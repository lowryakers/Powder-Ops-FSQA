// Re-grading the test attempts the grader got wrong (D-157).
//
// Until D-157 every multiple-choice question was marked wrong: the key is the
// option's POSITION ("2") and the test screen sends the option's WORDS. So the
// attempts already on file carry a score and a "not passed" that the answers
// they hold do not support — and Daniela, who tapped every right answer, was
// told she missed two.
//
// NOTHING HERE IS INVENTED. Each attempt keeps the answers the person actually
// gave; those are graded again, by the one grader, against the questions of
// the test version that was taken (a test edit makes a new version and keeps
// the old questions, so the key is the key as it stood that day).
//
// What follows from an attempt that now passes is what would have followed on
// the day: the completion is filed DATED THE DAY THE TEST WAS TAKEN, and the
// training task it answered is closed as of that moment. Both say they came
// from a re-grade. One completion per person per course — the FIRST passing
// attempt, because any later ones were retakes the fault sent them back for —
// and none where a completion on or after that day is already on file.
//
// Idempotent by construction: an attempt whose stored outcome already matches
// its re-grade is left alone, so a second boot changes nothing. A re-grade
// that would LOWER a score is reported and never applied — a filed outcome is
// only ever corrected in the direction the fault pushed it.

import { questionResult, insertCompletion, scoreResults } from './training-records.js';
import { plantDateOf } from './plant-clock.js';
import { logAudit } from './db.js';

const OPEN = ['open', 'in_progress', 'overdue', 'missed'];

export function regradeFiledAttempts(db) {
  const attempts = db.prepare(`SELECT a.*, t.passing_score, c.title AS course_title
    FROM training_test_attempts a
    LEFT JOIN training_tests t ON t.id = a.test_id
    LEFT JOIN training_courses c ON c.id = a.course_id
    ORDER BY a.taken_at, a.rowid`).all();
  const qStmt = db.prepare('SELECT * FROM training_questions WHERE test_id = ? ORDER BY position');
  const out = { checked: attempts.length, regraded: 0, now_passed: 0, records_filed: 0, tasks_closed: 0, lowered_skipped: 0, people: [] };
  const filedFor = new Set();

  for (const a of attempts) {
    let answers = {};
    try { answers = JSON.parse(a.answers || '{}') || {}; } catch { continue; }
    const questions = qStmt.all(a.test_id);
    if (!questions.length) continue;
    const results = questions.map((q, i) => questionResult(q, answers[q.id], i));
    const { score, passed } = scoreResults(results, a.passing_score);
    // D-158 rounds the score down where it used to round to the nearest, so a
    // stored 67 now computes as 66 from the same answers. That is not a
    // re-grade: the same verdict within a point is left exactly as filed.
    if ((passed ? 1 : 0) === a.passed && Math.abs(score - (a.score ?? 0)) <= 1) continue;
    if (score < (a.score ?? 0) || (a.passed && !passed)) {
      out.lowered_skipped++;
      console.warn(`[training-regrade] attempt ${a.id} would drop ${a.score}% → ${score}%; left as filed`);
      continue;
    }

    const day = plantDateOf(a.taken_at) || String(a.taken_at || '').slice(0, 10);
    db.transaction(() => {
      db.prepare('UPDATE training_test_attempts SET score = ?, passed = ?, results = ? WHERE id = ?')
        .run(score, passed ? 1 : 0, JSON.stringify(results), a.id);
      out.regraded++;
      logAudit('system', 'regrade', 'training_test_attempt', a.id,
        { course: a.course_title, for: a.employee_name, taken_on: day, score_was: a.score, score, passed_was: !!a.passed, passed,
          reason: 'Multiple-choice answers were compared with the option position instead of the option (D-157)' },
        { score: a.score, passed: !!a.passed }, { score, passed }, a.course_title);

      if (!passed || a.passed) return;
      out.now_passed++;
      out.people.push(`${a.employee_name} — ${a.course_title} ${score}% on ${day}`);
      const who = `${a.course_id}|${a.employee_user_id || String(a.employee_name || '').toLowerCase()}`;
      if (filedFor.has(who) || a.record_id) return;
      const existing = db.prepare(`SELECT 1 FROM training_records WHERE course_id = ? AND superseded = 0 AND status = 'completed'
          AND (LOWER(employee_name) = LOWER(?) OR (? IS NOT NULL AND employee_user_id = ?))
          AND completion_date >= ?`).get(a.course_id, a.employee_name, a.employee_user_id, a.employee_user_id, day);
      filedFor.add(who);
      if (existing) return;

      const note = `Passed the online test on ${day} (${score}%). It was graded as not passed by a fault in the grader and re-graded on ${plantDateOf()} from the answers given (D-157).`;
      const record = insertCompletion(db, {
        employee_name: a.employee_name, employee_user_id: a.employee_user_id, course_id: a.course_id, course_title: a.course_title,
        method: 'online_test', status: 'completed', passed: true, score,
        training_date: day, completion_date: day, test_attempt_id: a.id, notes: note,
      });
      db.prepare('UPDATE training_test_attempts SET record_id = ? WHERE id = ?').run(record.id, a.id);
      out.records_filed++;
      logAudit('system', 'create', 'training_record', record.id, { course: a.course_title, for: a.employee_name, from_regrade: a.id, completion_date: day }, null, null, a.course_title);

      // The task that asked for this training: theirs, this course, still open,
      // and raised before the test was taken (a later assignment is a new ask).
      const tasks = db.prepare(`SELECT id, notes FROM work_orders WHERE training_course_id = ?
          AND status IN (${OPEN.map(() => '?').join(',')})
          AND ((? IS NOT NULL AND assigned_to_id = ?) OR LOWER(assigned_to) = LOWER(?))
          AND created_at <= ?`).all(a.course_id, ...OPEN, a.employee_user_id, a.employee_user_id, a.employee_name, a.taken_at);
      for (const t of tasks) {
        db.prepare(`UPDATE work_orders SET status = 'completed', completed_at = ?, completed_by = ?,
            notes = TRIM(COALESCE(notes, '') || char(10) || ?), updated_at = datetime('now') WHERE id = ?`)
          .run(a.taken_at, a.employee_name, `Closed on re-grade: the test was passed on ${day} (D-157).`, t.id);
        out.tasks_closed++;
        logAudit('system', 'complete', 'work_order', t.id, { course: a.course_title, for: a.employee_name, from_regrade: a.id }, null, null, a.course_title);
      }
    })();
  }
  return out;
}

