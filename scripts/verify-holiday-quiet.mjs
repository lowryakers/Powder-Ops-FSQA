// verify:holidayquiet — a paid holiday is quiet, and the card opens the full list (D-176).
//
//   1. The card's production line names its week, never "this week".
//   2. Clicking the "Paid holidays coming up" card opens every paid holiday the
//      plant observes, by year, with the date each is observed on.
//   3. On a paid holiday nothing daily is owed: the scale-check strip is empty,
//      a task card due that day moves to the next open day (audited, not
//      "missed"), the generator never dates a new card on a closed day, and a
//      run left on a holiday is not a missing end-of-day report.
//
// "Today" is made a holiday the way the plant would: an admin override in
// Settings, with a reason — then put back. HOUSEKEEPING_MS=0 lets each read
// run the sweep. Caller sets PORT + DBPATH. Needs a fresh database.
const PORT = process.env.PORT || 5102;
const B = `http://localhost:${PORT}/api`;
const J = async r => { try { return await r.json(); } catch { return null; } };
let pass = 0, fail = 0;
const t = (n, c, d = '') => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (d ? ' — ' + d : '')); } };
let tok = null;
const req = (p, o = {}) => fetch(B + p, { ...o, headers: { 'Content-Type': 'application/json', ...(tok ? { Authorization: `Bearer ${tok}` } : {}), ...(o.headers || {}) } });
const post = (p, b) => req(p, { method: 'POST', body: JSON.stringify(b) });
const put = (p, b) => req(p, { method: 'PUT', body: JSON.stringify(b) });
const get = (p) => req(p);

const { default: Database } = await import('better-sqlite3');
const db = new Database(process.env.DBPATH || process.env.DB_PATH);
db.prepare(`INSERT OR REPLACE INTO users (id,name,username,role,department,is_active,setup_code,setup_code_expires_at)
  VALUES ('hq-admin','Quiet Admin','Quiet Admin','admin','office',1,'SC-HQ',datetime('now','+7 day'))`).run();
await post('/users/login', { name: 'Quiet Admin' });
await post('/users/set-password', { user_id: 'hq-admin', password: 'QuietPW2026!', setup_code: 'SC-HQ' });
tok = (await J(await post('/users/login', { name: 'Quiet Admin', password: 'QuietPW2026!' })))?.token;
t('an admin signed in', !!tok);

console.log('\n── the card names the week ──');
const up = await J(await get('/plant-calendar/upcoming?today=2026-10-14&days=60'));
const tw = up?.weeks?.find(w => w.week_start === '2026-11-23');
t('"Production days the week of Nov 23: Monday, Tuesday, Wednesday." — never "this week"',
  tw?.summary.at(-1) === 'Production days the week of Nov 23: Monday, Tuesday, Wednesday.', JSON.stringify(tw?.summary));
t('…nor in Spanish', /la semana del 23 nov/.test(tw?.summary_es?.at(-1) || '') && !/esta semana/i.test(tw?.summary_es?.at(-1) || ''), tw?.summary_es?.at(-1));
const quietStretch = await J(await get('/plant-calendar/upcoming?today=2026-02-02&days=60'));
t('in the long gap after New Year the card still names the next holiday (Memorial Day)',
  quietStretch?.weeks?.length === 0 && quietStretch?.next?.key === 'memorial_day', JSON.stringify(quietStretch?.next));

console.log('\n── today made a paid holiday ──');
const today = up ? (await J(await get('/plant-calendar/upcoming')))?.today : null;
const year = Number(String(today).slice(0, 4));
const before = await J(await get('/pm/operator-checks?group=all'));
t('on an ordinary day the scale-check strip lists checks still owed', (before?.scale_checks || []).length > 0, String(before?.scale_checks?.length));

// A card due today and one due Thanksgiving, raised before the calendar knew.
const eq = db.prepare("SELECT id FROM equipment WHERE status = 'active' LIMIT 1").get();
db.prepare(`INSERT INTO work_orders (id, equipment_id, title, due_date, status, task_group) VALUES
  ('hq-wo-today', ?, 'Holiday test — daily check', ?, 'open', 'warehouse'),
  ('hq-wo-thanks', ?, 'Holiday test — Thanksgiving card', '2026-11-26', 'open', 'warehouse')`).run(eq.id, today, eq.id);

let r = await put(`/plant-calendar/labor_day/${year}`, { observed_on: today, reason: 'Verify: today is a paid holiday' });
t('an admin makes today a paid holiday (Settings override, with a reason)', r.status === 200, String(r.status));

const during = await J(await get('/pm/operator-checks?group=all'));
t('THE SCALE-CHECK STRIP IS EMPTY ON A PAID HOLIDAY', Array.isArray(during?.scale_checks) && during.scale_checks.length === 0, JSON.stringify(during));
const status = await J(await get('/scale-verification/status'));
t('…and the scale status says why (the holiday it is)', status?.holiday?.name === 'Labor Day', JSON.stringify(status).slice(0, 160));

