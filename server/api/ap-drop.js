// AP Drop — one place to hand in a finance PDF, and the queue it waits in.
//
// Any signed-in person can DROP (a vendor invoice somebody emailed them, a
// credit memo, a remittance, an M4 invoice pack); the office WORKS the queue.
// The email box ap@powder-ops.com is the parallel front door and this is its
// in-app twin — same row, same statuses, `source` says which door.
//
// Three rules that shape it:
//
//  * THE FILE IS THE RECORD. It is stored first, hashed, and the row exists
//    before any reading of it is attempted. A parse that fails still leaves a
//    row in the queue reading "failed" — an upload that bounced because the
//    PDF was a scan is exactly the invoice that goes missing.
//  * THE PARSER SUGGESTS. `ap-drop-parse.js` is pure; what it read lands in
//    the editable fields WITH the line each value came from (`parsed_json`),
//    and the office corrects it on the detail pane. A blank is never filled
//    with a guess.
//  * NOTHING LEAVES READYDOC. No QuickBooks bill, no email, no payment. The
//    Controller's tooling polls the audit log (`ap_drop` / `create`) and
//    writes `qbo_bill_id` / `external_ref` back when it has linked one.
//  * ONE DROP, SCANNED, ROUTED. A drop that names a reconciliation partner
//    (M4) on its vendor or bill-to line, in what the submitter typed, or in
//    the filename becomes a DRAFT on the Partner Reconciliation ledger with
//    the same file — Jake's re-keying step, done by the reader. The drop row
//    stays and records which ledger document it became. A partner mentioned
//    only in the body text is a question (`needs_info` "M4 partner?"), never
//    a draft. Same bytes twice, or the same number and amount already on the
//    ledger, link the existing document rather than filing a second one.
//    Draft only: nothing here approves, settles or voids.
//
// Access: mounted WITHOUT requireModuleWrite, the QMS-filing arrangement,
// because uploading has to be open to whoever is holding the invoice. Reading
// the whole queue and moving a row past `new` is the office's — admins, the
// `ap-drop` edit grant (the finance flag), or an office/admin supervisor, the
// reimbursements `canSettle` shape. Everyone else sees their own drops.
import { Router } from 'express';
import multer from 'multer';
import { createHash } from 'crypto';
import { v4 as uuid } from 'uuid';
import { getDb, logAudit } from '../db.js';
import { storageEnabled, putObject, presignGet, getObjectBuffer } from '../storage.js';
import { extractInvoiceText } from '../invoice-text.js';
import { parseFinanceDocument, notAVendor } from '../ap-drop-parse.js';
import { detectPartner } from '../ap-drop-route.js';
import { dueDateFor } from '../partner-recon.js';
import { moduleLevel } from '../module-access.js';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024, files: 10 } });

// `to_partner_ar` and `receivable_other` (D-160) are money owed TO us. A drop
// is the AP queue's, and a receivable sitting in Outstanding reads as a bill we
// owe — so both are terminal: the first is set by routing when the ledger copy
// is a receivable, the second by the office for a non-partner customer.
// Neither is ever in_qbo / in_payment_run, the only statuses the Controller's
// payment tooling reads.
export const STATUSES = ['new', 'triaged', 'matched', 'in_qbo', 'in_payment_run', 'paid', 'closed', 'needs_info', 'duplicate_suspect', 'not_finance', 'to_partner_ar', 'receivable_other'];
export const TERMINAL = new Set(['paid', 'closed', 'not_finance', 'to_partner_ar', 'receivable_other']);
// A status that takes the row out of the ordinary flow has to say why.
const NEEDS_REASON = new Set(['needs_info', 'not_finance', 'duplicate_suspect', 'receivable_other']);
// Set by routing, never picked from the status list: it asserts a ledger
// document exists, and only routing knows that.
const ROUTING_ONLY = new Set(['to_partner_ar']);
// A near-duplicate (D-160): same party, same reference, within a dollar,
// inside a day — a second upload of one invoice with a re-typed total.
const NEAR_DUP_HOURS = 24;
const NEAR_DUP_DOLLARS = 1.0;
const DIRECTION_QUESTION = 'Receivable or payable?';
const EDITABLE = ['vendor_name', 'invoice_number', 'invoice_date', 'due_date', 'amount', 'currency', 'po_or_co_ref', 'bill_to', 'notes', 'qbo_bill_id', 'payment_run_id', 'external_ref'];
const DUPLICATE_WINDOW_DAYS = 30;
// How long the upload waits on the reader before answering. The row is already
// written; a slow OCR finishes in the background and updates it.
const PARSE_WAIT_MS = 15000;

export const canWorkQueue = (u) => u?.role === 'admin'
  || moduleLevel(u, 'ap-drop') === 'edit'
  || (u?.role === 'supervisor' && ['office', 'admin'].includes((u?.department || '').toLowerCase()));

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
const today = () => new Date().toISOString().slice(0, 10);
const daysBetween = (a, b) => Math.floor((Date.parse(b) - Date.parse(a)) / 86400000);
const num = (v) => { if (v === '' || v == null) return null; const n = Number(String(v).replace(/[$,\s]/g, '')); return Number.isFinite(n) ? n : null; };
const isoDate = (v) => (v && /^\d{4}-\d{2}-\d{2}/.test(String(v)) ? String(v).slice(0, 10) : null);

