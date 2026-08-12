// The sanitation log's area vocabulary, and the rule for folding the free-text
// history onto it.
//
// WHY THIS EXISTS AT ALL: `sanitation_records.area` was a free-text box, so the
// same room was filed under four spellings — "Room 7", "Room 7 (72 HR
// cleaning)", "QA Room", "QA ROOM", "Batching room 2 (72 Hr cleanning)". That
// makes the log unfilterable, but the expensive part is that recleanRooms()
// gets *last use* from `production_entries.room` and *last clean* from
// `sanitation_records.area` and joins them on the string. The Production Log
// stores the bare token `7`. Nobody types `7` into a cleaning form. So a room
// used today and cleaned today came out as TWO rows — one reading "no clean on
// record", one reading "clean" against a room that has never been used — and
// the 72-hour rule could not work on a single production room.
//
// THEREFORE THE CANONICAL VALUE IS THE PRODUCTION-ROOM TOKEN, not the words a
// person would say. `areaLabel()` in shared/rooms.js turns it back into "Room
// 7" for every screen. Storing the readable form here instead would be a third
// vocabulary, which is the problem this fixes.

import { areaLabel } from '../shared/rooms.js';

// Rooms, from ROOM_GROUPS in src/constants/productionLines.js. Room 8 is
// deliberately ABSENT: it is retired (Batching 3 is what runs there), so it is
// never offered on a new record. Records already filed against it keep it and
// still render as "Room 8" — retired, not deleted, the same rule the managed
// lists follow.
const ROOMS = ['1', '1.2', '2', '3', '4', '4.1', '4.2', '5', '6', '7', '15', 'Batching 1', 'Batching 2', 'Batching 3'];

// The non-production zones that have their own cleaning form and PM schedule
// (see cleaning-seed.js). `applicable: false` means the 72-hour production
// re-clean rule does not apply — they are cleaned daily on their own form.
const ZONES = [
  { value: 'Restrooms', applicable: false },
  { value: 'Breakroom, Lobby & Office', applicable: false },
  { value: 'Warehouse & Grounds', applicable: false },
  // Off by the user's decision (2026-08-12): it is cleaned, but it is not a
  // production room and should not raise a 72-hour re-clean task.
  { value: 'QA Room', applicable: false },
];

export const SANITATION_AREAS = [
  ...ROOMS.map(value => ({ value, label: areaLabel(value), applicable: true })),
  ...ZONES.map(z => ({ ...z, label: areaLabel(z.value) })),
];

// Areas that default OFF for the 72-hour rule, as canonical values. Read by
// recleanRooms() so the list and the rule cannot disagree about QA Room.
export const NON_PRODUCTION_AREAS = new Set(SANITATION_AREAS.filter(a => !a.applicable).map(a => a.value));

// A trailing parenthetical that only restates the rule — "(72 HR cleaning)",
// "(72hr cleaning)", "(72 Hr cleanning)". It describes why the clean happened,
// not which room it was in, and the 72-hour status is computed and shown on the
// row anyway. Dropped by the user's decision (2026-08-12).
const RULE_SUFFIX = /\s*\(\s*72\s*-?\s*h(?:r|rs|our|ours)?s?\b[^)]*\)\s*$/i;

const squash = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const key = (s) => squash(s).toLowerCase();

// Every canonical value, plus the spellings seen in the log, keyed for lookup.
// Written out rather than generated: an alias table you can read is one you can
// check against the log, and this one has to be checkable — it decides what
// happens to filed compliance records.
const ALIASES = new Map();
function alias(from, to) { ALIASES.set(key(from), to); }

for (const a of SANITATION_AREAS) {
  alias(a.value, a.value);          // already canonical
  alias(a.label, a.value);          // "Room 7" → "7"
}
// Room 8 is retired but still normalizes, so its history collapses to one name.
alias('8', '8'); alias('Room 8', '8');
// "Batching room 1" — the log's wording for what the schedule calls "Batching 1".
for (const n of ['1', '2', '3']) {
  alias(`Batching room ${n}`, `Batching ${n}`);
  alias(`Batching rm ${n}`, `Batching ${n}`);
}
alias('Restroom', 'Restrooms');
alias('Bathroom', 'Restrooms');
alias('Bathrooms', 'Restrooms');
alias('Breakroom, Lobby and Office', 'Breakroom, Lobby & Office');
alias('Break Room, Lobby & Office', 'Breakroom, Lobby & Office');
alias('Warehouse and Grounds', 'Warehouse & Grounds');
alias('Warehouse/Grounds', 'Warehouse & Grounds');
alias('QA', 'QA Room');
alias('Quality Room', 'QA Room');

/**
 * A filed area string → its canonical value, or null when nothing matches.
 *
 * NULL IS THE IMPORTANT RETURN. Anything this does not recognise is left
 * exactly as filed — a chemical concentration check ("Sanitizer dilution",
 * "Simple Green"), an area nobody has added to the list yet, a typo that could
 * plausibly be two different rooms. Guessing at those would quietly rewrite
 * compliance records onto a room they may not describe, which is worse than a
 * log with a few odd rows in it. Case, spacing and the (72 hr cleaning) suffix
 * are mechanical; everything else has to be in the table above.
 */
export function canonicalArea(raw) {
  const s = squash(raw);
  if (!s) return null;
  const stripped = squash(s.replace(RULE_SUFFIX, ''));
  return ALIASES.get(key(stripped)) || null;
}

/**
 * What normalizing would change, counted, writing nothing.
 *
 * Same preview-then-commit shape as the importers: this rewrites filed
 * compliance records, so the counts go in front of a person first.
 */
export function previewAreaNormalization(db) {
  let rows = [];
  try {
    rows = db.prepare(
      "SELECT area, COUNT(*) AS records FROM sanitation_records WHERE COALESCE(record_group, 'sanitation') = 'sanitation' GROUP BY area"
    ).all();
  } catch { return { changes: [], unchanged: [], unmatched: [], records: 0 }; }

  const changes = [], unchanged = [], unmatched = [];
  for (const r of rows) {
    const to = canonicalArea(r.area);
    if (!to) unmatched.push({ area: r.area, records: r.records });
    else if (to === r.area) unchanged.push({ area: r.area, records: r.records });
    else changes.push({ from: r.area, to, label: areaLabel(to), records: r.records });
  }
  const bySize = (a, b) => b.records - a.records;
  changes.sort(bySize); unchanged.sort(bySize); unmatched.sort(bySize);
  return { changes, unchanged, unmatched, records: changes.reduce((n, c) => n + c.records, 0) };
}
