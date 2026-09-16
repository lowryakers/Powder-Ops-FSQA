// A recurring job can name the ONE person who owns it, and that survives the
// night. Maria's ask was "Zuleika performs the daily dilution — can that show
// on her Operator View?", and the honest answer was no: assigning today's card
// worked, and createNextWorkOrder raised tomorrow's with nobody on it.
//
// Also asserted, because it is the half that must NOT change: naming an owner
// is additive. The task still belongs to its team and still reaches every
// operator in that department.
//
// Caller sets PORT + DBPATH.
const PORT = process.env.PORT || 4978; const URL = `http://localhost:${PORT}`;
let pass = 0, fail = 0;
const t = (n, c, d = '') => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (d ? ' — ' + d : '')); } };
const { default: Database } = await import('better-sqlite3');
const dbPath = process.env.DBPATH;

// An admin to drive the API, a CLEANER, and an operator whose own department is
// something else entirely — which is the case the whole pack is about.
{ const db = new Database(dbPath);
  const mk = (id, name, role, dept, code) => db.prepare(`INSERT OR REPLACE INTO users
    (id,name,username,role,department,is_active,setup_code,setup_code_expires_at,module_access)
    VALUES (?,?,?,?,?,1,?,datetime('now','+7 day'),'{"pm":"edit"}')`).run(id, name, name, role, dept, code);
  mk('so-admin', 'Owner Admin', 'admin', 'maintenance', 'SC-SO1');
  mk('so-cleaner', 'Rosa Cleaner', 'operator', 'cleaning', 'SC-SO2');
  mk('so-owner', 'Zuleika Owner', 'operator', 'batching', 'SC-SO3');
  db.close(); }

const H = { 'Content-Type': 'application/json' };
const call = (m, p, b, tok) => fetch(`${URL}/api${p}`, { method: m, headers: { ...H, ...(tok ? { Authorization: `Bearer ${tok}` } : {}) }, body: b ? JSON.stringify(b) : undefined });
const J = async r => { try { return await r.json(); } catch { return null; } };
async function signIn(id, name, code, pw) {
  await call('POST', '/users/login', { name });
  await call('POST', '/users/set-password', { user_id: id, password: pw, setup_code: code });
  return (await J(await call('POST', '/users/login', { name, password: pw })))?.token;
}
const tok = await signIn('so-admin', 'Owner Admin', 'SC-SO1', 'Admin2026!!');
const cleanerTok = await signIn('so-cleaner', 'Rosa Cleaner', 'SC-SO2', 'Clean2026!!');
let ownerTok = await signIn('so-owner', 'Zuleika Owner', 'SC-SO3', 'Owner2026!!');
t('three accounts signed in', !!tok && !!cleanerTok && !!ownerTok);

const eq = await J(await call('POST', '/equipment', { name: 'Chem Station (owner test)', type: 'Sanitation Zone', location: 'Production', asset_id: 'SO-1' }, tok));
t('equipment created', !!eq?.id);

console.log('\nA schedule can name an owner, and blank stays the ordinary case');
const teamOnly = await J(await call('POST', '/pm/schedules', {
  equipment_id: eq.id, title: 'Chemical Dilution — Team Only (owner test)', frequency_type: 'daily',
  frequency_value: 1, task_group: 'cleaning', procedure_steps: ['Test strip'] }, tok));
t('a schedule with no owner is created with none', !!teamOnly?.id && !teamOnly.assigned_to, JSON.stringify(teamOnly?.assigned_to));

const owned = await J(await call('POST', '/pm/schedules', {
  equipment_id: eq.id, title: 'Chemical Dilution — Sani-512 (owner test)', frequency_type: 'daily',
  frequency_value: 1, task_group: 'cleaning', assigned_to: 'Zuleika Owner', procedure_steps: ['Test strip'] }, tok));
t('a schedule created WITH an owner keeps it', owned?.assigned_to === 'Zuleika Owner', JSON.stringify(owned?.assigned_to));

const listed = async (id) => (await J(await call('GET', '/pm/schedules?include_inactive_equipment=true', null, tok)))?.find(s => s.id === id);
let row = await listed(owned.id);
t('and the list resolves the owner to an ACCOUNT, not just a string',
  row?.assigned_to === 'Zuleika Owner' && row?.assigned_to_id === 'so-owner', JSON.stringify(row?.assigned_to_id));

