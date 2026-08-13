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
import { reconcile, applyCredit, dueDateFor, endOfMonth, round2 } from '../partner-recon.js';
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

// WHAT A DOCUMENT IS FOR, as opposed to what kind of document it is. Only these
// are accepted; anything else stores NULL, because a typo'd category that
// happened to read "manufacturing" would draw on a credit facility.
const CATEGORIES = ['manufacturing', 'materials', 'freight', 'other'];

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

/**
 * What is still missing before this ledger is fit to show the other company.
 *
 * Deliberately counted over the WHOLE ledger, ignoring the caller's search and
 * direction filter. "Am I ready to share the link" is a question about the
 * ledger, not about whatever is on screen — a readiness number that fell to
 * zero because somebody typed in the search box would be worse than none.
 *
 * Void documents are excluded from all three: a voided row is a decision
 * already made and is not a gap to close.
 */
function documentGaps(db, partnerId) {
  const row = db.prepare(`
    SELECT
      COUNT(*) total,
      -- An invoice with nothing behind it. The other company is being asked to
      -- agree a number against a row somebody typed.
      SUM(CASE WHEN storage_key IS NULL THEN 1 ELSE 0 END) no_file,
      -- Draft counts toward nothing, so it is invisible in the balance both
      -- sides are settling against.
      SUM(CASE WHEN status = 'draft' THEN 1 ELSE 0 END) draft,
      -- No category means the credit cannot absorb it, whatever it is for.
      SUM(CASE WHEN category IS NULL OR category = '' THEN 1 ELSE 0 END) uncategorised
    FROM partner_documents
    WHERE partner_id = ? AND status != 'void'`).get(partnerId);
  return {
    total: row?.total || 0,
    no_file: row?.no_file || 0,
    draft: row?.draft || 0,
    uncategorised: row?.uncategorised || 0,
  };
}

