// /api/payment-run — the weekly payment run page (D-360, PR A).
//
// Mounted WITHOUT requireModuleWrite (the AP Drop arrangement): the door is
// AP Drop's work-the-queue rule, checked here per route. Reading the run and
// confirming a bill's class: admin, the ap-drop edit grant, or an office/admin
// supervisor. The must-pay list and the settings: admin. A bot token reads at
// most; it never confirms a class (a person confirms) and never edits the list.
import { Router } from 'express';
import { randomUUID } from 'crypto';
import { getDb, logAudit } from '../db.js';
import { canWorkQueue } from './ap-drop.js';
import { paymentRun, weeklyScore, getSettings, saveSettings, notifyRecipients, BILL_CLASSES, suggestClass, loadContext, MATERIALS_MODES, DEPOSIT_PAYMENT_MODES,
  recordBankDetails, listBankDetails, feedBalance } from '../payment-run.js';
import { gateSignature } from '../signature.js';
import multer from 'multer';
import { storageEnabled, putObject, presignGet } from '../storage.js';
import { closeout, canCloseOut, confirmReceived, recordPayment, addProof, markInQbo, sendBack, recordDepositInvoice,
  markDepositPaid, recordShortfall, closeRun, markProductionPaid } from '../payment-closeout.js';
import { PRICE_FIELDS, listInvoices, recordOrder, recheckOrder, markInvoiced, voidInvoice, invoiceView, announceOrder } from '../production-invoices.js';
import { botDm, postMessageAs } from './comms.js';
import { pushToUser } from '../push.js';
import { freezeRun, runView, listRuns, setBankBalance, sendForApproval, cancelRun, approverNumber } from '../payment-approval.js';

const router = Router();
const isToken = (req) => req.auth?.kind === 'token';
const gate = (req, res) => {
  if (canWorkQueue(req.user)) return true;
  res.status(403).json({ error: 'The payment run is for whoever works the AP queue (the AP Drop edit grant, an office supervisor, or an admin).' });
  return false;
};
const adminOnly = (req, res) => {
  if (req.user?.role === 'admin' && !isToken(req)) return true;
  res.status(403).json({ error: 'Only an admin, signed in, can change this.' });
  return false;
};
const personOnly = (req, res) => {
  if (!isToken(req)) return true;
  res.status(403).json({ error: 'A person prepares, sends and cancels a payment run; a bot may only read it.', code: 'person_only' });
  return false;
};
const fail = (res, e) => res.status(e.status || 500).json({ error: e.message, ...(e.code && { code: e.code }), ...(e.open && { open: e.open }), ...(e.existing && { existing: e.existing }) });
const people = (db, ids) => (ids || []).map(id => db.prepare('SELECT id, name FROM users WHERE id = ?').get(id)).filter(Boolean);

router.get('/', (req, res) => {
  if (!gate(req, res)) return;
  const db = getDb();
  const page = paymentRun(db);
  const s = getSettings(db);
  res.json({
    ...page,
    score: weeklyScore(db),
    settings: {
      bill_owner: people(db, [s.bill_owner_id])[0] || null,
      controller: people(db, [s.controller_id])[0] || null,
      notify: notifyRecipients(db),
      notify_set: (s.notify_ids || []).length > 0,
      approver_phone: s.approver_phone, approver_number: approverNumber(db), review_before_send: s.review_before_send !== false,
      materials_mode: s.materials_mode, materials_modes: MATERIALS_MODES, bank_balance: s.bank_balance,
      deposit_payment: s.deposit_payment || 'transfer', deposit_payment_modes: DEPOSIT_PAYMENT_MODES,
      production_price_field: s.production_price_field || null, production_price_fields: PRICE_FIELDS,
    },
    feed_balance: feedBalance(db),
    bank_details: listBankDetails(db).filter(r => !r.retired_at),
    runs: listRuns(db, 12),
    can_admin: req.user?.role === 'admin' && !isToken(req),
    can_classify: !isToken(req),
    can_close_out: !isToken(req) && canCloseOut(db, req.user),
  });
});

