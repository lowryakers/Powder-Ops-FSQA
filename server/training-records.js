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
import { plantDateOf } from './plant-clock.js';

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
  // A RESULT BELOW THE PASS MARK IS NOT A COMPLETION (D-158). It is filed —
  // somebody sat the test and that is a fact — but as `failed`: no completion
  // date, no retraining clock, and it never supersedes a completion already on
  // file. Filed as `completed` it read "trained" on the matrix and pushed the
  // person's real pass out of the way.
  const failed = body.passed === false || body.passed === 0;
  if (failed) body = { ...body, status: 'failed', completion_date: null };
  const completion = failed ? null : (body.completion_date || (body.status === 'completed' ? (body.training_date || plantDateOf()) : null));
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
    body.training_date || plantDateOf(), completion,
    failed ? 'failed' : (body.status || (completion ? 'completed' : 'scheduled')),
    body.passed === undefined ? null : (body.passed ? 1 : 0), body.score ?? null, next_due,
    body.certificate_url || null, body.document_url || null, body.gdrive_url || null, body.test_attempt_id || null, body.notes || null, sopRevision);
  if (!failed && (body.status === 'completed' || completion)) supersedeOlder(db, body.employee_name, body.course_id, id, body.employee_user_id || null);
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
export function gradeTestAttempt(db, { course_id, employee_name, employee_user_id = null, answers, test_id = null }) {
  const course = db.prepare('SELECT * FROM training_courses WHERE id = ?').get(course_id);
  if (!course) return { error: 'Course not found' };
  // GRADED AGAINST THE VERSION THAT WAS ON SCREEN (D-158). Editing a test makes
  // a new version with new question ids; somebody halfway through the old one
  // submitted answers keyed to questions the current version does not have,
  // and scored 0. A version of THIS course is honoured; anything else falls
  // back to the current one.
  const test = (test_id && db.prepare('SELECT * FROM training_tests WHERE id = ? AND course_id = ?').get(test_id, course_id))
    || db.prepare('SELECT * FROM training_tests WHERE course_id = ? AND is_current = 1').get(course_id);
  if (!test) return { error: 'No test for this course' };

  const questions = db.prepare('SELECT * FROM training_questions WHERE test_id = ? ORDER BY position').all(test.id);
  const results = questions.map((q, i) => questionResult(q, answers?.[q.id], i));
  const { score, passed, passing } = scoreResults(results, test.passing_score);

  // THE SAME SUBMISSION TWICE IS ONE ATTEMPT (D-158, the D-137 rule). A
  // submit made on a dropped connection is queued and replayed, and a second
  // tap can beat the button disabling — identical answers to the same test
  // from the same person within two minutes return the attempt already filed.
  const answersJson = JSON.stringify(Object.fromEntries(Object.entries(answers || {}).sort(([a], [b]) => (a < b ? -1 : 1))));
  const repeat = db.prepare(`SELECT * FROM training_test_attempts WHERE test_id = ? AND answers = ?
      AND ((? IS NOT NULL AND employee_user_id = ?) OR LOWER(employee_name) = LOWER(?))
      AND taken_at >= datetime('now', '-2 minutes') ORDER BY taken_at DESC LIMIT 1`)
    .get(test.id, answersJson, employee_user_id, employee_user_id, employee_name);
  if (repeat) {
    const record = repeat.record_id ? db.prepare('SELECT * FROM training_records WHERE id = ?').get(repeat.record_id) : null;
    return { attempt_id: repeat.id, score: repeat.score, passed: !!repeat.passed, passing_score: passing, record, course,
      missed: results.filter(r => !r.correct).map(r => r.number), results, duplicate: true };
  }

  // THE PER-QUESTION OUTCOME IS FROZEN WITH THE ATTEMPT (D-144), the expected
  // answer included — so a reviewer reads what this person got right and
  // wrong against the key as it stood that day, not against a test somebody
  // has since re-written. The `atp_limit` rule.
  const attemptId = uuid();
  db.prepare('INSERT INTO training_test_attempts (id, test_id, course_id, employee_name, employee_user_id, answers, score, passed, results) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(attemptId, test.id, course_id, employee_name, employee_user_id || null, answersJson, score, passed ? 1 : 0, JSON.stringify(results));

  let record = null;
  if (passed) {
    record = insertCompletion(db, {
      employee_name, employee_user_id, course_id, course_title: course.title,
      method: 'online_test', status: 'completed', passed: true, score,
      // THE PLANT'S DAY, not UTC's (D-158): a test passed after 6pm Mountain
      // was dated tomorrow, and its retraining clock ran a day short.
      completion_date: plantDateOf(), test_attempt_id: attemptId,
    });
    db.prepare('UPDATE training_test_attempts SET record_id = ? WHERE id = ?').run(record.id, attemptId);
  }
  // The trainee is told WHICH questions to look at again — by number, never
  // with the answer, or the retake is a copy of the key.
  const missed = results.filter(r => !r.correct).map(r => r.number);
  return { attempt_id: attemptId, score, passed, passing_score: passing, record, course, missed, results };
}

/**
 * The score and the verdict from graded questions — the ONE rule.
 *
 * THE SCORE IS ROUNDED DOWN, NEVER UP (D-158). It was rounded to the nearest
 * whole percent and THEN compared with the pass mark, so 11 of 13 (84.6%)
 * "scored 85%" and passed an 85% test. The score shown is what was earned.
 */
export function scoreResults(results, passingScore) {
  const earned = results.reduce((n, r) => n + (r.correct ? r.points : 0), 0);
  const total = results.reduce((n, r) => n + r.points, 0);
  const passing = passingScore ?? 80;
  // A hair of tolerance so 4/5 is 80, not 79.99999.
  const score = total ? Math.floor((earned / total) * 100 + 1e-9) : 0;
  return { score, passed: total > 0 && score >= passing, passing, earned, total };
}

/**
 * One question graded: the given answer against the key. ONE rule, used by the
 * grader and by the review of an attempt filed before results were frozen.
 * Short answer is a keyword match (`keywordMatch`, whole words).
 *
 * A MULTIPLE-CHOICE KEY IS THE OPTION'S POSITION (D-157) — `"2"` — in the
 * seeds, the course editor and the AI generator alike, while the test screen
 * sends the WORDS of the option that was tapped (the English words, whatever
 * language the label was shown in). Comparing the two strings marked every
 * multiple-choice answer wrong, so every test read "not passed". Both sides
 * are resolved to an option POSITION here and compared as positions: a
 * caller sending the position still works, a key written as the option's
 * words still works, and an option whose words are themselves a number
 * ("2") is matched as words before it is read as a position.
 */
const optionList = (v) => {
  if (Array.isArray(v)) return v;
  try { const a = JSON.parse(v || '[]'); return Array.isArray(a) ? a : []; } catch { return []; }
};
const norm = (v) => String(v ?? '').trim().toLowerCase();
const isIndex = (v, n) => /^\d+$/.test(v) && Number(v) < n;

/** Which option a value names: its words (English or the plant's Spanish) first, then a position. */
function optionIndexOf(value, options, optionsEs) {
  const v = norm(value);
  if (!v) return null;
  let i = options.findIndex((o) => norm(o) === v);
  if (i >= 0) return i;
  i = optionsEs.findIndex((o) => norm(o) === v);
  if (i >= 0) return i;
  return isIndex(v, options.length) ? Number(v) : null;
}

/**
 * A short answer is right when the key's WORDS appear in it, in order (D-158).
 * It was a substring test, so a key of "no" was found inside "I don't know"
 * and "know", and "hand-washing" did not match "hand washing". Case, accents
 * and punctuation are ignored; a word is only ever matched whole.
 */
const words = (v) => String(v ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
export function keywordMatch(given, key) {
  const k = words(key);
  if (!k) return false;
  return ` ${words(given)} `.includes(` ${k} `);
}

export function questionResult(q, given, index) {
  const correctRaw = String(q.correct_answer ?? '').trim();
  const correct = correctRaw.toLowerCase();
  const g = given === undefined || given === null ? '' : String(given).trim();
  const options = optionList(q.options);
  const optionsEs = optionList(q.options_es);
  let ok = false;
  let expected = correctRaw || null;
  if (q.type === 'multiple_choice' && options.length) {
    // The key: a position when it is one, otherwise the words of an option.
    const keyIdx = isIndex(correct, options.length) ? Number(correct) : optionIndexOf(correctRaw, options, optionsEs);
    if (keyIdx !== null) expected = String(options[keyIdx] ?? correctRaw);
    if (g !== '') {
      const gotIdx = optionIndexOf(g, options, optionsEs);
      ok = keyIdx !== null && gotIdx !== null ? gotIdx === keyIdx : g.toLowerCase() === correct;
    }
  } else if (g !== '') {
    ok = q.type === 'short_answer' ? keywordMatch(g, correctRaw) : g.toLowerCase() === correct;
  }
  return {
    // The number the trainee saw: questions are served in position order and
    // shown as "3 of 20", so it is the index, not the stored position.
    question_id: q.id, number: index + 1,
    prompt: q.prompt, type: q.type, given: g || null, expected,
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
