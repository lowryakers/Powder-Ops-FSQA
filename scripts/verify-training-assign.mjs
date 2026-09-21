// Assigning a training course, end to end against a live server.
//
// The step that did not exist: courses existed and completions were filed
// after the fact by whoever ran the session, but nothing could be HANDED to
// a person. Daniela asked for "the training test" for five new employees and
// the honest answer was that she would have to sit each of them at a screen
// she had access to.
//
// What is asserted is the spine, because it is the part that would be
// expensive to get wrong:
//   - an assignment IS a work order, and it reaches the assignee's own task
//     list rather than a second queue that disagrees with Task Center;
//   - completing it FILES THE TRAINING RECORD — the whole point, and the
//     defect this codebase keeps finding (a check whose completion writes
//     onto the work order and files nothing);
//   - the record is filed for the person it was ASSIGNED to, not whoever
//     pressed Complete;
//   - it cannot be completed with nothing behind it;
//   - assigning twice does not raise two cards.
//
// Caller sets PORT + DBPATH. Needs a fresh database.
const PORT = process.env.PORT || 4993;
const B = `http://localhost:${PORT}/api`;
const J = async r => { try { return await r.json(); } catch { return null; } };
let pass = 0, fail = 0;
const t = (n, c, d = '') => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (d ? ' — ' + d : '')); } };
const tok = {};
const req = (p, o = {}, who = 'dc') => fetch(B + p, { ...o, headers: { 'Content-Type': 'application/json', ...(tok[who] ? { Authorization: `Bearer ${tok[who]}` } : {}), ...(o.headers || {}) } });
const post = (p, b, who) => req(p, { method: 'POST', body: JSON.stringify(b) }, who);
const get = (p, who) => req(p, {}, who);

const { default: Database } = await import('better-sqlite3');
const db = new Database(process.env.DBPATH);

// Document Control assigns; the operator does the course.
const people = [
  ['ta-dc', 'Tessa Control', 'admin', 'document_control', 'SC-TD', '{"training":"edit"}'],
  ['ta-op', 'Gaston Ruiz', 'operator', 'warehouse', 'SC-TO', '{"pm":"edit"}'],
  ['ta-op2', 'Osvaldo Reyes', 'operator', 'warehouse', 'SC-TP', '{"pm":"edit"}'],
  ['ta-sup', 'Wanda Floor', 'supervisor', 'warehouse', 'SC-TS', '{"pm":"edit"}'],
];
for (const [id, name, role, dept, code, access] of people) {
  db.prepare(`INSERT OR REPLACE INTO users (id,name,username,role,department,is_active,setup_code,setup_code_expires_at,module_access)
    VALUES (?,?,?,?,?,1,?,datetime('now','+7 day'),?)`).run(id, name, name, role, dept, code, access);
}
const signIn = async (who, id, name, code, pw) => {
  await post('/users/login', { name });
  await post('/users/set-password', { user_id: id, password: pw, setup_code: code });
  tok[who] = (await J(await post('/users/login', { name, password: pw })))?.token;
};
await signIn('dc', 'ta-dc', 'Tessa Control', 'SC-TD', 'TessaPW2026!');
await signIn('op', 'ta-op', 'Gaston Ruiz', 'SC-TO', 'GastonPW2026!');
await signIn('sup', 'ta-sup', 'Wanda Floor', 'SC-TS', 'WandaPW2026!');
t('everyone signed in', !!tok.dc && !!tok.op && !!tok.sup);

const courses = await J(await get('/training/courses', 'dc'));
const forklift = (courses || []).find(c => c.code === 'FORK-101');
const pj = (courses || []).find(c => c.code === 'PJ-101');
t('the seeded Forklift course carries a test', !!forklift && !!forklift.has_test, JSON.stringify({ code: forklift?.code, has_test: forklift?.has_test }));
t('and the pallet-jack course does not — no test was supplied for it', !!pj && !pj.has_test);

console.log('\n── assigning ──');
const res = await J(await post('/training/assign', {
  course_id: forklift.id, due_date: '2026-10-05', reason: 'New warehouse employee',
  people: [{ user_id: 'ta-op', name: 'Gaston Ruiz' }, { user_id: 'ta-op2', name: 'Osvaldo Reyes' }],
}, 'dc'));
t('two people are assigned in one act', res?.created?.length === 2, JSON.stringify(res).slice(0, 200));
t('each carries the due date that was set', (res.created || []).every(c => c.due_date === '2026-10-05'));
const woId = res.created.find(c => c.user_id === 'ta-op')?.work_order_id;
t('and each is a work order', !!woId);

const again = await J(await post('/training/assign', {
  course_id: forklift.id, people: [{ user_id: 'ta-op', name: 'Gaston Ruiz' }],
}, 'dc'));
t('ASSIGNING IT AGAIN RAISES NOTHING — a second identical card is noise, and noise is what people dismiss',
  again?.created?.length === 0 && again?.skipped?.[0]?.why === 'already assigned', JSON.stringify(again).slice(0, 200));

const ghost = await J(await post('/training/assign', { course_id: forklift.id, people: [{ user_id: 'nobody-at-all', name: 'Ghost' }] }, 'dc'));
t('a person with no account is REPORTED, never invented', ghost?.created?.length === 0 && /no such active account/.test(ghost?.skipped?.[0]?.why || ''));

