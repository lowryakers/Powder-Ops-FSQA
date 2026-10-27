// Base lot and batch on COA requests (D-237). The lot as written is never
// changed; base_lot / batch are derived from it and filled where blank.
import { splitLot, rollUpLots } from '../shared/lot-model.js';

/** Fill base_lot/batch where NULL. Idempotent: a second run updates nothing. */
export function backfillBaseLots(db) {
  const rows = db.prepare("SELECT id, lot_number FROM coa_requests WHERE base_lot IS NULL AND lot_number IS NOT NULL AND TRIM(lot_number) != ''").all();
  const set = db.prepare('UPDATE coa_requests SET base_lot = ?, batch = ? WHERE id = ? AND base_lot IS NULL');
  let updated = 0;
  db.transaction(() => {
    for (const r of rows) {
      const { base_lot, batch } = splitLot(r.lot_number);
      if (!base_lot) continue;
      updated += set.run(base_lot, batch, r.id).changes;
    }
  })();
  return { updated };
}

/** Keep base_lot/batch in step after a create or a lot edit. */
export function stampBaseLot(db, id) {
  const r = db.prepare('SELECT lot_number FROM coa_requests WHERE id = ?').get(id);
  if (!r) return;
  const { base_lot, batch } = splitLot(r.lot_number);
  db.prepare('UPDATE coa_requests SET base_lot = ?, batch = ? WHERE id = ?').run(base_lot, batch, id);
}

/**
 * The per-lot gluten roll-up, ADVISORY (it gates nothing). Base lots where any
 * request carries a gluten result or the brand is ProDough. Batches known to
 * ReadyDoc are the COA requests on file for that base lot.
 */
export function lotGlutenRollup(db, { limit = 300 } = {}) {
  const reqs = db.prepare(`SELECT r.id, r.lot_number, r.base_lot, r.item_number, r.item_description, r.qa_signed_at
    FROM coa_requests r
    WHERE r.base_lot IS NOT NULL AND r.base_lot IN (
      SELECT DISTINCT q.base_lot FROM coa_requests q
      WHERE q.brand_owner = 'ProDough'
         OR EXISTS (SELECT 1 FROM coa_test_results t WHERE t.request_id = q.id AND t.test_type LIKE '%gluten%'))`).all();
  const gl = db.prepare("SELECT request_id, pass_fail, result_value, unit FROM coa_test_results WHERE test_type LIKE '%gluten%'").all();
  const byReq = new Map();
  for (const g of gl) { if (!byReq.has(g.request_id)) byReq.set(g.request_id, []); byReq.get(g.request_id).push(g); }
  const items = new Map(reqs.map(r => [r.base_lot, r]));
  const lots = rollUpLots(reqs.map(r => ({ id: r.id, lot_number: r.lot_number, signed: !!r.qa_signed_at, gluten: byReq.get(r.id) || [] })))
    .map(l => ({ ...l, item_number: items.get(l.base_lot)?.item_number || null, item_description: items.get(l.base_lot)?.item_description || null }));
  const not_met = lots.filter(l => !l.met);
  return { lots_total: lots.length, not_met_count: not_met.length, not_met: not_met.slice(0, limit) };
}
