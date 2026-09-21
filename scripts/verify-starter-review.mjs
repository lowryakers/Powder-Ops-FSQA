// The starter review decided on the packet, and chased by Pay Tracking.
//
// WHAT WAS MISSING WAS NOT THE ARITHMETIC. `starter_checks` has derived both
// dates from the hire date since the 30/90-day work shipped — but only in the
// employee drawer, a screen somebody opens when they already have that person
// in mind, which is never the morning a 30-day check falls due. And nothing
// anywhere recorded WHICH of the two a given starter gets, so the choice was
// made by remembering, or not at all. The same defect as the re-clean badge
// the cleaner could not see.
//
// So the assertions here are about the spine:
//   - the choice is made on the packet, where the hire date and the position
//     already are, and is stored;
//   - a value Pay Tracking does not know is REFUSED, not stored and ignored;
//   - completing the packet carries it onto the roster;
//   - it FILLS A BLANK and never overwrites a decision already on the roster;
//   - the date is DERIVED, never stored — correcting the start date moves it;
//   - it reaches the office queue with a lead, and leaves the moment somebody
//     is asked;
//   - the queue never lists one person twice.
//
// Caller sets PORT + DBPATH. Needs a fresh database.
const PORT = process.env.PORT || 4992;
const B = `http://localhost:${PORT}/api`;
const J = async r => { try { return await r.json(); } catch { return null; } };
let pass = 0, fail = 0;
const t = (n, c, d = '') => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (d ? ' — ' + d : '')); } };
const tok = {};
const req = (p, o = {}, who = 'office') => fetch(B + p, { ...o, headers: { 'Content-Type': 'application/json', ...(tok[who] ? { Authorization: `Bearer ${tok[who]}` } : {}), ...(o.headers || {}) } });
const post = (p, b, who) => req(p, { method: 'POST', body: JSON.stringify(b) }, who);
const put = (p, b, who) => req(p, { method: 'PUT', body: JSON.stringify(b) }, who);
const get = (p, who) => req(p, {}, who);

const { default: Database } = await import('better-sqlite3');
const db = new Database(process.env.DBPATH);

const day = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

db.prepare(`INSERT OR REPLACE INTO users (id,name,username,role,department,is_active,setup_code,setup_code_expires_at,module_access)
  VALUES ('sr-office','Marnee Office','Marnee Office','admin','office',1,'SC-SRO',datetime('now','+7 day'),NULL)`).run();
await post('/users/login', { name: 'Marnee Office' });
await post('/users/set-password', { user_id: 'sr-office', password: 'MarneePW2026!', setup_code: 'SC-SRO' });
tok.office = (await J(await post('/users/login', { name: 'Marnee Office', password: 'MarneePW2026!' })))?.token;
t('the office signed in', !!tok.office);

console.log('\n── the decision is made on the packet ──');
// Hire date 26 days ago: a 30-day check falls due in four days, inside the
// week's lead; a 90-day one is still two months out.
const started = day(-26);
const created = await J(await post('/onboarding', {
  first_name: 'Nipsi', last_name: 'Batchman', department: 'batching', team: 'Batching',
  position: 'Stick pack operator', start_date: started, worker_type: 'employee',
}, 'office'));
t('a packet opens with no starter review chosen — nothing is decided for the office',
  !!created?.id && !created.review_occasion, JSON.stringify({ id: !!created?.id, r: created?.review_occasion }));

const bad = await put(`/onboarding/${created.id}`, { review_occasion: '45_day' }, 'office');
t('A VALUE PAY TRACKING DOES NOT KNOW IS REFUSED — stored and ignored, it would sit on the packet looking like a decision and raise nothing',
  bad.status === 400, String(bad.status));
t('and nothing was written', !db.prepare('SELECT review_occasion FROM onboarding_records WHERE id = ?').get(created.id).review_occasion);

const picked = await J(await put(`/onboarding/${created.id}`, { review_occasion: '30_day' }, 'office'));
t('picking the 30-day check stores it on the packet', picked?.review_occasion === '30_day', picked?.review_occasion);
const changed = await J(await put(`/onboarding/${created.id}`, { review_occasion: '90_day' }, 'office'));
t('and it can be changed while the packet is still open', changed?.review_occasion === '90_day');
await put(`/onboarding/${created.id}`, { review_occasion: '30_day' }, 'office');

const listed = (((await J(await get('/onboarding', 'office'))) || {}).records || []).find(r => r.id === created.id);
t('the office\'s own list reads it back, so the choice is visible without opening the packet again',
  listed?.review_occasion === '30_day', listed?.review_occasion);

