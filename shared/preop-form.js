// FORM 117.21 V5 — Production Line Cleaning Log, on the sanitation record (D-125).
//
// The pre-op / changeover clean used to be a DAILY TASK carrying this form's
// questions as a list of ticks — including "ATP Test" and "Allergen Test" as
// boxes to tick beside the swab box that actually takes a reading, and "QA
// sign-off" as a box the CLEANER ticked. Three things wrong with one card. And
// the clean itself is not daily: Protocol 003 V4 says PC #1 is monitored "at the
// beginning of every run", so it happens when a run starts in a room, not when a
// calendar says so (D-009). The daily task is retired; the clean is filed on the
// Sanitation record when it is done, and THIS is the checklist that record asks.
//
// THE WORDING IS THE FORM'S, transcribed from the checklist template in
// cleaning-seed.js ("Production Line Cleaning Log", Form 117.21, Rev V5), which
// is itself the paper form. A change to what is asked is a Document Change
// Request, the scale-forms.js rule — do not tidy it here.
//
// Three of the paper form's boxes are fields the record already has, and are
// NOT asked twice: "Room number" is the record's AREA, "Did the cleaning Pass?"
// is its RESULT, and ATP swab 1's result is `atp_reading`, graded against
// PC #1's 35 RLU by atp-limits.js. The paper asks "pass or no pass" for an ATP
// swab; the app takes the RLU number and the limit decides, which is stricter
// and is what the plan says.
//
// NOTHING HERE GATES A FILING. A blank answer is a gap in the record, not a
// failure (D-020) — the same rule the swab box on the task follows. What the
// swabs CAN do is fail a clean, never pass one (atp-limits.js rule 2): an
// over-limit reading on either ATP swab, or an allergen swab marked "no pass",
// stores the record as `fail`. That asymmetry is applied on the server.
//
// Pure, and in shared/, because the form that renders it and the route that
// stores it must read one list.

import { isRoomToken } from './rooms.js';

export const PREOP_FORM = {
  code: 'Form 117.21',
  revision: 'V5',
  title: 'Production Line Cleaning Log',
};

export const PREOP_SETUP = [
  { key: 'product_name', label: 'Product name' },
  { key: 'wo_lot', label: 'Work Order / Lot number' },
];

export const PREOP_ALLERGENS = ['Milk', 'Nuts', 'Wheat', 'Gluten Free', 'Other'];

export const PREOP_CLEAN_LEVELS = [
  { value: 'partial', label: 'Partial clean #1' },
  { value: 'full', label: 'Full clean #2' },
];

/** The Cleaning Verification section's yes / no / N/A questions, verbatim. */
export const PREOP_CHECKS = [
  { key: 'materials_removed', label: 'Are all materials and packaging components removed from previous run?' },
  { key: 'knives', label: 'Visual inspection of all knives (no snap off blades allowed)' },
  { key: 'glass_plastic', label: 'Visual inspection of all glass (N/A), plastic, light covers, totes, machine doors, elbow joints on limbs, pallets, etc.' },
  { key: 'wipe_down', label: 'Wipe down equipment/product-contact surfaces with clean towels to remove any powder or residue' },
  { key: 'sanitizer', label: 'Clean all surfaces with sanitizer, letting it sit for more than 60 seconds to remove all contamination' },
];

export const YES_NO_NA = [
  { value: 'yes', label: 'Yes' },
  { value: 'no', label: 'No' },
  { value: 'na', label: 'N/A' },
];

export const CONDITIONS = ['Good', 'Poor'];

export const SWAB_RESULTS = [
  { value: 'pass', label: 'Pass' },
  { value: 'no_pass', label: 'No pass' },
];

/** The paper form has two lines for each test. */
export const SWAB_LINES = 2;

/**
 * Does this record carry Form 117.21?
 *
 * A pre-op clean of a production room — the same area rule clean-swabs.js uses
 * to decide that a clean owes an ATP swab, so the two cannot disagree about
 * which cleans are production. The restroom's pre-op clean is not this form.
 */
export function preopApplies(type, area) {
  const a = String(area ?? '').trim();
  return type === 'pre_op' && (a === 'Production' || isRoomToken(a));
}

