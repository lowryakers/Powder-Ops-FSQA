// verify:holidays — the paid holidays on the schedule, where people see them (D-175).
//
//   1. The calendar is derived from rules and read by every employee; only an
//      admin corrects one year, with a reason, audited; back to the rule undoes it.
//   2. The schedule's Notify message says when the week has a holiday.
//   3. ONE notice per holiday week, on the Monday of the week before, from 6am
//      plant time; a missed Monday catches up; once the week has started it is
//      late news and is not sent; never twice.
//   4. In a browser: the "coming up" strip, the closed column, the run on a
//      closed day reported, the editor's warning, a shift week's Friday and the
//      one-click move there, the Operator View at 390px, and Settings.
//
// Caller sets PORT + DBPATH. Needs a fresh database. Machine date 2026-10-14
// is assumed only for the browser's week navigation, which it computes.
const PORT = process.env.PORT || 5101;
const B = `http://localhost:${PORT}/api`;
const J = async r => { try { return await r.json(); } catch { return null; } };
let pass = 0, fail = 0;
const t = (n, c, d = '') => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (d ? ' — ' + d : '')); } };
let tok = null;
const req = (p, o = {}, k = tok) => fetch(B + p, { ...o, headers: { 'Content-Type': 'application/json', ...(k ? { Authorization: `Bearer ${k}` } : {}), ...(o.headers || {}) } });
const post = (p, b, k) => req(p, { method: 'POST', body: JSON.stringify(b) }, k);
const put = (p, b, k) => req(p, { method: 'PUT', body: JSON.stringify(b) }, k);
const get = (p, k) => req(p, {}, k);

const { default: Database } = await import('better-sqlite3');
const db = new Database(process.env.DBPATH || process.env.DB_PATH);
const mkUser = (id, name, role, dept) => db.prepare(`INSERT OR REPLACE INTO users (id,name,username,role,department,is_active,setup_code,setup_code_expires_at)
  VALUES (?,?,?,?,?,1,?,datetime('now','+7 day'))`).run(id, name, name, role, dept, `SC-${id}`);
mkUser('hol-admin', 'Holiday Admin', 'admin', 'office');
mkUser('hol-op', 'Holiday Operator', 'operator', 'warehouse');
async function signIn(id, name) {
  await post('/users/login', { name });
  await post('/users/set-password', { user_id: id, password: 'HolidayPW2026!', setup_code: `SC-${id}` });
  return (await J(await post('/users/login', { name, password: 'HolidayPW2026!' })))?.token;
}
tok = await signIn('hol-admin', 'Holiday Admin');
const opTok = await signIn('hol-op', 'Holiday Operator');
t('an admin and an operator signed in', !!tok && !!opTok);

console.log('\n── the calendar, derived and read by everybody ──');
let r = await get('/plant-calendar?year=2026');
let cal = await J(r);
t('GET /plant-calendar answers', r.status === 200, String(r.status));
const d26 = Object.fromEntries((cal?.holidays || []).map(h => [h.key, h.date]));
t('2026: Thanksgiving Nov 26, the Friday after Nov 27, Christmas Eve Dec 24, NYE Dec 31',
  d26.thanksgiving === '2026-11-26' && d26.day_after_thanksgiving === '2026-11-27' && d26.christmas_eve === '2026-12-24' && d26.new_years_eve === '2026-12-31', JSON.stringify(d26));
t('Independence Day 2026 (Saturday) was observed Friday Jul 3', d26.independence_day === '2026-07-03');
t('…and a paid holiday is 8 hours', cal?.holiday_hours === 8);
r = await get('/plant-calendar/upcoming?today=2026-10-14&days=60', opTok);
const up = await J(r);
t('AN OPERATOR READS what is coming up — a holiday is plant-wide news', r.status === 200 && up?.weeks?.length >= 1, String(r.status));
const tw = up?.weeks?.find(w => w.week_start === '2026-11-23');
t('Thanksgiving week is in the next 60 days with its effect in words',
  !!tw && tw.summary.at(-1) === 'Production days the week of Nov 23: Monday, Tuesday, Wednesday.', JSON.stringify(tw?.summary));
t('…and in Spanish', /Acción de Gracias/.test((tw?.summary_es || []).join(' ')));
t('…and the Monday its notice goes out', tw?.notice_on === '2026-11-16');
r = await get('/plant-calendar/week?week_start=2027-05-31');
const mem = await J(r);
t('Memorial Day 2027 week: Monday closed, production Tuesday–Friday', mem?.shift_week === true && mem.days[0].closed && mem.days[4].production);

