// Scale Verification log — the in-app home for Forms 417-01 … 417-05.
//
// Submissions arrive from the kiosk (public, /api/submit/scale-verification)
// or from a signed-in user, and land here for QA to verify. The list is a tab
// in Calibration Management, because that is where someone goes looking for
// "is this scale trustworthy today".

import { Router } from 'express';
import { randomUUID as uuid } from 'crypto';
import { getDb, logAudit } from '../db.js';
import { hasExplicitEdit } from '../module-access.js';
import { SCALE_FORMS, SCALE_PROCEDURE, getScaleForm, gradeReadings } from '../scale-forms.js';

const router = Router();
const MODULE = 'calibration';

// Verifying is the QA counter-signature on the form — QA, supervisors, admins,
// or anyone with an explicit Calibration edit grant.
const canVerify = (u) => u?.role === 'admin' || u?.role === 'supervisor'
  || ['qa', 'quality'].includes((u?.department || '').toLowerCase())
  || hasExplicitEdit(u, MODULE);

const shape = (r) => ({
  ...r,
  readings: (() => { try { return JSON.parse(r.readings || '[]'); } catch { return []; } })(),
});

/**
 * Write one verification. Shared with the public kiosk route so both paths
 * grade the readings the same way and neither can file an out-of-tolerance
 * check as a pass.
 * Returns { error } or { record }.
 */
export function recordScaleVerification(db, body, { actor, source }) {
  const form = getScaleForm(body?.form_code);
  if (!form) return { error: 'Pick which scale verification form you are filling in.' };

  const performedBy = String(body.performed_by || actor?.name || '').trim();
  if (!performedBy) return { error: 'Your name is required.' };

  const { readings, complete, result } = gradeReadings(form, body.readings);
  if (!complete) return { error: `All ${form.points.length} weight readings are required.` };

  // Link to the instrument when the room matches one on the scale list, so the
  // instrument's history shows its daily checks alongside its annual cal.
  const room = (body.room || '').trim() || null;
  let instrumentId = body.instrument_id || null;
  if (!instrumentId && room) {
    try {
      instrumentId = db.prepare(
        'SELECT id FROM calibration_instruments WHERE lower(room) = lower(?) LIMIT 1'
      ).get(room)?.id || null;
    } catch { instrumentId = null; }
  }

  const id = uuid();
  db.prepare(`INSERT INTO scale_verifications
    (id, form_code, form_title, room, instrument_id, weights_serial, asset_tag,
     performed_by, performed_at, readings, result, notes, source)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, datetime('now')), ?, ?, ?, ?)`).run(
    id, form.code, form.title, room, instrumentId,
    (body.weights_serial || '').trim() || null, (body.asset_tag || '').trim() || null,
    performedBy, body.performed_at || null,
    JSON.stringify(readings), result, (body.notes || '').trim() || null, source || 'kiosk'
  );

  const record = db.prepare('SELECT * FROM scale_verifications WHERE id = ?').get(id);
  logAudit(actor || performedBy, 'create', 'scale_verification', id,
    { form_code: form.code, room, result, source },
    null, record, `${form.short} · ${room || 'no room'} · ${result.toUpperCase()}`);
  return { record: shape(record) };
}

// GET /forms — the five form definitions (nominals + tolerances) so the client
// renders the right three rows without hardcoding them a second time.
// The procedure travels with the forms — the person running the check needs
// the directions on the same screen as the boxes they're typing into.
router.get('/forms', (_req, res) => res.json({ forms: SCALE_FORMS, procedure: SCALE_PROCEDURE }));

// GET / — the log.
router.get('/', (req, res) => {
  const db = getDb();
  const { form_code, result, from, to, room } = req.query;
  let sql = 'SELECT * FROM scale_verifications WHERE 1=1';
  const params = [];
  if (form_code) { sql += ' AND form_code = ?'; params.push(form_code); }
  if (result) { sql += ' AND result = ?'; params.push(result); }
  if (room) { sql += ' AND room = ?'; params.push(room); }
  if (from) { sql += ' AND performed_at >= ?'; params.push(from); }
  if (to) { sql += ' AND performed_at <= ?'; params.push(to + 'T23:59:59'); }
  sql += ' ORDER BY performed_at DESC LIMIT 1000';
  res.json(db.prepare(sql).all(...params).map(shape));
});

// GET /status — one row per form: today's check, so "did anyone verify the
// stick-filling scale this morning" is answerable at a glance.
router.get('/status', (_req, res) => {
  const db = getDb();
  const latest = db.prepare(`SELECT * FROM scale_verifications WHERE form_code = ?
    ORDER BY performed_at DESC LIMIT 1`);
  const todayRow = db.prepare(`SELECT * FROM scale_verifications
    WHERE form_code = ? AND date(performed_at) = date('now')
    ORDER BY performed_at DESC LIMIT 1`);
  res.json({
    forms: SCALE_FORMS.map(f => ({
      code: f.code, title: f.title, short: f.short, area: f.area,
      today: todayRow.get(f.code) ? shape(todayRow.get(f.code)) : null,
      latest: latest.get(f.code) ? shape(latest.get(f.code)) : null,
    })),
  });
});

// POST / — file a check from inside the app (same grading as the kiosk).
router.post('/', (req, res) => {
  const db = getDb();
  const { error, record } = recordScaleVerification(db, req.body, { actor: req.user, source: 'app' });
  if (error) return res.status(400).json({ error });
  res.status(201).json(record);
});

/**
 * QA's counter-signature on one scale check (the "Verified By (QA)" line).
 * Exported so the QA Review Center signs through here instead of repeating the
 * update — same write, same audit entry, whichever screen QA is on.
 * Returns { error, status } or { record }.
 */
export function verifyScaleCheck(db, user, id) {
  if (!canVerify(user)) return { error: 'Only QA, supervisors or admins can verify a scale check.', status: 403 };
  const existing = db.prepare('SELECT * FROM scale_verifications WHERE id = ?').get(id);
  if (!existing) return { error: 'Scale verification not found', status: 404 };
  if (existing.verified_by) return { error: 'Already verified.', status: 400 };

  db.prepare("UPDATE scale_verifications SET verified_by = ?, verified_at = datetime('now') WHERE id = ?")
    .run(user?.name || 'QA', existing.id);
  const updated = db.prepare('SELECT * FROM scale_verifications WHERE id = ?').get(existing.id);
  logAudit(user, 'verify', 'scale_verification', existing.id,
    { form_code: existing.form_code, result: existing.result }, existing, updated);
  return { record: shape(updated) };
}

// PUT /:id/verify — QA's counter-signature (the "Verified By (QA)" line).
router.put('/:id/verify', (req, res) => {
  const { error, status, record } = verifyScaleCheck(getDb(), req.user, req.params.id);
  if (error) return res.status(status).json({ error });
  res.json(record);
});

export default router;
