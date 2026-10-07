// verify:testgrading — D-157, live on a fresh database, a real browser, two reboots.
//
// Daniela (7 Oct): "she clicked all the correct answers and it's still showing
// that she missed 2 questions. And all of our Test Answers are showing 'not
// passed'." ALG-101 has three questions — multiple choice, true/false,
// multiple choice — and she was told 33%, "look at 1 and 3 again".
//
// The cause: a multiple-choice key is the option's POSITION ("2") in the seeds,
// the course editor and the AI generator, while the test screen sends the
// option's WORDS. Every multiple-choice answer was compared as a string with a
// number and marked wrong. The earlier verifies wrote their keys as words, which
// is the one shape nothing in the app writes — so they passed over the fault.
//
// This takes the REAL seeded tests, as the screen sends them, and re-grades
// attempts planted exactly as the old grader filed them.
//
// Caller sets PORT + DBPATH + DB_PATH (server already up). Needs a built client.
// The control is `main`: the seeded test cannot be passed.
import Database from 'better-sqlite3';
import { spawn } from 'child_process';
import { chromium } from 'playwright-core';

const PORT = Number(process.env.PORT || 5076);
const BOOT2 = PORT + 1;
const URL = `http://localhost:${PORT}`;
const B = `${URL}/api`;
const DBP = process.env.DBPATH;
let pass = 0, fail = 0;
const t = (n, ok, d = '') => { if (ok) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n}${d ? ' — ' + d : ''}`); } };
const J = async (r) => { try { return await r.json(); } catch { return null; } };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const q = (sql, ...a) => { const d = new Database(DBP, { readonly: true }); try { return d.prepare(sql).all(...a); } finally { d.close(); } };

const db = new Database(DBP);
const mk = (id, name, role, dept, modules) => db.prepare(`INSERT OR REPLACE INTO users (id,name,username,role,department,is_active,setup_code,setup_code_expires_at,module_access)
  VALUES (?,?,?,?,?,1,?,datetime('now','+7 day'),?)`).run(id, name, name, role, dept, `SC-${id}`, modules ? JSON.stringify(modules) : null);
mk('tg-dan', 'Daniela Grader', 'supervisor', 'document_control', { training: 'edit' });
mk('tg-op', 'Oscar Testtaker', 'operator', 'warehouse', null);
mk('tg-op2', 'Paula Phonetest', 'operator', 'warehouse', null);
const course = (code) => db.prepare('SELECT * FROM training_courses WHERE code = ?').get(code);
const keyOf = (courseId) => db.prepare(`SELECT q.* FROM training_questions q JOIN training_tests t ON t.id = q.test_id
  WHERE t.course_id = ? AND t.is_current = 1 ORDER BY q.position`).all(courseId).map((x) => ({ ...x, options: JSON.parse(x.options || '[]') }));
const ALG = course('ALG-101');
const SAF = course('SAF-201');
const algQs = keyOf(ALG.id);
const safQs = keyOf(SAF.id);
db.close();

// The option the key points to: a position for multiple choice, the word for true/false.
const keyIndex = (x) => (x.type === 'true_false'
  ? x.options.findIndex((o) => o.toLowerCase() === String(x.correct_answer).toLowerCase())
  : Number(x.correct_answer));
const rightWords = (qs) => Object.fromEntries(qs.map((x) => [x.id, x.options[keyIndex(x)]]));

t('the seeded ALG-101 test is the one Daniela took: multiple choice, true/false, multiple choice, keyed by position',
  algQs.map((x) => x.type).join() === 'multiple_choice,true_false,multiple_choice' && /^\d+$/.test(algQs[0].correct_answer));

const c = (m, p, b, tk) => fetch(B + p, { method: m, headers: { 'Content-Type': 'application/json', ...(tk ? { Authorization: `Bearer ${tk}` } : {}) }, body: b ? JSON.stringify(b) : undefined });
const login = async (id, name) => {
  await c('POST', '/users/login', { name });
  await c('POST', '/users/set-password', { user_id: id, password: 'Passw0rd!!', setup_code: `SC-${id}` });
  return J(await c('POST', '/users/login', { name, password: 'Passw0rd!!' }));
};
const dan = await login('tg-dan', 'Daniela Grader');
const op = await login('tg-op', 'Oscar Testtaker');
const op2 = await login('tg-op2', 'Paula Phonetest');
t('a reviewer and two operators sign in', !!dan?.token && !!op?.token && !!op2?.token);
const D = (m, p, b) => c(m, p, b, dan.token);
const woFor = (courseId, userId) => q(`SELECT * FROM work_orders WHERE training_course_id = ? AND assigned_to_id = ? ORDER BY (status = 'open') DESC, created_at DESC, rowid DESC`, courseId, userId)[0];

console.log('\n── the answers the screen sends: the words of the option tapped ──');
await D('POST', '/training/assign', { course_id: ALG.id, people: [{ user_id: 'tg-op', name: 'Oscar Testtaker' }] });
let wo = woFor(ALG.id, 'tg-op');
t('ALG-101 is assigned to Oscar', !!wo);
const words = rightWords(algQs);
let r = await J(await c('POST', `/pm/work-orders/${wo.id}/training-test`, { answers: words }, op.token));
t('every right answer, sent as the option\'s words, scores 100% and PASSES', r?.score === 100 && r?.passed === true, JSON.stringify(r));
t('…with nothing to look at again', JSON.stringify(r?.missed) === '[]', JSON.stringify(r?.missed));
t('…the completion is filed and the task closes', !!r?.record_id && r?.work_order_completed === true && woFor(ALG.id, 'tg-op').status === 'completed');
const rev = await J(await D('GET', `/training/attempts/${r.attempt_id}`));
t('the reviewer reads all three right, and "expected" is the option, not a number',
  rev?.right === 3 && rev?.wrong === 0 && rev.results[0].expected === algQs[0].options[Number(algQs[0].correct_answer)], JSON.stringify(rev?.results?.map((x) => x.expected)));

await D('POST', '/training/assign', { course_id: ALG.id, people: [{ user_id: 'tg-op', name: 'Oscar Testtaker' }] });
wo = woFor(ALG.id, 'tg-op');
const wrong = { ...words, [algQs[2].id]: algQs[2].options.find((o, i) => i !== Number(algQs[2].correct_answer)) };
r = await J(await c('POST', `/pm/work-orders/${wo.id}/training-test`, { answers: wrong }, op.token));
t('one wrong option is still wrong: 67%, not passed, question 3 named', r?.score === 67 && r?.passed === false && JSON.stringify(r?.missed) === '[3]', JSON.stringify(r));
const byPos = Object.fromEntries(algQs.map((x) => [x.id, x.type === 'multiple_choice' ? x.correct_answer : words[x.id]]));
r = await J(await c('POST', `/pm/work-orders/${wo.id}/training-test`, { answers: byPos }, op.token));
t('a caller that sends the option\'s POSITION is graded the same way', r?.score === 100 && r?.passed === true, JSON.stringify(r));

console.log('\n── a course written in the editor: Spanish options, and options that are numbers ──');
const made = await J(await D('POST', '/training/courses', { code: 'TG-101', title: 'Grading Edge Cases', has_test: true, passing_score: 100 }));
await D('PUT', `/training/courses/${made.id}/test`, { passing_score: 100, questions: [
  { type: 'multiple_choice', prompt: 'Where do used gloves go?', options: ['The floor', 'The bin'], options_es: ['El piso', 'El bote'], correct_answer: '1' },
  { type: 'multiple_choice', prompt: 'How many hairnets at once?', options: ['0', '2', '1'], correct_answer: '2' },
] });
await D('POST', '/training/assign', { course_id: made.id, people: [{ user_id: 'tg-op', name: 'Oscar Testtaker' }] });
wo = woFor(made.id, 'tg-op');
const madeQs = (await J(await c('GET', `/pm/work-orders/${wo.id}/training-test`, null, op.token))).questions;
t('the key never reaches the trainee', madeQs.every((x) => x.correct_answer === undefined));
r = await J(await c('POST', `/pm/work-orders/${wo.id}/training-test`, { answers: { [madeQs[0].id]: 'El bote', [madeQs[1].id]: '2' } }, op.token));
t('an option whose words are "2" is matched as WORDS — the second option, which is wrong', r?.passed === false && JSON.stringify(r?.missed) === '[2]', JSON.stringify(r));
t('…and the plant\'s Spanish words for the right option count as the right option', !r?.missed?.includes(1));
r = await J(await c('POST', `/pm/work-orders/${wo.id}/training-test`, { answers: { [madeQs[0].id]: 'The bin', [madeQs[1].id]: '1' } }, op.token));
t('the option reading "1" — the third, which the key names — passes', r?.passed === true, JSON.stringify(r));

console.log('\n── on the phone: tap the right answers on the seeded fire-safety test ──');
await D('POST', '/training/assign', { course_id: SAF.id, people: [{ user_id: 'tg-op2', name: 'Paula Phonetest' }] });
const safWo = woFor(SAF.id, 'tg-op2');
{ const d1 = new Database(DBP); d1.prepare("UPDATE work_orders SET due_date = date('now') WHERE id = ?").run(safWo.id); d1.close(); }
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.goto(`${URL}/manifest.webmanifest`);
  await page.evaluate(([tk, u]) => { localStorage.setItem('auth_token', tk); localStorage.setItem('auth_user', JSON.stringify(u)); }, [op2.token, op2.user]);
  await page.goto(`${URL}/?tab=operator`);
  await page.locator('[data-complete-task]').first().waitFor({ timeout: 15000 });
  const card = page.locator('div', { has: page.locator(`text=${SAF.title}`) }).filter({ has: page.locator('[data-complete-task]') }).last();
  await card.locator('[data-complete-task]').first().click();
  await page.locator('[data-take-test]:visible').first().click();
  await page.locator('[data-training-test]').waitFor();
  for (let i = 0; i < safQs.length; i++) {
    await page.locator(`[data-test-option="${keyIndex(safQs[i])}"]`).click();
    if (i < safQs.length - 1) { await page.locator('[data-test-next]').click(); await page.waitForTimeout(150); }
  }
  await page.locator('[data-test-submit]').click();
  await page.locator('[data-test-result]').waitFor();
  const res = await page.locator('[data-test-result]').getAttribute('data-test-result');
  const missed = await page.locator('[data-test-missed]').count() ? await page.locator('[data-test-missed]').getAttribute('data-test-missed') : '';
  t(`tapping all ${safQs.length} right answers reads PASSED`, res === 'passed', `${res} · missed ${missed} · ${await page.locator('[data-test-result]').innerText()}`);
  t('…with no question to look at again', !missed, String(missed));
  t('…and the task is closed', woFor(SAF.id, 'tg-op2').status === 'completed');

  const p2 = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await p2.goto(`${URL}/manifest.webmanifest`);
  await p2.evaluate(([tk, u]) => { localStorage.setItem('auth_token', tk); localStorage.setItem('auth_user', JSON.stringify(u)); }, [dan.token, dan.user]);
  await p2.goto(`${URL}/?tab=training&view=attempts`);
  await p2.locator('[data-training-attempts]').waitFor({ timeout: 15000 });
  const safAttempt = q('SELECT id FROM training_test_attempts WHERE course_id = ? AND employee_user_id = ?', SAF.id, 'tg-op2')[0];
  const row = p2.locator(`[data-attempt-row="${safAttempt.id}"]`);
  t('Test answers lists her attempt as passed, not "not passed"', /100%/.test(await row.innerText()) && !/not passed/i.test(await row.innerText()), await row.innerText());
  await row.click();
  await p2.locator('[data-attempt-review]').waitFor();
  const marks = await p2.locator('[data-attempt-q]').evaluateAll((els) => els.map((e) => e.getAttribute('data-attempt-correct')));
  t('…every question opens green', marks.length === safQs.length && marks.every((m) => m === '1'), marks.join(''));
} catch (e) { t('the screens rendered', false, e.message); }
finally { await browser.close(); }

console.log('\n── the attempts already on file, filed by the old grader ──');
// Planted exactly as the old grader wrote them: the right words given, the
// multiple-choice questions frozen as wrong, 33%, not passed.
const d2 = new Database(DBP);
const mk2 = (id, name) => d2.prepare(`INSERT OR REPLACE INTO users (id,name,username,role,department,is_active,module_access) VALUES (?,?,?,'operator','warehouse',1,NULL)`).run(id, name, name);
mk2('tg-dani', 'Daniela Planted');
mk2('tg-fail', 'Felix Wrongly');
mk2('tg-had', 'Hana Alreadydone');
const algTest = d2.prepare('SELECT * FROM training_tests WHERE course_id = ? AND is_current = 1').get(ALG.id);
const oldResults = (answers) => algQs.map((x, i) => ({ question_id: x.id, number: i + 1, prompt: x.prompt, type: x.type, given: answers[x.id] || null,
  expected: x.correct_answer, correct: x.type === 'true_false' && String(answers[x.id] || '').toLowerCase() === x.correct_answer, points: 1 }));
const plant = (id, uid, name, answers, at) => d2.prepare(`INSERT INTO training_test_attempts (id, test_id, course_id, employee_name, employee_user_id, answers, score, passed, results, taken_at)
  VALUES (?,?,?,?,?,?,?,?,?,?)`).run(id, algTest.id, ALG.id, name, uid, JSON.stringify(answers), 33, 0, JSON.stringify(oldResults(answers)), at);
const wrongAll = Object.fromEntries(algQs.map((x) => [x.id, x.options.find((o, i) => i !== keyIndex(x))]));
const tf = algQs.findIndex((x) => x.type === 'true_false');
wrongAll[algQs[tf].id] = words[algQs[tf].id];
// Daniela: the training task raised 1 Oct, her test on 2 Oct, a retake on 3 Oct (the fault sent her back).
d2.prepare(`INSERT INTO work_orders (id, title, status, priority, due_date, task_group, assigned_to, assigned_to_id, training_course_id, created_at)
  VALUES ('tg-wo-dani', ?, 'open', 'normal', '2026-10-10', 'warehouse', 'Daniela Planted', 'tg-dani', ?, '2026-10-01 15:00:00')`).run(`Training: ${ALG.title}`, ALG.id);
plant('tg-a1', 'tg-dani', 'Daniela Planted', words, '2026-10-02 16:30:00');
plant('tg-a2', 'tg-dani', 'Daniela Planted', words, '2026-10-03 16:30:00');
plant('tg-a3', 'tg-fail', 'Felix Wrongly', wrongAll, '2026-10-02 17:00:00');
plant('tg-a4', 'tg-had', 'Hana Alreadydone', words, '2026-10-02 18:00:00');
d2.prepare(`INSERT INTO training_records (id, employee_name, employee_user_id, training_topic, course_id, method, training_date, completion_date, status, passed, superseded)
  VALUES ('tg-rec-had', 'Hana Alreadydone', 'tg-had', ?, ?, 'classroom', '2026-10-04', '2026-10-04', 'completed', 1, 0)`).run(ALG.title, ALG.id);
const recordsBefore = d2.prepare('SELECT COUNT(*) n FROM training_records').get().n;
d2.close();

async function reboot(port) {
  const proc = spawn(process.execPath, ['server.js'], { env: { ...process.env, PORT: String(port), DB_PATH: DBP }, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  proc.stdout.on('data', (d) => { log += d; });
  proc.stderr.on('data', (d) => { log += d; });
  let ready = false;
  for (let i = 0; i < 90; i++) {
    await wait(1000);
    try { await fetch(`http://localhost:${port}/api/users/lookup?q=zz`); ready = true; break; } catch { /* booting */ }
  }
  return { proc, ready, log: () => log };
}
const one = await reboot(BOOT2);
t('the application booted again on the same database', one.ready);
t('the boot log names what it re-graded', /\[training-regrade\] 3 attempt\(s\) re-graded, 3 now passed, 1 completion\(s\) filed, 1 task\(s\) closed/.test(one.log()),
  one.log().split('\n').filter((l) => /training-regrade/.test(l)).join(' | ') || 'no line');
