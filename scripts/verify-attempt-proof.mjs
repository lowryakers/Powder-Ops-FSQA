// verify:attemptproof — a quiz attempt named as proof of competence on a
// training record must be THIS person's PASS at THIS course (D-276).
//
// Before this, POST /api/training took any `test_attempt_id` string as a passed
// quiz: somebody else's attempt, a failed one, one at another course, or an id
// that does not exist all saved a completed record with no competence tick.
// The task card already refused these (D-158); both doors now share one rule,
// `attemptProblem` in server/training-records.js.
//
// Caller sets PORT + DBPATH (the runner boots the server).
// Control: drop the attemptProblem call from POST /api/training — the four
// "refused" checks fail with 201.
import Database from 'better-sqlite3';

const PORT = Number(process.env.PORT || 5164);
const DBP = process.env.DBPATH || process.env.DB_PATH;
let pass = 0, fail = 0;
const t = (n, ok, d = '') => { if (ok) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n}${d ? ' — ' + d : ''}`); } };

const db = new Database(DBP);
const mk = (id, name, role, dept) => db.prepare(`INSERT OR REPLACE INTO users
  (id,name,username,role,department,is_active,setup_code,setup_code_expires_at)
  VALUES (?,?,?,?,?,1,?,datetime('now','+7 day'))`).run(id, name, name, role, dept, `SC-${id}`);
mk('ap-admin', 'Avery Proof', 'admin', 'admin');
mk('ap-a', 'Ana Quiz', 'operator', 'warehouse');
mk('ap-b', 'Ben Other', 'operator', 'warehouse');
const courses = db.prepare('SELECT id FROM training_courses WHERE active = 1 ORDER BY code LIMIT 2').all();
const [C1, C2] = courses.map(c => c.id);
db.prepare(`INSERT OR REPLACE INTO training_tests (id, course_id, title, passing_score) VALUES ('ap-test', ?, 'Fixture test', 80)`).run(C1);
const att = (id, course, uid, name, score, passed) => db.prepare(`INSERT OR REPLACE INTO training_test_attempts
  (id, test_id, course_id, employee_name, employee_user_id, score, passed) VALUES (?, 'ap-test', ?, ?, ?, ?, ?)`)
  .run(id, course, name, uid, score, passed);
att('ap-pass-a', C1, 'ap-a', 'Ana Quiz', 90, 1);       // Ana passed course 1
att('ap-fail-a', C1, 'ap-a', 'Ana Quiz', 40, 0);       // Ana failed course 1
att('ap-pass-b', C1, 'ap-b', 'Ben Other', 95, 1);      // Ben passed course 1
att('ap-pass-a-c2', C2, 'ap-a', 'Ana Quiz', 100, 1);   // Ana passed course 2
att('ap-name-only', C1, null, 'ana quiz', 85, 1);      // a paper-era attempt with no account id
db.close();

const H = { 'Content-Type': 'application/json' };
const call = async (m, p, b, tok) => {
  const r = await fetch(`http://localhost:${PORT}/api${p}`, { method: m, headers: { ...H, ...(tok && { Authorization: `Bearer ${tok}` }) }, body: b ? JSON.stringify(b) : undefined });
  let json = null; try { json = await r.json(); } catch { /* not json */ }
  return { status: r.status, json };
};
await call('POST', '/users/set-password', { user_id: 'ap-admin', password: 'Proof2026!!', setup_code: 'SC-ap-admin' });
const tok = (await call('POST', '/users/login', { name: 'Avery Proof', password: 'Proof2026!!' })).json?.token;
t('two courses and a signed-in admin', !!C1 && !!C2 && !!tok);

// A completed record whose only evidence is the attempt — no score, no tick.
const file = (attempt, extra = {}) => call('POST', '/training', {
  employee_name: 'Ana Quiz', employee_user_id: 'ap-a', course_id: C1, status: 'completed',
  training_date: '2026-10-01', completion_date: '2026-10-01', method: 'quiz', test_attempt_id: attempt, ...extra,
}, tok);

console.log('\n── refused ──');
let r = await file('ap-pass-b');
t("somebody else's passed attempt is refused", r.status === 400 && r.json?.code === 'ATTEMPT_MISMATCH', `${r.status} ${r.json?.error}`);
r = await file('ap-fail-a');
t("the person's own FAILED attempt is refused", r.status === 400 && r.json?.code === 'ATTEMPT_MISMATCH' && /did not pass/.test(r.json?.error || ''), `${r.status} ${r.json?.error}`);
r = await file('ap-pass-a-c2');
t("the person's pass at a DIFFERENT course is refused", r.status === 400 && r.json?.code === 'ATTEMPT_MISMATCH', `${r.status} ${r.json?.error}`);
r = await file('made-up-attempt-id');
t('an attempt id that does not exist is refused', r.status === 400 && r.json?.code === 'ATTEMPT_MISMATCH' && /not found/.test(r.json?.error || ''), `${r.status} ${r.json?.error}`);
r = await file('ap-pass-b', { competence_confirmed: true });
t('a mismatched attempt is refused even with the trainer\'s tick (the record would cite it)', r.status === 400 && r.json?.code === 'ATTEMPT_MISMATCH');
{
  const d = new Database(DBP, { readonly: true });
  const n = d.prepare("SELECT COUNT(*) n FROM training_records WHERE employee_user_id = 'ap-a'").get().n;
  t('nothing was filed by the refusals', n === 0, `${n} rows`);
  d.close();
}

console.log('\n── accepted ──');
r = await file('ap-pass-a');
t("the person's own pass at this course is accepted with no tick", r.status === 201 && r.json?.test_attempt_id === 'ap-pass-a', `${r.status} ${JSON.stringify(r.json).slice(0, 160)}`);
const recId = r.json?.id;
r = await call('POST', '/training', {
  employee_name: 'Ana Quiz', course_id: C1, status: 'completed', training_date: '2026-10-02', completion_date: '2026-10-02',
  method: 'quiz', test_attempt_id: 'ap-name-only',
}, tok);
t('an attempt with no account id matches on the name, case aside', r.status === 201, `${r.status} ${r.json?.error}`);

console.log('\n── an edit cannot carry the attempt to someone else ──');
r = await call('PUT', `/training/${recId}`, { employee_name: 'Ben Other', employee_user_id: 'ap-b' }, tok);
t('moving the record to another person is refused while it cites the attempt', r.status === 400 && r.json?.code === 'ATTEMPT_MISMATCH', `${r.status} ${r.json?.error}`);
r = await call('PUT', `/training/${recId}`, { course_id: C2 }, tok);
t('moving it to another course is refused', r.status === 400 && r.json?.code === 'ATTEMPT_MISMATCH', `${r.status} ${r.json?.error}`);
r = await call('PUT', `/training/${recId}`, { notes: 'Re-read SOP section 4' }, tok);
t('an ordinary edit of the same record still saves', r.status === 200, `${r.status} ${r.json?.error}`);

console.log(`\n${pass}/${pass + fail} assertions passed`);
process.exit(fail ? 1 : 0);
