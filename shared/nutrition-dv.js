// % Daily Value, recomputed from the amount the panel itself declares.
//
// THE CHECK THE PROOFING TOOL CANNOT DO. A label can be compared against
// itself for arithmetic — calories against macros, servings against net
// weight — and that catches a panel that contradicts itself. It is blind to
// the panel where every number is internally consistent and every number
// belongs to a different product, which is how a 38-SKU bottle run produced
// 13 nutrition errors and only 5 of them were visible to the arithmetic.
//
// A declared %DV is the one number on a panel that is DERIVED from another
// number on the same panel, so it can be checked here with no second source:
//
//     Saturated Fat 0g ......... 5%     zero grams cannot be 5% of anything
//     Sodium 570mg ............ 21%     computes to 25%
//     Dietary Fiber <1g ........ 8%     computes to 4%
//
// All three are in artwork right now. Catching them at approval stops them
// before they reach every pack drawn against the panel.
//
// PURE — amounts in, mismatches out. No Express, no database. The number the
// plant is going to argue with a printer about should be checkable without
// standing a server up, the same doctrine as partner-recon.js and
// coa-submission.js.
//
// IN shared/ BECAUSE BOTH SIDES RUN IT. The server decides — the approval gate
// is enforced in `decide()` and nowhere else — and the browser runs the same
// function to show the computed figure beside the box as somebody types it,
// which is the moment a wrong %DV is cheapest to fix. One definition, two
// callers, the same arrangement `shared/rich-markup.js` has. A second copy in
// the client is how the form and the gate start disagreeing, and the first
// sign of the disagreement would be a refusal nobody could explain.

/**
 * FDA Daily Values, adults and children 4+ (21 CFR 101.9(c)(8)(iv) and (c)(9)).
 *
 * NOT user-editable, and not in the app's settings — these are a published
 * regulatory reference, not this plant's decision, the same line
 * `scale-forms.js` tolerances draw. A DV that moves is a rule change, and it
 * goes in this file with a date.
 */
export const DAILY_VALUES = {
  total_fat: { dv: 78, unit: 'g', kind: 'macro' },
  saturated_fat: { dv: 20, unit: 'g', kind: 'macro' },
  cholesterol: { dv: 300, unit: 'mg', kind: 'macro' },
  sodium: { dv: 2300, unit: 'mg', kind: 'macro' },
  total_carbohydrate: { dv: 275, unit: 'g', kind: 'macro' },
  dietary_fiber: { dv: 28, unit: 'g', kind: 'macro' },
  added_sugars: { dv: 50, unit: 'g', kind: 'macro' },
  vitamin_d: { dv: 20, unit: 'mcg', kind: 'micro' },
  calcium: { dv: 1300, unit: 'mg', kind: 'micro' },
  iron: { dv: 18, unit: 'mg', kind: 'micro' },
  potassium: { dv: 4700, unit: 'mg', kind: 'micro' },
};

/** The label each mismatch is reported under — the panel's own wording. */
export const NUTRIENT_LABEL = {
  total_fat: 'Total Fat', saturated_fat: 'Saturated Fat', cholesterol: 'Cholesterol',
  sodium: 'Sodium', total_carbohydrate: 'Total Carbohydrate', dietary_fiber: 'Dietary Fiber',
  added_sugars: 'Added Sugars', vitamin_d: 'Vitamin D', calcium: 'Calcium',
  iron: 'Iron', potassium: 'Potassium',
};

/**
 * An amount as the panel writes it.
 *
 * `<1` and `<5` are real panel values, not sloppy data entry — 21 CFR 101.9
 * requires them below certain thresholds — so they are STORED as written and
 * read here as their numeric BOUND. What that makes possible is a one-sided
 * check: the true amount is somewhere below the bound, so the true %DV is
 * somewhere at or below the bound's %DV, and anything higher than that is
 * wrong whatever the real figure is.
 *
 * Returns `{ value, bounded }`, or null when there is no number to read at
 * all — a blank is a gap, never a zero. Reading a missing amount as 0 would
 * make every unfilled panel declare itself 0% compliant, which is the
 * fabricated-record refusal in a smaller hat.
 */
export function readAmount(raw) {
  if (raw === null || raw === undefined || raw === '') return null;
  if (typeof raw === 'number') return Number.isFinite(raw) ? { value: raw, bounded: false } : null;
  const s = String(raw).trim();
  if (!s) return null;
  const bounded = /^</.test(s);
  // Strip the comparator and any unit somebody typed alongside the number.
  const digits = s.replace(/^[<≤]\s*/, '').replace(/[^0-9.-]/g, '');
  // A WORD IS NOT A ZERO. Number('') is 0 and finite, so stripping the
  // non-digits out of "n/a" and handing the result to Number() reads a note
  // somebody typed as a declared nothing — and then every %DV beside it looks
  // like a mismatch against an amount the panel never gave.
  if (!/\d/.test(digits)) return null;
  const n = Number(digits);
  if (!Number.isFinite(n)) return null;
  return { value: n, bounded };
}