function event(db, dropId, user, kind, detail) {
  db.prepare('INSERT INTO ap_drop_events (id, drop_id, by_user_id, by_name, kind, detail) VALUES (?, ?, ?, ?, ?, ?)')
    .run(uuid(), dropId, user?.id || null, user?.name || 'system', kind, detail ? JSON.stringify(detail) : null);
}

// What the client gets. Age and overdue are DERIVED on every read — a stored
// age is wrong by tomorrow. `extracted_text` never leaves the server.
function shape(r, user) {
  if (!r) return null;
  const { extracted_text, parsed_json, partner_route, ...rest } = r;
  const parsed = (() => { try { return parsed_json ? JSON.parse(parsed_json) : null; } catch { return null; } })();
  const route = (() => { try { return partner_route ? JSON.parse(partner_route) : null; } catch { return null; } })();
  const t = today();
  const open = !TERMINAL.has(r.status);
  return {
    ...rest,
    parsed,
    partner_route: route,
    age_days: daysBetween(r.created_at.slice(0, 10), t),
    overdue: open && !!r.due_date && r.due_date < t,
    outstanding: open,
    searchable: !!(extracted_text && extracted_text.trim()),
    can_work: canWorkQueue(user),
    is_mine: !!user && (r.created_by_user_id === user.id),
  };
}

function loadDrop(db, id) {
  return db.prepare('SELECT * FROM ap_drops WHERE id = ?').get(id);
}

// Apply what the reader found to a row that still has those fields BLANK. A
// value somebody has typed is never overwritten by a re-read — the same rule
// the supply-invoice total follows (`total_source`).
function applyParse(db, id, parsed) {
  const row = loadDrop(db, id);
  if (!row) return;
  const f = parsed.fields || {};
  const set = [];
  const params = [];
  const put = (col, v) => { if (v != null && v !== '' && (row[col] == null || row[col] === '')) { set.push(`${col} = ?`); params.push(v); } };
  put('vendor_name', f.vendor);
  put('invoice_number', f.invoice_number);
  put('invoice_date', f.invoice_date);
  // A due date printed BEFORE the invoice date is a misread or a stale field
  // (I136: due 26 May on a 24 Sep invoice). Left blank, with a note on the
  // parse; the ledger copy takes the partner's terms instead (D-160). A due
  // date a person typed is never touched — `put` only fills blanks.
  // The reader already drops one before the PRINTED date; this catches one
  // before a date a person typed.
  const issued = row.invoice_date || f.invoice_date;
  if (f.due_date && issued && f.due_date < issued) {
    parsed.notes = [...(parsed.notes || []), `Due date ${f.due_date} is before the invoice date ${issued}; not applied.`];
    parsed.due_date_ignored = { parsed: f.due_date, issued };
  } else put('due_date', f.due_date);
  put('amount', f.total);
  put('currency', f.currency);
  put('po_or_co_ref', f.order_refs?.length ? f.order_refs.join(', ') : null);
  put('bill_to', f.bill_to);
  set.push('parse_status = ?', 'parsed_json = ?', "updated_at = datetime('now')");
  params.push(parsed.status, JSON.stringify(parsed), id);
  db.prepare(`UPDATE ap_drops SET ${set.join(', ')} WHERE id = ?`).run(...params);
}

async function readAndApply(id, buffer, contentType, filename) {
  const db = getDb();
  let text = '';
  try { text = await extractInvoiceText(buffer, contentType, filename); } catch { text = ''; }
  const parsed = parseFinanceDocument(text);
  const tx = db.transaction(() => {
    db.prepare('UPDATE ap_drops SET extracted_text = ? WHERE id = ?').run(text || '', id);
    applyParse(db, id, parsed);
    event(db, id, null, 'parsed', { status: parsed.status, fields_read: Object.entries(parsed.fields || {}).filter(([, v]) => v != null && v !== '' && !(Array.isArray(v) && !v.length)).map(([k]) => k), reason: parsed.reason, notes: parsed.notes || undefined });
  });
  tx();
  // A near-duplicate is flagged BEFORE routing, and is not routed: two
  // uploads of one invoice must not become two documents on the ledger.
  try { if (flagNearDuplicate(db, id)) return parsed; } catch (err) { console.warn('[ap-drop] near-duplicate check failed:', err.message); }
  // Routing runs AFTER the read so it sees the vendor and bill-to lines, and
  // is its own try: a ledger hiccup must never turn a read drop into a failed
  // one. It runs on the reparse path too, and is a no-op once routed.
  try { await routeToPartner(db, id, { buffer }); } catch (err) { console.warn('[ap-drop] partner routing failed:', err.message); }
  return parsed;
}

// ── Routing to the partner ledger ────────────────────────────────────────────
//
// `typed` is what the SUBMITTER wrote on the drop form, kept apart from what
// the reader filled in: a person typing "M4" is a party-identifying fact, a
// reference the reader found on page two is not. The columns cannot tell the
// two apart after the fact, so the upload records what was typed on the
// `uploaded` event and this reads it back from there.
function typedOn(db, id) {
  const ev = db.prepare("SELECT detail FROM ap_drop_events WHERE drop_id = ? AND kind = 'uploaded' ORDER BY at ASC LIMIT 1").get(id);
  try { return ev?.detail ? (JSON.parse(ev.detail).typed || {}) : {}; } catch { return {}; }
}

function activePartners(db) {
  try { return db.prepare('SELECT id, name, code, terms_days FROM partner_accounts WHERE is_active = 1').all(); } catch { return []; }
}

