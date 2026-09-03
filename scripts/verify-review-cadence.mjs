// The three "date from now" ratchets, executed against a live server.
//
// Document review, supplier annual review and the daily checklists each
// computed their next due date from the moment somebody pressed the button.
// Each raises its task ahead of the due date, so acting on the day the task
// appeared moved the anniversary earlier every cycle; a late checklist lost
// the days in between. Caller sets PORT + DBPATH. Needs a fresh database.
const PORT = process.env.PORT || 4925;
const B = `http://localhost:${PORT}/api`;
const J = async r => { try { return await r.json(); } catch { return null; } };
let token = null;
const req = (p, o = {}) => fetch(B + p, { ...o, headers: {
  'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(o.headers || {}) } });
const post = (p, b) => req(p, { method: 'POST', body: JSON.stringify(b) });
let pass = 0, fail = 0;
const t = (n, c, d = '') => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (d ? ' — ' + d : '')); } };
const { default: Database } = await import('better-sqlite3');
const { v4: uuid } = await import('uuid');
const { addInterval } = await import('../server/review-cadence.js');
const DB = () => new Database(process.env.DBPATH);
const today = new Date().toISOString().slice(0, 10);
const day = (n) => addInterval(today, { days: n });
const yesterday = day(-1);

{ const db = DB();
  db.prepare(`INSERT OR REPLACE INTO users (id,name,username,role,department,is_active,setup_code,setup_code_expires_at)
    VALUES ('rc-admin','Cadence Admin','Cadence Admin','admin','qa',1,'SC-RC',datetime('now','+7 day'))`).run();
  db.close(); }
await post('/users/login', { name: 'Cadence Admin' });
await post('/users/set-password', { user_id: 'rc-admin', password: 'CadPW2026!', setup_code: 'SC-RC' });
token = (await J(await post('/users/login', { name: 'Cadence Admin', password: 'CadPW2026!' })))?.token;
t('signed in', !!token);

const docRow = (id) => { const d = DB(); const r = d.prepare('SELECT review_due, last_reviewed FROM sop_documents WHERE id = ?').get(id); d.close(); return r; };
const setDue = (id, due) => { const d = DB(); d.prepare('UPDATE sop_documents SET review_due = ? WHERE id = ?').run(due, id); d.close(); };

console.log('\nDocument review from the Review Center (reviewed early)');
const doc = await J(await post('/documents', { doc_number: 'SOP 901', title: 'Cadence test', category: 'quality', revision: 'V1',
  status: 'active', review_frequency: 'annual', review_due: day(20) }));
t('document created with a review due in 20 days', doc?.id && docRow(doc.id)?.review_due === day(20), JSON.stringify(doc).slice(0, 120));
let r = await J(await post('/doc-review/act', { source: 'document-review', ids: [doc.id] }));
t('marked reviewed', r?.done?.includes(doc.id), JSON.stringify(r));
let row = docRow(doc.id);
t('last_reviewed is today', row.last_reviewed === today, row.last_reviewed);
t('THE ANNIVERSARY DID NOT MOVE: next due is the old due date + 12 months', row.review_due === addInterval(day(20), { months: 12 }), `${row.review_due} vs ${addInterval(day(20), { months: 12 })}`);
t('...and not today + 12 months', row.review_due !== addInterval(today, { months: 12 }));

console.log('\nDocument review, three months late');
setDue(doc.id, day(-90));
r = await J(await post('/doc-review/act', { source: 'document-review', ids: [doc.id] }));
row = docRow(doc.id);
t('next due is measured from today, not from the date it was missed', row.review_due === addInterval(today, { months: 12 }), row.review_due);
t('so it is not already in the past', row.review_due > today);

console.log('\nDocument review completed from its TASK, back-dated to yesterday');
setDue(doc.id, day(20));
const woId = uuid();
{ const db = DB();
  db.prepare(`INSERT INTO work_orders (id, title, description, priority, due_date, task_group, document_id, status)
    VALUES (?, 'Review SOP 901: Cadence test', 'Scheduled document review (SQF).', 'normal', ?, 'document_control', ?, 'open')`).run(woId, today, doc.id);
  db.close(); }
