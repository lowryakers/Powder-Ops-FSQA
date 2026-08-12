import { Router } from 'express';
import { v4 as uuid } from 'uuid';
import { getDb, logAudit } from '../db.js';
import { recordGroupFor } from '../qa-records.js';
import { activeChemicalNames } from '../chemicals.js';

const router = Router();

export { recordGroupFor };

router.get('/', (req, res) => {
  const db = getDb();
  const { area, type, from, to, result, equipment_id } = req.query;
  // Default to cleaning records; 'qa' is the inspection list, 'all' is both.
  const group = req.query.group === 'qa' ? 'qa' : req.query.group === 'all' ? null : 'sanitation';
  let sql = `SELECT sr.*, e.name as equipment_name
    FROM sanitation_records sr LEFT JOIN equipment e ON sr.equipment_id = e.id WHERE 1=1`;
  const params = [];

  if (group) { sql += " AND COALESCE(sr.record_group, 'sanitation') = ?"; params.push(group); }

  if (area) { sql += ' AND sr.area = ?'; params.push(area); }
  if (type) { sql += ' AND sr.type = ?'; params.push(type); }
  if (result) { sql += ' AND sr.result = ?'; params.push(result); }
  if (equipment_id) { sql += ' AND sr.equipment_id = ?'; params.push(equipment_id); }
  if (from) { sql += ' AND sr.performed_at >= ?'; params.push(from); }
  if (to) { sql += ' AND sr.performed_at <= ?'; params.push(to); }

  // Bounded. This returned every record ever filed — the log only grows, and
  // it was shipping megabytes to a phone to render a screen of rows. Callers
  // that want history ask for it with from/to or a bigger limit; the default
  // is "recent", which is what the log is actually read for.
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 500, 1), 5000);
  sql += ' ORDER BY sr.performed_at DESC LIMIT ?';
  params.push(limit);
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
  // QA files sanitizer dilution checks in this log, and the area they type is
  // "Sanitizer dilution", not "Chemical dilution" — so the term above matched
  // nothing they actually write and a jug of sanitizer was being told to
  // re-clean itself every 72 hours. The check is a real record; it is just not
  // a room.
  'dilution', 'titration',
].join('|'), 'i');

