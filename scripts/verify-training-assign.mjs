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

console.log('\n── the test is taken FROM THE TASK, because the floor has no Training module ──');
{
  // Osvaldo still has the Forklift assignment open from the first act.
  const list = await J(await get('/training/assignments', 'dc'));
  const os = (list || []).find(a => a.assigned_to === 'Osvaldo Reyes' && a.outstanding);
  t('Osvaldo still owes the forklift course', !!os);

  // He has no training grant at all — his map is {"pm":"edit"}.
  await signIn('op2', 'ta-op2', 'Osvaldo Reyes', 'SC-TP', 'OsvaldoPW2026!');
  const direct = await fetch(`${B}/training/courses/${forklift.id}/test/attempt`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok.op2}` },
    body: JSON.stringify({ employee_name: 'Osvaldo Reyes', answers: {} }),
  });
  t('HE CANNOT REACH THE TRAINING MODULE — which is right; the floor has no business in the register',
    direct.status === 403, `${direct.status}`);

  const test = await J(await get(`/pm/work-orders/${os.id}/training-test`, 'op2'));
  t('BUT THE ASSIGNMENT IS THE AUTHORIZATION — he can open the test off his own task',
    Array.isArray(test?.questions) && test.questions.length > 0, `${test?.questions?.length} question(s)`);
  t('it says who the record will be for', test?.for === 'Osvaldo Reyes');
  t('THE ANSWER KEY NEVER COMES DOWN', !JSON.stringify(test).includes('correct_answer'));

  // Somebody else's assignment is not his business — 404, not 403.
  const notMine = await fetch(`${B}/pm/work-orders/${pjWo}/training-test`, { headers: { Authorization: `Bearer ${tok.op2}` } });
  t('another person\'s assignment is a 404, never a 403 — whose course it is is not his business', notMine.status === 404, `${notMine.status}`);

  // Fail it first: the task must stay on his list.
  const wrong = Object.fromEntries(test.questions.map(q => [q.id, 'definitely not the answer']));
  const failed = await J(await post(`/pm/work-orders/${os.id}/training-test`, { answers: wrong }, 'op2'));
  t('failing is recorded and does not pass him', failed?.passed === false, JSON.stringify(failed).slice(0, 120));
  t('…and the task STAYS on his list — he can take it again',
    db.prepare('SELECT status FROM work_orders WHERE id = ?').get(os.id).status !== 'completed');
  t('no training record is filed for a fail', !db.prepare(
    "SELECT 1 FROM training_records WHERE course_id = ? AND employee_user_id = 'ta-op2'").get(forklift.id));

  // Now pass it, using the seeded answer key.
  const key = db.prepare(`SELECT q.id, q.correct_answer FROM training_questions q
    JOIN training_tests t ON t.id = q.test_id WHERE t.course_id = ? AND t.is_current = 1`).all(forklift.id);
  const right = Object.fromEntries(key.map(q => [q.id, q.correct_answer]));
  const ok = await J(await post(`/pm/work-orders/${os.id}/training-test`, { answers: right }, 'op2'));
  t('passing scores 100', ok?.passed === true && ok?.score === 100, JSON.stringify(ok).slice(0, 140));
  t('PASSING IS THE COMPLETION — the record is filed there and then', !!ok?.record_id);
  t('…and the task closes with it, so it does not sit on his phone after he passed',
    ok?.work_order_completed === true && db.prepare('SELECT status FROM work_orders WHERE id = ?').get(os.id).status === 'completed');
  const orec = db.prepare("SELECT * FROM training_records WHERE id = ?").get(ok.record_id);
  t('the record is HIS, with the score and the method', orec?.employee_user_id === 'ta-op2' && orec?.score === 100 && orec?.method === 'online_test',
    JSON.stringify({ who: orec?.employee_name, score: orec?.score, method: orec?.method }));
  t('and exactly ONE record was filed — not one from the test and another from a completion',
    db.prepare("SELECT COUNT(*) c FROM training_records WHERE course_id = ? AND employee_user_id = 'ta-op2'").get(forklift.id).c === 1);

  const after = await fetch(`${B}/pm/work-orders/${os.id}/training-test`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok.op2}` }, body: JSON.stringify({ answers: right }),
  });
  t('a closed task refuses another attempt', after.status === 409, `${after.status}`);
}

