// COC Drop (D-398) — the dock photographs a supplier's paper COC / COA, or
// uploads its PDF, and it waits in a queue until it is matched to its PO and
// filed into the supplier library. AP Drop's shape (server/api/ap-drop.js),
// for the warehouse instead of the office. Lowry, 25 Nov 2026: "I'm not going
// to have Juan scan and email anything." There is no scan-and-email step.
//
// Rules that shape it:
//
//  * ONE DROP IS ONE DELIVERY'S DOCUMENT. Every page sent in one request is one
//    drop (AP Drop files one row per file; a three-photo COC is one document).
//    The pages are stored first and hashed; the row exists before anyone reads it.
//  * THE QUEUE MATCHES, THEN FILES. Quality, Purchasing or the Procurement bot
//    set the PO / part / lot / quantity (the D-391 fields) and press File. Filing
//    copies the document into `supplier_files` through `fileSupplierDocuments` —
//    the same writer as POST /api/suppliers/:id/files — so the D-392 ReadyBot
//    alert reaches the dock exactly as it does for a COC filed on the supplier.
//    Photos are stitched, in page order, into ONE PDF: one library document.
//  * A SUPPLIER NOT ON THE LIST is added through `createSupplier` (D-393): it
//    starts unqualified, a token's near-name match is refused, nobody qualifies
//    it here.
//  * NOTHING HERE RECEIVES, SIGNS OR APPROVES. No receiving-log row, no checklist
//    sign-off, no disposition. And nothing is deleted: there is no delete route,
//    a DELETE is 403, and the tables refuse a DELETE by trigger.
//
// Access: mounted WITHOUT requireModuleWrite, the AP Drop arrangement —
// dropping is open to whoever is signed in and holding the paper. The queue is
// `canWorkCocQueue`; everyone else sees their own drops, and another person's
// drop is 404, never 403.
import { Router } from 'express';
import multer from 'multer';
import { createHash } from 'crypto';
import { v4 as uuid } from 'uuid';
import { PDFDocument } from 'pdf-lib';
import { getDb, logAudit } from '../db.js';
import { storageEnabled, putObject, presignGet, getObjectBuffer, deleteObject } from '../storage.js';
import { pageOf, pageList } from '../bot-api.js';
import { moduleLevel } from '../module-access.js';
import { createSupplier, fileSupplierDocuments, canEditSuppliersHere } from './suppliers.js';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024, files: 10 } });

export const STATUSES = ['new', 'matched', 'filed', 'mismatch'];
const KINDS = ['coc', 'coa'];
const MATCH_FIELDS = { po_number: 60, part_number: 80, lot_number: 80, qty_note: 120, mismatch_note: 500 };
const EDITABLE = [...Object.keys(MATCH_FIELDS), 'supplier_id', 'supplier_name', 'kind', 'notes'];
const DUPLICATE_WINDOW_DAYS = 30;
const QUALITY = ['qa', 'quality'];

/** Who works the queue: see every drop, edit the match fields, move status, file. */
export const canWorkCocQueue = (u, req = null) => {
  if (req?.auth?.kind === 'token') {
    const g = req.auth.grants || [];
    return g.includes('coc-drop') || g.includes('suppliers-edit');
  }
  return u?.role === 'admin'
    || QUALITY.includes((u?.department || '').toLowerCase())
    || moduleLevel(u, 'coc-drop') === 'edit';
};
const isAuditor = (u) => u?.role === 'auditor';
// An auditor reads the whole queue (as they read the Receiving Log) and writes nothing.
const canReadQueue = (u, req) => canWorkCocQueue(u, req) || isAuditor(u);

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
const clip = (v, n) => { const s = String(v ?? '').trim(); return s ? s.slice(0, n) : null; };
const safeName = (n) => String(n || 'file').replace(/[^\w.-]+/g, '_').slice(0, 120);
const isPdf = (f) => /pdf/i.test(f.mimetype || '') || /\.pdf$/i.test(f.originalname || '');
const isImage = (f) => /^image\//i.test(f.mimetype || '') || /\.(jpe?g|png|heic|heif|webp|gif)$/i.test(f.originalname || '');

