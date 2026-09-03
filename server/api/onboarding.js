// New-hire onboarding: the office starts it, the new hire completes it on a
// magic link with no account, and the packet lands in ADP — through the API
// once the Marketplace credentials exist, or keyed into RUN from the
// completed packet until then. docs/adp-run-onboarding.md is the map.
//
// Two routers because two audiences:
//   - the admin router mounts behind requireModuleWrite('onboarding')
//   - the portal router mounts publicly (isPublicPath '/onboarding-portal/'),
//     token-gated exactly like the partner portal: SHA-256 hash stored, clear
//     token in the link, single indexed lookup.
//
// SSN and bank numbers: encrypted at rest or NOT COLLECTED (onboarding-crypto).
// They never leave the server — every read shape returns last-4 — and are
// decrypted in exactly one place: building the ADP submission.
//
// ── What the new hire completes here, and what a signature is ─────────────
// The wizard now carries the whole federal W-4 (Steps 1–5) and I-9 Section 1,
// plus the pictures behind them: ID documents for the I-9 and a voided check
// for direct deposit. Each form ends in a SIGNATURE: the employee types their
// full legal name under the form's own perjury statement, and the server
// records the name, the moment, the address it came from and the device — a
// typed name with none of that is a text box, not a signature. I-9 Section 2
// is the EMPLOYER's: the office records the documents it examined and signs
// under the password gate every other signature in ReadyDoc uses.
//
// FINISHING IS REFUSED WHILE ANYTHING THE FORMS REQUIRE IS BLANK. The office
// used to receive packets with no SSN, because nothing asked for one. A packet
// that cannot be keyed into payroll is a packet somebody has to chase.

import { Router } from 'express';
import { randomUUID as uuid, randomBytes, createHash } from 'crypto';
import { readFileSync } from 'fs';
import PDFDocument from 'pdfkit';
import { getDb, logAudit } from '../db.js';
import { hasExplicitGrant } from '../module-access.js';
import { parseJson } from '../custom-fields.js';
import { uniqueUsername } from '../usernames.js';
import { readyDocOrigin } from '../links.js';
import { cryptoEnabled, encryptField, decryptField, last4 } from '../onboarding-crypto.js';
import { adpEnabled, submitApplicantOnboard } from '../adp.js';
import { storageEnabled, putObject, presignGet, deleteObject } from '../storage.js';
import { mediaUpload, cleanupTemp, uploadErrorMessage } from '../media.js';
import { gateSignature, signatureEvidence } from '../signature.js';

export const router = Router();
export const portalRouter = Router();

// Onboarding holds pay and identity data — admins, or an explicit grant.
const canManage = (u) => u?.role === 'admin' || hasExplicitGrant(u, 'onboarding');

const sha = (t) => createHash('sha256').update(t).digest('hex');

// What the new hire may write about themselves. Job facts (department, team,
// position, start date, pay) are the OFFICE's fields — a portal that accepted
// them would let a link edit its own pay rate.
const PORTAL_FIELDS = [
  'first_name', 'middle_name', 'last_name', 'preferred_name', 'email', 'phone',
  'address1', 'address2', 'city', 'state', 'zip', 'dob',
  'emergency_name', 'emergency_phone', 'emergency_relationship',
  'pay_method', 'dd_bank_name', 'dd_account_type',
  'w4_filing_status', 'w4_qualifying_children', 'w4_other_dependents', 'w4_dependents_amount',
  'w4_other_income', 'w4_deductions', 'w4_extra_withholding',
  'i9_other_last_names', 'i9_citizenship', 'i9_uscis_number', 'i9_i94_number',
  'i9_passport_number', 'i9_passport_country', 'i9_work_until', 'i9_preparer', 'i9_preparer_name',
  'language',
];
const ADMIN_FIELDS = [...PORTAL_FIELDS, 'department', 'team', 'position', 'start_date', 'pay_rate', 'pay_frequency', 'notes'];
const BOOL_FIELDS = ['w4_multiple_jobs', 'w4_exempt'];

export const PAY_METHODS = ['direct_deposit', 'check'];
export const FILING_STATUSES = ['single', 'married_jointly', 'head_of_household'];
export const CITIZENSHIP = ['citizen', 'noncitizen_national', 'permanent_resident', 'authorized_alien'];
export const FILE_KINDS = ['id_document', 'voided_check', 'other'];

// The perjury statements, verbatim from the forms, so the record carries what
// the person actually signed under.
export const W4_ATTESTATION = 'Under penalties of perjury, I declare that this certificate, to the best of my knowledge and belief, is true, correct, and complete.';
export const I9_S1_ATTESTATION = 'I am aware that federal law provides for imprisonment and/or fines for false statements, or the use of false documents, in connection with the completion of this form. I attest, under penalty of perjury, that this information, including my selection of the box attesting to my citizenship or immigration status, is true and correct.';
export const I9_S2_ATTESTATION = 'I attest, under penalty of perjury, that (1) I have examined the documentation presented by the above-named employee, (2) the above-listed documentation appears to be genuine and to relate to the employee named, and (3) to the best of my knowledge, the employee is authorized to work in the United States.';