/**
 * A result below the pass mark filed as `completed` (D-158).
 *
 * The paper-score path, group sign-off with a score and a record edit all
 * filed a fail as `completed` with `passed = 0`. The matrix read that as
 * trained, and filing it superseded the person's real pass. Each is turned
 * into what it is — `failed`, no retraining clock — and where it had pushed a
 * genuine pass aside, the latest pass for that person and course is current
 * again. Nothing is deleted and no pass is invented: a person with no passing
 * record simply reads as not trained, which is the truth. Idempotent.
 */
export function repairFailedCompletions(db) {
  const bad = db.prepare("SELECT * FROM training_records WHERE status = 'completed' AND passed = 0").all();
  const out = { failed: bad.length, reinstated: 0, people: [] };
  for (const r of bad) {
    db.transaction(() => {
      db.prepare("UPDATE training_records SET status = 'failed', next_due_date = NULL, updated_at = datetime('now') WHERE id = ?").run(r.id);
      logAudit('system', 'update', 'training_record', r.id,
        { for: r.employee_name, course: r.training_topic, score: r.score, reason: 'A result below the pass mark is not a completion (D-158)' },
        { status: 'completed' }, { status: 'failed' }, r.training_topic);
      if (!r.course_id) return;
      const person = `(LOWER(employee_name) = LOWER(?) OR (? IS NOT NULL AND employee_user_id = ?))`;
      const args = [r.course_id, r.employee_name, r.employee_user_id, r.employee_user_id];
      const current = db.prepare(`SELECT 1 FROM training_records WHERE course_id = ? AND ${person}
        AND superseded = 0 AND status = 'completed' AND COALESCE(passed, 1) = 1`).get(...args);
      if (current) return;
      const pass = db.prepare(`SELECT * FROM training_records WHERE course_id = ? AND ${person}
        AND status = 'completed' AND COALESCE(passed, 1) = 1
        ORDER BY COALESCE(completion_date, training_date) DESC, created_at DESC LIMIT 1`).get(...args);
      if (!pass) return;
      db.prepare("UPDATE training_records SET superseded = 0, updated_at = datetime('now') WHERE id = ?").run(pass.id);
      out.reinstated++;
      out.people.push(`${pass.employee_name} — ${pass.training_topic} (${pass.completion_date})`);
      logAudit('system', 'reinstate', 'training_record', pass.id,
        { for: pass.employee_name, course: pass.training_topic, displaced_by: r.id, reason: 'Superseded by a failed result filed as a completion (D-158)' },
        null, null, pass.training_topic);
    })();
  }
  return out;
}

/**
 * One pass mark per course (D-158). The course form and the test editor each
 * kept one and the grader read only the test's. Where they disagree, the
 * TEST's number wins — it is the one every attempt on file was graded
 * against — and the course is brought into line. Reported by name.
 */
export function alignPassMarks(db) {
  const rows = db.prepare(`SELECT c.id, c.code, c.title, c.passing_score AS course_mark, t.passing_score AS test_mark
    FROM training_courses c JOIN training_tests t ON t.course_id = c.id AND t.is_current = 1
    WHERE t.passing_score IS NOT NULL AND (c.passing_score IS NULL OR c.passing_score != t.passing_score)`).all();
  for (const r of rows) {
    db.prepare("UPDATE training_courses SET passing_score = ?, updated_at = datetime('now') WHERE id = ?").run(r.test_mark, r.id);
    logAudit('system', 'update', 'training_course', r.id,
      { pass_mark_was: r.course_mark, pass_mark: r.test_mark, reason: 'The course form showed a pass mark the test was not graded against (D-158)' },
      { passing_score: r.course_mark }, { passing_score: r.test_mark }, r.title);
  }
  return rows.map(r => `${r.code || r.title}: ${r.course_mark}% → ${r.test_mark}%`);
}
