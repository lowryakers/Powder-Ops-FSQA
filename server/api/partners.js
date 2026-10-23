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
import { pageList } from '../bot-api.js';
import { randomUUID as uuid, createHash, randomBytes } from 'crypto';
import { readFileSync } from 'fs';
import { getDb, logAudit } from '../db.js';
import { storageEnabled, putObject, presignGet, deleteObject } from '../storage.js';
import { mediaUpload, cleanupTemp, uploadErrorMessage } from '../media.js';
import { extractInvoiceText } from '../invoice-text.js';
import { reconcile, applyCredit, dueDateFor, endOfMonth, round2, signedAmount, normDocNumber, creditLedger, BASES } from '../partner-recon.js';
import { parseInvoice, parseLineItems, summarizeLineItems } from '../invoice-parse.js';
import { botDm, postMessageAs } from './comms.js';
import { pushToUser } from '../push.js';
import { readyDocOrigin } from '../links.js';

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

router.get('/', (req, res) => {
  const db = getDb();
  res.json(pageList(req, res, db.prepare('SELECT * FROM partner_accounts WHERE is_active = 1 ORDER BY name').all()));
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
  // `settled_period` rides along so a settled row can say WHICH settlement it
  // was paid in ("Settled 2026-08-31") without a second request per row.
  let sql = `SELECT partner_documents.*,
      (SELECT period_end FROM partner_settlements s WHERE s.id = partner_documents.settlement_id) AS settled_period
    FROM partner_documents WHERE partner_id = ?`;
  const params = [partnerId];
  if (q.direction === 'receivable' || q.direction === 'payable') { sql += ' AND direction = ?'; params.push(q.direction); }
  if (q.status) { sql += ' AND status = ?'; params.push(q.status); }
  if (q.doc_type) { sql += ' AND doc_type = ?'; params.push(q.doc_type); }
  if (q.unsettled === '1') sql += ' AND settlement_id IS NULL';
  if (q.settled === '1') sql += ' AND settlement_id IS NOT NULL';
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
      // The row's amount versus what the FILE prints as its total. A mismatch
      // is the one discrepancy the other company will find first, so it is
      // flagged rather than left for them to.
      amount_mismatch: d.parsed_amount != null && d.amount != null
        && Math.abs(d.parsed_amount - d.amount) >= 0.01,
    };
  });
}

