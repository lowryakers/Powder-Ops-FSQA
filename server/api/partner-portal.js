// What M4 sees: the same ledger, and a way to hand over their own paperwork.
//
// This is a PUBLIC path guarded by a bearer token in the URL, so the surface is
// deliberately narrow:
//
//   · READ the ledger and the number for their own partner account, so both
//     companies are looking at the same figure rather than two spreadsheets.
//     That is the entire point of the tool — a portal that showed them
//     something different would defeat it.
//   · UPLOAD invoices and POs, which land as DRAFT and marked `partner-portal`.
//     Someone at Powder Ops still has to approve them as final, so a partner
//     cannot put a number into a settlement on their own.
//   · RAISE A DISPUTE, because a disagreement the other side can't record is
//     how this ended up in email in the first place. A dispute only ever
//     removes a document from the number; it cannot add money.
//
// Everything else — approving as final, voiding, settling, creating links — is
// staff-only and simply has no endpoint here.
//
// The token is compared by hash, never stored in the clear, and every call
// stamps last_used_at so a link that is being used (or isn't) is visible.

import { Router } from 'express';
import { createHash, randomUUID as uuid } from 'crypto';
import PDFDocument from 'pdfkit';
import { getDb, logAudit } from '../db.js';
import { presignGet } from '../storage.js';
import { mediaUpload, cleanupTemp, uploadErrorMessage } from '../media.js';
import { applyCredit, round2, lastClosedMonthEnd, monthName, settleReference, openByCloseMonth } from '../partner-recon.js';
import { plantDateOf } from '../plant-clock.js';
import { registerUnicodeFonts, printable } from '../pdf-unicode.js';
import { createDocument, currentReconciliation, creditFor, settlementDetail, portalDoc, creditLedgerFor } from './partners.js';

const router = Router();

const portalUpload = mediaUpload({ files: 10 }).array('files', 10);
const uploadDocs = (req, res, next) => portalUpload(req, res, (err) => {
  if (err) return res.status(413).json({ error: uploadErrorMessage(err) });
  next();
});

const hashToken = (t) => createHash('sha256').update(String(t)).digest('hex');

// Resolve the token on every request rather than trusting anything the client
// sends about who it is.
function partnerFor(req, res) {
  const raw = String(req.params.token || '').trim();
  if (!raw || raw.length < 32) { res.status(404).json({ error: 'This link is not valid.' }); return null; }
  const db = getDb();
  const row = db.prepare('SELECT * FROM partner_portal_tokens WHERE token_hash = ?').get(hashToken(raw));
  if (!row || row.revoked_at) { res.status(403).json({ error: 'This link has been turned off. Ask your contact at Powder Ops for a new one.' }); return null; }
  if (row.expires_at && row.expires_at < new Date().toISOString().slice(0, 10)) {
    res.status(403).json({ error: 'This link has expired.' }); return null;
  }
  const partner = db.prepare('SELECT * FROM partner_accounts WHERE id = ?').get(row.partner_id);
  if (!partner || !partner.is_active) { res.status(404).json({ error: 'Account not found.' }); return null; }
  db.prepare("UPDATE partner_portal_tokens SET last_used_at = datetime('now') WHERE id = ?").run(row.id);
  return { db, partner, token: row };
}

// What the partner reads, from their side of the table. `direction` is
// relabelled: what we call a receivable is what THEY owe, and a column headed
// "receivable" that means the opposite of their books is how a shared number
// stops being shared.
const SIDE = { receivable: 'you_owe', payable: 'you_are_owed' };
const HOW = { credited: 'covered_by_credit', netted: 'netted', paid: 'paid_to_you' };
const theirOwedTo = (net) => (net > 0 ? 'powder-ops' : net < 0 ? 'you' : 'nobody');

