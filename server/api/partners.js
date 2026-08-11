// Partner reconciliation — the Powder Ops ⇄ M4 Dynamics ledger.
//
// Two companies that invoice each other constantly and had stalled because each
// was adding up its own emails. The point of this module is that there is ONE
// ledger, both directions, and one place that turns it into a number.
//
// The arithmetic lives in server/partner-recon.js and is a pure function — the
// number both companies have to trust should be checkable without a server.
// This file is custody: who may upload, who may call a document final, who may
// dispute it, and what happens when someone pays.

import { Router } from 'express';
import { randomUUID as uuid, createHash, randomBytes } from 'crypto';
import { readFileSync } from 'fs';
import { getDb, logAudit } from '../db.js';
import { storageEnabled, putObject, presignGet, deleteObject } from '../storage.js';
import { mediaUpload, cleanupTemp, uploadErrorMessage } from '../media.js';
import { extractInvoiceText } from '../invoice-text.js';
import { reconcile, dueDateFor, endOfMonth, round2 } from '../partner-recon.js';
import { parseInvoice, parseLineItems, summarizeLineItems } from '../invoice-parse.js';

const router = Router();

const docUpload = mediaUpload({ files: 10 }).array('files', 10);
const uploadDocs = (req, res, next) => docUpload(req, res, (err) => {
  if (err) return res.status(413).json({ error: uploadErrorMessage(err) });
  next();
});

/* ── Who may do what ──────────────────────────────────────────────────────── */

// Reading the ledger is open to whoever has the module. Calling a document
// FINAL is an assertion that the work behind it happened, and settling moves
// money — both are office/admin decisions.
const canSettle = (u) => u?.role === 'admin'
  || (u?.role === 'supervisor' && ['office', 'admin'].includes((u?.department || '').toLowerCase()));

const clean = (v, max = 300) => {
  const s = String(v ?? '').trim();
  return s ? s.slice(0, max) : null;
};
const money = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? round2(n) : 0;
};
const isoDay = (v) => {
  const s = String(v ?? '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
};

/* ── Partners ─────────────────────────────────────────────────────────────── */

router.get('/', (_req, res) => {
  const db = getDb();
  res.json(db.prepare('SELECT * FROM partner_accounts WHERE is_active = 1 ORDER BY name').all());
});

router.put('/:id', (req, res) => {
  if (!canSettle(req.user)) return res.status(403).json({ error: 'Only the office or an admin can change partner terms.' });
  const db = getDb();
  const before = db.prepare('SELECT * FROM partner_accounts WHERE id = ?').get(req.params.id);
  if (!before) return res.status(404).json({ error: 'Partner not found' });
  const terms = Number(req.body?.terms_days);
  db.prepare(`UPDATE partner_accounts SET contact_name = ?, contact_email = ?,
      terms_days = ?, notes = ? WHERE id = ?`)
    .run(clean(req.body?.contact_name, 120), clean(req.body?.contact_email, 200),
      Number.isFinite(terms) && terms >= 0 ? Math.floor(terms) : before.terms_days,
      clean(req.body?.notes, 2000), before.id);
  const after = db.prepare('SELECT * FROM partner_accounts WHERE id = ?').get(before.id);
  logAudit(req.user, 'update', 'partner_account', before.id, null, before, after, before.name);
  res.json(after);
});

/* ── Documents ────────────────────────────────────────────────────────────── */

function listDocuments(db, partnerId, q = {}) {
  let sql = 'SELECT * FROM partner_documents WHERE partner_id = ?';
  const params = [partnerId];
  if (q.direction === 'receivable' || q.direction === 'payable') { sql += ' AND direction = ?'; params.push(q.direction); }
  if (q.status) { sql += ' AND status = ?'; params.push(q.status); }
  if (q.doc_type) { sql += ' AND doc_type = ?'; params.push(q.doc_type); }
  if (q.unsettled === '1') sql += ' AND settlement_id IS NULL';
  if (q.settlement_id) { sql += ' AND settlement_id = ?'; params.push(q.settlement_id); }
  if (q.q) {
    // The uploaded PDF's text is searched too, so a lot number printed inside
    // an invoice finds it — not only what somebody keyed into the form.
    sql += ` AND (doc_number LIKE ? OR reference LIKE ? OR description LIKE ?
             OR filename LIKE ? OR line_items LIKE ? OR extracted_text LIKE ?)`;
    const like = `%${q.q}%`;
    params.push(like, like, like, like, like, like);
  }
  sql += ' ORDER BY COALESCE(issued_date, created_at) DESC, created_at DESC LIMIT ?';
  params.push(Math.min(Number(q.limit) || 500, 2000));
  // extracted_text can be tens of kB per row; it is searched, never shipped.
  return db.prepare(sql).all(...params).map(({ extracted_text, ...d }) => {
    const items = safeLines(d.line_items);
    return {
      ...d,
      has_text: !!extracted_text,
      line_items: items,
      // The one-line "what was on it" the table row shows. Built here rather
      // than in the browser so the row and any export say the same thing.
      line_summary: summarizeLineItems(items),
      // Whether the lines add up to the document's amount. Reported, never
      // used to correct either number: a summary that silently disagrees with
      // the total is worse than one that says it is incomplete.
      lines_reconcile: items.length && d.amount != null
        ? Math.abs((d.lines_total ?? 0) - d.amount) < 0.02
        : null,
    };
  });
}

function safeLines(json) {
  if (!json) return [];
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? v.filter(i => i && i.description) : [];
  } catch { return []; }
}