/** What the file itself says its total is — stored beside the row, never as it. */
function parsedTotalOf(text, partner) {
  if (!text) return { amount: null, label: null };
  try {
    const p = parseInvoice(text, { usNames: OUR_NAMES, partnerNames: nameVariants(partner?.name) });
    return { amount: p.amount ?? null, label: p.amount_label || null };
  } catch { return { amount: null, label: null }; }
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
    // Office-only: voiding is theirs, so the list of copies to look at is too.
    ...(canSettle(req.user) ? { settled_twins: settledTwins(db, req.params.id) } : {}),
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

  // Every door that files a document — the form, the import, the partner's own
  // portal — passes here, so the settled-copy refusal lives here once.
  const settledDup = findExistingDoc(db, partnerId, { doc_number: body?.doc_number, amount, direction });
  if (settledDup?.settlement_id) {
    return {
      error: duplicateNote(settledDup, amount), status: 409,
      settlement_id: settledDup.settlement_id, settled_period: settledDup.settled_period, duplicate_of: settledDup.id,
    };
  }

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
    const parsedTotal = parsedTotalOf(text, partner);
    db.prepare(`INSERT INTO partner_documents
      (id, partner_id, direction, doc_type, doc_number, reference, description,
       issued_date, terms_days, due_date, amount, status, category,
       storage_key, filename, content_type, size, extracted_text, line_items, lines_total,
       parsed_amount, parsed_amount_label, source, created_by)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,'draft',?,?,?,?,?,?,?,?,?,?,?,?)`)
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
        parsedTotal.amount, parsedTotal.label,
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
 * nobody catches it.
 *
 * MATCHED ON THE NUMBER AS AN IDENTITY (`normDocNumber`) AND THE DIRECTION,
 * never on the exact string and the exact amount. The first version required
 * both to be byte-for-byte equal, so "INV-I123" against "I123", or a file read
 * at a different figure than the one typed in August, was a NEW document — and
 * on 12 Oct five invoices already paid in the August settlement came back in as
 * open, final copies that counted in the balance and drew the credit a second
 * time. A different amount on the same number is still flagged (worded as
 * such): it is far more often one invoice read two ways than two invoices.
 *
 * A SETTLED document is included and returned first. It is the case that
 * matters most — the money behind it has already moved.
 *
 * `direction` may be null (a scan that could not tell which way a file points);
 * then any direction matches, because "maybe a duplicate" is the safe answer.
 */
function findExistingDoc(db, partnerId, { doc_number, amount, direction }) {
  const key = normDocNumber(doc_number);
  if (!key) return null;
  const rows = db.prepare(`SELECT d.id, d.doc_number, d.amount, d.direction, d.status, d.issued_date,
      d.settlement_id, s.period_end AS settled_period
    FROM partner_documents d LEFT JOIN partner_settlements s ON s.id = d.settlement_id
    WHERE d.partner_id = ? AND d.status != 'void' AND d.doc_number IS NOT NULL`).all(partnerId);
  const amt = amount == null || amount === '' || !Number.isFinite(Number(amount)) ? null : Number(amount);
  const hits = rows
    .filter(r => normDocNumber(r.doc_number) === key && (!direction || r.direction === direction))
    .map(r => ({ ...r, same_amount: amt != null && Math.abs(Number(r.amount) - amt) < 0.005 }));
  if (!hits.length) return null;
  hits.sort((a, b) => (b.settlement_id ? 1 : 0) - (a.settlement_id ? 1 : 0)
    || (b.same_amount ? 1 : 0) - (a.same_amount ? 1 : 0));
  return hits[0];
}

const dollars = (n) => `$${(Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** What to say about a match — three different situations, three sentences. */
function duplicateNote(dup, amount) {
  if (dup.settlement_id) {
    return `${dup.doc_number} is already settled ${dup.settled_period || ''} (${dollars(dup.amount)}). `
      + 'It was paid in that settlement; a second document needs a different number, or a credit note.';
  }
  if (dup.same_amount || amount == null) {
    return `${dup.doc_number} for ${dollars(dup.amount)} is already on this ledger (${dup.status}). Importing it again would double what is owed.`;
  }
  return `${dup.doc_number} is already on this ledger for ${dollars(dup.amount)} (${dup.status}) — this one reads ${dollars(amount)}. `
    + 'Same number, different amount: most likely the same invoice read two ways. Check it before importing.';
}

/**
 * Open documents that carry the number of a SETTLED one, same direction — the
 * repair list for copies like the 12 Oct import. DERIVED on every read, so a
 * person voiding the copy clears it; nothing is deleted or voided here.
 */
function settledTwins(db, partnerId) {
  const rows = db.prepare(`SELECT d.id, d.doc_number, d.amount, d.direction, d.status, d.source,
      d.created_at, d.created_by, d.settlement_id, s.period_end AS settled_period
    FROM partner_documents d LEFT JOIN partner_settlements s ON s.id = d.settlement_id
    WHERE d.partner_id = ? AND d.status != 'void' AND d.doc_number IS NOT NULL`).all(partnerId);
  const settled = new Map();
  for (const r of rows) {
    if (!r.settlement_id) continue;
    const k = `${r.direction}|${normDocNumber(r.doc_number)}`;
    if (!settled.has(k)) settled.set(k, r);
  }
  return rows
    .filter(r => !r.settlement_id)
    .map(r => ({ r, twin: settled.get(`${r.direction}|${normDocNumber(r.doc_number)}`) }))
    .filter(x => x.twin)
    .map(({ r, twin }) => ({
      id: r.id, doc_number: r.doc_number, amount: r.amount, direction: r.direction, status: r.status,
      source: r.source, created_at: r.created_at, created_by: r.created_by,
      twin: { id: twin.id, doc_number: twin.doc_number, amount: twin.amount, settlement_id: twin.settlement_id, period_end: twin.settled_period },
    }));
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
          same_amount: dup.same_amount, settlement_id: dup.settlement_id || null, settled_period: dup.settled_period || null,
        };
        row.message = duplicateNote(dup, parsed.amount);
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
      const dup = findExistingDoc(db, partner.id, { doc_number: row.doc_number, amount: Number(row.amount), direction: row.direction });
      // A SETTLED match is refused whatever the row says. The money behind it
      // has moved; `allow_duplicate` is for "this really is a second document",
      // and a second document with a settled document's number is a copy.
      if (dup?.settlement_id) {
        skipped.push({ filename: name, reason: `already settled ${dup.settled_period || ''} as ${dup.doc_number}`, settlement_id: dup.settlement_id });
        continue;
      }
      // Any other match needs a PERSON to say it is a second document. A token
      // never overrides a duplicate: the review step that would catch a wrong
      // override is exactly what a direct API call skips.
      const override = !!row.allow_duplicate && req.auth?.kind !== 'token';
      if (dup && !override) {
        skipped.push({ filename: name, reason: duplicateNote(dup, Number(row.amount)) });
        continue;
      }

      const r = await createDocument(db, {
        partnerId: partner.id, body: row, files: [f], user: req.user, source: 'import',
      });
      if (r.error) { skipped.push({ filename: name, reason: r.error }); continue; }
      const doc = r.documents[0];
      logAudit(req.user, 'create', 'partner_document', doc.id,
        // The override and what it overrode are recorded, so "why did this
        // copy get in" is answerable from the trail next time.
        { imported: true, filename: name, direction: row.direction, amount: Number(row.amount), doc_number: row.doc_number,
          ...(dup ? { allow_duplicate: true, duplicate_of: dup.id } : {}) },
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
    if (r.error) {
      return res.status(r.status || 400).json({
        error: r.error,
        ...(r.settlement_id ? { settlement_id: r.settlement_id, settled_period: r.settled_period, duplicate_of: r.duplicate_of } : {}),
      });
    }
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
  // parsed_amount is refreshed here too: it is the same kind of fact — what
  // the FILE says — and both derive from the same re-read. The row's amount
  // is still never touched.
  const partner = db.prepare('SELECT * FROM partner_accounts WHERE id = ?').get(doc.partner_id);
  const parsedTotal = parsedTotalOf(doc.extracted_text, partner);
  db.prepare(`UPDATE partner_documents SET line_items = ?, lines_total = ?,
      parsed_amount = ?, parsed_amount_label = ?, updated_at = datetime('now'), updated_by = ? WHERE id = ?`)
    .run(JSON.stringify(lines), total, parsedTotal.amount, parsedTotal.label, req.user?.name || null, doc.id);
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
 * The dates on a document, on their own — issued, terms, due.
 *
 * The edit pencil is drafts-only, rightly, so a FINAL document with a wrong
 * due date had no door at all: I136 was issued 24 Sep on Net 30 and carried a
 * due date of 26 May, read off the file. The due date decides whether a
 * document is in this month's number (Net 30 is the inclusion rule), so a wrong
 * one is not cosmetic — but changing it is a correction to a date, never to the
 * amount, the direction, the category or the lines, and this route touches
 * nothing else.
 *
 * Office/admin only, refused once settled (the date was part of what was paid
 * against) and refused on a void document. A due date before the issue date is
 * refused rather than stored — that is the I136 mistake itself.
 *
 * NOT open to a bot token. The module's rule for tokens is that a document stays
 * a draft while a token touches it, and this route exists precisely for final
 * documents, where moving a date moves money between months.
 */
router.put('/documents/:docId/dates', (req, res) => {
  if (!canSettle(req.user)) return res.status(403).json({ error: 'Only the office or an admin can change the dates on a document.' });
  const db = getDb();
  const before = db.prepare('SELECT * FROM partner_documents WHERE id = ?').get(req.params.docId);
  if (!before) return res.status(404).json({ error: 'Document not found' });
  if (before.settlement_id) {
    return res.status(400).json({ error: 'This document is part of a settled payment. Its dates are part of what was paid against and cannot be changed.' });
  }
  if (before.status === 'void') return res.status(400).json({ error: 'This document is void.' });

  const b = req.body || {};
  if (b.issued_date !== undefined && b.issued_date !== '' && !isoDay(b.issued_date)) return res.status(400).json({ error: 'The issue date must be a date (YYYY-MM-DD).' });
  if (b.due_date !== undefined && b.due_date !== '' && !isoDay(b.due_date)) return res.status(400).json({ error: 'The due date must be a date (YYYY-MM-DD).' });
  const termsRaw = b.terms_days === undefined || b.terms_days === '' ? null : Number(b.terms_days);
  if (termsRaw != null && !(Number.isFinite(termsRaw) && termsRaw >= 0 && termsRaw <= 365)) {
    return res.status(400).json({ error: 'Terms are a number of days between 0 and 365.' });
  }
  const issued = isoDay(b.issued_date) || before.issued_date;
  const terms = termsRaw != null ? Math.floor(termsRaw) : before.terms_days;
  // A due date typed wins. Otherwise, if the issue date or the terms moved, the
  // due date follows them; if neither moved, it is left as it was.
  const moved = issued !== before.issued_date || terms !== before.terms_days;
  const due = isoDay(b.due_date) || (moved ? dueDateFor(issued, terms) : before.due_date);
  if (issued && due && due < issued) {
    return res.status(400).json({ error: `A due date of ${due} is before the issue date (${issued}).` });
  }
  if (issued === before.issued_date && terms === before.terms_days && due === before.due_date) {
    return res.json({ ...before, extracted_text: undefined, unchanged: true });
  }
  db.prepare(`UPDATE partner_documents SET issued_date = ?, terms_days = ?, due_date = ?,
      updated_at = datetime('now'), updated_by = ? WHERE id = ?`)
    .run(issued, terms, due, req.user?.name || null, before.id);
  const after = db.prepare('SELECT * FROM partner_documents WHERE id = ?').get(before.id);
  logAudit(req.user, 'update', 'partner_document', before.id, {
    field: 'dates',
    from: { issued_date: before.issued_date, terms_days: before.terms_days, due_date: before.due_date },
    to: { issued_date: issued, terms_days: terms, due_date: due },
  }, before, after, after.doc_number || after.id);
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
    const partner = db.prepare('SELECT * FROM partner_accounts WHERE id = ?').get(before.partner_id);
    const parsedTotal = parsedTotalOf(text, partner);
    db.prepare(`UPDATE partner_documents SET storage_key = ?, filename = ?, content_type = ?, size = ?,
        extracted_text = ?, parsed_amount = ?, parsed_amount_label = ?,
        updated_at = datetime('now'), updated_by = ? WHERE id = ?`)
      .run(key, (f.originalname || 'file').slice(0, 255), f.mimetype || null, f.size || null,
        text, parsedTotal.amount, parsedTotal.label, req.user?.name || null, before.id);
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
  // A dispute the partner raised on this document is answered by resolving it,
  // so their page stops reading "Powder Ops reviewing".
  if (before.status === 'disputed') {
    db.prepare(`UPDATE partner_reviews SET resolved_at = datetime('now'), resolved_by = ?, resolution = 'Confirmed as final'
      WHERE document_id = ? AND resolved_at IS NULL`).run(req.user?.name || null, before.id);
  }
  logAudit(req.user, 'update', 'partner_document', before.id, { finalized: true }, before, after, after.doc_number || after.id);
  res.json({ ...after, extracted_text: undefined });
});

/* ── What the partner raised on their link ────────────────────────────────── */

// "This doesn't look right" from the partner page: against a document or a
// whole month end. Open ones first; the office answers each with a note.
router.get('/:id/reviews', (req, res) => {
  const db = getDb();
  res.json(db.prepare(`SELECT r.*, d.doc_number, d.direction, d.amount, d.status AS doc_status, s.period_end AS settlement_period
    FROM partner_reviews r
    LEFT JOIN partner_documents d ON d.id = r.document_id
    LEFT JOIN partner_settlements s ON s.id = r.settlement_id
    WHERE r.partner_id = ? ORDER BY (r.resolved_at IS NOT NULL), r.created_at DESC LIMIT 200`).all(req.params.id));
});

router.post('/reviews/:rid/resolve', (req, res) => {
  if (!canSettle(req.user)) return res.status(403).json({ error: 'Only the office or an admin can answer what the partner raised.' });
  const db = getDb();
  const before = db.prepare('SELECT * FROM partner_reviews WHERE id = ?').get(req.params.rid);
  if (!before) return res.status(404).json({ error: 'Not found' });
  if (before.resolved_at) return res.status(400).json({ error: 'Already answered.' });
  const resolution = clean(req.body?.resolution, 1000);
  if (!resolution || resolution.length < 3) return res.status(400).json({ error: 'Say what was found — the partner reads this answer.' });
  db.prepare(`UPDATE partner_reviews SET resolved_at = datetime('now'), resolved_by = ?, resolution = ? WHERE id = ?`)
    .run(req.user?.name || null, resolution, before.id);
  const after = db.prepare('SELECT * FROM partner_reviews WHERE id = ?').get(before.id);
  logAudit(req.user, 'update', 'partner_review', before.id, { resolution }, before, after, before.note.slice(0, 60));
  res.json(after);
});

// Admin only — for a test entry or one raised by mistake. It removes the
// question, not any money: a dispute flag on a document is cleared by
// "Resolve as final", never by this.
router.delete('/reviews/:rid', (req, res) => {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Only an admin can delete what the partner raised.' });
  const db = getDb();
  const before = db.prepare('SELECT * FROM partner_reviews WHERE id = ?').get(req.params.rid);
  if (!before) return res.status(404).json({ error: 'Not found' });
  db.prepare('DELETE FROM partner_reviews WHERE id = ?').run(before.id);
  logAudit(req.user, 'delete', 'partner_review', before.id, null, before, null, before.note.slice(0, 60));
  res.json({ ok: true });
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
const RECON_COLUMNS = `id, direction, doc_type, doc_number, reference, description,
      issued_date, terms_days, due_date, amount, status, disputed_reason, settlement_id, filename, category`;
/** `due` unless the caller named a basis the reconcile knows — `selected` is the settle path's own. */
const basisOf = (v) => (v === 'issued' ? 'issued' : 'due');

function currentReconciliation(db, partnerId, asOf, basis = 'due') {
  // `category` is in this list because the credit reads it. An explicit column
  // list silently drops a new column, and the symptom is not an error — it is
  // every document arriving uncategorised and a credit that absorbs nothing.
  const rows = db.prepare(`SELECT ${RECON_COLUMNS}
    FROM partner_documents WHERE partner_id = ? AND settlement_id IS NULL AND status != 'void'`).all(partnerId);
  return reconcile(rows, asOf, BASES.includes(basis) ? basis : 'due');
}

/**
 * Exactly the documents a person ticked for a settlement, run through the SAME
 * arithmetic (`reconcile` with basis `selected`, then the credit) — so the
 * preview on screen and the settlement it writes cannot disagree.
 *
 * Every id must be this partner's and must be a final, unsettled, undisputed
 * document. One that is not refuses the whole selection by name: settling the
 * rest quietly would pay a number that is not the one somebody looked at.
 */
function selectedReconciliation(db, partnerId, ids, asOf) {
  const list = [...new Set((Array.isArray(ids) ? ids : []).map(String).filter(Boolean))];
  if (!list.length) return { error: 'Tick at least one document to settle.' };
  if (list.length > 500) return { error: 'Too many documents in one settlement.' };
  const rows = db.prepare(`SELECT ${RECON_COLUMNS} FROM partner_documents
    WHERE partner_id = ? AND id IN (${list.map(() => '?').join(',')})`).all(partnerId, ...list);
  const found = new Set(rows.map(r => r.id));
  const missing = list.filter(id => !found.has(id));
  if (missing.length) return { error: `${missing.length} of the chosen documents are not on this ledger.`, refused: missing.map(id => ({ id, reason: 'not found' })) };
  const refused = rows.filter(r => r.settlement_id || r.status !== 'final').map(r => ({
    id: r.id, doc_number: r.doc_number,
    reason: r.settlement_id ? 'already settled' : r.status === 'void' ? 'void' : r.status === 'disputed' ? 'disputed' : 'still a draft',
  }));
  if (refused.length) {
    return {
      error: `These cannot go into a settlement: ${refused.map(x => `${x.doc_number || x.id} (${x.reason})`).join(', ')}.`,
      refused,
    };
  }
  return { r: reconcile(rows, asOf, 'selected'), ids: list };
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
  const r = currentReconciliation(db, partner.id, asOf, basisOf(req.query.basis));
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
  res.json(pageList(req, res, rows.map(c => ({
    ...c,
    applied_to_date: byId.get(c.id) || 0,
    remaining_balance: round2(Number(c.amount) - (byId.get(c.id) || 0)),
  }))));
});

// The draws behind the balance. A running total nobody can open is a number
// people are asked to take on faith, which is the state this module exists to
// end.
/**
 * The facility as a ledger — every draw grouped by settlement, balance before
 * and after each. Derived from the application rows (`creditLedger`).
 */
export function creditLedgerFor(db, credit) {
  if (!credit) return null;
  const apps = db.prepare(`SELECT a.settlement_id, a.document_id, a.amount, a.created_at,
      d.doc_number, d.description, s.period_end, s.paid_at
    FROM partner_credit_applications a
    LEFT JOIN partner_documents d ON d.id = a.document_id
    LEFT JOIN partner_settlements s ON s.id = a.settlement_id
    WHERE a.credit_id = ? ORDER BY a.created_at, a.rowid`).all(credit.id);
  return creditLedger(credit, apps);
}

router.get('/credits/:creditId/ledger', (req, res) => {
  const db = getDb();
  const credit = db.prepare('SELECT * FROM partner_credits WHERE id = ?').get(req.params.creditId);
  if (!credit) return res.status(404).json({ error: 'Credit not found' });
  res.json(creditLedgerFor(db, credit));
});

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
/**
 * What a chosen set of documents comes to — the live figure on the "Choose
 * documents" step. Writes nothing. Same loader, same reconcile, same credit as
 * the settle below, so the total shown before Mark PAID is the total paid.
 */
router.post('/:id/settle/preview', (req, res) => {
  if (!canSettle(req.user)) return res.status(403).json({ error: 'Only the office or an admin can prepare a settlement.' });
  const db = getDb();
  const partner = db.prepare('SELECT * FROM partner_accounts WHERE id = ?').get(req.params.id);
  if (!partner) return res.status(404).json({ error: 'Partner not found' });
  const asOf = isoDay(req.body?.as_of) || endOfMonth();
  const sel = selectedReconciliation(db, partner.id, req.body?.document_ids, asOf);
  if (sel.error) return res.status(400).json({ error: sel.error, refused: sel.refused || [] });
  const { credit, appliedToDate } = creditFor(db, partner.id);
  res.json({ ...sel.r, credit: credit ? applyCredit(sel.r, credit, appliedToDate) : null, written: false });
});

router.post('/:id/settle', (req, res) => {
  if (!canSettle(req.user)) return res.status(403).json({ error: 'Only the office or an admin can record a settlement.' });
  const db = getDb();
  const partner = db.prepare('SELECT * FROM partner_accounts WHERE id = ?').get(req.params.id);
  if (!partner) return res.status(404).json({ error: 'Partner not found' });

  const asOf = isoDay(req.body?.as_of) || endOfMonth();
  // Chosen documents, when a person ticked them; otherwise the whole basis
  // (due by default — the behaviour before selection existed, unchanged).
  const chosen = Array.isArray(req.body?.document_ids);
  let r, basis;
  if (chosen) {
    const sel = selectedReconciliation(db, partner.id, req.body.document_ids, asOf);
    if (sel.error) return res.status(400).json({ error: sel.error, refused: sel.refused || [] });
    r = sel.r; basis = 'selected';
  } else {
    basis = basisOf(req.body?.basis);
    r = currentReconciliation(db, partner.id, asOf, basis);
  }
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
       document_count, status, paid_at, paid_by, payment_reference, notes, created_by, basis)
      VALUES (?,?,?,?,?,?,?,?, 'paid', datetime('now'), ?, ?, ?, ?, ?)`)
      .run(id, partner.id, asOf, r.receivable_total, r.payable_total,
        netToPay,
        applied ? applied.owed_to : r.owed_to,
        ids.length, req.user?.name || null, clean(req.body?.payment_reference, 200),
        clean(req.body?.notes, 2000), req.user?.name || null, basis);
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
    basis, document_ids: ids,
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
  res.json(settlementDetail(db, s));
});

