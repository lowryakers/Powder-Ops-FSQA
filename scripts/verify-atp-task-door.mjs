// PC #1's critical limit, on the TASK door — executed against a live server.
//
// The Operator View captures an ATP reading on Production Line Pre-Op and
// changeover cleans, and until now the record filed from that completion
// carried no reading, no limit and no grade: a 200 RLU swab filed as a pass.
// POST /sanitation graded; this door did not. Every assertion below goes
// through the real completion endpoint and reads the real sanitation record.
//
// Caller sets PORT + DBPATH. Needs a fresh database.
const PORT = process.env.PORT || 4907;
const B = `http://localhost:${PORT}/api`;
const J = async r => { try { return await r.json(); } catch { return null; } };
let token = null;
const req = (p, o = {}) => fetch(B + p, { ...o, headers: {
  'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(o.headers || {}) } });
const post = (p, b) => req(p, { method: 'POST', body: JSON.stringify(b) });

let pass = 0, fail = 0;
const t = (n, c, d = '') => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (d ? ' — ' + d : '')); } };

const { default: Database } = await import('better-sqlite3');
const { ATP_LIMIT } = await import('../server/atp-limits.js');
const LIMIT = ATP_LIMIT.max;

const db = new Database(process.env.DBPATH);
db.prepare(`INSERT OR REPLACE INTO users (id,name,username,role,department,is_active,setup_code,setup_code_expires_at)
  VALUES ('atp-op','Atp Cleaner','Atp Cleaner','admin','cleaning',1,'SC-ATP',datetime('now','+7 day'))`).run();
db.prepare(`INSERT OR REPLACE INTO equipment (id,name,type,status,asset_kind,loto_required,is_food_contact)
  VALUES ('atp-eq','Production Line 7','Production Line','active','zone',0,0)`).run();
// The title is what recordAreaForTask() maps to the `Production` area.
db.prepare(`INSERT OR REPLACE INTO pm_schedules (id,equipment_id,title,frequency_type,frequency_value,task_group,is_active)
  VALUES ('atp-sch','atp-eq','Production Line Pre-Op Clean — Room 7','daily',1,'cleaning',1)`).run();
const wo = (id) => db.prepare(`INSERT OR REPLACE INTO work_orders (id,pm_schedule_id,equipment_id,title,status,task_group,due_date)
  VALUES (?, 'atp-sch','atp-eq','Production Line Pre-Op Clean — Room 7','open','cleaning', date('now'))`).run(id);
['atp-1','atp-2','atp-3','atp-4','atp-5'].forEach(wo);
db.close();

await post('/users/login', { name: 'Atp Cleaner' });
await post('/users/set-password', { user_id: 'atp-op', password: 'AtpPW2026!', setup_code: 'SC-ATP' });
token = (await J(await post('/users/login', { name: 'Atp Cleaner', password: 'AtpPW2026!' })))?.token;
t('signed in', !!token);

const record = (woId) => {
  const d = new Database(process.env.DBPATH, { readonly: true });
  const r = d.prepare("SELECT * FROM sanitation_records WHERE notes LIKE ? ORDER BY rowid DESC LIMIT 1").get(`%Filed from task ${woId}%`);
  d.close(); return r;
};
const complete = (id, body) => post(`/pm/work-orders/${id}/complete-and-recur`, body);

console.log(`\nAn over-limit swab (${LIMIT + 165} RLU) filed as a visual PASS`);
{
  const r = await complete('atp-1', { readings: { atp_reading: String(LIMIT + 165) }, reading_result: 'pass', notes: '' });
  const b = await J(r);
  t('the completion is accepted', r.ok, `got ${r.status}`);
  const rec = record('atp-1');
  t('a record was filed', !!rec);
  t('THE READING IS ON THE RECORD', String(rec?.atp_reading) === String(LIMIT + 165), `atp_reading=${rec?.atp_reading}`);
  t('THE LIMIT TRAVELS WITH IT', Number(rec?.atp_limit) === Number(LIMIT), `atp_limit=${rec?.atp_limit}`);
  t('THE RESULT IS FAIL, whatever the operator chose', rec?.result === 'fail', `result=${rec?.result}`);
  t('the first failure asks for a re-swab, not a re-clean', b?.atp_stage === 'reswab', `stage=${b?.atp_stage}`);
  t('no re-clean task from ONE failure', !b?.reclean_work_order_id);
}

console.log('\nA second consecutive failure raises the re-clean');
{
  const r = await complete('atp-2', { readings: { atp_reading: String(LIMIT + 40) }, reading_result: 'pass', notes: '' });
  const b = await J(r);
  t('accepted', r.ok);
  t('escalates', b?.atp_stage === 'escalate', `stage=${b?.atp_stage}`);
  t('a re-clean work order is raised', !!b?.reclean_work_order_id, JSON.stringify(b || {}).slice(0, 100));
  if (b?.reclean_work_order_id) {
    const d = new Database(process.env.DBPATH, { readonly: true });
    const rw = d.prepare('SELECT title, status FROM work_orders WHERE id = ?').get(b.reclean_work_order_id);
    d.close();
    t('...that names the failed swabs', /ATP|swab/i.test(rw?.title || ''), rw?.title);
  }
}

console.log('\nA passing graded reading resets the chain and files as pass');
{
  const r = await complete('atp-3', { readings: { atp_reading: '12' }, reading_result: 'pass', notes: '' });
  const rec = record('atp-3');
  t('accepted', r.ok);
  t('pass stays pass', rec?.result === 'pass', `result=${rec?.result}`);
  t('reading and limit stored', String(rec?.atp_reading) === '12' && Number(rec?.atp_limit) === Number(LIMIT));
  const r2 = await complete('atp-4', { readings: { atp_reading: String(LIMIT + 5) }, reading_result: 'pass', notes: '' });
  const b2 = await J(r2);
  t('the next failure is a FIRST failure again — no re-clean', b2?.atp_stage !== 'escalate' && !b2?.reclean_work_order_id, `stage=${b2?.atp_stage}`);
}

console.log('\nAn in-limit reading never upgrades a chosen FAIL');
{
  const d = new Database(process.env.DBPATH); d.prepare(`INSERT OR REPLACE INTO work_orders (id,pm_schedule_id,equipment_id,title,status,task_group,due_date)
    VALUES ('atp-6','atp-sch','atp-eq','Production Line Pre-Op Clean — Room 7','open','cleaning', date('now'))`).run(); d.close();
  await complete('atp-6', { readings: { atp_reading: '5' }, reading_result: 'fail', notes: 'residue seen' });
  const rec = record('atp-6');
  t('fail stays fail — a clean has reasons to fail that no swab sees', rec?.result === 'fail', `result=${rec?.result}`);
}

console.log('\nA missing reading is a gap, not a failure');
{
  const r = await complete('atp-5', { readings: {}, reading_result: 'pass', notes: '' });
  const rec = record('atp-5');
  t('accepted', r.ok);
  t('result exactly as filed', rec?.result === 'pass');
  t('no reading, no limit — nothing invented', rec?.atp_reading == null && rec?.atp_limit == null, `reading=${rec?.atp_reading} limit=${rec?.atp_limit}`);
}

console.log(`\n${pass}/${pass + fail} assertions passed`);
process.exit(fail ? 1 : 0);
