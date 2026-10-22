// D-196 / OBL-24 (platform half): the annual mock recall raises its own task,
// and signing the exercise off closes it.
//
// SOP 415 V3 asks for a mock recall at least once a year. Until this the
// cadence was REPORTED on the Mock Recall screen and raised nothing — a date
// nothing watches. Now an annual quality schedule raises the task; the task
// cannot be ticked closed (a tick is not a drill); the exercise's sign-off
// closes it as of the day it was run and pulls the next one a year out.
//
// Caller sets PORT + DBPATH on a FRESH database.
import crypto from 'crypto';
const PORT = process.env.PORT || 5118;
const URL = `http://localhost:${PORT}`;
let pass = 0, fail = 0;
const t = (n, c, d = '') => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (d ? ' — ' + d : '')); } };

const { checkKindFor, missingForCheck } = await import('../shared/check-forms.js');
const { DOCUMENTED_ITEMS } = await import('../server/mock-recall-form.js');

t('the seeded title resolves to the mock_recall kind',
  checkKindFor({ title: 'Annual Mock Recall (SOP 415)', module_id: 'Mock Recall' }) === 'mock_recall');
t('the task can never be satisfied from the card, whatever it is sent',
  missingForCheck({ kind: 'mock_recall' }, { anything: 'yes', mock_recall_id: 'x' }).length === 1);
t('an ordinary schedule is untouched', checkKindFor({ title: 'Daily Scale PM' }) === null);

const { default: Database } = await import('better-sqlite3');
{
  const db = new Database(process.env.DBPATH);
  db.prepare(`INSERT OR REPLACE INTO users (id, name, username, role, department, is_active, module_access, setup_code, setup_code_expires_at)
    VALUES ('mr-a','Recall Admin','Recall Admin','admin','quality',1,'{"recall":"edit","quality-schedules":"edit","pm":"edit","operator":"edit"}','SC-MR', datetime('now','+7 day'))`).run();
  db.close();
}
const H = { 'Content-Type': 'application/json' };
const post = (p, body, headers = H) => fetch(`${URL}/api${p}`, { method: 'POST', headers, body: JSON.stringify(body) });
const put = (p, body, headers) => fetch(`${URL}/api${p}`, { method: 'PUT', headers, body: JSON.stringify(body) });
const get = async (p, headers) => (await fetch(`${URL}/api${p}`, { headers })).json();
await post('/users/login', { name: 'Recall Admin' });
await post('/users/set-password', { user_id: 'mr-a', password: 'Recall2026!', setup_code: 'SC-MR' });
const auth = await (await post('/users/login', { name: 'Recall Admin', password: 'Recall2026!' })).json();
const A = { ...H, Authorization: `Bearer ${auth.token}` };
t('signed in', !!auth?.token);

// ── The schedule ships seeded, annual, and due today on a fresh database ─────
const scheds = await get('/quality-schedules', A);
const sch = (scheds || []).find(s => /Annual Mock Recall/i.test(s.title));
t('the annual mock recall schedule ships seeded', !!sch, (scheds || []).map(s => s.title).join(' | ').slice(0, 200));
t('it is annual', sch?.frequency_type === 'annual', sch?.frequency_type);

const dbx = new Database(process.env.DBPATH);
const today = dbx.prepare("SELECT date('now') d").get().d;

// The generator raises it (housekeeping runs on the task list read).
await get('/pm/operator-tasks', A);
await post('/pm/generate', {}, A);
let wo = dbx.prepare(`SELECT * FROM work_orders WHERE quality_schedule_id = ? AND status IN ('open','overdue','missed','in_progress')`).get(sch?.id);
if (!wo) {
  // Housekeeping is throttled; raise it exactly as the generator does.
  const id = crypto.randomUUID();
  dbx.prepare(`INSERT INTO work_orders (id, title, description, priority, due_date, procedure_steps, task_group, quality_schedule_id, status)
    VALUES (?, ?, 'Scheduled quality check.', 'normal', ?, '[]', 'qa', ?, 'open')`).run(id, sch.title, today, sch.id);
  wo = dbx.prepare('SELECT * FROM work_orders WHERE id = ?').get(id);
}
t('the annual task is raised', !!wo, 'no open task');
t('with no exercise on file it is due today — the honest state', wo?.due_date <= today, `${wo?.due_date} vs ${today}`);

