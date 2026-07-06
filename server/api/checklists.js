import { Router } from 'express';
import { v4 as uuid } from 'uuid';
import { getDb, logAudit } from '../db.js';

const router = Router();

function calcNextDueDate(frequency, fromDate) {
  const d = fromDate ? new Date(fromDate) : new Date();
  switch (frequency) {
    case 'per_shift': d.setHours(d.getHours() + 8); break;
    case 'daily': d.setDate(d.getDate() + 1); break;
    case 'weekly': d.setDate(d.getDate() + 7); break;
    case 'monthly': d.setMonth(d.getMonth() + 1); break;
    case 'quarterly': d.setMonth(d.getMonth() + 3); break;
    case 'annual': d.setFullYear(d.getFullYear() + 1); break;
    default: d.setDate(d.getDate() + 1);
  }
  return d.toISOString().split('T')[0];
}

function ensureInstances(db, templateId) {
  const tmpl = db.prepare('SELECT * FROM checklist_templates WHERE id = ? AND is_active = 1').get(templateId);
  if (!tmpl) return;
  const today = new Date().toISOString().split('T')[0];
  const pending = db.prepare(
    "SELECT id FROM checklist_instances WHERE checklist_id = ? AND status = 'pending' AND due_date >= ?"
  ).get(templateId, today);
  if (!pending) {
    const id = uuid();
    db.prepare('INSERT INTO checklist_instances (id, checklist_id, due_date) VALUES (?, ?, ?)').run(id, templateId, today);
  }
}

function ensureAllInstances(db) {
  const templates = db.prepare('SELECT id FROM checklist_templates WHERE is_active = 1').all();
  for (const t of templates) ensureInstances(db, t.id);
}

// --- Templates ---

router.get('/templates', (req, res) => {
  const db = getDb();
  const { type, active } = req.query;
  let sql = 'SELECT * FROM checklist_templates WHERE 1=1';
  const params = [];
  if (type) { sql += ' AND type = ?'; params.push(type); }
  if (active !== undefined) { sql += ' AND is_active = ?'; params.push(active === 'true' ? 1 : 0); }
  sql += ' ORDER BY type, name';
  res.json(db.prepare(sql).all(...params));
});

router.get('/templates/:id', (req, res) => {
  const db = getDb();
  const tmpl = db.prepare('SELECT * FROM checklist_templates WHERE id = ?').get(req.params.id);
  if (!tmpl) return res.status(404).json({ error: 'Template not found' });
  try { res.json({ ...tmpl, items: JSON.parse(tmpl.items || '[]') }); } catch { res.json({ ...tmpl, items: [] }); }
});

