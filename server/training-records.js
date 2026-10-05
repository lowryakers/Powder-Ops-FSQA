// Filing a training completion — the ONE writer, so a completion filed from
// the Training Records screen and one filed by finishing an assigned task are
// byte-for-byte the same record.
//
// Extracted from api/training.js rather than copied when assignments shipped:
// `check-records.js` files the record a completed assignment is evidence for,
// and a second insert there would be a second answer to "what does a
// completion look like" — the drift this codebase keeps unpicking. Same
// arrangement as `capa-raise.js`, which both the internal audit and the check
// records raise CARs through.

import { v4 as uuid } from 'uuid';

export const addMonths = (isoDate, months) => {
  if (!isoDate || !months) return null;
  const d = new Date(isoDate + (isoDate.length <= 10 ? 'T00:00:00' : ''));
  if (Number.isNaN(d.getTime())) return null;
  d.setMonth(d.getMonth() + months);
  return d.toISOString().slice(0, 10);
};

/** A completion's retraining due date, from the course's own cadence. */
export function dueDateFor(db, courseId, completionDate) {
  if (!courseId || !completionDate) return null;
  const c = db.prepare('SELECT retrain_months FROM training_courses WHERE id = ?').get(courseId);
  if (!c || !c.retrain_months) return null;
  return addMonths(completionDate, c.retrain_months);
}

/**
 * Mark earlier completions of the same course by the same person superseded,
 * so the matrix reflects the most recent one.
 *
 * MATCHED ON THE ACCOUNT WHERE THERE IS ONE, the name otherwise. Name-only
 * matching left a renamed person with two "current" completions — the record
 * filed under the old spelling was never superseded — the same split the
 * time-adjustment and pay-roster keys had.
 */
export function supersedeOlder(db, employeeName, courseId, keepId, employeeUserId = null) {
  if (!courseId) return;
  db.prepare(`UPDATE training_records SET superseded = 1
    WHERE id != ? AND course_id = ?
      AND (LOWER(employee_name) = LOWER(?) OR (? IS NOT NULL AND employee_user_id = ?))`)
    .run(keepId, courseId, employeeName, employeeUserId, employeeUserId);
}

/** The revision of a course's linked document that current training must reflect. */
export function courseTrainingRevision(db, courseId) {
  if (!courseId) return null;
  const c = db.prepare('SELECT sop_id FROM training_courses WHERE id = ?').get(courseId);
  if (!c?.sop_id) return null;
  const d = db.prepare('SELECT training_revision, revision FROM sop_documents WHERE id = ?').get(c.sop_id);
  return d?.training_revision || d?.revision || null;
}

