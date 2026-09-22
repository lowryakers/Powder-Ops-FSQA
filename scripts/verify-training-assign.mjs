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

console.log('\n── several courses in one act ──');
//
// The office hands a warehouse hire four courses, not one. Before this that
// was four passes through the same modal, which is how the fourth gets
// forgotten. What is asserted is that several courses is a LOOP OVER THE SAME
// FUNCTION — every per-person rule the single-course path already enforces has
// to hold unchanged, or the bulk door quietly behaves differently from the one
// the automatic new-hire pass uses.
const all = await J(await get('/training/courses', 'dc'));
const setOf = (all || []).filter(c => c.active !== 0).slice(0, 3);
t('three real courses to assign', setOf.length === 3);

const many = await J(await post('/training/assign', {
  course_ids: setOf.map(c => c.id), due_date: '2026-11-02', reason: 'Warehouse transfer',
  people: [{ user_id: 'ta-sup', name: 'Wanda Floor' }, { user_id: 'ta-op2', name: 'Osvaldo Reyes' }],
}, 'dc'));
t('THREE COURSES TO TWO PEOPLE IS SIX TASKS, raised in one act',
  many?.created?.length === 6, JSON.stringify({ created: many?.created?.length, skipped: many?.skipped?.length }));
t('and it is one task PER COURSE PER PERSON, never one shared card — a course is certified per operator',
  new Set((many.created || []).map(c => `${c.course_id}|${c.user_id}`)).size === 6);
t('THE THREE COUNTS ARE REPORTED SEPARATELY — six tasks is three courses to two people, and "assigned to 6 people" would be false',
  many.courses?.length === 3 && many.people_assigned === 2,
  JSON.stringify({ courses: many.courses?.length, people: many.people_assigned }));
t('every task carries the course it is for, so the result can be read by course rather than as one list',
  (many.created || []).every(c => !!c.course && !!c.course_id));
t('the due date set once applies to all of them', (many.created || []).every(c => c.due_date === '2026-11-02'));

const dupes = await J(await post('/training/assign', {
  course_ids: [setOf[0].id, setOf[0].id], people: [{ user_id: 'ta-op', name: 'Gaston Ruiz' }],
}, 'dc'));
t('THE SAME COURSE PICKED TWICE RAISES ONE TASK — de-duplicated before anything is written, rather than raising a card and then a confusing "already assigned" beside it',
  (dupes?.created?.length || 0) + (dupes?.skipped?.length || 0) === 1,
  JSON.stringify({ c: dupes?.created?.length, s: dupes?.skipped?.length }));

const mixed = await J(await post('/training/assign', {
  course_ids: ['no-such-course', setOf[1].id], people: [{ user_id: 'ta-op', name: 'Gaston Ruiz' }],
}, 'dc'));
t('A COURSE THAT DOES NOT EXIST IS REPORTED AND THE REST STILL GO OUT — refusing the whole request would make the office work out which of five ids was the bad one',
  mixed?.unavailable?.length === 1 && mixed?.courses?.length === 1, JSON.stringify(mixed).slice(0, 160));
const noneAtAll = await post('/training/assign', {
  course_ids: ['no-such-course'], people: [{ user_id: 'ta-op', name: 'Gaston Ruiz' }],
}, 'dc');
t('…but nothing resolving at all is still a 404, because then there was no act', noneAtAll.status === 404, String(noneAtAll.status));
const noCourse = await post('/training/assign', { course_ids: [], people: [{ user_id: 'ta-op', name: 'Gaston Ruiz' }] }, 'dc');
t('an empty list of courses is refused rather than read as "all of them"', noCourse.status === 400, String(noCourse.status));

t('THE SINGLE-COURSE CALLER IS UNTOUCHED — `course_id` still works and still answers with `course`',
  (await J(await post('/training/assign', { course_id: setOf[2].id, people: [{ user_id: 'ta-op', name: 'Gaston Ruiz' }] }, 'dc')))?.course?.id === setOf[2].id);

