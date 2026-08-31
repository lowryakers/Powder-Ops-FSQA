/**
 * How a room is written when a person reads it.
 *
 * The schedule stores a room as the bare token the grid is keyed on — "6",
 * "1.2", "Batching 1", "15". That is right for a lookup and wrong for a
 * sentence: a message that says "• 6 · MO 4471" makes the reader work out that
 * 6 is a room at all.
 *
 * In `shared/` because BOTH sides need it and they had drifted — the client's
 * Share text and PNG already labelled rooms, while the server's Notify message,
 * which is the one that actually lands in people's channels, printed the raw
 * token. Two copies of a display rule is how that happens.
 *
 * Batching rooms carry their own word already ("Batching 1"), so prefixing
 * would give "Room Batching 1". Kitting's room 15 is genuinely a room and reads
 * correctly as one.
 */
export function roomLabel(room) {
  const s = String(room ?? '').trim();
  if (!s) return '';
  return /batching/i.test(s) ? s : `Room ${s}`;
}

/**
 * The rooms roomLabel() is allowed to prefix.
 *
 * Kept here rather than imported from constants/productionLines.js because
 * `shared/` is loaded by the server too and must not reach into the client
 * tree. It is the same set, deliberately including the retired room: a record
 * filed against Room 8 still has to read as "Room 8" forever.
 */
const ROOM_TOKENS = new Set([
  // '0' is retired (FORM 431-01 V5 has no Room 0) but stays here: the entry
  // filed against it must still read "Room 0", not a bare 0, forever.
  '0', '1', '1.2', '2', '3', '4', '4.1', '4.2', '5', '6', '7', '8', '15',
  'Batching 1', 'Batching 2', 'Batching 3',
]);

/**
 * How a sanitation AREA is written when a person reads it.
 *
 * The sanitation log stores the same token the Production Log and the schedule
 * store — it has to, or the 72-hour rule joins a clean of "Room 7" against a
 * run in "7" and finds neither. But a table cell reading just "7" is not a
 * sentence, and the log's other areas ("Restrooms", "Warehouse & Grounds") are
 * not rooms and must never come out as "Room Restrooms".
 *
 * So: a known room token gets the label, everything else passes through as
 * written. Pure, so the picker, the log rows and the re-clean list all render
 * one area name the same way without any of them fetching a list to do it.
 */
export function areaLabel(area) {
  const s = String(area ?? '').trim();
  return ROOM_TOKENS.has(s) ? roomLabel(s) : s;
}

/**
 * The inverse: a label as a person reads it, back to the token records store.
 *
 * IT LIVES HERE, NEXT TO `areaLabel`, BECAUSE IT HAS TO ROUND-TRIP. A generated
 * work-order title carries the LABEL ("72h Re-clean — Room 7") — that is the
 * whole reason the title is built with `areaLabel` — but the sanitation record
 * that completing it files must carry the TOKEN ("7"), or the 72-hour rule
 * joins a clean of "Room 7" against a run in "7" and finds neither. That is the
 * failure `areaLabel`'s own note warns about, arrived at from the other side.
 *
 * A leading "Room " is stripped only when what is left is a real token, so an
 * area genuinely called "Room Service" passes through as written rather than
 * becoming "Service".
 */
export function areaToken(label) {
  const s = String(label ?? '').trim();
  if (ROOM_TOKENS.has(s)) return s;
  const m = /^Room\s+(.+)$/i.exec(s);
  return m && ROOM_TOKENS.has(m[1].trim()) ? m[1].trim() : s;
}
