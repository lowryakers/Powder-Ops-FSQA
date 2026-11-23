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
const done = await J(await call('POST', `/pm/work-orders/${openWo.id}/complete-and-recur`, { completed_by: 'Owner Admin', notes: 'ok', cleaning_chemicals: { none: true } }, tok));
t('completing it raised the next one', !!done?.next_work_order?.id || !!done?.next?.id, JSON.stringify(done).slice(0, 160));
{ const db = new Database(dbPath, { readonly: true });
  const next = db.prepare(`SELECT assigned_to, assigned_to_id, task_group FROM work_orders
    WHERE pm_schedule_id = ? AND id != ? ORDER BY created_at DESC LIMIT 1`).get(owned.id, openWo.id);
  db.close();
  t('TOMORROW’S AUTOMATIC TASK STILL NAMES HER — the whole point',
    next?.assigned_to === 'Zuleika Owner' && next?.assigned_to_id === 'so-owner', JSON.stringify(next));
  t('…and is still cleaning work, not moved to her department', next?.task_group === 'cleaning', JSON.stringify(next?.task_group)); }

console.log('\nHer Operator View shows it although her department is Batching');
// D-368: reading a list no longer runs the sweep that raises cards — run it.
await call('POST', '/pm/housekeeping', {}, tok);
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

console.log('\nA DEPARTMENT THAT IS NOT A TEAM ROUTES NOTHING, and the app says so');
const { routesTasks, TASK_GROUP_VALUES } = await import('../shared/task-groups.js');
const { ASSIGNABLE_DEPARTMENTS, DEPARTMENTS } = await import('../src/constants/departments.js');
t('EVERY go-forward department IS a task group — the invariant that must not break silently',
  ASSIGNABLE_DEPARTMENTS.every(d => TASK_GROUP_VALUES.includes(d.value)),
  ASSIGNABLE_DEPARTMENTS.filter(d => !TASK_GROUP_VALUES.includes(d.value)).map(d => d.value).join(',') || 'all nine match');
t('…and the LEGACY ones are not, which is the whole hole',
  DEPARTMENTS.filter(d => d.legacy).every(d => !routesTasks(d.value)),
  DEPARTMENTS.filter(d => d.legacy).map(d => `${d.value}=${routesTasks(d.value)}`).join(' '));
t('a blank department is NOT reported — /operator-tasks falls back to warehouse', routesTasks(null) && routesTasks(''));
t('the org chart\u2019s own words are not task groups either',
  !routesTasks('sanitation') && !routesTasks('executive') && !routesTasks('quality') && !routesTasks('admin'));

// The symptom, executed: an operator on a legacy department.
{ const db = new Database(dbPath);
  db.prepare(`INSERT OR REPLACE INTO users
    (id,name,username,role,department,is_active,setup_code,setup_code_expires_at,module_access)
    VALUES ('so-legacy','Legacy Operator','Legacy Operator','operator','production',1,'SC-SO4',datetime('now','+7 day'),'{"pm":"edit"}')`).run();
  db.close(); }
const legacyTok = await signIn('so-legacy', 'Legacy Operator', 'SC-SO4', 'Legacy2026!!');
const legacy = await J(await call('GET', '/pm/operator-tasks', null, legacyTok));
const legacyList = Array.isArray(legacy) ? legacy : [];
t('an account on a LEGACY department sees no team work at all — the reported symptom',
  legacyList.length === 0, `${legacyList.length} task(s)`);
await call('PUT', `/pm/schedules/${teamOnly.id}`, { assigned_to: 'Legacy Operator' }, tok);
const legacyAfter = await J(await call('GET', '/pm/operator-tasks', null, legacyTok));
t('…and naming her the owner is still the way work reaches her',
  (Array.isArray(legacyAfter) ? legacyAfter : []).some(w => w.title === 'Chemical Dilution — Team Only (owner test)'));

console.log('\nONE RAISE PATH (D-377): the housekeeping backfill carries the owner too');
// The backfill raises a card for any active schedule with nothing outstanding.
// It inserted the TEAM only, so an owned daily raised there arrived blank.
{ const db = new Database(dbPath);
  db.prepare(`UPDATE work_orders SET status = 'cancelled', notes = 'verify: clear the way for the backfill'
    WHERE pm_schedule_id = ? AND status IN ('open','in_progress','overdue','missed')`).run(owned.id);
  db.close(); }
const backTeam = await J(await call('POST', '/pm/schedules', {
  equipment_id: eq.id, title: 'Chemical Dilution — Backfill Team (owner test)', frequency_type: 'daily',
  frequency_value: 1, task_group: 'cleaning', procedure_steps: ['Test strip'] }, tok));
{ const db = new Database(dbPath);
  db.prepare(`UPDATE work_orders SET status = 'cancelled', notes = 'verify: clear the way for the backfill'
    WHERE pm_schedule_id = ? AND status IN ('open','in_progress','overdue','missed')`).run(backTeam.id);
  db.close(); }
