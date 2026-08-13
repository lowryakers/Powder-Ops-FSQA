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
import { createHash } from 'crypto';
import { getDb, logAudit } from '../db.js';
import { presignGet } from '../storage.js';
import { mediaUpload, cleanupTemp, uploadErrorMessage } from '../media.js';
import { endOfMonth, applyCredit } from '../partner-recon.js';
import { createDocument, currentReconciliation, creditFor } from './partners.js';

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

// The ledger and the number, from their side of the table. `direction` is
// relabelled here: what we call a receivable is what THEY owe, and showing a
// partner a column headed "receivable" that means the opposite of their books
// is how a shared number stops being shared.
router.get('/:token', (req, res) => {
  const ctx = partnerFor(req, res); if (!ctx) return;
  const { db, partner } = ctx;
  const asOf = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.as_of || '')) ? req.query.as_of : endOfMonth();
  const r = currentReconciliation(db, partner.id, asOf);
  // `proof_filename` is on this list because the partner is exactly who asks
  // for it. An explicit column list silently drops a new column — the same way
  // `category` went missing from the reconcile query — and the symptom here
  // would be a settlement that looks unproven on their side and proven on ours.
  const settlements = db.prepare(`SELECT id, period_end, net_amount, owed_to, status, paid_at, payment_reference,
      proof_filename
    FROM partner_settlements WHERE partner_id = ? ORDER BY period_end DESC LIMIT 24`).all(partner.id);

  // The credit, in full, from their side.
  //
  // A facility the partner cannot see is one they have to take our word for,
  // which is precisely the standoff this module exists to end — so this carries
  // the whole working, not the balance alone: the facility, what has been drawn
  // before, what THIS period draws and against which documents, what is left,
  // and the number before and after the credit. It also names what the credit
  // did NOT cover and why, because "my run wasn't credited" is the first
  // question they will have, and an answer that requires a phone call is how
  // two companies end up reconciling from different books again.
  const { credit, appliedToDate } = creditFor(db, partner.id);
  const c = credit ? applyCredit(r, credit, appliedToDate) : null;
  const creditView = c && {
    label: c.label,
    applies_to: c.applies_to,
    facility: c.facility,
    used_before_this_period: c.applied_to_date,
    available_this_period: c.opening_balance,
    applied_this_period: c.drawn_this_period,
    remaining_balance: c.remaining_balance,
    applied_to: c.draws,
    not_covered: c.ineligible,
    your_balance_before_credit: -c.net_before_credit,
    your_balance_after_credit: -c.net_amount,
  };
  const past = db.prepare(`SELECT a.amount, a.created_at, d.doc_number, d.description, s.period_end
    FROM partner_credit_applications a
    LEFT JOIN partner_documents d ON d.id = a.document_id
    LEFT JOIN partner_settlements s ON s.id = a.settlement_id
    WHERE a.credit_id = ? ORDER BY a.created_at DESC LIMIT 200`);

  res.json({
    partner: { name: partner.name, terms_days: partner.terms_days },
    as_of: asOf,
    // From the partner's point of view the sign flips: what we book as a
    // receivable is what THEY owe. `owed_to` names who is OWED the money — the
    // same meaning the internal field has, translated to their side. Getting
    // this backwards would show a partner they were being paid on a month they
    // owed us, which is worse than showing them nothing.
    you_owe: r.receivable_total,
    you_are_owed: r.payable_total,
    net_amount: -r.net_amount,
    owed_to: r.owed_to === 'us' ? 'powder-ops' : r.owed_to === 'them' ? 'you' : 'nobody',
    amount_due: r.amount_due,
    documents: {
      you_owe: r.documents.receivable,
      you_are_owed: r.documents.payable,
      excluded: r.documents.excluded,
    },
    excluded_summary: r.excluded_summary,
    counts: r.counts,
    settlements,
    // The credit reduces what they owe, so their bottom line follows it.
    credit: creditView,
    credit_history: credit ? past.all(credit.id) : [],
    ...(c ? { net_amount: -c.net_amount, amount_due: c.amount_due,
      owed_to: c.owed_to === 'us' ? 'powder-ops' : c.owed_to === 'them' ? 'you' : 'nobody' } : {}),
  });
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

// A dispute can only ever REMOVE a document from the number, so it is safe to
// let the other side raise one. It cannot create money and it cannot approve.
router.post('/:token/documents/:docId/dispute', (req, res) => {
  const ctx = partnerFor(req, res); if (!ctx) return;
  const { db, partner } = ctx;
  const d = db.prepare('SELECT * FROM partner_documents WHERE id = ? AND partner_id = ?')
    .get(req.params.docId, partner.id);
  if (!d) return res.status(404).json({ error: 'Document not found' });
  if (d.settlement_id) return res.status(400).json({ error: 'This one was already settled — ask for a credit note instead.' });
  const reason = String(req.body?.reason || '').trim().slice(0, 1000);
  if (reason.length < 3) return res.status(400).json({ error: 'Say what the disagreement is.' });

  db.prepare(`UPDATE partner_documents SET status = 'disputed', disputed_reason = ?,
      disputed_at = datetime('now'), disputed_by = ? WHERE id = ?`)
    .run(reason, `${partner.name} (portal)`, d.id);
  logAudit(`${partner.name} (portal)`, 'update', 'partner_document', d.id,
    { disputed: reason, via: 'partner-portal' }, d, null, d.doc_number || d.id);
  res.json({ ok: true });
});

export default router;
