// Standing supply lists and the groups they file under, end to end.
//
// Marnee asked for a recurring order for "Monthly break room snacks and
// supplies", "Monthly cleaning supplies" and "Monthly production supplies",
// and for a way to tag items so the groupings can be tracked.
//
// The load-bearing assertions are the NEGATIVES, because the easy version of
// this feature is the wrong one:
//   - a cycle files NOTHING by itself. Eighteen rows on the first of the month
//     whether or not anything is needed is noise in the one queue that has to
//     stay readable;
//   - a list with nothing on it asks NOBODY anything;
//   - "nothing needed" is a recorded ANSWER, not an absence;
//   - a group is matched as a whole element, never as a substring;
//   - opening the same cycle twice produces one of it.
//
// Caller sets PORT + DBPATH. Needs a fresh database.
const PORT = process.env.PORT || 4997;
const B = `http://localhost:${PORT}/api`;
const J = async r => { try { return await r.json(); } catch { return null; } };
let pass = 0, fail = 0;
const t = (n, c, d = '') => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (d ? ' — ' + d : '')); } };
const tok = {};
const req = (p, o = {}, who = 'admin') => fetch(B + p, { ...o, headers: { 'Content-Type': 'application/json', ...(tok[who] ? { Authorization: `Bearer ${tok[who]}` } : {}), ...(o.headers || {}) } });
const post = (p, b, who) => req(p, { method: 'POST', body: JSON.stringify(b) }, who);
const put = (p, b, who) => req(p, { method: 'PUT', body: JSON.stringify(b) }, who);
const get = (p, who) => req(p, {}, who);

const { default: Database } = await import('better-sqlite3');
const db = new Database(process.env.DBPATH);

