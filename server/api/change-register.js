// The change register's router. Anyone may raise a change; Quality approves
// and closes it, each with a signature (server/signature.js, the same
// password-at-the-moment gate every QA signature uses). See change-register.js.

import { Router } from 'express';
import { randomUUID as uuid } from 'crypto';
import { getDb, logAudit } from '../db.js';
import { KINDS, RISKS, assessmentMissing, nextChangeNumber, changeStatus } from '../change-register.js';
import { gateSignature, signatureEvidence } from '../signature.js';
import { diffSnapshots } from '../controlled.js';

const router = Router();

const isQuality = (u) => u?.role === 'admin' || (['qa', 'quality'].includes((u?.department || '').toLowerCase()) && ['supervisor', 'admin'].includes(u?.role));
const mayEdit = (u, r) => u?.role === 'admin' || isQuality(u) || r.requested_by === u?.name || r.owner === u?.name
  || ['document_control', 'maintenance', 'production'].includes((u?.department || '').toLowerCase()) && u?.role === 'supervisor';
const clean = (v, n = 4000) => String(v ?? '').trim().slice(0, n) || null;
const isDay = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
const parse = (raw) => { try { return JSON.parse(raw || 'null'); } catch { return null; } };

function get(db, id) { return db.prepare('SELECT * FROM change_requests WHERE id = ?').get(id); }
function shape(db, r, user) {
  return { ...r, assessment_missing: assessmentMissing(r), can_edit: ['draft', 'submitted'].includes(r.status) && mayEdit(user, r), can_approve: r.status === 'submitted' && isQuality(user), can_close: r.status === 'implemented' && isQuality(user) };
}

router.get('/', (req, res) => {
  const db = getDb();
  const { status, kind } = req.query;
  const where = []; const params = [];
  if (status) { where.push('status = ?'); params.push(status); }
  if (kind) { where.push('kind = ?'); params.push(kind); }
  const rows = db.prepare(`SELECT * FROM change_requests ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY
    CASE status WHEN 'submitted' THEN 0 WHEN 'implemented' THEN 1 WHEN 'approved' THEN 2 WHEN 'draft' THEN 3 ELSE 4 END, requested_on DESC LIMIT 500`).all(...params);
  // Parked controlled definitions belong on the same register: they are
  // changes awaiting a decision, held in the table that gates them.
  const parked = (() => {
    try {
      return db.prepare("SELECT * FROM controlled_definitions WHERE status = 'pending' ORDER BY pending_seen_at").all()
        .map(d => ({ id: d.id, label: d.label, scope: d.scope, pending_seen_at: d.pending_seen_at, dcr_id: d.pending_dcr_id, changes: diffSnapshots(parse(d.approved_snapshot), parse(d.pending_snapshot)) }));
    } catch { return []; }
  })();
  const releases = (() => {
    try {
      return db.prepare(`SELECT r.*, (SELECT number FROM change_requests q WHERE q.release_id = r.id ORDER BY q.created_at DESC LIMIT 1) AS change_number
        FROM software_releases r ORDER BY first_booted_at DESC LIMIT 50`).all();
    } catch { return []; }
  })();
  res.json({ requests: rows.map(r => shape(db, r, req.user)), parked, releases, counts: changeStatus(db), kinds: KINDS, risks: RISKS, is_quality: isQuality(req.user) });
});