await call('POST', '/pm/housekeeping', {}, tok);
{ const db = new Database(dbPath, { readonly: true });
  const ownedCard = db.prepare(`SELECT assigned_to, assigned_to_id, task_group FROM work_orders
    WHERE pm_schedule_id = ? AND status = 'open' ORDER BY created_at DESC LIMIT 1`).get(owned.id);
  const teamCard = db.prepare(`SELECT assigned_to, assigned_to_id, task_group, title FROM work_orders
    WHERE pm_schedule_id = ? AND status = 'open' ORDER BY created_at DESC LIMIT 1`).get(backTeam.id);
  db.close();
  t('the BACKFILL raises the owned schedule’s card with her name and account on it',
    ownedCard?.assigned_to === 'Zuleika Nava' && ownedCard?.assigned_to_id === 'so-owner' && ownedCard?.task_group === 'cleaning', JSON.stringify(ownedCard));
  t('a TEAM-ONLY schedule’s backfilled card names nobody and stays the team’s',
    !!teamCard && !teamCard.assigned_to && !teamCard.assigned_to_id && teamCard.task_group === 'cleaning', JSON.stringify(teamCard)); }
const cleanerNow = await J(await call('GET', '/pm/operator-tasks', null, cleanerTok));
t('…and it is on the cleaning department’s Operator View',
  (Array.isArray(cleanerNow) ? cleanerNow : []).some(w => w.title === 'Chemical Dilution — Backfill Team (owner test)'));

console.log('\nThe other calendars raise through the same path and land on their team');
const today = new Date().toISOString().slice(0, 10);
{ const db = new Database(dbPath);
  db.prepare(`INSERT INTO quality_schedules (id, title, frequency_type, frequency_value, next_due, is_active, assigned_to)
    VALUES ('so-qs', 'Tap Water Testing (owner test)', 'monthly', 1, ?, 1, 'Zuleika Nava')`).run(today);
  db.prepare(`INSERT INTO quality_schedules (id, title, frequency_type, frequency_value, next_due, is_active)
    VALUES ('so-qs2', 'Air Testing (owner test)', 'monthly', 1, ?, 1)`).run(today);
  db.prepare(`INSERT INTO sop_documents (id, doc_number, title, category, status, review_due) VALUES ('so-doc', 'SOP 999', 'Owner Test SOP', 'quality', 'active', ?)`).run(today);
  db.close(); }
await call('POST', '/pm/housekeeping', {}, tok);
{ const db = new Database(dbPath, { readonly: true });
  const q1 = db.prepare('SELECT assigned_to, assigned_to_id, task_group FROM work_orders WHERE quality_schedule_id = ?').get('so-qs');
  const q2 = db.prepare('SELECT assigned_to, assigned_to_id, task_group FROM work_orders WHERE quality_schedule_id = ?').get('so-qs2');
  const dr = db.prepare('SELECT assigned_to, task_group FROM work_orders WHERE document_id = ?').get('so-doc');
  db.close();
  t('a quality schedule naming an owner raises a QA card with the owner AND her account id',
    q1?.task_group === 'qa' && q1?.assigned_to === 'Zuleika Nava' && q1?.assigned_to_id === 'so-owner', JSON.stringify(q1));
  t('a quality schedule naming nobody raises a QA card for the whole team', q2?.task_group === 'qa' && !q2?.assigned_to, JSON.stringify(q2));
  t('a document review lands on Document Control, owner blank', dr?.task_group === 'document_control' && !dr?.assigned_to, JSON.stringify(dr)); }

console.log('\nNo calendar writes its own work order any more');
{ const fs = await import('fs');
  const body = (file, fn) => { const src = fs.readFileSync(file, 'utf8'); const i = src.indexOf(`function ${fn}(`); const j = src.indexOf('\n}\n', i); return i < 0 ? '' : src.slice(i, j); };
  const GENS = [['server/api/pm.js', 'createNextWorkOrder'], ['server/api/pm.js', 'markMissedWorkOrders'],
    ['server/api/quality-schedules.js', 'generateQualityScheduleTasks'], ['server/api/documents.js', 'generateDocumentReviewTasks'],
    ['server/api/sanitation.js', 'generateRecleanTasks'], ['server/supplier-review.js', 'generateSupplierReviewTasks'],
    ['server/stability.js', 'generateStabilityPullTasks']];
  for (const [file, fn] of GENS) {
    const b = body(file, fn);
    t(`${fn} raises through raiseWorkOrder and has no INSERT of its own`, b.includes('raiseWorkOrder(') && !/INSERT INTO work_orders/.test(b), file);
  }
  const pm = fs.readFileSync('server/api/pm.js', 'utf8');
  const raise = pm.slice(pm.indexOf("router.post('/schedules/:id/raise'"), pm.indexOf("router.put('/schedules/:id'"));
  t('the manual Raise button uses it too', raise.includes('raiseWorkOrder(') && !/INSERT INTO work_orders/.test(raise));
  t('training does NOT — an assignment names one person and no team', !fs.readFileSync('server/training-assign.js', 'utf8').includes('raiseWorkOrder')); }

console.log(`\n${pass}/${pass + fail} assertions passed`);
process.exit(fail ? 1 : 0);
