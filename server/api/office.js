import { Router } from 'express';
import multer from 'multer';
import { v4 as uuid } from 'uuid';
import { getDb, logAudit } from '../db.js';
import { storageEnabled, putObject, presignGet, deleteObject, getObjectBuffer } from '../storage.js';
import { aiEnabled, translateText } from '../ai.js';
import { extractInvoiceText } from '../invoice-text.js';

// Office Ops: supply ordering + time tracking (replaces two Monday boards).
// Submitting is open to supervisors + admins (or anyone explicitly granted the
// Requests module); managing the logs is admin-only (Marnee). Invoices upload
// to R2 when storage is configured and their contents are indexed for search.

const router = Router();
const invoiceUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024, files: 20 } });

// Supply-order and time-tracking requests are granted separately, so office
// staff can be given one without the other. The original combined
// 'office-requests' grant still means both, so existing users keep what they
// had.
const GRANT_FOR = { supply: ['supply-requests', 'office-requests'], time: ['time-requests', 'office-requests'] };

function canSubmit(req, kind) {
  const u = req.user;
  if (u?.role === 'admin' || u?.role === 'supervisor') return true;
  const ma = u?.module_access;
  if (!ma) return false;
  const ids = GRANT_FOR[kind] || [...GRANT_FOR.supply, ...GRANT_FOR.time];
  const has = (id) => (Array.isArray(ma) ? ma.includes(id) : !!ma[id]);
  return ids.some(has);
}
function requireSubmit(req, res, kind) {
  if (!canSubmit(req, kind)) {
    res.status(403).json({ error: 'You do not have access to this request form. Ask an admin to grant it in Settings.' });
    return false;
  }
  return true;
}
function requireAdmin(req, res) {
  if (req.user?.role !== 'admin') { res.status(403).json({ error: 'Admin only.' }); return false; }
  return true;
}

function saveInvoiceText(db, id, text) {
  try { db.prepare('UPDATE supply_invoices SET extracted_text = ? WHERE id = ?').run(text ?? '', id); } catch { /* column optional */ }
}

// Index any invoices uploaded before content indexing existed (or whose
// extraction previously failed at upload time). Runs once per boot, off the
// startup path; capped so a huge backlog spreads across restarts.
export async function backfillInvoiceText() {
  if (!storageEnabled()) return;
  const db = getDb();
  let rows;
  try { rows = db.prepare('SELECT id, storage_key, content_type, filename FROM supply_invoices WHERE extracted_text IS NULL ORDER BY created_at DESC LIMIT 100').all(); } catch { return; }
  if (!rows?.length) return;
  let done = 0;
  for (const r of rows) {
    const buf = await getObjectBuffer(r.storage_key);
    const text = buf ? await extractInvoiceText(buf, r.content_type, r.filename) : '';
    saveInvoiceText(db, r.id, text);
    if (text) done++;
  }
  console.log(`[invoices] Indexed contents of ${rows.length} invoice file(s) (${done} with text)`);
}

// ── Supply orders ────────────────────────────────────────────────────────────

// Item history for the form: distinct items with their most recent details, so
// reorders are one click and typing autocompletes from what's been bought before.
router.get('/supply/items', (req, res) => {
  if (!requireSubmit(req, res, 'supply')) return;
  const db = getDb();
  const rows = db.prepare(`
    SELECT item_name, supplier, link, uom, label, qty, COUNT(*) AS times_ordered, MAX(submitted_at) AS last_ordered
    FROM supply_orders GROUP BY LOWER(item_name), LOWER(COALESCE(supplier,'')) ORDER BY times_ordered DESC, last_ordered DESC LIMIT 400
  `).all();
  res.json(rows);
});

