// "Is this a chemical?" has one answer, used by the kiosk, the in-app sign-out
// form, the server-side check that a use specification was picked, and the
// sanitation re-clean rule. Two sources: the approved registry, and anything
// filed under the Chemicals category in the editable item list — because not
// everything that needs a use spec is in the registry (baking soda is the case
// that raised this).
//
// The category IS the marker, not a label. Adding "Chemicals" to the editor as
// a display group alone would have made an item look like a chemical while the
// sign-out quietly skipped its use spec, which is worse than not offering it.
//
// Its own module because api/qms.js and api/sanitation.js both need it and
// importing a router for one query drags a whole dependency tree behind it —
// the same reasoning that put password-policy.js beside the auth middleware.
export function activeChemicalNames(db) {
  const names = new Set();
  try {
    for (const r of db.prepare('SELECT name FROM approved_chemicals ORDER BY name').all()) names.add(r.name);
  } catch { /* table optional */ }
  try {
    const rows = db.prepare("SELECT name FROM maintenance_items WHERE category = 'Chemicals' ORDER BY sort_order, name").all();
    for (const r of rows) names.add(r.name);
  } catch { /* table optional */ }
  return [...names];
}
