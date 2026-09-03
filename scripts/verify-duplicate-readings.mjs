// The duplicate-readings question, EXECUTED AGAINST A LIVE SERVER.
//
// The pure module is asserted separately. This is the half that matters more:
// a rule that is correct in a module and unwired in the route is the failure
// this project keeps finding — a check that passes because the code it tests
// never ran. Everything below goes through the real HTTP endpoint.
//
// Caller sets PORT + DBPATH. Needs a fresh database.
const PORT = process.env.PORT || 4893;
const B = `http://localhost:${PORT}/api`;
const J = async (r) => { try { return await r.json(); } catch { return null; } };
let token = null;
const req = (p, o = {}) => fetch(B + p, { ...o, headers: {
  'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(o.headers || {}) } });
const post = (p, body) => req(p, { method: 'POST', body: JSON.stringify(body) });

let pass = 0, fail = 0;
const t = (n, c, d = '') => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (d ? ' — ' + d : '')); } };

const PW = 'DupSecret2026';
const { default: Database } = await import('better-sqlite3');
const db = new Database(process.env.DBPATH);
db.prepare(`INSERT OR REPLACE INTO users (id, name, username, role, department, is_active, setup_code, setup_code_expires_at)
  VALUES ('dup-qa','Dup QA','Dup QA','admin','qa',1,'SC-DUP', datetime('now','+7 day'))`).run();

// A machine and a daily schedule, so the work orders share a pm_schedule_id —
// which is what "the previous check" means.
db.prepare(`INSERT OR REPLACE INTO equipment (id, name, type, status, asset_kind, loto_required)
  VALUES ('dup-eq','Dup Temp Monitor','Environmental Monitoring Point','active','zone',0)`).run();
db.prepare(`INSERT OR REPLACE INTO pm_schedules (id, equipment_id, title, frequency_type, task_group, is_active)
  VALUES ('dup-sch','dup-eq','Temp & Humidity Check — Dup','daily','qa',1)`).run();

const wo = (id, status, readings, when) => db.prepare(`INSERT OR REPLACE INTO work_orders
  (id, equipment_id, pm_schedule_id, title, status, task_group, due_date, readings, completed_at, completed_by)
  VALUES (?,?,'dup-sch','Temp & Humidity Check — Dup',?,'qa',?,?,?,?)`)
  .run(id, 'dup-eq', status, when, readings, status === 'completed' ? `${when} 09:00:00` : null,
    status === 'completed' ? 'Maria' : null);

const YDAY = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
const TODAY = new Date().toISOString().slice(0, 10);

// Yesterday: a completed check on record. Today: the open task Maria filled in.
wo('dup-wo-yday', 'completed', JSON.stringify({ temperature: '68', humidity: '35' }), YDAY);
wo('dup-wo-today', 'open', null, TODAY);
wo('dup-wo-today2', 'open', null, TODAY);
wo('dup-wo-today3', 'open', null, TODAY);
db.close();

await post('/users/login', { name: 'Dup QA' });
await post('/users/set-password', { user_id: 'dup-qa', password: PW, setup_code: 'SC-DUP' });
token = (await J(await post('/users/login', { name: 'Dup QA', password: PW })))?.token;
t('QA signed in', !!token);

const complete = (id, body) => post(`/pm/work-orders/${id}/complete-and-recur`, body);

console.log('\nThe reported failure, through the real endpoint');
{
  const r = await complete('dup-wo-today', { readings: { temperature: '68', humidity: '35' }, notes: '' });
  const b = await J(r);
  t('filing yesterday\'s readings is REFUSED', r.status === 409, `got ${r.status}`);
  t('the refusal is machine-readable', b?.duplicate_readings === true);
  t('it names the record it matched', b?.prior_date === YDAY, `got ${b?.prior_date}`);
  t('it names who filed that one', b?.prior_by === 'Maria');
  t('the question mentions the date, not a null', /\d{4}-\d{2}-\d{2}/.test(b?.error || '') && !/null|undefined/.test(b?.error || ''));
}
{
  const row = new Database(process.env.DBPATH);
  const st = row.prepare('SELECT status FROM work_orders WHERE id = ?').get('dup-wo-today')?.status;
  const recs = row.prepare("SELECT COUNT(*) c FROM sanitation_records WHERE notes LIKE '%dup-wo-today%'").get().c;
  row.close();
  t('THE REFUSED TASK IS STILL OPEN', st === 'open', `status ${st}`);
  t('and no record was filed for it', recs === 0, `${recs} records`);
}

console.log('\nConfirming goes through — it is a question, not a limit');
{
  const r = await complete('dup-wo-today', {
    readings: { temperature: '68', humidity: '35' }, notes: '', confirm_duplicate_readings: true });
  t('the same body with the confirmation is accepted', r.ok, `got ${r.status}`);
  const row = new Database(process.env.DBPATH);
  const st = row.prepare('SELECT status FROM work_orders WHERE id = ?').get('dup-wo-today')?.status;
  row.close();
  t('the task completes', st === 'completed', `status ${st}`);
}

console.log('\nWhat must not fire');
{
  const r = await complete('dup-wo-today2', { readings: { temperature: '69', humidity: '35' }, notes: '' });
  t('a different reading is not challenged', r.ok, `got ${r.status}`);
}
{
  const r = await complete('dup-wo-today3', { notes: 'no readings on this one' });
  t('a task with NO readings is not challenged', r.ok, `got ${r.status}`);
}

console.log('\nThe edit path is deliberately never challenged');
{
  // Same asymmetry as the ATP escalation: correcting a filed record must not
  // re-ask a question that was already answered when it was filed.
  const d2 = new Database(process.env.DBPATH);
  const rec = d2.prepare("SELECT id FROM sanitation_records WHERE notes LIKE '%dup-wo-today%' LIMIT 1").get();
  d2.close();
  t('a sanitation record was filed by the confirmed completion', !!rec, 'none found');
  if (rec) {
    const r = await req(`/sanitation/${rec.id}`, { method: 'PUT', body: JSON.stringify({ notes: 'typo fixed' }) });
    t('editing it is not challenged', r.status !== 409, `got ${r.status}`);
  }
}

console.log(`\n${pass}/${pass + fail} assertions passed`);
process.exit(fail ? 1 : 0);