await get('/pm/operator-tasks?group=all'); // runs the housekeeping sweep
const woToday = db.prepare("SELECT due_date, status FROM work_orders WHERE id = 'hq-wo-today'").get();
t('A CARD DUE ON THE HOLIDAY MOVES TO THE NEXT OPEN DAY — not "missed"', woToday.due_date > today && woToday.status === 'open', JSON.stringify(woToday));
const woThanks = db.prepare("SELECT due_date, status FROM work_orders WHERE id = 'hq-wo-thanks'").get();
t('a card dated Thanksgiving moves past the Friday after, to Monday Nov 30', woThanks.due_date === '2026-11-30', JSON.stringify(woThanks));
const audits = db.prepare("SELECT details FROM audit_log WHERE entity_id IN ('hq-wo-today','hq-wo-thanks') AND action LIKE 'holiday_resched%'").all();
t('…each move is audited, naming the holiday', audits.length === 2 && audits.some(a => /Thanksgiving/.test(a.details)), JSON.stringify(audits));

// A daily schedule with nothing open: the generator dates its card.
db.prepare(`INSERT INTO pm_schedules (id, equipment_id, title, frequency_type, frequency_value, is_active, task_group)
  VALUES ('hq-sched', ?, 'Holiday test — new daily schedule', 'daily', 1, 1, 'warehouse')`).run(eq.id);
await get('/pm/operator-tasks?group=all');
const gen = db.prepare("SELECT due_date FROM work_orders WHERE pm_schedule_id = 'hq-sched'").get();
t('THE GENERATOR NEVER DATES A NEW CARD ON THE HOLIDAY', !!gen && gen.due_date !== today && gen.due_date > today, JSON.stringify(gen));

await req(`/plant-calendar/labor_day/${year}`, { method: 'DELETE' });
const after = await J(await get('/pm/operator-checks?group=all'));
t('back to the rule, today owes its scale checks again', (after?.scale_checks || []).length > 0);

console.log('\n── a run left on a holiday is not a missing report ──');
const slot = (week, day, mo) => post('/production/schedule', { week_start: week, day_of_week: day, room: '2', team: 'Batching', mo_number: mo, product_name: 'Test Mix', updated_by: 'Quiet Admin', append: true });
await slot('2026-09-07', 0, 'MO-LABORDAY');  // Labor Day 2026 (Mon)
await slot('2026-09-07', 1, 'MO-TUESDAY');
const missed = await J(await get('/production/missed-reports?from=2026-09-07&to=2026-09-08'));
t('THE RUN ON LABOR DAY IS NOT CHASED', Array.isArray(missed) && !missed.some(m => m.mo_number === 'MO-LABORDAY'), JSON.stringify(missed));
t('…the one on the Tuesday still is', Array.isArray(missed) && missed.some(m => m.mo_number === 'MO-TUESDAY'));

console.log('\n── in a real browser ──');
const { chromium } = await import('playwright-core');
const URL = `http://localhost:${PORT}`;
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
page.on('pageerror', e => { console.log('  [pageerror]', e.message); fail++; });
await page.goto(`${URL}/manifest.webmanifest`);
await page.evaluate(([tk, u]) => { localStorage.setItem('auth_token', tk); localStorage.setItem('auth_user', JSON.stringify(u)); },
  [tok, { id: 'hq-admin', name: 'Quiet Admin', role: 'admin', department: 'office' }]);
await page.goto(`${URL}/?tab=production-schedule`);
const card = page.locator('[data-holidays-strip]').first();
t('the schedule shows the holiday card', await card.waitFor({ timeout: 20000 }).then(() => true).catch(() => false));
const text = await card.innerText().catch(() => '');
t('THE CARD NAMES THE WEEK — "the week of Nov 23", no "this week" on the production line',
  /Production days the week of Nov 23/.test(text) && !/Production days this week/.test(text), text);
t('…and says it opens the full list', /See all/.test(text));
await card.click();
const list = page.locator('[data-holiday-list]');
t('CLICKING THE CARD OPENS THE LIST OF PAID HOLIDAYS', await list.waitFor({ timeout: 5000 }).then(() => true).catch(() => false));
const items = await list.locator('[data-holiday-item]').count();
t('…every holiday the plant observes this year — nine', items === 9, String(items));
const names = await list.innerText();
t('…by name and date (Thanksgiving Day, Christmas Eve, Memorial Day)', /Thanksgiving Day/.test(names) && /Christmas Eve/.test(names) && /Memorial Day/.test(names));
t('…marking the Tuesday–Friday weeks', /Production runs Tuesday–Friday that week/.test(names));
await list.locator('button[aria-label="Next year"]').click();
await page.waitForTimeout(600);
const ind = await list.locator('[data-holiday-item="independence_day"]').innerText().catch(() => '');
t('next year: Independence Day 2027 (a Sunday) reads as observed Friday Jul 2', /Jul 2/.test(ind) && /Falls on/.test(ind), ind);
await list.locator('button[aria-label="Close"]').click();
t('the list closes', await page.locator('[data-holiday-list]').count() === 0);

await page.setViewportSize({ width: 390, height: 844 });
await page.goto(`${URL}/?tab=operator`);
const opCard = page.locator('[data-holidays-strip]').first();
await opCard.waitFor({ timeout: 20000 }).catch(() => {});
await opCard.click().catch(() => {});
t('ON A PHONE the Operator View card opens the same list', await page.locator('[data-holiday-list]').waitFor({ timeout: 5000 }).then(() => true).catch(() => false));
t('…without panning sideways', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));

await browser.close();
db.close();
console.log(`\n${pass}/${pass + fail} assertions passed`);
process.exit(fail ? 1 : 0);
