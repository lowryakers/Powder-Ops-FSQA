// Who is on the Time Tracking → Hours list, and who says so.
//
// TWO DIFFERENT ANSWERS TO ONE COMPLAINT. The office reported people on the
// payroll hours list who "don't apply", and counting the real roster showed
// FIVE OF FOURTEEN were M4 guest accounts — a third of the list, and a bug
// rather than a preference: `users.is_external` already says they do not work
// here, so they come off by derivation and nobody ticks anything.
//
// What is left after that is genuine judgement — somebody salaried, somebody
// tracked elsewhere — and that is a decision, so it carries a name, a date and
// a reason, leaves the totals with the row, and can be undone.
//
// Caller sets PORT + DBPATH. Needs a fresh database.
const PORT = process.env.PORT || 5005;
const B = `http://localhost:${PORT}/api`;
const J = async r => { try { return await r.json(); } catch { return null; } };
let pass = 0, fail = 0;
const t = (n, c, d = '') => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (d ? ' — ' + d : '')); } };
let tok = null;
const req = (p, o = {}) => fetch(B + p, { ...o, headers: { 'Content-Type': 'application/json', ...(tok ? { Authorization: `Bearer ${tok}` } : {}), ...(o.headers || {}) } });
const post = (p, b) => req(p, { method: 'POST', body: JSON.stringify(b) });
const get = (p) => req(p);

const { default: Database } = await import('better-sqlite3');
const db = new Database(process.env.DBPATH);

db.prepare(`INSERT OR REPLACE INTO users (id,name,username,role,department,is_active,setup_code,setup_code_expires_at)
  VALUES ('hr-admin','Hours Admin','Hours Admin','admin','office',1,'SC-HR',datetime('now','+7 day'))`).run();
// One of each kind the list has to get right.
db.prepare(`INSERT OR REPLACE INTO users (id,name,username,role,department,is_active,is_external,external_org)
  VALUES ('hr-guest','Guest Client','Guest Client','operator','warehouse',1,1,'M4 Dynamic')`).run();
db.prepare(`INSERT OR REPLACE INTO users (id,name,username,role,department,is_active)
  VALUES ('hr-staff','Payroll Person','Payroll Person','operator','warehouse',1)`).run();

await post('/users/login', { name: 'Hours Admin' });
await post('/users/set-password', { user_id: 'hr-admin', password: 'HoursPW2026!', setup_code: 'SC-HR' });
tok = (await J(await post('/users/login', { name: 'Hours Admin', password: 'HoursPW2026!' })))?.token;
t('the office signed in', !!tok);

console.log('\n── a guest client is never on the payroll list ──');
const h1 = await J(await get('/office/hours'));
const names = (h1?.people || []).map(p => p.name);
t('A CLIENT ACCOUNT IS OFF IT BY DERIVATION — is_external already says they do not work here, so nobody ticks five boxes to re-state a fact the app holds',
  !names.includes('Guest Client'), names.join(', '));
t('and it is not merely hidden behind an exclusion somebody has to make',
  !(h1?.excluded || []).some(e => e.name === 'Guest Client'));
t('a real employee is still on it', names.includes('Payroll Person'));
t('nobody is excluded on a fresh database', (h1?.excluded || []).length === 0);

console.log('\n── taking somebody off, deliberately ──');
const noReason = await post('/office/hours/exclude', { row_id: 'hr-staff', reason: 'x' });
t('A REASON IS REQUIRED — a name that vanishes off a payroll list with nothing saying why is a gap nobody can resolve in March',
  noReason.status === 400, String(noReason.status));
const ghost = await post('/office/hours/exclude', { row_id: 'not-a-person', reason: 'Salaried, tracked elsewhere' });
t('somebody who is not on the list cannot be taken off it', ghost.status === 404);

const before = h1.totals_by_type.employee;
const ok = await post('/office/hours/exclude', { row_id: 'hr-staff', reason: 'Salaried — tracked in ADP, not here' });
t('excluding works', ok.status === 200);

const h2 = await J(await get('/office/hours'));
t('they leave the grid', !(h2.people || []).some(p => p.name === 'Payroll Person'));
t('AND THE TOTALS GO WITH THEM — a figure that still counts somebody the list does not show is the disagreement this codebase keeps unpicking',
  h2.totals_by_type.employee.people === before.people - 1,
  `${h2.totals_by_type.employee.people} vs ${before.people}`);
const e = (h2.excluded || []).find(x => x.row_id === 'hr-staff');
t('the decision stays visible, with who made it and why',
  e?.name === 'Payroll Person' && /Salaried/.test(e.reason) && e.excluded_by === 'Hours Admin',
  JSON.stringify(e));
t('and it is audited', !!db.prepare("SELECT 1 FROM audit_log WHERE entity_type = 'hours_exclusion' AND entity_id = 'hr-staff'").get());

console.log('\n── it is not a deactivation, and it is reversible ──');
t('THEIR ACCOUNT IS UNTOUCHED — this is a payroll LIST, not a payroll record, and deactivating would revoke their access to the whole app',
  db.prepare("SELECT is_active FROM users WHERE id = 'hr-staff'").get().is_active === 1);
