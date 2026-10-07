// Which test questions people get wrong, per course (D-159).
//
// Asked after D-157: a test whose key was wrong would mark everybody wrong on
// the same question, and the only way to see that was to open attempts one by
// one. This is the answer from the other side — one row per QUESTION.
//
// COUNTED BY PERSON, NOT BY ATTEMPT. Each person's LATEST attempt at a test
// version is the one that counts: eleven retakes by one person (the shape
// D-157's fault produced) must not read as eleven people missing a question.
// The attempt total is reported beside it, as information.
//
// GRADED BY THE ONE GRADER. Every answer is put through `questionResult`
// against the questions of the version that was taken — never a frozen
// `expected` string, which before D-157 held a position ("2") and not words.
//
// IT FLAGS, IT NEVER CHANGES A KEY. `key_check` is raised when most people
// miss a question AND most of those who missed it chose the SAME other
// answer — the pattern a wrong key makes, as opposed to a hard question, where
// wrong answers scatter. Whether the key is wrong is the course owner's call,
// made in the test editor; a key the app rewrote on a vote would be a
// fabricated answer to a safety question.
import { questionResult, optionList, optionIndexOf } from './training-records.js';

export const KEY_CHECK = { minPeople: 3, missRate: 0.5, agreeRate: 0.6 };

/** What somebody chose, as the option's words where it names an option. */
function answerLabel(q, given) {
  if (given === null || given === undefined || given === '') return null;
  if (q.type !== 'multiple_choice') return String(given).trim();
  const options = optionList(q.options);
  const i = optionIndexOf(given, options, optionList(q.options_es));
  return i === null ? String(given).trim() : String(options[i]);
}

const personOf = (a) => a.employee_user_id || `name:${String(a.employee_name || '').trim().toLowerCase()}`;

/**
 * @returns {{ courses: Array, key_checks: number }} — courses that have
 * attempts, worst question first; `include_old` adds superseded test versions.
 */
export function questionMisses(db, { course_id = null, include_old = false } = {}) {
  const params = [];
  let where = '1=1';
  if (course_id) { where += ' AND t.course_id = ?'; params.push(course_id); }
  if (!include_old) where += ' AND t.is_current = 1';
  const tests = db.prepare(`SELECT t.id, t.course_id, t.version, t.is_current, t.passing_score,
      c.code AS course_code, c.title AS course_title
    FROM training_tests t JOIN training_courses c ON c.id = t.course_id
    WHERE ${where} AND EXISTS (SELECT 1 FROM training_test_attempts a WHERE a.test_id = t.id)`).all(...params);
  const qStmt = db.prepare('SELECT * FROM training_questions WHERE test_id = ? ORDER BY position');
  const aStmt = db.prepare(`SELECT id, employee_name, employee_user_id, answers, passed, taken_at
    FROM training_test_attempts WHERE test_id = ? ORDER BY taken_at, rowid`);

  const courses = [];
  let keyChecks = 0;
  for (const t of tests) {
    const questions = qStmt.all(t.id);
    const attempts = aStmt.all(t.id);
    const latest = new Map();
    for (const a of attempts) latest.set(personOf(a), a);   // ordered by time: the last write wins
    const people = [...latest.values()];
    const rows = questions.map((q, i) => {
      let answered = 0;
      const missedBy = [];
      const wrong = new Map();
      let expected = null;
      for (const a of people) {
        const answers = (() => { try { return JSON.parse(a.answers || '{}') || {}; } catch { return {}; } })();
        const r = questionResult(q, answers[q.id], i);
        expected = r.expected;
        answered++;
        if (r.correct) continue;
        missedBy.push(a.employee_name);
        const label = answerLabel(q, answers[q.id]) ?? '(no answer)';
        wrong.set(label, (wrong.get(label) || 0) + 1);
      }
      const missed = missedBy.length;
      const top = [...wrong.entries()].sort((x, y) => y[1] - x[1])[0] || null;
      const missRate = answered ? missed / answered : 0;
      const keyCheck = answered >= KEY_CHECK.minPeople && missRate >= KEY_CHECK.missRate
        && !!top && top[0] !== '(no answer)' && top[1] / missed >= KEY_CHECK.agreeRate;
      if (keyCheck) keyChecks++;
      return {
        question_id: q.id, number: i + 1, prompt: q.prompt, type: q.type,
        expected: expected ?? (String(q.correct_answer ?? '') || null),
        people: answered, missed, miss_rate: Math.round(missRate * 100),
        top_wrong: top ? { answer: top[0], people: top[1] } : null,
        wrong_answers: [...wrong.entries()].sort((x, y) => y[1] - x[1]).map(([answer, n]) => ({ answer, people: n })),
        missed_by: missedBy.slice(0, 25),
        key_check: keyCheck,
      };
    }).sort((x, y) => y.miss_rate - x.miss_rate || y.missed - x.missed || x.number - y.number);
    courses.push({
      course_id: t.course_id, course_code: t.course_code, course_title: t.course_title,
      test_id: t.id, version: t.version, is_current: !!t.is_current, passing_score: t.passing_score ?? 80,
      people: people.length, attempts: attempts.length,
      passed_people: people.filter(a => a.passed).length,
      key_checks: rows.filter(r => r.key_check).length,
      worst_miss_rate: rows.length ? rows[0].miss_rate : 0,
      questions: rows,
    });
  }
  courses.sort((x, y) => y.key_checks - x.key_checks || y.worst_miss_rate - x.worst_miss_rate
    || String(x.course_code || x.course_title).localeCompare(String(y.course_code || y.course_title)));
  return { courses, key_checks: keyChecks, rule: KEY_CHECK };
}