// The ledger document this drop should attach to, if one already exists. The
// same bytes dropped twice — by two people, or forwarded again next month —
// must not put the same invoice on the ledger twice: that doubles what is
// owed, with a plausible number nobody catches. Same rule the partner
// importer applies on number + amount (`findExistingDoc` there).
function existingPartnerDoc(db, row, partnerId) {
  const viaHash = db.prepare(`SELECT d.* FROM ap_drops a JOIN partner_documents d ON d.id = a.partner_document_id
      WHERE a.content_sha256 = ? AND a.id != ? AND d.partner_id = ? AND d.status != 'void' ORDER BY a.created_at ASC LIMIT 1`)
    .get(row.content_sha256, row.id, partnerId);
  if (viaHash) return { doc: viaHash, how: 'same file' };
  if (row.invoice_number && row.amount != null) {
    const viaNumber = db.prepare(`SELECT * FROM partner_documents WHERE partner_id = ? AND doc_number = ? AND ABS(amount - ?) < 0.005 AND status != 'void' LIMIT 1`)
      .get(partnerId, String(row.invoice_number), Number(row.amount));
    if (viaNumber) return { doc: viaNumber, how: 'same number and amount' };
  }
  return null;
}

// ── Near-duplicates (D-160) ─────────────────────────────────────────────────
//
// Same bytes is caught at upload. This is the other case: Jake's 23 Sep pair,
// $7,464.34 and $7,464.49 on PO-01231 four minutes apart — one invoice saved
// twice, so the bytes differ. Same party (detected partner, or the same vendor
// name), the SAME reference once case and spaces are ignored (never a prefix
// match), within a dollar, inside a day. Flagged and linked to the earlier
// row, never deleted, never routed; the office confirms (route-partner) or
// closes it.
// A reference the reader filed is "PO PO-01231" (kind + value); one a person
// typed is "PO-01231". The leading kind word goes, then case and spaces —
// equality after that, never a prefix match.
export const normRef = (v) => String(v || '').trim().replace(/^(?:po|co)\s+/i, '').toLowerCase().replace(/\s+/g, '');

function partnerIdOf(db, row, partners) {
  try { const r = row.partner_route ? JSON.parse(row.partner_route) : null; if (r?.partner?.id) return r.partner.id; } catch { /* fall through */ }
  const det = detectPartner({
    partners,
    fields: { vendor_name: row.vendor_name, bill_to: row.bill_to, po_or_co_ref: row.po_or_co_ref, notes: row.notes, filename: row.filename },
    typed: typedOn(db, row.id),
    text: row.extracted_text || '',
  });
  return det.confidence === 'high' ? det.partner?.id || null : null;
}

export function findNearDuplicate(db, row, { partners = activePartners(db) } = {}) {
  const ref = normRef(row.po_or_co_ref);
  if (!ref || row.amount == null) return null;
  const candidates = db.prepare(`SELECT * FROM ap_drops WHERE id != ? AND content_sha256 != ?
      AND created_at >= datetime(?, ?) AND created_at <= ? AND amount IS NOT NULL AND ABS(amount - ?) <= ?
    ORDER BY created_at ASC, rowid ASC`)
    .all(row.id, row.content_sha256, row.created_at, `-${NEAR_DUP_HOURS} hours`, row.created_at, Number(row.amount), NEAR_DUP_DOLLARS + 0.0001);
  const vendor = String(row.vendor_name || '').trim().toLowerCase();
  let mine;
  for (const c of candidates) {
    if (normRef(c.po_or_co_ref) !== ref) continue;
    const sameVendor = vendor && String(c.vendor_name || '').trim().toLowerCase() === vendor;
    if (!sameVendor) {
      if (mine === undefined) mine = partnerIdOf(db, row, partners);
      if (!mine || partnerIdOf(db, c, partners) !== mine) continue;
    }
    return c;
  }
  return null;
}

function flagNearDuplicate(db, id) {
  const row = loadDrop(db, id);
  if (!row || row.status !== 'new' || row.duplicate_of || row.partner_document_id) return false;
  const prior = findNearDuplicate(db, row);
  if (!prior) return false;
  const mins = Math.round((Date.parse(row.created_at.replace(' ', 'T') + 'Z') - Date.parse(prior.created_at.replace(' ', 'T') + 'Z')) / 60000);
  const fmt = (n) => `$${Number(n).toFixed(2)}`;
  const reason = `Near-duplicate of ${prior.id.slice(0, 8)}: same ref, ${fmt(prior.amount)} vs ${fmt(row.amount)}, ${mins} min apart`;
  db.transaction(() => {
    db.prepare("UPDATE ap_drops SET status = 'duplicate_suspect', status_reason = ?, duplicate_of = ?, updated_at = datetime('now') WHERE id = ?").run(reason, prior.id, id);
    event(db, id, null, 'near_duplicate', { duplicate_of: prior.id, ref: row.po_or_co_ref, amount: row.amount, prior_amount: prior.amount, minutes_apart: mins });
  })();
  logAudit('system:ap-drop', 'ap_drop_status', 'ap_drop', id,
    { event: 'ap_drop.near_duplicate', from: 'new', to: 'duplicate_suspect', duplicate_of: prior.id, reason }, null, null, row.filename);
  return true;
}

