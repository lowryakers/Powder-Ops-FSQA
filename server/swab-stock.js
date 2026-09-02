import crypto from 'crypto';

// How many usable ATP and allergen swabs are on the shelf, and when to order.
//
// A swab is a consumable with a hard compliance dependency: running out does
// not slow a clean down, it means the clean cannot be VERIFIED, which stops
// product release. Nobody was counting them.
//
// ON HAND IS DERIVED ON EVERY READ:
//
//     the most recent physical count
//   + everything received since that count
//   − every swab LOGGED since that count
//
// So the number can never disagree with the cleaning log, and re-deriving it is
// idempotent. A stored running total drifts the first time somebody uses a swab
// without logging it and then quietly stays wrong — the defect this codebase
// keeps unpicking, in a new place.
//
// WHICH MEANS THE COUNT IS THE ANCHOR, not the arithmetic. Shelf counts differ
// from the books for ordinary reasons; a recount is a NEW event that resets the
// baseline, never an edit that erases the fact they differed.

export const SWAB_TYPES = [
  { key: 'atp', label: 'ATP swabs' },
  { key: 'allergen', label: 'Allergen swabs' },
];

// 4 bags of 25. Ordering is done in boxes, so this is what a delivery adds and
// what the reorder suggestion asks for.
export const SWABS_PER_BOX = 100;

// The plant's decision, seeded as the starting value and editable after.
//
// It is roughly four weeks of cover at the measured ceiling — 12 room-days a
// week, one swabbed clean each — which allows a two-week lead time and two
// weeks of safety stock. Deliberately the conservative side: a box on a shelf
// costs nothing next to a clean that cannot be verified.
export const DEFAULT_REORDER_POINT = 50;

const SETTING = { atp: 'swab_reorder_atp', allergen: 'swab_reorder_allergen' };

export function reorderPoint(db, type) {
  try {
    const row = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(SETTING[type]);
    const n = row ? Number(row.value) : NaN;
    return Number.isFinite(n) && n >= 0 ? n : DEFAULT_REORDER_POINT;
  } catch { return DEFAULT_REORDER_POINT; }
}

export function setReorderPoint(db, type, value) {
  const n = Math.max(0, Math.round(Number(value) || 0));
  db.prepare(`INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`)
    .run(SETTING[type], String(n));
  return n;
}

/**
 * Every swab LOGGED since a moment, from both places the plant records one.
 *
 * `sanitation_records.atp_reading` — a reading is a swab that was taken.
 * `production_entries.cleaning_events[]` — the Batching cleaning events carry
 * `atp_swab` and `allergen_swab` ticks, which is where the production-room
 * swabs actually live.
 *
 * COUNTED WHERE IT IS LOGGED, and no attempt is made to guess that one clean
 * written in both places is one swab. Reconciling those would mean deciding
 * which record is the real one, which is not a decision an inventory count gets
 * to make — and the two logs cover different areas in practice.
 */
export function swabsUsedSince(db, since) {
  const out = { atp: 0, allergen: 0 };
  const from = since || '0000-01-01';
  try {
    out.atp += db.prepare(`SELECT COUNT(*) c FROM sanitation_records
      WHERE atp_reading IS NOT NULL AND TRIM(atp_reading) != '' AND performed_at > ?`).get(from).c;
  } catch { /* column optional */ }
  try {
    // The cleaning events are JSON on the entry, so this is a scan of the rows
    // in range rather than a query the database can index. Bounded by the date.
    //
    // STRICTLY AFTER THE DAY OF THE COUNT, and that `>` is load-bearing. A
    // production entry carries only a DATE — its cleaning events have times,
    // but as free text belonging to a shift, not timestamps. So a shift filed
    // this morning and a count done this afternoon cannot be ordered, and
    // `>=` subtracted the morning's swabs from a count taken after they had
    // already left the shelf. The count is a physical fact: whatever was used
    // before it was done is already reflected in the number on the shelf.
    //
    // The cost is the other direction — a shift filed later on the day of a
    // count is not subtracted until tomorrow — and that is the right side to
    // err on: a figure that reads one high for an afternoon is a smaller
    // problem than one that drifts down for good and raises orders nobody
    // needs. The sanitation records have a real `performed_at`, so that half
    // stays exact.
    const rows = db.prepare(`SELECT date, cleaning_events FROM production_entries
      WHERE cleaning_events IS NOT NULL AND cleaning_events != '[]' AND date > ?`)
      .all(since ? String(since).slice(0, 10) : '0000-01-01');
    for (const r of rows) {
      const events = (() => { try { return JSON.parse(r.cleaning_events) || []; } catch { return []; } })();
      if (!Array.isArray(events)) continue;
      for (const e of events) {
        if (e?.atp_swab) out.atp += 1;
        if (e?.allergen_swab) out.allergen += 1;
      }
    }
  } catch { /* column optional on an older database */ }
  return out;
}

function lastCount(db, type) {
  try {
    return db.prepare(`SELECT * FROM swab_stock_events WHERE swab_type = ? AND kind = 'count'
      ORDER BY occurred_at DESC, created_at DESC LIMIT 1`).get(type) || null;
  } catch { return null; }
}

