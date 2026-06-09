import { Router } from 'express';
import { v4 as uuid } from 'uuid';
import { getDb, logAudit } from '../db.js';

const router = Router();

router.get('/equipment-list', (_req, res) => {
  const db = getDb();
  const equipment = db.prepare("SELECT id, name, type, location, asset_id FROM equipment WHERE status = 'active' ORDER BY name").all();
  res.json(equipment);
});

router.post('/work-order', (req, res) => {
  const db = getDb();
  const { equipment_id, title, description, priority, submitted_by } = req.body;

  if (!title || !submitted_by) {
    return res.status(400).json({ error: 'title and submitted_by are required' });
  }

  const id = uuid();
  const due_date = new Date();
  due_date.setDate(due_date.getDate() + 1);

  db.prepare(`
    INSERT INTO work_orders (id, equipment_id, title, description, priority, assigned_to, due_date)
    VALUES (?, ?, ?, ?, ?, NULL, ?)
  `).run(id, equipment_id || null, title, description || null, priority || 'normal', due_date.toISOString().split('T')[0]);

  logAudit(submitted_by, 'submit_public', 'work_order', id, { title, submitted_by }, null, null);
  res.status(201).json({ id, message: 'Work order submitted successfully' });
});

export default router;
