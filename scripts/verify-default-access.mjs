// verify:defaultaccess — D-124, live on a fresh database.
//   1. Operator View is every working account's, at View, with the task-doing
//      writes allowed by name and nothing else on the pm router.
//   2. A closed task is closed: its recorded outcome cannot be overwritten.
//   3. The four start-up passes run once per database, not once per boot.
//   4. Bulk Permissions lists active employees only (real browser).
import Database from 'better-sqlite3';
import crypto from 'crypto';
import { spawn } from 'child_process';

const PORT = process.env.PORT || 5044;
const URL = process.env.APP || `http://localhost:${PORT}`;
const DBP = process.env.DBPATH;
let pass = 0, fail = 0;
const t = (name, ok, extra = '') => { if (ok) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.log(`  ✗ ${name} ${extra}`); } };
const wait = (ms) => new Promise(r => setTimeout(r, ms));

const db = new Database(DBP);
const mk = (id, name, role, extra = '') => db.prepare(`INSERT OR REPLACE INTO users (id,name,username,role,department,is_active,module_access,setup_code,setup_code_expires_at${extra ? ',' + extra.split('=')[0] : ''})
  VALUES (?,?,?,?,'warehouse',1,NULL,?,datetime('now','+7 day')${extra ? ',' + extra.split('=')[1] : ''})`).run(id, name, name, role, `SC-${id}`);
mk('da-adm', 'Dana Admin', 'admin');
mk('da-none', 'Nora Nothing', 'operator');
mk('da-guest', 'Gus Guest', 'operator', 'is_external=1');
mk('da-gone', 'Olga Gone', 'operator');
db.prepare("UPDATE users SET is_active = 0 WHERE id = 'da-gone'").run();

const H = { 'Content-Type': 'application/json' };
const call = (p, opts = {}, tok) => fetch(`${URL}/api${p}`, { ...opts, headers: { ...H, ...(tok ? { Authorization: `Bearer ${tok}` } : {}) } });
async function signIn(id, name, pw) {
  await call('/users/login', { method: 'POST', body: JSON.stringify({ name }) });
  await call('/users/set-password', { method: 'POST', body: JSON.stringify({ user_id: id, password: pw, setup_code: `SC-${id}` }) });
  return (await (await call('/users/login', { method: 'POST', body: JSON.stringify({ name, password: pw }) })).json()).token;
}
const adm = await signIn('da-adm', 'Dana Admin', 'DanaAdmin2026!');
const none = await signIn('da-none', 'Nora Nothing', 'NoraNothing26!');
const guest = await signIn('da-guest', 'Gus Guest', 'GusGuest2026!!');

console.log('── 1. Operator View arrives with the account ──');
const woId = crypto.randomUUID();
db.prepare(`INSERT INTO work_orders (id, title, due_date, procedure_steps, task_group, status, assigned_to, assigned_to_id)
  VALUES (?, 'Default access: read the forklift SOP', date('now'), '[]', 'warehouse', 'open', 'Nora Nothing', 'da-none')`).run(woId);
const mine = await call('/pm/operator-tasks', {}, none);
const mineBody = mine.status === 200 ? await mine.json() : null;
const mineList = Array.isArray(mineBody) ? mineBody : (mineBody?.tasks || []);
t('AN ACCOUNT WITH NOTHING TICKED OPENS ITS OWN TASK LIST', mine.status === 200 && mineList.some(w => w.id === woId), `HTTP ${mine.status}`);
const other = await call('/sanitation', {}, none);
t('…and ONLY that: another module is still refused, as for any unassigned account', other.status === 403, `HTTP ${other.status}`);
const sched = await call('/pm/schedules', { method: 'POST', body: JSON.stringify({ title: 'DA: floor account writing a schedule', frequency_type: 'daily' }) }, none);
t('THE DEFAULT IS VIEW — creating a PM schedule is refused', sched.status === 403, `HTTP ${sched.status}`);
const done = await call(`/pm/work-orders/${woId}/complete-and-recur`, { method: 'POST', body: JSON.stringify({ notes: 'read it' }) }, none);
t('BUT DOING THE TASK IS ALLOWED — completing it passes at View', done.status === 200, `HTTP ${done.status} ${(await done.text()).slice(0, 160)}`);
t('and the record says who did it', db.prepare('SELECT completed_by FROM work_orders WHERE id = ?').get(woId)?.completed_by === 'Nora Nothing');
const g = await call('/pm/operator-tasks', {}, guest);
t('A CLIENT NEVER GETS IT — refused at the door as before (404, not 403)', g.status === 404, `HTTP ${g.status}`);
const gLogin = await (await call('/users/login', { method: 'POST', body: JSON.stringify({ name: 'Gus Guest', password: 'GusGuest2026!!' }) })).json();
t('THE SIGN-IN PAYLOAD SAYS SHE IS A CLIENT — the shell draws the guest layout from it before /users/me answers',
  gLogin?.user?.is_external === true, JSON.stringify(gLogin?.user || {}).slice(0, 160));