function movementSince(db, type, since) {
  try {
    return db.prepare(`SELECT COALESCE(SUM(qty), 0) n FROM swab_stock_events
      WHERE swab_type = ? AND kind IN ('received','adjustment') AND occurred_at > ?`)
      .get(type, since || '0000-01-01').n;
  } catch { return 0; }
}

/**
 * The usage rate, measured from the log rather than assumed.
 *
 * Over the window the counts actually cover. Returns null rather than a number
 * when there is not enough history to divide by — an invented rate produces an
 * invented "days of cover", and a figure nobody can source is worse than a gap
 * that says so.
 */
function usagePerWeek(db, type, since, now) {
  if (!since) return null;
  const days = (now - new Date(String(since).replace(' ', 'T') + 'Z')) / 86400000;
  // Under a week there is no rate worth quoting — one busy Tuesday would read
  // as sixty swabs a week.
  if (!(days >= 7)) return null;
  const used = swabsUsedSince(db, since)[type];
  return +(used / (days / 7)).toFixed(1);
}

export function swabState(db, { now = new Date() } = {}) {
  return SWAB_TYPES.map((t) => {
    const count = lastCount(db, t.key);
    const since = count?.occurred_at || null;
    const used = swabsUsedSince(db, since)[t.key];
    const moved = movementSince(db, t.key, since);
    // No count on record means no baseline — and an on-hand figure derived from
    // nothing is a number somebody will act on. It says so instead.
    const onHand = count ? Math.max(0, Number(count.qty) + moved - used) : null;
    const point = reorderPoint(db, t.key);
    const perWeek = usagePerWeek(db, t.key, since, now);
    return {
      key: t.key,
      label: t.label,
      on_hand: onHand,
      counted_at: since,
      counted_qty: count ? Number(count.qty) : null,
      used_since: used,
      received_since: moved,
      reorder_point: point,
      per_week: perWeek,
      // Only where there is a measured rate to divide by.
      weeks_of_cover: onHand != null && perWeek > 0 ? +(onHand / perWeek).toFixed(1) : null,
      below_reorder: onHand != null && onHand <= point,
      needs_count: !count,
      box_size: SWABS_PER_BOX,
    };
  });
}

/**
 * The plant's opening count, filed once so the shelf starts from a real number.
 *
 * INSERT-ONLY PER TYPE and skipped entirely once that type has any count on
 * record — a redeploy must never overwrite a count somebody actually did, which
 * is the seeding rule every other seeder here follows.
 *
 * It is filed as an ordinary count event carrying its own date and a reason
 * saying where the figure came from, rather than as a special kind of row: a
 * baseline that reads differently from a recount is a baseline nobody can
 * correct by counting.
 */
export const OPENING_COUNTS = { atp: 126, allergen: 80 };
export const OPENING_COUNT_DATE = '2026-09-01';

export function seedSwabCounts(db) {
  let filed = 0;
  for (const t of SWAB_TYPES) {
    try {
      const has = db.prepare("SELECT 1 FROM swab_stock_events WHERE swab_type = ? AND kind = 'count' LIMIT 1").get(t.key);
      if (has) continue;
      db.prepare(`INSERT INTO swab_stock_events (id, swab_type, kind, qty, reason, recorded_by, occurred_at)
        VALUES (?, ?, 'count', ?, ?, 'system', ?)`)
        .run(crypto.randomUUID(), t.key, OPENING_COUNTS[t.key],
          'Opening count reported by the plant', `${OPENING_COUNT_DATE} 00:00:00`);
      filed++;
    } catch { /* the table may not exist on a partial database */ }
  }
  return filed;
}

/**
 * Raise ONE supply order when a type drops to its reorder point.
 *
 * Directly, not as a suggestion — unlike the "used up" strip, which groups
 * because three people finishing the same sanitizer would file three
 * near-identical requests. There is exactly one trigger per swab type and it is
 * idempotent: while an order for that item is still open, no second one is
 * raised. A queue with duplicates in it stops being read.
 */
export function generateSwabReorders(db, { now = new Date() } = {}) {
  let raised = 0;
  const state = swabState(db, { now });
  for (const s of state) {
    if (!s.below_reorder) continue;
    const item = s.label;
    const open = (() => {
      try {
        return db.prepare(`SELECT 1 FROM supply_orders
          WHERE LOWER(item_name) = LOWER(?) AND status IN ('new','ordered') LIMIT 1`).get(item);
      } catch { return true; }   // no orders table: raise nothing rather than throw
    })();
    if (open) continue;
    try {
      const id = crypto.randomUUID();
      db.prepare(`INSERT INTO supply_orders (id, item_name, qty, uom, label, notes, requested_by)
        VALUES (?, ?, 1, 'box', 'Cleaning', ?, 'system')`)
        .run(id, item,
          `${s.on_hand} left, at or below the reorder point of ${s.reorder_point}. `
          + `One box is ${SWABS_PER_BOX} swabs`
          + (s.per_week ? `; recent use is about ${s.per_week} a week.` : '.'));
      raised++;
    } catch { /* the orders table may not exist on a partial database */ }
  }
  return raised;
}