console.log('\n── one year corrected by an admin, never the rule ──');
r = await put('/plant-calendar/christmas_eve/2026', { cancelled: true, reason: 'nope' }, opTok);
t('an operator cannot change a holiday', r.status === 403);
r = await put('/plant-calendar/christmas_eve/2026', { cancelled: true });
t('a change with no reason is refused, in words', r.status === 400 && /reason/i.test((await J(r))?.error || ''));
r = await put('/plant-calendar/no_such_day/2026', { cancelled: true, reason: 'test reason' });
t('a holiday the plant does not have is refused', r.status === 400);
// The Friday after Thanksgiving moved to the Monday after: that week becomes a
// Tuesday–Friday week by the same rule — used by the browser half below.
r = await put('/plant-calendar/day_after_thanksgiving/2026', { observed_on: '2026-11-30', reason: 'Verify: observe it the Monday after' });
cal = await J(r);
t('an admin moves one year of one holiday', r.status === 200 && cal?.holidays?.find(h => h.key === 'day_after_thanksgiving')?.date === '2026-11-30');
const nov30 = await J(await get('/plant-calendar/week?week_start=2026-11-30'));
t('…the week it lands on becomes a Tuesday–Friday week', nov30?.shift_week === true && nov30.days[4].production);
const nov23 = await J(await get('/plant-calendar/week?week_start=2026-11-23'));
t('…and Thanksgiving week now has Friday open again', nov23?.days[4].closed === false && nov23.days[3].closed === true);
const audit = db.prepare("SELECT * FROM audit_log WHERE entity_type = 'plant_holiday' AND entity_id = 'day_after_thanksgiving:2026'").all();
t('the change is audited with its reason', audit.length === 1 && /observe it the Monday after/.test(audit[0].details || ''));
r = await put('/plant-calendar/memorial_day/2027', { shift_week: false, reason: 'Customer run on the Monday' });
t('an admin can keep a Monday-holiday week Monday–Thursday', (await J(await get('/plant-calendar/week?week_start=2027-05-31')))?.shift_week === false);
await req('/plant-calendar/memorial_day/2027', { method: 'DELETE' });
t('"back to the rule" undoes it', (await J(await get('/plant-calendar/week?week_start=2027-05-31')))?.shift_week === true);
t('…and leaves its own audit entry', db.prepare("SELECT COUNT(*) c FROM audit_log WHERE action LIKE 'plant_holiday_reset%' OR (entity_type='plant_holiday' AND entity_id='memorial_day:2027')").get().c >= 2);

console.log('\n── the schedule says so when published ──');
const slot = async (week, day, room, mo) => J(await post('/production/schedule', { week_start: week, day_of_week: day, room, team: 'Batching', mo_number: mo, product_name: 'Test Mix', updated_by: 'Holiday Admin', append: true }));
await slot('2026-11-23', 3, '2', 'MO-THANKS');    // a run left on Thanksgiving
await slot('2026-11-23', 0, '2', 'MO-MONDAY');
await slot('2026-11-30', 0, '3', 'MO-SHIFT');     // a run on the moved holiday's Monday
db.prepare("INSERT INTO chat_channels (id, kind, name, topic, created_by) VALUES ('hol-sched', 'public', 'production_schedule', 'x', 'system')").run();
r = await post('/production/schedule/notify', { kind: 'new', week_start: '2026-11-23' });
const posted = db.prepare("SELECT body FROM chat_messages WHERE channel_id = 'hol-sched' ORDER BY created_at DESC").get()?.body || '';
t('the published summary carries a "Holiday this week" block', r.status === 200 && /Holiday this week/.test(posted) && /Thanksgiving Day/.test(posted), posted.slice(0, 300));
await post('/production/schedule/notify', { kind: 'new', week_start: '2026-10-12' });
const plainPost = db.prepare("SELECT body FROM chat_messages WHERE channel_id = 'hol-sched' ORDER BY created_at DESC").get()?.body || '';
t('…and an ordinary week\'s does not', !/Holiday this week/.test(plainPost));