one.proc.kill('SIGKILL');
const at = (id) => q('SELECT * FROM training_test_attempts WHERE id = ?', id)[0];
t('Daniela\'s attempt re-grades from her own answers to 100% and passed', at('tg-a1').score === 100 && at('tg-a1').passed === 1);
t('…its frozen results now say every question was right', JSON.parse(at('tg-a1').results).every((x) => x.correct));
t('…her retake re-grades too', at('tg-a2').passed === 1);
t('a test that really was failed STAYS failed — only the fault is corrected', at('tg-a3').score === 33 && at('tg-a3').passed === 0);
const recs = q("SELECT * FROM training_records WHERE employee_user_id = 'tg-dani' AND course_id = ?", ALG.id);
t('ONE completion is filed for Daniela, not one per retake', recs.length === 1, String(recs.length));
t('…dated the day she passed, not today', recs[0]?.completion_date === '2026-10-02' && recs[0]?.training_date === '2026-10-02', recs[0]?.completion_date);
t('…linked to her first passing attempt, and saying it came from a re-grade', recs[0]?.test_attempt_id === 'tg-a1' && at('tg-a1').record_id === recs[0]?.id && /re-graded/.test(recs[0]?.notes || '') && /D-157/.test(recs[0]?.notes || ''));
const dw = q("SELECT * FROM work_orders WHERE id = 'tg-wo-dani'")[0];
t('the training task she answered closes as of the moment she passed', dw.status === 'completed' && dw.completed_at === '2026-10-02 16:30:00' && /re-grade/.test(dw.notes || ''), JSON.stringify({ s: dw.status, at: dw.completed_at }));
t('a person who already has a later completion gets no second one', q("SELECT COUNT(*) n FROM training_records WHERE employee_user_id = 'tg-had'")[0].n === 1
  && q("SELECT superseded FROM training_records WHERE id = 'tg-rec-had'")[0].superseded === 0);
t('nothing else was filed', q('SELECT COUNT(*) n FROM training_records')[0].n === recordsBefore + 1);
t('each re-grade is audited with the score it had and the one it has', q("SELECT COUNT(*) n FROM audit_log WHERE action = 'regrade' AND details LIKE '%score_was%'")[0].n === 3);

const two = await reboot(BOOT2);
t('a second boot changes nothing', two.ready && !/attempt\(s\) re-graded/.test(two.log()) && q('SELECT COUNT(*) n FROM training_records')[0].n === recordsBefore + 1,
  two.log().split('\n').filter((l) => /training-regrade/.test(l)).join(' | '));
two.proc.kill('SIGKILL');

console.log(`\n${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
