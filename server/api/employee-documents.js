// Documents sent to an existing employee to fill in and sign — a W-4 for a
// withholding change, a W-9, a policy acknowledgement — and the signed copy
// kept against that person.
//
// TWO DOORS, and they are different people.
//   The OFFICE (admin, or the onboarding grant held in the office / HR / admin
//   departments — the same door as the SSN reveal) keeps templates, sends
//   documents, watches what is outstanding and reads the signed copies.
//   THE EMPLOYEE sees only what was sent to THEM, from any account that can
//   sign in — no module grant, because the person being asked to sign a W-4 is
//   very often an operator with nothing but Messages. So this router is
//   mounted WITHOUT requireModuleWrite (the AP Drop arrangement) and decides
//   for itself, per route, which door the caller came through.
//
// The employee signs by drawing (SignaturePad), typing the name on their
// account, ticking the statement, and confirming their password — the same
// gate a QA signature goes through. The server fills the PDF's own fields with
// what they answered, flattens it, appends the signature record page, stores
// the result and never rewrites it. A correction is a new request.
//
// Nothing here asks for a secret. A W-4 carries an SSN; the employee types it
// into the IRS form's own field and it lands, flattened, in the signed PDF —
// which is exactly where a paper W-4 carries it — and the answers are NOT
// copied into `values_json` for any field whose label names an SSN or a
// taxpayer number.
import { Router } from 'express';
import { randomUUID as uuid } from 'crypto';
import { readFileSync } from 'fs';
import { getDb, logAudit } from '../db.js';
import { hasExplicitGrant } from '../module-access.js';
import { readyDocOrigin } from '../links.js';
import { storageEnabled, putObject, presignGet, getObjectBuffer } from '../storage.js';
import { mediaUpload, cleanupTemp, uploadErrorMessage } from '../media.js';
import { gateSignature, signatureEvidence } from '../signature.js';
import { botDm, postMessageAs } from './comms.js';
import { pushToUser } from '../push.js';
import { readFields, signPdf, sha256, ATTESTATION } from '../employee-documents.js';

export const router = Router();

export const KINDS = [
  ['w4', 'Form W-4 (withholding)'],
  ['w9', 'Form W-9'],
  ['i9', 'Form I-9'],
  ['policy', 'Policy acknowledgement'],
  ['other', 'Other'],
];
const KIND_IDS = new Set(KINDS.map(k => k[0]));

// The office door. Deliberately the SAME predicate as the onboarding reveal:
// a warehouse supervisor holding the onboarding grant to hand out links must
// not be able to read the plant's W-4s.
export const canManage = (u) => u?.role === 'admin'
  || (hasExplicitGrant(u, 'onboarding') && ['office', 'hr', 'admin'].includes((u?.department || '').toLowerCase()));

const SECRET_LABEL = /\b(ssn|social security|taxpayer|tin\b|ein\b|itin|routing|account number)/i;

const fileUpload = mediaUpload({ files: 1, maxBytes: 25 * 1024 * 1024 }).single('file');
const upload = (req, res, next) => fileUpload(req, res, (err) => {
  if (err) return res.status(400).json({ error: uploadErrorMessage(err, 25 * 1024 * 1024) });
  next();
});

const parseJson = (s, d = null) => { try { return s == null ? d : (typeof s === 'string' ? JSON.parse(s) : s); } catch { return d; } };
const safeName = (s) => String(s || 'document.pdf').replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 80);
const isPdf = (f) => /pdf$/i.test(f?.mimetype || '') || /\.pdf$/i.test(f?.originalname || '');

function shapeTemplate(t) {
  return { id: t.id, title: t.title, kind: t.kind, instructions: t.instructions, filename: t.filename, size: t.size,
    field_count: t.field_count, uploaded_by: t.uploaded_by, uploaded_at: t.uploaded_at, retired_at: t.retired_at, one_off: !!t.one_off };
}