// "Today" is the plant's day. A test may pin it, and only a test.
function portalToday() {
  const pinned = process.env.PARTNER_PORTAL_TODAY;
  if (process.env.NODE_ENV === 'test' && /^\d{4}-\d{2}-\d{2}$/.test(pinned || '')) return pinned;
  return plantDateOf(new Date());
}

// The open documents carry their line items and file. The reconcile rows are a
// narrow projection, so these are looked up once for the lot.
function openExtras(db, partnerId) {
  const rows = db.prepare(`SELECT id, line_items, lines_total, storage_key FROM partner_documents
    WHERE partner_id = ? AND settlement_id IS NULL`).all(partnerId);
  const extra = new Map(rows.map(x => [x.id, x]));
  return (d, more = {}) => {
    const x = extra.get(d.id) || {};
    return { ...portalDoc({ ...d, line_items: x.line_items, lines_total: x.lines_total, storage_key: x.storage_key }), side: SIDE[d.direction], ...more };
  };
}

/** A settlement in their words — every document in it and how each cleared. */
function settlementView(db, partner, st) {
  const det = settlementDetail(db, st);
  return {
    id: st.id, period_end: st.period_end, net_amount: st.net_amount, owed_to: st.owed_to, status: st.status,
    paid_at: st.paid_at, payment_reference: st.payment_reference, proof_filename: st.proof_filename,
    document_count: st.document_count,
    basis: st.basis || null,
    reference: settleReference(partner, st.period_end),
    you_owed: st.receivable_total,
    you_were_owed: st.payable_total,
    credit: det.credit && {
      label: det.credit.label, applies_to: det.credit.applies_to,
      side: SIDE[det.credit.direction] || 'you_owe',
      applied: det.credit.drawn_this_period,
      balance_before: det.credit.balance_before, balance_after: det.credit.balance_after,
      side_after_credit: det.credit.side_net_after_credit,
    },
    documents: det.documents.map(d => ({ ...portalDoc(d), side: SIDE[d.direction], how_cleared: HOW[d.how_cleared] })),
  };
}

/**
 * THE LATEST CLOSED MONTH END — what the page leads with.
 *
 * Each month end closes in cash on the documents DUE by it (Net 30); whoever
 * owes pays. So the headline is the `due` reconcile at the last calendar month
 * end on or before today, with the credit applied exactly as the office's
 * settle would apply it — never a running total of everything open, which is
 * no figure either company agreed.
 *
 *   unpaid       documents due by the close are still unsettled
 *   paid         nothing is left over and a settlement was recorded for it
 *   nothing_due  nothing was due by that month end
 */
function closeView(db, partner, closeDate, today) {
  const r = currentReconciliation(db, partner.id, closeDate, 'due');
  const { credit, appliedToDate } = creditFor(db, partner.id);
  const c = credit ? applyCredit(r, credit, appliedToDate) : null;
  const shape = openExtras(db, partner.id);
  const base = {
    period_end: closeDate,
    label: monthName(closeDate, String(today).slice(0, 4)),
    reference: settleReference(partner, closeDate),
  };
  const included = [...r.documents.receivable, ...r.documents.payable];
  if (included.length) {
    const drawOf = new Map((c?.draws || []).map(d => [d.document_id, d.amount]));
    const net = c ? c.net_amount : r.net_amount;
    return {
      r,
      view: {
        ...base,
        status: 'unpaid',
        owed_to: theirOwedTo(net),
        amount: round2(Math.abs(net)),
        you_owe: r.receivable_total,
        you_are_owed: r.payable_total,
        credit: c && c.drawn_this_period > 0 ? {
          label: c.label, applies_to: c.applies_to, side: SIDE[c.direction] || 'you_owe',
          applied: c.drawn_this_period, side_after_credit: c.side_net_after_credit,
        } : null,
        documents: included.map(d => shape(d, { credit_applied: drawOf.get(d.id) || 0 })),
        settlement: null,
      },
    };
  }
  const st = db.prepare(`SELECT * FROM partner_settlements WHERE partner_id = ? AND period_end = ?
    ORDER BY created_at DESC LIMIT 1`).get(partner.id, closeDate);
  if (st) {
    const s = settlementView(db, partner, st);
    return {
      r,
      view: {
        ...base,
        status: 'paid',
        owed_to: theirOwedTo(st.net_amount),
        amount: round2(Math.abs(st.net_amount)),
        you_owe: st.receivable_total,
        you_are_owed: st.payable_total,
        credit: s.credit && s.credit.applied > 0 ? s.credit : null,
        documents: s.documents,
        settlement: { id: st.id, paid_at: st.paid_at, payment_reference: st.payment_reference, proof_filename: st.proof_filename },
      },
    };
  }
  return { r, view: { ...base, status: 'nothing_due', owed_to: 'nobody', amount: 0, you_owe: 0, you_are_owed: 0, credit: null, documents: [], settlement: null } };
}

