// The levels a Batching clean can be filed at — ONE definition, both sides.
//
// This list lived in three places: a LEVELS array in server/api/production.js
// that decides what is accepted, and two hand-written <option> lists (the EOD
// entry form and the running day log). Adding a level meant remembering all
// three, and a level added to only the form would have been silently discarded
// on save — the operator picks it, the record does not carry it. Same rule as
// shared/rooms.js and shared/equipment-types.js.
//
// WHETHER A SWAB IS EXPECTED IS PART OF THE LEVEL, and that is the point of
// this file rather than a bare array of strings.
//
// A Full Clean with no ATP swab recorded is a gap in the record. The Thursday
// end-of-week clean with no ATP swab is CORRECT — that clean does not call for
// one, because the room is not run again until Monday and by then the 72-hour
// rule has raised a re-clean that carries the swabs anyway. Filed as bare
// booleans those two records are identical, so an auditor reading the log (or
// anyone here counting missing swabs later) cannot tell the compliant one from
// the gap. The level now says which it is.
//
// `swabs`:
//   'required' — the level is defined by its swabs; their absence is a gap.
//   'optional' — commonly ATP only; the operator decides and either is normal.
//   'none'     — the level does not call for a swab. Absence is the record
//                being right, not a hole in it.

export const CLEAN_LEVELS = [
  {
    value: 'Full Clean',
    label: 'Full Clean',
    swabs: 'required',
    hint: 'Strip-down. ATP and allergen swabs are part of the clean.',
  },
  {
    // Added because the Thursday clean had nowhere to go. It is not a Full
    // Clean (no swabs) and it is not a Partial Clean (nothing partial about
    // it — it is the whole area, at the end of the week). Filing it as either
    // one misstated it, which is exactly the problem the per-event cleaning
    // list was built to fix at the shift level.
    value: 'End of Week Clean',
    label: 'End of Week Clean',
    swabs: 'none',
    hint: 'The Thursday clean. No swab is taken — the room is not run again '
      + 'until Monday, and the 72-hour rule raises a re-clean with swabs before it is.',
  },
  {
    value: 'Partial Clean',
    label: 'Partial Clean',
    swabs: 'optional',
    hint: 'A changeover or between-run clean. Usually an ATP swab.',
  },
];

// What the server will accept. Derived from the list above so the two can
// never disagree — the reason this file exists.
export const CLEAN_LEVEL_VALUES = CLEAN_LEVELS.map(l => l.value);

export function cleanLevel(value) {
  return CLEAN_LEVELS.find(l => l.value === value) || null;
}

/**
 * Does this level call for a swab?
 *
 * An unknown level — a record filed before a level was renamed, or one that
 * predates this list — answers 'optional'. That is the honest default: it
 * neither claims the swab was required and missing, nor that it was correctly
 * absent. History is never re-judged by a rule written after it.
 */
export function swabsExpected(level) {
  return cleanLevel(level)?.swabs || 'optional';
}
