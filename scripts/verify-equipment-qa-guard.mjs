// verify:eqqaguard — D-260. Setting equipment out of service stops the QA checks raised on it, so the
// save is refused until the person confirms, the refusal names each check, and QA is told.
//
// Live on 27 Oct: the three Temp/Humidity monitors were set out of service while the Equipment list
// was being tidied; QA's daily Temp & Humidity tasks vanished and nobody on QA was told.
//
// Caller sets PORT + DBPATH (the runner boots the server).
// Control: remove the two qaChecksStoppedBy guards from api/equipment.js — the first refusal fails.
import Database from 'better-sqlite3';
import { chromium } from 'playwright-core';

const PORT = Number(process.env.PORT || 5155);
const URL = `http://localhost:${PORT}`;
const DBP = process.env.DBPATH || process.env.DB_PATH;
let pass = 0, fail = 0;
const t = (n, ok, d = '') => { if (ok) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n}${d ? ' — ' + d : ''}`); } };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const one = (sql, ...a) => { const d = new Database(DBP, { readonly: true }); try { return d.prepare(sql).get(...a); } finally { d.close(); } };

const db = new Database(DBP);
const mk = (id, name, role, dept) => db.prepare(`INSERT OR REPLACE INTO users
  (id,name,username,role,department,is_active,setup_code,setup_code_expires_at,module_access)
  VALUES (?,?,?,?,?,1,?,datetime('now','+7 day'),NULL)`).run(id, name, name, role, dept, `SC-${id}`);
mk('qg-admin', 'Gale Admin', 'admin', 'admin');
mk('qg-qa', 'Quinn Quality', 'supervisor', 'qa');
const eq = (id, name, asset, team, kind) => db.prepare(`INSERT OR REPLACE INTO equipment
  (id, name, type, room, asset_id, status, task_group, asset_kind) VALUES (?, ?, 'Monitoring', 'Fixture', ?, 'active', ?, ?)`).run(id, name, asset, team, kind);
const sched = (id, eqId, title, team) => db.prepare(`INSERT OR REPLACE INTO pm_schedules
  (id, equipment_id, title, frequency_type, frequency_value, procedure_steps, task_group, is_active)
  VALUES (?, ?, ?, 'daily', 1, '[]', ?, 1)`).run(id, eqId, title, team);
const card = (id, schedId, eqId, title, team) => db.prepare(`INSERT OR REPLACE INTO work_orders
  (id, pm_schedule_id, equipment_id, title, due_date, task_group, status) VALUES (?, ?, ?, ?, date('now'), ?, 'open')`).run(id, schedId, eqId, title, team);
eq('qg-mon1', 'Fixture Room 1 Temp/Humidity Monitor', 'QG-TH-1', 'qa', 'zone');
eq('qg-mon2', 'Fixture Room 2 Temp/Humidity Monitor', 'QG-TH-2', 'qa', 'zone');
eq('qg-mon3', 'Fixture Room 3 Temp/Humidity Monitor', 'QG-TH-3', 'qa', 'zone');
eq('qg-fan', 'Fixture Wall Fan', 'QG-FAN', 'maintenance', 'machine');
for (const n of [1, 2, 3]) {
  sched(`qg-th${n}`, `qg-mon${n}`, `Temp & Humidity Check — Fixture Room ${n}`, 'qa');
  card(`qg-card${n}`, `qg-th${n}`, `qg-mon${n}`, `Temp & Humidity Check — Fixture Room ${n}`, 'qa');
}
sched('qg-fan-pm', 'qg-fan', 'Weekly PM — Fixture Wall Fan', 'maintenance');
db.close();

const H = { 'Content-Type': 'application/json' };
const call = (m, p, b, tok) => fetch(`${URL}/api${p}`, { method: m, headers: { ...H, ...(tok && { Authorization: `Bearer ${tok}` }) }, body: b ? JSON.stringify(b) : undefined });
const signIn = async (name, id) => {
  await call('POST', '/users/login', { name });
  await call('POST', '/users/set-password', { user_id: id, password: 'Guard2026!!', setup_code: `SC-${id}` });
  return (await call('POST', '/users/login', { name, password: 'Guard2026!!' })).json();
};
const admin = await signIn('Gale Admin', 'qg-admin');
const qa = await signIn('Quinn Quality', 'qg-qa');
t('sessions', !!admin.token && !!qa.token);
const status = (id) => one('SELECT status FROM equipment WHERE id = ?', id)?.status;
const cardStatus = (id) => one('SELECT status FROM work_orders WHERE id = ?', id)?.status;
const dmCount = () => one(`SELECT COUNT(*) n FROM chat_messages m JOIN chat_channel_members cm ON cm.channel_id = m.channel_id AND cm.user_id = 'qg-qa'
  JOIN users u ON u.id = m.user_id WHERE u.name = 'ReadyBot' AND m.body LIKE '%QA checks stopped%'`).n;

console.log('\n── one monitor, edited on its own ──');
let r = await call('PUT', '/equipment/qg-mon1', { status: 'out_of_service' }, admin.token);
let body = await r.json();
t('setting a monitor out of service is refused until confirmed (409)', r.status === 409 && body.code === 'stops_qa_checks', `${r.status} ${JSON.stringify(body).slice(0, 120)}`);
t('…the refusal names the check that would stop', body.checks?.some(c => c.title === 'Temp & Humidity Check — Fixture Room 1') && /Temp & Humidity Check — Fixture Room 1/.test(body.error || ''));
t('…and nothing changed: still active, its task still open', status('qg-mon1') === 'active' && cardStatus('qg-card1') === 'open');
const before = dmCount();
r = await call('PUT', '/equipment/qg-mon1', { status: 'out_of_service', confirm_stop_checks: true }, admin.token);
t('confirmed: it saves', r.ok, String(r.status));
t('…it is out of service and its open task closed', status('qg-mon1') === 'out_of_service' && cardStatus('qg-card1') === 'cancelled');
let audit = one(`SELECT details FROM audit_log WHERE entity_type = 'equipment' AND entity_id = 'qg-mon1' ORDER BY rowid DESC LIMIT 1`);
t('…the audit entry names the check that stopped', /Temp & Humidity Check — Fixture Room 1/.test(audit?.details || ''), audit?.details);
let told = false; for (let i = 0; i < 20 && !told; i++) { await wait(150); told = dmCount() > before; }
t('…and QA is told by ReadyBot', told);
r = await call('PUT', '/equipment/qg-mon1', { notes: 'awaiting a new probe' }, admin.token);
t('an edit to equipment already out of service is not asked again', r.ok, String(r.status));
r = await call('PUT', '/equipment/qg-mon1', { status: 'active' }, admin.token);
t('setting it back to active is never asked', r.ok && status('qg-mon1') === 'active', String(r.status));

console.log('\n── bulk edit, the way it happened ──');
r = await call('POST', '/equipment/bulk-update', { ids: ['qg-mon2', 'qg-mon3', 'qg-fan'], changes: { status: 'out_of_service' } }, admin.token);
body = await r.json();
t('bulk out of service on three monitors and a fan is refused (409)', r.status === 409 && body.code === 'stops_qa_checks', String(r.status));
t('…naming both monitors\' checks and not the fan', body.checks?.length === 2 && body.checks.every(c => /Temp & Humidity/.test(c.title)));
t('…and nothing in the batch changed', ['qg-mon2', 'qg-mon3', 'qg-fan'].every(id => status(id) === 'active') && cardStatus('qg-card2') === 'open');
r = await call('POST', '/equipment/bulk-update', { ids: ['qg-fan'], changes: { status: 'out_of_service' } }, admin.token);
t('a machine with no QA check is not asked', r.ok && status('qg-fan') === 'out_of_service', String(r.status));
r = await call('POST', '/equipment/bulk-update', { ids: ['qg-mon2'], changes: { notes: 'checked' } }, admin.token);
t('a bulk edit that does not touch status is not asked', r.ok, String(r.status));

console.log('\n── who is told is on Settings → ReadyBot messages ──');
const aud = await (await call('GET', '/flash/readybot-audience', null, admin.token)).json();
const row = (aud.audiences || aud).find?.(a => a.key === 'equipment_qa_stop');
t('the "QA checks stopped" audience is listed, defaulting to QA supervisors', !!row && row.recipients?.some(p => (p.name || p) === 'Quinn Quality'), JSON.stringify(row || {}).slice(0, 160));

console.log('\n── the Equipment screen asks, in those words ──');
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
await page.goto(`${URL}/manifest.webmanifest`);
await page.evaluate(([tok, u]) => { localStorage.setItem('auth_token', tok); localStorage.setItem('auth_user', JSON.stringify(u)); }, [admin.token, admin.user]);
await page.goto(`${URL}/?tab=equipment`);
await page.getByPlaceholder(/Search name, asset ID/).fill('Fixture Room 2').catch(() => {});
const rowEl = page.locator('tr', { hasText: 'Fixture Room 2 Temp/Humidity Monitor' }).first();
await rowEl.waitFor({ timeout: 20000 }).catch(() => {});
await rowEl.locator('td').last().locator('button').first().click().catch(() => {});
await page.locator('[data-eq-status]').waitFor({ timeout: 10000 }).catch(() => {});
await page.locator('[data-eq-status]').selectOption('out_of_service').catch(() => {});
let asked = '';
page.once('dialog', async (d) => { asked = d.message(); await d.dismiss(); });
await page.locator('form button[type=submit]').first().click().catch(() => {});
for (let i = 0; i < 30 && !asked; i++) await wait(100);
t('Update asks before stopping the check, naming it', /Temp & Humidity Check — Fixture Room 2/.test(asked) && /really out of use/.test(asked), asked.slice(0, 120));
await wait(400);
t('…saying no changes nothing and leaves the form open', status('qg-mon2') === 'active' && await page.locator('[data-eq-status]').count() === 1);
page.once('dialog', async (d) => { await d.accept(); });
await page.locator('form button[type=submit]').first().click().catch(() => {});
let done = false; for (let i = 0; i < 40 && !done; i++) { await wait(150); done = status('qg-mon2') === 'out_of_service'; }
t('…saying yes saves it', done);
await browser.close();

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
