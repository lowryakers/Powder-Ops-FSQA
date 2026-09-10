// AP Drop — one place to hand in a finance PDF, and the queue it waits in.
//
// Any signed-in person can DROP (a vendor invoice somebody emailed them, a
// credit memo, a remittance, an M4 invoice pack); the office WORKS the queue.
// The email box ap@powder-ops.com is the parallel front door and this is its
// in-app twin — same row, same statuses, `source` says which door.
//
// Three rules that shape it:
//
//  * THE FILE IS THE RECORD. It is stored first, hashed, and the row exists
//    before any reading of it is attempted. A parse that fails still leaves a
//    row in the queue reading "failed" — an upload that bounced because the
//    PDF was a scan is exactly the invoice that goes missing.
//  * THE PARSER SUGGESTS. `ap-drop-parse.js` is pure; what it read lands in
//    the editable fields WITH the line each value came from (`parsed_json`),
//    and the office corrects it on the detail pane. A blank is never filled
//    with a guess.
//  * NOTHING LEAVES READYDOC. No QuickBooks bill, no email, no payment. The
//    Controller's tooling polls the audit log (`ap_drop` / `create`) and
//    writes `qbo_bill_id` / `external_ref` back when it has linked one.
//
// Access: mounted WITHOUT requireModuleWrite, the QMS-filing arrangement,
// because uploading has to be open to whoever is holding the invoice. Reading
// the whole queue and moving a row past `new` is the office's — admins, the
// `ap-drop` edit grant (the finance flag), or an office/admin supervisor, the
// reimbursements `canSettle` shape. Everyone else sees their own drops.
import { Router } from 'express';
import multer from 'multer';
import { createHash } from 'crypto';
import { v4 as uuid } from 'uuid';
import { getDb, logAudit } from '../db.js';
import { storageEnabled, putObject, presignGet } from '../storage.js';
import { extractInvoiceText } from '../invoice-text.js';
import { parseFinanceDocument } from '../ap-drop-parse.js';
import { moduleLevel } from '../module-access.js';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024, files: 10 } });

export const STATUSES = ['new', 'triaged', 'matched', 'in_qbo', 'in_payment_run', 'paid', 'closed', 'needs_info', 'duplicate_suspect', 'not_finance'];
export const TERMINAL = new Set(['paid', 'closed', 'not_finance']);
// A status that takes the row out of the ordinary flow has to say why.
const NEEDS_REASON = new Set(['needs_info', 'not_finance', 'duplicate_suspect']);
const EDITABLE = ['vendor_name', 'invoice_number', 'invoice_date', 'due_date', 'amount', 'currency', 'po_or_co_ref', 'bill_to', 'notes', 'qbo_bill_id', 'payment_run_id', 'external_ref'];
const DUPLICATE_WINDOW_DAYS = 30;
// How long the upload waits on the reader before answering. The row is already
// written; a slow OCR finishes in the background and updates it.
const PARSE_WAIT_MS = 15000;

export const canWorkQueue = (u) => u?.role === 'admin'
  || moduleLevel(u, 'ap-drop') === 'edit'
  || (u?.role === 'supervisor' && ['office', 'admin'].includes((u?.department || '').toLowerCase()));

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
const today = () => new Date().toISOString().slice(0, 10);
const daysBetween = (a, b) => Math.floor((Date.parse(b) - Date.parse(a)) / 86400000);
const num = (v) => { if (v === '' || v == null) return null; const n = Number(String(v).replace(/[$,\s]/g, '')); return Number.isFinite(n) ? n : null; };
const isoDate = (v) => (v && /^\d{4}-\d{2}-\d{2}/.test(String(v)) ? String(v).slice(0, 10) : null);

function event(db, dropId, user, kind, detail) {
  db.prepare('INSERT INTO ap_drop_events (id, drop_id, by_user_id, by_name, kind, detail) VALUES (?, ?, ?, ?, ?, ?)')
    .run(uuid(), dropId, user?.id || null, user?.name || 'system', kind, detail ? JSON.stringify(detail) : null);
}

