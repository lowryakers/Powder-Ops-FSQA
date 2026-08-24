import { Router } from 'express';
import { v4 as uuid } from 'uuid';
import { getDb, logAudit } from '../db.js';
import { recordGroupFor } from '../qa-records.js';
import { activeChemicalNames } from '../chemicals.js';
import { areaLabel } from '../../shared/rooms.js';
import { canonicalArea, previewAreaNormalization, NON_PRODUCTION_AREAS } from '../sanitation-areas.js';
import { canVerifySanitation } from '../qa-signing.js';
import { recordEditPolicy, mayRevokeSignature } from '../record-permissions.js';
import { planQaRecordBackfill, runQaRecordBackfill } from '../qa-record-backfill.js';

const router = Router();

export { recordGroupFor };

router.get('/', (req, res) => {
  const db = getDb();
  const { area, type, from, to, result, equipment_id } = req.query;
  // Free-text search, ON THE SERVER. The panel used to have none at all, and a
  // client-side one would only ever search the page it had already been given —
  // the newest 500 of a log that keeps growing — which reads as "we have no
  // record of that" when the record is simply older than the cap.
  const q = String(req.query.q || '').trim().toLowerCase();
  // Default to cleaning records; 'qa' is the inspection list, 'all' is both.
  const group = req.query.group === 'qa' ? 'qa' : req.query.group === 'all' ? null : 'sanitation';
  let sql = `SELECT sr.*, e.name as equipment_name
    FROM sanitation_records sr LEFT JOIN equipment e ON sr.equipment_id = e.id WHERE 1=1`;
  const params = [];

  if (group) { sql += " AND COALESCE(sr.record_group, 'sanitation') = ?"; params.push(group); }

  if (area) { sql += ' AND sr.area = ?'; params.push(area); }
  if (q) {
    // The columns somebody actually looks a cleaning record up by: where, who,
    // what was used, and what they wrote.
    sql += ` AND (LOWER(sr.area) LIKE ? OR LOWER(COALESCE(sr.performed_by,'')) LIKE ?
                  OR LOWER(COALESCE(sr.notes,'')) LIKE ? OR LOWER(COALESCE(sr.chemicals_used,'')) LIKE ?
                  OR LOWER(COALESCE(sr.verified_by,'')) LIKE ? OR LOWER(COALESCE(e.name,'')) LIKE ?)`;
    const like = `%${q}%`;
    params.push(like, like, like, like, like, like);
  }
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
  // The server says what this user may do to each record; the client renders
  // what it's told (the qms.js rule). A verified record is closed to everyone
  // but an admin — the way back is revoking the verification.
  res.json(db.prepare(sql).all(...params).map(r => ({
    ...r,
    ...recordEditPolicy(req.user, { filedBy: r.performed_by, signedBy: r.verified_by }),
    can_revoke_verification: !!r.verified_by && mayRevokeSignature(req.user, r.verified_by),
  })));
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
// WHEN WAS THIS ROOM LAST CLEANED — from every place the plant records it.
//
// This read `sanitation_records` alone, and the production floor does not
// record its room cleans there. Batching logs them as `cleaning_events` on the
// production entry — that was a deliberate decision ("a clean is an EVENT, not
// a shift attribute", so a room and its blender can be cleaned to different
// levels in one shift) — and the 72-hour rule was looking somewhere else
// entirely. So every production room read `no_clean_on_record` forever, no
// matter how often it was actually cleaned.
//
// One fact, two places to write it, and a rule that only read one of them. The
// fix is to ask both, not to move the data: both are legitimate records of a
// clean, and the entry-level one carries detail (ATP swab, allergen swab, which
// blender) the sanitation form does not.
function lastCleanByArea(db) {
  const latest = new Map();
  const note = (area, at) => {
    if (!area || !at) return;
    const prev = latest.get(area);
    if (!prev || String(at) > String(prev)) latest.set(area, at);
  };
  try {
    for (const r of db.prepare(
      "SELECT area, MAX(performed_at) t FROM sanitation_records WHERE result = 'pass' GROUP BY area").all()) {
      note(r.area, r.t);
    }
  } catch { /* optional */ }
  try {
    // A cleaning event names its own room; blank means "the shift's room", the
    // same fallback the Production Log itself applies.
    for (const e of db.prepare(
      "SELECT date, room, cleaning_events FROM production_entries WHERE cleaning_events IS NOT NULL AND cleaning_events != '[]'").all()) {
      let events;
      try { events = JSON.parse(e.cleaning_events); } catch { continue; }
      if (!Array.isArray(events)) continue;
      for (const ev of events) {
        // Only a room-level clean counts as cleaning the ROOM. Wiping the
        // sifter does not reset the room's 72-hour clock, and treating it as
        // though it did would be the rule quietly excusing work nobody did.
        const scope = Array.isArray(ev?.scope) ? ev.scope.map(x => String(x).toLowerCase()) : [];
        if (scope.length && !scope.some(x => x.includes('room'))) continue;
        note(ev?.room || e.room, `${e.date} 23:59:00`);
      }
    }
  } catch { /* optional — older databases have no cleaning_events column */ }
  return latest;
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
  // CLEANING records only. The QA inspection lists live in this table too
  // (brittle plastic zones, light inspection zones, temp/humidity points —
  // 33 of them on a seeded database against 4 real cleaning areas), and every
  // one of them was entering the room list. Nothing was ever wrongly flagged,
  // because the non-food regex excluded them all, but they were the great bulk
  // of what made this screen unreadable. `record_group` already says which list
  // a record belongs to; this just asks it.
  try {
    db.prepare("SELECT DISTINCT area FROM sanitation_records WHERE COALESCE(record_group, 'sanitation') = 'sanitation'")
      .all().forEach(r => rooms.add(r.area));
  } catch { /* optional */ }
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
    // NON_PRODUCTION_AREAS comes from the canonical area list, so the picker
    // and the rule cannot disagree about whether QA Room owes a re-clean.
    const applicable = overrides.has(room)
      ? overrides.get(room)
      : !(NON_PRODUCTION_AREAS.has(room) || NONFOOD_DEFAULT.test(room) || isChemical(room));
    const flagKey = recleanFlagKey(room, clean, used);
    // A ROOM THAT HAS BEEN USED AND HAS NO CLEAN ON RECORD IS THE WORST CASE,
    // and it was the one case the rule ignored. `flagged` covered a clean that
    // had expired and a room used since its clean, but not a room used with no
    // passing clean at all — so the state that most needs somebody's attention
    // produced nothing. `unknown` (no clean, no use either) is still not
    // flagged: a room nobody has worked in owes nothing.
    const flagged = status === 'expired_72h' || status === 'dirty' || status === 'no_clean_on_record';
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
        : entry.status === 'no_clean_on_record'
          // Said plainly rather than dressed as a 72-hour lapse: these are
          // different problems and the second is worse.
          ? 'the room has been used in production and there is no passing clean on record'
          : `idle ${entry.hours_since_clean}h since last clean (72h rule)`;
      const woId = uuid();
      const eq = findEq.get(entry.room, entry.room);
      // The stored area is the Production Log's token ("7"), which is right for
      // the join and wrong on a task card. `72h Re-clean — 7` is not an
      // instruction. closeRecleanTasksFor() labels it the same way, so the
      // clean still finds and closes its own task.
      const title = `72h Re-clean — ${areaLabel(entry.room)}`;
      insWo.run(woId, eq?.id || null, title,
        `${areaLabel(entry.room)} needs a full re-clean before next use: ${why}. Log the clean in Sanitation when done.`, today);
      insAction.run(uuid(), entry.room, entry.flag_key, woId);
      logAudit('system', 'auto_generate', 'work_order', woId, { room: entry.room, source: 'reclean_72h' }, null, null, title);
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

/* ── Filing the records for inspections that were done and never recorded ─── */

// Preview writes NOTHING: it reports which completed QA inspection tasks have
// no record behind them, grouped by area and by month, so the months Daniela
// reported missing can be checked against what the backfill would actually
// file. Declared before `/:id`, or Express reads "qa-backfill" as an id.
router.get('/qa-backfill/preview', (req, res) => {
  if (!canManageReclean(req.user)) return res.status(403).json({ error: 'Only admins, supervisors, or QA can review the inspection backfill.' });
  res.json(planQaRecordBackfill(getDb()));
});

// File them. Every record is built from a completion that already exists and
// carries that completion's own date and person; a task nobody completed
// produces nothing. Idempotent, so running it twice files nothing the second
// time.
router.post('/qa-backfill', (req, res) => {
  if (!canManageReclean(req.user)) return res.status(403).json({ error: 'Only admins, supervisors, or QA can run the inspection backfill.' });
  try {
    res.json({ ok: true, ...runQaRecordBackfill(getDb(), { by: req.user?.name || 'system', group: req.body?.group || null }) });
  } catch (e) {
    console.error('[qa-backfill]', e);
    res.status(500).json({ error: e.message });
  }
});

/* ── Folding the free-text history onto the canonical areas ──────────────── */

// Preview writes NOTHING. This rewrites filed compliance records, so the counts
// go in front of a person first — the same preview-then-commit shape as every
// importer in here. Declared before `/:id`, or Express reads "areas" as an id.
router.get('/areas/preview', (req, res) => {
  if (!canManageReclean(req.user)) return res.status(403).json({ error: 'Only admins, supervisors, or QA can normalize areas.' });
  res.json(previewAreaNormalization(getDb()));
});

// Apply it. Audited PER RECORD plus one summary row — a bulk edit has to leave
// the trail a manual one would.
//
// Only the CLEANING group is touched: the QA inspection lists in this table use
// area as a zone name and have nothing to do with the room vocabulary.
router.post('/areas/normalize', (req, res) => {
  if (!canManageReclean(req.user)) return res.status(403).json({ error: 'Only admins, supervisors, or QA can normalize areas.' });
  const db = getDb();
  const plan = previewAreaNormalization(db);
  if (!plan.changes.length) return res.json({ ok: true, updated: 0, changes: [] });

  const rows = db.prepare(
    "SELECT id, area FROM sanitation_records WHERE COALESCE(record_group, 'sanitation') = 'sanitation' AND area IN (" +
    plan.changes.map(() => '?').join(',') + ')'
  ).all(...plan.changes.map(c => c.from));
  const to = new Map(plan.changes.map(c => [c.from, c.to]));
  const upd = db.prepare('UPDATE sanitation_records SET area = ? WHERE id = ?');

  let updated = 0;
  db.transaction(() => {
    for (const r of rows) {
      const next = to.get(r.area);
      if (!next || next === r.area) continue;
      upd.run(next, r.id);
      logAudit(req.user, 'update', 'sanitation_record', r.id, { field: 'area', from: r.area, to: next, source: 'area_normalization' },
        { area: r.area }, { area: next }, areaLabel(next));
      updated++;
    }
  })();

  logAudit(req.user, 'bulk_update', 'sanitation_record', 'area_normalization',
    { updated, changes: plan.changes, left_alone: plan.unmatched });
  res.json({ ok: true, updated, changes: plan.changes, unmatched: plan.unmatched });
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
  const { type, equipment_id, performed_by, chemicals_used, concentration, contact_time_minutes, rinse_verified, result, atp_reading, notes, chemical_id, performed_at, late_entry_reason } = req.body;

  if (!req.body?.area || !type || !performed_by || !result) {
    return res.status(400).json({ error: 'area, type, performed_by, and result are required' });
  }

  // Normalized on the SERVER, not only in the picker. The picker already sends
  // the canonical value, but the kiosk paths and the importers post here too,
  // and a rule the client alone applies is a suggestion. An area this does not
  // recognise is stored exactly as it arrived — see canonicalArea().
  const area = canonicalArea(req.body.area) || String(req.body.area).trim();

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
    const title = `72h Re-clean — ${areaLabel(area)}`;
    const open = db.prepare(`SELECT id FROM work_orders
      WHERE title = ? AND status IN ('open','in_progress','overdue','missed')`).all(title);
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
/**
 * QA's counter-signature on a cleaning record or a QA inspection.
 *
 * TWO THINGS WERE WRONG HERE and both mattered:
 *
 * 1. NO AUTHORIZATION AT ALL. `requireModuleWrite('sanitation')` on the mount
 *    lets a user through whenever `module_access` is null — which is its
 *    documented "role decides, nothing on the floor breaks" behaviour and the
 *    state most accounts are in — so any signed-in operator could apply QA's
 *    verification to any cleaning record. The QA Review Center already had the
 *    right rule in `canSignSanitation`; the module's own route went round it.
 *    That is the same two-doors-one-checked shape as the QMS router, and the
 *    reason `signQmsApproval` exists.
 *
 * 2. THE NAME CAME FROM THE REQUEST BODY, so the signature said whoever the
 *    caller typed. A counter-signature is a statement about who reviewed the
 *    record; taking it from the payload makes it a free-text field with a
 *    person's name in it. It comes from the SESSION now, like the scale check.
 *
 * Takes `user` rather than a name string for exactly that reason, and passes
 * the object to logAudit so actor_id/role/department are captured.
 * Returns { error, status } or { record }.
 */
export function verifySanitationRecord(db, user, id) {
  if (!canVerifySanitation(user)) {
    return { error: 'Only QA, supervisors or admins can verify a cleaning record.', status: 403 };
  }
  const existing = db.prepare('SELECT * FROM sanitation_records WHERE id = ?').get(id);
  if (!existing) return { error: 'Record not found', status: 404 };
  if (existing.verified_by) return { error: 'Already verified.', status: 400 };

  const verifiedBy = user?.name;
  if (!verifiedBy) return { error: 'Not authenticated', status: 401 };

  db.prepare("UPDATE sanitation_records SET verified_by = ?, verified_at = datetime('now') WHERE id = ?")
    .run(verifiedBy, id);

  const updated = db.prepare('SELECT * FROM sanitation_records WHERE id = ?').get(id);
  logAudit(user, 'verify', 'sanitation_record', id, null, existing, updated);
  return { record: updated };
}

router.put('/:id/verify', (req, res) => {
  const { error, status, record } = verifySanitationRecord(getDb(), req.user, req.params.id);
  if (error) return res.status(status || 400).json({ error });
  res.json(record);
});

// The way back from a verification is REVOKE, not "find an admin": the
// verifier who spots a wrong value revokes their own signature, corrects the
// record, and verifies again — all three steps audited. Same rule as QMS
// approvals.
router.delete('/:id/verify', (req, res) => {
  const db = getDb();
  const row = db.prepare('SELECT * FROM sanitation_records WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Record not found' });
  if (!row.verified_by) return res.status(400).json({ error: 'This record is not verified.' });
  if (!mayRevokeSignature(req.user, row.verified_by)) {
    return res.status(403).json({ error: `Only ${row.verified_by} or an admin can revoke this verification.` });
  }
  db.prepare('UPDATE sanitation_records SET verified_by = NULL, verified_at = NULL WHERE id = ?').run(row.id);
  const updated = db.prepare('SELECT * FROM sanitation_records WHERE id = ?').get(row.id);
  logAudit(req.user, 'update', 'sanitation_record', row.id,
    { verification_revoked: true, was_verified_by: row.verified_by }, row, updated, row.area);
  res.json(updated);
});

// Correcting a filed record. This route did not exist AT ALL — a sanitation
// record could be filed and verified but never corrected, by anyone, admin
// included. The policy is the house rule (server/record-permissions.js): the
// filer and the records roles while unsigned; once verified, admin only, with
// revoke as the way back.
router.put('/:id', (req, res) => {
  const db = getDb();
  const before = db.prepare('SELECT * FROM sanitation_records WHERE id = ?').get(req.params.id);
  if (!before) return res.status(404).json({ error: 'Record not found' });
  const policy = recordEditPolicy(req.user, { filedBy: before.performed_by, signedBy: before.verified_by });
  if (!policy.can_edit) return res.status(403).json({ error: policy.edit_block_reason });

  const b = req.body || {};
  const pick = (key, cur) => (b[key] === undefined ? cur : b[key]);
  const area = b.area !== undefined
    ? (canonicalArea(b.area) || String(b.area).trim())
    : before.area;
  if (!area || !String(pick('type', before.type)).trim() || !String(pick('performed_by', before.performed_by)).trim()
    || !String(pick('result', before.result)).trim()) {
    return res.status(400).json({ error: 'area, type, performed_by and result are required' });
  }

  let when = before.performed_at;
  if (b.performed_at !== undefined && b.performed_at !== null && String(b.performed_at).trim()) {
    const raw = /^\d{4}-\d{2}-\d{2}$/.test(b.performed_at) ? `${b.performed_at} 12:00:00` : String(b.performed_at);
    const parsed = new Date(raw.replace(' ', 'T'));
    if (Number.isNaN(parsed.getTime())) return res.status(400).json({ error: 'That date could not be read.' });
    if (parsed.getTime() > Date.now() + 60000) {
      return res.status(400).json({ error: 'A clean cannot be recorded for a future date.' });
    }
    when = raw;
  }

  db.prepare(`UPDATE sanitation_records SET area = ?, type = ?, equipment_id = ?, performed_by = ?,
      chemicals_used = ?, concentration = ?, contact_time_minutes = ?, rinse_verified = ?, result = ?,
      atp_reading = ?, notes = ?, chemical_id = ?, record_group = ?, performed_at = ?
    WHERE id = ?`)
    .run(area, pick('type', before.type), pick('equipment_id', before.equipment_id) || null,
      pick('performed_by', before.performed_by),
      pick('chemicals_used', before.chemicals_used) || null,
      pick('concentration', before.concentration) || null,
      b.contact_time_minutes === undefined ? before.contact_time_minutes : (b.contact_time_minutes ?? null),
      b.rinse_verified === undefined ? before.rinse_verified : (b.rinse_verified ? 1 : 0),
      pick('result', before.result),
      b.atp_reading === undefined ? before.atp_reading : (b.atp_reading ?? null),
      pick('notes', before.notes) || null,
      pick('chemical_id', before.chemical_id) || null,
      // The group follows the area — moving a record between the Sanitation
      // and QA Inspections lists is a consequence of what it IS, not a field.
      recordGroupFor(area), when, before.id);

  const after = db.prepare('SELECT * FROM sanitation_records WHERE id = ?').get(before.id);
  logAudit(req.user, 'update', 'sanitation_record', before.id, null, before, after, area);
  res.json({
    ...after,
    ...recordEditPolicy(req.user, { filedBy: after.performed_by, signedBy: after.verified_by }),
  });
});

export default router;
