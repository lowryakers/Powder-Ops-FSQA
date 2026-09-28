// PC #1's critical limit, on the TASK door — executed against a live server.
//
// The Operator View captures an ATP reading on Production Line Pre-Op and
// changeover cleans, and until now the record filed from that completion
// carried no reading, no limit and no grade: a 200 RLU swab filed as a pass.
// POST /sanitation graded; this door did not. Every assertion below goes
// through the real completion endpoint and reads the real sanitation record.
//
// Caller sets PORT + DBPATH. Needs a fresh database.
const PORT = process.env.PORT || 4907;
const B = `http://localhost:${PORT}/api`;
const J = async r => { try { return await r.json(); } catch { return null; } };
let token = null;
const req = (p, o = {}) => fetch(B + p, { ...o, headers: {
  'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(o.headers || {}) } });
const post = (p, b) => req(p, { method: 'POST', body: JSON.stringify(b) });

let pass = 0, fail = 0;
const t = (n, c, d = '') => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (d ? ' — ' + d : '')); } };

const { default: Database } = await import('better-sqlite3');
const { ATP_LIMIT } = await import('../server/atp-limits.js');
const LIMIT = ATP_LIMIT.max;

const db = new Database(process.env.DBPATH);
db.prepare(`INSERT OR REPLACE INTO users (id,name,username,role,department,is_active,setup_code,setup_code_expires_at)
  VALUES ('atp-op','Atp Cleaner','Atp Cleaner','admin','cleaning',1,'SC-ATP',datetime('now','+7 day'))`).run();
db.prepare(`INSERT OR REPLACE INTO equipment (id,name,type,status,asset_kind,loto_required,is_food_contact)
  VALUES ('atp-eq','Production Line 7','Production Line','active','zone',0,0)`).run();
// The title is what recordAreaForTask() maps to the `Production` area.
db.prepare(`INSERT OR REPLACE INTO pm_schedules (id,equipment_id,title,frequency_type,frequency_value,task_group,is_active)
  VALUES ('atp-sch','atp-eq','Production Line Pre-Op Clean — Room 7','daily',1,'cleaning',1)`).run();
const wo = (id) => db.prepare(`INSERT OR REPLACE INTO work_orders (id,pm_schedule_id,equipment_id,title,status,task_group,due_date)
  VALUES (?, 'atp-sch','atp-eq','Production Line Pre-Op Clean — Room 7','open','cleaning', date('now'))`).run(id);
['atp-1','atp-2','atp-3','atp-4','atp-5'].forEach(wo);
db.close();

await post('/users/login', { name: 'Atp Cleaner' });
await post('/users/set-password', { user_id: 'atp-op', password: 'AtpPW2026!', setup_code: 'SC-ATP' });
token = (await J(await post('/users/login', { name: 'Atp Cleaner', password: 'AtpPW2026!' })))?.token;
t('signed in', !!token);

const record = (woId) => {
  const d = new Database(process.env.DBPATH, { readonly: true });
  const r = d.prepare("SELECT * FROM sanitation_records WHERE notes LIKE ? ORDER BY rowid DESC LIMIT 1").get(`%Filed from task ${woId}%`);
  d.close(); return r;
};
const complete = (id, body) => post(`/pm/work-orders/${id}/complete-and-recur`, body);

console.log(`\nAn over-limit swab (${LIMIT + 165} RLU) filed as a visual PASS`);
{
  const r = await complete('atp-1', { readings: { atp_reading: String(LIMIT + 165) }, reading_result: 'pass', notes: '' });
  const b = await J(r);
  t('the completion is accepted', r.ok, `got ${r.status}`);
  const rec = record('atp-1');
  t('a record was filed', !!rec);
  t('THE READING IS ON THE RECORD', String(rec?.atp_reading) === String(LIMIT + 165), `atp_reading=${rec?.atp_reading}`);
  t('THE LIMIT TRAVELS WITH IT', Number(rec?.atp_limit) === Number(LIMIT), `atp_limit=${rec?.atp_limit}`);
  t('THE RESULT IS FAIL, whatever the operator chose', rec?.result === 'fail', `result=${rec?.result}`);
  t('the first failure asks for a re-swab, not a re-clean', b?.atp_stage === 'reswab', `stage=${b?.atp_stage}`);
  t('no re-clean task from ONE failure', !b?.reclean_work_order_id);
}

