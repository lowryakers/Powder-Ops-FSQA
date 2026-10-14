// What a nutrition panel's own numbers have to agree with (D-171).
//
// PURE — panel values in, findings out. The server runs it on every panel write
// and at approval; the draft card renders what the server sends. One definition,
// so the warning on the screen and the gate on the approve button cannot
// disagree about whether a panel passed.
//
// TWO CHECKS, both reported, neither a hard block:
//  * FILL WEIGHT — the serving size in grams times servings per container has to
//    land within ±5% of the product's fill weight in Products. A serving written
//    as a range ("1 bottle (34-37g)") is checked at its midpoint.
//  * CALORIES — 4 × carbohydrate + 4 × protein + 9 × fat has to land within ±20%
//    of the calories declared. A "<1" amount counts as anything from 0 to 1, and
//    the check passes when any value in that span would.
//
// A check whose inputs are missing is NOT CHECKED, never a pass and never a
// warning: a blank is a gap, not a number (the nutrition-dv rule).
//
// A warning carries a FINGERPRINT of the numbers it was raised on. A person's
// acknowledgement is of that fingerprint, so changing a value (or the product's
// fill weight) raises the warning again rather than riding on an old tick.

export const FILL_TOLERANCE = 0.05;
export const CALORIE_TOLERANCE = 0.20;

/**
 * The fields a panel-values write names, in the words the bot uses, and the
 * column each lives in on `nfp_versions.panel_json`. Nothing outside this list
 * is written by the values route.
 */
export const PANEL_VALUE_FIELDS = Object.freeze({
  serving_size: 'serving_size_desc',
  // D-173: the serving size is TWO facts — a household measure ("1 Scoop") and
  // the grams ("35", or a range "34-37"). `serving_size` above is the printed
  // label, GENERATED from the two; writing it parses it back into them.
  serving_household: 'serving_household',
  serving_grams: 'serving_grams',
  servings_per_container: 'servings_per_container',
  calories: 'calories',
  total_fat: 'total_fat_g',
  saturated_fat: 'saturated_fat_g',
  trans_fat: 'trans_fat_g',
  cholesterol: 'cholesterol_mg',
  sodium: 'sodium_mg',
  total_carbohydrate: 'total_carbohydrate_g',
  dietary_fiber: 'dietary_fiber_g',
  total_sugars: 'total_sugars_g',
  added_sugars: 'added_sugars_g',
  protein: 'protein_g',
  vitamin_d: 'vitamin_d_mcg',
  calcium: 'calcium_mg',
  iron: 'iron_mg',
  potassium: 'potassium_mg',
  ingredients: 'ingredients',
  allergen_statement: 'allergen_statement',
});

export const FIELD_LABEL = Object.freeze({
  serving_size: 'Serving size', serving_household: 'Serving (household measure)', serving_grams: 'Serving (g)',
  servings_per_container: 'Servings per container', calories: 'Calories',
  total_fat: 'Total fat', saturated_fat: 'Saturated fat', trans_fat: 'Trans fat', cholesterol: 'Cholesterol',
  sodium: 'Sodium', total_carbohydrate: 'Total carbohydrate', dietary_fiber: 'Dietary fiber',
  total_sugars: 'Total sugars', added_sugars: 'Added sugars', protein: 'Protein', vitamin_d: 'Vitamin D',
  calcium: 'Calcium', iron: 'Iron', potassium: 'Potassium', ingredients: 'Ingredients',
  allergen_statement: 'Allergen statement',
});

/** The panel as the values route speaks it: bot field name → stored value. */
export function valuesOf(panel) {
  const out = {};
  for (const [field, col] of Object.entries(PANEL_VALUE_FIELDS)) {
    out[field] = panel && panel[col] !== undefined ? panel[col] : null;
  }
  // A panel filed before the split (D-173) carries only the label and maybe
  // `serving_size_g`; read its two halves out of those so an old approved
  // panel diffs cleanly against a new draft rather than showing a change of
  // shape as a change of fact.
  if (panel && (out.serving_household === null || out.serving_household === '') && (out.serving_grams === null || out.serving_grams === '')) {
    const parsed = parseServingSize(panel.serving_size_desc);
    const g = parsed.grams ?? normalizeServingGrams(panel.serving_size_g);
    if (parsed.household || g) { out.serving_household = parsed.household; out.serving_grams = g; }
  }
  return out;
}

/**
 * The grams written into a serving size: "34 g", "1 scoop (30g)",
 * "1 bottle (34-37g)", "2 tbsp (14 to 16 g)". `mid` is the midpoint of a range.
 * Milligrams and kilograms are not grams. Null when no gram weight is written.
 */