/** What the partner raised, in the shape their page reads. No office names. */
function reviewsFor(db, partnerId) {
  return db.prepare(`SELECT id, document_id, settlement_id, period_end, note, created_at, resolved_at, resolution
    FROM partner_reviews WHERE partner_id = ? ORDER BY created_at DESC LIMIT 200`).all(partnerId)
    .map(x => ({ ...x, status: x.resolved_at ? 'answered' : 'open' }));
}

router.get('/:token', (req, res) => {
  const ctx = partnerFor(req, res); if (!ctx) return;
  const { db, partner } = ctx;
  const today = portalToday();
  const closeDate = lastClosedMonthEnd(today);
  const { r, view: close } = closeView(db, partner, closeDate, today);
  const shape = openExtras(db, partner.id);

  // Open, not yet due — grouped by the month end each document falls into. A
  // subtotal per side, and deliberately NO net: an open month has no "who pays"
  // until it closes.
  const open = openByCloseMonth(r.documents.excluded).map(g => ({
    period_end: g.period_end,
    label: monthName(g.period_end, today.slice(0, 4)),
    you_owe: g.receivable_total,
    you_are_owed: g.payable_total,
    documents: g.documents.map(d => shape(d)),
  }));
  // Not counted anywhere yet: their uploads waiting to be confirmed, and
  // anything under dispute.
  const waiting = r.documents.excluded
    .filter(d => d.exclusion === 'draft' || d.exclusion === 'disputed')
    .map(d => shape(d));

  const { credit, appliedToDate } = creditFor(db, partner.id);
  const settlementRows = db.prepare(`SELECT * FROM partner_settlements WHERE partner_id = ?
    ORDER BY period_end DESC, created_at DESC LIMIT 24`).all(partner.id);

  res.json({
    partner: { name: partner.name, terms_days: partner.terms_days },
    today,
    close,
    open,
    waiting,
    // An info line, not a figure in any open month: the credit is applied at
    // each close.
    credit_available: credit ? {
      label: credit.label, applies_to: credit.applies_to,
      facility: round2(credit.amount), available: round2(Number(credit.amount || 0) - appliedToDate),
    } : null,
    credit_ledger: credit ? creditLedgerFor(db, credit) : null,
    settlements: settlementRows.map(st => settlementView(db, partner, st)),
    reviews: reviewsFor(db, partner.id),
  });
});

/**
 * "This doesn't look right" — on one document, a settlement, or a month end.
 *
 * Always written down as a review row (who, what, when) that the office answers
 * on Partner Rec. On an UNSETTLED FINAL document it also marks the document
 * disputed, which only ever REMOVES it from the number until it is sorted out.
 * On anything settled it changes no money — a settlement is immutable — it asks
 * the question.
 */
