import { Router } from 'express';
import { v4 as uuid } from 'uuid';
import { getDb, logAudit } from '../db.js';

const router = Router();

function syncMaintenanceTasksToPM(db, equipmentId) {
  const eq = db.prepare('SELECT maintenance_tasks FROM equipment WHERE id = ?').get(equipmentId);
  if (!eq) return;
  let tasks;
  try { tasks = JSON.parse(eq.maintenance_tasks || '{}'); } catch { tasks = {}; }
  const flatSteps = [];
  const freqOrder = ['Daily', 'Bi-weekly', 'Weekly', 'Monthly', 'Quarterly', 'Semi-Annual', 'Annual', 'As Needed'];
  for (const freq of freqOrder) {
    if (tasks[freq]?.length) {
      flatSteps.push(`${freq}:`);
      tasks[freq].forEach(t => flatSteps.push(`  ${t}`));
    }
  }
  const stepsJson = JSON.stringify(flatSteps);

  const schedules = db.prepare("SELECT id FROM pm_schedules WHERE equipment_id = ? AND is_active = 1").all(equipmentId);
  for (const s of schedules) {
    db.prepare("UPDATE pm_schedules SET procedure_steps = ?, updated_at = datetime('now') WHERE id = ?").run(stepsJson, s.id);
    db.prepare("UPDATE work_orders SET procedure_steps = ? WHERE pm_schedule_id = ? AND status IN ('open','in_progress')").run(stepsJson, s.id);
  }
}

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
  logAudit(req.user, 'create', 'equipment', id, { name, type }, null, created);
  res.status(201).json(created);
});

// Bulk update - POST to avoid /:id conflict
router.post('/bulk-update', (req, res) => {
  const db = getDb();
  const { ids, changes } = req.body;
  if (!ids?.length || !changes) return res.status(400).json({ error: 'ids and changes are required' });

  const fields = [];
  const vals = [];
  const allowed = ['type', 'location', 'room', 'manufacturer', 'model_number', 'vendor', 'pm_frequency', 'is_food_contact', 'haccp_ccp_id', 'status', 'notes', 'maintenance_tasks'];

  for (const [key, value] of Object.entries(changes)) {
    if (!allowed.includes(key)) continue;
    if (key === 'is_food_contact') {
      fields.push(`${key} = ?`);
      vals.push(value ? 1 : 0);
    } else if (key === 'maintenance_tasks') {
      fields.push(`${key} = ?`);
      vals.push(JSON.stringify(value));
    } else {
      fields.push(`${key} = ?`);
      vals.push(value);
    }
  }

  if (fields.length === 0) return res.status(400).json({ error: 'No valid fields to update' });
  fields.push("updated_at = datetime('now')");

  const placeholders = ids.map(() => '?').join(',');
  db.prepare(`UPDATE equipment SET ${fields.join(', ')} WHERE id IN (${placeholders})`).run(...vals, ...ids);

  if (changes.maintenance_tasks !== undefined) {
    for (const id of ids) syncMaintenanceTasksToPM(db, id);
  }

  logAudit(req.user, 'bulk_update', 'equipment', null, { ids, fields: Object.keys(changes) }, null, null);
  res.json({ updated: ids.length });
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

  if (maintenance_tasks !== undefined) {
    syncMaintenanceTasksToPM(db, req.params.id);
  }

  const updated = db.prepare('SELECT * FROM equipment WHERE id = ?').get(req.params.id);
  logAudit(req.user, 'update', 'equipment', req.params.id, null, existing, updated);
  res.json(updated);
});

export default router;