function shape(db, r, { withUrls = false } = {}) {
  const u = db.prepare('SELECT name, username, department FROM users WHERE id = ?').get(r.user_id) || {};
  const t = r.template_id ? db.prepare('SELECT filename, storage_key FROM employee_document_templates WHERE id = ?').get(r.template_id) : null;
  return {
    id: r.id, user_id: r.user_id, employee_name: u.name || r.user_id, employee_username: u.username || null, department: u.department || null,
    template_id: r.template_id, title: r.title, kind: r.kind, kind_label: (KINDS.find(k => k[0] === r.kind) || [])[1] || r.kind,
    instructions: r.instructions, status: r.status, due_date: r.due_date,
    sent_by: r.sent_by, sent_at: r.sent_at, opened_at: r.opened_at, last_nudge_at: r.last_nudge_at,
    signed_at: r.signed_at, signature: parseJson(r.signature), signed_filename: r.signed_filename, signed_size: r.signed_size,
    signed_sha256: r.signed_sha256, source_sha256: r.source_sha256, source_filename: t?.filename || null,
    declined_reason: r.declined_reason, declined_at: r.declined_at,
    cancelled_reason: r.cancelled_reason, cancelled_at: r.cancelled_at, cancelled_by: r.cancelled_by,
    overdue: !!(r.status === 'pending' && r.due_date && r.due_date < new Date().toISOString().slice(0, 10)),
    ...(withUrls ? { _source_key: t?.storage_key || null } : {}),
  };
}

const activePerson = (db, id) => db.prepare("SELECT id, name, username, department, role FROM users WHERE id = ? AND is_active = 1 AND role != 'auditor'").get(id);

// ── ReadyBot ──────────────────────────────────────────────────────────────────
async function tellEmployee(db, row, { reminder = false } = {}) {
  const sentDays = Math.floor((Date.now() - new Date(row.sent_at.replace(' ', 'T') + 'Z')) / 86400000);
  const link = `${readyDocOrigin()}/?sign=${row.id}`;
  const due = row.due_date ? ` Please sign by ${row.due_date}.` : '';
  const body = reminder
    ? `⏳ Still waiting: *${row.title}* was sent to you to sign ${sentDays} day${sentDays === 1 ? '' : 's'} ago.${due}\nOpen it from "Documents to sign" in ReadyDoc, or here: ${link}`
    : `✍️ *${row.sent_by || 'The office'}* has sent you a document to fill in and sign: *${row.title}*.${due}\n${row.instructions ? `${row.instructions}\n` : ''}It stays under "Documents to sign" until you have signed it: ${link}`;
  try {
    const { bot, dm } = botDm(db, row.user_id);
    await postMessageAs(db, dm, bot, body);
    pushToUser(row.user_id, { title: reminder ? 'Still waiting for your signature' : 'A document to sign', body: row.title, tag: `employee-doc-${row.id}`, url: `/?sign=${row.id}` }).catch(() => {});
    return true;
  } catch { return false; }
}

function officeWatchers(db, row) {
  const rows = db.prepare(`SELECT id, name, role, department FROM users WHERE is_active = 1 AND role != 'auditor' AND name != 'ReadyBot'`).all();
  return rows.filter(u => u.id !== row.user_id && (u.id === row.sent_by_id || u.role === 'admin' || ['office', 'hr'].includes((u.department || '').toLowerCase())));
}

async function tellOffice(db, row, what) {
  const who = db.prepare('SELECT name FROM users WHERE id = ?').get(row.user_id)?.name || row.user_id;
  const link = `${readyDocOrigin()}/?tab=onboarding&view=documents`;
  const body = what === 'signed'
    ? `✅ *${who}* has signed *${row.title}*. The signed copy is in Onboarding → Employee documents.\n${link}`
    : `⚠️ *${who}* declined to sign *${row.title}*${row.declined_reason ? `: "${row.declined_reason}"` : '.'}\n${link}`;
  for (const w of officeWatchers(db, row)) {
    try {
      const { bot, dm } = botDm(db, w.id);
      await postMessageAs(db, dm, bot, body);
      pushToUser(w.id, { title: what === 'signed' ? 'Document signed' : 'Document declined', body: `${who} — ${row.title}`, tag: `employee-doc-office-${row.id}`, url: '/?tab=onboarding&view=documents' }).catch(() => {});
    } catch { /* one unreachable watcher must not stop the others */ }
  }
}

