import { Router } from 'express';
import { v4 as uuid } from 'uuid';
import { getDb, logAudit } from '../db.js';
import { requireRole } from '../middleware/auth.js';
import { hasExplicitEdit } from '../module-access.js';
import { getChannelByName, postMessageAs, getModuleLinks } from './comms.js';

// Production teams whose schedule gets published to a matching comms channel.
// Team name (as stored on assignments) → the channel it maps to.
const SCHEDULE_TEAM_CHANNELS = [
  { team: 'Batching', channel: 'batching' },
  { team: 'Kitting', channel: 'kitting' },
  { team: 'Filling', channel: 'filling-team' },
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
  return {
    ...entry,
    amendments: parseAmendments(entry.amendments),
    structured_data: parseJson(entry.structured_data, null),
    mo_lines: parseJson(entry.mo_lines, null),
    duration_hours, units_per_hour, units_per_minute, units_per_min_per_person,
  };
}

const parseJson = (raw, fallback) => { try { return raw ? JSON.parse(raw) : fallback; } catch { return fallback; } };

const parseAmendments = (raw) => { try { return JSON.parse(raw || '[]'); } catch { return []; } };

// Normalize the multi-MO line list (Batching runs several MOs a shift). Keeps
// only lines that name an MO or product; numbers are coerced, blanks dropped.
// Returns [] when nothing usable is present so callers can treat it as "none".
function normalizeMoLines(raw) {
  if (!Array.isArray(raw)) return [];
  const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };
  return raw
    .map(l => ({
      product_name: String(l?.product_name || '').trim(),
      mo_number: String(l?.mo_number || '').trim(),
      lot_number: String(l?.lot_number || '').trim(),
      batches: num(l?.batches),
      batch_weights: String(l?.batch_weights || '').trim(),
      quantity: num(l?.quantity),
    }))
    .filter(l => l.mo_number || l.product_name);
}

// ── EOD report templates (per team) ──────────────────────────────────────────
// A team's structured EOD survey. GET is open to anyone filing a report (they
// need it to render the form); editing the template is a log-edit act.
router.get('/eod-templates', (req, res) => {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM eod_templates WHERE is_active = 1').all();
  const out = {};
  for (const r of rows) out[r.team] = { team: r.team, title: r.title, fields: parseJson(r.fields, []) };
  res.json(out);
});

router.put('/eod-templates/:team', (req, res) => {
  if (!canEditLog(req.user)) return res.status(403).json({ error: 'Editing EOD templates requires a Production Log edit grant (Settings) or admin.' });
  const db = getDb();
  const team = req.params.team;
  const fields = Array.isArray(req.body?.fields) ? req.body.fields : [];
  // Normalize: each field needs a stable key and a known type. Keys are derived
  // from the label if absent so the admin only has to type a label.
  const TYPES = new Set(['text', 'number', 'select', 'checkbox', 'textarea']);
  const clean = fields.map((f, i) => {
    const label = String(f.label || '').trim() || `Field ${i + 1}`;
    const key = String(f.key || '').trim() || label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || `field_${i + 1}`;
    const type = TYPES.has(f.type) ? f.type : 'text';
    const out = { key, label, type };
    if (type === 'select') out.options = (Array.isArray(f.options) ? f.options : []).map(o => String(o)).filter(Boolean);
    if (f.required) out.required = true;
    return out;
  });
  db.prepare(`INSERT INTO eod_templates (team, title, fields, is_active, updated_by, updated_at)
              VALUES (?, ?, ?, 1, ?, datetime('now'))
              ON CONFLICT(team) DO UPDATE SET title = excluded.title, fields = excluded.fields,
                is_active = 1, updated_by = excluded.updated_by, updated_at = datetime('now')`)
    .run(team, String(req.body?.title || '').trim() || `${team} EOD Report`, JSON.stringify(clean), req.user?.name || null);
  logAudit(req.user, 'update', 'eod_template', team, { fields: clean.length }, null, null, team);
  res.json(db.prepare('SELECT * FROM eod_templates WHERE team = ?').get(team));
});

