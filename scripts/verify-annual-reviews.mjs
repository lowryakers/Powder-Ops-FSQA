// The two annual reviews an SQF audit asks for: the site management review
// (SQF 2.1.2.1) and the Food Defense Plan challenge (SOP 434 V3 § 5.0).
//
// Both ride the check-record interface (D-060): an annual quality schedule
// raises the task, completing it files the record, and the record carries the
// items as filed. The by-hand door records one that already happened — the
// plant ran a Food Defense challenge in March — through the SAME writer,
// stamped `source: 'paper'`.
//
// Caller sets PORT + DBPATH on a FRESH database.
import crypto from 'crypto';
const PORT = process.env.PORT || 4993;
const URL = `http://localhost:${PORT}`;
let pass = 0, fail = 0;
const t = (n, c, d = '') => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (d ? ' — ' + d : '')); } };

const { MANAGEMENT_REVIEW_ITEMS, FOOD_DEFENSE_ITEMS, FOOD_DEFENSE_METHODS, missingForCheck, checkKindFor } =
  await import('../shared/check-forms.js');

// ── The transcription, before anything is stood up ──────────────────────────
t('SQF 2.1.2.1 has all eight items, i through viii',
  MANAGEMENT_REVIEW_ITEMS.length === 8
  && MANAGEMENT_REVIEW_ITEMS.map(i => i.roman).join(',') === 'i,ii,iii,iv,v,vi,vii,viii',
  MANAGEMENT_REVIEW_ITEMS.map(i => i.roman).join(','));
t('item vi is the recalls and regulatory issues line the screenshot flags',
  /recalls and regulatory issues/i.test(MANAGEMENT_REVIEW_ITEMS[5].label), MANAGEMENT_REVIEW_ITEMS[5].label);
t('the clause wording is transcribed, not paraphrased',
  /Performance towards food safety culture assessment plan/.test(MANAGEMENT_REVIEW_ITEMS[3].label)
  && /Updates to all hazard analyses and risk assessments/.test(MANAGEMENT_REVIEW_ITEMS[6].label));
t('SOP 434 § 5.0 covers preparation through corrective actions',
  FOOD_DEFENSE_ITEMS.length === 9
  && FOOD_DEFENSE_ITEMS[0].clause === '5.1 B' && FOOD_DEFENSE_ITEMS.at(-1).clause === '5.3');
t('the five challenge methods the SOP names are offered', FOOD_DEFENSE_METHODS.length === 5
  && FOOD_DEFENSE_METHODS.some(m => /unauthorized entry/i.test(m.label)));
t('the seeded titles resolve to their kinds',
  checkKindFor({ title: 'Annual Management Review (SQF 2.1.2.1)' }) === 'management_review'
  && checkKindFor({ title: 'Annual Food Defense Plan Challenge (SOP 434)' }) === 'food_defense_challenge');
t('an ordinary schedule is untouched', checkKindFor({ title: 'Daily Scale PM' }) === null);

// A REVIEW CANNOT BE HALF-ANSWERED.
const mrForm = { kind: 'management_review', items: MANAGEMENT_REVIEW_ITEMS };
t('a blank management review names every one of the eight',
  missingForCheck(mrForm, {}).length === 9, JSON.stringify(missingForCheck(mrForm, {}).length));
const allDone = { attendees: 'A', items: Object.fromEntries(MANAGEMENT_REVIEW_ITEMS.map(i => [i.key, { result: 'done' }])) };
t('all eight reviewed is complete', missingForCheck(mrForm, allDone).length === 0);
const oneNa = { ...allDone, items: { ...allDone.items, vi_recalls: { result: 'na' } } };
t('N/A WITHOUT A REASON IS REFUSED — the clause requires all eight',
  missingForCheck(mrForm, oneNa).some(m => m.key === 'vi_recalls_note'), JSON.stringify(missingForCheck(mrForm, oneNa)));
t('N/A with a reason is accepted',
  missingForCheck(mrForm, { ...allDone, items: { ...allDone.items, vi_recalls: { result: 'na', note: 'No recalls or regulatory contacts this year' } } }).length === 0);