/**
 * Round a computed percentage the way the FDA prints it.
 *
 * THIS IS WHERE THE TRAP IS, and it is the whole reason this module has its
 * own tests. Macronutrients round to the nearest whole percent; vitamins and
 * minerals round in INCREMENTS (21 CFR 101.9(c)(8)(iii)):
 *
 *     ≤ 10%        → nearest 2%
 *     > 10% ≤ 50%  → nearest 5%
 *     > 50%        → nearest 10%
 *
 * Calcium 150 mg computes to 11.5%, which under the mineral rule is **10%**,
 * not 12%. Applying the macronutrient rule to minerals flags almost every
 * correct panel on this line as wrong — a warning that fires on good panels
 * is one people learn to dismiss, which costs more than the check is worth.
 */
export function roundDv(pct, kind = 'macro') {
  if (!Number.isFinite(pct)) return null;
  if (kind !== 'micro') return Math.round(pct);
  // The band is decided on the RAW percentage, before any rounding: 10.4%
  // is "over 10" and rounds to the nearest 5 (10), not to the nearest 2.
  const step = pct <= 10 ? 2 : pct <= 50 ? 5 : 10;
  return Math.round(pct / step) * step;
}

/** The %DV this amount computes to, already rounded. */
export function computeDv(nutrient, amount) {
  const rule = DAILY_VALUES[nutrient];
  const read = readAmount(amount);
  if (!rule || !read) return null;
  const raw = (read.value / rule.dv) * 100;
  return { ...read, raw, pct: roundDv(raw, rule.kind), rule };
}

/**
 * Every declared %DV that does not match its own amount.
 *
 * Reported, NEVER corrected. A panel is a regulatory document and the number
 * on it may be right for a reason this code cannot see — a rounding convention
 * the formulator applied, an amount typed into ReadyDoc differently from the
 * artwork. So this says what it computed and leaves the decision with the
 * person approving, the same standing `compareManualToTasks` has.
 *
 * A nutrient with no amount, or no declared %DV, produces NOTHING. An
 * incomplete panel is a gap somebody fills in; flagging every blank row as a
 * mismatch would bury the three that are real.
 */
export function checkDailyValues(panel = {}) {
  const out = [];
  for (const [nutrient, rule] of Object.entries(DAILY_VALUES)) {
    const amountKey = `${nutrient}_${rule.unit === 'g' ? 'g' : rule.unit}`;
    const amount = panel[amountKey];
    const declaredRaw = panel[`${nutrient}_dv`];
    if (declaredRaw === null || declaredRaw === undefined || declaredRaw === '') continue;
    const declared = Number(String(declaredRaw).replace(/[^0-9.-]/g, ''));
    if (!Number.isFinite(declared)) continue;
    const computed = computeDv(nutrient, amount);
    if (!computed) {
      out.push({
        nutrient, label: NUTRIENT_LABEL[nutrient], amount: amount ?? null,
        declared_dv: declared, computed_dv: null,
        note: `${NUTRIENT_LABEL[nutrient]} declares ${declared}% with no amount on the panel.`,
      });
      continue;
    }
    // A BOUNDED AMOUNT IS A CEILING, NOT AN EQUALITY. "<1 g" of fibre is
    // somewhere below 1 g, so anything at or under the bound's %DV is
    // consistent with it and only a HIGHER figure is provably wrong.
    //
    // AND A VITAMIN OR MINERAL UNDER 2% MAY BE DECLARED AS ZERO
    // (21 CFR 101.9(c)(8)(iii)). Iron at 0.3 mg is 1.67% of the DV, which the
    // increment rule rounds UP to 2% — so without this, a correctly formatted
    // panel declaring 0% gets flagged. The second false positive of exactly
    // the kind the calcium case is the warning about, and the panel it fires
    // on is the one in the contract this was written against.
    const mayBeZero = rule.kind === 'micro' && computed.raw < 2 && declared === 0;
    const ok = mayBeZero || (computed.bounded ? declared <= computed.pct : declared === computed.pct);
    if (ok) continue;
    out.push({
      nutrient,
      label: NUTRIENT_LABEL[nutrient],
      amount: amount ?? null,
      declared_dv: declared,
      computed_dv: computed.pct,
      bounded: computed.bounded,
      note: computed.bounded
        ? `${NUTRIENT_LABEL[nutrient]} ${amount} is at most ${computed.pct}% of the ${rule.dv}${rule.unit} Daily Value; the panel declares ${declared}%.`
        : computed.value === 0
          ? `${NUTRIENT_LABEL[nutrient]} is ${amount} — zero cannot be ${declared}% of anything.`
          : `${NUTRIENT_LABEL[nutrient]} ${amount} computes to ${computed.pct}% of the ${rule.dv}${rule.unit} Daily Value; the panel declares ${declared}%.`,
    });
  }
  return out;
}
