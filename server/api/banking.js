// Banking and reconciliation — custody for the arithmetic in bank-match.js.
//
// The job this replaces is somebody sitting with a statement in one window and
// a ledger in another, ticking lines off. So the screen this serves has one
// number on it — how many lines are still unaccounted for — and everything
// else exists to drive that to zero.
//
// Candidates come from the ledgers ReadyDoc already keeps: AP bills, AR
// invoices, reimbursements and partner settlements. Nothing new is invented to
// match against; if a payment has no document here, that is itself the finding.

import { Router } from 'express';
import multer from 'multer';
import { randomUUID as uuid } from 'crypto';
import { getDb, logAudit } from '../db.js';
import { parseStatement } from '../bank-formats.js';
import { suggestFor, planMatches, reconcile, round2, AUTO_THRESHOLD } from '../bank-match.js';
import {
  bankFeedEnabled, bankFeedStatus, createLinkToken, exchangePublicToken,
  syncItem, saveItemToken, readItemToken, saveCursor, removeItem, fetchBalances,
} from '../bank-feed.js';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

// Reconciling is an office act. Reading it is open to whoever has the module —
// seeing that the account balances is useful well beyond the person doing it.
const canReconcile = (u) => u?.role === 'admin'
  || (u?.role === 'supervisor' && ['office', 'admin'].includes((u?.department || '').toLowerCase()));

const clean = (v, max = 300) => {
  const s = String(v ?? '').trim();
  return s ? s.slice(0, max) : null;
};
const isoDay = (v) => {
  const s = String(v ?? '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
};
const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? round2(n) : null;
};

/* ── What a bank line could be ────────────────────────────────────────────── */

// Everything still open across the ledgers, in the one shape the matcher takes.
// Deliberately bounded and deliberately only OPEN items: a paid invoice is not
// a candidate for another payment.
function candidatesFor(db, { from, to }) {
  const out = [];
  const win = (col) => (from && to ? ` AND ${col} BETWEEN date(?, '-120 days') AND date(?, '+30 days')` : '');
  const winArgs = from && to ? [from, to] : [];

  const ap = db.prepare(`SELECT id, vendor, invoice_number, amount, amount_paid, invoice_date, due_date, status
    FROM ap_invoices WHERE status NOT IN ('paid', 'void')${win('COALESCE(invoice_date, due_date)')} LIMIT 2000`)
    .all(...winArgs);
  for (const r of ap) {
    const owed = round2(Number(r.amount || 0) - Number(r.amount_paid || 0));
    if (owed > 0) {
      out.push({
        type: 'ap_invoice', id: r.id, label: r.vendor || 'Vendor', amount: owed,
        date: r.invoice_date || r.due_date, direction: 'out', reference: r.invoice_number,
        detail: `AP · ${r.vendor || '—'} · ${r.invoice_number || 'no number'}`,
      });
    }
  }

  const ar = db.prepare(`SELECT id, customer, invoice_number, amount, amount_received, invoice_date, due_date, status
    FROM ar_invoices WHERE status NOT IN ('paid', 'void')${win('COALESCE(invoice_date, due_date)')} LIMIT 2000`)
    .all(...winArgs);
  for (const r of ar) {
    const owed = round2(Number(r.amount || 0) - Number(r.amount_received || 0));
    if (owed > 0) {
      out.push({
        type: 'ar_invoice', id: r.id, label: r.customer || 'Customer', amount: owed,
        date: r.invoice_date || r.due_date, direction: 'in', reference: r.invoice_number,
        detail: `AR · ${r.customer || '—'} · ${r.invoice_number || 'no number'}`,
      });
    }
  }

  // A reimbursement is money out the moment it is approved — it is owed
  // whether or not payroll has run yet.
  const reimb = db.prepare(`SELECT id, person, amount, spent_on, merchant, pay_period
    FROM reimbursements WHERE status IN ('approved', 'paid')${win('spent_on')} LIMIT 1000`).all(...winArgs);
  for (const r of reimb) {
    out.push({
      type: 'reimbursement', id: r.id, label: r.person, amount: round2(r.amount),
      date: r.spent_on, direction: 'out', reference: r.pay_period,
      detail: `Reimbursement · ${r.person} · ${r.merchant || 'no merchant'}`,
    });
  }

  // A settled partner period is one real payment in one direction.
  const setts = db.prepare(`SELECT s.id, s.period_end, s.net_amount, s.owed_to, s.payment_reference, p.name
    FROM partner_settlements s JOIN partner_accounts p ON p.id = s.partner_id
    WHERE s.status = 'paid' LIMIT 500`).all();
  for (const r of setts) {
    if (!r.net_amount) continue;
    out.push({
      type: 'partner_settlement', id: r.id, label: r.name,
      amount: round2(Math.abs(r.net_amount)), date: r.period_end,
      // owed_to 'us' means they paid us: money in.
      direction: r.owed_to === 'us' ? 'in' : 'out',
      reference: r.payment_reference,
      detail: `${r.name} settlement · ${r.period_end}`,
    });
  }

  return out;
}

