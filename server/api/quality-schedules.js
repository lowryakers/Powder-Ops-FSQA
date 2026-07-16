import { Router } from 'express';
import { v4 as uuid } from 'uuid';
import { getDb, logAudit } from '../db.js';

const router = Router();

// Quality-Control task scheduling (Phase 2). A quality schedule is a recurring
// verification (hygienic zoning, organoleptic/shelf-life, glass & brittle
// plastic, sanitation, allergen, pest, etc.) that generates QA work orders on a
// calendar frequency — the Quality-side parallel to equipment PM schedules and
// document review scheduling. The schedule advances on its own calendar so a
// missed check is recorded as missed and never piles up.

export const QUALITY_FREQUENCIES = ['daily', 'weekly', 'biweekly', 'monthly', 'quarterly', 'semi_annual', 'annual'];

// SQLite date modifier that moves a date forward by one interval of the schedule.
function advanceModifier(freqType, freqValue) {
  const n = Math.max(1, parseInt(freqValue, 10) || 1);
  switch (freqType) {
    case 'daily': return `+${n} days`;
    case 'weekly': return `+${n * 7} days`;
    case 'biweekly': return `+${n * 14} days`;
    case 'monthly': return `+${n} months`;
    case 'quarterly': return `+${n * 3} months`;
    case 'semi_annual': return `+${n * 6} months`;
    case 'annual': return `+${n * 12} months`;
    default: return `+${n} months`;
  }
}

// Compute the first occurrence strictly in the future, stepping by the interval.
// Caps iterations so a very stale schedule can't spin.
function nextFutureDue(db, current, freqType, freqValue) {
  const mod = advanceModifier(freqType, freqValue);
  let cur = current;
  let guard = 0;
  while (db.prepare('SELECT date(?) <= date(?) x').get(cur, "now").x && guard < 1000) {
    cur = db.prepare('SELECT date(?, ?) d').get(cur, mod).d;
    guard++;
  }
  return cur;
}

// Generate a QA work order for every active schedule that is due (next_due on or
// before today), then advance the schedule to its next future occurrence.
// Idempotent: skips a schedule that still has an open task, and advancing
// next_due past today means a second run the same day is a no-op.
export function generateQualityScheduleTasks(db) {
  let due;
  try {
    due = db.prepare(`SELECT * FROM quality_schedules
      WHERE is_active = 1 AND date(next_due) <= date('now')`).all();
  } catch { return 0; }
  if (!due.length) return 0;
  const hasOpen = db.prepare("SELECT 1 FROM work_orders WHERE quality_schedule_id = ? AND status IN ('open','in_progress','overdue') LIMIT 1");
  const ins = db.prepare(`INSERT INTO work_orders
    (id, title, description, priority, due_date, procedure_steps, task_group, quality_schedule_id, status)
    VALUES (?, ?, ?, 'normal', date('now'), ?, 'qa', ?, 'open')`);
  const advance = db.prepare('UPDATE quality_schedules SET next_due = ?, updated_at = datetime(\'now\') WHERE id = ?');
  let created = 0;
  const tx = db.transaction(() => {
    for (const s of due) {
      if (!hasOpen.get(s.id)) {
        const woId = uuid();
        ins.run(woId, s.title, s.description || 'Scheduled quality check.', s.procedure_steps || '[]', s.id);
        logAudit('system', 'auto_generate', 'work_order', woId, { quality_schedule_id: s.id }, null, null);
        created++;
      }
      // Advance the schedule's calendar past today regardless, so missed checks
      // don't accumulate as a backlog of overdue work orders.
      const nd = nextFutureDue(db, s.next_due, s.frequency_type, s.frequency_value);
      advance.run(nd, s.id);
    }
  });
  tx();
  return created;
}

