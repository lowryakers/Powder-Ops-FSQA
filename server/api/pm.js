import { Router } from 'express';
import { v4 as uuid } from 'uuid';
import { getDb, logAudit } from '../db.js';

const router = Router();

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

  res.json({ ...sched, procedure_steps: JSON.parse(sched.procedure_steps || '[]'), recent_work_orders: recentWOs });
});

router.post('/schedules', (req, res) => {
  const db = getDb();
  const id = uuid();
  const { equipment_id, title, description, frequency_type, frequency_value, procedure_steps, lubricant_type, is_food_grade_lubricant, estimated_minutes, haccp_ccp_id } = req.body;

  if (!equipment_id || !title || !frequency_type) {
    return res.status(400).json({ error: 'equipment_id, title, and frequency_type are required' });
  }

  db.prepare(`
    INSERT INTO pm_schedules (id, equipment_id, title, description, frequency_type, frequency_value, procedure_steps, lubricant_type, is_food_grade_lubricant, estimated_minutes, haccp_ccp_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, equipment_id, title, description || null, frequency_type, frequency_value || 1,
    JSON.stringify(procedure_steps || []), lubricant_type || null,
    is_food_grade_lubricant ? 1 : 0, estimated_minutes || null, haccp_ccp_id || null);

  const created = db.prepare('SELECT * FROM pm_schedules WHERE id = ?').get(id);
  logAudit(req.body._actor || 'system', 'create', 'pm_schedule', id, { title, equipment_id }, null, created);
  res.status(201).json(created);
});

router.put('/schedules/:id', (req, res) => {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM pm_schedules WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'PM schedule not found' });

  const { title, description, frequency_type, frequency_value, procedure_steps, lubricant_type, is_food_grade_lubricant, estimated_minutes, haccp_ccp_id, is_active } = req.body;

  db.prepare(`
    UPDATE pm_schedules SET title=?, description=?, frequency_type=?, frequency_value=?,
    procedure_steps=?, lubricant_type=?, is_food_grade_lubricant=?, estimated_minutes=?,
    haccp_ccp_id=?, is_active=?, updated_at=datetime('now') WHERE id=?
  `).run(
    title || existing.title, description ?? existing.description,
    frequency_type || existing.frequency_type, frequency_value ?? existing.frequency_value,
    procedure_steps ? JSON.stringify(procedure_steps) : existing.procedure_steps,
    lubricant_type ?? existing.lubricant_type,
    is_food_grade_lubricant !== undefined ? (is_food_grade_lubricant ? 1 : 0) : existing.is_food_grade_lubricant,
    estimated_minutes ?? existing.estimated_minutes, haccp_ccp_id ?? existing.haccp_ccp_id,
    is_active !== undefined ? (is_active ? 1 : 0) : existing.is_active, req.params.id
  );

  const updated = db.prepare('SELECT * FROM pm_schedules WHERE id = ?').get(req.params.id);
  logAudit(req.body._actor || 'system', 'update', 'pm_schedule', req.params.id, null, existing, updated);
  res.json(updated);
});

// --- Work Orders ---

router.get('/work-orders', (req, res) => {
  const db = getDb();
  const { status, equipment_id, from, to, assigned_to } = req.query;
  let sql = `SELECT wo.*, e.name as equipment_name, e.room, ps.title as pm_title, ps.frequency_type
    FROM work_orders wo
    JOIN equipment e ON wo.equipment_id = e.id
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
    FROM work_orders wo JOIN equipment e ON wo.equipment_id = e.id
    LEFT JOIN pm_schedules ps ON wo.pm_schedule_id = ps.id WHERE wo.id = ?`).get(req.params.id);
  if (!wo) return res.status(404).json({ error: 'Work order not found' });

  const history = db.prepare(
    "SELECT * FROM audit_log WHERE entity_type = 'work_order' AND entity_id = ? ORDER BY timestamp ASC"
  ).all(req.params.id);

  res.json({ ...wo, procedure_steps: JSON.parse(wo.procedure_steps || '[]'), step_completions: JSON.parse(wo.step_completions || '[]'), history });
});

router.post('/work-orders', (req, res) => {
  const db = getDb();
  const id = uuid();
  const { pm_schedule_id, equipment_id, title, description, priority, assigned_to, due_date, procedure_steps } = req.body;

  if (!equipment_id || !title || !due_date) {
    return res.status(400).json({ error: 'equipment_id, title, and due_date are required' });
  }

  db.prepare(`
    INSERT INTO work_orders (id, pm_schedule_id, equipment_id, title, description, priority, assigned_to, due_date, procedure_steps)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, pm_schedule_id || null, equipment_id, title, description || null,
    priority || 'normal', assigned_to || null, due_date, JSON.stringify(procedure_steps || []));

  const created = db.prepare('SELECT * FROM work_orders WHERE id = ?').get(id);
  logAudit(req.body._actor || 'system', 'create', 'work_order', id, { title, equipment_id, due_date }, null, created);
  res.status(201).json(created);
});

