// What the hours cost, read from the rate Pay Tracking already holds.
//
// The ask was "we have pay rates in Pay Tracking — put the rate on the Hours
// tab so we can report against the hours worked". The rate itself is the easy
// half. What this proves is the three places it could quietly go wrong:
//
//   1. THE COST IS DERIVED FROM THE FIGURES ALREADY ON THE SCREEN — the same
//      `total` and the same `overtime` printed in the columns beside it. A
//      cost computed from a second reading of the hours is a number that
//      disagrees with the hours above it, and whoever is looking cannot tell
//      which of the two is wrong.
//   2. NO RATE MEANS NO COST — null, never zero. A zero states that somebody's
//      hours were free, and a labour figure that understates is one people act
//      on. The total says how many of the list it covers.
//   3. THE RATE IS READ, NEVER COPIED. Move it in Pay Tracking and the money
//      here moves with it; nothing is written onto an hours row.
//
// Caller sets PORT + DBPATH. Needs a fresh database.
const PORT = process.env.PORT || 5006;
const B = `http://localhost:${PORT}/api`;
const J = async r => { try { return await r.json(); } catch { return null; } };
let pass = 0, fail = 0;
const t = (n, c, d = '') => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (d ? ' — ' + d : '')); } };
let tok = null;
const req = (p, o = {}) => fetch(B + p, { ...o, headers: { 'Content-Type': 'application/json', ...(tok ? { Authorization: `Bearer ${tok}` } : {}), ...(o.headers || {}) } });
const post = (p, b) => req(p, { method: 'POST', body: JSON.stringify(b) });
const get = (p) => req(p);
const near = (a, b) => a != null && Math.abs(a - b) < 0.005;
const P2 = (d, n) => (d.people || []).find(p => p.name === n);

const { default: Database } = await import('better-sqlite3');
const db = new Database(process.env.DBPATH);

db.prepare(`INSERT OR REPLACE INTO users (id,name,username,role,department,is_active,setup_code,setup_code_expires_at)
  VALUES ('rt-admin','Rate Admin','Rate Admin','admin','office',1,'SC-RT',datetime('now','+7 day'))`).run();
// One of every shape the Rate column has to get right.
const staff = [
  ['rt-hourly', 'Hourly Person', null],
  ['rt-salaried', 'Salaried Person', null],
  ['rt-unlinked', 'Unlinked Person', null],
  ['rt-short', 'Short Week Person', 32],
];
for (const [id, name, target] of staff) {
  db.prepare(`INSERT OR REPLACE INTO users (id,name,username,role,department,is_active,weekly_hours_target)
    VALUES (?,?,?,'operator','warehouse',1,?)`).run(id, name, name, target);
}
// The pay roster: an hourly rate, a blank rate (salaried), and a contractor
// whose row id IS the hours row id. `Unlinked Person` deliberately has none.
db.prepare(`INSERT INTO pay_employees (id,user_id,name,team,pay_rate,active) VALUES ('pe-hourly','rt-hourly','Hourly Person','warehouse',20,1)`).run();
db.prepare(`INSERT INTO pay_employees (id,user_id,name,team,pay_rate,active) VALUES ('pe-salaried','rt-salaried','Salaried Person','warehouse',NULL,1)`).run();
db.prepare(`INSERT INTO pay_employees (id,user_id,name,team,pay_rate,active) VALUES ('pe-short','rt-short','Short Week Person','warehouse',10,1)`).run();
db.prepare(`INSERT INTO pay_employees (id,user_id,name,team,pay_rate,active,worker_type,contractor_company)
  VALUES ('pe-temp',NULL,'Temp Person','warehouse',30,1,'contractor','Agency')`).run();

await post('/users/login', { name: 'Rate Admin' });
await post('/users/set-password', { user_id: 'rt-admin', password: 'RatePW2026!', setup_code: 'SC-RT' });
tok = (await J(await post('/users/login', { name: 'Rate Admin', password: 'RatePW2026!' })))?.token;
t('the office signed in', !!tok);

const h0 = await J(await get('/office/hours'));
const W = h0.weeks[0];
const hour = (uid, worked, extra = {}) => db.prepare(`INSERT INTO employee_hours (id,user_id,week_start,worked,pto,holiday,unpaid,auto_fill)
  VALUES (?,?,?,?,?,?,?,?)`).run(`eh-${uid}`, uid, W, worked, extra.pto || 0, extra.holiday || 0, extra.unpaid || 0, extra.auto_fill ?? 1);