/** Every other day: chase what has sat unsigned for two days or more. Called from scheduled-jobs. */
export async function employeeDocumentNudges(db) {
  const rows = db.prepare(`SELECT * FROM employee_documents WHERE status = 'pending'
    AND sent_at <= datetime('now', '-2 days') AND (last_nudge_at IS NULL OR last_nudge_at <= datetime('now', '-2 days'))`).all();
  let sent = 0;
  for (const r of rows) {
    try {
      if (await tellEmployee(db, r, { reminder: true })) {
        db.prepare("UPDATE employee_documents SET last_nudge_at = datetime('now') WHERE id = ?").run(r.id);
        sent++;
      }
    } catch { /* one bad DM must not stop the rest */ }
  }
  return { pending: rows.length, sent };
}

// ── The employee's own ────────────────────────────────────────────────────────
router.get('/mine', (req, res) => {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM employee_documents WHERE user_id = ? ORDER BY CASE status WHEN \'pending\' THEN 0 ELSE 1 END, sent_at DESC LIMIT 200').all(req.user.id);
  const shaped = rows.map(r => shape(db, r));
  res.json({ pending: shaped.filter(r => r.status === 'pending'), done: shaped.filter(r => r.status !== 'pending'), attestation: ATTESTATION, signer_name: req.user.name });
});

// ── The office ────────────────────────────────────────────────────────────────
router.get('/', (req, res) => {
  if (!canManage(req.user)) return res.status(403).json({ error: 'Employee documents are kept by the office. This needs the Onboarding module in an office, HR or admin department.' });
  const db = getDb();
  const status = String(req.query.status || '');
  const userId = String(req.query.user_id || '');
  const where = ['1=1']; const params = [];
  if (status) { where.push('status = ?'); params.push(status); }
  if (userId) { where.push('user_id = ?'); params.push(userId); }
  const rows = db.prepare(`SELECT * FROM employee_documents WHERE ${where.join(' AND ')} ORDER BY CASE status WHEN 'pending' THEN 0 ELSE 1 END, sent_at DESC LIMIT 500`).all(...params);
  const templates = db.prepare('SELECT * FROM employee_document_templates WHERE one_off = 0 ORDER BY retired_at IS NOT NULL, title').all();
  const people = db.prepare(`SELECT id, name, username, department, role FROM users WHERE is_active = 1 AND role != 'auditor' AND name != 'ReadyBot' ORDER BY name`).all();
  const counts = db.prepare(`SELECT status, COUNT(*) AS n FROM employee_documents GROUP BY status`).all();
  res.json({
    requests: rows.map(r => shape(db, r)),
    templates: templates.map(shapeTemplate),
    people, kinds: KINDS, storage_enabled: storageEnabled(), can_manage: true,
    counts: Object.fromEntries(counts.map(c => [c.status, c.n])),
  });
});

