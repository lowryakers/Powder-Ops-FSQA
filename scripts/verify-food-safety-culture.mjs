// D-211: the food safety culture program — the concern log, the supervisor's
// monthly check (two doors, one writer), the month's summary, the bell line,
// the review meeting type, and the screens.
//
// What this proves:
//   - anybody who works here can raise a concern; a guest cannot;
//   - "without a name" is refused until an admin allows it, and then no name
//     and no account id are stored at all (and the audit row carries none);
//   - a person reads their own named concerns, a reviewer reads them all, and
//     closing one needs words;
//   - the monthly check is refused while anything is missing, files once, and
//     each concern from the team talk lands in the log for that department;
//   - the same check filed from a quality-schedule task is the same record;
//   - the summary's figures equal the rows; the bell counts the open ones;
//   - "Food Safety Culture Review" is a meeting type.
//
// Caller sets PORT + DBPATH on a FRESH database.
import { chromium } from 'playwright-core';

const PORT = process.env.PORT || 5127;
const URL = `http://localhost:${PORT}`;
let pass = 0, fail = 0;
const t = (n, c, d = '') => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (d ? ' — ' + d : '')); } };

const { default: Database } = await import('better-sqlite3');
const db = new Database(process.env.DBPATH || process.env.DB_PATH);
db.pragma('busy_timeout = 10000');
// Server modules imported here only READ through `db` (or write through it); nothing calls db.js,
// which would open a second connection and run migrations against the server's file.
const mk = (id, name, role, dept, ma, ext = 0) => db.prepare(`INSERT OR REPLACE INTO users (id, name, username, role, department, is_active, is_external, module_access, setup_code, setup_code_expires_at)
  VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, datetime('now','+7 day'))`).run(id, name, name, role, dept, ext, ma ? JSON.stringify(ma) : null, `SC-${id}`);
mk('fc-admin', 'Culture Admin', 'admin', 'quality', null);
mk('fc-qa', 'Culture Quality', 'operator', 'qa', { 'qa-review': 'view' });
mk('fc-sup', 'Culture Super', 'supervisor', 'batching', { operator: 'view' });
mk('fc-op', 'Culture Operator', 'operator', 'batching', null);
mk('fc-op2', 'Culture Other', 'operator', 'filling', null);
mk('fc-ext', 'Culture Guest', 'operator', null, null, 1);