// ── A receivable leaves AP (D-160) ──────────────────────────────────────────
//
// Once the ledger holds the document as a RECEIVABLE, the AP queue has nothing
// left to do with it: the money is owed to us and is settled on Partner
// Reconciliation. Idempotent (already moved ⇒ nothing written), and a status a
// person set — paid, closed, not finance — or a duplicate flag still waiting on
// a look is left alone. If somebody later flips the ledger document to payable
// on Partner Recon the drop stays here as it is; there is no sync back, by
// decision — the ledger is where that correction lives.
function moveReceivableOff(db, id, { user = null, partner, doc, forced = false }) {
  const row = loadDrop(db, id);
  if (!row || !doc || doc.direction !== 'receivable') return false;
  if (row.status === 'to_partner_ar' || TERMINAL.has(row.status)) return false;
  if (row.status === 'duplicate_suspect' && !forced) return false;
  const reason = `Receivable — on ${partner.name} ledger as ${doc.doc_number || doc.id.slice(0, 8)}`;
  db.transaction(() => {
    db.prepare("UPDATE ap_drops SET status = 'to_partner_ar', status_reason = ?, closed_at = ?, updated_at = datetime('now') WHERE id = ?")
      .run(reason, new Date().toISOString(), id);
    event(db, id, user, 'status_changed', { from: row.status, to: 'to_partner_ar', reason, auto: true });
  })();
  logAudit(user || 'system:ap-drop', 'ap_drop_status', 'ap_drop', id,
    { event: 'ap_drop.to_partner_ar', from: row.status, to: 'to_partner_ar', reason, partner_document_id: doc.id, auto: true },
    { status: row.status }, { status: 'to_partner_ar' }, row.filename);
  return true;
}

/**
 * Decide whether the drop is a partner's document and, when it is, put a DRAFT
 * of it on the partner ledger with the same file. Idempotent: a drop already
 * linked is left alone. `force` is the office saying "yes, it is M4" on a
 * low-confidence drop (the `route-partner` endpoint); it may also name the
 * partner and the direction.
 */