const fdForm = { kind: 'food_defense_challenge', items: FOOD_DEFENSE_ITEMS, methods: FOOD_DEFENSE_METHODS };
const fdDone = {
  team: 'A', outcome: 'x', findings: 'y', corrective_actions: 'none',
  methods: ['mock_scenario'],
  items: Object.fromEntries(FOOD_DEFENSE_ITEMS.map(i => [i.key, { result: 'done' }])),
};
t('a challenge with no method used is REFUSED (§ 5.2 C says one must be)',
  missingForCheck(fdForm, { ...fdDone, methods: [] }).some(m => m.key === 'methods'));
t('a complete challenge passes', missingForCheck(fdForm, fdDone).length === 0);

// ── Live ────────────────────────────────────────────────────────────────────
const { default: Database } = await import('better-sqlite3');
{
  const db = new Database(process.env.DBPATH);
  db.prepare(`INSERT OR REPLACE INTO users (id, name, username, role, department, is_active, module_access, setup_code, setup_code_expires_at)
    VALUES ('ar-a','Annual Admin','Annual Admin','admin','quality',1,'{"quality-schedules":"edit","pm":"edit"}','SC-AR', datetime('now','+7 day'))`).run();
  db.prepare(`INSERT OR REPLACE INTO users (id, name, username, role, department, is_active, module_access, setup_code, setup_code_expires_at)
    VALUES ('ar-o','Annual Op','Annual Op','operator','warehouse',1,'{"quality-schedules":"view"}','SC-AO', datetime('now','+7 day'))`).run();
  db.close();
}
const H = { 'Content-Type': 'application/json' };
const post = (p, body, headers = H) => fetch(`${URL}/api${p}`, { method: 'POST', headers, body: JSON.stringify(body) });
async function signIn(name, id, code, pw) {
  await post('/users/login', { name });
  await post('/users/set-password', { user_id: id, password: pw, setup_code: code });
  return (await post('/users/login', { name, password: pw })).json();
}
const auth = await signIn('Annual Admin', 'ar-a', 'SC-AR', 'Annual2026!');
const op = await signIn('Annual Op', 'ar-o', 'SC-AO', 'AnnualOp26!');
const A = { ...H, Authorization: `Bearer ${auth.token}` };
const O = { ...H, Authorization: `Bearer ${op.token}` };
t('signed in', !!auth?.token && !!op?.token);

// The schedules seeded themselves, annually.
const scheds = await (await fetch(`${URL}/api/quality-schedules`, { headers: A })).json();
const mr = (scheds || []).find(s => /Annual Management Review/i.test(s.title));
const fd = (scheds || []).find(s => /Annual Food Defense Plan Challenge/i.test(s.title));
t('the management review schedule ships seeded', !!mr, (scheds || []).map(s => s.title).join(' | ').slice(0, 200));
t('and it RECURS ANNUALLY, on its own', mr?.frequency_type === 'annual' && mr?.frequency_value === 1, JSON.stringify(mr).slice(0, 160));
t('the food defense challenge schedule ships seeded and is annual',
  !!fd && fd.frequency_type === 'annual', JSON.stringify(fd).slice(0, 160));
t('both are active, so a task is raised without anybody setting one up',
  mr?.is_active === 1 && fd?.is_active === 1);

// The task the schedule raises carries the form.
await fetch(`${URL}/api/pm/generate`, { method: 'POST', headers: A }).catch(() => {});
const tasks = await (await fetch(`${URL}/api/pm/operator-tasks?limit=500`, { headers: A })).json();
const list = Array.isArray(tasks) ? tasks : (tasks.tasks || []);
const mrTask = list.find(w => w.quality_schedule_id === mr?.id);
const fdTask = list.find(w => w.quality_schedule_id === fd?.id);
t('the management review task exists and carries its eight-item form',
  !!mrTask && mrTask.check_form?.kind === 'management_review' && mrTask.check_form.items.length === 8,
  JSON.stringify(mrTask?.check_form || {}).slice(0, 200));
t('the food defense task carries SOP 434 V3, not a DRAFT stamp',
  fdTask?.check_form?.kind === 'food_defense_challenge' && fdTask.check_form.sop_revision === 'SOP 434 V3' && !fdTask.check_form.draft,
  JSON.stringify(fdTask?.check_form || {}).slice(0, 200));
t('the management review record IS stamped draft — no numbered form exists yet',
  mrTask?.check_form?.draft === true && mrTask.check_form.revision === 'DRAFT-1');

