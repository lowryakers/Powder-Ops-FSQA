// Canonical operational departments — the single source of truth for user
// assignment and task grouping. Edit here, not in individual components.
//
// - Production was split into its line teams. Sticks and Hand Fill were later
//   merged into one 'filling' team under a single supervisor; which machine a
//   run used is now a per-run line tag (see constants/productionLines.js)
//   rather than a separate team, so the distinction survives without splitting
//   the people.
// - Legacy values ('production', 'sticks', 'hand_fill') stay assignable-in-data
//   so pre-merge users and work orders keep resolving; a boot migration moves
//   them across, and they are hidden from the pickers.
// - QA and Document Control stay as two distinct values but share the "QA"
//   group so the UI can present them together.
export const DEPARTMENTS = [
  { value: 'warehouse', label: 'Warehouse', group: 'Warehouse' },
  { value: 'qa', label: 'QA', group: 'QA' },
  { value: 'document_control', label: 'Document Control', group: 'QA' },
  { value: 'batching', label: 'Batching', group: 'Production' },
  { value: 'kitting', label: 'Kitting', group: 'Production' },
  { value: 'filling', label: 'Filling', group: 'Production' },
  { value: 'cleaning', label: 'Cleaning', group: 'Sanitation' },
  { value: 'maintenance', label: 'Maintenance', group: 'Maintenance' },
  { value: 'office', label: 'Office', group: 'Office' },
  // Legacy — kept so existing accounts stay valid; reassign to a line team.
  { value: 'production', label: 'Production (legacy)', group: 'Production', legacy: true },
  { value: 'sticks', label: 'Sticks (merged into Filling)', group: 'Production', legacy: true },
  { value: 'hand_fill', label: 'Hand Fill (merged into Filling)', group: 'Production', legacy: true },
];

// Departments folded into another one. Anything still carrying the old value is
// read as the new one, so a record written before the merge still resolves.
export const MERGED_DEPARTMENTS = { sticks: 'filling', hand_fill: 'filling' };
export const resolveDepartment = (d) => MERGED_DEPARTMENTS[d] || d;

// Assignable (go-forward) departments — excludes legacy buckets.
export const ASSIGNABLE_DEPARTMENTS = DEPARTMENTS.filter(d => !d.legacy);

// Plain value arrays for simple pickers.
export const DEPARTMENT_VALUES = ASSIGNABLE_DEPARTMENTS.map(d => d.value);
export const ALL_DEPARTMENT_VALUES = DEPARTMENTS.map(d => d.value);

export const DEPARTMENT_LABELS = Object.fromEntries(DEPARTMENTS.map(d => [d.value, d.label]));

export const deptLabel = (d) =>
  DEPARTMENT_LABELS[d] || (d ? d.charAt(0).toUpperCase() + d.slice(1).replace(/_/g, ' ') : '');

// Departments grouped by their `group` for optgroup rendering, preserving order.
export const DEPARTMENT_GROUPS = DEPARTMENTS.reduce((acc, d) => {
  const g = acc.find(x => x.label === d.group);
  if (g) g.options.push(d);
  else acc.push({ label: d.group, options: [d] });
  return acc;
}, []);
