import { Router } from 'express';
import { v4 as uuid } from 'uuid';
import { getDb, logAudit } from '../db.js';
import { requireDepartment } from '../middleware/auth.js';
import { generateDocumentReviewTasks, recomputeDocumentReview } from './documents.js';
import { generateQualityScheduleTasks } from './quality-schedules.js';
import { generateRecleanTasks } from './sanitation.js';
import { getChannelByName, postMessageAs, botDm } from './comms.js';
import { pushToUser } from '../push.js';
import { environmentalBreaches, isEnvironmentalCheck } from '../env-limits.js';

// Side-effects to run when any work order transitions to completed, regardless
// of which completion path handled it. Completing a document-review task
// advances that document's review cycle. (Quality schedules advance on their
// own calendar at generation time, so they need no completion hook.)
function onWorkOrderCompleted(db, wo) {
  if (wo && wo.document_id) recomputeDocumentReview(db, wo.document_id);
}

const router = Router();

function safeParse(val, fallback = []) {
  try { return JSON.parse(val || JSON.stringify(fallback)); } catch { return fallback; }
}

function nextWeekday(date) {
  const d = new Date(date);
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
  return d;
}

const FREQ_DAYS = { daily: 1, weekly: 7, biweekly: 14, monthly: 30, quarterly: 90, semi_annual: 182, annual: 365 };

// Create the next occurrence WO for a schedule, due one interval from today
function createNextWorkOrder(db, sched, triggeredBy = null) {
  const interval = (FREQ_DAYS[sched.frequency_type] || 30) * (sched.frequency_value || 1);
  const raw = new Date();
  raw.setDate(raw.getDate() + interval);
  const dueStr = nextWeekday(raw).toISOString().split('T')[0];
  const woId = uuid();
  db.prepare(`
    INSERT INTO work_orders (id, pm_schedule_id, equipment_id, title, due_date, procedure_steps, task_group, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'open')
  `).run(woId, sched.id, sched.equipment_id, sched.title, dueStr, sched.procedure_steps, sched.task_group || 'warehouse');
  logAudit('system', 'auto_generate', 'work_order', woId, { pm_schedule_id: sched.id, ...(triggeredBy ? { triggered_by: triggeredBy } : {}) }, null, null);
  return { id: woId, title: sched.title, due_date: dueStr };
}

// Housekeeping that used to run on every GET.
//
// markMissedWorkOrders() and the task generators WRITE — a status sweep, an
// orphan backfill, new work orders. Doing that inside a read meant every task
// list, every operator refresh and every metrics poll paid for a table sweep,
// and a GET mutated the database. They still can't wait for a restart (a
// schedule coming due at 6am must produce a task that morning), so they run at
// most once every few minutes, whoever happens to ask first. Startup runs them
// once eagerly; see server.js.
const HOUSEKEEPING_MS = 5 * 60 * 1000;
const lastRunAt = new Map();
function periodically(key, fn, db) {
  const now = Date.now();
  if (now - (lastRunAt.get(key) || 0) < HOUSEKEEPING_MS) return;
  lastRunAt.set(key, now);
  try { fn(db); } catch (e) { console.warn(`[pm] ${key} skipped:`, e.message); }
}
export function runPmHousekeeping(db, { force = false } = {}) {
  if (force) lastRunAt.clear();
  periodically('mark-missed', markMissedWorkOrders, db);
  periodically('doc-review', generateDocumentReviewTasks, db);
  periodically('quality-schedules', generateQualityScheduleTasks, db);
  // A room flagged by the 72-hour rule raises its own cleaning task, so it
  // reaches the cleaner's Operator View without a supervisor triaging it first.
  periodically('reclean-tasks', generateRecleanTasks, db);
}

/**
 * Collapse identical scheduled tasks that are already on the floor.
 *
 * The guard in markMissedWorkOrders stops NEW duplicates; this clears the ones
 * generated before it existed — six identical "Temp & Humidity Check —
 * Warehouse" cards, same equipment, same due date, all overdue, with no way for
 * an operator to tell which one to complete.
 *
 * Deliberately narrow, because a task list is a compliance record:
 *   · Only tasks raised BY A PM SCHEDULE. Two hand-written tasks that happen to
 *     share a title may well be two real jobs; a generator producing the same
 *     row twice is not.
 *   · Only ones matching on equipment AND title AND due date. Same job, same
 *     machine, same day.
 *   · The OLDEST is kept — it carries whatever history the duplicates don't.
 *   · The rest are CANCELLED with a reason, never deleted. A deleted task is
 *     indistinguishable from one that never existed, which is exactly the gap
 *     an auditor asks about (the same rule server/cleanup.js follows).
 *   · A task somebody has started or completed is never touched.
 */
