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
 * THE ANSWER IS PASS OR FAIL, because that is what the form asks for.
 *
 * An earlier cut of this required a ppm number and graded it against the range.
 * Reading the plant's own filled-in logbooks settled it: the "Result ppm"
 * column is a printed *Pass / Fail* that gets circled, and across fourteen
 * pages of three years' records not one number was ever written. Requiring one
 * would have asked the floor on Monday for something they have never recorded.
 * (User decision, 2026-08-13: match the paper.)
 *
 * `min`/`max` are KEPT even though nothing is graded on them. They are the
 * acceptance criteria printed at the top of the form, they are what the
 * operator is checking the strip against, and the screen shows them — a target
 * the person cannot see is not a target.
 *
 * The reading stays OPTIONAL: the column is headed "Result ppm", so somewhere
 * to put the number belongs on the form. When one IS volunteered it is
 * cross-checked, and a number outside the range cannot be filed as a pass —
 * that is the one control worth keeping, and it costs nothing when the box is
 * left empty, which is the normal case.
 *
 * `value` is `{ confirmed, reading }`; a bare value is read as the
 * confirmation, so older callers keep working.
 *
 * Returns `{ result, reason }` where result is 'pass' | 'fail' | null. NULL IS
 * NOT A FAIL — an unanswered check is a gap in the record, not an out-of-range
 * dilution, and filing it as a failure would raise an investigation into
 * something nobody looked at.
 */
export function gradeDilution(form, value) {
  if (!form) return { result: null, reason: 'Unknown dilution' };

  const v = (value && typeof value === 'object') ? value : { confirmed: value };
  const yes = v.confirmed === 'yes' || v.confirmed === true || v.confirmed === 'pass';
  const no = v.confirmed === 'no' || v.confirmed === false || v.confirmed === 'fail';
  if (!yes && !no) return { result: null, reason: 'Not answered' };

  const within = isMeasured(form) ? `verified ${form.target}` : `mixed to ${form.target}`;
  const n = parseFloat(String(v.reading ?? '').replace(/[^0-9.\-]/g, ''));
  const measured = isMeasured(form) && Number.isFinite(n);

  if (yes && measured && (n < form.min || n > form.max)) {
    // The one place the number still overrules the tap. A recorded reading and
    // a circled Pass that disagree is not a record anybody can defend.
    return {
      result: 'fail',
      reason: `${n} ${form.unit} is outside ${form.target} — recorded as a fail despite being marked pass`,
      contradiction: true,
    };
  }
  if (yes) return { result: 'pass', reason: measured ? `${n} ${form.unit}, ${within}` : within };
  return { result: 'fail', reason: measured ? `${n} ${form.unit} — not ${within}` : `not ${within}` };
}
