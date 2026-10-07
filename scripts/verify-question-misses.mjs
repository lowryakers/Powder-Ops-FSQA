// verify:questionmisses — D-159, live on a fresh database and a real browser.
//
// "Add a most-missed questions view per course, so a wrong answer key stands
// out on its own." One row per question, counted ONCE PER PERSON (their latest
// attempt), graded by the one grader, and flagging — never changing — a key
// that looks wrong: most people miss it AND most of them chose the same other
// answer. A hard question, where wrong answers scatter, is not flagged.
//
// Caller sets PORT + DBPATH (server already up). Needs a built client.
// The control is `main` before the change: there is no such view.
import Database from 'better-sqlite3';
import { chromium } from 'playwright-core';

const PORT = Number(process.env.PORT || 5078);
const URL = `http://localhost:${PORT}`;
const B = `${URL}/api`;
const DBP = process.env.DBPATH;
let pass = 0, fail = 0;
const t = (n, ok, d = '') => { if (ok) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n}${d ? ' — ' + d : ''}`); } };
const J = async (r) => { try { return await r.json(); } catch { return null; } };

const db = new Database(DBP);
db.prepare(`INSERT OR REPLACE INTO users (id,name,username,role,department,is_active,setup_code,setup_code_expires_at,module_access)
  VALUES ('qm-rev','Quinn Reviewer','Quinn Reviewer','supervisor','qa',1,'SC-qm',datetime('now','+7 day'),?)`).run(JSON.stringify({ training: 'edit' }));
const ALG = db.prepare("SELECT id FROM training_courses WHERE code = 'ALG-101'").get();
const algQs = db.prepare(`SELECT q.* FROM training_questions q JOIN training_tests t ON t.id = q.test_id
  WHERE t.course_id = ? AND t.is_current = 1 ORDER BY q.position`).all(ALG.id).map((x) => ({ ...x, options: JSON.parse(x.options) }));
db.close();

const c = (m, p, b, tk) => fetch(B + p, { method: m, headers: { 'Content-Type': 'application/json', ...(tk ? { Authorization: `Bearer ${tk}` } : {}) }, body: b ? JSON.stringify(b) : undefined });
await c('POST', '/users/login', { name: 'Quinn Reviewer' });
await c('POST', '/users/set-password', { user_id: 'qm-rev', password: 'Passw0rd!!', setup_code: 'SC-qm' });
const rev = await J(await c('POST', '/users/login', { name: 'Quinn Reviewer', password: 'Passw0rd!!' }));
t('the reviewer signs in', !!rev?.token);
const R = (m, p, b) => c(m, p, b, rev.token);

// A course whose Q1 key is WRONG (it says "Wristwatch"), Q2 is genuinely hard, Q3 everybody knows.
const course = await J(await R('POST', '/training/courses', { code: 'QM-101', title: 'Hairnets and Jewellery', has_test: true, passing_score: 80 }));
await R('PUT', `/training/courses/${course.id}/test`, { passing_score: 80, questions: [
  { type: 'multiple_choice', prompt: 'What must be worn over the hair?', options: ['Hairnet', 'Wristwatch', 'Gum'], correct_answer: '1' },
  { type: 'multiple_choice', prompt: 'How often is a hairnet replaced?', options: ['Every break', 'Weekly', 'Monthly', 'Never'], correct_answer: '0' },
  { type: 'true_false', prompt: 'Rings may be worn on the line.', options: ['True', 'False'], correct_answer: 'false' },
] });
const take = (name, answers, cid = course.id) => R('POST', `/training/courses/${cid}/test/attempt`, { employee_name: name, answers });
const test = await J(await R('GET', `/training/courses/${course.id}/test`));
const [q1, q2, q3] = test.questions;
// Five people. Everybody answers Q1 "Hairnet" (the RIGHT answer, against a wrong key).
// Q2 wrong answers scatter (Weekly / Monthly / Never) for three of them.
const plan = [
  ['Ana One', 'Every break'], ['Ben Two', 'Weekly'], ['Cy Three', 'Monthly'], ['Di Four', 'Never'], ['Ed Five', 'Every break'],
];
// Ana tries three times first; those EARLIER attempts miss Q2 and Q3 — her latest is the one that counts.
await take('Ana One', { [q1.id]: 'Gum', [q2.id]: 'Never', [q3.id]: 'True' });
await take('Ana One', { [q1.id]: 'Gum', [q2.id]: 'Weekly', [q3.id]: 'True' });
await take('Ana One', { [q1.id]: 'Gum', [q2.id]: 'Monthly', [q3.id]: 'True' });
for (const [name, a2] of plan) await take(name, { [q1.id]: 'Hairnet', [q2.id]: a2, [q3.id]: 'False' });

// The seeded ALG-101, keyed by POSITION, answered right in WORDS by three people.
const algRight = Object.fromEntries(algQs.map((x) => [x.id, x.type === 'true_false'
  ? x.options.find((o) => o.toLowerCase() === x.correct_answer) : x.options[Number(x.correct_answer)]]));
for (const n of ['Fay Six', 'Gus Seven', 'Hal Eight']) await take(n, algRight, ALG.id);

console.log('\n── the view, from the server ──');
const res = await R('GET', '/training/question-misses');
const data = await J(res);
t('GET /training/question-misses answers', res.status === 200 && Array.isArray(data?.courses), `${res.status}`);
const qm = data?.courses?.find((x) => x.course_code === 'QM-101');
t('the course is there, with its people counted once each', qm?.people === 5 && qm?.attempts === 8, JSON.stringify({ people: qm?.people, attempts: qm?.attempts }));
const byNum = Object.fromEntries((qm?.questions || []).map((x) => [x.number, x]));
t('Q1 (the wrong key) is missed by all 5 people', byNum[1]?.missed === 5 && byNum[1]?.miss_rate === 100, JSON.stringify(byNum[1]));
t('…and the answer they all chose is named', byNum[1]?.top_wrong?.answer === 'Hairnet' && byNum[1]?.top_wrong?.people === 5);
t('…and it is FLAGGED to check the key', byNum[1]?.key_check === true);
t('…and the key is shown as the option\'s words, not "1"', byNum[1]?.expected === 'Wristwatch', String(byNum[1]?.expected));
t('Q2 (hard, wrong answers scattered) — 3 of 5 missed it — is NOT flagged', byNum[2]?.missed === 3 && byNum[2]?.key_check === false, JSON.stringify(byNum[2]));
t('Ana\'s earlier wrong attempts do not count — her latest, right, answer does', !byNum[2]?.missed_by?.includes('Ana One') && !byNum[3]?.missed_by?.includes('Ana One'));
t('Q3, which everybody knew, is missed by nobody', byNum[3]?.missed === 0);
t('the worst question is listed first', qm?.questions?.[0]?.number === 1);
t('the course reports one key to check, and the total says so', qm?.key_checks === 1 && data?.key_checks >= 1);
const alg = data?.courses?.find((x) => x.course_code === 'ALG-101');
t('ALG-101 answered right in words (keyed by position) shows NOTHING missed — one grader', alg && alg.questions.every((x) => x.missed === 0) && alg.key_checks === 0,
  JSON.stringify(alg?.questions?.map((x) => x.missed)));
t('QM-101, with a key to check, sorts above ALG-101', data.courses.findIndex((x) => x.course_code === 'QM-101') < data.courses.findIndex((x) => x.course_code === 'ALG-101'));
const one = await J(await R('GET', `/training/question-misses?course_id=${course.id}`));
t('?course_id= narrows to one course', one?.courses?.length === 1 && one.courses[0].course_code === 'QM-101');

console.log('\n── nothing is changed by looking ──');
const d2 = new Database(DBP, { readonly: true });
t('the key is untouched — the view flags, never rewrites', d2.prepare('SELECT correct_answer FROM training_questions WHERE id = ?').get(q1.id).correct_answer === '1');
d2.close();

console.log('\n── an edited test: the old version is kept apart ──');
await R('PUT', `/training/courses/${course.id}/test`, { passing_score: 80, questions: [
  { type: 'multiple_choice', prompt: 'What must be worn over the hair?', options: ['Hairnet', 'Wristwatch', 'Gum'], correct_answer: '0' },
] });
const cur = await J(await R('GET', '/training/question-misses'));
t('after the key is fixed (a new version), the current view no longer lists the old answers', !cur.courses.some((x) => x.course_code === 'QM-101'));
const withOld = await J(await R('GET', '/training/question-misses?include_old=1'));
const oldV = withOld.courses.find((x) => x.course_code === 'QM-101');
t('…and "include earlier versions" still shows them, marked as V1', oldV && oldV.is_current === false && oldV.version === 1);

console.log('\n── on the screen ──');
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
try {
  for (const width of [1280, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    await page.goto(`${URL}/manifest.webmanifest`);
    await page.evaluate(([tk, u]) => { localStorage.setItem('auth_token', tk); localStorage.setItem('auth_user', JSON.stringify(u)); }, [rev.token, rev.user]);
    await page.goto(`${URL}/?tab=training&view=misses`);
    await page.locator('[data-question-misses]').waitFor({ timeout: 15000 });
    await page.locator('[data-misses-old]').check();
    const card = page.locator('[data-misses-course="QM-101"]');
    await card.waitFor({ timeout: 10000 });
    const flagged = card.locator('[data-miss-q="1"]');
    t(`(${width}) the wrong-key question is drawn flagged`, await flagged.getAttribute('data-key-check') === '1');
    t(`(${width}) it reads "5 of 5 missed it" and names "Hairnet"`, /5 of 5 missed it/.test(await flagged.locator('[data-miss-count]').innerText())
      && (await flagged.locator('[data-miss-top]').innerText()) === 'Hairnet');
    t(`(${width}) the course header says to check the key`, /Check the key on 1 question/.test(await card.innerText()));
    t(`(${width}) the question nobody missed is summarised, not listed`, /1 question nobody missed/.test(await card.innerText()));
    await flagged.locator('[data-miss-more]').click();
    t(`(${width}) "Show who and what" names the people`, /Ben Two/.test(await flagged.locator('[data-miss-detail]').innerText()));
    const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    t(`(${width}) no sideways scroll`, over <= 1, `${over}px`);
    await page.close();
  }
} catch (e) { t('the screens rendered', false, e.message); }
finally { await browser.close(); }

console.log(`\n${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