console.log('\n── completing the packet carries it to the roster ──');
const done = await J(await post(`/onboarding/${created.id}/complete`, { create_account: true }, 'office'));
t('the packet completes', done?.status === 'completed' || done?.record?.status === 'completed', JSON.stringify(done).slice(0, 160));
const roster = db.prepare("SELECT * FROM pay_employees WHERE name = 'Nipsi Batchman'").get();
t('THE DECISION TRAVELS WITH THEM — the roster row carries the occasion, so nobody has to re-enter it or remember it was made',
  roster?.review_occasion === '30_day', JSON.stringify({ r: roster?.review_occasion }));
t('and the hire date came across, which is what the check is measured from', roster?.hire_date === started);

console.log('\n── the date is derived, never stored ──');
const cols = db.prepare('PRAGMA table_info(pay_employees)').all().map(c => c.name);
t('there is no starter-review DATE column anywhere — correcting a start date moves the check with it, rather than leaving a stored date that quietly disagrees',
  !cols.some(c => /review_(due|date)|starter_due/.test(c)), cols.filter(c => /review/.test(c)).join(','));

const drawer = await J(await get(`/pay/employees/${roster.id}`, 'office'));
const chosen = (drawer?.starter_checks || []).find(c => c.chosen);
t('the drawer marks the one they actually get', chosen?.occasion === '30_day', JSON.stringify(drawer?.starter_checks));
t('and works its date out from the hire date', chosen?.due === day(4), `${chosen?.due} vs ${day(4)}`);
t('BOTH ARE STILL LISTED — the office can raise either; marking the chosen one is a statement, not a restriction',
  (drawer?.starter_checks || []).length === 2);

// Moving the start date must move the check, with nothing else touched.
await put(`/pay/employees/${roster.id}`, { hire_date: day(-27) }, 'office');
const moved = await J(await get(`/pay/employees/${roster.id}`, 'office'));
t('moving the start date back a day moves the check with it', (moved?.starter_checks || []).find(c => c.chosen)?.due === day(3));
await put(`/pay/employees/${roster.id}`, { hire_date: started }, 'office');

console.log('\n── it reaches the office queue ──');
const q1 = await J(await get('/pay/actions', 'office'));
const mine = (q1?.items || []).filter(i => i.employee_id === roster.id);
const starter = mine.find(i => i.kind === 'starter');
t('THE CHECK IS ON THE QUEUE — the one screen the office already reads, rather than a drawer nobody opens on the right morning',
  !!starter, JSON.stringify(mine));
t('it names which check it is', starter?.occasion === '30_day' && starter?.occasion_label === '30-day review');
t('and when it falls due', starter?.due_date === day(4));
t('it is raised a week AHEAD, not on the day — a check that first appears the morning it is due is one that gets done late',
  starter?.due_date > q1.as_of);
t('it is counted under its own kind', q1?.counts?.starter === 1, JSON.stringify(q1?.counts));
t('ONE PERSON, ONE ASK — they are not also listed as an annual review due', mine.length === 1, JSON.stringify(mine.map(i => i.kind)));

console.log('\n── and leaves the moment somebody is asked ──');
db.prepare(`INSERT OR REPLACE INTO users (id,name,username,role,department,is_active) VALUES ('sr-rev','Bernardo Lopez','Bernardo Lopez','supervisor','batching',1)`).run();
const asg = await J(await post('/pay/assignments', {
  employee_id: roster.id, reviewer_id: 'sr-rev', due_date: day(4), occasion: '30_day',
}, 'office'));
t('an assignment can be made for that occasion', !!asg?.id || !!asg?.assignment?.id, JSON.stringify(asg).slice(0, 160));
const q2 = await J(await get('/pay/actions', 'office'));
t('THE ASK IS THE ANSWER — the starter item is gone, because somebody has been asked',
  !(q2?.items || []).some(i => i.kind === 'starter' && i.employee_id === roster.id), JSON.stringify(q2?.counts));

console.log('\n── nothing is chosen, nothing is chased ──');
const quiet = await J(await post('/onboarding', {
  first_name: 'Quiet', last_name: 'Starter', start_date: day(-26), worker_type: 'employee',
}, 'office'));
await post(`/onboarding/${quiet.id}/complete`, { create_account: false }, 'office');
const quietRow = db.prepare("SELECT * FROM pay_employees WHERE name = 'Quiet Starter'").get();
t('a packet completed with no choice made puts nothing on the roster', !quietRow?.review_occasion);
const q3 = await J(await get('/pay/actions', 'office'));
t('AND NOTHING ON THE QUEUE — "neither" is a real answer at this plant, so an unanswered packet must not invent a check',
  !(q3?.items || []).some(i => i.kind === 'starter' && i.employee_id === quietRow?.id));