function event(db, dropId, user, kind, detail) {
  db.prepare('INSERT INTO coc_drop_events (id, drop_id, by_user_id, by_name, kind, detail) VALUES (?, ?, ?, ?, ?, ?)')
    .run(uuid(), dropId, user?.id || null, user?.name || 'system', kind, detail ? JSON.stringify(detail) : null);
}

const loadDrop = (db, id) => db.prepare('SELECT * FROM coc_drops WHERE id = ?').get(id);
const pagesOf = (db, id) => db.prepare('SELECT * FROM coc_drop_files WHERE drop_id = ? ORDER BY page_index ASC, created_at ASC').all(id);

function shape(db, r, req) {
  if (!r) return null;
  const ids = (() => { try { return r.supplier_file_ids ? JSON.parse(r.supplier_file_ids) : []; } catch { return []; } })();
  const supplier = r.supplier_id ? db.prepare('SELECT id, name, status, source FROM suppliers WHERE id = ?').get(r.supplier_id) || null : null;
  const pages = db.prepare('SELECT COUNT(*) n FROM coc_drop_files WHERE drop_id = ?').get(r.id).n;
  return {
    ...r,
    supplier_file_ids: ids,
    supplier,
    pages,
    can_work: canWorkCocQueue(req.user, req) && !isAuditor(req.user),
    is_mine: !!req.user && r.created_by_user_id === req.user.id,
  };
}

// ── Drop ─────────────────────────────────────────────────────────────────────

