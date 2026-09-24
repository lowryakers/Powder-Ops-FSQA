import { Router } from 'express';
import multer from 'multer';
import { v4 as uuid } from 'uuid';
import { getDb, logAudit } from '../db.js';
import { storageEnabled, putObject, presignGet, deleteObject, getObjectBuffer } from '../storage.js';
import { aiEnabled, translateText } from '../ai.js';
import { extractInvoiceText } from '../invoice-text.js';
import { readInvoiceFigures } from '../invoice-figures.js';
import { USED_UP_REASON } from '../qms-config.js';
import { listOptions } from '../custom-fields.js';
import { CADENCES, periodOf, dueDateOf, cyclesDue, cycleAge, normalizeTags } from '../supply-lists.js';
import { botDm, postMessageAs } from './comms.js';
import { pushToUser } from '../push.js';
import { readyDocOrigin } from '../links.js';

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
  applyInvoiceFigures(db, id, text);
}

/**
 * Read the total and the date off the invoice, and fill the record's BLANKS.
 *
 * A figure read off a document may fill a field nobody answered; it may never
 * overwrite one somebody typed. `total_source` is what keeps those two apart —
 * re-reading a file can move a figure it supplied itself, and can never touch
 * one that came from a person. The evidence lines are stored beside the values,
 * so the number on the record can be checked against the document without
 * opening the document.
 */
function applyInvoiceFigures(db, id, text) {
  let row;
  try { row = db.prepare('SELECT total, invoice_date, total_source FROM supply_invoices WHERE id = ?').get(id); } catch { return null; }
  if (!row) return null;
  const figures = readInvoiceFigures(text);
  const typed = row.total_source === 'typed' || (row.total != null && !row.total_source);
  const total = (figures.total != null && !typed) ? figures.total : row.total;
  const source = total == null ? null : (typed ? 'typed' : (figures.total != null ? 'read' : row.total_source));
  const invoiceDate = row.invoice_date || figures.invoice_date || null;
  try {
    db.prepare('UPDATE supply_invoices SET figures = ?, total = ?, total_source = ?, invoice_date = ? WHERE id = ?')
      .run(JSON.stringify(figures), total, source, invoiceDate, id);
  } catch { /* columns optional on an older database */ }
  return figures;
}

// A JSON column that will not parse is a column with nothing in it — written
// as an IIFE returning the value, because the initialise-then-assign shape has
// an initialiser no branch ever reads.
function parseJson(raw, fallback) {
  return (() => { try { return raw ? JSON.parse(raw) : fallback; } catch { return fallback; } })();
}

function invoiceShape(r) {
  const figures = parseJson(r.figures, null);
  const { extracted_text, ...rest } = r;   // megabytes of OCR: searched, never shipped
  return { ...rest, figures, searchable: extracted_text == null ? null : !!extracted_text };
}

/**
 * What has actually arrived.
 *
 * `qty_received` is the only stored fact; everything the screen shows about a
 * part-delivered order is derived from it against `qty` on every read. An order
 * with no quantity written down cannot be part-received — there is nothing to
 * be a part OF — so it reports `qty_known: false` and receiving closes it
 * outright rather than inventing a denominator.
 */
function orderShape(row, extra = {}) {
  const qty = Number(row.qty);
  const qtyKnown = Number.isFinite(qty) && qty > 0;
  const received = Number(row.qty_received) || 0;
  const history = parseJson(row.receipt_history, []);
  const outstanding = qtyKnown ? Math.max(0, +(qty - received).toFixed(4)) : null;
  const state = received <= 0 ? 'none'
    : (!qtyKnown || received >= qty) ? 'complete'
      : 'partial';
  const tags = parseJson(row.tags, null);
  return {
    ...row,
    qty_received: received,
    qty_known: qtyKnown,
    outstanding,
    receipt_state: state,
    receipt_history: Array.isArray(history) ? history : [],
    // A row filed before tags existed carries its single `label`, so the chips
    // and the group filter cover the whole history with no backfill.
    tags: Array.isArray(tags) && tags.length ? tags : (row.label ? [row.label] : []),
    ...extra,
  };
}

// ── Groups, and the standing lists that recur (D-106) ────────────────────────
const today = () => new Date().toISOString().slice(0, 10);
/** The groups in use: the managed list, so adding one is a Settings task. */
function knownTags(db) {
  try { return listOptions(db, 'supply_tags').map(o => o.value); } catch { return []; }
}
/**
 * `tags` is the fact; `label` is its FIRST ENTRY MIRRORED (the mo_lines line-0
 * rule), written in the same statement and nowhere else. Every filter, form
 * and export that already reads `label` keeps working, and a request can now
 * belong to more than one group.
 */
function tagFields(db, body) {
  if (body?.tags === undefined && body?.label === undefined) return null;
  const raw = body?.tags !== undefined ? body.tags : (body.label ? [body.label] : []);
  const tags = normalizeTags(raw, knownTags(db));
  return { tags: tags.length ? JSON.stringify(tags) : null, label: tags[0] || null };
}
function listShape(db, row) {
  const items = db.prepare('SELECT * FROM supply_list_items WHERE list_id = ? AND active = 1 ORDER BY sort, item_name').all(row.id);
  const open = db.prepare('SELECT * FROM supply_list_cycles WHERE list_id = ? AND closed_at IS NULL ORDER BY due_date LIMIT 1').get(row.id);
  const last = db.prepare('SELECT * FROM supply_list_cycles WHERE list_id = ? AND closed_at IS NOT NULL ORDER BY closed_at DESC LIMIT 1').get(row.id);
  const t = today();
  return {
    ...row,
    active: !!row.active,
    tags: parseJson(row.tags, []) || [],
    items,
    item_count: items.length,
    // DERIVED on every read, never a stored "next run" — a stored date drifts
    // the first time somebody changes the cadence, and then the list is either
    // asked about twice or silently never again.
    next_due: items.length && row.active ? dueDateOf(row.cadence, row.day, t) : null,
    next_period: items.length && row.active ? periodOf(row.cadence, t) : null,
    open_cycle: open ? { ...open, days_late: cycleAge(open, t) } : null,
    last_cycle: last || null,
  };
}

/**
 * Open the cycles that have come due. Idempotent by construction — the UNIQUE
 * on (list_id, period) is what makes the hourly job, a redeploy in the same
 * hour and somebody pressing the button all produce one cycle.
 */