// COMPLETING THE TASK IS THE ONE ACT.
const half = { attendees: 'Lowry Akers, Adam Bliss, Maria Servin', items: { i_documentation: { result: 'done' } } };
const refused = await post(`/pm/work-orders/${mrTask.id}/complete-and-recur`, { completed_by: 'Annual Admin', check: half }, A);
t('completing with seven items unanswered is REFUSED', refused.status === 400, `HTTP ${refused.status}`);
t('and the refusal names what is still needed', /still|need/i.test(JSON.stringify(await refused.json())));

const full = {
  attendees: 'Lowry Akers, Adam Bliss, Maria Servin',
  notes: 'Annual review held; actions logged.',
  items: Object.fromEntries(MANAGEMENT_REVIEW_ITEMS.map(i => [i.key,
    i.key === 'vi_recalls' ? { result: 'na', note: 'No recalls or regulatory issues in the period' } : { result: 'done', note: 'Reviewed' }])),
};
const ok = await post(`/pm/work-orders/${mrTask.id}/complete-and-recur`, { completed_by: 'Annual Admin', check: full }, A);
t('completing the task once files the review', ok.status < 300, `HTTP ${ok.status} ${JSON.stringify(await ok.clone().json()).slice(0,180)}`);

const mrRead = await (await fetch(`${URL}/api/check-records/management-reviews`, { headers: A })).json();
t('the record is on the Management review tab', (mrRead.reviews || []).length === 1, JSON.stringify(mrRead).slice(0, 200));
const rec = mrRead.reviews[0];
t('it names who took part', /Maria Servin/.test(rec.attendees || ''));
t('it carries all eight items as filed', Object.keys(rec.items || {}).length === 8);
t('the N/A item kept its reason', rec.items.vi_recalls?.result === 'na' && /No recalls/.test(rec.items.vi_recalls.note || ''));
t('it records the clause and the draft revision it was run against',
  rec.clause === 'SQF Code 2.1.2.1' && rec.revision === 'DRAFT-1', JSON.stringify(rec).slice(0, 200));
t('it says it came from the ReadyDoc task', rec.source === 'task');
t('the screen says the annual one is NOT due — it was just done', mrRead.due === false && mrRead.days_since === 0);
t('and it recurs: completing it raised the next one',
  (await (await fetch(`${URL}/api/quality-schedules`, { headers: A })).json()).find(s => s.id === mr.id)?.next_due > new Date().toISOString().slice(0, 10),
  JSON.stringify((await (await fetch(`${URL}/api/quality-schedules`, { headers: A })).json()).find(s => s.id === mr.id)?.next_due));

// ── The one that already happened: March ────────────────────────────────────
const march = {
  performed_on: '2026-03-18',
  performed_by: 'Carol Pierce',
  team: 'Carol Pierce, Adam Bliss, Ricardo Avalos',
  methods: ['mock_scenario', 'access_validation'],
  outcome: 'Mock adulteration scenario walked with the shift; access validation reviewed against the authorization list. Response within 10 minutes.',
  findings: 'All mitigation strategies rated Effective. No new vulnerabilities identified.',
  corrective_actions: 'none',
  items: Object.fromEntries(FOOD_DEFENSE_ITEMS.map(i => [i.key, { result: 'done' }])),
};
const filed = await post('/check-records/food-defense/challenges', march, A);
t('the March challenge can be recorded after the fact', filed.status === 201, `HTTP ${filed.status} ${JSON.stringify(await filed.clone().json()).slice(0,200)}`);
const fdRead = await (await fetch(`${URL}/api/check-records/food-defense/challenges`, { headers: A })).json();
const ch = (fdRead.challenges || [])[0];
t('it keeps its OWN date, not today', ch?.performed_on === '2026-03-18', JSON.stringify(ch).slice(0, 160));
t('IT IS MARKED AS COMING FROM THE PAPER REPORT', ch?.source === 'paper');
t('it carries SOP 434 V3', ch?.sop_revision === 'SOP 434 V3');
t('and the methods actually used', (ch?.methods || []).includes('mock_scenario') && ch.methods.length === 2);
t('the tab now shows the last challenge as March', fdRead.last?.performed_on === '2026-03-18');