console.log('\nA second consecutive failure raises the re-clean');
{
  const r = await complete('atp-2', { readings: { atp_reading: String(LIMIT + 40) }, reading_result: 'pass', notes: '' });
  const b = await J(r);
  t('accepted', r.ok);
  t('escalates', b?.atp_stage === 'escalate', `stage=${b?.atp_stage}`);
  t('a re-clean work order is raised', !!b?.reclean_work_order_id, JSON.stringify(b || {}).slice(0, 100));
  if (b?.reclean_work_order_id) {
    const d = new Database(process.env.DBPATH, { readonly: true });
    const rw = d.prepare('SELECT title, status FROM work_orders WHERE id = ?').get(b.reclean_work_order_id);
    d.close();
    t('...that names the failed swabs', /ATP|swab/i.test(rw?.title || ''), rw?.title);
  }
}

console.log('\nA passing graded reading resets the chain and files as pass');
{
  const r = await complete('atp-3', { readings: { atp_reading: '12' }, reading_result: 'pass', notes: '' });
  const rec = record('atp-3');
  t('accepted', r.ok);
  t('pass stays pass', rec?.result === 'pass', `result=${rec?.result}`);
  t('reading and limit stored', String(rec?.atp_reading) === '12' && Number(rec?.atp_limit) === Number(LIMIT));
  const r2 = await complete('atp-4', { readings: { atp_reading: String(LIMIT + 5) }, reading_result: 'pass', notes: '' });
  const b2 = await J(r2);
  t('the next failure is a FIRST failure again — no re-clean', b2?.atp_stage !== 'escalate' && !b2?.reclean_work_order_id, `stage=${b2?.atp_stage}`);
}

console.log('\nAn in-limit reading never upgrades a chosen FAIL');
{
  const d = new Database(process.env.DBPATH); d.prepare(`INSERT OR REPLACE INTO work_orders (id,pm_schedule_id,equipment_id,title,status,task_group,due_date)
    VALUES ('atp-6','atp-sch','atp-eq','Production Line Pre-Op Clean — Room 7','open','cleaning', date('now'))`).run(); d.close();
  await complete('atp-6', { readings: { atp_reading: '5' }, reading_result: 'fail', notes: 'residue seen' });
  const rec = record('atp-6');
  t('fail stays fail — a clean has reasons to fail that no swab sees', rec?.result === 'fail', `result=${rec?.result}`);
}