export function collapseDuplicateWorkOrders(db) {
  let rows;
  try {
    rows = db.prepare(
      `SELECT id, pm_schedule_id, equipment_id, title, due_date, created_at
       FROM work_orders
       WHERE status IN ('open', 'overdue') AND pm_schedule_id IS NOT NULL
         AND started_at IS NULL AND completed_at IS NULL
       ORDER BY COALESCE(created_at, due_date), id`).all();
  } catch { return []; }

  const groups = new Map();
  for (const r of rows) {
    const key = `${r.equipment_id || ''}|${r.title || ''}|${r.due_date || ''}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }

  const cancelled = [];
  const cancel = db.prepare(
    `UPDATE work_orders SET status = 'cancelled', completed_at = datetime('now'), completed_by = 'system',
     notes = COALESCE(notes || char(10), '') || ?, updated_at = datetime('now') WHERE id = ?`);
  const tx = db.transaction(() => {
    for (const [, list] of groups) {
      if (list.length < 2) continue;
      const keep = list[0];
      for (const dup of list.slice(1)) {
        const reason = `Cancelled automatically: duplicate of ${keep.id} — the same scheduled task was generated more than once for this equipment and due date. The remaining task is the one to complete.`;
        cancel.run(reason, dup.id);
        cancelled.push({ id: dup.id, title: dup.title, due_date: dup.due_date, kept: keep.id });
        logAudit('system', 'cancel', 'work_order', dup.id,
          { reason: 'duplicate_scheduled_task', kept_work_order: keep.id, title: dup.title, due_date: dup.due_date },
          null, null, dup.title);
      }
    }
  });
  tx();
  return cancelled;
}

function markMissedWorkOrders(db) {
  const today = new Date().toISOString().split('T')[0];

  // Mark past-due open WOs as missed
  db.prepare(`
    UPDATE work_orders SET status = 'missed', updated_at = datetime('now')
    WHERE status IN ('open', 'overdue') AND due_date < ?
  `).run(today);

  // Ensure every active PM schedule has at least one open WO.
  //
  // THIS IS THE PATH THAT ACTUALLY KEEPS THE TASK LIST FULL — it runs from
  // housekeeping on ordinary page loads, where POST /generate is a manual
  // action almost nobody triggers. Filtering only the manual one left retiring
  // a machine doing nothing at all: its tasks reappeared on the next GET.
  // Equipment that is out of service is excluded here for the same reason.
  const orphaned = db.prepare(`
    SELECT ps.* FROM pm_schedules ps
    JOIN equipment e ON ps.equipment_id = e.id
    WHERE ps.is_active = 1
    AND e.status = 'active'
    AND NOT EXISTS (
      SELECT 1 FROM work_orders wo
      WHERE wo.pm_schedule_id = ps.id AND wo.status IN ('open', 'in_progress')
    )
  `).all();

  if (orphaned.length > 0) {
    const insertWO = db.prepare(`INSERT INTO work_orders (id, pm_schedule_id, equipment_id, title, due_date, procedure_steps, task_group, status) VALUES (?, ?, ?, ?, ?, ?, ?, 'open')`);
    const checkExisting = db.prepare(`SELECT 1 FROM work_orders WHERE pm_schedule_id = ? AND status IN ('open', 'in_progress') LIMIT 1`);
    // The SAME JOB must not appear twice on the floor.
    //
    // The guard above is per SCHEDULE, which is right until two schedules
    // describe the same work — and duplicate schedules do happen (a seeder that
    // ran twice, "create schedules from tasks" run beside a hand-made one, an
    // import). Then each one dutifully generated its own task and the Task
    // Center showed six identical "Temp & Humidity Check — Warehouse" cards,
    // same equipment, same due date, all overdue. Nobody can tell those apart
    // or knows which to complete.
    //
    // Two schedules on the SAME equipment with the SAME title are the same job
    // by definition, so one open task covers both. The duplicate schedule is
    // still there and still visible in the PM list — this only stops it
    // multiplying the work; cleaning it up is a decision for whoever owns it.
    const checkSameJob = db.prepare(
      `SELECT 1 FROM work_orders WHERE title = ? AND status IN ('open', 'in_progress')
       AND (equipment_id = ? OR (equipment_id IS NULL AND ? IS NULL)) LIMIT 1`);
    const tx = db.transaction(() => {
      for (const sched of orphaned) {
        if (checkExisting.get(sched.id)) continue;
        if (checkSameJob.get(sched.title, sched.equipment_id, sched.equipment_id)) continue;
        const interval = (FREQ_DAYS[sched.frequency_type] || 30) * (sched.frequency_value ?? 1);
        const dueDate = nextWeekday(interval <= 1 ? new Date() : new Date(Date.now() + interval * 86400000));
        insertWO.run(uuid(), sched.id, sched.equipment_id, sched.title, dueDate.toISOString().split('T')[0], sched.procedure_steps, sched.task_group || 'warehouse');
      }
    });
    tx();
  }
}

// --- PM Schedules ---

router.get('/schedules', (req, res) => {
  const db = getDb();
  const { equipment_id, active } = req.query;
  let sql = `SELECT ps.*, e.name as equipment_name, e.room, c.name as ccp_name
    FROM pm_schedules ps
    JOIN equipment e ON ps.equipment_id = e.id
    LEFT JOIN haccp_ccps c ON ps.haccp_ccp_id = c.id WHERE 1=1`;
  const params = [];

  if (equipment_id) { sql += ' AND ps.equipment_id = ?'; params.push(equipment_id); }
  if (active !== undefined) { sql += ' AND ps.is_active = ?'; params.push(active === 'true' ? 1 : 0); }
  // Schedules belonging to out-of-service equipment are hidden unless asked
  // for, so retiring a machine actually shrinks the PM list. Explicitly asking
  // for one piece of equipment always shows its own schedules.
  if (!equipment_id && req.query.include_inactive_equipment !== 'true') sql += " AND e.status = 'active'";

  sql += ' ORDER BY e.name, ps.title';
  res.json(db.prepare(sql).all(...params));
});

router.get('/schedules/:id', (req, res) => {
  const db = getDb();
  const sched = db.prepare(`SELECT ps.*, e.name as equipment_name, e.room, c.name as ccp_name
    FROM pm_schedules ps JOIN equipment e ON ps.equipment_id = e.id
    LEFT JOIN haccp_ccps c ON ps.haccp_ccp_id = c.id WHERE ps.id = ?`).get(req.params.id);
  if (!sched) return res.status(404).json({ error: 'PM schedule not found' });

  const recentWOs = db.prepare(
    'SELECT id, status, due_date, completed_at, completed_by FROM work_orders WHERE pm_schedule_id = ? ORDER BY due_date DESC LIMIT 10'
  ).all(req.params.id);

  res.json({ ...sched, procedure_steps: safeParse(sched.procedure_steps), recent_work_orders: recentWOs });
});

router.post('/schedules', (req, res) => {
  const db = getDb();
  const id = uuid();
  const { equipment_id, title, description, frequency_type, frequency_value, procedure_steps, lubricant_type, is_food_grade_lubricant, estimated_minutes, haccp_ccp_id, task_group } = req.body;

  if (!equipment_id || !title || !frequency_type) {
    return res.status(400).json({ error: 'equipment_id, title, and frequency_type are required' });
  }

  db.prepare(`
    INSERT INTO pm_schedules (id, equipment_id, title, description, frequency_type, frequency_value, procedure_steps, lubricant_type, is_food_grade_lubricant, estimated_minutes, haccp_ccp_id, task_group)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, equipment_id, title, description || null, frequency_type, frequency_value ?? 1,
    JSON.stringify(procedure_steps || []), lubricant_type || null,
    is_food_grade_lubricant ? 1 : 0, estimated_minutes ?? null, haccp_ccp_id || null, task_group || 'warehouse');

  const created = db.prepare('SELECT * FROM pm_schedules WHERE id = ?').get(id);
  logAudit(req.user, 'create', 'pm_schedule', id, { title, equipment_id }, null, created);
  res.status(201).json(created);
});

router.put('/schedules/:id', (req, res) => {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM pm_schedules WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'PM schedule not found' });

  const { title, description, frequency_type, frequency_value, procedure_steps, lubricant_type, is_food_grade_lubricant, estimated_minutes, haccp_ccp_id, is_active, task_group } = req.body;

  db.prepare(`
    UPDATE pm_schedules SET title=?, description=?, frequency_type=?, frequency_value=?,
    procedure_steps=?, lubricant_type=?, is_food_grade_lubricant=?, estimated_minutes=?,
    haccp_ccp_id=?, is_active=?, task_group=?, updated_at=datetime('now') WHERE id=?
  `).run(
    title || existing.title, description ?? existing.description,
    frequency_type || existing.frequency_type, frequency_value ?? existing.frequency_value,
    procedure_steps ? JSON.stringify(procedure_steps) : existing.procedure_steps,
    lubricant_type ?? existing.lubricant_type,
    is_food_grade_lubricant !== undefined ? (is_food_grade_lubricant ? 1 : 0) : existing.is_food_grade_lubricant,
    estimated_minutes ?? existing.estimated_minutes, haccp_ccp_id ?? existing.haccp_ccp_id,
    is_active !== undefined ? (is_active ? 1 : 0) : existing.is_active,
    task_group !== undefined ? (task_group || null) : existing.task_group, req.params.id
  );

  // If the assignee (task_group) changed, cascade to this PM's still-open work
  // orders so the reassignment takes effect immediately, not just on next generation.
  if (task_group !== undefined && (task_group || null) !== existing.task_group) {
    db.prepare("UPDATE work_orders SET task_group=? WHERE pm_schedule_id=? AND status IN ('open','in_progress','overdue')")
      .run(task_group || null, req.params.id);
  }

  const updated = db.prepare('SELECT * FROM pm_schedules WHERE id = ?').get(req.params.id);
  logAudit(req.user, 'update', 'pm_schedule', req.params.id, null, existing, updated);
  res.json(updated);
});