// A person confirms the class. The suggestion is offered; only this stores one.
router.post('/bills/:id/class', (req, res) => {
  if (!gate(req, res)) return;
  if (isToken(req)) return res.status(403).json({ error: 'A person confirms a bill\'s class; a bot may only suggest it.', code: 'person_only' });
  const db = getDb();
  const cls = String(req.body?.bill_class || '');
  if (!BILL_CLASSES[cls]) return res.status(400).json({ error: `Class must be one of: ${Object.keys(BILL_CLASSES).join(', ')}` });
  const row = db.prepare('SELECT * FROM ap_drops WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Bill not found' });
  if (['paid', 'closed', 'not_finance'].includes(row.status)) return res.status(409).json({ error: `This bill is ${row.status.replace(/_/g, ' ')}; its class is part of the record now.` });
  const suggested = suggestClass(loadContext(db), row);
  db.prepare("UPDATE ap_drops SET bill_class = ?, bill_class_by = ?, bill_class_at = datetime('now') WHERE id = ?").run(cls, req.user.name, row.id);
  db.prepare("INSERT INTO ap_drop_events (id, drop_id, by_user_id, by_name, kind, detail) VALUES (?, ?, ?, ?, 'class_confirmed', ?)")
    .run(randomUUID(), row.id, req.user.id, req.user.name, JSON.stringify({ from: row.bill_class, to: cls, suggested: suggested.value, why: suggested.why }));
  logAudit(req.user, 'update', 'ap_drop', row.id, { field: 'bill_class', from: row.bill_class, to: cls, suggested: suggested.value }, row,
    db.prepare('SELECT * FROM ap_drops WHERE id = ?').get(row.id), row.filename);
  res.json({ ok: true, bill_class: cls });
});

// ── the must-pay list: Lowry's, retired never deleted ─────────────────────────
router.post('/must-pays', (req, res) => {
  if (!adminOnly(req, res)) return;
  const db = getDb();
  const vendor = String(req.body?.vendor_name || '').trim().slice(0, 200);
  if (vendor.length < 2) return res.status(400).json({ error: 'Name the vendor as it appears on its bills.' });
  const live = db.prepare('SELECT * FROM payment_must_pays WHERE is_active = 1').all().find(m => m.vendor_name.toLowerCase() === vendor.toLowerCase());
  if (live) return res.status(409).json({ error: `${live.vendor_name} is already on the list.` });
  const id = randomUUID();
  const label = String(req.body?.label || '').trim().slice(0, 200) || null;
  const note = String(req.body?.note || '').trim().slice(0, 1000) || null;
  db.prepare('INSERT INTO payment_must_pays (id, vendor_name, label, note, created_by) VALUES (?, ?, ?, ?, ?)').run(id, vendor, label, note, req.user.name);
  const row = db.prepare('SELECT * FROM payment_must_pays WHERE id = ?').get(id);
  logAudit(req.user, 'create', 'payment_must_pay', id, { vendor_name: vendor, label }, null, row, vendor);
  res.status(201).json(row);
});

