// INCOMING SAMPLING (D-394, A-20261124-003) — the next step after a signed
// receiving inspection: sample the lot (SOP 402 V3 § IV.B) and decide release,
// hold or reject (§ IV.C), signed with the password. Replaces paper sampling
// going forward; historical paper stays paper.
//
// - ONE WRITER per act: fileSampling · saveSampling · signSampling · revokeSampling.
//   The routes and the record interface both call them.
// - THE CONTAINER RULE IS CONTROLLED (`sampling:SOP 402`): √(N+1), rounded up,
//   is SOP 402 V3's, and a change to it parks for Document Control like every
//   other acceptance criterion. Each signed record freezes the rule it was signed
//   under and the count it required.
// - A dietary ingredient is released only with a linked lab request that PASSED
//   (the identity test). A lab request is the COA module's (D-257) — this record
//   links to it and never replaces it.
// - A person signs. A token is refused by the approve guard on the path, a bot
//   account here.
import { Router } from 'express';
import { randomUUID as uuid, createHash } from 'crypto';
import { getDb, logAudit } from './db.js';
import { gateSignature } from './signature.js';
import { signatureMeaning } from '../shared/signature-meaning.js';
import { isBotAccount } from './trainees.js';
import { canLog } from './api/receiving.js';
import {
  SAMPLING_FORM, SAMPLING_STEPS, STEP_ANSWERS, MATERIAL_KINDS, MATERIAL_KIND_VALUES, DISPOSITIONS, DISPOSITION_VALUES,
  containersRequired, signRefusals,
} from '../shared/incoming-sampling.js';

// ── The controlled rule ─────────────────────────────────────────────────────
export const SAMPLING_RULE = { method: 'sqrt_n_plus_1', round: 'up', document: 'SOP 402', revision: 'V3' };

export function samplingControlledEntry() {
  return {
    scope: 'acceptance',
    key: 'sampling:SOP 402',
    label: 'Incoming sampling — containers to sample (SOP 402)',
    current: () => ({ ...SAMPLING_RULE }),
    editable: () => [
      { path: 'round', label: 'Round √(N+1) (up or nearest)', type: 'text' },
      { path: 'document', label: 'Document', type: 'text' },
      { path: 'revision', label: 'Revision', type: 'text' },
    ],
    validate: (s) => (['up', 'nearest'].includes(s?.round) ? [] : ['Rounding is "up" or "nearest".']),
    apply: (snap) => {
      if (['up', 'nearest'].includes(snap?.round)) SAMPLING_RULE.round = snap.round;
      if (snap?.document) SAMPLING_RULE.document = snap.document;
      if (snap?.revision) SAMPLING_RULE.revision = snap.revision;
    },
  };
}

// ── Who ─────────────────────────────────────────────────────────────────────
const isQa = (u) => ['qa', 'quality'].includes(String(u?.department || '').toLowerCase());
/** Filing and filling it in: the dock or QA. */
export const canFileSampling = (u) => canLog(u) || isQa(u);
/** Signing the disposition: QA or an admin — whose judgement release is. */
export const canSignSampling = (u) => u?.role === 'admin' || isQa(u);

// ── Shape ───────────────────────────────────────────────────────────────────
const j = (s, fb) => { try { return s ? JSON.parse(s) : fb; } catch { return fb; } };
const t = (v, n = 300) => { const s = String(v ?? '').trim(); return s ? s.slice(0, n) : null; };
const int = (v) => { const n = Math.floor(Number(v)); return Number.isFinite(n) && n >= 0 ? n : null; };
const sqlNow = () => new Date().toISOString().replace('T', ' ').slice(0, 19);
const HASHED = ['id', 'sampling_no', 'inspection_no', 'part_number', 'vendor_lot', 'material_kind', 'containers_received',
  'containers_sampled', 'steps', 'disposition', 'disposition_reason', 'coa_request_id', 'signed_by', 'signed_at', 'sign_meaning'];
export const samplingHash = (r) => createHash('sha256').update(JSON.stringify(HASHED.map(k => r?.[k] ?? null))).digest('hex');

const labStatus = (db, id) => (id ? db.prepare('SELECT status FROM coa_requests WHERE id = ?').get(id)?.status || 'missing' : null);