const fileUpload = mediaUpload({ files: 10 }).array('files', 10);
const uploadFiles = (req, res, next) => fileUpload(req, res, (err) => {
  if (err) return res.status(413).json({ error: uploadErrorMessage(err) });
  next();
});

function filesFor(db, id) {
  return db.prepare(`SELECT id, kind, filename, content_type, size, uploaded_by, uploaded_at, storage_key
    FROM onboarding_files WHERE onboarding_id = ? ORDER BY uploaded_at`).all(id)
    .map(({ storage_key, ...f }) => ({ ...f, has_file: !!storage_key }));
}

// A signature as the record keeps it: who typed what, when, from where.
const signatureOf = (v) => {
  const j = parseJson(v, null);
  return j && j.name ? j : null;
};

// One shape for every read: ciphertext never leaves, last-4 does.
function shape(db, r) {
  if (!r) return null;
  const { token_hash: _th, ssn_enc, dd_routing_enc: _dr, dd_account_enc, ...rest } = r;
  return {
    ...rest,
    progress: parseJson(r.progress, {}) || {},
    has_ssn: !!ssn_enc, has_bank: !!dd_account_enc,
    w4_multiple_jobs: !!r.w4_multiple_jobs,
    w4_exempt: !!r.w4_exempt,
    w4_signature: signatureOf(r.w4_signature),
    i9_signature: signatureOf(r.i9_signature),
    i9_section2: parseJson(r.i9_section2, null),
    files: filesFor(db, r.id),
    missing: missingToFinish(db, r),
    sensitive_collection: cryptoEnabled(),
    storage_enabled: storageEnabled(),
    adp_ready: adpEnabled(),
  };
}

const digits = (v) => String(v || '').replace(/\D/g, '');
// ABA routing checksum: 3(d1+d4+d7) + 7(d2+d5+d8) + (d3+d6+d9) ≡ 0 (mod 10).
export function validRouting(v) {
  const d = digits(v);
  if (d.length !== 9) return false;
  const n = d.split('').map(Number);
  return (3 * (n[0] + n[3] + n[6]) + 7 * (n[1] + n[4] + n[7]) + (n[2] + n[5] + n[8])) % 10 === 0;
}

function applyFields(db, rec, body, allowed) {
  const patch = {};
  for (const f of allowed) if (body[f] !== undefined) patch[f] = body[f] === '' ? null : String(body[f]).slice(0, 300);
  for (const f of BOOL_FIELDS) if (body[f] !== undefined) patch[f] = body[f] ? 1 : 0;
  if (patch.pay_method && !PAY_METHODS.includes(patch.pay_method)) return { error: 'Pay method must be direct deposit or check.' };
  if (patch.w4_filing_status && !FILING_STATUSES.includes(patch.w4_filing_status)) return { error: 'Unknown filing status.' };
  if (patch.i9_citizenship && !CITIZENSHIP.includes(patch.i9_citizenship)) return { error: 'Unknown citizenship status.' };
  // Sensitive fields: encrypted or refused, never stored bare. Validated on
  // the way in, because a mistyped routing number is a paycheck that bounces.
  for (const [field, encCol, l4Col] of [['ssn', 'ssn_enc', 'ssn_last4'], ['dd_routing', 'dd_routing_enc', null], ['dd_account', 'dd_account_enc', 'dd_account_last4']]) {
    if (body[field] === undefined) continue;
    const clear = String(body[field]).trim();
    // A blank is "nothing to store", not an attempt to store something — the
    // wizard re-sends these keys empty after every save, and in no-key mode
    // refusing the blank refused the whole page with it.
    if (!clear) continue;
    if (!cryptoEnabled()) return { error: 'Sensitive fields are not collected until encryption is configured (ONBOARDING_ENC_KEY).' };
    if (field === 'ssn' && digits(clear).length !== 9) return { error: 'A Social Security number is nine digits.' };
    if (field === 'dd_routing' && !validRouting(clear)) return { error: 'That routing number does not check out — it is the nine digits at the bottom-left of a check.' };
    if (field === 'dd_account' && (digits(clear).length < 4 || digits(clear).length > 17)) return { error: 'An account number is 4 to 17 digits.' };
    patch[encCol] = encryptField(field === 'ssn' ? digits(clear) : clear);
    if (l4Col) patch[l4Col] = last4(clear);
  }
  if (body.progress !== undefined && typeof body.progress === 'object') {
    patch.progress = JSON.stringify({ ...(parseJson(rec.progress, {}) || {}), ...body.progress });
  }
  if (!Object.keys(patch).length) return { patch: null };
  db.prepare(`UPDATE onboarding_records SET ${Object.keys(patch).map(k => `${k} = ?`).join(', ')},
    updated_at = datetime('now') WHERE id = ?`).run(...Object.values(patch), rec.id);
  return { patch };
}

/**
 * Sign one of the employee's forms. The name typed must be the legal name on
 * the record — a signature under somebody else's name is the one thing this
 * must refuse — and the attestation box must be ticked: the statement is the
 * form's own wording and signing without it is not signing the form.
 */