router.post('/must-pays/:id/retire', (req, res) => {
  if (!adminOnly(req, res)) return;
  const db = getDb();
  const reason = String(req.body?.reason || '').trim();
  if (reason.length < 3) return res.status(400).json({ error: 'Say why it comes off the list.' });
  const row = db.prepare('SELECT * FROM payment_must_pays WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  if (!row.is_active) return res.status(409).json({ error: 'Already off the list.' });
  db.prepare("UPDATE payment_must_pays SET is_active = 0, retired_by = ?, retired_at = datetime('now'), retire_reason = ? WHERE id = ?").run(req.user.name, reason, row.id);
  logAudit(req.user, 'retire', 'payment_must_pay', row.id, { reason }, row, db.prepare('SELECT * FROM payment_must_pays WHERE id = ?').get(row.id), row.vendor_name);
  res.json({ ok: true });
});

router.get('/settings', (req, res) => {
  if (!gate(req, res)) return;
  res.json(getSettings(getDb()));
});

router.put('/settings', (req, res) => {
  if (!adminOnly(req, res)) return;
  const db = getDb();
  const before = getSettings(db);
  const body = {};
  for (const k of ['bill_owner_id', 'controller_id', 'notify_ids', 'approver_phone', 'review_before_send', 'materials_mode', 'deposit_payment', 'production_price_field']) if (k in (req.body || {})) body[k] = req.body[k];
  let after;
  try { after = saveSettings(db, body); } catch (e) { return fail(res, e); }
  logAudit(req.user, 'update', 'app_setting', 'payment_run_settings', {}, before, after, 'Payment run settings');
  res.json(after);
});

// ── frozen runs (D-361): prepare, review, send to Danny, cancel ──────────────
// The balance Powder Ops can pay its own expenses from, entered by hand until a
// bank feed reads it (part C). Entered this week, it rides onto the next run.
router.put('/bank-balance', (req, res) => {
  if (!adminOnly(req, res)) return;
  const db = getDb();
  const before = getSettings(db).bank_balance;
  let after;
  const feed = req.body?.from_feed ? feedBalance(db) : null;
  if (req.body?.from_feed && !feed) return res.status(409).json({ error: 'No bank feed balance to use: no bank account is linked and synced.' });
  const value = feed ? { amount: feed.amount, by: `${req.user.name} (bank feed${feed.as_of ? `, as of ${feed.as_of}` : ''})` }
    : req.body?.amount === null ? null : { amount: req.body?.amount, by: req.user.name };
  try { after = saveSettings(db, { bank_balance: value }); } catch (e) { return fail(res, e); }
  logAudit(req.user, 'update', 'app_setting', 'payment_run_settings', { field: 'bank_balance' }, before, after.bank_balance, 'Payment run bank balance');
  res.json(after.bank_balance);
});

// ── vendor bank details (D-363) ───────────────────────────────────────────────
// What a vendor is paid to, as confirmed by phone. Recording them is a decision
// about where money goes: an admin, signed in, with the password. A bot reads.
router.get('/bank-details', (req, res) => {
  if (!gate(req, res)) return;
  res.json(listBankDetails(getDb()));
});

router.post('/bank-details', (req, res) => {
  if (!adminOnly(req, res)) return;
  const db = getDb();
  // Validate before asking for the password (it is asked last).
  try {
    if (String(req.body?.confirmed_note || '').trim().length < 5) throw Object.assign(new Error('Say how the details were confirmed: who you spoke to, and the number you called.'), { status: 400 });
  } catch (e) { return fail(res, e); }
  if (!gateSignature(req, res, { action: 'vendor_bank_details' })) return;
  try {
    const { row, replaced } = recordBankDetails(db, req.body, req.user);
    logAudit(req.user, replaced.length ? 'update' : 'create', 'vendor_bank_details', row.id,
      { vendor: row.vendor_name, routing: row.routing, account_last4: row.account_last4, from_drop_id: row.from_drop_id, signature_verified: true },
      replaced[0] || null, row, row.vendor_name);
    res.status(201).json(row);
  } catch (e) { fail(res, e); }
});

router.get('/runs', (req, res) => {
  if (!gate(req, res)) return;
  res.json(listRuns(getDb(), Math.min(Number(req.query.limit) || 20, 100)));
});

router.get('/runs/:id', (req, res) => {
  if (!gate(req, res)) return;
  const v = runView(getDb(), req.params.id);
  if (!v) return res.status(404).json({ error: 'Run not found' });
  res.json(v);
});

// Prepare (freeze) the run. Weekly: whoever works the queue. Urgent: an admin, with a reason.
router.post('/runs', (req, res) => {
  if (!gate(req, res) || !personOnly(req, res)) return;
  const kind = req.body?.kind === 'urgent' ? 'urgent' : 'weekly';
  if (kind === 'urgent' && !adminOnly(req, res)) return;
  const db = getDb();
  try {
    const v = freezeRun(db, { kind, ids: req.body?.ids, reason: req.body?.reason, by: req.user.name });
    logAudit(req.user, 'create', 'payment_run', v.id, { run_no: v.run_no, kind, bills: v.lines.length, owes: v.summary.owes }, null, null, v.run_no);
    res.status(201).json(v);
  } catch (e) { fail(res, e); }
});

router.post('/runs/:id/bank-balance', (req, res) => {
  if (!adminOnly(req, res)) return;
  try {
    const db = getDb();
    const feed = req.body?.from_feed ? feedBalance(db) : null;
    if (req.body?.from_feed && !feed) return res.status(409).json({ error: 'No bank feed balance to use: no bank account is linked and synced.' });
    const v = setBankBalance(db, req.params.id, feed ? feed.amount : req.body?.amount,
      feed ? `${req.user.name} (bank feed${feed.as_of ? `, as of ${feed.as_of}` : ''})` : req.user.name);
    logAudit(req.user, 'update', 'payment_run', v.id, { field: 'bank_balance', to: v.summary.bank_balance }, null, null, v.run_no);
    res.json(v);
  } catch (e) { fail(res, e); }
});

// Lowry's review is this button: the run goes to Danny with a fresh link.
router.post('/runs/:id/send', async (req, res) => {
  if (!adminOnly(req, res)) return;
  const db = getDb();
  try {
    const out = await sendForApproval(db, req.params.id, { by: req.user.name, to: req.body?.to || null });
    const v = runView(db, req.params.id);
    logAudit(req.user, 'update', 'payment_run', v.id, { action: 'sent_for_approval', to: out.sent_to, texted: out.texted, owes: v.summary.owes }, null, null, v.run_no);
    res.json({ ...out, run: v });
  } catch (e) { fail(res, e); }
});

router.post('/runs/:id/cancel', (req, res) => {
  if (!adminOnly(req, res)) return;
  try {
    const v = cancelRun(getDb(), req.params.id, { by: req.user.name, reason: req.body?.reason });
    logAudit(req.user, 'cancel', 'payment_run', v.id, { reason: v.cancel_reason }, null, null, v.run_no);
    res.json(v);
  } catch (e) { fail(res, e); }
});

// ── close-out (D-364, part D) ────────────────────────────────────────────────
// After Danny's transfer: the money landing, each bill paid with proof and
// marked in QBO (or sent back), the deposit invoice, the shortfall, the close.
// An admin or the Controller, signed in. A token reads the close-out at most.
const proofUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024, files: 1 } });
const closer = (req, res) => {
  if (!personOnly(req, res)) return false;
  if (canCloseOut(getDb(), req.user)) return true;
  res.status(403).json({ error: 'Closing out a run is for an admin or the Controller named in the payment run settings.' });
  return false;
};
const act = (fn, audit) => (req, res) => {
  if (!closer(req, res)) return;
  const db = getDb();
  try {
    const c = fn(db, req);
    logAudit(req.user, audit, 'payment_run', req.params.id, { line_id: req.params.lineId || null, ...(req.body || {}) }, null, null, c?.run_no);
    res.json(c);
  } catch (e) { fail(res, e); }
};

