// READS MUST NOT WRITE — and the throttle that makes that practical.
//
// Several modules have a sweep that cannot wait for a restart: a PM schedule
// coming due at 6am has to produce a task that morning, and an instrument whose
// calibration lapsed overnight has to read as overdue today. The lazy answer is
// to run the sweep inside the GET, which is what pm.js used to do and what
// calibration.js was still doing — every task list, every operator refresh and
// every metrics poll paying for a table sweep, and a read mutating the database.
//
// `periodically` is the compromise already proven in pm.js: the sweep runs at
// most once every few minutes, whoever happens to ask first, and a failure is
// logged rather than thrown so a housekeeping problem can never fail the read
// that triggered it.
//
// EXTRACTED rather than copied. A second throttle with its own map and its own
// interval is how two sweeps start disagreeing about how often "periodically"
// is, and the whole point of this file is that there is one answer.

const HOUSEKEEPING_MS = 5 * 60 * 1000;
const lastRunAt = new Map();

/** Run `fn(db)` at most once per HOUSEKEEPING_MS for the given key. */
export function periodically(key, fn, db) {
  const now = Date.now();
  if (now - (lastRunAt.get(key) || 0) < HOUSEKEEPING_MS) return;
  lastRunAt.set(key, now);
  try { fn(db); } catch (e) { console.warn(`[housekeeping] ${key} skipped:`, e.message); }
}

/** Clear the throttle so the next call runs immediately (startup, tests). */
export function resetHousekeeping(key) {
  if (key) lastRunAt.delete(key); else lastRunAt.clear();
}
