// Money someone spent out of their own pocket, and getting it back to them.
//
// Today that is Marnee and Adam and a personal card. The whole loop is small
// and should stay small: photograph the receipt at the till, say what it was,
// and tick it off when it goes out in payroll. Every field beyond that is a
// reason not to bother filing it, and the claim nobody files is the one that
// turns into an argument three months later.
//
// Three rules worth keeping:
//
//  1. THE RECEIPT IS THE RECORD. A claim with no receipt is a request to be
//     trusted; one with a photo is a document. So a receipt can be added at
//     any point before it is paid, and the list says loudly which claims are
//     still missing one — rather than refusing the claim at the till, where
//     the person is standing in a queue with a phone in one hand.
//  2. PAID IS STAMPED, NEVER GUESSED. Marking paid records who, when, and
//     which pay period, because "did I already reimburse that" is the entire
//     question. A paid claim is closed to editing for everyone but an admin.
//  3. A REJECTION CARRIES A REASON AND IS NOT A DELETE. Someone filed it in
//     good faith and is owed an answer; deleting it just makes them ask again.

import { Router } from 'express';
import { randomUUID as uuid } from 'crypto';
import { readFileSync } from 'fs';
import { getDb, logAudit } from '../db.js';
import { storageEnabled, putObject, presignGet, deleteObject } from '../storage.js';
import { mediaUpload, cleanupTemp, uploadErrorMessage } from '../media.js';
import { coerceCustomData, mergeCustomData, parseJson } from '../custom-fields.js';

const router = Router();

const receiptUpload = mediaUpload({ files: 10 }).array('receipts', 10);
const uploadReceipts = (req, res, next) => receiptUpload(req, res, (err) => {
  if (err) return res.status(413).json({ error: uploadErrorMessage(err) });
  next();
});

/* ── Who may do what ──────────────────────────────────────────────────────── */

// Filing is open — anyone who spent their own money is entitled to ask for it
// back, and gating that behind a module grant is how people go back to texting
// a photo to somebody. Deciding and PAYING is the office's job.
const canSettle = (u) => u?.role === 'admin'
  || (u?.role === 'supervisor' && ['office', 'admin'].includes((u?.department || '').toLowerCase()));

// You can always see and correct your own claim while it is still open; the
// office sees everything.
const ownsOrSettles = (u, row) => canSettle(u)
  || (row.user_id && row.user_id === u?.id)
  || (row.person && row.person === u?.name);

const CATEGORIES = ['Supplies', 'Equipment', 'Shipping', 'Travel & mileage', 'Meals', 'Fuel', 'Other'];