export function shapeSampling(db, r, user = null) {
  if (!r) return null;
  const rec = { ...r, steps: j(r.steps, {}), step_notes: j(r.step_notes, {}), rule: j(r.rule, null), composite: !!r.composite };
  const lab = rec.coa_request_id ? db.prepare('SELECT id, status, tests_requested FROM coa_requests WHERE id = ?').get(rec.coa_request_id) : null;
  const rule = rec.signed_at ? (rec.rule || SAMPLING_RULE) : SAMPLING_RULE;
  return {
    ...rec,
    lab_request: lab || null,
    containers_required: rec.signed_at ? rec.containers_required : containersRequired(rec.containers_received, rule),
    refusals: rec.signed_at ? [] : signRefusals(rec, { rule, linkedLab: lab?.status || (rec.coa_request_id ? 'missing' : null) }),
    signature_state: rec.signed_at ? (rec.sign_hash === samplingHash(r) ? 'signed' : 'changed') : null,
    can_edit: !rec.signed_at && !!user && canFileSampling(user),
    can_sign: !rec.signed_at && !!user && canSignSampling(user),
  };
}

function nextNo(db) {
  const r = db.prepare("SELECT MAX(CAST(substr(sampling_no, 5) AS INTEGER)) n FROM incoming_samplings WHERE sampling_no LIKE 'SMP-%'").get();
  return `SMP-${String((r?.n || 0) + 1).padStart(4, '0')}`;
}

// ── File (get-or-create on a receiving line) ────────────────────────────────
export function fileSampling(db, user, input = {}) {
  if (!canFileSampling(user)) return { status: 403, error: 'Sampling is filed by the dock or QA.' };
  const lineId = t(input.receiving_log_id, 80);
  if (!lineId) return { status: 400, error: 'Sample a line on a receiving inspection.' };
  const line = db.prepare('SELECT * FROM receiving_log WHERE id = ?').get(lineId);
  if (!line) return { status: 404, error: 'That receiving line was not found.' };
  const cl = line.inspection_no ? db.prepare('SELECT * FROM receiving_checklists WHERE inspection_no = ?').get(line.inspection_no) : null;
  if (!cl?.reviewed_at) {
    return { status: 409, code: 'RECEIVING_NOT_SIGNED', error: `Sign off receiving inspection ${line.inspection_no || '(none)'} first. Sampling is the step after it.` };
  }
  const existing = db.prepare('SELECT * FROM incoming_samplings WHERE receiving_log_id = ? ORDER BY created_at DESC LIMIT 1').get(lineId);
  if (existing) return { status: 200, row: existing, existing: true };
  const id = uuid();
  db.prepare(`INSERT INTO incoming_samplings (id, sampling_no, inspection_no, receiving_log_id, part_number, item_name, vendor, vendor_lot,
      po_number, form_revision, procedure, sampled_at, created_by, created_by_id)
    VALUES (?,?,?,?,?,?,?,?,?,?,?, date('now'), ?, ?)`)
    .run(id, nextNo(db), line.inspection_no, lineId, line.part_number || null, line.part_description || null,
      cl.vendor || null, line.vendor_lot || null, line.po_number || null, SAMPLING_FORM.revision, SAMPLING_FORM.procedure,
      user.name, user.id || null);
  const row = db.prepare('SELECT * FROM incoming_samplings WHERE id = ?').get(id);
  logAudit(user, 'create', 'incoming_sampling', id, { inspection_no: line.inspection_no, part_number: line.part_number, vendor_lot: line.vendor_lot }, null, row, row.sampling_no);
  return { status: 201, row };
}

