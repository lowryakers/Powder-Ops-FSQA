import { Router } from 'express';
import { v4 as uuid } from 'uuid';
import { getDb, logAudit } from '../db.js';

const router = Router();

// --- Instruments ---

router.get('/instruments', (req, res) => {
  const db = getDb();
  const { status, critical_only } = req.query;
  let sql = `SELECT ci.*, e.name as equipment_name, c.name as ccp_name
    FROM calibration_instruments ci
    LEFT JOIN equipment e ON ci.equipment_id = e.id
    LEFT JOIN haccp_ccps c ON ci.haccp_ccp_id = c.id WHERE 1=1`;
  const params = [];

  if (status) { sql += ' AND ci.status = ?'; params.push(status); }
  if (critical_only === 'true') { sql += ' AND ci.is_critical_control = 1'; }

  sql += ' ORDER BY ci.next_due ASC';
  res.json(db.prepare(sql).all(...params));
});

router.get('/instruments/:id', (req, res) => {
  const db = getDb();
  const inst = db.prepare(`SELECT ci.*, e.name as equipment_name, c.name as ccp_name
    FROM calibration_instruments ci LEFT JOIN equipment e ON ci.equipment_id = e.id
    LEFT JOIN haccp_ccps c ON ci.haccp_ccp_id = c.id WHERE ci.id = ?`).get(req.params.id);
  if (!inst) return res.status(404).json({ error: 'Instrument not found' });

  const records = db.prepare(
    'SELECT * FROM calibration_records WHERE instrument_id = ? ORDER BY calibrated_at DESC LIMIT 20'
  ).all(req.params.id);

  res.json({ ...inst, records });
});

router.post('/instruments', (req, res) => {
  const db = getDb();
  const id = uuid();
  const { name, type, serial_number, manufacturer, model, location, equipment_id, calibration_frequency, tolerance, unit_of_measure, is_critical_control, haccp_ccp_id } = req.body;

  if (!name || !type) return res.status(400).json({ error: 'name and type are required' });

  db.prepare(`
    INSERT INTO calibration_instruments (id, name, type, serial_number, manufacturer, model, location, equipment_id, calibration_frequency, tolerance, unit_of_measure, is_critical_control, haccp_ccp_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, name, type, serial_number || null, manufacturer || null, model || null,
    location || null, equipment_id || null, calibration_frequency || 'monthly',
    tolerance || null, unit_of_measure || null, is_critical_control ? 1 : 0, haccp_ccp_id || null);

  const created = db.prepare('SELECT * FROM calibration_instruments WHERE id = ?').get(id);
  logAudit(req.body._actor || 'system', 'create', 'calibration_instrument', id, { name, type }, null, created);
  res.status(201).json(created);
});

router.put('/instruments/:id', (req, res) => {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM calibration_instruments WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Instrument not found' });

  const fields = ['name', 'type', 'serial_number', 'manufacturer', 'model', 'location', 'equipment_id', 'calibration_frequency', 'tolerance', 'unit_of_measure', 'status', 'is_critical_control', 'haccp_ccp_id'];
  const vals = fields.map(f => {
    if (f === 'is_critical_control') return req.body[f] !== undefined ? (req.body[f] ? 1 : 0) : existing[f];
    return req.body[f] ?? existing[f];
  });

  db.prepare(`
    UPDATE calibration_instruments SET name=?, type=?, serial_number=?, manufacturer=?, model=?,
    location=?, equipment_id=?, calibration_frequency=?, tolerance=?, unit_of_measure=?,
    status=?, is_critical_control=?, haccp_ccp_id=?, updated_at=datetime('now') WHERE id=?
  `).run(...vals, req.params.id);

  const updated = db.prepare('SELECT * FROM calibration_instruments WHERE id = ?').get(req.params.id);
  logAudit(req.body._actor || 'system', 'update', 'calibration_instrument', req.params.id, null, existing, updated);
  res.json(updated);
});

// --- Calibration Records ---

router.get('/records', (req, res) => {
  const db = getDb();
  const { instrument_id, from, to, result } = req.query;
  let sql = `SELECT cr.*, ci.name as instrument_name, ci.type as instrument_type, ci.serial_number
    FROM calibration_records cr JOIN calibration_instruments ci ON cr.instrument_id = ci.id WHERE 1=1`;
  const params = [];

  if (instrument_id) { sql += ' AND cr.instrument_id = ?'; params.push(instrument_id); }
  if (result) { sql += ' AND cr.result = ?'; params.push(result); }
  if (from) { sql += ' AND cr.calibrated_at >= ?'; params.push(from); }
  if (to) { sql += ' AND cr.calibrated_at <= ?'; params.push(to); }

  sql += ' ORDER BY cr.calibrated_at DESC';
  res.json(db.prepare(sql).all(...params));
});

router.post('/records', (req, res) => {
  const db = getDb();
  const id = uuid();
  const { instrument_id, calibrated_by, result, reading_before, reading_after, standard_used, standard_cert_number, certificate_number, next_due, notes } = req.body;

  if (!instrument_id || !calibrated_by || !result) {
    return res.status(400).json({ error: 'instrument_id, calibrated_by, and result are required' });
  }

  db.prepare(`
    INSERT INTO calibration_records (id, instrument_id, calibrated_by, result, reading_before, reading_after, standard_used, standard_cert_number, certificate_number, next_due, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, instrument_id, calibrated_by, result, reading_before || null,
    reading_after || null, standard_used || null, standard_cert_number || null,
    certificate_number || null, next_due || null, notes || null);

  if (next_due) {
    db.prepare("UPDATE calibration_instruments SET last_calibrated = datetime('now'), next_due = ?, status = 'active', updated_at = datetime('now') WHERE id = ?")
      .run(next_due, instrument_id);
  } else {
    db.prepare("UPDATE calibration_instruments SET last_calibrated = datetime('now'), status = 'active', updated_at = datetime('now') WHERE id = ?")
      .run(instrument_id);
  }

  const created = db.prepare('SELECT * FROM calibration_records WHERE id = ?').get(id);
  logAudit(calibrated_by, 'calibrate', 'calibration_record', id, { instrument_id, result }, null, created);
  res.status(201).json(created);
});

export default router;
