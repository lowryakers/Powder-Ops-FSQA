// verify:routingcleanup — D-218. The cards the "Who sees which tasks" report found on the wrong list,
// closed at the source, and the Equipment list's team review.
//
// Live on 27 Oct: an empty "Daily PM Checklist — Production (Qa)" raising a blank card on QA's list
// every day, a Kitting checklist left with one scale line, machine PMs on two areas, a duplicate
// Monthly PM on Scale #73, and 179 open cards on equipment out of service (Ricardo's list read 377).
//
// Caller sets PORT + DBPATH (the runner boots the server). Boots a second server on PORT+100 so the
// boot passes run over the fixtures, and a third to prove a resumed schedule stays resumed.
import Database from 'better-sqlite3';
import { spawn } from 'child_process';
import { chromium } from 'playwright-core';

const PORT = Number(process.env.PORT || 5130);
const BOOT2 = PORT + 100;
const DBP = process.env.DBPATH;
let pass = 0, fail = 0;
const t = (n, ok, d = '') => { if (ok) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n}${d ? ' — ' + d : ''}`); } };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const q = (sql, ...a) => { const d = new Database(DBP, { readonly: true }); try { return d.prepare(sql).all(...a); } finally { d.close(); } };
const one = (sql, ...a) => q(sql, ...a)[0];

const db = new Database(DBP);
const mk = (id, name, role, dept) => db.prepare(`INSERT OR REPLACE INTO users
  (id,name,username,role,department,is_active,setup_code,setup_code_expires_at,module_access)
  VALUES (?,?,?,?,?,1,?,datetime('now','+7 day'),NULL)`).run(id, name, name, role, dept, `SC-${id}`);
mk('rc-admin', 'Rhea Admin', 'admin', 'admin');
const eq = (id, name, asset, team, kind = 'machine', status = 'active') => db.prepare(`INSERT OR REPLACE INTO equipment
  (id, name, type, room, asset_id, status, task_group, asset_kind) VALUES (?, ?, 'Mixer', 'Production', ?, ?, ?, ?)`).run(id, name, asset, status, team, kind);
const sched = (id, eqId, title, team, freq = 'daily', desc = null, steps = '[]', active = 1, created = "datetime('now')") => db.prepare(`INSERT OR REPLACE INTO pm_schedules
  (id, equipment_id, title, description, frequency_type, frequency_value, procedure_steps, task_group, is_active, created_at)
  VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ${created})`).run(id, eqId, title, desc, freq, steps, team, active);
const card = (id, schedId, eqId, title, team, status = 'open') => db.prepare(`INSERT OR REPLACE INTO work_orders
  (id, pm_schedule_id, equipment_id, title, due_date, task_group, status) VALUES (?, ?, ?, ?, date('now'), ?, ?)`).run(id, schedId, eqId, title, team, status);
const CONS = 'Consolidated daily checks for 2 equipment items in Fixture Room. One line per machine; replaces the individual daily PM tasks.';

eq('rc-mon', 'Fixture Monitor', 'RC-TH', 'qa', 'zone');
sched('rc-empty', 'rc-mon', 'Daily PM Checklist — Fixture Room (Qa)', 'qa', 'daily', CONS, '[]');
card('rc-empty-card', 'rc-empty', 'rc-mon', 'Daily PM Checklist — Fixture Room (Qa)', 'qa');
eq('rc-scale', 'Fixture Counting Scale', 'RC-SC', 'kitting');
sched('rc-left', 'rc-scale', 'Daily PM Checklist — Fixture Kitting (Warehouse)', 'kitting', 'daily', CONS, JSON.stringify(['Power, display, zero/tare, cleanliness, accuracy check']));
card('rc-left-card', 'rc-left', 'rc-scale', 'Daily PM Checklist — Fixture Kitting (Warehouse)', 'kitting');
eq('rc-zone', 'Fixture Maintenance Area', 'RC-BPG', 'qa', 'zone');
sched('rc-zone-pm', 'rc-zone', 'Monthly PM — RC-BPG Fixture Maintenance Area', 'qa', 'monthly');
sched('rc-zone-bpg', 'rc-zone', 'Brittle Plastic & Glass — Fixture Maintenance Area', 'qa', 'monthly');
eq('rc-dup', 'Fixture Scale 73', 'RC-73', 'filling');
sched('rc-dup-a', 'rc-dup', 'Monthly PM — 73 Scale', 'filling', 'monthly', null, '[]', 1, "datetime('now','-30 day')");
sched('rc-dup-b', 'rc-dup', 'Monthly PM — 73 Scale', 'filling', 'monthly');
eq('rc-oos', 'Fixture Old Conveyor', 'RC-OOS', 'maintenance', 'machine', 'out_of_service');
sched('rc-oos-pm', 'rc-oos', 'Weekly PM — Fixture Old Conveyor', 'maintenance', 'weekly');
card('rc-oos-open', 'rc-oos-pm', 'rc-oos', 'Weekly PM — Fixture Old Conveyor', 'maintenance', 'open');
card('rc-oos-missed', 'rc-oos-pm', 'rc-oos', 'Weekly PM — Fixture Old Conveyor', 'maintenance', 'missed');
card('rc-oos-started', 'rc-oos-pm', 'rc-oos', 'Weekly PM — Fixture Old Conveyor', 'maintenance', 'in_progress');
card('rc-oos-done', 'rc-oos-pm', 'rc-oos', 'Weekly PM — Fixture Old Conveyor', 'maintenance', 'completed');
eq('rc-p', 'Fixture Paused Fan', 'RC-PF', 'maintenance');
sched('rc-p-pm', 'rc-p', 'Weekly PM — Fixture Paused Fan', 'maintenance', 'weekly', null, '[]', 0);
card('rc-p-card', 'rc-p-pm', 'rc-p', 'Weekly PM — Fixture Paused Fan', 'maintenance', 'overdue');
// The team review: a filler on the Filling team with weekly+ PMs, and one already on Maintenance.
eq('rc-fill', 'Fixture Auger Filler', 'RC-AF', 'filling');
sched('rc-fill-d', 'rc-fill', 'Daily PM — Fixture Auger Filler', 'filling', 'daily');
sched('rc-fill-m', 'rc-fill', 'Monthly PM — Fixture Auger Filler', 'filling', 'monthly');
card('rc-fill-card', 'rc-fill-m', 'rc-fill', 'Monthly PM — Fixture Auger Filler', 'filling');
eq('rc-ok', 'Fixture Compressor', 'RC-CP', 'maintenance');
sched('rc-ok-m', 'rc-ok', 'Monthly PM — Fixture Compressor', 'maintenance', 'monthly');
// The deploy that ships this: the once-only marker is not there yet.
db.prepare("DELETE FROM app_settings WHERE key = 'routing_cleanup_v1'").run();
db.close();

const procs = [];
process.on('exit', () => { for (const p of procs) { try { p.kill(); } catch { /* gone */ } } });
async function boot(port) {
  const proc = spawn(process.execPath, ['server.js'], { env: { ...process.env, PORT: String(port), DB_PATH: DBP, HOUSEKEEPING_MS: '0' }, stdio: ['ignore', 'pipe', 'pipe'] });
  procs.push(proc);
  let log = '';
  proc.stdout.on('data', (d) => { log += d; });
  proc.stderr.on('data', (d) => { log += d; });
  for (let i = 0; i < 90; i++) {
    await wait(1000);
    try { await fetch(`http://localhost:${port}/api/users/lookup?q=zz`); return { proc, url: `http://localhost:${port}`, log: () => log }; } catch { /* booting */ }
  }
  return { proc, url: null, log: () => log };
}
const active = (id) => one('SELECT is_active FROM pm_schedules WHERE id = ?', id)?.is_active;
const status = (id) => one('SELECT status FROM work_orders WHERE id = ?', id)?.status;