const text = (v) => {
  const s = String(v ?? '').trim();
  return s ? s.slice(0, 200) : null;
};

/**
 * Normalise what a form posted into what is stored.
 *
 * Unknown keys are dropped; an answer that is not one of the form's own options
 * is REFUSED by name rather than stored or silently dropped — a stored value no
 * screen can render is a record that reads as blank. Returns `form: null` when
 * nothing at all was answered, so an untouched section stores nothing.
 */
export function normalizePreopForm(raw) {
  const errors = [];
  let src = raw;
  if (typeof src === 'string') {
    try { src = JSON.parse(src); } catch { return { form: null, errors: ['Form 117.21 answers could not be read.'] }; }
  }
  if (src == null) return { form: null, errors };
  if (typeof src !== 'object' || Array.isArray(src)) return { form: null, errors: ['Form 117.21 answers must be an object.'] };

  const oneOf = (value, options, label) => {
    const v = text(value);
    if (v == null) return null;
    if (!options.includes(v)) { errors.push(`"${v}" is not an answer to "${label}".`); return null; }
    return v;
  };

  const form = {};
  for (const f of PREOP_SETUP) form[f.key] = text(src[f.key]);
  form.allergens = Array.isArray(src.allergens)
    ? [...new Set(src.allergens.map(text).filter(Boolean))].filter(a => {
      if (PREOP_ALLERGENS.includes(a)) return true;
      errors.push(`"${a}" is not one of the allergens on the form.`);
      return false;
    })
    : [];
  form.clean_level = oneOf(src.clean_level, PREOP_CLEAN_LEVELS.map(l => l.value), 'Partial clean #1 or Full clean #2?');
  form.checks = {};
  for (const c of PREOP_CHECKS) form.checks[c.key] = oneOf(src.checks?.[c.key], YES_NO_NA.map(o => o.value), c.label);
  form.asset_tag = text(src.asset_tag);
  form.condition = oneOf(src.condition, CONDITIONS, 'Condition (Good/Poor)');

  // ATP swab 1's reading is the record's own `atp_reading`; the form keeps only
  // where it was taken. Swab 2 carries its reading here and is graded the same.
  form.atp = [];
  for (let i = 0; i < SWAB_LINES; i++) {
    const s = (Array.isArray(src.atp) ? src.atp[i] : null) || {};
    const line = { location: text(s.location), swab_no: text(s.swab_no) };
    if (i > 0) {
      const r = s.reading;
      if (r === null || r === undefined || String(r).trim() === '') line.reading = null;
      else if (!Number.isFinite(Number(r))) { errors.push(`ATP swab ${i + 1}: "${r}" is not a reading in RLU.`); line.reading = null; }
      else line.reading = Number(r);
    }
    form.atp.push(line);
  }
  form.allergen = [];
  for (let i = 0; i < SWAB_LINES; i++) {
    const s = (Array.isArray(src.allergen) ? src.allergen[i] : null) || {};
    form.allergen.push({
      location: text(s.location), swab_no: text(s.swab_no),
      result: oneOf(s.result, SWAB_RESULTS.map(o => o.value), `Allergen Test — Result ${i + 1}`),
    });
  }

  return { form: preopIsEmpty(form) ? null : form, errors };
}

/** True when not one answer was given. */
export function preopIsEmpty(form) {
  if (!form) return true;
  const vals = [
    ...PREOP_SETUP.map(f => form[f.key]), form.clean_level, form.asset_tag, form.condition,
    ...Object.values(form.checks || {}),
    ...(form.atp || []).flatMap(s => [s.location, s.swab_no, s.reading]),
    ...(form.allergen || []).flatMap(s => [s.location, s.swab_no, s.result]),
  ];
  return !(form.allergens || []).length && vals.every(v => v == null || v === '');
}

/** A stored column (JSON text) back to an object; null when there is none. */
export function parsePreopForm(stored) {
  if (!stored) return null;
  if (typeof stored === 'object') return stored;
  try { return JSON.parse(stored); } catch { return null; }
}

/** The allergen swabs marked "no pass" — each one fails the clean. */
export function allergenFailures(form) {
  return (form?.allergen || [])
    .map((s, i) => ({ ...s, line: i + 1 }))
    .filter(s => s.result === 'no_pass');
}