// ── Save (an open record only) ──────────────────────────────────────────────
const FIELDS = {
  item_name: (v) => t(v, 300), vendor_lot: (v) => t(v, 100), internal_lot: (v) => t(v, 100), po_number: (v) => t(v, 40),
  material_kind: (v) => (MATERIAL_KIND_VALUES.includes(v) ? v : null),
  containers_received: int, containers_sampled: int, container_numbers: (v) => t(v, 300),
  composite: (v) => (v ? 1 : 0), visual_ok: (v) => (['yes', 'no'].includes(v) ? v : null),
  disposition: (v) => (DISPOSITION_VALUES.includes(v) ? v : null), disposition_reason: (v) => t(v, 1000),
  coa_request_id: (v) => t(v, 80), notes: (v) => t(v, 2000), sampled_at: (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? v : null),
};
export function saveSampling(db, user, id, body = {}) {
  if (!canFileSampling(user)) return { status: 403, error: 'Sampling is filed by the dock or QA.' };
  const row = db.prepare('SELECT * FROM incoming_samplings WHERE id = ?').get(id);
  if (!row) return { status: 404, error: 'Not found' };
  if (row.signed_at) return { status: 409, error: 'This sampling record is signed. Revoke the signature to correct it.' };
  const patch = {};
  for (const [k, f] of Object.entries(FIELDS)) if (k in body) patch[k] = f(body[k]);
  if ('steps' in body) {
    const s = {};
    for (const st of SAMPLING_STEPS) if (STEP_ANSWERS.includes(body.steps?.[st.key])) s[st.key] = body.steps[st.key];
    patch.steps = JSON.stringify({ ...j(row.steps, {}), ...s });
  }
  if ('step_notes' in body) {
    const n = {};
    for (const st of SAMPLING_STEPS) if (body.step_notes?.[st.key] != null) n[st.key] = t(body.step_notes[st.key], 500);
    patch.step_notes = JSON.stringify({ ...j(row.step_notes, {}), ...n });
  }
  if (patch.coa_request_id && !db.prepare('SELECT 1 FROM coa_requests WHERE id = ?').get(patch.coa_request_id)) {
    return { status: 400, error: 'That lab request was not found.' };
  }
  const cols = Object.keys(patch);
  if (!cols.length) return { status: 200, row };
  db.prepare(`UPDATE incoming_samplings SET ${cols.map(c => `${c} = ?`).join(', ')}, updated_at = datetime('now') WHERE id = ?`)
    .run(...cols.map(c => patch[c]), id);
  const after = db.prepare('SELECT * FROM incoming_samplings WHERE id = ?').get(id);
  logAudit(user, 'update', 'incoming_sampling', id, { fields: cols }, row, after, row.sampling_no);
  return { status: 200, row: after };
}

// ── Sign (QA, with the password) ────────────────────────────────────────────
export function signSampling(db, user, id, { gate = null, auth = null } = {}) {
  if (auth?.kind === 'token' || isBotAccount(db, user)) return { status: 403, code: 'PERSON_ONLY', error: 'A person signs a sampling record.' };
  if (!canSignSampling(user)) return { status: 403, error: 'QA or an admin signs the sampling and its disposition.' };
  const row = db.prepare('SELECT * FROM incoming_samplings WHERE id = ?').get(id);
  if (!row) return { status: 404, error: 'Not found' };
  if (row.signed_at) return { status: 409, error: 'Already signed.' };
  const rec = { ...row, steps: j(row.steps, {}), step_notes: j(row.step_notes, {}) };
  const refusals = signRefusals(rec, { rule: SAMPLING_RULE, linkedLab: row.coa_request_id ? labStatus(db, row.coa_request_id) : null });
  if (refusals.length) return { status: 400, code: 'NOT_READY', error: refusals.join(' '), refusals };
  if (!gate) return { status: 403, error: 'A sampling record is signed with the password, on the receiving screen.', signature_required: true };
  if (!gate()) return { handled: true };
  const at = sqlNow();
  const meaning = signatureMeaning('incoming_sampling');
  const rule = { ...SAMPLING_RULE };
  const need = containersRequired(row.containers_received, rule);
  const signed = { ...row, signed_by: user.name, signed_at: at, sign_meaning: meaning };
  db.prepare(`UPDATE incoming_samplings SET signed_by = ?, signed_by_id = ?, signed_at = ?, sign_meaning = ?, sign_hash = ?,
      rule = ?, containers_required = ?, updated_at = datetime('now') WHERE id = ?`)
    .run(user.name, user.id || null, at, meaning, samplingHash(signed), JSON.stringify(rule), need, id);
  const after = db.prepare('SELECT * FROM incoming_samplings WHERE id = ?').get(id);
  logAudit(user, 'incoming_sampling_signed', 'incoming_sampling', id,
    { disposition: row.disposition, containers_required: need, containers_sampled: row.containers_sampled, rule, meaning, signature_verified: true },
    row, after, row.sampling_no);
  return { status: 200, row: after };
}