const clean = (v, max = 300) => {
  const s = String(v ?? '').trim();
  return s ? s.slice(0, max) : null;
};
const money = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : NaN;
};
const isoDay = (v) => {
  const s = String(v ?? '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
};

/* ── Reading ──────────────────────────────────────────────────────────────── */

function receiptsFor(db, ids) {
  if (!ids.length) return {};
  const rows = db.prepare(`SELECT id, reimbursement_id, storage_key, filename, content_type, size
    FROM reimbursement_receipts WHERE reimbursement_id IN (${ids.map(() => '?').join(',')})`).all(...ids);
  const by = {};
  for (const r of rows) (by[r.reimbursement_id] ||= []).push(r);
  return by;
}

// `can_edit` is stamped by the SERVER, the same rule qms.js uses — the client
// renders what it is told rather than keeping a second copy of the policy that
// can drift out of step with this one.
const withPermissions = (row, user) => ({
  ...row,
  can_edit: row.status === 'paid' ? user?.role === 'admin' : ownsOrSettles(user, row),
  can_decide: canSettle(user),
});

router.get('/', (req, res) => {
  const db = getDb();
  const q = req.query;
  let sql = 'SELECT * FROM reimbursements WHERE 1=1';
  const params = [];

  // Someone without office rights only ever sees their own claims. This is a
  // pay record — what a colleague spent is not their business.
  if (!canSettle(req.user)) {
    sql += ' AND (user_id = ? OR person = ?)';
    params.push(req.user?.id || '', req.user?.name || '');
  } else if (q.person) { sql += ' AND person = ?'; params.push(q.person); }

  if (q.status && q.status !== 'all') { sql += ' AND status = ?'; params.push(q.status); }
  if (isoDay(q.from)) { sql += ' AND spent_on >= ?'; params.push(isoDay(q.from)); }
  if (isoDay(q.to)) { sql += ' AND spent_on <= ?'; params.push(isoDay(q.to)); }
  if (q.q) {
    sql += ' AND (merchant LIKE ? OR description LIKE ? OR category LIKE ? OR payment_reference LIKE ?)';
    const like = `%${q.q}%`;
    params.push(like, like, like, like);
  }
  sql += ' ORDER BY spent_on DESC, created_at DESC LIMIT ?';
  params.push(Math.min(Number(q.limit) || 500, 2000));

  const rows = db.prepare(sql).all(...params);
  const byId = receiptsFor(db, rows.map(r => r.id));

  // The two numbers that matter are "what do I owe people" and "what still
  // needs a decision" — computed here so the screen never adds up its own.
  const scope = canSettle(req.user) ? '' : ' AND (user_id = ? OR person = ?)';
  const scopeParams = canSettle(req.user) ? [] : [req.user?.id || '', req.user?.name || ''];
  const totals = db.prepare(`SELECT
      COALESCE(SUM(CASE WHEN status IN ('submitted','approved') THEN amount END), 0) AS owed,
      COALESCE(SUM(CASE WHEN status = 'submitted' THEN amount END), 0) AS awaiting_review,
      COUNT(CASE WHEN status = 'submitted' THEN 1 END) AS awaiting_count,
      COUNT(CASE WHEN status = 'approved' THEN 1 END) AS approved_count
    FROM reimbursements WHERE 1=1${scope}`).get(...scopeParams);

  res.json({
    reimbursements: rows.map(r => ({
      ...withPermissions(r, req.user),
      // parseJson, not bare JSON.parse: this is a LIST, so one row with
      // malformed custom_data took the whole response down with a 500 rather
      // than degrading that row. Every other module on the custom-fields
      // engine already uses it.
      custom_data: parseJson(r.custom_data, {}),
      receipts: (byId[r.id] || []).map(({ storage_key, ...x }) => ({ ...x, has_file: !!storage_key })),
    })),
    totals,
    categories: CATEGORIES,
    // Only the office can see the roster filter; for everyone else there is
    // nothing to filter by.
    people: canSettle(req.user)
      ? db.prepare('SELECT DISTINCT person FROM reimbursements ORDER BY person').all().map(r => r.person)
      : [],
    storage_enabled: storageEnabled(),
  });
});

/* ── Filing ───────────────────────────────────────────────────────────────── */

router.post('/', uploadReceipts, async (req, res) => {
  const files = req.files || [];
  try {
    const db = getDb();
    const amount = money(req.body?.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ error: 'How much was it?' });
    }
    const spentOn = isoDay(req.body?.spent_on) || new Date().toISOString().slice(0, 10);
    if (spentOn > new Date().toISOString().slice(0, 10)) {
      return res.status(400).json({ error: 'That date is in the future — a receipt can\'t be from tomorrow.' });
    }

    // The office can file on someone else's behalf (a receipt handed over on
    // paper); everyone else files as themselves, whatever the form says.
    let person = req.user?.name || 'Unknown';
    let userId = req.user?.id || null;
    if (canSettle(req.user) && req.body?.user_id) {
      const u = db.prepare('SELECT id, name FROM users WHERE id = ?').get(req.body.user_id);
      if (u) { person = u.name; userId = u.id; }
    }

    const id = uuid();
    db.prepare(`INSERT INTO reimbursements
      (id, user_id, person, spent_on, amount, category, merchant, description, payment_method,
       custom_data, created_by)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
      .run(id, userId, person, spentOn, amount,
        clean(req.body?.category, 60), clean(req.body?.merchant, 160),
        clean(req.body?.description, 1000), clean(req.body?.payment_method, 60) || 'Personal card',
        JSON.stringify(coerceCustomData('reimbursement', req.body?.custom_data)), req.user?.name || null);

    await storeReceipts(db, id, files, req.user);
    logAudit(req.user, 'create', 'reimbursement', id,
      { amount, person, receipts: files.length }, null, null, `${person} — $${amount}`);
    res.status(201).json(loadOne(db, id, req.user));
  } finally {
    cleanupTemp(files);
  }
});

async function storeReceipts(db, reimbursementId, files, user) {
  if (!files?.length) return;
  if (!storageEnabled()) {
    // Not fatal on purpose: the claim is worth having even when the photo
    // can't be stored. The list will show it as missing a receipt.
    return;
  }
  for (const f of files) {
    const rid = uuid();
    const safe = (f.originalname || 'receipt').replace(/[^\w.-]+/g, '_').slice(0, 120);
    const key = `reimbursements/${reimbursementId}/${rid}-${safe}`;
    await putObject(key, readFileSync(f.path), f.mimetype);
    db.prepare(`INSERT INTO reimbursement_receipts
      (id, reimbursement_id, storage_key, filename, content_type, size, uploaded_by)
      VALUES (?,?,?,?,?,?,?)`)
      .run(rid, reimbursementId, key, (f.originalname || 'receipt').slice(0, 255),
        f.mimetype || null, f.size || null, user?.name || null);
  }
}

function loadOne(db, id, user) {
  const row = db.prepare('SELECT * FROM reimbursements WHERE id = ?').get(id);
  if (!row) return null;
  const receipts = db.prepare(`SELECT id, filename, content_type, size, storage_key
    FROM reimbursement_receipts WHERE reimbursement_id = ?`).all(id);
  return {
    ...withPermissions(row, user),
    custom_data: parseJson(row.custom_data, {}),
    receipts: receipts.map(({ storage_key, ...r }) => ({ ...r, has_file: !!storage_key })),
  };
}

// A receipt can be added after the fact — someone files the amount at the till
// and photographs the paper when they are back at a desk.
router.post('/:id/receipts', uploadReceipts, async (req, res) => {
  const files = req.files || [];
  try {
    const db = getDb();
    const row = db.prepare('SELECT * FROM reimbursements WHERE id = ?').get(req.params.id);
    if (!row) return res.status(404).json({ error: 'Not found' });
    if (!ownsOrSettles(req.user, row)) return res.status(403).json({ error: 'Not your claim.' });
    if (row.status === 'paid' && req.user?.role !== 'admin') {
      return res.status(400).json({ error: 'This one was already paid.' });
    }
    if (!storageEnabled()) return res.status(503).json({ error: 'File storage is not configured on this server.' });
    if (!files.length) return res.status(400).json({ error: 'No file received.' });
    await storeReceipts(db, row.id, files, req.user);
    logAudit(req.user, 'update', 'reimbursement', row.id, { receipts_added: files.length }, null, null, row.person);
    res.json(loadOne(db, row.id, req.user));
  } finally {
    cleanupTemp(files);
  }
});

router.get('/receipts/:receiptId/file', async (req, res) => {
  const db = getDb();
  const r = db.prepare(`SELECT rr.*, rb.user_id, rb.person FROM reimbursement_receipts rr
    JOIN reimbursements rb ON rb.id = rr.reimbursement_id WHERE rr.id = ?`).get(req.params.receiptId);
  if (!r?.storage_key) return res.status(404).json({ error: 'No file' });
  if (!ownsOrSettles(req.user, r)) return res.status(403).json({ error: 'Not your receipt.' });
  res.json({ url: await presignGet(r.storage_key, r.filename) });
});

router.delete('/receipts/:receiptId', (req, res) => {
  const db = getDb();
  const r = db.prepare(`SELECT rr.*, rb.status, rb.user_id, rb.person FROM reimbursement_receipts rr
    JOIN reimbursements rb ON rb.id = rr.reimbursement_id WHERE rr.id = ?`).get(req.params.receiptId);
  if (!r) return res.status(404).json({ error: 'Not found' });
  if (!ownsOrSettles(req.user, r)) return res.status(403).json({ error: 'Not your receipt.' });
  if (r.status === 'paid' && req.user?.role !== 'admin') {
    return res.status(400).json({ error: 'This claim was already paid — its receipts are the record of it.' });
  }
  db.prepare('DELETE FROM reimbursement_receipts WHERE id = ?').run(r.id);
  if (r.storage_key) deleteObject(r.storage_key);
  logAudit(req.user, 'delete', 'reimbursement_receipt', r.id, { filename: r.filename }, null, null, r.person);
  res.json({ ok: true });
});

/* ── Correcting ───────────────────────────────────────────────────────────── */

router.put('/:id', (req, res) => {
  const db = getDb();
  const before = db.prepare('SELECT * FROM reimbursements WHERE id = ?').get(req.params.id);
  if (!before) return res.status(404).json({ error: 'Not found' });
  if (!ownsOrSettles(req.user, before)) return res.status(403).json({ error: 'Not your claim.' });
  if (before.status === 'paid' && req.user?.role !== 'admin') {
    return res.status(400).json({ error: 'This one was already paid. Ask an admin if the amount was wrong.' });
  }
  const amount = req.body?.amount !== undefined ? money(req.body.amount) : before.amount;
  if (!Number.isFinite(amount) || amount <= 0) return res.status(400).json({ error: 'How much was it?' });

  db.prepare(`UPDATE reimbursements SET spent_on = ?, amount = ?, category = ?, merchant = ?,
      description = ?, payment_method = ?, custom_data = ?, updated_at = datetime('now'), updated_by = ?
    WHERE id = ?`)
    .run(isoDay(req.body?.spent_on) || before.spent_on, amount,
      clean(req.body?.category, 60), clean(req.body?.merchant, 160),
      clean(req.body?.description, 1000), clean(req.body?.payment_method, 60),
      JSON.stringify(mergeCustomData('reimbursement', before.custom_data, req.body?.custom_data)),
      req.user?.name || null, before.id);
  const after = db.prepare('SELECT * FROM reimbursements WHERE id = ?').get(before.id);
  logAudit(req.user, 'update', 'reimbursement', before.id, null, before, after, after.person);
  res.json(loadOne(db, before.id, req.user));
});

router.delete('/:id', (req, res) => {
  const db = getDb();
  const row = db.prepare('SELECT * FROM reimbursements WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  // Withdrawing your own un-decided claim is fine — you filed it by mistake.
  // Once someone has decided on it, it is a record and gets rejected, not
  // removed.
  const mine = row.user_id === req.user?.id || row.person === req.user?.name;
  const allowed = req.user?.role === 'admin' || (mine && row.status === 'submitted');
  if (!allowed) return res.status(403).json({ error: 'Reject it with a reason rather than deleting it.' });
  const keys = db.prepare('SELECT storage_key FROM reimbursement_receipts WHERE reimbursement_id = ?').all(row.id);
  db.prepare('DELETE FROM reimbursement_receipts WHERE reimbursement_id = ?').run(row.id);
  db.prepare('DELETE FROM reimbursements WHERE id = ?').run(row.id);
  for (const k of keys) if (k.storage_key) deleteObject(k.storage_key);
  logAudit(req.user, 'delete', 'reimbursement', row.id, null, row, null, row.person);
  res.json({ ok: true });
});

/* ── Deciding and paying ──────────────────────────────────────────────────── */

router.post('/:id/approve', (req, res) => {
  if (!canSettle(req.user)) return res.status(403).json({ error: 'Only the office or an admin can approve a reimbursement.' });
  const db = getDb();
  const before = db.prepare('SELECT * FROM reimbursements WHERE id = ?').get(req.params.id);
  if (!before) return res.status(404).json({ error: 'Not found' });
  if (before.status === 'paid') return res.status(400).json({ error: 'Already paid.' });
  db.prepare(`UPDATE reimbursements SET status = 'approved', approved_at = datetime('now'), approved_by = ?,
      rejected_at = NULL, rejected_by = NULL, rejected_reason = NULL WHERE id = ?`)
    .run(req.user?.name || null, before.id);
  logAudit(req.user, 'update', 'reimbursement', before.id, { approved: true }, before,
    db.prepare('SELECT * FROM reimbursements WHERE id = ?').get(before.id), before.person);
  res.json(loadOne(db, before.id, req.user));
});

router.post('/:id/reject', (req, res) => {
  if (!canSettle(req.user)) return res.status(403).json({ error: 'Only the office or an admin can decide a reimbursement.' });
  const db = getDb();
  const before = db.prepare('SELECT * FROM reimbursements WHERE id = ?').get(req.params.id);
  if (!before) return res.status(404).json({ error: 'Not found' });
  if (before.status === 'paid') return res.status(400).json({ error: 'This one was already paid.' });
  const reason = clean(req.body?.reason, 1000);
  if (!reason || reason.length < 3) {
    return res.status(400).json({ error: 'Say why — they filed it in good faith and are owed an answer.' });
  }
  db.prepare(`UPDATE reimbursements SET status = 'rejected', rejected_at = datetime('now'),
      rejected_by = ?, rejected_reason = ? WHERE id = ?`)
    .run(req.user?.name || null, reason, before.id);
  logAudit(req.user, 'update', 'reimbursement', before.id, { rejected: reason }, before,
    db.prepare('SELECT * FROM reimbursements WHERE id = ?').get(before.id), before.person);
  res.json(loadOne(db, before.id, req.user));
});

// The act this whole table exists for: it went out in a payroll run, tick it
// off. Batched, because that is how payroll is actually done — one run, several
// people — but stamped per record so the trail is the same either way.
router.post('/pay', (req, res) => {
  if (!canSettle(req.user)) return res.status(403).json({ error: 'Only the office or an admin can mark a reimbursement paid.' });
  const db = getDb();
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.filter(Boolean) : [];
  if (!ids.length) return res.status(400).json({ error: 'Nothing selected.' });
  const period = clean(req.body?.pay_period, 60);
  const reference = clean(req.body?.payment_reference, 200);

  const paid = [], skipped = [];
  const stamp = db.prepare(`UPDATE reimbursements SET status = 'paid', paid_at = datetime('now'),
    paid_by = ?, pay_period = ?, payment_reference = ? WHERE id = ?`);
  const tx = db.transaction(() => {
    for (const id of ids) {
      const row = db.prepare('SELECT * FROM reimbursements WHERE id = ?').get(id);
      if (!row) { skipped.push({ id, reason: 'not found' }); continue; }
      if (row.status === 'paid') { skipped.push({ id, person: row.person, reason: 'already paid' }); continue; }
      if (row.status === 'rejected') { skipped.push({ id, person: row.person, reason: 'rejected' }); continue; }
      stamp.run(req.user?.name || null, period, reference, id);
      paid.push(row);
    }
  });
  tx();

  // Audited individually as well as in summary — a batch has to leave the trail
  // a one-at-a-time run would.
  for (const row of paid) {
    logAudit(req.user, 'update', 'reimbursement', row.id,
      { paid: true, pay_period: period, amount: row.amount }, row,
      db.prepare('SELECT * FROM reimbursements WHERE id = ?').get(row.id), row.person);
  }
  if (paid.length > 1) {
    logAudit(req.user, 'update', 'reimbursement_batch', null, {
      count: paid.length, total: Math.round(paid.reduce((t, r) => t + r.amount, 0) * 100) / 100,
      pay_period: period, people: [...new Set(paid.map(r => r.person))],
    }, null, null, period || 'payroll run');
  }

  res.json({
    paid: paid.length,
    total: Math.round(paid.reduce((t, r) => t + r.amount, 0) * 100) / 100,
    skipped,
  });
});

export default router;