function raiseReview(db, partner, { document_id, settlement_id, period_end, note }) {
  const text = String(note || '').trim().slice(0, 1000);
  if (text.length < 3) return { status: 400, error: 'Say what the disagreement is.' };
  let doc = null, st = null;
  if (document_id) {
    doc = db.prepare('SELECT * FROM partner_documents WHERE id = ? AND partner_id = ?').get(document_id, partner.id);
    if (!doc) return { status: 404, error: 'Document not found' };
  }
  if (settlement_id) {
    st = db.prepare('SELECT * FROM partner_settlements WHERE id = ? AND partner_id = ?').get(settlement_id, partner.id);
    if (!st) return { status: 404, error: 'Settlement not found' };
  }
  const period = /^\d{4}-\d{2}-\d{2}$/.test(String(period_end || '')) ? period_end : (st?.period_end || null);
  if (!doc && !st && !period) return { status: 400, error: 'Say which document or month this is about.' };
  const who = `${partner.name} (portal)`;
  const id = uuid();
  const tx = db.transaction(() => {
    db.prepare(`INSERT INTO partner_reviews (id, partner_id, document_id, settlement_id, period_end, note, raised_by)
      VALUES (?,?,?,?,?,?,?)`).run(id, partner.id, doc?.id || null, st?.id || doc?.settlement_id || null, period, text, who);
    if (doc && !doc.settlement_id && doc.status === 'final') {
      db.prepare(`UPDATE partner_documents SET status = 'disputed', disputed_reason = ?,
          disputed_at = datetime('now'), disputed_by = ? WHERE id = ?`).run(text, who, doc.id);
    }
  });
  tx();
  const disputed = !!(doc && !doc.settlement_id && doc.status === 'final');
  logAudit(who, 'create', 'partner_review', id,
    { note: text, document_id: doc?.id || null, settlement_id: st?.id || null, period_end: period, disputed, via: 'partner-portal' },
    null, null, doc?.doc_number || period || id);
  return { status: 201, id, disputed };
}

router.post('/:token/reviews', (req, res) => {
  const ctx = partnerFor(req, res); if (!ctx) return;
  const r = raiseReview(ctx.db, ctx.partner, req.body || {});
  if (r.error) return res.status(r.status).json({ error: r.error });
  res.status(201).json({ ok: true, id: r.id, disputed: r.disputed });
});

/* ── A month's statement, as a PDF ────────────────────────────────────────── */

const pdfMoney = (n) => (Number(n) || 0).toLocaleString('en-US', { style: 'currency', currency: 'USD' });