export function revokeSampling(db, user, id, { gate = null, reason = '' } = {}) {
  const row = db.prepare('SELECT * FROM incoming_samplings WHERE id = ?').get(id);
  if (!row) return { status: 404, error: 'Not found' };
  if (!row.signed_at) return { status: 409, error: 'This sampling record is not signed.' };
  if (user.role !== 'admin' && row.signed_by !== user.name) return { status: 403, error: 'Only the person who signed it, or an admin, can revoke it.' };
  if (String(reason || '').trim().length < 3) return { status: 400, error: 'Say why the signature is being revoked.' };
  if (!gate) return { status: 403, error: 'Revoking is signed with the password.', signature_required: true };
  if (!gate()) return { handled: true };
  db.prepare(`UPDATE incoming_samplings SET signed_by = NULL, signed_by_id = NULL, signed_at = NULL, sign_meaning = NULL, sign_hash = NULL,
      rule = NULL, containers_required = NULL, updated_at = datetime('now') WHERE id = ?`).run(id);
  logAudit(user, 'incoming_sampling_revoked', 'incoming_sampling', id,
    { was_signed_by: row.signed_by, was_meaning: row.sign_meaning, reason: String(reason).trim(), signature_verified: true }, row, null, row.sampling_no);
  return { status: 200, ok: true };
}

// ── Routes (/api/receiving/sampling) ────────────────────────────────────────
const router = Router();
const send = (res, out, db, user) => {
  if (out.handled) return;
  if (out.error) return res.status(out.status).json({ error: out.error, ...(out.code ? { code: out.code } : {}),
    ...(out.refusals ? { refusals: out.refusals } : {}), ...(out.signature_required ? { signature_required: true } : {}) });
  res.status(out.status || 200).json(out.row ? shapeSampling(db, out.row, user) : out);
};

router.get('/form', (_req, res) => res.json({
  form: SAMPLING_FORM, steps: SAMPLING_STEPS, material_kinds: MATERIAL_KINDS, dispositions: DISPOSITIONS, rule: { ...SAMPLING_RULE },
}));
router.get('/', (req, res) => {
  const db = getDb();
  const where = []; const args = [];
  if (req.query.inspection_no) { where.push('inspection_no = ?'); args.push(String(req.query.inspection_no)); }
  if (req.query.receiving_log_id) { where.push('receiving_log_id = ?'); args.push(String(req.query.receiving_log_id)); }
  if (req.query.state === 'open') where.push('signed_at IS NULL');
  const rows = db.prepare(`SELECT * FROM incoming_samplings ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY created_at DESC LIMIT 500`).all(...args);
  res.json({ samplings: rows.map(r => shapeSampling(db, r, req.user)), can_file: canFileSampling(req.user), can_sign: canSignSampling(req.user) });
});
router.get('/:id', (req, res) => {
  const db = getDb();
  const r = db.prepare('SELECT * FROM incoming_samplings WHERE id = ? OR sampling_no = ?').get(req.params.id, req.params.id);
  if (!r) return res.status(404).json({ error: 'Not found' });
  // The lab requests already raised from this receiving line (D-257), to link one.
  const lab_requests = r.receiving_log_id
    ? db.prepare('SELECT id, status, tests_requested, date_sent FROM coa_requests WHERE receiving_log_id = ? ORDER BY created_at DESC').all(r.receiving_log_id)
    : [];
  res.json({ ...shapeSampling(db, r, req.user), lab_requests });
});
router.post('/', (req, res) => { const db = getDb(); send(res, fileSampling(db, req.user, req.body || {}), db, req.user); });
router.put('/:id', (req, res) => { const db = getDb(); send(res, saveSampling(db, req.user, req.params.id, req.body || {}), db, req.user); });
router.post('/:id/sign', (req, res) => {
  const db = getDb();
  send(res, signSampling(db, req.user, req.params.id, { auth: req.auth, gate: () => gateSignature(req, res, { action: 'incoming_sampling_sign' }) }), db, req.user);
});
router.delete('/:id/sign', (req, res) => {
  const db = getDb();
  send(res, revokeSampling(db, req.user, req.params.id, { reason: req.body?.reason,
    gate: () => gateSignature(req, res, { action: 'incoming_sampling_revoke' }) }), db, req.user);
});
export default router;