console.log('\n── a new hire is assigned what they owe, the moment the account exists ──');
{
  const created = await J(await post('/onboarding', {
    first_name: 'Nipsi', last_name: 'Batchman', position: 'Stick pack operator',
    department: 'batching', team: 'Batching', start_date: '2026-10-01',
  }, 'dc'));
  t('an onboarding is started', !!created?.id, JSON.stringify(created || {}).slice(0, 120));
  const done = await J(await post(`/onboarding/${created.id}/complete`, { create_account: true }, 'dc'));
  const tr2 = done?.training;
  t('COMPLETING IT ASSIGNS THE TRAINING THEY OWE — nothing has to be remembered',
    (tr2?.created?.length || 0) > 0, JSON.stringify(tr2?.created?.map(c => c.course) || []));

  const got = (tr2?.created || []).map(c => c.course);
  t('the universal courses are in it — GMP, allergen, hygiene, the new-hire orientation',
    ['GMP-101', 'ALG-101', 'HYG-101', 'ONB-101'].every(c => got.includes(c)), JSON.stringify(got));
  t('BATCHING GETS THE BATCHING ONES — the mixer, and forklift', got.includes('WI021') && got.includes('FORK-101'), JSON.stringify(got));
  t('…AND NOT THE FILLING LINE\'S, which is the whole point of reading the course\'s own departments',
    !got.includes('WI003') && !got.includes('WI007'), JSON.stringify(got));
  t('nor the ones restricted to admins and supervisors', !got.includes('HACCP-201'), JSON.stringify(got));
  t('they get THIRTY days, not the usual fortnight — a new starter is learning the job itself',
    (tr2?.created || []).every(c => c.due_date === tr2.due_date) && tr2.due_date > new Date(Date.now() + 25 * 86400000).toISOString().slice(0, 10),
    tr2?.due_date);

  const uid = db.prepare("SELECT id FROM users WHERE name = 'Nipsi Batchman'").get()?.id;
  const theirs = db.prepare(`SELECT COUNT(*) c FROM work_orders WHERE training_course_id IS NOT NULL AND assigned_to_id = ?`).get(uid).c;
  t('and every one of them is a real task on their own list', theirs === tr2.created.length, `${theirs} vs ${tr2.created.length}`);

  // Completing a SECOND time must not double them up.
  const twice = await J(await post(`/onboarding/${created.id}/complete`, { create_account: true }, 'dc'));
  t('COMPLETING IT AGAIN RAISES NOTHING — the office pressing the button twice is not two sets of training',
    (twice?.training?.created?.length || 0) === 0 && (twice?.training?.skipped?.length || 0) > 0,
    JSON.stringify({ c: twice?.training?.created?.length, s: twice?.training?.skipped?.length }));
}

console.log('\n── what is outstanding, derived from the tasks themselves ──');
const list = await J(await get('/training/assignments', 'dc'));
t('the assignments list is the work orders, so it cannot disagree with Task Center about what is owed',
  Array.isArray(list) && list.length >= 3, `${(list || []).length}`);
t('the completed ones read as done', (list || []).filter(a => a.id === woId).every(a => a.outstanding === false));
t('Osvaldo\'s reads done too — he passed it off his own task, and the list follows the work order',
  (list || []).some(a => a.assigned_to === 'Osvaldo Reyes' && a.course_code === 'FORK-101' && a.outstanding === false));
t('and the new hire\'s whole set is outstanding',
  (list || []).filter(a => a.assigned_to === 'Nipsi Batchman' && a.outstanding).length >= 4,
  String((list || []).filter(a => a.assigned_to === 'Nipsi Batchman' && a.outstanding).length));

db.close();
console.log(`\n${pass}/${pass + fail} assertions passed`);
process.exit(fail ? 1 : 0);
