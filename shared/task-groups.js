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

/**
 * DOES THIS DEPARTMENT ROUTE WORK?
 *
 * The Operator View locks a non-admin to `users.department` used AS a
 * `task_group` — which is right, and silent when the two disagree. Every
 * go-forward department in `constants/departments.js` is also a task group, so
 * this is true for everybody today; it is the LEGACY values that are not
 * (`production` above all, which split into batching / kitting / filling and
 * only a person can say which). An account on one of those filters against a
 * group no task carries, so its Operator View can only ever show what is
 * assigned to that person by name — and nothing on any screen says so.
 *
 * NOT a fix by mapping: `sticks` and `hand_fill` already resolve to `filling`
 * at boot (`filling-merge.js`) because the merge is a known fact. `production`
 * has no such answer and guessing one would route somebody's work to a team
 * they are not on. So this REPORTS, and a person sets the department.
 *
 * Blank is NOT reported — `/pm/operator-tasks` falls back to 'warehouse', so an
 * account with no department set is a different question (and one Settings
 * already asks in the same row).
 */
export const routesTasks = (department) =>
  !department || TASK_GROUP_VALUES.includes(department);