router.get('/runs/:id/closeout', (req, res) => {
  if (!gate(req, res)) return;
  try {
    const c = closeout(getDb(), req.params.id);
    if (!c) return res.status(409).json({ error: 'This run has not been approved yet.' });
    res.json({ ...c, can_close_out: !isToken(req) && canCloseOut(getDb(), req.user) });
  } catch (e) { fail(res, e); }
});
router.post('/runs/:id/received', act((db, req) => confirmReceived(db, req.params.id, req.body || {}, req.user), 'payment_run_received'));
router.post('/runs/:id/lines/:lineId/paid', act((db, req) => recordPayment(db, req.params.id, req.params.lineId, req.body || {}, req.user), 'payment_run_paid'));
router.post('/runs/:id/lines/:lineId/qbo', act((db, req) => markInQbo(db, req.params.id, req.params.lineId, req.body || {}, req.user), 'payment_run_qbo_marked'));
router.post('/runs/:id/lines/:lineId/send-back', act((db, req) => sendBack(db, req.params.id, req.params.lineId, req.body || {}, req.user), 'payment_run_sent_back'));
router.post('/runs/:id/deposit-invoice', act((db, req) => recordDepositInvoice(db, req.params.id, req.body || {}, req.user), 'payment_run_deposit_invoice'));
router.post('/runs/:id/deposit-paid', act((db, req) => markDepositPaid(db, req.params.id, req.user), 'payment_run_deposit_paid'));
router.post('/runs/:id/shortfall', act((db, req) => recordShortfall(db, req.params.id, req.body || {}, req.user), 'payment_run_shortfall'));
router.post('/runs/:id/close', act((db, req) => closeRun(db, req.params.id, req.user), 'payment_run_closed'));
router.post('/runs/:id/production/:invoiceId/paid', act((db, req) => markProductionPaid(db, req.params.id, req.params.invoiceId, req.user), 'payment_run_production_paid'));