router.get('/:id/documents', (req, res) => {
  const db = getDb();
  res.json({
    documents: listDocuments(db, req.params.id, req.query),
    gaps: documentGaps(db, req.params.id),
  });
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
       issued_date, terms_days, due_date, amount, status, category,
       storage_key, filename, content_type, size, extracted_text, line_items, lines_total, source, created_by)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,'draft',?,?,?,?,?,?,?,?,?,?)`)
      .run(id, partnerId, direction, docType, clean(body?.doc_number, 80), clean(body?.reference, 120),
        clean(body?.description, 1000), issued, terms, due, amount,
        // Set at CREATION as well as on edit. A category that could only be
        // added afterwards means every document arrives outside the credit and
        // somebody has to remember to go back — which is how a $200,000
        // facility quietly never gets used.
        CATEGORIES.includes(body?.category) ? body.category : null,
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
  // Absent means leave it — an edit to the due date must not silently
  // un-categorise a document and drop it out of the credit.
  const category = req.body?.category === undefined
    ? before.category
    : (CATEGORIES.includes(req.body.category) ? req.body.category : null);
  db.prepare(`UPDATE partner_documents SET doc_number = ?, reference = ?, description = ?,
      issued_date = ?, terms_days = ?, due_date = ?, amount = ?,
      direction = ?, doc_type = ?, line_items = ?, lines_total = ?, category = ?,
      updated_at = datetime('now'), updated_by = ?
    WHERE id = ?`)
    .run(clean(req.body?.doc_number, 80), clean(req.body?.reference, 120), clean(req.body?.description, 1000),
      issued, terms, isoDay(req.body?.due_date) || dueDateFor(issued, terms),
      req.body?.amount !== undefined ? money(req.body.amount) : before.amount,
      ['receivable', 'payable'].includes(req.body?.direction) ? req.body.direction : before.direction,
      ['invoice', 'po', 'credit'].includes(req.body?.doc_type) ? req.body.doc_type : before.doc_type,
      lines === null ? before.line_items : (lines.length ? JSON.stringify(lines) : null),
      lines === null ? before.lines_total : linesTotalOf(lines),
      category,
      req.user?.name || null, before.id);
  const after = db.prepare('SELECT * FROM partner_documents WHERE id = ?').get(before.id);
  logAudit(req.user, 'update', 'partner_document', before.id, null, before, after, after.doc_number || after.id);
  res.json({ ...after, extracted_text: undefined, has_text: !!after.extracted_text });
});

/**
 * Setting what a document is FOR, on its own.
 *
 * Deliberately not part of the edit form. The edit pencil only appears on
 * drafts — rightly, because changing the amount of a finalised invoice is a
 * different act — but the documents that need categorising are precisely the
 * FINAL ones, since those are the ones in the number and drawing on the credit.
 * Without this the four uncategorised invoices on the settlement card had no
 * door at all.
 *
 * So this changes one field and nothing else. It is refused once the document
 * is settled: the category decides what the credit absorbed, and re-classifying
 * a settled document would rewrite what a paid settlement was calculated
 * against — the same rule that stops a drawn-on credit being resized.
 */
router.put('/documents/:docId/category', (req, res) => {
  if (!canSettle(req.user)) return res.status(403).json({ error: 'Only the office or an admin can categorise a document.' });
  const db = getDb();
  const before = db.prepare('SELECT * FROM partner_documents WHERE id = ?').get(req.params.docId);
  if (!before) return res.status(404).json({ error: 'Document not found' });
  if (before.settlement_id) {
    return res.status(400).json({
      error: 'This document is part of a settled payment. Its category is what the credit was applied against and cannot be changed.',
    });
  }
  const raw = req.body?.category;
  // An empty string is a deliberate "back to uncategorised"; an unknown value
  // is refused rather than silently stored, or a typo becomes a category that
  // no credit will ever match.
  if (raw !== null && raw !== undefined && raw !== '' && !CATEGORIES.includes(raw)) {
    return res.status(400).json({ error: `Category must be one of: ${CATEGORIES.join(', ')}.` });
  }
  const category = raw === '' || raw === null || raw === undefined ? null : raw;
  db.prepare("UPDATE partner_documents SET category = ?, updated_at = datetime('now'), updated_by = ? WHERE id = ?")
    .run(category, req.user?.name || null, before.id);
  const after = db.prepare('SELECT * FROM partner_documents WHERE id = ?').get(before.id);
  logAudit(req.user, 'update', 'partner_document', before.id,
    { field: 'category', from: before.category, to: category }, before, after, after.doc_number || after.id);
  res.json({ ...after, extracted_text: undefined });
});

/**
 * Attach (or replace) the file on a document that already exists.
 *
 * There was no way to do this, which is how a ledger ends up with rows that
 * were typed in and no invoice behind them: an upload attempted while storage
 * was off is REFUSED outright (createDocument 503s on the whole call rather
 * than filing a document with a missing file), so whoever hit that entered the
 * numbers by hand and the paperwork never caught up.
 *
 * Replacing is allowed and the old object is deleted, because the usual reason
 * is that the first scan was the wrong page. Refused once settled: the document
 * is part of what was paid against.
 */
router.post('/documents/:docId/file', uploadDocs, async (req, res) => {
  const files = req.files || [];
  try {
    if (!canSettle(req.user)) return res.status(403).json({ error: 'Only the office or an admin can attach a document file.' });
    const db = getDb();
    const before = db.prepare('SELECT * FROM partner_documents WHERE id = ?').get(req.params.docId);
    if (!before) return res.status(404).json({ error: 'Document not found' });
    if (before.settlement_id) {
      return res.status(400).json({ error: 'This document is part of a settled payment and cannot be changed.' });
    }
    if (!storageEnabled()) return res.status(503).json({ error: 'File storage is not configured — set the R2 variables.' });
    const f = files[0];
    if (!f) return res.status(400).json({ error: 'No file received.' });

    const buf = readFileSync(f.path);
    const safe = (f.originalname || 'file').replace(/[^\w.-]+/g, '_').slice(0, 120);
    const key = `partners/${before.partner_id}/${before.id}-${safe}`;
    await putObject(key, buf, f.mimetype);
    // Best effort: a scan that cannot be read is still the document.
    let text = null;
    try { text = await extractInvoiceText(buf, f.mimetype, f.originalname); } catch { text = null; }

    const old = before.storage_key && before.storage_key !== key ? before.storage_key : null;
    db.prepare(`UPDATE partner_documents SET storage_key = ?, filename = ?, content_type = ?, size = ?,
        extracted_text = ?, updated_at = datetime('now'), updated_by = ? WHERE id = ?`)
      .run(key, (f.originalname || 'file').slice(0, 255), f.mimetype || null, f.size || null,
        text, req.user?.name || null, before.id);
    if (old) { try { await deleteObject(old); } catch { /* the row is what matters */ } }

    const after = db.prepare('SELECT * FROM partner_documents WHERE id = ?').get(before.id);
    logAudit(req.user, 'update', 'partner_document', before.id,
      { field: 'file', filename: after.filename, replaced: !!old }, null, null, after.doc_number || after.id);
    res.json({ ...after, extracted_text: undefined, has_text: !!after.extracted_text });
  } catch (err) {
    res.status(400).json({ error: uploadErrorMessage(err) });
  } finally {
    cleanupTemp(files);
  }
});

/**
 * Proof that the money actually moved.
 *
 * `payment_reference` is what somebody typed; the remittance advice or bank
 * confirmation is the thing that shows it happened, and it is what the other
 * company asks for when a settlement is questioned a year later.
 *
 * Attached AFTER the settlement rather than during it, deliberately: the settle
 * call recomputes the number and refuses a stale one, and making it multipart
 * so a file could ride along would put an upload failure in the path of
 * recording a payment. A settlement with no proof yet is honest and fixable; a
 * payment that failed to record because a PDF was too big is not.
 */
router.post('/settlements/:settlementId/proof', uploadDocs, async (req, res) => {
  const files = req.files || [];
  try {
    if (!canSettle(req.user)) return res.status(403).json({ error: 'Only the office or an admin can attach proof of payment.' });
    const db = getDb();
    const st = db.prepare('SELECT * FROM partner_settlements WHERE id = ?').get(req.params.settlementId);
    if (!st) return res.status(404).json({ error: 'Settlement not found' });
    if (!storageEnabled()) return res.status(503).json({ error: 'File storage is not configured — set the R2 variables.' });
    const f = files[0];
    if (!f) return res.status(400).json({ error: 'No file received.' });

    const safe = (f.originalname || 'file').replace(/[^\w.-]+/g, '_').slice(0, 120);
    const key = `partners/${st.partner_id}/settlements/${st.id}-${safe}`;
    await putObject(key, readFileSync(f.path), f.mimetype);
    const old = st.proof_storage_key && st.proof_storage_key !== key ? st.proof_storage_key : null;
    db.prepare(`UPDATE partner_settlements SET proof_storage_key = ?, proof_filename = ?,
        proof_content_type = ?, proof_size = ?, proof_uploaded_by = ?, proof_uploaded_at = datetime('now')
      WHERE id = ?`).run(key, (f.originalname || 'file').slice(0, 255), f.mimetype || null, f.size || null,
      req.user?.name || null, st.id);
    if (old) { try { await deleteObject(old); } catch { /* the row is what matters */ } }

    const after = db.prepare('SELECT * FROM partner_settlements WHERE id = ?').get(st.id);
    logAudit(req.user, 'update', 'partner_settlement', st.id,
      { field: 'payment_proof', filename: after.proof_filename, replaced: !!old }, null, null,
      `${st.period_end} proof of payment`);
    res.json(after);
  } catch (err) {
    res.status(400).json({ error: uploadErrorMessage(err) });
  } finally {
    cleanupTemp(files);
  }
});

/** The proof itself, for whoever can see the ledger. */
router.get('/settlements/:settlementId/proof', async (req, res) => {
  const db = getDb();
  const st = db.prepare('SELECT * FROM partner_settlements WHERE id = ?').get(req.params.settlementId);
  if (!st?.proof_storage_key) return res.status(404).json({ error: 'No proof of payment on this settlement.' });
  const url = await presignGet(st.proof_storage_key, st.proof_filename);
  if (!url) return res.status(503).json({ error: 'File storage is not configured.' });
  res.json({ url, filename: st.proof_filename });
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
  // `category` is in this list because the credit reads it. An explicit column
  // list silently drops a new column, and the symptom is not an error — it is
  // every document arriving uncategorised and a credit that absorbs nothing.
  const rows = db.prepare(`SELECT id, direction, doc_type, doc_number, reference, description,
      issued_date, terms_days, due_date, amount, status, disputed_reason, settlement_id, filename, category
    FROM partner_documents WHERE partner_id = ? AND settlement_id IS NULL AND status != 'void'`).all(partnerId);
  return reconcile(rows, asOf);
}

/**
 * The active credit facility and what it has already absorbed.
 *
 * `applied_to_date` is SUMMED from the application rows, never read from a
 * stored balance — one number with two sources is how a facility and its list
 * of draws start disagreeing, and on this one that argument is worth $200,000.
 */
export function creditFor(db, partnerId) {
  const credit = db.prepare(
    "SELECT * FROM partner_credits WHERE partner_id = ? AND status = 'active' ORDER BY created_at LIMIT 1"
  ).get(partnerId);
  if (!credit) return { credit: null, appliedToDate: 0 };
  const appliedToDate = db.prepare(
    'SELECT COALESCE(SUM(amount), 0) t FROM partner_credit_applications WHERE credit_id = ?'
  ).get(credit.id).t;
  return { credit, appliedToDate: round2(appliedToDate) };
}

router.get('/:id/reconcile', (req, res) => {
  const db = getDb();
  const partner = db.prepare('SELECT * FROM partner_accounts WHERE id = ?').get(req.params.id);
  if (!partner) return res.status(404).json({ error: 'Partner not found' });
  const asOf = isoDay(req.query.as_of) || endOfMonth();
  const r = currentReconciliation(db, partner.id, asOf);
  const { credit, appliedToDate } = creditFor(db, partner.id);
  // Reported alongside the raw number, never instead of it: `net_before_credit`
  // stays on the payload so both companies can see the working, not just the
  // answer.
  res.json({ partner, ...r, credit: credit ? applyCredit(r, credit, appliedToDate) : null });
});

/* ── The credit facility ──────────────────────────────────────────────────── */

router.get('/:id/credits', (req, res) => {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM partner_credits WHERE partner_id = ? ORDER BY created_at DESC').all(req.params.id);
  const used = db.prepare('SELECT credit_id, COALESCE(SUM(amount),0) t FROM partner_credit_applications GROUP BY credit_id').all();
  const byId = new Map(used.map(u => [u.credit_id, round2(u.t)]));
  res.json(rows.map(c => ({
    ...c,
    applied_to_date: byId.get(c.id) || 0,
    remaining_balance: round2(Number(c.amount) - (byId.get(c.id) || 0)),
  })));
});

// The draws behind the balance. A running total nobody can open is a number
// people are asked to take on faith, which is the state this module exists to
// end.
router.get('/credits/:creditId/applications', (req, res) => {
  const db = getDb();
  res.json(db.prepare(`SELECT a.*, d.doc_number, d.description, d.issued_date, d.category,
      s.period_end, s.paid_at
    FROM partner_credit_applications a
    LEFT JOIN partner_documents d ON d.id = a.document_id
    LEFT JOIN partner_settlements s ON s.id = a.settlement_id
    WHERE a.credit_id = ? ORDER BY a.created_at DESC LIMIT 500`).all(req.params.creditId));
});

router.post('/:id/credits', (req, res) => {
  if (!canSettle(req.user)) return res.status(403).json({ error: 'Only the office or an admin can open a credit.' });
  const db = getDb();
  const partner = db.prepare('SELECT * FROM partner_accounts WHERE id = ?').get(req.params.id);
  if (!partner) return res.status(404).json({ error: 'Partner not found' });
  const amount = money(req.body?.amount);
  if (!(amount > 0)) return res.status(400).json({ error: 'A credit needs an amount.' });
  const appliesTo = CATEGORIES.includes(req.body?.applies_to) ? req.body.applies_to : 'manufacturing';
  const direction = ['receivable', 'payable'].includes(req.body?.direction) ? req.body.direction : 'receivable';
  const id = uuid();
  db.prepare(`INSERT INTO partner_credits
    (id, partner_id, direction, applies_to, amount, label, description, issued_date, created_by)
    VALUES (?,?,?,?,?,?,?,?,?)`)
    .run(id, partner.id, direction, appliesTo, amount,
      clean(req.body?.label, 120) || `${partner.name} ${appliesTo} credit`,
      clean(req.body?.description, 2000), isoDay(req.body?.issued_date) || new Date().toISOString().slice(0, 10),
      req.user?.name || null);
  const created = db.prepare('SELECT * FROM partner_credits WHERE id = ?').get(id);
  logAudit(req.user, 'create', 'partner_credit', id, { amount, applies_to: appliesTo, direction },
    null, created, created.label);
  res.status(201).json(created);
});

/**
 * Correcting the facility, and the one thing that cannot be corrected.
 *
 * The AMOUNT and what it applies to can be changed while nothing has drawn on
 * it. Once a draw is stamped into a settlement, changing either would rewrite
 * what a paid settlement was calculated against — so it is refused, and the way
 * to reduce a facility that has been used is to close it and open the next one.
 */
router.put('/credits/:creditId', (req, res) => {
  if (!canSettle(req.user)) return res.status(403).json({ error: 'Only the office or an admin can change a credit.' });
  const db = getDb();
  const before = db.prepare('SELECT * FROM partner_credits WHERE id = ?').get(req.params.creditId);
  if (!before) return res.status(404).json({ error: 'Credit not found' });
  const drawn = db.prepare('SELECT COUNT(*) n FROM partner_credit_applications WHERE credit_id = ?').get(before.id).n;
  const changesTerms = (req.body?.amount !== undefined && money(req.body.amount) !== round2(before.amount))
    || (req.body?.applies_to !== undefined && req.body.applies_to !== before.applies_to)
    || (req.body?.direction !== undefined && req.body.direction !== before.direction);
  if (drawn > 0 && changesTerms) {
    return res.status(409).json({
      error: `This credit has already been drawn on in ${drawn} settled document${drawn === 1 ? '' : 's'}. Close it and open a new one rather than rewriting what those settlements were calculated against.`,
    });
  }
  db.prepare(`UPDATE partner_credits SET amount = ?, applies_to = ?, direction = ?, label = ?,
      description = ?, status = ?, updated_at = datetime('now'), updated_by = ? WHERE id = ?`)
    .run(req.body?.amount !== undefined ? money(req.body.amount) : before.amount,
      CATEGORIES.includes(req.body?.applies_to) ? req.body.applies_to : before.applies_to,
      ['receivable', 'payable'].includes(req.body?.direction) ? req.body.direction : before.direction,
      clean(req.body?.label, 120) || before.label,
      req.body?.description !== undefined ? clean(req.body.description, 2000) : before.description,
      ['active', 'closed', 'void'].includes(req.body?.status) ? req.body.status : before.status,
      req.user?.name || null, before.id);
  const after = db.prepare('SELECT * FROM partner_credits WHERE id = ?').get(before.id);
  logAudit(req.user, 'update', 'partner_credit', before.id, null, before, after, after.label);
  res.json(after);
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

  // The credit is recomputed here too, and the settlement is stamped with what
  // it actually absorbed. A facility whose balance moved without a settlement
  // saying so is the second mechanism all over again.
  const { credit, appliedToDate } = creditFor(db, partner.id);
  const applied = credit ? applyCredit(r, credit, appliedToDate) : null;
  const netToPay = applied ? applied.net_amount : r.net_amount;

  // Checked against the number the screen was SHOWING, which is the one after
  // the credit — paying against a stale figure is the failure this exists to
  // prevent, and the credit moving is one of the ways it goes stale.
  if (req.body?.expected_net !== undefined && round2(req.body.expected_net) !== netToPay) {
    return res.status(409).json({
      error: 'The balance changed while you were looking at it — review the new number before settling.',
      expected: round2(req.body.expected_net), actual: netToPay,
    });
  }

  const id = uuid();
  const tx = db.transaction(() => {
    db.prepare(`INSERT INTO partner_settlements
      (id, partner_id, period_end, receivable_total, payable_total, net_amount, owed_to,
       document_count, status, paid_at, paid_by, payment_reference, notes, created_by)
      VALUES (?,?,?,?,?,?,?,?, 'paid', datetime('now'), ?, ?, ?, ?)`)
      .run(id, partner.id, asOf, r.receivable_total, r.payable_total,
        netToPay,
        applied ? applied.owed_to : r.owed_to,
        ids.length, req.user?.name || null, clean(req.body?.payment_reference, 200),
        clean(req.body?.notes, 2000), req.user?.name || null);
    const stamp = db.prepare('UPDATE partner_documents SET settlement_id = ? WHERE id = ?');
    for (const docId of ids) stamp.run(id, docId);
    // Same transaction as the settlement: a draw that lands without its
    // payment, or a payment without its draw, is a balance nobody can defend.
    if (applied?.draws?.length) {
      const drawIns = db.prepare(`INSERT INTO partner_credit_applications
        (id, credit_id, settlement_id, document_id, amount, created_by) VALUES (?,?,?,?,?,?)`);
      for (const d of applied.draws) {
        drawIns.run(uuid(), credit.id, id, d.document_id, d.amount, req.user?.name || null);
      }
      // A facility with nothing left is CLOSED rather than left sitting at
      // zero, so nobody reads an exhausted credit as available headroom.
      if (applied.remaining_balance <= 0) {
        db.prepare("UPDATE partner_credits SET status = 'closed', updated_at = datetime('now'), updated_by = ? WHERE id = ?")
          .run(req.user?.name || null, credit.id);
      }
    }
  });
  tx();

  const settlement = db.prepare('SELECT * FROM partner_settlements WHERE id = ?').get(id);
  logAudit(req.user, 'create', 'partner_settlement', id, {
    net: netToPay, owed_to: settlement.owed_to, documents: ids.length, period_end: asOf,
    ...(applied?.drawn_this_period
      ? { credit_drawn: applied.drawn_this_period, credit_remaining: applied.remaining_balance, credit_id: credit.id }
      : {}),
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