/** Normalize whatever the client sends for line items into storable rows. */
function normalizeLines(raw) {
  const list = Array.isArray(raw) ? raw : [];
  const out = [];
  for (const i of list) {
    const description = clean(i?.description, 300);
    if (!description) continue;
    const num = (v) => (v === '' || v == null || !Number.isFinite(Number(v)) ? null : round2(Number(v)));
    out.push({ description, quantity: num(i?.quantity), unit_price: num(i?.unit_price), amount: num(i?.amount) });
    if (out.length >= 100) break;
  }
  return out;
}
const linesTotalOf = (items) =>
  (items.length ? round2(items.reduce((t, i) => t + (i.amount || 0), 0)) : null);

router.get('/:id/documents', (req, res) => {
  const db = getDb();
  res.json({ documents: listDocuments(db, req.params.id, req.query) });
});

// Create a document, with or without a file. Both paths land here so there is
// one place that computes a due date and one place that audits.
async function createDocument(db, { partnerId, body, files, user, source }) {
  const partner = db.prepare('SELECT * FROM partner_accounts WHERE id = ?').get(partnerId);
  if (!partner) return { error: 'Partner not found', status: 404 };

  const direction = body?.direction === 'payable' ? 'payable' : 'receivable';
  const docType = ['invoice', 'po', 'credit'].includes(body?.doc_type) ? body.doc_type : 'invoice';
  const amount = money(body?.amount);
  const issued = isoDay(body?.issued_date) || new Date().toISOString().slice(0, 10);
  const termsRaw = Number(body?.terms_days);
  const terms = Number.isFinite(termsRaw) && termsRaw >= 0 ? Math.floor(termsRaw) : partner.terms_days;
  const due = isoDay(body?.due_date) || dueDateFor(issued, terms);

  const out = [];
  const list = files?.length ? files : [null];
  for (const f of list) {
    const id = uuid();
    let key = null, text = null;
    if (f) {
      if (!storageEnabled()) return { error: 'File storage is not configured on this server.', status: 503 };
      const buf = readFileSync(f.path);
      const safe = (f.originalname || 'file').replace(/[^\w.-]+/g, '_').slice(0, 120);
      key = `partners/${partnerId}/${id}-${safe}`;
      await putObject(key, buf, f.mimetype);
      // Best effort: a scan that can't be read is still a document worth having.
      try { text = await extractInvoiceText(buf, f.mimetype, f.originalname); } catch { text = null; }
    }
    // What was ON the document. Whatever the caller reviewed wins; failing
    // that, read it from the file here, so a document added through the plain
    // form still gets its summary.
    let lines = normalizeLines(body?.line_items);
    if (!lines.length && text) {
      try { lines = normalizeLines(parseLineItems(text)); } catch { lines = []; }
    }
    db.prepare(`INSERT INTO partner_documents
      (id, partner_id, direction, doc_type, doc_number, reference, description,
       issued_date, terms_days, due_date, amount, status,
       storage_key, filename, content_type, size, extracted_text, line_items, lines_total, source, created_by)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,'draft',?,?,?,?,?,?,?,?,?)`)
      .run(id, partnerId, direction, docType, clean(body?.doc_number, 80), clean(body?.reference, 120),
        clean(body?.description, 1000), issued, terms, due, amount,
        key, f ? (f.originalname || 'file').slice(0, 255) : null, f?.mimetype || null, f?.size || null,
        text ? String(text).slice(0, 400000) : null,
        lines.length ? JSON.stringify(lines) : null, linesTotalOf(lines),
        source, user?.name || null);
    out.push(db.prepare('SELECT id, doc_number, direction, amount, due_date, filename, lines_total FROM partner_documents WHERE id = ?').get(id));
  }
  return { documents: out, partner };
}

