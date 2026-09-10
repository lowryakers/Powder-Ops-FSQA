import { personRef } from './person-links.js';
/**
 * What Team Activity counts, defined once.
 *
 * The panel used to compute its numbers inline. The moment a number becomes
 * clickable that stops being safe: a drill-down built from a second copy of the
 * predicates is a list that disagrees with the number above it, and the person
 * who clicked has no way to tell which one is wrong. So the tests live here and
 * BOTH `/activity/summary` and `/activity/tasks` import them.
 *
 * Pure — rows in, booleans and totals out. No Express, no database.
 */

export const GROUP_LABELS = {
  warehouse: 'Warehouse',
  maintenance: 'Maintenance',
  qa: 'Quality',
  cleaning: 'Cleaning',
  document_control: 'Document Control',
};

/** Date portion of a timestamp, robust to both ISO ('T') and SQLite (' ') forms. */
export function dateOnly(ts) { return ts ? String(ts).slice(0, 10) : ''; }

export function daysBetween(fromIso, toIso) {
  const a = new Date(fromIso).getTime();
  const b = new Date(toIso).getTime();
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return (b - a) / 86400000;
}

export function isoWeekStart(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  if (Number.isNaN(d.getTime())) return dateStr;
  const day = d.getDay();
  d.setDate(d.getDate() - day + (day === 0 ? -6 : 1));
  return d.toISOString().split('T')[0];
}

/**
 * The tests, bound to a "today" so a drill-down asked for a second later cannot
 * classify a task differently from the summary that produced the number.
 */
export function predicates(today) {
  const isCompleted = (r) => r.status === 'completed';
  const isNA = (r) => r.status === 'not_applicable';
  const isOnTime = (r) => isCompleted(r) && r.completed_at && r.due_date
    && dateOnly(r.completed_at) <= r.due_date;
  const isOverdue = (r) => r.status === 'missed'
    || (['open', 'in_progress', 'overdue'].includes(r.status) && r.due_date < today);
  const cycleDays = (r) => (isCompleted(r) && r.created_at && r.completed_at)
    ? daysBetween(r.created_at, r.completed_at) : null;
  return { isCompleted, isNA, isOnTime, isOverdue, cycleDays };
}

export function rollup(list, today) {
  const { isCompleted, isNA, isOnTime, isOverdue, cycleDays } = predicates(today);
  const total = list.length;
  const completed = list.filter(isCompleted).length;
  const onTime = list.filter(isOnTime).length;
  const overdue = list.filter(isOverdue).length;
  const cycles = list.map(cycleDays).filter((v) => v != null && v >= 0);
  const avgDays = cycles.length ? cycles.reduce((a, b) => a + b, 0) / cycles.length : null;
  // On-time rate is measured against work that was actually completed.
  const onTimePct = completed ? Math.round((onTime / completed) * 100) : null;
  const naCount = list.filter(isNA).length;
  // Completion rate counts completed + N/A as "handled" against the total due.
  const completionPct = total ? Math.round(((completed + naCount) / total) * 100) : null;
  return {
    total, completed, on_time: onTime, overdue, na: naCount,
    avg_days: avgDays, on_time_pct: onTimePct, completion_pct: completionPct,
  };
}

/**
 * Every number on the screen, and the rows behind it.
 *
 * `key` is what a clicked cell sends back. `count` reads the same rollup the
 * card renders, so a measure can never be listed with one number and open with
 * another — the drill-down asserts this rather than assuming it.
 *
 * `late` is a measure with no card of its own: it is what someone means when
 * they click an on-time percentage, which is a rate rather than a set.
 */
export const MEASURES = {
  // Every `filter` takes the predicate set and RETURNS a test. `due` matches
  // everything, but it still has to return a function like the rest of them.
  due: {
    label: 'Due in this period',
    filter: () => () => true,
    count: (r) => r.total,
  },
  completed: {
    label: 'Completed',
    filter: (p) => p.isCompleted,
    count: (r) => r.completed,
  },
  on_time: {
    label: 'Completed on time',
    filter: (p) => p.isOnTime,
    count: (r) => r.on_time,
  },
  late: {
    label: 'Completed late',
    filter: (p) => (row) => p.isCompleted(row) && !p.isOnTime(row),
    count: (r) => r.completed - r.on_time,
  },
  overdue: {
    label: 'Overdue',
    filter: (p) => p.isOverdue,
    count: (r) => r.overdue,
  },
  outstanding: {
    label: 'Not handled',
    filter: (p) => (row) => !p.isCompleted(row) && !p.isNA(row),
    count: (r) => r.total - r.completed - r.na,
  },
};

/**
 * Who a row is attributed to: completed work belongs to whoever completed it,
 * outstanding work to whoever it is assigned to. KEYED ON THE ACCOUNT where
 * the row carries one (`completed_by_id` / `assigned_to_id`, resolved by the
 * person-links triggers) and on the name only for rows that predate the id —
 * keying on the name split a renamed operator into two people, one of them a
 * phantom with half the stats. Both the by-person table and the drill-down
 * behind it call this; a second copy is a list that disagrees with the number.
 */
export function personOf(r) {
  if (r.completed_by) return { key: personRef(r.completed_by_id, r.completed_by), name: r.completed_by, id: r.completed_by_id || null };
  if (r.assigned_to) return { key: personRef(r.assigned_to_id, r.assigned_to), name: r.assigned_to, id: r.assigned_to_id || null };
  return { key: null, name: null, id: null };
}

/** Rows behind one measure, for one optional department and/or person. */
export function drill(rows, { metric, department, person, today }) {
  const measure = MEASURES[metric];
  if (!measure) return null;
  const p = predicates(today);
  const test = measure.filter(p);
  return rows.filter((r) => {
    if (department && (r.task_group || 'warehouse') !== department) return false;
    // Same attribution the by-person rollup uses: completed work belongs to
    // whoever completed it, outstanding work to whoever it is assigned to.
    if (person && personOf(r).key !== person) return false;
    return test(r);
  });
}
