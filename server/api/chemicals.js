import { Router } from 'express';
import { v4 as uuid } from 'uuid';
import { getDb, logAudit } from '../db.js';

const router = Router();

router.get('/', (req, res) => {
  const db = getDb();
  const { category, food_grade, active } = req.query;
  let sql = 'SELECT * FROM approved_chemicals WHERE 1=1';
  const params = [];
  if (category) { sql += ' AND category = ?'; params.push(category); }
  if (food_grade === 'true') { sql += ' AND is_food_grade = 1'; }
  if (active !== 'false') { sql += ' AND is_active = 1'; }
  sql += ' ORDER BY category, name';
  res.json(db.prepare(sql).all(...params));
});

router.get('/:id', (req, res) => {
  const db = getDb();
  const chem = db.prepare('SELECT * FROM approved_chemicals WHERE id = ?').get(req.params.id);
  if (!chem) return res.status(404).json({ error: 'Not found' });
  res.json(chem);
});

router.post('/', (req, res) => {
  const db = getDb();
  const { name, category, manufacturer, product_code, sds_number, sds_url, is_food_grade, nsf_rating, approved_applications, max_concentration, required_contact_time_minutes, review_due, notes, location_for_use, _actor } = req.body;
  if (!name || !category) return res.status(400).json({ error: 'Name and category required' });
  const id = uuid();
  db.prepare(`
    INSERT INTO approved_chemicals (id, name, category, manufacturer, product_code, sds_number, sds_url, is_food_grade, nsf_rating, approved_applications, max_concentration, required_contact_time_minutes, approved_by, review_due, notes, location_for_use)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, name, category, manufacturer || null, product_code || null, sds_number || null, sds_url || null, is_food_grade ? 1 : 0, nsf_rating || null, JSON.stringify(approved_applications || []), max_concentration || null, required_contact_time_minutes ?? null, _actor || 'system', review_due || null, notes || null, location_for_use || null);
  logAudit(_actor || 'system', 'chemical_approved', 'chemical', id, { name, category });
  const created = db.prepare('SELECT * FROM approved_chemicals WHERE id = ?').get(id);
  res.status(201).json(created);
});

router.put('/:id', (req, res) => {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM approved_chemicals WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Not found' });
  const { name, category, manufacturer, product_code, sds_number, sds_url, is_food_grade, nsf_rating, approved_applications, max_concentration, required_contact_time_minutes, is_active, review_due, notes, location_for_use, _actor } = req.body;
  db.prepare(`
    UPDATE approved_chemicals SET name=?, category=?, manufacturer=?, product_code=?, sds_number=?, sds_url=?, is_food_grade=?, nsf_rating=?, approved_applications=?, max_concentration=?, required_contact_time_minutes=?, is_active=?, review_due=?, notes=?, location_for_use=?, updated_at=datetime('now')
    WHERE id=?
  `).run(
    name || existing.name, category || existing.category, manufacturer ?? existing.manufacturer, product_code ?? existing.product_code, sds_number ?? existing.sds_number, sds_url ?? existing.sds_url,
    is_food_grade !== undefined ? (is_food_grade ? 1 : 0) : existing.is_food_grade,
    nsf_rating ?? existing.nsf_rating, JSON.stringify(approved_applications || JSON.parse(existing.approved_applications || '[]')),
    max_concentration ?? existing.max_concentration, required_contact_time_minutes ?? existing.required_contact_time_minutes,
    is_active !== undefined ? (is_active ? 1 : 0) : existing.is_active,
    review_due ?? existing.review_due, notes ?? existing.notes, location_for_use ?? existing.location_for_use, req.params.id
  );
  const updated = db.prepare('SELECT * FROM approved_chemicals WHERE id = ?').get(req.params.id);
  logAudit(_actor || 'system', 'chemical_updated', 'chemical', req.params.id, { name: updated.name }, existing, updated);
  res.json(updated);
});

export default router;