console.log('\n── already current is skipped only when asked ──');
// FORK-101 was completed by Gaston at the top of this run, so he is current on
// it and Wanda is not. That is the pair the option has to tell apart.
const reTrain = await J(await post('/training/assign', {
  course_ids: [forklift.id], people: [{ user_id: 'ta-op', name: 'Gaston Ruiz' }],
}, 'dc'));
t('BY DEFAULT A RE-TRAIN IS HONOURED — assigning by hand is often deliberate, and the app must not second-guess it',
  reTrain?.created?.length === 1, JSON.stringify(reTrain).slice(0, 160));
// Close it again so the next call is not simply refused as already open.
const reWo = reTrain.created[0].work_order_id;
db.prepare("UPDATE work_orders SET status = 'cancelled' WHERE id = ?").run(reWo);
const skipped = await J(await post('/training/assign', {
  course_ids: [forklift.id], people: [{ user_id: 'ta-op', name: 'Gaston Ruiz' }, { user_id: 'ta-sup', name: 'Wanda Floor' }],
  skip_current: true,
}, 'dc'));
t('WITH THE OPTION ON, SOMEBODY ALREADY CURRENT IS SKIPPED AND SOMEBODY WHO IS NOT STILL GETS IT — re-issuing a whole set to several people is where that becomes the noise people dismiss',
  skipped?.created?.length === 1 && skipped.created[0].name === 'Wanda Floor'
  && skipped?.skipped?.some(x => x.name === 'Gaston Ruiz' && x.why === 'already current'),
  JSON.stringify({ c: (skipped?.created || []).map(x => x.name), s: (skipped?.skipped || []).map(x => `${x.name}:${x.why}`) }));

console.log('\n── AND IT REACHES THE PERSON, not only a screen they may not hold ──');
// The report: "all of the employees that get assigned training don't have
// anything appearing on their end." Every part of the mechanism was working
// and the assignment still reached nobody — three ways, all of them the
// re-clean badge again. See server/training-notify.js.
db.prepare(`INSERT OR REPLACE INTO users (id,name,username,role,department,is_active,setup_code,setup_code_expires_at,module_access)
  VALUES ('ta-none','Nadia Nomods','Nadia Nomods','operator','cleaning',1,'SC-TN',datetime('now','+7 day'),NULL)`).run();
await signIn('none', 'ta-none', 'Nadia Nomods', 'SC-TN', 'NadiaPW2026!');
db.prepare(`INSERT OR REPLACE INTO users (id,name,username,role,department,is_active,module_access)
  VALUES ('ta-other','Otto Other','Otto Other','operator','cleaning',1,'{"production-log":"edit"}')`).run();
const dmsTo = (uid) => db.prepare(`SELECT COUNT(*) c FROM chat_messages m
  JOIN chat_channels ch ON ch.id = m.channel_id
  WHERE ch.kind = 'dm' AND ch.dm_key LIKE ? AND m.body LIKE '%training%'`).get(`%${uid}%`)?.c || 0;

const beforeNone = dmsTo('ta-none'), beforePm = dmsTo('ta-op2');
const reach = await J(await post('/training/assign', {
  course_id: pj.id,
  people: [{ user_id: 'ta-none' }, { user_id: 'ta-other' }, { user_id: 'ta-op2' }],
}, 'dc'));
await new Promise(r => setTimeout(r, 500));
t('all three get a task — nothing here refuses to assign', reach?.created?.length === 3, JSON.stringify(reach?.created?.map(c => c.name)));

const nomods = await get('/pm/operator-tasks', 'none');
t('THE ACCOUNT WITH NO MODULES CANNOT SEE ITS OWN TASK — a NULL map is an empty account, so every guarded mount refuses the read',
  nomods.status === 403, `HTTP ${nomods.status}`);
t('…and the assign screen SAYS SO rather than reporting a clean success',
  (reach?.unreachable || []).some(u => u.name === 'Nadia Nomods' && u.reach?.code === 'no_modules'),
  JSON.stringify(reach?.unreachable));
t('…naming the tick in Settings, never applying it — which module somebody gets is the office\'s decision',
  /Settings/.test((reach?.unreachable || []).find(u => u.name === 'Nadia Nomods')?.reach?.fix || ''));
t('SOMEBODY WITH MODULES BUT NO TASK LIST IS A DIFFERENT GAP and is reported as one',
  (reach?.unreachable || []).some(u => u.name === 'Otto Other' && u.reach?.code === 'message_only'),
  JSON.stringify((reach?.unreachable || []).map(u => `${u.name}:${u.reach?.code}`)));