/* ── Accounts ─────────────────────────────────────────────────────────────── */

router.get('/accounts', (req, res) => {
  const db = getDb();
  const rows = db.prepare(`SELECT a.*,
      (SELECT COUNT(*) FROM bank_transactions t WHERE t.account_id = a.id AND t.status = 'unmatched') AS unmatched,
      (SELECT COUNT(*) FROM bank_transactions t WHERE t.account_id = a.id) AS transactions,
      (SELECT MAX(period_end) FROM bank_reconciliations r WHERE r.account_id = a.id AND r.status = 'closed') AS reconciled_through
    FROM bank_accounts a WHERE a.is_active = 1 ORDER BY a.name`).all();
  res.json({ accounts: rows, feed: bankFeedStatus(), can_reconcile: canReconcile(req.user) });
});

router.post('/accounts', (req, res) => {
  if (!canReconcile(req.user)) return res.status(403).json({ error: 'Only the office or an admin can add a bank account.' });
  const name = clean(req.body?.name, 120);
  if (!name) return res.status(400).json({ error: 'Give the account a name.' });
  const id = uuid();
  getDb().prepare(`INSERT INTO bank_accounts
    (id, name, institution, account_type, mask, opening_balance, opening_date, created_by)
    VALUES (?,?,?,?,?,?,?,?)`)
    .run(id, name, clean(req.body?.institution, 120), clean(req.body?.account_type, 60),
      clean(req.body?.mask, 8), num(req.body?.opening_balance) ?? 0,
      isoDay(req.body?.opening_date), req.user?.name || null);
  logAudit(req.user, 'create', 'bank_account', id, { name }, null, null, name);
  res.status(201).json(getDb().prepare('SELECT * FROM bank_accounts WHERE id = ?').get(id));
});

router.put('/accounts/:id', (req, res) => {
  if (!canReconcile(req.user)) return res.status(403).json({ error: 'Not allowed.' });
  const db = getDb();
  const before = db.prepare('SELECT * FROM bank_accounts WHERE id = ?').get(req.params.id);
  if (!before) return res.status(404).json({ error: 'Account not found' });
  // The opening balance is what every reconciliation is built on. Once a period
  // is closed it is part of that arithmetic and moving it would silently
  // invalidate the history.
  const closed = db.prepare("SELECT COUNT(*) n FROM bank_reconciliations WHERE account_id = ? AND status = 'closed'").get(before.id).n;
  const opening = num(req.body?.opening_balance);
  if (closed > 0 && opening !== null && opening !== round2(before.opening_balance)) {
    return res.status(400).json({ error: 'This account has closed reconciliations. Changing the opening balance would invalidate them — reopen the earliest period first.' });
  }
  db.prepare(`UPDATE bank_accounts SET name = ?, institution = ?, account_type = ?, mask = ?,
      opening_balance = ?, opening_date = ? WHERE id = ?`)
    .run(clean(req.body?.name, 120) || before.name, clean(req.body?.institution, 120),
      clean(req.body?.account_type, 60), clean(req.body?.mask, 8),
      opening ?? before.opening_balance, isoDay(req.body?.opening_date) || before.opening_date, before.id);
  const after = db.prepare('SELECT * FROM bank_accounts WHERE id = ?').get(before.id);
  logAudit(req.user, 'update', 'bank_account', before.id, null, before, after, after.name);
  res.json(after);
});

/* ── Transactions ─────────────────────────────────────────────────────────── */