router.post('/', (req, res) => {
  const db = getDb();
  const b = req.body || {};
  const title = clean(b.title, 200);
  if (!title) return res.status(400).json({ error: 'Give the change a title.' });
  if (!KINDS.includes(b.kind)) return res.status(400).json({ error: `Kind must be one of: ${KINDS.join(', ')}.` });
  const id = uuid();
  const number = nextChangeNumber(db);
  db.prepare(`INSERT INTO change_requests (id, number, kind, title, description, reason, requested_by, requested_on, owner,
      impact_product_safety, impact_quality, impact_validation, documents_affected, training_affected, risk, controlled_definition_id, dcr_record_id, release_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, number, b.kind, title, clean(b.description), clean(b.reason), req.user.name, isDay(b.requested_on) ? b.requested_on : db.prepare("SELECT date('now') d").get().d, clean(b.owner, 120),
      clean(b.impact_product_safety), clean(b.impact_quality), clean(b.impact_validation), clean(b.documents_affected), clean(b.training_affected),
      RISKS.includes(b.risk) ? b.risk : null, clean(b.controlled_definition_id, 60), clean(b.dcr_record_id, 60), clean(b.release_id, 60));
  logAudit(req.user, 'change_request_raised', 'change_request', id, { number, kind: b.kind, title }, null, get(db, id), number);
  res.status(201).json({ request: shape(db, get(db, id), req.user) });
});

router.put('/:id', (req, res) => {
  const db = getDb();
  const r = get(db, req.params.id);
  if (!r) return res.status(404).json({ error: 'Not found' });
  if (!['draft', 'submitted'].includes(r.status)) return res.status(409).json({ error: `A ${r.status} change is a record; raise a new change to alter it.` });
  if (!mayEdit(req.user, r)) return res.status(403).json({ error: 'Not permitted' });
  const b = req.body || {};
  const f = (k, n = 4000) => b[k] !== undefined ? clean(b[k], n) : r[k];
  db.prepare(`UPDATE change_requests SET title = ?, description = ?, reason = ?, owner = ?, kind = ?, impact_product_safety = ?, impact_quality = ?, impact_validation = ?,
      documents_affected = ?, training_affected = ?, risk = ?, release_id = ?, updated_at = datetime('now') WHERE id = ?`)
    .run(f('title', 200) || r.title, f('description'), f('reason'), f('owner', 120), KINDS.includes(b.kind) ? b.kind : r.kind,
      f('impact_product_safety'), f('impact_quality'), f('impact_validation'), f('documents_affected'), f('training_affected'),
      b.risk !== undefined ? (RISKS.includes(b.risk) ? b.risk : null) : r.risk, f('release_id', 60), r.id);
  logAudit(req.user, 'change_request_updated', 'change_request', r.id, {}, r, get(db, r.id), r.number);
  res.json({ request: shape(db, get(db, r.id), req.user) });
});

// Submitting asks Quality to decide. Refused until the impact assessment is
// complete — an approval given against an empty assessment is a rubber stamp.
router.post('/:id/submit', (req, res) => {
  const db = getDb();
  const r = get(db, req.params.id);
  if (!r) return res.status(404).json({ error: 'Not found' });
  if (r.status !== 'draft') return res.status(409).json({ error: 'Only a draft can be submitted.' });
  if (!mayEdit(req.user, r)) return res.status(403).json({ error: 'Not permitted' });
  const missing = assessmentMissing(r);
  if (missing.length) return res.status(400).json({ error: `Complete the impact assessment first: ${missing.map(m => m.label).join('; ')}.`, missing });
  db.prepare("UPDATE change_requests SET status = 'submitted', submitted_at = datetime('now'), updated_at = datetime('now') WHERE id = ?").run(r.id);
  logAudit(req.user, 'change_request_submitted', 'change_request', r.id, { number: r.number });
  res.json({ request: shape(db, get(db, r.id), req.user) });
});

// Quality's approval is a SIGNATURE — the password at the moment of signing.
router.post('/:id/approve', (req, res) => {
  const db = getDb();
  const r = get(db, req.params.id);
  if (!r) return res.status(404).json({ error: 'Not found' });
  if (!isQuality(req.user)) return res.status(403).json({ error: 'Quality approves changes — a QA supervisor or an admin.' });
  if (r.status !== 'submitted') return res.status(409).json({ error: 'Only a submitted change can be approved.' });
  if (!gateSignature(req, res, { action: 'change_request_approve' })) return;
  db.prepare("UPDATE change_requests SET status = 'approved', approved_by = ?, approved_at = datetime('now'), approval_note = ?, updated_at = datetime('now') WHERE id = ?")
    .run(req.user.name, clean(req.body?.note, 2000), r.id);
  logAudit(req.user, 'change_request_approved', 'change_request', r.id, { number: r.number, ...signatureEvidence() }, r, get(db, r.id), r.number);
  res.json({ request: shape(db, get(db, r.id), req.user) });
});

router.post('/:id/reject', (req, res) => {
  const db = getDb();
  const r = get(db, req.params.id);
  if (!r) return res.status(404).json({ error: 'Not found' });
  if (!isQuality(req.user)) return res.status(403).json({ error: 'Quality decides changes.' });
  if (r.status !== 'submitted') return res.status(409).json({ error: 'Only a submitted change can be rejected.' });
  const reason = clean(req.body?.reason, 2000);
  if (!reason || reason.length < 3) return res.status(400).json({ error: 'Say why (recorded on the change).' });
  db.prepare("UPDATE change_requests SET status = 'rejected', rejected_by = ?, rejected_at = datetime('now'), rejected_reason = ?, updated_at = datetime('now') WHERE id = ?").run(req.user.name, reason, r.id);
  logAudit(req.user, 'change_request_rejected', 'change_request', r.id, { number: r.number, reason });
  res.json({ request: shape(db, get(db, r.id), req.user) });
});

// Implemented follows approval. A change implemented before Quality approved
// it is the finding; the register refuses to record the order the other way.
router.post('/:id/implement', (req, res) => {
  const db = getDb();
  const r = get(db, req.params.id);
  if (!r) return res.status(404).json({ error: 'Not found' });
  if (r.status !== 'approved') return res.status(409).json({ error: r.status === 'submitted' ? 'Quality has not approved this change yet.' : 'Only an approved change can be marked implemented.' });
  if (!mayEdit(req.user, r) && !isQuality(req.user)) return res.status(403).json({ error: 'Not permitted' });
  const notes = clean(req.body?.implementation_notes, 4000);
  if (!notes) return res.status(400).json({ error: 'Say what was done to implement it.' });
  db.prepare("UPDATE change_requests SET status = 'implemented', implemented_by = ?, implemented_on = ?, implementation_notes = ?, release_id = COALESCE(?, release_id), updated_at = datetime('now') WHERE id = ?")
    .run(req.user.name, isDay(req.body?.implemented_on) ? req.body.implemented_on : db.prepare("SELECT date('now') d").get().d, notes, clean(req.body?.release_id, 60), r.id);
  logAudit(req.user, 'change_request_implemented', 'change_request', r.id, { number: r.number });
  res.json({ request: shape(db, get(db, r.id), req.user) });
});

// Closing is Quality's second signature: the change worked. Nothing closes
// without the approval already on the record.
router.post('/:id/close', (req, res) => {
  const db = getDb();
  const r = get(db, req.params.id);
  if (!r) return res.status(404).json({ error: 'Not found' });
  if (!isQuality(req.user)) return res.status(403).json({ error: 'Quality closes changes.' });
  if (r.status !== 'implemented') return res.status(409).json({ error: 'A change closes after it is approved and implemented.' });
  if (!r.approved_at) return res.status(409).json({ error: 'No Quality approval on record — a change cannot close without one.' });
  const eff = clean(req.body?.effectiveness_check, 4000);
  if (!eff || eff.length < 5) return res.status(400).json({ error: 'Record the effectiveness check — what was verified after the change.' });
  if (!gateSignature(req, res, { action: 'change_request_close' })) return;
  db.prepare("UPDATE change_requests SET status = 'closed', effectiveness_check = ?, closed_by = ?, closed_at = datetime('now'), updated_at = datetime('now') WHERE id = ?").run(eff, req.user.name, r.id);
  logAudit(req.user, 'change_request_closed', 'change_request', r.id, { number: r.number, ...signatureEvidence() }, r, get(db, r.id), r.number);
  res.json({ request: shape(db, get(db, r.id), req.user) });
});

router.post('/:id/withdraw', (req, res) => {
  const db = getDb();
  const r = get(db, req.params.id);
  if (!r) return res.status(404).json({ error: 'Not found' });
  if (!['draft', 'submitted'].includes(r.status)) return res.status(409).json({ error: 'Only a draft or submitted change can be withdrawn.' });
  if (!mayEdit(req.user, r)) return res.status(403).json({ error: 'Not permitted' });
  const reason = clean(req.body?.reason, 2000);
  if (!reason) return res.status(400).json({ error: 'Say why it is withdrawn.' });
  db.prepare("UPDATE change_requests SET status = 'withdrawn', rejected_reason = ?, updated_at = datetime('now') WHERE id = ?").run(reason, r.id);
  logAudit(req.user, 'change_request_withdrawn', 'change_request', r.id, { number: r.number, reason });
  res.json({ request: shape(db, get(db, r.id), req.user) });
});

export default router;