router.post('/supply/orders', (req, res) => {
  if (!requireSubmit(req, res, 'supply')) return;
  const db = getDb();
  const { item_name, qty, uom, link, supplier, urgent, label, notes } = req.body || {};
  if (!item_name || !String(item_name).trim()) return res.status(400).json({ error: 'Item name is required' });
  const id = uuid();
  db.prepare(`INSERT INTO supply_orders (id, item_name, qty, uom, link, supplier, urgent, label, notes, requested_by, requested_by_id)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, String(item_name).trim(), qty ?? null, uom || null, link || null, supplier || null, urgent ? 1 : 0, label || null,
      notes || null, req.user.name, req.user.id);
  const created = db.prepare('SELECT * FROM supply_orders WHERE id = ?').get(id);
  logAudit(req.user, 'create', 'supply_order', id, { item_name, qty, supplier, urgent: !!urgent }, null, created, item_name);
  res.status(201).json(created);
});

// Admin log, filterable by status/search.
router.get('/supply/orders', (req, res) => {
  if (!requireAdmin(req, res)) return;
  const db = getDb();
  const { status, q } = req.query;
  let sql = 'SELECT * FROM supply_orders WHERE 1=1';
  const params = [];
  if (status) { sql += ' AND status = ?'; params.push(status); }
  if (q) { sql += ' AND (item_name LIKE ? OR supplier LIKE ? OR label LIKE ?)'; params.push(`%${q}%`, `%${q}%`, `%${q}%`); }
  sql += " ORDER BY CASE status WHEN 'new' THEN 0 WHEN 'ordered' THEN 1 WHEN 'received' THEN 2 ELSE 3 END, urgent DESC, submitted_at DESC LIMIT 1000";
  res.json(db.prepare(sql).all(...params));
});

router.put('/supply/orders/:id', (req, res) => {
  if (!requireAdmin(req, res)) return;
  const db = getDb();
  const existing = db.prepare('SELECT * FROM supply_orders WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Order not found' });
  const fields = ['item_name', 'qty', 'uom', 'link', 'supplier', 'urgent', 'label', 'status', 'total', 'eta', 'invoice_link', 'invoice_id', 'notes'];
  const patch = {};
  for (const f of fields) if (req.body[f] !== undefined) patch[f] = f === 'urgent' ? (req.body[f] ? 1 : 0) : req.body[f];
  if (!Object.keys(patch).length) return res.json(existing);
  const sets = Object.keys(patch).map(k => `${k} = ?`).join(', ');
  db.prepare(`UPDATE supply_orders SET ${sets}, updated_at = datetime('now') WHERE id = ?`).run(...Object.values(patch), req.params.id);
  const updated = db.prepare('SELECT * FROM supply_orders WHERE id = ?').get(req.params.id);
  logAudit(req.user, 'update', 'supply_order', req.params.id, patch, existing, updated, existing.item_name);
  res.json(updated);
});

// One-click reorder: clone a past order as a fresh "new" request.
router.post('/supply/orders/:id/reorder', (req, res) => {
  if (!requireSubmit(req, res, 'supply')) return;
  const db = getDb();
  const src = db.prepare('SELECT * FROM supply_orders WHERE id = ?').get(req.params.id);
  if (!src) return res.status(404).json({ error: 'Order not found' });
  const id = uuid();
  const qty = req.body?.qty ?? src.qty;
  db.prepare(`INSERT INTO supply_orders (id, item_name, qty, uom, link, supplier, urgent, label, notes, requested_by, requested_by_id)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, src.item_name, qty, src.uom, src.link, src.supplier, req.body?.urgent ? 1 : 0, src.label, req.body?.notes || null, req.user.name, req.user.id);
  const created = db.prepare('SELECT * FROM supply_orders WHERE id = ?').get(id);
  logAudit(req.user, 'create', 'supply_order', id, { reorder_of: src.id, item_name: src.item_name }, null, created, src.item_name);
  res.status(201).json(created);
});

router.delete('/supply/orders/:id', (req, res) => {
  if (!requireAdmin(req, res)) return;
  const db = getDb();
  const existing = db.prepare('SELECT * FROM supply_orders WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Order not found' });
  db.prepare('DELETE FROM supply_orders WHERE id = ?').run(req.params.id);
  logAudit(req.user, 'delete', 'supply_order', req.params.id, null, existing, null, existing.item_name);
  res.json({ deleted: req.params.id });
});