/**
 * What a settlement was made of, and HOW each document cleared.
 *
 * The Settled tab showed "they owed $30,582.51 − we owed $78,280.00" over a
 * payment of $74,574.98, which does not add up until you know $26,877.49 of
 * what they owed was taken by the credit. So each document says how it left
 * the ledger: CREDITED (a credit draw stamped into this settlement — with the
 * remainder when only part was covered), NETTED (a receivable set against what
 * we owed) or PAID (a payable, settled by the payment). The credit balance
 * before and after is read off the draws (`creditLedger`), never stored.
 *
 * Nothing here is re-decided: the totals are the ones the settlement row
 * froze, the draws are the rows it wrote.
 */
export function settlementDetail(db, s) {
  const docs = listDocuments(db, s.partner_id, { settlement_id: s.id, limit: 2000 });
  const draws = db.prepare(`SELECT credit_id, document_id, amount FROM partner_credit_applications
    WHERE settlement_id = ? ORDER BY created_at, rowid`).all(s.id);
  const drawOf = new Map();
  for (const d of draws) drawOf.set(d.document_id, round2((drawOf.get(d.document_id) || 0) + Number(d.amount || 0)));

  const documents = docs.map(d => {
    const signed = round2(signedAmount(d));
    const drawn = drawOf.get(d.id) || 0;
    const how = drawn > 0 ? 'credited' : d.direction === 'receivable' ? 'netted' : 'paid';
    return {
      ...d,
      signed,
      how_cleared: how,
      credited_amount: drawn || 0,
      // What the credit did not cover, when it ran out part way through.
      remainder: drawn > 0 ? round2(Math.max(0, signed - drawn)) : 0,
    };
  });

  let credit = null;
  if (draws.length) {
    const c = db.prepare('SELECT * FROM partner_credits WHERE id = ?').get(draws[0].credit_id);
    const ledger = creditLedgerFor(db, c);
    const g = ledger?.groups.find(x => x.settlement_id === s.id);
    const drawn = round2(draws.reduce((t, x) => t + Number(x.amount || 0), 0));
    const sideTotal = c?.direction === 'payable' ? s.payable_total : s.receivable_total;
    credit = {
      credit_id: c?.id || null, label: c?.label || null, applies_to: c?.applies_to || null, direction: c?.direction || null,
      facility: ledger?.facility ?? null,
      drawn_this_period: drawn,
      balance_before: g?.before ?? null,
      balance_after: g?.after ?? null,
      side_total: sideTotal,
      side_net_after_credit: round2(sideTotal - drawn),
    };
  }
  return {
    settlement: s,
    documents,
    credit,
    math: {
      receivable: s.receivable_total,
      payable: s.payable_total,
      net_before_credit: round2(s.receivable_total - s.payable_total),
      net_after_credit: s.net_amount,
    },
  };
}