export async function routeToPartner(db, id, { buffer = null, user = null, force = null } = {}) {
  const row = loadDrop(db, id);
  if (!row || row.partner_document_id) return { routed: false, reason: row ? 'already routed' : 'no such drop' };
  const partners = activePartners(db);
  const det = detectPartner({
    partners,
    fields: { vendor_name: row.vendor_name, bill_to: row.bill_to, po_or_co_ref: row.po_or_co_ref, notes: row.notes, filename: row.filename },
    typed: typedOn(db, id),
    text: row.extracted_text || '',
  });
  let partner = det.partner, direction = det.direction, confidence = det.confidence;
  if (force) {
    partner = (force.partner_id && partners.find(p => p.id === force.partner_id)) || det.partner || partners[0] || null;
    if (!partner) return { routed: false, reason: 'no partner to route to' };
    // The office answering "yes, it is theirs" has not said which way the
    // money goes. Never assumed (D-160): without a direction it is refused.
    direction = ['receivable', 'payable'].includes(force.direction) ? force.direction : (det.direction || null);
    if (!direction) return { routed: false, needs_direction: true, reason: 'say whether it is a receivable (they owe us) or a payable (we owe them)' };
    confidence = 'high';
  }
  const verdict = { ...det, partner: partner ? { id: partner.id, name: partner.name } : null, confidence, direction, forced: !!force, decided_at: new Date().toISOString() };
  if (!partner) return { routed: false, reason: det.reason };

  if (confidence === 'low') {
    // A question on the queue, not a number on the ledger. Only a row still
    // reading `new` is parked — a duplicate suspect keeps its own flag.
    db.prepare('UPDATE ap_drops SET partner_route = ? WHERE id = ?').run(JSON.stringify(verdict), id);
    if (row.status === 'new') {
      const reason = `${partner.name} partner? ${det.reason} Say yes to put it on the partner ledger, or move it on if it is not theirs.`;
      db.prepare("UPDATE ap_drops SET status = 'needs_info', status_reason = ?, updated_at = datetime('now') WHERE id = ?").run(reason, id);
      event(db, id, null, 'partner_uncertain', { partner: partner.name, matched_text: det.matched_text, reason: det.reason });
    }
    return { routed: false, reason: 'uncertain', partner: partner.name };
  }

  // High confidence on WHO, but nothing says which way: ask (D-160). Parked
  // the same way the low-confidence question is, once.
  if (!direction) {
    db.prepare('UPDATE ap_drops SET partner_route = ? WHERE id = ?').run(JSON.stringify(verdict), id);
    if (row.status === 'new') {
      const reason = `${DIRECTION_QUESTION} (${partner.name}) ${det.reason}`.trim();
      db.prepare("UPDATE ap_drops SET status = 'needs_info', status_reason = ?, updated_at = datetime('now') WHERE id = ?").run(reason, id);
      event(db, id, null, 'needs_direction', { partner: partner.name, matched_on: det.matched_on, matched_text: det.matched_text });
    }
    return { routed: false, reason: 'direction unclear', needs_direction: true, partner: partner.name };
  }

  // High confidence: link what is already on the ledger, or file a draft.
  const existing = existingPartnerDoc(db, row, partner.id);
  let docId, created = false, how = existing?.how || null, dueCorrected = null;
  if (existing) {
    docId = existing.doc.id;
  } else {
    if (!storageEnabled()) return { routed: false, reason: 'storage off' };
    docId = uuid();
    // The ledger's copy is its own object. A partner document may be deleted
    // by an admin and that purges its file; sharing the key would take the
    // drop's evidence with it. Same bytes, second key.
    const buf = buffer || await getObjectBuffer(row.storage_key);
    if (!buf) return { routed: false, reason: 'stored file could not be read back' };
    const safe = (row.filename || 'file').replace(/[^\w.-]+/g, '_').slice(0, 120);
    const key = `partners/${partner.id}/${docId}-${safe}`;
    await putObject(key, buf, row.content_type || 'application/octet-stream');
    const issued = row.invoice_date || today();
    // A due date before the issue date is not a due date (I136): the partner's
    // terms decide the ledger copy's, and the drop keeps what it was given.
    let due = row.due_date || dueDateFor(issued, partner.terms_days);
    if (row.due_date && row.due_date < issued) {
      due = dueDateFor(issued, partner.terms_days);
      dueCorrected = { parsed: row.due_date, used: due, terms_days: partner.terms_days };
    }
    const description = [`Routed from AP Drop (${row.submitter || 'unknown'}, ${row.created_at.slice(0, 10)})`, row.notes ? `Note: ${row.notes}` : null].filter(Boolean).join(' — ').slice(0, 1000);
    db.prepare(`INSERT INTO partner_documents
      (id, partner_id, direction, doc_type, doc_number, reference, description, issued_date, terms_days, due_date, amount, status,
       storage_key, filename, content_type, size, extracted_text, source, created_by)
      VALUES (?,?,?,'invoice',?,?,?,?,?,?,?,'draft',?,?,?,?,?,'ap-drop',?)`)
      .run(docId, partner.id, direction, row.invoice_number ? String(row.invoice_number).slice(0, 80) : null,
        row.po_or_co_ref ? String(row.po_or_co_ref).slice(0, 120) : null, description, issued, partner.terms_days, due,
        row.amount != null ? Number(row.amount) : 0, key, (row.filename || 'file').slice(0, 255), row.content_type || null, row.size || null,
        row.extracted_text ? String(row.extracted_text).slice(0, 400000) : null, row.submitter || user?.name || 'AP Drop');
    created = true;
    logAudit(user || 'system:ap-drop', 'create', 'partner_document', docId,
      { routed_from_drop: id, direction, amount: row.amount, doc_number: row.invoice_number, filename: row.filename, matched_on: det.matched_on, forced: !!force },
      null, null, partner.name);
  }
  db.prepare("UPDATE ap_drops SET partner_document_id = ?, partner_route = ?, updated_at = datetime('now') WHERE id = ?")
    .run(docId, JSON.stringify(verdict), id);
  event(db, id, user, 'routed_partner', { partner: partner.name, document_id: docId, created, linked_how: how, direction, matched_on: det.matched_on, matched_text: det.matched_text, forced: !!force });
  if (dueCorrected) event(db, id, user, 'due_date_corrected', dueCorrected);
  logAudit(user || 'system:ap-drop', 'ap_drop_routed', 'ap_drop', id,
    { event: 'ap_drop.routed', partner: partner.name, partner_document_id: docId, created, linked_how: how, direction, matched_on: det.matched_on, forced: !!force },
    null, null, row.filename);
  // The ledger document's OWN direction decides — a link to a hand-keyed
  // document says what is actually on the ledger.
  const doc = db.prepare('SELECT id, doc_number, direction FROM partner_documents WHERE id = ?').get(docId);
  const cleared = moveReceivableOff(db, id, { user, partner, doc, forced: !!force });
  return { routed: true, created, document_id: docId, partner: partner.name, direction: doc?.direction || direction, to_partner_ar: cleared };
}

// ── Drop ────────────────────────────────────────────────────────────────────

