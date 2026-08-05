import { Router } from 'express';
import multer from 'multer';
import { v4 as uuid } from 'uuid';
import { getDb, logAudit } from '../db.js';
import { storageEnabled, putObject, presignGet, deleteObject, getObjectBuffer } from '../storage.js';
import { extractInvoiceText } from '../invoice-text.js';
import {
  quickbooksEnabled, quickbooksStatus, syncFromQuickBooks,
  discoverQuickBooks, lastInventory, testQuickBooks,
} from '../quickbooks.js';

// Accounts Payable / Accounts Receivable for the office (Jake).
//
// Deliberately one flat row per invoice with a short status vocabulary, so the
// KPI cards are plain sums and nothing needs explaining. Files upload to R2
// like every other attachment and their text is indexed, so search covers
// what's inside the PDF — the same behaviour Supply Orders already has.
//
// Access: 'accounts-payable' and 'accounts-receivable' are separate modules, so
// someone can be given one ledger without the other.

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024, files: 30 } });

const AP_STATUSES = ['draft', 'awaiting_approval', 'approved', 'scheduled', 'paid', 'void'];
const AR_STATUSES = ['unbilled', 'sent', 'partial', 'paid', 'void'];

const LEDGERS = {
  ap: {
    table: 'ap_invoices', party: 'vendor', paidField: 'amount_paid',
    statuses: AP_STATUSES, moduleId: 'accounts-payable', entity: 'ap_invoice',
    fields: ['vendor', 'invoice_number', 'po_number', 'invoice_date', 'due_date', 'terms', 'category',
      'amount', 'amount_paid', 'status', 'paid_date', 'payment_method', 'payment_ref', 'notes', 'file_id',
      'priority', 'invoice_link', 'ach_link', 'pay_link', 'pay_confirmation'],
  },
  ar: {
    table: 'ar_invoices', party: 'customer', paidField: 'amount_received',
    statuses: AR_STATUSES, moduleId: 'accounts-receivable', entity: 'ar_invoice',
    fields: ['customer', 'invoice_number', 'po_number', 'invoice_date', 'due_date', 'terms',
      'amount', 'amount_received', 'status', 'sent_date', 'paid_date', 'notes', 'file_id',
      'co_number', 'person', 'order_type', 'invoice_link', 'pay_confirmation'],
  },
};

function ledgerOf(req, res) {
  const cfg = LEDGERS[req.params.ledger];
  if (!cfg) { res.status(404).json({ error: 'Unknown ledger' }); return null; }
  return cfg;
}

// Admins always; anyone else needs the module granted in Settings.
function may(user, cfg, level = 'view') {
  if (user?.role === 'admin') return true;
  const ma = user?.module_access;
  if (!ma) return false;
  if (Array.isArray(ma)) return level === 'view' && ma.includes(cfg.moduleId);
  const lvl = ma[cfg.moduleId];
  return level === 'edit' ? lvl === 'edit' : lvl === 'edit' || lvl === 'view';
}
function requireAccess(req, res, cfg, level) {
  if (!may(req.user, cfg, level)) { res.status(403).json({ error: 'You do not have access to this ledger.' }); return false; }
  return true;
}

const num = (v) => (v === '' || v === null || v === undefined ? 0 : Number(v) || 0);

// ── List + summary ───────────────────────────────────────────────────────────

