// verify:ptoplan — who is due for the 4-hour PTO plan (D-320).
// Policy: the 4-hour plan applies once somebody is a supervisor or has been here
// two years. ADP is where it is changed; Pay Tracking says who is due and keeps
// saying it until the roster's PTO plan reads "4 hr". Live server + browser.
// Caller sets PORT + DBPATH; needs a built client.
// Control: main before D-320 — no `pto` on the roster, no PTO line on the list.
import { chromium } from 'playwright-core';
const PORT = process.env.PORT || 5204; const URL = `http://localhost:${PORT}`;
let pass = 0, fail = 0;
const t = (n, c, d = '') => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (d ? ' — ' + d : '')); } };
const { default: Database } = await import('better-sqlite3');
const dbPath = process.env.DBPATH;
{ const db = new Database(dbPath);
  db.prepare(`INSERT OR REPLACE INTO users (id,name,username,role,department,is_active,setup_code,setup_code_expires_at,module_access)
    VALUES ('pt-admin','Lowry Pto','Lowry Pto','admin','executive',1,'SC-pt',datetime('now','+7 day'),?)`).run(JSON.stringify({ 'pay-tracking': 'edit' }));
  db.close(); }
const H = { 'Content-Type': 'application/json' };
const call = (m, p, b, tok) => fetch(`${URL}/api${p}`, { method: m, headers: { ...H, ...(tok ? { Authorization: `Bearer ${tok}` } : {}) }, body: b ? JSON.stringify(b) : undefined });
await call('POST', '/users/login', { name: 'Lowry Pto' });
await call('POST', '/users/set-password', { user_id: 'pt-admin', password: 'Passw0rd!!', setup_code: 'SC-pt' });
const admin = await (await call('POST', '/users/login', { name: 'Lowry Pto', password: 'Passw0rd!!' })).json();
const A = admin.token;
t('signed in', !!A);

const day = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
const yearsAgo = (y, extraDays = 0) => { const d = new Date(); d.setUTCFullYear(d.getUTCFullYear() - y); d.setUTCDate(d.getUTCDate() + extraDays); return d.toISOString().slice(0, 10); };
const mk = async (body) => (await (await call('POST', '/pay/employees', { pay_rate: 18, team: 'Filling', ...body }, A)).json());
const twoYears = await mk({ name: 'Tess Twoyears', hire_date: yearsAgo(2, -30), pto_plan: '3 hr' });
const sup = await mk({ name: 'Sam Supervisor', hire_date: day(-100), pto_plan: '3 hr', is_supervisor: true });
const soon = await mk({ name: 'Nora Soon', hire_date: yearsAgo(2, 10), pto_plan: '3 hr' });
const newbie = await mk({ name: 'Ned New', hire_date: day(-200), pto_plan: '3 hr' });
const onPlan = await mk({ name: 'Olga Onplan', hire_date: yearsAgo(3), pto_plan: '4 hr' });
const contractor = await mk({ name: 'Cal Contract', hire_date: yearsAgo(3), pto_plan: '1099' });
t('six people filed', [twoYears, sup, soon, newbie, onPlan, contractor].every(e => e?.id));

console.log('\n── who is due ──');
const roster = await (await call('GET', '/pay/employees', null, A)).json();
const st = (e) => roster.find(r => r.id === e.id)?.pto;
t('two years here on the 3 hr plan → due', st(twoYears)?.status === 'due' && st(twoYears).reasons.includes('two_years'), JSON.stringify(st(twoYears)));
t('a supervisor under two years → due', st(sup)?.status === 'due' && st(sup).reasons.includes('supervisor'), JSON.stringify(st(sup)));
t('two years in ten days → soon (a fortnight\'s warning)', st(soon)?.status === 'soon', JSON.stringify(st(soon)));
t('200 days, not a supervisor → not yet', st(newbie)?.status === 'not_yet');
t('already on "4 hr" → nothing owed', st(onPlan)?.status === 'on_plan');
t('a 1099 contractor has no PTO plan', st(contractor) === null);

let acts = await (await call('GET', '/pay/actions', null, A)).json();
const ptoIds = (acts.items || []).filter(i => i.kind === 'pto').map(i => i.employee_id);
t('the office list carries the due and the soon, and no one else', [twoYears.id, sup.id, soon.id].every(id => ptoIds.includes(id))
  && ![newbie.id, onPlan.id, contractor.id].some(id => ptoIds.includes(id)));
t('counts.pto matches the PTO lines', acts.counts?.pto === ptoIds.length, JSON.stringify(acts.counts));
const bell = (await (await call('GET', '/compliance/notifications', null, A)).json());
const badge = (bell.items || bell || []).find?.(b => b.id === 'pay-actions');
t('the admin bell names the PTO plans to change', new RegExp(`${acts.counts.pto} PTO plan`).test(badge?.label || ''), badge?.label);

console.log('\n── it stays until the plan says "4 hr" ──');
let r = await call('PUT', `/pay/employees/${twoYears.id}`, { notes: 'looked at it' }, A);
acts = await (await call('GET', '/pay/actions', null, A)).json();
t('editing anything else leaves the line', acts.items.some(i => i.kind === 'pto' && i.employee_id === twoYears.id));
r = await call('PUT', `/pay/employees/${twoYears.id}`, { pto_plan: '4 hr' }, A);
acts = await (await call('GET', '/pay/actions', null, A)).json();
t('recording "4 hr" clears it', r.status === 200 && !acts.items.some(i => i.kind === 'pto' && i.employee_id === twoYears.id));

console.log('\n── the screen ──');
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('pageerror', e => { console.log('  [pageerror]', e.message); fail++; });
await page.goto(`${URL}/manifest.webmanifest`);
await page.evaluate(([tk, u]) => { localStorage.setItem('auth_token', tk); localStorage.setItem('auth_user', JSON.stringify(u)); }, [A, admin.user]);
await page.goto(`${URL}/?tab=pay-tracking`);
await page.waitForSelector('[data-pay-actions]', { timeout: 20000 }).catch(() => {});
const lines = page.locator('[data-action="pto"]');
t('the list on Pay Tracking shows PTO plan lines', await lines.count() === acts.counts.pto, `${await lines.count()} vs ${acts.counts.pto}`);
t('…naming why and what to do', /Sam Supervisor/.test(await page.locator('[data-pay-actions]').innerText()) && /change it in ADP/.test(await page.locator('[data-pay-actions]').innerText()));
await page.waitForSelector('[data-pto-due]', { timeout: 10000 }).catch(() => {});
t('the roster\'s PTO column marks who is due', await page.locator('[data-pto-due="due"]').count() >= 1 && await page.locator('[data-pto-due="soon"]').count() >= 1);
await page.locator('[data-action="pto"]', { hasText: 'Sam Supervisor' }).getByRole('button').click();
await page.waitForSelector('[data-pto-drawer]', { timeout: 10000 }).catch(() => {});
t('"Open and set the plan" opens the person, saying what to do', await page.locator('[data-pto-drawer="due"]').count() === 1);
await browser.close();

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
