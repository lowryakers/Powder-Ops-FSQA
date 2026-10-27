// verify:taskrouting — D-217. Who sees which tasks, and three places work landed on the wrong list.
//
// Maria: QA still sees Daily PM tasks. Three causes, each asserted here, plus the read-only report that
// names the rest on the live database:
//  1. A machine's schedules follow its team — EXCEPT anything already on QA, so a machine PM that had
//     ever been on QA stayed there after the machine moved to Maintenance. Only QA's inspections
//     (BP&G, Light, Temp & Humidity) are exempt now, and missed cards move too.
//  2. "Daily PM Checklist — Production (Qa)" lost its Temp & Humidity lines (D-138) but stayed hung on
//     the Production 1 monitor, so its card named a monitor that has its own check. It is re-hung on a
//     machine it still covers.
//  3. The Task Center's team tabs were admin-only: anyone else saw every team's work at once. Everyone
//     gets the tabs, opening on their own team.
//
// Caller sets PORT + DBPATH (the runner boots the server). Boots a second server on PORT+100 so the
// boot repair runs over the fixtures. Needs a built client.
import Database from 'better-sqlite3';
import { spawn } from 'child_process';
import { chromium } from 'playwright-core';

const PORT = Number(process.env.PORT || 5129);
const BOOT2 = PORT + 100;
const DBP = process.env.DBPATH;
let pass = 0, fail = 0;
const t = (n, ok, d = '') => { if (ok) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n}${d ? ' — ' + d : ''}`); } };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const q = (sql, ...a) => { const d = new Database(DBP, { readonly: true }); try { return d.prepare(sql).all(...a); } finally { d.close(); } };

const db = new Database(DBP);
const mk = (id, name, role, dept, ma) => db.prepare(`INSERT OR REPLACE INTO users
  (id,name,username,role,department,is_active,setup_code,setup_code_expires_at,module_access)
  VALUES (?,?,?,?,?,1,?,datetime('now','+7 day'),?)`).run(id, name, name, role, dept, `SC-${id}`, ma ? JSON.stringify(ma) : null);
mk('tr-admin', 'Tara Admin', 'admin', 'admin', null);
mk('tr-qa', 'Quincy QA', 'supervisor', 'qa', { pm: 'view', operator: 'view' });
const eq = (id, name, asset, team, kind = 'machine') => db.prepare(`INSERT OR REPLACE INTO equipment (id, name, type, room, asset_id, status, task_group, asset_kind)
  VALUES (?, ?, 'Mixer', 'Production', ?, 'active', ?, ?)`).run(id, name, asset, team, kind);
const sched = (id, eqId, title, team, freq = 'daily', desc = null, steps = '[]') => db.prepare(`INSERT OR REPLACE INTO pm_schedules
  (id, equipment_id, title, description, frequency_type, frequency_value, procedure_steps, task_group, is_active) VALUES (?, ?, ?, ?, ?, 1, ?, ?, 1)`)
  .run(id, eqId, title, desc, freq, steps, team);
const card = (id, schedId, eqId, title, team, status = 'open', qs = null) => db.prepare(`INSERT OR REPLACE INTO work_orders
  (id, pm_schedule_id, quality_schedule_id, equipment_id, title, due_date, task_group, status) VALUES (?, ?, ?, ?, ?, date('now'), ?, ?)`)
  .run(id, schedId, qs, eqId, title, team, status);

// 1. A machine whose team is Maintenance, carrying a Daily PM stuck on QA.
eq('tr-mixer', 'Fixture Ribbon Mixer', 'TR-001', 'qa');
sched('tr-mixer-pm', 'tr-mixer', 'Fixture Ribbon Mixer — Daily PM', 'qa');
card('tr-mixer-open', 'tr-mixer-pm', 'tr-mixer', 'Fixture Ribbon Mixer — Daily PM', 'qa', 'open');
card('tr-mixer-missed', 'tr-mixer-pm', 'tr-mixer', 'Fixture Ribbon Mixer — Daily PM', 'qa', 'missed');
// QA's own inspection on the same machine, and a quality-schedule card on it: both stay QA's.
sched('tr-mixer-light', 'tr-mixer', 'Light Inspection — Fixture Mixer Room', 'qa', 'monthly');
card('tr-mixer-light-card', 'tr-mixer-light', 'tr-mixer', 'Light Inspection — Fixture Mixer Room', 'qa');
card('tr-mixer-qs-card', null, 'tr-mixer', 'Environmental swab — mixer', 'qa', 'open', 'tr-qs');

// 2. A QA room checklist hung on a monitor whose own line has a twin, plus a machine with no daily of its own.
eq('tr-mon', 'Fixture Temp/Humidity Monitor', 'TR-TH-1', 'qa', 'zone');
sched('tr-mon-th', 'tr-mon', 'Temp & Humidity Check — Fixture Room', 'qa');
eq('tr-hopper', 'Fixture Hopper', 'TR-002', 'qa');
const steps = JSON.stringify(['Fixture Temp/Humidity Monitor #TR-TH-1 — Record temperature', 'Fixture Hopper #TR-002 — Check the seal']);
sched('tr-check', 'tr-mon', 'Daily PM Checklist — Fixture Room (Qa)', 'qa', 'daily',
  'Consolidated daily checks for 2 equipment items in Fixture Room. One line per machine; replaces the individual daily PM tasks.', steps);
card('tr-check-card', 'tr-check', 'tr-mon', 'Daily PM Checklist — Fixture Room (Qa)', 'qa');
db.close();

// Every server this script starts is stopped on the way out, however it exits — a crash that left one
// running answered the next run's boot on the same port with old code.
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

console.log('\n── the boot repair: the checklist names a machine it still covers ──');
const two = await boot(BOOT2);
t('second server booted', !!two.url, two.log().slice(-400));
const check = q("SELECT equipment_id, is_active, procedure_steps FROM pm_schedules WHERE id = 'tr-check'")[0];
t('the monitor line came off (it has its own Temp & Humidity check)', !/Temp\/Humidity Monitor/.test(check.procedure_steps), check.procedure_steps);
t('the checklist stays active for the line with no daily of its own', check.is_active === 1);
t('it is re-hung on the hopper, the machine it still covers', check.equipment_id === 'tr-hopper', check.equipment_id);
t('its open card is re-hung too', q("SELECT equipment_id FROM work_orders WHERE id = 'tr-check-card'")[0].equipment_id === 'tr-hopper');
t('the boot log says so', /re-hung on a machine it still covers/.test(two.log()), two.log().match(/Checklist.*Fixture.*/)?.[0]);
t('the re-hang is audited', q("SELECT COUNT(*) n FROM audit_log WHERE entity_id = 'tr-check' AND details LIKE '%rehung_to%'")[0].n >= 1);
two.proc.kill(); await wait(800);
const three = await boot(BOOT2);
t('a second boot changes nothing (idempotent)', !/Fixture Room/.test(three.log().match(/\[migrate\] Checklist.*/g)?.join('\n') || ''));
const URL = three.url;

const H = { 'Content-Type': 'application/json' };
const call = (m, p, b, tok) => fetch(`${URL}/api${p}`, { method: m, headers: { ...H, ...(tok && { Authorization: `Bearer ${tok}` }) }, body: b ? JSON.stringify(b) : undefined });
const signIn = async (name, id) => {
  await call('POST', '/users/login', { name });
  await call('POST', '/users/set-password', { user_id: id, password: 'Route2026!!', setup_code: `SC-${id}` });
  return (await call('POST', '/users/login', { name, password: 'Route2026!!' })).json();
};
const admin = await signIn('Tara Admin', 'tr-admin');
const qa = await signIn('Quincy QA', 'tr-qa');

console.log('\n── the report: read-only, admin-only, names the stuck PM ──');
const counts = () => Object.fromEntries(q("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '%_fts%'")
  .map(r => [r.name, q(`SELECT COUNT(*) c FROM "${r.name}"`)[0].c]));
t('QA is refused', (await call('GET', '/compliance/task-routing', null, qa.token)).status === 403);
await wait(300);
const before = counts();
const rep = await (await call('GET', '/compliance/task-routing', null, admin.token)).json();
await wait(300);
const after = counts();
const moved = Object.keys(after).filter(k => after[k] !== before[k]);
t('running it changes no table', moved.length === 0, moved.join(', '));
const finding = (key) => rep.findings.find(f => f.key === key);
t('the Daily PM on QA is listed under machine PMs on the wrong team', finding('machine_care_wrong_team')?.rows.some(r => /Fixture Ribbon Mixer — Daily PM/.test(r.text)));
t('QA\'s Light Inspection is NOT listed there', !finding('machine_care_wrong_team')?.rows.some(r => /Light Inspection/.test(r.text)));
t('the QA room checklist is listed with its line explained', /Fixture Hopper.*no daily of its own/.test(JSON.stringify(finding('checklist_wrong_team')?.rows || [])));
t('no checklist is hung off its own lines any more', !finding('checklist_anchor_off'));
t('QA Quincy\'s card count is reported', rep.people.some(p => p.name === 'Quincy QA' && p.cards > 0));
t('the text names where each thing is changed', /Where to change it: Equipment → the machine → Team/.test(rep.text));

console.log('\n── moving the machine to Maintenance moves its PM, and only its PM ──');
const put = await call('PUT', '/equipment/tr-mixer', { task_group: 'maintenance' }, admin.token);
t('the equipment saves', put.ok, String(put.status));
const team = (sql, id) => q(sql, id)[0]?.task_group;
t('its Daily PM schedule follows it off QA', team('SELECT task_group FROM pm_schedules WHERE id = ?', 'tr-mixer-pm') === 'maintenance');
t('its open card follows', team('SELECT task_group FROM work_orders WHERE id = ?', 'tr-mixer-open') === 'maintenance');
t('its MISSED card follows too', team('SELECT task_group FROM work_orders WHERE id = ?', 'tr-mixer-missed') === 'maintenance');
t('QA\'s Light Inspection on the machine stays QA\'s', team('SELECT task_group FROM pm_schedules WHERE id = ?', 'tr-mixer-light') === 'qa'
  && team('SELECT task_group FROM work_orders WHERE id = ?', 'tr-mixer-light-card') === 'qa');
t('a quality-schedule card on the machine stays QA\'s', team('SELECT task_group FROM work_orders WHERE id = ?', 'tr-mixer-qs-card') === 'qa');
const opv = await (await call('GET', '/pm/operator-tasks', null, qa.token)).json();
t('the PM is off QA\'s Operator View', !opv.some(w => /Fixture Ribbon Mixer — Daily PM/.test(w.title)), opv.map(w => w.title).join(', '));

console.log('\n── the Task Center opens on the person\'s own team ──');
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
await page.goto(`${URL}/manifest.webmanifest`);
await page.evaluate(([tok, u]) => { localStorage.setItem('auth_token', tok); localStorage.setItem('auth_user', JSON.stringify(u)); }, [qa.token, qa.user]);
await page.goto(`${URL}/?tab=pm`);
await page.locator('[data-task-team-tabs]').waitFor({ timeout: 20000 }).catch(() => {});
t('a QA supervisor sees the team tabs (admin-only before)', await page.locator('[data-task-team-tabs]').count() === 1);
await page.getByText('Light Inspection — Fixture Mixer Room').first().waitFor({ timeout: 15000 }).catch(() => {});
const body = await page.textContent('body');
t('it opens on QA: QA\'s inspection is there', /Light Inspection — Fixture Mixer Room/.test(body));
t('and the Maintenance PM is not', !/Fixture Ribbon Mixer — Daily PM/.test(body));
await page.getByRole('button', { name: 'All Groups' }).click({ timeout: 5000 }).catch(() => {});
await page.getByText('Fixture Ribbon Mixer — Daily PM').first().waitFor({ timeout: 15000 }).catch(() => {});
t('All Groups is one tap away and shows it', /Fixture Ribbon Mixer — Daily PM/.test(await page.textContent('body')));
await browser.close();
three.proc.kill();

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