function renderStatement(res, partner, s, { closed }) {
  const doc = new PDFDocument({ size: 'LETTER', margin: 50 });
  const F = registerUnicodeFonts(doc);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${s.reference}.pdf"`);
  doc.pipe(res);
  // Once the PDF is streaming there is no sending JSON — a throw here must
  // end one download, never the process.
  try {
    doc.font(F.bold).fontSize(15).text(printable(`${partner.name} ⇄ Powder Ops`));
    doc.font(F.regular).fontSize(11).fillColor('#444')
      .text(`${closed.label} close — documents due by ${s.period_end} (Net ${partner.terms_days ?? 30})`);
    doc.moveDown(0.4).fillColor('#000').font(F.bold).fontSize(12).text(
      s.owed_to === 'powder-ops' ? `${printable(partner.name)} owes Powder Ops ${pdfMoney(s.amount)}`
        : s.owed_to === 'you' ? `Powder Ops owes ${printable(partner.name)} ${pdfMoney(s.amount)}`
          : 'Nothing is owed either way.');
    doc.font(F.regular).fontSize(10).text(
      s.status === 'paid'
        ? `Paid${s.settlement?.paid_at ? ` ${String(s.settlement.paid_at).slice(0, 10)}` : ''}${s.settlement?.payment_reference ? ` · ref ${printable(s.settlement.payment_reference)}` : ''}`
        : s.status === 'unpaid' ? 'Unpaid' : 'Nothing due');
    doc.moveDown(0.8);

    const cols = [50, 140, 215, 290, 420, 562];
    const row = (cells, font = F.regular) => {
      const y = doc.y;
      doc.font(font).fontSize(9);
      cells.forEach((c, i) => doc.text(printable(c), cols[i], y, { width: cols[i + 1] - cols[i] - 6, align: i === 4 ? 'right' : 'left' }));
      doc.y = Math.max(doc.y, y + 13);
      doc.x = 50;
    };
    row(['Document', 'Issued', 'Due', 'Side', 'Amount'], F.bold);
    for (const d of s.documents) {
      if (doc.y > 700) doc.addPage();
      row([d.doc_number || d.description || 'Document', d.issued_date || '—', d.due_date || '—',
        d.side === 'you_owe' ? `${partner.name} owes` : 'Powder Ops owes', pdfMoney(d.signed)]);
    }
    if (!s.documents.length) row(['No documents were due by this month end.', '', '', '', '']);

    doc.moveDown(0.8).font(F.regular).fontSize(10);
    doc.text(`${printable(partner.name)} owed Powder Ops: ${pdfMoney(s.you_owe)}`, 50);
    if (s.credit?.applied > 0) doc.text(`Less ${printable(s.credit.applies_to || '')} credit: ${pdfMoney(s.credit.applied)} (that side comes to ${pdfMoney(s.credit.side_after_credit)})`, 50);
    doc.text(`Powder Ops owed ${printable(partner.name)}: ${pdfMoney(s.you_are_owed)}`, 50);
    doc.font(F.bold).text(`Net: ${pdfMoney(s.amount)} ${s.owed_to === 'powder-ops' ? `payable to Powder Ops` : s.owed_to === 'you' ? `payable to ${printable(partner.name)}` : ''}`, 50);
    doc.moveDown(0.8).font(F.regular).text(
      `Pay to: ${s.owed_to === 'you' ? printable(partner.name) : 'Powder Ops'} · Reference: ${s.reference}`, 50);
    doc.fontSize(8).fillColor('#666').moveDown(0.4)
      .text('Bank details are sent separately. Generated from the shared ledger on the partner link.', 50);
  } catch (e) {
    console.warn('[partner-portal] statement render failed:', e.message);
  }
  doc.end();
}

router.get('/:token/statements/:key', (req, res) => {
  const ctx = partnerFor(req, res); if (!ctx) return;
  const { db, partner } = ctx;
  const key = String(req.params.key || '').replace(/\.pdf$/i, '');
  const today = portalToday();
  if (key === 'close') {
    const { view } = closeView(db, partner, lastClosedMonthEnd(today), today);
    return renderStatement(res, partner, view, { closed: view });
  }
  // A settled month — scoped to THIS partner's settlements.
  const st = db.prepare('SELECT * FROM partner_settlements WHERE id = ? AND partner_id = ?').get(key, partner.id);
  if (!st) return res.status(404).json({ error: 'No such statement.' });
  const s = settlementView(db, partner, st);
  const view = {
    period_end: st.period_end, reference: s.reference, status: 'paid',
    owed_to: theirOwedTo(st.net_amount), amount: round2(Math.abs(st.net_amount)),
    you_owe: st.receivable_total, you_are_owed: st.payable_total,
    credit: s.credit && s.credit.applied > 0 ? s.credit : null,
    documents: s.documents,
    settlement: { paid_at: st.paid_at, payment_reference: st.payment_reference },
  };
  return renderStatement(res, partner, view, { closed: { label: monthName(st.period_end, today.slice(0, 4)) } });
});

/**
 * Open a file through the link. A redirect to a short-lived address, so the
 * page can use a plain link (opens in a tab, shows where it goes, works with a
 * long-press) — scoped to this partner's documents like every route here.
 */
router.get('/:token/documents/:docId/open', async (req, res) => {
  const ctx = partnerFor(req, res); if (!ctx) return;
  const d = ctx.db.prepare('SELECT storage_key, filename FROM partner_documents WHERE id = ? AND partner_id = ?')
    .get(req.params.docId, ctx.partner.id);
  if (!d?.storage_key) return res.status(404).json({ error: 'No file on this document' });
  const url = await presignGet(d.storage_key, d.filename);
  if (!url) return res.status(503).json({ error: 'File storage is not configured.' });
  res.redirect(302, url);
});

