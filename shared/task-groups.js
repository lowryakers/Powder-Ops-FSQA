// The teams a task can be routed to — ONE list.
//
// Three screens had their own: Task Center's tabs, Recurring Schedules' Team
// select (missing document_control and office, so a schedule edited there
// blanked a team the server writes) and Meetings' owner select (offering
// `office`, `sanitation` and `production`, none of which Task Center had a
// tab for — so a meeting action assigned to Office, the default, reached
// nobody's list). A team is a routing key: the select that assigns it and
// the tab that shows it must be the same vocabulary or work goes to a list
// nobody opens.
export const TASK_GROUPS = [
  { value: 'maintenance', label: 'Maintenance' },
  { value: 'warehouse', label: 'Warehouse' },
  { value: 'qa', label: 'QA' },
  { value: 'document_control', label: 'Document Control' },
  { value: 'office', label: 'Office' },
  { value: 'batching', label: 'Batching' },
  { value: 'kitting', label: 'Kitting' },
  { value: 'filling', label: 'Filling' },
  { value: 'cleaning', label: 'Cleaning' },
];

export const TASK_GROUP_VALUES = TASK_GROUPS.map(g => g.value);
export const taskGroupLabel = (v) => TASK_GROUPS.find(g => g.value === v)?.label || v || '';
