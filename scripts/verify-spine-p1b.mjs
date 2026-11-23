// verify:spinep1b — D-368 (single-spine P1, step B). A read is a read: opening a
// task list no longer marks cards missed or raises new ones; the sweep runs on
// its own tick (started at boot) and on an explicit POST /pm/housekeeping. A
// quality schedule can name an owner, and the next card it raises carries it.
// Caller sets PORT + DBPATH; this entry runs with PM_HOUSEKEEPING_TICK_MS=6000.
// Control: `main` — the GET flips the card and raises the quality task.
import Database from 'better-sqlite3';

const PORT = process.env.PORT || 5237;
const URL = `http://localhost:${PORT}`;
let pass = 0, fail = 0;
const t = (n, ok, d = '') => { if (ok) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n}${d ? ' — ' + d : ''}`); } };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const db = new Database(process.env.DBPATH);
db.pragma('busy_timeout = 5000');

const mk = (id, name, role, dept) => db.prepare(`INSERT OR REPLACE INTO users
  (id,name,username,role,department,is_active,setup_code,setup_code_expires_at,module_access)
  VALUES (?,?,?,?,?,1,?,datetime('now','+7 day'),?)`).run(id, name, name, role, dept, `SC-${id}`, JSON.stringify({ pm: 'edit', operator: 'view' }));
mk('p1b-boss', 'Bea Boss', 'admin', 'qa');
mk('p1b-op', 'Otto Floor', 'operator', 'warehouse');
mk('p1b-own', 'Olive Owner', 'operator', 'warehouse');
const H = { 'Content-Type': 'application/json' };
const post = (p, b) => fetch(`${URL}/api${p}`, { method: 'POST', headers: H, body: JSON.stringify(b) });
const signIn = async (name, id) => {
  await post('/users/login', { name });
  await post('/users/set-password', { user_id: id, password: 'Spine2026!!b', setup_code: `SC-${id}` });
  return (await (await post('/users/login', { name, password: 'Spine2026!!b' })).json()).token;
};
const BOSS = await signIn('Bea Boss', 'p1b-boss');
const OP = await signIn('Otto Floor', 'p1b-op');
t('signed in', !!BOSS && !!OP);
const call = async (method, p, body, tok = BOSS) => {
  const r = await fetch(`${URL}/api${p}`, { method, headers: { ...H, Authorization: `Bearer ${tok}` }, body: body ? JSON.stringify(body) : undefined });
  let j = null; try { j = await r.json(); } catch { /* none */ }
  return { status: r.status, body: j };
};
const eq = db.prepare('SELECT id FROM equipment LIMIT 1').get().id;
const yesterday = db.prepare("SELECT date('now','-1 day') d").get().d;
const today = db.prepare("SELECT date('now') d").get().d;
let n = 0;
const card = () => { const id = `p1b-wo-${++n}`; db.prepare(`INSERT INTO work_orders (id, equipment_id, title, status, due_date, task_group) VALUES (?,?,?, 'open', ?, 'warehouse')`).run(id, eq, `P1b card ${n}`, yesterday); return id; };
const statusOf = (id) => db.prepare('SELECT status FROM work_orders WHERE id = ?').get(id)?.status;
const woCount = () => db.prepare('SELECT COUNT(*) c FROM work_orders').get().c;

console.log('\n── the tick runs on its own');
const sentinel = card();
let flipped = false;
for (let i = 0; i < 40 && !flipped; i++) { await sleep(500); flipped = statusOf(sentinel) === 'missed'; }
t('a past-due card is marked missed by the tick, with nobody reading a list', flipped, statusOf(sentinel));

console.log('\n── reading a list writes nothing');
// Straight after a tick, so the next one is seconds away.
const qs = 'p1b-qs';
db.prepare(`INSERT INTO quality_schedules (id, title, frequency_type, frequency_value, procedure_steps, next_due, is_active, task_group)
  VALUES (?, 'P1b weekly check', 'weekly', 1, '[]', ?, 1, 'qa')`).run(qs, today);
const fresh = card();
const before = woCount();
for (const p of ['/pm/work-orders', '/pm/operator-tasks', '/pm/metrics', '/pm/search?q=P1b', '/pm/by-frequency', '/pm/completed-history', '/pm/schedules/generation']) {
  const r = await call('GET', p);
  t(`GET ${p} answers`, r.status === 200, String(r.status));
}
t('…and the due-yesterday card is still open', statusOf(fresh) === 'open', statusOf(fresh));
t('…and no work order was raised (the due quality schedule raised nothing)', woCount() === before, `${before} → ${woCount()}`);

console.log('\n── the explicit pass');
const refused = await call('POST', '/pm/housekeeping', {}, OP);
t('an operator cannot run the sweep by hand', refused.status === 403);
const ran = await call('POST', '/pm/housekeeping', {});
t('an admin can', ran.status === 200 && ran.body?.ok);
t('…which marks the card missed', statusOf(fresh) === 'missed');
const qcard = () => db.prepare(`SELECT * FROM work_orders WHERE quality_schedule_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1`).get(qs);
t('…and raises the due quality task, team-only', !!qcard() && qcard().assigned_to == null && qcard().task_group === 'qa');

console.log('\n── a quality schedule names an owner');
let r = await call('PUT', `/quality-schedules/${qs}`, { assigned_to: 'Olive Owner' });
t('PUT an owner', r.status === 200 && r.body?.assigned_to === 'Olive Owner', JSON.stringify(r.body).slice(0, 160));
let list = (await call('GET', '/quality-schedules')).body || [];
t('GET reads it back', list.find(s => s.id === qs)?.assigned_to === 'Olive Owner');
r = await call('PUT', `/quality-schedules/${qs}`, { title: 'P1b weekly check' });
t('an edit that does not mention the owner leaves it', r.body?.assigned_to === 'Olive Owner');
const audit = db.prepare(`SELECT details FROM audit_log WHERE entity_type = 'quality_schedule' AND entity_id = ? AND details LIKE '%owner%' ORDER BY rowid DESC LIMIT 1`).get(qs);
t('the change is audited, from → to', /"owner":\{"from":null,"to":"Olive Owner"\}/.test(audit?.details || ''), audit?.details);
db.prepare("UPDATE work_orders SET status = 'completed', completed_at = datetime('now') WHERE quality_schedule_id = ?").run(qs);
await call('PUT', `/quality-schedules/${qs}`, { next_due: today });
await call('POST', '/pm/housekeeping', {});
const owned = qcard();
t('the next task carries the owner — and keeps the team', owned?.assigned_to === 'Olive Owner' && owned?.assigned_to_id === 'p1b-own' && owned?.task_group === 'qa', JSON.stringify({ a: owned?.assigned_to, id: owned?.assigned_to_id, g: owned?.task_group }));
const myList = (await call('GET', '/pm/operator-tasks', null, await signIn('Olive Owner', 'p1b-own'))).body;
const tasks = Array.isArray(myList) ? myList : (myList?.tasks || []);
t('…and reaches the owner\'s own list', tasks.some(x => x.id === owned?.id));
r = await call('PUT', `/quality-schedules/${qs}`, { assigned_to: '' });
t('a blank owner clears it', r.status === 200 && r.body?.assigned_to == null);
db.prepare("UPDATE work_orders SET status = 'completed', completed_at = datetime('now') WHERE quality_schedule_id = ?").run(qs);
await call('PUT', `/quality-schedules/${qs}`, { next_due: today });
await call('POST', '/pm/housekeeping', {});
t('…and the next task is the team\'s alone', qcard()?.id !== owned?.id && qcard()?.assigned_to == null && qcard()?.task_group === 'qa');

db.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