/**
 * A document as the PARTNER may see it — an allow list, so a column added to
 * partner_documents later is not shipped to a public link by default. No file
 * key, no extracted text, nobody's email, no internal note fields.
 */
export function portalDoc(d) {
  const lines = Array.isArray(d.line_items) ? d.line_items : safeLines(d.line_items);
  return {
    id: d.id,
    doc_type: d.doc_type,
    doc_number: d.doc_number,
    reference: d.reference,
    description: d.description,
    issued_date: d.issued_date,
    terms_days: d.terms_days,
    due_date: d.due_date,
    amount: d.amount,
    signed: d.signed != null ? d.signed : round2(signedAmount(d)),
    category: d.category || null,
    status: d.status,
    disputed_reason: d.disputed_reason || null,
    filename: d.filename || null,
    has_file: !!(d.storage_key || d.filename),
    line_items: lines,
    line_summary: summarizeLineItems(lines),
    lines_total: d.lines_total ?? null,
    ...(d.exclusion ? { exclusion: d.exclusion, exclusion_note: d.exclusion_note } : {}),
    ...(d.how_cleared ? { how_cleared: d.how_cleared, credited_amount: d.credited_amount, remainder: d.remainder } : {}),
  };
}

/* ── Reminders ────────────────────────────────────────────────────────────── */
//
// "DM me on the last day of the month to close the period." Each reminder
// belongs to ONE person — whoever wants the nudge makes their own, so pausing
// yours never silences a colleague's. The DM carries the LIVE balance, because
// "close the period" with no number is an errand; with the number it is the
// start of the job.

