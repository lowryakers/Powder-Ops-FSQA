import { Router } from 'express';
import { v4 as uuid } from 'uuid';
import { getDb, logAudit } from '../db.js';

const router = Router();

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

// GET /schedule — get schedule for a week
router.get('/schedule', (req, res) => {
  const db = getDb();
  const { week_start } = req.query;
  if (!week_start) return res.status(400).json({ error: 'week_start query param is required' });

  const assignments = db.prepare('SELECT * FROM production_schedule WHERE week_start = ? ORDER BY day_of_week, room').all(week_start);
  const cleaning_levels = db.prepare('SELECT * FROM production_cleaning_levels WHERE week_start = ? ORDER BY day_of_week, room').all(week_start);
  res.json({ assignments, cleaning_levels });
});

// POST /schedule — create or update a schedule assignment
router.post('/schedule', (req, res) => {
  const db = getDb();
  const { week_start, day_of_week, room, room_type, team, mo_number, product_name, start_time, notes, updated_by } = req.body;

  if (!week_start || day_of_week == null || !room) {
    return res.status(400).json({ error: 'week_start, day_of_week, and room are required' });
  }

  const existing = db.prepare('SELECT * FROM production_schedule WHERE week_start = ? AND day_of_week = ? AND room = ?').get(week_start, day_of_week, room);

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
      INSERT INTO production_schedule (id, week_start, day_of_week, room, room_type, team, mo_number, product_name, start_time, notes, created_by, updated_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, week_start, day_of_week, room, room_type || 'production', team || null, mo_number || null, product_name || null, start_time || null, notes || null, updated_by || null, updated_by || null);
    const created = db.prepare('SELECT * FROM production_schedule WHERE id = ?').get(id);
    logAudit(updated_by || 'system', 'create', 'production_schedule', id, req.body, null, created);
    res.status(201).json(created);
  }
});

// DELETE /schedule/:id — delete a schedule assignment
router.delete('/schedule/:id', (req, res) => {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM production_schedule WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Schedule assignment not found' });

  db.prepare('DELETE FROM production_schedule WHERE id = ?').run(req.params.id);
  logAudit(req.body._actor || 'system', 'delete', 'production_schedule', req.params.id, null, existing, null);
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

export default router;