const people = [
  // NULL map on an admin = full access. A MAP on an admin is a RESTRICTION
  // map (module-access.js), so giving her one would hide the admin-only Supply
  // Orders module and the tab with it.
  ['sl-admin', 'Marla Office', 'admin', 'office', 'SC-SA', null],
  ['sl-sup', 'Sergio Floor', 'supervisor', 'cleaning', 'SC-SS', '{"supply-requests":"edit"}'],
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
await signIn('admin', 'sl-admin', 'Marla Office', 'SC-SA', 'MarlaPW2026!');
await signIn('sup', 'sl-sup', 'Sergio Floor', 'SC-SS', 'SergioPW2026!');
t('both signed in', !!tok.admin && !!tok.sup);

console.log('\n── the three lists Marnee named ──');
let lists = await J(await get('/office/supply/lists'));
const want = ['Monthly break room snacks and supplies', 'Monthly cleaning supplies', 'Monthly production supplies'];
t('all three are seeded, verbatim', want.every(n => (lists || []).some(l => l.name === n)),
  JSON.stringify((lists || []).map(l => l.name)));
const breakRoom = (lists || []).find(l => l.name === want[0]);
t('each carries the group its requests will file under', JSON.stringify(breakRoom?.tags) === '["Break room"]', JSON.stringify(breakRoom?.tags));
t('and they ship MONTHLY on the 1st, which is what "monthly" was asked for',
  (lists || []).every(l => l.cadence === 'monthly' && l.day === 1));

t('A LIST WITH NOTHING ON IT HAS NOTHING TO ASK ABOUT — the items are the office\'s to write, and a cycle offering an empty tick list reads as the feature being broken',
  (lists || []).every(l => l.item_count === 0 && !l.open_cycle && !l.next_due),
  JSON.stringify((lists || []).map(l => [l.item_count, !!l.open_cycle])));

console.log('\n── the list is the thing she maintains ──');
for (const [name, supplier] of [['Coffee (case)', 'Costco'], ['Paper towels', 'Costco'], ['Creamer', 'Costco']]) {
  await post(`/office/supply/lists/${breakRoom.id}/items`, { item_name: name, qty: 2, uom: 'Case', supplier });
}
lists = await J(await get('/office/supply/lists'));
let br = lists.find(l => l.id === breakRoom.id);
t('three items on the break-room list', br?.item_count === 3, `${br?.item_count}`);
t('and now that it has items it has a cycle — the 1st has been and gone', !!br?.open_cycle, JSON.stringify(br?.open_cycle));
t('the cycle names the period it covers', /^\d{4}-\d{2}$/.test(br?.open_cycle?.period || ''), br?.open_cycle?.period);

const beforeOrders = db.prepare('SELECT COUNT(*) c FROM supply_orders').get().c;
await get('/office/supply/lists');
await get('/office/supply/lists');
t('OPENING THE CYCLE FILES NOTHING — what recurs is the asking, not the order',
  db.prepare('SELECT COUNT(*) c FROM supply_orders').get().c === beforeOrders,
  `${beforeOrders} → ${db.prepare('SELECT COUNT(*) c FROM supply_orders').get().c}`);
t('and reading the screen three times produces ONE cycle, not three',
  db.prepare('SELECT COUNT(*) c FROM supply_list_cycles WHERE list_id = ?').get(breakRoom.id).c === 1);

console.log('\n── closing it is what orders anything ──');
const bad = await post(`/office/supply/cycles/${br.open_cycle.id}/close`, {}, 'admin');
t('closing with neither a pick nor an answer is refused', bad.status === 400, `HTTP ${bad.status}`);

const filed = await J(await post(`/office/supply/cycles/${br.open_cycle.id}/close`, {
  items: [{ item_id: br.items[0].id, qty: 4 }, { item_id: br.items[1].id }],
}, 'admin'));
t('ticking two items files two requests, and only two', filed?.created === 2, JSON.stringify(filed?.created));
const orders = await J(await get('/office/supply/orders?status=new', 'admin'));
const coffee = (orders || []).find(o => o.item_name === 'Coffee (case)');
t('the quantity SHE typed wins over the one on the list', Number(coffee?.qty) === 4, `${coffee?.qty}`);
t('THE REQUEST CARRIES THE LIST\'S GROUP, so what the break room costs is answerable',
  JSON.stringify(coffee?.tags) === '["Break room"]', JSON.stringify(coffee?.tags));
t('…mirrored onto `label`, so every filter and export that already reads it keeps working',
  coffee?.label === 'Break room', coffee?.label);
t('and it names the cycle it came from — "why did we order this" has an answer on the row',
  /Monthly break room/.test(coffee?.notes || '') && !!coffee?.list_cycle_id, coffee?.notes);
t('the item nobody ticked was NOT ordered', !(orders || []).some(o => o.item_name === 'Creamer'));

const twice = await post(`/office/supply/cycles/${br.open_cycle.id}/close`, { nothing_needed: true }, 'admin');
t('a closed cycle cannot be closed again', twice.status === 400, `HTTP ${twice.status}`);

lists = await J(await get('/office/supply/lists'));
br = lists.find(l => l.id === breakRoom.id);
t('the list reads up to date, and says what last month came to',
  !br.open_cycle && br.last_cycle?.outcome === 'ordered' && br.last_cycle.orders_created === 2,
  JSON.stringify(br.last_cycle));

console.log('\n── "nothing needed" is an ANSWER, not an absence ──');
const cleaning = lists.find(l => l.name === 'Monthly cleaning supplies');
await post(`/office/supply/lists/${cleaning.id}/items`, { item_name: 'Sani-512', qty: 1, uom: 'Case' });
lists = await J(await get('/office/supply/lists'));
const cl = lists.find(l => l.id === cleaning.id);
const skipped = await J(await post(`/office/supply/cycles/${cl.open_cycle.id}/close`, { nothing_needed: true, note: 'Plenty on the shelf' }, 'admin'));
t('it closes with nothing ordered', skipped?.created === 0);
const row = db.prepare('SELECT * FROM supply_list_cycles WHERE id = ?').get(cl.open_cycle.id);
t('A MONTH SOMEBODY LOOKED AT AND SKIPPED IS A DIFFERENT FACT FROM ONE NOBODY OPENED — it carries the outcome, the reason, the name and the date',
  row.outcome === 'nothing_needed' && row.note === 'Plenty on the shelf' && row.closed_by === 'Marla Office' && !!row.closed_at,
  JSON.stringify({ o: row.outcome, n: row.note, by: row.closed_by }));

console.log('\n── groups ──');
const tags = await J(await get('/office/supply/tags', 'sup'));
t('the five that used to be a hard-coded array are the managed list now',
  ['Warehouse/Production', 'Cleaning', 'Break room', 'Maintenance', 'Office'].every(v => (tags || []).some(x => x.value === v)),
  JSON.stringify((tags || []).map(x => x.value)));
// Adding a group is a Settings task now, not a deploy — so add one and read it
// back rather than asserting about a seeded catalogue's counts.
db.prepare(`INSERT INTO app_list_options (id, list_key, value, label, sort_order)
  VALUES ('sl-lab', 'supply_tags', 'Lab bench', 'Lab bench', 9)`).run();
const tags2 = await J(await get('/office/supply/tags', 'sup'));
t('A GROUP NOBODY HAS ORDERED AGAINST IS STILL OFFERED, AT ZERO — visibly a category rather than an absence',
  (tags2 || []).some(x => x.value === 'Lab bench' && x.count === 0 && x.suggested),
  JSON.stringify((tags2 || []).find(x => x.value === 'Lab bench')));
t('and the counts are read off the ORDERS — the groups in use ARE the orders carrying them, so a stored tally is wrong the first time somebody retags one',
  (tags2 || []).find(x => x.value === 'Break room')?.count
    === db.prepare(`SELECT COUNT(*) c FROM supply_orders WHERE label = 'Break room'
      OR EXISTS (SELECT 1 FROM json_each(supply_orders.tags) t WHERE t.value = 'Break room')`).get().c,
  JSON.stringify((tags2 || []).find(x => x.value === 'Break room')));

// A free group, and a spelling of a known one.
const multi = await J(await post('/office/supply/orders', {
  item_name: 'Nitrile gloves', qty: 5, tags: ['cleaning', 'Warehouse/Production', 'Lab'],
}, 'sup'));
t('A REQUEST CAN BELONG TO MORE THAN ONE GROUP — a case of gloves is both, and one "For" box made somebody choose',
  (multi?.tags || []).length === 3, JSON.stringify(multi?.tags));
t('a spelling of a known group is folded into it — two spellings of one group is two groups',
  (multi?.tags || []).includes('Cleaning') && !(multi?.tags || []).includes('cleaning'), JSON.stringify(multi?.tags));
t('a genuinely new group is kept exactly as typed', (multi?.tags || []).includes('Lab'));
t('and `label` mirrors the FIRST of them and nothing else writes it', multi?.label === 'Cleaning', multi?.label);

const byTag = await J(await get('/office/supply/orders?tag=Warehouse/Production', 'admin'));
t('filtering by a group finds a request whose SECOND group it is',
  (byTag || []).some(o => o.item_name === 'Nitrile gloves'), JSON.stringify((byTag || []).map(o => o.item_name)));
const officeTag = await J(await get('/office/supply/orders?tag=Lab', 'admin'));
t('A GROUP IS MATCHED AS A WHOLE ELEMENT, never as a substring — "Lab" finds the gloves and "Lab bench" must not',
  (officeTag || []).some(o => o.item_name === 'Nitrile gloves'));
const benchTag = await J(await get('/office/supply/orders?tag=Lab bench', 'admin'));
t('…so the longer group finds nothing, where a LIKE would have matched',
  !(benchTag || []).some(o => o.item_name === 'Nitrile gloves'), JSON.stringify((benchTag || []).map(o => o.item_name)));

console.log('\n── and it reaches the person who orders ──');
const { supplyCycleNudge } = await import('../server/api/office.js');
const dms = () => db.prepare(`SELECT COUNT(*) c FROM chat_messages m JOIN chat_channels ch ON ch.id = m.channel_id
  WHERE ch.kind = 'dm' AND ch.dm_key LIKE '%sl-admin%' AND m.body LIKE '%standing supply%'`).get().c;
// Both cycles are closed; the production list is still empty. Nothing is due.
const quiet = await supplyCycleNudge(db);
t('NOTHING TO SAY, NOTHING SAID — a closed cycle and an empty list produce no message', quiet.sent === 0, JSON.stringify(quiet));

const prod = lists.find(l => l.name === 'Monthly production supplies');
await post(`/office/supply/lists/${prod.id}/items`, { item_name: 'Scoops', qty: 10 });
const before = dms();
const told = await supplyCycleNudge(db);
t('a list that has come due DOES reach the office — a prompt that only lives on a screen reaches whoever opens that screen (D-105)',
  told.sent > 0 && dms() > before, `${JSON.stringify(told)} dms ${before}->${dms()}`);
const body = db.prepare(`SELECT m.body FROM chat_messages m JOIN chat_channels ch ON ch.id = m.channel_id
  WHERE ch.kind = 'dm' AND ch.dm_key LIKE '%sl-admin%' ORDER BY m.created_at DESC LIMIT 1`).get()?.body || '';
t('and it names the list and how many items are on it', /Monthly production supplies/.test(body) && /1 item/.test(body), body.replace(/\n/g, ' | ').slice(0, 150));
const again = await supplyCycleNudge(db);
t('THE CLOCK IS ON THE CYCLE, not one global flag — three lists on different days must not share one timer',
  again.sent === 0, JSON.stringify(again));

console.log('\n── who may do what ──');
const supCreate = await post('/office/supply/lists', { name: 'Sergio\'s list' }, 'sup');
t('a supervisor may not create a standing list — what gets ordered is the office\'s', supCreate.status === 403, `HTTP ${supCreate.status}`);
const supItem = await post(`/office/supply/lists/${prod.id}/items`, { item_name: 'Sneaky' }, 'sup');
t('nor add to one', supItem.status === 403, `HTTP ${supItem.status}`);
const supRead = await get('/office/supply/lists', 'sup');
t('but he may READ them — knowing the list exists is how somebody stops filing a one-off for paper towels', supRead.status === 200);

const retired = await J(await req(`/office/supply/lists/${breakRoom.id}/items/${br.items[2].id}`, { method: 'DELETE' }, 'admin'));
t('removing an item takes it off the list', (retired?.items || []).length === 2, `${(retired?.items || []).length}`);
t('RETIRED, NOT DELETED — a cycle filed last month recorded what it ordered against the list as it stood',
  db.prepare('SELECT active FROM supply_list_items WHERE id = ?').get(br.items[2].id)?.active === 0);

console.log('\n── the period arithmetic, pure ──');
const { periodOf, dueDateOf, cyclesDue } = await import('../server/supply-lists.js');
t('a month is a month', periodOf('monthly', '2026-09-22') === '2026-09');
t('a quarter is a quarter', periodOf('quarterly', '2026-09-22') === '2026-Q3');
t('A LIST SET TO THE 31st IS STILL ASKED ABOUT IN FEBRUARY — the day is clamped to 28 rather than rolling into March',
  dueDateOf('monthly', 31, '2026-02-10') === '2026-02-28', dueDateOf('monthly', 31, '2026-02-10'));
t('a weekly list due Monday resolves to that week\'s Monday', dueDateOf('weekly', 1, '2026-09-24') === '2026-09-21');
t('A CYCLE IS NEVER OPENED EARLY — the 1st has not arrived, so there is nothing to ask about yet',
  cyclesDue([{ id: 'x', active: 1, cadence: 'monthly', day: 15, item_count: 3 }], '2026-09-02').length === 0);
t('…and is opened once the day has come', cyclesDue([{ id: 'x', active: 1, cadence: 'monthly', day: 15, item_count: 3 }], '2026-09-22').length === 1);
t('a retired list is never asked about', cyclesDue([{ id: 'x', active: 0, cadence: 'monthly', day: 1, item_count: 3 }], '2026-09-22').length === 0);
t('nor is one whose cycle for this period already exists',
  cyclesDue([{ id: 'x', active: 1, cadence: 'monthly', day: 1, item_count: 3 }], '2026-09-22', new Set(['x:2026-09'])).length === 0);

console.log('\n── in a real browser ──');
{
  // A fourth list nobody has touched, so the cycle on screen is unambiguous.
  const fresh = await J(await post('/office/supply/lists', { name: 'Monthly lab supplies', cadence: 'monthly', day: 1, tags: ['Lab bench'] }, 'admin'));
  await post(`/office/supply/lists/${fresh.id}/items`, { item_name: 'Pipette tips', qty: 3, uom: 'Box', supplier: 'Fisher' }, 'admin');
  await post(`/office/supply/lists/${fresh.id}/items`, { item_name: 'Nitrile gloves (S)', qty: 2, uom: 'Case' }, 'admin');

  const { chromium } = await import('playwright-core');
  const URL = `http://localhost:${PORT}`;
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on('pageerror', e => { console.log('  [pageerror]', e.message); fail++; });
  await page.goto(`${URL}/manifest.webmanifest`);
  await page.evaluate(([tk, u]) => { localStorage.setItem('auth_token', tk); localStorage.setItem('auth_user', JSON.stringify(u)); },
    [tok.admin, { id: 'sl-admin', name: 'Marla Office', role: 'admin', department: 'office' }]);
  await page.goto(`${URL}/?tab=supply-orders`);

  const opened = await page.getByRole('button', { name: 'Standing lists' }).first().click({ timeout: 20000 })
    .then(() => page.waitForSelector('[data-standing-list]', { timeout: 15000 })).then(() => true).catch(() => false);
  t('Supply Orders has a Standing lists tab and it lists them', opened);

  if (opened) {
    const card = page.locator('[data-standing-list="Monthly lab supplies"]');
    t('the list she asked for is on the screen by name', await card.count() === 1);
    t('and it says it is due now rather than leaving her to work out the date',
      await card.locator('[data-list-due]').count() === 1);
    const before = Number((await J(await get('/office/supply/orders?status=new', 'admin')))?.length || 0);
    await card.locator('[data-cycle-pick="Pipette tips"]').check();
    t('ticking one item offers a quantity beside it, defaulted from the list',
      await card.locator('[data-cycle-qty="Pipette tips"]').inputValue() === '3');
    await card.locator('[data-cycle-file]').click();
    await page.waitForFunction(() => !document.querySelector('[data-standing-list="Monthly lab supplies"] [data-cycle-file]'), null, { timeout: 15000 }).catch(() => {});
    const after = await J(await get('/office/supply/orders?status=new', 'admin'));
    t('CLICKING IT FILES THE REQUEST SHE TICKED AND NOTHING ELSE — the other item on the list is not ordered',
      (after || []).length === before + 1 && (after || []).some(o => o.item_name === 'Pipette tips')
      && !(after || []).some(o => o.item_name === 'Nitrile gloves (S)'),
      `${before} -> ${(after || []).length}`);
    t('and the card now reads up to date', await card.locator('[data-list-due]').count() === 0);

    // The groups, on the request form.
    await page.getByRole('button', { name: 'New Request' }).first().click();
    await page.waitForSelector('[data-order-tag]', { timeout: 10000 });
    t('the request form offers the groups as chips, not one "For" box',
      await page.locator('[data-order-tag]').count() >= 5, `${await page.locator('[data-order-tag]').count()}`);
    t('including one added in Settings rather than in the code',
      await page.locator('[data-order-tag="Lab bench"]').count() === 1);
  }

  // THE SUPERVISOR'S VIEW. He reaches the lists through Requests, and the
  // controls the server would refuse are not rendered at all — a button that
  // errors reads as a fault, not as a boundary.
  await page.evaluate(([tk, u]) => { localStorage.setItem('auth_token', tk); localStorage.setItem('auth_user', JSON.stringify(u)); },
    [tok.sup, { id: 'sl-sup', name: 'Sergio Floor', role: 'supervisor', department: 'cleaning' }]);
  await page.goto(`${URL}/?tab=office-requests`);
  const supTab = await page.getByRole('button', { name: 'Standing lists' }).first().click({ timeout: 20000 })
    .then(() => page.waitForSelector('[data-standing-list]', { timeout: 15000 })).then(() => true).catch(() => false);
  t('a supervisor reaches the standing lists through Requests', supTab, 'tab not found');
  if (supTab) {
    t('HE IS OFFERED NO CONTROL HE WOULD BE REFUSED — no New list, no add, no remove, no cycle to file',
      await page.locator('[data-standing-new]').count() === 0
      && await page.locator('[data-list-add]').count() === 0
      && await page.locator('[data-cycle-file]').count() === 0,
      JSON.stringify({ n: await page.locator('[data-standing-new]').count(), a: await page.locator('[data-list-add]').count(), c: await page.locator('[data-cycle-file]').count() }));
    t('…and the screen says why rather than leaving it looking broken',
      /office decides what is ordered/i.test(await page.locator('body').innerText()));
  }

  // A phone: the tab strip and the cycle have to be usable on one.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(([tk, u]) => { localStorage.setItem('auth_token', tk); localStorage.setItem('auth_user', JSON.stringify(u)); },
    [tok.admin, { id: 'sl-admin', name: 'Marla Office', role: 'admin', department: 'office' }]);
  await page.goto(`${URL}/?tab=supply-orders`);
  await page.getByRole('button', { name: 'Standing lists' }).first().click({ timeout: 20000 }).catch(() => {});
  await page.waitForSelector('[data-standing-list]', { timeout: 15000 }).catch(() => {});
  const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  t('and none of it pans the page sideways at 390px', over <= 1, `${over}px over`);
  await browser.close();
}

db.close();
console.log(`\n${pass}/${pass + fail} assertions passed`);
process.exit(fail ? 1 : 0);
