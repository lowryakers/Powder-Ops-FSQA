/**
 * A-100-#### — the warehouse's own inspection number, issued from ONE place.
 *
 * An inspection number is claimed by whichever record reaches the delivery
 * first, and that is now three different tables:
 *
 *   • the QA film/pouch inspection (FORM 418-01), which happens BEFORE the
 *     warehouse receives packaging at all;
 *   • the receiving inspection checklist (FORM 204-01), worked at the truck;
 *   • the receiving log lines themselves, keyed in afterwards.
 *
 * Counting fewer than all of them hands the same number to the next truck —
 * which is exactly the bug the checklist introduced when it began claiming
 * numbers and `nextInspectionNo` still counted only the log. Extracted rather
 * than copied for that reason: a second counter reading two tables while the
 * first reads three is how the collision comes back.
 *
 * Zero-padded to 4 and it keeps counting past 9999 rather than wrapping.
 */

export const INSPECTION_PREFIX = 'A-100-';

const SOURCES = [
  'SELECT inspection_no FROM receiving_log WHERE inspection_no LIKE ?',
  'SELECT inspection_no FROM receiving_checklists WHERE inspection_no LIKE ?',
  'SELECT inspection_no FROM film_pouch_inspections WHERE inspection_no LIKE ?',
];

export function nextInspectionNo(db) {
  let max = 0;
  for (const sql of SOURCES) {
    for (const r of db.prepare(sql).all(`${INSPECTION_PREFIX}%`)) {
      const n = Number(String(r.inspection_no).slice(INSPECTION_PREFIX.length));
      if (Number.isFinite(n) && n > max) max = n;
    }
  }
  return INSPECTION_PREFIX + String(max + 1).padStart(4, '0');
}