// Hours already filed stay filed: what we paid somebody is a record.
db.prepare(`INSERT INTO employee_hours (id, user_id, week_start, worked) VALUES ('hr-h1','hr-staff',?,8)`).run(h2.weeks[0]);
const h3 = await J(await get('/office/hours'));
t('hours already filed are kept, not deleted', db.prepare("SELECT worked FROM employee_hours WHERE id = 'hr-h1'").get().worked === 8);
t('…and still do not show while they are off the list', !(h3.people || []).some(p => p.name === 'Payroll Person'));

const back = await req('/office/hours/exclude/hr-staff', { method: 'DELETE' });
t('putting them back is one click', back.status === 200);
const h4 = await J(await get('/office/hours'));
t('they return to the grid with their hours intact',
  (h4.people || []).find(p => p.name === 'Payroll Person')?.period.worked === 8);
t('and nothing is left on the excluded list', (h4.excluded || []).length === 0);

console.log('\n── only an admin decides this ──');
db.prepare(`INSERT OR REPLACE INTO users (id,name,username,role,department,is_active,setup_code,setup_code_expires_at,module_access)
  VALUES ('hr-sup','Sup Ervisor','Sup Ervisor','supervisor','warehouse',1,'SC-HS',datetime('now','+7 day'),'{"pm":"edit"}')`).run();
await post('/users/login', { name: 'Sup Ervisor' });
await post('/users/set-password', { user_id: 'hr-sup', password: 'SupPW2026!', setup_code: 'SC-HS' });
const supTok = (await J(await post('/users/login', { name: 'Sup Ervisor', password: 'SupPW2026!' })))?.token;
const supTry = await fetch(`${B}/office/hours/exclude`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${supTok}` },
  body: JSON.stringify({ row_id: 'hr-staff', reason: 'Not mine to decide' }),
});
t('a supervisor cannot take somebody off the payroll list', supTry.status === 403 || supTry.status === 401, String(supTry.status));

console.log('\n── in a real browser ──');
const { chromium } = await import('playwright-core');
const URL = `http://localhost:${PORT}`;
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('pageerror', e => { console.log('  [pageerror]', e.message); fail++; });
await page.goto(`${URL}/manifest.webmanifest`);
await page.evaluate(([tk, u]) => { localStorage.setItem('auth_token', tk); localStorage.setItem('auth_user', JSON.stringify(u)); },
  [tok, { id: 'hr-admin', name: 'Hours Admin', role: 'admin', department: 'office' }]);
// Time Tracking keeps its own useState tabs rather than useModuleTabs, so
// ?view= does not reach it — clicked, the way somebody actually gets there.
await page.goto(`${URL}/?tab=time-tracking`);
await page.waitForSelector('text=Time Tracking', { timeout: 20000 });
await page.getByRole('tab', { name: 'Hours', exact: true }).first().click();
const onTab = await page.waitForSelector('[data-exclude-open="hr-staff"]', { timeout: 20000 }).then(() => true).catch(() => false);
t('THE CONTROL IS ON THE HOURS LIST ITSELF — a fix that is not where the problem is seen is a fix nobody runs',
  onTab, (await page.locator('body').innerText()).slice(0, 90).replace(/\n/g, ' '));

if (onTab) {
  t('a guest client is not on the screen either, not just out of the payload',
    !(await page.locator('body').innerText()).includes('Guest Client'));
  await page.locator('[data-exclude-open="hr-staff"]').first().click();
  await page.waitForSelector('[data-exclude-modal]', { timeout: 10000 });
  t('it says plainly that the account and the hours already filed are untouched',
    /account stays/i.test(await page.locator('[data-exclude-modal]').innerText()));
  t('and Save is held until there is a reason', await page.locator('[data-exclude-save]').isDisabled());
  await page.locator('[data-exclude-reason]').fill('Salaried — tracked in ADP');
  t('…and offered once there is', !(await page.locator('[data-exclude-save]').isDisabled()));
  await page.locator('[data-exclude-save]').click();
  await page.waitForSelector('[data-excluded-strip]', { timeout: 10000 });
  t('THE DECISION STAYS ON SCREEN with a way back — a name that simply vanished could never be questioned or undone',
    await page.locator('[data-excluded-strip]').isVisible());
  await page.locator('[data-excluded-toggle]').click();
  await page.waitForSelector('[data-excluded-restore="hr-staff"]', { timeout: 10000 });
  t('it names who decided and why', /Salaried/.test(await page.locator('[data-excluded-row="hr-staff"]').innerText())
    && /Hours Admin/.test(await page.locator('[data-excluded-row="hr-staff"]').innerText()));
  await page.locator('[data-excluded-restore="hr-staff"]').first().click();
  await page.waitForTimeout(900);
  t('and putting them back returns them to the grid', await page.locator('[data-exclude-open="hr-staff"]').count() > 0);
}

await browser.close();
db.close();
console.log(`\n${pass}/${pass + fail} assertions passed`);
process.exit(fail ? 1 : 0);
