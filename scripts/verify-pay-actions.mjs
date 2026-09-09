// The office's pay-review list: three kinds of item, each staying until the
// act that clears it has happened; the ReadyBot reminder and the bell read the
// same list. Live server + a real browser. Caller sets PORT + DBPATH; needs a
// built client.
import { chromium } from 'playwright-core';
const PORT = process.env.PORT || 4978; const URL = `http://localhost:${PORT}`;
let pass = 0, fail = 0;
const t = (n, c, d = '') => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (d ? ' — ' + d : '')); } };
const { default: Database } = await import('better-sqlite3');
const dbPath = process.env.DBPATH;
{ const db = new Database(dbPath);
  const mk = (id, name, role, dept) => db.prepare(`INSERT OR REPLACE INTO users (id,name,username,role,department,is_active,setup_code,setup_code_expires_at,module_access)
    VALUES (?,?,?,?,?,1,?,datetime('now','+7 day'),?)`).run(id, name, name, role, dept, 'SC-' + id, JSON.stringify({ 'pay-tracking': 'edit' }));
  mk('pa-admin', 'Lowry Test', 'admin', 'executive');
  mk('pa-marnee', 'Marnee Test', 'supervisor', 'admin');
  mk('pa-sup', 'Reina Test', 'supervisor', 'production');
  db.close(); }
const H = { 'Content-Type': 'application/json' };
const call = (m, p, b, tok) => fetch(`${URL}/api${p}`, { method: m, headers: { ...H, ...(tok ? { Authorization: `Bearer ${tok}` } : {}) }, body: b ? JSON.stringify(b) : undefined });
const login = async (id, name) => {
  await call('POST', '/users/login', { name });
  await call('POST', '/users/set-password', { user_id: id, password: 'Passw0rd!!', setup_code: 'SC-' + id });
  return (await (await call('POST', '/users/login', { name, password: 'Passw0rd!!' })).json());
};
const admin = await login('pa-admin', 'Lowry Test');
const sup = await login('pa-sup', 'Reina Test');
t('admin and a supervisor signed in', !!admin?.token && !!sup?.token);
const A = admin.token, S = sup.token;

console.log('\n── an empty list ──');
let acts = await (await call('GET', '/pay/actions', null, A)).json();
// A fresh database seeds a roster whose review clocks have already run out, so
// the honest opening state is "N to assign, nothing to decide or chase" — and
// every count below is relative to that baseline.
const base = acts.counts?.assign || 0;
t('a fresh roster has nothing to decide or chase, only the seeded people to assign', acts.counts?.decide === 0 && acts.counts?.chase === 0 && acts.counts?.total === base, JSON.stringify(acts.counts));
t('reminders default to admins plus the office/HR/admin departments', acts.recipients_source === 'default' && acts.recipients.some(r => r.name === 'Lowry Test') && acts.recipients.some(r => r.name === 'Marnee Test'));
t('a supervisor is refused the list', (await call('GET', '/pay/actions', null, S)).status === 403);

console.log('\n── three people, three kinds of item ──');
const old = new Date(Date.now() - 400 * 86400000).toISOString().slice(0, 10);
const mk = async (name, team) => (await (await call('POST', '/pay/employees', { name, team, pay_rate: 18, hire_date: old }, A)).json());
const eDecide = await mk('Ana Decide', 'Filling');
const eChase = await mk('Ben Chase', 'Filling');
const eAssign = await mk('Cara Assign', 'Kitting');
t('three employees on the roster, all past the review clock', [eDecide, eChase, eAssign].every(e => e?.id && e.review?.status === 'due'));
// decide: a supervisor submits an evaluation for Ana
let r = await call('POST', `/pay/employees/${eDecide.id}/reviews`, { scores: { a: 3, b: 2, c: 3 }, notes: 'Solid year' }, S);
t('a review is submitted for Ana', r.status === 201, String(r.status));
// chase: Ben is assigned to the supervisor with a date already past
r = await call('POST', '/pay/assignments', { employee_id: eChase.id, reviewer_id: 'pa-sup', due_date: old }, A);
t('Ben is assigned to the supervisor with a past date', r.status === 201, String(r.status));
acts = await (await call('GET', '/pay/actions', null, A)).json();
t('the list grew by exactly three items', acts.counts.total === base + 3 && acts.counts.decide === 1 && acts.counts.chase === 1, JSON.stringify(acts.counts));
const kinds = Object.fromEntries(acts.items.map(i => [i.employee_name, i.kind]));
t('Ana is a decision, Ben is a chase, Cara is an assignment', kinds['Ana Decide'] === 'decide' && kinds['Ben Chase'] === 'chase' && kinds['Cara Assign'] === 'assign', JSON.stringify(kinds));
t('decisions sort first', acts.items[0].kind === 'decide');
t('the decision item says who reviewed and how long it has waited', /Reina Test/.test(acts.items[0].reviewers) && acts.items[0].waiting_days === 0 && acts.items[0].reviews === 1);
const chase = acts.items.find(i => i.kind === 'chase');
t('the chase item names the reviewer and the date', chase.reviewer_name === 'Reina Test' && chase.due_date === old && chase.overdue_days === 400);
t('an employee with an open review is not ALSO listed as unassigned', acts.items.filter(i => i.employee_name === 'Ana Decide').length === 1);

