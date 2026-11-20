// The weekly payment run, part D (D-364): after Danny says he sent the money,
// the run is CLOSED OUT. Nothing paid or invoiced stays open.
//
// What has to be true before a run closes, each derived on every read:
//   1. The transfer LANDED. A person (admin or the Controller) confirms the
//      amount that arrived in the Powder Ops account and the date. The bank
//      feed, when one is linked, offers the matching deposit; it never confirms.
//   2. Every ticked bill is PAID or SENT BACK. Paid = how (QBO Bill Pay ACH,
//      the debit card, a check, other), the date, a reference, the PROOF
//      (stored and hashed) and the QBO payment marked. A bill that cannot be
//      paid this week goes back to the queue with a reason and rides the next
//      run; it is never left on this one.
//   3. The weekly ProDough DEPOSIT invoice (the material bills, at cost — Chris
//      calls it a Deposit) is recorded with its QBO invoice number and is paid.
//      How the transfer pays it is a setting (DEPOSIT_PAYMENT_MODES) until the
//      accountant confirms. Part E takes deposits off the final production bill:
//      `applied_to` is left for it and nothing here fills it.
//   4. A shortfall (Powder Ops expenses above its own balance) says how it was
//      booked. The accountant has not decided, so a person writes it down.
//
// RULES:
//   - THE CONTROLLER IS A BOT (D-366): Grok Bot, its own token holding the
//     payment-run-controller grant, on the account named Controller in the
//     settings. It records the money landing (with EVIDENCE: a bank-feed line or
//     a file), schedules and records payments, the Deposit invoice number, and
//     closes a finished run. An admin (Lowry) can do every step by hand. Sending
//     a bill back, marking a Deposit or production invoice paid by hand (manual
//     mode) and booking the shortfall stay a person's; the weekly task tells
//     Lowry what is waiting on him and what the bot has not done.
//   - Nothing is deleted. A payment row, once written, is filled in, never
//     rewritten: proof and the QBO mark can be added; method, amount and date
//     cannot change. A mistake is told to Lowry and corrected in QBO.
//   - Marking a bill paid goes through the D-329 rule: a bill on the partner
//     ledger is paid by its settlement, not here.
import { randomUUID, createHash } from 'crypto';
import { plantDateOf } from './plant-clock.js';
import { getSettings, notifyRecipients, money, addDays, DEPOSIT_PAYMENT_MODES } from './payment-run.js';
import { runView, logEvent } from './payment-approval.js';
import { runProduction, payRunProduction, pendingLines, openDeposits as openDepositsE } from './production-invoices.js';

export const PAY_METHODS = Object.freeze({
  qbo_ach: 'QBO Bill Pay (ACH)',
  debit_card: 'Powder Ops debit card',
  check: 'Check',
  other: 'Other',
});
const round = (n) => Math.round((Number(n) || 0) * 100) / 100;
const fail = (status, message, extra = {}) => Object.assign(new Error(message), { status, ...extra });
const isoDate = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? String(v) : null);

export const CONTROLLER_GRANT = 'payment-run-controller';

/** The request is the Controller bot: a token holding the grant, on the account named Controller. */
export function isControllerBot(db, req) {
  if (req?.auth?.kind !== 'token') return false;
  if (!(req.auth.grants || []).includes(CONTROLLER_GRANT)) return false;
  const c = getSettings(db).controller_id;
  return !!c && c === req.user?.id;
}

/**
 * Who may record the close-out: an admin signed in, or the Controller bot
 * (its token with the grant). Pass the request; a bare user is read as a session.
 */
export function canCloseOut(db, userOrReq) {
  const req = userOrReq?.user !== undefined || userOrReq?.auth ? userOrReq : { user: userOrReq };
  const user = req.user;
  if (!user) return false;
  if (req.auth?.kind === 'token') return isControllerBot(db, req);
  if (user.role === 'admin') return true;
  const c = getSettings(db).controller_id;
  return !!c && c === user.id;
}