t('and somebody who holds My Tasks is NOT listed — a warning that fires when nothing is wrong is wallpaper',
  !(reach?.unreachable || []).some(u => u.name === 'Osvaldo Reyes'));

t('THE PERSON IS TOLD, whatever their modules — Messages is not behind the guard and is the one thing every account has',
  dmsTo('ta-none') > beforeNone && dmsTo('ta-op2') > beforePm,
  `none ${beforeNone}->${dmsTo('ta-none')}, pm ${beforePm}->${dmsTo('ta-op2')}`);
const dmBody = db.prepare(`SELECT m.body FROM chat_messages m JOIN chat_channels ch ON ch.id = m.channel_id
  WHERE ch.kind = 'dm' AND ch.dm_key LIKE '%ta-none%' ORDER BY m.created_at DESC LIMIT 1`).get()?.body || '';
t('the message names the course and its due date — "you have training" with neither is an errand, not an instruction',
  /PJ-101/.test(dmBody) && /\d{4}-\d{2}-\d{2}/.test(dmBody), dmBody.replace(/\n/g, ' | ').slice(0, 160));
t('and it says where to look, because a fortnight out the card sits under a collapsed Upcoming header',
  /Upcoming/i.test(dmBody));

console.log('\n── chased, on each task\'s own clock ──');
const { trainingNudges } = await import('../server/training-notify.js');
const quiet = await trainingNudges(db);
t('NOBODY IS CHASED THE MORNING AFTER BEING ASKED', quiet.sent === 0, JSON.stringify(quiet));

db.prepare("UPDATE work_orders SET created_at = datetime('now','-3 days') WHERE training_course_id IS NOT NULL AND assigned_to_id = 'ta-none'").run();
// Give her a second outstanding course, so the grouping is exercised.
await post('/training/assign', { course_id: forklift.id, people: [{ user_id: 'ta-none' }] }, 'dc');
db.prepare("UPDATE work_orders SET created_at = datetime('now','-3 days') WHERE training_course_id IS NOT NULL AND assigned_to_id = 'ta-none'").run();
const beforeChase = dmsTo('ta-none');
const chased = await trainingNudges(db);
t('an assignment two days old IS chased', chased.sent === 1 && chased.people === 1, JSON.stringify(chased));
t('ONE MESSAGE PER PERSON however many courses are outstanding — five DMs in the same second is the noise people dismiss',
  dmsTo('ta-none') === beforeChase + 1, `${beforeChase} -> ${dmsTo('ta-none')}`);
const chaseBody = db.prepare(`SELECT m.body FROM chat_messages m JOIN chat_channels ch ON ch.id = m.channel_id
  WHERE ch.kind = 'dm' AND ch.dm_key LIKE '%ta-none%' ORDER BY m.created_at DESC LIMIT 1`).get()?.body || '';
t('…and it reads as a reminder naming both, not as a fresh request',
  /Still outstanding/i.test(chaseBody) && /FORK-101/.test(chaseBody) && /PJ-101/.test(chaseBody),
  chaseBody.replace(/\n/g, ' | ').slice(0, 170));

const again2 = await trainingNudges(db);
t('THE CLOCK IS ON THE TASK, NOT GLOBAL — a second pass straight afterwards chases nobody', again2.sent === 0, JSON.stringify(again2));

db.prepare("UPDATE work_orders SET status = 'cancelled' WHERE training_course_id IS NOT NULL AND assigned_to_id = 'ta-none'").run();
db.prepare("UPDATE work_orders SET last_nudge_at = NULL WHERE assigned_to_id = 'ta-none'").run();
const cleared = await trainingNudges(db);
t('and doing the course stops it permanently', cleared.sent === 0, JSON.stringify(cleared));

console.log('\n── in a real browser ──');
// A person with nothing assigned yet, so the counts on the result screen are
// unambiguous — everybody above has courses on them by now.
db.prepare(`INSERT OR REPLACE INTO users (id,name,username,role,department,is_active,module_access)
  VALUES ('ta-new','Pilar Nuevo','Pilar Nuevo','operator','warehouse',1,'{"pm":"edit"}')`).run();