// What the client gets. Age and overdue are DERIVED on every read — a stored
// age is wrong by tomorrow. `extracted_text` never leaves the server.
function shape(r, user) {
  if (!r) return null;
  const { extracted_text, parsed_json, ...rest } = r;
  const parsed = (() => { try { return parsed_json ? JSON.parse(parsed_json) : null; } catch { return null; } })();
  const t = today();
  const open = !TERMINAL.has(r.status);
  return {
    ...rest,
    parsed,
    age_days: daysBetween(r.created_at.slice(0, 10), t),
    overdue: open && !!r.due_date && r.due_date < t,
    outstanding: open,
    searchable: !!(extracted_text && extracted_text.trim()),
    can_work: canWorkQueue(user),
    is_mine: !!user && (r.created_by_user_id === user.id),
  };
}

function loadDrop(db, id) {
  return db.prepare('SELECT * FROM ap_drops WHERE id = ?').get(id);
}

// Apply what the reader found to a row that still has those fields BLANK. A
// value somebody has typed is never overwritten by a re-read — the same rule
// the supply-invoice total follows (`total_source`).
function applyParse(db, id, parsed) {
  const row = loadDrop(db, id);
  if (!row) return;
  const f = parsed.fields || {};
  const set = [];
  const params = [];
  const put = (col, v) => { if (v != null && v !== '' && (row[col] == null || row[col] === '')) { set.push(`${col} = ?`); params.push(v); } };
  put('vendor_name', f.vendor);
  put('invoice_number', f.invoice_number);
  put('invoice_date', f.invoice_date);
  put('due_date', f.due_date);
  put('amount', f.total);
  put('currency', f.currency);
  put('po_or_co_ref', f.order_refs?.length ? f.order_refs.join(', ') : null);
  put('bill_to', f.bill_to);
  set.push('parse_status = ?', 'parsed_json = ?', "updated_at = datetime('now')");
  params.push(parsed.status, JSON.stringify(parsed), id);
  db.prepare(`UPDATE ap_drops SET ${set.join(', ')} WHERE id = ?`).run(...params);
}

async function readAndApply(id, buffer, contentType, filename) {
  const db = getDb();
  let text = '';
  try { text = await extractInvoiceText(buffer, contentType, filename); } catch { text = ''; }
  const parsed = parseFinanceDocument(text);
  const tx = db.transaction(() => {
    db.prepare('UPDATE ap_drops SET extracted_text = ? WHERE id = ?').run(text || '', id);
    applyParse(db, id, parsed);
    event(db, id, null, 'parsed', { status: parsed.status, fields_read: Object.entries(parsed.fields || {}).filter(([, v]) => v != null && v !== '' && !(Array.isArray(v) && !v.length)).map(([k]) => k), reason: parsed.reason });
  });
  tx();
  return parsed;
}

// ── Drop ────────────────────────────────────────────────────────────────────