console.log('\n── one notice per holiday week ──');
const { sendHolidayNotices } = await import('../server/plant-calendar.js');
const posts = [], pushes = [];
const deps = {
  getChannelByName: (_db, name) => (name === 'announcements' ? { id: 'ann', name } : null),
  postMessageAs: async (_db, ch, author, body) => { posts.push({ ch: ch.name, author: author.name, body }); return { id: `m${posts.length}` }; },
  getBotUser: () => ({ id: 'bot', name: 'ReadyBot' }),
  pushToUser: async (id, payload) => { pushes.push({ id, payload }); },
};
let n = await sendHolidayNotices(db, deps, new Date('2026-11-16T12:00:00Z'));
t('not before 6am plant time (5am Mountain on the Monday)', n.sent === 0 && posts.length === 0);
n = await sendHolidayNotices(db, deps, new Date('2026-11-13T16:00:00Z'));
t('not before its Monday (the Friday before)', n.sent === 0);
n = await sendHolidayNotices(db, deps, new Date('2026-11-16T15:00:00Z'));
t('ON THE MONDAY OF THE WEEK BEFORE: one notice, Thanksgiving week', n.sent === 1 && posts.length === 1 && /Thanksgiving Day/.test(posts[0].body), JSON.stringify(n));
t('…by ReadyBot, in #announcements', posts[0]?.author === 'ReadyBot' && posts[0]?.ch === 'announcements');
t('…in English and Spanish', /Production days the week of Nov 23/.test(posts[0]?.body || '') && /Día festivo pagado/.test(posts[0]?.body || ''));
const active = db.prepare("SELECT COUNT(*) c FROM users WHERE is_active = 1 AND COALESCE(is_external,0) = 0 AND role != 'auditor' AND name != 'ReadyBot'").get().c;
t('…pushed once to every active employee', pushes.length === active && pushes.every(p => /Paid holiday/.test(p.payload.title)), `${pushes.length} of ${active}`);
t('…the push opens the Operator View, which everybody has', pushes[0]?.payload.url === '/?tab=operator');
n = await sendHolidayNotices(db, deps, new Date('2026-11-17T15:00:00Z'));
t('NEVER TWICE: the next tick sends nothing', n.sent === 0 && posts.length === 1);
n = await sendHolidayNotices(db, deps, new Date('2026-11-30T15:00:00Z'));
t('a week that has already started is late news and is not announced', n.sent === 0
  && !db.prepare("SELECT 1 FROM plant_holiday_notices WHERE week_start = '2026-11-30'").get());
n = await sendHolidayNotices(db, deps, new Date('2026-12-15T15:00:00Z'));
t('A MISSED MONDAY CATCHES UP: Christmas week announced on the Tuesday', n.sent === 1 && /Christmas Eve/.test(posts.at(-1).body));
t('the notices table holds exactly the weeks announced', db.prepare('SELECT week_start FROM plant_holiday_notices ORDER BY week_start').all().map(x => x.week_start).join() === '2026-11-23,2026-12-21');

console.log('\n── in a real browser ──');
const { chromium } = await import('playwright-core');
const URL = `http://localhost:${PORT}`;
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });
page.on('pageerror', e => { console.log('  [pageerror]', e.message); fail++; });
await page.goto(`${URL}/manifest.webmanifest`);
await page.evaluate(([tk, u]) => { localStorage.setItem('auth_token', tk); localStorage.setItem('auth_user', JSON.stringify(u)); },
  [tok, { id: 'hol-admin', name: 'Holiday Admin', role: 'admin', department: 'office' }]);
await page.goto(`${URL}/?tab=production-schedule`);
const strip = page.locator('[data-holidays-strip]').first();
t('the schedule opens with "Paid holidays coming up"', await strip.waitFor({ timeout: 20000 }).then(() => true).catch(() => false));
t('…naming Thanksgiving and what it does to production', /Thanksgiving Day/.test(await strip.innerText()) && /Production days the week of Nov 23: Monday, Tuesday, Wednesday/.test(await strip.innerText()));

