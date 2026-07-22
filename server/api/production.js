import { Router } from 'express';
import { v4 as uuid } from 'uuid';
import { getDb, logAudit } from '../db.js';
import { requireRole } from '../middleware/auth.js';
import { getChannelByName, postMessageAs, getModuleLinks } from './comms.js';

// Production teams whose schedule gets published to a matching comms channel.
// Team name (as stored on assignments) → the channel it maps to.
const SCHEDULE_TEAM_CHANNELS = [
  { team: 'Batching', channel: 'batching' },
  { team: 'Kitting', channel: 'kitting' },
  { team: 'Stick Pack', channel: 'sticks' },
  { team: 'Hand Fill', channel: 'hand fill' },
];
const SCHED_DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];

function schedRowsForTeam(assignments, team) {
  return assignments
    .filter(a => a.team === team && a.room_type !== 'cleaning')
    .sort((a, b) => (a.day_of_week - b.day_of_week) || String(a.room).localeCompare(String(b.room)) || ((a.slot || 0) - (b.slot || 0)));
}
function schedFingerprint(rows) {
  return rows.map(a => `${a.day_of_week}|${a.room}|${a.slot || 0}|${a.mo_number || ''}|${a.product_name || ''}|${a.start_time || ''}|${a.notes || ''}`).join('\n');
}
function fmtWeekLabel(weekStart) {
  try { return new Date(weekStart + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); }
  catch { return weekStart; }
}
function fmtSchedTime(t) {
  if (!t) return '';
  const m = /^(\d{1,2}):(\d{2})/.exec(String(t));
  if (!m) return String(t);
  let h = +m[1]; const mm = m[2]; const ap = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${h}:${mm} ${ap}`;
}
function teamScheduleMessage(team, rows, weekStart, kind) {
  const head = `📋 ${team} — production schedule${kind === 'new' ? '' : ' (updated)'} · week of ${fmtWeekLabel(weekStart)}`;
  if (!rows.length) return `${head}\nNothing scheduled this week.`;
  const byDay = {};
  for (const a of rows) (byDay[a.day_of_week] ||= []).push(a);
  const lines = [head];
  for (let d = 0; d < 5; d++) {
    if (!byDay[d]) continue;
    lines.push(`${SCHED_DAY_NAMES[d]}:`);
    for (const a of byDay[d]) {
      const parts = [a.room, a.mo_number ? `MO ${a.mo_number}` : null, a.product_name, fmtSchedTime(a.start_time)].filter(Boolean);
      lines.push(`  • ${parts.join(' · ')}`);
      if (a.notes) lines.push(`    ↳ ${a.notes}`);
    }
  }
  return lines.join('\n');
}
function combinedScheduleMessage(assignments, weekStart, kind, changedTeams) {
  const counts = SCHEDULE_TEAM_CHANNELS.map(({ team }) => `${team}: ${schedRowsForTeam(assignments, team).length}`).join(' · ');
  const head = `📋 Production schedule ${kind === 'new' ? 'published' : 'updated'} · week of ${fmtWeekLabel(weekStart)}`;
  const changed = changedTeams.length ? `Team updates: ${changedTeams.join(', ')}.` : 'No team-level changes this time.';
  return `${head}\n${counts}\n${changed}\nOpen ReadyDoc → Schedule for the full grid.`;
}

const router = Router();

// Stable identity for a "missed report" slot, used to remember QA dismissals.
const missedKey = (d, room, mo, team) => `${d}|${room || ''}|${mo ? 'mo:' + mo : (team ? 'team:' + team : '*')}`;

// --- Helper: compute duration and rate metrics ---
function computeMetrics(entry) {
  const [sh, sm] = entry.start_time.split(':').map(Number);
  const [eh, em] = entry.end_time.split(':').map(Number);
  let startMinutes = sh * 60 + sm;
  let endMinutes = eh * 60 + em;
  if (endMinutes <= startMinutes) endMinutes += 24 * 60; // overnight shift
  const duration_hours = (endMinutes - startMinutes) / 60;
  const units_per_hour = duration_hours > 0 ? entry.quantity_completed / duration_hours : 0;
  const units_per_minute = duration_hours > 0 ? entry.quantity_completed / (duration_hours * 60) : 0;
  const units_per_min_per_person = entry.people_count > 0 ? units_per_minute / entry.people_count : 0;
  return { ...entry, duration_hours, units_per_hour, units_per_minute, units_per_min_per_person };
}

// GET /entries — list production entries with optional filters
router.get('/entries', (req, res) => {
  const db = getDb();
  const { from, to, team, mo, room } = req.query;
  let sql = 'SELECT * FROM production_entries WHERE 1=1';
  const params = [];
  if (from) { sql += ' AND date >= ?'; params.push(from); }
  if (to) { sql += ' AND date <= ?'; params.push(to); }
  if (team) { sql += ' AND team = ?'; params.push(team); }
  if (mo) { sql += ' AND mo_number = ?'; params.push(mo); }
  if (room) { sql += ' AND room = ?'; params.push(room); }
  sql += ' ORDER BY date DESC, start_time DESC';
  const rows = db.prepare(sql).all(...params);
  res.json(rows.map(computeMetrics));
});

// GET /entries/summary — aggregated stats
router.get('/entries/summary', (req, res) => {
  const db = getDb();
  const { from, to } = req.query;
  let where = '1=1';
  const params = [];
  if (from) { where += ' AND date >= ?'; params.push(from); }
  if (to) { where += ' AND date <= ?'; params.push(to); }

  const totals = db.prepare(`SELECT COUNT(*) as total_entries, COALESCE(SUM(quantity_completed),0) as total_quantity, COUNT(DISTINCT mo_number) as unique_mos FROM production_entries WHERE ${where}`).get(...params);
  const entries_by_team = db.prepare(`SELECT team, COUNT(*) as count, COALESCE(SUM(quantity_completed),0) as total_qty FROM production_entries WHERE ${where} GROUP BY team ORDER BY team`).all(...params);
  const entries_by_room = db.prepare(`SELECT room, COUNT(*) as count FROM production_entries WHERE ${where} GROUP BY room ORDER BY room`).all(...params);
  const pending = db.prepare(`SELECT COUNT(*) as entries_pending_qa FROM production_entries WHERE ${where} AND qa_signoff_by IS NULL`).get(...params);

  res.json({
    ...totals,
    entries_by_team,
    entries_by_room,
    entries_pending_qa: pending.entries_pending_qa
  });
});

// GET /missed-reports — scheduled production slots (past / today) with no
// matching end-of-day entry, so a supervisor's missing report is visible at a
// glance. A slot is "reported" when an entry exists for the same date + room
// and matching MO# (or team, when the schedule has no MO#).
router.get('/missed-reports', (req, res) => {
  const db = getDb();
  const { from, to, include_today, include_dismissed } = req.query;
  const today = new Date().toISOString().slice(0, 10);
  const cutoff = include_today === '1' ? today : new Date(Date.now() - 86400000).toISOString().slice(0, 10);

  const scheduled = db.prepare(`
    SELECT s.room, s.team, s.mo_number, s.product_name, s.start_time,
      date(s.week_start, '+' || s.day_of_week || ' days') AS sched_date
    FROM production_schedule s
    WHERE s.room_type = 'production'
  `).all().filter(r =>
    r.sched_date && r.sched_date <= cutoff && (!from || r.sched_date >= from) && (!to || r.sched_date <= to)
  );

  const entries = db.prepare('SELECT date, room, team, mo_number FROM production_entries').all();
  const reported = (s) => entries.some(e =>
    e.date === s.sched_date && e.room === s.room &&
    (s.mo_number ? String(e.mo_number) === String(s.mo_number) : (s.team ? e.team === s.team : true)));

  const dismissals = {};
  for (const d of db.prepare('SELECT * FROM production_missed_dismissals').all()) dismissals[d.dismiss_key] = d;
  const includeDismissed = include_dismissed === '1';

  const missed = scheduled.filter(s => !reported(s)).map(s => {
    const key = missedKey(s.sched_date, s.room, s.mo_number, s.team);
    const dis = dismissals[key];
    return {
      date: s.sched_date, room: s.room, team: s.team, mo_number: s.mo_number,
      product_name: s.product_name, start_time: s.start_time,
      days_ago: Math.round((new Date(today) - new Date(s.sched_date)) / 86400000),
      dismiss_key: key,
      dismissed: !!dis,
      dismiss_reason: dis?.reason || null,
      dismissed_by: dis?.dismissed_by || null,
      dismissed_at: dis?.created_at || null,
    };
  }).filter(m => includeDismissed || !m.dismissed);
  missed.sort((a, b) => b.date.localeCompare(a.date) || a.room.localeCompare(b.room));
  res.json(missed);
});

// Dismiss a missed-report callout after QA review (records who/why for audit).
router.post('/missed-reports/dismiss', requireRole('admin', 'supervisor'), (req, res) => {
  const db = getDb();
  const { date, room, mo_number, team, reason } = req.body || {};
  if (!date || !room) return res.status(400).json({ error: 'date and room are required' });
  const key = missedKey(date, room, mo_number, team);
  db.prepare(`INSERT INTO production_missed_dismissals (id, dismiss_key, sched_date, room, mo_number, team, reason, dismissed_by, dismissed_by_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(dismiss_key) DO UPDATE SET reason = excluded.reason, dismissed_by = excluded.dismissed_by, dismissed_by_id = excluded.dismissed_by_id, created_at = datetime('now')`)
    .run(uuid(), key, date, room, mo_number || null, team || null, (reason || '').slice(0, 500) || null, req.user.name, req.user.id);
  logAudit(req.user, 'dismiss', 'production_missed_report', key, { date, room, mo_number, team, reason }, null, null, `${room} · ${date}`);
  res.json({ ok: true, dismiss_key: key });
});

// Undo a dismissal — the callout returns to the active list.
router.post('/missed-reports/restore', requireRole('admin', 'supervisor'), (req, res) => {
  const db = getDb();
  const { dismiss_key, date, room, mo_number, team } = req.body || {};
  const key = dismiss_key || missedKey(date, room, mo_number, team);
  const info = db.prepare('DELETE FROM production_missed_dismissals WHERE dismiss_key = ?').run(key);
  if (info.changes) logAudit(req.user, 'restore', 'production_missed_report', key, null, null, null, key);
  res.json({ ok: true });
});

// POST /entries — create a new production entry
router.post('/entries', (req, res) => {
  const db = getDb();
  const { date, team, room, product_name, mo_number, lot_number, start_time, end_time, quantity_completed, people_count, submitted_by, notes } = req.body;

  if (!date || !team || !room || !product_name || !mo_number || !lot_number || !start_time || !end_time || quantity_completed == null || !people_count || !submitted_by) {
    return res.status(400).json({ error: 'Missing required fields: date, team, room, product_name, mo_number, lot_number, start_time, end_time, quantity_completed, people_count, submitted_by' });
  }

  const id = uuid();
  db.prepare(`
    INSERT INTO production_entries (id, date, team, room, product_name, mo_number, lot_number, start_time, end_time, quantity_completed, people_count, notes, submitted_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, date, team, room, product_name, mo_number, lot_number, start_time, end_time, quantity_completed, people_count, notes || null, submitted_by);

  const created = db.prepare('SELECT * FROM production_entries WHERE id = ?').get(id);
  logAudit(submitted_by, 'create', 'production_entry', id, req.body, null, created);
  res.status(201).json(computeMetrics(created));
});