export function openSupplyCycles(db, on = today()) {
  // The IIFE form, not `let x = []; try { x = … }`: both branches assign, so
  // the initialiser is never read and the linter is right to refuse it.
  const lists = (() => {
    try {
      return db.prepare(`SELECT l.*, (SELECT COUNT(*) FROM supply_list_items i
        WHERE i.list_id = l.id AND i.active = 1) AS item_count FROM supply_lists l`).all();
    } catch { return null; }
  })();
  if (!lists) return { opened: 0, cycles: [] };
  const existing = new Set(db.prepare('SELECT list_id, period FROM supply_list_cycles').all()
    .map(c => `${c.list_id}:${c.period}`));
  const due = cyclesDue(lists, on, existing);
  const ins = db.prepare(`INSERT OR IGNORE INTO supply_list_cycles (id, list_id, period, due_date)
    VALUES (?, ?, ?, ?)`);
  let opened = 0;
  for (const c of due) { if (ins.run(uuid(), c.list_id, c.period, c.due_date).changes) opened += 1; }
  return { opened, cycles: due };
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
    SELECT item_name, supplier, link, uom, label, tags, qty, COUNT(*) AS times_ordered, MAX(submitted_at) AS last_ordered
    FROM supply_orders GROUP BY LOWER(item_name), LOWER(COALESCE(supplier,'')) ORDER BY times_ordered DESC, last_ordered DESC LIMIT 400
  `).all();
  res.json(rows);
});

router.post('/supply/orders', (req, res) => {
  if (!requireSubmit(req, res, 'supply')) return;
  const db = getDb();
  const { item_name, qty, uom, link, supplier, urgent, notes } = req.body || {};
  if (!item_name || !String(item_name).trim()) return res.status(400).json({ error: 'Item name is required' });
  const id = uuid();
  const tf = tagFields(db, req.body) || { tags: null, label: null };
  db.prepare(`INSERT INTO supply_orders (id, item_name, qty, uom, link, supplier, urgent, label, tags, notes, requested_by, requested_by_id)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, String(item_name).trim(), qty ?? null, uom || null, link || null, supplier || null, urgent ? 1 : 0, tf.label, tf.tags,
      notes || null, req.user.name, req.user.id);
  const created = db.prepare('SELECT * FROM supply_orders WHERE id = ?').get(id);
  logAudit(req.user, 'create', 'supply_order', id, { item_name, qty, supplier, urgent: !!urgent }, null, created, item_name);
  res.status(201).json(orderShape(created));
});

// Admin log, filterable by status/search.
router.get('/supply/orders', (req, res) => {
  if (!requireAdmin(req, res)) return;
  const db = getDb();
  const { status, q } = req.query;
  let sql = 'SELECT * FROM supply_orders WHERE 1=1';
  const params = [];
  if (status) { sql += ' AND status = ?'; params.push(status); }
  if (q && String(q).trim()) { sql += ' AND (item_name LIKE ? OR supplier LIKE ? OR label LIKE ?)'; params.push(`%${q}%`, `%${q}%`, `%${q}%`); }
  // A GROUP IS MATCHED AS A WHOLE ELEMENT, never as a substring: "Office" must
  // not pull in a free group somebody typed as "Front Office". json_each on a
  // NULL column yields no rows, so the `label` half is what covers every
  // request filed before tags existed.
  if (req.query.tag) {
    sql += ` AND (LOWER(COALESCE(label,'')) = LOWER(?) OR EXISTS (
      SELECT 1 FROM json_each(supply_orders.tags) t WHERE LOWER(t.value) = LOWER(?)))`;
    params.push(req.query.tag, req.query.tag);
  }
  sql += " ORDER BY CASE status WHEN 'new' THEN 0 WHEN 'ordered' THEN 1 WHEN 'received' THEN 2 ELSE 3 END, urgent DESC, submitted_at DESC LIMIT 1000";
  const rows = db.prepare(sql).all(...params);
  // One lookup for every linked invoice rather than a query per row.
  const ids = [...new Set(rows.map(r => r.invoice_id).filter(Boolean))];
  const invoices = new Map();
  if (ids.length) {
    const marks = ids.map(() => '?').join(',');
    for (const inv of db.prepare(`SELECT id, filename, total, total_source, figures FROM supply_invoices WHERE id IN (${marks})`).all(...ids)) {
      invoices.set(inv.id, inv);
    }
  }
  res.json(rows.map(r => orderShape(r, suggestedTotal(r, invoices.get(r.invoice_id)))));
});

/**
 * The total the linked invoice says, offered when the order has none.
 *
 * SUGGESTED, NEVER APPLIED. One invoice routinely covers several orders, so
 * copying its total onto each of them would state a cost three times over. The
 * screen offers the figure with the file it came from and a person accepts it;
 * an order that already has a total is left completely alone.
 */
function suggestedTotal(order, invoice) {
  if (!invoice || order.total != null) return {};
  if (invoice.total == null) return {};
  const evidence = parseJson(invoice.figures, null)?.total_evidence ?? null;
  return {
    suggested_total: invoice.total,
    suggested_total_from: invoice.filename,
    suggested_total_source: invoice.total_source || 'typed',
    suggested_total_evidence: invoice.total_source === 'read' ? evidence : null,
  };
}

/**
 * Receiving part of an order.
 *
 * Three barstools ordered and one delivered is the ordinary case. `qty` is
 * accumulated rather than set, because the second delivery is a separate event
 * and each one is appended to `receipt_history` with who took it in — "when did
 * the rest turn up" is then answerable from the record.
 *
 * A CORRECTION IS A NEGATIVE ENTRY, NOT AN ERASURE. Miscounting a delivery is
 * ordinary; rewriting the count so the mistake never happened is not, and it
 * is the difference between a log and a number. A correction needs a note, and
 * the running total can never go below zero or the record would describe
 * something impossible.
 */
router.post('/supply/orders/:id/receive', (req, res) => {
  if (!requireAdmin(req, res)) return;
  const db = getDb();
  const existing = db.prepare('SELECT * FROM supply_orders WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Order not found' });

  const qty = Number(req.body?.qty);
  if (!Number.isFinite(qty) || qty === 0) return res.status(400).json({ error: 'How many arrived?' });
  const note = String(req.body?.note || '').trim();
  if (qty < 0 && note.length < 3) return res.status(400).json({ error: 'A correction needs a reason.' });

  const before = Number(existing.qty_received) || 0;
  const after = +(before + qty).toFixed(4);
  if (after < 0) return res.status(400).json({ error: `Only ${before} recorded as received — that correction would take it below zero.` });

  const ordered = Number(existing.qty);
  const qtyKnown = Number.isFinite(ordered) && ordered > 0;
  if (qtyKnown && after > ordered) {
    return res.status(400).json({ error: `${ordered} ${existing.uom || ''}`.trim() + ` ordered — receiving ${after} would be more than that. Correct the order quantity first.` });
  }

  const history = parseJson(existing.receipt_history, []);
  const entries = Array.isArray(history) ? history : [];
  entries.push({ at: new Date().toISOString(), by: req.user.name, qty, note: note || null, total_after: after });

  // The status follows the count and is never set by hand here: an order is
  // received when everything ordered has arrived, and stays 'ordered' while
  // any of it is outstanding. Without a quantity there is nothing to be a part
  // of, so any receipt closes it.
  const complete = !qtyKnown || after >= ordered;
  const status = after <= 0 ? (existing.status === 'received' ? 'ordered' : existing.status)
    : complete ? 'received' : 'ordered';

  db.prepare(`UPDATE supply_orders SET qty_received = ?, receipt_history = ?, status = ?,
              received_at = ?, received_by = ?, updated_at = datetime('now') WHERE id = ?`)
    .run(after, JSON.stringify(entries), status,
      complete && after > 0 ? new Date().toISOString() : null,
      complete && after > 0 ? req.user.name : null, req.params.id);

  const updated = db.prepare('SELECT * FROM supply_orders WHERE id = ?').get(req.params.id);
  logAudit(req.user, 'update', 'supply_order', req.params.id,
    { received: qty, total_received: after, of: qtyKnown ? ordered : null, note: note || null },
    existing, updated, existing.item_name);
  res.json(orderShape(updated));
});

