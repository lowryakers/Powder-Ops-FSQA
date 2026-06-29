import { Router } from 'express';
import { v4 as uuid } from 'uuid';
import { getDb, logAudit } from '../db.js';

const router = Router();

router.get('/', (req, res) => {
  const db = getDb();
  const { category, status } = req.query;
  let sql = 'SELECT * FROM sop_documents WHERE 1=1';
  const params = [];
  if (category) { sql += ' AND category = ?'; params.push(category); }
  if (status) { sql += ' AND status = ?'; params.push(status); }
  else { sql += " AND status != 'archived'"; }
  sql += ' ORDER BY category, doc_number';
  res.json(db.prepare(sql).all(...params));
});

router.get('/:id', (req, res) => {
  const db = getDb();
  const doc = db.prepare('SELECT * FROM sop_documents WHERE id = ?').get(req.params.id);
  if (!doc) return res.status(404).json({ error: 'Not found' });
  res.json(doc);
});

router.post('/', (req, res) => {
  const db = getDb();
  const { doc_number, title, category, revision, effective_date, review_due, owner, gdrive_url, gdrive_folder, description, _actor } = req.body;
  if (!title || !category) return res.status(400).json({ error: 'Title and category are required' });
  const id = uuid();
  db.prepare(`INSERT INTO sop_documents (id, doc_number, title, category, revision, effective_date, review_due, owner, gdrive_url, gdrive_folder, description)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    id, doc_number || '', title, category, revision || '1.0',
    effective_date || null, review_due || null, owner || null,
    gdrive_url || null, gdrive_folder || null, description || null
  );
  logAudit(_actor || 'system', 'sop_created', 'sop', id, { title, category });
  res.status(201).json(db.prepare('SELECT * FROM sop_documents WHERE id = ?').get(id));
});

router.put('/:id', (req, res) => {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM sop_documents WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Not found' });
  const { doc_number, title, category, revision, effective_date, review_due, status, owner, gdrive_url, gdrive_folder, description, _actor } = req.body;
  db.prepare(`UPDATE sop_documents SET doc_number=?, title=?, category=?, revision=?, effective_date=?, review_due=?, status=?, owner=?, gdrive_url=?, gdrive_folder=?, description=?, updated_at=datetime('now') WHERE id=?`).run(
    doc_number ?? existing.doc_number, title || existing.title, category || existing.category,
    revision || existing.revision, effective_date ?? existing.effective_date,
    review_due ?? existing.review_due, status || existing.status, owner ?? existing.owner,
    gdrive_url ?? existing.gdrive_url, gdrive_folder ?? existing.gdrive_folder,
    description ?? existing.description, req.params.id
  );
  logAudit(_actor || 'system', 'sop_updated', 'sop', req.params.id, { title: title || existing.title });
  res.json(db.prepare('SELECT * FROM sop_documents WHERE id = ?').get(req.params.id));
});

export default router;