export function servingGrams(desc) {
  if (desc === null || desc === undefined) return null;
  if (typeof desc === 'number') return Number.isFinite(desc) ? { low: desc, high: desc, mid: desc } : null;
  const s = String(desc);
  const re = /(?<![\d.])(\d+(?:\.\d+)?)\s*(?:(?:-|–|to)\s*(\d+(?:\.\d+)?)\s*)?g(?:rams?)?(?![a-z])/i;
  const m = s.match(re);
  if (!m) return null;
  // The character before the number must not be part of "m" or "k" grams.
  const before = s.slice(0, m.index).trimEnd().slice(-1);
  if (/[mk]/i.test(before)) return null;
  const low = Number(m[1]);
  const high = m[2] !== undefined ? Number(m[2]) : low;
  if (!Number.isFinite(low) || !Number.isFinite(high)) return null;
  const [a, b] = low <= high ? [low, high] : [high, low];
  return { low: a, high: b, mid: (a + b) / 2 };
}

/** The grams half of a structured serving size: "35", "34.8" or a range "34-37". */
export const SERVING_GRAMS_RE = /^\s*(\d+(?:\.\d+)?)\s*(?:(?:-|–|to)\s*(\d+(?:\.\d+)?))?\s*g?\s*$/i;

/** Normalise a grams text: "35 g" → "35", "34 – 37" → "34-37". Null when it is not one. */
export function normalizeServingGrams(text) {
  if (text === null || text === undefined) return null;
  if (typeof text === 'number') return Number.isFinite(text) && text > 0 ? String(text) : null;
  const m = String(text).match(SERVING_GRAMS_RE);
  if (!m) return null;
  const a = Number(m[1]);
  const b = m[2] !== undefined ? Number(m[2]) : null;
  if (!(a > 0) || (b !== null && !(b > 0))) return null;
  if (b === null || b === a) return String(a);
  return a < b ? `${a}-${b}` : `${b}-${a}`;
}

/** A normalised grams text as a span, the `servingGrams` shape. */
export function gramsSpan(text) {
  const g = normalizeServingGrams(text);
  if (!g) return null;
  const [a, b] = g.split('-').map(Number);
  const high = b === undefined ? a : b;
  return { low: a, high, mid: (a + high) / 2 };
}

/**
 * Split a printed serving size into its two facts (D-173).
 * "1 Scoop (35g)" → { household: "1 Scoop", grams: "35" }
 * "1 bottle (34-37g)" → { household: "1 bottle", grams: "34-37" }
 * "35 g" → { household: null, grams: "35" }
 * "1 bottle" → { household: "1 bottle", grams: null } — the gap the queue shows.
 */
export function parseServingSize(desc) {
  if (desc === null || desc === undefined || String(desc).trim() === '') return { household: null, grams: null };
  const s = String(desc).trim();
  const g = servingGrams(s);
  if (!g) return { household: s, grams: null };
  const re = /\(?\s*(\d+(?:\.\d+)?)\s*(?:(?:-|–|to)\s*(\d+(?:\.\d+)?)\s*)?g(?:rams?)?(?![a-z])\s*\)?/i;
  const household = s.replace(re, '').replace(/\s{2,}/g, ' ').replace(/^[\s,;:-]+|[\s,;:-]+$/g, '').trim();
  const grams = g.low === g.high ? String(g.low) : `${g.low}-${g.high}`;
  return { household: household || null, grams };
}

/** The printed label, generated from the two facts. "1 Scoop (35g)"; "35 g" with no household measure. */
export function servingLabel(household, grams) {
  const g = normalizeServingGrams(grams);
  const h = household === null || household === undefined ? '' : String(household).trim();
  if (!g) return h || null;
  return h ? `${h} (${g}g)` : `${g} g`;
}

/**
 * What a panel has to carry before it can be approved (D-173). The lines
 * 21 CFR 101.9 prints on every panel, the serving grams, and the ingredients.
 * `allergen_statement` is deliberately not here: a product with no allergen
 * has none to declare.
 */
export const REQUIRED_PANEL_FIELDS = Object.freeze([
  'serving_grams', 'servings_per_container', 'calories', 'total_fat', 'saturated_fat', 'trans_fat',
  'cholesterol', 'sodium', 'total_carbohydrate', 'dietary_fiber', 'total_sugars', 'added_sugars', 'protein',
  'ingredients',
]);