const REMINDER_DAYS = ['last', ...Array.from({ length: 28 }, (_, i) => String(i + 1))];

router.get('/:id/reminders', (req, res) => {
  const db = getDb();
  res.json(db.prepare(`SELECT r.*, u.name AS user_name FROM partner_reminders r
    LEFT JOIN users u ON u.id = r.user_id
    WHERE r.partner_id = ? ORDER BY r.created_at`).all(req.params.id));
});

router.post('/:id/reminders', (req, res) => {
  if (!canSettle(req.user)) return res.status(403).json({ error: 'Only the office or an admin can set a reconciliation reminder.' });
  const db = getDb();
  const partner = db.prepare('SELECT * FROM partner_accounts WHERE id = ?').get(req.params.id);
  if (!partner) return res.status(404).json({ error: 'Partner not found' });
  const message = clean(req.body?.message, 300);
  if (!message) return res.status(400).json({ error: 'Say what the reminder should tell you.' });
  const day = REMINDER_DAYS.includes(String(req.body?.day)) ? String(req.body.day) : 'last';
  const hourRaw = Number(req.body?.hour);
  const hour = Number.isInteger(hourRaw) && hourRaw >= 0 && hourRaw <= 23 ? hourRaw : 8;
  const id = uuid();
  db.prepare(`INSERT INTO partner_reminders (id, partner_id, user_id, message, day, hour, created_by)
    VALUES (?,?,?,?,?,?,?)`)
    .run(id, partner.id, req.user.id, message, day, hour, req.user?.name || null);
  const created = db.prepare('SELECT * FROM partner_reminders WHERE id = ?').get(id);
  logAudit(req.user, 'create', 'partner_reminder', id, { message, day, hour }, null, created, partner.name);
  res.status(201).json(created);
});

