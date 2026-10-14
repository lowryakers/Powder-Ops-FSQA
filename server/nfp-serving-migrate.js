// Split every stored serving size into its two facts, once (D-173).
//
// `panel_json.serving_size_desc` was one free string — "1 Scoop (35g)". The
// structured form is `serving_household` + `serving_grams`, and the printed
// label is GENERATED from them. This pass parses what is on file: a row it can
// read gets both halves; one it cannot ("1 bottle", no grams) is left exactly
// as filed and reads `serving_grams_missing` on the review queue until a
// person fixes it. Nothing is invented, nothing is re-stamped, and a row that
// already carries `serving_grams` is never touched — so it is idempotent by
// construction, with no app_settings marker to go stale.
import { parseServingSize } from '../shared/panel-reconcile.js';

export function migrateServingSizes(db) {
  const rows = db.prepare("SELECT id, sku, version, panel_json FROM nfp_versions WHERE panel_json IS NOT NULL").all();
  let split = 0, unparsed = 0;
  const update = db.prepare("UPDATE nfp_versions SET panel_json = ? WHERE id = ?");
  for (const r of rows) {
    let panel;
    try { panel = JSON.parse(r.panel_json); } catch { continue; }
    if (!panel || typeof panel !== 'object') continue;
    if (panel.serving_grams !== undefined && panel.serving_grams !== null && panel.serving_grams !== '') continue;
    const desc = panel.serving_size_desc;
    if (desc === undefined || desc === null || String(desc).trim() === '') continue;
    const { household, grams } = parseServingSize(desc);
    if (!grams) { unparsed++; continue; }
    update.run(JSON.stringify({ ...panel, serving_household: household, serving_grams: grams }), r.id);
    split++;
  }
  if (split || unparsed) {
    console.log(`[nfp] serving sizes split into measure + grams: ${split}; left for a person (no grams readable): ${unparsed}`);
  }
  return { split, unparsed };
}
