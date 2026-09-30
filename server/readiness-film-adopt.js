// Artwork already released takes the packaging spec AS IT STANDS as its film
// baseline (D-136).
//
// The readiness model's first-sight rule says a dependency ABSENT from what was
// recorded can never read as moved — right for a deploy, which must not light
// the catalogue amber, and wrong for the artwork already on the Artwork board:
// without a recorded `film` fact, a trim corrected on its spec next week would
// never mark that artwork for another look, which is the whole point of D-136.
//
// So this records today's spec values as the baseline for every print-ready
// product whose artwork basis does not carry one yet. It ADDS a missing key and
// never overwrites one, so it is idempotent by construction (the
// `repairPaddedGtins` shape, not an app_settings flag) and changes no step's
// state on the day it runs: every product reads exactly as it did before.
import { FACTS, parseBasis } from '../shared/product-readiness.js';

export function adoptFilmBasis(db) {
  const rows = db.prepare(`
    SELECT p.sku, p.readiness_basis, s.format AS spec_format, s.material_structure, s.zipper,
           s.print_process, s.trim_length_mm, s.trim_width_mm, s.gusset_mm, s.front_panel_mm,
           s.wind_direction
    FROM products p LEFT JOIN packaging_specs s ON s.spec_id = p.spec_id
    WHERE p.artwork_status = 'print_ready'`).all();
  const upd = db.prepare('UPDATE products SET readiness_basis = ? WHERE sku = ?');
  let adopted = 0;
  const tx = db.transaction(() => {
    for (const r of rows) {
      const basis = parseBasis(r.readiness_basis);
      const art = basis.artwork || { at: null, by: null, deps: {} };
      if (art.deps && 'film' in art.deps) continue;
      basis.artwork = { ...art, deps: { ...(art.deps || {}), film: FACTS.film(r) } };
      upd.run(JSON.stringify(basis), r.sku);
      adopted++;
    }
  });
  tx();
  if (adopted) console.log(`[seed] Readiness: ${adopted} released artwork took its packaging spec as it stands as the film baseline`);
  return { adopted };
}
