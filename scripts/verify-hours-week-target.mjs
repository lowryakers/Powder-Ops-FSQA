// verify:weektarget — each week on the Hours tab carries its own target (D-167).
//
// Payroll is tracked weekly, and the Hours grid had ONE Target/wk column at the
// start of the row, so a short week (a closure, a holiday counted as hours)
// could only be expressed by changing somebody's usual target for every week.
// What this proves:
//   1. A week's target moves THAT week's paid non-working and overtime, and
//      leaves the other week and the person's usual target alone.
//   2. Setting a week's target on a week with no hours does NOT start
//      auto-filling it: an untouched week must not invent paid time.
//   3. Clearing it (or typing the usual figure back) follows the usual target
//      again; a contractor is refused a target; the change is audited.
//   4. On screen: a Target box inside each week, the usual target beside the
//      name, the outlined state and its reset, and the CSV per week.
//
// Caller sets PORT + DBPATH. Needs a fresh database.
const PORT = process.env.PORT || 5094;
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
  VALUES ('wt-admin','Week Admin','Week Admin','admin','office',1,'SC-WT',datetime('now','+7 day'))`).run();
for (const [id, name] of [['wt-a', 'Alpha Weekly'], ['wt-b', 'Bravo Weekly']]) {
  db.prepare(`INSERT OR REPLACE INTO users (id,name,username,role,department,is_active)
    VALUES (?,?,?,'operator','warehouse',1)`).run(id, name, name);
}
db.prepare(`INSERT INTO pay_employees (id,user_id,name,team,pay_rate,active) VALUES ('pe-wt-a','wt-a','Alpha Weekly','warehouse',20,1)`).run();
db.prepare(`INSERT INTO pay_employees (id,user_id,name,team,pay_rate,active,worker_type,contractor_company)
  VALUES ('pe-wt-temp',NULL,'Temp Weekly','warehouse',25,1,'contractor','Agency')`).run();

await post('/users/login', { name: 'Week Admin' });
await post('/users/set-password', { user_id: 'wt-admin', password: 'WeekPW2026!', setup_code: 'SC-WT' });
tok = (await J(await post('/users/login', { name: 'Week Admin', password: 'WeekPW2026!' })))?.token;
t('the office signed in', !!tok);

const h0 = await J(await get('/office/hours'));
const [W1, W2] = h0.weeks;
const P = (d, n) => (d.people || []).find(p => p.name === n);
const wk = (d, n, w) => P(d, n)?.weeks.find(x => x.week_start === w);

console.log('\n── a week carries its own target ──');
t('every week reports its target, the usual one until somebody changes it',
  wk(h0, 'Alpha Weekly', W1)?.target === 40 && wk(h0, 'Alpha Weekly', W2)?.target === 40 && wk(h0, 'Alpha Weekly', W1)?.target_set === false);
t('a contractor\'s week has no target', wk(h0, 'Temp Weekly', W1)?.target === null);

// Alpha works 30h in both weeks; week 1 is a 32-hour week.
await put('/office/hours', { user_id: 'wt-a', week_start: W1, worked: 30 });
await put('/office/hours', { user_id: 'wt-a', week_start: W2, worked: 30 });
let r = await put('/office/hours', { user_id: 'wt-a', week_start: W1, target: 32 });
t('setting week 1\'s target saves', r.status === 200, String(r.status));
let h = await J(await get('/office/hours'));
t('WEEK 1 IS MEASURED AGAINST 32: 2:00 paid non-working, not 10:00',
  wk(h, 'Alpha Weekly', W1)?.target === 32 && wk(h, 'Alpha Weekly', W1)?.target_set === true && wk(h, 'Alpha Weekly', W1)?.non_working === 2,
  JSON.stringify(wk(h, 'Alpha Weekly', W1)));
t('WEEK 2 IS UNTOUCHED: still 40, still 10:00 non-working',
  wk(h, 'Alpha Weekly', W2)?.target === 40 && wk(h, 'Alpha Weekly', W2)?.non_working === 10);
t('and the person\'s usual target did not move', P(h, 'Alpha Weekly')?.target === 40
  && db.prepare("SELECT weekly_hours_target FROM users WHERE id = 'wt-a'").get().weekly_hours_target == null);
t('the period total is the sum of the two weeks as measured (32 + 40)', P(h, 'Alpha Weekly')?.period.total === 72, String(P(h, 'Alpha Weekly')?.period.total));

await put('/office/hours', { user_id: 'wt-a', week_start: W2, worked: 45, target: 44 });
h = await J(await get('/office/hours'));
// D-193: the weekly total is what is paid; recorded beyond it is unpaid, and
// overtime is the paid worked hours over 40 — not over the person's own total.
t('UNPAID IS DERIVED: 45 recorded against a 44 weekly total is 1:00 unpaid', wk(h, 'Alpha Weekly', W2)?.unpaid === 1,
  JSON.stringify(wk(h, 'Alpha Weekly', W2)));
t('OVERTIME IS OVER 40 IN THE WEEKLY TOTAL: a 44 week is 4:00', wk(h, 'Alpha Weekly', W2)?.overtime === 4,
  String(wk(h, 'Alpha Weekly', W2)?.overtime));
t('…paid hours are the weekly total, and the cost follows (44h × $20 + 4h × $10 premium)',
  wk(h, 'Alpha Weekly', W2)?.total === 44 && wk(h, 'Alpha Weekly', W2)?.cost === 920, String(wk(h, 'Alpha Weekly', W2)?.cost));
r = await put('/office/hours', { user_id: 'wt-a', week_start: W2, unpaid: 3 });
t('a typed unpaid figure for an employee is refused — it is worked out from the weekly total', r.status === 400, String(r.status));

console.log('\n── a target alone is not an entry ──');
r = await put('/office/hours', { user_id: 'wt-b', week_start: W1, target: 24 });
h = await J(await get('/office/hours'));
t('A WEEK WITH NO HOURS STAYS EMPTY when only its target is set — no 24:00 of invented paid time',
  r.status === 200 && wk(h, 'Bravo Weekly', W1)?.non_working === 0 && wk(h, 'Bravo Weekly', W1)?.has_entry === false
  && wk(h, 'Bravo Weekly', W1)?.target === 24, JSON.stringify(wk(h, 'Bravo Weekly', W1)));
await put('/office/hours', { user_id: 'wt-b', week_start: W1, worked: 20 });
h = await J(await get('/office/hours'));
t('the first hours typed make it an entry, balanced to the week\'s 24', wk(h, 'Bravo Weekly', W1)?.non_working === 4
  && wk(h, 'Bravo Weekly', W1)?.target === 24);

console.log('\n── clearing, refusing, auditing ──');
r = await put('/office/hours', { user_id: 'wt-a', week_start: W1, target: null });
h = await J(await get('/office/hours'));
t('clearing a week\'s target follows the usual one again', wk(h, 'Alpha Weekly', W1)?.target === 40
  && wk(h, 'Alpha Weekly', W1)?.target_set === false && wk(h, 'Alpha Weekly', W1)?.non_working === 10);
await put('/office/hours/target/wt-a', { target: 36 });
h = await J(await get('/office/hours'));
t('A CHANGE TO THE USUAL TARGET REACHES EVERY WEEK THAT FOLLOWS IT, and not the one that has its own',
  wk(h, 'Alpha Weekly', W1)?.target === 36 && wk(h, 'Alpha Weekly', W2)?.target === 44);
await put('/office/hours/target/wt-a', { target: null });
r = await put('/office/hours', { user_id: 'pe-wt-temp', week_start: W1, target: 30 });
t('a contractor is refused a weekly target, in words', r.status === 400 && /contractor/i.test((await J(r))?.error || ''));
r = await put('/office/hours', { user_id: 'wt-a', week_start: W1, target: 500 });
t('an impossible target is refused', r.status === 400);
const audits = db.prepare("SELECT details FROM audit_log WHERE entity_type = 'employee_hours' AND entity_id = ?").all(`wt-a:${W1}`);
t('each change to a week\'s target is audited with what it was', audits.length >= 2
  && audits.some(a => /"week_target":32/.test(a.details) && /"was":null/.test(a.details)), JSON.stringify(audits));

// Leave a set week on screen for the browser half.
await put('/office/hours', { user_id: 'wt-a', week_start: W1, target: 32 });

console.log('\n── in a real browser ──');
const { chromium } = await import('playwright-core');
const URL = `http://localhost:${PORT}`;
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ viewport: { width: 1600, height: 950 } });
page.on('pageerror', e => { console.log('  [pageerror]', e.message); fail++; });
await page.goto(`${URL}/manifest.webmanifest`);
await page.evaluate(([tk, u]) => { localStorage.setItem('auth_token', tk); localStorage.setItem('auth_user', JSON.stringify(u)); },
  [tok, { id: 'wt-admin', name: 'Week Admin', role: 'admin', department: 'office' }]);
