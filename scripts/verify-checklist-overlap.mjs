// verify:checklistoverlap — D-138, live on a fresh database, two reboots, and a real browser.
//
// "Daily PM Checklist — Production (Qa)" sat on QA's list beside the Temp &
// Humidity checks for Production 1 and 2 — the same two checks, folded into a
// room checklist on 22 July, with no form number and filing no record. The
// per-point schedules had been brought back; the merged one was never stood
// down. The same defect shows up wherever a reader assumes the checklist's
// `equipment_id` is the only machine on it.
//
// Caller sets PORT + DBPATH. Needs a built client. The control is `main`
// before this change: the reboot touches nothing and the QA checklist is still
// on the floor beside the checks it duplicates.
import Database from 'better-sqlite3';
import { spawn } from 'child_process';
import { randomUUID as uuid } from 'crypto';
import { chromium } from 'playwright-core';

const PORT = Number(process.env.PORT || 5054);
const BOOT2 = PORT + 100;
const DBP = process.env.DBPATH;
let pass = 0, fail = 0;
const t = (n, ok, d = '') => { if (ok) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n}${d ? ' — ' + d : ''}`); } };
const J = async (r) => { try { return await r.json(); } catch { return null; } };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const today = new Date().toISOString().slice(0, 10);
const yday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);

const db = new Database(DBP);
const mkUser = (id, name, role, dept, modules) => db.prepare(`INSERT OR REPLACE INTO users
  (id,name,username,role,department,is_active,setup_code,setup_code_expires_at,module_access)
  VALUES (?,?,?,?,?,1,?,datetime('now','+7 day'),?)`).run(id, name, name, role, dept, `SC-${id}`, modules ? JSON.stringify(modules) : null);
mkUser('co-adm', 'Ola Overlap', 'admin', 'maintenance', null);
mkUser('co-qa', 'Quinn Checks', 'operator', 'qa', { operator: 'view' });

// ── THE PLANT'S STATE ──────────────────────────────────────────────────────
// (1) The QA room checklist, exactly as consolidation built it: hung on the
// Production 1 monitor, one line per monitor, an open card today, a missed one
// from yesterday and a completed one from last week. The two per-point
// schedules are active beside it (the Temp & Humidity repair put them back).
const th = (a) => db.prepare('SELECT * FROM equipment WHERE asset_id = ?').get(a);
const P1 = th('QA-TH-011'), P2 = th('QA-TH-012');
const thSched = db.prepare("SELECT id, title FROM pm_schedules WHERE title LIKE 'Temp & Humidity Check — Production%' AND is_active = 1").all();
const QA_ID = uuid();
const qaSteps = [`${P1.name} #QA-TH-011 — Record temperature and humidity`, `${P2.name} #QA-TH-012 — Record temperature and humidity`];
db.prepare(`INSERT INTO pm_schedules (id, equipment_id, title, description, frequency_type, frequency_value, procedure_steps, task_group, is_active)
  VALUES (?, ?, 'Daily PM Checklist — Production (Qa)', 'Consolidated daily checks for 2 equipment items in Production. One line per machine; replaces the individual daily PM tasks.', 'daily', 1, ?, 'qa', 1)`)
  .run(QA_ID, P1.id, JSON.stringify(qaSteps));
const card = (status, due) => {
  const id = uuid();
  db.prepare(`INSERT INTO work_orders (id, pm_schedule_id, equipment_id, title, due_date, procedure_steps, task_group, status, completed_at, completed_by)
    VALUES (?, ?, ?, 'Daily PM Checklist — Production (Qa)', ?, ?, 'qa', ?, ?, ?)`)
    .run(id, QA_ID, P1.id, due, JSON.stringify(qaSteps), status, status === 'completed' ? `${due} 09:00:00` : null, status === 'completed' ? 'Diana' : null);
  return id;
};
const W_OPEN = card('open', today), W_MISSED = card('missed', yday), W_DONE = card('completed', '2026-09-20');

// (2) A maintenance room checklist, as built on this database. One machine on
// it (not the anchor) was later given a Daily PM of its own — what "Create
// schedules from these tasks" did for every machine on a checklist.
const maint = db.prepare(`SELECT * FROM pm_schedules WHERE description LIKE 'Consolidated daily checks%' AND is_active = 1
  ORDER BY json_array_length(procedure_steps) DESC LIMIT 1`).get();