// --- Work Orders ---

router.get('/work-orders', (req, res) => {
  const db = getDb();
  runPmHousekeeping(db);
  const { status, equipment_id, from, to, assigned_to } = req.query;
  let sql = `SELECT wo.*, e.name as equipment_name, e.room, e.is_food_contact,
    ps.title as pm_title, ps.frequency_type
    FROM work_orders wo
    LEFT JOIN equipment e ON wo.equipment_id = e.id
    LEFT JOIN pm_schedules ps ON wo.pm_schedule_id = ps.id WHERE 1=1`;
  const params = [];

  if (status) { sql += ' AND wo.status = ?'; params.push(status); }
  if (equipment_id) { sql += ' AND wo.equipment_id = ?'; params.push(equipment_id); }
  if (assigned_to) { sql += ' AND wo.assigned_to = ?'; params.push(assigned_to); }
  if (from) { sql += ' AND wo.due_date >= ?'; params.push(from); }
  if (to) { sql += ' AND wo.due_date <= ?'; params.push(to); }

  sql += ' ORDER BY wo.due_date ASC';
  res.json(db.prepare(sql).all(...params));
});

router.get('/work-orders/:id', (req, res) => {
  const db = getDb();
  const wo = db.prepare(`SELECT wo.*, e.name as equipment_name, e.room, e.is_food_contact,
    ps.title as pm_title
    FROM work_orders wo LEFT JOIN equipment e ON wo.equipment_id = e.id
    LEFT JOIN pm_schedules ps ON wo.pm_schedule_id = ps.id WHERE wo.id = ?`).get(req.params.id);
  if (!wo) return res.status(404).json({ error: 'Work order not found' });

  const history = db.prepare(
    "SELECT * FROM audit_log WHERE entity_type = 'work_order' AND entity_id = ? ORDER BY timestamp ASC"
  ).all(req.params.id);

  res.json({ ...wo, procedure_steps: safeParse(wo.procedure_steps), step_completions: safeParse(wo.step_completions), history });
});