function signForm(db, rec, which, body, req) {
  const name = String(body.signed_name || '').trim();
  const legal = [rec.first_name, rec.middle_name, rec.last_name].filter(Boolean).join(' ').trim();
  const legalShort = [rec.first_name, rec.last_name].filter(Boolean).join(' ').trim();
  if (!name) return { error: 'Type your full legal name to sign.' };
  const norm = (s) => s.toLowerCase().replace(/\s+/g, ' ');
  if (norm(name) !== norm(legal) && norm(name) !== norm(legalShort)) {
    return { error: `The signature must be your legal name as entered above (${legalShort}).` };
  }
  if (!body.attest) return { error: 'Read the statement and tick the box to sign.' };
  if (which === 'w4' && !rec.w4_filing_status) return { error: 'Choose a filing status before signing the W-4.' };
  if (which === 'i9' && !rec.i9_citizenship) return { error: 'Choose your citizenship or immigration status before signing.' };
  const sig = {
    name, at: new Date().toISOString(),
    ip: req.ip || null, ua: String(req.headers['user-agent'] || '').slice(0, 200),
    attestation: which === 'w4' ? W4_ATTESTATION : I9_S1_ATTESTATION,
  };
  db.prepare(`UPDATE onboarding_records SET ${which}_signature = ?, updated_at = datetime('now') WHERE id = ?`)
    .run(JSON.stringify(sig), rec.id);
  return { ok: true };
}

/**
 * What the forms still need before the new hire can finish — DERIVED on every
 * read, so the wizard, the office packet and the finish gate cannot disagree
 * about what is missing.
 */
export function missingToFinish(db, rec) {
  const m = [];
  const blank = (f) => !String(rec[f] || '').trim();
  for (const [f, l] of [['first_name', 'first name'], ['last_name', 'last name'], ['dob', 'date of birth'],
    ['address1', 'home address'], ['city', 'city'], ['state', 'state'], ['zip', 'ZIP'], ['phone', 'phone']]) {
    if (blank(f)) m.push({ step: 'personal', field: f, label: l });
  }
  if (cryptoEnabled() && !rec.ssn_enc) m.push({ step: 'personal', field: 'ssn', label: 'Social Security number' });
  if (blank('pay_method')) m.push({ step: 'deposit', field: 'pay_method', label: 'how you want to be paid' });
  if (rec.pay_method === 'direct_deposit') {
    if (cryptoEnabled()) {
      if (!rec.dd_routing_enc) m.push({ step: 'deposit', field: 'dd_routing', label: 'routing number' });
      if (!rec.dd_account_enc) m.push({ step: 'deposit', field: 'dd_account', label: 'account number' });
      if (blank('dd_account_type')) m.push({ step: 'deposit', field: 'dd_account_type', label: 'checking or savings' });
    } else {
      // No key: the numbers are not typed here, so the voided check IS the
      // direct-deposit instruction and must be attached.
      const hasCheck = db.prepare("SELECT 1 FROM onboarding_files WHERE onboarding_id = ? AND kind = 'voided_check'").get(rec.id);
      if (!hasCheck) m.push({ step: 'deposit', field: 'voided_check', label: 'a photo of a voided check' });
    }
  }
  if (blank('w4_filing_status')) m.push({ step: 'w4', field: 'w4_filing_status', label: 'W-4 filing status' });
  if (!signatureOf(rec.w4_signature)) m.push({ step: 'w4', field: 'w4_signature', label: 'your signature on the W-4' });
  if (blank('i9_citizenship')) m.push({ step: 'i9', field: 'i9_citizenship', label: 'I-9 citizenship or immigration status' });
  if (rec.i9_citizenship === 'permanent_resident' && blank('i9_uscis_number')) {
    m.push({ step: 'i9', field: 'i9_uscis_number', label: 'USCIS A-Number' });
  }
  if (rec.i9_citizenship === 'authorized_alien') {
    if (blank('i9_work_until')) m.push({ step: 'i9', field: 'i9_work_until', label: 'work authorization expiration (or N/A)' });
    if (blank('i9_uscis_number') && blank('i9_i94_number') && blank('i9_passport_number')) {
      m.push({ step: 'i9', field: 'i9_uscis_number', label: 'a USCIS A-Number, I-94 number, or foreign passport number' });
    }
    if (!blank('i9_passport_number') && blank('i9_passport_country')) m.push({ step: 'i9', field: 'i9_passport_country', label: 'passport country of issuance' });
  }
  if (rec.i9_preparer === 'used' && blank('i9_preparer_name')) m.push({ step: 'i9', field: 'i9_preparer_name', label: 'the preparer or translator\'s name' });
  if (!signatureOf(rec.i9_signature)) m.push({ step: 'i9', field: 'i9_signature', label: 'your signature on the I-9' });
  return m;
}

async function storeFiles(db, rec, files, kind, by) {
  const k = FILE_KINDS.includes(kind) ? kind : 'other';
  for (const f of files) {
    const fid = uuid();
    const safe = (f.originalname || 'file').replace(/[^\w.-]+/g, '_').slice(0, 120);
    const key = `onboarding/${rec.id}/${fid}-${safe}`;
    await putObject(key, readFileSync(f.path), f.mimetype);
    db.prepare(`INSERT INTO onboarding_files (id, onboarding_id, kind, storage_key, filename, content_type, size, uploaded_by)
      VALUES (?,?,?,?,?,?,?,?)`).run(fid, rec.id, k, key, (f.originalname || 'file').slice(0, 255),
      f.mimetype || null, f.size || null, by);
  }
}

