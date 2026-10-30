// Reads the letter-of-guarantee state off the records (D-289). The rule is
// shared/supplier-guarantee.js; this only gathers the rows it needs.
import { guaranteeStatus, GUARANTEE_KIND } from '../shared/supplier-guarantee.js';
import { plantDateOf } from './plant-clock.js';

/** Map of supplier_id → that supplier's guarantee letters, in one query. */
function lettersBySupplier(db) {
  const map = new Map();
  for (const f of db.prepare(`SELECT id, supplier_id, kind, expires_on, filename, created_at,
      CASE WHEN storage_key IS NOT NULL THEN 1 ELSE 0 END AS stored
      FROM supplier_files WHERE kind = ?`).all(GUARANTEE_KIND)) {
    if (!map.has(f.supplier_id)) map.set(f.supplier_id, []);
    map.get(f.supplier_id).push(f);
  }
  return map;
}

/** Attach `guarantee` to each supplier row. */
export function withGuarantee(db, suppliers, today = plantDateOf()) {
  const letters = lettersBySupplier(db);
  return suppliers.map(s => ({ ...s, guarantee: guaranteeStatus(s, letters.get(s.id) || [], today) }));
}

export function guaranteeFor(db, supplier, today = plantDateOf()) {
  const files = db.prepare(`SELECT id, supplier_id, kind, expires_on, filename, created_at,
      CASE WHEN storage_key IS NOT NULL THEN 1 ELSE 0 END AS stored
      FROM supplier_files WHERE supplier_id = ? AND kind = ?`).all(supplier.id, GUARANTEE_KIND);
  return guaranteeStatus(supplier, files, today);
}

/** Suppliers that owe a letter and have no current one — the bell and the register read this. */
export function openGuaranteeGaps(db, today = plantDateOf()) {
  const suppliers = db.prepare('SELECT id, name, vendor_type, food_contact, actively_using FROM suppliers WHERE actively_using = 1').all();
  return withGuarantee(db, suppliers, today).filter(s => s.guarantee.gap);
}