/* ── Importing a stack of invoices ────────────────────────────────────────── */
//
// `POST /:id/documents` takes several files but applies ONE set of metadata to
// all of them, so a dozen invoices became a dozen documents with the same
// number and the same amount. That is fine for "here are three pages of one
// invoice" and useless for the actual job: a folder of invoices from the month.
//
// So: scan → review → commit, the same three steps as every other bulk path
// here. SCAN WRITES NOTHING. It reads each file, proposes a row, and says per
// file what it could not find. The person fixes those rows and commits, and the
// commit goes through `createDocument` — the same function the single-document
// form uses, so an imported row cannot exist in a state a typed one could not.
//
// Everything lands as DRAFT, because draft is what "the work behind it
// happened" has not been asserted for yet, and nothing draft touches the
// settlement number.

const NAME_NOISE = /\b(inc|llc|l\.l\.c|ltd|co|corp|company|dynamics)\b\.?/gi;
/** Name fragments a document might print for a company, longest first. */
function nameVariants(name) {
  const full = String(name || '').trim();
  if (!full) return [];
  const short = full.replace(NAME_NOISE, '').replace(/[.,]/g, ' ').replace(/\s+/g, ' ').trim();
  return [...new Set([full, short].filter(s => s.length >= 3))];
}
const OUR_NAMES = ['Powder Ops', 'PowderOps', 'Powder-Ops'];

/**
 * Is this document already on the ledger?
 *
 * The single most damaging thing a re-import can do is add what is already
 * there — the amount owed simply doubles, and it is a plausible number so
 * nobody catches it. Matched on document number + amount within the partner,
 * which is what identifies an invoice; the date is checked too but a document
 * re-issued on a different date with the same number and amount is the same
 * document, not a second one.
 */
function findExistingDoc(db, partnerId, { doc_number, amount }) {
  if (!doc_number || amount == null) return null;
  return db.prepare(
    `SELECT id, doc_number, amount, direction, status, issued_date FROM partner_documents
     WHERE partner_id = ? AND doc_number = ? AND ABS(amount - ?) < 0.005
       AND status != 'void' LIMIT 1`).get(partnerId, String(doc_number), Number(amount)) || null;
}

