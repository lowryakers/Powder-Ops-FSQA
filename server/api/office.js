import { Router } from 'express';
import multer from 'multer';
import { v4 as uuid } from 'uuid';
import { getDb, logAudit } from '../db.js';
import { storageEnabled, putObject, presignGet, deleteObject } from '../storage.js';
import { aiEnabled, translateText } from '../ai.js';

// Office Ops: supply ordering + time tracking (replaces two Monday boards).
// Submitting is open to supervisors + admins; managing the logs is admin-only
// (Marnee). Invoices upload to R2 when storage is configured.

const router = Router();
const invoiceUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024, files: 5 } });

function canSubmit(req) {
  return req.user?.role === 'admin' || req.user?.role === 'supervisor';
}
function requireSubmit(req, res) {
  if (!canSubmit(req)) { res.status(403).json({ error: 'Only supervisors and admins can use this form.' }); return false; }
  return true;
}
function requireAdmin(req, res) {
  if (req.user?.role !== 'admin') { res.status(403).json({ error: 'Admin only.' }); return false; }
  return true;
}

// ── Supply orders ────────────────────────────────────────────────────────────

// Item history for the form: distinct items with their most recent details, so
// reorders are one click and typing autocompletes from what's been bought before.
router.get('/supply/items', (req, res) => {
  if (!requireSubmit(req, res)) return;
  const db = getDb();
  const rows = db.prepare(`
    SELECT item_name, supplier, link, uom, label, qty, COUNT(*) AS times_ordered, MAX(submitted_at) AS last_ordered
    FROM supply_orders GROUP BY LOWER(item_name), LOWER(COALESCE(supplier,'')) ORDER BY times_ordered DESC, last_ordered DESC LIMIT 400
  `).all();
  res.json(rows);
});

router.post('/supply/orders', (req, res) => {
  if (!requireSubmit(req, res)) return;
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
  if (!requireSubmit(req, res)) return;
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
  if (q) { sql += ' AND (filename LIKE ? OR supplier LIKE ? OR notes LIKE ?)'; params.push(`%${q}%`, `%${q}%`, `%${q}%`); }
  sql += ' ORDER BY COALESCE(invoice_date, created_at) DESC LIMIT 500';
  const rows = db.prepare(sql).all(...params);
  const out = await Promise.all(rows.map(async r => ({ ...r, url: await presignGet(r.storage_key, r.filename).catch(() => null) })));
  res.json(out);
});

router.post('/supply/invoices', invoiceUpload.array('files', 5), async (req, res) => {
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
  if (!requireSubmit(req, res)) return;
  const db = getDb();
  const { employee_name, employee_id, adjustment_type, adjustment_date, message, details } = req.body || {};
  if (!employee_name || !adjustment_date) return res.status(400).json({ error: 'employee_name and adjustment_date are required' });
  const type = ['absent', 'tardy_leave_early', 'other'].includes(adjustment_type) ? adjustment_type : 'other';
  const id = uuid();
  db.prepare(`INSERT INTO time_adjustments (id, employee_name, employee_id, adjustment_type, adjustment_date, message, details, submitted_by, submitted_by_id)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, employee_name, employee_id || null, type, adjustment_date, message || null, details || null, req.user.name, req.user.id);
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

router.get('/time/adjustments', (req, res) => {
  if (!requireAdmin(req, res)) return;
  const db = getDb();
  const { status, employee, from, to } = req.query;
  let sql = 'SELECT * FROM time_adjustments WHERE 1=1';
  const params = [];
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
  db.prepare("UPDATE time_adjustments SET status = ?, updated_at = datetime('now') WHERE id = ?").run(status, req.params.id);
  res.json(db.prepare('SELECT * FROM time_adjustments WHERE id = ?').get(req.params.id));
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
