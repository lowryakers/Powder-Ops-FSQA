import { Router } from 'express';
import multer from 'multer';
import { v4 as uuid } from 'uuid';
import { getDb, logAudit } from '../db.js';
import { storageEnabled, putObject, presignGet, deleteObject, getObjectBuffer } from '../storage.js';
import { aiEnabled, translateText } from '../ai.js';
import { extractInvoiceText } from '../invoice-text.js';
import { USED_UP_REASON } from '../qms-config.js';

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

// Pay periods are every two weeks, anchored on the 2026-07-19 → 2026-08-01
// period. Stored as the period's start date (YYYY-MM-DD) so it sorts and
// filters without any date maths; the UI renders it as "7/19 – 8/1".
export const PAY_PERIOD_ANCHOR = '2026-07-19';
const DAY = 86400000;

function payPeriodFor(dateStr) {
  const d = String(dateStr || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return null;
  const anchor = Date.parse(`${PAY_PERIOD_ANCHOR}T00:00:00Z`);
  const n = Math.floor((Date.parse(`${d}T00:00:00Z`) - anchor) / (14 * DAY));
  return new Date(anchor + n * 14 * DAY).toISOString().slice(0, 10);
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

// Bulk review: the same two decisions as the single-entry PUT (reviewed, and
// keyed into ADP) applied to a selection. Reconciling a whole pay period one
// row at a time is the slow part of Marnee's month, so this is one round trip
// and one transaction. Each entry is still audited individually — a bulk edit
// has to leave the same trail a manual one would.
router.put('/time/adjustments/bulk', (req, res) => {
  if (!requireAdmin(req, res)) return;
  const db = getDb();
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.filter(x => typeof x === 'string') : [];
  if (!ids.length) return res.status(400).json({ error: 'No entries selected' });

  const wantStatus = ['new', 'reviewed'].includes(req.body?.status) ? req.body.status : null;
  const wantAdp = ['pending', 'entered', 'not_applicable'].includes(req.body?.adp_status) ? req.body.adp_status : null;
  if (!wantStatus && !wantAdp) return res.status(400).json({ error: 'Nothing to change' });

  const get = db.prepare('SELECT * FROM time_adjustments WHERE id = ?');
  const upd = db.prepare(`UPDATE time_adjustments SET status = ?, adp_status = ?, adp_entered_by = ?,
    adp_entered_at = ?, pay_period = ?, updated_at = datetime('now') WHERE id = ?`);
  const now = new Date().toISOString();
  const changed = [];

  db.transaction(() => {
    for (const id of ids) {
      const existing = get.get(id);
      if (!existing) continue;
      const status = wantStatus || existing.status;
      const adpStatus = wantAdp || existing.adp_status || 'pending';
      const done = adpStatus !== 'pending';
      // Only re-stamp who/when when the ADP state is what actually moved.
      const adpMoved = wantAdp && adpStatus !== (existing.adp_status || 'pending');
      const adpBy = adpMoved ? (done ? req.user.name : null) : existing.adp_entered_by;
      const adpAt = adpMoved ? (done ? now : null) : existing.adp_entered_at;
      // Older rows predate the pay-period column; stamp it while we're here so
      // the period filter groups them the same way an edited row would.
      const payPeriod = existing.pay_period || payPeriodFor(existing.adjustment_date);
      if (status === existing.status && !adpMoved && payPeriod === existing.pay_period) continue;
      upd.run(status, adpStatus, adpBy, adpAt, payPeriod, id);
      changed.push({ existing, after: get.get(id) });
    }
  })();

  for (const { existing, after } of changed) {
    logAudit(req.user, 'update', 'time_adjustment', after.id, {
      bulk: true,
      ...(after.status !== existing.status ? { status: { from: existing.status, to: after.status } } : {}),
      ...(after.adp_status !== existing.adp_status
        ? { adp_status: { from: existing.adp_status || 'pending', to: after.adp_status } } : {}),
    }, existing, after, existing.employee_name);
  }
  res.json({ updated: changed.length, requested: ids.length });
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

router.post('/time/adjustments/bulk-delete', (req, res) => {
  if (!requireAdmin(req, res)) return;
  const db = getDb();
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.filter(x => typeof x === 'string') : [];
  if (!ids.length) return res.status(400).json({ error: 'No entries selected' });
  const get = db.prepare('SELECT * FROM time_adjustments WHERE id = ?');
  const del = db.prepare('DELETE FROM time_adjustments WHERE id = ?');
  const removed = [];
  db.transaction(() => {
    for (const id of ids) {
      const existing = get.get(id);
      if (!existing) continue;
      del.run(id);
      removed.push(existing);
    }
  })();
  for (const e of removed) {
    logAudit(req.user, 'delete', 'time_adjustment', e.id, { bulk: true }, e, null, e.employee_name);
  }
  res.json({ deleted: removed.length, requested: ids.length });
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

// ── Restock suggestions ──────────────────────────────────────────────────────
// A chemical that runs out never comes back, so signing it in as "Used up /
// ran out" is the only honest way to close the record — and it's also the
// earliest anyone knows to reorder.
//
// These are SUGGESTIONS, deliberately not supply requests. Three people
// finishing the same sanitizer would otherwise put three near-identical rows in
// the office queue, and a queue with duplicates in it stops being read. So they
// are grouped by item, live in their own dismissible strip, and only become a
// real request when someone decides they should — the decision about what gets
// ordered stays with the person who orders.
//
// There's no suggestions table: a suggestion IS a sign-out record whose outcome
// was "used up", and its state lives on that record. Nothing to keep in sync.
const SUGGESTION_SQL = `
  SELECT id, data, record_number, record_date, created_by
  FROM qms_records
  WHERE record_type = 'maintenance_sign_out'
    AND json_extract(data, '$.return_reason') = ?
    AND COALESCE(json_extract(data, '$.suggestion_state'), 'open') = 'open'
  ORDER BY record_date DESC, created_at DESC LIMIT 500`;

function openSuggestions(db) {
  let rows = [];
  try { rows = db.prepare(SUGGESTION_SQL).all(USED_UP_REASON); } catch { return []; }
  // Group by item: "3 people reported this" is one thing to act on, not three.
  const byItem = new Map();
  for (const r of rows) {
    let d = {};
    try { d = JSON.parse(r.data || '{}'); } catch { /* skip */ }
    const item = (d.item_description || '').trim();
    if (!item) continue;
    if (!byItem.has(item)) byItem.set(item, { item_name: item, count: 0, ids: [], last_reported: null, reported_by: [], notes: [] });
    const g = byItem.get(item);
    g.count += 1;
    g.ids.push(r.id);
    if (!g.last_reported || (r.record_date || '') > g.last_reported) g.last_reported = r.record_date;
    const who = d.employee_name || r.created_by;
    if (who && !g.reported_by.includes(who)) g.reported_by.push(who);
    if (d.comments && !g.notes.includes(d.comments)) g.notes.push(d.comments);
  }
  return [...byItem.values()].sort((a, b) => (b.last_reported || '').localeCompare(a.last_reported || ''));
}

router.get('/supply/suggestions', (req, res) => {
  if (!requireAdmin(req, res)) return;
  res.json(openSuggestions(getDb()));
});

// Stamp the state onto each contributing record, so a dismissed or ordered
// suggestion doesn't come back next time the strip loads.
function markSuggestion(db, ids, state) {
  const get = db.prepare('SELECT data FROM qms_records WHERE id = ?');
  const upd = db.prepare("UPDATE qms_records SET data = ?, updated_at = datetime('now') WHERE id = ?");
  let n = 0;
  db.transaction(() => {
    for (const id of ids) {
      const row = get.get(id);
      if (!row) continue;
      let d = {};
      try { d = JSON.parse(row.data || '{}'); } catch { d = {}; }
      d.suggestion_state = state;
      upd.run(JSON.stringify(d), id);
      n += 1;
    }
  })();
  return n;
}

router.post('/supply/suggestions/dismiss', (req, res) => {
  if (!requireAdmin(req, res)) return;
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.filter(x => typeof x === 'string') : [];
  if (!ids.length) return res.status(400).json({ error: 'Nothing selected' });
  const db = getDb();
  const n = markSuggestion(db, ids, 'dismissed');
  logAudit(req.user, 'update', 'supply_suggestion', null, { dismissed: n, item: req.body?.item_name || null });
  res.json({ dismissed: n });
});

// Turn a suggestion into a real supply request. The office still fills in
// quantity and supplier the normal way; this only saves the retyping and keeps
// the link back to who reported it.
router.post('/supply/suggestions/order', (req, res) => {
  if (!requireAdmin(req, res)) return;
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.filter(x => typeof x === 'string') : [];
  const item = String(req.body?.item_name || '').trim();
  if (!item) return res.status(400).json({ error: 'Item name is required' });
  const db = getDb();
  const id = uuid();
  const reported = Array.isArray(req.body?.reported_by) ? req.body.reported_by.filter(Boolean) : [];
  const notes = ['Reported used up on the Sign In/Out log', reported.length ? `by ${reported.join(', ')}` : '']
    .filter(Boolean).join(' ');
  db.prepare(`INSERT INTO supply_orders (id, item_name, qty, uom, urgent, label, notes, requested_by, requested_by_id)
              VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?)`)
    .run(id, item, req.body?.qty ?? null, req.body?.uom || null, req.body?.label || null, notes, req.user.name, req.user.id);
  if (ids.length) markSuggestion(db, ids, 'ordered');
  const created = db.prepare('SELECT * FROM supply_orders WHERE id = ?').get(id);
  logAudit(req.user, 'create', 'supply_order', id, { item_name: item, from_suggestion: true, records: ids.length }, null, created, item);
  res.status(201).json(created);
});

// ── Hours & spend ────────────────────────────────────────────────────────────
// Merged in from the standalone tracker Marnee was keeping. Two additions:
// hours worked vs paid non-working time per pay period, and what the supply
// orders in that period actually cost, by category.
//
// Pay periods are the same biweekly Sun–Sat periods used everywhere else
// (payPeriodFor above); weeks are the two halves of a period.

const STANDARD_WEEK_HOURS = 40;
const DAY_MS = 86400000;

// The two week-start dates (Sundays) inside a pay period.
function weeksOf(periodStart) {
  const a = Date.parse(`${periodStart}T00:00:00Z`);
  return [periodStart, new Date(a + 7 * DAY_MS).toISOString().slice(0, 10)];
}

// Recent pay periods, newest first, for the period picker.
router.get('/periods', (req, res) => {
  if (!requireAdmin(req, res)) return;
  const count = Math.min(Number(req.query.count) || 8, 26);
  const current = payPeriodFor(new Date().toISOString().slice(0, 10));
  const out = [];
  for (let i = 0; i < count; i++) {
    const start = new Date(Date.parse(`${current}T00:00:00Z`) - i * 14 * DAY_MS).toISOString().slice(0, 10);
    const end = new Date(Date.parse(`${start}T00:00:00Z`) + 13 * DAY_MS).toISOString().slice(0, 10);
    out.push({ start, end, weeks: weeksOf(start), current: i === 0 });
  }
  res.json(out);
});

// The roster comes straight from the users table — active people only, no bot
// — so adding someone in Settings adds them here.
//
// Admins and auditors are excluded: this tab tracks hourly staff against a
// weekly target, and salaried/system accounts only add rows Marnee has to
// scroll past. They still appear everywhere else in the app.
// Sorted alphabetically by LAST name, in JS rather than in SQL.
//
// Two reasons it isn't `ORDER BY name`. First, this is the payroll tab and it
// gets read against ADP, which lists people by surname. Second, SQLite's
// default collation compares raw bytes, so any name starting with an accent —
// Ángel, Óscar, Ñuñez — sorts after every plain-ASCII name instead of where it
// belongs, which is what dropped a handful of people at the bottom of an
// otherwise A–Z list. localeCompare knows Á files under A.
const byName = new Intl.Collator('en', { sensitivity: 'base', ignorePunctuation: true });

// Suffixes aren't surnames. Without this "Robert Smith Jr." files under J.
const NAME_SUFFIX = /^(jr|sr|ii|iii|iv|v|md|phd|dds|esq)\.?$/i;

/**
 * The surname to file someone under: the last word of their full legal name,
 * ignoring a trailing suffix.
 *
 * Spanish names carry two surnames (paternal then maternal), so "Gaston Antonio
 * Perez Quintanilla" files under Quintanilla. That's the same rule the sign-in
 * username derivation uses (server/usernames.js), so the two agree — and where
 * someone goes by the paternal surname instead, the fix is the same one:
 * correct it on their record rather than special-casing it here.
 */
function lastNameOf(fullName) {
  const parts = String(fullName || '').trim().split(/\s+/).filter(Boolean);
  while (parts.length > 1 && NAME_SUFFIX.test(parts[parts.length - 1])) parts.pop();
  return parts[parts.length - 1] || '';
}

function roster(db) {
  return db.prepare(`SELECT id, name, department, weekly_hours_target FROM users
    WHERE is_active = 1 AND name != 'ReadyBot' AND role NOT IN ('auditor', 'admin')`).all()
    .map(u => ({ ...u, target: u.weekly_hours_target || STANDARD_WEEK_HOURS }))
    // Full name breaks ties, so two people who share a surname stay in a
    // stable, predictable order rather than whatever the table returns.
    .sort((a, b) => byName.compare(lastNameOf(a.name), lastNameOf(b.name))
      || byName.compare(a.name || '', b.name || ''));
}

router.get('/hours', (req, res) => {
  if (!requireAdmin(req, res)) return;
  const db = getDb();
  const periodStart = /^\d{4}-\d{2}-\d{2}$/.test(req.query.period || '')
    ? req.query.period : payPeriodFor(new Date().toISOString().slice(0, 10));
  const weeks = weeksOf(periodStart);

  const rows = db.prepare('SELECT * FROM employee_hours WHERE week_start IN (?, ?)').all(...weeks);
  const byUser = {};
  for (const r of rows) (byUser[r.user_id] = byUser[r.user_id] || {})[r.week_start] = r;

  const people = roster(db).map(u => {
    const weekRows = weeks.map(w => {
      const r = byUser[u.id]?.[w];
      const worked = r?.worked || 0, pto = r?.pto || 0, holiday = r?.holiday || 0, unpaid = r?.unpaid || 0;
      const autoFill = r ? !!r.auto_fill : true;
      // Paid-but-not-worked: the balance up to target, only once there's an
      // entry — an untouched week shouldn't invent 40 hours of anything.
      const nonWorking = (r && autoFill) ? Math.max(0, u.target - worked - pto - holiday - unpaid) : 0;
      return {
        week_start: w, worked, pto, holiday, unpaid, auto_fill: autoFill,
        has_entry: !!r, note: r?.note || null,
        non_working: Math.round(nonWorking * 100) / 100,
        overtime: Math.round(Math.max(0, worked - u.target) * 100) / 100,
        total: Math.round((worked + pto + holiday + nonWorking) * 100) / 100,
      };
    });
    const sum = (k) => Math.round(weekRows.reduce((n, w) => n + w[k], 0) * 100) / 100;
    return {
      user_id: u.id, name: u.name, department: u.department, target: u.target,
      weeks: weekRows,
      period: { worked: sum('worked'), pto: sum('pto'), holiday: sum('holiday'), unpaid: sum('unpaid'),
        non_working: sum('non_working'), overtime: sum('overtime'), total: sum('total') },
    };
  });

  const totals = people.reduce((acc, p) => {
    for (const k of ['worked', 'pto', 'holiday', 'unpaid', 'non_working', 'overtime', 'total']) {
      acc[k] = Math.round(((acc[k] || 0) + p.period[k]) * 100) / 100;
    }
    return acc;
  }, {});

  res.json({ period_start: periodStart, weeks, people, totals });
});

router.put('/hours', (req, res) => {
  if (!requireAdmin(req, res)) return;
  const db = getDb();
  const { user_id, week_start } = req.body || {};
  if (!user_id || !/^\d{4}-\d{2}-\d{2}$/.test(week_start || '')) {
    return res.status(400).json({ error: 'user_id and week_start are required' });
  }
  const person = db.prepare('SELECT id, name FROM users WHERE id = ?').get(user_id);
  if (!person) return res.status(404).json({ error: 'Person not found' });

  const existing = db.prepare('SELECT * FROM employee_hours WHERE user_id = ? AND week_start = ?').get(user_id, week_start);
  const n = (v, fallback) => (v === undefined ? fallback : Math.max(0, Number(v) || 0));
  const next = {
    worked: n(req.body.worked, existing?.worked || 0),
    pto: n(req.body.pto, existing?.pto || 0),
    holiday: n(req.body.holiday, existing?.holiday || 0),
    unpaid: n(req.body.unpaid, existing?.unpaid || 0),
    auto_fill: req.body.auto_fill === undefined ? (existing ? existing.auto_fill : 1) : (req.body.auto_fill ? 1 : 0),
    note: req.body.note === undefined ? (existing?.note || null) : (req.body.note || null),
  };

  if (existing) {
    db.prepare(`UPDATE employee_hours SET worked = ?, pto = ?, holiday = ?, unpaid = ?, auto_fill = ?,
      note = ?, updated_by = ?, updated_at = datetime('now') WHERE id = ?`)
      .run(next.worked, next.pto, next.holiday, next.unpaid, next.auto_fill, next.note, req.user.name, existing.id);
  } else {
    db.prepare(`INSERT INTO employee_hours (id, user_id, week_start, worked, pto, holiday, unpaid, auto_fill, note, updated_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(uuid(), user_id, week_start, next.worked, next.pto, next.holiday, next.unpaid, next.auto_fill, next.note, req.user.name);
  }
  res.json(db.prepare('SELECT * FROM employee_hours WHERE user_id = ? AND week_start = ?').get(user_id, week_start));
});

// Per-person weekly target (Settings keeps the roster; this keeps the number
// payroll cares about next to it).
router.put('/hours/target/:userId', (req, res) => {
  if (!requireAdmin(req, res)) return;
  const db = getDb();
  const target = req.body?.target === null || req.body?.target === '' ? null : Math.max(0, Number(req.body?.target) || 0);
  db.prepare("UPDATE users SET weekly_hours_target = ?, updated_at = datetime('now') WHERE id = ?").run(target, req.params.userId);
  res.json({ ok: true, target });
});

// Supply spend for a pay period, by category — the card that used to come from
// the Monday board, now reading the supply orders in this app.
router.get('/spend', (req, res) => {
  if (!requireAdmin(req, res)) return;
  const db = getDb();
  const periodStart = /^\d{4}-\d{2}-\d{2}$/.test(req.query.period || '')
    ? req.query.period : payPeriodFor(new Date().toISOString().slice(0, 10));
  const end = new Date(Date.parse(`${periodStart}T00:00:00Z`) + 13 * DAY_MS).toISOString().slice(0, 10);

  // Ordered-or-later orders are money committed; date them by when they were
  // submitted, which is the only date every row reliably has.
  const rows = db.prepare(`SELECT * FROM supply_orders
    WHERE status IN ('ordered','received','paid')
      AND date(submitted_at) BETWEEN ? AND ?
    ORDER BY submitted_at DESC`).all(periodStart, end);

  const byCategory = {};
  let total = 0;
  for (const r of rows) {
    const key = (r.label || 'Uncategorized').trim() || 'Uncategorized';
    const amount = Number(r.total) || 0;
    byCategory[key] = byCategory[key] || { label: key, amount: 0, count: 0 };
    byCategory[key].amount = Math.round((byCategory[key].amount + amount) * 100) / 100;
    byCategory[key].count++;
    total += amount;
  }

  res.json({
    period_start: periodStart, period_end: end,
    total: Math.round(total * 100) / 100,
    order_count: rows.length,
    untotalled: rows.filter(r => r.total == null).length,
    categories: Object.values(byCategory).sort((a, b) => b.amount - a.amount),
    orders: rows.map(r => ({ id: r.id, item_name: r.item_name, supplier: r.supplier, label: r.label,
      total: r.total, status: r.status, submitted_at: r.submitted_at, link: r.link })),
  });
});

export default router;