const isBlank = (x) => x === null || x === undefined || String(x).trim() === '';

/** The required fields a panel (stored shape) does not carry. Empty = complete. */
export function missingRequired(panel) {
  const v = valuesOf(panel || {});
  return REQUIRED_PANEL_FIELDS.filter((f) => isBlank(v[f]));
}

/**
 * The gram rule. A serving size that has its gram weight keeps it: a new value
 * with no grams is refused when the current APPROVED panel's serving size has
 * them. Returns an error sentence, or null when the value is acceptable.
 */
export function gramRuleError(nextDesc, approvedDesc) {
  if (nextDesc === null || nextDesc === undefined || String(nextDesc).trim() === '') return null;
  if (servingGrams(nextDesc)) return null;
  if (!servingGrams(approvedDesc)) return null;
  return `The serving size must keep its gram weight. The approved panel says "${approvedDesc}"; `
    + `"${nextDesc}" has no grams. Write it with the grams, for example "${approvedDesc}".`;
}

/** A panel amount as a span: 12 → [12,12]; "<1" → [0,1]; "" / null / words → null. */
export function amountSpan(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? [v, v] : null;
  const s = String(v).trim();
  const lt = s.match(/^<\s*(\d+(?:\.\d+)?)/);
  if (lt) return [0, Number(lt[1])];
  const n = s.match(/^(\d+(?:\.\d+)?)/);
  if (n && /^\d+(?:\.\d+)?\s*[a-z]*$/i.test(s)) return [Number(n[1]), Number(n[1])];
  return null;
}

const pct = (x) => `${(x * 100).toFixed(1)}%`;
const r1 = (x) => Math.round(x * 10) / 10;

/**
 * Fill tolerance by pack (D-173). Stick packs are compared to the SKU's own
 * fill (they vary — Apple Pie is 34.8 g); a large pouch with no fill recorded
 * is compared to the standard pouch fill. Warning only, never a block.
 */
export const FILL_TOLERANCE_BY_PACK = Object.freeze({ STK: 0.05, PLG: 0.05, PSM: 0.05, BTL: 0.05, CUP: 0.05, BOX: 0.05 });
export const POUCH_STANDARD_FILL_G = Object.freeze({ PLG: 660 });

/**
 * Fill weight: the FORMULA's per-serving fill × servings against the SKU's fill
 * weight (D-173). The formula figure is what the line actually fills; the label
 * grams are rounded and only stand in when no formula figure is recorded —
 * and the message says which was used. ±5% per pack type.
 */
export function fillCheck(panel, fillWeightG, { perServingG = null, pack = null } = {}) {
  const label = gramsSpan(panel?.serving_grams) || servingGrams(panel?.serving_size_desc ?? panel?.serving_size_g);
  const formula = Number(perServingG);
  const perServing = formula > 0 ? { low: formula, high: formula, mid: formula, basis: 'formula' }
    : label ? { ...label, basis: 'label' } : null;
  const servings = amountSpan(panel?.servings_per_container);
  let fill = Number(fillWeightG);
  let fillBasis = 'sku';
  if (!(fill > 0) && pack && POUCH_STANDARD_FILL_G[pack]) { fill = POUCH_STANDARD_FILL_G[pack]; fillBasis = 'pack_standard'; }
  const tolerance = FILL_TOLERANCE_BY_PACK[pack] ?? FILL_TOLERANCE;
  if (!perServing || !servings || servings[0] !== servings[1] || !(fill > 0)) {
    const missing = [];
    if (!perServing) missing.push('serving size in grams');
    if (!servings || servings[0] !== servings[1]) missing.push('servings per container');
    if (!(fill > 0)) missing.push('fill weight in Products');
    return { key: 'fill_weight', label: 'Fill weight', status: 'not_checked',
      message: `Not checked — no ${missing.join(', ')}.` };
  }
  const total = perServing.mid * servings[0];
  const off = (total - fill) / fill;
  const ok = Math.abs(off) <= tolerance + 1e-9;
  const servingText = perServing.basis === 'formula'
    ? `formula per-serving fill ${perServing.mid} g`
    : perServing.low === perServing.high ? `label serving ${perServing.mid} g` : `label serving ${perServing.low}–${perServing.high} g (midpoint ${perServing.mid} g)`;
  const fillText = fillBasis === 'pack_standard' ? `the standard ${pack} fill of ${fill} g` : `a fill weight of ${fill} g`;
  return {
    key: 'fill_weight', label: 'Fill weight', status: ok ? 'ok' : 'warn',
    serving_g: perServing.mid, serving_basis: perServing.basis, servings: servings[0], computed_g: r1(total),
    fill_weight_g: fill, fill_basis: fillBasis, tolerance,
    off: Math.round(off * 1000) / 1000,
    message: `${servingText} × ${servings[0]} servings = ${r1(total)} g against ${fillText} `
      + `(${off >= 0 ? '+' : ''}${pct(off)}; allowed ±${pct(tolerance)}).`,
    fingerprint: JSON.stringify(['fill', perServing.mid, servings[0], fill]),
  };
}

