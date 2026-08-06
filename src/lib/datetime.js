/**
 * Turning a stored timestamp into the time it actually happened.
 *
 * THE BUG THIS EXISTS TO FIX. SQLite's `datetime('now')` — which is what most
 * of the schema defaults to — returns UTC in the form `2026-08-06 19:27:43`:
 * a space instead of a T, and no timezone marker at all. JavaScript does not
 * treat that as ISO, so `new Date('2026-08-06 19:27:43')` parses it as LOCAL
 * time. In Utah (UTC−6 in summer) a record written at 1:27pm was therefore
 * displayed as 7:27pm — six hours late, on audit entries and scale
 * verifications alike. The value in the database was always right; only the
 * reading of it was wrong.
 *
 * Three shapes arrive here and all three have to work:
 *   `2026-08-06 19:27:43`      SQLite datetime('now') — UTC, needs the Z
 *   `2026-08-06T19:27:43.123Z` new Date().toISOString() — already unambiguous
 *   `2026-08-06`               a date column — see below
 *
 * A DATE-ONLY VALUE IS DELIBERATELY READ AS LOCAL MIDNIGHT. `new Date('2026-08-06')`
 * is UTC midnight, which west of Greenwich renders as the previous evening —
 * that is the classic "everything is a day early" bug, and a due date that
 * displays as the wrong day is worse than one that displays in the wrong hour.
 */

const SQLITE_DATETIME = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2}(\.\d+)?)?$/;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** A stored timestamp → a Date at the instant it really happened, or null. */
export function parseServerTime(value) {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const s = String(value).trim();
  if (!s) return null;

  // SQLite's space-separated UTC. Give it the marker it is missing.
  if (SQLITE_DATETIME.test(s)) {
    const d = new Date(`${s.replace(' ', 'T')}Z`);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  // A bare date is a calendar day, not an instant — keep it on its own day.
  if (DATE_ONLY.test(s)) {
    const [y, m, day] = s.split('-').map(Number);
    return new Date(y, m - 1, day);
  }
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

const fmt = (value, opts, fallback) => {
  const d = parseServerTime(value);
  return d ? d.toLocaleString(undefined, opts) : fallback;
};

/** "8/6/2026, 1:27 PM" — the everyday one. */
export const formatDateTime = (value, fallback = '—') =>
  fmt(value, { dateStyle: 'short', timeStyle: 'short' }, fallback);

/** "8/6/2026" */
export const formatDate = (value, fallback = '—') => {
  const d = parseServerTime(value);
  return d ? d.toLocaleDateString() : fallback;
};

/** "1:27 PM" */
export const formatTime = (value, fallback = '—') =>
  fmt(value, { timeStyle: 'short' }, fallback);

/** "Aug 6, 2026, 1:27 PM" — for record headers where the month reads better. */
export const formatLongDateTime = (value, fallback = '—') =>
  fmt(value, { dateStyle: 'medium', timeStyle: 'short' }, fallback);