function loadRun(db, runId) {
  const run = db.prepare('SELECT * FROM payment_runs WHERE id = ?').get(runId);
  if (!run) throw fail(404, 'Run not found');
  return run;
}
const approvedSummary = (run) => { try { return JSON.parse(run.approved_totals || 'null'); } catch { return null; } };

/** The deposit row for a run, created on first need (one per run). */
export function depositFor(db, run) {
  const s = approvedSummary(run);
  const amount = round(s?.materials || 0);
  if (!(amount > 0)) return null;
  let d = db.prepare('SELECT * FROM prodough_deposits WHERE run_id = ?').get(run.id);
  if (!d) {
    db.prepare('INSERT OR IGNORE INTO prodough_deposits (id, run_id, amount, mode) VALUES (?, ?, ?, ?)')
      .run(randomUUID(), run.id, amount, getSettings(db).materials_mode || null);
    d = db.prepare('SELECT * FROM prodough_deposits WHERE run_id = ?').get(run.id);
  }
  return d;
}

/** Bank-feed deposits that could be the transfer: money in, within a cent, since the day before it was sent. */
export function feedMatches(db, run) {
  const want = round(run.transferred_amount);
  if (!(want > 0)) return [];
  const since = addDays(plantDateOf(run.transferred_at || run.approved_at || run.created_at), -1);
  try {
    return db.prepare(`SELECT t.id, t.posted_date, t.description, t.amount, a.name AS account FROM bank_transactions t
      LEFT JOIN bank_accounts a ON a.id = t.account_id
      WHERE t.amount > 0 AND ABS(t.amount - ?) < 0.011 AND t.posted_date >= ? ORDER BY t.posted_date LIMIT 5`).all(want, since);
  } catch { return []; }
}

