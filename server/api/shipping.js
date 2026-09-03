// Shipping Truck Inspection — the outbound twin of FORM 204-01, worked at the
// dock when a shipment LEAVES.
//
// Mounted under the Receiving Log module on purpose: same dock, same people,
// same grant. A warehouse operator who can file a receiving inspection can
// file a shipping one, and nobody has to be granted a second module for the
// other direction of the same truck.
//
// The shape is the receiving checklist's, deliberately: get-or-create on the
// number, answers saved as tapped, escalations DERIVED from the answers and
// sent the moment the triggering answer lands, sign-off refused while any
// question is blank. One thing is new — photographs of the load — and the
// sign-off gate checks the photo claim against the photos on file.

import { Router } from 'express';
import { randomUUID as uuid } from 'crypto';
import { readFileSync } from 'fs';
import { getDb, logAudit } from '../db.js';
import { hasExplicitEdit, hasExplicitGrant } from '../module-access.js';
import { parseJson } from '../custom-fields.js';
import {
  CHECKLIST, CHECKLIST_REVISION, NOTIFY_TARGETS, getItem, normalizeAnswers, triggeredEscalations,
  unanswered, photoClaimUnsupported,
} from '../shipping-checklist.js';
import { sendEscalation } from '../receiving-notify.js';
import { storageEnabled, putObject, presignGet, deleteObject } from '../storage.js';
import { mediaUpload, cleanupTemp, uploadErrorMessage } from '../media.js';

const router = Router();
const MODULE = 'receiving-log';

// The same door as receiving: warehouse, supervisors, admins, or a grant.
const canLog = (u) => u?.role === 'admin' || u?.role === 'supervisor'
  || u?.department === 'warehouse' || hasExplicitGrant(u, MODULE) || hasExplicitEdit(u, MODULE);

// S-100-#### — shipping's own series, issued from this table alone. A-100 is
// receiving's and counts three tables (see inspection-no.js); giving outbound
// trucks a different prefix is what keeps the two counters from ever needing
// to know about each other.
export const SHIPMENT_PREFIX = 'S-100-';
export function nextShipmentNo(db) {
  let max = 0;
  for (const r of db.prepare('SELECT shipment_no FROM shipping_inspections WHERE shipment_no LIKE ?').all(`${SHIPMENT_PREFIX}%`)) {
    const n = Number(String(r.shipment_no).slice(SHIPMENT_PREFIX.length));
    if (Number.isFinite(n) && n > max) max = n;
  }
  return SHIPMENT_PREFIX + String(max + 1).padStart(4, '0');
}

const photoUpload = mediaUpload({ files: 10 }).array('photos', 10);
const uploadPhotos = (req, res, next) => photoUpload(req, res, (err) => {
  if (err) return res.status(413).json({ error: uploadErrorMessage(err) });
  next();
});

function photosFor(db, inspectionId) {
  return db.prepare(`SELECT id, filename, content_type, size, caption, uploaded_by, uploaded_at, storage_key
    FROM shipping_photos WHERE inspection_id = ? ORDER BY uploaded_at`).all(inspectionId)
    .map(({ storage_key, ...p }) => ({ ...p, has_file: !!storage_key }));
}

const shapeInspection = (db, r) => {
  if (!r) return null;
  const answers = parseJson(r.answers, {}) || {};
  const photos = photosFor(db, r.id);
  return {
    ...r,
    answers,
    item_notes: parseJson(r.item_notes, []) || [],
    notifications: parseJson(r.notifications, []) || [],
    escalations: triggeredEscalations(answers),
    unanswered: unanswered(answers),
    photos,
    photo_claim_unsupported: photoClaimUnsupported(answers, photos.length),
  };
};

router.get('/next-shipment-no', (_req, res) => res.json({ shipment_no: nextShipmentNo(getDb()) }));

router.get('/inspection/form', (_req, res) => res.json({ ...CHECKLIST, storage_enabled: storageEnabled() }));

router.get('/inspections', (req, res) => {
  const db = getDb();
  const open = req.query.open === '1';
  const rows = db.prepare(`
    SELECT s.*, (SELECT COUNT(*) FROM shipping_photos p WHERE p.inspection_id = s.id) AS photo_count
    FROM shipping_inspections s
    ${open ? 'WHERE s.reviewed_at IS NULL' : ''}
    ORDER BY s.reviewed_at IS NOT NULL, s.created_at DESC
    LIMIT ?`).all(Math.min(Number(req.query.limit) || 100, 300));
  res.json(rows.map(r => {
    const answers = parseJson(r.answers, {}) || {};
    const notified = new Set((parseJson(r.notifications, []) || []).map(n => n.item));
    const blank = unanswered(answers).length;
    return {
      ...r, answers,
      answered: Object.keys(answers).length,
      total: blank + Object.keys(answers).length,
      escalations_outstanding: triggeredEscalations(answers).filter(e => !notified.has(e.key)).length,
    };
  }));
});