router.post('/work-orders', (req, res) => {
  const db = getDb();
  const id = uuid();
  const { pm_schedule_id, equipment_id, title, description, priority, assigned_to, due_date, procedure_steps, attachments, task_group } = req.body;

  // Equipment is optional so departments (e.g. Document Control) can be assigned
  // free-form tasks — "review SOP-014" — that aren't tied to a machine.
  if (!title || !due_date) {
    return res.status(400).json({ error: 'title and due_date are required' });
  }

  const group = task_group || 'warehouse';
  // Assigning to Document Control is limited to admins and QA / Document Control
  // supervisors (the roles that own document workflow).
  if (group === 'document_control') {
    const canAssignDC = req.user?.role === 'admin' ||
      (req.user?.role === 'supervisor' && ['qa', 'document_control'].includes(req.user?.department));
    if (!canAssignDC) return res.status(403).json({ error: 'Only admins or QA / Document Control supervisors can assign Document Control tasks.' });
  }

  db.prepare(`
    INSERT INTO work_orders (id, pm_schedule_id, equipment_id, title, description, priority, assigned_to, due_date, procedure_steps, attachments, task_group)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, pm_schedule_id || null, equipment_id || null, title, description || null,
    priority || 'normal', assigned_to || null, due_date, JSON.stringify(procedure_steps || []), JSON.stringify(attachments || []), group);

  const created = db.prepare('SELECT * FROM work_orders WHERE id = ?').get(id);
  logAudit(req.user, 'create', 'work_order', id, { title, equipment_id: equipment_id || null, task_group: group, due_date }, null, created);
  res.status(201).json(created);
});

router.put('/work-orders/:id', (req, res) => {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM work_orders WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Work order not found' });

  const { status, assigned_to, notes, lubricant_used, lubricant_is_food_grade, step_completions, priority, due_date } = req.body;

  const newStatus = status || existing.status;
  const completedAt = (newStatus === 'completed' && existing.status !== 'completed') ? new Date().toISOString() : existing.completed_at;
  const completedBy = (newStatus === 'completed' && existing.status !== 'completed') ? req.user.name : existing.completed_by;
  const startedAt = (newStatus === 'in_progress' && !existing.started_at) ? new Date().toISOString() : existing.started_at;

  db.prepare(`
    UPDATE work_orders SET status=?, priority=?, assigned_to=?, started_at=?, completed_at=?,
    completed_by=?, notes=?, lubricant_used=?, lubricant_is_food_grade=?,
    step_completions=?, due_date=?, updated_at=datetime('now') WHERE id=?
  `).run(
    newStatus, priority || existing.priority, assigned_to ?? existing.assigned_to,
    startedAt, completedAt, completedBy,
    notes ?? existing.notes, lubricant_used ?? existing.lubricant_used,
    lubricant_is_food_grade !== undefined ? (lubricant_is_food_grade ? 1 : 0) : existing.lubricant_is_food_grade,
    step_completions ? JSON.stringify(step_completions) : existing.step_completions,
    due_date || existing.due_date, req.params.id
  );

  if (newStatus === 'completed' && existing.status !== 'completed') {
    onWorkOrderCompleted(db, existing);
    // Redoing the work answers the rework request. The note and its history
    // stay on the record; only the outstanding flag clears.
    if (existing.rework_required) {
      db.prepare('UPDATE work_orders SET rework_required=0 WHERE id=?').run(req.params.id);
    }
  }

  const updated = db.prepare('SELECT * FROM work_orders WHERE id = ?').get(req.params.id);
  logAudit(req.user, 'update', 'work_order', req.params.id, { status: newStatus }, existing, updated);
  res.json(updated);
});

// --- PM Completion Metrics ---

router.get('/metrics', (req, res) => {
  const db = getDb();
  runPmHousekeeping(db);
  const { from, to, group } = req.query;
  const now = new Date();
  const defaultFrom = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
  const defaultTo = now.toISOString().split('T')[0];
  const start = from || defaultFrom;
  const end = to || defaultTo;

  const gf = group ? ' AND task_group = ?' : '';
  const gp = group ? [group] : [];
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const rateCutoff = yesterday.toISOString().split('T')[0];
  const total = db.prepare("SELECT COUNT(*) as count FROM work_orders WHERE due_date BETWEEN ? AND ?" + gf).get(start, rateCutoff, ...gp);
  const completed = db.prepare("SELECT COUNT(*) as count FROM work_orders WHERE due_date BETWEEN ? AND ? AND status IN ('completed','not_applicable')" + gf).get(start, rateCutoff, ...gp);
  const missed = db.prepare("SELECT COUNT(*) as count FROM work_orders WHERE due_date BETWEEN ? AND ? AND status = 'missed'" + gf).get(start, rateCutoff, ...gp);
  const naCount = db.prepare("SELECT COUNT(*) as count FROM work_orders WHERE due_date BETWEEN ? AND ? AND status = 'not_applicable'" + gf).get(start, rateCutoff, ...gp);
  const overdue = db.prepare("SELECT COUNT(*) as count FROM work_orders WHERE due_date < ? AND status IN ('open','in_progress','overdue')" + gf).get(end, ...gp);
  const open = db.prepare("SELECT COUNT(*) as count FROM work_orders WHERE status IN ('open','in_progress')" + gf).get(...gp);

  const completionRate = total.count > 0 ? ((completed.count / total.count) * 100).toFixed(1) : 0;

  const byEquipment = db.prepare(`
    SELECT e.name, e.room, COUNT(*) as total,
      SUM(CASE WHEN wo.status IN ('completed','not_applicable') THEN 1 ELSE 0 END) as completed
    FROM work_orders wo JOIN equipment e ON wo.equipment_id = e.id
    WHERE wo.due_date BETWEEN ? AND ?${group ? ' AND wo.task_group = ?' : ''}
    GROUP BY wo.equipment_id ORDER BY e.name
  `).all(start, end, ...gp);

  const monthlyTrend = db.prepare(`
    SELECT strftime('%Y-%m', due_date) as month,
      COUNT(*) as total,
      SUM(CASE WHEN status IN ('completed','not_applicable') THEN 1 ELSE 0 END) as completed,
      SUM(CASE WHEN status = 'missed' THEN 1 ELSE 0 END) as missed,
      SUM(CASE WHEN status = 'not_applicable' THEN 1 ELSE 0 END) as not_applicable
    FROM work_orders${group ? ' WHERE task_group = ?' : ''} GROUP BY strftime('%Y-%m', due_date) ORDER BY month DESC LIMIT 12
  `).all(...gp);

  res.json({
    period: { from: start, to: end },
    total: total.count,
    completed: completed.count,
    missed: missed.count,
    not_applicable: naCount.count,
    overdue: overdue.count,
    open: open.count,
    completion_rate: parseFloat(completionRate),
    meets_sqf_target: parseFloat(completionRate) >= 95,
    by_equipment: byEquipment,
    monthly_trend: monthlyTrend.reverse(),
  });
});

// --- Complete a Work Order and auto-generate next occurrence ---

/**
 * A food-contact task cannot be completed without an account of its steps.
 *
 * Completing a clean on a food-contact machine puts it in QA's hygiene
 * clearance queue, and QA's whole job there is to decide whether it is fit to
 * run again. Doing that from a task with no step record is a rubber stamp —
 * which is exactly what was happening, because no completion screen asked.
 *
 * Enforced HERE and not only in the form: a rule the client alone applies is a
 * suggestion, and there are three ways to complete a task.
 *
 * Two deliberate limits on the rule:
 *  • It only applies to equipment flagged `is_food_contact` — the same fact
 *    that raises the clearance — so the rest of the floor is not blocked by a
 *    gate that exists for hygiene.
 *  • A task with no procedure steps has nothing to tick, and refusing it would
 *    make it impossible to complete at all.
 *
 * Headings (a step ending in ':') are not steps and are not counted.
 */
export function missingStepTicks(procedureStepsJson, stepResults) {
  let steps;
  try { steps = JSON.parse(procedureStepsJson || '[]'); } catch { steps = []; }
  if (!Array.isArray(steps)) steps = [];
  const isHeading = (t) => typeof t === 'string' && t.endsWith(':');
  const results = Array.isArray(stepResults) ? stepResults : [];
  const ticked = (v) => v === true || v === 'done' || v === 'pass';
  const outstanding = [];
  steps.forEach((step, i) => {
    if (isHeading(step)) return;
    if (!ticked(results[i])) outstanding.push(step);
  });
  return { total: steps.filter(t => !isHeading(t)).length, outstanding };
}

router.post('/work-orders/:id/complete-and-recur', (req, res) => {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM work_orders WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Work order not found' });
  if (existing.status === 'completed') {
    return res.status(409).json({ error: 'Work order is already completed' });
  }

  const { notes, lubricant_used, lubricant_is_food_grade, readings, step_results, reading_result } = req.body;
  const completedAt = new Date().toISOString();
  const completedBy = req.user.name;

  const eq = db.prepare('SELECT is_food_contact FROM equipment WHERE id = ?').get(existing.equipment_id);
  const needsClearance = eq && eq.is_food_contact === 1 ? 1 : 0;

  // Food-contact work goes to QA for hygiene clearance, and QA cannot clear a
  // machine from a task that does not say what was done.
  if (needsClearance) {
    const { total, outstanding } = missingStepTicks(existing.procedure_steps, step_results);
    if (total > 0 && outstanding.length) {
      return res.status(400).json({
        error: `This is food-contact equipment, so QA has to sign it off before it runs again — tick each step you completed. ${outstanding.length} of ${total} still unticked.`,
        outstanding,
        requires_steps: true,
      });
    }
  }

  db.prepare(`
    UPDATE work_orders SET status='completed', completed_at=?, completed_by=?,
    notes=?, lubricant_used=?, lubricant_is_food_grade=?,
    readings=?, step_results=?, reading_result=?,
    clearance_required=?, clearance_status=?,
    chemical_id=?,
    rework_required=0,
    updated_at=datetime('now') WHERE id=?
  `).run(completedAt, completedBy, notes || null, lubricant_used || null,
    lubricant_is_food_grade ? 1 : 0,
    JSON.stringify(readings || {}), JSON.stringify(step_results || []), reading_result || null,
    needsClearance, needsClearance ? 'pending' : null,
    req.body.chemical_id || null,
    req.params.id);

  logAudit(completedBy, 'complete', 'work_order', req.params.id, { notes, readings, reading_result }, null, null);
  if (isEnvironmentalCheck(existing.title)) {
    const eqName = db.prepare('SELECT name, room FROM equipment WHERE id = ?').get(existing.equipment_id);
    notifyEnvironmentalBreach(db, { ...existing, equipment_name: eqName?.room || eqName?.name }, readings, completedBy)
      .catch(e => console.warn('[env-alert]', e.message));
  }
  if (needsClearance) {
    logAudit('system', 'clearance_required', 'work_order', req.params.id, 'Food-contact equipment — hygiene clearance pending');
  }
  onWorkOrderCompleted(db, existing);

  let nextWO = null;
  if (existing.pm_schedule_id) {
    const sched = db.prepare('SELECT * FROM pm_schedules WHERE id = ?').get(existing.pm_schedule_id);
    if (sched && sched.is_active) {
      nextWO = createNextWorkOrder(db, sched, req.params.id);
    }
  }

  res.json({ completed: req.params.id, next_work_order: nextWO });
});

// --- Batch Complete ---

router.post('/work-orders/batch-complete', (req, res) => {
  const db = getDb();
  const { ids } = req.body;
  if (!ids || !Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: 'ids array required' });

  const completedAt = new Date().toISOString();
  const completedBy = req.user.name;
  const results = [];

  const completeStmt = db.prepare(`
    UPDATE work_orders SET status='completed', completed_at=?, completed_by=?,
    notes='Batch completed', readings='{}', step_results='[]',
    rework_required=0,
    updated_at=datetime('now') WHERE id=?
  `);
  const getWO = db.prepare('SELECT * FROM work_orders WHERE id = ?');
  const getSched = db.prepare('SELECT * FROM pm_schedules WHERE id = ?');
  const getEq = db.prepare('SELECT is_food_contact FROM equipment WHERE id = ?');

  // A batch tick-off writes no step record at all, so it cannot satisfy the
  // food-contact gate. Those tasks are SKIPPED and named, rather than quietly
  // completed with an empty account of the work — which is the state that put
  // "0 of 3 ticked" in front of QA in the first place.
  const skipped = [];
  const batchRun = db.transaction(() => {
    for (const id of ids) {
      const wo = getWO.get(id);
      if (!wo || wo.status === 'completed') continue;

      const eq = getEq.get(wo.equipment_id);
      const needsClearance = eq && eq.is_food_contact === 1 ? 1 : 0;
      if (needsClearance && missingStepTicks(wo.procedure_steps, []).total > 0) {
        skipped.push({ id, title: wo.title, reason: 'Food-contact equipment — open it and tick the steps.' });
        continue;
      }

      completeStmt.run(completedAt, completedBy, id);
      if (needsClearance) {
        db.prepare("UPDATE work_orders SET clearance_required=1, clearance_status='pending' WHERE id=?").run(id);
        logAudit('system', 'clearance_required', 'work_order', id, 'Food-contact equipment — hygiene clearance pending');
      }

      logAudit(completedBy, 'complete', 'work_order', id, { batch: true }, null, null);
      onWorkOrderCompleted(db, wo);

      if (wo.pm_schedule_id) {
        const sched = getSched.get(wo.pm_schedule_id);
        if (sched && sched.is_active) {
          createNextWorkOrder(db, sched, id);
        }
      }
      results.push(id);
    }
  });

  batchRun();
  res.json({ completed: results.length, ids: results, skipped });
});

// --- Mark Work Order Not Applicable ---

router.post('/work-orders/:id/not-applicable', (req, res) => {
  const db = getDb();
  const wo = db.prepare('SELECT * FROM work_orders WHERE id = ?').get(req.params.id);
  if (!wo) return res.status(404).json({ error: 'Work order not found' });

  const { reason } = req.body;
  const actor = req.user.name;

  db.prepare(`
    UPDATE work_orders SET status='not_applicable', completed_at=datetime('now'), completed_by=?,
    notes=?, updated_at=datetime('now') WHERE id=?
  `).run(actor, reason || 'Equipment not in use', req.params.id);

  logAudit(actor, 'not_applicable', 'work_order', req.params.id, { reason: reason || 'Equipment not in use' });

  let nextWO = null;
  if (wo.pm_schedule_id) {
    const sched = db.prepare('SELECT * FROM pm_schedules WHERE id = ?').get(wo.pm_schedule_id);
    if (sched && sched.is_active) {
      nextWO = createNextWorkOrder(db, sched, req.params.id);
    }
  }

  res.json({ skipped: req.params.id, next_work_order: nextWO });
});

// --- Flag Issue on Work Order ---

// A flagged issue alerts the responsible person: post into the task's team
// channel with an @mention of the team lead (the team's sole active
// supervisor), falling back to Adam as the catch-all when the lead is
// ambiguous or missing, plus a direct push so the lead's phone buzzes even
// if they aren't a member of the channel. Best-effort — flagging never fails
// because notification did.
async function notifyTaskIssue(db, flagger, wo) {
  const team = wo.task_group || 'maintenance';
  const sups = db.prepare("SELECT id, name FROM users WHERE is_active = 1 AND role = 'supervisor' AND department = ?").all(team);
  let lead = sups.length === 1 ? sups[0] : null;
  if (!lead) {
    lead = db.prepare("SELECT id, name FROM users WHERE is_active = 1 AND name LIKE 'Adam%' ORDER BY name LIMIT 1").get() || null;
  }
  const channel = getChannelByName(db, team) || getChannelByName(db, 'general');
  const note = String(wo.issue_notes || '').slice(0, 300);
  if (channel) {
    const text = `⚠️ Issue reported on task "${wo.title}"${lead ? ` — @${lead.name}` : ''}\n${note}`;
    await postMessageAs(db, channel, flagger, text); // @mention handles the lead's push
  }
  if (lead && lead.id !== flagger.id) {
    pushToUser(lead.id, {
      title: `Issue reported: ${wo.title}`,
      body: `${flagger.name}: ${note.slice(0, 120)}`,
      tag: `issue-${wo.id}`, renotify: true,
    }).catch(() => {});
  }
}

// A humidity or temperature reading out of range is told to someone straight
// away, because the whole value of a daily check is catching the day it moves.
// Best-effort: a notification failure must never make the check itself fail —
// the reading is already recorded by the time this runs.
async function notifyEnvironmentalBreach(db, wo, readings, completedBy) {
  const breaches = environmentalBreaches(readings);
  if (!breaches.length) return;

  const room = wo.equipment_name || wo.location || wo.title || 'the monitored area';
  const lines = breaches.map(b => {
    const state = b.exceeded ? 'OUT OF RANGE' : 'approaching the limit';
    return `• ${b.label}: *${b.value}${b.unit}* — ${state} (${b.note})`;
  }).join('\n');
  const worst = breaches.some(b => b.exceeded) ? 'out of range' : 'approaching its limit';
  const body = `*Temp & Humidity check ${worst}* — ${room}\n${lines}\n\nLogged by ${completedBy} just now.`;

  // Adam is the named escalation for environmental excursions. Fall back to
  // the QA supervisors so a rename or an absence never silences this.
  let targets = db.prepare("SELECT id, name FROM users WHERE is_active = 1 AND name LIKE 'Adam%' ORDER BY name LIMIT 1").all();
  if (!targets.length) {
    targets = db.prepare("SELECT id, name FROM users WHERE is_active = 1 AND role IN ('admin','supervisor') AND LOWER(department) IN ('qa','quality')").all();
  }
  for (const t of targets) {
    try {
      const { bot, dm } = botDm(db, t.id);
      if (dm) await postMessageAs(db, dm, bot, body);
    } catch (e) { console.warn('[env-alert] DM failed:', e.message); }
    // A DM the phone doesn't buzz for is a message read tomorrow.
    pushToUser(t.id, {
      title: `Temp & Humidity ${worst}: ${room}`,
      body: breaches.map(b => `${b.label} ${b.value}${b.unit}`).join(' · '),
      tag: `env-${wo.id}`, renotify: true,
    }).catch(() => {});
  }
  logAudit('system', 'environmental_alert', 'work_order', wo.id,
    { room, breaches, notified: targets.map(t => t.name) }, null, null, wo.title);
}

router.post('/work-orders/:id/flag-issue', (req, res) => {
  const db = getDb();
  const wo = db.prepare('SELECT * FROM work_orders WHERE id = ?').get(req.params.id);
  if (!wo) return res.status(404).json({ error: 'Work order not found' });

  const { notes, attachments } = req.body;
  if (!notes) return res.status(400).json({ error: 'Issue notes are required' });

  db.prepare(`
    UPDATE work_orders SET issue_flagged=1, issue_notes=?, issue_attachments=?,
    issue_flagged_by=?, issue_flagged_at=datetime('now'), priority='high',
    updated_at=datetime('now') WHERE id=?
  `).run(notes, JSON.stringify(attachments || []), req.user.name, req.params.id);

  logAudit(req.user, 'issue_flagged', 'work_order', req.params.id, { notes });
  const updated = db.prepare('SELECT * FROM work_orders WHERE id = ?').get(req.params.id);
  notifyTaskIssue(db, req.user, updated).catch(e => console.warn('[flag-issue] notify failed:', e.message));
  res.json(updated);
});

// --- Review of a completed task ---
//
// QA (or a supervisor) reviews finished work and leaves a note. Most notes are
// just notes. Marking one as needing rework reopens the task and puts it back
// on the person who did it, with the note attached — the same shape as flagging
// a QA note on a production entry, minus the amendment machinery, because a
// task has a status to move and isn't a filed record.
//
// The prior completion isn't erased; it moves into review_history so a task
// that was done, kicked back and redone still shows all of it.
router.post('/work-orders/:id/review', (req, res) => {
  const db = getDb();
  const wo = db.prepare('SELECT * FROM work_orders WHERE id = ?').get(req.params.id);
  if (!wo) return res.status(404).json({ error: 'Work order not found' });

  const note = String(req.body?.note || '').trim();
  const rework = !!req.body?.rework_required;
  if (!note) return res.status(400).json({ error: 'A review note is required.' });
  if (rework && wo.status !== 'completed') {
    return res.status(400).json({ error: 'Only a completed task can be sent back for rework.' });
  }

  let history;
  try { history = JSON.parse(wo.review_history || '[]'); } catch { history = []; }
  history.push({
    reviewed_at: new Date().toISOString(),
    reviewed_by: req.user?.name || 'system',
    note,
    rework_required: rework,
    prior_completion: rework && wo.completed_at ? { by: wo.completed_by, at: wo.completed_at } : null,
  });

  if (rework) {
    db.prepare(`
      UPDATE work_orders SET review_note=?, review_by=?, review_at=datetime('now'),
        rework_required=1, review_history=?, status='open', assigned_to=COALESCE(?, assigned_to),
        completed_at=NULL, completed_by=NULL, updated_at=datetime('now') WHERE id=?
    `).run(note, req.user?.name || null, JSON.stringify(history), wo.completed_by || null, req.params.id);
  } else {
    db.prepare(`
      UPDATE work_orders SET review_note=?, review_by=?, review_at=datetime('now'),
        review_history=?, updated_at=datetime('now') WHERE id=?
    `).run(note, req.user?.name || null, JSON.stringify(history), req.params.id);
  }

  const updated = db.prepare('SELECT * FROM work_orders WHERE id = ?').get(req.params.id);
  logAudit(req.user, rework ? 'rework_requested' : 'task_reviewed', 'work_order', req.params.id,
    { note, rework_required: rework }, wo, updated, wo.title);
  res.json(updated);
});

// Clearing the flag when the work is redone: completing the task resolves it,
// so this is only for a reviewer withdrawing the request.
router.post('/work-orders/:id/review/clear', (req, res) => {
  const db = getDb();
  const wo = db.prepare('SELECT * FROM work_orders WHERE id = ?').get(req.params.id);
  if (!wo) return res.status(404).json({ error: 'Work order not found' });
  db.prepare("UPDATE work_orders SET rework_required=0, updated_at=datetime('now') WHERE id=?").run(req.params.id);
  logAudit(req.user, 'rework_cleared', 'work_order', req.params.id, null, wo, null, wo.title);
  res.json(db.prepare('SELECT * FROM work_orders WHERE id = ?').get(req.params.id));
});

// --- Snooze: push a task to a later day, with a name and a reason ---
//
// Operators complete or ignore; supervisors legitimately need "not today —
// tomorrow, because X". This is an audited defer, the same shape as the setup-
// step waiver: the decision carries a reason and a name, the original due date
// is preserved, and the history shows every push. It is NOT a way to erase a
// miss — a task already marked missed is a record and stays one.
router.post('/work-orders/:id/snooze', (req, res) => {
  const db = getDb();
  const wo = db.prepare('SELECT * FROM work_orders WHERE id = ?').get(req.params.id);
  if (!wo) return res.status(404).json({ error: 'Work order not found' });

  const canSnooze = req.user?.role === 'admin' || req.user?.role === 'supervisor' || req.user?.department === 'qa';
  if (!canSnooze) return res.status(403).json({ error: 'Deferring a task is a supervisor/QA/admin action.' });
  if (!['open', 'in_progress', 'overdue'].includes(wo.status)) {
    return res.status(400).json({ error: 'Only an open task can be deferred. A missed task is already a record — it stays missed.' });
  }
  const reason = String(req.body?.reason || '').trim();
  if (reason.length < 3) return res.status(400).json({ error: 'Say why — a defer without a reason is indistinguishable from a task quietly ignored.' });
  const days = Math.min(14, Math.max(1, parseInt(req.body?.days, 10) || 1));

  // Count from the later of today and the current due date, in LOCAL parts —
  // new Date('YYYY-MM-DD') is UTC midnight and shifts a day west of Greenwich.
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const baseStr = wo.due_date > todayStr ? wo.due_date : todayStr;
  const [y, m, d] = baseStr.split('-').map(Number);
  const target = nextWeekday(new Date(y, m - 1, d + days));
  const newDue = `${target.getFullYear()}-${String(target.getMonth() + 1).padStart(2, '0')}-${String(target.getDate()).padStart(2, '0')}`;

  const history = safeParse(wo.snooze_history, []);
  history.push({ at: new Date().toISOString(), by: req.user.name, reason, from: wo.due_date, to: newDue });

  db.prepare(`
    UPDATE work_orders SET due_date=?, snooze_history=?,
      original_due_date=COALESCE(original_due_date, ?),
      status = CASE WHEN status='overdue' THEN 'open' ELSE status END,
      updated_at=datetime('now') WHERE id=?
  `).run(newDue, JSON.stringify(history), wo.due_date, req.params.id);

  const updated = db.prepare('SELECT * FROM work_orders WHERE id = ?').get(req.params.id);
  logAudit(req.user, 'snoozed', 'work_order', req.params.id,
    { reason, days, from: wo.due_date, to: newDue }, wo, updated, wo.title);
  res.json(updated);
});

// --- Hygiene Clearance ---

router.put('/work-orders/:id/clearance', requireDepartment('qa'), (req, res) => {
  const db = getDb();
  const wo = db.prepare('SELECT * FROM work_orders WHERE id = ?').get(req.params.id);
  if (!wo) return res.status(404).json({ error: 'Work order not found' });
  if (!wo.clearance_required) return res.status(400).json({ error: 'This work order does not require clearance' });

  const { status, cleared_by, notes, method } = req.body;
  if (!status || !cleared_by) return res.status(400).json({ error: 'status and cleared_by required' });
  if (!['cleared', 'failed'].includes(status)) return res.status(400).json({ error: 'status must be "cleared" or "failed"' });

  if (cleared_by === wo.completed_by) {
    return res.status(403).json({ error: 'Clearance must be performed by someone other than the person who completed the work' });
  }

  db.prepare(`
    UPDATE work_orders SET clearance_status=?, clearance_by=?, clearance_at=datetime('now'),
    clearance_notes=?, clearance_method=?, updated_at=datetime('now') WHERE id=?
  `).run(status, cleared_by, notes || null, method || null, req.params.id);

  logAudit(req.user, `clearance_${status}`, 'work_order', req.params.id,
    `Method: ${method || 'visual'}, Notes: ${notes || 'none'}`);
  res.json({ success: true });
});

// What QA has to clear, and — the part that was missing — WHAT WAS DONE.
//
// The card used to show a title, a machine and a name. Deciding whether a
// machine is fit to run again from that means either knowing the daily and
// weekly procedures by heart or going to the Equipment list to look them up,
// which is how a clearance becomes a rubber stamp. The steps, their tick
// state, the readings and any flagged issue were all already on the row; the
// schedule join adds the one thing that wasn't — which procedure this was and
// how often it runs.
router.get('/clearance-pending', (req, res) => {
  const db = getDb();
  const rows = db.prepare(`
    SELECT wo.*, e.name as equipment_name, e.location, e.asset_id, e.room, e.is_food_contact,
           ps.title AS pm_title, ps.frequency_type, ps.procedure_steps AS schedule_steps
    FROM work_orders wo
    LEFT JOIN equipment e ON wo.equipment_id = e.id
    LEFT JOIN pm_schedules ps ON wo.pm_schedule_id = ps.id
    WHERE wo.clearance_required = 1 AND wo.clearance_status = 'pending'
    ORDER BY wo.completed_at DESC
  `).all();
  res.json(rows);
});

// --- PM Schedules grouped by frequency ---

// Search every task, regardless of the team tab, frequency filter or status the
// user happens to be looking at — searching a filtered slice is why "restroom"
// came back empty while the task existed. Covers open/in-progress/overdue,
// missed, and recent completions, and matches the PM title as well as the work
// order's own title, equipment, asset id, location and assignee.
router.get('/search', (req, res) => {
  const db = getDb();
  runPmHousekeeping(db);
  const q = String(req.query.q || '').trim();
  if (q.length < 2) return res.json([]);
  const like = `%${q}%`;

  const rows = db.prepare(`
    SELECT wo.*, e.name as equipment_name, e.type as equipment_type, e.location,
      e.asset_id, e.is_food_contact, ps.title as pm_title, ps.frequency_type, ps.procedure_steps as pm_steps
    FROM work_orders wo
    -- LEFT: "a task you can name is a task you should be able to find" was not
    -- true of a task with no equipment.
    LEFT JOIN equipment e ON wo.equipment_id = e.id
    LEFT JOIN pm_schedules ps ON wo.pm_schedule_id = ps.id
    WHERE (wo.status != 'completed' OR wo.completed_at >= date('now', '-90 days'))
      AND (LOWER(wo.title) LIKE LOWER(?) OR LOWER(ps.title) LIKE LOWER(?)
        OR LOWER(e.name) LIKE LOWER(?) OR LOWER(e.asset_id) LIKE LOWER(?)
        OR LOWER(e.location) LIKE LOWER(?) OR LOWER(wo.assigned_to) LIKE LOWER(?))
    ORDER BY (wo.status = 'completed'), (wo.due_date >= date('now')), wo.due_date
    LIMIT 100
  `).all(like, like, like, like, like, like);

  res.json(rows.map(r => ({ ...r, procedure_steps: safeParse(r.pm_steps || r.procedure_steps) })));
});

router.get('/by-frequency', (req, res) => {
  const db = getDb();
  runPmHousekeeping(db);
  const { frequency, equipment_id, group } = req.query;

  let sql = `SELECT wo.*, e.name as equipment_name, e.type as equipment_type, e.location,
    e.asset_id, e.is_food_contact,
    ps.title as pm_title, ps.frequency_type, ps.procedure_steps as pm_steps
    FROM work_orders wo
    -- LEFT, because NOT EVERY TASK HAS EQUIPMENT. New Task creates team tasks
    -- with no equipment, and a task raised from a chat message always has
    -- equipment_id NULL. An inner join silently dropped every one of them from
    -- the Task Center while the Operator View — which left-joins — showed them,
    -- so the same task existed on one screen and not the other.
    LEFT JOIN equipment e ON wo.equipment_id = e.id
    LEFT JOIN pm_schedules ps ON wo.pm_schedule_id = ps.id
    WHERE wo.status IN ('open', 'in_progress', 'overdue')`;
  const params = [];

  if (frequency) { sql += ' AND ps.frequency_type = ?'; params.push(frequency); }
  if (equipment_id) { sql += ' AND wo.equipment_id = ?'; params.push(equipment_id); }
  if (group) { sql += ' AND wo.task_group = ?'; params.push(group); }

  sql += ' ORDER BY ps.frequency_type, e.name';

  const rows = db.prepare(sql).all(...params);

  const grouped = {};
  for (const r of rows) {
    const freq = r.frequency_type || 'unscheduled';
    if (!grouped[freq]) grouped[freq] = [];
    grouped[freq].push({ ...r, procedure_steps: safeParse(r.pm_steps || r.procedure_steps) });
  }

  res.json(grouped);
});

// --- Completed PM history (archive) ---

router.get('/completed-history', (req, res) => {
  const db = getDb();
  runPmHousekeeping(db);
  const { limit = 50, offset = 0, frequency, from, to, include_missed, group } = req.query;
  const showMissed = include_missed !== 'false';

  const statusFilter = showMissed ? "wo.status IN ('completed','missed','not_applicable')" : "wo.status IN ('completed','not_applicable')";
  const dateCol = 'COALESCE(wo.completed_at, wo.due_date)';

  let sql = `SELECT wo.*, e.name as equipment_name, e.type as equipment_type, e.location,
    e.asset_id, e.is_food_contact, ps.title as pm_title, ps.frequency_type
    FROM work_orders wo
    LEFT JOIN equipment e ON wo.equipment_id = e.id
    LEFT JOIN pm_schedules ps ON wo.pm_schedule_id = ps.id
    WHERE ${statusFilter}`;
  const params = [];

  if (frequency) { sql += ' AND ps.frequency_type = ?'; params.push(frequency); }
  if (group) { sql += ' AND wo.task_group = ?'; params.push(group); }
  if (from) { sql += ` AND ${dateCol} >= ?`; params.push(from); }
  if (to) { sql += ` AND ${dateCol} <= ?`; params.push(to + 'T23:59:59'); }

  const countSql = sql.replace(/SELECT wo\.\*[\s\S]*?FROM/, 'SELECT COUNT(*) as c FROM');
  sql += ` ORDER BY ${dateCol} DESC LIMIT ? OFFSET ?`;
  params.push(parseInt(limit), parseInt(offset));

  const rows = db.prepare(sql).all(...params);
  const total = db.prepare(countSql).get(...params.slice(0, -2));

  const missedCount = db.prepare(`SELECT COUNT(*) as c FROM work_orders WHERE status = 'missed'`).get().c;

  res.json({ items: rows, total: total.c, missed_count: missedCount });
});

// --- Generate Work Orders from PM Schedules ---

router.post('/generate', (_req, res) => {
  const db = getDb();
  // Equipment that is out of service generates NOTHING new. Its schedule is
  // left alone rather than deactivated — the machine may come back, and
  // deleting the schedule would lose the procedure with it. Tasks already open
  // are also left alone: somebody may still need to close them out honestly.
  const schedules = db.prepare(`
    SELECT ps.* FROM pm_schedules ps
    JOIN equipment e ON ps.equipment_id = e.id
    WHERE ps.is_active = 1 AND e.status = 'active'
  `).all();
  const generated = [];

  const checkOpen = db.prepare("SELECT 1 FROM work_orders WHERE pm_schedule_id = ? AND status IN ('open','in_progress') LIMIT 1");
  for (const sched of schedules) {
    if (checkOpen.get(sched.id)) continue;
    const lastWO = db.prepare(
      'SELECT due_date FROM work_orders WHERE pm_schedule_id = ? ORDER BY due_date DESC LIMIT 1'
    ).get(sched.id);

    const interval = (FREQ_DAYS[sched.frequency_type] || 30) * (sched.frequency_value || 1);

    const lastDate = lastWO ? new Date(lastWO.due_date) : new Date();
    const rawNext = new Date(lastDate);
    rawNext.setDate(rawNext.getDate() + interval);
    const nextDue = nextWeekday(rawNext);

    const horizon = new Date();
    horizon.setDate(horizon.getDate() + 30);

    if (nextDue <= horizon) {
      const woId = uuid();
      db.prepare(`
        INSERT INTO work_orders (id, pm_schedule_id, equipment_id, title, description, due_date, procedure_steps, task_group)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(woId, sched.id, sched.equipment_id, sched.title,
        sched.description, nextDue.toISOString().split('T')[0], sched.procedure_steps, sched.task_group || 'warehouse');

      generated.push({ id: woId, title: sched.title, due_date: nextDue.toISOString().split('T')[0] });
      logAudit('system', 'auto_generate', 'work_order', woId, { pm_schedule_id: sched.id }, null, null);
    }
  }

  res.json({ generated: generated.length, work_orders: generated });
});

