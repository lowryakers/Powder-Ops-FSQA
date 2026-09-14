// What is actually IN the bag, in grams — the one input the proofing service's
// Net Weight check has no other way to learn.
//
// Artwork-Proofing reconciles `serving size x servings per container` against
// the fill weight. Every other input is printed on the artwork, which is both
// why the check works and why this column has to exist: a label checked only
// against itself is internally consistent and can still be wrong by half.
// Three revisions reached film exactly that way — crepe declaring 216 g
// against a 454 g fill, pancake declaring 686 g against the same 454 (a 51%
// overstatement of net contents), cupcake declaring 378 g against 380.
// Proofreading cannot find that class of error. Dividing by a measured fill
// weight can.
//
// TRANSCRIBED, NEVER DERIVED — the `preventive-controls.js` doctrine. Each
// value is read off the production formula and confirmed by weighing a sealed
// bag. It must never be computed from the declared net weight, the serving
// size, or anything else on the label: the moment the two agree by
// construction rather than by measurement the check is worthless, and it
// would have passed all three revisions above.
//
// KEYED ON THE SKU, one line each, rather than on the product line. "Every
// Pancake Mix is 454" is a derivation, and a pancake flavour packed in a
// different bag would silently inherit a number nobody weighed.
//
// What this is NOT allowed to do:
//   - overwrite. A value already on the row is somebody's measurement and
//     wins, including one that disagrees with this table.
//   - refill a value somebody CLEARED. Blanking a fill weight is how a person
//     says "that was wrong, we do not know it yet", and the proofer then
//     reports that SKU UNVERIFIED — which is the honest answer. So the pass
//     runs ONCE and is stamped, rather than topping up every NULL on every
//     deploy. (The candidates-seed rule: a redeploy must never resurrect what
//     somebody deliberately removed.)
//   - invent a product. A SKU that is not in the catalogue is REPORTED and
//     skipped, never created.
import { logAudit } from './db.js';

const FLAG = 'product_fill_weights_seeded';

// Confirmed against the production formula and verified by weighing sealed
// bags. Ten SKUs; the catalogue holds no other product whose fill weight has
// been measured yet.
export const FILL_WEIGHTS = [
  // Protein Pancake Mix — 454 g
  { sku: 'PPM-BM', grams: 454 },
  { sku: 'PPM-C', grams: 454 },
  { sku: 'PPM-CS', grams: 454 },
  { sku: 'PPM-PS', grams: 454 },
  // Protein Cupcake Mix — 380 g, and NOT the 720 g on the artwork. Those packs
  // currently declare 25.4 oz (720 g), which is the error being corrected to
  // 13.4 oz (380 g). Seeding what the label says would make the check agree
  // with the defect it exists to find.
  { sku: 'PCCM-V-04', grams: 380 },
  { sku: 'PCCM-CH-01', grams: 380 },
  { sku: 'PCCM-CS-02', grams: 380 },
  { sku: 'PCCM-PS-03', grams: 380 },
  // Protein Crepe Mix — 454 g
  { sku: 'PCM-OR', grams: 454 },
  { sku: 'PCM-CH', grams: 454 },
];

export function seedFillWeights(db) {
  const done = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(FLAG);
  if (done) return { skipped: true, reason: 'already run' };

  // Never stamp the marker over an empty catalogue. On a fresh database the
  // products are seeded first, but a boot that found none would otherwise mark
  // the pass complete and it could never run again — the
  // linkOrgPositionsToUsers trap.
  const total = db.prepare('SELECT COUNT(*) n FROM products').get().n;
  if (!total) return { skipped: true, reason: 'no catalogue yet' };

  // A renamed SKU is the same product: `legacy_sku` is never cleared, so it is
  // the other half of the answer to "which row is this".
  const find = db.prepare('SELECT sku, fill_weight_g FROM products WHERE sku = ? OR legacy_sku = ?');
  const upd = db.prepare('UPDATE products SET fill_weight_g = ? WHERE sku = ?');

  const filled = [], kept = [], missing = [];
  db.transaction(() => {
    for (const { sku, grams } of FILL_WEIGHTS) {
      const row = find.get(sku, sku);
      if (!row) { missing.push(sku); continue; }
      if (row.fill_weight_g !== null && row.fill_weight_g !== undefined) {
        kept.push({ sku: row.sku, grams: row.fill_weight_g });
        continue;
      }
      upd.run(grams, row.sku);
      filled.push({ sku: row.sku, grams });
    }
    db.prepare('INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)')
      .run(FLAG, new Date().toISOString());
  })();

  // Where the number came from travels with it, because "who says it is 454"
  // is the first question anyone asks of a check that fails.
  for (const f of filled) {
    logAudit('system', 'update', 'product', f.sku,
      { action: 'fill_weight_seeded', fill_weight_g: f.grams,
        why: 'Read off the production formula and confirmed by weighing a sealed bag.' },
      null, null, f.sku);
  }
  if (filled.length) console.log(`[seed] Products: fill weight set on ${filled.length} SKU(s)`);
  for (const k of kept) console.log(`[seed] Products: ${k.sku} keeps its own fill weight of ${k.grams} g`);
  for (const m of missing) console.warn(`[seed] Products: no catalogue row for ${m} — fill weight not set`);
  return { filled, kept, missing };
}