router.get('/inspection/:shipmentNo', (req, res) => {
  const db = getDb();
  const row = db.prepare('SELECT * FROM shipping_inspections WHERE shipment_no = ?').get(req.params.shipmentNo);
  res.json({ inspection: shapeInspection(db, row), form: { ...CHECKLIST, storage_enabled: storageEnabled() } });
});

const HEADER_COLS = ['order_number', 'bol_number', 'customer', 'carrier', 'truck_number', 'driver_name',
  'seal_number', 'pallet_count', 'ship_date'];

async function fireEscalation(db, row, item, user, { detail = '', auto = false } = {}) {
  const path = `/?tab=receiving-log&view=shipping&shipment=${encodeURIComponent(row.shipment_no)}`;
  const { sent, reason } = await sendEscalation(db, {
    item: item.text, target: item.notify.target, inspectionNo: row.shipment_no, detail, from: user, path,
    icon: '🚚', targets: NOTIFY_TARGETS, tagPrefix: 'shipping',
    origin: `Raised by ${user?.name || 'Shipping'} on the Shipping Truck Inspection.`,
  });
  if (!sent.length) return { sent: [], reason };
  const fresh = db.prepare('SELECT notifications FROM shipping_inspections WHERE id = ?').get(row.id);
  const log = parseJson(fresh?.notifications, []) || [];
  log.push({
    item: item.key, text: item.text, target: item.notify.target, to: sent,
    at: new Date().toISOString(), by: user.name, ...(auto ? { auto: true } : {}),
  });
  db.prepare("UPDATE shipping_inspections SET notifications = ?, updated_at = datetime('now') WHERE id = ?")
    .run(JSON.stringify(log), row.id);
  logAudit(user, 'shipping_escalation_sent', 'shipping_inspection', row.id,
    { shipment_no: row.shipment_no, item: item.key, target: item.notify.target, to: sent, auto }, null, null, row.shipment_no);
  return { sent, log };
}

/** Start or update. Get-or-create on the shipment number, the receiving rule. */
router.post('/inspection', async (req, res) => {
  if (!canLog(req.user)) return res.status(403).json({ error: 'Filing a shipping inspection needs the Receiving Log.' });
  const db = getDb();
  const no = String(req.body?.shipment_no || '').trim() || nextShipmentNo(db);
  let row = db.prepare('SELECT * FROM shipping_inspections WHERE shipment_no = ?').get(no);
  if (!row) {
    db.prepare(`INSERT INTO shipping_inspections (id, shipment_no, checklist_revision, ship_date, inspector, created_by)
      VALUES (?, ?, ?, COALESCE(?, date('now')), ?, ?)`).run(
      uuid(), no, CHECKLIST_REVISION, req.body?.ship_date || null, req.body?.inspector || req.user.name, req.user.name);
    row = db.prepare('SELECT * FROM shipping_inspections WHERE shipment_no = ?').get(no);
    logAudit(req.user, 'shipping_inspection_started', 'shipping_inspection', row.id, { shipment_no: no }, null, row, no);
  }
  if (row.reviewed_at) return res.status(409).json({ error: 'This inspection has been signed off. Revoke the sign-off to correct it.' });

  const patch = {};
  for (const c of HEADER_COLS) if (req.body?.[c] !== undefined) patch[c] = req.body[c] === '' ? null : req.body[c];
  if (req.body?.answers !== undefined) {
    patch.answers = JSON.stringify({ ...parseJson(row.answers, {}), ...normalizeAnswers(req.body.answers) });
  }
  if (req.body?.item_notes !== undefined) patch.item_notes = JSON.stringify(req.body.item_notes || []);
  if (Object.keys(patch).length) {
    db.prepare(`UPDATE shipping_inspections SET ${Object.keys(patch).map(c => `${c} = ?`).join(', ')},
      updated_at = datetime('now') WHERE id = ?`).run(...Object.values(patch), row.id);
    logAudit(req.user, 'shipping_inspection_updated', 'shipping_inspection', row.id,
      { shipment_no: no, fields: Object.keys(patch) }, row, null, no);
  }
  let updated = db.prepare('SELECT * FROM shipping_inspections WHERE id = ?').get(row.id);

  // The answer is the trigger — only for items answered in THIS request,
  // idempotent per item, best-effort. Same three limits as receiving.
  if (req.body?.answers !== undefined && !updated.reviewed_at) {
    try {
      const ans = parseJson(updated.answers, {}) || {};
      const already = new Set((parseJson(updated.notifications, []) || []).map(n => n.item));
      let fired = false;
      for (const key of Object.keys(normalizeAnswers(req.body.answers))) {
        const item = getItem(key);
        if (!item?.notify || already.has(key) || ans[key] !== item.notify.answer) continue;
        const out = await fireEscalation(db, updated, item, req.user, { auto: true });
        if (out.sent.length) fired = true;
      }
      if (fired) updated = db.prepare('SELECT * FROM shipping_inspections WHERE id = ?').get(row.id);
    } catch (e) {
      console.warn('[shipping] auto-escalation failed (save is unaffected):', e.message);
    }
  }
  res.json(shapeInspection(db, updated));
});