router.get('/:ledger', (req, res) => {
  const cfg = ledgerOf(req, res); if (!cfg) return;
  if (!requireAccess(req, res, cfg, 'view')) return;
  const db = getDb();
  const { status, party, from, to, q } = req.query;

  let sql = `SELECT * FROM ${cfg.table} WHERE 1=1`;
  const params = [];
  if (status) { sql += ' AND status = ?'; params.push(status); }
  if (party) { sql += ` AND ${cfg.party} = ?`; params.push(party); }
  if (from) { sql += ' AND invoice_date >= ?'; params.push(from); }
  if (to) { sql += ' AND invoice_date <= ?'; params.push(to); }
  if (q) {
    // Matches the invoice itself or the text pulled out of its attached file.
    sql += ` AND (LOWER(${cfg.party}) LIKE LOWER(?) OR LOWER(COALESCE(invoice_number,'')) LIKE LOWER(?)
      OR LOWER(COALESCE(po_number,'')) LIKE LOWER(?) OR LOWER(COALESCE(notes,'')) LIKE LOWER(?)
      OR id IN (SELECT invoice_id FROM finance_files WHERE LOWER(COALESCE(extracted_text,'')) LIKE LOWER(?)))`;
    const like = `%${q}%`;
    params.push(like, like, like, like, like);
  }
  sql += " ORDER BY COALESCE(due_date, invoice_date, created_at) DESC LIMIT 2000";
  res.json(db.prepare(sql).all(...params));
});

// The header cards. Outstanding = billed but not settled; past due uses the
// due date against today. Everything is a plain sum so the numbers can be
// checked by hand against the list below them.
router.get('/:ledger/summary', (req, res) => {
  const cfg = ledgerOf(req, res); if (!cfg) return;
  if (!requireAccess(req, res, cfg, 'view')) return;
  const db = getDb();
  const open = cfg.statuses.filter(s => s !== 'paid' && s !== 'void' && s !== 'draft');
  const marks = open.map(() => '?').join(',');

  const row = db.prepare(`
    SELECT
      COALESCE(SUM(amount - ${cfg.paidField}), 0) AS outstanding,
      COALESCE(SUM(CASE WHEN due_date IS NOT NULL AND due_date < date('now') THEN amount - ${cfg.paidField} ELSE 0 END), 0) AS past_due,
      COUNT(*) AS open_count
    FROM ${cfg.table} WHERE status IN (${marks})
  `).get(...open);

  const pending = req.params.ledger === 'ap'
    ? db.prepare("SELECT COUNT(*) c, COALESCE(SUM(amount - amount_paid), 0) v FROM ap_invoices WHERE status = 'awaiting_approval'").get()
    : db.prepare("SELECT COUNT(*) c, COALESCE(SUM(amount - amount_received), 0) v FROM ar_invoices WHERE status = 'unbilled'").get();

  res.json({
    outstanding: row.outstanding,
    past_due: row.past_due,
    open_count: row.open_count,
    pending_count: pending.c,
    pending_value: pending.v,
    // AP: invoices awaiting approval. AR: unbilled / pending invoices.
    pending_label: req.params.ledger === 'ap' ? 'Invoices awaiting approval' : 'Unbilled / pending invoices',
    quickbooks: quickbooksStatus(),
  });
});

// ── Create / update / delete ─────────────────────────────────────────────────

router.post('/:ledger', (req, res) => {
  const cfg = ledgerOf(req, res); if (!cfg) return;
  if (!requireAccess(req, res, cfg, 'edit')) return;
  const db = getDb();
  const body = req.body || {};
  if (!body[cfg.party]) return res.status(400).json({ error: `${cfg.party} is required` });

  const id = uuid();
  const values = cfg.fields.map(f => {
    if (f === 'amount' || f === cfg.paidField) return num(body[f]);
    if (f === 'status') return cfg.statuses.includes(body.status) ? body.status : cfg.statuses[0];
    return body[f] ?? null;
  });
  db.prepare(`INSERT INTO ${cfg.table} (id, ${cfg.fields.join(', ')}, created_by)
    VALUES (?, ${cfg.fields.map(() => '?').join(', ')}, ?)`).run(id, ...values, req.user.name);

  const created = db.prepare(`SELECT * FROM ${cfg.table} WHERE id = ?`).get(id);
  if (body.file_id) db.prepare('UPDATE finance_files SET invoice_id = ? WHERE id = ?').run(id, body.file_id);
  logAudit(req.user, 'create', cfg.entity, id, { amount: created.amount, status: created.status }, null, created, created[cfg.party]);
  res.status(201).json(created);
});

