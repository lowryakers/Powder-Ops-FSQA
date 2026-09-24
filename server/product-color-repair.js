// Brand colours that were transcribed wrongly, corrected once.
//
// `product_colors` is written by exactly one thing — `seedProducts()`, loading
// `seed-data/sku_colors.csv`, which skips entirely once `products` has any row.
// So it runs once in a database's life. Correcting the CSV fixes a FRESH
// database and reaches a live one never, which is why this file exists: the
// correction has to travel to the rows already on the volume.
//
// The going-forward door is `PUT /api/products/:sku/colors`. This is only for
// the values that were already wrong before there was a door.
//
// WHAT IT IS NOT ALLOWED TO DO — and these are the rules that make it safe to
// leave in the boot sequence:
//
//   - Guess. Every correction is TRANSCRIBED below with the evidence for it,
//     the same standing `preventive-controls.js` and the flavour register's
//     `DECIDED` table have. Nothing is inferred from the data.
//   - Overwrite somebody. A correction applies only while the row still reads
//     EXACTLY what it was recorded as reading — the wrong Pantone AND the hex
//     that proves it wrong. If either has moved, the row is REPORTED and left
//     exactly as it is: somebody has already been here, and a repair that
//     undoes a person's correction is the quiet undo that makes people stop
//     trusting a setting (the equipment `asset_kind` backfill rule).
//   - Run twice. Idempotent BY CONSTRUCTION rather than by a marker in
//     `app_settings`: once applied, the row no longer matches `from_pms`, so
//     the second boot finds nothing. That is stronger than a flag, which can
//     be cleared, and it is why `repairPaddedGtins` is written the same way.
//   - Raise a false alarm. `readiness_basis` records what each satisfied step
//     was signed off against, so moving the colour without moving the basis
//     would make the ARTWORK step read STALE — "the brand colours moved" — on
//     a pack whose ink never moved. The pack has always printed in C25131;
//     what was wrong was ReadyDoc's transcription of that ink's NAME. So the
//     basis is rebased, exactly as a re-spelled GTIN is.
import { logAudit } from './db.js';

/**
 * Transcription errors found in the audited colour list.
 *
 * `from_pms` and `hex` are the row AS IT STANDS — both must still match or
 * nothing is written. `hex` is also the evidence: it is the value that proves
 * which of the two is wrong.
 */
export const COLOR_CORRECTIONS = [
  {
    sku: 'PPM-PS', slot: 2,
    from_pms: 'PMS 285 C', to_pms: 'PMS 7580 C', hex: 'HEX C25131',
    // PANTONE 285 C is a mid blue (about #0071CE — which is exactly what it
    // carries on the two rows where it is correct, PP-CC-04 and PSP-CCR). The
    // hex on this row is a burnt orange and is the colour actually printed on
    // the pancake pouch, so the Pantone name is the value that is wrong.
    // Reported by Lowry Akers, 2026-09-24.
    reason: 'PANTONE 285 C is a blue; this slot prints C25131 (burnt orange). '
      + 'The hex is correct and the Pantone reference was mis-transcribed.',
  },
];

/** Move the `colors` fact inside a stored readiness basis. Returns JSON or null. */
export function rebaseColorBasis(raw, fromFact, toFact) {
  if (!raw || fromFact === toFact) return null;
  let basis;
  try { basis = JSON.parse(raw); } catch { return null; }
  if (!basis || typeof basis !== 'object') return null;
  let moved = false;
  for (const step of Object.values(basis)) {
    const deps = step && step.deps;
    if (!deps || typeof deps.colors !== 'string') continue;
    if (deps.colors !== fromFact) continue;
    deps.colors = toFact;
    moved = true;
  }
  return moved ? JSON.stringify(basis) : null;
}

/** The `colors` fingerprint as `shared/product-readiness.js` computes it. */
const colorFact = (rows) => rows
  .map((c) => `${c.pms_code || c.pms || ''}:${c.hex || ''}`).sort().join(',');

export function repairProductColors(db) {
  const fixed = [];
  const skipped = [];

  for (const fix of COLOR_CORRECTIONS) {
    const row = (() => {
      try {
        return db.prepare('SELECT * FROM product_colors WHERE sku = ? AND slot = ?')
          .get(fix.sku, fix.slot);
      } catch { return null; }
    })();
    if (!row) continue;                                   // fresh DB, or the SKU is gone
    if (row.pms === fix.to_pms) continue;                 // already correct — say nothing
    if (row.pms !== fix.from_pms || row.hex !== fix.hex) {
      skipped.push({ sku: fix.sku, slot: fix.slot, found: `${row.pms} / ${row.hex}`,
        expected: `${fix.from_pms} / ${fix.hex}`, reason: 'the row has been changed since this was recorded' });
      continue;
    }

    const before = db.prepare('SELECT * FROM product_colors WHERE sku = ? ORDER BY slot').all(fix.sku);
    const after = before.map((c) => (c.slot === fix.slot ? { ...c, pms: fix.to_pms } : c));
    const product = db.prepare('SELECT readiness_basis FROM products WHERE sku = ?').get(fix.sku);
    const rebased = rebaseColorBasis(product?.readiness_basis, colorFact(before), colorFact(after));

    db.transaction(() => {
      db.prepare("UPDATE product_colors SET pms = ? WHERE sku = ? AND slot = ?")
        .run(fix.to_pms, fix.sku, fix.slot);
      if (rebased) {
        db.prepare('UPDATE products SET readiness_basis = ? WHERE sku = ?').run(rebased, fix.sku);
      }
    })();

    logAudit('system', 'product_colors_updated', 'product', fix.sku,
      { slot: fix.slot, from: fix.from_pms, to: fix.to_pms, hex: fix.hex, reason: fix.reason,
        correction: 'transcription', basis_rebased: !!rebased },
      { pms: fix.from_pms }, { pms: fix.to_pms }, fix.sku);
    fixed.push({ sku: fix.sku, slot: fix.slot, from: fix.from_pms, to: fix.to_pms });
  }

  if (fixed.length) {
    console.log(`[seed] Corrected ${fixed.length} mis-transcribed brand colour(s): `
      + fixed.map((f) => `${f.sku} slot ${f.slot} ${f.from} → ${f.to}`).join('; '));
  }
  // Reported, never silent: a row that has moved is a person's decision and
  // the deploy log is where somebody notices the correction did not land.
  for (const s of skipped) {
    console.warn(`[seed] Brand colour correction SKIPPED for ${s.sku} slot ${s.slot} — `
      + `${s.reason} (found ${s.found}, expected ${s.expected}). Left as it is.`);
  }
  return { fixed, skipped };
}
