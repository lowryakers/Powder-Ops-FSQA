// D-123: the re-sync banner that never cleared. A truck's daily schedule carries
// the designed Good/Bad/X pre-shift inspection; the re-sync must neither count
// it nor flatten it, an equipment edit must not overwrite it, and the boot pass
// must restore it where it was flattened and leave a hand-edited one alone.
import Database from 'better-sqlite3';
import { applyTruckChecklists, PALLET_JACK_DAILY_STEPS } from '../server/truck-checklists.js';

const URL = process.env.APP || `http://localhost:${process.env.PORT || 5043}`;
const DBP = process.env.DBPATH;
let pass = 0; const failed = [];
const t = (name, ok, extra = '') => { if (ok) { pass++; console.log(`  ✓ ${name}`); } else { failed.push(name); console.log(`  ✗ ${name} ${extra}`); } };

const db = new Database(DBP);
db.prepare(`INSERT OR REPLACE INTO users (id, name, username, role, department, is_active, module_access, setup_code, setup_code_expires_at)
  VALUES ('tc-a','Truck Admin','Truck Admin','admin','maintenance',1,'{"equipment":"edit","pm":"edit"}','SC-TC', datetime('now','+7 day'))`).run();

const jack = db.prepare("SELECT id, name FROM equipment WHERE type = 'Pallet Jack' ORDER BY name LIMIT 1").get();
t('a pallet jack is on file to test with', !!jack);
const DAILY = ['Forks, wheels, handle, pump action, leaks, damage', 'Check for bent forks, worn wheels, loose hardware, hydraulic leaks'];
const WEEKLY = ['Lubricate moving points'];
db.prepare('UPDATE equipment SET maintenance_tasks = ? WHERE id = ?').run(JSON.stringify({ Daily: DAILY, Weekly: WEEKLY }), jack.id);
db.prepare("DELETE FROM pm_schedules WHERE equipment_id = ?").run(jack.id);
const ins = db.prepare(`INSERT INTO pm_schedules (id, equipment_id, title, frequency_type, frequency_value, procedure_steps, is_active, task_group)
  VALUES (?, ?, ?, ?, 1, ?, 1, 'warehouse')`);
ins.run('tc-daily', jack.id, `${jack.name} — Daily PM`, 'daily', JSON.stringify(PALLET_JACK_DAILY_STEPS));
// The old flattening bug on the weekly: every cadence written in.
ins.run('tc-weekly', jack.id, `${jack.name} — Weekly PM`, 'weekly', JSON.stringify([...DAILY, ...WEEKLY]));
db.prepare(`INSERT INTO work_orders (id, pm_schedule_id, equipment_id, title, due_date, procedure_steps, task_group, status)
  VALUES ('tc-wo', 'tc-daily', ?, 'Daily PM', date('now','-1 day'), ?, 'warehouse', 'missed')`).run(jack.id, JSON.stringify(PALLET_JACK_DAILY_STEPS));

const H = { 'Content-Type': 'application/json' };
const post = (p, body, headers = H) => fetch(`${URL}/api${p}`, { method: 'POST', headers, body: JSON.stringify(body) });
await post('/users/login', { name: 'Truck Admin' });
await post('/users/set-password', { user_id: 'tc-a', password: 'Truck2026!!', setup_code: 'SC-TC' });
const auth = await (await post('/users/login', { name: 'Truck Admin', password: 'Truck2026!!' })).json();
const A = { ...H, Authorization: `Bearer ${auth.token}` };
const get = async (p) => (await fetch(`${URL}/api${p}`, { headers: A })).json();
const steps = (id) => JSON.parse(db.prepare('SELECT procedure_steps FROM pm_schedules WHERE id = ?').get(id).procedure_steps);
const n = PALLET_JACK_DAILY_STEPS.length;

console.log('The re-sync banner');
const p1 = await get('/equipment/procedure-steps/resync/preview');
const m1 = p1.machines.find(m => m.id === jack.id);
t('the flattened weekly schedule IS reported', !!m1?.schedules.some(s => s.frequency_type === 'weekly' && s.direction === 'extra'));
t('the daily pre-shift inspection is NOT reported as carrying extra steps',
  !m1?.schedules.some(s => s.frequency_type === 'daily'), JSON.stringify(m1?.schedules));

const r = await post('/equipment/procedure-steps/resync', { ids: [jack.id] }, A);
t('re-sync answers 200', r.status === 200, String(r.status));
t('the weekly schedule is put back to its one written task', steps('tc-weekly').length === 1);
t(`the daily inspection keeps all ${n} checklist items`, steps('tc-daily').length === n, String(steps('tc-daily').length));
t('the missed inspection on the floor keeps its checklist too',
  JSON.parse(db.prepare("SELECT procedure_steps FROM work_orders WHERE id = 'tc-wo'").get().procedure_steps).length === n);

const p2 = await get('/equipment/procedure-steps/resync/preview');
t('after one re-sync the machine is off the banner for good', !p2.machines.some(m => m.id === jack.id));

console.log('An ordinary equipment edit');
const put = await fetch(`${URL}/api/equipment/${jack.id}`, { method: 'PUT', headers: A,
  body: JSON.stringify({ maintenance_tasks: { Daily: [...DAILY, 'Check the horn'], Weekly: WEEKLY } }) });
t('the edit saves', put.status === 200, String(put.status));
t('editing the machine\'s Daily lines does not overwrite the inspection', steps('tc-daily').length === n);
t('it still flows through to a plain schedule', steps('tc-weekly').length === 1);

console.log('The boot pass');
// The state a re-sync left on the live database before this fix.
db.prepare('UPDATE pm_schedules SET procedure_steps = ? WHERE id = ?').run(JSON.stringify(DAILY), 'tc-daily');
db.prepare("UPDATE work_orders SET procedure_steps = ? WHERE id = 'tc-wo'").run(JSON.stringify(DAILY));
const b1 = applyTruckChecklists(db);
t('a flattened inspection is restored', steps('tc-daily').length === n && b1.written >= 1);
t('including on yesterday\'s missed card',
  JSON.parse(db.prepare("SELECT procedure_steps FROM work_orders WHERE id = 'tc-wo'").get().procedure_steps).length === n);
const edited = PALLET_JACK_DAILY_STEPS.slice(0, n - 1);
db.prepare('UPDATE pm_schedules SET procedure_steps = ? WHERE id = ?').run(JSON.stringify(edited), 'tc-daily');
applyTruckChecklists(db);
t('a checklist edited by hand is left as the plant has it', steps('tc-daily').length === n - 1);
const b3 = applyTruckChecklists(db);
t('a second pass writes nothing on that machine', steps('tc-daily').length === n - 1 && typeof b3.kept === 'number');

db.close();
console.log(`\n${pass} PASS / ${failed.length} FAIL`);
process.exit(failed.length ? 1 : 0);