/** File one completion. Returns the stored row. */
export function insertCompletion(db, body) {
  const id = uuid();
  const completion = body.completion_date || (body.status === 'completed' ? (body.training_date || new Date().toISOString().slice(0, 10)) : null);
  const next_due = dueDateFor(db, body.course_id, completion);
  // Stamp the document revision this completion was trained against.
  const sopRevision = body.sop_revision || courseTrainingRevision(db, body.course_id);
  db.prepare(`INSERT INTO training_records
    (id, employee_name, employee_id, employee_user_id, training_topic, course_id, sop_id, trainer, method,
     training_date, completion_date, status, passed, score, next_due_date, certificate_url, document_url, gdrive_url, test_attempt_id, notes, sop_revision)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    id, body.employee_name, body.employee_id || null, body.employee_user_id || null,
    body.training_topic || body.course_title || '', body.course_id || null, body.sop_id || null,
    body.trainer || null, body.method || null,
    body.training_date || new Date().toISOString().slice(0, 10), completion,
    body.status || (completion ? 'completed' : 'scheduled'),
    body.passed === undefined ? null : (body.passed ? 1 : 0), body.score ?? null, next_due,
    body.certificate_url || null, body.document_url || null, body.gdrive_url || null, body.test_attempt_id || null, body.notes || null, sopRevision);
  if (body.status === 'completed' || completion) supersedeOlder(db, body.employee_name, body.course_id, id, body.employee_user_id || null);
  return db.prepare('SELECT * FROM training_records WHERE id = ?').get(id);
}

/**
 * Grade a test attempt and file what it implies — the ONE grader.
 *
 * Extracted when an assigned course became takeable from the task itself:
 * the Training Records screen, the kiosk and the operator's own task list
 * all grade the same test, and three copies of "what counts as a pass" is
 * how one door starts certifying people the others would fail.
 *
 * PASSING IS THE COMPLETION. The record is filed here, the moment they pass,
 * rather than waiting for somebody to press a button afterwards — an
 * operator who passes the forklift test and closes the app has been trained,
 * and a record that depends on a second act is one that goes missing.
 */
export function gradeTestAttempt(db, { course_id, employee_name, employee_user_id = null, answers }) {
  const course = db.prepare('SELECT * FROM training_courses WHERE id = ?').get(course_id);
  if (!course) return { error: 'Course not found' };
  const test = db.prepare('SELECT * FROM training_tests WHERE course_id = ? AND is_current = 1').get(course_id);
  if (!test) return { error: 'No test for this course' };

  const questions = db.prepare('SELECT * FROM training_questions WHERE test_id = ? ORDER BY position').all(test.id);
  const results = questions.map((q, i) => questionResult(q, answers?.[q.id], i));
  const earned = results.reduce((n, r) => n + (r.correct ? r.points : 0), 0);
  const total = results.reduce((n, r) => n + r.points, 0);
  const score = total ? Math.round((earned / total) * 100) : 0;
  const passing = test.passing_score ?? 80;
  const passed = score >= passing;

  // THE PER-QUESTION OUTCOME IS FROZEN WITH THE ATTEMPT (D-144), the expected
  // answer included — so a reviewer reads what this person got right and
  // wrong against the key as it stood that day, not against a test somebody
  // has since re-written. The `atp_limit` rule.
  const attemptId = uuid();
  db.prepare('INSERT INTO training_test_attempts (id, test_id, course_id, employee_name, employee_user_id, answers, score, passed, results) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(attemptId, test.id, course_id, employee_name, employee_user_id || null, JSON.stringify(answers || {}), score, passed ? 1 : 0, JSON.stringify(results));

  let record = null;
  if (passed) {
    record = insertCompletion(db, {
      employee_name, employee_user_id, course_id, course_title: course.title,
      method: 'online_test', status: 'completed', passed: true, score,
      completion_date: new Date().toISOString().slice(0, 10), test_attempt_id: attemptId,
    });
    db.prepare('UPDATE training_test_attempts SET record_id = ? WHERE id = ?').run(record.id, attemptId);
  }
  // The trainee is told WHICH questions to look at again — by number, never
  // with the answer, or the retake is a copy of the key.
  const missed = results.filter(r => !r.correct).map(r => r.number);
  return { attempt_id: attemptId, score, passed, passing_score: passing, record, course, missed, results };
}

/**
 * One question graded: the given answer against the key. ONE rule, used by the
 * grader and by the review of an attempt filed before results were frozen.
 * Short answer is a keyword match: correct when the expected text appears.
 */
export function questionResult(q, given, index) {
  const correctRaw = String(q.correct_answer ?? '').trim();
  const correct = correctRaw.toLowerCase();
  const g = given === undefined || given === null ? '' : String(given).trim();
  let ok = false;
  if (g !== '') {
    ok = q.type === 'short_answer' ? (!!correct && g.toLowerCase().includes(correct)) : g.toLowerCase() === correct;
  }
  return {
    // The number the trainee saw: questions are served in position order and
    // shown as "3 of 20", so it is the index, not the stored position.
    question_id: q.id, number: index + 1,
    prompt: q.prompt, type: q.type, given: g || null, expected: correctRaw || null,
    correct: ok, points: Number(q.points) || 0,
  };
}

/**
 * An attempt with its per-question outcome for a reviewer. An attempt filed
 * before D-144 has no frozen results: they are re-derived from its stored
 * answers against the CURRENT key and SAID to be (`derived: true`) — the key
 * may have moved since.
 */
export function attemptReview(db, id) {
  const a = db.prepare(`SELECT a.*, c.title AS course_title, c.code AS course_code FROM training_test_attempts a
    LEFT JOIN training_courses c ON c.id = a.course_id WHERE a.id = ?`).get(id);
  if (!a) return null;
  let derived = false;
  let results = (() => { try { return a.results ? JSON.parse(a.results) : null; } catch { return null; } })();
  if (!results) {
    let answers = {};
    try { answers = JSON.parse(a.answers || '{}'); } catch { answers = {}; }
    const qs = db.prepare('SELECT * FROM training_questions WHERE test_id = ? ORDER BY position').all(a.test_id);
    results = qs.map((q, i) => questionResult(q, answers[q.id], i));
    derived = true;
  }
  const { answers: _a, results: _r, ...rest } = a;
  return { ...rest, passed: !!a.passed, results, derived,
    right: results.filter(r => r.correct).length, wrong: results.filter(r => !r.correct).length };
}
