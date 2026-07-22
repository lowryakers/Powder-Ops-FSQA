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
// schedule, sanitation history). Shared with the notifications badge.
//
// Applicability: the rule targets food-production rooms/lines. Two kinds of
// names default OFF: non-food areas (restrooms, breakroom, offices…) and
// inspection-record "areas" that aren't cleanable rooms at all (brittle
// plastic/glass zones, light inspections, temp/humidity monitors…). Anything
// else defaults ON. Admin/QA overrides live in reclean_rooms and always win.
const NONFOOD_DEFAULT = new RegExp([
  'restroom', 'bathroom', 'break\\s?room', 'lobby', 'office', 'lunch', 'grounds', 'exterior', 'janitor',
  'brittle', 'glass', 'light inspection', 'temp\\s*/?\\s*humidity', 'chemical (verification|dilution)',
].join('|'), 'i');

// Actions (dismiss / N-A / not-in-use / assigned) bind to this key; a new
// passed clean or new use changes the key, which re-arms the flag.
function recleanFlagKey(room, clean, used) {
  return `${room}|${clean || 'none'}|${used || 'none'}`;
}

export function recleanRooms(db) {
  const rooms = new Set();
  try { db.prepare("SELECT DISTINCT room FROM production_entries WHERE room IS NOT NULL").all().forEach(r => rooms.add(r.room)); } catch { /* optional */ }
  try { db.prepare("SELECT DISTINCT room FROM production_schedule WHERE room IS NOT NULL AND room_type != 'cleaning'").all().forEach(r => rooms.add(r.room)); } catch { /* optional */ }
  try { db.prepare('SELECT DISTINCT area FROM sanitation_records').all().forEach(r => rooms.add(r.area)); } catch { /* optional */ }
  let overrides = new Map();
  try { overrides = new Map(db.prepare('SELECT room, applicable FROM reclean_rooms').all().map(r => [r.room, !!r.applicable])); } catch { /* optional */ }
  const lastClean = db.prepare("SELECT MAX(performed_at) t FROM sanitation_records WHERE area = ? AND result = 'pass'");
  const lastUse = db.prepare('SELECT MAX(date) t FROM production_entries WHERE room = ?');
  let latestAction = null;
  try { latestAction = db.prepare('SELECT * FROM reclean_actions WHERE room = ? AND flag_key = ? ORDER BY created_at DESC LIMIT 1'); } catch { /* optional */ }
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
    const applicable = overrides.has(room) ? overrides.get(room) : !NONFOOD_DEFAULT.test(room);
    const flagKey = recleanFlagKey(room, clean, used);
    const flagged = status === 'expired_72h' || status === 'dirty';
    const action = flagged && latestAction ? (latestAction.get(room, flagKey) || null) : null;
    out.push({
      room, status, last_clean: clean, last_use: used, hours_since_clean: hoursIdle,
      applicable, flag_key: flagKey,
      action: action ? { id: action.id, action: action.action, reason: action.reason, work_order_id: action.work_order_id, by: action.created_by, at: action.created_at } : null,
      needs_attention: flagged && applicable && !action,
    });
  }
  const order = { expired_72h: 0, dirty: 1, no_clean_on_record: 2, clean: 3, unknown: 4 };
  out.sort((a, b) => (b.needs_attention ? 1 : 0) - (a.needs_attention ? 1 : 0) || order[a.status] - order[b.status] || a.room.localeCompare(b.room));
  return out;
}

function canManageReclean(user) {
  return user?.role === 'admin' || user?.role === 'supervisor' || user?.department === 'qa';
}

// Registered before /:id so they aren't shadowed.
router.get('/reclean-status', (req, res) => {
  res.json({ rooms: recleanRooms(getDb()), rule_hours: 72 });
});