const nameOf = (rec) => `${rec.first_name || ''} ${rec.last_name || ''}`.trim();

// ── Admin ────────────────────────────────────────────────────────────────────

router.get('/', (req, res) => {
  if (!canManage(req.user)) return res.status(403).json({ error: 'Onboarding needs the Onboarding module.' });
  const db = getDb();
  const rows = db.prepare('SELECT * FROM onboarding_records ORDER BY created_at DESC LIMIT 500').all();
  res.json({
    records: rows.map(r => shape(db, r)),
    adp_ready: adpEnabled(), sensitive_collection: cryptoEnabled(), storage_enabled: storageEnabled(),
    attestations: { w4: W4_ATTESTATION, i9_s1: I9_S1_ATTESTATION, i9_s2: I9_S2_ATTESTATION },
  });
});

router.post('/', (req, res) => {
  if (!canManage(req.user)) return res.status(403).json({ error: 'Onboarding needs the Onboarding module.' });
  const b = req.body || {};
  if (!String(b.first_name || '').trim() || !String(b.last_name || '').trim()) {
    return res.status(400).json({ error: 'First and last name are required to start an onboarding.' });
  }
  const db = getDb();
  const id = uuid();
  const token = randomBytes(24).toString('base64url');
  db.prepare(`INSERT INTO onboarding_records (id, token_hash, status, created_by, invited_at)
    VALUES (?, ?, 'invited', ?, datetime('now'))`).run(id, sha(token), req.user.name);
  const rec = db.prepare('SELECT * FROM onboarding_records WHERE id = ?').get(id);
  const out = applyFields(db, rec, b, ADMIN_FIELDS);
  if (out.error) { db.prepare('DELETE FROM onboarding_records WHERE id = ?').run(id); return res.status(400).json({ error: out.error }); }
  const fresh = db.prepare('SELECT * FROM onboarding_records WHERE id = ?').get(id);
  logAudit(req.user, 'create', 'onboarding', id, { name: nameOf(fresh) }, null, null, nameOf(fresh));
  // The clear token exists in this response and nowhere else — same rule as
  // the partner portal. Lost link ⇒ reissue, which invalidates this one.
  res.status(201).json({ ...shape(db, fresh), link: `${readyDocOrigin()}/welcome/${token}` });
});

// Files: declared before `/:id`.
router.get('/files/:fileId/url', async (req, res) => {
  if (!canManage(req.user)) return res.status(403).json({ error: 'Onboarding needs the Onboarding module.' });
  const f = getDb().prepare('SELECT * FROM onboarding_files WHERE id = ?').get(req.params.fileId);
  if (!f?.storage_key) return res.status(404).json({ error: 'No file' });
  res.json({ url: await presignGet(f.storage_key, f.filename) });
});

router.delete('/files/:fileId', (req, res) => {
  if (!canManage(req.user)) return res.status(403).json({ error: 'Onboarding needs the Onboarding module.' });
  const db = getDb();
  const f = db.prepare(`SELECT f.*, o.first_name, o.last_name FROM onboarding_files f
    JOIN onboarding_records o ON o.id = f.onboarding_id WHERE f.id = ?`).get(req.params.fileId);
  if (!f) return res.status(404).json({ error: 'Not found' });
  db.prepare('DELETE FROM onboarding_files WHERE id = ?').run(f.id);
  if (f.storage_key) deleteObject(f.storage_key);
  logAudit(req.user, 'delete', 'onboarding_file', f.id, { filename: f.filename, kind: f.kind }, null, null, nameOf(f));
  res.json({ ok: true });
});

router.post('/:id/files', uploadFiles, async (req, res) => {
  const files = req.files || [];
  try {
    if (!canManage(req.user)) return res.status(403).json({ error: 'Onboarding needs the Onboarding module.' });
    const db = getDb();
    const rec = db.prepare('SELECT * FROM onboarding_records WHERE id = ?').get(req.params.id);
    if (!rec) return res.status(404).json({ error: 'Not found' });
    if (!storageEnabled()) return res.status(503).json({ error: 'File storage is not configured on this server.' });
    if (!files.length) return res.status(400).json({ error: 'No file received.' });
    await storeFiles(db, rec, files, req.body?.kind, req.user.name);
    logAudit(req.user, 'update', 'onboarding', rec.id, { files_added: files.length, kind: req.body?.kind || 'other' }, null, null, nameOf(rec));
    res.json(shape(db, rec));
  } finally { cleanupTemp(files); }
});

router.put('/:id', (req, res) => {
  if (!canManage(req.user)) return res.status(403).json({ error: 'Onboarding needs the Onboarding module.' });
  const db = getDb();
  const rec = db.prepare('SELECT * FROM onboarding_records WHERE id = ?').get(req.params.id);
  if (!rec) return res.status(404).json({ error: 'Not found' });
  if (['completed', 'cancelled'].includes(rec.status)) return res.status(409).json({ error: `This onboarding is ${rec.status}.` });
  const out = applyFields(db, rec, req.body || {}, ADMIN_FIELDS);
  if (out.error) return res.status(400).json({ error: out.error });
  const next = db.prepare('SELECT * FROM onboarding_records WHERE id = ?').get(rec.id);
  logAudit(req.user, 'update', 'onboarding', rec.id, { fields: Object.keys(out.patch || {}) }, null, null, nameOf(rec));
  res.json(shape(db, next));
});