console.log('\n── 2. A closed task is closed ──');
const naId = crypto.randomUUID();
const schedRow = db.prepare("SELECT id, equipment_id, title FROM pm_schedules WHERE is_active = 1 AND frequency_type = 'daily' LIMIT 1").get();
t('a daily schedule is on file to test with', !!schedRow);
db.prepare(`INSERT INTO work_orders (id, pm_schedule_id, equipment_id, title, due_date, procedure_steps, task_group, status)
  VALUES (?, ?, ?, ?, '2026-06-17', '[]', 'cleaning', 'open')`).run(naId, schedRow.id, schedRow.equipment_id, schedRow.title);
const openFor = () => db.prepare("SELECT COUNT(*) c FROM work_orders WHERE pm_schedule_id = ? AND status IN ('open','in_progress','overdue','missed')").get(schedRow.id).c;
const na = await call(`/pm/work-orders/${naId}/not-applicable`, { method: 'POST', body: JSON.stringify({ reason: 'no changeover today' }) }, adm);
t('marking it not applicable works, and raises the next one', na.status === 200, `HTTP ${na.status}`);
const openAfterNa = openFor();
const again = await call(`/pm/work-orders/${naId}/complete-and-recur`, { method: 'POST', body: JSON.stringify({ notes: 'x' }) }, adm);
const againBody = await again.json().catch(() => ({}));
t('COMPLETING A TASK ALREADY MARKED N/A IS REFUSED — the screenshot\'s card', again.status === 409 && againBody.closed === 'not_applicable', `HTTP ${again.status} ${JSON.stringify(againBody).slice(0, 160)}`);
t('…and says who closed it and where the work goes instead', /not applicable/.test(againBody.error || '') && /Dana Admin/.test(againBody.error || '') && /record form/.test(againBody.error || ''));
const naAgain = await call(`/pm/work-orders/${naId}/not-applicable`, { method: 'POST', body: JSON.stringify({ reason: 'again' }) }, adm);
t('marking it N/A a second time is refused too', naAgain.status === 409, `HTTP ${naAgain.status}`);
const batch = await (await call('/pm/work-orders/batch-complete', { method: 'POST', body: JSON.stringify({ ids: [naId] }) }, adm)).json();
t('and the batch tick-off skips it, naming why', (batch.skipped || []).some(s => s.id === naId && /already closed/.test(s.reason)), JSON.stringify(batch).slice(0, 200));
t('no extra next task either (createNextWorkOrder\'s same-date guard, asserted as a regression)', openFor() === openAfterNa, `${openAfterNa} -> ${openFor()}`);
const after = db.prepare('SELECT status, completed_by, notes FROM work_orders WHERE id = ?').get(naId);
t('THE RECORDED OUTCOME STANDS — still not applicable, by the person who said so, for the reason given',
  after?.status === 'not_applicable' && after?.completed_by === 'Dana Admin' && /no changeover/.test(after?.notes || ''), JSON.stringify(after));