/** The close-out: what is done and what is left. Derived; writes nothing except creating the deposit row. */
export function closeout(db, runId) {
  const run = loadRun(db, runId);
  if (!['approved', 'transferred'].includes(run.status)) return null;
  const s = approvedSummary(run) || {};
  const view = runView(db, run.id);
  const pays = new Map(db.prepare('SELECT * FROM payment_run_payments WHERE run_id = ?').all(run.id).map(p => [p.line_id, p]));
  const scheds = new Map(db.prepare('SELECT * FROM payment_run_schedules WHERE run_id = ? AND replaced_at IS NULL').all(run.id).map(x => [x.line_id, x]));
  const lines = view.lines.filter(l => l.included).map(l => {
    const p = pays.get(l.id);
    const sch = scheds.get(l.id);
    let state = sch ? 'scheduled' : 'to_pay';
    const missing = [];
    if (p?.outcome === 'not_paid') state = 'sent_back';
    else if (p) {
      if (!p.proof_key) missing.push('proof of payment');
      if (!p.qbo_marked_at) missing.push('marked paid in QBO');
      state = missing.length ? 'paid_incomplete' : 'done';
    }
    return {
      line_id: l.id, drop_id: l.drop_id, vendor: l.vendor, invoice_number: l.invoice_number, amount: l.amount, due_date: l.due_date,
      bill_class: l.bill_class, must_pay: l.must_pay, state, missing,
      schedule: sch && !p ? { method: sch.method, method_label: PAY_METHODS[sch.method], scheduled_on: sch.scheduled_on, reference: sch.reference,
        scheduled_by: sch.scheduled_by, scheduled_at: sch.scheduled_at } : null,
      payment: p ? {
        outcome: p.outcome, method: p.method, method_label: PAY_METHODS[p.method] || null, paid_on: p.paid_on, amount: p.amount,
        reference: p.reference, reason: p.reason, proof_name: p.proof_name, proof_at: p.proof_at, proof_by: p.proof_by,
        qbo_payment_id: p.qbo_payment_id, qbo_marked_by: p.qbo_marked_by, qbo_marked_at: p.qbo_marked_at,
        recorded_by: p.recorded_by, recorded_at: p.recorded_at,
      } : null,
    };
  });
  const deposit = run.status === 'transferred' ? depositFor(db, run) : null;
  const shortfall = round(s.shortfall || 0);
  const open = [];
  // `who` says whose step it is (D-366): danny, bot (the Controller bot; an admin
  // can do it too) or person (Lowry or an admin — never a bot).
  if (run.status === 'approved') open.push({ key: 'transfer_sent', who: 'danny', label: 'Danny has not said the money was sent yet' });
  if (run.status === 'transferred' && !run.received_at) open.push({ key: 'transfer_landed', who: 'bot', label: `Confirm ${money(run.transferred_amount)} landed in the Powder Ops account` });
  for (const l of lines) {
    if (l.state === 'to_pay') open.push({ key: `pay:${l.line_id}`, who: 'bot', label: `Pay ${l.vendor || 'bill'} ${money(l.amount)}` });
    if (l.state === 'scheduled') open.push({ key: `pay:${l.line_id}`, who: 'bot', label: `Pay ${l.vendor || 'bill'} ${money(l.amount)} (scheduled ${l.schedule.scheduled_on}, ${l.schedule.method_label})` });
    if (l.state === 'paid_incomplete') open.push({ key: `finish:${l.line_id}`, who: 'bot', label: `${l.vendor || 'Bill'} ${money(l.amount)}: ${l.missing.join(' and ')}` });
  }
  const manual = (getSettings(db).deposit_payment || 'transfer') === 'manual';
  if (deposit && !deposit.qbo_invoice_no) open.push({ key: 'deposit_invoice', who: 'bot', label: `Record the deposit invoice to ProDough (${money(deposit.amount)}) from QBO` });
  if (deposit && !deposit.paid_at) open.push({ key: 'deposit_paid', who: manual ? 'person' : 'bot', label: `Mark the deposit invoice paid (${money(deposit.amount)})` });
  // D-365: the production invoices this run collected are paid by it too.
  const production = run.status === 'transferred' ? runProduction(db, run) : [];
  for (const p of production) if (!p.paid) open.push({ key: `production:${p.id}`, who: manual ? 'person' : 'bot', label: `Mark production invoice ${p.ref_no} paid (${money(p.amount)})` });
  if (shortfall > 0 && !run.shortfall_note) open.push({ key: 'shortfall', who: 'person', label: `Say how the ${money(shortfall)} shortfall was booked` });
  const expected = s.owes ?? null;
  return {
    run_id: run.id, run_no: run.run_no, status: run.status, closed: !!run.closed_at, closed_at: run.closed_at, closed_by: run.closed_by,
    transfer: {
      expected, sent_amount: run.transferred_amount, sent_by: run.transferred_name, sent_at: run.transferred_at,
      received_amount: run.received_amount, received_on: run.received_on, received_by: run.received_by, received_at: run.received_at,
      received_bank_txn: run.received_bank_txn,
      evidence: run.received_evidence_key ? { name: run.received_evidence_name, sha256: run.received_evidence_sha256 } : null,
      differs: run.received_amount != null && expected != null && Math.abs(run.received_amount - expected) >= 0.01,
      feed_matches: run.status === 'transferred' && !run.received_at ? feedMatches(db, run) : [],
    },
    lines,
    deposit: deposit ? {
      amount: deposit.amount, qbo_invoice_no: deposit.qbo_invoice_no, invoice_recorded_by: deposit.invoice_recorded_by,
      invoice_recorded_at: deposit.invoice_recorded_at, paid_amount: deposit.paid_amount, paid_from: deposit.paid_from,
      paid_by: deposit.paid_by, paid_at: deposit.paid_at, applied_to: deposit.applied_to,
    } : null,
    production,
    deposit_payment: getSettings(db).deposit_payment || 'transfer', deposit_payment_modes: DEPOSIT_PAYMENT_MODES,
    shortfall: shortfall > 0 ? { amount: shortfall, note: run.shortfall_note, by: run.shortfall_by, at: run.shortfall_at } : null,
    open, can_close: !run.closed_at && run.status === 'transferred' && open.length === 0,
    pay_methods: PAY_METHODS,
  };
}