router.post('/:id/documents/scan', uploadDocs, async (req, res) => {
  const files = req.files || [];
  try {
    const db = getDb();
    const partner = db.prepare('SELECT * FROM partner_accounts WHERE id = ?').get(req.params.id);
    if (!partner) return res.status(404).json({ error: 'Partner not found' });
    if (!files.length) return res.status(400).json({ error: 'No files uploaded' });

    const partnerNames = nameVariants(partner.name);
    const out = [];
    for (const f of files) {
      const row = { filename: f.originalname || 'file', size: f.size || null };
      let text = '';
      try {
        text = await extractInvoiceText(readFileSync(f.path), f.mimetype, f.originalname) || '';
      } catch (e) {
        row.error = `Could not read this file: ${e.message}`;
      }
      // A scan with no text layer is a photograph. Say that, rather than
      // returning empty fields that read as "this invoice is blank".
      if (!row.error && text.replace(/\s/g, '').length < 30) {
        row.readable = false;
        row.message = 'No text could be read from this file — it is an image scan. Its details have to be typed in.';
        row.proposal = { doc_type: 'invoice', direction: null, missing: ['document number', 'date', 'amount', 'direction'] };
        out.push(row);
        continue;
      }
      if (row.error) { row.readable = false; out.push(row); continue; }

      row.readable = true;
      const parsed = parseInvoice(text, { usNames: OUR_NAMES, partnerNames, filename: row.filename });
      // Fall back to the partner's own terms, the same default a typed document
      // gets — but say so, so nobody reads it as something the invoice stated.
      if (parsed.terms_days == null) { parsed.terms_days = partner.terms_days; parsed.terms_from_partner = true; }
      row.proposal = parsed;

      const dup = findExistingDoc(db, partner.id, parsed);
      if (dup) {
        row.duplicate_of = {
          id: dup.id, doc_number: dup.doc_number, amount: dup.amount,
          direction: dup.direction, status: dup.status, issued_date: dup.issued_date,
        };
        row.message = `${dup.doc_number} for ${dup.amount} is already on this ledger (${dup.status}). Importing it again would double what is owed.`;
      }
      out.push(row);
    }

    res.json({
      partner: { id: partner.id, name: partner.name, terms_days: partner.terms_days },
      files: out,
      // Nothing was written. Said explicitly because this endpoint takes an
      // upload, and an upload that changes nothing is worth being clear about.
      written: false,
    });
  } catch (err) {
    res.status(400).json({ error: uploadErrorMessage(err) });
  } finally {
    cleanupTemp(files);
  }
});

/**
 * Commit the reviewed rows.
 *
 * The client re-sends the files alongside a `rows` array — one entry per file,
 * in order — so there is no stash table holding half-imported documents (the
 * same shape as the policy and scanned-test importers).
 *
 * A row may be skipped outright, and a duplicate is skipped unless the person
 * explicitly says otherwise. Each document is created through `createDocument`
 * and audited individually, plus one summary row.
 */
router.post('/:id/documents/import', uploadDocs, async (req, res) => {
  const files = req.files || [];
  try {
    const db = getDb();
    const partner = db.prepare('SELECT * FROM partner_accounts WHERE id = ?').get(req.params.id);
    if (!partner) return res.status(404).json({ error: 'Partner not found' });
    if (!files.length) return res.status(400).json({ error: 'No files uploaded' });

    let rows;
    try { rows = JSON.parse(req.body?.rows || '[]'); } catch { rows = []; }
    if (!Array.isArray(rows) || rows.length !== files.length) {
      return res.status(400).json({ error: 'The reviewed rows do not line up with the files uploaded. Start the import again.' });
    }

    const created = [], skipped = [];
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      const row = rows[i] || {};
      const name = f.originalname || 'file';

      if (row.skip) { skipped.push({ filename: name, reason: 'not selected' }); continue; }
      // A direction is the one field with no safe default: getting it backwards
      // moves the money the wrong way, with a confident number to match.
      if (!['receivable', 'payable'].includes(row.direction)) {
        skipped.push({ filename: name, reason: 'no direction set — say whether they owe us or we owe them' });
        continue;
      }
      if (row.amount == null || !Number.isFinite(Number(row.amount))) {
        skipped.push({ filename: name, reason: 'no amount' });
        continue;
      }
      if (!row.allow_duplicate) {
        const dup = findExistingDoc(db, partner.id, { doc_number: row.doc_number, amount: Number(row.amount) });
        if (dup) { skipped.push({ filename: name, reason: `already on the ledger as ${dup.doc_number}` }); continue; }
      }

      const r = await createDocument(db, {
        partnerId: partner.id, body: row, files: [f], user: req.user, source: 'import',
      });
      if (r.error) { skipped.push({ filename: name, reason: r.error }); continue; }
      const doc = r.documents[0];
      logAudit(req.user, 'create', 'partner_document', doc.id,
        { imported: true, filename: name, direction: row.direction, amount: Number(row.amount), doc_number: row.doc_number },
        null, null, partner.name);
      created.push({ ...doc, filename: name });
    }

    logAudit(req.user, 'import', 'partner_document', null,
      { partner: partner.name, created: created.length, skipped: skipped.length }, null, null, partner.name);
    res.status(201).json({ created, skipped });
  } catch (err) {
    res.status(400).json({ error: uploadErrorMessage(err) });
  } finally {
    cleanupTemp(files);
  }
});