// ── production invoices to ProDough (D-365, part E) ──────────────────────────
// A closed MO or a shipped order is recorded by a person (ReadyDoc does not read
// MRPEasy); it is held with its reasons or ready for the Controller to create in
// QBO with the paid Deposits taken off. Recording: whoever works the AP queue.
// The QBO invoice and a void: an admin or the Controller. Never a token.
const announceDeps = { botDm, postMessageAs, pushToUser };
router.get('/production-invoices', (req, res) => {
  if (!gate(req, res)) return;
  const db = getDb();
  res.json({ ...listInvoices(db), can_invoice: !isToken(req) && canCloseOut(db, req.user) });
});
router.post('/production-invoices', (req, res) => {
  if (!personOnly(req, res) || !gate(req, res)) return;
  const db = getDb();
  try {
    const v = recordOrder(db, req.body || {}, req.user);
    logAudit(req.user, 'create', 'production_invoice', v.id, { source: v.source, mo_number: v.mo_number, prodough_po: v.prodough_po, status: v.status }, null, null, v.ref_no);
    res.status(201).json(v);
    announceOrder(db, announceDeps, v).catch(() => {});
  } catch (e) { fail(res, e); }
});
router.post('/production-invoices/:id/recheck', (req, res) => {
  if (!personOnly(req, res) || !gate(req, res)) return;
  const db = getDb();
  try {
    const v = recheckOrder(db, req.params.id, req.body || {}, req.user);
    logAudit(req.user, 'update', 'production_invoice', v.id, { recheck: true, status: v.status, prodough_po: v.prodough_po }, null, null, v.ref_no);
    res.json(v);
    if (v.status === 'to_invoice') announceOrder(db, announceDeps, v).catch(() => {});
  } catch (e) { fail(res, e); }
});
const invoiceAct = (fn, action) => (req, res) => {
  if (!closer(req, res)) return;
  const db = getDb();
  try {
    const before = invoiceView(db, db.prepare('SELECT * FROM production_invoices WHERE id = ?').get(req.params.id));
    const v = fn(db, req);
    logAudit(req.user, action, 'production_invoice', v.id, { ...(req.body || {}) }, before && { status: before.status }, { status: v.status, amount_due: v.amount_due }, v.ref_no);
    res.json(v);
  } catch (e) { fail(res, e); }
};
router.post('/production-invoices/:id/invoiced', invoiceAct((db, req) => markInvoiced(db, req.params.id, req.body || {}, req.user), 'update'));
router.post('/production-invoices/:id/void', invoiceAct((db, req) => voidInvoice(db, req.params.id, req.body || {}, req.user), 'void'));

router.post('/runs/:id/lines/:lineId/proof', proofUpload.single('file'), async (req, res) => {
  if (!closer(req, res)) return;
  if (!storageEnabled()) return res.status(503).json({ error: 'File storage is not configured, so proof cannot be attached yet.' });
  const db = getDb();
  try {
    const c = await addProof(db, req.params.id, req.params.lineId, req.file, req.user, { putObject });
    logAudit(req.user, 'payment_run_proof', 'payment_run', req.params.id, { line_id: req.params.lineId, file: req.file?.originalname }, null, null, c.run_no);
    res.json(c);
  } catch (e) { fail(res, e); }
});

router.get('/runs/:id/lines/:lineId/proof', async (req, res) => {
  if (!gate(req, res)) return;
  const p = getDb().prepare('SELECT proof_key, proof_name FROM payment_run_payments WHERE run_id = ? AND line_id = ?').get(req.params.id, req.params.lineId);
  if (!p?.proof_key) return res.status(404).json({ error: 'No proof attached.' });
  try { res.json({ url: await presignGet(p.proof_key, p.proof_name), name: p.proof_name }); } catch (e) { fail(res, e); }
});

export default router;
