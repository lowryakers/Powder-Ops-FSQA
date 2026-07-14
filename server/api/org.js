import { Router } from 'express';
import { v4 as uuid } from 'uuid';
import { getDb, logAudit } from '../db.js';

const router = Router();

// GET / — all positions + chart meta
router.get('/', (_req, res) => {
  const db = getDb();
  const positions = db.prepare('SELECT * FROM org_positions ORDER BY sort_order, title').all();
  const meta = db.prepare('SELECT * FROM org_chart_meta WHERE id = 1').get() || null;
  res.json({ positions, meta });
});

router.post('/', (req, res) => {
  const db = getDb();
  const { title, name, backup, department, parent_id, sort_order, job_description_id } = req.body;
  if (!title) return res.status(400).json({ error: 'Title is required' });
  const id = uuid();
  db.prepare(`INSERT INTO org_positions (id, title, name, backup, department, parent_id, job_description_id, sort_order)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
    id, title, name || null, backup || null, department || null,
    parent_id || null, job_description_id || null, Number.isInteger(sort_order) ? sort_order : 0
  );
  const created = db.prepare('SELECT * FROM org_positions WHERE id = ?').get(id);
  logAudit(req.user, 'org_position_created', 'org_position', id, { title, name });
  res.status(201).json(created);
});

router.put('/:id', (req, res) => {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM org_positions WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Not found' });
  const { title, name, backup, department, parent_id, sort_order, job_description_id } = req.body;

  // Guard against making a node its own ancestor (cycle)
  if (parent_id) {
    let cur = parent_id;
    const byId = Object.fromEntries(db.prepare('SELECT id, parent_id FROM org_positions').all().map(p => [p.id, p.parent_id]));
    while (cur) {
      if (cur === req.params.id) return res.status(400).json({ error: 'A position cannot report into its own branch' });
      cur = byId[cur];
    }
  }

  db.prepare(`UPDATE org_positions SET title=?, name=?, backup=?, department=?, parent_id=?, job_description_id=?, sort_order=?, updated_at=datetime('now') WHERE id=?`).run(
    title || existing.title, name ?? existing.name, backup ?? existing.backup,
    department ?? existing.department, parent_id !== undefined ? (parent_id || null) : existing.parent_id,
    job_description_id !== undefined ? (job_description_id || null) : existing.job_description_id,
    Number.isInteger(sort_order) ? sort_order : existing.sort_order, req.params.id
  );
  const updated = db.prepare('SELECT * FROM org_positions WHERE id = ?').get(req.params.id);
  logAudit(req.user, 'org_position_updated', 'org_position', req.params.id, { title: updated.title }, existing, updated);
  res.json(updated);
});

// DELETE — remove a position; its children re-report to its parent (no orphans)
router.delete('/:id', (req, res) => {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM org_positions WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Not found' });
  const tx = db.transaction(() => {
    db.prepare('UPDATE org_positions SET parent_id = ?, updated_at = datetime(\'now\') WHERE parent_id = ?').run(existing.parent_id || null, req.params.id);
    db.prepare('DELETE FROM org_positions WHERE id = ?').run(req.params.id);
  });
  tx();
  logAudit(req.user, 'org_position_deleted', 'org_position', req.params.id, { title: existing.title }, existing, null);
  res.json({ success: true });
});

// PUT /meta — chart version / approval metadata
router.put('/meta', (req, res) => {
  const db = getDb();
  const { version, approved_by, effective_date } = req.body;
  const existing = db.prepare('SELECT * FROM org_chart_meta WHERE id = 1').get();
  if (existing) {
    db.prepare(`UPDATE org_chart_meta SET version=?, approved_by=?, effective_date=?, updated_at=datetime('now') WHERE id=1`)
      .run(version ?? existing.version, approved_by ?? existing.approved_by, effective_date ?? existing.effective_date);
  } else {
    db.prepare('INSERT INTO org_chart_meta (id, version, approved_by, effective_date) VALUES (1, ?, ?, ?)')
      .run(version || null, approved_by || null, effective_date || null);
  }
  logAudit(req.user, 'org_meta_updated', 'org_chart', '1', req.body);
  res.json(db.prepare('SELECT * FROM org_chart_meta WHERE id = 1').get());
});

export default router;