router.post('/inspection/:shipmentNo/notify', async (req, res) => {
  if (!canLog(req.user)) return res.status(403).json({ error: 'Filing a shipping inspection needs the Receiving Log.' });
  const db = getDb();
  const row = db.prepare('SELECT * FROM shipping_inspections WHERE shipment_no = ?').get(req.params.shipmentNo);
  if (!row) return res.status(404).json({ error: 'No inspection for this shipment yet.' });
  const item = getItem(String(req.body?.item || ''));
  if (!item?.notify) return res.status(400).json({ error: 'That item has nobody to notify.' });
  const answers = parseJson(row.answers, {}) || {};
  if (answers[item.key] !== item.notify.answer) {
    return res.status(409).json({ error: `"${item.text}" is not answered ${item.notify.answer.toUpperCase()}, so there is nothing to escalate.` });
  }
  const { sent, reason, log } = await fireEscalation(db, row, item, req.user, { detail: String(req.body?.detail || '').slice(0, 500) });
  if (!sent.length) return res.status(503).json({ error: `Could not reach anyone — ${reason || 'no matching accounts'}. Tell them directly.` });
  res.json({ ok: true, sent, notifications: log });
});

/* ── Photos of the load ──────────────────────────────────────────────────── */

router.post('/inspection/:shipmentNo/photos', uploadPhotos, async (req, res) => {
  const files = req.files || [];
  try {
    if (!canLog(req.user)) return res.status(403).json({ error: 'Filing a shipping inspection needs the Receiving Log.' });
    const db = getDb();
    const row = db.prepare('SELECT * FROM shipping_inspections WHERE shipment_no = ?').get(req.params.shipmentNo);
    if (!row) return res.status(404).json({ error: 'No inspection for this shipment yet.' });
    // A signed-off inspection is the record of how the truck left. Adding a
    // photograph afterwards would put evidence on a record after the decision
    // it supported — revoke, attach, sign again, all audited.
    if (row.reviewed_at) return res.status(409).json({ error: 'This inspection is signed off. Revoke the sign-off to add photos.' });
    if (!storageEnabled()) return res.status(503).json({ error: 'File storage is not configured on this server.' });
    if (!files.length) return res.status(400).json({ error: 'No photo received.' });
    const caption = String(req.body?.caption || '').slice(0, 200) || null;
    for (const f of files) {
      const pid = uuid();
      const safe = (f.originalname || 'photo').replace(/[^\w.-]+/g, '_').slice(0, 120);
      const key = `shipping/${row.id}/${pid}-${safe}`;
      await putObject(key, readFileSync(f.path), f.mimetype);
      db.prepare(`INSERT INTO shipping_photos (id, inspection_id, storage_key, filename, content_type, size, caption, uploaded_by)
        VALUES (?,?,?,?,?,?,?,?)`).run(pid, row.id, key, (f.originalname || 'photo').slice(0, 255),
        f.mimetype || null, f.size || null, caption, req.user.name);
    }
    db.prepare("UPDATE shipping_inspections SET updated_at = datetime('now') WHERE id = ?").run(row.id);
    logAudit(req.user, 'shipping_photos_added', 'shipping_inspection', row.id,
      { shipment_no: row.shipment_no, photos: files.length }, null, null, row.shipment_no);
    res.json(shapeInspection(db, row));
  } finally {
    cleanupTemp(files);
  }
});

