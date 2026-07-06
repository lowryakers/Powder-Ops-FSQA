import { Router } from 'express';
import { v4 as uuid } from 'uuid';
import { getDb, logAudit } from '../db.js';

const router = Router();

// --- LOTO Procedures (templates) ---

router.get('/procedures', (req, res) => {
  const db = getDb();
  const { equipment_id } = req.query;
  let sql = `SELECT lp.*, e.name as equipment_name, e.room
    FROM loto_procedures lp JOIN equipment e ON lp.equipment_id = e.id WHERE 1=1`;
  const params = [];
  if (equipment_id) { sql += ' AND lp.equipment_id = ?'; params.push(equipment_id); }
  sql += ' ORDER BY e.name, lp.title';
  res.json(db.prepare(sql).all(...params));
});

router.get('/procedures/:id', (req, res) => {
  const db = getDb();
  const proc = db.prepare(`SELECT lp.*, e.name as equipment_name, e.room
    FROM loto_procedures lp JOIN equipment e ON lp.equipment_id = e.id WHERE lp.id = ?`).get(req.params.id);
  if (!proc) return res.status(404).json({ error: 'LOTO procedure not found' });
  try { res.json({ ...proc, energy_sources: JSON.parse(proc.energy_sources || '[]'), steps: JSON.parse(proc.steps || '[]') }); } catch { res.json({ ...proc, energy_sources: [], steps: [] }); }
});

router.post('/procedures', (req, res) => {
  const db = getDb();
  const id = uuid();
  const { equipment_id, title, description, energy_sources, steps, required_locks, required_tags, verification_method } = req.body;

  if (!equipment_id || !title || !energy_sources?.length || !steps?.length) {
    return res.status(400).json({ error: 'equipment_id, title, energy_sources, and steps are required' });
  }

  db.prepare(`
    INSERT INTO loto_procedures (id, equipment_id, title, description, energy_sources, steps, required_locks, required_tags, verification_method)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, equipment_id, title, description || null,
    JSON.stringify(energy_sources), JSON.stringify(steps),
    required_locks ?? 1, required_tags ?? 1, verification_method || 'try_start');

  const created = db.prepare('SELECT * FROM loto_procedures WHERE id = ?').get(id);
  logAudit(req.user.name, 'create', 'loto_procedure', id, { title, equipment_id }, null, created);
  res.status(201).json(created);
});

router.put('/procedures/:id', (req, res) => {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM loto_procedures WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'LOTO procedure not found' });

  const { title, description, energy_sources, steps, required_locks, required_tags, verification_method, is_active } = req.body;

  db.prepare(`
    UPDATE loto_procedures SET title=?, description=?, energy_sources=?, steps=?,
    required_locks=?, required_tags=?, verification_method=?, is_active=?, updated_at=datetime('now') WHERE id=?
  `).run(
    title || existing.title, description ?? existing.description,
    energy_sources ? JSON.stringify(energy_sources) : existing.energy_sources,
    steps ? JSON.stringify(steps) : existing.steps,
    required_locks ?? existing.required_locks, required_tags ?? existing.required_tags,
    verification_method || existing.verification_method,
    is_active !== undefined ? (is_active ? 1 : 0) : existing.is_active,
    req.params.id
  );

  const updated = db.prepare('SELECT * FROM loto_procedures WHERE id = ?').get(req.params.id);
  logAudit(req.user.name, 'update', 'loto_procedure', req.params.id, null, existing, updated);
  res.json(updated);
});

// --- LOTO Executions (actual lockout events) ---

router.get('/executions', (req, res) => {
  const db = getDb();
  const { procedure_id, status, from, to } = req.query;
  let sql = `SELECT le.*, lp.title as procedure_title, e.name as equipment_name, e.room
    FROM loto_executions le
    JOIN loto_procedures lp ON le.procedure_id = lp.id
    JOIN equipment e ON lp.equipment_id = e.id WHERE 1=1`;
  const params = [];

  if (procedure_id) { sql += ' AND le.procedure_id = ?'; params.push(procedure_id); }
  if (status) { sql += ' AND le.status = ?'; params.push(status); }
  if (from) { sql += ' AND le.locked_at >= ?'; params.push(from); }
  if (to) { sql += ' AND le.locked_at <= ?'; params.push(to); }

  sql += ' ORDER BY le.locked_at DESC';
  res.json(db.prepare(sql).all(...params));
});

router.post('/executions', (req, res) => {
  const db = getDb();
  const id = uuid();
  const { procedure_id, locked_by, reason, lock_numbers, tag_numbers } = req.body;

  if (!procedure_id || !locked_by || !reason) {
    return res.status(400).json({ error: 'procedure_id, locked_by, and reason are required' });
  }

  const proc = db.prepare('SELECT * FROM loto_procedures WHERE id = ?').get(procedure_id);
  if (!proc) return res.status(404).json({ error: 'LOTO procedure not found' });

  db.prepare(`
    INSERT INTO loto_executions (id, procedure_id, locked_by, reason, lock_numbers, tag_numbers, status)
    VALUES (?, ?, ?, ?, ?, ?, 'locked')
  `).run(id, procedure_id, locked_by, reason,
    lock_numbers || null, tag_numbers || null);

  const created = db.prepare('SELECT * FROM loto_executions WHERE id = ?').get(id);
  logAudit(locked_by, 'lockout', 'loto_execution', id, { procedure_id, reason }, null, created);
  res.status(201).json(created);
});

router.put('/executions/:id/verify', (req, res) => {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM loto_executions WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Execution not found' });

  const { verified_by, verification_result } = req.body;
  if (!verified_by) return res.status(400).json({ error: 'verified_by is required' });

  db.prepare("UPDATE loto_executions SET verified_by=?, verification_result=?, verified_at=datetime('now'), status='verified', updated_at=datetime('now') WHERE id=?")
    .run(verified_by, verification_result || 'zero_energy_confirmed', req.params.id);

  const updated = db.prepare('SELECT * FROM loto_executions WHERE id = ?').get(req.params.id);
  logAudit(verified_by, 'verify_lockout', 'loto_execution', req.params.id, { verification_result }, existing, updated);
  res.json(updated);
});

router.put('/executions/:id/release', (req, res) => {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM loto_executions WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Execution not found' });

  const { released_by, release_notes } = req.body;
  if (!released_by) return res.status(400).json({ error: 'released_by is required' });

  db.prepare("UPDATE loto_executions SET released_by=?, released_at=datetime('now'), release_notes=?, status='released', updated_at=datetime('now') WHERE id=?")
    .run(released_by, release_notes || null, req.params.id);

  const updated = db.prepare('SELECT * FROM loto_executions WHERE id = ?').get(req.params.id);
  logAudit(released_by, 'release_lockout', 'loto_execution', req.params.id, { release_notes }, existing, updated);
  res.json(updated);
});

router.get('/uncovered-equipment', (_req, res) => {
  const db = getDb();
  const rows = db.prepare(`
    SELECT e.id, e.name, e.room, e.location, e.asset_id
    FROM equipment e
    WHERE e.status = 'active'
      AND e.id NOT IN (SELECT equipment_id FROM loto_procedures)
    ORDER BY e.name
  `).all();
  res.json(rows);
});

export default router;
