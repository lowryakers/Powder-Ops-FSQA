/**
 * THE PLANT'S CLOCK, on a server that runs in UTC.
 *
 * Nothing sets TZ on the container, so `new Date().getHours()` and SQLite's
 * `date('now')` both answer in UTC. Most of the app never notices, because a
 * record is stamped in UTC and rendered through `src/lib/datetime.js`, which
 * converts on the way out. "Today" is the exception: a question asked on the
 * server, in the plant's day, about rows stamped in UTC.
 *
 * The Scale Verification status derived "today" with `date(performed_at) =
 * date('now')`. In Utah that flips at 6pm: a check run at 7am read as
 * "Not checked today" from 6pm onward, and would have raised a not-done
 * prompt on the evening shift for a check that was done. The plant's day is
 * the plant's day.
 *
 * One definition. `PLANT_TZ` is an env override with the plant's zone as the
 * default — it is a fact about where the building is, not a preference.
 */
export const PLANT_TZ = process.env.PLANT_TZ || 'America/Denver';

/**
 * A stored timestamp → Date. SQLite's `datetime('now')` writes
 * `YYYY-MM-DD HH:MM:SS` in UTC with no zone marker, which JavaScript would
 * read as LOCAL time — the same six-hour trap `src/lib/datetime.js` closes on
 * the client, closed the same way here. An ISO string with a zone is left
 * alone; a bare date is midnight UTC (callers asking for a plant day should
 * not be passing bare dates).
 */
export function parseServerTime(value) {
  if (value == null || value === '') return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const s = String(value).trim();
  const m = s.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?)$/);
  const d = m ? new Date(`${m[1]}T${m[2]}Z`) : new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

const dayFmt = new Intl.DateTimeFormat('en-CA', { timeZone: PLANT_TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
const hourFmt = new Intl.DateTimeFormat('en-US', { timeZone: PLANT_TZ, hour: 'numeric', hourCycle: 'h23' });
const weekdayFmt = new Intl.DateTimeFormat('en-US', { timeZone: PLANT_TZ, weekday: 'short' });

/** `YYYY-MM-DD` in the plant's zone for a stored timestamp (or now). */
export function plantDateOf(value = new Date()) {
  const d = value instanceof Date ? value : parseServerTime(value);
  return d ? dayFmt.format(d) : null;
}

/** 0–23 in the plant's zone. */
export function plantHour(now = new Date()) {
  return Number(hourFmt.format(now));
}

/** True Monday–Friday in the plant's zone. */
export function plantWeekday(now = new Date()) {
  return !['Sat', 'Sun'].includes(weekdayFmt.format(now));
}

const partsFmt = new Intl.DateTimeFormat('en-US', {
  timeZone: PLANT_TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
});

/**
 * A Date whose LOCAL fields read the plant's wall clock (D-124).
 *
 * The scheduler asks "is it Monday", "is it past 06:00", "which week is it" and
 * "what is today" with getDay / getHours / getDate — and the container runs in
 * UTC with nothing setting TZ, so the 06:00 digests went out at midnight
 * Mountain and Monday's began on Sunday evening. Built from the plant's parts
 * with the local constructor, so its local fields are the plant's whatever
 * zone the process runs in. For gates and labels ONLY: never store it or
 * subtract it from a real instant — elapsed time uses the real `now`.
 */
export function plantWallClock(now = new Date()) {
  const p = Object.fromEntries(partsFmt.formatToParts(now).map(x => [x.type, x.value]));
  return new Date(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
}