// Navigate from this week to the week of Nov 23.
const monday = (() => { const d = new Date(); const w = (d.getDay() + 6) % 7; d.setDate(d.getDate() - w); d.setHours(0, 0, 0, 0); return d; })();
const weeksTo = Math.round((new Date('2026-11-23T00:00:00') - monday) / (7 * 86400000));
for (let i = 0; i < weeksTo; i++) { await page.locator('button[title="Next week"]').click(); await page.waitForTimeout(150); }
await page.waitForTimeout(900);
const thu = page.locator('th[data-day-head="3"]');
t('THANKSGIVING\'S COLUMN IS MARKED CLOSED, by name', (await thu.getAttribute('data-closed')) === '1' && /Thanksgiving Day/.test(await thu.innerText()), await thu.innerText().catch(() => ''));
t('…and its cells are tinted', await page.locator('td[data-closed-cell="1"]').count() > 0);
t('Friday is open again in this week (the holiday was moved)', (await page.locator('th[data-day-head="4"]').getAttribute('data-closed')) === null);
const banner = page.locator('[data-closed-runs]');
t('THE RUN LEFT ON THANKSGIVING IS REPORTED', await banner.count() === 1 && /1 run is scheduled on a paid holiday: Thursday \(Thanksgiving Day\)/.test(await banner.innerText()), await banner.innerText().catch(() => ''));
// The editor warns on a closed day, and still opens.
await page.locator('td[data-closed-cell="1"]').filter({ hasNot: page.locator('text=MO-THANKS') }).first().click();
const warn = page.locator('[data-cell-holiday]');
t('THE EDITOR WARNS on a holiday — it does not refuse', await warn.waitFor({ timeout: 5000 }).then(() => true).catch(() => false) && /paid holiday/.test(await warn.innerText()));
await page.mouse.click(5, 5);
await page.waitForTimeout(300);

await page.locator('button[title="Next week"]').click();
await page.waitForTimeout(1200);
const friHead = page.locator('th[data-day-head="4"]');
t('A TUESDAY–FRIDAY WEEK: Friday is marked "Production day"', await friHead.locator('[data-shift-day]').count() === 1);
t('…and Monday closed', (await page.locator('th[data-day-head="0"]').getAttribute('data-closed')) === '1');
const move = page.locator('[data-move-to-friday]');
t('the Monday run is reported with a "Move it to Friday" button', await move.count() === 1 && /Move it to Friday/.test(await move.innerText()));
await move.click();
await page.waitForTimeout(1200);
const after = await J(await get('/production/schedule?week_start=2026-11-30'));
t('ONE CLICK MOVES IT TO FRIDAY', after?.assignments?.find(a => a.mo_number === 'MO-SHIFT')?.day_of_week === 4);
t('…the move is audited like any other', db.prepare("SELECT COUNT(*) c FROM audit_log WHERE entity_type = 'production_schedule' AND action = 'move'").get().c >= 1);
t('…and the banner is gone', await page.locator('[data-closed-runs]').count() === 0);

// Operator View on a phone.
await page.setViewportSize({ width: 390, height: 844 });
await page.goto(`${URL}/?tab=operator`);
const opStrip = page.locator('[data-holidays-strip]').first();
t('THE OPERATOR VIEW shows what is coming up (60 days)', await opStrip.waitFor({ timeout: 20000 }).then(() => true).catch(() => false));
t('…without the page panning sideways at 390px', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
await page.locator('button', { hasText: /^ES$/ }).first().click();
await page.waitForTimeout(400);
t('…and in Spanish with the ES switch', /Días festivos pagados próximos/.test(await opStrip.innerText()) && /Acción de Gracias/.test(await opStrip.innerText()));
await page.locator('button', { hasText: /^EN$/ }).first().click();

// Settings → Plant holidays.
await page.setViewportSize({ width: 1440, height: 950 });
await page.goto(`${URL}/?tab=settings&section=plant-holidays`);
const row = page.locator('[data-holiday-row="christmas_eve"]');
t('Settings → Plant holidays lists the year', await row.waitFor({ timeout: 20000 }).then(() => true).catch(() => false));
await page.locator('[data-holiday-edit="christmas_eve"]').click();
await page.locator('label', { hasText: 'Not observed this year' }).locator('input').check();
await page.locator('#holiday-reason').fill('Verify: open on Christmas Eve this year');
await page.locator('[data-holiday-save]').click();
await page.waitForTimeout(800);
t('AN ADMIN CHANGES ONE YEAR from Settings, with a reason', /Not observed this year/.test(await row.innerText()) && /open on Christmas Eve/.test(await row.innerText()), await row.innerText());
t('…stored as an override, not a change to the rule', db.prepare("SELECT cancelled FROM plant_holiday_overrides WHERE holiday_key='christmas_eve' AND year=2026").get()?.cancelled === 1);
await row.locator('button', { hasText: 'Back to the rule' }).click();
await page.waitForTimeout(800);
t('"Back to the rule" from Settings', !db.prepare("SELECT 1 FROM plant_holiday_overrides WHERE holiday_key='christmas_eve' AND year=2026").get()
  && !/Not observed/.test(await row.innerText()));

await browser.close();
db.close();
console.log(`\n${pass}/${pass + fail} assertions passed`);
process.exit(fail ? 1 : 0);