console.log('\n── the deploy ──');
const two = await boot(BOOT2);
t('second server booted', !!two.url, two.log().slice(-400));
t('an empty room checklist is paused', active('rc-empty') === 0);
t('…and its blank card is cancelled, with the reason', status('rc-empty-card') === 'cancelled'
  && /no lines left/.test(one("SELECT notes FROM work_orders WHERE id = 'rc-empty-card'").notes));
t('a line-team checklist whose one line names no machine is paused', active('rc-left') === 0 && status('rc-left-card') === 'cancelled');
t('a machine PM on an area is paused', active('rc-zone-pm') === 0);
t('…and the area keeps its own inspection', active('rc-zone-bpg') === 1);
t('of two identical schedules the older keeps running', active('rc-dup-a') === 1 && active('rc-dup-b') === 0);
t('open and missed cards on equipment out of service are cancelled', status('rc-oos-open') === 'cancelled' && status('rc-oos-missed') === 'cancelled');
t('a card somebody started is left', status('rc-oos-started') === 'in_progress');
t('completed work is left exactly as filed', status('rc-oos-done') === 'completed');
t('a card a paused schedule left behind is cancelled', status('rc-p-card') === 'cancelled');
t('a machine schedule nobody flagged is untouched', active('rc-ok-m') === 1 && active('rc-fill-m') === 1);
t('every cancellation is audited', one(`SELECT COUNT(*) n FROM audit_log WHERE entity_type = 'work_order' AND action = 'cancel'
  AND entity_id IN ('rc-empty-card','rc-left-card','rc-oos-open','rc-oos-missed','rc-p-card')`).n === 5);
t('the boot log says what was paused', /Paused "Monthly PM — 73 Scale"/.test(two.log()) && /Closed \d+ open card\(s\) on equipment out of service/.test(two.log()));