// Take an action on a flagged room: dismiss (reason required), mark N/A, or
// mark not in use. The action holds until the room's clean/use state changes.
router.post('/reclean-actions', (req, res) => {
  if (!canManageReclean(req.user)) return res.status(403).json({ error: 'Only admins, supervisors, or QA can manage re-clean flags.' });
  const db = getDb();
  const { room, action, reason } = req.body || {};
  if (!['dismissed', 'na', 'not_in_use'].includes(action)) return res.status(400).json({ error: 'action must be dismissed, na, or not_in_use' });
  if (action === 'dismissed' && !(reason || '').trim()) return res.status(400).json({ error: 'A reason is required to dismiss a re-clean flag.' });
  const entry = recleanRooms(db).find(r => r.room === room);
  if (!entry) return res.status(404).json({ error: 'Room not found' });
  const id = uuid();
  db.prepare(`INSERT INTO reclean_actions (id, room, flag_key, action, reason, created_by, created_by_id)
              VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(id, room, entry.flag_key, action, (reason || '').trim() || null, req.user.name, req.user.id);
  logAudit(req.user, 'update', 'sanitation_reclean', id, { room, action, reason: reason || null }, null, null, room);
  res.status(201).json({ ok: true, rooms: recleanRooms(db) });
});

// Undo an action (re-arms the flag).
router.delete('/reclean-actions/:id', (req, res) => {
  if (!canManageReclean(req.user)) return res.status(403).json({ error: 'Only admins, supervisors, or QA can manage re-clean flags.' });
  const db = getDb();
  const existing = db.prepare('SELECT * FROM reclean_actions WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Not found' });
  db.prepare('DELETE FROM reclean_actions WHERE id = ?').run(req.params.id);
  logAudit(req.user, 'delete', 'sanitation_reclean', req.params.id, { room: existing.room, action: existing.action }, existing, null, existing.room);
  res.json({ ok: true, rooms: recleanRooms(db) });
});

// Assign the re-clean to the Cleaning team as a work order due today.
router.post('/reclean-assign', (req, res) => {
  if (!canManageReclean(req.user)) return res.status(403).json({ error: 'Only admins, supervisors, or QA can manage re-clean flags.' });
  const db = getDb();
  const { room } = req.body || {};
  const entry = recleanRooms(db).find(r => r.room === room);
  if (!entry) return res.status(404).json({ error: 'Room not found' });
  const woId = uuid();
  const today = new Date().toISOString().split('T')[0];
  const why = entry.status === 'dirty' ? 'used after its last passed clean' : `idle ${entry.hours_since_clean}h since last clean (72h rule)`;
  const eq = db.prepare('SELECT id FROM equipment WHERE room = ? OR location = ? LIMIT 1').get(room, room);
  db.prepare(`INSERT INTO work_orders (id, equipment_id, title, description, priority, due_date, procedure_steps, task_group, status)
              VALUES (?, ?, ?, ?, 'high', ?, '[]', 'cleaning', 'open')`)
    .run(woId, eq?.id || null, `72h Re-clean — ${room}`,
      `Room "${room}" needs a full re-clean before next use: ${why}. Log the clean in Sanitation when done.`, today);
  const id = uuid();
  db.prepare(`INSERT INTO reclean_actions (id, room, flag_key, action, work_order_id, created_by, created_by_id)
              VALUES (?, ?, ?, 'assigned', ?, ?, ?)`)
    .run(id, room, entry.flag_key, woId, req.user.name, req.user.id);
  logAudit(req.user, 'create', 'work_order', woId, { room, source: 'reclean_72h' }, null, null, `72h Re-clean — ${room}`);
  res.status(201).json({ ok: true, work_order_id: woId, rooms: recleanRooms(db) });
});

// Toggle whether the 72h rule applies to a room (SQF/NSF-relevant rooms only).
router.put('/reclean-rooms', (req, res) => {
  if (!canManageReclean(req.user)) return res.status(403).json({ error: 'Only admins, supervisors, or QA can manage the room list.' });
  const db = getDb();
  const { room, applicable } = req.body || {};
  if (!room) return res.status(400).json({ error: 'room is required' });
  db.prepare(`INSERT INTO reclean_rooms (room, applicable, updated_by, updated_at) VALUES (?, ?, ?, datetime('now'))
              ON CONFLICT(room) DO UPDATE SET applicable = excluded.applicable, updated_by = excluded.updated_by, updated_at = datetime('now')`)
    .run(room, applicable ? 1 : 0, req.user.name);
  logAudit(req.user, 'update', 'sanitation_reclean', room, { applicable: !!applicable }, null, null, room);
  res.json({ ok: true, rooms: recleanRooms(db) });
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
