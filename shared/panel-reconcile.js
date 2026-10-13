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
  serving_size: 'Serving size', servings_per_container: 'Servings per container', calories: 'Calories',
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

/** Fill weight: serving grams × servings vs the product's fill weight, ±5%. */
export function fillCheck(panel, fillWeightG) {
  const grams = servingGrams(panel?.serving_size_desc ?? panel?.serving_size_g);
  const servings = amountSpan(panel?.servings_per_container);
  const fill = Number(fillWeightG);
  if (!grams || !servings || servings[0] !== servings[1] || !(fill > 0)) {
    const missing = [];
    if (!grams) missing.push('serving size in grams');
    if (!servings || servings[0] !== servings[1]) missing.push('servings per container');
    if (!(fill > 0)) missing.push('fill weight in Products');
    return { key: 'fill_weight', label: 'Fill weight', status: 'not_checked',
      message: `Not checked — no ${missing.join(', ')}.` };
  }
  const total = grams.mid * servings[0];
  const off = (total - fill) / fill;
  const ok = Math.abs(off) <= FILL_TOLERANCE + 1e-9;
  const servingText = grams.low === grams.high ? `${grams.mid} g` : `${grams.low}–${grams.high} g (midpoint ${grams.mid} g)`;
  return {
    key: 'fill_weight', label: 'Fill weight', status: ok ? 'ok' : 'warn',
    serving_g: grams.mid, servings: servings[0], computed_g: r1(total), fill_weight_g: fill,
    off: Math.round(off * 1000) / 1000,
    message: `${servingText} × ${servings[0]} servings = ${r1(total)} g against a fill weight of ${fill} g `
      + `(${off >= 0 ? '+' : ''}${pct(off)}; allowed ±${pct(FILL_TOLERANCE)}).`,
    fingerprint: JSON.stringify(['fill', grams.mid, servings[0], fill]),
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
export function reconcile(panel, { fillWeightG } = {}) {
  return [fillCheck(panel || {}, fillWeightG), calorieCheck(panel || {})];
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
  for (const [field, col] of Object.entries(PANEL_VALUE_FIELDS)) {
    const d = draftPanel?.[col] ?? null;
    const a = approvedPanel?.[col] ?? null;
    if (!same(d, a)) out.push({ field, label: FIELD_LABEL[field], approved: a, draft: d });
  }
  return out;
}