router.post('/:id/documents', uploadDocs, async (req, res) => {
  const files = req.files || [];
  try {
    const db = getDb();
    const r = await createDocument(db, {
      partnerId: req.params.id, body: req.body, files, user: req.user, source: 'internal',
    });
    if (r.error) return res.status(r.status || 400).json({ error: r.error });
    logAudit(req.user, 'create', 'partner_document', r.documents[0]?.id,
      { count: r.documents.length, direction: req.body?.direction }, null, null, r.partner.name);
    res.status(201).json(r.documents);
  } finally {
    cleanupTemp(files);
  }
});

/**
 * Read the line items out of a document already on the ledger.
 *
 * Everything filed before line items existed has a stored PDF and no summary,
 * and re-uploading those invoices to get one would be absurd. This re-reads
 * the text that was already extracted at upload and fills the summary in.
 *
 * It touches ONLY `line_items` — never the amount, the direction, the dates or
 * the status. Those were reviewed by a person when the document was filed, and
 * a re-read months later is not a reason to overwrite them. Allowed on final
 * documents for the same reason: adding a description of what was on an
 * invoice does not change the invoice.
 */
router.post('/documents/:docId/read-lines', (req, res) => {
  const db = getDb();
  const doc = db.prepare('SELECT * FROM partner_documents WHERE id = ?').get(req.params.docId);
  if (!doc) return res.status(404).json({ error: 'Document not found' });
  if (!doc.extracted_text) {
    return res.status(400).json({
      error: doc.storage_key
        ? 'No text was readable from this file — it is an image scan, so its lines have to be typed in.'
        : 'There is no file on this document to read.',
    });
  }
  let lines;
  try { lines = normalizeLines(parseLineItems(doc.extracted_text)); } catch { lines = []; }
  if (!lines.length) {
    return res.status(400).json({ error: 'No line items could be found in this document. They can be typed in instead.' });
  }
  const total = linesTotalOf(lines);
  db.prepare("UPDATE partner_documents SET line_items = ?, lines_total = ?, updated_at = datetime('now'), updated_by = ? WHERE id = ?")
    .run(JSON.stringify(lines), total, req.user?.name || null, doc.id);
  logAudit(req.user, 'update', 'partner_document', doc.id,
    { read_lines: lines.length, lines_total: total }, null, null, doc.doc_number);
  res.json({
    line_items: lines,
    lines_total: total,
    lines_reconcile: doc.amount != null ? Math.abs(total - doc.amount) < 0.02 : null,
  });
});