const thin = await post('/check-records/food-defense/challenges', { ...march, methods: [], performed_on: '2026-03-19' }, A);
t('A BACK-FILED CHALLENGE MAY NOT BE THINNER THAN A LIVE ONE', thin.status === 400, `HTTP ${thin.status}`);
const future = await post('/check-records/food-defense/challenges', { ...march, performed_on: '2099-01-01' }, A);
t('and it cannot be dated in the future', future.status === 400, `HTTP ${future.status}`);
const byOp = await post('/check-records/management-reviews', { ...full, reviewed_on: '2026-02-01' }, O);
t('recording one is Quality leadership, not the floor', byOp.status === 403, `HTTP ${byOp.status}`);
t('an operator can still READ the records',
  (await fetch(`${URL}/api/check-records/management-reviews`, { headers: O })).status === 200);

// ── A review recorded by hand settles the schedule that asked for it (D-122) ──
// Lowry filed the 2 March review by hand and asked whether the annual task's
// clock resets from it. Before this the tab said "not due" while the Task
// Center card stayed open and the next task was timed from the seed date.
{
  const dbx = new Database(process.env.DBPATH);
  const today = dbx.prepare("SELECT date('now') d").get().d;
  const dayOf = (n) => dbx.prepare("SELECT date('now', ?) d").get(`-${n} days`).d;
  const plusYear = (d) => dbx.prepare("SELECT date(?, '+1 year') d").get(d).d;
  // Raise this year's task exactly as the generator does (housekeeping is
  // throttled to once in five minutes, and the first run was seconds ago):
  // the card due today, the schedule advanced a year past it.
  const raise = () => {
    const id = crypto.randomUUID();
    dbx.prepare(`INSERT INTO work_orders (id, title, description, priority, due_date, procedure_steps, task_group, quality_schedule_id, status)
      VALUES (?, ?, 'Scheduled quality check.', 'normal', ?, '[]', 'qa', ?, 'open')`).run(id, mr.title, today, mr.id);
    dbx.prepare('UPDATE quality_schedules SET next_due = ? WHERE id = ?').run(plusYear(today), mr.id);
    return dbx.prepare('SELECT id, status FROM work_orders WHERE id = ?').get(id);
  };
  const openWo = raise();
  t('a fresh management review task is open again', openWo?.status === 'open', JSON.stringify(openWo));
  const raisedNext = dbx.prepare('SELECT next_due FROM quality_schedules WHERE id = ?').get(mr.id).next_due;

  const marchDay = dayOf(211);   // this year's review, done ~seven months ago
  const byHand = await post('/check-records/management-reviews', { ...full, reviewed_on: marchDay, reviewed_by: 'Lowry Akers' }, A);
  const byHandBody = await byHand.json();
  t('a management review recorded by hand files', byHand.status === 201, `HTTP ${byHand.status} ${JSON.stringify(byHandBody).slice(0, 200)}`);
  const woAfter = dbx.prepare('SELECT status, completed_at, completed_by, notes FROM work_orders WHERE id = ?').get(openWo?.id);
  t('THE OPEN TASK CARD IS COMPLETED BY THE RECORD', woAfter?.status === 'completed', JSON.stringify(woAfter));
  t('as of the day the review happened, not today', String(woAfter?.completed_at || '').startsWith(marchDay), woAfter?.completed_at);
  t('by the person who chaired it, and it says it came off the paper', woAfter?.completed_by === 'Lowry Akers' && /paper review/i.test(woAfter?.notes || ''));
  t('the record is linked to the task and the schedule it stood in for',
    byHandBody.work_order_id === openWo?.id && byHandBody.quality_schedule_id === mr.id, JSON.stringify({ w: byHandBody.work_order_id, q: byHandBody.quality_schedule_id }));
  const nextAfter = dbx.prepare('SELECT next_due FROM quality_schedules WHERE id = ?').get(mr.id).next_due;
  t("THE ANNUAL CLOCK RUNS FROM THE REVIEW'S DATE: next due is its anniversary", nextAfter === plusYear(marchDay), `${nextAfter} vs ${plusYear(marchDay)}`);
  t('which is EARLIER than the seed-dated next raise, so nothing waits a year too long', nextAfter < raisedNext, `${nextAfter} < ${raisedNext}`);
  t('and the response says what it settled', byHandBody.settled?.closed?.length === 1 && byHandBody.settled?.next_due === nextAfter);
  const tab = await (await fetch(`${URL}/api/check-records/management-reviews`, { headers: A })).json();
  t('the tab and the schedule agree: not due, and the March review is on it as the paper one',
    tab.due === false && (tab.reviews || []).some(r => r.reviewed_on === marchDay && r.source === 'paper'),
    JSON.stringify({ due: tab.due, dates: (tab.reviews || []).map(r => r.reviewed_on) }));

  // A review older than a year does NOT close this year's task — one is still owed.
  const openAgain = raise();
  t('a task is open again for the control', openAgain?.status === 'open');
  const old = await post('/check-records/management-reviews', { ...full, reviewed_on: dayOf(400), reviewed_by: 'Lowry Akers' }, A);
  t('a review from over a year ago still files', old.status === 201, `HTTP ${old.status}`);
  t('but LEAVES THE OPEN TASK OPEN — a review is still owed',
    dbx.prepare('SELECT status FROM work_orders WHERE id = ?').get(openAgain?.id)?.status === 'open');
  dbx.close();
}