const mSteps = JSON.parse(maint.procedure_steps);
const asset = (step) => (step.slice(0, step.indexOf(' — ')).match(/#(\S+)$/) || [])[1];
const anchor = db.prepare('SELECT * FROM equipment WHERE id = ?').get(maint.equipment_id);
const lineIdx = mSteps.findIndex((s) => asset(s) && asset(s) !== anchor.asset_id);
const twin = db.prepare('SELECT * FROM equipment WHERE asset_id = ?').get(asset(mSteps[lineIdx]));
const otherIdx = mSteps.findIndex((s, i) => i !== lineIdx && asset(s) && asset(s) !== anchor.asset_id && asset(s) !== twin.asset_id);
const covered = db.prepare('SELECT * FROM equipment WHERE asset_id = ?').get(asset(mSteps[otherIdx]));
db.prepare(`INSERT INTO pm_schedules (id, equipment_id, title, description, frequency_type, frequency_value, procedure_steps, task_group, is_active)
  VALUES (?, ?, ?, 'Created from the maintenance tasks written on it.', 'daily', 1, '["Daily check"]', ?, 1)`)
  .run(uuid(), twin.id, `${twin.name} — Daily PM`, maint.task_group);
const M_OPEN = uuid();
db.prepare(`INSERT INTO work_orders (id, pm_schedule_id, equipment_id, title, due_date, procedure_steps, task_group, status)
  VALUES (?, ?, ?, ?, ?, ?, ?, 'open')`).run(M_OPEN, maint.id, maint.equipment_id, maint.title, today, maint.procedure_steps, maint.task_group);
// A machine covered by the checklist with Daily tasks written and NO schedule
// of its own — its only recurring work is its line on the room checklist,
// which is what consolidation left every non-anchor machine with.
db.prepare("UPDATE pm_schedules SET is_active = 0 WHERE equipment_id = ? AND (description IS NULL OR description NOT LIKE 'Consolidated%')").run(covered.id);
db.prepare('UPDATE equipment SET maintenance_tasks = ? WHERE id = ?')
  .run(JSON.stringify({ Daily: ['Wipe down', 'Check guards'], Monthly: ['Inspect belt'] }), covered.id);
db.close();
t('the plant\'s state is built: a QA room checklist over two live per-point checks, and a maintenance one with one twin',
  !!P1 && !!P2 && thSched.length === 2 && lineIdx >= 0 && otherIdx >= 0, `th=${thSched.length} line=${lineIdx} other=${otherIdx}`);

async function reboot(port) {
  const proc = spawn(process.execPath, ['server.js'], {
    env: { ...process.env, PORT: String(port), DB_PATH: DBP },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  proc.stdout.on('data', (d) => { log += d; });
  proc.stderr.on('data', (d) => { log += d; });
  let ready = false;
  for (let i = 0; i < 90; i++) {
    await wait(1000);
    try { await fetch(`http://localhost:${port}/api/users/lookup?q=zz`); ready = true; break; } catch { /* booting */ }
  }
  return { proc, base: `http://localhost:${port}/api`, url: `http://localhost:${port}`, ready, log: () => log };
}
const q = (sql, ...a) => { const d = new Database(DBP, { readonly: true }); try { return d.prepare(sql).all(...a); } finally { d.close(); } };
const one1 = (sql, ...a) => q(sql, ...a)[0];

console.log('\n── the redeploy: a checklist line whose machine has its own daily schedule comes off ──');
const one = await reboot(BOOT2);
t('the application booted again on the same database', one.ready);
t('the boot log names the QA checklist and says it was paused', /Checklist overlap: "Daily PM Checklist — Production \(Qa\)" — 2 line\(s\) removed.*checklist paused, 2 open card\(s\) cancelled/.test(one.log()),
  one.log().split('\n').filter((l) => /overlap/.test(l)).join(' | ') || 'no line');
const qa = one1('SELECT * FROM pm_schedules WHERE id = ?', QA_ID);
t('the QA room checklist is PAUSED, not deleted', qa && qa.is_active === 0);
t('its open card and its missed card are cancelled, with the reason on each',
  q(`SELECT status, notes FROM work_orders WHERE id IN (?, ?)`, W_OPEN, W_MISSED).every((w) => w.status === 'cancelled' && /D-138/.test(w.notes || '')));
t('the card completed last week is left exactly as filed', one1('SELECT status, completed_by FROM work_orders WHERE id = ?', W_DONE)?.status === 'completed');
t('both per-point Temp & Humidity schedules are still running',
  q("SELECT is_active FROM pm_schedules WHERE title LIKE 'Temp & Humidity Check — Production%'").every((s) => s.is_active === 1));
const m = one1('SELECT * FROM pm_schedules WHERE id = ?', maint.id);
const mAfter = JSON.parse(m.procedure_steps);
t('on the maintenance checklist only the twin\'s line came off', m.is_active === 1 && mAfter.length === mSteps.length - 1
  && !mAfter.some((s) => asset(s) === twin.asset_id), `${mSteps.length} → ${mAfter.length}`);
t('and the card already open carries the shorter list too', JSON.parse(one1('SELECT procedure_steps FROM work_orders WHERE id = ?', M_OPEN).procedure_steps).length === mAfter.length);
t('each change is audited with the lines removed and the schedule that owns them',
  q("SELECT details FROM audit_log WHERE entity_type = 'pm_schedule' AND entity_id IN (?, ?) AND details LIKE '%consolidated_checklist_overlap%'", QA_ID, maint.id).length === 2);
one.proc.kill('SIGKILL');

const two = await reboot(BOOT2);
t('a second boot changes nothing (idempotent)', two.ready && !/Checklist overlap/.test(two.log())
  && JSON.parse(one1('SELECT procedure_steps FROM pm_schedules WHERE id = ?', maint.id).procedure_steps).length === mAfter.length);

const B = two.base;
const signIn = async (id, name) => {
  const c = (mth, p, b) => fetch(B + p, { method: mth, headers: { 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : undefined });
  await c('POST', '/users/login', { name });
  await c('POST', '/users/set-password', { user_id: id, password: 'Passw0rd!!', setup_code: `SC-${id}` });
  return J(await c('POST', '/users/login', { name, password: 'Passw0rd!!' }));
};
const adm = await signIn('co-adm', 'Ola Overlap');
const qau = await signIn('co-qa', 'Quinn Checks');
const call = (tok) => (mth, p, b) => fetch(B + p, { method: mth, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` }, body: b ? JSON.stringify(b) : undefined });
const A = call(adm.token), Q = call(qau.token);

console.log('\n── what QA sees ──');
const tasks = await J(await Q('GET', '/pm/operator-tasks'));
const titles = (Array.isArray(tasks) ? tasks : tasks?.tasks || []).map((x) => x.title);
t('QA\'s list has no "Daily PM Checklist — Production (Qa)"', !titles.some((x) => /Production \(Qa\)/.test(x)), titles.filter((x) => /Checklist/.test(x)).join(', '));
t('and still has the per-point Temp & Humidity checks', titles.filter((x) => /^Temp & Humidity Check — Production/.test(x)).length >= 2, titles.filter((x) => /Temp/.test(x)).join(', '));

console.log('\n── a machine on a room checklist IS scheduled ──');
const rd = await J(await A('GET', `/equipment/${covered.id}/readiness`));
const step = (rd?.steps || []).find((s) => s.id === 'pm_schedule');
t('the setup checklist reads "on the room checklist", not "nothing generates them"', step?.done === true && /room checklist/.test(step?.detail || ''), JSON.stringify(step));
const prev = await J(await A('GET', '/equipment/schedules-from-tasks/preview'));
const mine = (prev?.machines || []).find((x) => x.id === covered.id);
t('"Create schedules from these tasks" offers it a Monthly, never a second Daily',
  !!mine && mine.create.map((c) => c.frequency).join() === 'Monthly' && mine.skip.some((s) => s.frequency === 'Daily' && /room checklist/.test(s.reason)), JSON.stringify(mine));

console.log('\n── the machine the checklist hangs on cannot take it over ──');
const before = one1('SELECT procedure_steps, task_group FROM pm_schedules WHERE id = ?', maint.id);
let r = await A('PUT', `/equipment/${anchor.id}`, { maintenance_tasks: { Daily: ['Only this machine'] } });
t('saving the anchor\'s task list leaves the room checklist\'s lines alone', r.ok
  && one1('SELECT procedure_steps FROM pm_schedules WHERE id = ?', maint.id).procedure_steps === before.procedure_steps);
const otherGroup = before.task_group === 'warehouse' ? 'maintenance' : 'warehouse';
r = await A('PUT', `/equipment/${anchor.id}`, { task_group: otherGroup });
t('re-routing the anchor to another team does not move the room\'s checklist', r.ok
  && one1('SELECT task_group FROM pm_schedules WHERE id = ?', maint.id).task_group === before.task_group
  && one1('SELECT task_group FROM work_orders WHERE id = ?', M_OPEN).task_group === before.task_group);
r = await A('DELETE', `/equipment/${anchor.id}`);
t('deleting the anchor is refused while the checklist hangs on it', r.status === 409 && /covers other machines/.test((await J(r))?.error || ''));

console.log('\n── in the browser, the Operator View ──');
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.goto(`${two.url}/manifest.webmanifest`);
  await page.evaluate(([tk, u]) => { localStorage.setItem('auth_token', tk); localStorage.setItem('auth_user', JSON.stringify(u)); }, [qau.token, qau.user]);
  await page.goto(`${two.url}/?tab=operator`);
  await page.getByText(/Temp & Humidity Check — Production 1/).first().waitFor({ timeout: 15000 });
  const body = await page.locator('body').innerText();
  t('QA\'s screen shows the Production 1 check and no merged checklist', /Temp & Humidity Check — Production 1/.test(body) && !/Production \(Qa\)/.test(body));
} catch (e) { t('the Operator View rendered', false, e.message); }
finally { await browser.close(); two.proc.kill('SIGKILL'); }

console.log(`\n${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