router.get('/accounts/:id/transactions', (req, res) => {
  const db = getDb();
  const q = req.query;
  let sql = 'SELECT * FROM bank_transactions WHERE account_id = ?';
  const params = [req.params.id];
  if (q.status && q.status !== 'all') { sql += ' AND status = ?'; params.push(q.status); }
  if (isoDay(q.from)) { sql += ' AND posted_date >= ?'; params.push(isoDay(q.from)); }
  if (isoDay(q.to)) { sql += ' AND posted_date <= ?'; params.push(isoDay(q.to)); }
  if (q.q) { sql += ' AND (description LIKE ? OR counterparty LIKE ? OR reference LIKE ?)'; const l = `%${q.q}%`; params.push(l, l, l); }
  sql += ' ORDER BY posted_date DESC, rowid DESC LIMIT ?';
  params.push(Math.min(Number(q.limit) || 500, 2000));

  const rows = db.prepare(sql).all(...params);
  const matches = rows.length
    ? db.prepare(`SELECT * FROM bank_transaction_matches WHERE transaction_id IN (${rows.map(() => '?').join(',')})`).all(...rows.map(r => r.id))
    : [];
  const byTxn = {};
  for (const m of matches) (byTxn[m.transaction_id] ||= []).push(m);

  res.json({
    transactions: rows.map(r => ({ ...r, matches: byTxn[r.id] || [] })),
    can_reconcile: canReconcile(req.user),
  });
});

// The suggestion list for one line — computed on demand so it reflects what is
// still open right now, rather than whatever was true when the file landed.
router.get('/transactions/:id/suggestions', (req, res) => {
  const db = getDb();
  const t = db.prepare('SELECT * FROM bank_transactions WHERE id = ?').get(req.params.id);
  if (!t) return res.status(404).json({ error: 'Not found' });
  const cands = candidatesFor(db, { from: t.posted_date, to: t.posted_date });
  res.json(suggestFor(t, cands));
});

/* ── Bringing transactions in ─────────────────────────────────────────────── */