hour('rt-hourly', 48);           // eight hours of overtime on a 40-hour target
hour('rt-salaried', 40);
hour('rt-unlinked', 40);
hour('rt-short', 30);            // under a 32-hour target: two hours paid non-working
hour('pe-temp', 20);             // a contractor: no target, so no balance and no overtime

const h = await J(await get('/office/hours'));
const P = (n) => (h.people || []).find(p => p.name === n);

console.log('\n── the rate comes from Pay Tracking, and says when it cannot ──');
t('an hourly rate is read off the linked pay row', P('Hourly Person')?.rate === 20);
t('A CONTRACTOR IS DIRECT — their hours-list id IS their pay row id', P('Temp Person')?.rate === 30);
t('A BLANK RATE ON A LINKED ROW IS SOMEBODY SALARIED, not an error — the same thing the Pay Tracking roster already calls it',
  P('Salaried Person')?.rate === null && P('Salaried Person')?.rate_linked === true);
t('NO PAY ROW AT ALL IS A DIFFERENT GAP and is reported as one, because it is closed somewhere else — on the Roster tab, by linking the account',
  P('Unlinked Person')?.rate === null && P('Unlinked Person')?.rate_linked === false);

console.log('\n── the cost is the hours on the screen, at that rate ──');
const hp = P('Hourly Person');
const wk = hp.weeks.find(w => w.week_start === W);
t('48 hours at $20 with a 40-hour target is $1,040 — 40 straight and 8 at time and a half',
  near(wk.cost, 1040), JSON.stringify({ cost: wk.cost, straight: wk.straight_cost, prem: wk.ot_premium }));
t('THE PREMIUM IS HALF THE RATE, because the overtime hour itself is already inside `worked` and therefore already inside the paid-hours total — counting it at 1.5x here would pay for it twice',
  near(wk.straight_cost, 960) && near(wk.ot_premium, 80));
t('IT RECONCILES AGAINST THE VERY FIGURES PRINTED BESIDE IT — total x rate plus the premium on the same overtime the column shows, so the money cannot disagree with the hours',
  near(wk.cost, wk.total * hp.rate + wk.overtime * hp.rate * 0.5),
  `${wk.cost} vs ${wk.total}h x ${hp.rate} + ${wk.overtime}h OT`);
t('the period cost is the sum of its weeks', near(hp.period.cost, hp.weeks.reduce((n, w) => n + w.cost, 0)));

const short = P('Short Week Person');
const swk = short.weeks.find(w => w.week_start === W);
t('PAID NON-WORKING IS PAID FOR — 30 worked against a 32-hour target is 32 paid hours at $10',
  near(swk.total, 32) && near(swk.cost, 320), JSON.stringify({ total: swk.total, cost: swk.cost }));

console.log('\n── unpaid hours are not paid for ──');
db.prepare('UPDATE employee_hours SET unpaid = 8, auto_fill = 0 WHERE id = ?').run('eh-rt-unlinked');
db.prepare('UPDATE pay_employees SET user_id = ? WHERE id = ?').run('rt-unlinked', 'pe-salaried');  // temporarily: give them a rate
db.prepare('UPDATE pay_employees SET pay_rate = 10 WHERE id = ?').run('pe-salaried');
const hu = await J(await get('/office/hours'));
const up = (hu.people || []).find(p => p.name === 'Unlinked Person');
t('unpaid time is outside the paid-hours total, so it is outside the cost', near(up.period.cost, 400), JSON.stringify(up.period));
// Put it back the way it was for everything below.
db.prepare('UPDATE pay_employees SET user_id = ?, pay_rate = NULL WHERE id = ?').run('rt-salaried', 'pe-salaried');
db.prepare('UPDATE employee_hours SET unpaid = 0, auto_fill = 1 WHERE id = ?').run('eh-rt-unlinked');

console.log('\n── no rate is no cost, never a free hour ──');
const h2 = await J(await get('/office/hours'));
t('A SALARIED PERSON COSTS NULL, NOT ZERO — a zero would state their hours were free, when the truth is nobody has said what they cost',
  P2(h2, 'Salaried Person').period.cost === null, JSON.stringify(P2(h2, 'Salaried Person').period.cost));