r = await J(await post(`/pm/work-orders/${woId}/complete-and-recur`, { notes: 'read, still correct', performed_on: yesterday, late_entry_reason: 'ticked off the morning after' }));
{ const d = DB(); const w = d.prepare('SELECT status FROM work_orders WHERE id = ?').get(woId); d.close();
  t('task completed', w?.status === 'completed', JSON.stringify(r).slice(0, 160)); }
row = docRow(doc.id);
t('last_reviewed is the day the review was PERFORMED (yesterday), not today', row.last_reviewed === yesterday, row.last_reviewed);
t('next due still anchored on the anniversary', row.review_due === addInterval(day(20), { months: 12 }), row.review_due);

console.log('\nSupplier annual review (SOP 404 § IV.B)');
const sid = uuid();
{ const db = DB();
  db.prepare('INSERT INTO suppliers (id, name, actively_using, status) VALUES (?, ?, 1, ?)').run(sid, 'Cadence Vendor', 'unqualified');
  db.close(); }
const criteria = Object.fromEntries(['quality_system','facilities','order_processing','manufacturing_controls','capa','documentation','compliance'].map(k => [k, true]));
const qualDue = (period) => { const d = DB(); const q = d.prepare('SELECT next_review_due FROM supplier_qualifications WHERE supplier_id = ? AND period_label = ?').get(sid, period); d.close(); return q?.next_review_due; };
r = await J(await post(`/suppliers/${sid}/disposition`, { disposition: 'approved', period_label: '2026', risk_criteria: criteria }));
t('first qualification: a year from today', qualDue('2026') === addInterval(today, { months: 12 }), `${qualDue('2026')} / ${JSON.stringify(r).slice(0, 120)}`);
{ const db = DB(); db.prepare("UPDATE supplier_qualifications SET next_review_due = ? WHERE supplier_id = ?").run(day(20), sid); db.close(); }
r = await J(await post(`/suppliers/${sid}/disposition`, { disposition: 'approved', period_label: '2027', risk_criteria: criteria }));
t('reviewed 20 days early: next due is the anniversary + 1 year, not today + 1 year', qualDue('2027') === addInterval(day(20), { months: 12 }), qualDue('2027'));
{ const db = DB(); db.prepare("UPDATE supplier_qualifications SET next_review_due = ? WHERE supplier_id = ?").run(day(-100), sid); db.close(); }
r = await J(await post(`/suppliers/${sid}/disposition`, { disposition: 'approved', period_label: '2028', risk_criteria: criteria }));
t('reviewed 100 days late: next due is a year from today', qualDue('2028') === addInterval(today, { months: 12 }), qualDue('2028'));

console.log('\nA daily checklist completed five days late');
const tmpl = await J(await post('/checklists/templates', { name: 'Cadence daily', type: 'gmp', frequency: 'daily', items: [] }));
t('template created', !!tmpl?.id, JSON.stringify(tmpl).slice(0, 120));
const late = uuid();
{ const db = DB(); db.prepare("INSERT INTO checklist_instances (id, checklist_id, due_date) VALUES (?, ?, ?)").run(late, tmpl.id, day(-5)); db.close(); }
r = await J(await post(`/checklists/instances/${late}/complete`, { submitted_by: 'Cadence Admin', responses: {} }));
t('completed', r?.completed === late, JSON.stringify(r));
t('THE NEXT INSTANCE IS DUE THE DAY AFTER THE ONE THAT WAS DUE (4 days ago), not tomorrow', r?.next_due === day(-4), r?.next_due);
const skipR = await J(await post(`/checklists/instances/${r.next_instance}/skip`, {}));
t('skipped', skipR?.skipped === r.next_instance, JSON.stringify(skipR));
{ const db = DB();
  const nxt = db.prepare("SELECT due_date FROM checklist_instances WHERE checklist_id = ? AND status = 'pending' ORDER BY due_date ASC LIMIT 1").get(tmpl.id);
  db.close();
  t('the skip path advances the same way (3 days ago)', nxt?.due_date === day(-3), nxt?.due_date); }

console.log(`\n${pass}/${pass + fail} assertions passed`);
process.exit(fail ? 1 : 0);