// One place writes bank transactions, whether they came from a file or a feed.
// Upserted on the provider's id so a re-imported overlapping range or a
// repeated sync updates rather than duplicating — the single most common way a
// reconciliation goes wrong.
function ingest(db, accountId, transactions, source) {
  const ins = db.prepare(`INSERT INTO bank_transactions
    (id, account_id, posted_date, description, counterparty, reference, amount, pending, category, external_id, source)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
  const upd = db.prepare(`UPDATE bank_transactions SET posted_date = ?, description = ?, counterparty = ?,
    reference = ?, amount = ?, pending = ?, category = ? WHERE id = ?`);
  const find = db.prepare('SELECT * FROM bank_transactions WHERE account_id = ? AND external_id = ?');

  let created = 0, updated = 0, skipped = 0;
  for (const t of transactions) {
    if (!t.posted_date || !Number.isFinite(Number(t.amount))) { skipped++; continue; }
    const prior = t.external_id ? find.get(accountId, t.external_id) : null;
    if (prior) {
      // A line already inside a closed reconciliation is history. Letting a
      // re-import move its amount would change a period that has been signed
      // off, so it is left exactly as it was.
      if (prior.reconciliation_id) { skipped++; continue; }
      upd.run(t.posted_date, t.description, t.counterparty, t.reference,
        round2(t.amount), t.pending ? 1 : 0, t.category || null, prior.id);
      updated++;
    } else {
      ins.run(uuid(), accountId, t.posted_date, t.description, t.counterparty, t.reference,
        round2(t.amount), t.pending ? 1 : 0, t.category || null, t.external_id || null, source);
      created++;
    }
  }
  return { created, updated, skipped };
}

// Apply the rules people have taught it, then auto-match what is unambiguous.
// Both are best-effort improvements to a list a human still reviews.
function autoProcess(db, accountId) {
  const rules = db.prepare('SELECT * FROM bank_rules WHERE account_id IS NULL OR account_id = ?').all(accountId);
  const open = db.prepare("SELECT * FROM bank_transactions WHERE account_id = ? AND status = 'unmatched' AND reconciliation_id IS NULL").all(accountId);

  let ruled = 0;
  for (const t of open) {
    const hay = `${t.description || ''} ${t.counterparty || ''}`.toLowerCase();
    const rule = rules.find(r => hay.includes(String(r.match_text).toLowerCase()));
    if (!rule) continue;
    if (rule.action === 'categorize') {
      db.prepare('UPDATE bank_transactions SET category = ?, counterparty = COALESCE(?, counterparty) WHERE id = ?')
        .run(rule.category, rule.counterparty, t.id);
    } else {
      db.prepare(`UPDATE bank_transactions SET status = ?, category = ?, resolution_note = ?,
          resolved_at = datetime('now'), resolved_by = ? WHERE id = ?`)
        .run(rule.action === 'ignore' ? 'ignored' : 'no_document', rule.category,
          `Rule: ${rule.match_text}`, 'ReadyDoc rule', t.id);
    }
    db.prepare('UPDATE bank_rules SET hits = hits + 1 WHERE id = ?').run(rule.id);
    ruled++;
  }

  const stillOpen = db.prepare("SELECT * FROM bank_transactions WHERE account_id = ? AND status = 'unmatched' AND reconciliation_id IS NULL").all(accountId);
  if (!stillOpen.length) return { ruled, auto_matched: 0 };
  const dates = stillOpen.map(t => t.posted_date).sort();
  const cands = candidatesFor(db, { from: dates[0], to: dates[dates.length - 1] });
  const plan = planMatches(stillOpen, cands);

  let auto = 0;
  const insMatch = db.prepare(`INSERT INTO bank_transaction_matches
    (id, transaction_id, target_type, target_id, amount, confidence, auto, matched_by)
    VALUES (?,?,?,?,?,?,1,?)`);
  for (const p of plan) {
    if (!p.auto || !p.best) continue;
    const t = stillOpen.find(x => x.id === p.transaction_id);
    insMatch.run(uuid(), t.id, p.best.type, p.best.id, round2(Math.abs(t.amount)), p.best.score, 'ReadyDoc');
    db.prepare("UPDATE bank_transactions SET status = 'matched' WHERE id = ?").run(t.id);
    auto++;
  }
  return { ruled, auto_matched: auto };
}

router.post('/accounts/:id/import', upload.single('file'), (req, res) => {
  if (!canReconcile(req.user)) return res.status(403).json({ error: 'Only the office or an admin can import a statement.' });
  if (!req.file) return res.status(400).json({ error: 'Attach the statement (.csv, .ofx or .qfx).' });
  const db = getDb();
  const account = db.prepare('SELECT * FROM bank_accounts WHERE id = ?').get(req.params.id);
  if (!account) return res.status(404).json({ error: 'Account not found' });

  const parsed = parseStatement(req.file.buffer, req.file.originalname);
  if (parsed.error) return res.status(400).json({ error: parsed.error });

  let counts, processed;
  db.transaction(() => {
    counts = ingest(db, account.id, parsed.transactions, `statement:${req.file.originalname}`.slice(0, 200));
    processed = autoProcess(db, account.id);
    if (parsed.statement?.balance !== null && parsed.statement?.balance !== undefined) {
      db.prepare('UPDATE bank_accounts SET current_balance = ?, balance_as_of = ? WHERE id = ?')
        .run(parsed.statement.balance, parsed.statement.balance_date || null, account.id);
    }
  })();

  logAudit(req.user, 'create', 'bank_transaction', null, {
    account: account.name, file: req.file.originalname, format: parsed.format, ...counts, ...processed,
  }, null, null, account.name);
  res.status(201).json({ format: parsed.format, ...counts, ...processed, statement: parsed.statement });
});

/* ── Matching ─────────────────────────────────────────────────────────────── */

router.post('/transactions/:id/match', (req, res) => {
  if (!canReconcile(req.user)) return res.status(403).json({ error: 'Only the office or an admin can match a transaction.' });
  const db = getDb();
  const t = db.prepare('SELECT * FROM bank_transactions WHERE id = ?').get(req.params.id);
  if (!t) return res.status(404).json({ error: 'Not found' });
  if (t.reconciliation_id) return res.status(400).json({ error: 'This line is inside a closed reconciliation.' });

  // A list, because one payment can cover several documents.
  const targets = Array.isArray(req.body?.targets) ? req.body.targets : [req.body];
  const rows = targets
    .map(x => ({ type: clean(x?.target_type, 40), id: clean(x?.target_id, 60), amount: num(x?.amount) }))
    .filter(x => x.type && x.id);
  if (!rows.length) return res.status(400).json({ error: 'Nothing to match to.' });

  const total = round2(rows.reduce((s, r) => s + Math.abs(r.amount ?? Math.abs(t.amount)), 0));
  if (rows.length > 1 && total !== round2(Math.abs(t.amount))) {
    return res.status(400).json({
      error: `Those add up to ${total.toFixed(2)}, but the bank line is ${Math.abs(t.amount).toFixed(2)}. A split has to account for the whole payment.`,
    });
  }

  db.transaction(() => {
    db.prepare('DELETE FROM bank_transaction_matches WHERE transaction_id = ?').run(t.id);
    const ins = db.prepare(`INSERT INTO bank_transaction_matches
      (id, transaction_id, target_type, target_id, amount, confidence, auto, matched_by)
      VALUES (?,?,?,?,?,?,0,?)`);
    for (const r of rows) {
      ins.run(uuid(), t.id, r.type, r.id, r.amount ?? round2(Math.abs(t.amount)),
        num(req.body?.confidence), req.user?.name || null);
    }
    db.prepare(`UPDATE bank_transactions SET status = 'matched', resolved_at = datetime('now'),
      resolved_by = ?, resolution_note = NULL WHERE id = ?`).run(req.user?.name || null, t.id);
  })();

  logAudit(req.user, 'update', 'bank_transaction', t.id,
    { matched: rows.map(r => `${r.type}:${r.id}`) }, t, null, t.description || t.id);
  res.json({ ok: true });
});

// Undoing a match must be as easy as making one, or people stop making them.
router.delete('/transactions/:id/match', (req, res) => {
  if (!canReconcile(req.user)) return res.status(403).json({ error: 'Not allowed.' });
  const db = getDb();
  const t = db.prepare('SELECT * FROM bank_transactions WHERE id = ?').get(req.params.id);
  if (!t) return res.status(404).json({ error: 'Not found' });
  if (t.reconciliation_id) return res.status(400).json({ error: 'This line is inside a closed reconciliation.' });
  db.transaction(() => {
    db.prepare('DELETE FROM bank_transaction_matches WHERE transaction_id = ?').run(t.id);
    db.prepare(`UPDATE bank_transactions SET status = 'unmatched', resolved_at = NULL,
      resolved_by = NULL, resolution_note = NULL WHERE id = ?`).run(t.id);
  })();
  logAudit(req.user, 'update', 'bank_transaction', t.id, { unmatched: true }, t, null, t.description || t.id);
  res.json({ ok: true });
});

// "This is a bank fee / interest / a transfer — there is no document." A real
// answer, and the reason a reconciliation can reach zero honestly.
router.post('/transactions/:id/resolve', (req, res) => {
  if (!canReconcile(req.user)) return res.status(403).json({ error: 'Not allowed.' });
  const db = getDb();
  const t = db.prepare('SELECT * FROM bank_transactions WHERE id = ?').get(req.params.id);
  if (!t) return res.status(404).json({ error: 'Not found' });
  if (t.reconciliation_id) return res.status(400).json({ error: 'This line is inside a closed reconciliation.' });
  const note = clean(req.body?.note, 500);
  if (!note || note.length < 3) return res.status(400).json({ error: 'Say what it was — a line closed with no explanation is the gap this is meant to remove.' });
  const status = req.body?.status === 'ignored' ? 'ignored' : 'no_document';

  db.prepare(`UPDATE bank_transactions SET status = ?, category = ?, resolution_note = ?,
      resolved_at = datetime('now'), resolved_by = ? WHERE id = ?`)
    .run(status, clean(req.body?.category, 60), note, req.user?.name || null, t.id);

  // Offer to remember it. The rules table is taught by what the office does,
  // never shipped as a guess about this plant's vendors.
  if (req.body?.remember && t.description) {
    const key = clean(req.body?.match_text, 120) || String(t.description).slice(0, 40);
    db.prepare(`INSERT INTO bank_rules (id, account_id, match_text, category, action, created_by)
      VALUES (?,?,?,?,?,?)`)
      .run(uuid(), t.account_id, key, clean(req.body?.category, 60), status === 'ignored' ? 'ignore' : 'no_document', req.user?.name || null);
  }
  logAudit(req.user, 'update', 'bank_transaction', t.id, { resolved: status, note }, t, null, t.description || t.id);
  res.json({ ok: true });
});

/* ── Reconciling ──────────────────────────────────────────────────────────── */

// The live picture. `difference` is the number Jake is chasing.
router.get('/accounts/:id/reconciliation', (req, res) => {
  const db = getDb();
  const account = db.prepare('SELECT * FROM bank_accounts WHERE id = ?').get(req.params.id);
  if (!account) return res.status(404).json({ error: 'Account not found' });
  const periodEnd = isoDay(req.query.period_end) || new Date().toISOString().slice(0, 10);

  // Opening = the account's own opening plus every period already closed.
  const closed = db.prepare(`SELECT COALESCE(SUM(cleared_total), 0) AS total
    FROM bank_reconciliations WHERE account_id = ? AND status = 'closed' AND period_end <= ?`)
    .get(account.id, periodEnd);
  const opening = round2(Number(account.opening_balance || 0) + Number(closed.total || 0));

  const rows = db.prepare(`SELECT * FROM bank_transactions
    WHERE account_id = ? AND reconciliation_id IS NULL AND posted_date <= ?`).all(account.id, periodEnd);
  const statementBalance = num(req.query.statement_balance) ?? account.current_balance ?? 0;

  res.json({
    account,
    ...reconcile({ openingBalance: opening, statementBalance, transactions: rows, periodEnd }),
    can_reconcile: canReconcile(req.user),
  });
});

router.post('/accounts/:id/reconciliation', (req, res) => {
  if (!canReconcile(req.user)) return res.status(403).json({ error: 'Only the office or an admin can close a reconciliation.' });
  const db = getDb();
  const account = db.prepare('SELECT * FROM bank_accounts WHERE id = ?').get(req.params.id);
  if (!account) return res.status(404).json({ error: 'Account not found' });
  const periodEnd = isoDay(req.body?.period_end);
  if (!periodEnd) return res.status(400).json({ error: 'Which period is being closed?' });
  const statementBalance = num(req.body?.statement_balance);
  if (statementBalance === null) return res.status(400).json({ error: 'What does the statement say the closing balance is?' });

  const closedBefore = db.prepare(`SELECT COALESCE(SUM(cleared_total), 0) AS total
    FROM bank_reconciliations WHERE account_id = ? AND status = 'closed' AND period_end <= ?`)
    .get(account.id, periodEnd);
  const opening = round2(Number(account.opening_balance || 0) + Number(closedBefore.total || 0));
  const rows = db.prepare(`SELECT * FROM bank_transactions
    WHERE account_id = ? AND reconciliation_id IS NULL AND posted_date <= ?`).all(account.id, periodEnd);
  const r = reconcile({ openingBalance: opening, statementBalance, transactions: rows, periodEnd });

  // The two refusals that make this worth doing at all.
  if (!r.balanced) {
    return res.status(400).json({
      error: `The account is out by ${r.difference.toFixed(2)}. A period only closes when it balances.`,
      ...r,
    });
  }
  if (r.unresolved > 0) {
    return res.status(400).json({
      error: `${r.unresolved} line${r.unresolved === 1 ? ' is' : 's are'} still unaccounted for. Match them, or say what they were.`,
      ...r,
    });
  }

  const id = uuid();
  const cleared = rows.filter(t => !t.pending && t.posted_date <= periodEnd);
  db.transaction(() => {
    db.prepare(`INSERT INTO bank_reconciliations
      (id, account_id, period_end, statement_balance, opening_balance, cleared_total, difference,
       transaction_count, closed_by, notes)
      VALUES (?,?,?,?,?,?,?,?,?,?)`)
      .run(id, account.id, periodEnd, r.statement_balance, r.opening_balance, r.cleared_total,
        r.difference, cleared.length, req.user?.name || null, clean(req.body?.notes, 2000));
    const stamp = db.prepare('UPDATE bank_transactions SET reconciliation_id = ? WHERE id = ?');
    for (const t of cleared) stamp.run(id, t.id);
    db.prepare('UPDATE bank_accounts SET current_balance = ?, balance_as_of = ? WHERE id = ?')
      .run(r.statement_balance, periodEnd, account.id);
  })();

  logAudit(req.user, 'create', 'bank_reconciliation', id, {
    account: account.name, period_end: periodEnd, statement_balance: r.statement_balance,
    transactions: cleared.length,
  }, null, null, `${account.name} — ${periodEnd}`);
  res.status(201).json(db.prepare('SELECT * FROM bank_reconciliations WHERE id = ?').get(id));
});

router.get('/accounts/:id/reconciliations', (req, res) => {
  res.json(getDb().prepare(`SELECT * FROM bank_reconciliations WHERE account_id = ?
    ORDER BY period_end DESC LIMIT 120`).all(req.params.id));
});

// Reopening is allowed and recorded. A closed period that turns out to be
// wrong has to be correctable, but never quietly — the reason travels with it.
router.post('/reconciliations/:id/reopen', (req, res) => {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Only an admin can reopen a closed reconciliation.' });
  const db = getDb();
  const r = db.prepare('SELECT * FROM bank_reconciliations WHERE id = ?').get(req.params.id);
  if (!r) return res.status(404).json({ error: 'Not found' });
  if (r.status === 'reopened') return res.status(400).json({ error: 'Already reopened.' });
  const reason = clean(req.body?.reason, 1000);
  if (!reason || reason.length < 3) return res.status(400).json({ error: 'Say why it is being reopened.' });
  // A later period is built on this one's closing figure, so it has to go first.
  const later = db.prepare(`SELECT COUNT(*) n FROM bank_reconciliations
    WHERE account_id = ? AND status = 'closed' AND period_end > ?`).get(r.account_id, r.period_end).n;
  if (later > 0) return res.status(400).json({ error: `${later} later period${later === 1 ? ' is' : 's are'} built on this one. Reopen the most recent first.` });

  db.transaction(() => {
    db.prepare(`UPDATE bank_reconciliations SET status = 'reopened', reopened_at = datetime('now'),
      reopened_by = ?, reopened_reason = ? WHERE id = ?`).run(req.user?.name || null, reason, r.id);
    db.prepare('UPDATE bank_transactions SET reconciliation_id = NULL WHERE reconciliation_id = ?').run(r.id);
  })();
  logAudit(req.user, 'update', 'bank_reconciliation', r.id, { reopened: reason }, r, null, r.period_end);
  res.json({ ok: true });
});

/* ── The live feed ────────────────────────────────────────────────────────── */

router.get('/feed/status', (req, res) => res.json(bankFeedStatus()));

router.post('/feed/link-token', async (req, res) => {
  if (!canReconcile(req.user)) return res.status(403).json({ error: 'Not allowed.' });
  if (!bankFeedEnabled()) return res.status(503).json({ error: 'No bank feed is configured on this server.' });
  try { res.json({ link_token: await createLinkToken(req.user.id) }); }
  catch (e) { res.status(502).json({ error: e.message }); }
});

// Plaid Link hands back a public token; this turns it into connected accounts.
router.post('/feed/connect', async (req, res) => {
  if (!canReconcile(req.user)) return res.status(403).json({ error: 'Not allowed.' });
  if (!bankFeedEnabled()) return res.status(503).json({ error: 'No bank feed is configured on this server.' });
  const publicToken = clean(req.body?.public_token, 200);
  if (!publicToken) return res.status(400).json({ error: 'No token from the bank connection.' });
  try {
    const r = await exchangePublicToken(publicToken);
    saveItemToken(r.item_id, r.access_token);
    const db = getDb();
    const created = [];
    for (const a of r.accounts) {
      const exists = db.prepare('SELECT id FROM bank_accounts WHERE provider_account_id = ?').get(a.provider_account_id);
      if (exists) continue;
      const id = uuid();
      db.prepare(`INSERT INTO bank_accounts (id, name, institution, account_type, mask, currency,
        current_balance, provider, provider_item_id, provider_account_id, created_by)
        VALUES (?,?,?,?,?,?,?, 'plaid', ?,?,?)`)
        .run(id, a.name, r.institution, a.account_type, a.mask, a.currency,
          a.current_balance, r.item_id, a.provider_account_id, req.user?.name || null);
      created.push(id);
    }
    logAudit(req.user, 'create', 'bank_account', null, { connected: created.length, item: r.item_id }, null, null, 'Bank connection');
    res.status(201).json({ connected: created.length });
  } catch (e) { res.status(502).json({ error: e.message }); }
});

router.post('/accounts/:id/sync', async (req, res) => {
  if (!canReconcile(req.user)) return res.status(403).json({ error: 'Not allowed.' });
  const db = getDb();
  const account = db.prepare('SELECT * FROM bank_accounts WHERE id = ?').get(req.params.id);
  if (!account) return res.status(404).json({ error: 'Account not found' });
  if (account.provider !== 'plaid' || !account.provider_item_id) {
    return res.status(400).json({ error: 'This account isn\'t connected to a bank feed. Import a statement instead.' });
  }
  const tok = readItemToken(account.provider_item_id);
  if (!tok?.access_token) return res.status(400).json({ error: 'The connection to this bank has been removed. Reconnect it.' });

  try {
    const r = await syncItem(tok.access_token, tok.cursor);
    // The feed covers every account at the institution; keep only this one's.
    const mine = (list) => list.filter(t => t.provider_account_id === account.provider_account_id);
    let counts, processed;
    db.transaction(() => {
      counts = ingest(db, account.id, [...mine(r.added), ...mine(r.modified)], 'plaid');
      // A retracted pending charge has to disappear here too, or the account
      // will never reconcile. Never touches a closed period.
      for (const id of r.removed) {
        db.prepare('DELETE FROM bank_transactions WHERE account_id = ? AND external_id = ? AND reconciliation_id IS NULL')
          .run(account.id, id);
      }
      processed = autoProcess(db, account.id);
      saveCursor(account.provider_item_id, r.cursor);
      db.prepare("UPDATE bank_accounts SET last_synced_at = datetime('now'), last_sync_error = NULL WHERE id = ?").run(account.id);
    })();
    try {
      const bal = (await fetchBalances(tok.access_token)).find(b => b.provider_account_id === account.provider_account_id);
      if (bal?.current_balance != null) {
        db.prepare("UPDATE bank_accounts SET current_balance = ?, balance_as_of = date('now') WHERE id = ?")
          .run(bal.current_balance, account.id);
      }
    } catch { /* balances are a nicety; the transactions are the point */ }

    logAudit(req.user, 'update', 'bank_account', account.id, { sync: { ...counts, ...processed } }, null, null, account.name);
    res.json({ ...counts, ...processed, removed: r.removed.length });
  } catch (e) {
    db.prepare('UPDATE bank_accounts SET last_sync_error = ? WHERE id = ?').run(String(e.message).slice(0, 500), account.id);
    res.status(502).json({ error: e.message });
  }
});

router.delete('/accounts/:id/connection', async (req, res) => {
  if (!canReconcile(req.user)) return res.status(403).json({ error: 'Not allowed.' });
  const db = getDb();
  const account = db.prepare('SELECT * FROM bank_accounts WHERE id = ?').get(req.params.id);
  if (!account) return res.status(404).json({ error: 'Account not found' });
  if (account.provider_item_id) {
    const others = db.prepare('SELECT COUNT(*) n FROM bank_accounts WHERE provider_item_id = ? AND id != ?')
      .get(account.provider_item_id, account.id).n;
    if (others === 0) await removeItem(account.provider_item_id);
  }
  // The transactions stay. They are what the account was reconciled against;
  // dropping the connection is not a reason to lose the history.
  db.prepare("UPDATE bank_accounts SET provider = 'manual', provider_item_id = NULL, provider_account_id = NULL WHERE id = ?")
    .run(account.id);
  logAudit(req.user, 'update', 'bank_account', account.id, { disconnected: true }, account, null, account.name);
  res.json({ ok: true });
});

/* ── Rules ────────────────────────────────────────────────────────────────── */

router.get('/rules', (req, res) => {
  res.json(getDb().prepare('SELECT * FROM bank_rules ORDER BY hits DESC, created_at DESC LIMIT 200').all());
});

router.delete('/rules/:id', (req, res) => {
  if (!canReconcile(req.user)) return res.status(403).json({ error: 'Not allowed.' });
  getDb().prepare('DELETE FROM bank_rules WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

export { candidatesFor, AUTO_THRESHOLD };
export default router;
