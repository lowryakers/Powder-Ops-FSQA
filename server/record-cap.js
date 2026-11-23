// How many rows one record type may return to GET /api/records (D-373).
//
// A LOOKUP IS NEVER CAPPED. With a lot, a machine (`equipment`) or a person
// asked, every matching row comes back: a recall that silently stops at the
// newest 500 shifts of a lot is the failure the lookup exists to prevent.
// An unfiltered read stays bounded at MAX_ROWS per type, and the type is
// reported as truncated whenever it hits that bound.
//
// The adapters never decide this themselves. retrieveRecords stamps the row
// count it wants on the query (`_rows`) and every adapter's LIMIT reads it
// through rowLimit(); SQLite reads LIMIT -1 as "no limit".
export const MAX_ROWS = 500;
export const LOOKUP_FILTERS = ['lot', 'equipment', 'person'];

export const isLookup = (q = {}) => LOOKUP_FILTERS.some(f => q[f] != null && String(q[f]).trim() !== '');

/** The cap a caller asked for (never above MAX_ROWS). */
export const requestedCap = (q = {}) => Math.min(Number(q.limit) || MAX_ROWS, MAX_ROWS);

/** The LIMIT an adapter puts on its query. */
export const rowLimit = (q = {}) => (q._rows != null ? q._rows : requestedCap(q));
