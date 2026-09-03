// FORM 418-01 — the QA Film/Pouch Inspection Checklist.
//
// ── Why this is not part of the receiving router ────────────────────────────
// It reads like a receiving screen and it lives on the Receiving module's tab
// strip, because that is where the delivery is. But the inspection is QA's
// work, and `/api/receiving` is mounted behind requireModuleWrite('receiving-log').
// Filing this there would have meant every QA lead needed the warehouse's
// module before they could inspect a roll of film — a permission that says
// nothing about who does the job. Mounted on its own path behind
// `qa-inspections` instead, with `canInspect` in the handlers as well: the
// mount guard alone is not a guard (see the note on the QMS router).
//
// The order the plant actually works in:
//   1. Packaging arrives. FORM 204-01's first question — "Is the product
//      Packaging (Film or pouches)?" — is answered YES and escalates to QA.
//   2. QA runs THIS form, one sheet per flavour, and accepts or rejects.
//   3. Only then does the warehouse receive it and file its lines.
// So this record may be the FIRST thing that exists for a delivery, which is
// why it can issue the inspection number itself.

import { Router } from 'express';
import { randomUUID as uuid } from 'crypto';
import { createReadStream } from 'fs';
import { getDb, logAudit } from '../db.js';
import { hasExplicitGrant } from '../module-access.js';
import { parseJson } from '../custom-fields.js';
import { nextInspectionNo } from '../inspection-no.js';
import { mediaUpload, rejectOversize, cleanupTemp, uploadErrorMessage } from '../media.js';
import { storageEnabled, putStream, presignGet, deleteObject } from '../storage.js';
import {
  FILM_CHECKLIST, FILM_REVISION, FILM_DECISIONS,
  allItems, exceptions, normalizeAnswers, unanswered,
} from '../film-pouch-checklist.js';

const router = Router();

/**
 * Who runs a film inspection. The paper names a QA Lead and an Assistant, so
 * this is QA's record: admins, the QA/quality department, or an explicit
 * qa-inspections grant. Deliberately NOT every supervisor — the same reasoning
 * as `isQaReviewer`, which handed QA's counter-signature to Filling and
 * Batching supervisors by role alone.
 */
const canInspect = (u) => u?.role === 'admin'
  || ['qa', 'quality'].includes((u?.department || '').toLowerCase())
  || hasExplicitGrant(u, 'qa-inspections');

const DENIED = 'A film/pouch inspection is QA\'s record — it needs QA Inspections access.';

const HEADER_COLS = [
  'vendor', 'part_no', 'inspection_date', 'roll_count', 'vendor_lot',
  'qa_lead', 'assistant', 'wind_direction', 'film_width', 'issue_notes',
];
const NUMS = new Set(['roll_count']);

const shape = (r) => {
  if (!r) return null;
  const answers = parseJson(r.answers, {}) || {};
  return {
    ...r,
    answers,
    // Derived on every read, never stored: correct a mis-tap and the exception
    // list moves with it. See the doctrine note in film-pouch-checklist.js —
    // these are an AID to QA's decision, not the decision.
    exceptions: exceptions(answers),
    unanswered: unanswered(answers),
    answered: Object.keys(answers).length,
    total: allItems().length,
  };
};

// ── The blank form ──────────────────────────────────────────────────────────
// Open to any signed-in reader: a form nobody can see is a form nobody fills
// in, and the warehouse needs to read the questions QA answered.
router.get('/form', (_req, res) => res.json(FILM_CHECKLIST));

/**
 * Inspections, newest first, unsigned ones on top.
 *
 * A sheet is started on the dock with a phone and finished at a desk, and a
 * pallet of six flavours is six sheets — without a list, the only way back to
 * one is remembering the number.
 */
router.get('/', (req, res) => {
  const db = getDb();
  const { open, inspection_no: no, q } = req.query;
  let sql = 'SELECT * FROM film_pouch_inspections WHERE 1=1';
  const params = [];
  if (open === '1') sql += ' AND reviewed_at IS NULL';
  if (no) { sql += ' AND inspection_no = ?'; params.push(no); }
  if (q && String(q).trim()) {
    sql += ' AND (inspection_no LIKE ? OR flavor LIKE ? OR vendor LIKE ? OR part_no LIKE ? OR vendor_lot LIKE ?)';
    const like = `%${q}%`;
    params.push(like, like, like, like, like);
  }
  sql += ' ORDER BY reviewed_at IS NOT NULL, created_at DESC LIMIT ?';
  params.push(Math.min(Number(req.query.limit) || 200, 500));
  res.json(db.prepare(sql).all(...params).map(shape));
});