function needTransferred(run) {
  if (run.closed_at) throw fail(409, 'This run is closed.');
  if (run.status !== 'transferred') throw fail(409, 'Danny has not recorded the transfer yet.', { code: 'NOT_TRANSFERRED' });
}

/** The transfer landed. In 'transfer' mode this also pays the deposit invoice. */
export function confirmReceived(db, runId, { amount, received_on, bank_txn_id }, user, { evidence = null, requireEvidence = false } = {}) {
  const run = loadRun(db, runId);
  needTransferred(run);
  if (run.received_at) throw fail(409, 'The transfer is already confirmed.');
  const n = Number(amount);
  if (amount === '' || amount == null || !Number.isFinite(n) || n <= 0) throw fail(400, 'Enter the amount that arrived in the account.');
  const on = isoDate(received_on) || plantDateOf();
  if (on > plantDateOf()) throw fail(400, 'The date it arrived cannot be in the future.');
  let txn = null;
  if (bank_txn_id) {
    txn = feedMatches(db, run).find(t => t.id === bank_txn_id);
    if (!txn) throw fail(400, 'That bank-feed line is not one of the matches for this transfer.');
  }
  if (requireEvidence && !txn && !evidence) throw fail(400, 'Attach the evidence the money landed: the matching bank-feed line (bank_txn_id) or a file (statement or screenshot).', { code: 'EVIDENCE_REQUIRED' });
  const mode = getSettings(db).deposit_payment || 'transfer';
  db.transaction(() => {
    db.prepare(`UPDATE payment_runs SET received_amount = ?, received_on = ?, received_by = ?, received_at = datetime('now'), received_bank_txn = ?,
        received_evidence_key = ?, received_evidence_name = ?, received_evidence_sha256 = ? WHERE id = ?`)
      .run(round(n), on, user.name, txn?.id || null, evidence?.key || null, evidence?.name || null, evidence?.sha256 || null, run.id);
    const dep = depositFor(db, { ...run, received_at: 'now' });
    if (dep && mode === 'transfer' && !dep.paid_at) {
      db.prepare("UPDATE prodough_deposits SET paid_amount = ?, paid_from = 'transfer', paid_by = ?, paid_at = datetime('now') WHERE id = ?")
        .run(round(Math.min(dep.amount, n)), user.name, dep.id);
    }
    if (mode === 'transfer') payRunProduction(db, run, { from: 'transfer', by: user.name });
    const expected = approvedSummary(run)?.owes ?? null;
    logEvent(db, run.id, 'received', { by: user.name, detail: { amount: round(n), on, expected, bank_txn: txn?.id || null, evidence: evidence ? { name: evidence.name, sha256: evidence.sha256 } : null, differs: expected != null && Math.abs(round(n) - expected) >= 0.01 } });
  })();
  return closeout(db, run.id);
}

function lineOf(db, run, lineId) {
  const l = db.prepare('SELECT * FROM payment_run_lines WHERE id = ? AND run_id = ?').get(lineId, run.id);
  if (!l) throw fail(404, 'That bill is not on this run.');
  if (!l.included) throw fail(409, 'That bill was unticked; it is not paid on this run.');
  return l;
}

/**
 * A payment SCHEDULED (D-366): QBO Bill Pay set up for a date, before it is
 * paid. Replacing a schedule keeps the old row (stamped replaced). A scheduled
 * bill is still open until its payment is recorded.
 */