const { chromium } = await import('playwright-core');
const URL = `http://localhost:${PORT}`;
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
page.on('pageerror', e => { console.log('  [pageerror]', e.message); fail++; });
await page.goto(`${URL}/manifest.webmanifest`);
await page.evaluate(([tk, u]) => { localStorage.setItem('auth_token', tk); localStorage.setItem('auth_user', JSON.stringify(u)); },
  [tok.dc, { id: 'ta-dc', name: 'Tessa Control', role: 'admin', department: 'document_control' }]);
await page.goto(`${URL}/?tab=training`);
const opened = await page.getByRole('button', { name: /Assign/i }).first().click({ timeout: 20000 })
  .then(() => page.waitForSelector('[data-assign-modal]', { timeout: 10000 })).then(() => true).catch(() => false);
t('the Assign control opens the modal', opened);

if (opened) {
  const boxes = page.locator('[data-assign-modal] [data-assign-course]');
  t('COURSES ARE A LIST OF TICK BOXES, not a single-choice dropdown — picking four is one pass through the form, not four',
    await boxes.count() > 1, `${await boxes.count()}`);
  await boxes.nth(0).check();
  await boxes.nth(1).check();
  t('the form says how many are picked', /2 selected/.test(await page.locator('[data-assign-modal]').innerText()));
  await page.locator('[data-assign-modal] [data-assign-person="Pilar Nuevo"]').check();
  t('the button names what is about to happen rather than a bare Assign',
    /2 courses to 1/.test(await page.locator('[data-assign-submit]').innerText()),
    await page.locator('[data-assign-submit]').innerText());
  const courseText = await page.locator('[data-assign-modal]').innerText();
  t('A COURSE WITH NO TEST DOES NOT PRINT A LITERAL "0" beside its title — SQLite hands back an integer and `{0 && …}` renders it',
    !/Awareness\s+0/.test(courseText) && !/\)\s+0$/m.test(courseText), courseText.split('\n').slice(2, 6).join(' | '));
  t('A GUEST CLIENT IS NOT OFFERED THE PLANT\'S TRAINING — is_external already says they do not work here, and a task on an account with no module reaches nobody',
    await page.locator('[data-assign-modal] [data-assign-person="Cristian"]').count() === 0
    && await page.locator('[data-assign-modal] [data-assign-person]').count() > 0);
  t('the skip-already-current option is there and is OFF by default',
    await page.locator('[data-assign-skip-current]').count() === 1
    && !(await page.locator('[data-assign-skip-current]').isChecked()));
  await page.locator('[data-assign-submit]').click();
  await page.waitForSelector('[data-assign-created]', { timeout: 15000 });
  const said = await page.locator('[data-assign-modal]').innerText();
  t('and the result reads as courses AND people, not one ambiguous number',
    /2 tasks raised/.test(said) && /2 courses/.test(said) && /1 person/.test(said),
    said.replace(/\n/g, ' | ').slice(0, 160));
  t('a person who holds My Tasks raises NO warning strip', await page.locator('[data-assign-unreachable]').count() === 0);

  // And the same screen, assigning to somebody the card will never reach.
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await page.getByRole('button', { name: /Assign/i }).first().click();
  await page.waitForSelector('[data-assign-modal]');
  await page.locator('[data-assign-modal] [data-assign-course]').nth(2).check();
  await page.locator('[data-assign-modal] [data-assign-person="Nadia Nomods"]').check();
  await page.locator('[data-assign-submit]').click();
  await page.waitForSelector('[data-assign-created]', { timeout: 15000 });
  const warned = await page.locator('[data-assign-unreachable]').innerText().catch(() => '');
  t('BUT AN ACCOUNT WITH NO MODULES IS NAMED ON THE SCREEN THAT ASSIGNED IT — "assigned to 5 people" while three hold no task list is a screen stating something untrue',
    /Nadia Nomods/.test(warned) && /Settings/.test(warned), warned.replace(/\n/g, ' | ').slice(0, 200));
  t('…and it still says they were messaged, because that part did work',
    /messaged/i.test(await page.locator('[data-assign-modal]').innerText()));
}
await browser.close();

db.close();
console.log(`\n${pass}/${pass + fail} assertions passed`);
process.exit(fail ? 1 : 0);
