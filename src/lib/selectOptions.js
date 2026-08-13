/**
 * A <select> must never silently rewrite what is stored in a record.
 *
 * THE TRAP: a `<select>` whose `value` is not among its `<option>`s does not
 * error and does not render blank — the browser selects the FIRST option. So
 * opening an old record to fix a typo in its notes and pressing Save moves the
 * field to whatever happens to be listed first, with no warning, and the audit
 * trail records it as a deliberate change by that person.
 *
 * This has now bitten three times, and each fix was narrower than the problem:
 *   • Room 8 was retired, so `RETIRED_ROOMS` was added to the amend form —
 *     which left "0", "1 & 8" and "Other" (six real entries) still silently
 *     reassigned to Batching 1.
 *   • BPG zone types were missing from the equipment dropdown, so opening a
 *     zone and saving retyped it "A/C". Fixed by adding the zone types.
 *   • Calibration's status select keeps 'overdue' "while it is the current
 *     value" — the right instinct, hand-applied to one field.
 *
 * The general rule is the one thing all three wanted: WHATEVER THE RECORD
 * HOLDS IS ALWAYS AN OPTION. A value that is no longer offered for NEW records
 * still has to be selectable on the record that already has it, or the form
 * cannot faithfully re-save what it just displayed.
 *
 * `keepCurrent` handles both option shapes in this codebase — plain strings and
 * `{ value, label }` — and appends nothing when the value is blank or already
 * present, so it is safe to wrap any select unconditionally.
 */

/**
 * @param {Array<string|{value:string,label?:string}>} options - what is offered for a NEW record
 * @param {*} value - what this record currently holds
 * @param {{suffix?: string}} [opts] - text appended to the added option's label
 * @returns the same options, plus the current value if it was missing
 */
export function keepCurrent(options, value, { suffix = ' (no longer offered)' } = {}) {
  const list = Array.isArray(options) ? options : [];
  if (value === null || value === undefined || value === '') return list;
  const v = String(value);

  const objectShaped = list.some(o => o && typeof o === 'object');
  const present = list.some(o => String(o && typeof o === 'object' ? o.value : o) === v);
  if (present) return list;

  // Appended, not prepended: the offered values stay where people expect them,
  // and the odd one out reads as the exception it is.
  return objectShaped
    ? [...list, { value: v, label: `${v}${suffix}` }]
    : [...list, v];
}

/** True when this record holds something the form would not offer today. */
export function isRetiredValue(options, value) {
  if (value === null || value === undefined || value === '') return false;
  const v = String(value);
  return !(Array.isArray(options) ? options : [])
    .some(o => String(o && typeof o === 'object' ? o.value : o) === v);
}
