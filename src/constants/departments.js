// Canonical operational departments — the single source of truth for user
// assignment and task grouping. Edit here, not in individual components.
//
// - Production was split into its line teams (Batching / Kitting / Sticks /
//   Hand Fill). The old 'production' value is kept as a legacy bucket so
//   pre-split users and work orders keep working until an admin reassigns them.
// - QA and Document Control stay as two distinct values but share the "QA"
//   group so the UI can present them together.
export const DEPARTMENTS = [
  { value: 'warehouse', label: 'Warehouse', group: 'Warehouse' },
  { value: 'qa', label: 'QA', group: 'QA' },
  { value: 'document_control', label: 'Document Control', group: 'QA' },
  { value: 'batching', label: 'Batching', group: 'Production' },
  { value: 'kitting', label: 'Kitting', group: 'Production' },
  { value: 'sticks', label: 'Sticks', group: 'Production' },
  { value: 'hand_fill', label: 'Hand Fill', group: 'Production' },
  { value: 'cleaning', label: 'Cleaning', group: 'Sanitation' },
  { value: 'maintenance', label: 'Maintenance', group: 'Maintenance' },
  { value: 'office', label: 'Office', group: 'Office' },
  // Legacy — assignable so existing accounts stay valid; reassign to a line team.
  { value: 'production', label: 'Production (legacy)', group: 'Production', legacy: true },
];

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