function escapeRe(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

// A REGISTERED CHEMICAL IS NOT A ROOM.
//
// `sanitation_records.area` is free text, so a concentration check filed
// against "Simple Green" became a room in recleanRooms() with a 72-hour clock
// on it. The registry is already the single answer to "is this a chemical"
// (activeChemicalNames — the same one the kiosk and the sign-out use), so ask
// it rather than keeping a second hand-written list of product names in here
// that would drift the moment QA approves another sanitizer.
//
// Word-boundary matching, and only names of 4+ characters: a short chemical
// code would otherwise match half the room names in the plant. An admin
// override in reclean_rooms still wins over this, both directions.
function chemicalAreaTest(db) {
  let names = [];
  try { names = activeChemicalNames(db); } catch { /* optional */ }
  const parts = names.map(n => String(n || '').trim()).filter(n => n.length >= 4).map(escapeRe);
  if (!parts.length) return () => false;
  const re = new RegExp(`(^|[^a-z0-9])(${parts.join('|')})([^a-z0-9]|$)`, 'i');
  return (area) => re.test(String(area || ''));
}

// Actions (dismiss / N-A / not-in-use / assigned) bind to this key; a new
// passed clean or new use changes the key, which re-arms the flag.
function recleanFlagKey(room, clean, used) {
  return `${room}|${clean || 'none'}|${used || 'none'}`;
}

// Two GROUP BY passes, not two queries per room.
//
// This used to run `MAX(...) WHERE area = ?` and `MAX(...) WHERE room = ?` once
// per room. Neither has an index on the filtered column, so each one scanned
// its table — 53 rooms × 2 scans = 106 table scans, ~83ms, and it grew with
// both the room count and the history. That cost was paid by /notifications,
// /compliance/critical AND /sanitation/reclean-status, i.e. three times on
// every page load. Grouped, it's ~4ms and flat.
function lastCleanByArea(db) {
  try {
    return new Map(db.prepare(
      "SELECT area, MAX(performed_at) t FROM sanitation_records WHERE result = 'pass' GROUP BY area"
    ).all().map(r => [r.area, r.t]));
  } catch { return new Map(); }
}
function lastUseByRoom(db) {
  try {
    return new Map(db.prepare(
      'SELECT room, MAX(date) t FROM production_entries WHERE room IS NOT NULL GROUP BY room'
    ).all().map(r => [r.room, r.t]));
  } catch { return new Map(); }
}

export function recleanRooms(db) {
  const rooms = new Set();
  try { db.prepare("SELECT DISTINCT room FROM production_entries WHERE room IS NOT NULL").all().forEach(r => rooms.add(r.room)); } catch { /* optional */ }
  try { db.prepare("SELECT DISTINCT room FROM production_schedule WHERE room IS NOT NULL AND room_type != 'cleaning'").all().forEach(r => rooms.add(r.room)); } catch { /* optional */ }
  try { db.prepare('SELECT DISTINCT area FROM sanitation_records').all().forEach(r => rooms.add(r.area)); } catch { /* optional */ }
  let overrides = new Map();
  try { overrides = new Map(db.prepare('SELECT room, applicable FROM reclean_rooms').all().map(r => [r.room, !!r.applicable])); } catch { /* optional */ }
  const cleanBy = lastCleanByArea(db);
  const useBy = lastUseByRoom(db);
  const isChemical = chemicalAreaTest(db);
  let latestAction = null;
  try { latestAction = db.prepare('SELECT * FROM reclean_actions WHERE room = ? AND flag_key = ? ORDER BY created_at DESC LIMIT 1'); } catch { /* optional */ }
  const now = Date.now();
  const out = [];
  for (const room of rooms) {
    const clean = cleanBy.get(room) || null;
    const used = useBy.get(room) || null;
    let status, hoursIdle = null;
    if (!clean) {
      status = used ? 'no_clean_on_record' : 'unknown';
    } else if (used && used > clean.slice(0, 10)) {
      status = 'dirty'; // used after the last passed clean
    } else {
      hoursIdle = Math.floor((now - new Date(clean.replace(' ', 'T') + 'Z').getTime()) / 3600000);
      status = hoursIdle >= 72 ? 'expired_72h' : 'clean';
    }
    const applicable = overrides.has(room)
      ? overrides.get(room)
      : !(NONFOOD_DEFAULT.test(room) || isChemical(room));
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

// A flagged room becomes a TASK by itself.
//
// It used to wait for a supervisor to press "Assign" — until then the only
// trace was a badge on the Sanitation module, which the cleaner may not even
// have. So a room that needed re-cleaning was invisible to the one person
// whose job it was, which is how a few got missed. The Operator View is
// deliberately only work orders (something to go and do), so the honest fix is
// to make this one.
//
// Idempotent on `flag_key`: the key changes only when the last clean or last
// use changes, so a room stays at exactly one open task and a new task appears
// only when the room is dirtied again. Dismiss / N-A still win — an existing
// action means a human already decided, and no task is raised.
export function generateRecleanTasks(db) {
  let rooms;
  try { rooms = recleanRooms(db).filter(r => r.needs_attention); } catch { return 0; }
  if (!rooms.length) return 0;
  const already = db.prepare("SELECT 1 FROM reclean_actions WHERE room = ? AND flag_key = ? LIMIT 1");
  const findEq = db.prepare('SELECT id FROM equipment WHERE room = ? OR location = ? LIMIT 1');
  const insWo = db.prepare(`INSERT INTO work_orders (id, equipment_id, title, description, priority, due_date, procedure_steps, task_group, status)
              VALUES (?, ?, ?, ?, 'high', ?, '[]', 'cleaning', 'open')`);
  const insAction = db.prepare(`INSERT INTO reclean_actions (id, room, flag_key, action, work_order_id, created_by, created_by_id)
              VALUES (?, ?, ?, 'assigned', ?, 'system', NULL)`);
  const today = new Date().toISOString().split('T')[0];
  let created = 0;
  const tx = db.transaction(() => {
    for (const entry of rooms) {
      if (already.get(entry.room, entry.flag_key)) continue;
      const why = entry.status === 'dirty'
        ? 'used after its last passed clean'
        : `idle ${entry.hours_since_clean}h since last clean (72h rule)`;
      const woId = uuid();
      const eq = findEq.get(entry.room, entry.room);
      insWo.run(woId, eq?.id || null, `72h Re-clean — ${entry.room}`,
        `Room "${entry.room}" needs a full re-clean before next use: ${why}. Log the clean in Sanitation when done.`, today);
      insAction.run(uuid(), entry.room, entry.flag_key, woId);
      logAudit('system', 'auto_generate', 'work_order', woId, { room: entry.room, source: 'reclean_72h' }, null, null, `72h Re-clean — ${entry.room}`);
      created++;
    }
  });
  tx();
  return created;
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
  // Dismissing or N-A'ing a flag also closes the task the rule raised for it —
  // otherwise the cleaner keeps seeing a job a supervisor has already decided
  // isn't needed. Cancelled, not deleted: the task existed and the record says
  // who stood it down.
  if (['dismissed', 'na', 'not_in_use'].includes(action)) {
    try {
      const prior = db.prepare("SELECT work_order_id FROM reclean_actions WHERE room = ? AND flag_key = ? AND work_order_id IS NOT NULL").all(room, entry.flag_key);
      for (const p of prior) {
        db.prepare(`UPDATE work_orders SET status = 'cancelled', completed_at = datetime('now'), completed_by = ?,
          notes = COALESCE(notes || char(10), '') || ?, updated_at = datetime('now')
          WHERE id = ? AND status IN ('open','in_progress','overdue','missed')`)
          .run(req.user.name, `Re-clean flag marked "${action.replace(/_/g, ' ')}" by ${req.user.name}${reason ? `: ${reason}` : ''}`, p.work_order_id);
      }
    } catch { /* the task may already be gone */ }
  }

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

// Filing a clean, including one done days ago.
//
// `performed_at` used to be "now" and nothing else, so work that was genuinely
// done but couldn't be logged — a locked-out account, a dead phone — had no way
// into the record at all. It can be back-dated now, on two conditions that keep
// it honest: it can never be in the FUTURE (that would be a record of something
// that hasn't happened), and anything more than a day back needs a reason. Both
// dates are stored, so the record reads "cleaned the 30th, entered the 4th"
// rather than pretending it was filed on the day.
router.post('/', (req, res) => {
  const db = getDb();
  const id = uuid();
  const { area, type, equipment_id, performed_by, chemicals_used, concentration, contact_time_minutes, rinse_verified, result, atp_reading, notes, chemical_id, performed_at, late_entry_reason } = req.body;

  if (!area || !type || !performed_by || !result) {
    return res.status(400).json({ error: 'area, type, performed_by, and result are required' });
  }

  let when = null;
  let late = 0;
  if (performed_at) {
    // Accept a date or a full timestamp; a bare date means end of that day's
    // shift rather than midnight, so the 72-hour clock isn't unfairly early.
    const raw = /^\d{4}-\d{2}-\d{2}$/.test(performed_at) ? `${performed_at} 12:00:00` : String(performed_at);
    const parsed = new Date(raw.replace(' ', 'T'));
    if (Number.isNaN(parsed.getTime())) return res.status(400).json({ error: 'That date could not be read.' });
    if (parsed.getTime() > Date.now() + 60000) {
      return res.status(400).json({ error: 'A clean cannot be recorded for a future date.' });
    }
    const daysBack = (Date.now() - parsed.getTime()) / 86400000;
    if (daysBack > 1) {
      if (!String(late_entry_reason || '').trim()) {
        return res.status(400).json({ error: 'Recording a clean from a previous day needs a reason — say why it is being entered now.' });
      }
      late = 1;
    }
    when = raw;
  }

  db.prepare(`
    INSERT INTO sanitation_records (id, area, type, equipment_id, performed_by, chemicals_used, concentration, contact_time_minutes, rinse_verified, result, atp_reading, notes, chemical_id, record_group, performed_at, entered_at, entered_late, late_entry_reason)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, datetime('now')), datetime('now'), ?, ?)
  `).run(id, area, type, equipment_id || null, performed_by, chemicals_used || null,
    concentration || null, contact_time_minutes ?? null, rinse_verified ? 1 : 0,
    result, atp_reading ?? null, notes || null, chemical_id || null, recordGroupFor(area),
    when, late, late ? String(late_entry_reason).trim() : null);

  const created = db.prepare('SELECT * FROM sanitation_records WHERE id = ?').get(id);
  const closed = result === 'pass' ? closeRecleanTasksFor(db, area, req.user?.name || performed_by, created) : 0;
  logAudit(req.user || performed_by, 'create', 'sanitation_record', id,
    { area, type, result, entered_late: !!late, performed_at: created.performed_at, reclean_tasks_closed: closed },
    null, created);
  res.status(201).json(created);
});

// Logging a passed clean closes the task the 72-hour rule raised for that room.
//
// Without this the cleaner does the job, files the record, and the task sits in
// her list anyway — so she either leaves it open or completes it separately and
// the two records disagree about when the work happened. The clean IS the
// completion, so it completes the task and says which record did it.
function closeRecleanTasksFor(db, area, who, record) {
  try {
    const open = db.prepare(`SELECT id FROM work_orders
      WHERE title = ? AND status IN ('open','in_progress','overdue','missed')`).all(`72h Re-clean — ${area}`);
    if (!open.length) return 0;
    const upd = db.prepare(`UPDATE work_orders SET status = 'completed', completed_at = datetime('now'), completed_by = ?,
      notes = COALESCE(notes || char(10), '') || ?, updated_at = datetime('now') WHERE id = ?`);
    for (const w of open) {
      upd.run(who, `Closed by the cleaning record filed for ${String(record.performed_at || '').slice(0, 10)}.`, w.id);
      logAudit(who, 'update', 'work_order', w.id, { closed_by_sanitation_record: record.id, area }, null, null, `72h Re-clean — ${area}`);
    }
    return open.length;
  } catch { return 0; }
}

/**
 * QA's verification signature on one cleaning or inspection record.
 *
 * Exported because the QA Review Center signs the same records from its own
 * screen. It calls THIS — it does not write the columns itself — so there is
 * exactly one place a sanitation verification is recorded and exactly one audit
 * entry shape, no matter which door QA came through.
 *
 * Returns { error } or { record }.
 */
export function verifySanitationRecord(db, id, verifiedBy) {
  const existing = db.prepare('SELECT * FROM sanitation_records WHERE id = ?').get(id);
  if (!existing) return { error: 'Record not found' };
  if (!verifiedBy) return { error: 'verified_by is required' };
  if (existing.verified_by) return { error: 'Already verified.' };

  db.prepare("UPDATE sanitation_records SET verified_by = ?, verified_at = datetime('now') WHERE id = ?")
    .run(verifiedBy, id);

  const updated = db.prepare('SELECT * FROM sanitation_records WHERE id = ?').get(id);
  logAudit(verifiedBy, 'verify', 'sanitation_record', id, null, existing, updated);
  return { record: updated };
}

router.put('/:id/verify', (req, res) => {
  const { error, record } = verifySanitationRecord(getDb(), req.params.id, req.body?.verified_by);
  if (error) return res.status(error === 'Record not found' ? 404 : 400).json({ error });
  res.json(record);
});

export default router;