// Only Quality leadership may define/edit recurring quality checks.
function canManage(user) {
  if (!user) return false;
  if (user.role === 'admin' || user.role === 'supervisor') return true;
  return ['qa', 'quality'].includes((user.department || '').toLowerCase());
}
function requireManage(req, res, next) {
  if (!canManage(req.user)) return res.status(403).json({ error: 'Quality management access required' });
  next();
}

router.get('/', (req, res) => {
  const db = getDb();
  const rows = db.prepare(`
    SELECT qs.*,
      (SELECT COUNT(*) FROM work_orders wo WHERE wo.quality_schedule_id = qs.id) AS task_count,
      (SELECT MAX(completed_at) FROM work_orders wo WHERE wo.quality_schedule_id = qs.id AND wo.status = 'completed') AS last_completed
    FROM quality_schedules qs ORDER BY qs.is_active DESC, qs.next_due ASC`).all();
  res.json(rows);
});

router.post('/', requireManage, (req, res) => {
  const db = getDb();
  const { title, description, module_id, frequency_type, frequency_value, procedure_steps, first_due } = req.body;
  if (!title || !title.trim()) return res.status(400).json({ error: 'Title is required' });
  const freq = QUALITY_FREQUENCIES.includes(frequency_type) ? frequency_type : 'monthly';
  const id = uuid();
  // First due date defaults to today, so the first task generates right away.
  const nextDue = (first_due && /^\d{4}-\d{2}-\d{2}$/.test(first_due))
    ? first_due
    : db.prepare("SELECT date('now') d").get().d;
  db.prepare(`INSERT INTO quality_schedules
    (id, title, description, module_id, frequency_type, frequency_value, procedure_steps, next_due, is_active)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`).run(
    id, title.trim(), description || null, module_id || null, freq,
    Math.max(1, parseInt(frequency_value, 10) || 1),
    JSON.stringify(Array.isArray(procedure_steps) ? procedure_steps : []), nextDue
  );
  logAudit(req.user, 'quality_schedule_created', 'quality_schedule', id, { title, frequency_type: freq });
  // Generate the first task immediately if it's already due.
  generateQualityScheduleTasks(db);
  res.status(201).json(db.prepare('SELECT * FROM quality_schedules WHERE id = ?').get(id));
});

router.put('/:id', requireManage, (req, res) => {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM quality_schedules WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Not found' });
  const { title, description, module_id, frequency_type, frequency_value, procedure_steps, next_due, is_active } = req.body;
  const freq = QUALITY_FREQUENCIES.includes(frequency_type) ? frequency_type : existing.frequency_type;
  db.prepare(`UPDATE quality_schedules SET
    title=?, description=?, module_id=?, frequency_type=?, frequency_value=?, procedure_steps=?, next_due=?, is_active=?, updated_at=datetime('now')
    WHERE id=?`).run(
    title ?? existing.title, description ?? existing.description, module_id ?? existing.module_id,
    freq, frequency_value != null ? Math.max(1, parseInt(frequency_value, 10) || 1) : existing.frequency_value,
    procedure_steps !== undefined ? JSON.stringify(Array.isArray(procedure_steps) ? procedure_steps : []) : existing.procedure_steps,
    (next_due && /^\d{4}-\d{2}-\d{2}$/.test(next_due)) ? next_due : existing.next_due,
    is_active !== undefined ? (is_active ? 1 : 0) : existing.is_active,
    req.params.id
  );
  logAudit(req.user, 'quality_schedule_updated', 'quality_schedule', req.params.id, { title: title ?? existing.title });
  res.json(db.prepare('SELECT * FROM quality_schedules WHERE id = ?').get(req.params.id));
});

router.delete('/:id', requireManage, (req, res) => {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM quality_schedules WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Not found' });
  db.prepare('DELETE FROM quality_schedules WHERE id = ?').run(req.params.id);
  logAudit(req.user, 'quality_schedule_deleted', 'quality_schedule', req.params.id, { title: existing.title });
  res.json({ deleted: req.params.id });
});

export default router;