await page.goto(`${URL}/?tab=time-tracking`);
await page.waitForSelector('text=Time Tracking', { timeout: 20000 });
await page.getByRole('tab', { name: 'Hours', exact: true }).first().click();
const table = page.locator('table').filter({ hasText: 'Week of' }).first();
const onTab = await table.waitFor({ timeout: 20000 }).then(() => true).catch(() => false);
t('the Hours grid renders', onTab);
if (onTab) {
  const heads = await table.locator('thead').innerText();
  t('THERE IS NO LONE Target/wk COLUMN AT THE START', !/Target\/wk/i.test(heads), heads.slice(0, 120));
  t('each week has its own Weekly total column (D-193 renamed it from Target)', (heads.match(/Weekly total/g) || []).length === 2 && !/Target/.test(heads), heads.replace(/\s+/g, ' ').slice(0, 200));
  const row = table.locator('tr', { hasText: 'Alpha Weekly' });
  const w1 = row.locator(`[data-week-target="${W1}"] input`);
  t('week 1 shows its own 32:00', (await w1.inputValue()) === '32:00', await w1.inputValue());
  t('…and a reset, because it differs from the usual', await row.locator(`[data-week-target-reset="${W1}"]`).count() === 1);
  t('week 2 shows its own 44:00', (await row.locator(`[data-week-target="${W2}"] input`).inputValue()) === '44:00');
  t('UNPAID IS SHOWN, NOT TYPED: week 2 reads 1:00 and has no input box',
    (await row.locator(`[data-unpaid="${W2}"]`).innerText()).trim() === '1:00' && (await row.locator(`[data-unpaid="${W2}"] input`).count()) === 0);
  t('the usual target sits beside the name', (await row.locator('[data-usual-target="wt-a"] input').inputValue()) === '40:00');

  // Type a week's target, as the office would.
  const bravo = table.locator('tr', { hasText: 'Bravo Weekly' });
  const bw2 = bravo.locator(`[data-week-target="${W2}"] input`);
  await bw2.fill('30');
  await bw2.press('Enter');
  await page.waitForTimeout(800);
  const after = await J(await get('/office/hours'));
  t('TYPING INTO A WEEK\'S TARGET SAVES THAT WEEK ONLY', wk(after, 'Bravo Weekly', W2)?.target === 30
    && wk(after, 'Bravo Weekly', W1)?.target === 24 && P(after, 'Bravo Weekly')?.target === 40,
    JSON.stringify(P(after, 'Bravo Weekly')?.weeks.map(w => w.target)));
  await row.locator(`[data-week-target-reset="${W1}"]`).click();
  await page.waitForTimeout(800);
  const reset = await J(await get('/office/hours'));
  t('the reset puts week 1 back on the usual target', wk(reset, 'Alpha Weekly', W1)?.target_set === false);

  const box = await row.locator(`[data-week-target="${W2}"] input`).boundingBox();
  const val = await row.locator(`[data-week-target="${W2}"] input`).evaluate(el => el.scrollWidth <= el.clientWidth);
  t('the boxes are wide enough to show 44:00 without clipping', val && box && box.width >= 52, String(box?.width));

  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 15000 }).catch(() => null),
    page.locator('[data-hours-export]').first().click(),
  ]);
  if (download) {
    const fs = await import('node:fs/promises');
    const text = await fs.readFile(await download.path(), 'utf8');
    const head = text.split('\n')[0];
    t('the CSV carries a weekly total per week', head.includes(`"Weekly total ${W1}"`) && head.includes(`"Weekly total ${W2}"`), head.slice(0, 160));
    t('…with the figures on screen', /"Alpha Weekly"[^\n]*"40","30"[^\n]*"44","45"/.test(text),
      text.split('\n').find(l => l.startsWith('"Alpha Weekly"')));
  } else t('the CSV downloads', false);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(400);
  const card = page.locator(`[data-week-target="${W2}"] input`).filter({ visible: true });
  t('ON A PHONE each week block has its own target too', await card.count() >= 2);
  t('…and the page does not pan sideways', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
}
await browser.close();
db.close();
console.log(`\n${pass}/${pass + fail} assertions passed`);
process.exit(fail ? 1 : 0);