// The task list carries the form, so the card can say where to go.
const search = await get(`/pm/search?q=${encodeURIComponent('Annual Mock Recall')}`, A);
const listed = (Array.isArray(search) ? search : search?.rows || []).find(r => r.id === wo?.id);
t('the task card carries check_form kind mock_recall', listed?.check_form?.kind === 'mock_recall', JSON.stringify(listed?.check_form));
t('… pointing at the Mock Recall module', listed?.check_form?.recorded_in === 'recall');

// ── A tick cannot close it ───────────────────────────────────────────────────
const tick = await post(`/pm/work-orders/${wo.id}/complete-and-recur`, { completed_by: 'Recall Admin', notes: 'done' }, A);
const tickBody = await tick.json().catch(() => ({}));
t('completing the task by hand is REFUSED (400 requires_check)', tick.status === 400 && tickBody.requires_check === true, `${tick.status} ${JSON.stringify(tickBody).slice(0, 160)}`);
t('… and the task is still open', dbx.prepare('SELECT status FROM work_orders WHERE id = ?').get(wo.id).status !== 'completed');
const batch = await (await post('/pm/work-orders/batch-complete', { ids: [wo.id], completed_by: 'Recall Admin' }, A)).json();
t('batch-complete skips it with a reason', (batch.skipped || []).some(s => s.id === wo.id), JSON.stringify(batch).slice(0, 200));

// ── The exercise, run four days ago and signed today ─────────────────────────
const ranOn = dbx.prepare("SELECT date('now','-4 days') d").get().d;
const created = await (await post('/mock-recalls', { product_name: 'Whey Blueberry Muffin Stick', lot_number: 'LOT-MR-1', reason: 'Annual exercise', date_initiated: ranOn }, A)).json();
t('an exercise is started', !!created?.id, JSON.stringify(created).slice(0, 160));
const fill = Object.fromEntries(DOCUMENTED_ITEMS.map(f => [f.key, created[f.key] || 'Recorded']));
await put(`/mock-recalls/${created.id}`, {
  ...fill, date_initiated: ranOn, mass_balance_pct: 100,
  started_at: `${ranOn}T14:00:00.000Z`, ended_at: `${ranOn}T16:30:00.000Z`,
  summary_report_complete: true, form_415_1_checked: true, tracking_procedure: 'distributed',
}, A);
const signRes = await post(`/mock-recalls/${created.id}/approve`, {}, A);
const signed = await signRes.json();
t('the exercise signs off', signRes.status === 200 && signed.approved_at, `${signRes.status} ${JSON.stringify(signed).slice(0, 200)}`);
t('the sign-off reports the task it closed', (signed.schedule?.closed || []).includes(wo.id), JSON.stringify(signed.schedule));

const after = dbx.prepare('SELECT * FROM work_orders WHERE id = ?').get(wo.id);
t('THE SIGN-OFF CLOSED THE ANNUAL TASK', after.status === 'completed', after.status);
t('… dated the day the exercise was run, not today', String(after.completed_at).startsWith(ranOn), after.completed_at);
t('… by the person who signed', after.completed_by === 'Recall Admin', after.completed_by);
t('… with a note naming the exercise', new RegExp(created.recall_number).test(after.notes || ''), after.notes);
const rec = dbx.prepare('SELECT quality_schedule_id, work_order_id FROM mock_recalls WHERE id = ?').get(created.id);
t('the exercise is linked to the schedule and the task', rec.quality_schedule_id === sch.id && rec.work_order_id === wo.id, JSON.stringify(rec));
const nd = dbx.prepare('SELECT next_due FROM quality_schedules WHERE id = ?').get(sch.id).next_due;
const anniversary = dbx.prepare("SELECT date(?, '+1 year') d").get(ranOn).d;
t('next due is the anniversary of the exercise', nd === anniversary, `${nd} vs ${anniversary}`);
const audit = dbx.prepare(`SELECT details FROM audit_log WHERE entity_type = 'work_order' AND entity_id = ? ORDER BY rowid DESC LIMIT 1`).get(wo.id);
t('the task closure is audited with the exercise as its source', /mock_recall/.test(audit?.details || ''), audit?.details);

