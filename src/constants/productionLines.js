// Which machine/line a Filling run actually used.
//
// Sticks and Hand Fill used to be separate teams, which meant the equipment a
// run went through was implied by the team name. Merging them into one Filling
// team would have thrown that away, so the line moved here: one team of people,
// a tag per run saying what it ran on. That also leaves room for the machines
// that were never their own team — the two of them were never the whole list.
//
// `legacyTeam` is what the old team column said, and is what the boot migration
// matches on when it back-fills this tag onto historical runs.
export const PRODUCTION_LINES = [
  { value: 'sticks', label: 'Stick Pack', color: '#0891b2', legacyTeam: 'Stick Pack' },
  { value: 'hand_fill', label: 'Hand Fill', color: '#7c3aed', legacyTeam: 'Hand Fill' },
  { value: 'auto_pouch', label: 'Auto Pouch', color: '#0d9488' },
  { value: 'sachet', label: 'Sachet', color: '#c026d3' },
  { value: 'bottling', label: 'Bottling', color: '#ea580c' },
];

export const LINE_VALUES = PRODUCTION_LINES.map(l => l.value);
export const LINE_LABELS = Object.fromEntries(PRODUCTION_LINES.map(l => [l.value, l.label]));
export const LINE_COLORS = Object.fromEntries(PRODUCTION_LINES.map(l => [l.value, l.color]));
export const lineLabel = (v) => LINE_LABELS[v] || '';

// The team those runs now belong to. Kept as a constant so the string isn't
// spelled out in a dozen components.
export const FILLING_TEAM = 'Filling';

// Who files a production entry. The log, the schedule and the day log all offer
// this list, and three copies of it is how one of them ends up missing a team.
export const PRODUCTION_TEAMS = [
  'Batching', 'Filling', 'Kitting', 'Quality', 'Warehouse', 'Sanitation', 'Other',
];

/**
 * The rooms work actually happens in — the facility's vocabulary, in one place.
 *
 * The schedule and the Production Log each used to keep their own list, and
 * they had drifted badly: the schedule had dropped Room 8 and gained Batching 3
 * and the half-rooms (1.2, 4.1, 4.2), while the log was still offering Room 8,
 * had never heard of Batching 3, and listed 0 and 9–14 — rooms nobody schedules.
 * So the same shift could be scheduled in one room and only be reportable in
 * another. One list, imported by both.
 *
 * Grouping is part of the vocabulary (a batching room is not a production
 * room); the colours the schedule paints each group with are not, and stay
 * there. Retiring a room here removes it from new work only — see the Room
 * filter in ProductionLog and `UnplacedAssignments` in ProductionSchedule,
 * which both keep already-filed work reachable.
 */
export const ROOM_GROUPS = [
  { id: 'production', label: 'Production Rooms', rooms: ['1', '1.2', '2', '3', '4', '4.1', '4.2', '5', '6', '7'] },
  { id: 'kitting', label: 'Kitting', rooms: ['15'] },
  { id: 'batching', label: 'Batching Rooms', rooms: ['Batching 1', 'Batching 2', 'Batching 3'] },
];

export const PRODUCTION_ROOMS = ROOM_GROUPS.flatMap(g => g.rooms);

/**
 * Rooms work was filed against that are no longer in use.
 *
 * Retired, not deleted — the same rule the managed lists follow. They are never
 * offered on a new entry, and they stay in the log's Room filter permanently,
 * because a filed record you cannot filter to is indistinguishable from one
 * that was deleted. Deriving this from the loaded rows instead would look like
 * it worked and quietly fail: the log fetches a date window, so a shift run in
 * Room 8 last spring simply isn't in the data the filter is built from.
 *
 * Room 8 isn't on the facility map; what ran there is Batching Room 3.
 */
export const RETIRED_ROOMS = ['8'];

// Old team name → the line tag it becomes. Used by the migration and by any
// import that still speaks the pre-merge vocabulary (e.g. a schedule sheet
// exported before the change).
export const LEGACY_TEAM_TO_LINE = Object.fromEntries(
  PRODUCTION_LINES.filter(l => l.legacyTeam).map(l => [l.legacyTeam, l.value]),
);
