// verify:trainingtest — D-144, live on a fresh database and a real browser.
//
// Daniela (28 Sep) on the employee's test:
//  - the translation is not reachable from the test;
//  - the employee is asked to type a percentage under the test — remove it,
//    the score is computed and shown at the end;
//  - the reviewer cannot see which questions were right or wrong;
//  - assigning to Jose Luna "bounces" saying he has no Operator View.
//
// Caller sets PORT + DBPATH + DB_PATH (server already up). Needs a built client.
// The control is `main`: the score box is offered to the trainee and accepted,
// and there is no per-question review to ask for.
import Database from 'better-sqlite3';
import { chromium } from 'playwright-core';

const PORT = Number(process.env.PORT || 5058);
const URL = `http://localhost:${PORT}`;
const B = `${URL}/api`;
const DBP = process.env.DBPATH;
let pass = 0, fail = 0;
const t = (n, ok, d = '') => { if (ok) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n}${d ? ' — ' + d : ''}`); } };
const J = async (r) => { try { return await r.json(); } catch { return null; } };

const db = new Database(DBP);
const mk = (id, name, role, dept, modules) => db.prepare(`INSERT OR REPLACE INTO users (id,name,username,role,department,is_active,setup_code,setup_code_expires_at,module_access)
  VALUES (?,?,?,?,?,1,?,datetime('now','+7 day'),?)`).run(id, name, name, role, dept, `SC-${id}`, modules ? JSON.stringify(modules) : null);
mk('tt-dan', 'Daniela Tester', 'supervisor', 'document_control', { training: 'edit', 'org-chart': 'edit' });
mk('tt-jose', 'Jose Testluna', 'operator', 'warehouse', null);          // NULL map: D-124 gives Operator View
mk('tt-ana', 'Ana Testpaper', 'operator', 'warehouse', null);
db.close();
const c = (m, p, b, tk) => fetch(B + p, { method: m, headers: { 'Content-Type': 'application/json', ...(tk ? { Authorization: `Bearer ${tk}` } : {}) }, body: b ? JSON.stringify(b) : undefined });
const login = async (id, name) => {
  await c('POST', '/users/login', { name });
  await c('POST', '/users/set-password', { user_id: id, password: 'Passw0rd!!', setup_code: `SC-${id}` });
  return J(await c('POST', '/users/login', { name, password: 'Passw0rd!!' }));
};
const dan = await login('tt-dan', 'Daniela Tester');
const jose = await login('tt-jose', 'Jose Testluna');
t('a reviewer and two employees sign in', !!dan?.token && !!jose?.token);
const D = (m, p, b) => c(m, p, b, dan.token);
const JO = (m, p, b) => c(m, p, b, jose.token);

const course = await J(await D('POST', '/training/courses', { code: 'TT-101', title: 'Glove Changing', has_test: true, passing_score: 80 }));
await D('PUT', `/training/courses/${course.id}/test`, { passing_score: 80, questions: [
  { prompt: 'When are gloves changed?', prompt_es: '¿Cuándo se cambian los guantes?', options: ['After a break', 'Never'], options_es: ['Después de un descanso', 'Nunca'], correct_answer: 'After a break' },
  { prompt: 'Where do used gloves go?', options: ['The bin', 'The floor'], correct_answer: 'The bin' },
  { prompt: 'Who checks the glove station?', options: ['QA', 'Nobody'], correct_answer: 'QA' },
] });
t('a course with a three-question test is filed, one question translated by the plant', !!course?.id);

console.log('\n── assigning reaches the person (the Jose Luna bounce) ──');
let r = await J(await D('POST', '/training/assign', { course_id: course.id, people: [{ user_id: 'tt-jose', name: 'Jose Testluna' }] }));
t('an account with nothing assigned in Settings is NOT reported as having no task list (D-124)', r?.created?.length === 1 && !(r.unreachable || []).length,
  JSON.stringify(r?.unreachable));
r = await J(await D('POST', '/training/assign', { course_id: course.id, people: [{ name: 'Ana Testpaper' }] }));
t('a person picked by NAME lands on their account, and is not reported unreachable', r?.created?.[0]?.user_id === 'tt-ana' && !(r.unreachable || []).length,
  JSON.stringify({ created: r?.created, unreachable: r?.unreachable }));
const anaWo = r.created[0].work_order_id;
const tasks = await J(await JO('GET', '/pm/operator-tasks'));
const mine = (tasks || []).find((x) => x.training_course_id === course.id);
t('the course is on Jose\'s Operator View', !!mine, String((tasks || []).length));

console.log('\n── the trainee is never asked for a score ──');
let res = await JO('POST', `/pm/work-orders/${mine.id}/complete-and-recur`, { check: { score: 100 } });
const body = await J(res);
t('a typed score from the trainee themself is REFUSED — the test grades itself', res.status === 403 && body?.self_score_refused === true, `${res.status} ${JSON.stringify(body)}`);
res = await D('POST', `/pm/work-orders/${anaWo}/complete-and-recur`, { check: { score: 90 } });
t('a supervisor recording a PAPER test for somebody else still can', res.status === 200, String(res.status));

console.log('\n── the score is worked out, and the trainee is told what to look at again ──');
const test = await J(await JO('GET', `/pm/work-orders/${mine.id}/training-test`));
const [q1, q2, q3] = test.questions;
const first = await J(await JO('POST', `/pm/work-orders/${mine.id}/training-test`, { answers: { [q1.id]: 'After a break', [q2.id]: 'The bin', [q3.id]: 'Nobody' } }));
t('two of three right is 66% (rounded down, D-158), not passed', first?.score === 66 && first?.passed === false, JSON.stringify(first));
t('the result names question 3 to look at again — by number, never the answer', JSON.stringify(first?.missed) === '[3]' && !JSON.stringify(first).includes('"QA"'));

console.log('\n── the reviewer sees each question ──');
const list = await J(await D('GET', '/training/attempts'));
const a1 = (list || []).find((x) => x.id === first.attempt_id);
t('the failed attempt is listed for the reviewer', !!a1 && a1.passed === false && a1.frozen === true);
const rev = await J(await D('GET', `/training/attempts/${first.attempt_id}`));
t('question by question: right, right, wrong — with what was given and what was expected', rev?.results?.map((x) => x.correct).join() === 'true,true,false'
  && rev.results[2].given === 'Nobody' && rev.results[2].expected === 'QA' && rev.derived === false && rev.right === 2 && rev.wrong === 1, JSON.stringify(rev?.results));
const d0 = new Database(DBP);
d0.prepare(`INSERT INTO training_test_attempts (id, test_id, course_id, employee_name, answers, score, passed)
  SELECT 'tt-old', test_id, course_id, 'Old Attempt', ?, 33, 0 FROM training_test_attempts WHERE id = ?`).run(JSON.stringify({ [q1.id]: 'After a break' }), first.attempt_id);
d0.close();
const old = await J(await D('GET', '/training/attempts/tt-old'));
t('an attempt from before the outcome was kept is re-graded and SAYS so', old?.derived === true && old.results.filter((x) => x.correct).length === 1);
res = await JO('GET', `/training/attempts/${first.attempt_id}`);
t('the trainee cannot read the key through the review (it is the Training module\'s)', res.status === 403, String(res.status));

console.log('\n── in the browser ──');
// A course is due a fortnight out by default and lands under "Later"; the card
// is put on today so the phone shows it open without hunting.
{ const d1 = new Database(DBP); d1.prepare("UPDATE work_orders SET due_date = date('now') WHERE id = ?").run(mine.id); d1.close(); }
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.goto(`${URL}/manifest.webmanifest`);
  await page.evaluate(([tk, u]) => { localStorage.setItem('auth_token', tk); localStorage.setItem('auth_user', JSON.stringify(u)); }, [jose.token, jose.user]);
  await page.goto(`${URL}/?tab=operator`);
  const cardBtn = page.locator('[data-complete-task]').first();
  await cardBtn.waitFor({ timeout: 15000 });
  await page.locator('text=Glove Changing').first().scrollIntoViewIfNeeded();
  // The training card's own Complete button.
  const card = page.locator('div', { has: page.locator('text=Glove Changing') }).filter({ has: page.locator('[data-complete-task]') }).last();
  await card.locator('[data-complete-task]').first().click();
  t('the trainee sees no score box — a sentence saying the score is worked out instead', await page.locator('[data-training-score]:visible').count() === 0
    && await page.locator('[data-training-self]:visible').count() === 1);
  await page.locator('[data-take-test]:visible').first().click();
  await page.locator('[data-training-test]').waitFor();
  t('the test carries its own EN / ES switch', await page.locator('[data-test-lang-btn="es"]').count() === 1);
  await page.locator('[data-test-lang-btn="es"]').click();
  t('in Spanish, the plant\'s own translation is shown', /Cuándo se cambian/.test(await page.locator('[data-test-prompt]').innerText()));
  await page.locator('[data-test-option="0"]').click();
  await page.locator('[data-test-next]').click();
  await page.waitForTimeout(400);
  const note = await page.locator('[data-test-machine]').getAttribute('data-test-machine');
  t('a question the plant did not translate SAYS what it is showing (translation off here: "none")', note === 'none', String(note));
  await page.locator('[data-test-option="0"]').click();
  await page.locator('[data-test-next]').click();
  await page.locator('[data-test-option="0"]').click();
  await page.locator('[data-test-submit]').click();
  await page.locator('[data-test-result]').waitFor();
  const missed = await page.locator('[data-test-missed]').getAttribute('data-test-missed');
  t('the score is shown at the end with nothing to look at again on a clean pass', await page.locator('[data-test-result]').getAttribute('data-test-result') === 'passed' && missed === '',
    String(missed));

  const p2 = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await p2.goto(`${URL}/manifest.webmanifest`);
  await p2.evaluate(([tk, u]) => { localStorage.setItem('auth_token', tk); localStorage.setItem('auth_user', JSON.stringify(u)); }, [dan.token, dan.user]);
  await p2.goto(`${URL}/?tab=training&view=attempts`);
  await p2.locator('[data-training-attempts]').waitFor({ timeout: 15000 });
  await p2.locator(`[data-attempt-row="${first.attempt_id}"]`).click();
  await p2.locator('[data-attempt-review]').waitFor();
  const marks = await p2.locator('[data-attempt-q]').evaluateAll((els) => els.map((e) => e.getAttribute('data-attempt-correct')));
  t('Training → Test answers opens an attempt question by question', marks.join('') === '110', marks.join(''));
  t('the wrong one names what was expected', /Expected:\s*QA/.test(await p2.locator('[data-attempt-q="3"]').innerText()));

  // "All new employees must be addable to the Org Chart": each person not on
  // it is a button that opens Add Position with them already chosen.
  await p2.goto(`${URL}/?tab=org-chart`);
  await p2.locator('[data-place-person="tt-jose"]').waitFor({ timeout: 15000 });
  await p2.locator('[data-place-person="tt-jose"]').click();
  t('Org Chart: a person not on the chart opens Add Position with them filled in', await p2.locator('[data-position-person]').inputValue() === 'tt-jose');
} catch (e) { t('the screens rendered', false, e.message); }
finally { await browser.close(); }

console.log(`\n${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