router.post('/templates', (req, res) => {
  const db = getDb();
  const id = uuid();
  const { name, type, frequency, description, items } = req.body;
  if (!name || !type) return res.status(400).json({ error: 'name and type are required' });

  db.prepare(`
    INSERT INTO checklist_templates (id, name, type, frequency, description, items)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, name, type, frequency || 'daily', description || null, JSON.stringify(items || []));

  ensureInstances(db, id);

  const created = db.prepare('SELECT * FROM checklist_templates WHERE id = ?').get(id);
  logAudit(req.user.name, 'create', 'checklist_template', id, { name, type }, null, created);
  res.status(201).json(created);
});

router.put('/templates/:id', (req, res) => {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM checklist_templates WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Template not found' });

  const { name, type, frequency, description, items, is_active } = req.body;
  db.prepare(`
    UPDATE checklist_templates SET name=?, type=?, frequency=?, description=?, items=?, is_active=?, updated_at=datetime('now') WHERE id=?
  `).run(
    name || existing.name, type || existing.type, frequency || existing.frequency,
    description ?? existing.description, items ? JSON.stringify(items) : existing.items,
    is_active !== undefined ? (is_active ? 1 : 0) : existing.is_active, req.params.id
  );

  if (is_active !== undefined && is_active) ensureInstances(db, req.params.id);

  const updated = db.prepare('SELECT * FROM checklist_templates WHERE id = ?').get(req.params.id);
  logAudit(req.user.name, 'update', 'checklist_template', req.params.id, null, existing, updated);
  res.json(updated);
});

// --- Instances (recurring schedule) ---

router.get('/due', (req, res) => {
  const db = getDb();
  ensureAllInstances(db);

  const today = new Date().toISOString().split('T')[0];
  db.prepare(
    "UPDATE checklist_instances SET status = 'overdue' WHERE status = 'pending' AND due_date < ?"
  ).run(today);

  const { status } = req.query;
  let sql = `
    SELECT ci.*, ct.name, ct.type, ct.frequency, ct.description, ct.items
    FROM checklist_instances ci
    JOIN checklist_templates ct ON ci.checklist_id = ct.id
    WHERE ct.is_active = 1
  `;
  const params = [];

  if (status === 'pending') {
    sql += " AND ci.status IN ('pending', 'overdue')";
  } else if (status === 'completed') {
    sql += " AND ci.status = 'completed'";
  } else {
    sql += " AND ci.status IN ('pending', 'overdue')";
  }

  sql += ' ORDER BY ci.due_date ASC, ct.type, ct.name';
  const rows = db.prepare(sql).all(...params);
  res.json(rows.map(r => { try { return { ...r, items: JSON.parse(r.items || '[]') }; } catch { return { ...r, items: [] }; } }));
});

router.get('/history', (req, res) => {
  const db = getDb();
  const { checklist_id, limit } = req.query;
  let sql = `
    SELECT ci.*, ct.name, ct.type, ct.frequency
    FROM checklist_instances ci
    JOIN checklist_templates ct ON ci.checklist_id = ct.id
    WHERE ci.status = 'completed'
  `;
  const params = [];
  if (checklist_id) { sql += ' AND ci.checklist_id = ?'; params.push(checklist_id); }
  sql += ' ORDER BY ci.completed_at DESC';
  sql += ` LIMIT ${parseInt(limit) || 50}`;
  res.json(db.prepare(sql).all(...params));
});

router.post('/instances/:id/complete', (req, res) => {
  const db = getDb();
  const instance = db.prepare('SELECT * FROM checklist_instances WHERE id = ?').get(req.params.id);
  if (!instance) return res.status(404).json({ error: 'Instance not found' });
  if (instance.status === 'completed') return res.status(400).json({ error: 'Already completed' });

  const { submitted_by, responses, overall_status, notes, corrective_action_taken } = req.body;
  if (!submitted_by || !responses) return res.status(400).json({ error: 'submitted_by and responses required' });

  const template = db.prepare('SELECT * FROM checklist_templates WHERE id = ?').get(instance.checklist_id);
  if (!template) return res.status(404).json({ error: 'Template not found' });

  const subId = uuid();
  db.prepare(`
    INSERT INTO checklist_submissions (id, checklist_id, submitted_by, responses, overall_status, notes, corrective_action_taken)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(subId, instance.checklist_id, submitted_by, JSON.stringify(responses),
    overall_status || 'pass', notes || null, corrective_action_taken || null);

  db.prepare(`
    UPDATE checklist_instances SET status = 'completed', submission_id = ?, completed_by = ?, completed_at = datetime('now') WHERE id = ?
  `).run(subId, submitted_by, req.params.id);

  const nextDue = calcNextDueDate(template.frequency);
  const nextId = uuid();
  db.prepare('INSERT INTO checklist_instances (id, checklist_id, due_date) VALUES (?, ?, ?)').run(nextId, instance.checklist_id, nextDue);

  logAudit(submitted_by, 'complete', 'checklist_instance', req.params.id, {
    checklist_id: instance.checklist_id,
    overall_status: overall_status || 'pass',
    next_due: nextDue,
  }, null, null);

  res.json({ completed: req.params.id, submission_id: subId, next_instance: nextId, next_due: nextDue });
});

router.post('/instances/:id/skip', (req, res) => {
  const db = getDb();
  const instance = db.prepare('SELECT * FROM checklist_instances WHERE id = ?').get(req.params.id);
  if (!instance) return res.status(404).json({ error: 'Instance not found' });

  db.prepare("UPDATE checklist_instances SET status = 'skipped' WHERE id = ?").run(req.params.id);

  const template = db.prepare('SELECT * FROM checklist_templates WHERE id = ?').get(instance.checklist_id);
  if (template) {
    const nextDue = calcNextDueDate(template.frequency);
    const nextId = uuid();
    db.prepare('INSERT INTO checklist_instances (id, checklist_id, due_date) VALUES (?, ?, ?)').run(nextId, instance.checklist_id, nextDue);
  }

  logAudit(req.user.name, 'skip', 'checklist_instance', req.params.id, null, null, null);
  res.json({ skipped: req.params.id });
});

// --- Submissions (legacy direct access) ---

router.get('/submissions', (req, res) => {
  const db = getDb();
  const { checklist_id, from, to, status, submitted_by } = req.query;
  let sql = `SELECT cs.*, ct.name as checklist_name, ct.type as checklist_type
    FROM checklist_submissions cs JOIN checklist_templates ct ON cs.checklist_id = ct.id WHERE 1=1`;
  const params = [];

  if (checklist_id) { sql += ' AND cs.checklist_id = ?'; params.push(checklist_id); }
  if (status) { sql += ' AND cs.overall_status = ?'; params.push(status); }
  if (submitted_by) { sql += ' AND cs.submitted_by = ?'; params.push(submitted_by); }
  if (from) { sql += ' AND cs.submitted_at >= ?'; params.push(from); }
  if (to) { sql += ' AND cs.submitted_at <= ?'; params.push(to); }

  sql += ' ORDER BY cs.submitted_at DESC';
  res.json(db.prepare(sql).all(...params));
});

router.post('/submissions', (req, res) => {
  const db = getDb();
  const id = uuid();
  const { checklist_id, submitted_by, responses, overall_status, notes, corrective_action_taken } = req.body;

  if (!checklist_id || !submitted_by || !responses) {
    return res.status(400).json({ error: 'checklist_id, submitted_by, and responses are required' });
  }

  const template = db.prepare('SELECT * FROM checklist_templates WHERE id = ?').get(checklist_id);
  if (!template) return res.status(404).json({ error: 'Checklist template not found' });

  db.prepare(`
    INSERT INTO checklist_submissions (id, checklist_id, submitted_by, responses, overall_status, notes, corrective_action_taken)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, checklist_id, submitted_by, JSON.stringify(responses),
    overall_status || 'pass', notes || null, corrective_action_taken || null);

  const created = db.prepare('SELECT * FROM checklist_submissions WHERE id = ?').get(id);
  logAudit(submitted_by, 'submit', 'checklist_submission', id, { checklist_id, overall_status: overall_status || 'pass' }, null, created);
  res.status(201).json(created);
});

router.put('/submissions/:id/verify', (req, res) => {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM checklist_submissions WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Submission not found' });

  const { verified_by } = req.body;
  if (!verified_by) return res.status(400).json({ error: 'verified_by is required' });

  db.prepare("UPDATE checklist_submissions SET verified_by = ?, verified_at = datetime('now') WHERE id = ?")
    .run(verified_by, req.params.id);

  const updated = db.prepare('SELECT * FROM checklist_submissions WHERE id = ?').get(req.params.id);
  logAudit(verified_by, 'verify', 'checklist_submission', req.params.id, null, existing, updated);
  res.json(updated);
});

export default router;