// ── An old exercise links but leaves the task open (one is still owed) ───────
const id2 = crypto.randomUUID();
dbx.prepare(`INSERT INTO work_orders (id, title, description, priority, due_date, procedure_steps, task_group, quality_schedule_id, status)
  VALUES (?, ?, 'Scheduled quality check.', 'normal', ?, '[]', 'qa', ?, 'open')`).run(id2, sch.title, today, sch.id);
const oldDay = dbx.prepare("SELECT date('now','-400 days') d").get().d;
const old = await (await post('/mock-recalls', { product_name: 'Old Exercise', lot_number: 'LOT-OLD', reason: 'Back-filed', date_initiated: oldDay }, A)).json();
await put(`/mock-recalls/${old.id}`, {
  ...Object.fromEntries(DOCUMENTED_ITEMS.map(f => [f.key, old[f.key] || 'Recorded'])), date_initiated: oldDay, mass_balance_pct: 100,
  started_at: `${oldDay}T14:00:00.000Z`, ended_at: `${oldDay}T15:00:00.000Z`, summary_report_complete: true, form_415_1_checked: true,
}, A);
await post(`/mock-recalls/${old.id}/approve`, {}, A);
t('an exercise run over a year ago does NOT close this year\'s task',
  dbx.prepare('SELECT status FROM work_orders WHERE id = ?').get(id2).status === 'open');
t('… and does not push next due back', dbx.prepare('SELECT next_due FROM quality_schedules WHERE id = ?').get(sch.id).next_due === anniversary);

// ── A redeploy does not re-seed or move the schedule ─────────────────────────
const { seedQualitySchedules } = await import('../server/api/quality-schedules.js');
const before = dbx.prepare('SELECT COUNT(*) c FROM quality_schedules WHERE title LIKE ?').get('%Mock Recall%').c;
seedQualitySchedules(dbx);
t('re-seeding adds no second schedule', dbx.prepare('SELECT COUNT(*) c FROM quality_schedules WHERE title LIKE ?').get('%Mock Recall%').c === before);

// First due on a database that already has a signed exercise: its anniversary.
const db2path = `${process.env.DBPATH}.seed2`;
(await import('fs')).rmSync(db2path, { force: true });
{
  const db2 = new Database(db2path);
  db2.exec(`CREATE TABLE quality_schedules (id TEXT, title TEXT, description TEXT, module_id TEXT, frequency_type TEXT, frequency_value INTEGER, procedure_steps TEXT, next_due TEXT, is_active INTEGER);
    CREATE TABLE mock_recalls (id TEXT, date_initiated TEXT, approved_at TEXT);`);
  const recent = db2.prepare("SELECT date('now','-60 days') d").get().d;
  db2.prepare("INSERT INTO mock_recalls VALUES ('x', ?, datetime('now'))").run(recent);
  seedQualitySchedules(db2);
  const s2 = db2.prepare("SELECT next_due FROM quality_schedules WHERE title LIKE '%Mock Recall%'").get();
  const want = db2.prepare("SELECT date(?, '+1 year') d").get(recent).d;
  t('a plant that ran one 60 days ago is first due on its anniversary, not today', s2?.next_due === want, `${s2?.next_due} vs ${want}`);
  db2.close();
}
dbx.close();

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