const H = { 'Content-Type': 'application/json' };
const call = async (method, p, body, headers = H) => {
  const r = await fetch(`${URL}/api${p}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  let j = null; try { j = await r.json(); } catch { /* none */ }
  return { status: r.status, body: j };
};
const login = async (id, name) => {
  await call('POST', '/users/set-password', { user_id: id, password: 'Culture2026!!', setup_code: `SC-${id}` });
  const tok = (await call('POST', '/users/login', { name, password: 'Culture2026!!' })).body?.token;
  return { ...H, Authorization: `Bearer ${tok}` };
};
const A = await login('fc-admin', 'Culture Admin');
const Q = await login('fc-qa', 'Culture Quality');
const S = await login('fc-sup', 'Culture Super');
const O = await login('fc-op', 'Culture Operator');
const O2 = await login('fc-op2', 'Culture Other');
const X = await login('fc-ext', 'Culture Guest');
const today = db.prepare("SELECT date('now') d").get().d;
const month = today.slice(0, 7);

console.log('── who may do what ──');
let r = await call('GET', '/culture/meta', undefined, O);
t('an operator with no modules can reach the program and raise a concern', r.status === 200 && r.body.can_review === false && r.body.can_file_check === false && r.body.categories.length === 5, JSON.stringify(r.body).slice(0, 160));
t('…and "without a name" is ON from the first boot (Daniela, D-213)', r.body.anonymous_allowed === true);
t('the check form carries her six safety items', r.body.check_form.safety_items.length === 6 && r.body.check_form.safety_items.some(i => /pallet/i.test(i.label)));
t('the departments read in the plant\'s words — Sanitation, Production', r.body.departments[0].label === 'Sanitation' && r.body.departments[1].label === 'Production');
await call('PUT', '/culture/settings', { anonymous_allowed: false }, A);
t('a supervisor may file the check; QA reviews', (await call('GET', '/culture/meta', undefined, S)).body.can_file_check === true
  && (await call('GET', '/culture/meta', undefined, Q)).body.can_review === true);
r = await call('POST', '/culture/concerns', { category: 'gmp', description: 'x' }, X);
t('a guest account is refused (404, not 403)', r.status === 404, String(r.status));

console.log('\n── raising a concern ──');
r = await call('POST', '/culture/concerns', { category: 'sanitation', description: 'Sink by Room 2 had no soap all morning' }, O);
const named = r.body?.id;
t('an operator raises a named concern', r.status === 201 && !!named, JSON.stringify(r.body));
const row = db.prepare('SELECT * FROM culture_concerns WHERE id = ?').get(named);
t('…it carries their name, their department and "raised directly"', row.raised_by === 'Culture Operator' && row.department === 'batching' && row.source === 'direct' && row.anonymous === 0);
r = await call('POST', '/culture/concerns', { category: 'gmp' , description: 'no' }, O);
t('a two-letter concern is refused', r.status === 400);
r = await call('POST', '/culture/concerns', { category: 'nonsense', description: 'Something about hairnets' }, O);
t('an unknown topic is refused', r.status === 400);
r = await call('POST', '/culture/concerns', { category: 'safety', description: 'Forklift going too fast near the dock', anonymous: true }, O);
t('"without a name" is REFUSED while the plant has not allowed it', r.status === 400 && /name/i.test(r.body?.error || ''), JSON.stringify(r.body));
r = await call('PUT', '/culture/settings', { anonymous_allowed: true }, S);
t('only an admin turns it on (403 for a supervisor)', r.status === 403);
r = await call('PUT', '/culture/settings', { anonymous_allowed: true }, A);
t('an admin allows it', r.status === 200 && r.body.anonymous_allowed === true);
r = await call('POST', '/culture/concerns', { category: 'safety', description: 'Forklift going too fast near the dock', anonymous: true }, O);
const anonId = r.body?.id;
const anonRow = db.prepare('SELECT * FROM culture_concerns WHERE id = ?').get(anonId);
t('an anonymous concern stores NO name and NO account id', r.status === 201 && anonRow.anonymous === 1 && anonRow.raised_by === null && anonRow.raised_by_id === null, JSON.stringify(anonRow));
const anonAudit = db.prepare("SELECT actor, actor_id FROM audit_log WHERE entity_type = 'culture_concern' AND entity_id = ?").get(anonId);
t('…and its audit row names nobody', anonAudit && anonAudit.actor === 'anonymous' && !anonAudit.actor_id, JSON.stringify(anonAudit));
await call('POST', '/culture/concerns', { category: 'food_defense', description: 'Side door left propped open at lunch' }, O2);

console.log('\n── who reads what ──');
r = await call('GET', '/culture/concerns', undefined, O);
t('an operator reads only their own NAMED concern (the anonymous one cannot be found again)', r.body.length === 1 && r.body[0].id === named && r.body[0].is_mine, JSON.stringify(r.body.map(x => x.id)));
r = await call('GET', '/culture/concerns?status=open', undefined, Q);
t('QA reads every concern', r.body.length === 3, String(r.body.length));
t('…the anonymous one shows no name to QA either', r.body.find(x => x.id === anonId)?.raised_by === null);
r = await call('GET', '/culture/summary', undefined, O);
t('the summary is for reviewers (403 for an operator)', r.status === 403);

console.log('\n── answering ──');
r = await call('POST', `/culture/concerns/${named}/respond`, { status: 'closed', response: '' }, Q);
t('closing with no words is refused', r.status === 400);
r = await call('POST', `/culture/concerns/${named}/respond`, { status: 'closed', response: 'Refill added to the Room 2 checklist; restocked today.' }, O);
t('an operator cannot answer (403)', r.status === 403);
r = await call('POST', `/culture/concerns/${named}/respond`, { status: 'closed', response: 'Refill added to the Room 2 checklist; restocked today.' }, Q);
t('QA closes it with what was done', r.status === 200 && r.body.status === 'closed');
r = await call('GET', '/culture/concerns', undefined, O);
t('…and the operator reads the answer on their own concern', /Room 2 checklist/.test(r.body[0]?.response || ''));

console.log('\n── the supervisor\'s monthly check (page door) ──');
const { GMP_WALK_ITEMS, CULTURE_SAFETY_ITEMS } = await import('../shared/check-forms.js');
const allC = Object.fromEntries([...GMP_WALK_ITEMS, ...CULTURE_SAFETY_ITEMS].map(i => [i.key, { result: 'c' }]));
r = await call('POST', '/culture/checks', { department: 'batching' }, S);
t('a blank check is refused and names what is missing', r.status === 400 && r.body.missing?.length >= 7, JSON.stringify(r.body).slice(0, 200));
r = await call('POST', '/culture/checks', { department: 'batching', items: allC, observation_note: 'Good', talk_date: today, talk_attendees: 6 }, O);
t('an operator cannot file it (403)', r.status === 403);
r = await call('POST', '/culture/checks', {
  department: 'batching', items: { ...allC, hairnets: { result: 'nc', note: 'Two people without beard covers' } },
  observation_note: 'Gowning good overall; beard covers slipping at end of shift.', talk_date: today, talk_attendees: 7,
  concerns: [{ category: 'gmp', description: 'Beard covers run out on the late shift' }, { category: '', description: '' }],
}, S);
t('a supervisor files a complete check', r.status === 201 && r.body.nc_count === 1 && r.body.concern_ids.length === 1, JSON.stringify(r.body));
const talk = db.prepare('SELECT * FROM culture_concerns WHERE id = ?').get(r.body.concern_ids[0]);
t('the concern from the team talk is in the log, for that department, named for the supervisor', talk.source === 'team_talk' && talk.department === 'batching' && talk.raised_by === 'Culture Super' && talk.culture_check_id === r.body.id);
const chk = db.prepare('SELECT * FROM culture_checks WHERE id = ?').get(r.body.id);
t('the check is stamped DRAFT-1 and filed from the page', chk.checklist_revision === 'DRAFT-1' && chk.source === 'page' && chk.talk_attendees === 7);

console.log('\n── the same record from a task (task door) ──');
db.prepare(`INSERT INTO quality_schedules (id, title, module_id, frequency_type, frequency_value, next_due, is_active)
  VALUES ('fc-qs', 'Monthly Culture Check — Filling', 'GMP', 'monthly', 1, date('now','+20 day'), 1)`).run();
db.prepare(`INSERT INTO work_orders (id, title, description, priority, due_date, procedure_steps, task_group, quality_schedule_id, status)
  VALUES ('fc-wo', 'Monthly Culture Check — Filling', 'x', 'normal', date('now'), '[]', 'qa', 'fc-qs', 'open')`).run();
const tasks = (await call('GET', '/pm/operator-tasks?limit=500', undefined, A)).body;
const task = (Array.isArray(tasks) ? tasks : tasks.tasks || []).find(w => w.id === 'fc-wo');
t('the task carries the culture form with its department from the title', task?.check_form?.kind === 'culture_check' && task.check_form.department === 'filling', JSON.stringify(task?.check_form || {}).slice(0, 160));
r = await call('POST', '/pm/work-orders/fc-wo/complete-and-recur', { completed_by: 'Culture Other', check: { items: allC, observation_note: 'x', talk_date: today, talk_attendees: 3 } }, O2);
t('an operator on the team cannot file the supervisor\'s check from the task (403)', r.status === 403, String(r.status));
r = await call('POST', '/pm/work-orders/fc-wo/complete-and-recur', { completed_by: 'Culture Admin', check: { items: allC } }, A);
t('completing it half-filled is refused', r.status === 400, String(r.status));
r = await call('POST', '/pm/work-orders/fc-wo/complete-and-recur', { completed_by: 'Culture Admin', check: { items: allC, observation_note: 'All good on Filling.', talk_date: today, talk_attendees: 4 } }, A);
const taskChk = db.prepare("SELECT * FROM culture_checks WHERE work_order_id = 'fc-wo'").get();
t('completing it files the same record, from the task, for Filling', r.status < 300 && taskChk?.source === 'task' && taskChk.department === 'filling', `${r.status} ${JSON.stringify(r.body).slice(0, 160)}`);

console.log('\n── Daniela\'s answers, seeded once (D-213) ──');
const culture = await import('../server/culture.js');
const qsRows = db.prepare("SELECT title, task_group, frequency_type, is_active, next_due FROM quality_schedules WHERE module_id = 'Food Safety Culture' ORDER BY title").all();
const byTitle = Object.fromEntries(qsRows.map(q => [q.title, q]));
t('five monthly checks, one per department, each routed to its team',
  byTitle['Monthly Culture Check — Sanitation']?.task_group === 'cleaning' && byTitle['Monthly Culture Check — Production']?.task_group === 'filling'
  && byTitle['Monthly Culture Check — Batching']?.task_group === 'batching' && byTitle['Monthly Culture Check — Kitting']?.task_group === 'kitting'
  && byTitle['Monthly Culture Check — Warehouse']?.task_group === 'warehouse', JSON.stringify(qsRows.map(q => q.title)));
t('…and a monthly review for Document Control on the 1st', byTitle['Monthly Food Safety Culture Review']?.task_group === 'document_control' && byTitle['Monthly Food Safety Culture Review'].next_due.endsWith('-01'));
const mtg = db.prepare("SELECT * FROM meetings WHERE meeting_type = 'Food Safety Culture Review'").all();
t('the first review meeting is scheduled on an open day at the start of next month', mtg.length === 1 && mtg[0].meeting_date > today && Number(mtg[0].meeting_date.slice(8)) <= 7, JSON.stringify(mtg.map(m => m.meeting_date)));
const inv = culture.reviewAttendees(db).map(u => u.name);
t('who is asked: admin, QA / Document Control and supervisors — not operators or guests',
  inv.includes('Culture Admin') && inv.includes('Culture Quality') && inv.includes('Culture Super') && !inv.includes('Culture Operator') && !inv.includes('Culture Guest'));
mk('fc-jo1', 'Jose Uno', 'operator', 'batching', null);
mk('fc-jo2', 'José Luna', 'supervisor', 'kitting', null);
mk('fc-ju1', 'Juana Gonzalez', 'operator', 'warehouse', null);
mk('fc-ju2', 'Juan Gonzalez', 'supervisor', 'warehouse', null);
mk('fc-de1', 'Debora One', 'supervisor', 'filling', null);
mk('fc-de2', 'Debora Two', 'supervisor', 'batching', null);
mk('fc-de3', 'Debora Three', 'supervisor', 'kitting', null);
t('"Jose" is the kitting supervisor, accents folded, not the operator', culture.resolveSupervisor(db, 'Jose', 'kitting').user?.name === 'José Luna');
t('"Juan" is Juan, never Juana', culture.resolveSupervisor(db, 'Juan', 'warehouse').user?.name === 'Juan Gonzalez');
t('"Debora" narrows to the supervisor on the team', culture.resolveSupervisor(db, 'Debora', 'filling').user?.name === 'Debora One');
const amb = culture.resolveSupervisor(db, 'Debora', 'cleaning');
t('…and two people the team cannot tell apart are REPORTED, never guessed', amb.user === null && amb.candidates.length === 3);
db.prepare("UPDATE quality_schedules SET is_active = 0 WHERE title = 'Monthly Culture Check — Kitting'").run();
const again = culture.seedCultureProgram(db);
t('a second boot changes nothing — a paused check stays paused', again.length === 0
  && db.prepare("SELECT is_active FROM quality_schedules WHERE title = 'Monthly Culture Check — Kitting'").get().is_active === 0
  && db.prepare("SELECT COUNT(*) c FROM quality_schedules WHERE module_id = 'Food Safety Culture'").get().c === 6);
db.prepare("UPDATE quality_schedules SET is_active = 1 WHERE title = 'Monthly Culture Check — Kitting'").run();
db.prepare(`INSERT INTO quality_schedules (id, title, module_id, frequency_type, frequency_value, next_due, is_active, task_group, assigned_to)
  VALUES ('fc-qs2', 'Monthly Culture Check — Kitting (test)', 'x', 'monthly', 1, date('now'), 1, 'kitting', 'Culture Super')`).run();
await call('GET', '/pm/operator-tasks?limit=500', undefined, A);   // housekeeping raises it (HOUSEKEEPING_MS=0)
const gen = db.prepare("SELECT task_group, assigned_to FROM work_orders WHERE quality_schedule_id = 'fc-qs2'").get();
t('a raised check goes to its team, named for its supervisor (not QA)', gen?.task_group === 'kitting' && gen.assigned_to === 'Culture Super', JSON.stringify(gen));
const older = db.prepare("SELECT task_group FROM work_orders WHERE quality_schedule_id = (SELECT id FROM quality_schedules WHERE title = 'Tap Water Testing')").get();
t('a schedule that names no team is still QA\'s', !older || older.task_group === 'qa');
db.prepare("DELETE FROM work_orders WHERE quality_schedule_id = 'fc-qs2'").run();

console.log('\n── the month ──');
const sum = (await call('GET', `/culture/summary?month=${month}`, undefined, Q)).body;
const raised = db.prepare('SELECT COUNT(*) c FROM culture_concerns WHERE raised_on LIKE ?').get(`${month}%`).c;
t('concerns raised equals the rows', sum.current.concerns.raised === raised && raised === 4, `${sum.current.concerns.raised} vs ${raised}`);
t('…split into direct, team talk and without a name', sum.current.concerns.raised_directly === 3 && sum.current.concerns.from_team_talks === 1 && sum.current.concerns.anonymous === 1);
t('checks filed: two, one per department', sum.current.checks.filed === 2 && sum.current.checks.by_department.batching === 1 && sum.current.checks.by_department.filling === 1);
t('the item not compliant is named', sum.current.observed_not_compliant.some(x => /Hairnets/.test(x.label) && x.count === 1));
t('last month is beside it, and empty', sum.previous.concerns.raised === 0 && sum.previous_month < month);
t('the reading note is there: fewer concerns is not a stronger culture', /not by itself a stronger culture/.test(sum.reading_note));
t('still open counts the three not closed', sum.still_open.count === 3);

console.log('\n── reaching the people who answer ──');
const bell = (await call('GET', '/compliance/notifications', undefined, Q)).body;
const line = (bell.items || bell.notifications || bell || []).find?.(x => x.id === 'culture-concerns');
const open = db.prepare("SELECT COUNT(*) c FROM culture_concerns WHERE status = 'open'").get().c;
t('QA\'s bell counts the unanswered concerns', line?.count === open && line.tab === 'food-safety-culture', JSON.stringify(line));
const opBell = (await call('GET', '/compliance/notifications', undefined, O)).body;
t('an operator\'s bell does not', !((opBell.items || opBell.notifications || opBell || []).some?.(x => x.id === 'culture-concerns')));
t('"Food Safety Culture Review" is a meeting type', !!db.prepare("SELECT 1 FROM app_list_options WHERE list_key = 'meeting_types' AND value = 'Food Safety Culture Review'").get());

console.log('\n── the screens ──');
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' }).catch(() => chromium.launch());
const asUser = async (headers, id, w, h) => {
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  await page.goto(`${URL}/manifest.webmanifest`);
  const me = (await call('GET', '/users/me', undefined, headers)).body;
  const tok = headers.Authorization.slice(7);
  await page.evaluate(([tk, u]) => { localStorage.setItem('auth_token', tk); localStorage.setItem('auth_user', JSON.stringify(u)); }, [tok, me]);
  return page;
};
const op = await asUser(O2, 'fc-op2', 390, 900);
await op.goto(`${URL}/?tab=operator`);
await op.waitForSelector('[data-raise-concern]', { timeout: 10000 }).catch(() => {});
t('the Operator View offers "Raise a concern" on a phone', (await op.locator('[data-raise-concern]').count()) >= 1);
await op.locator('[data-raise-concern]').first().click().catch(() => {});
await op.waitForSelector('[data-concern-form]', { timeout: 5000 }).catch(() => {});
await op.selectOption('[data-concern-category]', 'safety').catch(() => {});
await op.fill('[data-concern-text]', 'Wet floor by the filling line, no sign').catch(() => {});
t('…with "leave my name off" shown now it is allowed', (await op.locator('[data-concern-anon]').count()) === 1);
await op.locator('[data-concern-send]').click().catch(() => {});
await op.waitForSelector('[data-concern-thanks]', { timeout: 5000 }).catch(() => {});
t('…and sending it thanks the person and files it', (await op.locator('[data-concern-thanks]').count()) === 1
  && !!db.prepare("SELECT 1 FROM culture_concerns WHERE description = 'Wet floor by the filling line, no sign' AND raised_by = 'Culture Other'").get());
t('…with no sideways scroll at 390px', !(await op.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)));
const qa = await asUser(Q, 'fc-qa', 1280, 900);
await qa.goto(`${URL}/?tab=food-safety-culture`);
await qa.waitForSelector('[data-culture-summary]', { timeout: 10000 }).catch(() => {});
t('QA opens Food Safety Culture on this month', (await qa.locator(`[data-culture-summary="${month}"]`).count()) === 1);
t('…and the raised figure is the rows', (await qa.locator('[data-figure="raised"]').innerText().catch(() => '')).includes(String(raised + 1)));
await browser.close();

db.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
