// One number, one spelling — for the rows that were written before there was
// a rule.
//
// `00` + a 12-digit UPC-A is that UPC's GTIN-14 form and carries the SAME
// check digit, so a padded number pasted into the GTIN box passed validation
// and was stored exactly as typed. Four bottle drafts are on file that way,
// and three separate readers disagreed about them: the GS1 capacity count
// skipped them, the barcode-image check called the image "for a different
// number" when it is for that number, and `master.csv` shipped fourteen digits
// to a proofing tool that reads twelve.
//
// This is a ONE-OFF repair, not a rule: the rule is `storedGtin()` at the
// write path, which means this finds nothing on a database written since.
// It is safe to leave running because it is idempotent by construction — a
// normalised number normalises to itself.
//
// What it is NOT allowed to do:
//   - invent or change a NUMBER. Removing padding does not change which number
//     is on the row; the check digit is untouched and re-verified.
//   - collide. `products.gtin` is UNIQUE, so a row whose bare form is already
//     on another SKU is REPORTED and left exactly as it is. That is two
//     products claiming one barcode, which is a person's decision, not a
//     seeder's.
//   - raise a false alarm. `readiness_basis` records the spelling each step was
//     signed off against, so re-spelling the column without re-spelling the
//     basis would make artwork, Shopify and ShipHero read STALE on a change
//     that is only a change of spelling.
import { normalizeGtin, isPaddedGtin, gtinValid } from '../shared/gtin.js';
import { logAudit } from './db.js';

/** Rewrite the `gtin` fact inside a stored readiness basis. Returns JSON or null. */
export function rebaseGtinBasis(raw) {
  if (!raw) return null;
  let basis;
  try { basis = JSON.parse(raw); } catch { return null; }
  if (!basis || typeof basis !== 'object') return null;
  let moved = false;
  for (const step of Object.values(basis)) {
    const deps = step && step.deps;
    if (!deps || typeof deps.gtin !== 'string') continue;
    const next = normalizeGtin(deps.gtin);
    if (next !== deps.gtin) { deps.gtin = next; moved = true; }
  }
  return moved ? JSON.stringify(basis) : null;
}

export function repairPaddedGtins(db) {
  const rows = (() => {
    try {
      return db.prepare(`SELECT sku, gtin, barcode_gtin, readiness_basis FROM products
        WHERE (gtin IS NOT NULL AND gtin != '') OR (barcode_gtin IS NOT NULL AND barcode_gtin != '')`).all();
    } catch { return []; }
  })();

  const held = db.prepare('SELECT sku FROM products WHERE gtin = ? AND sku != ?');
  const upd = db.prepare(`UPDATE products SET gtin = ?, gtin_valid = ?, barcode_gtin = ?, readiness_basis = ?,
    updated_at = datetime('now') WHERE sku = ?`);

  const fixed = [];
  const skipped = [];
  db.transaction(() => {
    for (const r of rows) {
      const gtin = r.gtin ? normalizeGtin(r.gtin) : r.gtin;
      const barcodeGtin = r.barcode_gtin ? normalizeGtin(r.barcode_gtin) : r.barcode_gtin;
      const basis = rebaseGtinBasis(r.readiness_basis);
      if (gtin === r.gtin && barcodeGtin === r.barcode_gtin && !basis) continue;

      if (gtin !== r.gtin) {
        const clash = held.get(gtin, r.sku);
        if (clash) {
          skipped.push({ sku: r.sku, gtin: r.gtin, reason: `${gtin} is already on ${clash.sku}` });
          continue;
        }
      }
      // The check digit belongs to the number, not to its padding — re-derived
      // rather than carried over, so a row that was invalid stays invalid.
      upd.run(gtin, gtin && gtinValid(gtin) ? 1 : 0, barcodeGtin, basis || r.readiness_basis, r.sku);
      fixed.push({ sku: r.sku, from: r.gtin, to: gtin });
    }
  })();

  for (const f of fixed) {
    if (f.from === f.to) continue;
    logAudit('system', 'update', 'product', f.sku,
      { action: 'gtin_unpadded', from: f.from, to: f.to,
        why: 'The same GS1 number, written without its GTIN-14 padding.' },
      null, null, f.sku);
  }
  if (fixed.length) console.log(`[seed] Products: ${fixed.length} GTIN(s) stored without their GTIN-14 padding`);
  for (const s of skipped) console.warn(`[seed] Products: ${s.sku} keeps ${s.gtin} — ${s.reason}`);
  return { fixed, skipped, padded: rows.filter((r) => isPaddedGtin(r.gtin)).length };
}