t('so does somebody with no pay row', P2(h2, 'Unlinked Person').period.cost === null);

console.log('\n── the totals cover the people they can, and say how many that is ──');
const emp = h2.totals_by_type.employee;
const rated = (h2.people || []).filter(p => !p.is_contractor && p.rate != null);
t('the employee cost is the sum of the employees who have a rate',
  near(emp.cost, rated.reduce((n, p) => n + p.period.cost, 0)), `${emp.cost}`);
t('THE COUNT IT COVERS IS ON THE FIGURE — a cost over two of four people is a useful number only while the screen says it is two of four',
  emp.people_rated === rated.length && emp.people_unrated === emp.people - rated.length,
  JSON.stringify({ rated: emp.people_rated, unrated: emp.people_unrated, people: emp.people }));
t('the combined total is the two types added up',
  near(h2.totals.cost, emp.cost + h2.totals_by_type.contractor.cost));
t('a contractor has no target, so no overtime premium is invented for one',
  h2.totals_by_type.contractor.ot_premium === 0 && near(h2.totals_by_type.contractor.cost, 600));
t('the straight and premium halves add back to the cost',
  near(emp.cost, emp.straight_cost + emp.ot_premium));

console.log('\n── the rate is read, never copied ──');
db.prepare('UPDATE pay_employees SET pay_rate = 25 WHERE id = ?').run('pe-hourly');
const h3 = await J(await get('/office/hours'));
t('MOVING THE RATE IN PAY TRACKING MOVES THE MONEY HERE — there is no second copy to go stale, and no hours row to rewrite on a raise',
  near(P2(h3, 'Hourly Person').period.cost, 48 * 25 + 8 * 25 * 0.5), String(P2(h3, 'Hourly Person').period.cost));
t('and nothing was written onto the hours row itself',
  !db.prepare('PRAGMA table_info(employee_hours)').all().some(c => /rate|cost/.test(c.name)));
db.prepare('UPDATE pay_employees SET pay_rate = 20 WHERE id = ?').run('pe-hourly');

console.log('\n── an excluded person leaves the money with the hours ──');
const before = (await J(await get('/office/hours'))).totals_by_type.employee;
await post('/office/hours/exclude', { row_id: 'rt-hourly', reason: 'Tracked elsewhere for this period' });
const h4 = await J(await get('/office/hours'));
t('their cost comes out of the total too — a figure that still counts somebody the list does not show is the defect this whole tab keeps unpicking',
  near(h4.totals_by_type.employee.cost, before.cost - 1040)
  && h4.totals_by_type.employee.people_rated === before.people_rated - 1,
  `${h4.totals_by_type.employee.cost} vs ${before.cost}`);
await req('/office/hours/exclude/rt-hourly', { method: 'DELETE' });

console.log('\n── pay is admin-only, and stays that way ──');
db.prepare(`INSERT OR REPLACE INTO users (id,name,username,role,department,is_active,setup_code,setup_code_expires_at,module_access)
  VALUES ('rt-sup','Rate Sup','Rate Sup','supervisor','office',1,'SC-RS',datetime('now','+7 day'),'{"pm":"edit"}')`).run();
await post('/users/login', { name: 'Rate Sup' });
await post('/users/set-password', { user_id: 'rt-sup', password: 'SupPW2026!', setup_code: 'SC-RS' });
const supTok = (await J(await post('/users/login', { name: 'Rate Sup', password: 'SupPW2026!' })))?.token;
const supTry = await fetch(`${B}/office/hours`, { headers: { Authorization: `Bearer ${supTok}` } });
t('a supervisor cannot read the hours list, and therefore cannot read what anybody is paid',
  supTry.status === 403 || supTry.status === 401, String(supTry.status));

console.log('\n── in a real browser ──');
const { chromium } = await import('playwright-core');
const URL = `http://localhost:${PORT}`;
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ viewport: { width: 1600, height: 950 } });
page.on('pageerror', e => { console.log('  [pageerror]', e.message); fail++; });
await page.goto(`${URL}/manifest.webmanifest`);
await page.evaluate(([tk, u]) => { localStorage.setItem('auth_token', tk); localStorage.setItem('auth_user', JSON.stringify(u)); },
  [tok, { id: 'rt-admin', name: 'Rate Admin', role: 'admin', department: 'office' }]);