router.put('/:ledger/:id', (req, res) => {
  const cfg = ledgerOf(req, res); if (!cfg) return;
  if (!requireAccess(req, res, cfg, 'edit')) return;
  const db = getDb();
  const existing = db.prepare(`SELECT * FROM ${cfg.table} WHERE id = ?`).get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Invoice not found' });

  const body = req.body || {};
  const next = {};
  for (const f of cfg.fields) {
    if (body[f] === undefined) { next[f] = existing[f]; continue; }
    if (f === 'amount' || f === cfg.paidField) next[f] = num(body[f]);
    else if (f === 'status') next[f] = cfg.statuses.includes(body.status) ? body.status : existing.status;
    else next[f] = body[f] ?? null;
  }
  // Approving an AP invoice stamps who and when — that's the audit question
  // an accountant actually gets asked.
  let approvedBy = existing.approved_by, approvedAt = existing.approved_at;
  if (cfg.entity === 'ap_invoice' && next.status === 'approved' && existing.status !== 'approved') {
    approvedBy = req.user.name;
    approvedAt = new Date().toISOString();
  }

  db.prepare(`UPDATE ${cfg.table} SET ${cfg.fields.map(f => `${f} = ?`).join(', ')},
    ${cfg.entity === 'ap_invoice' ? 'approved_by = ?, approved_at = ?,' : ''} updated_at = datetime('now') WHERE id = ?`)
    .run(...cfg.fields.map(f => next[f]), ...(cfg.entity === 'ap_invoice' ? [approvedBy, approvedAt] : []), req.params.id);

  const updated = db.prepare(`SELECT * FROM ${cfg.table} WHERE id = ?`).get(req.params.id);
  if (next.file_id && next.file_id !== existing.file_id) {
    db.prepare('UPDATE finance_files SET invoice_id = ? WHERE id = ?').run(req.params.id, next.file_id);
  }
  logAudit(req.user, 'update', cfg.entity, req.params.id,
    updated.status !== existing.status ? { status: { from: existing.status, to: updated.status } } : null,
    existing, updated, updated[cfg.party]);
  res.json(updated);
});

router.delete('/:ledger/:id', (req, res) => {
  const cfg = ledgerOf(req, res); if (!cfg) return;
  if (!requireAccess(req, res, cfg, 'edit')) return;
  const db = getDb();
  const existing = db.prepare(`SELECT * FROM ${cfg.table} WHERE id = ?`).get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Invoice not found' });
  db.prepare(`DELETE FROM ${cfg.table} WHERE id = ?`).run(req.params.id);
  db.prepare('UPDATE finance_files SET invoice_id = NULL WHERE invoice_id = ?').run(req.params.id);
  logAudit(req.user, 'delete', cfg.entity, req.params.id, null, existing, null, existing[cfg.party]);
  res.json({ deleted: req.params.id });
});

// ── Files: bulk upload, searchable contents ──────────────────────────────────

