// Safety module: crisis contacts (FORM 501-01), evacuation headcounts
// (Form 501-02), first aid injury log (FORM 502-01).
//
// The contacts are a REFERENCE served from safety-forms.js — the document's
// list, never the roster. The other two file records. Filing is deliberately
// open to any signed-in user: the person holding the clipboard at the
// evacuation site, or the supervisor at the first aid kit, is whoever was
// there, and a safety record that only a manager may start is one that gets
// written up hours later from memory. Corrections and deletes are narrower.

import { Router } from 'express';
import { randomUUID as uuid } from 'crypto';
import { getDb, logAudit } from '../db.js';
import { parseJson } from '../custom-fields.js';
import {
  SAFETY_FORMS, EVAC_REVISION, EVAC_WORK_AREAS, EVAC_REASONS, FIRST_AID_REVISION,
} from '../safety-forms.js';

const router = Router();

const canCorrect = (u) => u?.role === 'admin' || u?.role === 'supervisor'
  || ['qa', 'quality', 'office', 'hr'].includes((u?.department || '').toLowerCase());

// The three forms, verbatim. Everything the panel renders comes from here.
router.get('/forms', (_req, res) => res.json(SAFETY_FORMS));

// ── Evacuation headcounts ───────────────────────────────────────────────────

const normalizeAreas = (input) => {
  if (!Array.isArray(input)) return [];
  return input.map(a => ({
    area: String(a?.area || '').slice(0, 60),
    total: Number.isFinite(Number(a?.total)) && a?.total !== '' && a?.total !== null ? Number(a.total) : null,
    accounted: Number.isFinite(Number(a?.accounted)) && a?.accounted !== '' && a?.accounted !== null ? Number(a.accounted) : null,
    // The circled code must be one the form prints; anything else is dropped
    // rather than stored as a reason the paper cannot show.
    reason: EVAC_REASONS[String(a?.reason || '').toUpperCase()] ? String(a.reason).toUpperCase() : null,
  })).filter(a => a.area);
};

const shapeEvac = (r) => {
  const areas = parseJson(r.areas, []) || [];
  return {
    ...r,
    areas,
    // Derived on read, never stored — correct a row and the totals move.
    total_in_areas: areas.reduce((s, a) => s + (a.total || 0), 0),
    total_accounted: areas.reduce((s, a) => s + (a.accounted || 0), 0),
    // The one number that matters at an evacuation site.
    unaccounted: areas.reduce((s, a) => s + Math.max(0, (a.total || 0) - (a.accounted || 0)), 0),
  };
};

router.get('/evacuations', (req, res) => {
  const db = getDb();
  const limit = Math.min(Number(req.query.limit) || 200, 500);
  res.json(db.prepare('SELECT * FROM evacuation_headcounts ORDER BY event_date DESC, created_at DESC LIMIT ?')
    .all(limit).map(shapeEvac));
});