await page.goto(`${URL}/?tab=time-tracking`);
await page.waitForSelector('text=Time Tracking', { timeout: 20000 });
await page.getByRole('tab', { name: 'Hours', exact: true }).first().click();
const onTab = await page.waitForSelector('[data-rate="rt-hourly"]', { timeout: 20000 }).then(() => true).catch(() => false);
t('THE RATE IS ON THE HOURS LIST, beside the hours it is being applied to', onTab,
  (await page.locator('body').innerText()).slice(0, 90).replace(/\n/g, ' '));

if (onTab) {
  t('it prints the hourly rate', /\$20\.00\/hr/.test(await page.locator('[data-rate="rt-hourly"]').innerText()));
  t('a blank rate reads Salaried, the word Pay Tracking already uses',
    (await page.locator('[data-rate="rt-salaried"]').innerText()).trim() === 'Salaried');
  t('and no pay row at all reads as the different thing it is',
    /No pay record/i.test(await page.locator('[data-rate="rt-unlinked"]').innerText()));
  t('the period cost sits under the period hours', /\$1,040/.test(await page.locator('[data-cost="rt-hourly"]').innerText()));
  t('a salaried person gets no cost printed at all, not a $0',
    await page.locator('[data-cost="rt-salaried"]').count() === 0);

  const card = await page.locator('[data-total="employee:cost"]').first().innerText();
  const basis = await page.locator('[data-cost-basis="employee"]').first().innerText();
  t('the labour cost card is on screen', /\$/.test(card), card);
  t('AND IT SAYS HOW MUCH OF THE LIST IT COVERS, because two of four people having a rate is what makes the figure readable',
    /of \d+ people have a rate/.test(basis), basis);
  t('the overtime premium is broken out rather than buried in one number', /overtime premium/.test(basis), basis);

  t('A TARGET THAT IS NOT THE ORDINARY WEEK IS SAID OUT LOUD — the premium inside the cost is measured against each person’s own target, and where that differs the money needs it stated rather than inferred',
    await page.locator('[data-ot-basis-note]').count() > 0,
    (await page.locator('body').innerText()).slice(0, 120).replace(/\n/g, ' '));

  // THE FILE IS BUILT FROM THE PAYLOAD ON THE SCREEN, not from a second
  // endpoint, so an export cannot disagree with the page it came from — which
  // is the only reason anybody should trust carrying it into a spreadsheet.
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 15000 }).catch(() => null),
    page.locator('[data-hours-export]').first().click(),
  ]);
  t('A PERSON WITH NO PAY RECORD IS NAMED, with where it is fixed — an empty rate column that explains nothing reads as the feature being broken, which is how it gets ignored',
    /no Pay Tracking record/.test(await page.locator('[data-unlinked-note]').innerText())
    && /Unlinked Person/.test(await page.locator('[data-unlinked-note]').innerText()),
    (await page.locator('[data-unlinked-note]').innerText().catch(() => 'no note')).slice(0, 120));

  t('the period downloads as a file', !!download, 'no download event');
  if (download) {
    const fs = await import('node:fs/promises');
    const path = await download.path();
    const text = await fs.readFile(path, 'utf8');
    t('the export carries the rate and the cost, so the reporting can happen in a spreadsheet',
      /Rate/.test(text) && /Period cost/.test(text), text.split('\n')[0].slice(0, 120));
    const row = text.split('\n').find(l => l.startsWith('"Hourly Person"'));
    t('and the number in the file is the number on the screen', /1040/.test(row || ''), row);
    t('a salaried person exports a BLANK cost, never a zero — the same distinction the screen makes',
      /^"Salaried Person"[^\n]*,"",""$/.test((text.split('\n').find(l => l.startsWith('"Salaried Person"')) || '').trim())
      || /,"","",""$/.test((text.split('\n').find(l => l.startsWith('"Salaried Person"')) || '').trim()),
      (text.split('\n').find(l => l.startsWith('"Salaried Person"')) || '').slice(-40));
  }
}

await browser.close();
db.close();
console.log(`\n${pass}/${pass + fail} assertions passed`);
process.exit(fail ? 1 : 0);