router.post('/', upload.array('files', 10), async (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Sign in to drop a file.' });
  if (!storageEnabled()) return res.status(503).json({ error: 'File storage is not configured on this server, so nothing can be dropped yet.' });
  const files = req.files || [];
  if (!files.length) return res.status(400).json({ error: 'Nothing was attached. Drop a PDF or photograph of the document.' });
  const db = getDb();
  const b = req.body || {};
  const created = [];
  for (const f of files) {
    const id = uuid();
    const hash = sha256(f.buffer);
    const key = `ap-drop/${id}-${(f.originalname || 'file').replace(/[^\w.-]+/g, '_')}`;
    await putObject(key, f.buffer, f.mimetype);
    // The same bytes handed in twice within the window is almost always the
    // same invoice forwarded by two people. It is still filed — silently
    // dropping it would lose the second submitter's note — but flagged and
    // linked to the first, so the queue shows one bill, not two.
    const prior = db.prepare(`SELECT id FROM ap_drops WHERE content_sha256 = ? AND created_at >= datetime('now', ?) ORDER BY created_at ASC LIMIT 1`)
      .get(hash, `-${DUPLICATE_WINDOW_DAYS} day`);
    const status = prior ? 'duplicate_suspect' : 'new';
    db.transaction(() => {
      db.prepare(`INSERT INTO ap_drops (id, created_by_user_id, submitter, source, filename, storage_key, size, content_type, content_sha256,
          vendor_name, po_or_co_ref, amount, due_date, notes, status, status_reason, duplicate_of)
        VALUES (?, ?, ?, 'drop', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(id, req.user.id, String(b.submitter || req.user.name).slice(0, 120), f.originalname || 'file', key, f.size, f.mimetype, hash,
          String(b.vendor_name || '').trim() || null, String(b.po_or_co_ref || '').trim() || null, num(b.amount), isoDate(b.due_date),
          String(b.notes || '').trim() || null, status, prior ? `Same file was dropped on an earlier row (${prior.id.slice(0, 8)})` : null, prior?.id || null);
      event(db, id, req.user, 'uploaded', { filename: f.originalname, size: f.size, duplicate_of: prior?.id || null });
      if (prior) event(db, prior.id, req.user, 'duplicate_dropped', { again_as: id });
    })();
    // `event: 'ap_drop.created'` is what outside automation polls the audit
    // log for; the canonical action is `create` on entity `ap_drop`.
    logAudit(req.user, 'ap_drop_created', 'ap_drop', id,
      { event: 'ap_drop.created', filename: f.originalname, size: f.size, sha256: hash, status, duplicate_of: prior?.id || null },
      null, null, f.originalname);

    // The reader runs now but the upload does not wait on it forever: a scan
    // through vision OCR can take a while, and the row is already filed.
    const reading = readAndApply(id, f.buffer, f.mimetype, f.originalname).catch(err => {
      console.warn('[ap-drop] parse failed:', err.message);
      try { getDb().prepare("UPDATE ap_drops SET parse_status = 'failed', updated_at = datetime('now') WHERE id = ? AND parse_status = 'pending'").run(id); } catch { /* ignore */ }
    });
    await Promise.race([reading, new Promise(r => setTimeout(r, PARSE_WAIT_MS))]);
    created.push(shape(loadDrop(db, id), req.user));
  }
  res.status(201).json({ drops: created });
});

// ── Queue ────────────────────────────────────────────────────────────────────

router.get('/meta', (req, res) => {
  const db = getDb();
  const work = canWorkQueue(req.user);
  const scope = work ? '' : ' WHERE created_by_user_id = ?';
  const p = work ? [] : [req.user?.id || ''];
  const vendors = db.prepare(`SELECT DISTINCT vendor_name FROM ap_drops${scope ? scope + ' AND' : ' WHERE'} vendor_name IS NOT NULL ORDER BY vendor_name`).all(...p).map(r => r.vendor_name);
  const submitters = db.prepare(`SELECT DISTINCT submitter FROM ap_drops${scope ? scope + ' AND' : ' WHERE'} submitter IS NOT NULL ORDER BY submitter`).all(...p).map(r => r.submitter);
  const counts = {};
  for (const r of db.prepare(`SELECT status, COUNT(*) n FROM ap_drops${scope} GROUP BY status`).all(...p)) counts[r.status] = r.n;
  res.json({ statuses: STATUSES, terminal: [...TERMINAL], vendors, submitters, counts, can_work: work, storage_enabled: storageEnabled(), inbox_email: 'ap@powder-ops.com' });
});

router.get('/', (req, res) => {
  const db = getDb();
  const q = req.query || {};
  const work = canWorkQueue(req.user);
  let sql = 'SELECT * FROM ap_drops WHERE 1=1';
  const params = [];
  if (!work) { sql += ' AND created_by_user_id = ?'; params.push(req.user?.id || ''); }
  // `outstanding` is the default landing: everything not paid, closed or
  // rejected. `all` lifts it; a named status narrows to exactly that.
  if (q.status && q.status !== 'all' && q.status !== 'outstanding') { sql += ' AND status = ?'; params.push(q.status); }
  else if (q.status !== 'all') { sql += ` AND status NOT IN (${[...TERMINAL].map(() => '?').join(',')})`; params.push(...TERMINAL); }
  if (q.vendor) { sql += ' AND vendor_name = ?'; params.push(q.vendor); }
  if (q.submitter) { sql += ' AND submitter = ?'; params.push(q.submitter); }
  if (q.from) { sql += ' AND created_at >= ?'; params.push(q.from); }
  if (q.to) { sql += ' AND created_at < date(?, \'+1 day\')'; params.push(q.to); }
  if (q.overdue === '1' || q.overdue === 'true') { sql += ' AND due_date IS NOT NULL AND due_date < ?'; params.push(today()); }
  if (q.needs_info === '1' || q.needs_info === 'true') sql += " AND status = 'needs_info'";
  if (q.q && String(q.q).trim()) {
    sql += ` AND (LOWER(COALESCE(vendor_name,'')) LIKE LOWER(?) OR LOWER(COALESCE(invoice_number,'')) LIKE LOWER(?)
      OR LOWER(COALESCE(po_or_co_ref,'')) LIKE LOWER(?) OR LOWER(COALESCE(notes,'')) LIKE LOWER(?) OR LOWER(filename) LIKE LOWER(?)
      OR LOWER(COALESCE(extracted_text,'')) LIKE LOWER(?))`;
    const like = `%${String(q.q).trim()}%`;
    params.push(like, like, like, like, like, like);
  }
  const limit = Math.min(Math.max(parseInt(q.limit, 10) || 500, 1), 2000);
  sql += ' ORDER BY created_at DESC LIMIT ?';
  params.push(limit);
  res.json(db.prepare(sql).all(...params).map(r => shape(r, req.user)));
});

router.get('/recent', (req, res) => {
  const db = getDb();
  const work = canWorkQueue(req.user);
  const rows = work
    ? db.prepare('SELECT * FROM ap_drops ORDER BY created_at DESC LIMIT 10').all()
    : db.prepare('SELECT * FROM ap_drops WHERE created_by_user_id = ? ORDER BY created_at DESC LIMIT 10').all(req.user?.id || '');
  res.json(rows.map(r => shape(r, req.user)));
});

// ── One drop ────────────────────────────────────────────────────────────────

function loadFor(req, res) {
  const db = getDb();
  const row = loadDrop(db, req.params.id);
  if (!row) { res.status(404).json({ error: 'Not found' }); return null; }
  if (!canWorkQueue(req.user) && row.created_by_user_id !== req.user?.id) { res.status(404).json({ error: 'Not found' }); return null; }
  return row;
}

router.get('/:id', async (req, res) => {
  const row = loadFor(req, res); if (!row) return;
  const db = getDb();
  const events = db.prepare('SELECT id, at, by_name, kind, detail FROM ap_drop_events WHERE drop_id = ? ORDER BY at ASC, rowid ASC').all(row.id)
    .map(e => ({ ...e, detail: e.detail ? JSON.parse(e.detail) : null }));
  const duplicate_of = row.duplicate_of ? shape(loadDrop(db, row.duplicate_of), req.user) : null;
  const file_url = await (async () => { try { return storageEnabled() ? await presignGet(row.storage_key, row.filename) : null; } catch { return null; } })();
  res.json({ ...shape(row, req.user), events, duplicate_of, file_url });
});

// Editing the extracted fields is the office's. Every changed field is one
// activity line, so "who changed the amount" is answerable from the pane.
router.put('/:id', (req, res) => {
  const row = loadFor(req, res); if (!row) return;
  if (!canWorkQueue(req.user)) return res.status(403).json({ error: 'Only the office can edit what was read off the document.' });
  const db = getDb();
  const b = req.body || {};
  const set = [], params = [], changed = {};
  for (const k of EDITABLE) {
    if (!(k in b)) continue;
    let v = b[k];
    if (k === 'amount') v = num(v);
    else if (k === 'invoice_date' || k === 'due_date') v = isoDate(v);
    else v = v == null ? null : (String(v).trim() || null);
    if (v === row[k] || (v == null && row[k] == null)) continue;
    set.push(`${k} = ?`); params.push(v); changed[k] = { from: row[k], to: v };
  }
  if (!set.length) return res.json(shape(row, req.user));
  set.push("updated_at = datetime('now')");
  db.transaction(() => {
    db.prepare(`UPDATE ap_drops SET ${set.join(', ')} WHERE id = ?`).run(...params, row.id);
    event(db, row.id, req.user, 'fields_edited', changed);
  })();
  logAudit(req.user, 'ap_drop_updated', 'ap_drop', row.id, changed, row, loadDrop(db, row.id), row.filename);
  res.json(shape(loadDrop(db, row.id), req.user));
});

router.post('/:id/status', (req, res) => {
  const row = loadFor(req, res); if (!row) return;
  if (!canWorkQueue(req.user)) return res.status(403).json({ error: 'Only the office can move a drop through the queue.' });
  const status = String(req.body?.status || '');
  const reason = String(req.body?.reason || '').trim();
  if (!STATUSES.includes(status)) return res.status(400).json({ error: `Unknown status "${status}".` });
  if (NEEDS_REASON.has(status) && reason.length < 3) return res.status(400).json({ error: `Say why it is ${status.replace(/_/g, ' ')} — the reason shows on the queue.` });
  if (status === row.status && !reason) return res.json(shape(row, req.user));
  const db = getDb();
  db.transaction(() => {
    db.prepare(`UPDATE ap_drops SET status = ?, status_reason = ?, closed_at = ?, updated_at = datetime('now') WHERE id = ?`)
      .run(status, reason || null, TERMINAL.has(status) ? new Date().toISOString() : null, row.id);
    event(db, row.id, req.user, 'status_changed', { from: row.status, to: status, reason: reason || null });
  })();
  logAudit(req.user, 'ap_drop_status', 'ap_drop', row.id, { from: row.status, to: status, reason: reason || null }, row, loadDrop(db, row.id), row.filename);
  res.json(shape(loadDrop(db, row.id), req.user));
});

router.post('/:id/notes', (req, res) => {
  const row = loadFor(req, res); if (!row) return;
  const text = String(req.body?.text || '').trim();
  if (!text) return res.status(400).json({ error: 'An empty note says nothing.' });
  const db = getDb();
  event(db, row.id, req.user, 'note', { text: text.slice(0, 2000) });
  db.prepare("UPDATE ap_drops SET updated_at = datetime('now') WHERE id = ?").run(row.id);
  res.status(201).json({ ok: true });
});

// Re-run the reader over the stored file — fills BLANK fields only.
router.post('/:id/reparse', async (req, res) => {
  const row = loadFor(req, res); if (!row) return;
  if (!canWorkQueue(req.user)) return res.status(403).json({ error: 'Only the office can re-read a document.' });
  const { getObjectBuffer } = await import('../storage.js');
  const buf = await getObjectBuffer(row.storage_key);
  if (!buf) return res.status(404).json({ error: 'The stored file could not be read back.' });
  const parsed = await readAndApply(row.id, buf, row.content_type, row.filename);
  res.json({ parsed, drop: shape(loadDrop(getDb(), row.id), req.user) });
});

export default router;