/**
 * What the warehouse needs to know before it receives: has QA cleared the
 * packaging on this inspection number, and what did they say?
 *
 * Declared BEFORE `/:id` — "status" is a perfectly good uuid as far as Express
 * is concerned, and it matches in declaration order.
 */
router.get('/status/:inspectionNo', (req, res) => {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM film_pouch_inspections WHERE inspection_no = ? ORDER BY flavor')
    .all(req.params.inspectionNo).map(shape);
  res.json({
    inspection_no: req.params.inspectionNo,
    sheets: rows,
    // "Cleared" means every sheet on this delivery was signed AND accepted.
    // One rejected flavour is not a cleared delivery, and reporting it as one
    // is how rejected film gets put away on a rack.
    cleared: rows.length > 0 && rows.every(r => r.reviewed_at && r.decision === 'accepted'),
    rejected: rows.filter(r => r.decision === 'rejected').map(r => r.flavor),
    open: rows.filter(r => !r.reviewed_at).map(r => r.flavor),
  });
});

router.get('/:id', async (req, res) => {
  const db = getDb();
  const row = db.prepare('SELECT * FROM film_pouch_inspections WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  const photos = db.prepare('SELECT * FROM film_pouch_photos WHERE inspection_id = ? ORDER BY created_at').all(row.id);
  const withUrls = [];
  for (const p of photos) {
    withUrls.push({ ...p, url: storageEnabled() ? await presignGet(p.storage_key, p.filename) : null });
  }
  res.json({ inspection: shape(row), photos: withUrls, form: FILM_CHECKLIST });
});

/**
 * Start or update a sheet. Get-or-create on (inspection #, flavour), so opening
 * the same flavour twice — or on a second device — lands on the same record
 * rather than filing a duplicate. A blank inspection # issues the next one,
 * because QA may well be the first person to touch this delivery.
 *
 * Deliberately validates nothing beyond the answer vocabulary. A form that
 * refuses a half-filled field while somebody is holding a roll of film is a
 * form they stop using; validation belongs at sign-off, which is where it is.
 */
router.post('/', (req, res) => {
  if (!canInspect(req.user)) return res.status(403).json({ error: DENIED });
  const db = getDb();
  // FLAVOR IS NO LONGER REQUIRED (user decision 2026-08-14): a coffee acid
  // reducer has no flavor, and a form that demands one gets "N/A" typed into a
  // field that then reads as a flavor called N/A. A blank flavor is a valid
  // sheet — the whole-delivery or unflavored-item sheet — and stays one per
  // inspection number, because '' participates in the same get-or-create
  // identity any named flavor does.
  const flavor = String(req.body?.flavor || '').trim();
  let row = null;
  if (req.body?.id) {
    // Addressed by id: the sheet already exists (an auto-created draft, or an
    // open editor) and this request may also SET its flavor — the one identity
    // fact a draft born from the receiving escalation cannot know yet.
    row = db.prepare('SELECT * FROM film_pouch_inspections WHERE id = ?').get(String(req.body.id));
    if (!row) return res.status(404).json({ error: 'Not found' });
  }
  const no = row?.inspection_no || String(req.body?.inspection_no || '').trim() || nextInspectionNo(db);

  if (!row) row = db.prepare('SELECT * FROM film_pouch_inspections WHERE inspection_no = ? AND flavor = ?').get(no, flavor);
  const created = !row;
  if (!row) {
    db.prepare(`INSERT INTO film_pouch_inspections
      (id, inspection_no, flavor, checklist_revision, inspection_date, qa_lead, created_by)
      VALUES (?, ?, ?, ?, COALESCE(?, date('now')), ?, ?)`).run(
      uuid(), no, flavor, FILM_REVISION, req.body?.inspection_date || null,
      req.body?.qa_lead || req.user.name, req.user.name);
    row = db.prepare('SELECT * FROM film_pouch_inspections WHERE inspection_no = ? AND flavor = ?').get(no, flavor);
    // DELIBERATELY FALLS THROUGH to the patch below. "Answers save as they are
    // tapped" is the contract, and a create that returned early silently
    // dropped any header fields or answers sent in the same request — the
    // first tap of an offline-queue replay, or any client that starts a sheet
    // with details, would look saved and not be.
  }
  // A signed sheet is the record of the packaging that was accepted or refused.
  if (row.reviewed_at) return res.status(409).json({ error: 'This inspection is signed off. Revoke the sign-off to correct it.' });

  const patch = {};
  // Renaming the flavor of an UNSIGNED sheet is allowed (it is how a blank
  // draft becomes "Blue Raz"), but never onto a pair that already exists —
  // silently merging two flavors' sheets would lose one flavor's answers.
  if (req.body?.id && req.body?.flavor !== undefined && flavor !== row.flavor) {
    const clash = db.prepare(
      'SELECT 1 FROM film_pouch_inspections WHERE inspection_no = ? AND flavor = ? AND id != ?')
      .get(row.inspection_no, flavor, row.id);
    if (clash) return res.status(409).json({ error: `A sheet for "${flavor || '(no flavor)'}" already exists on ${row.inspection_no} — open that one instead.` });
    patch.flavor = flavor;
  }
  for (const c of HEADER_COLS) {
    if (req.body?.[c] === undefined) continue;
    if (NUMS.has(c)) { const n = Number(req.body[c]); patch[c] = Number.isFinite(n) ? n : null; }
    else patch[c] = req.body[c] === '' ? null : req.body[c];
  }
  if (req.body?.answers !== undefined) {
    patch.answers = JSON.stringify({ ...parseJson(row.answers, {}), ...normalizeAnswers(req.body.answers) });
  }
  if (Object.keys(patch).length) {
    db.prepare(`UPDATE film_pouch_inspections SET ${Object.keys(patch).map(c => `${c} = ?`).join(', ')},
      updated_at = datetime('now') WHERE id = ?`).run(...Object.values(patch), row.id);
  }
  const updated = db.prepare('SELECT * FROM film_pouch_inspections WHERE id = ?').get(row.id);
  const label = `${no} · ${updated.flavor || '(no flavor)'}`;
  if (created) {
    logAudit(req.user, 'film_inspection_created', 'film_inspection', row.id,
      { inspection_no: no, flavor: updated.flavor, fields: Object.keys(patch) }, null, updated, label);
  } else {
    logAudit(req.user, 'film_inspection_updated', 'film_inspection', row.id,
      { inspection_no: no, flavor: updated.flavor, fields: Object.keys(patch) }, row, updated, label);
  }
  res.status(created ? 201 : 200).json(shape(updated));
});

/**
 * Sign it off with QA's decision — the ACCEPTED / REJECTED the paper has them
 * circle.
 *
 * REFUSED WHILE ANY ITEM IS BLANK, the same rule as FORM 204-01 and an internal
 * audit: a checklist filed with empty questions reads later as if those checks
 * passed.
 *
 * A REJECTION NEEDS ITS REASON. The form's own failure instruction is "record
 * the issue below, take photos" — a rejection with nothing behind it cannot be
 * put in front of the vendor, which is the entire point of rejecting. An
 * acceptance is not made to justify itself, because the thirty answers above it
 * already are the justification.
 */
router.post('/:id/review', (req, res) => {
  if (!canInspect(req.user)) return res.status(403).json({ error: DENIED });
  const db = getDb();
  const row = db.prepare('SELECT * FROM film_pouch_inspections WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  if (row.reviewed_at) return res.status(409).json({ error: 'Already signed off.' });

  const decision = String(req.body?.decision || '').toLowerCase();
  if (!FILM_DECISIONS[decision]) {
    return res.status(400).json({ error: 'Record the decision the form asks for: accepted or rejected.' });
  }
  const answers = parseJson(row.answers, {}) || {};
  const blanks = unanswered(answers);
  if (blanks.length) {
    return res.status(400).json({
      error: `${blanks.length} question${blanks.length === 1 ? '' : 's'} still blank. A checklist filed with blanks reads later as if those checks passed.`,
      unanswered: blanks,
    });
  }
  const notes = req.body?.issue_notes !== undefined ? String(req.body.issue_notes || '').trim() : (row.issue_notes || '');
  if (decision === 'rejected' && notes.length < 3) {
    return res.status(400).json({ error: 'A rejection needs the issue recorded — the form asks for it, and the vendor will.' });
  }

  db.prepare(`UPDATE film_pouch_inspections SET decision = ?, issue_notes = ?, reviewed_by = ?,
    reviewed_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`)
    .run(decision, notes || null, req.user.name, row.id);
  const updated = db.prepare('SELECT * FROM film_pouch_inspections WHERE id = ?').get(row.id);
  logAudit(req.user, 'film_inspection_reviewed', 'film_inspection', row.id,
    { inspection_no: row.inspection_no, flavor: row.flavor, decision }, row, updated,
    `${row.inspection_no} · ${row.flavor}`);
  res.json(shape(updated));
});

/** The way back from a signature is revoke, correct, sign again — all audited. */
router.delete('/:id/review', (req, res) => {
  const db = getDb();
  const row = db.prepare('SELECT * FROM film_pouch_inspections WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  if (!row.reviewed_at) return res.status(409).json({ error: 'This inspection is not signed off.' });
  if (req.user.role !== 'admin' && row.reviewed_by !== req.user.name) {
    return res.status(403).json({ error: 'Only the person who signed it, or an admin, can revoke a sign-off.' });
  }
  db.prepare(`UPDATE film_pouch_inspections SET decision = NULL, reviewed_by = NULL, reviewed_at = NULL,
    updated_at = datetime('now') WHERE id = ?`).run(row.id);
  logAudit(req.user, 'film_inspection_review_revoked', 'film_inspection', row.id,
    { inspection_no: row.inspection_no, flavor: row.flavor, was_signed_by: row.reviewed_by, was: row.decision },
    row, null, `${row.inspection_no} · ${row.flavor}`);
  res.json({ ok: true });
});

// ── Photos ──────────────────────────────────────────────────────────────────
// "If ANY item fails: record the issue below, TAKE PHOTOS". Storage-gated the
// same way every other upload is: without R2 the rest of the form still works
// and the button is simply not offered.
const photoUpload = mediaUpload({ files: 10 }).array('files', 10);

router.post('/:id/photos', (req, res) => {
  if (!canInspect(req.user)) return res.status(403).json({ error: DENIED });
  if (!storageEnabled()) return res.status(503).json({ error: 'File storage is not configured, so photos cannot be attached.' });
  photoUpload(req, res, async (err) => {
    const files = req.files || [];
    try {
      if (err) return res.status(400).json({ error: uploadErrorMessage(err) });
      const db = getDb();
      const row = db.prepare('SELECT * FROM film_pouch_inspections WHERE id = ?').get(req.params.id);
      if (!row) return res.status(404).json({ error: 'Not found' });
      if (row.reviewed_at) return res.status(409).json({ error: 'This inspection is signed off. Revoke the sign-off to add photos.' });
      const tooBig = rejectOversize(files);
      if (tooBig) return res.status(400).json({ error: tooBig });
      if (!files.length) return res.status(400).json({ error: 'No files were uploaded.' });

      const saved = [];
      for (const f of files) {
        const key = `film-inspections/${row.id}/${uuid()}-${f.originalname}`;
        await putStream(key, createReadStream(f.path), f.mimetype);
        const id = uuid();
        db.prepare(`INSERT INTO film_pouch_photos
          (id, inspection_id, storage_key, filename, content_type, size_bytes, caption, uploaded_by)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
          id, row.id, key, f.originalname, f.mimetype, f.size,
          String(req.body?.caption || '').slice(0, 300) || null, req.user.name);
        saved.push({ id, filename: f.originalname });
      }
      logAudit(req.user, 'film_inspection_photos_added', 'film_inspection', row.id,
        { inspection_no: row.inspection_no, flavor: row.flavor, files: saved.map(s => s.filename) },
        null, null, `${row.inspection_no} · ${row.flavor}`);
      res.status(201).json({ ok: true, added: saved.length });
    } catch (e) {
      res.status(500).json({ error: e.message });
    } finally {
      cleanupTemp(files);
    }
  });
});

router.delete('/photos/:photoId', async (req, res) => {
  if (!canInspect(req.user)) return res.status(403).json({ error: DENIED });
  const db = getDb();
  const photo = db.prepare('SELECT * FROM film_pouch_photos WHERE id = ?').get(req.params.photoId);
  if (!photo) return res.status(404).json({ error: 'Not found' });
  const row = db.prepare('SELECT * FROM film_pouch_inspections WHERE id = ?').get(photo.inspection_id);
  // The photos are the evidence behind a signed decision, so they are as closed
  // as the decision is.
  if (row?.reviewed_at) return res.status(409).json({ error: 'This inspection is signed off. Revoke the sign-off to remove a photo.' });
  db.prepare('DELETE FROM film_pouch_photos WHERE id = ?').run(photo.id);
  try { await deleteObject(photo.storage_key); } catch { /* the row is gone either way */ }
  logAudit(req.user, 'film_inspection_photo_removed', 'film_inspection', photo.inspection_id,
    { filename: photo.filename }, photo, null, row ? `${row.inspection_no} · ${row.flavor}` : null);
  res.json({ ok: true });
});

router.delete('/:id', (req, res) => {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Only an admin can delete an inspection.' });
  const db = getDb();
  const row = db.prepare('SELECT * FROM film_pouch_inspections WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  if (row.reviewed_at) return res.status(409).json({ error: 'A signed inspection is a record. Revoke the sign-off first.' });
  db.prepare('DELETE FROM film_pouch_inspections WHERE id = ?').run(row.id);
  logAudit(req.user, 'film_inspection_deleted', 'film_inspection', row.id,
    { inspection_no: row.inspection_no, flavor: row.flavor }, row, null, `${row.inspection_no} · ${row.flavor}`);
  res.json({ ok: true });
});

export default router;