router.post('/templates', upload, async (req, res) => {
  const f = req.file;
  try {
    if (!canManage(req.user)) return res.status(403).json({ error: 'Only the office keeps document templates.' });
    if (!storageEnabled()) return res.status(503).json({ error: 'File storage is not configured on this server.' });
    if (!f) return res.status(400).json({ error: 'Attach the PDF to keep as a template.' });
    if (!isPdf(f)) return res.status(400).json({ error: 'Templates are PDFs. Export the document as PDF first.' });
    const title = String(req.body?.title || '').trim() || f.originalname.replace(/\.pdf$/i, '');
    const kind = KIND_IDS.has(req.body?.kind) ? req.body.kind : 'other';
    const buf = readFileSync(f.path);
    const fields = await readFields(buf);
    const id = uuid();
    const key = `employee-documents/templates/${id}-${safeName(f.originalname)}`;
    await putObject(key, buf, 'application/pdf');
    getDb().prepare(`INSERT INTO employee_document_templates (id, title, kind, instructions, storage_key, filename, content_type, size, sha256, field_count, uploaded_by)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(id, title, kind, String(req.body?.instructions || '').trim() || null, key, f.originalname, 'application/pdf', f.size, sha256(buf), fields.length, req.user.name);
    logAudit(req.user, 'create', 'employee_document_template', id, { title, kind, field_count: fields.length, filename: f.originalname }, null, null, title);
    res.status(201).json({ ...shapeTemplate(getDb().prepare('SELECT * FROM employee_document_templates WHERE id = ?').get(id)), fields });
  } finally { cleanupTemp(f ? [f] : []); }
});

router.get('/templates/:id/fields', async (req, res) => {
  if (!canManage(req.user)) return res.status(403).json({ error: 'Only the office reads templates.' });
  const t = getDb().prepare('SELECT * FROM employee_document_templates WHERE id = ?').get(req.params.id);
  if (!t) return res.status(404).json({ error: 'Not found' });
  const buf = await getObjectBuffer(t.storage_key);
  if (!buf) return res.status(503).json({ error: 'The file could not be read from storage.' });
  res.json({ fields: await readFields(buf), url: await presignGet(t.storage_key, t.filename) });
});

// Retire, never delete: a signed request points at it.
router.delete('/templates/:id', (req, res) => {
  if (!canManage(req.user)) return res.status(403).json({ error: 'Only the office keeps document templates.' });
  const db = getDb();
  const t = db.prepare('SELECT * FROM employee_document_templates WHERE id = ?').get(req.params.id);
  if (!t) return res.status(404).json({ error: 'Not found' });
  db.prepare("UPDATE employee_document_templates SET retired_at = datetime('now'), retired_by = ? WHERE id = ?").run(req.user.name, t.id);
  logAudit(req.user, 'retire', 'employee_document_template', t.id, {}, null, null, t.title);
  res.json({ ok: true });
});

/**
 * Send one document to one or more people. JSON with `template_id`, or
 * multipart with a one-off `file`. One request row per person; each is told.
 */
router.post('/send', upload, async (req, res) => {
  const f = req.file;
  try {
    if (!canManage(req.user)) return res.status(403).json({ error: 'Only the office sends documents to sign.' });
    const db = getDb();
    const b = req.body || {};
    const ids = [...new Set((parseJson(b.user_ids, []) || []).map(String).filter(Boolean))];
    if (!ids.length) return res.status(400).json({ error: 'Choose at least one person.' });
    const people = ids.map(id => activePerson(db, id));
    const missing = ids.filter((id, i) => !people[i]);
    if (missing.length) return res.status(400).json({ error: 'One of the people chosen is not an active account.' });
    if (ids.includes(req.user.id) && ids.length === 1 && req.user.role !== 'admin') return res.status(400).json({ error: 'Send it to somebody else; you cannot send a document to yourself.' });
    const dueDate = String(b.due_date || '').trim() || null;
    if (dueDate && !/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) return res.status(400).json({ error: 'The due date must be a date.' });

    let template = b.template_id ? db.prepare('SELECT * FROM employee_document_templates WHERE id = ?').get(String(b.template_id)) : null;
    if (b.template_id && !template) return res.status(404).json({ error: 'That template no longer exists.' });
    if (template?.retired_at) return res.status(409).json({ error: 'That template has been retired. Upload the current version.' });
    if (!template) {
      if (!f) return res.status(400).json({ error: 'Choose a template or attach a PDF.' });
      if (!storageEnabled()) return res.status(503).json({ error: 'File storage is not configured on this server.' });
      if (!isPdf(f)) return res.status(400).json({ error: 'Only a PDF can be sent to sign. Export the document as PDF first.' });
      const buf = readFileSync(f.path);
      const fields = await readFields(buf);
      const id = uuid();
      const key = `employee-documents/templates/${id}-${safeName(f.originalname)}`;
      await putObject(key, buf, 'application/pdf');
      db.prepare(`INSERT INTO employee_document_templates (id, title, kind, instructions, storage_key, filename, content_type, size, sha256, field_count, one_off, uploaded_by)
        VALUES (?,?,?,?,?,?,?,?,?,?,1,?)`).run(id, String(b.title || '').trim() || f.originalname.replace(/\.pdf$/i, ''), KIND_IDS.has(b.kind) ? b.kind : 'other',
        null, key, f.originalname, 'application/pdf', f.size, sha256(buf), fields.length, req.user.name);
      template = db.prepare('SELECT * FROM employee_document_templates WHERE id = ?').get(id);
    }
    const title = String(b.title || '').trim() || template.title;
    const kind = KIND_IDS.has(b.kind) ? b.kind : template.kind;
    const instructions = String(b.instructions ?? template.instructions ?? '').trim() || null;

    const created = [];
    const insert = db.prepare(`INSERT INTO employee_documents (id, user_id, template_id, title, kind, instructions, due_date, sent_by, sent_by_id, source_sha256)
      VALUES (?,?,?,?,?,?,?,?,?,?)`);
    db.transaction(() => {
      for (const p of people) {
        const id = uuid();
        insert.run(id, p.id, template.id, title, kind, instructions, dueDate, req.user.name, req.user.id, template.sha256);
        created.push(id);
        logAudit(req.user, 'create', 'employee_document', id, { to: p.name, to_id: p.id, title, kind, template_id: template.id, due_date: dueDate }, null, null, `${title} → ${p.name}`);
      }
    })();
    const rows = created.map(id => db.prepare('SELECT * FROM employee_documents WHERE id = ?').get(id));
    // Told after the rows are committed, and a comms outage never fails a send
    // that is already on the record — the list is the record; the DM is the knock.
    const told = [];
    for (const r of rows) { if (await tellEmployee(db, r)) told.push(r.user_id); }
    res.status(201).json({ requests: rows.map(r => shape(db, r)), told: told.length });
  } finally { cleanupTemp(f ? [f] : []); }
});

router.post('/:id/remind', async (req, res) => {
  if (!canManage(req.user)) return res.status(403).json({ error: 'Only the office sends reminders.' });
  const db = getDb();
  const r = db.prepare('SELECT * FROM employee_documents WHERE id = ?').get(req.params.id);
  if (!r) return res.status(404).json({ error: 'Not found' });
  if (r.status !== 'pending') return res.status(409).json({ error: `This document is ${r.status}; there is nothing to remind about.` });
  const ok = await tellEmployee(db, r, { reminder: true });
  if (ok) db.prepare("UPDATE employee_documents SET last_nudge_at = datetime('now') WHERE id = ?").run(r.id);
  logAudit(req.user, 'remind', 'employee_document', r.id, { sent: ok }, null, null, r.title);
  res.json({ ok, ...shape(db, db.prepare('SELECT * FROM employee_documents WHERE id = ?').get(r.id)) });
});

router.post('/:id/cancel', (req, res) => {
  if (!canManage(req.user)) return res.status(403).json({ error: 'Only the office withdraws a request.' });
  const db = getDb();
  const r = db.prepare('SELECT * FROM employee_documents WHERE id = ?').get(req.params.id);
  if (!r) return res.status(404).json({ error: 'Not found' });
  if (r.status !== 'pending') return res.status(409).json({ error: `This document is already ${r.status}.` });
  const reason = String(req.body?.reason || '').trim();
  if (reason.length < 3) return res.status(400).json({ error: 'Say why it is being withdrawn (a few words).' });
  db.prepare("UPDATE employee_documents SET status = 'cancelled', cancelled_reason = ?, cancelled_at = datetime('now'), cancelled_by = ? WHERE id = ?").run(reason, req.user.name, r.id);
  logAudit(req.user, 'cancel', 'employee_document', r.id, { reason }, r, null, r.title);
  res.json(shape(db, db.prepare('SELECT * FROM employee_documents WHERE id = ?').get(r.id)));
});

// ── One request: the employee it was sent to, or the office ─────────────────
function loadFor(req, res) {
  const db = getDb();
  const r = db.prepare('SELECT * FROM employee_documents WHERE id = ?').get(req.params.id);
  if (!r) { res.status(404).json({ error: 'Not found' }); return null; }
  const mine = r.user_id === req.user.id;
  if (!mine && !canManage(req.user)) { res.status(404).json({ error: 'Not found' }); return null; }
  return { db, r, mine };
}

router.get('/:id', async (req, res) => {
  const ctx = loadFor(req, res); if (!ctx) return;
  const { db, r, mine } = ctx;
  const t = r.template_id ? db.prepare('SELECT * FROM employee_document_templates WHERE id = ?').get(r.template_id) : null;
  if (mine && r.status === 'pending' && !r.opened_at) db.prepare("UPDATE employee_documents SET opened_at = datetime('now') WHERE id = ?").run(r.id);
  let fields = [];
  if (r.status === 'pending' && t) {
    const buf = await getObjectBuffer(t.storage_key);
    if (buf) fields = await readFields(buf);
  }
  res.json({
    ...shape(db, db.prepare('SELECT * FROM employee_documents WHERE id = ?').get(r.id)),
    fields,
    source_url: t ? await presignGet(t.storage_key, t.filename) : null,
    signed_url: r.signed_key ? await presignGet(r.signed_key, r.signed_filename) : null,
    attestation: ATTESTATION,
    signer_name: mine ? req.user.name : (db.prepare('SELECT name FROM users WHERE id = ?').get(r.user_id)?.name || null),
    can_sign: mine && r.status === 'pending',
  });
});

// The bytes through our own origin, for a Download button (a plain <a href>
// cannot carry the session).
router.get('/:id/signed', async (req, res) => {
  const ctx = loadFor(req, res); if (!ctx) return;
  const { r } = ctx;
  if (!r.signed_key) return res.status(404).json({ error: 'Not signed yet.' });
  const buf = await getObjectBuffer(r.signed_key);
  if (!buf) return res.status(503).json({ error: 'The signed file could not be read from storage.' });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${(r.signed_filename || 'signed.pdf').replace(/"/g, '')}"`);
  res.send(buf);
});

/**
 * The signature. Name must be the name on the account, the statement must be
 * ticked, a signature must be drawn, and the password confirmed — checked in
 * that order, and ALL before anything is written or generated.
 */
router.post('/:id/sign', async (req, res) => {
  const ctx = loadFor(req, res); if (!ctx) return;
  const { db, r, mine } = ctx;
  if (!mine) return res.status(403).json({ error: 'Only the person it was sent to can sign this document.' });
  if (r.status !== 'pending') return res.status(409).json({ error: `This document is ${r.status}.` });
  const b = req.body || {};
  const name = String(b.signed_name || '').trim();
  const norm = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
  if (!name) return res.status(400).json({ error: 'Type your full name to sign.' });
  if (norm(name) !== norm(req.user.name)) return res.status(400).json({ error: `The signature must be the name on your account (${req.user.name}).` });
  if (!b.attest) return res.status(400).json({ error: 'Read the statement and tick the box to sign.' });
  // THE PNG IS CHECKED BY ITS BYTES, NOT BY ITS LENGTH. A drawn signature is a
  // few kilobytes, but "long enough" is not a test of anything — the thing that
  // must be true is that it is a PNG this server can embed, so it is decoded
  // and its header read. Anything else lands as an unreadable box on a tax form.
  const image = String(b.signature_image || '');
  const png = (() => {
    const m = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(image);
    if (!m) return null;
    const buf = Buffer.from(m[1], 'base64');
    const MAGIC = Buffer.from('89504e470d0a1a0a', 'hex');
    return buf.length >= 40 && buf.subarray(0, 8).equals(MAGIC) ? buf : null;
  })();
  if (!png) return res.status(400).json({ error: 'Draw your signature in the box.' });
  if (png.length > 2_000_000) return res.status(400).json({ error: 'The signature image is too large.' });
  const values = (b.values && typeof b.values === 'object' && !Array.isArray(b.values)) ? b.values : {};
  if (!gateSignature(req, res, { action: 'employee_document_sign' })) return;
  if (!storageEnabled()) return res.status(503).json({ error: 'File storage is not configured on this server, so nothing can be signed right now.' });

  const t = db.prepare('SELECT * FROM employee_document_templates WHERE id = ?').get(r.template_id);
  const buf = t ? await getObjectBuffer(t.storage_key) : null;
  if (!buf) return res.status(503).json({ error: 'The document could not be read from storage.' });
  if (r.source_sha256 && sha256(buf) !== r.source_sha256) return res.status(409).json({ error: 'The file on record is not the one that was sent. Ask the office to send it again.' });

  const username = db.prepare('SELECT username FROM users WHERE id = ?').get(req.user.id)?.username || null;
  const at = new Date().toISOString();
  const evidence = { at, ip: req.ip || null, ua: String(req.headers['user-agent'] || '').slice(0, 200), verified: true };
  const out = await signPdf(buf, {
    values, signatureImage: image,
    signer: { name, username, id: req.user.id },
    evidence,
    document: { title: r.title, filename: t.filename, sent_by: r.sent_by, sent_at: r.sent_at, request_id: r.id },
  });
  if (out.errors.length) return res.status(400).json({ error: out.errors[0], errors: out.errors });

  const fields = await readFields(buf);
  // What is kept beside the record: the answers for the office to read on
  // screen, MINUS anything whose label names a secret. Those live only in the
  // signed PDF, which is where a paper form would carry them.
  const keep = {};
  for (const f of fields) {
    if (!(f.name in values)) continue;
    if (SECRET_LABEL.test(f.label || '') || SECRET_LABEL.test(f.name)) continue;
    keep[f.label || f.name] = values[f.name];
  }
  const signedName = `${safeName((t.filename || r.title).replace(/\.pdf$/i, ''))}-signed-${(username || req.user.name).replace(/[^A-Za-z0-9]+/g, '_')}.pdf`;
  const key = `employee-documents/${r.user_id}/${r.id}-signed.pdf`;
  await putObject(key, Buffer.from(out.bytes), 'application/pdf');
  const sig = { name, at, ip: evidence.ip, ua: evidence.ua, attestation: ATTESTATION, verified: true };
  db.prepare(`UPDATE employee_documents SET status = 'signed', signed_at = ?, signature = ?, signature_image = ?, values_json = ?,
    signed_key = ?, signed_filename = ?, signed_size = ?, signed_sha256 = ? WHERE id = ? AND status = 'pending'`)
    .run(at, JSON.stringify(sig), image, JSON.stringify(keep), key, signedName, out.bytes.length, sha256(Buffer.from(out.bytes)), r.id);
  logAudit(req.user, 'sign', 'employee_document', r.id, { ...signatureEvidence(), signed_as: name, pages: out.pages, fields_answered: Object.keys(values).length, source_sha256: out.source_sha256 }, null, null, r.title);
  const fresh = db.prepare('SELECT * FROM employee_documents WHERE id = ?').get(r.id);
  tellOffice(db, fresh, 'signed').catch(() => {});
  res.json({ ...shape(db, fresh), signed_url: await presignGet(key, signedName) });
});

router.post('/:id/decline', (req, res) => {
  const ctx = loadFor(req, res); if (!ctx) return;
  const { db, r, mine } = ctx;
  if (!mine) return res.status(403).json({ error: 'Only the person it was sent to can decline it.' });
  if (r.status !== 'pending') return res.status(409).json({ error: `This document is ${r.status}.` });
  const reason = String(req.body?.reason || '').trim();
  if (reason.length < 3) return res.status(400).json({ error: 'Tell the office why, in a few words, so they can sort it out.' });
  db.prepare("UPDATE employee_documents SET status = 'declined', declined_reason = ?, declined_at = datetime('now') WHERE id = ?").run(reason, r.id);
  logAudit(req.user, 'decline', 'employee_document', r.id, { reason }, null, null, r.title);
  const fresh = db.prepare('SELECT * FROM employee_documents WHERE id = ?').get(r.id);
  tellOffice(db, fresh, 'declined').catch(() => {});
  res.json(shape(db, fresh));
});

export default router;
