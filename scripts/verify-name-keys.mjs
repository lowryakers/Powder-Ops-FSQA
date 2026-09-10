// The link is the identity, the name is a label — for work orders,
// certifications, first-aid injuries and production entries. Rename a person in
// Settings and assert nothing splits: Team Activity keeps one row, the
// drill-down reconciles, their own task screen still lists their work, the
// delete guard still refuses, certificates and injuries read under the new
// name, and the QA-correction door still opens for them. Caller sets PORT + DBPATH.
const PORT = process.env.PORT || 4992; const URL = `http://localhost:${PORT}`;
let pass = 0, fail = 0;
const t = (n, c, d = '') => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (d ? ' — ' + d : '')); } };
const { default: Database } = await import('better-sqlite3');
const { installPersonLinks } = await import('../server/person-links.js');
const db = new Database(process.env.DBPATH);
for (const [id, name, role, dept, code, ma] of [
  ['nk-admin', 'Keys Admin', 'admin', 'office', 'SC-KA', null],
  // operator:edit passes the /api/production mount for a write; production-log stays VIEW so
  // the amend can only succeed through the invited door, never a blanket edit grant.
  ['nk-op', 'Ana Perez', 'operator', 'production', 'SC-KO', { pm: 'view', 'production-log': 'view', operator: 'edit' }],
  ['nk-twin-a', 'Same Name', 'operator', 'warehouse', 'SC-T1', { pm: 'view' }],
  ['nk-twin-b', 'Same Name', 'operator', 'production', 'SC-T2', { pm: 'view' }],
]) db.prepare(`INSERT OR REPLACE INTO users (id,name,username,role,department,is_active,setup_code,setup_code_expires_at,module_access)
    VALUES (?,?,?,?,?,1,?,datetime('now','+7 day'),?)`).run(id, name, name + '-' + id, role, dept, code, ma ? JSON.stringify(ma) : null);