// ── Invoice repository ───────────────────────────────────────────────────────
router.get('/supply/invoices', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const db = getDb();
  const { q } = req.query;
  let sql = 'SELECT * FROM supply_invoices WHERE 1=1';
  const params = [];
  // Search covers the indexed file contents too (what's written INSIDE the invoice).
  if (q) { sql += ' AND (filename LIKE ? OR supplier LIKE ? OR notes LIKE ? OR extracted_text LIKE ?)'; params.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`); }
  sql += ' ORDER BY COALESCE(invoice_date, created_at) DESC LIMIT 500';
  const rows = db.prepare(sql).all(...params);
  const out = await Promise.all(rows.map(async r => ({ ...r, url: await presignGet(r.storage_key, r.filename).catch(() => null) })));
  res.json(out);
});

router.post('/supply/invoices', invoiceUpload.array('files', 20), async (req, res) => {
  if (!requireAdmin(req, res)) return;
  if (!storageEnabled()) return res.status(503).json({ error: 'File storage is not configured on this server.' });
  const db = getDb();
  const files = req.files || [];
  if (!files.length) return res.status(400).json({ error: 'No files uploaded' });
  const created = [];
  for (const f of files) {
    const id = uuid();
    const key = `invoices/${id}/${f.originalname}`;
    await putObject(key, f.buffer, f.mimetype);
    db.prepare(`INSERT INTO supply_invoices (id, filename, storage_key, size, content_type, supplier, invoice_date, total, notes, uploaded_by)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, f.originalname, key, f.size, f.mimetype, req.body.supplier || null, req.body.invoice_date || null,
        req.body.total ? Number(req.body.total) : null, req.body.notes || null, req.user.name);
    created.push(db.prepare('SELECT * FROM supply_invoices WHERE id = ?').get(id));
    // Index the file's contents in the background so upload stays snappy.
    extractInvoiceText(f.buffer, f.mimetype, f.originalname)
      .then(text => saveInvoiceText(getDb(), id, text))
      .catch(() => saveInvoiceText(getDb(), id, ''));
  }
  logAudit(req.user, 'create', 'supply_invoice', created[0].id, { count: created.length }, null, null);
  res.status(201).json(created);
});

router.put('/supply/invoices/:id', (req, res) => {
  if (!requireAdmin(req, res)) return;
  const db = getDb();
  const existing = db.prepare('SELECT * FROM supply_invoices WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Invoice not found' });
  const { supplier, invoice_date, total, notes } = req.body || {};
  db.prepare('UPDATE supply_invoices SET supplier = ?, invoice_date = ?, total = ?, notes = ? WHERE id = ?')
    .run(supplier ?? existing.supplier, invoice_date ?? existing.invoice_date, total ?? existing.total, notes ?? existing.notes, req.params.id);
  res.json(db.prepare('SELECT * FROM supply_invoices WHERE id = ?').get(req.params.id));
});

router.delete('/supply/invoices/:id', (req, res) => {
  if (!requireAdmin(req, res)) return;
  const db = getDb();
  const existing = db.prepare('SELECT * FROM supply_invoices WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Invoice not found' });
  deleteObject(existing.storage_key);
  db.prepare('DELETE FROM supply_invoices WHERE id = ?').run(req.params.id);
  logAudit(req.user, 'delete', 'supply_invoice', req.params.id, null, existing, null, existing.filename);
  res.json({ deleted: req.params.id });
});