// Editing is allowed while a document is still draft. Once it is final it is
// part of a number someone may already have looked at, so it changes by dispute
// or by a credit note — not by quietly editing the amount.
router.put('/documents/:docId', (req, res) => {
  const db = getDb();
  const before = db.prepare('SELECT * FROM partner_documents WHERE id = ?').get(req.params.docId);
  if (!before) return res.status(404).json({ error: 'Document not found' });
  if (before.status !== 'draft' && !canSettle(req.user)) {
    return res.status(403).json({ error: 'This document is final. Raise a dispute or a credit note instead of editing it.' });
  }
  if (before.settlement_id) return res.status(400).json({ error: 'This document was part of a settled payment and cannot be changed.' });

  const issued = isoDay(req.body?.issued_date) || before.issued_date;
  const termsRaw = Number(req.body?.terms_days);
  const terms = Number.isFinite(termsRaw) && termsRaw >= 0 ? Math.floor(termsRaw) : before.terms_days;
  // Absent means "leave the lines alone" — an edit to the due date must not
  // wipe the summary of what was on the invoice.
  const lines = req.body?.line_items !== undefined ? normalizeLines(req.body.line_items) : null;
  db.prepare(`UPDATE partner_documents SET doc_number = ?, reference = ?, description = ?,
      issued_date = ?, terms_days = ?, due_date = ?, amount = ?,
      direction = ?, doc_type = ?, line_items = ?, lines_total = ?,
      updated_at = datetime('now'), updated_by = ?
    WHERE id = ?`)
    .run(clean(req.body?.doc_number, 80), clean(req.body?.reference, 120), clean(req.body?.description, 1000),
      issued, terms, isoDay(req.body?.due_date) || dueDateFor(issued, terms),
      req.body?.amount !== undefined ? money(req.body.amount) : before.amount,
      ['receivable', 'payable'].includes(req.body?.direction) ? req.body.direction : before.direction,
      ['invoice', 'po', 'credit'].includes(req.body?.doc_type) ? req.body.doc_type : before.doc_type,
      lines === null ? before.line_items : (lines.length ? JSON.stringify(lines) : null),
      lines === null ? before.lines_total : linesTotalOf(lines),
      req.user?.name || null, before.id);
  const after = db.prepare('SELECT * FROM partner_documents WHERE id = ?').get(before.id);
  logAudit(req.user, 'update', 'partner_document', before.id, null, before, after, after.doc_number || after.id);
  res.json({ ...after, extracted_text: undefined, has_text: !!after.extracted_text });
});

// "Approve as final" — the goods went out, or the production run finished. This
// is what lets a document into the number.
router.post('/documents/:docId/finalize', (req, res) => {
  if (!canSettle(req.user)) return res.status(403).json({ error: 'Only the office or an admin can approve a document as final.' });
  const db = getDb();
  const before = db.prepare('SELECT * FROM partner_documents WHERE id = ?').get(req.params.docId);
  if (!before) return res.status(404).json({ error: 'Document not found' });
  if (before.settlement_id) return res.status(400).json({ error: 'Already settled.' });
  if (!(Number(before.amount) > 0)) return res.status(400).json({ error: 'Put an amount on it before approving it as final.' });

  db.prepare(`UPDATE partner_documents SET status = 'final', finalized_at = datetime('now'),
      finalized_by = ?, disputed_reason = NULL, disputed_at = NULL, disputed_by = NULL WHERE id = ?`)
    .run(req.user?.name || null, before.id);
  const after = db.prepare('SELECT * FROM partner_documents WHERE id = ?').get(before.id);
  logAudit(req.user, 'update', 'partner_document', before.id, { finalized: true }, before, after, after.doc_number || after.id);
  res.json({ ...after, extracted_text: undefined });
});

// A dispute EXCLUDES rather than blocks: one disagreement must not stop the
// other eleven documents settling. The reason travels with it into the report.
router.post('/documents/:docId/dispute', (req, res) => {
  const db = getDb();
  const before = db.prepare('SELECT * FROM partner_documents WHERE id = ?').get(req.params.docId);
  if (!before) return res.status(404).json({ error: 'Document not found' });
  if (before.settlement_id) return res.status(400).json({ error: 'This document was already settled — raise a credit note instead.' });
  const reason = clean(req.body?.reason, 1000);
  if (!reason || reason.length < 3) return res.status(400).json({ error: 'Say what the disagreement is — it goes in the report both sides read.' });

  db.prepare(`UPDATE partner_documents SET status = 'disputed', disputed_reason = ?,
      disputed_at = datetime('now'), disputed_by = ? WHERE id = ?`)
    .run(reason, req.user?.name || null, before.id);
  const after = db.prepare('SELECT * FROM partner_documents WHERE id = ?').get(before.id);
  logAudit(req.user, 'update', 'partner_document', before.id, { disputed: reason }, before, after, after.doc_number || after.id);
  res.json({ ...after, extracted_text: undefined });
});