// PUT /entries/:id/qa-signoff — QA signs off on a production entry
router.put('/entries/:id/qa-signoff', (req, res) => {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM production_entries WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Production entry not found' });

  const { qa_signoff_by, qa_notes } = req.body;
  if (!qa_signoff_by) return res.status(400).json({ error: 'qa_signoff_by is required' });

  db.prepare(`
    UPDATE production_entries SET qa_signoff_by = ?, qa_signoff_at = datetime('now'), qa_notes = ?, updated_at = datetime('now') WHERE id = ?
  `).run(qa_signoff_by, qa_notes || null, req.params.id);

  const updated = db.prepare('SELECT * FROM production_entries WHERE id = ?').get(req.params.id);
  logAudit(qa_signoff_by, 'qa_signoff', 'production_entry', req.params.id, { qa_notes }, existing, updated);
  res.json(computeMetrics(updated));
});

// POST /entries/import — bulk import from CSV data
router.post('/entries/import', (req, res) => {
  const db = getDb();
  const { entries } = req.body;
  if (!Array.isArray(entries) || entries.length === 0) {
    return res.status(400).json({ error: 'entries array is required and must not be empty' });
  }

  const insert = db.prepare(`
    INSERT INTO production_entries (id, date, team, room, product_name, mo_number, lot_number, start_time, end_time, quantity_completed, people_count, notes, submitted_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const tx = db.transaction((rows) => {
    let count = 0;
    for (const e of rows) {
      const id = uuid();
      insert.run(id, e.date, e.team, e.room, e.product_name, e.mo_number, e.lot_number, e.start_time, e.end_time, e.quantity_completed, e.people_count, e.notes || null, e.submitted_by);
      count++;
    }
    return count;
  });

  try {
    const imported = tx(entries);
    res.status(201).json({ imported });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// PUT /entries/:id — update a production entry field
router.put('/entries/:id', (req, res) => {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM production_entries WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Production entry not found' });

  const allowed = ['submitted_by', 'notes', 'team', 'room', 'product_name', 'mo_number', 'lot_number'];
  const updates = [];
  const values = [];
  for (const field of allowed) {
    if (req.body[field] !== undefined) {
      updates.push(`${field} = ?`);
      values.push(req.body[field]);
    }
  }
  if (updates.length === 0) return res.status(400).json({ error: 'No valid fields to update' });

  updates.push("updated_at = datetime('now')");
  values.push(req.params.id);
  db.prepare(`UPDATE production_entries SET ${updates.join(', ')} WHERE id = ?`).run(...values);

  const updated = db.prepare('SELECT * FROM production_entries WHERE id = ?').get(req.params.id);
  logAudit(req.user || 'system', 'update', 'production_entry', req.params.id, req.body, existing, updated);
  res.json(computeMetrics(updated));
});

// GET /schedule — get schedule for a week
router.get('/schedule', (req, res) => {
  const db = getDb();
  const { week_start } = req.query;
  if (!week_start) return res.status(400).json({ error: 'week_start query param is required' });

  const assignments = db.prepare('SELECT * FROM production_schedule WHERE week_start = ? ORDER BY day_of_week, room, slot').all(week_start);
  const cleaning_levels = db.prepare('SELECT * FROM production_cleaning_levels WHERE week_start = ? ORDER BY day_of_week, room').all(week_start);
  res.json({ assignments, cleaning_levels });
});

// POST /schedule — create or update a schedule assignment
router.post('/schedule', (req, res) => {
  const db = getDb();
  const { week_start, day_of_week, room, room_type, team, mo_number, product_name, start_time, notes, updated_by } = req.body;
  const slot = Number.isInteger(req.body.slot) ? req.body.slot : 0;

  if (!week_start || day_of_week == null || !room) {
    return res.status(400).json({ error: 'week_start, day_of_week, and room are required' });
  }

  const existing = db.prepare('SELECT * FROM production_schedule WHERE week_start = ? AND day_of_week = ? AND room = ? AND slot = ?').get(week_start, day_of_week, room, slot);

  if (existing) {
    db.prepare(`
      UPDATE production_schedule SET room_type = ?, team = ?, mo_number = ?, product_name = ?, start_time = ?, notes = ?, updated_by = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(room_type || 'production', team || null, mo_number || null, product_name || null, start_time || null, notes || null, updated_by || null, existing.id);
    const updated = db.prepare('SELECT * FROM production_schedule WHERE id = ?').get(existing.id);
    logAudit(updated_by || 'system', 'update', 'production_schedule', existing.id, req.body, existing, updated);
    res.json(updated);
  } else {
    const id = uuid();
    db.prepare(`
      INSERT INTO production_schedule (id, week_start, day_of_week, room, slot, room_type, team, mo_number, product_name, start_time, notes, created_by, updated_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, week_start, day_of_week, room, slot, room_type || 'production', team || null, mo_number || null, product_name || null, start_time || null, notes || null, updated_by || null, updated_by || null);
    const created = db.prepare('SELECT * FROM production_schedule WHERE id = ?').get(id);
    logAudit(updated_by || 'system', 'create', 'production_schedule', id, req.body, null, created);
    res.status(201).json(created);
  }
});

// POST /schedule/duplicate-day — copy one day's assignments/cleaning to other days of the same week
router.post('/schedule/duplicate-day', (req, res) => {
  const db = getDb();
  const { week_start, source_day, target_days, updated_by } = req.body;
  const includeAssignments = req.body.include_assignments !== false;
  const includeCleaning = req.body.include_cleaning !== false;

  if (!week_start || source_day == null || !Array.isArray(target_days)) {
    return res.status(400).json({ error: 'week_start, source_day, and target_days are required' });
  }
  const targets = [...new Set(target_days.map(Number))].filter(d => Number.isInteger(d) && d >= 0 && d <= 4 && d !== Number(source_day));
  if (targets.length === 0) {
    return res.status(400).json({ error: 'target_days must contain at least one weekday (0-4) other than source_day' });
  }
  if (!includeAssignments && !includeCleaning) {
    return res.status(400).json({ error: 'Nothing to copy: enable assignments and/or cleaning' });
  }

  const assignments = db.prepare('SELECT * FROM production_schedule WHERE week_start = ? AND day_of_week = ?').all(week_start, source_day);
  const cleaning = db.prepare('SELECT * FROM production_cleaning_levels WHERE week_start = ? AND day_of_week = ?').all(week_start, source_day);

  const deleteAssignments = db.prepare('DELETE FROM production_schedule WHERE week_start = ? AND day_of_week = ?');
  const deleteCleaning = db.prepare('DELETE FROM production_cleaning_levels WHERE week_start = ? AND day_of_week = ?');
  const insertAssignment = db.prepare(`
    INSERT INTO production_schedule (id, week_start, day_of_week, room, slot, room_type, team, mo_number, product_name, start_time, notes, created_by, updated_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertCleaning = db.prepare(`
    INSERT INTO production_cleaning_levels (id, week_start, day_of_week, room, level, updated_by)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  const tx = db.transaction(() => {
    let copied_assignments = 0;
    let copied_cleaning = 0;
    for (const day of targets) {
      if (includeAssignments) {
        deleteAssignments.run(week_start, day);
        for (const a of assignments) {
          insertAssignment.run(uuid(), week_start, day, a.room, a.slot || 0, a.room_type, a.team, a.mo_number, a.product_name, a.start_time, a.notes, updated_by || null, updated_by || null);
          copied_assignments++;
        }
      }
      if (includeCleaning) {
        deleteCleaning.run(week_start, day);
        for (const c of cleaning) {
          insertCleaning.run(uuid(), week_start, day, c.room, c.level, updated_by || null);
          copied_cleaning++;
        }
      }
    }
    return { copied_assignments, copied_cleaning };
  });

  const result = tx();
  logAudit(updated_by || 'system', 'duplicate_day', 'production_schedule', week_start, { source_day, target_days: targets, include_assignments: includeAssignments, include_cleaning: includeCleaning, ...result }, null, null);
  res.json({ success: true, target_days: targets, ...result });
});

// PUT /schedule/:id/move — move an assignment to another day/room (drag & drop)
router.put('/schedule/:id/move', (req, res) => {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM production_schedule WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Schedule assignment not found' });

  const { room, room_type, updated_by } = req.body;
  const targetDay = req.body.day_of_week != null ? Number(req.body.day_of_week) : existing.day_of_week;
  const targetRoom = room || existing.room;

  if (!Number.isInteger(targetDay) || targetDay < 0 || targetDay > 4) {
    return res.status(400).json({ error: 'day_of_week must be an integer 0-4' });
  }

  // No-op when dropped back on the same cell
  if (targetDay === existing.day_of_week && targetRoom === existing.room) {
    return res.json(existing);
  }

  // Append to the end of the target cell so it never collides with an existing slot
  const maxSlot = db.prepare('SELECT MAX(slot) as m FROM production_schedule WHERE week_start = ? AND day_of_week = ? AND room = ?')
    .get(existing.week_start, targetDay, targetRoom).m;
  const newSlot = maxSlot == null ? 0 : maxSlot + 1;

  db.prepare(`
    UPDATE production_schedule SET day_of_week = ?, room = ?, slot = ?, room_type = ?, updated_by = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(targetDay, targetRoom, newSlot, room_type || existing.room_type, updated_by || null, existing.id);

  const updated = db.prepare('SELECT * FROM production_schedule WHERE id = ?').get(existing.id);
  logAudit(updated_by || 'system', 'move', 'production_schedule', existing.id,
    { from: { day: existing.day_of_week, room: existing.room }, to: { day: targetDay, room: targetRoom } }, existing, updated);
  res.json(updated);
});

// DELETE /schedule/:id — delete a schedule assignment
router.delete('/schedule/:id', (req, res) => {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM production_schedule WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Schedule assignment not found' });

  db.prepare('DELETE FROM production_schedule WHERE id = ?').run(req.params.id);
  logAudit(req.user || 'system', 'delete', 'production_schedule', req.params.id, null, existing, null);
  res.json({ success: true });
});

// POST /schedule/cleaning — create or update a cleaning level
router.post('/schedule/cleaning', (req, res) => {
  const db = getDb();
  const { week_start, day_of_week, room, level, updated_by } = req.body;

  if (!week_start || day_of_week == null || !room) {
    return res.status(400).json({ error: 'week_start, day_of_week, and room are required' });
  }

  const existing = db.prepare('SELECT * FROM production_cleaning_levels WHERE week_start = ? AND day_of_week = ? AND room = ?').get(week_start, day_of_week, room);

  if (existing) {
    db.prepare(`
      UPDATE production_cleaning_levels SET level = ?, updated_by = ?, updated_at = datetime('now') WHERE id = ?
    `).run(level || null, updated_by || null, existing.id);
    const updated = db.prepare('SELECT * FROM production_cleaning_levels WHERE id = ?').get(existing.id);
    logAudit(updated_by || 'system', 'update', 'production_cleaning_level', existing.id, req.body, existing, updated);
    res.json(updated);
  } else {
    const id = uuid();
    db.prepare(`
      INSERT INTO production_cleaning_levels (id, week_start, day_of_week, room, level, updated_by)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, week_start, day_of_week, room, level || null, updated_by || null);
    const created = db.prepare('SELECT * FROM production_cleaning_levels WHERE id = ?').get(id);
    logAudit(updated_by || 'system', 'create', 'production_cleaning_level', id, req.body, null, created);
    res.status(201).json(created);
  }
});

// --- Schedule "publish/notify" marker ---------------------------------------
// Admins press Notify when the week's schedule is ready; everyone else sees a
// New/Updated badge on the Schedule tab until they open it. The marker is a
// single app-wide row (keyed by week_start so the label reflects the week that
// changed); per-user "seen" state lives on users.schedule_seen_at.
function getSetting(db, key) {
  try { return db.prepare('SELECT value FROM app_settings WHERE key = ?').get(key)?.value ?? null; }
  catch { return null; }
}
function setSetting(db, key, value) {
  db.prepare(`INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
              ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`).run(key, value);
}

// POST /schedule/notify — admin publishes the schedule (kind: 'new' | 'updated').
// Also posts a per-team schedule overview to each production team's comms
// channel (only teams whose schedule actually changed since the last publish),
// plus a combined summary to #production — authored by the publisher.
router.post('/schedule/notify', requireRole('admin'), async (req, res) => {
  const db = getDb();
  const kind = req.body?.kind === 'new' ? 'new' : 'updated';
  const weekStart = req.body?.week_start || null;
  // Millisecond-precision timestamp (same format as schedule_seen_at) so the
  // unseen comparison is exact even for rapid notify/seen sequences.
  const at = db.prepare("SELECT strftime('%Y-%m-%d %H:%M:%f','now') AS t").get().t;
  setSetting(db, 'schedule_notified_at', at);
  setSetting(db, 'schedule_notify_kind', kind);
  if (weekStart) setSetting(db, 'schedule_notify_week', weekStart);
  // The publisher has, by definition, already seen it.
  if (req.user?.id) db.prepare("UPDATE users SET schedule_seen_at = ? WHERE id = ?").run(at, req.user.id);
  logAudit(req.user || 'system', 'notify', 'production_schedule', weekStart || 'week', { kind, week_start: weekStart }, null, null);

  // Best-effort channel publishing — never fail the notify itself.
  let posted = [];
  try {
    if (weekStart && req.user?.id) {
      const assignments = db.prepare('SELECT * FROM production_schedule WHERE week_start = ?').all(weekStart);
      const changedTeams = [];
      for (const { team, channel } of SCHEDULE_TEAM_CHANNELS) {
        const rows = schedRowsForTeam(assignments, team);
        const fp = schedFingerprint(rows);
        const key = `sched_fp_${weekStart}_${team}`;
        const prev = getSetting(db, key);
        setSetting(db, key, fp);
        if (prev === fp) continue;              // unchanged for this team → stay silent
        if (!rows.length && !prev) continue;    // never had anything → nothing to announce
        changedTeams.push(team);
        const ch = getChannelByName(db, channel);
        if (ch) { await postMessageAs(db, ch, req.user, teamScheduleMessage(team, rows, weekStart, kind)); posted.push(team); }
      }
      // Combined summary goes to the admin-configured channel for the Schedule
      // module (Messages → module links); default #production_schedule.
      const summaryName = getModuleLinks(db)['production-schedule'] ?? 'production_schedule';
      const prod = summaryName ? getChannelByName(db, summaryName) : null;
      if (prod) await postMessageAs(db, prod, req.user, combinedScheduleMessage(assignments, weekStart, kind, changedTeams));
    }
  } catch (e) {
    console.warn('[schedule] channel publish failed:', e.message);
  }

  res.json({ notified_at: at, kind, week_start: weekStart, posted_to: posted });
});

// GET /schedule/notify-status — is there an unseen schedule notice for me?
router.get('/schedule/notify-status', (req, res) => {
  const db = getDb();
  const notifiedAt = getSetting(db, 'schedule_notified_at');
  const kind = getSetting(db, 'schedule_notify_kind') || 'updated';
  const week = getSetting(db, 'schedule_notify_week') || null;
  let seenAt = null;
  if (req.user?.id) seenAt = db.prepare('SELECT schedule_seen_at FROM users WHERE id = ?').get(req.user.id)?.schedule_seen_at || null;
  const unseen = !!notifiedAt && (!seenAt || notifiedAt > seenAt);
  res.json({ notified_at: notifiedAt, kind, week_start: week, seen_at: seenAt, unseen });
});

// POST /schedule/seen — mark the schedule as viewed by the current user
router.post('/schedule/seen', (req, res) => {
  const db = getDb();
  if (req.user?.id) db.prepare("UPDATE users SET schedule_seen_at = strftime('%Y-%m-%d %H:%M:%f','now') WHERE id = ?").run(req.user.id);
  res.json({ ok: true });
});

export default router;