router.post('/:ledger/files', upload.array('files', 30), async (req, res) => {
  const cfg = ledgerOf(req, res); if (!cfg) return;
  if (!requireAccess(req, res, cfg, 'edit')) return;
  if (!storageEnabled()) return res.status(503).json({ error: 'File storage is not configured on this server.' });
  const files = req.files || [];
  if (!files.length) return res.status(400).json({ error: 'No files uploaded' });

  const db = getDb();
  const ins = db.prepare(`INSERT INTO finance_files (id, ledger, invoice_id, filename, storage_key, size, content_type, uploaded_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
  const created = [];
  for (const f of files) {
    const id = uuid();
    const key = `finance/${req.params.ledger}/${id}-${f.originalname.replace(/[^\w.-]+/g, '_')}`;
    await putObject(key, f.buffer, f.mimetype);
    ins.run(id, req.params.ledger, req.body?.invoice_id || null, f.originalname, key, f.size, f.mimetype, req.user.name);
    created.push({ id, filename: f.originalname, size: f.size, content_type: f.mimetype });
    // Index the contents in the background; a slow OCR shouldn't hold the
    // upload open, and search picks it up as soon as it lands.
    extractInvoiceText(f.buffer, f.mimetype, f.originalname)
      .then(text => { try { getDb().prepare('UPDATE finance_files SET extracted_text = ? WHERE id = ?').run(text ?? '', id); } catch { /* ignore */ } })
      .catch(() => {});
  }
  logAudit(req.user, 'create', 'finance_file', null, { ledger: req.params.ledger, count: created.length }, null, null);
  res.status(201).json({ files: created });
});

router.get('/:ledger/files', (req, res) => {
  const cfg = ledgerOf(req, res); if (!cfg) return;
  if (!requireAccess(req, res, cfg, 'view')) return;
  const db = getDb();
  const { q, invoice_id, unlinked } = req.query;
  let sql = 'SELECT id, ledger, invoice_id, filename, size, content_type, uploaded_by, created_at FROM finance_files WHERE ledger = ?';
  const params = [req.params.ledger];
  if (invoice_id) { sql += ' AND invoice_id = ?'; params.push(invoice_id); }
  if (unlinked === 'true') sql += ' AND invoice_id IS NULL';
  if (q) {
    sql += " AND (LOWER(filename) LIKE LOWER(?) OR LOWER(COALESCE(extracted_text,'')) LIKE LOWER(?))";
    params.push(`%${q}%`, `%${q}%`);
  }
  sql += ' ORDER BY created_at DESC LIMIT 500';
  res.json(db.prepare(sql).all(...params));
});

router.get('/:ledger/files/:id/url', async (req, res) => {
  const cfg = ledgerOf(req, res); if (!cfg) return;
  if (!requireAccess(req, res, cfg, 'view')) return;
  const row = getDb().prepare('SELECT * FROM finance_files WHERE id = ? AND ledger = ?').get(req.params.id, req.params.ledger);
  if (!row) return res.status(404).json({ error: 'File not found' });
  res.json({ url: await presignGet(row.storage_key), filename: row.filename, content_type: row.content_type });
});

router.delete('/:ledger/files/:id', async (req, res) => {
  const cfg = ledgerOf(req, res); if (!cfg) return;
  if (!requireAccess(req, res, cfg, 'edit')) return;
  const db = getDb();
  const row = db.prepare('SELECT * FROM finance_files WHERE id = ? AND ledger = ?').get(req.params.id, req.params.ledger);
  if (!row) return res.status(404).json({ error: 'File not found' });
  await deleteObject(row.storage_key).catch(() => {});
  db.prepare('DELETE FROM finance_files WHERE id = ?').run(req.params.id);
  logAudit(req.user, 'delete', 'finance_file', req.params.id, null, row, null, row.filename);
  res.json({ deleted: req.params.id });
});

// ── QuickBooks ───────────────────────────────────────────────────────────────

router.get('/quickbooks/status', (req, res) => {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Admin only.' });
  res.json(quickbooksStatus());
});

// Intuit's app profile asks for the IP address their API will see our calls
// coming from. Hosting can move us between addresses, so rather than write a
// number down once and hope, this reports what it is right now.
const IP_LOOKUPS = [
  'https://checkip.amazonaws.com',
  'https://api.ipify.org',
  'https://icanhazip.com',
];
const IPV4 = /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/;

router.get('/quickbooks/egress-ip', async (req, res) => {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Admin only.' });
  // Try a few echo services in turn — one being down or blocked shouldn't
  // leave an admin staring at a blank field mid-way through Intuit's form.
  const errors = [];
  for (const url of IP_LOOKUPS) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(6000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const ip = (await r.text()).match(IPV4)?.[0];
      if (!ip) throw new Error('no address in response');
      return res.json({ ip, source: new URL(url).host, checked_at: new Date().toISOString() });
    } catch (e) {
      errors.push(`${new URL(url).host}: ${e.message}`);
    }
  }
  res.status(502).json({ error: `Could not determine the outbound IP (${errors.join('; ')})` });
});

// `full: true` is the one-time migration — everything ever, plus the chart of
// accounts, vendors and customers. Without it this is the day-to-day sync of
// what changed since last time.
router.post('/quickbooks/sync', async (req, res) => {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Admin only.' });
  if (!quickbooksEnabled()) return res.status(503).json({ error: 'QuickBooks is not configured on this server.' });
  const full = req.body?.full === true;
  try {
    const result = await syncFromQuickBooks(getDb(), { full });
    logAudit(req.user, 'update', 'quickbooks_sync', null, result, null, null,
      full ? 'Full pull from QuickBooks' : 'QuickBooks sync');
    res.json(result);
  } catch (e) {
    res.status(502).json({ error: e.message || 'QuickBooks sync failed' });
  }
});

// Prove the connection and name the company it reached. Deliberately allowed
// even when not configured — reporting which values are missing is most of its
// value before anything works.
router.post('/quickbooks/test', async (req, res) => {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Admin only.' });
  res.json(await testQuickBooks());
});

// "What do we actually use?" — counted from their books rather than recalled.
// Reads only; it downloads no rows it does not need, so it is safe to re-run.
router.post('/quickbooks/discover', async (req, res) => {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Admin only.' });
  if (!quickbooksEnabled()) return res.status(503).json({ error: 'QuickBooks is not configured on this server.' });
  try {
    const report = await discoverQuickBooks(getDb());
    logAudit(req.user, 'update', 'quickbooks_discovery', null,
      { in_use: report.in_use.length, unused: report.unused.length }, null, null);
    res.json(report);
  } catch (e) {
    res.status(502).json({ error: e.message || 'QuickBooks discovery failed' });
  }
});

// The last report, so the answer survives a page reload without re-hitting the
// API — and is readable at all when QuickBooks is unreachable.
router.get('/quickbooks/inventory', (req, res) => {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Admin only.' });
  res.json(lastInventory() || { entities: [], checked_at: null });
});

// What the pull has actually landed here so far.
router.get('/quickbooks/pulled', (req, res) => {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Admin only.' });
  const db = getDb();
  const one = (sql, fallback = 0) => { try { return db.prepare(sql).get()?.n ?? fallback; } catch { return fallback; } };
  res.json({
    accounts: one('SELECT COUNT(*) n FROM qbo_accounts'),
    vendors: one("SELECT COUNT(*) n FROM qbo_contacts WHERE kind = 'vendor'"),
    customers: one("SELECT COUNT(*) n FROM qbo_contacts WHERE kind = 'customer'"),
    ap: one('SELECT COUNT(*) n FROM ap_invoices WHERE qb_id IS NOT NULL'),
    ar: one('SELECT COUNT(*) n FROM ar_invoices WHERE qb_id IS NOT NULL'),
  });
});

// The chart of accounts as pulled, grouped the way an accountant reads it.
router.get('/quickbooks/accounts', (req, res) => {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Admin only.' });
  const db = getDb();
  let rows = [];
  try {
    rows = db.prepare(`SELECT * FROM qbo_accounts ORDER BY classification, account_type,
      CASE WHEN acct_number IS NULL OR acct_number = '' THEN 1 ELSE 0 END, acct_number, name`).all();
  } catch { /* table may not exist on an old DB */ }
  res.json(rows);
});

// Index files uploaded before content indexing, or whose extraction failed.
// Runs once per boot, capped so a backlog spreads over restarts.
export async function backfillFinanceFileText() {
  if (!storageEnabled()) return;
  const db = getDb();
  let rows;
  try {
    rows = db.prepare('SELECT id, storage_key, content_type, filename FROM finance_files WHERE extracted_text IS NULL ORDER BY created_at DESC LIMIT 100').all();
  } catch { return; }
  if (!rows?.length) return;
  let done = 0;
  for (const r of rows) {
    const buf = await getObjectBuffer(r.storage_key);
    const text = buf ? await extractInvoiceText(buf, r.content_type, r.filename) : '';
    try { db.prepare('UPDATE finance_files SET extracted_text = ? WHERE id = ?').run(text ?? '', r.id); } catch { /* ignore */ }
    if (text) done++;
  }
  console.log(`[finance] Indexed contents of ${rows.length} invoice file(s) (${done} with text)`);
}

export default router;