router.post('/documents/:docId/void', (req, res) => {
  if (!canSettle(req.user)) return res.status(403).json({ error: 'Only the office or an admin can void a document.' });
  const db = getDb();
  const before = db.prepare('SELECT * FROM partner_documents WHERE id = ?').get(req.params.docId);
  if (!before) return res.status(404).json({ error: 'Document not found' });
  if (before.settlement_id) return res.status(400).json({ error: 'This document was part of a settled payment.' });
  db.prepare("UPDATE partner_documents SET status = 'void', updated_at = datetime('now'), updated_by = ? WHERE id = ?")
    .run(req.user?.name || null, before.id);
  logAudit(req.user, 'update', 'partner_document', before.id, { voided: true }, before, null, before.doc_number || before.id);
  res.json({ ok: true });
});

router.get('/documents/:docId/file', async (req, res) => {
  const db = getDb();
  const d = db.prepare('SELECT storage_key, filename FROM partner_documents WHERE id = ?').get(req.params.docId);
  if (!d?.storage_key) return res.status(404).json({ error: 'No file on this document' });
  res.json({ url: await presignGet(d.storage_key, d.filename) });
});

router.delete('/documents/:docId', (req, res) => {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Only an admin can delete a document.' });
  const db = getDb();
  const d = db.prepare('SELECT * FROM partner_documents WHERE id = ?').get(req.params.docId);
  if (!d) return res.status(404).json({ error: 'Document not found' });
  if (d.settlement_id) return res.status(400).json({ error: 'This document is part of a settled payment and is kept as the record of it.' });
  db.prepare('DELETE FROM partner_documents WHERE id = ?').run(d.id);
  if (d.storage_key) deleteObject(d.storage_key);
  logAudit(req.user, 'delete', 'partner_document', d.id, null, d, null, d.doc_number || d.id);
  res.json({ ok: true });
});

/* ── The number ───────────────────────────────────────────────────────────── */

// Everything unsettled, run through the one arithmetic. `as_of` defaults to the
// end of the current month because that is the agreed rhythm.
function currentReconciliation(db, partnerId, asOf) {
  const rows = db.prepare(`SELECT id, direction, doc_type, doc_number, reference, description,
      issued_date, terms_days, due_date, amount, status, disputed_reason, settlement_id, filename
    FROM partner_documents WHERE partner_id = ? AND settlement_id IS NULL AND status != 'void'`).all(partnerId);
  return reconcile(rows, asOf);
}

router.get('/:id/reconcile', (req, res) => {
  const db = getDb();
  const partner = db.prepare('SELECT * FROM partner_accounts WHERE id = ?').get(req.params.id);
  if (!partner) return res.status(404).json({ error: 'Partner not found' });
  const asOf = isoDay(req.query.as_of) || endOfMonth();
  res.json({ partner, ...currentReconciliation(db, partner.id, asOf) });
});

/* ── Settling ─────────────────────────────────────────────────────────────── */

// Settle and pay in one act. A settlement that exists but isn't paid would be a
// third state to explain, and the agreed process is "whoever owes pays that day,
// then we click PAID".
//
// The total is RECOMPUTED here and never taken from the client. If someone
// finalised another invoice while the screen was open, the number moved — and
// paying against a stale figure is exactly the failure this tool exists to
// prevent, so `expected_net` mismatches are refused rather than reconciled.
router.post('/:id/settle', (req, res) => {
  if (!canSettle(req.user)) return res.status(403).json({ error: 'Only the office or an admin can record a settlement.' });
  const db = getDb();
  const partner = db.prepare('SELECT * FROM partner_accounts WHERE id = ?').get(req.params.id);
  if (!partner) return res.status(404).json({ error: 'Partner not found' });

  const asOf = isoDay(req.body?.as_of) || endOfMonth();
  const r = currentReconciliation(db, partner.id, asOf);
  const ids = [...r.documents.receivable, ...r.documents.payable].map(d => d.id);
  if (!ids.length) return res.status(400).json({ error: 'Nothing is due to settle for this period.' });

  if (req.body?.expected_net !== undefined && round2(req.body.expected_net) !== r.net_amount) {
    return res.status(409).json({
      error: 'The balance changed while you were looking at it — review the new number before settling.',
      expected: round2(req.body.expected_net), actual: r.net_amount,
    });
  }

  const id = uuid();
  const tx = db.transaction(() => {
    db.prepare(`INSERT INTO partner_settlements
      (id, partner_id, period_end, receivable_total, payable_total, net_amount, owed_to,
       document_count, status, paid_at, paid_by, payment_reference, notes, created_by)
      VALUES (?,?,?,?,?,?,?,?, 'paid', datetime('now'), ?, ?, ?, ?)`)
      .run(id, partner.id, asOf, r.receivable_total, r.payable_total, r.net_amount, r.owed_to,
        ids.length, req.user?.name || null, clean(req.body?.payment_reference, 200),
        clean(req.body?.notes, 2000), req.user?.name || null);
    const stamp = db.prepare('UPDATE partner_documents SET settlement_id = ? WHERE id = ?');
    for (const docId of ids) stamp.run(id, docId);
  });
  tx();

  const settlement = db.prepare('SELECT * FROM partner_settlements WHERE id = ?').get(id);
  logAudit(req.user, 'create', 'partner_settlement', id, {
    net: r.net_amount, owed_to: r.owed_to, documents: ids.length, period_end: asOf,
  }, null, settlement, `${partner.name} — ${asOf}`);
  res.status(201).json(settlement);
});