router.put('/supply/orders/:id', (req, res) => {
  if (!requireAdmin(req, res)) return;
  const db = getDb();
  const existing = db.prepare('SELECT * FROM supply_orders WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Order not found' });
  const fields = ['item_name', 'qty', 'uom', 'link', 'supplier', 'urgent', 'status', 'total', 'eta', 'invoice_link', 'invoice_id', 'notes'];
  const patch = {};
  for (const f of fields) if (req.body[f] !== undefined) patch[f] = f === 'urgent' ? (req.body[f] ? 1 : 0) : req.body[f];
  // `label` is written only here, as the mirror of the first tag — an edit
  // that set one and not the other is how the chips and the group filter start
  // disagreeing about what a request is for.
  const tf = tagFields(db, req.body);
  if (tf) Object.assign(patch, tf);
  if (!Object.keys(patch).length) return res.json(orderShape(existing));
  // qty_received is the fact and receipts are its only writer. An edit that
  // would contradict it is refused and names the door: a delivery miscounted
  // is corrected with a negative receipt entry and a reason, never by editing
  // the order until the numbers agree.
  const received = Number(existing.qty_received) || 0;
  if (patch.qty !== undefined && Number(patch.qty) > 0 && Number(patch.qty) < received) {
    return res.status(400).json({ error: `${received} already arrived against this order — correct the receipt first, then the quantity.`, use: 'receive' });
  }
  if (patch.status !== undefined && patch.status !== 'received' && existing.status === 'received'
    && received > 0 && Number(existing.qty) > 0 && received >= Number(existing.qty)) {
    return res.status(400).json({ error: 'Everything ordered has arrived. To reopen it, record a negative receipt with the reason — the count decides the status.', use: 'receive' });
  }
  const sets = Object.keys(patch).map(k => `${k} = ?`).join(', ');
  db.prepare(`UPDATE supply_orders SET ${sets}, updated_at = datetime('now') WHERE id = ?`).run(...Object.values(patch), req.params.id);
  // A changed quantity moves the status with it: three of five arrived is
  // 'ordered' however the row read before the edit.
  if (patch.qty !== undefined && patch.status === undefined) {
    const q = Number(patch.qty);
    const st = q > 0 && received >= q ? 'received' : (existing.status === 'received' ? 'ordered' : existing.status);
    if (st !== existing.status) db.prepare('UPDATE supply_orders SET status = ? WHERE id = ?').run(st, req.params.id);
  }

  // Marking the whole order received from the status control has to move the
  // count with it, or the row reads "received" beside "1 of 3 arrived" and
  // neither figure can be trusted. The count is the fact; this keeps the
  // shorthand honest rather than giving it a second answer.
  if (patch.status === 'received') {
    const ordered = Number(existing.qty);
    const target = Number.isFinite(ordered) && ordered > 0 ? ordered : (Number(existing.qty_received) || 0);
    if (target > (Number(existing.qty_received) || 0)) {
      const history = parseJson(existing.receipt_history, []);
      const entries = Array.isArray(history) ? history : [];
      entries.push({ at: new Date().toISOString(), by: req.user.name, qty: +(target - (Number(existing.qty_received) || 0)).toFixed(4), note: 'Marked received in full', total_after: target });
      db.prepare('UPDATE supply_orders SET qty_received = ?, receipt_history = ?, received_at = ?, received_by = ? WHERE id = ?')
        .run(target, JSON.stringify(entries), new Date().toISOString(), req.user.name, req.params.id);
    }
  }

  const updated = db.prepare('SELECT * FROM supply_orders WHERE id = ?').get(req.params.id);
  logAudit(req.user, 'update', 'supply_order', req.params.id, patch, existing, updated, existing.item_name);
  res.json(orderShape(updated));
});

// One-click reorder: clone a past order as a fresh "new" request.
router.post('/supply/orders/:id/reorder', (req, res) => {
  if (!requireSubmit(req, res, 'supply')) return;
  const db = getDb();
  const src = db.prepare('SELECT * FROM supply_orders WHERE id = ?').get(req.params.id);
  if (!src) return res.status(404).json({ error: 'Order not found' });
  const id = uuid();
  const qty = req.body?.qty ?? src.qty;
  db.prepare(`INSERT INTO supply_orders (id, item_name, qty, uom, link, supplier, urgent, label, tags, notes, requested_by, requested_by_id)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, src.item_name, qty, src.uom, src.link, src.supplier, req.body?.urgent ? 1 : 0, src.label, src.tags, req.body?.notes || null, req.user.name, req.user.id);
  const created = db.prepare('SELECT * FROM supply_orders WHERE id = ?').get(id);
  logAudit(req.user, 'create', 'supply_order', id, { reorder_of: src.id, item_name: src.item_name }, null, created, src.item_name);
  res.status(201).json(orderShape(created));
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
  if (q && String(q).trim()) { sql += ' AND (filename LIKE ? OR supplier LIKE ? OR notes LIKE ? OR extracted_text LIKE ?)'; params.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`); }
  sql += ' ORDER BY COALESCE(invoice_date, created_at) DESC LIMIT 500';
  const rows = db.prepare(sql).all(...params);
  const out = await Promise.all(rows.map(async r => ({ ...invoiceShape(r), url: await presignGet(r.storage_key, r.filename).catch(() => null) })));
  res.json(out);
});