router.post('/', upload.array('files', 10), async (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Sign in to drop a COC.' });
  if (isAuditor(req.user)) return res.status(403).json({ error: 'An auditor reads; dropping is for the plant.' });
  if (!storageEnabled()) return res.status(503).json({ error: 'File storage is not configured on this server, so nothing can be dropped yet.' });
  const files = req.files || [];
  if (!files.length) return res.status(400).json({ error: 'Nothing was attached. Take a photo of the COC, or choose its PDF.' });
  const wrong = files.find(f => !isPdf(f) && !isImage(f));
  if (wrong) return res.status(400).json({ error: `"${wrong.originalname}" is not a photo or a PDF. Drop a photo of each page, or the PDF.` });
  const db = getDb();
  const b = req.body || {};
  const kind = b.kind == null || b.kind === '' ? 'coc' : String(b.kind).toLowerCase();
  if (!KINDS.includes(kind)) return res.status(400).json({ error: 'kind must be "coc" or "coa".' });
  const supplierId = clip(b.supplier_id, 64);
  if (supplierId && !db.prepare('SELECT 1 FROM suppliers WHERE id = ?').get(supplierId)) {
    return res.status(400).json({ error: 'That supplier is not on the register. Type its name instead.' });
  }

  const id = uuid();
  const hashes = files.map(f => sha256(f.buffer));
  const combined = sha256(Buffer.from(hashes.join('|')));
  const stored = [];
  try {
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      const fileId = uuid();
      const key = `coc-drop/${id}/${fileId}-${safeName(f.originalname)}`;
      await putObject(key, f.buffer, f.mimetype);
      stored.push({ fileId, key, f, hash: hashes[i], page_index: i });
    }
  } catch (err) {
    for (const s of stored) deleteObject(s.key).catch(() => {});
    return res.status(502).json({ error: `The pages could not be stored: ${err.message}` });
  }
  // The same pages dropped again within the window is almost always the same
  // COC handed in twice. It is still filed — never silently dropped — and the
  // reason names the earlier drop, so the queue can see it.
  const prior = db.prepare(`SELECT id FROM coc_drops WHERE content_sha256 = ? AND created_at >= datetime('now', ?) ORDER BY created_at ASC LIMIT 1`)
    .get(combined, `-${DUPLICATE_WINDOW_DAYS} day`);
  const typed = {
    po_number: clip(b.po_number, MATCH_FIELDS.po_number), supplier_id: supplierId,
    supplier_name: clip(b.supplier_name, 200), notes: clip(b.notes, 2000), kind,
  };
  db.transaction(() => {
    db.prepare(`INSERT INTO coc_drops (id, created_by_user_id, submitter, source, notes, status, status_reason, kind, po_number,
        supplier_id, supplier_name, content_sha256) VALUES (?, ?, ?, 'drop', ?, 'new', ?, ?, ?, ?, ?, ?)`)
      .run(id, req.user.id, String(req.user.name || '').slice(0, 120), typed.notes,
        prior ? `The same pages were dropped earlier (${prior.id.slice(0, 8)})` : null,
        kind, typed.po_number, supplierId, typed.supplier_name, combined);
    const ins = db.prepare(`INSERT INTO coc_drop_files (id, drop_id, filename, storage_key, size, content_type, content_sha256, page_index)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
    for (const s of stored) ins.run(s.fileId, id, s.f.originalname || 'file', s.key, s.f.size, s.f.mimetype, s.hash, s.page_index);
    event(db, id, req.user, 'uploaded', { pages: stored.length, files: stored.map(s => s.f.originalname), duplicate_of: prior?.id || null, typed });
    if (prior) event(db, prior.id, req.user, 'duplicate_dropped', { again_as: id });
  })();
  // `event: 'coc_drop.created'` is what outside automation polls the audit log for.
  logAudit(req.user, 'coc_drop_created', 'coc_drop', id,
    { event: 'coc_drop.created', pages: stored.length, sha256: combined, kind, po_number: typed.po_number, duplicate_of: prior?.id || null },
    null, null, typed.po_number ? `COC drop · ${typed.po_number}` : 'COC drop');
  res.status(201).json({ drop: shape(db, loadDrop(db, id), req) });
});

// ── Queue ────────────────────────────────────────────────────────────────────

// POs the plant has already written down in ReadyDoc (receiving lines, the
// library, earlier drops), last 90 days. Never MRPEasy or Keychain.
function recentPos(db) {
  const rows = db.prepare(`
    SELECT po_number AS po, MAX(at) AS at FROM (
      SELECT po_number, created_at AS at FROM receiving_log WHERE po_number IS NOT NULL AND TRIM(po_number) != '' AND created_at >= datetime('now', '-90 day')
      UNION ALL SELECT po_number, created_at FROM supplier_files WHERE po_number IS NOT NULL AND created_at >= datetime('now', '-90 day')
      UNION ALL SELECT po_number, created_at FROM coc_drops WHERE po_number IS NOT NULL AND created_at >= datetime('now', '-90 day')
    ) GROUP BY po_number ORDER BY at DESC LIMIT 200`).all();
  return rows.map(r => String(r.po).trim()).filter(Boolean);
}

router.get('/meta', (req, res) => {
  const db = getDb();
  const work = canWorkCocQueue(req.user, req) && !isAuditor(req.user);
  const all = canReadQueue(req.user, req);
  const scope = all ? '' : ' WHERE created_by_user_id = ?';
  const p = all ? [] : [req.user?.id || ''];
  const counts = {};
  for (const r of db.prepare(`SELECT status, COUNT(*) n FROM coc_drops${scope} GROUP BY status`).all(...p)) counts[r.status] = r.n;
  const suppliers = db.prepare('SELECT id, name FROM suppliers ORDER BY actively_using DESC, name COLLATE NOCASE LIMIT 2000').all();
  const pos = (() => { try { return recentPos(db); } catch { return []; } })();
  res.json({ statuses: STATUSES, kinds: KINDS, counts, can_work: work, storage_enabled: storageEnabled(), suppliers, recent_pos: pos });
});

function listSql(req) {
  const q = req.query || {};
  const work = canReadQueue(req.user, req);
  let sql = 'SELECT d.* FROM coc_drops d LEFT JOIN suppliers s ON s.id = d.supplier_id WHERE 1=1';
  const params = [];
  if (!work) { sql += ' AND d.created_by_user_id = ?'; params.push(req.user?.id || ''); }
  // The default landing is everything not yet filed; `all` lifts it; a named
  // status narrows to exactly that.
  if (q.status && q.status !== 'all' && q.status !== 'open') { sql += ' AND d.status = ?'; params.push(q.status); }
  else if (q.status !== 'all') sql += " AND d.status != 'filed'";
  if (q.supplier) { sql += ' AND (d.supplier_id = ? OR LOWER(COALESCE(d.supplier_name, s.name, \'\')) = LOWER(?))'; params.push(q.supplier, q.supplier); }
  if (q.submitter) { sql += ' AND d.submitter = ?'; params.push(q.submitter); }
  if (q.from) { sql += ' AND d.created_at >= ?'; params.push(q.from); }
  if (q.to) { sql += " AND d.created_at < date(?, '+1 day')"; params.push(q.to); }
  if (q.q && String(q.q).trim()) {
    const like = `%${String(q.q).trim().toLowerCase()}%`;
    sql += ` AND (LOWER(COALESCE(d.po_number,'')) LIKE ? OR LOWER(COALESCE(d.supplier_name,'')) LIKE ? OR LOWER(COALESCE(s.name,'')) LIKE ?
      OR LOWER(COALESCE(d.notes,'')) LIKE ? OR EXISTS (SELECT 1 FROM coc_drop_files f WHERE f.drop_id = d.id AND LOWER(f.filename) LIKE ?))`;
    params.push(like, like, like, like, like);
  }
  return { sql, params };
}

router.get('/', (req, res) => {
  const db = getDb();
  const { sql, params } = listSql(req);
  if (pageOf(req)) return res.json(pageList(req, res, db.prepare(sql + ' ORDER BY d.created_at DESC').all(...params).map(r => shape(db, r, req))));
  const limit = Math.min(Math.max(parseInt(req.query?.limit, 10) || 500, 1), 2000);
  res.json(db.prepare(sql + ' ORDER BY d.created_at DESC LIMIT ?').all(...params, limit).map(r => shape(db, r, req)));
});

router.get('/recent', (req, res) => {
  const db = getDb();
  const rows = canReadQueue(req.user, req)
    ? db.prepare('SELECT * FROM coc_drops ORDER BY created_at DESC LIMIT 10').all()
    : db.prepare('SELECT * FROM coc_drops WHERE created_by_user_id = ? ORDER BY created_at DESC LIMIT 10').all(req.user?.id || '');
  res.json(rows.map(r => shape(db, r, req)));
});

// ── One drop ────────────────────────────────────────────────────────────────

function loadFor(req, res) {
  const db = getDb();
  const row = loadDrop(db, req.params.id);
  if (!row || (!canReadQueue(req.user, req) && row.created_by_user_id !== req.user?.id)) {
    res.status(404).json({ error: 'Not found' });
    return null;
  }
  return row;
}
const workerOnly = (req, res, what) => {
  if (canWorkCocQueue(req.user, req) && !isAuditor(req.user)) return true;
  res.status(403).json({ error: `Only Quality and Purchasing ${what}.` });
  return false;
};

router.get('/:id', async (req, res) => {
  const row = loadFor(req, res); if (!row) return;
  const db = getDb();
  const token = req.auth?.kind === 'token';
  const pages = [];
  for (const p of pagesOf(db, row.id)) {
    const { storage_key, ...rest } = p;
    const url = token ? null : await (async () => { try { return await presignGet(storage_key, p.filename); } catch { return null; } })();
    pages.push({ ...rest, url });
  }
  const events = db.prepare('SELECT id, at, by_name, kind, detail FROM coc_drop_events WHERE drop_id = ? ORDER BY at ASC, rowid ASC').all(row.id)
    .map(e => ({ ...e, detail: e.detail ? JSON.parse(e.detail) : null }));
  const out = shape(db, row, req);
  const ids = out.supplier_file_ids;
  const library = ids.length
    ? db.prepare(`SELECT id, filename, kind, po_number, created_at FROM supplier_files WHERE id IN (${ids.map(() => '?').join(',')})`).all(...ids)
    : [];
  res.json({ ...out, page_files: pages, events, library });
});

function cleanField(k, v) {
  if (v == null) return null;
  if (k === 'kind') return String(v).toLowerCase();
  if (k === 'supplier_id') return clip(v, 64);
  if (k === 'supplier_name') return clip(v, 200);
  if (k === 'notes') return clip(v, 2000);
  return clip(v, MATCH_FIELDS[k]);
}

// Editing the match fields is the queue's. Each changed field is one activity
// line. Setting a PO on a `new` drop makes it `matched`; a mismatch note makes
// it `mismatch` (unless it is already filed). Both are written in this same
// edit, so the row never reads "new" over a PO somebody has just matched.
router.put('/:id', (req, res) => {
  const row = loadFor(req, res); if (!row) return;
  if (!workerOnly(req, res, 'edit a drop')) return;
  const db = getDb();
  const b = req.body || {};
  const set = [], params = [], changed = {};
  for (const k of EDITABLE) {
    if (!(k in b)) continue;
    const v = cleanField(k, b[k]);
    if (k === 'kind' && !KINDS.includes(v || '')) return res.status(400).json({ error: 'kind must be "coc" or "coa".' });
    if (k === 'supplier_id' && v && !db.prepare('SELECT 1 FROM suppliers WHERE id = ?').get(v)) {
      return res.status(400).json({ error: 'That supplier is not on the register.' });
    }
    if ((v ?? null) === (row[k] ?? null)) continue;
    set.push(`${k} = ?`); params.push(v); changed[k] = { from: row[k], to: v };
  }
  if (!set.length) return res.json(shape(db, row, req));
  const after = { ...row, ...Object.fromEntries(Object.entries(changed).map(([k, c]) => [k, c.to])) };
  let next = row.status;
  if (row.status !== 'filed') {
    if (changed.mismatch_note && after.mismatch_note) next = 'mismatch';
    else if (row.status === 'new' && changed.po_number && after.po_number) next = 'matched';
  }
  if (next !== row.status) { set.push('status = ?'); params.push(next); }
  set.push("updated_at = datetime('now')");
  db.transaction(() => {
    db.prepare(`UPDATE coc_drops SET ${set.join(', ')} WHERE id = ?`).run(...params, row.id);
    event(db, row.id, req.user, 'fields_edited', changed);
    if (next !== row.status) event(db, row.id, req.user, 'status_changed', { from: row.status, to: next, by: 'edit' });
  })();
  logAudit(req.user, 'coc_drop_updated', 'coc_drop', row.id, { ...changed, ...(next !== row.status ? { status: { from: row.status, to: next } } : {}) },
    row, loadDrop(db, row.id), row.po_number || 'COC drop');
  res.json(shape(db, loadDrop(db, row.id), req));
});

router.post('/:id/status', (req, res) => {
  const row = loadFor(req, res); if (!row) return;
  if (!workerOnly(req, res, 'move a drop through the queue')) return;
  const status = String(req.body?.status || '');
  const reason = String(req.body?.reason || '').trim();
  if (!STATUSES.includes(status)) return res.status(400).json({ error: `Unknown status "${status}". It is one of: ${STATUSES.join(', ')}.` });
  if (status === 'mismatch' && reason.length < 3) return res.status(400).json({ error: 'Say what does not match — the reason shows on the queue.' });
  const ids = (() => { try { return JSON.parse(row.supplier_file_ids || '[]'); } catch { return []; } })();
  if (status === 'filed' && !ids.length) return res.status(400).json({ error: 'A drop is filed by pressing File into library, which puts it in the supplier library.' });
  if (row.status === 'filed' && status !== 'filed') return res.status(400).json({ error: 'This drop is already in the library. Correct the document on the supplier instead.' });
  if (status === row.status && !reason) return res.json(shape(getDb(), row, req));
  const db = getDb();
  db.transaction(() => {
    db.prepare(`UPDATE coc_drops SET status = ?, status_reason = ?, mismatch_note = CASE WHEN ? = 'mismatch' AND (mismatch_note IS NULL OR mismatch_note = '') THEN ? ELSE mismatch_note END,
        updated_at = datetime('now') WHERE id = ?`).run(status, reason || null, status, reason.slice(0, 500) || null, row.id);
    event(db, row.id, req.user, 'status_changed', { from: row.status, to: status, reason: reason || null });
  })();
  logAudit(req.user, 'coc_drop_status', 'coc_drop', row.id, { from: row.status, to: status, reason: reason || null }, row, loadDrop(db, row.id), row.po_number || 'COC drop');
  res.json(shape(db, loadDrop(db, row.id), req));
});

router.post('/:id/notes', (req, res) => {
  const row = loadFor(req, res); if (!row) return;
  if (isAuditor(req.user)) return res.status(403).json({ error: 'An auditor reads; notes are for the plant.' });
  const text = String(req.body?.text || '').trim();
  if (!text) return res.status(400).json({ error: 'An empty note says nothing.' });
  const db = getDb();
  event(db, row.id, req.user, 'note', { text: text.slice(0, 2000) });
  db.prepare("UPDATE coc_drops SET updated_at = datetime('now') WHERE id = ?").run(row.id);
  res.status(201).json({ ok: true });
});

// The pages as ONE library document. A single PDF is filed as it is; anything
// else — photos, several PDFs, or a mix — is stitched in page order into one
// PDF. A photo pdf-lib cannot draw (the screen sends JPEG; a raw HEIC from a
// bot would not be) means the pages are filed one by one instead, and the
// response says so.
export async function stitchPages(pages) {
  if (pages.length === 1 && isPdf({ mimetype: pages[0].content_type, originalname: pages[0].filename })) {
    return { files: [{ buffer: pages[0].buffer, originalname: pages[0].filename, mimetype: 'application/pdf' }], stitched: false };
  }
  const out = await PDFDocument.create();
  for (const p of pages) {
    const type = p.content_type || '';
    if (/pdf/i.test(type) || /\.pdf$/i.test(p.filename)) {
      const src = await PDFDocument.load(p.buffer, { ignoreEncryption: true });
      for (const pg of await out.copyPages(src, src.getPageIndices())) out.addPage(pg);
      continue;
    }
    const img = /png/i.test(type) || /\.png$/i.test(p.filename) ? await out.embedPng(p.buffer)
      : /jpe?g/i.test(type) || /\.jpe?g$/i.test(p.filename) ? await out.embedJpg(p.buffer) : null;
    if (!img) return { files: pages.map(x => ({ buffer: x.buffer, originalname: x.filename, mimetype: x.content_type })), stitched: false, reason: `${p.filename} could not be drawn into a PDF, so each page was filed on its own` };
    const page = out.addPage([img.width, img.height]);
    page.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height });
  }
  return { files: [{ buffer: Buffer.from(await out.save()), originalname: null, mimetype: 'application/pdf' }], stitched: true };
}

router.post('/:id/file', async (req, res) => {
  const row = loadFor(req, res); if (!row) return;
  if (!workerOnly(req, res, 'file a drop into the library')) return;
  const db = getDb();
  // Filing writes the supplier library, so a token also needs the library's own
  // grant (suppliers-edit), as it would on POST /api/suppliers/:id/files.
  if (req.auth?.kind === 'token' && !(req.auth.grants || []).includes('suppliers-edit')) {
    return res.status(403).json({ error: 'Filing into the supplier library needs the suppliers-edit grant on this token.' });
  }
  const done = (() => { try { return JSON.parse(row.supplier_file_ids || '[]'); } catch { return []; } })();
  if (row.status === 'filed' && done.length) return res.json({ drop: shape(db, row, req), already_filed: true });
  if (!storageEnabled()) return res.status(503).json({ error: 'File storage is not configured on this server.' });
  const b = req.body || {};

  // The supplier: the one chosen, else the one named. A name exactly on the
  // register is that supplier; a new name is added unqualified (D-393).
  let supplier = row.supplier_id ? db.prepare('SELECT id, name FROM suppliers WHERE id = ?').get(row.supplier_id) : null;
  let created = null;
  if (!supplier) {
    const name = clip(b.supplier_name, 200) || row.supplier_name;
    if (!name) return res.status(400).json({ code: 'SUPPLIER_REQUIRED', error: 'Choose the supplier, or type its name, before filing.' });
    const key = name.toLowerCase().replace(/\s+/g, ' ');
    const exact = db.prepare('SELECT id, name, legacy_names FROM suppliers').all().find(r => [r.name, ...(() => { try { return JSON.parse(r.legacy_names || '[]'); } catch { return []; } })()]
      .some(n => String(n || '').toLowerCase().replace(/\s+/g, ' ') === key));
    if (exact) supplier = { id: exact.id, name: exact.name };
    else {
      if (!canEditSuppliersHere(req)) return res.status(403).json({ code: 'SUPPLIER_CREATE_NOT_PERMITTED', error: `"${name}" is not on the register, and adding a supplier needs Suppliers edit (or the suppliers-edit grant).` });
      const r = createSupplier(db, { name, vendor_type: b.vendor_type, notes: `Added when a COC drop was filed (${row.id.slice(0, 8)}).` },
        { user: req.user, viaToken: req.auth?.kind === 'token' });
      if (r.status !== 201) return res.status(r.status).json(r.body);
      supplier = { id: r.body.id, name };
      created = r.body.id;
    }
  }

  const pageRows = pagesOf(db, row.id);
  const pages = [];
  for (const p of pageRows) pages.push({ ...p, buffer: await getObjectBuffer(p.storage_key) });
  let stitched;
  try { stitched = await stitchPages(pages); }
  catch (err) { return res.status(400).json({ error: `The pages could not be put into one PDF: ${err.message}` }); }
  const base = `${row.kind.toUpperCase()}${row.po_number ? ` ${row.po_number}` : ''}${row.lot_number ? ` lot ${row.lot_number}` : ''}`.replace(/[^\w .-]+/g, '_');
  const files = stitched.files.map((f, i) => ({ ...f, originalname: f.originalname || `${base}${stitched.files.length > 1 ? ` p${i + 1}` : ''}.pdf`, size: f.buffer.length }));
  const { saved, receiving_alert } = await fileSupplierDocuments(db, supplier, files, {
    kind: row.kind, lot_number: row.lot_number,
    delivery: { po_number: row.po_number, part_number: row.part_number, qty_note: row.qty_note, mismatch_note: row.mismatch_note },
  }, req.user);
  const ids = saved.map(s => s.id);
  db.transaction(() => {
    db.prepare(`UPDATE coc_drops SET status = 'filed', closed_at = datetime('now'), supplier_id = ?, supplier_file_ids = ?, updated_at = datetime('now') WHERE id = ?`)
      .run(supplier.id, JSON.stringify(ids), row.id);
    event(db, row.id, req.user, 'filed', { supplier_id: supplier.id, supplier_name: supplier.name, supplier_created: !!created, supplier_file_ids: ids,
      stitched: stitched.stitched, ...(stitched.reason ? { note: stitched.reason } : {}), receiving_alert });
  })();
  logAudit(req.user, 'coc_drop_status', 'coc_drop', row.id,
    { from: row.status, to: 'filed', supplier_id: supplier.id, supplier_file_ids: ids, supplier_created: created }, row, loadDrop(db, row.id), row.po_number || 'COC drop');
  res.json({ drop: shape(db, loadDrop(db, row.id), req), saved, supplier_created: created, stitched: stitched.stitched, note: stitched.reason || null, receiving_alert });
});

// Nothing is deleted (SEC hold A-20261102-019): a DELETE anywhere here is 403.
router.delete(/.*/, (req, res) => res.status(403).json({ error: 'A COC drop is kept. Mark it mismatch with a reason instead of removing it.' }));

export default router;