router.get('/:token/settlements/:settlementId/proof/open', async (req, res) => {
  const ctx = partnerFor(req, res); if (!ctx) return;
  const st = ctx.db.prepare('SELECT proof_storage_key, proof_filename FROM partner_settlements WHERE id = ? AND partner_id = ?')
    .get(req.params.settlementId, ctx.partner.id);
  if (!st?.proof_storage_key) return res.status(404).json({ error: 'No proof of payment on this settlement.' });
  const url = await presignGet(st.proof_storage_key, st.proof_filename);
  if (!url) return res.status(503).json({ error: 'File storage is not configured.' });
  res.redirect(302, url);
});

/** The remittance advice for a settlement, from their side of the link. */
router.get('/:token/settlements/:settlementId/proof', async (req, res) => {
  const ctx = partnerFor(req, res); if (!ctx) return;
  const { db, partner } = ctx;
  // Scoped to THIS partner's settlements. A token is a credential for one
  // account, and an id in a URL is not.
  const st = db.prepare('SELECT * FROM partner_settlements WHERE id = ? AND partner_id = ?')
    .get(req.params.settlementId, partner.id);
  if (!st?.proof_storage_key) return res.status(404).json({ error: 'No proof of payment on this settlement.' });
  const url = await presignGet(st.proof_storage_key, st.proof_filename);
  if (!url) return res.status(503).json({ error: 'File storage is not configured.' });
  res.json({ url, filename: st.proof_filename });
});

router.post('/:token/documents', uploadDocs, async (req, res) => {
  const files = req.files || [];
  try {
    const ctx = partnerFor(req, res); if (!ctx) return;
    const { db, partner } = ctx;
    const r = await createDocument(db, {
      partnerId: partner.id,
      body: req.body,
      files,
      user: { name: `${partner.name} (portal)` },
      source: 'partner-portal',
    });
    if (r.error) return res.status(r.status || 400).json({ error: r.error });
    logAudit(`${partner.name} (portal)`, 'create', 'partner_document', r.documents[0]?.id,
      { count: r.documents.length, via: 'partner-portal' }, null, null, partner.name);
    res.status(201).json({
      documents: r.documents,
      note: 'Received. Powder Ops will confirm it as final once the goods or the run are complete.',
    });
  } finally {
    cleanupTemp(files);
  }
});

router.get('/:token/documents/:docId/file', async (req, res) => {
  const ctx = partnerFor(req, res); if (!ctx) return;
  // Scoped to their own partner id — a document id from another account is a
  // 404 here, not a download.
  const d = ctx.db.prepare('SELECT storage_key, filename FROM partner_documents WHERE id = ? AND partner_id = ?')
    .get(req.params.docId, ctx.partner.id);
  if (!d?.storage_key) return res.status(404).json({ error: 'No file on this document' });
  res.json({ url: await presignGet(d.storage_key, d.filename) });
});

// The older door, kept for anything still calling it: a dispute on an open
// document. It goes through `raiseReview`, so it is written down the same way
// and the office sees it in the same list.
router.post('/:token/documents/:docId/dispute', (req, res) => {
  const ctx = partnerFor(req, res); if (!ctx) return;
  const { db, partner } = ctx;
  const d = db.prepare('SELECT settlement_id FROM partner_documents WHERE id = ? AND partner_id = ?')
    .get(req.params.docId, partner.id);
  if (!d) return res.status(404).json({ error: 'Document not found' });
  if (d.settlement_id) return res.status(400).json({ error: 'This one was already settled — ask for a credit note instead.' });
  const r = raiseReview(db, partner, { document_id: req.params.docId, note: req.body?.reason });
  if (r.error) return res.status(r.status).json({ error: r.error });
  res.json({ ok: true });
});

export default router;