// ── Time tracking (absences / tardies) ───────────────────────────────────────
router.post('/time/adjustments', (req, res) => {
  if (!requireSubmit(req, res, 'time')) return;
  const db = getDb();
  const { employee_name, employee_id, adjustment_type, adjustment_date, message, details } = req.body || {};
  if (!employee_name || !adjustment_date) return res.status(400).json({ error: 'employee_name and adjustment_date are required' });
  const type = ['absent', 'tardy_leave_early', 'other'].includes(adjustment_type) ? adjustment_type : 'other';
  const id = uuid();
  db.prepare(`INSERT INTO time_adjustments (id, employee_name, employee_id, adjustment_type, adjustment_date, message, details, submitted_by, submitted_by_id, pay_period)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, employee_name, employee_id || null, type, adjustment_date, message || null, details || null, req.user.name, req.user.id, payPeriodFor(adjustment_date));
  const created = db.prepare('SELECT * FROM time_adjustments WHERE id = ?').get(id);
  logAudit(req.user, 'create', 'time_adjustment', id, { employee_name, adjustment_type: type, adjustment_date }, null, created, employee_name);
  // Auto-translate the free-text to English for the (English-speaking) admin.
  // Fire-and-forget; returns unchanged text when it's already English.
  if (aiEnabled()) {
    const parts = [message, details].filter(Boolean);
    if (parts.length) {
      translateText(parts, 'en').then(out => {
        const en = out.filter(Boolean).join(' — ');
        if (en) getDb().prepare('UPDATE time_adjustments SET message_en = ? WHERE id = ?').run(en, id);
      }).catch(() => {});
    }
  }
  res.status(201).json(created);
});

// Semi-monthly pay periods (1st-15th, 16th-EOM) written as "2026-07 A/B".
// Kept as a plain derived string so filtering and grouping need no date math.
function payPeriodFor(dateStr) {
  const d = String(dateStr || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return null;
  return `${d.slice(0, 7)} ${Number(d.slice(8, 10)) <= 15 ? 'A' : 'B'}`;
}

router.get('/time/adjustments', (req, res) => {
  if (!requireAdmin(req, res)) return;
  const db = getDb();
  const { status, employee, from, to, pay_period, adp_status } = req.query;
  let sql = 'SELECT * FROM time_adjustments WHERE 1=1';
  const params = [];
  if (pay_period) { sql += ' AND pay_period = ?'; params.push(pay_period); }
  if (adp_status) { sql += " AND COALESCE(adp_status, 'pending') = ?"; params.push(adp_status); }
  if (status) { sql += ' AND status = ?'; params.push(status); }
  if (employee) { sql += ' AND employee_name = ?'; params.push(employee); }
  if (from) { sql += ' AND adjustment_date >= ?'; params.push(from); }
  if (to) { sql += ' AND adjustment_date <= ?'; params.push(to); }
  sql += ' ORDER BY adjustment_date DESC, created_at DESC LIMIT 1000';
  res.json(db.prepare(sql).all(...params));
});

// Per-employee rollup for the admin: absences / tardies in the last 30 and 90
// days, so patterns are visible without counting by hand.
router.get('/time/stats', (req, res) => {
  if (!requireAdmin(req, res)) return;
  const db = getDb();
  const rows = db.prepare(`
    SELECT employee_name,
      SUM(CASE WHEN adjustment_date >= date('now','-30 days') THEN 1 ELSE 0 END) AS last_30,
      SUM(CASE WHEN adjustment_date >= date('now','-90 days') THEN 1 ELSE 0 END) AS last_90,
      SUM(CASE WHEN adjustment_type = 'absent' AND adjustment_date >= date('now','-90 days') THEN 1 ELSE 0 END) AS absences_90,
      SUM(CASE WHEN adjustment_type = 'tardy_leave_early' AND adjustment_date >= date('now','-90 days') THEN 1 ELSE 0 END) AS tardies_90,
      MAX(adjustment_date) AS last_event
    FROM time_adjustments GROUP BY employee_name HAVING last_90 > 0 ORDER BY last_90 DESC, last_30 DESC
  `).all();
  res.json(rows);
});

router.put('/time/adjustments/:id', (req, res) => {
  if (!requireAdmin(req, res)) return;
  const db = getDb();
  const existing = db.prepare('SELECT * FROM time_adjustments WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Entry not found' });
  const status = req.body?.status === 'reviewed' ? 'reviewed' : req.body?.status === 'new' ? 'new' : existing.status;

  // The last mile after review: was this entry actually keyed into ADP for its
  // pay period? Stamped with who and when so payroll can be reconciled later.
  let adpStatus = existing.adp_status || 'pending';
  let adpBy = existing.adp_entered_by;
  let adpAt = existing.adp_entered_at;
  if (req.body?.adp_status !== undefined) {
    adpStatus = ['entered', 'not_applicable'].includes(req.body.adp_status) ? req.body.adp_status : 'pending';
    const done = adpStatus !== 'pending';
    adpBy = done ? req.user.name : null;
    adpAt = done ? new Date().toISOString() : null;
  }
  const payPeriod = req.body?.pay_period !== undefined
    ? (req.body.pay_period || null)
    : (existing.pay_period || payPeriodFor(existing.adjustment_date));

  db.prepare(`UPDATE time_adjustments SET status = ?, adp_status = ?, adp_entered_by = ?, adp_entered_at = ?,
    pay_period = ?, updated_at = datetime('now') WHERE id = ?`)
    .run(status, adpStatus, adpBy, adpAt, payPeriod, req.params.id);

  const updated = db.prepare('SELECT * FROM time_adjustments WHERE id = ?').get(req.params.id);
  if (updated.adp_status !== existing.adp_status) {
    logAudit(req.user, 'update', 'time_adjustment', req.params.id,
      { adp_status: { from: existing.adp_status || 'pending', to: updated.adp_status } }, existing, updated, existing.employee_name);
  }
  res.json(updated);
});

router.delete('/time/adjustments/:id', (req, res) => {
  if (!requireAdmin(req, res)) return;
  const db = getDb();
  const existing = db.prepare('SELECT * FROM time_adjustments WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Entry not found' });
  db.prepare('DELETE FROM time_adjustments WHERE id = ?').run(req.params.id);
  logAudit(req.user, 'delete', 'time_adjustment', req.params.id, null, existing, null, existing.employee_name);
  res.json({ deleted: req.params.id });
});

export default router;
