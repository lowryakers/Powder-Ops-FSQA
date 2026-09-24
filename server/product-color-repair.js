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
import { pmsValid, hexValid } from '../shared/product-colors.js';

/**
 * Transcription errors found in the audited colour list.
 *
 * `from` is the row AS IT STANDS — BOTH values must still match or nothing is
 * written, because the pair is the evidence: it is the two values disagreeing
 * that proves one of them is wrong, and a row where either has moved is a row
 * somebody has already been to.
 *
 * `to` is the whole corrected pair. Most corrections move one of the two and
 * carry the other unchanged; writing both out means a correction never has to
 * be read as "and the rest stays as it was".
 */
export const COLOR_CORRECTIONS = [
  {
    sku: 'PPM-PS', slot: 2,
    from: { pms: 'PMS 285 C', hex: 'HEX C25131' },
    to: { pms: 'PMS 7580 C', hex: 'HEX C25131' },
    // PANTONE 285 C is a mid blue (about #0071CE — which is exactly what it
    // carries on the two rows where it is correct, PP-CC-04 and PSP-CCR). The
    // hex on this row is a burnt orange and is the colour actually printed on
    // the pancake pouch, so the Pantone name is the value that is wrong.
    // Reported by Lowry Akers, 2026-09-24.
    reason: 'PANTONE 285 C is a blue; this slot prints C25131 (burnt orange). '
      + 'The hex is correct and the Pantone reference was mis-transcribed.',
  },

  /* ── The other direction: the NAME is right and the HEX is borrowed ────────
   *
   * Three corrections resolved against the artwork PDFs themselves — the
   * separation names read out of the file and the rendered pixels sampled —
   * by Lowry Akers, 2026-09-24. In the first two the Pantone reference is
   * correct and the hex beside it belongs to a DIFFERENT ink, which is the
   * opposite of the Pumpkin Spice case above and is why each correction has
   * to say which of the two it is moving.
   *
   * Both appear on a pouch and a stick of the same flavour, so each is two
   * rows. The same Pantone also sits on the Toffee Cream beef rows carrying
   * the CORRECT hex already, which is how the sweep found them: one ink, two
   * colours, 181 and 61 apart per channel.
   */
  {
    sku: 'PP-PC-11', slot: 3,
    from: { pms: 'PMS 9201 C', hex: 'HEX 502C1E' },
    to: { pms: 'PMS 9201 C', hex: 'HEX F4E1CB' },
    reason: 'Peach Cobbler artwork prints 9201 C as the cream F4E1CB, which is '
      + 'in the render; 502C1E is not present as a solid anywhere on the pack. '
      + '502C1E is PMS 4625 C, borrowed from another row.',
  },
  {
    sku: 'PSP-PC', slot: 3,
    from: { pms: 'PMS 9201 C', hex: 'HEX 502C1E' },
    to: { pms: 'PMS 9201 C', hex: 'HEX F4E1CB' },
    reason: 'Peach Cobbler artwork prints 9201 C as the cream F4E1CB, which is '
      + 'in the render; 502C1E is not present as a solid anywhere on the pack. '
      + '502C1E is PMS 4625 C, borrowed from another row.',
  },
  {
    sku: 'PP-IM-07', slot: 2,
    from: { pms: 'PMS 728 C', hex: 'HEX 9FD560' },
    to: { pms: 'PMS 728 C', hex: 'HEX C49873' },
    reason: 'Iced Mocha artwork prints 728 C as the tan C49873 (about 97,000 '
      + 'pixels of it); 9FD560 is present in none. 9FD560 is PMS 367 C.',
  },
  {
    sku: 'PSP-IM', slot: 2,
    from: { pms: 'PMS 728 C', hex: 'HEX 9FD560' },
    to: { pms: 'PMS 728 C', hex: 'HEX C49873' },
    reason: 'Iced Mocha artwork prints 728 C as the tan C49873 (about 97,000 '
      + 'pixels of it); 9FD560 is present in none. 9FD560 is PMS 367 C.',
  },

  /* ── A typo, not an unusable value ────────────────────────────────────────
   *
   * `PNS 9160 C` is the one of the four shapes `shared/product-colors.js`
   * refuses that is NOT a different kind of thing. `PMS --` is an empty slot
   * and `CMYK 3 1 17 0` is a process build — neither names a spot ink. This
   * one names a real ink and is three characters away from saying so, and the
   * audit marked it invalid because that is what it read, correctly.
   *
   * So this correction moves `pms_valid` from 0 to 1, which none of the others
   * do — which is exactly why validity is RE-DERIVED on write here rather than
   * carried in the correction. The same `gtin_valid` rule: a stored verdict
   * that a repair has to remember to update is one a repair forgets.
   */
  {
    sku: 'PP-IM-07', slot: 3,
    from: { pms: 'PNS 9160 C', hex: 'HEX EDEDB2' },
    to: { pms: 'PMS 9160 C', hex: 'HEX EDEDB2' },
    reason: 'PNS is a typo for PMS. 9160 C is a real ink, used on Iced Mocha '
      + 'and Glazed Donut; the colour was never in doubt, only the spelling.',
  },
  {
    sku: 'PSP-IM', slot: 3,
    from: { pms: 'PNS 9160 C', hex: 'HEX EDEDB2' },
    to: { pms: 'PMS 9160 C', hex: 'HEX EDEDB2' },
    reason: 'PNS is a typo for PMS. 9160 C is a real ink, used on Iced Mocha '
      + 'and Glazed Donut; the colour was never in doubt, only the spelling.',
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
    if (!row) continue;                                            // fresh DB, or the SKU is gone
    if (row.pms === fix.to.pms && row.hex === fix.to.hex) continue; // already correct — say nothing
    if (row.pms !== fix.from.pms || row.hex !== fix.from.hex) {
      skipped.push({ sku: fix.sku, slot: fix.slot, found: `${row.pms} / ${row.hex}`,
        expected: `${fix.from.pms} / ${fix.from.hex}`, reason: 'the row has been changed since this was recorded' });
      continue;
    }

    const before = db.prepare('SELECT * FROM product_colors WHERE sku = ? ORDER BY slot').all(fix.sku);
    const after = before.map((c) => (c.slot === fix.slot ? { ...c, pms: fix.to.pms, hex: fix.to.hex } : c));
    const product = db.prepare('SELECT readiness_basis FROM products WHERE sku = ?').get(fix.sku);
    const rebased = rebaseColorBasis(product?.readiness_basis, colorFact(before), colorFact(after));

    db.transaction(() => {
      // Validity is RE-DERIVED, never carried in the correction — the
      // `gtin_valid` rule. `PNS 9160 C` → `PMS 9160 C` moves it from 0 to 1,
      // and a repair that has to remember to say so is one that forgets.
      db.prepare('UPDATE product_colors SET pms = ?, hex = ?, pms_valid = ?, hex_valid = ? WHERE sku = ? AND slot = ?')
        .run(fix.to.pms, fix.to.hex, pmsValid(fix.to.pms) ? 1 : 0, hexValid(fix.to.hex) ? 1 : 0,
          fix.sku, fix.slot);
      if (rebased) {
        db.prepare('UPDATE products SET readiness_basis = ? WHERE sku = ?').run(rebased, fix.sku);
      }
    })();

    logAudit('system', 'product_colors_updated', 'product', fix.sku,
      { slot: fix.slot, from: `${fix.from.pms} / ${fix.from.hex}`,
        to: `${fix.to.pms} / ${fix.to.hex}`, reason: fix.reason,
        correction: 'transcription', basis_rebased: !!rebased },
      { pms: fix.from.pms, hex: fix.from.hex }, { pms: fix.to.pms, hex: fix.to.hex }, fix.sku);
    fixed.push({ sku: fix.sku, slot: fix.slot,
      from: `${fix.from.pms} / ${fix.from.hex}`, to: `${fix.to.pms} / ${fix.to.hex}` });
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
