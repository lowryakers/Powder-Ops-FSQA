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