router.post('/evacuations', (req, res) => {
  const db = getDb();
  const { event_date, event_time, is_drill, areas, notes, completed_by } = req.body || {};
  if (!event_date) return res.status(400).json({ error: 'The evacuation needs its date.' });
  const id = uuid();
  // A blank sheet starts with the form's own work areas so the person at the
  // evacuation site fills rows in rather than remembering which teams exist.
  const rows = normalizeAreas(areas?.length ? areas : EVAC_WORK_AREAS.map(a => ({ area: a })));
  db.prepare(`INSERT INTO evacuation_headcounts
    (id, form_revision, event_date, event_time, is_drill, areas, notes, completed_by, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    id, EVAC_REVISION, event_date, event_time || null, is_drill === false || is_drill === 0 ? 0 : 1,
    JSON.stringify(rows), notes || null, completed_by || req.user.name, req.user.name);
  const row = db.prepare('SELECT * FROM evacuation_headcounts WHERE id = ?').get(id);
  logAudit(req.user, 'evacuation_filed', 'evacuation_headcount', id,
    { event_date, is_drill: !!(is_drill ?? true) }, null, row, `Evacuation ${event_date}`);
  res.status(201).json(shapeEvac(row));
});

router.put('/evacuations/:id', (req, res) => {
  const db = getDb();
  const row = db.prepare('SELECT * FROM evacuation_headcounts WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  // The filer may keep working their own sheet; anyone else needs the ladder.
  if (row.created_by !== req.user.name && !canCorrect(req.user)) {
    return res.status(403).json({ error: 'Correcting someone else\'s record needs a supervisor, QA or the office.' });
  }
  const { event_date, event_time, is_drill, areas, notes, completed_by } = req.body || {};
  db.prepare(`UPDATE evacuation_headcounts SET
    event_date = COALESCE(?, event_date), event_time = COALESCE(?, event_time),
    is_drill = COALESCE(?, is_drill), areas = COALESCE(?, areas),
    notes = COALESCE(?, notes), completed_by = COALESCE(?, completed_by),
    updated_at = datetime('now') WHERE id = ?`).run(
    event_date || null, event_time || null,
    is_drill === undefined ? null : (is_drill ? 1 : 0),
    areas === undefined ? null : JSON.stringify(normalizeAreas(areas)),
    notes === undefined ? null : notes, completed_by || null, row.id);
  const updated = db.prepare('SELECT * FROM evacuation_headcounts WHERE id = ?').get(row.id);
  logAudit(req.user, 'evacuation_updated', 'evacuation_headcount', row.id, {}, row, updated,
    `Evacuation ${updated.event_date}`);
  res.json(shapeEvac(updated));
});

router.delete('/evacuations/:id', (req, res) => {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Only an admin can delete an evacuation record.' });
  const db = getDb();
  const row = db.prepare('SELECT * FROM evacuation_headcounts WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  db.prepare('DELETE FROM evacuation_headcounts WHERE id = ?').run(row.id);
  logAudit(req.user, 'evacuation_deleted', 'evacuation_headcount', row.id, {}, row, null,
    `Evacuation ${row.event_date}`);
  res.json({ ok: true });
});

// ── First aid injuries ──────────────────────────────────────────────────────

router.get('/first-aid', (req, res) => {
  const db = getDb();
  const limit = Math.min(Number(req.query.limit) || 200, 500);
  const { q } = req.query;
  let sql = 'SELECT * FROM first_aid_injuries WHERE 1=1';
  const params = [];
  if (q) {
    sql += ' AND (employee_name LIKE ? OR injury_description LIKE ? OR explanation LIKE ?)';
    const like = `%${q}%`;
    params.push(like, like, like);
  }
  sql += ' ORDER BY injury_date DESC, created_at DESC LIMIT ?';
  params.push(limit);
  res.json(db.prepare(sql).all(...params));
});

router.post('/first-aid', (req, res) => {
  const db = getDb();
  const { employee_name, injury_date, injury_description, explanation, supervisor_name, supervisor_date } = req.body || {};
  if (!employee_name || !injury_date) {
    return res.status(400).json({ error: 'The employee\'s name and the date of injury are required.' });
  }
  const id = uuid();
  db.prepare(`INSERT INTO first_aid_injuries
    (id, form_revision, employee_name, injury_date, injury_description, explanation, supervisor_name, supervisor_date, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    id, FIRST_AID_REVISION, employee_name, injury_date, injury_description || null,
    explanation || null, supervisor_name || null, supervisor_date || null, req.user.name);
  const row = db.prepare('SELECT * FROM first_aid_injuries WHERE id = ?').get(id);
  logAudit(req.user, 'first_aid_filed', 'first_aid_injury', id,
    { employee_name, injury_date }, null, row, `${employee_name} · ${injury_date}`);
  res.status(201).json(row);
});

router.put('/first-aid/:id', (req, res) => {
  const db = getDb();
  const row = db.prepare('SELECT * FROM first_aid_injuries WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  if (row.created_by !== req.user.name && !canCorrect(req.user)) {
    return res.status(403).json({ error: 'Correcting someone else\'s record needs a supervisor, QA or the office.' });
  }
  const cols = ['employee_name', 'injury_date', 'injury_description', 'explanation', 'supervisor_name', 'supervisor_date'];
  const patch = {};
  for (const c of cols) if (req.body?.[c] !== undefined) patch[c] = req.body[c] === '' ? null : req.body[c];
  if (Object.keys(patch).length) {
    db.prepare(`UPDATE first_aid_injuries SET ${Object.keys(patch).map(c => `${c} = ?`).join(', ')},
      updated_at = datetime('now') WHERE id = ?`).run(...Object.values(patch), row.id);
  }
  const updated = db.prepare('SELECT * FROM first_aid_injuries WHERE id = ?').get(row.id);
  logAudit(req.user, 'first_aid_updated', 'first_aid_injury', row.id, { fields: Object.keys(patch) },
    row, updated, `${updated.employee_name} · ${updated.injury_date}`);
  res.json(updated);
});

router.delete('/first-aid/:id', (req, res) => {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Only an admin can delete an injury record.' });
  const db = getDb();
  const row = db.prepare('SELECT * FROM first_aid_injuries WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  db.prepare('DELETE FROM first_aid_injuries WHERE id = ?').run(row.id);
  logAudit(req.user, 'first_aid_deleted', 'first_aid_injury', row.id, {}, row, null,
    `${row.employee_name} · ${row.injury_date}`);
  res.json({ ok: true });
});

export default router;