router.get('/photos/:photoId/url', async (req, res) => {
  const p = getDb().prepare('SELECT * FROM shipping_photos WHERE id = ?').get(req.params.photoId);
  if (!p?.storage_key) return res.status(404).json({ error: 'No file' });
  res.json({ url: await presignGet(p.storage_key, p.filename) });
});

router.delete('/photos/:photoId', (req, res) => {
  if (!canLog(req.user)) return res.status(403).json({ error: 'Filing a shipping inspection needs the Receiving Log.' });
  const db = getDb();
  const p = db.prepare(`SELECT p.*, s.reviewed_at, s.shipment_no FROM shipping_photos p
    JOIN shipping_inspections s ON s.id = p.inspection_id WHERE p.id = ?`).get(req.params.photoId);
  if (!p) return res.status(404).json({ error: 'Not found' });
  if (p.reviewed_at) return res.status(409).json({ error: 'This inspection is signed off — its photos are the record of the load.' });
  db.prepare('DELETE FROM shipping_photos WHERE id = ?').run(p.id);
  if (p.storage_key) deleteObject(p.storage_key);
  logAudit(req.user, 'delete', 'shipping_photo', p.id, { filename: p.filename }, null, null, p.shipment_no);
  res.json({ ok: true });
});

/* ── Sign-off ────────────────────────────────────────────────────────────── */

router.post('/inspection/:shipmentNo/review', (req, res) => {
  if (!canLog(req.user)) return res.status(403).json({ error: 'Filing a shipping inspection needs the Receiving Log.' });
  const db = getDb();
  const row = db.prepare('SELECT * FROM shipping_inspections WHERE shipment_no = ?').get(req.params.shipmentNo);
  if (!row) return res.status(404).json({ error: 'No inspection for this shipment yet.' });
  if (row.reviewed_at) return res.status(409).json({ error: 'Already signed off.' });

  const answers = parseJson(row.answers, {}) || {};
  const blanks = unanswered(answers);
  if (blanks.length) {
    return res.status(400).json({
      error: `${blanks.length} question${blanks.length === 1 ? '' : 's'} still blank. An inspection filed with blanks reads later as if those checks passed.`,
      unanswered: blanks,
    });
  }
  const notified = new Set((parseJson(row.notifications, []) || []).map(n => n.item));
  const outstanding = triggeredEscalations(answers).filter(e => !notified.has(e.key));
  if (outstanding.length) {
    return res.status(400).json({
      error: `${outstanding.length} escalation${outstanding.length === 1 ? '' : 's'} the form requires ${outstanding.length === 1 ? 'has' : 'have'} not been sent.`,
      outstanding,
    });
  }
  // The one answer the record can check. "Photos taken — yes" with nothing
  // attached is a claim with nothing behind it.
  const photoCount = db.prepare('SELECT COUNT(*) c FROM shipping_photos WHERE inspection_id = ?').get(row.id).c;
  if (photoClaimUnsupported(answers, photoCount)) {
    return res.status(400).json({
      error: 'The inspection says photos were taken, but none are attached. Add the photos of the load, or answer that question No.',
      photo_claim_unsupported: true,
    });
  }

  db.prepare(`UPDATE shipping_inspections SET reviewed_by = ?, reviewed_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`)
    .run(req.user.name, row.id);
  const updated = db.prepare('SELECT * FROM shipping_inspections WHERE id = ?').get(row.id);
  logAudit(req.user, 'shipping_inspection_reviewed', 'shipping_inspection', row.id,
    { shipment_no: row.shipment_no, photos: photoCount }, row, updated, row.shipment_no);
  res.json(shapeInspection(db, updated));
});

router.delete('/inspection/:shipmentNo/review', (req, res) => {
  const db = getDb();
  const row = db.prepare('SELECT * FROM shipping_inspections WHERE shipment_no = ?').get(req.params.shipmentNo);
  if (!row) return res.status(404).json({ error: 'Not found' });
  if (!row.reviewed_at) return res.status(409).json({ error: 'This inspection is not signed off.' });
  if (req.user.role !== 'admin' && row.reviewed_by !== req.user.name) {
    return res.status(403).json({ error: 'Only the person who signed it, or an admin, can revoke a sign-off.' });
  }
  db.prepare("UPDATE shipping_inspections SET reviewed_by = NULL, reviewed_at = NULL, updated_at = datetime('now') WHERE id = ?").run(row.id);
  logAudit(req.user, 'shipping_inspection_review_revoked', 'shipping_inspection', row.id,
    { shipment_no: row.shipment_no, was_signed_by: row.reviewed_by }, row, null, row.shipment_no);
  res.json({ ok: true });
});

export default router;