router.put('/reminders/:rid', (req, res) => {
  const db = getDb();
  const before = db.prepare('SELECT * FROM partner_reminders WHERE id = ?').get(req.params.rid);
  if (!before) return res.status(404).json({ error: 'Reminder not found' });
  if (before.user_id !== req.user?.id && req.user?.role !== 'admin') {
    return res.status(403).json({ error: 'This is someone else\'s reminder.' });
  }
  const message = req.body?.message !== undefined ? clean(req.body.message, 300) : before.message;
  if (!message) return res.status(400).json({ error: 'A reminder needs its message.' });
  const day = req.body?.day !== undefined && REMINDER_DAYS.includes(String(req.body.day)) ? String(req.body.day) : before.day;
  const hourRaw = Number(req.body?.hour);
  const hour = req.body?.hour !== undefined && Number.isInteger(hourRaw) && hourRaw >= 0 && hourRaw <= 23 ? hourRaw : before.hour;
  const active = req.body?.active !== undefined ? (req.body.active ? 1 : 0) : before.active;
  db.prepare(`UPDATE partner_reminders SET message = ?, day = ?, hour = ?, active = ?,
      updated_at = datetime('now') WHERE id = ?`).run(message, day, hour, active, before.id);
  const after = db.prepare('SELECT * FROM partner_reminders WHERE id = ?').get(before.id);
  logAudit(req.user, 'update', 'partner_reminder', before.id, null, before, after, message);
  res.json(after);
});