const none = await J(await post('/onboarding', {
  first_name: 'Neither', last_name: 'Needed', start_date: day(-26), worker_type: 'employee', review_occasion: 'none',
}, 'office'));
t('"neither" is accepted as an answer in its own right', none?.review_occasion === 'none');
await post(`/onboarding/${none.id}/complete`, { create_account: false }, 'office');
const noneRow = db.prepare("SELECT * FROM pay_employees WHERE name = 'Neither Needed'").get();
const q4 = await J(await get('/pay/actions', 'office'));
t('and raises nothing — deciding not to is a decision, not an oversight',
  noneRow?.review_occasion === 'none' && !(q4?.items || []).some(i => i.kind === 'starter' && i.employee_id === noneRow.id));

console.log('\n── a decision already on the roster is never overwritten ──');
db.prepare(`INSERT INTO pay_employees (id, name, hire_date, review_occasion, active, worker_type)
  VALUES ('sr-already','Already Decided',?,'90_day',1,'employee')`).run(day(-26));
const rehire = await J(await post('/onboarding', {
  first_name: 'Already', last_name: 'Decided', start_date: day(-26), worker_type: 'employee', review_occasion: '30_day',
}, 'office'));
await post(`/onboarding/${rehire.id}/complete`, { create_account: false }, 'office');
t('FILLS A BLANK, NEVER OVERWRITES — somebody who set the check by hand on the roster made a decision, and the packet must not undo it',
  db.prepare("SELECT review_occasion FROM pay_employees WHERE id = 'sr-already'").get().review_occasion === '90_day');

console.log('\n── a contractor is never chased for a starter review ──');
db.prepare(`INSERT INTO pay_employees (id, name, hire_date, review_occasion, active, worker_type)
  VALUES ('sr-temp','Temp Hand',?,'30_day',1,'contractor')`).run(day(-26));
const q5 = await J(await get('/pay/actions', 'office'));
t('a 1099 contractor with an occasion set still raises nothing — they never fall due for a review at all',
  !(q5?.items || []).some(i => i.employee_id === 'sr-temp'));

console.log('\n── in a real browser, on a phone ──');
const { chromium } = await import('playwright-core');
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const URL = `http://localhost:${PORT}`;
const m = await browser.newPage({ viewport: { width: 390, height: 844 } });
m.on('pageerror', e => { console.log('  [pageerror]', e.message); fail++; });

// THE LINK YOU TEXT SOMEBODY. Public, no token, nothing given away — a join
// link is single-use and only works on an account with no password yet, which
// is the wrong shape for the new phone, the deleted icon and the person set
// up months ago who never installed it.
await m.goto(`${URL}/install`);
// The shell answers any unknown path, so "it responded" proves nothing —
// what is asserted is that the INSTALL PAGE is what came back, rather than
// the sign-in screen the address used to fall through to.
const onInstall = await m.waitForSelector('[data-install-page]', { timeout: 15000 }).then(() => true).catch(() => false);
t('/install renders with no session at all — nobody has to be signed in to be told how to sign in',
  onInstall, (await m.locator('body').innerText()).slice(0, 80).replace(/\n/g, ' '));
if (onInstall) {
t('it carries the install instructions, which on iOS are the whole feature — beforeinstallprompt never fires there',
  await m.locator('[data-install]').isVisible());
const signin = m.locator('[data-install-signin]');
t('and a way to the sign-in screen', await signin.isVisible() && await signin.getAttribute('href') === '/');
const bodyEn = await m.locator('body').innerText();
t('nothing on it names the plant, the roster or a module — it is safe to text to anyone',
  !/Powder Ops|powder-ops/i.test(bodyEn), bodyEn.slice(0, 120));

await m.locator('[data-install-lang]').click();
await m.waitForTimeout(150);
const bodyEs = await m.locator('body').innerText();
t('IT READS IN SPANISH TOO — half this plant does, and a page that opens in English is one half of it closes',
  /pantalla de inicio/i.test(bodyEs) && bodyEs !== bodyEn);
} else { fail += 4; console.log('  ✗ (4 more assertions skipped — the page never rendered)'); }

