// The swab shelf — executed against a live server.
// Caller sets PORT + DBPATH. NEEDS A FRESH DATABASE: it asserts the opening
// state, then files counts and deliveries into it.
const PORT = process.env.PORT || 4893;
const B = `http://localhost:${PORT}/api`;
const J = async (r) => { try { return await r.json(); } catch { return null; } };
let token = null;
const req = (p, o = {}) => fetch(B + p, { ...o, headers: {
  'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(o.headers || {}) } });
const get = (p) => req(p);
const post = (p, body) => req(p, { method: 'POST', body: JSON.stringify(body) });
const put = (p, body) => req(p, { method: 'PUT', body: JSON.stringify(body) });

let pass = 0, fail = 0;
const t = (n, c, d = '') => { if (c) pass++; else { fail++; console.log('  ✗ ' + n + (d ? ' — ' + d : '')); } };
const swab = (rows, key) => (rows || []).find(s => s.key === key);

const { default: Database } = await import('better-sqlite3');
const PW = 'SwabSecret2026';

// A QA account (may count) and an operator with a read grant (may not).
{
  const db = new Database(process.env.DBPATH);
  db.prepare(`INSERT OR REPLACE INTO users (id, name, username, role, department, is_active, setup_code, setup_code_expires_at)
    VALUES ('sw-qa','Swab QA','Swab QA','admin','qa',1,'SC-SW', datetime('now','+7 day'))`).run();
  db.prepare(`INSERT OR REPLACE INTO users (id, name, username, role, department, is_active, module_access, setup_code, setup_code_expires_at)
    VALUES ('sw-op','Swab Op','Swab Op','operator','production',1,'{"sanitation":"edit"}','SC-SO', datetime('now','+7 day'))`).run();
  db.close();
}
const signIn = async (name, code) => {
  await post('/users/login', { name });
  const id = name === 'Swab QA' ? 'sw-qa' : 'sw-op';
  await post('/users/set-password', { user_id: id, password: PW, setup_code: code });
  return (await J(await post('/users/login', { name, password: PW })))?.token;
};
const qaToken = await signIn('Swab QA', 'SC-SW');
const opToken = await signIn('Swab Op', 'SC-SO');
token = qaToken;
t('QA signed in', !!qaToken);
t('an operator signed in', !!opToken);

console.log('\n── the opening state comes from the seed ──');
let state = await J(await get('/sanitation/swab-stock'));
let atp = swab(state?.swabs, 'atp');
let allergen = swab(state?.swabs, 'allergen');
t('both swab types are reported', !!atp && !!allergen, JSON.stringify(state).slice(0, 200));
t('ATP opens at the counted 126', atp.counted_qty === 126, `${atp?.counted_qty}`);
t('allergen opens at the counted 80', allergen.counted_qty === 80, `${allergen?.counted_qty}`);
t('the reorder point is the plant\'s 50', atp.reorder_point === 50 && allergen.reorder_point === 50);
t('a box is 100 swabs', state.box_size === 100 && atp.box_size === 100);
t('neither needs a first count', !atp.needs_count && !allergen.needs_count);
const openingAtp = atp.on_hand;
t('on hand is a number, not null', typeof openingAtp === 'number', `${openingAtp}`);

console.log('\n── a logged swab comes off the shelf ──');
// An ATP reading IS a swab that was taken.
const clean = await J(await post('/sanitation', {
  area: '1', type: 'pre_op', result: 'pass', performed_by: 'Swab QA', atp_reading: '12',
}));
t('a clean with an ATP reading was filed', !!clean?.id, JSON.stringify(clean).slice(0, 140));
state = await J(await get('/sanitation/swab-stock'));
atp = swab(state.swabs, 'atp');
t('ONE SWAB CAME OFF THE ATP SHELF', atp.on_hand === openingAtp - 1, `${openingAtp} → ${atp.on_hand}`);
t('and it is counted as used since the count', atp.used_since >= 1, `${atp.used_since}`);
t('the allergen shelf did NOT move — an ATP reading is not an allergen swab',
  swab(state.swabs, 'allergen').on_hand === allergen.on_hand);

// The Batching cleaning events are the other place a swab is recorded.
const day = new Date().toISOString().slice(0, 10);
const entry = await J(await post('/production/entries', {
  date: day, team: 'Batching', room: 'Batching 1', product_name: 'Swab Test', mo_number: 'MO-SWAB',
  lot_number: 'LOT-SWAB', people_count: 1, quantity_completed: 1,
  start_time: '06:00', end_time: '14:00', submitted_by: 'Swab QA',
  cleaning_events: [{ level: 'Full Clean', scope: ['Room'], room: 'Batching 1', atp_swab: true, allergen_swab: true,
    start_time: '06:00', end_time: '07:00' }],
}));
t('a Batching entry with a swabbed clean was filed', !!entry?.id, JSON.stringify(entry).slice(0, 160));
state = await J(await get('/sanitation/swab-stock'));
t('the cleaning event took one of each', swab(state.swabs, 'atp').on_hand === openingAtp - 2
  && swab(state.swabs, 'allergen').on_hand === allergen.on_hand - 1,
  JSON.stringify(state.swabs.map(s => [s.key, s.on_hand])));

console.log('\n── a delivery is counted in boxes ──');
let r = await post('/sanitation/swab-stock/allergen/received', { boxes: 2 });
t('a delivery is accepted', r.status === 201, `${r.status}`);
state = await J(await get('/sanitation/swab-stock'));
allergen = swab(state.swabs, 'allergen');
t('two boxes added 200 swabs, not 2', allergen.received_since === 200, `${allergen.received_since}`);
r = await post('/sanitation/swab-stock/allergen/received', { boxes: 0 });
t('nothing is filed for no boxes', r.status === 400, `${r.status}`);

console.log('\n── a recount is a NEW event, not an edit ──');
const before = swab(state.swabs, 'atp').on_hand;
r = await post('/sanitation/swab-stock/atp/count', { qty: 40, reason: 'shelf count' });
t('a count is accepted', r.status === 201, `${r.status}`);
state = await J(await get('/sanitation/swab-stock'));
atp = swab(state.swabs, 'atp');
t('THE COUNT IS THE ANCHOR — on hand is what was counted', atp.on_hand === 40, `${atp.on_hand}`);
t('and the clock restarts, so nothing before it is subtracted twice', atp.used_since === 0, `${atp.used_since}`);
{
  const db = new Database(process.env.DBPATH);
  const n = db.prepare("SELECT COUNT(*) c FROM swab_stock_events WHERE swab_type='atp' AND kind='count'").get().c;
  t('BOTH COUNTS SURVIVE — the earlier one was not overwritten', n === 2, `${n}`);
  const a = db.prepare(`SELECT details FROM audit_log WHERE entity_type='swab_stock'
    AND details LIKE '%"kind":"count"%' ORDER BY timestamp DESC LIMIT 1`).get();
  t('the audit trail records the variance against the books',
    /"expected":/.test(a?.details || '') && /"variance":/.test(a?.details || ''), a?.details);
  t('and the variance is the real difference', new RegExp(`"variance":${40 - before}\\b`).test(a?.details || ''),
    `expected ${40 - before} · ${a?.details}`);
  db.close();
}

console.log('\n── the reorder order raises itself, once ──');
// 40 is below the 50 point, so housekeeping now has something to do. It runs on
// ordinary page loads, so a GET on the task list is what triggers it — the same
// path the floor takes, rather than a test-only hook.
await get('/pm/work-orders?limit=1');
await new Promise(res => setTimeout(res, 400));
const orders = await J(await get('/office/supply/orders'));
const list = orders?.orders || orders || [];
// Scoped to what the app raised. The office's own history already carries
// hand-filed swab orders, which is exactly why the guard below matters.
const swabOrders = list.filter(o => o.requested_by === 'system' && /swab/i.test(o.item_name || ''));
t('an order was raised for the type below its point', swabOrders.length === 1, JSON.stringify(swabOrders.map(o => o.item_name)));
t('it is for the ATP swabs, not the allergen ones that are fine',
  /atp/i.test(swabOrders[0]?.item_name || ''), swabOrders[0]?.item_name);
t('it asks for a box', swabOrders[0]?.qty === 1 && swabOrders[0]?.uom === 'box',
  JSON.stringify([swabOrders[0]?.qty, swabOrders[0]?.uom]));
t('and it says why, with the numbers', /reorder point of 50/i.test(swabOrders[0]?.notes || ''), swabOrders[0]?.notes);

// Idempotent: a second sweep must not file a second order. Driven directly,
// because housekeeping is throttled to once every five minutes and a second
// HTTP call would prove nothing — it would not run at all.
{
  const { generateSwabReorders } = await import('../server/swab-stock.js');
  const db = new Database(process.env.DBPATH);
  const mine = () => db.prepare("SELECT id FROM supply_orders WHERE requested_by = 'system' AND item_name LIKE '%swab%'").all();
  const raised = generateSwabReorders(db);
  t('A SECOND SWEEP RAISES NOTHING while the order is still open', raised === 0, `${raised}`);
  t('and there is still exactly one', mine().length === 1, `${mine().length}`);
  // Close it, and the next sweep raises the next one — the trigger is not spent
  // by having fired once.
  const first = mine()[0].id;
  db.prepare("UPDATE supply_orders SET status = 'received' WHERE id = ?").run(first);
  t('once the order is closed the next one is raised', generateSwabReorders(db) === 1);
  t('so there are two, one closed and one open', mine().length === 2, `${mine().length}`);
  // A hand-filed order counts too: the office already ordering them is the same
  // fact as the app having ordered them, and a duplicate in that queue is what
  // makes people stop reading it.
  db.prepare("DELETE FROM supply_orders WHERE requested_by = 'system' AND item_name LIKE '%swab%'").run();
  const hand = 'hand-' + Date.now();
  db.prepare("INSERT INTO supply_orders (id, item_name, qty, uom, status) VALUES (?, 'ATP swabs', 1, 'box', 'ordered')").run(hand);
  t('NOTHING IS RAISED OVER AN ORDER SOMEBODY ALREADY PLACED BY HAND', generateSwabReorders(db) === 0);
  db.prepare('DELETE FROM supply_orders WHERE id = ?').run(hand);
  db.close();
}

console.log('\n── the reorder point is the plant\'s to move ──');
r = await put('/sanitation/swab-stock/atp', { reorder_point: 30 });
t('the point moves', r.status === 200, `${r.status}`);
state = await J(await get('/sanitation/swab-stock'));
atp = swab(state.swabs, 'atp');
t('and 40 is no longer below it', atp.reorder_point === 30 && atp.below_reorder === false,
  JSON.stringify([atp.reorder_point, atp.below_reorder]));

console.log('\n── who may do what ──');
token = opToken;
const opRead = await J(await get('/sanitation/swab-stock'));
t('an operator can SEE the shelf — they are the one about to swab a room',
  (opRead?.swabs || []).length === 2, JSON.stringify(opRead).slice(0, 120));
r = await post('/sanitation/swab-stock/atp/count', { qty: 999 });
t('but cannot file a count', r.status === 403, `${r.status}`);
r = await post('/sanitation/swab-stock/allergen/received', { boxes: 5 });
t('nor a delivery', r.status === 403, `${r.status}`);
r = await put('/sanitation/swab-stock/atp', { reorder_point: 0 });
t('nor move the reorder point', r.status === 403, `${r.status}`);
token = qaToken;
state = await J(await get('/sanitation/swab-stock'));
t('AND NONE OF IT LANDED', swab(state.swabs, 'atp').on_hand === 40
  && swab(state.swabs, 'atp').reorder_point === 30, JSON.stringify(state.swabs[0]));

console.log('\n── refusals ──');
r = await post('/sanitation/swab-stock/nonsense/count', { qty: 5 });
t('an unknown swab type is refused', r.status === 400, `${r.status}`);
r = await post('/sanitation/swab-stock/atp/count', { qty: -1 });
t('a negative count is refused', r.status === 400, `${r.status}`);
// Route ordering: `/:id` IS live (an unknown record 404s), and "swab-stock"
// still reaches its own handler rather than being read as a record id.
t('an unknown record id 404s, so /:id is live', (await get('/sanitation/no-such-record')).status === 404);
t('and swab-stock is not read as one', !!(await J(await get('/sanitation/swab-stock')))?.swabs);

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
