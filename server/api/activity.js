import { Router } from 'express';
import { getDb } from '../db.js';
import { requireRole } from '../middleware/auth.js';

const router = Router();

// Team Activity (admin) — how the team is performing over time, sourced from the
// operational task-timing tables (work orders), NOT the audit log. The audit log
// remains the immutable compliance trail; these are throughput/on-time metrics.
//
// Admin-only: this org has no lower-level staff who could misuse per-person data,
// so individual detail is shown openly alongside the department rollups.

const GROUP_LABELS = {
  warehouse: 'Warehouse',
  maintenance: 'Maintenance',
  qa: 'Quality',
  cleaning: 'Cleaning',
  document_control: 'Document Control',
};

// Date portion of a timestamp, robust to both ISO ('T') and SQLite (' ') forms.
function dateOnly(ts) { return ts ? String(ts).slice(0, 10) : ''; }

function isoWeekStart(dateStr) {
  // Monday of the week containing dateStr, as YYYY-MM-DD.
  const d = new Date(dateStr + 'T00:00:00');
  if (Number.isNaN(d.getTime())) return dateStr;
  const day = d.getDay();
  d.setDate(d.getDate() - day + (day === 0 ? -6 : 1));
  return d.toISOString().split('T')[0];
}

function daysBetween(fromIso, toIso) {
  const a = new Date(fromIso).getTime();
  const b = new Date(toIso).getTime();
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return (b - a) / 86400000;
}

router.get('/summary', requireRole('admin'), (req, res) => {
  const db = getDb();
  const today = new Date().toISOString().split('T')[0];
  // Default window: last 30 days through today.
  const to = /^\d{4}-\d{2}-\d{2}$/.test(req.query.to || '') ? req.query.to : today;
  const from = /^\d{4}-\d{2}-\d{2}$/.test(req.query.from || '')
    ? req.query.from
    : db.prepare("SELECT date(?, '-30 days') d").get(to).d;

  // Universe: work orders due within the window (the work that was expected in
  // this period). Metrics are computed over this set in JS.
  const rows = db.prepare(`
    SELECT task_group, assigned_to, completed_by, status, due_date, created_at, completed_at
    FROM work_orders
    WHERE due_date BETWEEN ? AND ?`).all(from, to);

  const isCompleted = (r) => r.status === 'completed';
  const isNA = (r) => r.status === 'not_applicable';
  const isOnTime = (r) => isCompleted(r) && r.completed_at && r.due_date &&
    dateOnly(r.completed_at) <= r.due_date;
  const isOverdue = (r) => r.status === 'missed' ||
    (['open', 'in_progress', 'overdue'].includes(r.status) && r.due_date < today);
  const cycleDays = (r) => (isCompleted(r) && r.created_at && r.completed_at)
    ? daysBetween(r.created_at, r.completed_at) : null;

  function rollup(list) {
    const total = list.length;
    const completed = list.filter(isCompleted).length;
    const onTime = list.filter(isOnTime).length;
    const overdue = list.filter(isOverdue).length;
    const cycles = list.map(cycleDays).filter(v => v != null && v >= 0);
    const avgDays = cycles.length ? cycles.reduce((a, b) => a + b, 0) / cycles.length : null;
    // On-time rate is measured against work that was actually completed.
    const onTimePct = completed ? Math.round((onTime / completed) * 100) : null;
    const naCount = list.filter(isNA).length;
    // Completion rate counts completed + N/A as "handled" against the total due.
    const completionPct = total ? Math.round(((completed + naCount) / total) * 100) : null;
    return { total, completed, on_time: onTime, overdue, avg_days: avgDays, on_time_pct: onTimePct, completion_pct: completionPct };
  }

  const overall = rollup(rows);

  // By department (task_group).
  const byGroup = {};
  for (const r of rows) {
    const key = r.task_group || 'warehouse';
    (byGroup[key] ||= []).push(r);
  }
  const by_department = Object.entries(byGroup)
    .map(([key, list]) => ({ key, label: GROUP_LABELS[key] || key, ...rollup(list) }))
    .sort((a, b) => b.total - a.total);

  // By person: attribute completed work to completed_by, and outstanding/overdue
  // work to assigned_to. A person appears if they touched either side.
  const people = {};
  const touch = (name) => (people[name] ||= []);
  for (const r of rows) {
    const who = r.completed_by || r.assigned_to;
    if (who) touch(who).push(r);
  }
  const by_person = Object.entries(people)
    .map(([name, list]) => ({ name, ...rollup(list) }))
    .filter(p => p.completed > 0 || p.overdue > 0)
    .sort((a, b) => b.completed - a.completed);

  // Weekly completion trend (by completion date within the window).
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

export default router;