console.log('\n── the office picks the check on the packet ──');
const o = await browser.newPage({ viewport: { width: 1280, height: 900 } });
o.on('pageerror', e => { console.log('  [pageerror]', e.message); fail++; });
// Seeded on the manifest, not on the app root: loading the shell first is
// what clears the token again.
await o.goto(`${URL}/manifest.webmanifest`);
await o.evaluate(([tk, u]) => { localStorage.setItem('auth_token', tk); localStorage.setItem('auth_user', JSON.stringify(u)); },
  [tok.office, { id: 'sr-office', name: 'Marnee Office', role: 'admin', department: 'office' }]);
const fresh = await J(await post('/onboarding', {
  first_name: 'Browser', last_name: 'Starter', start_date: day(-26), worker_type: 'employee',
}, 'office'));
await o.goto(`${URL}/?tab=onboarding`);
await o.waitForSelector('text=Browser Starter', { timeout: 20000 });
await o.locator('text=Browser Starter').first().click();
await o.waitForSelector('[data-starter-review]', { timeout: 15000 });
t('the picker is ON THE PACKET, beside the hire date and the position — the one moment somebody has all three in front of them',
  await o.locator('[data-starter-review]').isVisible());
t('nothing is chosen for them', /Nothing chosen yet/.test(await o.locator('[data-starter-review]').innerText()));
await o.locator('[data-starter-pick="30_day"]').click();
await o.waitForTimeout(800);
t('picking it says when it falls due, worked out from the start date they can see above',
  /Falls due/.test(await o.locator('[data-starter-review]').innerText()),
  await o.locator('[data-starter-review]').innerText());
t('AND IT SAVED ON THE SPOT — a choice that only commits as a side effect of the Complete button is one people cannot tell they have made',
  db.prepare('SELECT review_occasion FROM onboarding_records WHERE id = ?').get(fresh.id).review_occasion === '30_day');

console.log('\n── and the queue shows it ──');
// Completed so the decision reaches the roster, which is what the queue reads.
await post(`/onboarding/${fresh.id}/complete`, { create_account: false }, 'office');
await o.goto(`${URL}/?tab=pay-tracking`);
await o.waitForSelector('[data-action="starter"]', { timeout: 20000 });
const line = await o.locator('[data-action="starter"]').first().innerText();
t('the office queue draws the starter check as its own kind, not as another "assign a reviewer"',
  /Starter/i.test(line) && /30-day review/.test(line), line);

console.log('\n── a join link ends on the install step, not at the app ──');
db.prepare(`INSERT OR REPLACE INTO users (id,name,username,role,department,is_active,module_access)
  VALUES ('sr-new','Gaston Ruiz','Gaston Ruiz','operator','warehouse',1,'{"pm":"view"}')`).run();
const inv = await J(await post('/users/sr-new/invite', {}, 'office'));
t('a join link is issued', !!inv?.url, JSON.stringify(inv).slice(0, 120));
const j = await browser.newPage({ viewport: { width: 390, height: 844 } });
j.on('pageerror', e => { console.log('  [pageerror]', e.message); fail++; });
await j.goto(inv.url.replace(/^https?:\/\/[^/]+/, URL));
await j.waitForSelector('input[type="password"]', { timeout: 15000 });
const pws = j.locator('input[type="password"]');
await pws.nth(0).fill('GastonPW2026!');
if (await pws.count() > 1) await pws.nth(1).fill('GastonPW2026!');
await j.locator('button[type="submit"]').first().click();
const landed = await j.waitForSelector('[data-join-done]', { timeout: 15000 }).then(() => true).catch(() => false);
t('the link signs them in', landed);
// The old page redirected to the app after 1.2s, so this is also the
// assertion that it stays put long enough to be read at all.
await j.waitForTimeout(2500);
const stillThere = await j.locator('[data-join-done]').count() > 0;
t('IT NO LONGER DUMPS THEM AT THE APP AFTER A SECOND — the third of what they need, putting it on the phone, was the part it skipped',
  stillThere && await j.locator('[data-install]').count() > 0,
  (await j.locator('body').innerText()).slice(0, 80).replace(/\n/g, ' '));
t('and it says who they are signed in as',
  stillThere && /Gaston Ruiz/.test(await j.locator('[data-join-done]').innerText()));
t('with Open ReadyDoc still one tap away for anyone who would rather get on with it',
  await j.locator('[data-join-open]').count() > 0);
t('the same card as the onboarding wizard, from one component — a second copy is how one door starts telling people to tap a menu that moved',
  await j.locator('[data-install]').count() === 1);

await browser.close();
db.close();
console.log(`\n${pass}/${pass + fail} assertions passed`);
process.exit(fail ? 1 : 0);