router.put('/work-orders/:id', (req, res) => {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM work_orders WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Work order not found' });

  const { status, assigned_to, notes, lubricant_used, lubricant_is_food_grade, step_completions, priority } = req.body;

  const newStatus = status || existing.status;
  const completedAt = (newStatus === 'completed' && existing.status !== 'completed') ? new Date().toISOString() : existing.completed_at;
  const completedBy = (newStatus === 'completed' && existing.status !== 'completed') ? (req.body._actor || req.body.completed_by || 'system') : existing.completed_by;
  const startedAt = (newStatus === 'in_progress' && !existing.started_at) ? new Date().toISOString() : existing.started_at;

  db.prepare(`
    UPDATE work_orders SET status=?, priority=?, assigned_to=?, started_at=?, completed_at=?,
    completed_by=?, notes=?, lubricant_used=?, lubricant_is_food_grade=?,
    step_completions=?, updated_at=datetime('now') WHERE id=?
  `).run(
    newStatus, priority || existing.priority, assigned_to ?? existing.assigned_to,
    startedAt, completedAt, completedBy,
    notes ?? existing.notes, lubricant_used ?? existing.lubricant_used,
    lubricant_is_food_grade !== undefined ? (lubricant_is_food_grade ? 1 : 0) : existing.lubricant_is_food_grade,
    step_completions ? JSON.stringify(step_completions) : existing.step_completions,
    req.params.id
  );

  const updated = db.prepare('SELECT * FROM work_orders WHERE id = ?').get(req.params.id);
  logAudit(req.body._actor || 'system', 'update', 'work_order', req.params.id, { status: newStatus }, existing, updated);
  res.json(updated);
});

// --- PM Completion Metrics ---

