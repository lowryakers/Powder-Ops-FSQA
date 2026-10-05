// verify:hourspaylink — D-150, live on a fresh database and a real browser.
//
// Three reports from Lowry (5 Oct), one release:
//  1. Hours → "remove" on a contractor did nothing. The button sent
//     JSON.stringify(...) into apiFetch, which serializes again, so the server
//     read a bare string, found nothing to change and answered 400 — silently.
//  2. Hours said "No pay record" for people who ARE on Pay Tracking. The rate is
//     read through the account link on the pay row; their rows were never linked
//     (or were linked to an account that is gone). The link is now made where
//     the gap is seen, a person choosing from suggestions.
//  3. Pay Tracking's Days column reset the moment an evaluation was SUBMITTED.
//     The clock now resets on the decision — a raise applied or held flat — and
//     the person stays Due until then. A one-time repair undoes earlier resets.
//
// Caller sets PORT + DBPATH (server up). Needs a built client. The control is
// `main`: the contractor stays, no Link button exists, and a submit reads OK.
import Database from 'better-sqlite3';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright-core';

const PORT = Number(process.env.PORT || 5066);
const URL = `http://localhost:${PORT}`;
const B = `${URL}/api`;
let pass = 0, fail = 0;
const t = (n, ok, d = '') => { if (ok) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n}${d ? ' — ' + d : ''}`); } };
const J = async (r) => { try { return await r.json(); } catch { return null; } };
const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
const today = new Date().toISOString().slice(0, 10);

const db = new Database(process.env.DBPATH);
const mkUser = db.prepare(`INSERT OR REPLACE INTO users (id,name,username,role,department,is_active,setup_code,setup_code_expires_at,module_access)
  VALUES (?,?,?,?,?,?,?,datetime('now','+7 day'),?)`);
mkUser.run('hp-admin', 'Hpl Admin', 'Hpl Admin', 'admin', 'office', 1, 'SC-hp', null);
mkUser.run('hp-romina', 'Romina Vega', 'Romina Vega', 'operator', 'filling', 1, null, JSON.stringify({ operator: 'view' }));
mkUser.run('hp-osvaldo', 'Osvaldo Quintero', 'Osvaldo Quintero', 'operator', 'warehouse', 1, null, JSON.stringify({ operator: 'view' }));
mkUser.run('hp-diana', 'Diana Santillan', 'Diana Santillan', 'operator', 'qa', 1, null, JSON.stringify({ operator: 'view' }));
mkUser.run('hp-diana-old', 'Diana Old Account', 'Diana Old Account', 'operator', 'qa', 0, null, null);
const mkPay = db.prepare(`INSERT OR REPLACE INTO pay_employees (id, user_id, name, team, pay_rate, hire_date, last_increase_at, last_reviewed_at, active, worker_type)
  VALUES (?,?,?,?,?,?,?,?,1,?)`);
// Romina's pay row carries her other surname and was never linked.
mkPay.run('hp-pay-romina', null, 'Romina Rosales', 'Hand Fill', 17, daysAgo(600), daysAgo(400), null, 'employee');
// Diana's pay row is linked to an account that has since been deactivated.
mkPay.run('hp-pay-diana', 'hp-diana-old', 'Diana Santillan', 'Quality', 17.5, daysAgo(500), daysAgo(400), null, 'employee');
// Two people due a review, to submit evaluations against.
mkUser.run('hp-eva', 'Eva Reviewed', 'Eva Reviewed', 'operator', 'filling', 1, null, JSON.stringify({ operator: 'view' }));
mkUser.run('hp-flat', 'Flat Heldline', 'Flat Heldline', 'operator', 'filling', 1, null, JSON.stringify({ operator: 'view' }));
mkPay.run('hp-pay-eva', 'hp-eva', 'Eva Reviewed', 'Filling', 16, daysAgo(700), daysAgo(400), null, 'employee');
mkPay.run('hp-pay-flat', 'hp-flat', 'Flat Heldline', 'Filling', 16, daysAgo(700), daysAgo(400), null, 'employee');
// A contractor on the Hours list.
mkPay.run('hp-pay-temp', null, 'Tina Temporary', 'Warehouse', 18, daysAgo(30), null, null, 'contractor');
db.close();

const c = (m, p, b, tk) => fetch(B + p, { method: m, headers: { 'Content-Type': 'application/json', ...(tk ? { Authorization: `Bearer ${tk}` } : {}) }, body: b ? JSON.stringify(b) : undefined });
await c('POST', '/users/set-password', { user_id: 'hp-admin', password: 'Passw0rd!!', setup_code: 'SC-hp' });
const me = await J(await c('POST', '/users/login', { name: 'Hpl Admin', password: 'Passw0rd!!' }));
const A = (m, p, b) => c(m, p, b, me?.token);
t('an admin signs in', !!me?.token);

console.log('\n── the Hours tab offers the pay rows nobody has tied to an account ──');
let h = await J(await A('GET', '/office/hours'));
const person = (id) => h.people.find(p => p.user_id === id);
const unl = (h.pay_rows_unlinked || []).map(r => r.id);
t('Romina, Osvaldo and Diana all read "no pay record" to begin with',
  ['hp-romina', 'hp-osvaldo', 'hp-diana'].every(id => person(id) && !person(id).rate_linked));
t('the unlinked pay row (Romina Rosales) is offered', unl.includes('hp-pay-romina'));
t('a pay row linked to a DEACTIVATED account is offered too, marked as a stale link — Pay Tracking\'s reconcile list skips it',
  (h.pay_rows_unlinked || []).find(r => r.id === 'hp-pay-diana')?.state === 'stale_link');
t('contractors are never offered as somebody\'s pay row', !unl.includes('hp-pay-temp'));
t('Diana\'s row is suggested to her by the same name', person('hp-diana').pay_suggestions?.[0]?.id === 'hp-pay-diana'
  && person('hp-diana').pay_suggestions[0].why === 'same name');
t('Romina\'s row is suggested by first name, never applied', person('hp-romina').pay_suggestions?.[0]?.why === 'same first name'
  && !person('hp-romina').rate_linked);
t('Osvaldo has no suggestion', (person('hp-osvaldo').pay_suggestions || []).length === 0);

console.log('\n── the review clock moves on the DECISION, not the submit ──');
const emp = async (id) => (await J(await A('GET', '/pay/employees'))).find(r => r.id === id);
const scores = { quality: 2, safety: 3, teamwork: 2 };
let eva = await emp('hp-pay-eva');
t('Eva starts Due (400 days since her last raise)', eva.review.status === 'due' && eva.review.days >= 399, JSON.stringify(eva.review));
let r = await A('POST', '/pay/employees/hp-pay-eva/reviews', { scores, notes: 'Solid year' });
t('an evaluation is submitted for her', r.status === 201);
eva = await emp('hp-pay-eva');
t('…and she is STILL Due, the days unchanged — nothing has been decided', eva.review.status === 'due' && eva.review.days >= 399
  && !eva.last_reviewed_at, JSON.stringify({ review: eva.review, last_reviewed_at: eva.last_reviewed_at }));
t('the roster says the decision is waiting', eva.review.awaiting_decision === 1);
const acts = await J(await A('GET', '/pay/actions'));
const evaItems = (acts?.items || acts || []).filter?.(i => i.employee_id === 'hp-pay-eva') || [];
t('the office\'s list asks for a decision, once — not "assign" as well', evaItems.length === 1 && evaItems[0].kind === 'decide',
  JSON.stringify(evaItems.map(i => i.kind)));
r = await A('POST', '/pay/employees/hp-pay-eva/rate', { new_rate: 16.75 });
eva = await emp('hp-pay-eva');
t('applying the raise resets the clock: OK, 0 days, nothing waiting', r.ok && eva.review.status === 'ok' && eva.review.days === 0
  && eva.review.awaiting_decision === 0, JSON.stringify(eva.review));
await A('POST', '/pay/employees/hp-pay-flat/reviews', { scores, notes: 'Hold for now' });
let flat = await emp('hp-pay-flat');
t('a second person stays Due after their evaluation is in', flat.review.status === 'due');
r = await A('POST', '/pay/employees/hp-pay-flat/reviews/resolve', { resolution: 'Held flat — revisit after the busy season' });
flat = await emp('hp-pay-flat');
t('holding flat IS the decision: the clock resets to today', flat.last_reviewed_at === today && flat.review.status === 'ok',
  JSON.stringify({ last: flat.last_reviewed_at, review: flat.review }));

console.log('\n── the earlier resets are put back, once ──');
{
  const d = new Database(process.env.DBPATH);
  // What the old submit left behind: an open review and the stamp it wrote.
  d.prepare(`INSERT OR REPLACE INTO pay_employees (id, user_id, name, team, pay_rate, hire_date, last_increase_at, last_reviewed_at, active, worker_type)
    VALUES ('hp-pay-old','hp-eva','Old Stamped','Filling',15,?,?,?,1,'employee')`).run(daysAgo(800), daysAgo(420), daysAgo(3));
  d.prepare(`INSERT INTO pay_reviews (id, employee_id, reviewer_id, reviewer_name, review_date, scores, total, status)
    VALUES ('hp-rv-old','hp-pay-old','hp-admin','Hpl Admin',?,'{}',6,'open')`).run(daysAgo(3));
  // A stamp a DECISION explains is left: raised after the review date.
  d.prepare(`INSERT OR REPLACE INTO pay_employees (id, user_id, name, team, pay_rate, hire_date, last_increase_at, last_reviewed_at, active, worker_type)
    VALUES ('hp-pay-keep',NULL,'Keep Stamp','Filling',15,?,?,?,1,'employee')`).run(daysAgo(800), daysAgo(2), daysAgo(5));
  d.prepare(`INSERT INTO pay_reviews (id, employee_id, reviewer_id, reviewer_name, review_date, scores, total, status)
    VALUES ('hp-rv-keep','hp-pay-keep','hp-admin','Hpl Admin',?,'{}',6,'open')`).run(daysAgo(5));
  d.prepare("DELETE FROM app_settings WHERE key = 'pay_review_clock_repair_v1'").run();
  d.close();
}
const { repairUndecidedReviewStamps = () => ({ repaired: 0, missing: true }) } = await import('../server/api/pay.js');
const { getDb } = await import('../server/db.js');
const rep = repairUndecidedReviewStamps(getDb());
const after = new Database(process.env.DBPATH);
const oldRow = after.prepare("SELECT last_reviewed_at FROM pay_employees WHERE id = 'hp-pay-old'").get();
const keepRow = after.prepare("SELECT last_reviewed_at FROM pay_employees WHERE id = 'hp-pay-keep'").get();
t('a stamp written by an undecided evaluation is cleared, so the clock runs from the last raise again',
  oldRow.last_reviewed_at === null && rep.people?.some(p => p.name === 'Old Stamped'), JSON.stringify(rep));
t('a stamp a later raise explains is left alone', keepRow.last_reviewed_at === daysAgo(5));
t('the repair is audited per person', !!after.prepare("SELECT 1 FROM audit_log WHERE entity_id = 'hp-pay-old' AND details LIKE '%D-150%'").get());
t('…and runs once', repairUndecidedReviewStamps(getDb()).skipped === true);
after.close();

console.log('\n── no screen double-encodes a request body any more ──');
const offenders = [];
const walk = (dir) => { for (const f of readdirSync(dir)) { const p = join(dir, f); if (statSync(p).isDirectory()) walk(p);
  else if (/\.jsx?$/.test(f)) { const src = readFileSync(p, 'utf8'); if (/apiFetch\([^)]*\{[^}]*body:\s*JSON\.stringify/s.test(src)) offenders.push(p); } } };
walk('src');
t('no apiFetch call passes JSON.stringify(...) as its body', offenders.length === 0, offenders.join(', '));

console.log('\n── in the browser: Time Tracking → Hours ──');
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
try {
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  page.on('dialog', d => d.accept());
  await page.goto(`${URL}/manifest.webmanifest`);
  await page.evaluate(([tk, u]) => { localStorage.setItem('auth_token', tk); localStorage.setItem('auth_user', JSON.stringify(u)); }, [me.token, me.user]);
  await page.goto(`${URL}/?tab=time-tracking`);
  await page.getByRole('tab', { name: 'Hours', exact: true }).first().click();
  await page.locator('[data-end-contractor]:visible').first().waitFor({ timeout: 15000 });
  t('the contractor is on the list with a remove button', await page.locator('tr:has-text("Tina Temporary") [data-end-contractor]').count() === 1);
  await page.locator('tr:has-text("Tina Temporary") [data-end-contractor]').click();
  await page.waitForTimeout(800);
  t('pressing remove takes them off the list', await page.locator('tr:has-text("Tina Temporary")').count() === 0);
  const d2 = new Database(process.env.DBPATH);
  t('…by deactivating the pay row — the row and its history stay', d2.prepare("SELECT active FROM pay_employees WHERE id = 'hp-pay-temp'").get()?.active === 0);
  d2.close();

  await page.locator('[data-link-pay="hp-romina"]:visible').click();
  await page.locator('[data-link-pay-modal]').waitFor();
  t('Link… opens a picker with Romina Rosales on it, marked as a first-name match',
    await page.locator('[data-link-pay-modal] label:has-text("Romina Rosales")').count() === 1
    && await page.locator('[data-link-pay-modal] label:has-text("Romina Rosales") >> text=same first name').count() === 1);
  t('the suggestion is pre-selected and nothing is linked yet',
    await page.locator('[data-link-pay-option="hp-pay-romina"]').isChecked()
    && !(await J(await A('GET', '/office/hours'))).people.find(p => p.user_id === 'hp-romina').rate_linked);
  await page.locator('[data-link-pay-save]').click();
  await page.waitForTimeout(800);
  t('after Link, her rate reads from Pay Tracking', (await page.locator('[data-rate="hp-romina"]').innerText()).includes('$17.00'),
    await page.locator('[data-rate="hp-romina"]').innerText());
  await page.locator('[data-link-pay="hp-osvaldo"]:visible').click();
  await page.locator('[data-link-pay-add]').click();
  await page.waitForTimeout(800);
  h = await J(await A('GET', '/office/hours'));
  t('"Not there — add them" opens a pay row with no rate (salaried until somebody sets one)',
    h.people.find(p => p.user_id === 'hp-osvaldo')?.rate_linked === true && h.people.find(p => p.user_id === 'hp-osvaldo').rate == null);
} catch (e) { t('the Hours tab rendered', false, e.message); }
finally { await browser.close(); }

console.log(`\n${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
