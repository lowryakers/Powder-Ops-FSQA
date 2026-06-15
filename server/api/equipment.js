import { Router } from 'express';
import { v4 as uuid } from 'uuid';
import { getDb, logAudit } from '../db.js';

const router = Router();

router.get('/', (req, res) => {
  const db = getDb();
  const { status, type, food_contact } = req.query;
  let sql = 'SELECT e.*, c.name as ccp_name FROM equipment e LEFT JOIN haccp_ccps c ON e.haccp_ccp_id = c.id WHERE 1=1';
  const params = [];

  if (status) { sql += ' AND e.status = ?'; params.push(status); }
  if (type) { sql += ' AND e.type = ?'; params.push(type); }
  if (food_contact !== undefined) { sql += ' AND e.is_food_contact = ?'; params.push(food_contact === 'true' ? 1 : 0); }

  sql += ' ORDER BY e.name';
  res.json(db.prepare(sql).all(...params));
});

router.get('/:id', (req, res) => {
  const db = getDb();
  const row = db.prepare('SELECT e.*, c.name as ccp_name FROM equipment e LEFT JOIN haccp_ccps c ON e.haccp_ccp_id = c.id WHERE e.id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Equipment not found' });
  res.json(row);
});

router.post('/', (req, res) => {
  const db = getDb();
  const id = uuid();
  const { name, type, location, room, asset_id, manufacturer, model_number, serial_number, vendor, pm_frequency, is_food_contact, haccp_ccp_id, notes, maintenance_tasks } = req.body;
  if (!name || !type) return res.status(400).json({ error: 'name and type are required' });

  db.prepare(`
    INSERT INTO equipment (id, name, type, location, room, asset_id, manufacturer, model_number, serial_number, vendor, pm_frequency, is_food_contact, haccp_ccp_id, notes, maintenance_tasks)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, name, type, location || null, room || null, asset_id || null, manufacturer || null, model_number || null, serial_number || null, vendor || null, pm_frequency || null, is_food_contact ? 1 : 0, haccp_ccp_id || null, notes || null, maintenance_tasks ? JSON.stringify(maintenance_tasks) : '{}');

  const created = db.prepare('SELECT * FROM equipment WHERE id = ?').get(id);
  logAudit(req.body._actor || 'system', 'create', 'equipment', id, { name, type }, null, created);
  res.status(201).json(created);
});

router.put('/:id', (req, res) => {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM equipment WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Equipment not found' });

  const { name, type, location, room, asset_id, manufacturer, model_number, serial_number, vendor, pm_frequency, is_food_contact, haccp_ccp_id, status, notes, maintenance_tasks } = req.body;
  db.prepare(`
    UPDATE equipment SET name = ?, type = ?, location = ?, room = ?, asset_id = ?, manufacturer = ?,
    model_number = ?, serial_number = ?, vendor = ?, pm_frequency = ?, is_food_contact = ?,
    haccp_ccp_id = ?, status = ?, notes = ?, maintenance_tasks = ?, updated_at = datetime('now') WHERE id = ?
  `).run(
    name || existing.name, type || existing.type, location ?? existing.location,
    room ?? existing.room, asset_id ?? existing.asset_id, manufacturer ?? existing.manufacturer,
    model_number ?? existing.model_number, serial_number ?? existing.serial_number,
    vendor ?? existing.vendor, pm_frequency ?? existing.pm_frequency,
    is_food_contact !== undefined ? (is_food_contact ? 1 : 0) : existing.is_food_contact,
    haccp_ccp_id ?? existing.haccp_ccp_id, status || existing.status, notes ?? existing.notes,
    maintenance_tasks !== undefined ? JSON.stringify(maintenance_tasks) : (existing.maintenance_tasks || '{}'), req.params.id
  );

  const updated = db.prepare('SELECT * FROM equipment WHERE id = ?').get(req.params.id);
  logAudit(req.body._actor || 'system', 'update', 'equipment', req.params.id, null, existing, updated);
  res.json(updated);
});

export default router;