console.log('\nRaising the task puts the owner on the card');
const raised = await J(await call('POST', `/pm/schedules/${owned.id}/raise`, { due_date: new Date(Date.now() + 864e5).toISOString().slice(0, 10) }, tok));
t('the manual raise carries the owner — it read a column that never existed', !!raised?.work_order?.id);
{ const db = new Database(dbPath, { readonly: true });
  const wo = db.prepare('SELECT assigned_to, assigned_to_id, task_group FROM work_orders WHERE id = ?').get(raised.work_order.id);
  db.close();
  t('…assigned_to on the raised work order', wo?.assigned_to === 'Zuleika Owner', JSON.stringify(wo?.assigned_to));
  t('…and the ACCOUNT ID with it, so a rename cannot lose her', wo?.assigned_to_id === 'so-owner', JSON.stringify(wo?.assigned_to_id));
  t('…while the task still belongs to the cleaning team', wo?.task_group === 'cleaning', JSON.stringify(wo?.task_group)); }

console.log('\nTHE NIGHT TEST: the recurrence keeps the owner');
// Complete the open task the way the floor does, which recurs the schedule.
const openWo = await (async () => { const db = new Database(dbPath, { readonly: true });
  const r = db.prepare("SELECT id FROM work_orders WHERE pm_schedule_id = ? AND status IN ('open','in_progress') ORDER BY due_date LIMIT 1").get(owned.id);
  db.close(); return r; })();
t('there is an open task to complete', !!openWo?.id);
const done = await J(await call('POST', `/pm/work-orders/${openWo.id}/complete-and-recur`, { completed_by: 'Owner Admin', notes: 'ok' }, tok));
t('completing it raised the next one', !!done?.next_work_order?.id || !!done?.next?.id, JSON.stringify(done).slice(0, 160));
{ const db = new Database(dbPath, { readonly: true });
  const next = db.prepare(`SELECT assigned_to, assigned_to_id, task_group FROM work_orders
    WHERE pm_schedule_id = ? AND id != ? ORDER BY created_at DESC LIMIT 1`).get(owned.id, openWo.id);
  db.close();
  t('TOMORROW’S AUTOMATIC TASK STILL NAMES HER — the whole point',
    next?.assigned_to === 'Zuleika Owner' && next?.assigned_to_id === 'so-owner', JSON.stringify(next));
  t('…and is still cleaning work, not moved to her department', next?.task_group === 'cleaning', JSON.stringify(next?.task_group)); }

console.log('\nHer Operator View shows it although her department is Batching');
let mine = await J(await call('GET', '/pm/operator-tasks', null, ownerTok));
const mineList = Array.isArray(mine) ? mine : (mine?.tasks || mine?.work_orders || []);
t('the owned dilution card is on HER screen',
  mineList.some(w => w.title === 'Chemical Dilution — Sani-512 (owner test)'),
  `${mineList.length} task(s): ${mineList.map(w => w.title).slice(0, 4).join(' | ')}`);
t('…and the team-only one is NOT — she is not in Cleaning',
  !mineList.some(w => w.title === 'Chemical Dilution — Team Only (owner test)'));

console.log('\nNAMING AN OWNER IS ADDITIVE — the team does not lose the work');
const theirs = await J(await call('GET', '/pm/operator-tasks', null, cleanerTok));
const theirList = Array.isArray(theirs) ? theirs : (theirs?.tasks || theirs?.work_orders || []);
t('a cleaner still sees the owned schedule’s task', theirList.some(w => w.title === 'Chemical Dilution — Sani-512 (owner test)'),
  `${theirList.length} task(s)`);
t('…and still sees the unowned team task', theirList.some(w => w.title === 'Chemical Dilution — Team Only (owner test)'));

console.log('\nNaming an owner reaches the card already on the floor');
await call('PUT', `/pm/schedules/${teamOnly.id}`, { assigned_to: 'Zuleika Owner' }, tok);
mine = await J(await call('GET', '/pm/operator-tasks', null, ownerTok));
t('the task raised BEFORE she was named is hers now, not tomorrow',
  (Array.isArray(mine) ? mine : []).some(w => w.title === 'Chemical Dilution — Team Only (owner test)'));

