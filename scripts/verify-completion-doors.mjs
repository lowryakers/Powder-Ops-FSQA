// Completing a task has ONE door — executed against a live server.
//
// PUT /pm/work-orders/:id with status: 'completed' used to close the task and
// file nothing: no controlled record, no back-date rule, no step gate, no ATP
// grade, no recurrence. It refuses now and names the route that does it.
//
// Caller sets PORT + DBPATH. Needs a fresh database.
const PORT = process.env.PORT || 4914;
const B = `http://localhost:${PORT}/api`;
const J = async r => { try { return await r.json(); } catch { return null; } };
let token = null;
const req = (p, o = {}) => fetch(B + p, { ...o, headers: {
  'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(o.headers || {}) } });
const post = (p, b) => req(p, { method: 'POST', body: JSON.stringify(b) });
const put = (p, b) => req(p, { method: 'PUT', body: JSON.stringify(b) });
let pass = 0, fail = 0;
const t = (n, c, d = '') => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (d ? ' — ' + d : '')); } };
const { default: Database } = await import('better-sqlite3');

const db = new Database(process.env.DBPATH);
db.prepare(`INSERT OR REPLACE INTO users (id,name,username,role,department,is_active,setup_code,setup_code_expires_at)
  VALUES ('cd-qa','Door QA','Door QA','admin','qa',1,'SC-CD',datetime('now','+7 day'))`).run();
db.prepare(`INSERT OR REPLACE INTO equipment (id,name,type,status,asset_kind,loto_required,is_food_contact)
  VALUES ('cd-eq','Door Monitor','Environmental Monitoring Point','active','zone',0,0)`).run();
db.prepare(`INSERT OR REPLACE INTO pm_schedules (id,equipment_id,title,frequency_type,frequency_value,task_group,is_active)
  VALUES ('cd-sch','cd-eq','Temp & Humidity Check — Production 1','daily',1,'qa',1)`).run();
['cd-1','cd-2','cd-3'].forEach(id => db.prepare(`INSERT OR REPLACE INTO work_orders (id,pm_schedule_id,equipment_id,title,status,task_group,due_date)
  VALUES (?, 'cd-sch','cd-eq','Temp & Humidity Check — Production 1','open','qa', date('now'))`).run(id));
db.close();
await post('/users/login', { name: 'Door QA' });
await post('/users/set-password', { user_id: 'cd-qa', password: 'DoorPW2026!', setup_code: 'SC-CD' });
token = (await J(await post('/users/login', { name: 'Door QA', password: 'DoorPW2026!' })))?.token;
t('signed in', !!token);
const state = (id) => { const d = new Database(process.env.DBPATH, { readonly: true });
  const w = d.prepare('SELECT status, completed_at FROM work_orders WHERE id = ?').get(id);
  const n = d.prepare("SELECT COUNT(*) c FROM sanitation_records WHERE notes LIKE ?").get(`%Filed from task ${id}%`).c;
  d.close(); return { ...w, records: n }; };

console.log('\nThe edit route refuses to complete');
{
  const r = await put('/pm/work-orders/cd-1', { status: 'completed' });
  const b = await J(r);
  t('PUT status=completed is refused', r.status === 400, `got ${r.status}`);
  t('and names the door that does it', b?.use === 'complete-and-recur' && /complete-and-recur/.test(b?.error || ''));
  const s = state('cd-1');
  t('THE TASK IS STILL OPEN', s.status === 'open', `status=${s.status}`);
  t('and no record was filed for it', s.records === 0);
  const na = await put('/pm/work-orders/cd-1', { status: 'not_applicable' });
  t('PUT status=not_applicable is refused too', na.status === 400, `got ${na.status}`);
}

console.log('\nThe edit route still does what it is for');
{
  const r = await put('/pm/work-orders/cd-2', { status: 'in_progress' });
  t('Start (open -> in_progress) works', r.ok && (await J(r))?.status === 'in_progress', `got ${r.status}`);
  const r2 = await put('/pm/work-orders/cd-2', { notes: 'a note', priority: 'high' });
  const b2 = await J(r2);
  t('editing notes and priority works', r2.ok && b2?.notes === 'a note' && b2?.priority === 'high');
  const r3 = await put('/pm/work-orders/cd-2', { status: 'in_progress', notes: 'same status again' });
  t('re-sending the current status is not a change and is accepted', r3.ok, `got ${r3.status}`);
}

console.log('\nThe one door still files');
{
  const r = await post('/pm/work-orders/cd-3/complete-and-recur', { readings: { temperature: '68', humidity: '35' }, notes: '' });
  t('complete-and-recur completes', r.ok, `got ${r.status}`);
  const s = state('cd-3');
  t('the task is completed', s.status === 'completed');
  t('AND ITS RECORD WAS FILED', s.records === 1, `${s.records} records`);
}

console.log(`\n${pass}/${pass + fail} assertions passed`);
process.exit(fail ? 1 : 0);