console.log('\nA missing reading is a gap, not a failure');
{
  const r = await complete('atp-5', { readings: {}, reading_result: 'pass', notes: '' });
  const rec = record('atp-5');
  t('accepted', r.ok);
  t('result exactly as filed', rec?.result === 'pass');
  t('no reading, no limit — nothing invented', rec?.atp_reading == null && rec?.atp_limit == null, `reading=${rec?.atp_reading} limit=${rec?.atp_limit}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// THE RE-CLEAN IT RAISES HAD NOWHERE TO PUT THE SECOND SWAB.
//
// The task door grades (above) and the Operator View captures — but ONLY on a
// task whose title contains "pre-op", "changeover" or "production line". Every
// such title was written by a seeder; the four re-clean titles this app raises
// at RUNTIME match none of them, so all four drew the plain cleaning form with
// no ATP box. Including the one raised BY two failed swabs to obtain a second.
//
// The verdict comes from `recordAreaForTask()` now — the map that already
// answers "what does completing this file, and where" — so the screen carries
// no second list of titles. Third time this defect has been found, third map.
console.log('\nWhich cleans owe a swab — derived, not a regex on the screen');
const { swabPlanForTask } = await import('../server/clean-swabs.js');
const { RECLEAN_REASONS, ATP_RECLEAN } = await import('../shared/reclean-reasons.js');
{
  const plan = (title) => swabPlanForTask(title);
  // Every re-clean title the app can raise, taken from the one vocabulary
  // rather than re-typed here — a copy in the test is a test that agrees with
  // itself and not with the app.
  const roomTitles = Object.values(RECLEAN_REASONS).map(r => r.title('Room 7'));
  t('all three 72-hour-rule re-clean titles owe a swab',
    roomTitles.every(x => plan(x)?.atp === 'required'),
    roomTitles.filter(x => !plan(x)).join(' | '));
  t('THE TWO-FAILED-SWABS RE-CLEAN ASKS FOR A SECOND SWAB BY NAME',
    plan(ATP_RECLEAN.title('Room 7'))?.reason === 'second_swab');
  t('so does the pre-op / changeover clean, as it always did',
    plan('Production Line Pre-Op / Changeover Clean')?.atp === 'required');
  t('the restroom, warehouse and breakroom cleans owe NONE — an ATP box there is the wallpaper that gets a real one ignored',
    ['Restroom Daily Cleaning', 'Warehouse/Grounds Daily Cleaning', 'Breakroom/Lobby/Office Daily Cleaning']
      .every(x => plan(x) === null));
  t('and a maintenance PM that merely says "Cleaning" owes nothing',
    plan('Daily PM Checklist — Production (Cleaning)') === null);
  t('neither does a task that is not a clean at all', plan('Monthly Lubrication — Auger') === null);
}

console.log('\nThe task the plant is actually handed carries the plan');
{
  // Two consecutive failures on a fresh area, so the re-clean is the real one
  // `raiseAtpRecleanTask` raises rather than a row planted by the test.
  const d = new Database(process.env.DBPATH);
  d.prepare(`INSERT OR REPLACE INTO pm_schedules (id,equipment_id,title,frequency_type,frequency_value,task_group,is_active)
    VALUES ('atp-sch6','atp-eq','Production Line Pre-Op Clean — Room 6','daily',1,'cleaning',1)`).run();
  ['atp-6a', 'atp-6b'].forEach(id => d.prepare(`INSERT OR REPLACE INTO work_orders (id,pm_schedule_id,equipment_id,title,status,task_group,due_date,assigned_to)
    VALUES (?, 'atp-sch6','atp-eq','Production Line Pre-Op Clean — Room 6','open','cleaning', date('now'), 'Atp Cleaner')`).run(id));
  // A restroom clean beside it — the negative control on the same screen.
  d.prepare(`INSERT OR REPLACE INTO pm_schedules (id,equipment_id,title,frequency_type,frequency_value,task_group,is_active)
    VALUES ('atp-schr','atp-eq','Restroom Daily Cleaning','daily',1,'cleaning',1)`).run();
  d.prepare(`INSERT OR REPLACE INTO work_orders (id,pm_schedule_id,equipment_id,title,status,task_group,due_date,assigned_to)
    VALUES ('atp-rest','atp-schr','atp-eq','Restroom Daily Cleaning','open','cleaning', date('now'), 'Atp Cleaner')`).run();
  d.close();

  await complete('atp-6a', { readings: { atp_reading: String(LIMIT + 100) }, reading_result: 'pass', notes: '' });
  const esc = await J(await complete('atp-6b', { readings: { atp_reading: String(LIMIT + 90) }, reading_result: 'pass', notes: '' }));
  t('two consecutive failures raise the re-clean', !!esc?.reclean_work_order_id, `stage=${esc?.atp_stage}`);

  const d2 = new Database(process.env.DBPATH, { readonly: true });
  const raised = d2.prepare('SELECT id, title FROM work_orders WHERE id = ?').get(esc?.reclean_work_order_id || '');
  d2.close();
  t('ONE DEFINITION OF ITS TITLE — the work order matches ATP_RECLEAN exactly',
    raised?.title === ATP_RECLEAN.title('Production'), raised?.title);

  const tasks = await J(await req('/pm/operator-tasks?limit=500'));
  const list = Array.isArray(tasks) ? tasks : (tasks?.tasks || []);
  const card = list.find(x => x.id === esc?.reclean_work_order_id);
  t('the re-clean is on the cleaner’s own screen', !!card, `${list.length} tasks`);
  t('AND IT CARRIES THE SWAB PLAN — this is the fix', card?.swab_plan?.atp === 'required',
    JSON.stringify(card?.swab_plan || null));
  t('…naming it as the SECOND swab, not an ordinary clean',
    card?.swab_plan?.reason === 'second_swab', JSON.stringify(card?.swab_plan || null));
  const rest = list.find(x => x.id === 'atp-rest');
  t('the restroom clean beside it carries none', !!rest && !rest.swab_plan, JSON.stringify(rest?.swab_plan || null));

  // The whole point: the reading that clears the area can now be entered on
  // the task that asks for it.
  const r = await complete(esc.reclean_work_order_id, { readings: { atp_reading: '9' }, reading_result: 'pass', notes: '' });
  t('completing it with a passing reading is accepted', r.ok, `got ${r.status}`);
  const rec = record(esc.reclean_work_order_id);
  t('the second swab is ON the record, with its limit', String(rec?.atp_reading) === '9' && Number(rec?.atp_limit) === Number(LIMIT),
    `reading=${rec?.atp_reading} limit=${rec?.atp_limit}`);
  t('and it files as a pass', rec?.result === 'pass', `result=${rec?.result}`);
}

console.log('\nThe floor strings exist in both languages');
{
  // Through the real translator, not the raw table: a key present but not
  // resolvable is the same blank on the screen.
  const { createTranslator } = await import('../src/i18n/operatorStrings.js');
  const en = createTranslator('en'), es = createTranslator('es');
  const keys = ['swab_heading', 'swab_why_reclean', 'swab_why_second'];
  const missing = keys.filter(k => !en(k) || !es(k) || en(k) === k || es(k) === k || en(k) === es(k));
  t('every new floor string resolves in EN and ES, and they differ — a safety rule shown in one language is a rule half the shift cannot read',
    missing.length === 0, missing.join(', '));
}

// ─────────────────────────────────────────────────────────────────────────────
// AND THE TASK CENTER NEVER ASKED AT ALL — the reported gap.
//
// Live Pre-Ops filed on 27 and 28 September read "ATP —" with no limit, three
// days after D-112 put the box on the Operator View. Reproduced here: the
// completion body the Task Center's own form sends carries no readings, so the
// record it files is graded against nothing. Same endpoint, same rule, same
// area — the other screen simply did not draw the field, although the server
// had been stamping `swab_plan` on the very rows it renders.
//
// Fourth screen, same defect, so the verdict stays the server's.
console.log('\nThe Task Center completes the same task through the same door');
{
  const d = new Database(process.env.DBPATH);
  d.prepare(`INSERT OR REPLACE INTO pm_schedules (id,equipment_id,title,frequency_type,frequency_value,task_group,is_active)
    VALUES ('atp-tc-sch','atp-eq','Production Line Pre-Op Clean — Room 3','daily',1,'cleaning',1)`).run();
  ['atp-tc-1', 'atp-tc-2'].forEach(id => d.prepare(`INSERT OR REPLACE INTO work_orders (id,pm_schedule_id,equipment_id,title,status,task_group,due_date,assigned_to,procedure_steps)
    VALUES (?, 'atp-tc-sch','atp-eq','Production Line Pre-Op Clean — Room 3','open','cleaning', date('now'), 'Atp Cleaner','[]')`).run(id));
  d.prepare(`INSERT OR REPLACE INTO work_orders (id,pm_schedule_id,equipment_id,title,status,task_group,due_date,assigned_to,procedure_steps)
    VALUES ('atp-tc-rest','atp-schr','atp-eq','Restroom Daily Cleaning','open','cleaning', date('now'), 'Atp Cleaner','[]')`).run();
  d.close();

  // The list the Task Center actually renders.
  const byFreq = await J(await req('/pm/by-frequency'));
  const flat = Object.values(byFreq || {}).flatMap(v => (Array.isArray(v) ? v : (v?.tasks || [])));
  const row = flat.find(x => x.id === 'atp-tc-1');
  t('the pre-op is on the Task Center list', !!row, `${flat.length} rows`);
  t('AND THE SERVER ALREADY TOLD IT A SWAB IS OWED — the box was the only missing half',
    row?.swab_plan?.atp === 'required', JSON.stringify(row?.swab_plan || null));
  const restRow = flat.find(x => x.id === 'atp-tc-rest');
  t('the restroom clean on the same list owes none', !!restRow && !restRow.swab_plan,
    JSON.stringify(restRow?.swab_plan || null));

  // What the form sends when the reading IS entered — the fix.
  const r = await complete('atp-tc-1', { readings: { atp_reading: '18' }, notes: 'cleaned', lubricant_used: '', chemical_id: '' });
  t('the completion is accepted', r.ok, `got ${r.status}`);
  const rec = record('atp-tc-1');
  t('THE READING IS ON THE RECORD, filed from the desk', String(rec?.atp_reading) === '18', `atp_reading=${rec?.atp_reading}`);
  t('…with the limit beside it', Number(rec?.atp_limit) === Number(LIMIT), `atp_limit=${rec?.atp_limit}`);

  // An over-limit reading entered here grades exactly as it does on the floor.
  const r2 = await complete('atp-tc-2', { readings: { atp_reading: String(LIMIT + 70) }, notes: '', lubricant_used: '', chemical_id: '' });
  const b2 = await J(r2);
  const rec2 = record('atp-tc-2');
  t('an over-limit swab entered here files as a FAIL, exactly as on the floor', rec2?.result === 'fail', `result=${rec2?.result}`);
  t('…and asks for a re-swab rather than passing silently', b2?.atp_stage === 'reswab', `stage=${b2?.atp_stage}`);

  // And leaving it blank is still a gap, not a refusal.
  const d2 = new Database(process.env.DBPATH);
  d2.prepare(`INSERT OR REPLACE INTO work_orders (id,pm_schedule_id,equipment_id,title,status,task_group,due_date,procedure_steps)
    VALUES ('atp-tc-3','atp-tc-sch','atp-eq','Production Line Pre-Op Clean — Room 3','open','cleaning', date('now'),'[]')`).run();
  d2.close();
  const r3 = await complete('atp-tc-3', { notes: 'no swab taken', lubricant_used: '', chemical_id: '' });
  t('a completion with no reading is still accepted — a gap, not a failure', r3.ok, `got ${r3.status}`);
  t('…and invents nothing', record('atp-tc-3')?.atp_reading == null);
}

console.log('\nIn a real browser: the box is on the card');
{
  const { chromium } = await import('playwright-core');
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage({ viewport: { width: 390, height: 840 } });
  page.on('pageerror', (e) => { console.log('  [pageerror]', e.message); fail++; });
  const URL = `http://localhost:${PORT}`;
  await page.goto(`${URL}/manifest.webmanifest`);
  const me = await J(await req('/users/me'));
  await page.evaluate(([tok, u]) => {
    localStorage.setItem('auth_token', tok); localStorage.setItem('auth_user', JSON.stringify(u));
  }, [token, me]);

  // Two cards planted side by side and back-dated, so both land in the
  // Overdue section — the one bucket that always opens. The seeded database
  // has seventy-odd tasks due today and the Today section collapses past five.
  const d = new Database(process.env.DBPATH);
  d.prepare(`INSERT OR REPLACE INTO work_orders (id,equipment_id,title,description,status,task_group,due_date,assigned_to,procedure_steps)
    VALUES ('atp-ui', 'atp-eq', ?, 'raised by two failed swabs', 'open','cleaning', date('now','-1 day'), 'Atp Cleaner', '[]')`)
    .run(ATP_RECLEAN.title('Room 6'));
  d.prepare(`INSERT OR REPLACE INTO work_orders (id,equipment_id,title,description,status,task_group,due_date,assigned_to,procedure_steps)
    VALUES ('atp-ui-rest', 'atp-eq', 'Restroom Daily Cleaning', 'the negative control, on the same screen', 'open','cleaning', date('now','-1 day'), 'Atp Cleaner', '[]')`).run();
  // THE PRE-OP ITSELF — the card the plant's reported records came from, and
  // the one an operator-side check was going to open by hand. It takes a
  // different branch of this screen from the re-clean above (`production_clean`
  // rather than the swab block), so it has to be asserted on its own card.
  d.prepare(`INSERT OR REPLACE INTO work_orders (id,equipment_id,title,description,status,task_group,due_date,assigned_to,procedure_steps)
    VALUES ('atp-ui-preop', 'atp-eq', 'Production Line Pre-Op Clean — Room 3', 'the reported case', 'open','cleaning', date('now','-1 day'), 'Atp Cleaner', '[]')`).run();
  // …and one more, still open, for the desk form to actually submit.
  d.prepare(`INSERT OR REPLACE INTO work_orders (id,pm_schedule_id,equipment_id,title,description,status,task_group,due_date,procedure_steps)
    VALUES ('atp-tc-4', 'atp-tc-sch', 'atp-eq', 'Production Line Pre-Op Clean — Room 3', 'submitted from the Task Center', 'open','cleaning', date('now'), '[]')`).run();
  d.close();

  await page.goto(`${URL}/operator`);
  await page.waitForTimeout(3500);
  const card = page.locator('[data-task-card="atp-ui"]');
  t('the re-clean card is on the Operator View', await card.count() > 0,
    (await page.locator('body').innerText()).slice(0, 160).replace(/\n/g, ' '));
  // Guarded so a CONTROL run — the swab plan and the card hooks removed —
  // reports every assertion it fails instead of stopping at the first.
  const cardThere = await card.count() > 0;
  if (cardThere) {
    await card.scrollIntoViewIfNeeded().catch(() => {});
    await card.locator('[data-complete-task]').click().catch(() => {});
    await page.waitForTimeout(700);
  }
  t('THE ATP BOX IS ON IT — the reported gap, closed',
    cardThere && await card.locator('[data-atp-field]').count() > 0);
  t('the swab block says which swab this is',
    cardThere && await card.locator('[data-swab-block][data-swab-reason="second_swab"]').count() > 0);
  const why = cardThere ? await card.locator('[data-swab-why]').first().innerText().catch(() => '') : '';
  t('…in words the cleaner can act on', /second swab/i.test(why), why);
  // The live hint enforces nothing — the server decides — but an over-limit
  // reading should read as one before the operator presses Submit.
  if (cardThere) {
    await card.locator('[data-atp-field]').fill(String(LIMIT + 165)).catch(() => {});
    await page.waitForTimeout(400);
  }
  t('typing an over-limit reading says so on the card, against PC #1’s own limit',
    cardThere && new RegExp(String(LIMIT)).test(await card.innerText()));

  // The negative control on the same screen, at the same moment.
  const rest = page.locator('[data-task-card="atp-ui-rest"]');
  if (await rest.count()) {
    await rest.scrollIntoViewIfNeeded().catch(() => {});
    await rest.locator('[data-complete-task]').click().catch(() => {});
    await page.waitForTimeout(600);
  }
  t('the restroom clean beside it is offered NO swab box',
    cardThere && await rest.locator('[data-swab-block]').count() === 0
    && await rest.locator('[data-atp-field]').count() === 0);

  // The reported card: a pending Pre-Op, opened on the floor screen.
  const preop = page.locator('[data-task-card="atp-ui-preop"]');
  const preopThere = await preop.count() > 0;
  t('a pending Pre-Op is on the Operator View', preopThere);
  if (preopThere) {
    await preop.scrollIntoViewIfNeeded().catch(() => {});
    await preop.locator('[data-complete-task]').click().catch(() => {});
    await page.waitForTimeout(700);
  }
  t('THE PRE-OP ASKS FOR ITS SWAB ON THE FLOOR SCREEN — so the floor half was never the gap',
    preopThere && await preop.locator('[data-atp-field]').count() > 0);
  if (preopThere) {
    await preop.locator('[data-atp-field]').fill(String(LIMIT + 5)).catch(() => {});
    await page.waitForTimeout(400);
  }
  t('…and grades it live against PC #1’s limit',
    preopThere && new RegExp(String(LIMIT)).test(await preop.innerText()));

  const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  t('nothing pans the page sideways at 390px', over <= 1, `${over}px over`);

  // ── The other screen, at a desk ────────────────────────────────────────────
  // The Task Center completes the same task through the same endpoint. This is
  // the screen the plant's pre-ops were being finished on, and the one that
  // asked for nothing.
  const wide = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  wide.on('pageerror', (e) => { console.log('  [pageerror]', e.message); fail++; });
  await wide.goto(`${URL}/manifest.webmanifest`);
  await wide.evaluate(([tok, u]) => {
    localStorage.setItem('auth_token', tok); localStorage.setItem('auth_user', JSON.stringify(u));
  }, [token, me]);
  await wide.goto(`${URL}/?tab=pm`);
  await wide.waitForTimeout(4000);
  // Search rather than scroll: the seeded database has seventy-odd open tasks.
  const search = wide.locator('input[placeholder*="earch" i]').first();
  if (await search.count()) { await search.fill('Pre-Op Clean — Room 3'); await wide.waitForTimeout(1500); }
  const tcCard = wide.locator('[data-wo-card="atp-tc-4"]').first();
  const tcThere = await tcCard.count() > 0;
  t('the pre-op card is on the Task Center', tcThere,
    (await wide.locator('body').innerText()).slice(0, 200).replace(/\n/g, ' '));
  if (tcThere) {
    await tcCard.scrollIntoViewIfNeeded().catch(() => {});
    await tcCard.locator('[data-wo-complete]').click().catch(() => {});
    await wide.waitForTimeout(800);
  }
  t('THE ATP BOX IS ON THE DESK FORM TOO — the reported gap, closed',
    tcThere && await tcCard.locator('[data-atp-field]').count() > 0);
  t('…and says why it is being asked for',
    tcThere && await tcCard.locator('[data-swab-block][data-swab-reason="production_clean"]').count() > 0);
  if (tcThere) {
    await tcCard.locator('[data-atp-field]').fill(String(LIMIT + 165)).catch(() => {});
    await wide.waitForTimeout(400);
  }
  t('an over-limit reading says so before Done is pressed',
    tcThere && new RegExp(String(LIMIT)).test(await tcCard.innerText()));

  // THE WHOLE CHAIN, DRIVEN BY THE REAL FORM: type the reading, press Done,
  // and read the record the server filed. Everything above this proves the
  // server grades what it is sent; this is the only assertion that proves the
  // screen sends it — which is the half that was missing.
  if (tcThere) {
    await tcCard.locator('[data-atp-field]').fill('21').catch(() => {});
    await tcCard.locator('button[type="submit"]').first().click().catch(() => {});
    await wide.waitForTimeout(2500);
  }
  const typed = record('atp-tc-4');
  t('PRESSING DONE ON THE DESK FORM FILES THE READING IT WAS GIVEN',
    String(typed?.atp_reading) === '21', `atp_reading=${typed?.atp_reading}`);
  t('…graded against PC #1’s limit, like every other door',
    Number(typed?.atp_limit) === Number(LIMIT), `atp_limit=${typed?.atp_limit}`);

  // The negative control on the same screen: a clean that owes no swab.
  if (await search.count()) { await search.fill('Restroom Daily Cleaning'); await wide.waitForTimeout(1500); }
  const tcRest = wide.locator('[data-wo-card="atp-tc-rest"]').first();
  if (await tcRest.count()) {
    await tcRest.scrollIntoViewIfNeeded().catch(() => {});
    await tcRest.locator('[data-wo-complete]').click().catch(() => {});
    await wide.waitForTimeout(700);
  }
  t('the restroom clean is offered no swab box here either',
    tcThere && await tcRest.count() > 0
    && await tcRest.locator('[data-swab-block]').count() === 0
    && await tcRest.locator('[data-atp-field]').count() === 0);

  await browser.close();
}

console.log(`\n${pass}/${pass + fail} assertions passed`);
process.exit(fail ? 1 : 0);