router.delete('/reminders/:rid', (req, res) => {
  const db = getDb();
  const r = db.prepare('SELECT * FROM partner_reminders WHERE id = ?').get(req.params.rid);
  if (!r) return res.status(404).json({ error: 'Reminder not found' });
  if (r.user_id !== req.user?.id && req.user?.role !== 'admin') {
    return res.status(403).json({ error: 'This is someone else\'s reminder.' });
  }
  db.prepare('DELETE FROM partner_reminders WHERE id = ?').run(r.id);
  logAudit(req.user, 'delete', 'partner_reminder', r.id, null, r, null, r.message);
  res.json({ ok: true });
});

/** The plant's wall-clock date and hour, DST handled by the tz database. */
function plantClock(now = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Denver', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', hourCycle: 'h23',
  }).formatToParts(now).filter(p => p.type !== 'literal').map(p => [p.type, p.value]));
  return { y: Number(parts.year), m: Number(parts.month), d: Number(parts.day), h: Number(parts.hour) };
}

/**
 * Fire any reminders that have come due. Called on the hourly jobs tick; the
 * per-month stamp (`last_sent_period`) makes repeat ticks free, and the stamp
 * is written ONLY after the DM posts — a comms hiccup retries next hour
 * instead of silently costing someone their month-end nudge.
 */