console.log('\n── the bell and the reminder read the same list ──');
const notif = await (await call('GET', '/compliance/notifications', null, A)).json();
const badge = (notif.items || []).find(i => i.id === 'pay-actions');
t('the admin bell carries the same count', badge?.count === base + 3 && new RegExp(`1 to decide · 1 to chase · ${base + 1} to assign`).test(badge.label), JSON.stringify(badge));
const supNotif = await (await call('GET', '/compliance/notifications', null, S)).json();
t('a supervisor bell does not carry the office item', !(supNotif.items || []).some(i => i.id === 'pay-actions'));
{
  const { payReviewNudges } = await import('../server/api/pay.js');
  const db = new Database(dbPath);
  const before = db.prepare('SELECT COUNT(*) c FROM chat_messages').get().c;
  const sent = await payReviewNudges(db);
  t('the reminder went to the office recipients (Lowry and Marnee) and the reviewer', sent.office >= 2 && sent.reviewers === 1, JSON.stringify(sent));
  const msgs = db.prepare('SELECT body FROM chat_messages ORDER BY rowid DESC LIMIT 10').all().map(m => m.body || '');
  const office = msgs.find(b => new RegExp(`${base + 3} things waiting on you`).test(b));
  t('the office message names all three items, including the submitted evaluation awaiting a decision', !!office && /awaiting your decision/.test(office) && /Ana Decide/.test(office) && /Ben Chase/.test(office) && /Cara Assign/.test(office), (office || msgs[0] || '').slice(0, 200));
  t('and says they stay on the list until acted on', /stay on the list until you act/.test(office || ''));
  t('messages were actually written', db.prepare('SELECT COUNT(*) c FROM chat_messages').get().c > before);
  db.close();
}

console.log('\n── acting clears each item; nothing else does ──');
acts = await (await call('GET', '/pay/actions', null, A)).json();
t('reading the list does not clear it', acts.counts.total === base + 3);
r = await call('POST', `/pay/employees/${eDecide.id}/rate`, { new_rate: 19 }, A);
acts = await (await call('GET', '/pay/actions', null, A)).json();
t('applying a rate clears the decision', r.status === 200 && !acts.items.some(i => i.employee_name === 'Ana Decide'), JSON.stringify(acts.counts));
r = await call('POST', `/pay/employees/${eChase.id}/reviews`, { scores: { a: 2, b: 2, c: 2 } }, S);
acts = await (await call('GET', '/pay/actions', null, A)).json();
t('the reviewer delivering turns the chase into a decision', r.status === 201 && acts.items.find(i => i.employee_name === 'Ben Chase')?.kind === 'decide');
r = await call('POST', `/pay/employees/${eChase.id}/reviews/resolve`, { resolution: 'Held flat this year, talked it through' }, A);
acts = await (await call('GET', '/pay/actions', null, A)).json();
t('holding flat with a reason clears that decision', r.status === 200 && !acts.items.some(i => i.employee_name === 'Ben Chase'));
r = await call('POST', '/pay/assignments', { employee_id: eAssign.id, reviewer_id: 'pa-sup', due_date: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10) }, A);
acts = await (await call('GET', '/pay/actions', null, A)).json();
t('assigning a reviewer (with a future date) clears the unassigned item, back to the baseline', r.status === 201 && acts.counts.total === base && acts.counts.decide === 0 && acts.counts.chase === 0, JSON.stringify(acts.counts));

console.log('\n── who gets reminded is the plant\'s choice ──');
r = await call('PUT', '/pay/action-recipients', { user_ids: ['pa-marnee'] }, A);
let rec = await r.json();
t('the recipients can be set to just Marnee', r.status === 200 && rec.recipients_source === 'setting' && rec.recipients.length === 1 && rec.recipients[0].name === 'Marnee Test');
r = await call('PUT', '/pay/action-recipients', { user_ids: [] }, A);
rec = await r.json();
t('clearing the choice returns to the default set', rec.recipients_source === 'default' && rec.recipients.length >= 2);

console.log('\n── in the browser ──');
// Put two items back so the strip has something to show.
await call('DELETE', `/pay/assignments/${(await (await call('GET', '/pay/assignments?status=open', null, A)).json()).find(a => a.employee_name === 'Cara Assign')?.id}`, null, A);
await call('POST', `/pay/employees/${eDecide.id}/reviews`, { scores: { a: 3, b: 3, c: 3 } }, S);
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
page.on('pageerror', e => { console.log('  [pageerror]', e.message); fail++; });
await page.goto(`${URL}/manifest.webmanifest`);
await page.evaluate(([tk, u]) => { localStorage.setItem('auth_token', tk); localStorage.setItem('auth_user', JSON.stringify(u)); }, [A, admin.user]);
await page.goto(`${URL}/?tab=pay-tracking`);
await page.waitForTimeout(3500);
const strip = page.locator('[data-pay-actions]');
t('the strip is on the Pay Tracking screen with the two items added to the baseline', await strip.count() === 1 && await strip.getAttribute('data-pay-actions') === String(base + 2));
t('it says how many things are waiting and that they stay until acted on', new RegExp(`${base + 2} things waiting on you`).test(await strip.innerText()) && /stays here until you act/.test(await strip.innerText()));
t('the decision is listed first and names the employee', (await strip.locator('[data-action]').first().getAttribute('data-action')) === 'decide' && /Ana Decide/.test(await strip.locator('[data-action]').first().innerText()));
await strip.locator('[data-action="assign"]', { hasText: 'Cara Assign' }).locator('button').click();
await page.waitForTimeout(800);
t('"Assign a reviewer" opens the Assignments tab with Cara already picked', (await page.locator('[data-assign-preset]').getAttribute('data-assign-preset')) === eAssign.id
  && (await page.locator('[data-assign-preset] select').first().inputValue()) === eAssign.id);
await strip.locator('[data-action="decide"] button').click();
await page.waitForTimeout(1500);
t('"Open and decide" opens the person with their review on screen', /Ana Decide/.test(await page.locator('body').innerText()) && /Reina Test/.test(await page.locator('body').innerText()));
await browser.close();

console.log(`\n${pass}/${pass + fail} assertions passed`);
process.exit(fail ? 1 : 0);