console.log('\n── once per database: a resumed schedule stays resumed ──');
{ const d = new Database(DBP); d.prepare("UPDATE pm_schedules SET is_active = 1 WHERE id = 'rc-zone-pm'").run(); d.close(); }
two.proc.kill(); await wait(800);
const three = await boot(BOOT2);
t('a zone PM somebody resumed is not paused again', active('rc-zone-pm') === 1);
const URL = three.url;

const H = { 'Content-Type': 'application/json' };
const call = (m, p, b, tok) => fetch(`${URL}/api${p}`, { method: m, headers: { ...H, ...(tok && { Authorization: `Bearer ${tok}` }) }, body: b ? JSON.stringify(b) : undefined });
await call('POST', '/users/login', { name: 'Rhea Admin' });
await call('POST', '/users/set-password', { user_id: 'rc-admin', password: 'Clean2026!!', setup_code: 'SC-rc-admin' });
const admin = await (await call('POST', '/users/login', { name: 'Rhea Admin', password: 'Clean2026!!' })).json();

console.log('\n── taking a machine out of service closes its cards, from now on ──');
{ const d = new Database(DBP);
  d.prepare("INSERT OR REPLACE INTO work_orders (id, pm_schedule_id, equipment_id, title, due_date, task_group, status) VALUES ('rc-ok-card', 'rc-ok-m', 'rc-ok', 'Monthly PM — Fixture Compressor', date('now'), 'maintenance', 'open')").run();
  d.close(); }
const put = await call('PUT', '/equipment/rc-ok', { status: 'out_of_service' }, admin.token);
t('the equipment saves', put.ok, String(put.status));
t('its open card is cancelled by the save', status('rc-ok-card') === 'cancelled');
{ const d = new Database(DBP);
  d.prepare("INSERT OR REPLACE INTO work_orders (id, pm_schedule_id, equipment_id, title, due_date, task_group, status) VALUES ('rc-dup-card', 'rc-dup-a', 'rc-dup', 'Monthly PM — 73 Scale', date('now'), 'filling', 'open')").run();
  d.close(); }
const bulk = await call('POST', '/equipment/bulk-update', { ids: ['rc-dup'], changes: { status: 'retired' } }, admin.token);
t('bulk edit to retired closes the cards too', bulk.ok && status('rc-dup-card') === 'cancelled', String(bulk.status));

console.log('\n── the Equipment list team review ──');
const rev = await (await call('GET', '/equipment/team-review', null, admin.token)).json();
const filler = rev.rows?.find(r => r.id === 'rc-fill');
t('a filler on the Filling team with a monthly PM is listed, suggested Maintenance', filler?.suggested === 'maintenance' && /monthly/.test(filler.reason), JSON.stringify(filler));
t('a machine on Maintenance is not listed', !rev.rows.some(r => r.name === 'Fixture Compressor'));
t('an area is never listed', !rev.rows.some(r => r.id === 'rc-zone'));

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
// The phone first: the desktop pass moves the filler, which empties the list.
for (const width of [390, 1280]) {
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  await page.goto(`${URL}/manifest.webmanifest`);
  await page.evaluate(([tok, u]) => { localStorage.setItem('auth_token', tok); localStorage.setItem('auth_user', JSON.stringify(u)); }, [admin.token, admin.user]);
  await page.goto(`${URL}/?tab=equipment`);
  await page.locator('[data-team-review]').waitFor({ timeout: 20000 }).catch(() => {});
  t(`${width}px: the team review strip is on the Equipment list`, await page.locator('[data-team-review]').count() === 1);
  await page.locator('[data-team-review-open]').click().catch(() => {});
  const row = page.locator('[data-team-review-row]', { hasText: 'Fixture Auger Filler' });
  await row.waitFor({ timeout: 10000 }).catch(() => {});
  t(`${width}px: the review names the filler and why`, /monthly PMs go to the Filling list/.test(await row.textContent().catch(() => '')));
  if (width === 1280) {
    await row.locator('[data-team-review-move]').click().catch(() => {});
    await row.getByText('Moved to Maintenance').waitFor({ timeout: 10000 }).catch(() => {});
    t('Move to Maintenance moves the machine and its schedules', one("SELECT task_group FROM equipment WHERE id = 'rc-fill'").task_group === 'maintenance'
      && one("SELECT task_group FROM pm_schedules WHERE id = 'rc-fill-m'").task_group === 'maintenance'
      && one("SELECT task_group FROM work_orders WHERE id = 'rc-fill-card'").task_group === 'maintenance');
  }
  t(`${width}px: the page does not pan sideways`, !(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)));
  await page.close();
}
await browser.close();
const after = await (await call('GET', '/equipment/team-review', null, admin.token)).json();
t('once moved, the machine leaves the review', !after.rows.some(r => r.id === 'rc-fill'));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