export async function partnerReminderNudges(db) {
  let reminders;
  try { reminders = db.prepare('SELECT * FROM partner_reminders WHERE active = 1').all(); }
  catch { return { sent: 0 }; }
  if (!reminders.length) return { sent: 0 };

  const { y, m, d, h } = plantClock();
  const period = `${y}-${String(m).padStart(2, '0')}`;
  const daysInMonth = new Date(y, m, 0).getDate();
  let sent = 0;

  for (const r of reminders) {
    const target = r.day === 'last' ? daysInMonth : Number(r.day);
    if (d !== target || h < r.hour || r.last_sent_period === period) continue;
    const partner = db.prepare('SELECT * FROM partner_accounts WHERE id = ?').get(r.partner_id);
    if (!partner) continue;

    // The live number, credit applied — same arithmetic as the Balance tab.
    let balance = '';
    try {
      const rec = currentReconciliation(db, partner.id, endOfMonth());
      const { credit, appliedToDate } = creditFor(db, partner.id);
      const net = credit ? applyCredit(rec, credit, appliedToDate) : rec;
      const docs = rec.counts ? (rec.counts.receivable + rec.counts.payable) : 0;
      balance = net.net_amount > 0
        ? `\nCurrent balance: ${net.owed_to === 'us' ? `${partner.name} owes Powder Ops` : `Powder Ops owes ${partner.name}`} $${Number(net.net_amount).toLocaleString('en-US', { minimumFractionDigits: 2 })} across ${docs} document${docs === 1 ? '' : 's'}.`
        : '\nCurrent balance: nothing due to settle.';
    } catch { /* the reminder still goes; the number is a courtesy */ }

    const path = '/?tab=partner-reconciliation';
    try {
      const { bot, dm } = botDm(db, r.user_id);
      await postMessageAs(db, dm, bot,
        `⏰ *${partner.name} reconciliation reminder*\n${r.message}${balance}\n[Open Partner Reconciliation](${readyDocOrigin()}${path})`);
      db.prepare("UPDATE partner_reminders SET last_sent_period = ?, updated_at = datetime('now') WHERE id = ?")
        .run(period, r.id);
      pushToUser(r.user_id, {
        title: `${partner.name}: ${r.message}`.slice(0, 60),
        body: balance.replace(/\n/g, ' ').trim().slice(0, 120) || 'Open the Partner Reconciliation tab.',
        tag: `partner-reminder-${r.id}`, renotify: true, url: path,
      }).catch(() => {});
      sent++;
    } catch (e) {
      console.warn('[partners] reminder DM failed (will retry next hour):', e.message);
    }
  }
  return { sent };
}

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