const call = async (method, p, body, tok) => {
  const r = await fetch(`${URL}/api${p}`, { method, headers: { 'Content-Type': 'application/json', ...(tok ? { Authorization: `Bearer ${tok}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let j = null; try { j = await r.json(); } catch { /* empty */ }
  return { status: r.status, body: j };
};
const signIn = async (name, id, code) => {
  await call('POST', '/users/login', { name });
  await call('POST', '/users/set-password', { user_id: id, password: 'Keys2026!!', setup_code: code });
  return (await call('POST', '/users/login', { name, password: 'Keys2026!!' })).body?.token;
};
const admin = await signIn('Keys Admin', 'nk-admin', 'SC-KA');
const ana = await signIn('Ana Perez', 'nk-op', 'SC-KO');
t('signed in', !!admin && !!ana);
const today = new Date().toISOString().slice(0, 10);
const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);

// 1. Triggers: an insert by name resolves the account; an ambiguous name resolves to nothing.
let r = await call('POST', '/pm/work-orders', { title: 'Wipe down Room 3', assigned_to: 'Ana Perez', due_date: today, task_group: 'production', priority: 'normal' }, admin);
t('task created for Ana by name', r.status === 201 || r.status === 200, JSON.stringify(r.body).slice(0, 120));
const wo1 = r.body?.id;
let row = db.prepare('SELECT assigned_to, assigned_to_id FROM work_orders WHERE id = ?').get(wo1);
t('the insert trigger linked assigned_to to her account', row?.assigned_to_id === 'nk-op', JSON.stringify(row));
db.prepare(`INSERT INTO work_orders (id, title, due_date, status, task_group, assigned_to, completed_by, completed_at)
  VALUES ('nk-done', 'Sanitise sifter', ?, 'completed', 'production', 'Ana Perez', 'Ana Perez', datetime('now'))`).run(daysAgo(2));
row = db.prepare('SELECT assigned_to_id, completed_by_id FROM work_orders WHERE id = ?').get('nk-done');
t('a completed task links both columns', row.assigned_to_id === 'nk-op' && row.completed_by_id === 'nk-op');
db.prepare(`INSERT INTO work_orders (id, title, due_date, status, task_group, assigned_to) VALUES ('nk-twin', 'Ambiguous', ?, 'open', 'warehouse', 'Same Name')`).run(today);
t('a name two accounts share resolves to NOTHING, never a guess', db.prepare('SELECT assigned_to_id FROM work_orders WHERE id = ?').get('nk-twin').assigned_to_id === null);
db.prepare("UPDATE work_orders SET assigned_to = 'Keys Admin' WHERE id = 'nk-twin'").run();
t('changing the name re-resolves the id', db.prepare('SELECT assigned_to_id FROM work_orders WHERE id = ?').get('nk-twin').assigned_to_id === 'nk-admin');
db.prepare("UPDATE work_orders SET assigned_to = 'Typed Differently', assigned_to_id = 'nk-op' WHERE id = 'nk-twin'").run();
t('an id set deliberately in the same statement is kept', db.prepare('SELECT assigned_to_id FROM work_orders WHERE id = ?').get('nk-twin').assigned_to_id === 'nk-op');
db.prepare("UPDATE work_orders SET assigned_to = NULL WHERE id = 'nk-twin'").run();
t('clearing the name clears the id', db.prepare('SELECT assigned_to_id FROM work_orders WHERE id = ?').get('nk-twin').assigned_to_id === null);

// Certificate, injury and production entry filed under her name.
const fd = new FormData(); fd.append('person_name', 'Ana Perez'); fd.append('cert_type', 'PCQI'); fd.append('expiry_date', '2027-01-01');
r = await fetch(`${URL}/api/certifications`, { method: 'POST', headers: { Authorization: `Bearer ${admin}` }, body: fd });
const cert = await r.json();
t('certificate filed', r.status === 201 || r.status === 200, JSON.stringify(cert).slice(0, 100));
t('…linked to her account by the trigger', db.prepare('SELECT user_id FROM certifications WHERE id = ?').get(cert.id)?.user_id === 'nk-op');
r = await call('POST', '/safety/first-aid', { employee_name: 'Ana Perez', injury_date: daysAgo(1), injury_description: 'Paper cut' }, admin);
t('injury filed and linked', (r.status === 201 || r.status === 200) && db.prepare('SELECT employee_user_id FROM first_aid_injuries WHERE id = ?').get(r.body.id)?.employee_user_id === 'nk-op', JSON.stringify(r.body).slice(0, 100));
r = await call('POST', '/production/entries', { date: today, team: 'Filling', room: '1', product_name: 'Whey', mo_number: 'MO1', lot_number: 'L1', start_time: '06:00', end_time: '14:00', quantity_completed: 10, people_count: 2, submitted_by: 'Ana Perez' }, admin);
t('production entry filed and linked', (r.status === 201 || r.status === 200) && db.prepare('SELECT submitted_by_id FROM production_entries WHERE id = ?').get(r.body.id)?.submitted_by_id === 'nk-op', JSON.stringify(r.body).slice(0, 100));
const entryId = r.body?.id;

// A row that predates the columns, then the one-time backfill.
db.prepare(`INSERT INTO work_orders (id, title, due_date, status, task_group, assigned_to) VALUES ('nk-old', 'Legacy task', ?, 'open', 'production', 'Ana Perez')`).run(today);
db.prepare("UPDATE work_orders SET assigned_to_id = NULL WHERE id = 'nk-old'").run();
db.prepare("DELETE FROM app_settings WHERE key = 'person_ids_linked'").run();
installPersonLinks(db, { addColumnIfMissing: () => {} });
t('the backfill links rows written before the column existed', db.prepare('SELECT assigned_to_id FROM work_orders WHERE id = ?').get('nk-old').assigned_to_id === 'nk-op');
t('…and stamps its marker', !!db.prepare("SELECT 1 FROM app_settings WHERE key = 'person_ids_linked'").get());

// 2. The rename.
r = await call('PUT', '/users/nk-op', { name: 'Ana Perez-Lopez' }, admin);
t('renamed in Settings', r.status === 200 && r.body?.name === 'Ana Perez-Lopez', JSON.stringify(r.body).slice(0, 100));
const ana2 = (await call('POST', '/users/login', { name: 'Ana Perez-Lopez', password: 'Keys2026!!' })).body?.token || ana;

// Team Activity: one person, current name, drill-down reconciles.
r = await call('GET', `/activity/summary?from=${daysAgo(7)}&to=${today}`, null, admin);
const mine = (r.body?.by_person || []).filter(p => /Ana Perez/.test(p.name));
t('Team Activity shows ONE row for her (was: two people after a rename)', mine.length === 1, JSON.stringify(mine));
t('…under her current name', mine[0]?.name === 'Ana Perez-Lopez' && mine[0]?.key === 'nk-op');
r = await call('GET', `/activity/tasks?metric=completed&person=${encodeURIComponent(mine[0]?.key)}&from=${daysAgo(7)}&to=${today}`, null, admin);
t('the drill-down behind her completed count reconciles with the table', r.status === 200 && (r.body?.total ?? r.body?.rows?.length) === mine[0]?.completed, JSON.stringify(r.body).slice(0, 120));

// Her own screen still lists her work.
r = await call('GET', '/pm/operator-tasks', null, ana2);
const titles = (r.body || []).map(x => x.title);
t('the Operator View still lists the tasks assigned under her old name', titles.includes('Wipe down Room 3') && titles.includes('Legacy task'), titles.join(','));
r = await call('GET', '/pm/work-orders?assigned_to=' + encodeURIComponent('Ana Perez-Lopez'), null, admin);
t('the Task Center filter by her NEW name finds the old-name tasks', (r.body || []).some(x => x.id === wo1));
r = await call('GET', '/pm/work-orders?assigned_to=' + encodeURIComponent('Ana Perez'), null, admin);
t('…and by the OLD name still finds them too', (r.body || []).some(x => x.id === wo1));

// The delete guard.
r = await call('DELETE', '/users/nk-op', null, admin);
t('a renamed person with history still cannot be permanently removed', r.status === 409 && r.body?.tasks >= 3, JSON.stringify(r.body).slice(0, 120));

// Certifications and injuries read under the current name.
r = await call('GET', '/certifications', null, admin);
const c = (r.body?.certifications || []).find(x => x.id === cert.id);
t('the certificate reads under her current name, keeping what was filed', c?.person_name === 'Ana Perez-Lopez' && c?.person_name_renamed_from === 'Ana Perez', JSON.stringify(c).slice(0, 120));
r = await call('GET', '/certifications?q=Perez-Lopez', null, admin);
t('searching the NEW name finds a certificate filed under the old one', (r.body?.certifications || []).some(x => x.id === cert.id));
r = await call('GET', '/safety/first-aid?q=Perez-Lopez', null, admin);
t('the injury log finds her by the new name and shows it', (r.body || []).some(x => x.employee_name === 'Ana Perez-Lopez' && x.employee_name_renamed_from === 'Ana Perez'));

// The QA-correction door.
db.prepare("UPDATE production_entries SET qa_action_required = 1, qa_signoff_at = datetime('now') WHERE id = ?").run(entryId);
r = await call('GET', '/production/entries/qa-actions', null, ana2);
t('QA’s correction request still reaches the renamed submitter', (r.body || []).some(x => x.id === entryId), JSON.stringify(r.body).slice(0, 100));
r = await call('PUT', `/production/entries/${entryId}`, { notes: 'Corrected as asked', reason: 'QA asked for the lot number to be checked' }, ana2);
t('…and she may amend her own entry (the invited door)', r.status === 200, JSON.stringify(r.body).slice(0, 120));
r = await call('POST', '/production/entries', { date: today, team: 'Filling', room: '2', product_name: 'Beef', mo_number: 'MO2', lot_number: 'L2', start_time: '06:00', end_time: '14:00', quantity_completed: 5, people_count: 1, submitted_by: 'Keys Admin' }, admin);
db.prepare("UPDATE production_entries SET qa_action_required = 1, qa_signoff_at = datetime('now') WHERE id = ?").run(r.body.id);
r = await call('PUT', `/production/entries/${r.body.id}`, { notes: 'Not mine', reason: "trying somebody else's entry" }, ana2);
t("…but not somebody else's flagged entry (the door is per entry, per filer)", r.status === 403);

// Snapshot columns are untouched.
const snap = db.prepare("SELECT name FROM pragma_table_info('audit_log') WHERE name LIKE '%_id' AND name = 'actor_user_id'").get();
t('audit_log.actor gained no follow-the-rename column', !snap);

db.close();
console.log(`\n${pass}/${pass + fail} assertions passed`); process.exit(fail ? 1 : 0);
