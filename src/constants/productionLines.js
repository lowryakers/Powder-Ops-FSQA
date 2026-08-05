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

// Old team name → the line tag it becomes. Used by the migration and by any
// import that still speaks the pre-merge vocabulary (e.g. a schedule sheet
// exported before the change).
export const LEGACY_TEAM_TO_LINE = Object.fromEntries(
  PRODUCTION_LINES.filter(l => l.legacyTeam).map(l => [l.legacyTeam, l.value]),
);