router.post('/:id/reissue', (req, res) => {
  if (!canManage(req.user)) return res.status(403).json({ error: 'Onboarding needs the Onboarding module.' });
  const db = getDb();
  const rec = db.prepare('SELECT * FROM onboarding_records WHERE id = ?').get(req.params.id);
  if (!rec) return res.status(404).json({ error: 'Not found' });
  if (['completed', 'cancelled'].includes(rec.status)) return res.status(409).json({ error: `This onboarding is ${rec.status}.` });
  const token = randomBytes(24).toString('base64url');
  db.prepare("UPDATE onboarding_records SET token_hash = ?, invited_at = datetime('now'), updated_at = datetime('now') WHERE id = ?")
    .run(sha(token), rec.id);
  logAudit(req.user, 'update', 'onboarding', rec.id, { reissued: true }, null, null, nameOf(rec));
  res.json({ link: `${readyDocOrigin()}/welcome/${token}` });
});

router.post('/:id/cancel', (req, res) => {
  if (!canManage(req.user)) return res.status(403).json({ error: 'Onboarding needs the Onboarding module.' });
  const db = getDb();
  const rec = db.prepare('SELECT * FROM onboarding_records WHERE id = ?').get(req.params.id);
  if (!rec) return res.status(404).json({ error: 'Not found' });
  db.prepare("UPDATE onboarding_records SET status = 'cancelled', token_hash = NULL, updated_at = datetime('now') WHERE id = ?").run(rec.id);
  logAudit(req.user, 'update', 'onboarding', rec.id, { cancelled: true }, null, null, nameOf(rec));
  res.json({ ok: true });
});

/**
 * I-9 Section 2 — the employer's attestation that it examined the documents.
 *
 * Password-gated like every signature in ReadyDoc (403 + signature_required,
 * never 401), because this is the plant's statement under penalty of perjury
 * that a named person looked at the documents. Either one List A document or
 * one List B plus one List C — the form's own rule, enforced here so a
 * packet cannot read "verified" over half an examination.
 */
router.post('/:id/i9-section2', (req, res) => {
  if (!canManage(req.user)) return res.status(403).json({ error: 'Onboarding needs the Onboarding module.' });
  const db = getDb();
  const rec = db.prepare('SELECT * FROM onboarding_records WHERE id = ?').get(req.params.id);
  if (!rec) return res.status(404).json({ error: 'Not found' });
  if (rec.status === 'cancelled') return res.status(409).json({ error: 'This onboarding was cancelled.' });
  if (!signatureOf(rec.i9_signature)) return res.status(400).json({ error: 'The employee has not signed Section 1 yet. Section 2 follows Section 1.' });
  const b = req.body || {};
  const docs = (Array.isArray(b.documents) ? b.documents : []).map(d => ({
    list: String(d.list || '').toUpperCase().slice(0, 1),
    title: String(d.title || '').trim().slice(0, 120),
    issuing_authority: String(d.issuing_authority || '').trim().slice(0, 120),
    number: String(d.number || '').trim().slice(0, 60),
    expires: String(d.expires || '').trim().slice(0, 20) || null,
  })).filter(d => d.list && d.title);
  const lists = docs.map(d => d.list);
  const okA = lists.includes('A');
  const okBC = lists.includes('B') && lists.includes('C');
  if (!okA && !okBC) return res.status(400).json({ error: 'Section 2 needs one List A document, or one List B and one List C document, each with its title, issuing authority and number.' });
  if (docs.some(d => !d.issuing_authority || !d.number)) return res.status(400).json({ error: 'Every document needs its issuing authority and document number.' });
  const firstDay = String(b.first_day || rec.start_date || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(firstDay)) return res.status(400).json({ error: "The employee's first day of employment is required." });
  if (!b.attest) return res.status(400).json({ error: 'Read the attestation and tick the box to sign Section 2.' });
  if (!gateSignature(req, res, { action: 'i9_section2' })) return;
  const s2 = {
    documents: docs, first_day: firstDay,
    additional_info: String(b.additional_info || '').slice(0, 500) || null,
    employer_title: String(b.employer_title || '').slice(0, 80) || null,
    signed_by: req.user.name, signed_at: new Date().toISOString(),
    attestation: I9_S2_ATTESTATION, ...signatureEvidence(),
  };
  db.prepare("UPDATE onboarding_records SET i9_section2 = ?, updated_at = datetime('now') WHERE id = ?").run(JSON.stringify(s2), rec.id);
  logAudit(req.user, 'sign', 'onboarding', rec.id, { i9_section2: true, documents: docs.map(d => `${d.list}: ${d.title}`), ...signatureEvidence() }, null, null, nameOf(rec));
  res.json(shape(db, db.prepare('SELECT * FROM onboarding_records WHERE id = ?').get(rec.id)));
});