router.get('/:id/settlements', (req, res) => {
  const db = getDb();
  res.json(db.prepare(`SELECT * FROM partner_settlements WHERE partner_id = ?
    ORDER BY period_end DESC, created_at DESC LIMIT 200`).all(req.params.id));
});

// What a past settlement was made of — the answer to "how did we get to that
// number", months later.
router.get('/settlements/:settlementId', (req, res) => {
  const db = getDb();
  const s = db.prepare('SELECT * FROM partner_settlements WHERE id = ?').get(req.params.settlementId);
  if (!s) return res.status(404).json({ error: 'Settlement not found' });
  const docs = listDocuments(db, s.partner_id, { settlement_id: s.id, limit: 2000 });
  res.json({ settlement: s, documents: docs });
});

/* ── Partner portal links ─────────────────────────────────────────────────── */

const hashToken = (t) => createHash('sha256').update(String(t)).digest('hex');

router.get('/:id/portal-tokens', (req, res) => {
  if (!canSettle(req.user)) return res.status(403).json({ error: 'Not allowed.' });
  const db = getDb();
  res.json(db.prepare(`SELECT id, label, created_at, created_by, expires_at, revoked_at, last_used_at
    FROM partner_portal_tokens WHERE partner_id = ? ORDER BY created_at DESC`).all(req.params.id));
});

// The clear-text token is returned EXACTLY ONCE, at creation. Only its hash is
// stored, so a leaked database is not a set of working partner links.
router.post('/:id/portal-tokens', (req, res) => {
  if (!canSettle(req.user)) return res.status(403).json({ error: 'Only the office or an admin can create a partner link.' });
  const db = getDb();
  const partner = db.prepare('SELECT * FROM partner_accounts WHERE id = ?').get(req.params.id);
  if (!partner) return res.status(404).json({ error: 'Partner not found' });
  const token = randomBytes(32).toString('hex');
  const id = uuid();
  db.prepare(`INSERT INTO partner_portal_tokens (id, partner_id, token_hash, label, created_by, expires_at)
    VALUES (?,?,?,?,?,?)`)
    .run(id, partner.id, hashToken(token), clean(req.body?.label, 120), req.user?.name || null,
      isoDay(req.body?.expires_at));
  logAudit(req.user, 'create', 'partner_portal_token', id, { label: req.body?.label }, null, null, partner.name);
  res.status(201).json({ id, token });
});

router.delete('/portal-tokens/:tokenId', (req, res) => {
  if (!canSettle(req.user)) return res.status(403).json({ error: 'Not allowed.' });
  const db = getDb();
  const t = db.prepare('SELECT * FROM partner_portal_tokens WHERE id = ?').get(req.params.tokenId);
  if (!t) return res.status(404).json({ error: 'Not found' });
  db.prepare("UPDATE partner_portal_tokens SET revoked_at = datetime('now') WHERE id = ?").run(t.id);
  logAudit(req.user, 'update', 'partner_portal_token', t.id, { revoked: true }, t, null, t.label || t.id);
  res.json({ ok: true });
});

export { createDocument, currentReconciliation, hashToken };
export default router;
