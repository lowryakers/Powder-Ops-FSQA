import { Router } from 'express';
import { v4 as uuid } from 'uuid';
import { getDb, logAudit } from '../db.js';

const router = Router();

router.get('/', (req, res) => {
  const db = getDb();
  const { equipment_id, result } = req.query;
  let sql = `SELECT dv.*, e.name as equipment_name, e.location, e.is_food_contact
    FROM design_verifications dv
    JOIN equipment e ON dv.equipment_id = e.id WHERE 1=1`;
  const params = [];
  if (equipment_id) { sql += ' AND dv.equipment_id = ?'; params.push(equipment_id); }
  if (result) { sql += ' AND dv.overall_result = ?'; params.push(result); }
  sql += ' ORDER BY dv.created_at DESC';
  res.json(db.prepare(sql).all(...params));
});

router.get('/pending', (req, res) => {
  const db = getDb();
  const pending = db.prepare(`
    SELECT dv.*, e.name as equipment_name, e.location
    FROM design_verifications dv
    JOIN equipment e ON dv.equipment_id = e.id
    WHERE dv.overall_result = 'pending'
    ORDER BY dv.created_at DESC
  `).all();
  res.json(pending);
});

router.get('/equipment-status', (req, res) => {
  const db = getDb();
  const rows = db.prepare(`
    SELECT e.id, e.name, e.is_food_contact,
      dv.id as verification_id, dv.overall_result, dv.performed_at, dv.trigger_reason
    FROM equipment e
    LEFT JOIN (
      SELECT *, ROW_NUMBER() OVER (PARTITION BY equipment_id ORDER BY created_at DESC) as rn
      FROM design_verifications
    ) dv ON dv.equipment_id = e.id AND dv.rn = 1
    WHERE e.is_food_contact = 1
    ORDER BY e.name
  `).all();
  res.json(rows);
});

router.get('/:id', (req, res) => {
  const db = getDb();
  const dv = db.prepare(`
    SELECT dv.*, e.name as equipment_name, e.location, e.is_food_contact
    FROM design_verifications dv
    JOIN equipment e ON dv.equipment_id = e.id
    WHERE dv.id = ?
  `).get(req.params.id);
  if (!dv) return res.status(404).json({ error: 'Not found' });
  res.json(dv);
});

router.post('/', (req, res) => {
  const db = getDb();
  const { equipment_id, trigger_reason, description, checklist_responses, performed_by, notes, _actor } = req.body;
  if (!equipment_id || !trigger_reason || !performed_by) {
    return res.status(400).json({ error: 'equipment_id, trigger_reason, and performed_by required' });
  }
  const id = uuid();
  db.prepare(`
    INSERT INTO design_verifications (id, equipment_id, trigger_reason, description, checklist_responses, performed_by, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, equipment_id, trigger_reason, description || null, JSON.stringify(checklist_responses || []), performed_by, notes || null);
  logAudit(_actor || performed_by, 'design_verification_created', 'design_verification', id, `${trigger_reason} verification for equipment ${equipment_id}`);
  res.status(201).json({ id });
});

router.put('/:id/approve', (req, res) => {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM design_verifications WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Not found' });
  const { overall_result, conditions, approved_by, notes, _actor } = req.body;
  if (!overall_result || !approved_by) {
    return res.status(400).json({ error: 'overall_result and approved_by required' });
  }
  db.prepare(`
    UPDATE design_verifications SET overall_result=?, conditions=?, approved_by=?, approved_at=datetime('now'), notes=?, updated_at=datetime('now')
    WHERE id=?
  `).run(overall_result, conditions || null, approved_by, notes ?? existing.notes, req.params.id);
  logAudit(_actor || approved_by, `design_verification_${overall_result}`, 'design_verification', req.params.id, `${overall_result}: ${conditions || 'No conditions'}`);
  res.json({ success: true });
});

export default router;