router.post('/', upload.array('files', 10), async (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Sign in to drop a file.' });
  if (!storageEnabled()) return res.status(503).json({ error: 'File storage is not configured on this server, so nothing can be dropped yet.' });
  const files = req.files || [];
  if (!files.length) return res.status(400).json({ error: 'Nothing was attached. Drop a PDF or photograph of the document.' });
  const db = getDb();
  const b = req.body || {};
  const created = [];
  for (const f of files) {
    const id = uuid();
    const hash = sha256(f.buffer);
    const key = `ap-drop/${id}-${(f.originalname || 'file').replace(/[^\w.-]+/g, '_')}`;
    await putObject(key, f.buffer, f.mimetype);
    // The same bytes handed in twice within the window is almost always the
    // same invoice forwarded by two people. It is still filed — silently
    // dropping it would lose the second submitter's note — but flagged and
    // linked to the first, so the queue shows one bill, not two.
    const prior = db.prepare(`SELECT id FROM ap_drops WHERE content_sha256 = ? AND created_at >= datetime('now', ?) ORDER BY created_at ASC LIMIT 1`)
      .get(hash, `-${DUPLICATE_WINDOW_DAYS} day`);
    const status = prior ? 'duplicate_suspect' : 'new';
    db.transaction(() => {
      db.prepare(`INSERT INTO ap_drops (id, created_by_user_id, submitter, source, filename, storage_key, size, content_type, content_sha256,
          vendor_name, po_or_co_ref, amount, due_date, notes, status, status_reason, duplicate_of)
        VALUES (?, ?, ?, 'drop', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(id, req.user.id, String(b.submitter || req.user.name).slice(0, 120), f.originalname || 'file', key, f.size, f.mimetype, hash,
          String(b.vendor_name || '').trim() || null, String(b.po_or_co_ref || '').trim() || null, num(b.amount), isoDate(b.due_date),
          String(b.notes || '').trim() || null, status, prior ? `Same file was dropped on an earlier row (${prior.id.slice(0, 8)})` : null, prior?.id || null);
      event(db, id, req.user, 'uploaded', {
        filename: f.originalname, size: f.size, duplicate_of: prior?.id || null,
        // What the person wrote, as opposed to what the reader will fill in —
        // the routing rule treats the two differently.
        typed: { vendor_name: String(b.vendor_name || '').trim() || null, po_or_co_ref: String(b.po_or_co_ref || '').trim() || null, notes: String(b.notes || '').trim() || null },
      });
      if (prior) event(db, prior.id, req.user, 'duplicate_dropped', { again_as: id });
    })();
    // `event: 'ap_drop.created'` is what outside automation polls the audit
    // log for; the canonical action is `create` on entity `ap_drop`.
    logAudit(req.user, 'ap_drop_created', 'ap_drop', id,
      { event: 'ap_drop.created', filename: f.originalname, size: f.size, sha256: hash, status, duplicate_of: prior?.id || null },
      null, null, f.originalname);

    // The reader runs now but the upload does not wait on it forever: a scan
    // through vision OCR can take a while, and the row is already filed.
    const reading = readAndApply(id, f.buffer, f.mimetype, f.originalname).catch(err => {
      console.warn('[ap-drop] parse failed:', err.message);
      try { getDb().prepare("UPDATE ap_drops SET parse_status = 'failed', updated_at = datetime('now') WHERE id = ? AND parse_status = 'pending'").run(id); } catch { /* ignore */ }
    });
    await Promise.race([reading, new Promise(r => setTimeout(r, PARSE_WAIT_MS))]);
    created.push(shape(loadDrop(db, id), req.user));
  }
  res.status(201).json({ drops: created });
});

// ── Queue ────────────────────────────────────────────────────────────────────

router.get('/meta', (req, res) => {
  const db = getDb();
  const work = canWorkQueue(req.user);
  const scope = work ? '' : ' WHERE created_by_user_id = ?';
  const p = work ? [] : [req.user?.id || ''];
  const vendors = db.prepare(`SELECT DISTINCT vendor_name FROM ap_drops${scope ? scope + ' AND' : ' WHERE'} vendor_name IS NOT NULL ORDER BY vendor_name`).all(...p).map(r => r.vendor_name);
  const submitters = db.prepare(`SELECT DISTINCT submitter FROM ap_drops${scope ? scope + ' AND' : ' WHERE'} submitter IS NOT NULL ORDER BY submitter`).all(...p).map(r => r.submitter);
  const counts = {};
  for (const r of db.prepare(`SELECT status, COUNT(*) n FROM ap_drops${scope} GROUP BY status`).all(...p)) counts[r.status] = r.n;
  res.json({ statuses: STATUSES, terminal: [...TERMINAL], vendors, submitters, counts, can_work: work, storage_enabled: storageEnabled(), inbox_email: 'ap@powder-ops.com' });
});

router.get('/', (req, res) => {
  const db = getDb();
  const q = req.query || {};
  const work = canWorkQueue(req.user);
  let sql = 'SELECT * FROM ap_drops WHERE 1=1';
  const params = [];
  if (!work) { sql += ' AND created_by_user_id = ?'; params.push(req.user?.id || ''); }
  // `outstanding` is the default landing: everything not paid, closed or
  // rejected. `all` lifts it; a named status narrows to exactly that.
  if (q.status && q.status !== 'all' && q.status !== 'outstanding') { sql += ' AND status = ?'; params.push(q.status); }
  else if (q.status !== 'all') { sql += ` AND status NOT IN (${[...TERMINAL].map(() => '?').join(',')})`; params.push(...TERMINAL); }
  if (q.vendor) { sql += ' AND vendor_name = ?'; params.push(q.vendor); }
  if (q.submitter) { sql += ' AND submitter = ?'; params.push(q.submitter); }
  if (q.from) { sql += ' AND created_at >= ?'; params.push(q.from); }
  if (q.to) { sql += ' AND created_at < date(?, \'+1 day\')'; params.push(q.to); }
  if (q.overdue === '1' || q.overdue === 'true') { sql += ' AND due_date IS NOT NULL AND due_date < ?'; params.push(today()); }
  if (q.needs_info === '1' || q.needs_info === 'true') sql += " AND status = 'needs_info'";
  if (q.q && String(q.q).trim()) {
    sql += ` AND (LOWER(COALESCE(vendor_name,'')) LIKE LOWER(?) OR LOWER(COALESCE(invoice_number,'')) LIKE LOWER(?)
      OR LOWER(COALESCE(po_or_co_ref,'')) LIKE LOWER(?) OR LOWER(COALESCE(notes,'')) LIKE LOWER(?) OR LOWER(filename) LIKE LOWER(?)
      OR LOWER(COALESCE(extracted_text,'')) LIKE LOWER(?))`;
    const like = `%${String(q.q).trim()}%`;
    params.push(like, like, like, like, like, like);
  }
  const limit = Math.min(Math.max(parseInt(q.limit, 10) || 500, 1), 2000);
  sql += ' ORDER BY created_at DESC LIMIT ?';
  params.push(limit);
  res.json(db.prepare(sql).all(...params).map(r => shape(r, req.user)));
});

router.get('/recent', (req, res) => {
  const db = getDb();
  const work = canWorkQueue(req.user);
  const rows = work
    ? db.prepare('SELECT * FROM ap_drops ORDER BY created_at DESC LIMIT 10').all()
    : db.prepare('SELECT * FROM ap_drops WHERE created_by_user_id = ? ORDER BY created_at DESC LIMIT 10').all(req.user?.id || '');
  res.json(rows.map(r => shape(r, req.user)));
});

// ── One drop ────────────────────────────────────────────────────────────────

function loadFor(req, res) {
  const db = getDb();
  const row = loadDrop(db, req.params.id);
  if (!row) { res.status(404).json({ error: 'Not found' }); return null; }
  if (!canWorkQueue(req.user) && row.created_by_user_id !== req.user?.id) { res.status(404).json({ error: 'Not found' }); return null; }
  return row;
}

router.get('/:id', async (req, res) => {
  const row = loadFor(req, res); if (!row) return;
  const db = getDb();
  const events = db.prepare('SELECT id, at, by_name, kind, detail FROM ap_drop_events WHERE drop_id = ? ORDER BY at ASC, rowid ASC').all(row.id)
    .map(e => ({ ...e, detail: e.detail ? JSON.parse(e.detail) : null }));
  const duplicate_of = row.duplicate_of ? shape(loadDrop(db, row.duplicate_of), req.user) : null;
  const partner_document = row.partner_document_id
    ? (db.prepare(`SELECT d.id, d.doc_number, d.direction, d.status, d.amount, d.due_date, d.filename, d.settlement_id, p.name AS partner_name, p.id AS partner_id
        FROM partner_documents d JOIN partner_accounts p ON p.id = d.partner_id WHERE d.id = ?`).get(row.partner_document_id) || null)
    : null;
  const file_url = await (async () => { try { return storageEnabled() ? await presignGet(row.storage_key, row.filename) : null; } catch { return null; } })();
  res.json({ ...shape(row, req.user), events, duplicate_of, partner_document, file_url });
});

// Editing the extracted fields is the office's. Every changed field is one
// activity line, so "who changed the amount" is answerable from the pane.
router.put('/:id', (req, res) => {
  const row = loadFor(req, res); if (!row) return;
  if (!canWorkQueue(req.user)) return res.status(403).json({ error: 'Only the office can edit what was read off the document.' });
  const db = getDb();
  const b = req.body || {};
  const set = [], params = [], changed = {};
  for (const k of EDITABLE) {
    if (!(k in b)) continue;
    let v = b[k];
    if (k === 'amount') v = num(v);
    else if (k === 'invoice_date' || k === 'due_date') v = isoDate(v);
    else v = v == null ? null : (String(v).trim() || null);
    if (v === row[k] || (v == null && row[k] == null)) continue;
    set.push(`${k} = ?`); params.push(v); changed[k] = { from: row[k], to: v };
  }
  if (!set.length) return res.json(shape(row, req.user));
  set.push("updated_at = datetime('now')");
  db.transaction(() => {
    db.prepare(`UPDATE ap_drops SET ${set.join(', ')} WHERE id = ?`).run(...params, row.id);
    event(db, row.id, req.user, 'fields_edited', changed);
  })();
  logAudit(req.user, 'ap_drop_updated', 'ap_drop', row.id, changed, row, loadDrop(db, row.id), row.filename);
  res.json(shape(loadDrop(db, row.id), req.user));
});

router.post('/:id/status', (req, res) => {
  const row = loadFor(req, res); if (!row) return;
  if (!canWorkQueue(req.user)) return res.status(403).json({ error: 'Only the office can move a drop through the queue.' });
  const status = String(req.body?.status || '');
  const reason = String(req.body?.reason || '').trim();
  if (!STATUSES.includes(status)) return res.status(400).json({ error: `Unknown status "${status}".` });
  if (ROUTING_ONLY.has(status)) return res.status(400).json({ error: 'A drop moves to Partner Recon by being routed there as a receivable, not by picking the status.' });
  if (NEEDS_REASON.has(status) && reason.length < 3) return res.status(400).json({ error: `Say why it is ${status.replace(/_/g, ' ')} — the reason shows on the queue.` });
  if (status === row.status && !reason) return res.json(shape(row, req.user));
  const db = getDb();
  db.transaction(() => {
    db.prepare(`UPDATE ap_drops SET status = ?, status_reason = ?, closed_at = ?, updated_at = datetime('now') WHERE id = ?`)
      .run(status, reason || null, TERMINAL.has(status) ? new Date().toISOString() : null, row.id);
    event(db, row.id, req.user, 'status_changed', { from: row.status, to: status, reason: reason || null });
  })();
  logAudit(req.user, 'ap_drop_status', 'ap_drop', row.id, { from: row.status, to: status, reason: reason || null }, row, loadDrop(db, row.id), row.filename);
  res.json(shape(loadDrop(db, row.id), req.user));
});

router.post('/:id/notes', (req, res) => {
  const row = loadFor(req, res); if (!row) return;
  const text = String(req.body?.text || '').trim();
  if (!text) return res.status(400).json({ error: 'An empty note says nothing.' });
  const db = getDb();
  event(db, row.id, req.user, 'note', { text: text.slice(0, 2000) });
  db.prepare("UPDATE ap_drops SET updated_at = datetime('now') WHERE id = ?").run(row.id);
  res.status(201).json({ ok: true });
});

// The office answering "M4 partner?" with yes — or routing a drop the reader
// did not recognise. Draft only, same function, same idempotence.
router.post('/:id/route-partner', async (req, res) => {
  const row = loadFor(req, res); if (!row) return;
  if (!canWorkQueue(req.user)) return res.status(403).json({ error: 'Only the office can route a drop to the partner ledger.' });
  if (row.partner_document_id) return res.status(409).json({ error: 'This drop is already on the partner ledger.' });
  const db = getDb();
  const dir = req.body?.direction;
  if (dir != null && dir !== '' && !['receivable', 'payable'].includes(dir)) return res.status(400).json({ error: 'Direction is "receivable" or "payable".' });
  const r = await routeToPartner(db, row.id, { user: req.user, force: { partner_id: req.body?.partner_id || null, direction: dir || null } });
  if (!r.routed) return res.status(400).json({ error: `Could not route it: ${r.reason}.`, needs_direction: !!r.needs_direction });
  // A drop parked as "M4 partner?" / "Receivable or payable?" is answered by
  // routing it, and a confirmed near-duplicate likewise; a row the office
  // routed by hand from `new` moves on to triaged, since somebody just looked
  // at it. A receivable has already left AP (to_partner_ar) and is left there.
  const now = loadDrop(db, row.id);
  if (['needs_info', 'new', 'duplicate_suspect'].includes(now.status)) {
    db.prepare("UPDATE ap_drops SET status = 'triaged', status_reason = NULL, updated_at = datetime('now') WHERE id = ?").run(row.id);
    event(db, row.id, req.user, 'status_changed', { from: now.status, to: 'triaged', reason: `routed to ${r.partner}` });
  }
  res.json({ ...r, drop: shape(loadDrop(db, row.id), req.user) });
});

// D-160: "Not AP — this is a receivable" for a customer who is not a
// reconciliation partner. Terminal, with a reason; no AR module, no ledger.
router.post('/:id/receivable-other', (req, res) => {
  const row = loadFor(req, res); if (!row) return;
  if (!canWorkQueue(req.user)) return res.status(403).json({ error: 'Only the office can take a drop off the AP queue.' });
  if (row.partner_document_id) return res.status(409).json({ error: 'This drop is on the partner ledger; that is where it is worked.' });
  const reason = String(req.body?.reason || '').trim();
  if (reason.length < 3) return res.status(400).json({ error: 'Say who owes it and why it is not a bill — the reason stays on the record.' });
  if (row.status === 'receivable_other') return res.json(shape(row, req.user));
  const db = getDb();
  db.transaction(() => {
    db.prepare("UPDATE ap_drops SET status = 'receivable_other', status_reason = ?, closed_at = ?, updated_at = datetime('now') WHERE id = ?")
      .run(reason, new Date().toISOString(), row.id);
    event(db, row.id, req.user, 'status_changed', { from: row.status, to: 'receivable_other', reason });
  })();
  logAudit(req.user, 'ap_drop_status', 'ap_drop', row.id, { event: 'ap_drop.receivable_other', from: row.status, to: 'receivable_other', reason },
    { status: row.status }, { status: 'receivable_other' }, row.filename);
  res.json(shape(loadDrop(db, row.id), req.user));
});

// Re-run the reader over the stored file — fills BLANK fields only.
router.post('/:id/reparse', async (req, res) => {
  const row = loadFor(req, res); if (!row) return;
  if (!canWorkQueue(req.user)) return res.status(403).json({ error: 'Only the office can re-read a document.' });
  const { getObjectBuffer } = await import('../storage.js');
  const buf = await getObjectBuffer(row.storage_key);
  if (!buf) return res.status(404).json({ error: 'The stored file could not be read back.' });
  const parsed = await readAndApply(row.id, buf, row.content_type, row.filename);
  res.json({ parsed, drop: shape(loadDrop(getDb(), row.id), req.user) });
});


/**
 * Drops already on file whose vendor the READER filled with something that is
 * not a vendor — a markdown table header, a bare country (D-147). Only a value
 * equal to the reader's own `parsed_json.fields.vendor` is touched: a vendor a
 * person typed or corrected is theirs and is never cleared. Idempotent by
 * construction (a cleared row no longer matches). Status is left alone — a
 * drop with no vendor is still on the Outstanding list for a person to name.
 */
export function repairHeaderVendors(db) {
  const rows = db.prepare(`SELECT id, vendor_name, parsed_json FROM ap_drops
    WHERE vendor_name IS NOT NULL AND vendor_name != '' AND parsed_json IS NOT NULL
      AND vendor_name = json_extract(parsed_json, '$.fields.vendor')`).all();
  const cleared = [];
  db.transaction(() => {
    for (const r of rows) {
      if (!notAVendor(r.vendor_name)) continue;
      db.prepare("UPDATE ap_drops SET vendor_name = NULL, updated_at = datetime('now') WHERE id = ?").run(r.id);
      event(db, r.id, null, 'vendor_cleared', { was: r.vendor_name, reason: 'The reader took a table header or a country for the vendor (D-147). A person names the vendor.' });
      logAudit('system', 'update', 'ap_drop', r.id, { vendor_cleared: r.vendor_name, source: 'D-147' }, { vendor_name: r.vendor_name }, { vendor_name: null });
      cleared.push({ id: r.id, was: r.vendor_name });
    }
  })();
  return cleared;
}

export default router;