// --- Operator view: simplified task list ---

/**
 * Missed work, without showing the same job twice.
 *
 * Housekeeping marks a past-due task 'missed' AND creates a fresh one for the
 * schedule, so a daily clean left undone for a fortnight leaves fourteen missed
 * rows behind it. Listing them all would bury today's work under a fortnight of
 * identical cards, and the cleaner would complete one and watch thirteen
 * others linger — they are one physical job.
 *
 * So:
 *  • a schedule that already has a live task keeps ONE card, and that card
 *    carries `missed_count` / `missed_since` — she is told she is behind
 *    without being handed the same job fourteen times;
 *  • a schedule with nothing live keeps its OLDEST missed task, because
 *    otherwise the work disappears from the screen altogether;
 *  • a ONE-OFF task with no schedule always survives. Nothing regenerates it,
 *    so dropping it is not deduplication, it is losing the task.
 */
function collapseMissed(rows) {
  const live = new Set();
  for (const r of rows) {
    if (r.pm_schedule_id && r.status !== 'missed') live.add(r.pm_schedule_id);
  }
  const missedBySchedule = new Map();
  for (const r of rows) {
    if (r.status !== 'missed' || !r.pm_schedule_id) continue;
    const cur = missedBySchedule.get(r.pm_schedule_id);
    if (!cur) missedBySchedule.set(r.pm_schedule_id, { count: 1, oldest: r });
    else {
      cur.count += 1;
      if (String(r.due_date) < String(cur.oldest.due_date)) cur.oldest = r;
    }
  }
  const out = [];
  for (const r of rows) {
    if (r.status !== 'missed') {
      const m = r.pm_schedule_id ? missedBySchedule.get(r.pm_schedule_id) : null;
      out.push(m ? { ...r, missed_count: m.count, missed_since: m.oldest.due_date } : r);
      continue;
    }
    // A one-off missed task has nothing to fold into and nothing to replace it.
    if (!r.pm_schedule_id) { out.push(r); continue; }
    if (live.has(r.pm_schedule_id)) continue; // folded onto the live card above
    const m = missedBySchedule.get(r.pm_schedule_id);
    if (m && m.oldest.id === r.id) out.push({ ...r, missed_count: m.count, missed_since: m.oldest.due_date });
  }
  return out;
}