// GET /entries — list production entries with optional filters
router.get('/entries', (req, res) => {
  const db = getDb();
  const { from, to, team, mo, room } = req.query;
  let sql = 'SELECT * FROM production_entries WHERE 1=1';
  const params = [];
  if (from) { sql += ' AND date >= ?'; params.push(from); }
  if (to) { sql += ' AND date <= ?'; params.push(to); }
  if (team) { sql += ' AND team = ?'; params.push(team); }
  if (mo) { sql += ' AND (mo_number = ? OR mo_lines LIKE ?)'; params.push(mo, `%${mo}%`); }
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
  const pending = db.prepare(`SELECT COUNT(*) as entries_pending_qa FROM production_entries WHERE ${where} AND qa_signoff_by IS NULL AND qa_waived_at IS NULL`).get(...params);

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
  let { date, team, room, line, product_name, mo_number, lot_number, start_time, end_time, quantity_completed, people_count, submitted_by, notes, structured_data, mo_lines } = req.body;

  // A shift can carry several MOs (Batching). When mo_lines is present, line 0
  // is mirrored into the scalar product/MO/lot/quantity columns so everything
  // that reads those columns keeps working; the full list is stored in mo_lines.
  const lines = normalizeMoLines(mo_lines);
  if (lines.length) {
    product_name = lines[0].product_name || product_name;
    mo_number = lines[0].mo_number || mo_number;
    lot_number = lines[0].lot_number || lot_number;
    // Shift quantity is the sum of the lines that recorded one (0 if none did).
    const lineQty = lines.reduce((s, l) => s + (l.quantity || 0), 0);
    if (quantity_completed == null) quantity_completed = lineQty;
  }

  if (!date || !team || !room || !product_name || !mo_number || !lot_number || !start_time || !end_time || quantity_completed == null || !people_count || !submitted_by) {
    return res.status(400).json({ error: 'Missing required fields: date, team, room, product_name, mo_number, lot_number, start_time, end_time, quantity_completed, people_count, submitted_by' });
  }

  // Team EOD template answers, stored as JSON. Only an object is accepted.
  const structured = structured_data && typeof structured_data === 'object' && !Array.isArray(structured_data)
    ? JSON.stringify(structured_data) : null;
  const moLinesJson = lines.length ? JSON.stringify(lines) : null;

  const id = uuid();
  db.prepare(`
    INSERT INTO production_entries (id, date, team, room, line, product_name, mo_number, lot_number, start_time, end_time, quantity_completed, people_count, notes, submitted_by, structured_data, mo_lines)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, date, team, room, line || null, product_name, mo_number, lot_number, start_time, end_time, quantity_completed, people_count, notes || null, submitted_by, structured, moLinesJson);

  const created = db.prepare('SELECT * FROM production_entries WHERE id = ?').get(id);
  logAudit(submitted_by, 'create', 'production_entry', id, req.body, null, created);
  res.status(201).json(computeMetrics(created));
});

/**
 * QA's sign-off on one production entry, including the "this note needs a
 * correction" flag that authorizes the filer to amend it.
 *
 * Exported so the QA Review Center signs through this rather than reproducing
 * the update — one place writes the signature, one audit shape, and the
 * needs-correction rule (a flag is meaningless without a note saying what to
 * fix) can't drift between the two screens.
 *
 * Returns { error, status } or { entry }.
 */
export function signOffProductionEntry(db, id, { by, notes, actionRequired } = {}) {
  const existing = db.prepare('SELECT * FROM production_entries WHERE id = ?').get(id);
  if (!existing) return { error: 'Production entry not found', status: 404 };
  if (!by) return { error: 'qa_signoff_by is required', status: 400 };

  // "Needs correction" only means something alongside a note — the note is what
  // tells the supervisor what to fix.
  const needsAction = !!actionRequired && !!(notes || '').trim();
  if (actionRequired && !needsAction) {
    return { error: 'Say what needs correcting in the notes before flagging this entry.', status: 400 };
  }

  db.prepare(`
    UPDATE production_entries SET qa_signoff_by = ?, qa_signoff_at = datetime('now'), qa_notes = ?,
      qa_action_required = ?, qa_action_resolved_at = NULL, updated_at = datetime('now') WHERE id = ?
  `).run(by, notes || null, needsAction ? 1 : 0, id);

  const updated = db.prepare('SELECT * FROM production_entries WHERE id = ?').get(id);
  logAudit(by, 'qa_signoff', 'production_entry', id, { qa_notes: notes, qa_action_required: needsAction }, existing, updated);
  return { entry: updated };
}

// PUT /entries/:id/qa-signoff — QA signs off on a production entry
router.put('/entries/:id/qa-signoff', (req, res) => {
  const { qa_signoff_by, qa_notes, qa_action_required } = req.body || {};
  const { error, status, entry } = signOffProductionEntry(getDb(), req.params.id, {
    by: qa_signoff_by, notes: qa_notes, actionRequired: qa_action_required,
  });
  if (error) return res.status(status).json({ error });
  res.json(computeMetrics(entry));
});

// GET /entries/qa-actions — entries QA has asked the caller to correct.
// Drives the banner on the Production Log so a flagged note doesn't depend on
// the supervisor happening to scroll past their own entry.
router.get('/entries/qa-actions', (req, res) => {
  const db = getDb();
  const me = req.user?.name || '';
  const all = req.user?.role === 'admin' || hasExplicitEdit(req.user, 'production-log');
  const rows = db.prepare(`
    SELECT * FROM production_entries
    WHERE qa_action_required = 1 AND qa_action_resolved_at IS NULL
    ORDER BY date DESC, qa_signoff_at DESC
  `).all();
  res.json(rows.filter(r => all || r.submitted_by === me).map(computeMetrics));
});

// POST /entries/import — bulk import from CSV data (rewrites the log → same
// guard as editing entries).
router.post('/entries/import', (req, res) => {
  if (!canEditLog(req.user)) return res.status(403).json({ error: 'Importing log entries requires an explicit Production Log edit grant (Settings) or admin.' });
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

// Editing EXISTING log entries is separate from submitting the EOD form:
// supervisors file EOD reports, but changing the log afterwards requires an
// admin or an explicit Production Log edit grant in Settings.
const canEditLog = (u) => u?.role === 'admin' || hasExplicitEdit(u, 'production-log');

// Fields a correction may touch, with the labels an auditor should read.
// `date` is deliberately absent: an EOD report filed against the wrong day is
// a different record, not a typo, and should be voided and re-filed.
const AMENDABLE = {
  product_name: 'Product', mo_number: 'MO #', lot_number: 'Lot #',
  team: 'Team', room: 'Room', line: 'Line',
  start_time: 'Start time', end_time: 'End time',
  quantity_completed: 'Quantity completed', people_count: 'People',
  notes: 'Notes', submitted_by: 'Submitted by',
};
const NUMERIC_FIELDS = new Set(['quantity_completed', 'people_count']);
const MIN_REASON = 10;

// PUT /entries/:id — amend a filed production entry.
//
// A filed EOD report is a record, so this is a correction with an audit trail,
// not an edit. Three rules make it defensible under SQF:
//   1. A reason is mandatory — a change nobody explained is a finding.
//   2. The original values survive. Every amendment stores each field's
//      before/after on the entry itself, so the correction is visible on the
//      record and not only in the audit log an auditor may never open.
//   3. Amending a QA-signed entry retires that signature (preserved in the
//      amendment) and returns the entry to Pending QA. A signature attests to
//      what was reviewed; change the record and it no longer attests to
//      anything, so QA must look again.
router.put('/entries/:id', (req, res) => {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM production_entries WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Production entry not found' });

  // QA flagging a note as actionable is itself the authorization to correct
  // THAT entry, and only by the person who filed it. That's deliberately
  // narrower than a standing edit grant: asking one supervisor to fix one
  // report shouldn't open the whole log to them.
  const invited = !!existing.qa_action_required && !existing.qa_action_resolved_at
    && existing.submitted_by === req.user?.name;
  if (!canEditLog(req.user) && !invited) {
    return res.status(403).json({ error: 'Editing log entries requires an explicit Production Log edit grant (Settings) or admin.' });
  }

  const reason = String(req.body?.reason || '').trim();
  if (reason.length < MIN_REASON) {
    return res.status(400).json({ error: `A reason for the correction is required (at least ${MIN_REASON} characters). It becomes part of the record.` });
  }

  // Diff first: only fields that actually differ become part of the amendment,
  // so re-saving an untouched form doesn't manufacture a correction.
  const changes = [];
  const updates = [];
  const values = [];
  for (const [field, label] of Object.entries(AMENDABLE)) {
    if (req.body[field] === undefined) continue;
    const next = NUMERIC_FIELDS.has(field) ? Number(req.body[field]) : (req.body[field] ?? '');
    if (NUMERIC_FIELDS.has(field) && !Number.isFinite(next)) {
      return res.status(400).json({ error: `${label} must be a number.` });
    }
    const prev = existing[field];
    if (String(prev ?? '') === String(next ?? '')) continue;
    changes.push({ field, label, from: prev ?? null, to: next });
    updates.push(`${field} = ?`);
    values.push(next);
  }

  // Multi-MO lines amend as a whole (they're a JSON array, not a scalar).
  // Mirror line 0 into the scalar product/MO/lot/quantity columns — but only
  // ones the caller didn't also send as their own amend, so a column is never
  // assigned twice in the same UPDATE.
  if (req.body.mo_lines !== undefined) {
    const nextLines = normalizeMoLines(req.body.mo_lines);
    const nextJson = nextLines.length ? JSON.stringify(nextLines) : null;
    if (String(existing.mo_lines ?? '') !== String(nextJson ?? '')) {
      changes.push({ field: 'mo_lines', label: 'MO lines', from: existing.mo_lines || null, to: nextJson });
      updates.push('mo_lines = ?');
      values.push(nextJson);
      if (nextLines.length) {
        const first = nextLines[0];
        const mirror = { product_name: first.product_name, mo_number: first.mo_number, lot_number: first.lot_number };
        for (const [f, v] of Object.entries(mirror)) {
          if (v && req.body[f] === undefined && String(existing[f] ?? '') !== String(v)) {
            updates.push(`${f} = ?`); values.push(v);
          }
        }
        const qty = nextLines.reduce((s, l) => s + (l.quantity || 0), 0);
        if (qty && req.body.quantity_completed === undefined && Number(existing.quantity_completed) !== qty) {
          updates.push('quantity_completed = ?'); values.push(qty);
        }
      }
    }
  }

  if (!changes.length) return res.status(400).json({ error: 'Nothing was changed.' });

  const wasSigned = existing.qa_signoff_by
    ? { by: existing.qa_signoff_by, at: existing.qa_signoff_at, notes: existing.qa_notes || null }
    : null;

  const amendment = {
    id: uuid(),
    amended_at: new Date().toISOString(),
    amended_by: req.user?.name || 'system',
    amended_by_id: req.user?.id || null,
    amended_by_role: req.user?.role || null,
    reason,
    changes,
    attestation: 'I certify that this correction is accurate, that the reason recorded above is truthful, and that the original entry has been preserved.',
    retired_qa_signoff: wasSigned,
    // Records that this amendment answers a QA request, so the round trip
    // (QA asked → supervisor corrected → QA re-signed) reads off the entry.
    resolves_qa_action: !!existing.qa_action_required && !existing.qa_action_resolved_at,
  };
  const amendments = [...parseAmendments(existing.amendments), amendment];

  updates.push('amendments = ?');
  values.push(JSON.stringify(amendments));
  if (wasSigned) {
    updates.push('qa_signoff_by = NULL', 'qa_signoff_at = NULL', 'qa_notes = NULL');
  }
  if (amendment.resolves_qa_action) {
    // The ask is answered; the entry goes back to Pending QA for a fresh look.
    updates.push('qa_action_required = 0', "qa_action_resolved_at = datetime('now')");
  }
  updates.push("updated_at = datetime('now')");
  values.push(req.params.id);
  db.prepare(`UPDATE production_entries SET ${updates.join(', ')} WHERE id = ?`).run(...values);

  const updated = db.prepare('SELECT * FROM production_entries WHERE id = ?').get(req.params.id);
  logAudit(req.user || 'system', 'amend', 'production_entry', req.params.id, {
    reason,
    changes: changes.map(c => ({ field: c.field, from: c.from, to: c.to })),
    qa_signoff_retired: !!wasSigned,
  }, existing, updated, `${existing.product_name} · MO ${existing.mo_number} · ${existing.date}`);
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

  // `append` means "add a line to this cell", not "write slot N". The repeat /
  // copy-to-next-week paths use it: they target a cell the editor isn't looking
  // at, so a fixed slot silently overwrote whatever was already scheduled there
  // — which read as "it won't let me put two things on Thursday".
  const appendSlot = req.body.append === true;
  const effectiveSlot = appendSlot
    ? ((db.prepare('SELECT MAX(slot) m FROM production_schedule WHERE week_start = ? AND day_of_week = ? AND room = ?')
        .get(week_start, day_of_week, room).m ?? -1) + 1)
    : slot;

  const existing = appendSlot ? null
    : db.prepare('SELECT * FROM production_schedule WHERE week_start = ? AND day_of_week = ? AND room = ? AND slot = ?').get(week_start, day_of_week, room, slot);

  if (existing) {
    db.prepare(`
      UPDATE production_schedule SET room_type = ?, team = ?, mo_number = ?, product_name = ?, start_time = ?, notes = ?, updated_by = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(room_type || 'production', team || null, mo_number || null, product_name || null, start_time || null, notes || null, updated_by || null, existing.id);
    // A different MO in this cell invalidates any prior flavor approval.
    if ((existing.mo_number || '') !== (mo_number || '') && existing.flavor_approved_at) {
      db.prepare('UPDATE production_schedule SET flavor_approved_by = NULL, flavor_approved_at = NULL WHERE id = ?').run(existing.id);
    }
    const updated = db.prepare('SELECT * FROM production_schedule WHERE id = ?').get(existing.id);
    logAudit(updated_by || 'system', 'update', 'production_schedule', existing.id, req.body, existing, updated);
    res.json(updated);
  } else {
    const id = uuid();
    db.prepare(`
      INSERT INTO production_schedule (id, week_start, day_of_week, room, slot, room_type, team, mo_number, product_name, start_time, notes, created_by, updated_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, week_start, day_of_week, room, effectiveSlot, room_type || 'production', team || null, mo_number || null, product_name || null, start_time || null, notes || null, updated_by || null, updated_by || null);
    const created = db.prepare('SELECT * FROM production_schedule WHERE id = ?').get(id);
    logAudit(updated_by || 'system', 'create', 'production_schedule', id, req.body, null, created);
    res.status(201).json(created);
  }
});

// POST /schedule/:id/flavor-approve — mark the scheduled MO's flavor approved
// and announce it in #batching + #document_control. { approved: false } clears.
router.post('/schedule/:id/flavor-approve', async (req, res) => {
  const db = getDb();
  const row = db.prepare('SELECT * FROM production_schedule WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Assignment not found' });
  const u = req.user || {};
  const allowed = u.role === 'admin' || u.role === 'supervisor' || ['qa', 'document_control'].includes(u.department);
  if (!allowed) return res.status(403).json({ error: 'Not authorized to approve flavors' });

  if (req.body?.approved === false) {
    db.prepare("UPDATE production_schedule SET flavor_approved_by = NULL, flavor_approved_at = NULL, updated_at = datetime('now') WHERE id = ?").run(row.id);
    const cleared = db.prepare('SELECT * FROM production_schedule WHERE id = ?').get(row.id);
    logAudit(req.user, 'update', 'production_schedule', row.id, { flavor_approved: false, mo_number: row.mo_number }, row, cleared);
    return res.json(cleared);
  }

  db.prepare("UPDATE production_schedule SET flavor_approved_by = ?, flavor_approved_at = datetime('now'), updated_at = datetime('now') WHERE id = ?").run(u.name || 'system', row.id);
  const updated = db.prepare('SELECT * FROM production_schedule WHERE id = ?').get(row.id);
  logAudit(req.user, 'update', 'production_schedule', row.id, { flavor_approved: true, mo_number: row.mo_number }, row, updated);

  try {
    const dayName = SCHED_DAY_NAMES[row.day_of_week] || '';
    const parts = [row.mo_number ? `MO ${row.mo_number}` : null, row.product_name, [dayName, row.room].filter(Boolean).join(' · '), `week of ${fmtWeekLabel(row.week_start)}`].filter(Boolean);
    const msg = `✅ Flavor Approved — ${parts.join(' · ')}\nApproved by ${u.name || 'ReadyDoc'}.`;
    for (const chName of ['batching', 'document control']) {
      const ch = getChannelByName(db, chName);
      if (ch) await postMessageAs(db, ch, u, msg);
    }
  } catch (e) {
    console.warn('[schedule] flavor-approve announcement failed:', e.message);
  }

  res.json(updated);
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

// POST /schedule/bulk-move — move several assignments into one day at once.
// Unlike /:id/move this can cross weeks (week_start), which is the whole point:
// people build next week by pulling this week's items forward. Every item is
// appended to the end of the target cell, so moving three MOs onto Thursday
// gives you three lines on Thursday instead of the last one winning.
router.post('/schedule/bulk-move', (req, res) => {
  const db = getDb();
  const { ids, room, room_type, updated_by } = req.body;
  const targetDay = req.body.day_of_week != null ? Number(req.body.day_of_week) : null;
  const targetWeek = req.body.week_start || null;

  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ error: 'ids must be a non-empty array' });
  }
  if (targetDay == null || !Number.isInteger(targetDay) || targetDay < 0 || targetDay > 4) {
    return res.status(400).json({ error: 'day_of_week must be an integer 0-4' });
  }

  const rows = ids
    .map(id => db.prepare('SELECT * FROM production_schedule WHERE id = ?').get(id))
    .filter(Boolean);
  if (rows.length === 0) return res.status(404).json({ error: 'No matching schedule assignments' });

  const nextSlot = db.prepare('SELECT MAX(slot) m FROM production_schedule WHERE week_start = ? AND day_of_week = ? AND room = ?');
  const update = db.prepare(`
    UPDATE production_schedule SET week_start = ?, day_of_week = ?, room = ?, slot = ?, room_type = ?, updated_by = ?, updated_at = datetime('now')
    WHERE id = ?
  `);

  const tx = db.transaction(() => {
    const moved = [];
    for (const row of rows) {
      const week = targetWeek || row.week_start;
      // Room follows the request when given, otherwise each item keeps its own —
      // a bulk move across days shouldn't quietly relocate everything to one room.
      const toRoom = room || row.room;
      const max = nextSlot.get(week, targetDay, toRoom).m;
      const slot = max == null ? 0 : max + 1;
      update.run(week, targetDay, toRoom, slot, room_type || row.room_type, updated_by || null, row.id);
      const updated = db.prepare('SELECT * FROM production_schedule WHERE id = ?').get(row.id);
      logAudit(updated_by || 'system', 'move', 'production_schedule', row.id,
        { from: { week: row.week_start, day: row.day_of_week, room: row.room }, to: { week, day: targetDay, room: toRoom }, bulk: true },
        row, updated);
      moved.push(updated);
    }
    return moved;
  });

  const moved = tx();
  res.json({ success: true, moved: moved.length, assignments: moved });
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