router.get('/metrics', (req, res) => {
  const db = getDb();
  const { from, to } = req.query;
  const now = new Date();
  const defaultFrom = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
  const defaultTo = now.toISOString().split('T')[0];
  const start = from || defaultFrom;
  const end = to || defaultTo;

  const total = db.prepare('SELECT COUNT(*) as count FROM work_orders WHERE due_date BETWEEN ? AND ?').get(start, end);
  const completed = db.prepare("SELECT COUNT(*) as count FROM work_orders WHERE due_date BETWEEN ? AND ? AND status = 'completed'").get(start, end);
  const overdue = db.prepare("SELECT COUNT(*) as count FROM work_orders WHERE due_date < ? AND status IN ('open','in_progress','overdue')").get(end);
  const open = db.prepare("SELECT COUNT(*) as count FROM work_orders WHERE status IN ('open','in_progress')").get();

  const completionRate = total.count > 0 ? ((completed.count / total.count) * 100).toFixed(1) : 0;

  const byEquipment = db.prepare(`
    SELECT e.name, e.room, COUNT(*) as total,
      SUM(CASE WHEN wo.status = 'completed' THEN 1 ELSE 0 END) as completed
    FROM work_orders wo JOIN equipment e ON wo.equipment_id = e.id
    WHERE wo.due_date BETWEEN ? AND ?
    GROUP BY wo.equipment_id ORDER BY e.name
  `).all(start, end);

  const monthlyTrend = db.prepare(`
    SELECT strftime('%Y-%m', due_date) as month,
      COUNT(*) as total,
      SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed
    FROM work_orders GROUP BY strftime('%Y-%m', due_date) ORDER BY month DESC LIMIT 12
  `).all();

  res.json({
    period: { from: start, to: end },
    total: total.count,
    completed: completed.count,
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

  const { notes, lubricant_used, lubricant_is_food_grade, _actor } = req.body;
  const completedAt = new Date().toISOString();
  const completedBy = _actor || 'system';

  db.prepare(`
    UPDATE work_orders SET status='completed', completed_at=?, completed_by=?,
    notes=?, lubricant_used=?, lubricant_is_food_grade=?, updated_at=datetime('now') WHERE id=?
  `).run(completedAt, completedBy, notes || null, lubricant_used || null,
    lubricant_is_food_grade ? 1 : 0, req.params.id);

  logAudit(completedBy, 'complete', 'work_order', req.params.id, { notes }, null, null);

  let nextWO = null;
  if (existing.pm_schedule_id) {
    const sched = db.prepare('SELECT * FROM pm_schedules WHERE id = ?').get(existing.pm_schedule_id);
    if (sched && sched.is_active) {
      const freqDays = { daily: 1, weekly: 7, biweekly: 14, monthly: 30, quarterly: 90, semi_annual: 182, annual: 365 };
      const interval = (freqDays[sched.frequency_type] || 30) * (sched.frequency_value || 1);
      const nextDue = new Date();
      nextDue.setDate(nextDue.getDate() + interval);
      const woId = uuid();
      db.prepare(`
        INSERT INTO work_orders (id, pm_schedule_id, equipment_id, title, due_date, procedure_steps, status)
        VALUES (?, ?, ?, ?, ?, ?, 'open')
      `).run(woId, sched.id, sched.equipment_id, sched.title, nextDue.toISOString().split('T')[0], sched.procedure_steps);
      logAudit('system', 'auto_generate', 'work_order', woId, { pm_schedule_id: sched.id, triggered_by: req.params.id }, null, null);
      nextWO = { id: woId, title: sched.title, due_date: nextDue.toISOString().split('T')[0] };
    }
  }

  res.json({ completed: req.params.id, next_work_order: nextWO });
});

// --- PM Schedules grouped by frequency ---

router.get('/by-frequency', (req, res) => {
  const db = getDb();
  const { frequency, equipment_id } = req.query;

  let sql = `SELECT wo.*, e.name as equipment_name, e.type as equipment_type, e.location,
    e.asset_id, ps.title as pm_title, ps.frequency_type, ps.procedure_steps as pm_steps
    FROM work_orders wo
    JOIN equipment e ON wo.equipment_id = e.id
    LEFT JOIN pm_schedules ps ON wo.pm_schedule_id = ps.id
    WHERE wo.status IN ('open', 'in_progress', 'overdue')`;
  const params = [];

  if (frequency) { sql += ' AND ps.frequency_type = ?'; params.push(frequency); }
  if (equipment_id) { sql += ' AND wo.equipment_id = ?'; params.push(equipment_id); }

  sql += ' ORDER BY ps.frequency_type, e.name';

  const rows = db.prepare(sql).all(...params);

  const grouped = {};
  for (const r of rows) {
    const freq = r.frequency_type || 'unscheduled';
    if (!grouped[freq]) grouped[freq] = [];
    grouped[freq].push({ ...r, procedure_steps: JSON.parse(r.pm_steps || r.procedure_steps || '[]') });
  }

  res.json(grouped);
});

// --- Completed PM history (archive) ---

router.get('/completed-history', (req, res) => {
  const db = getDb();
  const { limit = 50, offset = 0, frequency } = req.query;

  let sql = `SELECT wo.*, e.name as equipment_name, e.type as equipment_type, e.location,
    e.asset_id, ps.title as pm_title, ps.frequency_type
    FROM work_orders wo
    JOIN equipment e ON wo.equipment_id = e.id
    LEFT JOIN pm_schedules ps ON wo.pm_schedule_id = ps.id
    WHERE wo.status = 'completed'`;
  const params = [];

  if (frequency) { sql += ' AND ps.frequency_type = ?'; params.push(frequency); }

  sql += ' ORDER BY wo.completed_at DESC LIMIT ? OFFSET ?';
  params.push(parseInt(limit), parseInt(offset));

  const rows = db.prepare(sql).all(...params);
  const total = db.prepare(`SELECT COUNT(*) as c FROM work_orders wo LEFT JOIN pm_schedules ps ON wo.pm_schedule_id = ps.id WHERE wo.status = 'completed'${frequency ? ' AND ps.frequency_type = ?' : ''}`).get(...(frequency ? [frequency] : []));

  res.json({ items: rows, total: total.c });
});

// --- Generate Work Orders from PM Schedules ---

router.post('/generate', (_req, res) => {
  const db = getDb();
  const schedules = db.prepare('SELECT * FROM pm_schedules WHERE is_active = 1').all();
  const generated = [];

  const freqDays = { daily: 1, weekly: 7, biweekly: 14, monthly: 30, quarterly: 90, semi_annual: 182, annual: 365 };

  for (const sched of schedules) {
    const lastWO = db.prepare(
      'SELECT due_date FROM work_orders WHERE pm_schedule_id = ? ORDER BY due_date DESC LIMIT 1'
    ).get(sched.id);

    const interval = (freqDays[sched.frequency_type] || 30) * (sched.frequency_value || 1);

    const lastDate = lastWO ? new Date(lastWO.due_date) : new Date();
    const nextDue = new Date(lastDate);
    nextDue.setDate(nextDue.getDate() + interval);

    const horizon = new Date();
    horizon.setDate(horizon.getDate() + 30);

    if (nextDue <= horizon) {
      const woId = uuid();
      db.prepare(`
        INSERT INTO work_orders (id, pm_schedule_id, equipment_id, title, description, due_date, procedure_steps)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(woId, sched.id, sched.equipment_id, sched.title,
        sched.description, nextDue.toISOString().split('T')[0], sched.procedure_steps);

      generated.push({ id: woId, title: sched.title, due_date: nextDue.toISOString().split('T')[0] });
      logAudit('system', 'auto_generate', 'work_order', woId, { pm_schedule_id: sched.id }, null, null);
    }
  }

  res.json({ generated: generated.length, work_orders: generated });
});

// --- Operator view: simplified task list ---

router.get('/operator-tasks', (req, res) => {
  const db = getDb();
  const { assigned_to } = req.query;

  let sql = `SELECT wo.id, wo.title, wo.status, wo.priority, wo.due_date, wo.assigned_to,
    wo.procedure_steps, wo.pm_schedule_id,
    e.name as equipment_name, e.type as equipment_type, e.location, e.asset_id,
    ps.frequency_type
    FROM work_orders wo
    JOIN equipment e ON wo.equipment_id = e.id
    LEFT JOIN pm_schedules ps ON wo.pm_schedule_id = ps.id
    WHERE wo.status IN ('open', 'in_progress', 'overdue')`;
  const params = [];

  if (assigned_to) { sql += ' AND wo.assigned_to = ?'; params.push(assigned_to); }

  sql += ` ORDER BY
    CASE wo.priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END,
    CASE ps.frequency_type WHEN 'daily' THEN 0 WHEN 'weekly' THEN 1 WHEN 'monthly' THEN 2 WHEN 'quarterly' THEN 3 ELSE 4 END,
    wo.due_date ASC`;

  const rows = db.prepare(sql).all(...params);
  res.json(rows.map(r => ({ ...r, procedure_steps: JSON.parse(r.procedure_steps || '[]') })));
});

export default router;