router.get('/operator-tasks', (req, res) => {
  const db = getDb();
  runPmHousekeeping(db);
  const { assigned_to } = req.query;
  // Only admins may view other departments (or all) via the group filter.
  // Everyone else — including supervisors — is locked to their own department.
  const canViewAll = req.user?.role === 'admin';
  const group = canViewAll ? req.query.group : (req.user?.department || 'warehouse');

  // `description` carries the original wording of a task raised from a chat
  // message. Without it the operator sees only the summarised title — half a
  // sentence, with the instruction it summarises nowhere on the screen.
  let sql = `SELECT wo.id, wo.title, wo.description, wo.status, wo.priority, wo.due_date, wo.assigned_to,
    wo.procedure_steps, wo.pm_schedule_id, wo.task_group,
    wo.issue_flagged, wo.issue_notes, wo.issue_attachments, wo.issue_flagged_by, wo.issue_flagged_at,
    e.name as equipment_name, e.type as equipment_type, e.location, e.asset_id, e.is_food_contact,
    ps.frequency_type, ps.title as schedule_title
    FROM work_orders wo
    LEFT JOIN equipment e ON wo.equipment_id = e.id
    LEFT JOIN pm_schedules ps ON wo.pm_schedule_id = ps.id
    -- 'missed' IS INCLUDED, and leaving it out is why the floor could not see
    -- overdue work. markMissedWorkOrders flips anything past due to 'missed'
    -- on ordinary page loads, so a task due yesterday was already 'missed'
    -- today and dropped out of this list entirely — the Overdue bucket could
    -- never contain anything, and the operator had a one-day window on her own
    -- work. The Task Center's search has always covered missed; this screen
    -- did not, which is the same two-screens-disagreeing bug as the inner join
    -- that hid equipment-less tasks.
    WHERE wo.status IN ('open', 'in_progress', 'overdue', 'missed')`;
  const params = [];

  if (assigned_to) { sql += ' AND wo.assigned_to = ?'; params.push(assigned_to); }
  if (group) { sql += ' AND wo.task_group = ?'; params.push(group); }

  sql += ` ORDER BY
    CASE wo.priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END,
    CASE ps.frequency_type WHEN 'daily' THEN 0 WHEN 'weekly' THEN 1 WHEN 'monthly' THEN 2 WHEN 'quarterly' THEN 3 ELSE 4 END,
    wo.due_date ASC`;

  const rows = db.prepare(sql).all(...params);

  // Pending production-entry sign-offs used to be injected here as virtual
  // "QA Sign-off:" tasks. They are not tasks — they are approvals, and they
  // live in the QA Review Center, which already covers all seven pending-
  // signature sources (production entries, QA inspections, cleaning records,
  // scale verifications, the three sign-out logs) and can clear them in
  // batches. Listing them here as well meant the same work appeared in two
  // places with nothing on either screen saying so.
  //
  // This screen is now only work orders: something to go and do, one at a
  // time. Signing is a review, and reviews happen in QA Review.
  res.json(collapseMissed(rows).map(r => ({ ...r, procedure_steps: safeParse(r.procedure_steps) })));
});

router.put('/schedules/:id/items', (req, res) => {
  const db = getDb();
  const sched = db.prepare('SELECT * FROM pm_schedules WHERE id = ?').get(req.params.id);
  if (!sched) return res.status(404).json({ error: 'PM schedule not found' });
  const { items } = req.body;
  if (!items || !Array.isArray(items)) return res.status(400).json({ error: 'items array required' });
  const stepsJson = JSON.stringify(items);
  db.prepare("UPDATE pm_schedules SET procedure_steps = ?, updated_at = datetime('now') WHERE id = ?")
    .run(stepsJson, req.params.id);
  db.prepare("UPDATE work_orders SET procedure_steps = ? WHERE pm_schedule_id = ? AND status IN ('open','in_progress','overdue')")
    .run(stepsJson, req.params.id);
  logAudit(req.user, 'items_updated', 'pm_schedule', req.params.id, { item_count: items.length });
  res.json(db.prepare('SELECT * FROM pm_schedules WHERE id = ?').get(req.params.id));
});

export default router;