console.log('\nAn absent field leaves the owner alone; an empty one clears it');
await call('PUT', `/pm/schedules/${owned.id}`, { description: 'edited, nothing to do with the owner' }, tok);
row = await listed(owned.id);
t('EDITING THE DESCRIPTION DOES NOT UNASSIGN HER', row?.assigned_to === 'Zuleika Owner', JSON.stringify(row?.assigned_to));
await call('PUT', `/pm/schedules/${owned.id}`, { assigned_to: '' }, tok);
row = await listed(owned.id);
t('an explicitly empty owner clears it', !row?.assigned_to && !row?.assigned_to_id, JSON.stringify(row?.assigned_to));
{ const db = new Database(dbPath, { readonly: true });
  const still = db.prepare(`SELECT COUNT(*) n FROM work_orders WHERE pm_schedule_id = ?
    AND status IN ('open','in_progress','overdue','missed') AND assigned_to IS NOT NULL`).get(owned.id);
  db.close();
  t('…and clears it from the open cards too', Number(still.n) === 0, JSON.stringify(still)); }

console.log('\nThe id is the identity: a RENAME does not lose the schedule');
await call('PUT', `/pm/schedules/${owned.id}`, { assigned_to: 'Zuleika Owner' }, tok);
{ const db = new Database(dbPath); db.prepare("UPDATE users SET name = 'Zuleika Nava', username = 'Zuleika Nava' WHERE id = 'so-owner'").run(); db.close(); }
row = await listed(owned.id);
t('the list reports her CURRENT name', row?.assigned_to === 'Zuleika Nava', JSON.stringify(row?.assigned_to));
t('…and says what it was filed as', row?.assigned_to_renamed_from === 'Zuleika Owner', JSON.stringify(row?.assigned_to_renamed_from));
const later = await J(await call('POST', `/pm/schedules/${owned.id}/raise`, { due_date: new Date(Date.now() + 3 * 864e5).toISOString().slice(0, 10) }, tok));
{ const db = new Database(dbPath, { readonly: true });
  const wo = db.prepare('SELECT assigned_to, assigned_to_id FROM work_orders WHERE id = ?').get(later?.work_order?.id);
  db.close();
  t('a task raised AFTER the rename carries the new name and the same id',
    wo?.assigned_to === 'Zuleika Nava' && wo?.assigned_to_id === 'so-owner', JSON.stringify(wo)); }
ownerTok = await signIn('so-owner', 'Zuleika Nava', 'SC-SO3', 'Owner2026!!') || ownerTok;
mine = await J(await call('GET', '/pm/operator-tasks', null, ownerTok));
t('and her Operator View still finds her work after the rename',
  (Array.isArray(mine) ? mine : []).some(w => w.title === 'Chemical Dilution — Sani-512 (owner test)'));

console.log('\nFORM 106-01 names four chemicals, and Lysol is not one of them');
const { DILUTIONS, dilutionTitle } = await import('../shared/dilution-forms.js');
t('four daily dilutions on the form', DILUTIONS.length === 4, String(DILUTIONS.length));
t('NONE of them is Lysol — "Lysol dilution" is not this form',
  !DILUTIONS.some(d => /lysol/i.test(d.chemical)), DILUTIONS.map(d => d.chemical).join(' | '));
{ const db = new Database(dbPath, { readonly: true });
  const seeded = db.prepare(`SELECT title, task_group, is_active FROM pm_schedules WHERE title LIKE 'Chemical Dilution — %' AND title NOT LIKE '%owner test%'`).all();
  db.close();
  t('the four seeded dilution schedules exist', seeded.length === 4, seeded.map(s => s.title).join(' | '));
  t('…and every one routes to the CLEANING team', seeded.every(s => s.task_group === 'cleaning'),
    seeded.map(s => `${s.title}=${s.task_group}`).join(' | ')); }

console.log(`\n${pass}/${pass + fail} assertions passed`);
process.exit(fail ? 1 : 0);