// Push the packet into RUN. 503 with the reason until the Marketplace
// credentials exist — the button can render honestly either way.
router.post('/:id/submit-adp', async (req, res) => {
  if (!canManage(req.user)) return res.status(403).json({ error: 'Onboarding needs the Onboarding module.' });
  if (!adpEnabled()) return res.status(503).json({ error: 'ADP is not connected yet — see docs/adp-run-onboarding.md. The packet below is ready to key into RUN.' });
  const db = getDb();
  const rec = db.prepare('SELECT * FROM onboarding_records WHERE id = ?').get(req.params.id);
  if (!rec) return res.status(404).json({ error: 'Not found' });
  if (rec.status === 'cancelled') return res.status(409).json({ error: 'This onboarding was cancelled.' });
  try {
    const response = await submitApplicantOnboard({
      ...rec,
      ssn: decryptField(rec.ssn_enc),
      dd_routing: decryptField(rec.dd_routing_enc),
      dd_account: decryptField(rec.dd_account_enc),
    });
    db.prepare(`UPDATE onboarding_records SET status = 'submitted_to_adp', adp_submitted_at = datetime('now'),
      adp_response = ?, updated_at = datetime('now') WHERE id = ?`)
      .run(JSON.stringify(response).slice(0, 4000), rec.id);
    logAudit(req.user, 'update', 'onboarding', rec.id, { submitted_to_adp: true }, null, null, nameOf(rec));
    res.json(shape(db, db.prepare('SELECT * FROM onboarding_records WHERE id = ?').get(rec.id)));
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

// Close it out, optionally creating the person's ReadyDoc account — which
// starts Messages-only under the NULL-map rule until modules are granted.
router.post('/:id/complete', (req, res) => {
  if (!canManage(req.user)) return res.status(403).json({ error: 'Onboarding needs the Onboarding module.' });
  const db = getDb();
  const rec = db.prepare('SELECT * FROM onboarding_records WHERE id = ?').get(req.params.id);
  if (!rec) return res.status(404).json({ error: 'Not found' });
  if (rec.status === 'cancelled') return res.status(409).json({ error: 'This onboarding was cancelled.' });
  let userId = rec.user_id;
  if (req.body?.create_account && !userId) {
    const name = nameOf(rec);
    const existing = db.prepare('SELECT id FROM users WHERE LOWER(name) = LOWER(?)').get(name);
    if (existing) userId = existing.id;
    else {
      userId = uuid();
      // THE SIGN-IN NAME IS SET HERE, not left for the boot-time backfill.
      // Every other account-creation path (users.js POST and bulk, the Slack
      // importer, auditor passes) derives a username at creation;
      // this one did not, so a new starter onboarded through their own welcome
      // link had `username NULL` and could not sign in until the next process
      // restart happened to run backfillUsernames(). Found by the mirror sweep
      // the week this module was folded onto main.
      db.prepare(`INSERT INTO users (id, name, username, role, department, is_active) VALUES (?, ?, ?, 'operator', ?, 1)`)
        .run(userId, name, uniqueUsername(db, name, null), rec.department || 'production');
      logAudit(req.user, 'create', 'user', userId, { from_onboarding: rec.id }, null, null, name);
    }
  }
  db.prepare(`UPDATE onboarding_records SET status = 'completed', completed_at = datetime('now'),
    token_hash = NULL, user_id = ?, updated_at = datetime('now') WHERE id = ?`).run(userId || null, rec.id);
  logAudit(req.user, 'update', 'onboarding', rec.id, { completed: true, user_id: userId || null }, null, null, nameOf(rec));
  res.json(shape(db, db.prepare('SELECT * FROM onboarding_records WHERE id = ?').get(rec.id)));
});

/**
 * The packet as a document: what was entered, what was signed and when, what
 * the employer examined. Sensitive values print as last-4 — the PDF is filed,
 * emailed and printed, and a full SSN on it would undo the encryption.
 */
router.get('/:id/packet.pdf', (req, res) => {
  if (!canManage(req.user)) return res.status(403).json({ error: 'Onboarding needs the Onboarding module.' });
  const db = getDb();
  const rec = db.prepare('SELECT * FROM onboarding_records WHERE id = ?').get(req.params.id);
  if (!rec) return res.status(404).json({ error: 'Not found' });
  const r = shape(db, rec);
  const doc = new PDFDocument({ size: 'LETTER', margin: 54 });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="onboarding-${(nameOf(rec) || 'packet').replace(/\W+/g, '-').toLowerCase()}.pdf"`);
  doc.pipe(res);
  try {
    const H = (t) => { doc.moveDown(0.6).font('Helvetica-Bold').fontSize(12).text(t); doc.moveDown(0.2).font('Helvetica').fontSize(10); };
    const L = (k, v) => doc.text(`${k}: ${v == null || v === '' ? '—' : v}`);
    const sig = (s) => (s ? `${s.name} · ${s.at}${s.ip ? ` · from ${s.ip}` : ''}` : 'NOT SIGNED');
    doc.font('Helvetica-Bold').fontSize(16).text('New-hire onboarding packet');
    doc.font('Helvetica').fontSize(10).fillColor('#555').text(`Powder Ops · ReadyDoc · generated ${new Date().toISOString().slice(0, 16).replace('T', ' ')} by ${req.user.name}`).fillColor('#000');
    H('Employee');
    L('Name', [rec.first_name, rec.middle_name, rec.last_name].filter(Boolean).join(' '));
    L('Other last names used', rec.i9_other_last_names);
    L('Address', [rec.address1, rec.address2, [rec.city, rec.state, rec.zip].filter(Boolean).join(' ')].filter(Boolean).join(', '));
    L('Date of birth', rec.dob); L('Phone', rec.phone); L('Email', rec.email);
    L('SSN', r.has_ssn ? `•••-••-${rec.ssn_last4}` : 'not collected');
    L('Position', rec.position); L('Team', rec.team); L('Start date', rec.start_date);
    L('Pay', rec.pay_rate ? `${rec.pay_rate}${rec.pay_frequency ? ` / ${rec.pay_frequency}` : ''}` : null);
    L('Emergency contact', rec.emergency_name ? `${rec.emergency_name} (${rec.emergency_relationship || '?'}) ${rec.emergency_phone || ''}` : null);
    H('Pay method');
    L('Method', rec.pay_method === 'direct_deposit' ? 'Direct deposit' : rec.pay_method === 'check' ? 'Paper check' : null);
    if (rec.pay_method === 'direct_deposit') {
      L('Bank', rec.dd_bank_name); L('Account', r.has_bank ? `${rec.dd_account_type || ''} ••••${rec.dd_account_last4 || ''}` : 'not collected — see voided check');
    }
    H('Form W-4 (Employee\'s Withholding Certificate)');
    L('Step 1(c) Filing status', { single: 'Single or Married filing separately', married_jointly: 'Married filing jointly or Qualifying surviving spouse', head_of_household: 'Head of household' }[rec.w4_filing_status] || rec.w4_filing_status);
    L('Step 2 Multiple jobs or spouse works', rec.w4_multiple_jobs ? 'Yes (box checked)' : 'No');
    L('Step 3 Qualifying children under 17', rec.w4_qualifying_children);
    L('Step 3 Other dependents', rec.w4_other_dependents);
    L('Step 3 Total dependents amount ($)', rec.w4_dependents_amount);
    L('Step 4(a) Other income ($)', rec.w4_other_income); L('Step 4(b) Deductions ($)', rec.w4_deductions); L('Step 4(c) Extra withholding ($)', rec.w4_extra_withholding);
    L('Exempt from withholding', rec.w4_exempt ? 'Yes — "Exempt" claimed' : 'No');
    L('Step 5 Employee signature', sig(r.w4_signature));
    if (r.w4_signature) doc.fontSize(8).fillColor('#555').text(W4_ATTESTATION).fillColor('#000').fontSize(10);
    H('Form I-9 Section 1 (Employee Information and Attestation)');
    L('Attests to', { citizen: 'A citizen of the United States', noncitizen_national: 'A noncitizen national of the United States', permanent_resident: 'A lawful permanent resident', authorized_alien: 'A noncitizen authorized to work' }[rec.i9_citizenship] || null);
    L('USCIS A-Number', rec.i9_uscis_number); L('Form I-94 admission number', rec.i9_i94_number);
    L('Foreign passport', rec.i9_passport_number ? `${rec.i9_passport_number} (${rec.i9_passport_country || '?'})` : null);
    L('Authorized to work until', rec.i9_work_until);
    L('Preparer / translator', rec.i9_preparer === 'used' ? rec.i9_preparer_name : 'Did not use');
    L('Employee signature', sig(r.i9_signature));
    if (r.i9_signature) doc.fontSize(8).fillColor('#555').text(I9_S1_ATTESTATION).fillColor('#000').fontSize(10);
    H('Form I-9 Section 2 (Employer Review and Verification)');
    if (r.i9_section2) {
      for (const d of r.i9_section2.documents) L(`List ${d.list}`, `${d.title} · ${d.issuing_authority} · #${d.number}${d.expires ? ` · expires ${d.expires}` : ''}`);
      L("Employee's first day of employment", r.i9_section2.first_day);
      L('Additional information', r.i9_section2.additional_info);
      L('Employer signature', `${r.i9_section2.signed_by}${r.i9_section2.employer_title ? `, ${r.i9_section2.employer_title}` : ''} · ${r.i9_section2.signed_at} · password-verified`);
      doc.fontSize(8).fillColor('#555').text(I9_S2_ATTESTATION).fillColor('#000').fontSize(10);
    } else {
      doc.text('NOT COMPLETED — the employer has not recorded the documents examined.');
    }
    H('Attached files');
    if (!r.files.length) doc.text('None.');
    for (const f of r.files) L({ id_document: 'ID document', voided_check: 'Voided check', other: 'Other' }[f.kind] || f.kind, `${f.filename} · ${f.uploaded_by} · ${f.uploaded_at}`);
    if (r.missing.length) { H('Still missing'); for (const m of r.missing) doc.text(`• ${m.label}`); }
    doc.moveDown(1).fontSize(8).fillColor('#555').text('Signatures were captured electronically in ReadyDoc: the signer typed their legal name under the form\'s own attestation, and the time, network address and device were recorded. Employer signatures are password-verified at the moment of signing. Full SSN and account numbers are held encrypted and are not printed.');
    doc.end();
  } catch (e) {
    // Once the pipe has started there is no sending JSON — truncate this
    // download rather than take the process down (the coa-submission lesson).
    console.error('[onboarding] packet pdf failed:', e.message);
    try { doc.end(); } catch { /* already ended */ }
  }
});

// ── Portal (public, token-gated) ─────────────────────────────────────────────

function byToken(db, token) {
  if (!token || token.length < 16) return null;
  return db.prepare("SELECT * FROM onboarding_records WHERE token_hash = ? AND status NOT IN ('cancelled','completed')").get(sha(token));
}
const portalShape = (db, rec) => {
  const s = shape(db, rec);
  // The employer's examination is not the employee's to read on the link.
  delete s.i9_section2; delete s.notes; delete s.adp_response;
  return { ...s, attestations: { w4: W4_ATTESTATION, i9_s1: I9_S1_ATTESTATION } };
};
const linkGone = (res) => res.status(404).json({ error: 'This link is no longer valid. Ask the office for a new one.' });

// What the wizard renders — job facts included read-only, secrets as flags.
portalRouter.get('/:token', (req, res) => {
  const db = getDb();
  const rec = byToken(db, req.params.token);
  if (!rec) return linkGone(res);
  res.json(portalShape(db, rec));
});

portalRouter.put('/:token', (req, res) => {
  const db = getDb();
  const rec = byToken(db, req.params.token);
  if (!rec) return linkGone(res);
  if (['submitted_to_adp'].includes(rec.status)) return res.status(409).json({ error: 'This onboarding was already submitted — contact the office to correct anything.' });
  const b = req.body || {};
  const out = applyFields(db, rec, b, PORTAL_FIELDS);
  if (out.error) return res.status(400).json({ error: out.error });
  // Signing rides on the same save so the wizard's "sign and continue" is one
  // request; it is checked against the record AFTER the fields landed.
  for (const which of ['w4', 'i9']) {
    if (!b[`${which}_sign`]) continue;
    const fresh = db.prepare('SELECT * FROM onboarding_records WHERE id = ?').get(rec.id);
    const s = signForm(db, fresh, which, b, req);
    if (s.error) return res.status(400).json({ error: s.error });
    logAudit('onboarding-portal', 'sign', 'onboarding', rec.id, { form: which, ip: req.ip || null }, null, null, nameOf(fresh));
  }
  if (rec.status === 'invited') {
    db.prepare("UPDATE onboarding_records SET status = 'in_progress', updated_at = datetime('now') WHERE id = ?").run(rec.id);
  }
  res.json(portalShape(db, db.prepare('SELECT * FROM onboarding_records WHERE id = ?').get(rec.id)));
});

// The pictures: ID documents for the I-9, a voided check for direct deposit.
// The phone's camera opens straight into this from the wizard.
portalRouter.post('/:token/files', uploadFiles, async (req, res) => {
  const files = req.files || [];
  try {
    const db = getDb();
    const rec = byToken(db, req.params.token);
    if (!rec) return linkGone(res);
    if (['submitted_to_adp'].includes(rec.status)) return res.status(409).json({ error: 'This onboarding was already submitted — contact the office.' });
    if (!storageEnabled()) return res.status(503).json({ error: 'Photo upload is not available right now — bring the documents on your first day.' });
    if (!files.length) return res.status(400).json({ error: 'No photo received.' });
    await storeFiles(db, rec, files, req.body?.kind, 'new hire');
    logAudit('onboarding-portal', 'update', 'onboarding', rec.id, { files_added: files.length, kind: req.body?.kind || 'other' }, null, null, nameOf(rec));
    res.json(portalShape(db, rec));
  } finally { cleanupTemp(files); }
});

portalRouter.delete('/:token/files/:fileId', (req, res) => {
  const db = getDb();
  const rec = byToken(db, req.params.token);
  if (!rec) return linkGone(res);
  // Only their own, and only what they uploaded — the office's files are not
  // the new hire's to remove.
  const f = db.prepare("SELECT * FROM onboarding_files WHERE id = ? AND onboarding_id = ? AND uploaded_by = 'new hire'").get(req.params.fileId, rec.id);
  if (!f) return res.status(404).json({ error: 'Not found' });
  db.prepare('DELETE FROM onboarding_files WHERE id = ?').run(f.id);
  if (f.storage_key) deleteObject(f.storage_key);
  res.json(portalShape(db, rec));
});

portalRouter.post('/:token/finish', (req, res) => {
  const db = getDb();
  const rec = byToken(db, req.params.token);
  if (!rec) return linkGone(res);
  const missing = missingToFinish(db, rec);
  if (missing.length) {
    return res.status(400).json({
      error: 'Still needed before finishing: ' + missing.map(m => m.label).join(', '),
      missing,
    });
  }
  db.prepare("UPDATE onboarding_records SET status = 'ready', finished_at = datetime('now'), updated_at = datetime('now') WHERE id = ?").run(rec.id);
  logAudit('onboarding-portal', 'update', 'onboarding', rec.id, { finished: true }, null, null, nameOf(rec));
  res.json({ ok: true });
});

export default router;