console.log('\n── it reaches the person ──');
const mine = await J(await get('/pm/operator-tasks', 'op'));
const task = (mine || []).find(x => x.id === woId);
t('IT IS ON THE ASSIGNEE\'S OWN TASK LIST — not a second queue to go and look at', !!task, `${(mine || []).length} task(s)`);
t('the card names the course', /FORK-101/.test(task?.title || ''), task?.title);
t('and it carries the form its completion must fill in', task?.check_form?.kind === 'training' && task?.check_form?.has_test === true,
  JSON.stringify(task?.check_form || null).slice(0, 160));

console.log('\n── completing it files the record ──');
const bare = await fetch(`${B}/pm/work-orders/${woId}/complete-and-recur`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok.op}` },
  body: JSON.stringify({ completed_by: 'Gaston Ruiz' }),
});
const bareBody = await J(bare);
t('IT CANNOT BE COMPLETED WITH NOTHING BEHIND IT — a tick with no result is the fabricated-record refusal in a smaller hat',
  bare.status === 400 && bareBody?.requires_check === true, `${bare.status} ${JSON.stringify(bareBody).slice(0, 140)}`);
t('…and it says what is still needed', /test result/i.test((bareBody?.missing || []).map(m => m.label).join(' ')), JSON.stringify(bareBody?.missing));

const before = db.prepare('SELECT COUNT(*) c FROM training_records').get().c;
// The SUPERVISOR closes it out, on the floor phone — the record must still be
// the operator's.
const done = await fetch(`${B}/pm/work-orders/${woId}/complete-and-recur`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok.sup}` },
  body: JSON.stringify({ completed_by: 'Wanda Floor', check: { score: 95 } }),
});
t('with a result it completes', done.ok, `${done.status} ${JSON.stringify(await J(done)).slice(0, 160)}`);

const recs = db.prepare(`SELECT tr.*, c.code FROM training_records tr LEFT JOIN training_courses c ON c.id = tr.course_id
  WHERE tr.course_id = ? ORDER BY tr.created_at DESC`).all(forklift.id);
t('THE COMPLETION FILED A TRAINING RECORD — the whole point, and the defect this codebase keeps finding',
  db.prepare('SELECT COUNT(*) c FROM training_records').get().c === before + 1, `${before} → ${db.prepare('SELECT COUNT(*) c FROM training_records').get().c}`);
const rec = recs[0];
t('IT IS FILED FOR THE PERSON IT WAS ASSIGNED TO, not whoever pressed Complete',
  rec?.employee_name === 'Gaston Ruiz' && rec?.employee_user_id === 'ta-op', `${rec?.employee_name} / ${rec?.employee_user_id}`);
t('it carries the score, and the pass is graded against the course', rec?.score === 95 && rec?.passed === 1, JSON.stringify({ score: rec?.score, passed: rec?.passed }));
t('and the next one comes due off the course cadence — nothing has to remember 36 months',
  !!rec?.next_due_date && rec.next_due_date.startsWith('2029'), rec?.next_due_date);
t('the task is closed', db.prepare('SELECT status FROM work_orders WHERE id = ?').get(woId).status === 'completed');

console.log('\n── a course with no test asks for the trainer instead ──');
const pjRes = await J(await post('/training/assign', { course_id: pj.id, people: [{ user_id: 'ta-op', name: 'Gaston Ruiz' }] }, 'dc'));
const pjWo = pjRes.created[0].work_order_id;
const pjTasks = await J(await get('/pm/operator-tasks', 'op'));
const pjTask = (pjTasks || []).find(x => x.id === pjWo);
t('it asks for a trainer, not a score', pjTask?.check_form?.has_test === false, JSON.stringify(pjTask?.check_form || null).slice(0, 120));
const pjBare = await fetch(`${B}/pm/work-orders/${pjWo}/complete-and-recur`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok.op}` },
  body: JSON.stringify({ completed_by: 'Gaston Ruiz', check: { score: 90 } }),
});
const pjBareBody = await J(pjBare);
t('a score does not satisfy a course that has no test — "trained by nobody" is not a record',
  pjBare.status === 400 && /delivered/i.test((pjBareBody?.missing || []).map(m => m.label).join(' ')), JSON.stringify(pjBareBody?.missing));
const pjDone = await fetch(`${B}/pm/work-orders/${pjWo}/complete-and-recur`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok.op}` },
  body: JSON.stringify({ completed_by: 'Gaston Ruiz', check: { trainer: 'Juan Gonzalez', method: 'in person' } }),
});
t('with a trainer it completes', pjDone.ok, `${pjDone.status}`);
const pjRec = db.prepare('SELECT * FROM training_records WHERE course_id = ? ORDER BY created_at DESC LIMIT 1').get(pj.id);
t('and the record says who delivered it', pjRec?.trainer === 'Juan Gonzalez' && pjRec?.method === 'in person', JSON.stringify({ trainer: pjRec?.trainer, method: pjRec?.method }));

console.log('\n── what is outstanding, derived from the tasks themselves ──');
const list = await J(await get('/training/assignments', 'dc'));
t('the assignments list is the work orders, so it cannot disagree with Task Center about what is owed',
  Array.isArray(list) && list.length >= 3, `${(list || []).length}`);
t('the completed ones read as done', (list || []).filter(a => a.id === woId).every(a => a.outstanding === false));
t('and Osvaldo\'s is still outstanding', (list || []).some(a => a.assigned_to === 'Osvaldo Reyes' && a.outstanding === true));

db.close();
console.log(`\n${pass}/${pass + fail} assertions passed`);
process.exit(fail ? 1 : 0);
