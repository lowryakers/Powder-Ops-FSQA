// "Are the equipment list and the instrument list full of duplicates?"
//
// Measured rather than guessed, and the answer has three parts:
//
//  1. WITHIN EQUIPMENT, a repeated NAME is almost always legitimate. Ten A/C
//     units, six volumetric stick-pack machines, four fans — the plant owns
//     several of the same thing, and each has its own asset number. This is the
//     same finding as the "duplicate tasks" report: six real machines sharing
//     a name. A true duplicate is a repeated name AND a repeated asset number,
//     which on the production data is a handful of rows, not dozens.
//
//  2. ACROSS THE TWO LISTS, the overlap is real but invisible by name:
//     equipment calls it "Kitchen Tour Scale" (asset 151) and calibration
//     calls the same object "Touch Scale EG5001 #0151". Nothing matched on
//     name and nothing was linked, so the two registries looked unrelated
//     while describing the same scale. The ASSET NUMBER is what joins them —
//     from `asset_number`, or from the #NNNN the instrument's own name
//     carries.
//
//  3. THEY ARE NOT THE SAME LIST AND SHOULD NOT BE MERGED. An instrument row
//     holds what calibration needs — tolerance, unit, capacity, frequency, due
//     date — and half the instruments (the reference weights, the thermometers)
//     are not plant equipment at all. The right relationship is a LINK, which
//     `calibration_instruments.equipment_id` already provides and which nothing
//     had ever populated.

const norm = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
// Asset numbers are typed with and without leading zeros ("0151" / "151"), so
// they are compared as their digits with the padding removed.
const assetKey = (s) => {
  const digits = String(s ?? '').replace(/\D/g, '').replace(/^0+/, '');
  return digits || null;
};
// An instrument's asset number, from its own field or from the "#0151" its
// name carries — the plant writes it in both places and neither consistently.
export function instrumentAsset(inst) {
  return assetKey(inst.asset_number) || assetKey((String(inst.name || '').match(/#\s*0*(\d+)/) || [])[1]);
}

/** Rows that are the same row twice: same name AND same asset number. */
export function trueDuplicates(rows, { nameKey = 'name', assetField = 'asset_id' } = {}) {
  const groups = new Map();
  for (const r of rows) {
    const asset = assetKey(r[assetField]);
    if (!asset) continue; // no asset number is not evidence of duplication
    const k = `${norm(r[nameKey])}|${asset}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
  }
  return [...groups.values()].filter(g => g.length > 1)
    .map(g => ({ name: g[0][nameKey], asset: g[0][assetField], rows: g }));
}

/**
 * Rows sharing a name but NOT an asset number — reported separately and never
 * as duplicates. Ten A/C units are ten machines; the only thing worth saying
 * about them is that a task list will read ambiguously, which is a naming
 * problem, not a data problem.
 */
export function sameNameDifferentAsset(rows, { nameKey = 'name', assetField = 'asset_id' } = {}) {
  const groups = new Map();
  for (const r of rows) {
    const k = norm(r[nameKey]);
    if (!k) continue;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
  }
  return [...groups.values()]
    .filter(g => g.length > 1 && new Set(g.map(r => assetKey(r[assetField]))).size === g.length)
    .map(g => ({ name: g[0][nameKey], count: g.length, assets: g.map(r => r[assetField]) }));
}

/** Instruments and equipment rows that are the same physical object. */
export function crossRegistryMatches(instruments, equipment) {
  const byAsset = new Map();
  for (const e of equipment) {
    const a = assetKey(e.asset_id);
    if (a && !byAsset.has(a)) byAsset.set(a, e);
  }
  const linked = [];
  const unmatched = [];
  for (const i of instruments) {
    const a = instrumentAsset(i);
    const e = a ? byAsset.get(a) : null;
    if (e) {
      linked.push({
        instrument: { id: i.id, name: i.name, asset: i.asset_number || a, type: i.type },
        equipment: { id: e.id, name: e.name, asset: e.asset_id, type: e.type },
        already_linked: i.equipment_id === e.id,
        // The names differ in almost every case, which is why nothing ever
        // matched them; worth showing so the reviewer can see what they are
        // agreeing to.
        names_differ: norm(i.name) !== norm(e.name),
      });
    } else {
      unmatched.push({ id: i.id, name: i.name, asset: i.asset_number || null, type: i.type });
    }
  }
  return { linked, unmatched };
}
