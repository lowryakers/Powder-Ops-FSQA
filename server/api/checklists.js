import { Router } from 'express';
import { v4 as uuid } from 'uuid';
import { getDb, logAudit } from '../db.js';

const router = Router();

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
  res.json({ ...tmpl, items: JSON.parse(tmpl.items || '[]') });
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

  const created = db.prepare('SELECT * FROM checklist_templates WHERE id = ?').get(id);
  logAudit(req.body._actor || 'system', 'create', 'checklist_template', id, { name, type }, null, created);
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

  const updated = db.prepare('SELECT * FROM checklist_templates WHERE id = ?').get(req.params.id);
  logAudit(req.body._actor || 'system', 'update', 'checklist_template', req.params.id, null, existing, updated);
  res.json(updated);
});

// --- Submissions ---

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