// ── The assignee picker names the people these tasks belong to (D-122) ───────
{
  const dbx = new Database(process.env.DBPATH);
  dbx.prepare(`INSERT OR REPLACE INTO users (id,name,username,role,department,is_active,is_external,external_org,module_access)
    VALUES ('ar-guest','Guest Client','Guest Client','operator','qa',1,1,'M4 Dynamic',NULL)`).run();
  dbx.close();
  const techs = await (await fetch(`${URL}/api/users/technicians`, { headers: A })).json();
  const names = (techs || []).map(u => u.name);
  t('the Task Center assignee list offers an ADMIN — the review is chaired by management', names.includes('Annual Admin'), names.join(', ').slice(0, 200));
  t('and still the floor', names.includes('Annual Op'));
  t('but never ReadyBot', !names.includes('ReadyBot'));
  t('and never a client guest, who is an operator by role and nobody a task can reach', !names.includes('Guest Client'));
}

// ── In a real browser: the tabs exist and the record is readable ────────────
const { chromium } = await import('playwright-core');
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on('pageerror', e => console.log('  [pageerror]', e.message));
  await page.goto(`${URL}/manifest.webmanifest`);
  await page.evaluate(([tok, u]) => { localStorage.setItem('auth_token', tok); localStorage.setItem('auth_user', JSON.stringify(u)); }, [auth.token, auth.user]);
  await page.goto(`${URL}/?tab=quality-schedules&view=management-review`);
  await page.waitForLoadState('networkidle');

  const mrThere = await page.locator('[data-annual-review="management_review"]').count() > 0;
  t('the Management review tab opens', mrThere, await page.locator('h2').first().innerText().catch(() => '?'));
  if (mrThere) {
    const body = await page.locator('[data-annual-review="management_review"]').innerText();
    t('it shows the review just filed, with who took part', /Maria Servin/.test(body) && /8 of 8 reviewed|7 of 8 reviewed/.test(body), body.slice(0, 300));
    t('and says the annual one is not due', await page.locator('[data-annual-due="0"]').count() === 1);
    t('the N/A is visible as one, not hidden', /1 N\/A/.test(body), body.slice(0, 300));
  }

  await page.goto(`${URL}/?tab=quality-schedules&view=food-defense`);
  await page.waitForLoadState('networkidle');
  const fdThere = await page.locator('[data-annual-review="food_defense_challenge"]').count() > 0;
  t('the Food defense tab opens', fdThere);
  if (fdThere) {
    const body = await page.locator('[data-annual-review="food_defense_challenge"]').innerText();
    t('the March challenge is on it, carrying its own March date',
      /3\/18\/2026|18\/3\/2026|2026-03-18/.test(body) && /Carol Pierce/.test(body), body.slice(0, 600));
    t('and it is labelled as the paper report', /Paper report/.test(body), body.slice(0, 400));
    t('the methods used are named in words, not keys',
      /Mock intentional adulteration/.test(body) && !/mock_scenario/.test(body), body.slice(0, 400));

    await page.locator('[data-annual-file-toggle]').click();
    await page.waitForSelector('[data-annual-entry]', { timeout: 8000 });
    t('the by-hand form opens and asks the same nine steps',
      await page.locator('[data-review-item]').count() === 9, String(await page.locator('[data-review-item]').count()));
    t('Save is held until it is answered', await page.locator('[data-annual-save]').isDisabled());
    t('and the five SOP methods are offered as taps', await page.locator('[data-fd-method]').count() === 5);
  }
} finally { await browser.close(); }

console.log(`\n${pass}/${pass + fail} assertions passed`);
process.exit(fail ? 1 : 0);
