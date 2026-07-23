import { Router } from 'express';
import { v4 as uuid } from 'uuid';
import { getDb, logAudit } from '../db.js';
import { requireDepartment } from '../middleware/auth.js';
import { generateDocumentReviewTasks, recomputeDocumentReview } from './documents.js';
import { generateQualityScheduleTasks } from './quality-schedules.js';
import { getChannelByName, postMessageAs } from './comms.js';
import { pushToUser } from '../push.js';

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

function markMissedWorkOrders(db) {
  const today = new Date().toISOString().split('T')[0];

  // Mark past-due open WOs as missed
  db.prepare(`
    UPDATE work_orders SET status = 'missed', updated_at = datetime('now')
    WHERE status IN ('open', 'overdue') AND due_date < ?
  `).run(today);

  // Ensure every active PM schedule has at least one open WO
  const orphaned = db.prepare(`
    SELECT ps.* FROM pm_schedules ps
    WHERE ps.is_active = 1
    AND NOT EXISTS (
      SELECT 1 FROM work_orders wo
      WHERE wo.pm_schedule_id = ps.id AND wo.status IN ('open', 'in_progress')
    )
  `).all();

  if (orphaned.length > 0) {
    const insertWO = db.prepare(`INSERT INTO work_orders (id, pm_schedule_id, equipment_id, title, due_date, procedure_steps, task_group, status) VALUES (?, ?, ?, ?, ?, ?, ?, 'open')`);
    const checkExisting = db.prepare(`SELECT 1 FROM work_orders WHERE pm_schedule_id = ? AND status IN ('open', 'in_progress') LIMIT 1`);
    const tx = db.transaction(() => {
      for (const sched of orphaned) {
        if (checkExisting.get(sched.id)) continue;
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
  markMissedWorkOrders(db);
  const { status, equipment_id, from, to, assigned_to } = req.query;
  let sql = `SELECT wo.*, e.name as equipment_name, e.room, ps.title as pm_title, ps.frequency_type
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
  const wo = db.prepare(`SELECT wo.*, e.name as equipment_name, e.room, ps.title as pm_title
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
  }

  const updated = db.prepare('SELECT * FROM work_orders WHERE id = ?').get(req.params.id);
  logAudit(req.user, 'update', 'work_order', req.params.id, { status: newStatus }, existing, updated);
  res.json(updated);
});

// --- PM Completion Metrics ---

router.get('/metrics', (req, res) => {
  const db = getDb();
  markMissedWorkOrders(db);
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

  db.prepare(`
    UPDATE work_orders SET status='completed', completed_at=?, completed_by=?,
    notes=?, lubricant_used=?, lubricant_is_food_grade=?,
    readings=?, step_results=?, reading_result=?,
    clearance_required=?, clearance_status=?,
    chemical_id=?,
    updated_at=datetime('now') WHERE id=?
  `).run(completedAt, completedBy, notes || null, lubricant_used || null,
    lubricant_is_food_grade ? 1 : 0,
    JSON.stringify(readings || {}), JSON.stringify(step_results || []), reading_result || null,
    needsClearance, needsClearance ? 'pending' : null,
    req.body.chemical_id || null,
    req.params.id);

  logAudit(completedBy, 'complete', 'work_order', req.params.id, { notes, readings, reading_result }, null, null);
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
    updated_at=datetime('now') WHERE id=?
  `);
  const getWO = db.prepare('SELECT * FROM work_orders WHERE id = ?');
  const getSched = db.prepare('SELECT * FROM pm_schedules WHERE id = ?');
  const getEq = db.prepare('SELECT is_food_contact FROM equipment WHERE id = ?');

  const batchRun = db.transaction(() => {
    for (const id of ids) {
      const wo = getWO.get(id);
      if (!wo || wo.status === 'completed') continue;
      completeStmt.run(completedAt, completedBy, id);

      const eq = getEq.get(wo.equipment_id);
      const needsClearance = eq && eq.is_food_contact === 1 ? 1 : 0;
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
  res.json({ completed: results.length, ids: results });
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

router.get('/clearance-pending', (req, res) => {
  const db = getDb();
  const rows = db.prepare(`
    SELECT wo.*, e.name as equipment_name, e.location, e.asset_id, e.room
    FROM work_orders wo
    JOIN equipment e ON wo.equipment_id = e.id
    WHERE wo.clearance_required = 1 AND wo.clearance_status = 'pending'
    ORDER BY wo.completed_at DESC
  `).all();
  res.json(rows);
});

// --- PM Schedules grouped by frequency ---

router.get('/by-frequency', (req, res) => {
  const db = getDb();
  markMissedWorkOrders(db);
  const { frequency, equipment_id, group } = req.query;

  let sql = `SELECT wo.*, e.name as equipment_name, e.type as equipment_type, e.location,
    e.asset_id, ps.title as pm_title, ps.frequency_type, ps.procedure_steps as pm_steps
    FROM work_orders wo
    JOIN equipment e ON wo.equipment_id = e.id
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
  markMissedWorkOrders(db);
  const { limit = 50, offset = 0, frequency, from, to, include_missed, group } = req.query;
  const showMissed = include_missed !== 'false';

  const statusFilter = showMissed ? "wo.status IN ('completed','missed','not_applicable')" : "wo.status IN ('completed','not_applicable')";
  const dateCol = 'COALESCE(wo.completed_at, wo.due_date)';

  let sql = `SELECT wo.*, e.name as equipment_name, e.type as equipment_type, e.location,
    e.asset_id, ps.title as pm_title, ps.frequency_type
    FROM work_orders wo
    JOIN equipment e ON wo.equipment_id = e.id
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
  const schedules = db.prepare('SELECT * FROM pm_schedules WHERE is_active = 1').all();
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

router.get('/operator-tasks', (req, res) => {
  const db = getDb();
  markMissedWorkOrders(db);
  generateDocumentReviewTasks(db);
  generateQualityScheduleTasks(db);
  const { assigned_to } = req.query;
  // Only admins may view other departments (or all) via the group filter.
  // Everyone else — including supervisors — is locked to their own department.
  const canViewAll = req.user?.role === 'admin';
  const group = canViewAll ? req.query.group : (req.user?.department || 'warehouse');

  let sql = `SELECT wo.id, wo.title, wo.status, wo.priority, wo.due_date, wo.assigned_to,
    wo.procedure_steps, wo.pm_schedule_id, wo.task_group,
    wo.issue_flagged, wo.issue_notes, wo.issue_attachments, wo.issue_flagged_by, wo.issue_flagged_at,
    e.name as equipment_name, e.type as equipment_type, e.location, e.asset_id,
    ps.frequency_type, ps.title as schedule_title
    FROM work_orders wo
    LEFT JOIN equipment e ON wo.equipment_id = e.id
    LEFT JOIN pm_schedules ps ON wo.pm_schedule_id = ps.id
    WHERE wo.status IN ('open', 'in_progress', 'overdue')`;
  const params = [];

  if (assigned_to) { sql += ' AND wo.assigned_to = ?'; params.push(assigned_to); }
  if (group) { sql += ' AND wo.task_group = ?'; params.push(group); }

  sql += ` ORDER BY
    CASE wo.priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END,
    CASE ps.frequency_type WHEN 'daily' THEN 0 WHEN 'weekly' THEN 1 WHEN 'monthly' THEN 2 WHEN 'quarterly' THEN 3 ELSE 4 END,
    wo.due_date ASC`;

  const rows = db.prepare(sql).all(...params);

  // Also include pending QA production entries as virtual tasks (for QA dept or admin/all view)
  const qaGroup = group || '';
  const includeQA = !qaGroup || qaGroup === 'qa' || qaGroup === 'all' || qaGroup === '';
  let qaTasks = [];
  if (includeQA) {
    qaTasks = db.prepare(`
      SELECT id, date, team, room, product_name, mo_number, lot_number, submitted_by, created_at
      FROM production_entries
      WHERE qa_signoff_by IS NULL
      ORDER BY date DESC
    `).all().map(e => ({
      id: 'qa_' + e.id,
      _production_entry_id: e.id,
      title: `QA Sign-off: ${e.product_name} (MO ${e.mo_number})`,
      status: 'open',
      priority: 'normal',
      due_date: e.date,
      assigned_to: null,
      procedure_steps: [],
      pm_schedule_id: null,
      task_group: 'qa',
      task_type: 'qa_signoff',
      issue_flagged: 0,
      equipment_name: e.room,
      equipment_type: 'production',
      location: e.room,
      asset_id: null,
      frequency_type: null,
      schedule_title: null,
      _qa_meta: { lot_number: e.lot_number, submitted_by: e.submitted_by, team: e.team, date: e.date, mo_number: e.mo_number, product_name: e.product_name },
    }));
  }

  res.json([...rows.map(r => ({ ...r, procedure_steps: safeParse(r.procedure_steps) })), ...qaTasks]);
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
