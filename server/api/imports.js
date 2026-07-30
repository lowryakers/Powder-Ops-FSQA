// Universal file importer: bring a log in from Monday, Airtable, Google Drive,
// Slack or a desktop spreadsheet without a one-off script each time.
//
// The flow is deliberately four steps, because a silent bulk write into a
// compliance log is not something anyone should be able to do by accident:
//
//   analyze  upload the file, see the columns it found and a guessed mapping
//   preview  apply the mapping, validate every row, report create/update/skip
//   commit   write, upserting on a natural key so a re-run updates in place
//   record   each row keeps source + external_id, so provenance is answerable
//
// Adding a target is a TARGETS entry — the parsing, mapping UI, validation and
// idempotency are shared.

import { Router } from 'express';
import { randomUUID as uuid } from 'crypto';
import { createHash } from 'crypto';
import multer from 'multer';
import { getDb, logAudit } from '../db.js';
import { hasExplicitEdit } from '../module-access.js';
import { readTable, excelSerialToDate } from '../tabular.js';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

/* ── Coercion ────────────────────────────────────────────────────────────── */

const clean = (v) => String(v ?? '').trim();

// Spreadsheets hand back dates three ways: an Excel serial, an ISO string, or
// something locale-formatted. Normalize all of them to YYYY-MM-DD.
function toDate(v) {
  const s = clean(v);
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  if (/^\d+(\.\d+)?$/.test(s)) {
    const n = Number(s);
    // Excel serials for real dates land far from small counting numbers.
    if (n > 20000 && n < 80000) return excelSerialToDate(n);
  }
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

function toNumber(v) {
  const s = clean(v).replace(/[$,]/g, '');
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined; // undefined = invalid, null = empty
}

// Monday check columns arrive as "v", Airtable as "checked"/TRUE, CSV as 1/0.
function toBool(v) {
  const s = clean(v).toLowerCase();
  if (!s) return 0;
  return ['v', 'x', 'yes', 'true', '1', 'checked', '✓'].includes(s) ? 1 : 0;
}

/* ── Targets ─────────────────────────────────────────────────────────────── */

const TARGETS = {
  receiving_log: {
    label: 'Receiving Log',
    table: 'receiving_log',
    module: 'receiving-log',
    fields: [
      { key: 'inspection_no', label: 'Inspection #', aliases: ['name', 'inspection', 'inspection #'] },
      { key: 'date_received', label: 'Date Received', type: 'date', required: true, aliases: ['date received', 'received date', 'date'] },
      { key: 'po_number', label: 'PO #', aliases: ['po #', 'po', 'po number', 'purchase order'] },
      { key: 'part_number', label: 'Part #', required: true, aliases: ['part #', 'part', 'part number', 'item'] },
      { key: 'part_description', label: 'Part Description', aliases: ['part description', 'description'] },
      { key: 'vendor_lot', label: 'Vendor Lot #', aliases: ['vendor lot #', 'vendor lot', 'lot', 'lot #'] },
      { key: 'expiration_date', label: 'Expiration Date', type: 'date', aliases: ['expiration date', 'expiry', 'expires', 'exp date'] },
      { key: 'quantity_received', label: 'Quantity Received', type: 'number', aliases: ['quantity received', 'qty', 'quantity'] },
      { key: 'uom', label: 'UOM', aliases: ['uom', 'unit', 'unit of measure'] },
      { key: 'received_by', label: 'Received By', aliases: ['received by', 'receiver'] },
      { key: 'part_in_mrp', label: 'Part # in MRPEasy', type: 'bool', aliases: ['part # in mrpeasy', 'part in mrp'] },
      { key: 'received_in_mrp', label: 'Received in MRPEasy', type: 'bool', aliases: ['received in mrpeasy', 'received in mrp'] },
      { key: 'packing_slip_url', label: 'Packing Slip (link)', aliases: ['packing slip', 'packing slip url', 'files'] },
      { key: 'status_of_release', label: 'Status of Release', aliases: ['status of release', 'status', 'release status'] },
      { key: 'release_date', label: 'Release Date', type: 'date', aliases: ['release date', 'released'] },
      { key: 'notes', label: 'Notes', aliases: ['notes', 'comment', 'comments'] },
    ],
    // What makes a row "the same row" on a re-import. Deliberately the whole
    // natural key, not the inspection #: one inspection covers several line
    // items, so the Monday export repeats it (722 distinct values across 2,107
    // rows, "NA" 215 times). Keying on it alone would collapse most of the log
    // into a handful of records.
    identity: ['inspection_no', 'date_received', 'po_number', 'part_number', 'vendor_lot'],
    identityFallback: ['date_received', 'part_description', 'quantity_received'],
  },
};

const norm = (s) => clean(s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

// Guess a mapping by matching each target field against the file's headers.
// Exact alias first, then a contains match — the goal is that a Monday export
// lands fully mapped and the person just confirms.
function suggestMapping(target, headers) {
  const map = {};
  const used = new Set();
  for (const f of target.fields) {
    const cands = [norm(f.label), norm(f.key), ...(f.aliases || []).map(norm)];
    let hit = headers.find(h => !used.has(h) && cands.includes(norm(h)));
    if (!hit) hit = headers.find(h => !used.has(h) && cands.some(c => c && norm(h).includes(c)));
    if (hit) { map[f.key] = hit; used.add(hit); }
  }
  return map;
}

// A stable id for the row so re-importing updates in place instead of
// duplicating.
//
// The business key alone is NOT enough to call two rows the same record. The
// same item legitimately arrives twice against one inspection #, PO and lot —
// two pallets, two partial deliveries — differing only in quantity, expiry or
// packing slip. Treating those as duplicates silently discards real receipts.
//
// So the identity is the business key PLUS which occurrence of that key this
// row is within the file. Two separate receipts get occurrence 0 and 1 and both
// import; re-running the same export lands on the same occurrences and updates
// in place; and a row edited upstream still matches its slot rather than
// duplicating. Only rows that are identical *and* redundant collapse — and that
// check is made on full row content, below.
function identityFor(target, row, occurrence = 0) {
  let parts = target.identity.map(k => clean(row[k]));
  if (!parts.some(Boolean)) {
    parts = target.identityFallback.map(k => clean(row[k]));
    if (!parts.some(Boolean)) return null;
  }
  const seed = `${parts.join('|').toLowerCase()}#${occurrence}`;
  return `${target.table}:${createHash('sha1').update(seed).digest('hex').slice(0, 24)}`;
}

// The business key on its own, used only to count occurrences within a file.
function businessKey(target, row) {
  const parts = target.identity.map(k => clean(row[k]));
  return (parts.some(Boolean) ? parts : target.identityFallback.map(k => clean(row[k]))).join('|').toLowerCase();
}

// Full-content fingerprint. Two rows matching on this are the same receipt
// entered twice — the only case where skipping is right.
function contentHash(target, row) {
  const parts = target.fields.map(f => clean(row[f.key]));
  return createHash('sha1').update(parts.join('|').toLowerCase()).digest('hex');
}

// Apply a mapping to one source row and validate it.
function buildRow(target, mapping, src) {
  const out = {};
  const errors = [];
  for (const f of target.fields) {
    const header = mapping[f.key];
    if (!header) continue;
    const raw = src[header];
    let v;
    if (f.type === 'date') v = toDate(raw);
    else if (f.type === 'number') { v = toNumber(raw); if (v === undefined) { errors.push(`${f.label}: "${clean(raw)}" is not a number`); v = null; } }
    else if (f.type === 'bool') v = toBool(raw);
    else v = clean(raw) || null;
    out[f.key] = v;
  }
  for (const f of target.fields) {
    if (f.required && (out[f.key] === null || out[f.key] === undefined || out[f.key] === '')) {
      errors.push(`${f.label} is required`);
    }
  }
  return { row: out, errors };
}

const canImport = (u, target) => u?.role === 'admin' || hasExplicitEdit(u, target.module);

/* ── Endpoints ───────────────────────────────────────────────────────────── */

router.get('/targets', (req, res) => {
  res.json(Object.entries(TARGETS).map(([key, t]) => ({
    key, label: t.label,
    fields: t.fields.map(f => ({ key: f.key, label: f.label, type: f.type || 'text', required: !!f.required })),
    can_import: canImport(req.user, t),
  })));
});

// Step 1 — read the file, stash it, and propose a mapping.
router.post('/analyze', upload.single('file'), (req, res) => {
  const target = TARGETS[req.body?.target];
  if (!target) return res.status(400).json({ error: 'Unknown import target.' });
  if (!canImport(req.user, target)) return res.status(403).json({ error: `Importing into ${target.label} requires an edit grant or admin.` });
  if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });

  let parsed;
  try { parsed = readTable(req.file.buffer, req.file.originalname); }
  catch (e) { return res.status(400).json({ error: `Could not read that file: ${e.message}` }); }
  if (!parsed.rows.length) return res.status(400).json({ error: 'No data rows found in that file.' });

  const db = getDb();
  const id = uuid();
  db.prepare(`INSERT INTO import_batches (id, target, filename, row_count, headers, rows_json, created_by)
              VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(id, req.body.target, req.file.originalname, parsed.rows.length,
      JSON.stringify(parsed.headers), JSON.stringify(parsed.rows), req.user?.name || null);

  res.json({
    batch_id: id,
    filename: req.file.originalname,
    headers: parsed.headers,
    row_count: parsed.rows.length,
    suggested_mapping: suggestMapping(target, parsed.headers),
    sample: parsed.rows.slice(0, 5),
  });
});

// Step 2 — dry run. Nothing is written; this is the "what will happen" screen.
router.post('/:id/preview', (req, res) => {
  const db = getDb();
  const batch = db.prepare('SELECT * FROM import_batches WHERE id = ?').get(req.params.id);
  if (!batch) return res.status(404).json({ error: 'Import not found.' });
  const target = TARGETS[batch.target];
  if (!canImport(req.user, target)) return res.status(403).json({ error: 'Not allowed.' });

  const mapping = req.body?.mapping || {};
  const rows = JSON.parse(batch.rows_json);
  const existing = new Set(db.prepare(`SELECT external_id FROM ${target.table} WHERE external_id IS NOT NULL`).all().map(r => r.external_id));

  let create = 0, update = 0, skip = 0;
  const issues = [];
  const seenContent = new Set();   // identical rows entered twice
  const keyCounts = new Map();     // occurrences of each business key
  const preview = [];
  rows.forEach((src, i) => {
    const { row, errors } = buildRow(target, mapping, src);
    if (errors.length) {
      skip++;
      if (issues.length < 25) issues.push({ line: i + 2, errors });
      return;
    }
    // Only a row identical in every mapped field is a redundant re-entry. Rows
    // sharing a business key but differing anywhere (quantity, expiry, packing
    // slip) are separate receipts and must both land.
    const content = contentHash(target, row);
    if (seenContent.has(content)) {
      skip++;
      if (issues.length < 25) issues.push({ line: i + 2, errors: ['identical to an earlier row in this file'] });
      return;
    }
    seenContent.add(content);

    const bk = businessKey(target, row);
    const occ = keyCounts.get(bk) || 0;
    keyCounts.set(bk, occ + 1);
    const ext = identityFor(target, row, occ);
    if (ext && existing.has(ext)) update++; else create++;
    if (preview.length < 8) preview.push(row);
  });

  res.json({ batch_id: batch.id, total: rows.length, create, update, skip, issues, preview });
});

// Step 3 — write. Upsert on external_id inside one transaction so a failure
// can't leave the log half-imported.
router.post('/:id/commit', (req, res) => {
  const db = getDb();
  const batch = db.prepare('SELECT * FROM import_batches WHERE id = ?').get(req.params.id);
  if (!batch) return res.status(404).json({ error: 'Import not found.' });
  if (batch.committed_at) return res.status(409).json({ error: 'This import has already been committed.' });
  const target = TARGETS[batch.target];
  if (!canImport(req.user, target)) return res.status(403).json({ error: 'Not allowed.' });

  const mapping = req.body?.mapping || {};
  const rows = JSON.parse(batch.rows_json);
  const source = `import:${(batch.filename || 'file').slice(0, 40)}`;
  const cols = target.fields.map(f => f.key);

  let created = 0, updated = 0, skipped = 0;
  const seenContent = new Set();
  const keyCounts = new Map();

  const insert = db.prepare(`INSERT INTO ${target.table}
    (id, ${cols.join(', ')}, source, external_id, created_by)
    VALUES (?, ${cols.map(() => '?').join(', ')}, ?, ?, ?)`);
  const findByExt = db.prepare(`SELECT id FROM ${target.table} WHERE external_id = ?`);
  const updateStmt = db.prepare(`UPDATE ${target.table}
    SET ${cols.map(c => `${c} = ?`).join(', ')}, source = ?, updated_at = datetime('now') WHERE id = ?`);

  db.transaction(() => {
    for (const src of rows) {
      const { row, errors } = buildRow(target, mapping, src);
      if (errors.length) { skipped++; continue; }
      // Mirrors the preview exactly, so what was approved is what gets written.
      const content = contentHash(target, row);
      if (seenContent.has(content)) { skipped++; continue; }
      seenContent.add(content);
      const bk = businessKey(target, row);
      const occ = keyCounts.get(bk) || 0;
      keyCounts.set(bk, occ + 1);
      const ext = identityFor(target, row, occ);
      const values = cols.map(c => row[c] ?? null);
      const hit = ext ? findByExt.get(ext) : null;
      if (hit) { updateStmt.run(...values, source, hit.id); updated++; }
      else { insert.run(uuid(), ...values, source, ext, req.user?.name || null); created++; }
    }
  })();

  const result = { created, updated, skipped, total: rows.length };
  db.prepare("UPDATE import_batches SET committed_at = datetime('now'), mapping = ?, result = ? WHERE id = ?")
    .run(JSON.stringify(mapping), JSON.stringify(result), batch.id);
  logAudit(req.user, 'import', 'import_batch', batch.id,
    { target: batch.target, filename: batch.filename, ...result }, null, null, `${target.label} · ${batch.filename}`);

  res.json(result);
});

// Import history — what was loaded, by whom, and what it did.
router.get('/history', (req, res) => {
  const db = getDb();
  const rows = db.prepare(`SELECT id, target, filename, row_count, created_by, created_at, committed_at, result
                           FROM import_batches ORDER BY created_at DESC LIMIT 50`).all();
  res.json(rows.map(r => ({ ...r, result: r.result ? JSON.parse(r.result) : null })));
});

export default router;