// Re-read the figures off a file already on the shelf — the invoices uploaded
// before this existed, and any whose text arrived after the first pass. It
// fills blanks only, so running it over the whole repository can never move a
// figure somebody typed.
router.post('/supply/invoices/:id/read', (req, res) => {
  if (!requireAdmin(req, res)) return;
  const db = getDb();
  const existing = db.prepare('SELECT * FROM supply_invoices WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Invoice not found' });
  if (existing.extracted_text == null) {
    return res.status(409).json({ error: 'The contents of this file have not been read yet. It is indexed in the background after upload.' });
  }
  const figures = applyInvoiceFigures(db, req.params.id, existing.extracted_text);
  const updated = db.prepare('SELECT * FROM supply_invoices WHERE id = ?').get(req.params.id);
  logAudit(req.user, 'update', 'supply_invoice', req.params.id, { read: figures }, existing, updated, existing.filename);
  res.json(invoiceShape(updated));
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
    const typedTotal = req.body.total ? Number(req.body.total) : null;
    db.prepare(`INSERT INTO supply_invoices (id, filename, storage_key, size, content_type, supplier, invoice_date, total, notes, uploaded_by)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, f.originalname, key, f.size, f.mimetype, req.body.supplier || null, req.body.invoice_date || null,
        typedTotal, req.body.notes || null, req.user.name);
    // A total given at upload is a person's answer and is protected from every
    // later read of the file.
    if (typedTotal != null) {
      try { db.prepare("UPDATE supply_invoices SET total_source = 'typed' WHERE id = ?").run(id); } catch { /* older database */ }
    }
    created.push(invoiceShape(db.prepare('SELECT * FROM supply_invoices WHERE id = ?').get(id)));
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
  // Editing the total makes it a typed figure, whatever it was before — a
  // person has now answered, and no later read of the file may move it.
  if (total !== undefined && Number(total) !== Number(existing.total)) {
    try { db.prepare("UPDATE supply_invoices SET total_source = 'typed' WHERE id = ?").run(req.params.id); } catch { /* older database */ }
  }
  const updated = db.prepare('SELECT * FROM supply_invoices WHERE id = ?').get(req.params.id);
  logAudit(req.user, 'update', 'supply_invoice', req.params.id, { total: updated.total }, existing, updated, existing.filename);
  res.json(invoiceShape(updated));
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
  // Matches the account OR the stored spelling, so filtering by somebody's
  // current name still finds the entries filed under their old one.
  if (employee) { sql += ' AND (employee_name = ? OR employee_id = ?)'; params.push(employee, employee); }
  if (from) { sql += ' AND adjustment_date >= ?'; params.push(from); }
  if (to) { sql += ' AND adjustment_date <= ?'; params.push(to); }
  sql += ' ORDER BY adjustment_date DESC, created_at DESC LIMIT 1000';
  res.json(withCurrentNames(db, db.prepare(sql).all(...params)));
});

/**
 * The CURRENT name for a filed adjustment.
 *
 * `time_adjustments.employee_name` is the name as it stood the day the entry
 * was filed, and `employee_id` is the account it was filed against. Only the
 * id is the person: rename somebody in Settings and every entry filed under the
 * old spelling silently becomes a second, separate employee — the 90-day
 * absence rollup counted them as two people with half a history each.
 *
 * So the id wins on read and the stored string is a label, exactly the rule
 * `withLinkedNames` follows on the pay roster. `renamed_from` keeps the old
 * spelling visible, because an entry that suddenly reads under a different name
 * needs to say why.
 */
function withCurrentNames(db, rows) {
  const ids = [...new Set(rows.map(r => r.employee_id).filter(Boolean))];
  if (!ids.length) return rows;
  const names = new Map();
  try {
    for (const u of db.prepare(`SELECT id, name FROM users WHERE id IN (${ids.map(() => '?').join(',')})`).all(...ids)) {
      names.set(u.id, u.name);
    }
  } catch { return rows; }
  return rows.map(r => {
    const current = r.employee_id && names.get(r.employee_id);
    if (!current || current === r.employee_name) return r;
    return { ...r, employee_name: current, renamed_from: r.employee_name };
  });
}

// Per-employee rollup for the admin: absences / tardies in the last 30 and 90
// days, so patterns are visible without counting by hand.
router.get('/time/stats', (req, res) => {
  if (!requireAdmin(req, res)) return;
  const db = getDb();
  // GROUPED ON THE ACCOUNT WHERE THERE IS ONE. Grouping on employee_name split
  // anybody who had been renamed in Settings into two rows with half a history
  // each — which is the opposite of what a pattern rollup is for. The stored
  // name is the fallback for entries filed before ids were recorded.
  const rows = db.prepare(`
    SELECT COALESCE(employee_id, employee_name) AS person_key,
      MAX(employee_id) AS employee_id,
      MAX(employee_name) AS employee_name,
      SUM(CASE WHEN adjustment_date >= date('now','-30 days') THEN 1 ELSE 0 END) AS last_30,
      SUM(CASE WHEN adjustment_date >= date('now','-90 days') THEN 1 ELSE 0 END) AS last_90,
      SUM(CASE WHEN adjustment_type = 'absent' AND adjustment_date >= date('now','-90 days') THEN 1 ELSE 0 END) AS absences_90,
      SUM(CASE WHEN adjustment_type = 'tardy_leave_early' AND adjustment_date >= date('now','-90 days') THEN 1 ELSE 0 END) AS tardies_90,
      MAX(adjustment_date) AS last_event
    FROM time_adjustments GROUP BY person_key HAVING last_90 > 0 ORDER BY last_90 DESC, last_30 DESC
  `).all();
  res.json(withCurrentNames(db, rows));
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
  let rows;
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

/**
 * Who is told a standing list has come due.
 *
 * The office — whoever actually orders. One function, exported, called by the
 * sender AND by the Settings screen that describes it, because a registry with
 * its own copy of the rule is what drifted in D-086. A stored list wins; unset
 * is never nobody.
 */
export function supplyCycleRecipients(db) {
  let ids = null;
  try { ids = JSON.parse(db.prepare("SELECT value FROM app_settings WHERE key = 'supply_cycle_recipients'").get()?.value || 'null'); } catch { ids = null; }
  const all = db.prepare("SELECT id, name, role, department FROM users WHERE is_active = 1 AND name != 'ReadyBot' AND role != 'auditor'").all();
  if (Array.isArray(ids) && ids.length) {
    const chosen = all.filter(u => ids.includes(u.id));
    if (chosen.length) return { users: chosen, source: 'setting' };
  }
  const rule = all.filter(u => u.role === 'admin' || ['office', 'hr', 'admin'].includes(String(u.department || '').toLowerCase()));
  return { users: rule.length ? rule : all.filter(u => u.role === 'admin'), source: 'default' };
}

/**
 * A cycle opening has to REACH somebody. D-105, one release earlier: an ask
 * that lives only on a screen reaches whoever opens that screen, and the whole
 * point of a standing list is that nobody has to remember to open it.
 *
 * Chased every third day while a cycle stands open, on THE CYCLE'S OWN CLOCK
 * (`supply_list_cycles.last_nudge_at`) rather than one global flag — three
 * lists on different days must not share one timer (D-083). Quiet by itself:
 * closing the cycle, either way, is what stops it.
 */
export async function supplyCycleNudge(db) {
  openSupplyCycles(db);
  const open = (() => {
    try {
      return db.prepare(`SELECT c.*, l.name FROM supply_list_cycles c JOIN supply_lists l ON l.id = c.list_id
        WHERE c.closed_at IS NULL AND l.active = 1 AND c.due_date <= date('now')
          AND (c.last_nudge_at IS NULL OR c.last_nudge_at <= datetime('now', '-3 days'))
        ORDER BY c.due_date`).all();
    } catch { return []; }
  })();
  if (!open.length) return { sent: 0, cycles: 0 };

  const t = today();
  const lines = open.map(c => {
    const n = db.prepare('SELECT COUNT(*) n FROM supply_list_items WHERE list_id = ? AND active = 1').get(c.list_id).n;
    const late = cycleAge(c, t);
    return `• *${c.name}* — ${n} item${n === 1 ? '' : 's'}, due ${c.due_date}${late > 0 ? ` (${late} day${late === 1 ? '' : 's'} ago)` : ''}`;
  }).join('\n');
  const body = `🧾 ${open.length === 1 ? 'A standing supply list has' : `${open.length} standing supply lists have`} come due:\n${lines}\n\n`
    + 'Open *Supply Orders → Standing lists*, tick what is actually low and it files the requests. '
    + `"Nothing needed" is one click and is recorded.\n[Open Supply Orders](${readyDocOrigin()}/?tab=supply-orders)`;

  const { users } = supplyCycleRecipients(db);
  let sent = 0;
  for (const u of users) {
    try {
      const { bot, dm } = botDm(db, u.id);
      await postMessageAs(db, dm, bot, body);
      pushToUser(u.id, { title: 'Supply list due', body: open.map(c => c.name).join(', '), tag: 'supply-cycle', url: '/?tab=supply-orders' }).catch(() => {});
      sent += 1;
    } catch { /* one unreachable recipient must not stop the others */ }
  }
  if (sent) {
    const stamp = db.prepare("UPDATE supply_list_cycles SET last_nudge_at = datetime('now') WHERE id = ?");
    for (const c of open) stamp.run(c.id);
  }
  return { sent, cycles: open.length };
}

// ── Standing lists ───────────────────────────────────────────────────────────
// Reading is open to anyone who may submit a request — knowing the break room
// list exists is how somebody stops filing a one-off for paper towels. Editing
// a list, and closing a cycle, is the office's (admin), because that is who
// owns what gets ordered.

router.get('/supply/tags', (req, res) => {
  if (!requireSubmit(req, res, 'supply')) return;
  const db = getDb();
  // Counted from the ORDERS, because the groups in use ARE the orders carrying
  // them — a stored tally is wrong the first time somebody retags a request.
  const counts = new Map();
  for (const r of db.prepare('SELECT label, tags FROM supply_orders').all()) {
    for (const t of (parseJson(r.tags, null) || (r.label ? [r.label] : []))) {
      counts.set(t, (counts.get(t) || 0) + 1);
    }
  }
  const known = knownTags(db);
  // Every suggested group is offered AT ZERO, so a group nobody has ordered
  // against yet is visibly a category rather than an absence; a free group
  // somebody typed is listed after them.
  const rows = known.map(v => ({ value: v, count: counts.get(v) || 0, suggested: true }));
  for (const [v, count] of counts) if (!known.includes(v)) rows.push({ value: v, count, suggested: false });
  res.json(rows);
});

router.get('/supply/lists', (req, res) => {
  if (!requireSubmit(req, res, 'supply')) return;
  const db = getDb();
  // Opened on read as well as on the hourly job: the UNIQUE key makes that
  // free, and it means the first person to open the screen on the 1st sees the
  // cycle rather than waiting for a tick.
  openSupplyCycles(db);
  const rows = db.prepare('SELECT * FROM supply_lists ORDER BY active DESC, name').all();
  res.json(rows.map(r => listShape(db, r)));
});

router.post('/supply/lists', (req, res) => {
  if (!requireAdmin(req, res)) return;
  const db = getDb();
  const name = String(req.body?.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Give the list a name.' });
  const cadence = CADENCES.includes(req.body?.cadence) ? req.body.cadence : 'monthly';
  const id = uuid();
  db.prepare(`INSERT INTO supply_lists (id, name, cadence, day, tags, notes, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(id, name, cadence, Number(req.body?.day) || 1,
      JSON.stringify(normalizeTags(req.body?.tags, knownTags(db))), req.body?.notes || null, req.user.name);
  const created = db.prepare('SELECT * FROM supply_lists WHERE id = ?').get(id);
  logAudit(req.user, 'create', 'supply_list', id, { name, cadence }, null, created, name);
  res.status(201).json(listShape(db, created));
});

router.put('/supply/lists/:id', (req, res) => {
  if (!requireAdmin(req, res)) return;
  const db = getDb();
  const existing = db.prepare('SELECT * FROM supply_lists WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'List not found' });
  const patch = {};
  if (req.body.name !== undefined) patch.name = String(req.body.name).trim() || existing.name;
  if (req.body.cadence !== undefined && CADENCES.includes(req.body.cadence)) patch.cadence = req.body.cadence;
  if (req.body.day !== undefined) patch.day = Number(req.body.day) || 1;
  if (req.body.notes !== undefined) patch.notes = req.body.notes || null;
  if (req.body.active !== undefined) patch.active = req.body.active ? 1 : 0;
  if (req.body.tags !== undefined) patch.tags = JSON.stringify(normalizeTags(req.body.tags, knownTags(db)));
  if (!Object.keys(patch).length) return res.json(listShape(db, existing));
  db.prepare(`UPDATE supply_lists SET ${Object.keys(patch).map(k => `${k} = ?`).join(', ')}, updated_at = datetime('now') WHERE id = ?`)
    .run(...Object.values(patch), req.params.id);
  const updated = db.prepare('SELECT * FROM supply_lists WHERE id = ?').get(req.params.id);
  logAudit(req.user, 'update', 'supply_list', req.params.id, patch, existing, updated, existing.name);
  res.json(listShape(db, updated));
});

router.post('/supply/lists/:id/items', (req, res) => {
  if (!requireAdmin(req, res)) return;
  const db = getDb();
  const list = db.prepare('SELECT * FROM supply_lists WHERE id = ?').get(req.params.id);
  if (!list) return res.status(404).json({ error: 'List not found' });
  const item_name = String(req.body?.item_name || '').trim();
  if (!item_name) return res.status(400).json({ error: 'Item name is required' });
  const id = uuid();
  const next = db.prepare('SELECT COALESCE(MAX(sort), 0) + 1 AS n FROM supply_list_items WHERE list_id = ?').get(req.params.id).n;
  db.prepare(`INSERT INTO supply_list_items (id, list_id, item_name, qty, uom, supplier, link, notes, sort)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, req.params.id, item_name, req.body?.qty ?? null, req.body?.uom || null,
      req.body?.supplier || null, req.body?.link || null, req.body?.notes || null, next);
  logAudit(req.user, 'update', 'supply_list', req.params.id, { added: item_name }, null, null, list.name);
  res.status(201).json(listShape(db, list));
});

/**
 * Correct an item that is already on a list.
 *
 * THE LIST IS FILLED IN ONCE AND LIVED WITH, so almost every change to it is a
 * correction to a row that already exists — a link found later, a supplier that
 * moved, a quantity that was always wrong. Without this the only way to attach
 * one was to retire the item and add it back, which is not the same act: the
 * retired row is what last month's cycle ordered against, and the new one is a
 * different item with the same name. A correction must not cost the history.
 *
 * An absent field means LEAVE IT ALONE, never "clear it" — the `body.x ??
 * existing.x` rule every other editable record here follows, so a screen that
 * only sends the link cannot blank the supplier.
 */
router.put('/supply/lists/:id/items/:itemId', (req, res) => {
  if (!requireAdmin(req, res)) return;
  const db = getDb();
  const list = db.prepare('SELECT * FROM supply_lists WHERE id = ?').get(req.params.id);
  if (!list) return res.status(404).json({ error: 'List not found' });
  const item = db.prepare('SELECT * FROM supply_list_items WHERE id = ? AND list_id = ?')
    .get(req.params.itemId, req.params.id);
  if (!item) return res.status(404).json({ error: 'Item not found' });

  const patch = {};
  if (req.body.item_name !== undefined) {
    const name = String(req.body.item_name).trim();
    // The name is what the order is filed under, so an empty one is refused
    // rather than quietly kept — a silent no-op reads as the save failing.
    if (!name) return res.status(400).json({ error: 'Item name is required' });
    patch.item_name = name;
  }
  // A blank on any of these is a real answer: it is how somebody CLEARS a link
  // or a supplier they typed by mistake. Only `undefined` means "not sent".
  if (req.body.qty !== undefined) patch.qty = req.body.qty === '' || req.body.qty === null ? null : Number(req.body.qty);
  for (const k of ['uom', 'supplier', 'link', 'notes']) {
    if (req.body[k] !== undefined) patch[k] = String(req.body[k] ?? '').trim() || null;
  }
  if (!Object.keys(patch).length) return res.json(listShape(db, list));
  if (patch.qty !== undefined && !Number.isFinite(patch.qty) && patch.qty !== null) {
    return res.status(400).json({ error: 'Quantity has to be a number.' });
  }

  db.prepare(`UPDATE supply_list_items SET ${Object.keys(patch).map(k => `${k} = ?`).join(', ')} WHERE id = ?`)
    .run(...Object.values(patch), req.params.itemId);
  const updated = db.prepare('SELECT * FROM supply_list_items WHERE id = ?').get(req.params.itemId);
  logAudit(req.user, 'update', 'supply_list', req.params.id,
    { item: updated.item_name, changed: Object.keys(patch) }, item, updated, list.name);
  res.json(listShape(db, list));
});

// RETIRED, NOT DELETED. A cycle filed last month recorded what it ordered
// against the list as it stood; removing the row outright would leave that
// history pointing at nothing.
router.delete('/supply/lists/:id/items/:itemId', (req, res) => {
  if (!requireAdmin(req, res)) return;
  const db = getDb();
  const list = db.prepare('SELECT * FROM supply_lists WHERE id = ?').get(req.params.id);
  if (!list) return res.status(404).json({ error: 'List not found' });
  const item = db.prepare('SELECT * FROM supply_list_items WHERE id = ? AND list_id = ?').get(req.params.itemId, req.params.id);
  if (!item) return res.status(404).json({ error: 'Item not found' });
  db.prepare('UPDATE supply_list_items SET active = 0 WHERE id = ?').run(req.params.itemId);
  logAudit(req.user, 'update', 'supply_list', req.params.id, { removed: item.item_name }, item, null, list.name);
  res.json(listShape(db, list));
});

/**
 * Close a cycle. THIS is what files real requests.
 *
 * Nothing is ordered until somebody says which items and how many, and
 * "nothing needed this month" is a one-click ANSWER rather than an absence —
 * a cycle deliberately skipped and one nobody opened are different facts, and
 * only the first of them is fine.
 */
router.post('/supply/cycles/:id/close', (req, res) => {
  if (!requireAdmin(req, res)) return;
  const db = getDb();
  const cycle = db.prepare('SELECT * FROM supply_list_cycles WHERE id = ?').get(req.params.id);
  if (!cycle) return res.status(404).json({ error: 'Cycle not found' });
  if (cycle.closed_at) return res.status(400).json({ error: 'That cycle is already closed.' });
  const list = db.prepare('SELECT * FROM supply_lists WHERE id = ?').get(cycle.list_id);
  const picks = Array.isArray(req.body?.items) ? req.body.items : [];
  const note = String(req.body?.note || '').trim() || null;
  if (!picks.length && !req.body?.nothing_needed) {
    return res.status(400).json({ error: 'Pick what needs ordering, or say nothing is needed this month.' });
  }

  const tags = parseJson(list?.tags, []) || [];
  const tagJson = tags.length ? JSON.stringify(tags) : null;
  const ins = db.prepare(`INSERT INTO supply_orders
    (id, item_name, qty, uom, link, supplier, urgent, label, tags, notes, requested_by, requested_by_id, list_cycle_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const created = [];
  db.transaction(() => {
    for (const p of picks) {
      const item = db.prepare('SELECT * FROM supply_list_items WHERE id = ? AND list_id = ?').get(p?.item_id, cycle.list_id);
      if (!item) continue;  // an item retired while the screen was open
      const id = uuid();
      ins.run(id, item.item_name, p.qty ?? item.qty ?? null, item.uom, item.link, item.supplier,
        p.urgent ? 1 : 0, tags[0] || null, tagJson,
        // The cycle is named on the request, so "why did we order this" has an
        // answer on the row rather than in somebody's head.
        [item.notes, `${list.name} — ${cycle.period}`].filter(Boolean).join(' · '),
        req.user.name, req.user.id, cycle.id);
      created.push(id);
    }
    db.prepare(`UPDATE supply_list_cycles SET closed_at = datetime('now'), closed_by = ?, outcome = ?,
      note = ?, orders_created = ? WHERE id = ?`)
      .run(req.user.name, created.length ? 'ordered' : 'nothing_needed', note, created.length, cycle.id);
  })();
  const closed = db.prepare('SELECT * FROM supply_list_cycles WHERE id = ?').get(cycle.id);
  logAudit(req.user, 'update', 'supply_list_cycle', cycle.id,
    { list: list?.name, period: cycle.period, outcome: closed.outcome, orders: created.length }, cycle, closed, list?.name);
  res.json({ cycle: closed, created: created.length, list: listShape(db, list) });
});

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
      let d;
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

/**
 * Everyone whose hours are recorded for a pay period.
 *
 * TWO SOURCES, ONE LIST, AND THAT IS THE WHOLE DESIGN DECISION. Employees are
 * `users` — the accounts. Temporary and agency workers are the CONTRACTOR rows
 * of the pay roster, because a temp who never signs in is not an account: give
 * one a `users` row and they appear in the @mention list, the assignee picker,
 * Team Activity and the comms member list, none of which anybody wanted.
 *
 * They are read here rather than kept in a second list of their own, so a temp
 * is added ONCE, in Pay Tracking, and shows up in both places. A second roster
 * is how the two modules start disagreeing about who was working.
 *
 * A contractor carries NO weekly target: the hours are whatever the agency
 * invoices, so paid-but-not-worked has nothing to balance up to. `target: null`
 * is what the hours maths reads to skip that, and it is deliberately distinct
 * from a target of zero.
 */
function contractorRoster(db) {
  try {
    return db.prepare(`SELECT id, name, team AS department, contractor_company, ends_on
      FROM pay_employees
      WHERE active = 1 AND COALESCE(worker_type, 'employee') = 'contractor'`).all()
      .map(c => ({ ...c, target: null, is_contractor: true }));
  } catch { return []; }  // Pay Tracking may not exist on every deployment.
}

function roster(db) {
  // A GUEST CLIENT IS NOT ON THE PAYROLL, and that is derived rather than
  // ticked. Five of the fourteen names on this list were M4 accounts —
  // `users.is_external` already says they do not work here, so asking the
  // office to exclude each one by hand would be making them re-state a fact
  // the app holds. The same reasoning that keeps admins and auditors off it.
  return db.prepare(`SELECT id, name, department, weekly_hours_target FROM users
    WHERE is_active = 1 AND name != 'ReadyBot' AND role NOT IN ('auditor', 'admin')
      AND COALESCE(is_external, 0) = 0`).all()
    .map(u => ({ ...u, target: u.weekly_hours_target || STANDARD_WEEK_HOURS }))
    // Full name breaks ties, so two people who share a surname stay in a
    // stable, predictable order rather than whatever the table returns.
    .sort((a, b) => byName.compare(lastNameOf(a.name), lastNameOf(b.name))
      || byName.compare(a.name || '', b.name || ''));
}

/**
 * Who has been taken off the Hours list by hand, keyed on the row's own id —
 * a `users.id` for an employee, a `pay_employees.id` for a contractor.
 *
 * ONE READER, so the grid, the totals and the "excluded" strip can never
 * disagree about who is on the list. Returns a Map so the caller can both
 * filter and report; a missing table answers empty rather than throwing,
 * the same way the contractor roster does.
 */
/**
 * What each person on the Hours list is paid, READ FROM PAY TRACKING.
 *
 * THE RATE IS NEVER COPIED ONTO AN HOURS ROW. `pay_employees.pay_rate` is the
 * one owner of what somebody is paid — it has a change history behind it and
 * an admin applies increases against it — so this reads it at request time and
 * stores nothing. A rate mirrored onto `employee_hours` is how this tab and
 * Pay Tracking start disagreeing about what an hour cost, and the hours rows
 * would then have to be rewritten every time somebody got a raise.
 *
 * KEYED ON THE ACCOUNT, NOT THE NAME. `pay_employees.user_id` is the link Pay
 * Tracking already maintains (the seeder matches by name ONCE, the Roster tab
 * reconciles the rest deliberately). Matching on the name string here would be
 * a SECOND matcher that could quietly disagree with the first — the same
 * reasoning that makes the link the identity and the stored name a label. A
 * roster row nobody has linked yet therefore has no rate here, and says so,
 * which routes the office to the Roster tab rather than to a guess.
 *
 * A CONTRACTOR'S row id IS a `pay_employees.id`, so their rate is direct.
 *
 * Returns a Map of row id to `{ rate }`. Present-with-a-null-rate and absent
 * are DIFFERENT answers: the first is somebody salaried (which is what a blank
 * rate means on the Pay Tracking roster), the second is a person no pay row
 * has been linked to at all. Collapsing them would hide the second.
 */
function rateRoster(db) {
  try {
    const out = new Map();
    for (const r of db.prepare('SELECT id, user_id, pay_rate FROM pay_employees WHERE active = 1').all()) {
      out.set(r.id, { rate: r.pay_rate });
      if (r.user_id) out.set(r.user_id, { rate: r.pay_rate });
    }
    return out;
  } catch { return new Map(); }
}

// Overtime is paid at time and a half, so the PREMIUM on an overtime hour is
// half the rate — the hour itself is already inside `worked`, and therefore
// already inside the paid-hours total, so counting it at 1.5x here would pay
// for it twice.
const OT_MULTIPLIER = 1.5;
const money = (n) => Math.round(n * 100) / 100;

/**
 * What a week of hours cost, at this person's rate.
 *
 * DERIVED FROM THE FIGURES THE GRID ALREADY SHOWS, and that is the whole of
 * the design. The cost is `total` (what we pay for: worked + PTO + holiday +
 * paid non-working, never unpaid) at the rate, plus the premium on the SAME
 * `overtime` figure printed in the column above it. A cost computed from a
 * second, subtly different reading of the hours is a number that disagrees
 * with the hours it sits beside, and whoever is looking cannot tell which of
 * the two is wrong — the activity-metrics rule, applied to money.
 *
 * Note what that inherits: `overtime` here is hours over THIS PERSON'S weekly
 * target, which is 40 for everybody unless the office set otherwise, and is
 * not the same statement as the statutory over-40 week. The screen says so
 * whenever somebody on the list carries a different target; inventing a second
 * overtime definition down here, visible only in the money, would be worse.
 *
 * No rate means no cost — null, never zero. A zero would state that the hours
 * were free, when the truth is that nobody has said what they cost.
 */
function weekCost(rate, week) {
  if (rate == null) return { straight_cost: null, ot_premium: null, cost: null };
  const straight = money(week.total * rate);
  const premium = money(week.overtime * rate * (OT_MULTIPLIER - 1));
  return { straight_cost: straight, ot_premium: premium, cost: money(straight + premium) };
}

function hoursExclusions(db) {
  try {
    return new Map(db.prepare('SELECT * FROM hours_exclusions').all().map(r => [r.row_id, r]));
  } catch { return new Map(); }
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

  // Excluded people leave the grid AND the totals — a figure that still counts
  // somebody the list does not show is the disagreement this whole codebase
  // keeps unpicking. They are reported separately so the decision stays
  // visible and reversible, rather than a name that silently vanished.
  const excluded = hoursExclusions(db);
  const rates = rateRoster(db);
  const all = [...roster(db), ...contractorRoster(db)];
  const people = all.filter(u => !excluded.has(u.id)).map(u => {
    const pay = rates.get(u.id);
    const rate = pay ? pay.rate : null;
    const weekRows = weeks.map(w => {
      const r = byUser[u.id]?.[w];
      const worked = r?.worked || 0, pto = r?.pto || 0, holiday = r?.holiday || 0, unpaid = r?.unpaid || 0;
      const autoFill = r ? !!r.auto_fill : true;
      // Paid-but-not-worked: the balance up to target, only once there's an
      // entry — an untouched week shouldn't invent 40 hours of anything.
      // No target (a contractor) means nothing to balance up to: their paid
      // hours are the hours worked, and there is no overtime line to compute.
      const nonWorking = (r && autoFill && u.target != null)
        ? Math.max(0, u.target - worked - pto - holiday - unpaid) : 0;
      return {
        week_start: w, worked, pto, holiday, unpaid, auto_fill: autoFill,
        has_entry: !!r, note: r?.note || null,
        non_working: Math.round(nonWorking * 100) / 100,
        overtime: u.target == null ? 0 : Math.round(Math.max(0, worked - u.target) * 100) / 100,
        total: Math.round((worked + pto + holiday + nonWorking) * 100) / 100,
      };
    }).map(w => ({ ...w, ...weekCost(rate, w) }));
    const sum = (k) => Math.round(weekRows.reduce((n, w) => n + w[k], 0) * 100) / 100;
    const cash = (k) => (rate == null ? null : money(weekRows.reduce((n, w) => n + w[k], 0)));
    return {
      user_id: u.id, name: u.name, department: u.department, target: u.target,
      is_contractor: !!u.is_contractor, contractor_company: u.contractor_company || null,
      ends_on: u.ends_on || null,
      // `rate` is what they are paid; `rate_linked` says whether a Pay Tracking
      // row was found at all. A linked row with a blank rate is somebody
      // salaried; no row is somebody nobody has linked yet, and those two gaps
      // are closed in different places.
      rate, rate_linked: !!pay,
      weeks: weekRows,
      period: { worked: sum('worked'), pto: sum('pto'), holiday: sum('holiday'), unpaid: sum('unpaid'),
        non_working: sum('non_working'), overtime: sum('overtime'), total: sum('total'),
        straight_cost: cash('straight_cost'), ot_premium: cash('ot_premium'), cost: cash('cost') },
    };
  });

  // TOTALLED BY WORKER TYPE, NOT ONLY COMBINED.
  //
  // An employee's period and a contractor's are two different payroll jobs. One
  // goes to ADP against a weekly target, with a PTO balance, a paid-non-working
  // balance and an overtime line; the other is hours worked on somebody's
  // invoice, with no target and therefore no overtime and no balance at all. A
  // single figure covering both answers neither question — and it reads as the
  // employee number, because for most periods the employees are most of it.
  //
  // Derived from `people`, the same rows the grid renders, so a card and the
  // column under it cannot disagree — the activity-metrics rule. The combined
  // `totals` is kept and is the sum of the two, which the test asserts.
  //
  // THE COST TOTAL COVERS ONLY THE PEOPLE WHO HAVE A RATE, and says how many
  // it does not cover. Treating a missing rate as zero would quietly report a
  // period as cheaper than it was, and a labour figure that understates is one
  // somebody acts on. `people_rated` / `people_unrated` are what make the
  // figure interpretable: a cost over 22 of 25 people is a useful number as
  // long as the screen says it is 22 of 25.
  const KEYS = ['worked', 'pto', 'holiday', 'unpaid', 'non_working', 'overtime', 'total'];
  const CASH_KEYS = ['straight_cost', 'ot_premium', 'cost'];
  const sumOf = (list) => {
    const acc = {};
    for (const k of KEYS) acc[k] = Math.round(list.reduce((n, p) => n + p.period[k], 0) * 100) / 100;
    const rated = list.filter(p => p.rate != null);
    for (const k of CASH_KEYS) acc[k] = money(rated.reduce((n, p) => n + p.period[k], 0));
    acc.people = list.length;
    acc.people_rated = rated.length;
    acc.people_unrated = list.length - rated.length;
    return acc;
  };
  const employeeRows = people.filter(p => !p.is_contractor);
  const contractorRows = people.filter(p => p.is_contractor);
  const totals = sumOf(people);
  const totals_by_type = { employee: sumOf(employeeRows), contractor: sumOf(contractorRows) };

  // Named from the roster where they are still on it, from the stored name
  // otherwise — somebody excluded and since deactivated must still be
  // explainable, and a row reading only an id explains nothing.
  const byId = new Map(all.map(u => [u.id, u]));
  const excludedRows = [...excluded.values()].map(e => ({
    ...e, name: byId.get(e.row_id)?.name || e.name || 'Unknown',
    still_on_roster: byId.has(e.row_id),
  })).sort((a, b) => String(a.name).localeCompare(String(b.name)));

  // `standard_week` is shipped so the screen can say when somebody's overtime
  // is being measured against a target that is NOT the ordinary 40-hour week —
  // which is what makes the premium in the cost column interpretable. Quiet
  // when every target is 40, which is the usual case.
  res.json({ period_start: periodStart, weeks, people, totals, totals_by_type,
    standard_week: STANDARD_WEEK_HOURS, ot_multiplier: OT_MULTIPLIER, excluded: excludedRows });
});

/**
 * Take somebody off the Hours list, or put them back.
 *
 * NOT A DELETE AND NOT A DEACTIVATION. Their `employee_hours` rows stay
 * exactly as filed — what we paid somebody is a payroll record — and their
 * account is untouched, which is what makes this safe to use on a person who
 * very much still works here and simply is not tracked this way.
 *
 * A REASON IS REQUIRED. A name that disappears off a payroll list with
 * nothing saying why is the sort of gap somebody finds in March and cannot
 * resolve; three words and a name make it answerable from the record.
 */
router.post('/hours/exclude', (req, res) => {
  if (!requireAdmin(req, res)) return;
  const db = getDb();
  const rowId = String(req.body?.row_id || '').trim();
  const reason = String(req.body?.reason || '').trim();
  if (!rowId) return res.status(400).json({ error: 'row_id is required' });
  if (reason.length < 3) return res.status(400).json({ error: 'Say why they are not tracked here — it is what makes their absence explainable later.' });

  const person = [...roster(db), ...contractorRoster(db)].find(u => u.id === rowId);
  if (!person) return res.status(404).json({ error: 'That person is not on the hours list.' });

  db.prepare(`INSERT INTO hours_exclusions (row_id, kind, name, reason, excluded_by)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(row_id) DO UPDATE SET reason = excluded.reason, excluded_by = excluded.excluded_by,
      excluded_at = datetime('now')`)
    .run(rowId, person.is_contractor ? 'contractor' : 'employee', person.name, reason, req.user.name);
  logAudit(req.user, 'update', 'hours_exclusion', rowId, { excluded: true, reason }, null, null, person.name);
  res.json({ ok: true, row_id: rowId, name: person.name, reason });
});

router.delete('/hours/exclude/:rowId', (req, res) => {
  if (!requireAdmin(req, res)) return;
  const db = getDb();
  const row = db.prepare('SELECT * FROM hours_exclusions WHERE row_id = ?').get(req.params.rowId);
  if (!row) return res.status(404).json({ error: 'Not excluded.' });
  db.prepare('DELETE FROM hours_exclusions WHERE row_id = ?').run(req.params.rowId);
  logAudit(req.user, 'update', 'hours_exclusion', req.params.rowId, { excluded: false, was: row.reason }, null, null, row.name);
  res.json({ ok: true });
});

router.put('/hours', (req, res) => {
  if (!requireAdmin(req, res)) return;
  const db = getDb();
  const { user_id, week_start } = req.body || {};
  if (!user_id || !/^\d{4}-\d{2}-\d{2}$/.test(week_start || '')) {
    return res.status(400).json({ error: 'user_id and week_start are required' });
  }
  // A contractor's id is a pay_employees id, not a users id — the hours row
  // keys on whichever it is, and nothing else in this table cares which.
  const person = db.prepare('SELECT id, name FROM users WHERE id = ?').get(user_id)
    || (() => { try {
      return db.prepare("SELECT id, name FROM pay_employees WHERE id = ? AND COALESCE(worker_type,'employee') = 'contractor'").get(user_id);
    } catch { return null; } })();
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
