/**
 * FORM 106-01 — Chemical Dilution Logbook, V3.
 *
 * The four dilutions the plant verifies daily, with the acceptance criteria
 * transcribed from their own controlled document.
 *
 * NOT USER-EDITABLE, and deliberately so: changing what a dilution must read
 * is a Document Change Request, exactly like the tolerances in
 * `server/scale-forms.js`. `FORM_REVISION` is stamped on every record filed
 * from a check, so a filed record always says which revision it was run
 * against.
 *
 * In `shared/` because BOTH sides need it and must not disagree: the server
 * grades the reading and files the record, and the operator's phone shows the
 * target range and the live pass/fail while they are typing. A second copy of a
 * range is how a screen starts telling somebody a reading passed that the
 * record then files as a fail.
 */

export const FORM_CODE = 'FORM 106-01';
export const FORM_REVISION = 'FORM 106-01 V3';

/**
 * `min`/`max` present ⇒ the reading is a NUMBER and the range decides.
 * Absent ⇒ it is a mixing ratio, confirmed by the person who mixed it.
 *
 * Not every check on this form is a measurement, and pretending otherwise
 * would be worse than admitting it. Sani-512 and chlorine are read off a test
 * strip in ppm. Dawn and Simple Green are mixed to a ratio — there is no
 * instrument and no number, so those ask the operator to confirm the ratio and
 * say so on screen, rather than offering a numeric box that grades nothing.
 */
export const DILUTIONS = [
  {
    key: 'sani512',
    chemical: 'Sani-512 Sanitizer',
    // The name in approved_chemicals, so a record ties back to the registry.
    registry_name: 'Noble Chemical Sani 512',
    min: 200, max: 250, unit: 'ppm',
    method: 'Test strip',
    target: '200–250 ppm',
  },
  {
    key: 'chlorine',
    chemical: 'Chlorine (Cloro)',
    registry_name: 'HE & Standard Washers Bleach',
    min: 100, max: 200, unit: 'ppm',
    method: 'Test strip',
    target: '100–200 ppm',
  },
  {
    key: 'dawn',
    chemical: 'Dawn Professional Heavy Duty',
    registry_name: 'Dawn Professional Heavy Duty',
    unit: null,
    method: 'Mixing ratio',
    target: '1 tsp to 2.5 gal water',
  },
  {
    key: 'simple_green',
    chemical: 'Simple Green',
    registry_name: 'Simple Green',
    unit: null,
    method: 'Mixing ratio',
    target: '1:10 to 1:30',
  },
];

export const DILUTION_BY_KEY = Object.fromEntries(DILUTIONS.map(d => [d.key, d]));

/** Whether the range decides the result, or a person does. */
export const isMeasured = (form) => Number.isFinite(form?.min) && Number.isFinite(form?.max);

/** The schedule/work-order title for one dilution. The seeder writes it and
 *  formFromTitle() reads it back, so the mapping lives in exactly one place. */
export function dilutionTitle(form) {
  return `Chemical Dilution — ${form.chemical}`;
}

/**
 * Which dilution a work order is for, from its title.
 *
 * A task raised from one of these schedules carries the chemical in its name,
 * so the completion form does not have to ask "which chemical?" — the old
 * single lumped task did ask, which is how a check of four chemicals closed
 * having recorded one.
 */
export function formFromTitle(title) {
  const t = String(title || '');
  return DILUTIONS.find(d => t === dilutionTitle(d)) || null;
}

/**
 * The reading decides — never the operator's tap.
 *
 * The paper form has the operator circle out-of-range readings; here the range
 * does it, the same rule `gradeReadings()` follows for the scale forms. It was
 * previously possible to type 300 ppm and press Pass, and the record would say
 * pass.
 *
 * Returns `{ result, reason }` where result is 'pass' | 'fail' | null. NULL IS
 * NOT A FAIL — a blank or unreadable entry is a gap in the record, not an
 * out-of-range dilution, and filing it as a failure would raise an
 * investigation into something nobody measured.
 */
export function gradeDilution(form, value) {
  if (!form) return { result: null, reason: 'Unknown dilution' };

  if (!isMeasured(form)) {
    // A ratio is confirmed, not measured. `value` is the confirmation.
    if (value === 'yes' || value === true || value === 'pass') return { result: 'pass', reason: `Mixed to ${form.target}` };
    if (value === 'no' || value === false || value === 'fail') return { result: 'fail', reason: `Not mixed to ${form.target}` };
    return { result: null, reason: 'Not confirmed' };
  }

  const n = parseFloat(String(value ?? '').replace(/[^0-9.\-]/g, ''));
  if (!Number.isFinite(n)) return { result: null, reason: 'No reading recorded' };
  if (n < form.min) return { result: 'fail', reason: `${n} ${form.unit} is below the ${form.target} range` };
  if (n > form.max) return { result: 'fail', reason: `${n} ${form.unit} is above the ${form.target} range` };
  return { result: 'pass', reason: `${n} ${form.unit} is within ${form.target}` };
}
