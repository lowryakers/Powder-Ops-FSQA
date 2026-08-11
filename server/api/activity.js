import { Router } from 'express';
import { getDb } from '../db.js';
import { requireRole } from '../middleware/auth.js';
import {
  GROUP_LABELS, MEASURES, dateOnly, drill, isoWeekStart, predicates, rollup,
} from '../activity-metrics.js';

const router = Router();

// Team Activity (admin) — how the team is performing over time, sourced from the
// operational task-timing tables (work orders), NOT the audit log. The audit log
// remains the immutable compliance trail; these are throughput/on-time metrics.
//
// Admin-only: this org has no lower-level staff who could misuse per-person data,
// so individual detail is shown openly alongside the department rollups.
//
// Every number here is clickable, and the rows behind it come from
// `activity-metrics.js` — the same predicates that produced the number. A
// drill-down computed separately is a list that disagrees with the figure above
// it, and whoever clicked has no way to know which is wrong.

/** The window both endpoints read, resolved identically. */
function window_(db, query) {
  const today = new Date().toISOString().split('T')[0];
  const to = /^\d{4}-\d{2}-\d{2}$/.test(query.to || '') ? query.to : today;
  const from = /^\d{4}-\d{2}-\d{2}$/.test(query.from || '')
    ? query.from
    : db.prepare("SELECT date(?, '-30 days') d").get(to).d;
  return { from, to, today };
}

// Universe: work orders due within the window — the work that was expected in
// this period. Everything is selected because the drill-down has to render a
// real task, not just count one.
//
// LEFT JOIN, never inner: a task raised from a chat message or created for a
// team rather than a machine has no equipment_id, and an inner join here would
// silently drop it from both the count and the list. That is the exact bug that
// made tasks appear in the Operator View and not the Task Center.
const DUE_IN_WINDOW = `
  SELECT wo.*, e.name AS equipment_name
  FROM work_orders wo
  LEFT JOIN equipment e ON wo.equipment_id = e.id
  WHERE wo.due_date BETWEEN ? AND ?`;

router.get('/summary', requireRole('admin'), (req, res) => {
  const db = getDb();
  const { from, to, today } = window_(db, req.query);
  const rows = db.prepare(DUE_IN_WINDOW).all(from, to);
  const roll = (list) => rollup(list, today);

  const overall = roll(rows);

  // By department (task_group).
  const byGroup = {};
  for (const r of rows) (byGroup[r.task_group || 'warehouse'] ||= []).push(r);
  const by_department = Object.entries(byGroup)
    .map(([key, list]) => ({ key, label: GROUP_LABELS[key] || key, ...roll(list) }))
    .sort((a, b) => b.total - a.total);

  // By person: attribute completed work to completed_by, and outstanding/overdue
  // work to assigned_to. A person appears if they touched either side.
  const people = {};
  for (const r of rows) {
    const who = r.completed_by || r.assigned_to;
    if (who) (people[who] ||= []).push(r);
  }
  const by_person = Object.entries(people)
    .map(([name, list]) => ({ name, ...roll(list) }))
    .filter((p) => p.completed > 0 || p.overdue > 0)
    .sort((a, b) => b.completed - a.completed);

  // Weekly completion trend (by completion date within the window).
  const { isCompleted, isOnTime } = predicates(today);
  const weeks = {};
  for (const r of rows) {
    if (!isCompleted(r) || !r.completed_at) continue;
    const cd = dateOnly(r.completed_at);
    if (cd < from || cd > to) continue;
    const wk = isoWeekStart(cd);
    (weeks[wk] ||= { week: wk, completed: 0, on_time: 0 });
    weeks[wk].completed++;
    if (isOnTime(r)) weeks[wk].on_time++;
  }
  const trend = Object.values(weeks).sort((a, b) => a.week.localeCompare(b.week));

  res.json({ from, to, overall, by_department, by_person, trend });
});

/**
 * The tasks behind a number.
 *
 * `metric` names a measure in MEASURES; `department` and `person` narrow it the
 * same way the two tables do. Bounded like every other list endpoint here —
 * `total` is the honest count so a truncated page never reads as the whole
 * answer, and it is computed from the same filter, not from the summary.
 */
router.get('/tasks', requireRole('admin'), (req, res) => {
  const db = getDb();
  const { from, to, today } = window_(db, req.query);
  const metric = String(req.query.metric || 'due');
  if (!MEASURES[metric]) {
    return res.status(400).json({ error: `Unknown measure "${metric}".` });
  }
  const department = req.query.department ? String(req.query.department) : null;
  const person = req.query.person ? String(req.query.person) : null;
  const limit = Math.min(Number(req.query.limit) || 200, 500);

  const rows = db.prepare(DUE_IN_WINDOW).all(from, to);
  const matched = drill(rows, { metric, department, person, today });
  const { isOverdue, isCompleted, isOnTime, cycleDays } = predicates(today);

  // Most-overdue first for outstanding work, most-recent first for finished
  // work — in both cases the row someone opened this to see is at the top.
  const finished = ['completed', 'on_time', 'late'].includes(metric);
  matched.sort((a, b) => (finished
    ? String(b.completed_at || '').localeCompare(String(a.completed_at || ''))
    : String(a.due_date || '').localeCompare(String(b.due_date || ''))));

  const tasks = matched.slice(0, limit).map((r) => ({
    id: r.id,
    title: r.title,
    task_group: r.task_group,
    equipment_name: r.equipment_name || null,
    assigned_to: r.assigned_to,
    completed_by: r.completed_by,
    status: r.status,
    due_date: r.due_date,
    completed_at: r.completed_at,
    created_at: r.created_at,
    priority: r.priority,
    // Derived here so the drawer never re-decides what the server already
    // decided — the whole point of the shared predicates.
    overdue: isOverdue(r),
    on_time: isCompleted(r) ? isOnTime(r) : null,
    days_late: r.due_date && !isCompleted(r)
      ? Math.max(0, Math.floor((new Date(today) - new Date(r.due_date)) / 86400000))
      : (isCompleted(r) && r.completed_at && r.due_date
        ? Math.max(0, Math.floor((new Date(dateOnly(r.completed_at)) - new Date(r.due_date)) / 86400000))
        : null),
    cycle_days: cycleDays(r),
  }));

  res.json({
    from, to, metric, label: MEASURES[metric].label, department, person,
    total: matched.length, truncated: matched.length > tasks.length, tasks,
  });
});

export default router;
