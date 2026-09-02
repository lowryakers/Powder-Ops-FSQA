// A BACK-DATED COMPLETION USED TO LOSE A DAY'S TASK, and nothing said so.
//
// Maria completed the daily Temp & Humidity task on the 2nd, correctly
// recording that the check was performed on the 1st. The RECORD was right —
// performed_at said the 1st, entered_late was set. But createNextWorkOrder
// scheduled from "now", so the next task fell due on the 3rd and the 2nd never
// got a task at all. Nobody could take that day's readings and nothing
// anywhere reported a gap.
//
// Executed against a live server: the rule lives in the interaction between
// resolveBackdate and createNextWorkOrder, and a pure test of either one in
// isolation would have passed with the bug present.
//
// Caller sets PORT + DBPATH. Needs a fresh database.
const PORT = process.env.PORT || 4897;
const B = `http://localhost:${PORT}/api`;
const J = async r => { try { return await r.json(); } catch { return null; } };
let token = null;
const req = (p, o = {}) => fetch(B + p, { ...o, headers: {
  'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(o.headers || {}) } });
const post = (p, b) => req(p, { method: 'POST', body: JSON.stringify(b) });

let pass = 0, fail = 0;
const t = (n, c, d = '') => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (d ? ' — ' + d : '')); } };

const { default: Database } = await import('better-sqlite3');
const day = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
const TODAY = day(0), YDAY = day(-1), TOMORROW = day(1);

const db = new Database(process.env.DBPATH);
db.prepare(`INSERT OR REPLACE INTO users (id,name,username,role,department,is_active,setup_code,setup_code_expires_at)
  VALUES ('bd-qa','Backdate QA','Backdate QA','admin','qa',1,'SC-BD',datetime('now','+7 day'))`).run();
db.prepare(`INSERT OR REPLACE INTO equipment (id,name,type,status,asset_kind,loto_required)
  VALUES ('bd-eq','BD Temp/Humidity Monitor','Environmental Monitoring Point','active','zone',0)`).run();
// The daily one carries a title recordAreaForTask() recognises, so completing
// it files a real sanitation record — otherwise the record assertion below
// would match nothing and pass for the wrong reason.
const TITLES = { 'bd-daily': 'Temp & Humidity Check — Production 1' };
const titleOf = (id) => TITLES[id] || `BD Check ${id}`;
const sched = (id, freq) => db.prepare(`INSERT OR REPLACE INTO pm_schedules
  (id,equipment_id,title,frequency_type,frequency_value,task_group,is_active)
  VALUES (?, 'bd-eq', ?, ?, 1, 'qa', 1)`).run(id, titleOf(id), freq);
const wo = (id, schedId, due) => db.prepare(`INSERT OR REPLACE INTO work_orders
  (id,pm_schedule_id,equipment_id,title,status,task_group,due_date)
  VALUES (?, ?, 'bd-eq', ?, 'open', 'qa', ?)`).run(id, schedId, titleOf(schedId), due);

sched('bd-daily', 'daily');   wo('bd-wo-1', 'bd-daily', TODAY);
sched('bd-plain', 'daily');   wo('bd-wo-2', 'bd-plain', TODAY);
sched('bd-dup', 'daily');     wo('bd-wo-3', 'bd-dup', TODAY);
sched('bd-week', 'weekly');   wo('bd-wo-4', 'bd-week', TODAY);
db.close();

await post('/users/login', { name: 'Backdate QA' });
await post('/users/set-password', { user_id: 'bd-qa', password: 'BackdatePW2026', setup_code: 'SC-BD' });
token = (await J(await post('/users/login', { name: 'Backdate QA', password: 'BackdatePW2026' })))?.token;
t('QA signed in', !!token);

const liveFor = (schedId, due) => {
  const d = new Database(process.env.DBPATH, { readonly: true });
  const rows = d.prepare(`SELECT id, due_date, status FROM work_orders
    WHERE pm_schedule_id = ? AND due_date = ? AND status IN ('open','in_progress','missed','overdue')`).all(schedId, due);
  d.close();
  return rows;
};

console.log('\nThe reported failure: the day the check was FOR still needs a task');
{
  const r = await post('/pm/work-orders/bd-wo-1/complete-and-recur', {
    readings: { temperature: '68', humidity: '35' }, notes: '',
    performed_on: YDAY, late_entry_reason: 'entered the next morning' });
  const b = await J(r);
  t('the back-dated completion is accepted', r.ok, `got ${r.status}`);
  const d = new Database(process.env.DBPATH, { readonly: true });
  const rec = d.prepare("SELECT performed_at, entered_late FROM sanitation_records WHERE notes LIKE '%bd-wo-1%'").get();
  d.close();
  t('the record is dated the day it was PERFORMED, and marked late',
    String(rec?.performed_at || '').slice(0, 10) === YDAY && rec?.entered_late === 1,
    `performed_at=${rec?.performed_at} late=${rec?.entered_late}`);
  t('THE NEXT TASK IS DUE TODAY, not tomorrow', b?.next_work_order?.due_date === TODAY,
    `got ${b?.next_work_order?.due_date}`);
  t('so the floor has a task for today', liveFor('bd-daily', TODAY).length === 1,
    `${liveFor('bd-daily', TODAY).length} tasks`);
  t('and nothing was scheduled for tomorrow instead', liveFor('bd-daily', TOMORROW).length === 0);
}

console.log('\nAn ordinary completion is completely unchanged');
{
  const r = await post('/pm/work-orders/bd-wo-2/complete-and-recur', {
    readings: { temperature: '70', humidity: '40' }, notes: '' });
  const b = await J(r);
  t('next task is due tomorrow, as before', b?.next_work_order?.due_date === TOMORROW,
    `got ${b?.next_work_order?.due_date}`);
  t('nothing extra was raised for today', liveFor('bd-plain', TODAY).length === 0);
}

console.log('\nWeekly schedules advance a week from the performed day');
{
  const r = await post('/pm/work-orders/bd-wo-4/complete-and-recur', {
    readings: { temperature: '66' }, notes: '', performed_on: YDAY, late_entry_reason: 'late' });
  const b = await J(r);
  t('a weekly check done yesterday is next due 6 days out, not 7', b?.next_work_order?.due_date === day(6),
    `got ${b?.next_work_order?.due_date} want ${day(6)}`);
}

console.log('\nNever two live tasks for one schedule on one day');
{
  // A task already sitting on the date the next one would land.
  const d = new Database(process.env.DBPATH);
  d.prepare(`INSERT OR REPLACE INTO work_orders (id,pm_schedule_id,equipment_id,title,status,task_group,due_date)
    VALUES ('bd-wo-3b','bd-dup','bd-eq','BD Check bd-dup','open','qa',?)`).run(TODAY);
  d.close();
  const r = await post('/pm/work-orders/bd-wo-3/complete-and-recur', {
    readings: { temperature: '71' }, notes: '', performed_on: YDAY, late_entry_reason: 'late' });
  const b = await J(r);
  t('the existing task is returned rather than a second one created', b?.next_work_order?.existing === true);
  t('exactly one live task for that day', liveFor('bd-dup', TODAY).length === 1,
    `${liveFor('bd-dup', TODAY).length} tasks`);
}

console.log(`\n${pass}/${pass + fail} assertions passed`);
process.exit(fail ? 1 : 0);
