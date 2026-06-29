import { Router } from 'express';
import { v4 as uuid } from 'uuid';
import { getDb, logAudit } from '../db.js';

const router = Router();

router.get('/', (req, res) => {
  const db = getDb();
  const { employee, status, sop_id } = req.query;
  let sql = 'SELECT tr.*, sd.title as sop_title, sd.doc_number as sop_number FROM training_records tr LEFT JOIN sop_documents sd ON tr.sop_id = sd.id WHERE 1=1';
  const params = [];
  if (employee) { sql += ' AND tr.employee_name LIKE ?'; params.push(`%${employee}%`); }
  if (status) { sql += ' AND tr.status = ?'; params.push(status); }
  if (sop_id) { sql += ' AND tr.sop_id = ?'; params.push(sop_id); }
  sql += ' ORDER BY tr.training_date DESC';
  res.json(db.prepare(sql).all(...params));
});

router.get('/matrix', (_req, res) => {
  const db = getDb();
  const employees = [...new Set(db.prepare('SELECT DISTINCT employee_name FROM training_records ORDER BY employee_name').all().map(r => r.employee_name))];
  const topics = [...new Set(db.prepare('SELECT DISTINCT training_topic FROM training_records ORDER BY training_topic').all().map(r => r.training_topic))];
  const records = db.prepare('SELECT employee_name, training_topic, status, completion_date FROM training_records ORDER BY training_date DESC').all();

  const matrix = {};
  for (const emp of employees) {
    matrix[emp] = {};
    for (const topic of topics) {
      const rec = records.find(r => r.employee_name === emp && r.training_topic === topic);
      matrix[emp][topic] = rec ? { status: rec.status, date: rec.completion_date } : null;
    }
  }
  res.json({ employees, topics, matrix });
});

router.get('/:id', (req, res) => {
  const db = getDb();
  const rec = db.prepare('SELECT tr.*, sd.title as sop_title FROM training_records tr LEFT JOIN sop_documents sd ON tr.sop_id = sd.id WHERE tr.id = ?').get(req.params.id);
  if (!rec) return res.status(404).json({ error: 'Not found' });
  res.json(rec);
});

router.post('/', (req, res) => {
  const db = getDb();
  const { employee_name, employee_id, training_topic, sop_id, trainer, training_date, completion_date, status, score, certificate_url, gdrive_url, notes, _actor } = req.body;
  if (!employee_name || !training_topic) return res.status(400).json({ error: 'Employee name and training topic are required' });
  const id = uuid();
  db.prepare(`INSERT INTO training_records (id, employee_name, employee_id, training_topic, sop_id, trainer, training_date, completion_date, status, score, certificate_url, gdrive_url, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    id, employee_name, employee_id || null, training_topic, sop_id || null,
    trainer || null, training_date || new Date().toISOString().split('T')[0],
    completion_date || null, status || 'scheduled', score ?? null,
    certificate_url || null, gdrive_url || null, notes || null
  );
  logAudit(_actor || 'system', 'training_created', 'training', id, { employee_name, training_topic });
  res.status(201).json(db.prepare('SELECT * FROM training_records WHERE id = ?').get(id));
});

router.put('/:id', (req, res) => {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM training_records WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Not found' });
  const { employee_name, employee_id, training_topic, sop_id, trainer, training_date, completion_date, status, score, certificate_url, gdrive_url, notes, _actor } = req.body;
  db.prepare(`UPDATE training_records SET employee_name=?, employee_id=?, training_topic=?, sop_id=?, trainer=?, training_date=?, completion_date=?, status=?, score=?, certificate_url=?, gdrive_url=?, notes=?, updated_at=datetime('now') WHERE id=?`).run(
    employee_name || existing.employee_name, employee_id ?? existing.employee_id,
    training_topic || existing.training_topic, sop_id ?? existing.sop_id,
    trainer ?? existing.trainer, training_date || existing.training_date,
    completion_date ?? existing.completion_date, status || existing.status,
    score ?? existing.score, certificate_url ?? existing.certificate_url,
    gdrive_url ?? existing.gdrive_url, notes ?? existing.notes, req.params.id
  );
  logAudit(_actor || 'system', 'training_updated', 'training', req.params.id, { employee_name: employee_name || existing.employee_name });
  res.json(db.prepare('SELECT * FROM training_records WHERE id = ?').get(req.params.id));
});

export default router;
