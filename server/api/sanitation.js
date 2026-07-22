import { Router } from 'express';
import { v4 as uuid } from 'uuid';
import { getDb, logAudit } from '../db.js';

const router = Router();

router.get('/', (req, res) => {
  const db = getDb();
  const { area, type, from, to, result, equipment_id } = req.query;
  let sql = `SELECT sr.*, e.name as equipment_name
    FROM sanitation_records sr LEFT JOIN equipment e ON sr.equipment_id = e.id WHERE 1=1`;
  const params = [];

  if (area) { sql += ' AND sr.area = ?'; params.push(area); }
  if (type) { sql += ' AND sr.type = ?'; params.push(type); }
  if (result) { sql += ' AND sr.result = ?'; params.push(result); }
  if (equipment_id) { sql += ' AND sr.equipment_id = ?'; params.push(equipment_id); }
  if (from) { sql += ' AND sr.performed_at >= ?'; params.push(from); }
  if (to) { sql += ' AND sr.performed_at <= ?'; params.push(to); }

  sql += ' ORDER BY sr.performed_at DESC';
  res.json(db.prepare(sql).all(...params));
});

// SQF/NSF 72-hour idle rule: a cleaned room whose clean is 72h+ old (with no
// newer clean) must be re-cleaned before use, and any room used after its last
// clean is dirty. Rooms come from wherever they appear (production entries,
// schedule, sanitation history). Registered before /:id so it isn't shadowed.
router.get('/reclean-status', (req, res) => {
  const db = getDb();
  const rooms = new Set();
  try { db.prepare("SELECT DISTINCT room FROM production_entries WHERE room IS NOT NULL").all().forEach(r => rooms.add(r.room)); } catch { /* optional */ }
  try { db.prepare("SELECT DISTINCT room FROM production_schedule WHERE room IS NOT NULL AND room_type != 'cleaning'").all().forEach(r => rooms.add(r.room)); } catch { /* optional */ }
  try { db.prepare('SELECT DISTINCT area FROM sanitation_records').all().forEach(r => rooms.add(r.area)); } catch { /* optional */ }
  const lastClean = db.prepare("SELECT MAX(performed_at) t FROM sanitation_records WHERE area = ? AND result = 'pass'");
  const lastUse = db.prepare('SELECT MAX(date) t FROM production_entries WHERE room = ?');
  const now = Date.now();
  const out = [];
  for (const room of rooms) {
    const clean = lastClean.get(room).t;
    const used = lastUse.get(room).t;
    let status, hoursIdle = null;
    if (!clean) {
      status = used ? 'no_clean_on_record' : 'unknown';
    } else if (used && used > clean.slice(0, 10)) {
      status = 'dirty'; // used after the last passed clean
    } else {
      hoursIdle = Math.floor((now - new Date(clean.replace(' ', 'T') + 'Z').getTime()) / 3600000);
      status = hoursIdle >= 72 ? 'expired_72h' : 'clean';
    }
    out.push({ room, status, last_clean: clean, last_use: used, hours_since_clean: hoursIdle });
  }
  const order = { expired_72h: 0, dirty: 1, no_clean_on_record: 2, clean: 3, unknown: 4 };
  out.sort((a, b) => order[a.status] - order[b.status] || a.room.localeCompare(b.room));
  res.json({ rooms: out, rule_hours: 72 });
});

router.get('/:id', (req, res) => {
  const db = getDb();
  const record = db.prepare(`SELECT sr.*, e.name as equipment_name
    FROM sanitation_records sr LEFT JOIN equipment e ON sr.equipment_id = e.id WHERE sr.id = ?`).get(req.params.id);
  if (!record) return res.status(404).json({ error: 'Record not found' });
  res.json(record);
});

router.post('/', (req, res) => {
  const db = getDb();
  const id = uuid();
  const { area, type, equipment_id, performed_by, chemicals_used, concentration, contact_time_minutes, rinse_verified, result, atp_reading, notes, chemical_id } = req.body;

  if (!area || !type || !performed_by || !result) {
    return res.status(400).json({ error: 'area, type, performed_by, and result are required' });
  }

  db.prepare(`
    INSERT INTO sanitation_records (id, area, type, equipment_id, performed_by, chemicals_used, concentration, contact_time_minutes, rinse_verified, result, atp_reading, notes, chemical_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, area, type, equipment_id || null, performed_by, chemicals_used || null,
    concentration || null, contact_time_minutes ?? null, rinse_verified ? 1 : 0,
    result, atp_reading ?? null, notes || null, chemical_id || null);

  const created = db.prepare('SELECT * FROM sanitation_records WHERE id = ?').get(id);
  logAudit(performed_by, 'create', 'sanitation_record', id, { area, type, result }, null, created);
  res.status(201).json(created);
});

router.put('/:id/verify', (req, res) => {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM sanitation_records WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Record not found' });

  const { verified_by } = req.body;
  if (!verified_by) return res.status(400).json({ error: 'verified_by is required' });

  db.prepare("UPDATE sanitation_records SET verified_by = ?, verified_at = datetime('now') WHERE id = ?")
    .run(verified_by, req.params.id);

  const updated = db.prepare('SELECT * FROM sanitation_records WHERE id = ?').get(req.params.id);
  logAudit(verified_by, 'verify', 'sanitation_record', req.params.id, null, existing, updated);
  res.json(updated);
});

export default router;