/** Calories: 4 × carbs + 4 × protein + 9 × fat vs declared calories, ±20%. */
export function calorieCheck(panel) {
  const carb = amountSpan(panel?.total_carbohydrate_g);
  const prot = amountSpan(panel?.protein_g);
  const fat = amountSpan(panel?.total_fat_g);
  const cal = amountSpan(panel?.calories);
  if (!carb || !prot || !fat || !cal || cal[0] !== cal[1]) {
    const missing = [['total carbohydrate', carb], ['protein', prot], ['total fat', fat], ['calories', cal && cal[0] === cal[1]]]
      .filter(([, v]) => !v).map(([n]) => n);
    return { key: 'calories', label: 'Calories (4/4/9)', status: 'not_checked',
      message: `Not checked — no ${missing.join(', ')}.` };
  }
  const calories = cal[0];
  const lo = 4 * carb[0] + 4 * prot[0] + 9 * fat[0];
  const hi = 4 * carb[1] + 4 * prot[1] + 9 * fat[1];
  const mid = (lo + hi) / 2;
  let ok;
  let off;
  if (calories <= 0) {
    ok = hi === 0;
    off = hi === 0 ? 0 : 1;
  } else {
    const min = calories * (1 - CALORIE_TOLERANCE);
    const max = calories * (1 + CALORIE_TOLERANCE);
    ok = hi >= min - 1e-9 && lo <= max + 1e-9;
    // The off figure is the nearest point of the span to the declared value.
    const nearest = Math.min(Math.max(calories, lo), hi);
    off = (nearest - calories) / calories;
  }
  const computed = lo === hi ? `${r1(lo)}` : `${r1(lo)}–${r1(hi)}`;
  return {
    key: 'calories', label: 'Calories (4/4/9)', status: ok ? 'ok' : 'warn',
    computed_kcal: r1(mid), computed_low: r1(lo), computed_high: r1(hi), calories,
    off: Math.round(off * 1000) / 1000,
    message: `4 × ${carb[1] === carb[0] ? carb[0] : `<${carb[1]}`} g carbohydrate + 4 × ${prot[1] === prot[0] ? prot[0] : `<${prot[1]}`} g protein `
      + `+ 9 × ${fat[1] === fat[0] ? fat[0] : `<${fat[1]}`} g fat = ${computed} kcal against ${calories} declared `
      + `(${off >= 0 ? '+' : ''}${pct(off)}; allowed ±${pct(CALORIE_TOLERANCE)}).`,
    fingerprint: JSON.stringify(['cal', carb, prot, fat, calories]),
  };
}

/** Both checks, in a fixed order. */
export function reconcile(panel, { fillWeightG, perServingG, pack } = {}) {
  return [fillCheck(panel || {}, fillWeightG, { perServingG, pack }), calorieCheck(panel || {})];
}

/**
 * The warnings nobody has acknowledged. `acks` is a list of
 * { check_key, fingerprint } — an acknowledgement covers exactly the numbers it
 * was given against.
 */
export function unresolvedWarnings(checks, acks = []) {
  return checks.filter((c) => c.status === 'warn'
    && !acks.some((a) => a.check_key === c.key && a.fingerprint === c.fingerprint));
}

const same = (a, b) => {
  const n = (x) => (x === null || x === undefined || x === '' ? null : String(x).trim());
  return n(a) === n(b);
};

/** Only the fields that differ between a draft panel and the approved one. */
export function panelDiff(draftPanel, approvedPanel) {
  const out = [];
  // Through valuesOf, so a pre-split approved panel's serving halves are read
  // out of its label rather than reported as a change (D-173).
  const dv = valuesOf(draftPanel || {});
  const av = valuesOf(approvedPanel || {});
  for (const field of Object.keys(PANEL_VALUE_FIELDS)) {
    const d = dv[field] ?? null;
    const a = av[field] ?? null;
    if (!same(d, a)) out.push({ field, label: FIELD_LABEL[field], approved: a, draft: d });
  }
  return out;
}
