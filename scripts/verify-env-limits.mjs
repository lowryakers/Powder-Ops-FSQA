// verify:envlimits — D-201, single-spine move 03 for the temperature and
// humidity limits.
//
// The limits (humidity below 40%, temperature below 78°F) lived in
// env-limits.js and decided only whether Adam got a DM. The record the daily
// check filed said "Humidity 41." and PASS, and the Operator View kept its own
// copy of the rule — "<= 40" passed, temperature was never looked at.
// Now: one rule (shared/env-grade.js), the numbers under Document Control
// (controlled.js parks a change), the record graded and stamped with the limit
// and its document, the screen reading the limits in force.
//
// Caller sets PORT + DBPATH on a fresh database. Needs a built client. The
// control is `main` before the change: no /api/env-limits, the record files PASS.
import Database from 'better-sqlite3';
import { chromium } from 'playwright-core';

const PORT = process.env.PORT || 5121;
const URL = `http://localhost:${PORT}`;
let pass = 0, fail = 0;
const t = (n, ok, d = '') => { if (ok) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n}${d ? ' — ' + d : ''}`); } };

console.log('── the one rule ──');
const { envVerdict } = await import('../shared/env-grade.js');
const L = { humidity: { procedureLimit: 40, unit: '%', label: 'Humidity' }, temperature: { procedureLimit: 78, unit: '°F', label: 'Temperature' } };
t('humidity of exactly 40 is OUT — the procedure says below 40', envVerdict(L, { humidity: '40' })?.fail === true);
t('39.9% is in range', envVerdict(L, { humidity: '39.9' })?.fail === false);
t('a temperature of 78°F fails on its own', envVerdict(L, { temperature: '78', humidity: '30' })?.fail === true);
t('typed "41 %" reads as 41', envVerdict(L, { humidity: '41 %' })?.results[0]?.value === 41);
t('nothing typed is a gap, not a failure', envVerdict(L, {}) === null);

const db = new Database(process.env.DBPATH);
db.prepare(`INSERT OR REPLACE INTO users (id, name, username, role, department, is_active, setup_code, setup_code_expires_at)
  VALUES ('env-qa','Env QA','Env QA','admin','qa',1,'SC-ENV', datetime('now','+7 day'))`).run();
db.prepare(`INSERT OR REPLACE INTO equipment (id, name, type, status, asset_kind, loto_required)
  VALUES ('env-eq','Env Monitor','Environmental Monitoring Point','active','zone',0)`).run();
const TODAY = db.prepare("SELECT date('now') d").get().d;
const wo = (id, d = TODAY) => db.prepare(`INSERT OR REPLACE INTO work_orders (id, equipment_id, title, status, task_group, due_date, priority)
  VALUES (?, 'env-eq', 'Temp & Humidity Check — Env Room', 'open', 'qa', ?, 'normal')`).run(id, d);
['env-1', 'env-2', 'env-3', 'env-4'].forEach(id => wo(id));

const H = { 'Content-Type': 'application/json' };
const post = (p, b, h = H) => fetch(`${URL}/api${p}`, { method: 'POST', headers: h, body: JSON.stringify(b) });
await post('/users/login', { name: 'Env QA' });
await post('/users/set-password', { user_id: 'env-qa', password: 'EnvLimits2026!', setup_code: 'SC-ENV' });
const auth = await (await post('/users/login', { name: 'Env QA', password: 'EnvLimits2026!' })).json();
const A = { ...H, Authorization: `Bearer ${auth.token}` };
t('signed in', !!auth?.token);

console.log('\n── under Document Control ──');
const row = db.prepare("SELECT * FROM controlled_definitions WHERE key = 'env:temp-humidity'").get();
t('the limits are a controlled definition from first boot', !!row && row.status === 'approved', JSON.stringify(row?.status));
const snap = JSON.parse(row?.approved_snapshot || '{}');
t('…the approved baseline is 40% and 78°F on FORM 110-03', snap.humidity?.procedureLimit === 40 && snap.temperature?.procedureLimit === 78 && snap.document === 'FORM 110-03');
const lim = await (await fetch(`${URL}/api/env-limits`, { headers: A })).json();
t('GET /api/env-limits answers with the limits in force', lim?.humidity?.procedureLimit === 40 && lim?.temperature?.procedureLimit === 78 && lim?.document === 'FORM 110-03', JSON.stringify(lim).slice(0, 160));

console.log('\n── the record says what it was checked against ──');
const complete = (id, readings) => post(`/pm/work-orders/${id}/complete-and-recur`, { readings, notes: '', confirm_duplicate_readings: true, completed_by: 'Env QA' }, A);
const recFor = (id) => db.prepare('SELECT result, notes FROM sanitation_records WHERE notes LIKE ?').get(`%${id}%`);
let r = await complete('env-1', { temperature: '68', humidity: '35' });
t('an in-range check completes', r.ok, String(r.status));
let rec = recFor('env-1');
t('…and files PASS', rec?.result === 'pass', rec?.result);
t('…naming each reading, its limit and the document', /Humidity 35% in range \(limit below 40%, FORM 110-03 V2\)/.test(rec?.notes || '') && /Temperature 68°F in range \(limit below 78°F/.test(rec?.notes || ''), rec?.notes);
r = await complete('env-2', { temperature: '70', humidity: '41' });
t('an out-of-range check still completes — the work was done', r.ok, String(r.status));
rec = recFor('env-2');
t('THE RECORD FILES FAIL at 41% humidity', rec?.result === 'fail', rec?.result);
t('…saying OUT OF RANGE with the limit', /Humidity 41% OUT OF RANGE \(limit below 40%/.test(rec?.notes || ''), rec?.notes);
r = await complete('env-3', { temperature: '79', humidity: '30' });
rec = recFor('env-3');
t('a temperature of 79°F fails the record too', rec?.result === 'fail' && /Temperature 79°F OUT OF RANGE/.test(rec?.notes || ''), rec?.notes);

console.log('\n── a change is Document Control\'s, and takes effect when approved ──');
const pending = { ...snap, humidity: { ...snap.humidity, procedureLimit: 45, alertAtOrAbove: 44 }, revision: 'V3' };
db.prepare("UPDATE controlled_definitions SET pending_snapshot = ?, pending_hash = 'x', status = 'pending', pending_seen_at = datetime('now') WHERE id = ?")
  .run(JSON.stringify(pending), row.id);
const before = await (await fetch(`${URL}/api/env-limits`, { headers: A })).json();
t('while parked, the app goes on checking against 40%', before?.humidity?.procedureLimit === 40);
const ap = await post(`/controlled/${row.id}/approve`, {}, A);
t('Document Control approves', ap.ok, String(ap.status));
const after = await (await fetch(`${URL}/api/env-limits`, { headers: A })).json();
t('…and the new limit is in force at once, no restart', after?.humidity?.procedureLimit === 45 && after?.revision === 'V3', JSON.stringify(after?.humidity));
r = await complete('env-4', { temperature: '70', humidity: '42' });
rec = recFor('env-4');
t('42% now passes, and the record says it was checked against 45% on V3', rec?.result === 'pass' && /limit below 45%, FORM 110-03 V3/.test(rec?.notes || ''), rec?.notes);
t('the record filed under 40% still says 40%', /limit below 40%/.test(recFor('env-2')?.notes || ''));
// Put 40 back for the screen half.
db.prepare("UPDATE controlled_definitions SET pending_snapshot = ?, pending_hash = 'y', status = 'pending' WHERE id = ?").run(JSON.stringify(snap), row.id);
await post(`/controlled/${row.id}/approve`, {}, A);

console.log('\n── the Operator View reads the same rule ──');
wo('env-ui');
db.close();
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.on('pageerror', (e) => { console.log('  [pageerror]', e.message); fail++; });
  await page.goto(`${URL}/manifest.webmanifest`);
  await page.evaluate(([tok, u]) => { localStorage.setItem('auth_token', tok); localStorage.setItem('auth_user', JSON.stringify(u)); }, [auth.token, auth.user]);
  await page.goto(`${URL}/operator`);
  await page.getByText('Temp & Humidity Check — Env Room').first().waitFor({ timeout: 20000 }).catch(() => {});
  await page.locator('div.p-4').filter({ hasText: 'Temp & Humidity Check — Env Room' }).locator('[data-complete-task]').first()
    .click({ timeout: 10000 }).catch((e) => console.log('  [click]', e.message.split('\n')[0]));
  await page.locator('input[placeholder="e.g. 68.5"]').first().fill('70', { timeout: 10000 }).catch(() => {});
  await page.locator('input[placeholder="e.g. 35.2"]').first().fill('40').catch(() => {});
  await page.waitForTimeout(600);
  t('390px: exactly 40% reads FAIL on the phone', await page.locator('[data-env-verdict="fail"]').count() === 1);
  t('390px: …and names the limit from the server', /below 40%/.test(await page.locator('[data-env-verdict]').textContent().catch(() => '')));
  t('390px: the warning names it too', await page.locator('[data-env-warning="humidity"]').count() === 1);
  await page.locator('input[placeholder="e.g. 35.2"]').first().fill('35');
  await page.waitForTimeout(300);
  t('390px: 35% reads PASS', await page.locator('[data-env-verdict="pass"]').count() === 1);
  await page.locator('input[placeholder="e.g. 68.5"]').first().fill('80');
  await page.waitForTimeout(300);
  t('390px: 80°F reads FAIL — temperature is looked at now', await page.locator('[data-env-verdict="fail"]').count() === 1 && /Temperature must be below 78°F/.test(await page.locator('[data-env-verdict]').textContent().catch(() => '')));
  t('390px: the limits say where they come from', /FORM 110-03 V2/.test(await page.locator('[data-env-verdict]').textContent().catch(() => '')));
} finally { await browser.close(); }

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