console.log('\n── 3. The start-up passes run once per database ──');
async function reboot(port) {
  const proc = spawn(process.execPath, ['server.js'], { env: { ...process.env, PORT: String(port), DB_PATH: DBP, DBPATH: DBP }, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = ''; proc.stdout.on('data', d => { log += d; }); proc.stderr.on('data', d => { log += d; });
  let ready = false;
  for (let i = 0; i < 90; i++) { await wait(1000); try { await fetch(`http://localhost:${port}/api/users/lookup?q=zz`); ready = true; break; } catch { /* booting */ } }
  return { proc, ready, log: () => log };
}
const b1 = await reboot(Number(PORT) + 100);
t('the application booted again on the same file', b1.ready);
b1.proc.kill('SIGKILL'); await wait(500);
const markers = ['migrate_cleaning_group_v1', 'migrate_light_inspection_frequency_v1', 'migrate_pm_titles_v1', 'migrate_maintenance_group_v1'];
const have = markers.filter(k => db.prepare('SELECT 1 FROM app_settings WHERE key = ?').get(k));
t('all four passes are recorded as done once the tables they act on have rows', have.length === 4, JSON.stringify(have));

// Now the plant edits the very fields those passes used to rewrite.
const light = db.prepare("SELECT id FROM pm_schedules WHERE title LIKE 'Light Inspection%' LIMIT 1").get();
if (light) db.prepare("UPDATE pm_schedules SET frequency_type = 'quarterly' WHERE id = ?").run(light.id);
const wh = db.prepare(`SELECT ps.id FROM pm_schedules ps JOIN equipment e ON e.id = ps.equipment_id
  WHERE ps.task_group IN ('warehouse','maintenance') AND (ps.description IS NULL OR ps.description NOT LIKE 'Consolidated daily checks%') LIMIT 1`).get();
if (wh) db.prepare("UPDATE pm_schedules SET title = 'Renamed by the plant' WHERE id = ?").run(wh.id);
const cl = db.prepare(`SELECT ps.id FROM pm_schedules ps JOIN equipment e ON e.id = ps.equipment_id WHERE e.asset_id LIKE 'QA-CL-%' LIMIT 1`).get();
if (cl) db.prepare("UPDATE pm_schedules SET task_group = 'qa' WHERE id = ?").run(cl.id);
t('there is a Light Inspection, a warehouse/maintenance and a cleaning-zone schedule to edit', !!(light && wh && cl), JSON.stringify({ light: !!light, wh: !!wh, cl: !!cl }));

const b2 = await reboot(Number(PORT) + 101);
t('booted a third time', b2.ready);
b2.proc.kill('SIGKILL'); await wait(500);
t('A LIGHT INSPECTION DELIBERATELY SET QUARTERLY STAYS QUARTERLY', !light || db.prepare('SELECT frequency_type f FROM pm_schedules WHERE id = ?').get(light.id).f === 'quarterly');
t('A RENAMED SCHEDULE KEEPS ITS NAME across a deploy', !wh || db.prepare('SELECT title FROM pm_schedules WHERE id = ?').get(wh.id).title === 'Renamed by the plant');
t('A CLEANING-ZONE SCHEDULE ROUTED TO QA STAYS ROUTED', !cl || db.prepare('SELECT task_group g FROM pm_schedules WHERE id = ?').get(cl.id).g === 'qa');

console.log('\n── 4. Bulk Permissions lists active employees only ──');
const { chromium } = await import('playwright-core');
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on('pageerror', e => { console.log('  [pageerror]', e.message); fail++; });
  await page.goto(`${URL}/manifest.webmanifest`);
  await page.evaluate(([tk]) => { localStorage.setItem('auth_token', tk); localStorage.setItem('auth_user', JSON.stringify({ id: 'da-adm', name: 'Dana Admin', role: 'admin' })); }, [adm]);
  await page.goto(`${URL}/?tab=settings&section=users`);
  await page.getByRole('button', { name: /Bulk Permissions/ }).click({ timeout: 20000 });
  await page.waitForSelector('[data-bulk-person]', { timeout: 10000 });
  const names = await page.locator('[data-bulk-person]').evaluateAll(els => els.map(e => e.getAttribute('data-bulk-person')));
  t('an active employee is listed', names.includes('Nora Nothing'), JSON.stringify(names).slice(0, 200));
  t('A CLIENT IS NOT', !names.includes('Gus Guest'));
  t('A DEACTIVATED ACCOUNT IS NOT', !names.includes('Olga Gone'));
  t('nor ReadyBot', !names.includes('ReadyBot'));

  // The roster row says what she holds, not the amber "nothing".
  await page.keyboard.press('Escape').catch(() => {});
  await page.goto(`${URL}/?tab=settings&section=users`);
  await page.waitForSelector('[data-access-defaults]', { timeout: 15000 }).catch(() => {});
  t('THE ROSTER SAYS "Operator View only" for an account with nothing ticked — not "No modules assigned"',
    await page.locator('[data-access-defaults]').count() > 0);

  // The Task Center card of a closed task offers nothing to do.
  await page.goto(`${URL}/?tab=pm`);
  await page.waitForTimeout(2500);
  const search = page.locator('input[placeholder*="Search" i]').first();
  if (await search.count()) { await search.fill(schedRow.title.slice(0, 20)); await page.waitForTimeout(2000); }
  const card = page.locator(`[data-wo-card="${naId}"]`);
  if (await card.count()) {
    t('THE CLOSED CARD OFFERS NO DONE BUTTON', await card.locator('[data-wo-complete]').count() === 0);
    t('…and says it was marked not applicable, by whom', /Marked not applicable by Dana Admin/.test(await card.locator('[data-wo-closed]').innerText().catch(() => '')));
  } else {
    console.log('  (the closed card was not in the visible list; asserting the shared rule instead)');
    const { isClosedStatus } = await import('../shared/work-order-status.js');
    t('the card\'s rule treats not_applicable as closed', isClosedStatus('not_applicable') && !isClosedStatus('missed'));
  }
} finally { await browser.close(); }

db.close();
console.log(`\n${pass}/${pass + fail} assertions passed`);
process.exit(fail ? 1 : 0);
