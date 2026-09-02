// The swab shelf's arithmetic, on a temporary database. No server.
//
// This is the guard on the rule that is easiest to break back: a count is the
// anchor, and swabs logged before it must not be subtracted from it.
import Database from 'better-sqlite3';
import {
  swabState, swabsUsedSince, generateSwabReorders, setReorderPoint,
  reorderPoint, seedSwabCounts, DEFAULT_REORDER_POINT, SWABS_PER_BOX, OPENING_COUNTS,
} from '../server/swab-stock.js';

let pass = 0, fail = 0;
const t = (n, c, d = '') => { if (c) pass++; else { fail++; console.log('  ✗ ' + n + (d ? ' — ' + d : '')); } };
const S = (rows, k) => rows.find(r => r.key === k);

const db = new Database(':memory:');
db.exec(`
  CREATE TABLE app_settings (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT);
  CREATE TABLE swab_stock_events (
    id TEXT PRIMARY KEY, swab_type TEXT, kind TEXT, qty REAL, reason TEXT,
    recorded_by TEXT, occurred_at TEXT, created_at TEXT DEFAULT (datetime('now')));
  CREATE TABLE sanitation_records (id TEXT PRIMARY KEY, atp_reading TEXT, performed_at TEXT);
  CREATE TABLE production_entries (id TEXT PRIMARY KEY, date TEXT, cleaning_events TEXT);
  CREATE TABLE supply_orders (
    id TEXT PRIMARY KEY, item_name TEXT, qty REAL, uom TEXT, label TEXT,
    status TEXT DEFAULT 'new', notes TEXT, requested_by TEXT,
    submitted_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')));
`);
let seq = 0;
const ev = (type, kind, qty, at) => db.prepare(
  'INSERT INTO swab_stock_events (id, swab_type, kind, qty, occurred_at) VALUES (?, ?, ?, ?, ?)')
  .run(`e${++seq}`, type, kind, qty, at);
const atpRead = (at) => db.prepare('INSERT INTO sanitation_records (id, atp_reading, performed_at) VALUES (?, ?, ?)')
  .run(`s${++seq}`, '15', at);
const shift = (date, events) => db.prepare('INSERT INTO production_entries (id, date, cleaning_events) VALUES (?, ?, ?)')
  .run(`p${++seq}`, date, JSON.stringify(events));

console.log('── with no count on record ──');
let st = swabState(db);
t('there is no on-hand figure', S(st, 'atp').on_hand === null);
t('it says a count is needed rather than showing a number', S(st, 'atp').needs_count === true);
t('and nothing is ordered against a shelf nobody has counted', generateSwabReorders(db) === 0);
t('the reorder point falls back to the plant\'s value', reorderPoint(db, 'atp') === DEFAULT_REORDER_POINT);

console.log('\n── the opening count is insert-only ──');
t('it files both types', seedSwabCounts(db) === 2);
t('ATP opens at the plant\'s figure', S(swabState(db), 'atp').on_hand === OPENING_COUNTS.atp);
t('allergen opens at its own', S(swabState(db), 'allergen').on_hand === OPENING_COUNTS.allergen);
ev('atp', 'count', 12, '2026-09-10 09:00:00');
t('A REDEPLOY FILES NOTHING once a count exists', seedSwabCounts(db) === 0);
t('AND DOES NOT OVERWRITE THE COUNT SOMEBODY DID', S(swabState(db), 'atp').on_hand === 12);

console.log('\n── the count is the anchor ──');
// A shift on the day of the count, and one after it.
shift('2026-09-10', [{ atp_swab: true, allergen_swab: true }]);
shift('2026-09-11', [{ atp_swab: true }, { atp_swab: true, allergen_swab: true }]);
st = swabState(db);
t('THE SAME-DAY SHIFT IS NOT SUBTRACTED — it is already in the physical count',
  S(st, 'atp').used_since === 2, `${S(st, 'atp').used_since}`);
t('so on hand is the count minus only what came after', S(st, 'atp').on_hand === 10, `${S(st, 'atp').on_hand}`);
// A reading has a real timestamp, so it is compared exactly.
atpRead('2026-09-10 08:00:00');   // before the count
atpRead('2026-09-10 17:00:00');   // after it
st = swabState(db);
t('a reading before the count is not subtracted, one after it is',
  S(st, 'atp').used_since === 3, `${S(st, 'atp').used_since}`);

console.log('\n── deliveries, and the working shown ──');
ev('atp', 'received', SWABS_PER_BOX, '2026-09-12 09:00:00');
st = swabState(db);
t('a box adds its swabs', S(st, 'atp').received_since === 100);
t('on hand is count + received − used', S(st, 'atp').on_hand === 12 + 100 - 3, `${S(st, 'atp').on_hand}`);
t('and the count it was measured from travels with it', S(st, 'atp').counted_qty === 12);
// A delivery filed BEFORE the count is already in it.
ev('atp', 'received', 50, '2026-09-01 09:00:00');
t('a delivery before the count is not added twice', S(swabState(db), 'atp').received_since === 100);

console.log('\n── ordering ──');
setReorderPoint(db, 'atp', 200);
t('the point is the plant\'s to move', reorderPoint(db, 'atp') === 200);
st = swabState(db);
t('109 is below 200', S(st, 'atp').below_reorder === true);
t('an order is raised', generateSwabReorders(db) === 1);
const o = db.prepare("SELECT * FROM supply_orders WHERE requested_by = 'system'").get();
t('for one box', o.qty === 1 && o.uom === 'box', JSON.stringify([o.qty, o.uom]));
t('naming the shelf and the point', /109 left/.test(o.notes) && /reorder point of 200/.test(o.notes), o.notes);
t('filed under Cleaning, where the swabs are used', o.label === 'Cleaning', o.label);
t('A SECOND SWEEP RAISES NOTHING while it is open', generateSwabReorders(db) === 0);
db.prepare("UPDATE supply_orders SET status = 'received' WHERE id = ?").run(o.id);
t('but once it is closed the next one is raised', generateSwabReorders(db) === 1);
setReorderPoint(db, 'atp', 5);
t('and nothing is raised over a shelf that is fine', generateSwabReorders(db) === 0);

console.log('\n── the rate, and refusing to invent one ──');
// The allergen count is the seeded opening one, dated well back, so there is a
// window to divide by.
const rate = S(swabState(db, { now: new Date('2026-09-15T00:00:00Z') }), 'allergen');
t('a rate is quoted once there is a week of history', rate.per_week != null, `${rate.per_week}`);
ev('allergen', 'count', 80, '2026-09-14 09:00:00');
const fresh = S(swabState(db, { now: new Date('2026-09-15T00:00:00Z') }), 'allergen');
t('UNDER A WEEK THERE IS NO RATE, not a made-up one', fresh.per_week === null, `${fresh.per_week}`);
t('and no weeks-of-cover figure derived from one', fresh.weeks_of_cover === null);

console.log('\n── a swab is counted where it is logged ──');
const used = swabsUsedSince(db, '2026-09-10 12:00:00');
t('the two logs are read separately', used.atp === 3 && used.allergen === 1, JSON.stringify(used));

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