export function scheduleLine(db, runId, lineId, body, user) {
  const run = loadRun(db, runId);
  needTransferred(run);
  if (!run.received_at) throw fail(409, 'Confirm the transfer landed before scheduling payments.', { code: 'TRANSFER_NOT_CONFIRMED' });
  const l = lineOf(db, run, lineId);
  if (db.prepare('SELECT 1 FROM payment_run_payments WHERE line_id = ?').get(l.id)) throw fail(409, 'This bill already has a payment recorded (or was sent back).');
  const method = String(body?.method || '');
  if (!PAY_METHODS[method]) throw fail(400, `How will it be paid? One of: ${Object.values(PAY_METHODS).join(', ')}.`);
  const on = isoDate(body?.scheduled_on);
  if (!on) throw fail(400, 'Give the date the payment is scheduled for (YYYY-MM-DD).');
  const block = partnerBlock(db, l.drop_id);
  if (block) throw fail(409, `This bill is invoice #${block.doc_number || '-'} on the partner ledger; it is paid by its settlement on Partner Reconciliation.`, { code: 'SETTLE_ON_PARTNER_REC' });
  const reference = String(body?.reference || '').trim().slice(0, 200) || null;
  db.transaction(() => {
    db.prepare("UPDATE payment_run_schedules SET replaced_at = datetime('now') WHERE line_id = ? AND replaced_at IS NULL").run(l.id);
    db.prepare('INSERT INTO payment_run_schedules (id, run_id, line_id, method, scheduled_on, reference, scheduled_by, scheduled_by_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(randomUUID(), run.id, l.id, method, on, reference, user.name, user.id || null);
    logEvent(db, run.id, 'scheduled', { by: user.name, detail: { vendor: l.vendor, invoice: l.invoice_number, amount: l.amount, method, scheduled_on: on, reference } });
  })();
  return closeout(db, run.id);
}

/** The D-329 rule: a bill on the partner ledger is paid by its settlement. */
function partnerBlock(db, dropId) {
  const d = db.prepare('SELECT partner_document_id FROM ap_drops WHERE id = ?').get(dropId);
  if (!d?.partner_document_id) return null;
  const doc = db.prepare('SELECT id, doc_number, settlement_id FROM partner_documents WHERE id = ?').get(d.partner_document_id);
  return doc && !doc.settlement_id ? doc : null;
}

/** A bill was paid: how, when, the reference. Proof and the QBO mark can follow. */
export function recordPayment(db, runId, lineId, body, user) {
  const run = loadRun(db, runId);
  needTransferred(run);
  if (!run.received_at) throw fail(409, 'Confirm the transfer landed before paying the bills.', { code: 'TRANSFER_NOT_CONFIRMED' });
  const l = lineOf(db, run, lineId);
  if (db.prepare('SELECT 1 FROM payment_run_payments WHERE line_id = ?').get(l.id)) throw fail(409, 'This bill already has a payment recorded.');
  const method = String(body?.method || '');
  if (!PAY_METHODS[method]) throw fail(400, `How was it paid? One of: ${Object.values(PAY_METHODS).join(', ')}.`);
  const paidOn = isoDate(body?.paid_on) || plantDateOf();
  if (paidOn > plantDateOf()) throw fail(400, 'The payment date cannot be in the future.');
  const reference = String(body?.reference || '').trim();
  if (reference.length < 2) throw fail(400, 'Give the payment reference (the QBO payment number, the card receipt or the check number).');
  const block = partnerBlock(db, l.drop_id);
  if (block) throw fail(409, `This bill is invoice #${block.doc_number || '-'} on the partner ledger; it is paid by its settlement on Partner Reconciliation.`, { code: 'SETTLE_ON_PARTNER_REC' });
  const qbo = String(body?.qbo_payment_id || '').trim();
  db.transaction(() => {
    db.prepare(`INSERT INTO payment_run_payments (id, run_id, line_id, drop_id, outcome, method, paid_on, amount, reference, qbo_payment_id,
      qbo_marked_by, qbo_marked_at, recorded_by, recorded_by_id) VALUES (?, ?, ?, ?, 'paid', ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(randomUUID(), run.id, l.id, l.drop_id, method, paidOn, l.amount, reference.slice(0, 200), qbo || null,
        qbo ? user.name : null, qbo ? new Date().toISOString() : null, user.name, user.id || null);
    db.prepare("UPDATE ap_drops SET status = 'paid', closed_at = ?, updated_at = datetime('now') WHERE id = ? AND status IN ('in_payment_run','in_qbo')")
      .run(new Date().toISOString(), l.drop_id);
    db.prepare("INSERT INTO ap_drop_events (id, drop_id, by_name, kind, detail) VALUES (?, ?, ?, 'paid', ?)")
      .run(randomUUID(), l.drop_id, user.name, JSON.stringify({ run: run.run_no, method, paid_on: paidOn, reference, amount: l.amount }));
    logEvent(db, run.id, 'paid', { by: user.name, detail: { vendor: l.vendor, invoice: l.invoice_number, amount: l.amount, method, paid_on: paidOn } });
  })();
  return closeout(db, run.id);
}

/** Proof of payment, stored and hashed. Added once; a second file is refused (the first is the record). */
export async function addProof(db, runId, lineId, file, user, { putObject }) {
  const run = loadRun(db, runId);
  if (run.closed_at) throw fail(409, 'This run is closed.');
  const l = lineOf(db, run, lineId);
  const p = db.prepare("SELECT * FROM payment_run_payments WHERE line_id = ? AND outcome = 'paid'").get(l.id);
  if (!p) throw fail(409, 'Record the payment first, then attach its proof.');
  if (p.proof_key) throw fail(409, 'Proof is already attached to this payment.');
  if (!file?.buffer?.length) throw fail(400, 'Attach the proof of payment (a PDF or a photo).');
  const ok = /^(application\/pdf|image\/(png|jpe?g|heic|webp))$/i.test(file.mimetype || '');
  if (!ok) throw fail(415, 'Proof must be a PDF or a photo.');
  const sha = createHash('sha256').update(file.buffer).digest('hex');
  const key = `payment-proof/${run.run_no}/${l.id}-${sha.slice(0, 12)}`;
  await putObject(key, file.buffer, file.mimetype);
  db.prepare("UPDATE payment_run_payments SET proof_key = ?, proof_name = ?, proof_type = ?, proof_size = ?, proof_sha256 = ?, proof_by = ?, proof_at = datetime('now') WHERE id = ? AND proof_key IS NULL")
    .run(key, String(file.originalname || 'proof').slice(0, 200), file.mimetype, file.size || file.buffer.length, sha, user.name, p.id);
  logEvent(db, run.id, 'proof', { by: user.name, detail: { vendor: l.vendor, amount: l.amount, file: file.originalname, sha256: sha } });
  return closeout(db, run.id);
}

/** The bill is marked paid in QBO (the Controller does it there; this records it). */
export function markInQbo(db, runId, lineId, { qbo_payment_id }, user) {
  const run = loadRun(db, runId);
  if (run.closed_at) throw fail(409, 'This run is closed.');
  const l = lineOf(db, run, lineId);
  const p = db.prepare("SELECT * FROM payment_run_payments WHERE line_id = ? AND outcome = 'paid'").get(l.id);
  if (!p) throw fail(409, 'Record the payment first.');
  if (p.qbo_marked_at) throw fail(409, 'Already marked paid in QBO.');
  const id = String(qbo_payment_id || '').trim();
  if (id.length < 1) throw fail(400, 'Give the QBO payment number.');
  db.prepare("UPDATE payment_run_payments SET qbo_payment_id = ?, qbo_marked_by = ?, qbo_marked_at = datetime('now') WHERE id = ? AND qbo_marked_at IS NULL")
    .run(id.slice(0, 120), user.name, p.id);
  logEvent(db, run.id, 'qbo_marked', { by: user.name, detail: { vendor: l.vendor, amount: l.amount, qbo_payment_id: id } });
  return closeout(db, run.id);
}

/** A bill that cannot be paid this week goes back to the queue, with the reason. */
export function sendBack(db, runId, lineId, { reason }, user) {
  const run = loadRun(db, runId);
  needTransferred(run);
  const l = lineOf(db, run, lineId);
  if (db.prepare('SELECT 1 FROM payment_run_payments WHERE line_id = ?').get(l.id)) throw fail(409, 'This bill already has a payment recorded.');
  const why = String(reason || '').trim();
  if (why.length < 5) throw fail(400, 'Say why it was not paid; Lowry and the bill owner will read it.');
  db.transaction(() => {
    db.prepare(`INSERT INTO payment_run_payments (id, run_id, line_id, drop_id, outcome, amount, reason, recorded_by, recorded_by_id)
      VALUES (?, ?, ?, ?, 'not_paid', ?, ?, ?, ?)`).run(randomUUID(), run.id, l.id, l.drop_id, l.amount, why.slice(0, 500), user.name, user.id || null);
    db.prepare("UPDATE ap_drops SET status = 'in_qbo', payment_run_id = NULL, updated_at = datetime('now') WHERE id = ? AND status = 'in_payment_run'").run(l.drop_id);
    db.prepare("INSERT INTO ap_drop_events (id, drop_id, by_name, kind, detail) VALUES (?, ?, ?, 'payment_sent_back', ?)")
      .run(randomUUID(), l.drop_id, user.name, JSON.stringify({ run: run.run_no, reason: why }));
    logEvent(db, run.id, 'sent_back', { by: user.name, detail: { vendor: l.vendor, invoice: l.invoice_number, amount: l.amount, reason: why } });
  })();
  return closeout(db, run.id);
}

/** The deposit invoice as created in QBO. */
export function recordDepositInvoice(db, runId, { qbo_invoice_no }, user) {
  const run = loadRun(db, runId);
  needTransferred(run);
  const dep = depositFor(db, run);
  if (!dep) throw fail(409, 'This run has no ProDough material bills, so there is no deposit invoice.');
  if (dep.qbo_invoice_no) throw fail(409, 'The deposit invoice is already recorded.');
  const no = String(qbo_invoice_no || '').trim();
  if (!no) throw fail(400, 'Give the QBO invoice number.');
  db.prepare("UPDATE prodough_deposits SET qbo_invoice_no = ?, invoice_recorded_by = ?, invoice_recorded_at = datetime('now') WHERE id = ?").run(no.slice(0, 80), user.name, dep.id);
  logEvent(db, run.id, 'deposit_invoice', { by: user.name, detail: { amount: dep.amount, qbo_invoice_no: no } });
  return closeout(db, run.id);
}

/** In 'manual' mode (or before the transfer is confirmed in either mode, refused): a person marks the deposit paid. */
export function markDepositPaid(db, runId, user) {
  const run = loadRun(db, runId);
  needTransferred(run);
  if (!run.received_at) throw fail(409, 'Confirm the transfer landed first.', { code: 'TRANSFER_NOT_CONFIRMED' });
  const dep = depositFor(db, run);
  if (!dep) throw fail(409, 'This run has no deposit invoice.');
  if (dep.paid_at) throw fail(409, 'The deposit is already marked paid.');
  db.prepare("UPDATE prodough_deposits SET paid_amount = ?, paid_from = 'manual', paid_by = ?, paid_at = datetime('now') WHERE id = ?").run(dep.amount, user.name, dep.id);
  logEvent(db, run.id, 'deposit_paid', { by: user.name, detail: { amount: dep.amount } });
  return closeout(db, run.id);
}

export function recordShortfall(db, runId, { note }, user) {
  const run = loadRun(db, runId);
  needTransferred(run);
  if (!(round(approvedSummary(run)?.shortfall || 0) > 0)) throw fail(409, 'This run has no shortfall.');
  if (run.shortfall_note) throw fail(409, 'How the shortfall was booked is already recorded.');
  const text = String(note || '').trim();
  if (text.length < 5) throw fail(400, 'Say how the shortfall was booked (which invoice or entry, and its number).');
  db.prepare("UPDATE payment_runs SET shortfall_note = ?, shortfall_by = ?, shortfall_at = datetime('now') WHERE id = ?").run(text.slice(0, 500), user.name, run.id);
  logEvent(db, run.id, 'shortfall_booked', { by: user.name, detail: { note: text } });
  return closeout(db, run.id);
}

/** Close the run: refused while anything is open, naming it. */
export function closeRun(db, runId, user) {
  const c = closeout(db, runId);
  if (!c) throw fail(409, 'Only a run Danny has paid can be closed.');
  if (c.closed) throw fail(409, 'This run is already closed.');
  if (c.open.length) throw fail(409, `Still open: ${c.open.map(o => o.label).join('; ')}.`, { code: 'RUN_NOT_FINISHED', open: c.open });
  db.prepare("UPDATE payment_runs SET closed_by = ?, closed_at = datetime('now') WHERE id = ? AND closed_at IS NULL").run(user.name, runId);
  logEvent(db, runId, 'closed', { by: user.name, detail: null });
  return closeout(db, runId);
}

/** Deposits not yet taken off a final production bill — the one reader is part E's (D-365). */
export const openDeposits = openDepositsE;

/** In 'manual' mode: a person marks one of the run's production invoices paid (D-365). */
export function markProductionPaid(db, runId, invoiceId, user) {
  const run = loadRun(db, runId);
  needTransferred(run);
  if (!run.received_at) throw fail(409, 'Confirm the transfer landed first.', { code: 'TRANSFER_NOT_CONFIRMED' });
  const item = runProduction(db, run).find(p => p.id === invoiceId);
  if (!item) throw fail(404, 'That production invoice is not on this run.');
  if (item.paid) throw fail(409, 'Already marked paid.');
  if (!payRunProduction(db, run, { from: 'manual', by: user.name, only: invoiceId })) throw fail(409, `${item.ref_no} is ${item.status}; it cannot be marked paid.`);
  logEvent(db, run.id, 'production_paid', { by: user.name, detail: { ref_no: item.ref_no, amount: item.amount } });
  return closeout(db, run.id);
}

/**
 * The weekly task (Mondays), to Lowry (the notify list): every run Danny has
 * approved and that is not closed, split into what only a person can do (his)
 * and what is waiting on the Controller bot, plus production orders held or
 * not yet invoiced. Quiet when none. The bot reads the close-out itself.
 */
export async function closeoutDigest(db, deps) {
  const runs = db.prepare("SELECT id FROM payment_runs WHERE status IN ('approved','transferred') AND closed_at IS NULL ORDER BY created_at").all();
  const parts = [];
  const list = (items) => `${items.slice(0, 8).map(o => `• ${o.label}`).join('\n')}${items.length > 8 ? `\n• and ${items.length - 8} more` : ''}`;
  for (const r of runs) {
    const c = closeout(db, r.id);
    if (!c) continue;
    if (!c.open.length) { parts.push(`*${c.run_no}*: everything is done; the bot has not closed it yet.`); continue; }
    const mine = c.open.filter(o => o.who === 'person');
    const bot = c.open.filter(o => o.who === 'bot');
    const danny = c.open.filter(o => o.who === 'danny');
    const bits = [`*${c.run_no}* (${c.open.length} left)`];
    if (mine.length) bits.push(`_Only a person can do these:_\n${list(mine)}`);
    if (bot.length) bits.push(`_Waiting on the Controller bot (you can do them too):_\n${list(bot)}`);
    if (danny.length) bits.push(`_Waiting on Danny:_\n${list(danny)}`);
    parts.push(bits.join('\n'));
  }
  const pending = pendingLines(db);
  if (pending.length) parts.push(`*ProDough production orders* (${pending.length}):\n${pending.slice(0, 8).map(l => `• ${l}`).join('\n')}${pending.length > 8 ? `\n• and ${pending.length - 8} more` : ''}`);
  if (!parts.length) return { runs: 0, sent: 0 };
  const recipients = notifyRecipients(db);
  const body = `*Payment runs not closed yet*\n${parts.join('\n\n')}\nOpen: /?tab=payment-run`;
  let sent = 0;
  for (const u of recipients) {
    try {
      const { bot, dm } = deps.botDm(db, u.id);
      await deps.postMessageAs(db, dm, bot, body);
      deps.pushToUser?.(u.id, { title: 'Payment runs to close', body: `${parts.length} item${parts.length === 1 ? '' : 's'} open`, tag: 'payment-closeout', url: '/?tab=payment-run' })?.catch?.(() => {});
      sent++;
    } catch (e) { console.warn('[payment-run] close-out digest failed:', e.message); }
  }
  return { runs: parts.length, sent };
}
