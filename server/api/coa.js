import { Router } from 'express';
import { v4 as uuid } from 'uuid';
import multer from 'multer';
import path from 'path';
import { mkdirSync, existsSync, createReadStream, statSync, unlinkSync, readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import PDFDocument from 'pdfkit';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { getDb, logAudit, dataDir } from '../db.js';
import { requireRole } from '../middleware/auth.js';
import { gradeResult, specIndex } from '../coa-grade.js';
import { parseColumnarCoa, foundSomething } from '../coa-parse.js';
import { aiEnabled, readLabReport } from '../ai.js';
import { composeSubmission, PROCESSING, processingLabel } from '../coa-submission.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Beside the DB (the persistent volume in production) — NOT the app dir,
// which is wiped on every deploy.
const UPLOAD_DIR = path.join(dataDir(), 'coa-files');
mkdirSync(UPLOAD_DIR, { recursive: true });
// The real Powder Ops box logo, embedded on exported certificates.
const LOGO_PATH = path.join(__dirname, '..', 'assets', 'powder-ops-logo.jpg');

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${uuid()}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = ['.pdf', '.jpg', '.jpeg', '.png', '.xlsx', '.xls', '.csv', '.doc', '.docx'];
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, allowed.includes(ext));
  },
});

// PDF-only, held in memory: these uploads are READ (text extracted) rather than
// filed, so they never need to touch disk. Declared beside `upload` because a
// route registered above its multer instance throws at module load — `const` is
// not hoisted, and the router.post() call runs during evaluation.
const coaUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    cb(null, path.extname(file.originalname).toLowerCase() === '.pdf');
  },
});

const router = Router();

const REQUEST_FIELDS = ['item_number', 'item_description', 'lot_number', 'product_expiration', 'tests_requested', 'status', 'lab_id', 'lab_name', 'date_sent', 'tat_days', 'expected_results_date', 'date_of_results', 'date_sent_to_customer', 'requested_by', 'invoice_amount', 'retest_required', 'retest_of', 'notes', 'origin', 'supplier', 'product_code', 'manufacturer_lot', 'vendor_lot', 'received_date', 'certificate_number', 'date_of_issuance'];

function nextCertNumber(db) {
  const last = db.prepare("SELECT certificate_number FROM coa_requests WHERE certificate_number IS NOT NULL ORDER BY CAST(certificate_number AS INTEGER) DESC LIMIT 1").get();
  const next = last ? parseInt(last.certificate_number) + 1 : 160001;
  return String(next);
}

// ──────────────── Labs ────────────────

router.get('/labs', (_req, res) => {
  const db = getDb();
  const labs = db.prepare('SELECT * FROM coa_labs ORDER BY name').all();
  res.json(labs);
});

router.post('/labs', (req, res) => {
  const db = getDb();
  const { name, contact_name, contact_email, contact_phone, address } = req.body;
  if (!name) return res.status(400).json({ error: 'Lab name is required' });

  const id = uuid();
  db.prepare('INSERT INTO coa_labs (id, name, contact_name, contact_email, contact_phone, address) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, name, contact_name || null, contact_email || null, contact_phone || null, address || null);

  const created = db.prepare('SELECT * FROM coa_labs WHERE id = ?').get(id);
  logAudit(req.user, 'create', 'coa_lab', id, req.body, null, created);
  res.status(201).json(created);
});

router.put('/labs/:id', (req, res) => {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM coa_labs WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Lab not found' });

  const fields = ['name', 'contact_name', 'contact_email', 'contact_phone', 'address', 'is_active'];
  const updates = [];
  const values = [];
  for (const f of fields) {
    if (req.body[f] !== undefined) {
      updates.push(`${f} = ?`);
      values.push(req.body[f]);
    }
  }
  if (updates.length === 0) return res.status(400).json({ error: 'No fields to update' });

  updates.push("updated_at = datetime('now')");
  values.push(req.params.id);
  db.prepare(`UPDATE coa_labs SET ${updates.join(', ')} WHERE id = ?`).run(...values);

  const updated = db.prepare('SELECT * FROM coa_labs WHERE id = ?').get(req.params.id);
  logAudit(req.user, 'update', 'coa_lab', req.params.id, req.body, existing, updated);
  res.json(updated);
});

// ──────────────── Specifications ────────────────

// Material-level requirements narrative (Form 607-01 sections 2–5), one per item.
const MATERIAL_SPEC_FIELDS = ['common_name', 'sku_number', 'vendor', 'revision', 'packaging', 'labeling', 'desiccant', 'storage', 'handling', 'safety', 'acceptance_criteria', 'retest_panel', 'max_shelf_life', 'treatment_note', 'notes'];

router.get('/material-spec', (req, res) => {
  const db = getDb();
  const { item_number } = req.query;
  if (!item_number) return res.status(400).json({ error: 'item_number is required' });
  res.json(db.prepare('SELECT * FROM coa_material_specs WHERE item_number = ?').get(item_number) || null);
});

router.put('/material-spec', (req, res) => {
  const db = getDb();
  const item_number = String(req.body?.item_number || '').trim();
  if (!item_number) return res.status(400).json({ error: 'item_number is required' });
  const cols = ['item_number', ...MATERIAL_SPEC_FIELDS, 'updated_by'];
  const vals = [item_number, ...MATERIAL_SPEC_FIELDS.map(f => req.body[f] ?? null), req.user.name];
  const placeholders = cols.map(() => '?').join(', ');
  const updates = [...MATERIAL_SPEC_FIELDS, 'updated_by'].map(c => `${c}=excluded.${c}`).join(', ');
  db.prepare(`INSERT INTO coa_material_specs (${cols.join(', ')}) VALUES (${placeholders})
    ON CONFLICT(item_number) DO UPDATE SET ${updates}, updated_at=datetime('now')`).run(...vals);
  logAudit(req.user, 'update', 'coa_material_spec', item_number, { item_number }, null, null);
  res.json(db.prepare('SELECT * FROM coa_material_specs WHERE item_number = ?').get(item_number));
});

router.get('/specifications', (req, res) => {
  const db = getDb();
  const { item_number } = req.query;
  let sql = 'SELECT * FROM coa_specifications WHERE is_active = 1';
  const params = [];
  if (item_number) { sql += ' AND item_number = ?'; params.push(item_number); }
  sql += ' ORDER BY item_number, test_type';
  res.json(db.prepare(sql).all(...params));
});

// ── Draft specifications waiting on QA ──────────────────────────────────────
//
// Seeded starter specs (server/spec-seed.js) land as `is_active = 0` +
// `approval_status = 'draft'`, so they cannot grade anything until someone
// reviews them. This is their queue. Bounded like every other list endpoint.
router.get('/specifications/drafts', (req, res) => {
  const db = getDb();
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 500, 1), 2000);
  const rows = db.prepare(`SELECT * FROM coa_specifications
    WHERE approval_status = 'draft' AND is_active = 0
    ORDER BY item_number, test_type LIMIT ?`).all(limit);
  // Items are derived from the rows actually returned, not from a separate
  // GROUP BY over the whole table — otherwise a page cut short by `limit`
  // lists items whose drafts aren't in the payload, and the UI renders empty
  // groups. `total` is the honest count of everything still waiting.
  const seen = new Map();
  for (const r of rows) {
    if (!seen.has(r.item_number)) seen.set(r.item_number, { item_number: r.item_number, item_description: r.item_description, n: 0 });
    seen.get(r.item_number).n++;
  }
  const total = db.prepare("SELECT COUNT(*) n FROM coa_specifications WHERE approval_status = 'draft' AND is_active = 0").get().n;
  res.json({ drafts: rows, items: [...seen.values()], shown: rows.length, total });
});

// Approve drafts into live specifications. From this point they grade results,
// so a draft whose limit was left blank on purpose (the heavy metals) can be
// given its number in the same call rather than approved empty and forgotten.
router.post('/specifications/drafts/approve', (req, res) => {
  const db = getDb();
  const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];
  if (!ids.length) return res.status(400).json({ error: 'ids array is required' });
  const limits = req.body?.limits && typeof req.body.limits === 'object' ? req.body.limits : {};

  const get = db.prepare("SELECT * FROM coa_specifications WHERE id = ? AND approval_status = 'draft'");
  const setLimits = db.prepare('UPDATE coa_specifications SET min_value = ?, max_value = ? WHERE id = ?');
  const approve = db.prepare(`UPDATE coa_specifications SET is_active = 1, approval_status = 'approved',
    reviewed_by = ?, reviewed_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`);

  const done = [];
  const tx = db.transaction(() => {
    for (const id of ids) {
      const row = get.get(id);
      if (!row) continue;
      const l = limits[id];
      if (l && (l.min_value !== undefined || l.max_value !== undefined)) {
        const min = l.min_value === '' || l.min_value == null ? null : Number(l.min_value);
        const max = l.max_value === '' || l.max_value == null ? null : Number(l.max_value);
        setLimits.run(Number.isFinite(min) ? min : null, Number.isFinite(max) ? max : null, id);
      }
      approve.run(req.user.name, id);
      done.push(id);
      logAudit(req.user, 'approve', 'coa_specification', id,
        { item_number: row.item_number, test_type: row.test_type, from: 'draft' },
        row, db.prepare('SELECT * FROM coa_specifications WHERE id = ?').get(id), `${row.item_number} · ${row.test_type}`);
    }
  });
  tx();
  res.json({ approved: done.length });
});

// Discarding a draft does NOT delete the row — it stays as the record that
// this spec was offered and turned down, and it's what stops the seeder
// filing it again on the next deploy.
router.post('/specifications/drafts/discard', (req, res) => {
  const db = getDb();
  const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];
  if (!ids.length) return res.status(400).json({ error: 'ids array is required' });
  const get = db.prepare("SELECT * FROM coa_specifications WHERE id = ? AND approval_status = 'draft'");
  const upd = db.prepare(`UPDATE coa_specifications SET approval_status = 'discarded',
    reviewed_by = ?, reviewed_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`);
  let n = 0;
  const tx = db.transaction(() => {
    for (const id of ids) {
      const row = get.get(id);
      if (!row) continue;
      upd.run(req.user.name, id);
      n++;
      logAudit(req.user, 'update', 'coa_specification', id,
        { item_number: row.item_number, test_type: row.test_type, discarded_draft: true }, row, null,
        `${row.item_number} · ${row.test_type}`);
    }
  });
  tx();
  res.json({ discarded: n });
});

router.post('/specifications', (req, res) => {
  const db = getDb();
  const { item_number, item_description, test_type, specification, unit, min_value, max_value, method, sku_number, vendor, revision } = req.body;
  if (!item_number || !item_description || !test_type) {
    return res.status(400).json({ error: 'item_number, item_description, and test_type are required' });
  }

  const id = uuid();
  db.prepare(`INSERT INTO coa_specifications (id, item_number, item_description, test_type, specification, unit, min_value, max_value, method, sku_number, vendor, revision, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, item_number, item_description, test_type, specification || null, unit || null, min_value ?? null, max_value ?? null, method || null, sku_number || null, vendor || null, revision || null, req.user.name);

  const created = db.prepare('SELECT * FROM coa_specifications WHERE id = ?').get(id);
  logAudit(req.user, 'create', 'coa_specification', id, req.body, null, created);
  res.status(201).json(created);
});

router.put('/specifications/:id', (req, res) => {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM coa_specifications WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Specification not found' });

  const fields = ['item_number', 'item_description', 'test_type', 'specification', 'unit', 'min_value', 'max_value', 'method', 'sku_number', 'vendor', 'revision', 'is_active'];
  const updates = [];
  const values = [];
  for (const f of fields) {
    if (req.body[f] !== undefined) {
      updates.push(`${f} = ?`);
      values.push(req.body[f]);
    }
  }
  if (updates.length === 0) return res.status(400).json({ error: 'No fields to update' });

  updates.push("updated_at = datetime('now')");
  values.push(req.params.id);
  db.prepare(`UPDATE coa_specifications SET ${updates.join(', ')} WHERE id = ?`).run(...values);

  const updated = db.prepare('SELECT * FROM coa_specifications WHERE id = ?').get(req.params.id);
  logAudit(req.user, 'update', 'coa_specification', req.params.id, req.body, existing, updated);
  res.json(updated);
});

router.delete('/specifications/:id', (req, res) => {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM coa_specifications WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Specification not found' });

  db.prepare("UPDATE coa_specifications SET is_active = 0, updated_at = datetime('now') WHERE id = ?").run(req.params.id);
  logAudit(req.user, 'delete', 'coa_specification', req.params.id, null, existing, null);
  res.json({ success: true });
});

// ──────────────── Item specification summary ────────────────
// QA wants one item and every test spec that applies to it, grouped — the paper
// "material specification sheet" they used to keep. The Specifications tab
// stores one row per test, so this just gathers the active rows for an item and
// lifts the item-level fields (which repeat on every row) to the top.
function specSheet(db, itemNumber) {
  const specs = db.prepare('SELECT * FROM coa_specifications WHERE item_number = ? AND is_active = 1 ORDER BY test_type').all(itemNumber);
  const head = specs[0] || {};
  return {
    item_number: itemNumber,
    item_description: head.item_description || null,
    sku_number: head.sku_number || null,
    vendor: head.vendor || null,
    revision: head.revision || null,
    specifications: specs,
  };
}

// Human-readable spec: the free-text spec if given, else derived from the range.
function specText(s) {
  if (s.specification) return s.specification;
  const u = s.unit ? ` ${s.unit}` : '';
  if (s.min_value != null && s.max_value != null) return `${s.min_value} – ${s.max_value}${u}`;
  if (s.max_value != null) return `≤ ${s.max_value}${u}`;
  if (s.min_value != null) return `≥ ${s.min_value}${u}`;
  return '—';
}

router.get('/specifications/summary', (req, res) => {
  const { item_number } = req.query;
  if (!item_number) return res.status(400).json({ error: 'item_number is required' });
  res.json(specSheet(getDb(), item_number));
});

// Downloadable spec sheet PDF for one item — same letterhead as the COA export.
router.get('/specifications/pdf', (req, res) => {
  const db = getDb();
  const { item_number } = req.query;
  if (!item_number) return res.status(400).json({ error: 'item_number is required' });
  const sheet = specSheet(db, item_number);
  if (!sheet.specifications.length) return res.status(404).json({ error: 'No active specifications for this item.' });

  const SLATE = '#3a3a3a', ORANGE = '#c65d35', RULE = '#d8d4d0';
  const doc = new PDFDocument({ size: 'LETTER', margins: { top: 42, bottom: 60, left: 50, right: 50 }, bufferPages: true });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="SpecSheet_${String(item_number).replace(/[^a-zA-Z0-9]/g, '_')}.pdf"`);
  doc.pipe(res);

  const lm = doc.page.margins.left;
  const pageW = doc.page.width - lm - doc.page.margins.right;

  const logoH = 74;
  try { doc.image(LOGO_PATH, lm, 42, { height: logoH }); } catch { /* logo optional */ }
  doc.font('Helvetica-Bold').fontSize(15).fillColor(SLATE).text('POWDER OPS', lm + 75, 50, { characterSpacing: 0.5 });
  doc.font('Helvetica').fontSize(8.5).fillColor('#666')
    .text('281 E 1600 N, Vineyard, UT 84059', lm + 75, 69)
    .text('www.powder-ops.com', lm + 75, 81);

  let y = 42 + logoH + 18;
  doc.font('Helvetica-Bold').fontSize(16).fillColor(SLATE)
    .text('MATERIAL SPECIFICATION SHEET', lm, y, { width: pageW, align: 'center', characterSpacing: 1 });
  y += 22;
  doc.moveTo(lm, y).lineTo(lm + pageW, y).lineWidth(2).strokeColor(ORANGE).stroke();
  y += 12;

  const na = (v) => v || 'N/A';
  const info = [
    ['Item Number', na(sheet.item_number), 'SKU', na(sheet.sku_number)],
    ['Description', na(sheet.item_description), 'Vendor', na(sheet.vendor)],
    ['Revision', na(sheet.revision), 'Printed', new Date().toLocaleDateString('en-US')],
  ];
  const halfW = pageW / 2, labW = 78;
  doc.fontSize(8.5);
  for (const [l1, v1, l2, v2] of info) {
    doc.font('Helvetica-Bold').fillColor('#777').text(l1.toUpperCase(), lm, y, { width: labW });
    doc.font('Helvetica').fillColor('#111').text(v1, lm + labW, y, { width: halfW - labW - 10 });
    doc.font('Helvetica-Bold').fillColor('#777').text(l2.toUpperCase(), lm + halfW, y, { width: labW });
    doc.font('Helvetica').fillColor('#111').text(v2, lm + halfW + labW, y, { width: halfW - labW });
    y += 15;
    doc.moveTo(lm, y - 4).lineTo(lm + pageW, y - 4).lineWidth(0.4).strokeColor(RULE).stroke();
  }
  y += 10;

  // Specs table: Test | Specification | Method
  const cols = [
    { k: 'test', label: 'TEST / ATTRIBUTE', w: pageW * 0.34 },
    { k: 'spec', label: 'SPECIFICATION', w: pageW * 0.40 },
    { k: 'method', label: 'METHOD', w: pageW * 0.26 },
  ];
  const rowX = (i) => lm + cols.slice(0, i).reduce((a, c) => a + c.w, 0);
  doc.font('Helvetica-Bold').fontSize(8).fillColor('#777');
  cols.forEach((c, i) => doc.text(c.label, rowX(i), y, { width: c.w - 6 }));
  y += 13;
  doc.moveTo(lm, y - 3).lineTo(lm + pageW, y - 3).lineWidth(0.8).strokeColor(SLATE).stroke();

  for (const s of sheet.specifications) {
    const cells = [s.test_type || '—', specText(s), s.method || '—'];
    const h = Math.max(...cells.map((t, i) => doc.font('Helvetica').fontSize(8.5).heightOfString(String(t), { width: cols[i].w - 6 }))) + 6;
    if (y + h > doc.page.height - doc.page.margins.bottom) { doc.addPage(); y = doc.page.margins.top; }
    doc.font('Helvetica').fontSize(8.5).fillColor('#111');
    cells.forEach((t, i) => doc.text(String(t), rowX(i), y, { width: cols[i].w - 6 }));
    y += h;
    doc.moveTo(lm, y - 3).lineTo(lm + pageW, y - 3).lineWidth(0.4).strokeColor(RULE).stroke();
  }

  y += 8;
  doc.font('Helvetica-Oblique').fontSize(7.5).fillColor('#999')
    .text(`${sheet.specifications.length} specification${sheet.specifications.length === 1 ? '' : 's'} · Powder Ops FSQA · generated ${new Date().toLocaleString('en-US')}`, lm, y, { width: pageW });
  doc.end();
});

// ──────────────── Vendor Lot Lookup ────────────────

router.get('/lot-lookup', (req, res) => {
  const db = getDb();
  const { lot, manufacturer_lot, vendor_lot, item_number } = req.query;
  if (!lot && !manufacturer_lot && !vendor_lot) {
    return res.status(400).json({ error: 'Provide lot, manufacturer_lot, or vendor_lot to search' });
  }

  let sql = 'SELECT * FROM coa_requests WHERE 1=1';
  const params = [];

  if (lot) {
    sql += ' AND (lot_number = ? OR manufacturer_lot = ? OR vendor_lot = ?)';
    params.push(lot, lot, lot);
  }
  if (manufacturer_lot) { sql += ' AND manufacturer_lot = ?'; params.push(manufacturer_lot); }
  if (vendor_lot) { sql += ' AND vendor_lot = ?'; params.push(vendor_lot); }
  if (item_number) { sql += ' AND item_number = ?'; params.push(item_number); }

  sql += ' ORDER BY date_sent DESC, created_at DESC';
  const matches = db.prepare(sql).all(...params);

  const tested = matches.length > 0;
  const passed = matches.some(r => r.status === 'pass');
  const failed = matches.some(r => r.status === 'fail');

  res.json({
    tested,
    passed,
    failed,
    total_matches: matches.length,
    matches,
    recommendation: !tested ? 'Lab testing required — no prior results for this lot.'
      : failed ? 'WARNING: Prior test FAILED for this lot. Re-test or reject.'
      : passed ? 'This lot has passed lab testing. No re-test needed.'
      : 'Tests exist but are still pending/in progress.',
  });
});

// ──────────────── Requests (main COA tracker) ────────────────

router.get('/requests', (req, res) => {
  const db = getDb();
  const { status, from, to, item_number, lot_number, lab_id, search } = req.query;
  let sql = 'SELECT * FROM coa_requests WHERE 1=1';
  const params = [];

  if (status && status !== 'all') { sql += ' AND status = ?'; params.push(status); }
  if (from) { sql += ' AND date_sent >= ?'; params.push(from); }
  if (to) { sql += ' AND date_sent <= ?'; params.push(to); }
  if (item_number) { sql += ' AND item_number = ?'; params.push(item_number); }
  if (lot_number) { sql += ' AND lot_number = ?'; params.push(lot_number); }
  if (lab_id) { sql += ' AND lab_id = ?'; params.push(lab_id); }
  if (search) {
    sql += ' AND (item_number LIKE ? OR item_description LIKE ? OR lot_number LIKE ? OR manufacturer_lot LIKE ? OR vendor_lot LIKE ? OR supplier LIKE ?)';
    const s = `%${search}%`;
    params.push(s, s, s, s, s, s);
  }

  // Bounded like the other logs. It also protects the file-count lookup below,
  // which expands to one bound parameter per request — unbounded, that query
  // grew a placeholder list as long as the whole table.
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 500, 1), 5000);
  // THE HONEST TOTAL, counted with the same filters and no limit. The bound
  // above is right — 1,391 imported requests is megabytes to a phone — but a
  // list that silently stops at 500 reads as data that was never imported,
  // which is exactly how it was reported ("were some left out of the Monday
  // export?"). Nothing was: the screen only ever asked for the first 500.
  const total = db.prepare(sql.replace('SELECT *', 'SELECT COUNT(*) c')).get(...params).c;
  sql += ' ORDER BY date_sent DESC, created_at DESC LIMIT ?';
  params.push(limit);
  const requests = db.prepare(sql).all(...params);

  const fileCountStmt = db.prepare('SELECT request_id, file_type, COUNT(*) as count FROM coa_files WHERE request_id IN (' + requests.map(() => '?').join(',') + ') GROUP BY request_id, file_type');
  const fileCounts = requests.length > 0 ? fileCountStmt.all(...requests.map(r => r.id)) : [];
  const fileMap = {};
  for (const fc of fileCounts) {
    if (!fileMap[fc.request_id]) fileMap[fc.request_id] = {};
    fileMap[fc.request_id][fc.file_type] = fc.count;
  }

  // `{ requests, total, shown }` rather than a bare array, the same shape the
  // draft-specifications endpoint uses, so the screen can say what it is
  // showing you out of what exists.
  res.json({
    requests: requests.map(r => ({ ...r, file_counts: fileMap[r.id] || {} })),
    total,
    shown: requests.length,
    limit,
  });
});

/* ── Asking the lab to collect ────────────────────────────────────────────────
 *
 * Declared BEFORE '/requests/:id' — Express matches in declaration order and
 * "submission" is a perfectly good :id. Same trap as /master.csv and PUT
 * /org/meta, both of which shipped dead.
 *
 * Two endpoints on purpose. `preview` WRITES NOTHING, so somebody can look at
 * what is about to go to an outside laboratory before it counts as sent;
 * `submission` composes the same text and files the requests as sent. A
 * preview computed differently from the thing that commits is a preview that
 * lies, so both call `build()`.
 */
function buildSubmission(db, ids, { processing, releasedBy }) {
  const rows = ids.map(id => db.prepare('SELECT * FROM coa_requests WHERE id = ?').get(id)).filter(Boolean);
  if (!rows.length) return null;
  // The lab comes from the requests themselves when they agree; a submission
  // spanning two laboratories is refused by the caller rather than silently
  // addressed to one of them.
  const labIds = [...new Set(rows.map(r => r.lab_id).filter(Boolean))];
  const lab = labIds.length === 1 ? db.prepare('SELECT * FROM coa_labs WHERE id = ?').get(labIds[0]) : null;

  const specsByItem = {};
  for (const item of [...new Set(rows.map(r => r.item_number))]) {
    specsByItem[item] = db.prepare('SELECT * FROM coa_specifications WHERE item_number = ? AND is_active = 1')
      .all(item);
  }
  return { rows, labIds, ...composeSubmission({ lab, requests: rows, specsByItem, processing, releasedBy }) };
}

router.get('/requests/submission/options', (_req, res) => {
  res.json({ processing: PROCESSING });
});

router.post('/requests/submission/preview', (req, res) => {
  const db = getDb();
  const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];
  if (!ids.length) return res.status(400).json({ error: 'Pick at least one request.' });
  const built = buildSubmission(db, ids, { processing: req.body?.processing, releasedBy: req.user.name });
  if (!built) return res.status(404).json({ error: 'No such requests.' });
  const alreadySent = built.rows.filter(r => r.date_sent).map(r => ({ id: r.id, lot_number: r.lot_number, date_sent: r.date_sent }));
  res.json({
    subject: built.subject, to: built.to, lab_name: built.lab_name, text: built.text,
    samples: built.samples, warnings: built.warnings, already_sent: alreadySent,
    multiple_labs: built.labIds.length > 1 ? built.labIds.length : 0,
  });
});

router.post('/requests/submission', (req, res) => {
  const db = getDb();
  const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];
  if (!ids.length) return res.status(400).json({ error: 'Pick at least one request.' });
  const built = buildSubmission(db, ids, { processing: req.body?.processing, releasedBy: req.user.name });
  if (!built) return res.status(404).json({ error: 'No such requests.' });
  // One submission is one form with one Processing box and one lab address.
  // Composing across two laboratories would produce a document that is wrong
  // for both of them.
  if (built.labIds.length > 1) {
    return res.status(400).json({ error: 'Those requests are assigned to more than one laboratory. Submit one lab at a time.' });
  }
  // A request already sent is not re-sent by accident — date_sent drives the
  // turnaround clock and the expected-results date, and quietly restamping it
  // would hide a sample that has been out for three weeks.
  const resend = !!req.body?.resend;
  const skipped = resend ? [] : built.rows.filter(r => r.date_sent)
    .map(r => ({ id: r.id, lot_number: r.lot_number, reason: `Already sent ${r.date_sent}` }));
  const skip = new Set(skipped.map(s => s.id));
  const filing = built.rows.filter(r => !skip.has(r.id));

  const today = new Date().toISOString().slice(0, 10);
  const tx = db.transaction(() => {
    for (const r of filing) {
      const tat = r.tat_days || null;
      const expected = tat
        ? db.prepare("SELECT date(?, ?) d").get(today, `+${tat} days`).d
        : r.expected_results_date || null;
      db.prepare(`UPDATE coa_requests SET status = CASE WHEN status = 'pending' THEN 'sent' ELSE status END,
        date_sent = ?, expected_results_date = ?, updated_at = datetime('now') WHERE id = ?`)
        .run(today, expected, r.id);
    }
  });
  tx();
  // Audited individually as well as in summary — a batch action has to leave
  // the trail a manual one would.
  for (const r of filing) {
    logAudit(req.user, 'update', 'coa_request', r.id,
      { action: 'submitted_to_lab', lab: built.lab_name, processing: processingLabel(req.body?.processing), date_sent: today },
      r, db.prepare('SELECT * FROM coa_requests WHERE id = ?').get(r.id), `${r.item_number} lot ${r.lot_number}`);
  }
  logAudit(req.user, 'update', 'coa_request', null,
    { action: 'lab_submission_composed', samples: built.samples, sent: filing.length, skipped: skipped.length, lab: built.lab_name });

  res.json({
    subject: built.subject, to: built.to, lab_name: built.lab_name, text: built.text,
    samples: built.samples, warnings: built.warnings, sent: filing.length, skipped,
  });
});

router.get('/requests/:id', (req, res) => {
  const db = getDb();
  const request = db.prepare('SELECT * FROM coa_requests WHERE id = ?').get(req.params.id);
  if (!request) return res.status(404).json({ error: 'COA request not found' });

  const files = db.prepare('SELECT * FROM coa_files WHERE request_id = ? ORDER BY created_at DESC').all(req.params.id);
  const test_results = db.prepare('SELECT * FROM coa_test_results WHERE request_id = ? ORDER BY test_type').all(req.params.id);
  const specs = db.prepare('SELECT * FROM coa_specifications WHERE item_number = ? AND is_active = 1').all(request.item_number);

  res.json({ ...request, files, test_results, specifications: specs });
});

router.post('/requests', (req, res) => {
  const db = getDb();
  const { item_number, item_description, lot_number, product_expiration, tests_requested, lab_id, date_sent, tat_days, expected_results_date, requested_by, notes, origin, supplier, product_code, manufacturer_lot, vendor_lot, received_date } = req.body;

  if (!item_number || !item_description || !lot_number || !tests_requested) {
    return res.status(400).json({ error: 'item_number, item_description, lot_number, and tests_requested are required' });
  }

  let lab_name = null;
  if (lab_id) {
    const lab = db.prepare('SELECT name FROM coa_labs WHERE id = ?').get(lab_id);
    lab_name = lab?.name || null;
  }

  const id = uuid();
  const status = date_sent ? 'sent' : 'pending';

  db.prepare(`INSERT INTO coa_requests (id, item_number, item_description, lot_number, product_expiration, tests_requested, status, lab_id, lab_name, date_sent, tat_days, expected_results_date, requested_by, notes, created_by, origin, supplier, product_code, manufacturer_lot, vendor_lot, received_date)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, item_number, item_description, lot_number, product_expiration || null, tests_requested, status, lab_id || null, lab_name, date_sent || null, tat_days || null, expected_results_date || null, requested_by || req.user.name, notes || null, req.user.name, origin || null, supplier || null, product_code || null, manufacturer_lot || null, vendor_lot || null, received_date || null);

  const created = db.prepare('SELECT * FROM coa_requests WHERE id = ?').get(id);
  logAudit(req.user, 'create', 'coa_request', id, req.body, null, created);
  res.status(201).json(created);
});

router.put('/requests/:id', (req, res) => {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM coa_requests WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'COA request not found' });

  const updates = [];
  const values = [];

  for (const f of REQUEST_FIELDS) {
    if (req.body[f] !== undefined) {
      updates.push(`${f} = ?`);
      values.push(req.body[f]);
    }
  }

  if (req.body.lab_id && !req.body.lab_name) {
    const lab = db.prepare('SELECT name FROM coa_labs WHERE id = ?').get(req.body.lab_id);
    if (lab) {
      updates.push('lab_name = ?');
      values.push(lab.name);
    }
  }

  if (updates.length === 0) return res.status(400).json({ error: 'No fields to update' });

  updates.push("updated_at = datetime('now')");
  values.push(req.params.id);
  db.prepare(`UPDATE coa_requests SET ${updates.join(', ')} WHERE id = ?`).run(...values);

  const updated = db.prepare('SELECT * FROM coa_requests WHERE id = ?').get(req.params.id);
  logAudit(req.user, 'update', 'coa_request', req.params.id, req.body, existing, updated);
  res.json(updated);
});

// Bulk permanent delete of lab requests (with their test results + files).
// Admin only.
router.post('/requests/bulk-delete', requireRole('admin'), (req, res) => {
  const db = getDb();
  const { ids } = req.body;
  if (!Array.isArray(ids) || !ids.length) return res.status(400).json({ error: 'ids array is required' });
  const ph = ids.map(() => '?').join(',');
  const found = db.prepare(`SELECT id, certificate_number FROM coa_requests WHERE id IN (${ph})`).all(...ids);
  const tx = db.transaction(() => {
    db.prepare(`DELETE FROM coa_test_results WHERE request_id IN (${ph})`).run(...ids);
    db.prepare(`DELETE FROM coa_files WHERE request_id IN (${ph})`).run(...ids);
    db.prepare(`DELETE FROM coa_requests WHERE id IN (${ph})`).run(...ids);
  });
  tx();
  for (const r of found) logAudit(req.user, 'delete', 'coa_request', r.id, null, r, null);
  res.json({ deleted: found.length });
});

// Bulk status update for lab requests.
router.post('/requests/bulk-update', (req, res) => {
  const db = getDb();
  const { ids, patch } = req.body;
  if (!Array.isArray(ids) || !ids.length) return res.status(400).json({ error: 'ids array is required' });
  if (!patch || !patch.status) return res.status(400).json({ error: 'patch.status is required' });
  const ph = ids.map(() => '?').join(',');
  const info = db.prepare(`UPDATE coa_requests SET status=?, updated_at=datetime('now') WHERE id IN (${ph})`).run(patch.status, ...ids);
  logAudit(req.user, 'coa_requests_bulk_updated', 'coa_request', null, { count: info.changes, status: patch.status });
  res.json({ updated: info.changes });
});

// ──────────────── Test Results ────────────────

router.post('/requests/:id/results', (req, res) => {
  const db = getDb();
  const request = db.prepare('SELECT * FROM coa_requests WHERE id = ?').get(req.params.id);
  if (!request) return res.status(404).json({ error: 'COA request not found' });

  const { results } = req.body;
  if (!Array.isArray(results) || results.length === 0) {
    return res.status(400).json({ error: 'results array is required' });
  }

  const insert = db.prepare(`INSERT INTO coa_test_results (id, request_id, test_type, result_value, unit, specification_id, pass_fail, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);

  // One grader, one spec lookup, shared with the scan preview and the edit
  // path — a preview computed differently from the commit is a preview that
  // lies. `specIndex` matches "Total Aerobic Microbial Count (USP)" against a
  // spec written "Total Aerobic Plate Count"; exact string equality (what this
  // used to do) matched almost nothing on a real report.
  const specs = db.prepare('SELECT * FROM coa_specifications WHERE item_number = ? AND is_active = 1').all(request.item_number);
  const index = specIndex(specs);

  const tx = db.transaction((rows) => {
    const created = [];
    for (const r of rows) {
      const id = uuid();
      const spec = index.find(r.test_type);
      // gradeResult handles "<10", "Not Detected", "Absent in 25g" and the rest
      // of a real micro panel, which parseFloat could not — every one of those
      // used to land with no verdict at all.
      const { pass_fail } = gradeResult(r.result_value, spec, r.pass_fail || null);
      insert.run(id, req.params.id, r.test_type, r.result_value ?? null, r.unit || spec?.unit || null, spec?.id || null, pass_fail, r.notes || null);
      created.push(db.prepare('SELECT * FROM coa_test_results WHERE id = ?').get(id));
    }
    return created;
  });

  const created = tx(results);
  rollUpRequestStatus(db, req.params.id);

  logAudit(req.user, 'create', 'coa_test_results', req.params.id, { results }, null, created);
  res.status(201).json(created);
});

/**
 * The request's own pass/fail, derived from its results.
 *
 * Called after every write to a result — create, edit, delete. It used to run
 * only on create, so correcting a result left the request stuck on the verdict
 * the first entry produced.
 *
 * A result with NO verdict holds the request at pending rather than letting the
 * others carry it to a pass. An ungraded test is an open question, and a COA
 * that reads "pass" while one of its tests was never decided is exactly the
 * document that must not exist.
 */
function rollUpRequestStatus(db, requestId) {
  const all = db.prepare('SELECT pass_fail FROM coa_test_results WHERE request_id = ?').all(requestId);
  if (!all.length) return;
  const hasFail = all.some(r => r.pass_fail === 'fail');
  const allDecided = all.every(r => r.pass_fail === 'pass' || r.pass_fail === 'na');
  if (hasFail) {
    db.prepare("UPDATE coa_requests SET status = 'fail', date_of_results = COALESCE(date_of_results, date('now')), updated_at = datetime('now') WHERE id = ?").run(requestId);
  } else if (allDecided) {
    db.prepare("UPDATE coa_requests SET status = 'pass', date_of_results = COALESCE(date_of_results, date('now')), updated_at = datetime('now') WHERE id = ?").run(requestId);
  } else {
    // Back to pending: something is still undecided. Only ever moves a verdict
    // BACK, never invents one.
    db.prepare("UPDATE coa_requests SET status = CASE WHEN status IN ('pass','fail') THEN 'sent' ELSE status END, updated_at = datetime('now') WHERE id = ?").run(requestId);
  }
}

/**
 * Correct a logged result.
 *
 * This simply did not exist: a result could be created and deleted, never
 * edited. So a test that landed with no pass/fail — which, before the grader
 * above, was every micro test — could not be given one, and a mistyped value
 * meant deleting the row and losing that it had ever been entered.
 *
 * Re-grades from the value unless a verdict is set BY HAND, in which case the
 * hand-set one wins and is recorded as such: a person overruling the automatic
 * grade is a decision, and the reason it was made belongs in `notes`.
 */
router.put('/requests/:requestId/results/:id', (req, res) => {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM coa_test_results WHERE id = ? AND request_id = ?').get(req.params.id, req.params.requestId);
  if (!existing) return res.status(404).json({ error: 'Test result not found' });
  const request = db.prepare('SELECT * FROM coa_requests WHERE id = ?').get(req.params.requestId);
  if (!request) return res.status(404).json({ error: 'COA request not found' });

  const test_type = req.body.test_type !== undefined ? String(req.body.test_type || '').trim() : existing.test_type;
  if (!test_type) return res.status(400).json({ error: 'A test name is required.' });
  const result_value = req.body.result_value !== undefined ? req.body.result_value : existing.result_value;
  const notes = req.body.notes !== undefined ? (req.body.notes || null) : existing.notes;

  const specs = db.prepare('SELECT * FROM coa_specifications WHERE item_number = ? AND is_active = 1').all(request.item_number);
  const spec = specIndex(specs).find(test_type);

  // '' means "clear it and let the specification decide again"; a value means
  // the person is overruling. Anything else keeps what is already there.
  let pass_fail;
  if (req.body.pass_fail !== undefined) {
    const wanted = req.body.pass_fail === '' ? null : String(req.body.pass_fail);
    if (wanted && !['pass', 'fail', 'na'].includes(wanted)) {
      return res.status(400).json({ error: 'Pass/fail must be pass, fail or na.' });
    }
    pass_fail = wanted || gradeResult(result_value, spec, null).pass_fail;
  } else {
    pass_fail = gradeResult(result_value, spec, existing.pass_fail || null).pass_fail;
  }

  const unit = req.body.unit !== undefined ? (req.body.unit || null) : (existing.unit || spec?.unit || null);
  db.prepare(`UPDATE coa_test_results SET test_type = ?, result_value = ?, unit = ?, specification_id = ?, pass_fail = ?, notes = ? WHERE id = ?`)
    .run(test_type, result_value ?? null, unit, spec?.id || null, pass_fail, notes, req.params.id);

  rollUpRequestStatus(db, req.params.requestId);
  const updated = db.prepare('SELECT * FROM coa_test_results WHERE id = ?').get(req.params.id);
  logAudit(req.user, 'update', 'coa_test_result', req.params.id,
    { test_type, changed_pass_fail: existing.pass_fail !== pass_fail }, existing, updated);
  res.json(updated);
});

router.delete('/requests/:requestId/results/:id', (req, res) => {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM coa_test_results WHERE id = ? AND request_id = ?').get(req.params.id, req.params.requestId);
  if (!existing) return res.status(404).json({ error: 'Test result not found' });

  db.prepare('DELETE FROM coa_test_results WHERE id = ?').run(req.params.id);
  // The request's verdict is derived from its results, so removing one has to
  // re-derive it — otherwise a request keeps a 'fail' from a row that is gone.
  rollUpRequestStatus(db, req.params.requestId);
  logAudit(req.user, 'delete', 'coa_test_result', req.params.id, null, existing, null);
  res.json({ success: true });
});

// ──────────────── File Upload/Download ────────────────

/**
 * Read a lab report against an EXISTING request, and propose what it says.
 *
 * This is the gap behind "we uploaded the CTLA result and nothing populated":
 * `POST /requests/:id/files` stored the PDF and read nothing at all. The parser
 * existed, but only on `/parse-coa`, which is the flow that CREATES a request
 * from a PDF — it was never wired to the far more common act of attaching the
 * report to the request you already raised.
 *
 * WRITES NOTHING. It returns a proposal: the header fields it read beside what
 * the request currently says, and each test matched to the item's ACTIVE
 * specification with the pass/fail that spec would give it. Applying is a
 * second, deliberate act, because this is a compliance record and a parser
 * confidently overwriting one is the failure the whole review step exists to
 * prevent. Same shape as the controlled-document revision importer.
 *
 * The two honest failure reports matter as much as the happy path:
 *   · A PDF with no text layer is a PHOTOGRAPH of a report. Nothing can be read
 *     from it, and saying "0 fields found" would read as "the parser ran and
 *     your report is empty". It says the file is an image scan instead.
 *   · A test with no active specification is recorded WITHOUT a pass/fail and
 *     says so. A spec still sitting in drafts cannot grade anything (that is
 *     deliberate — see the drafts review), and silently returning no verdict is
 *     how a result nobody graded looks like a result that passed.
 */
router.post('/requests/:id/scan', coaUpload.single('file'), async (req, res) => {
  const db = getDb();
  const request = db.prepare('SELECT * FROM coa_requests WHERE id = ?').get(req.params.id);
  if (!request) return res.status(404).json({ error: 'COA request not found' });

  let buffer = req.file?.buffer || null;
  let sourceName = req.file?.originalname || null;
  // Or re-read a report already attached to this request, so a file uploaded
  // before this existed doesn't have to be uploaded again.
  if (!buffer && req.body?.file_id) {
    const f = db.prepare('SELECT * FROM coa_files WHERE id = ? AND request_id = ?').get(req.body.file_id, req.params.id);
    if (!f) return res.status(404).json({ error: 'That file is not attached to this request.' });
    const p = path.join(UPLOAD_DIR, f.filename);
    if (!existsSync(p)) return res.status(404).json({ error: 'The attached file is no longer on disk.' });
    buffer = readFileSync(p);
    sourceName = f.original_name;
  }
  if (!buffer) return res.status(400).json({ error: 'Upload a PDF, or name a file already attached to this request.' });

  let parsed;
  try {
    parsed = await pdfLines(buffer);
  } catch (err) {
    return res.status(400).json({ error: `Could not open that PDF: ${err.message}` });
  }

  const text = parsed.text || '';
  // A handful of stray characters is not a text layer. Below this the file is a
  // scanned image and there is nothing to extract, however good the parser is.
  const TEXT_LAYER_MIN = 40;
  if (text.replace(/\s/g, '').length < TEXT_LAYER_MIN) {
    return res.json({
      readable: false,
      reason: 'no_text_layer',
      message: 'This PDF has no text in it — it is a scanned image of the report, so nothing can be read out of it automatically. Ask the lab for the original PDF, or type the results in by hand.',
      source_name: sourceName,
      page_count: parsed.numpages,
      header: [], results: [], unmatched_specs: [],
    });
  }

  let extracted = parseCTLACoa(text);
  let read_by = 'patterns';
  let ai_error = null;

  /**
   * The columnar reader, for reports laid out as a table — which is all of them.
   *
   * `parseCTLACoa` wants "Label: value" on one line and a test name at the start
   * of a line. In a real CoA the label column and the value column arrive as
   * separate blocks, and the Result cell is glued to the front of the Analysis
   * cell with no separator ("<100Total Aerobic Microbial Count (USP)"). So it
   * matched nothing at all on CTLA's report — readable text, zero fields.
   *
   * Tried BEFORE the AI fallback because it is deterministic: the same file
   * gives the same answer every time, which is what you want reading something
   * that ends up on a compliance record.
   */
  //
  // IT ALWAYS RUNS, and the RICHER read wins. This used to be gated on the
  // pattern reader finding NOTHING — so one lucky row disabled it, and that
  // is exactly what happened: `parseCTLACoa`'s test list contains "Gluten",
  // the finished-good report has a line starting with that word, and a single
  // matched row made a twelve-test report look successfully read. Micro,
  // heavy metals and everything else were never looked for at all. A reader
  // that found 1 of 12 has not succeeded; "found something" is not the same
  // question as "found what was on the report".
  const columnarRows = (() => {
    try {
      const columnar = parseColumnarCoa(text);
      return foundSomething(columnar) ? columnar : null;
    } catch (e) {
      console.warn('[coa] columnar read failed:', e.message);
      return null;
    }
  })();
  if (columnarRows) {
    // Columnar header values WIN. It read the report's actual layout, while
    // the pattern reader guesses from one line at a time — and its guesses
    // were wrong in a way that mattered: it maps "Customer:" to supplier, so
    // a CoA offered "Powder Ops" as the material's supplier (the lab's
    // customer is US), pre-ticked, on a compliance record. It also leaves
    // dates as printed where the columnar reader stores ISO.
    extracted = { ...extracted, ...Object.fromEntries(Object.entries(columnarRows).filter(([k, v]) => k !== 'test_results' && v)) };
    // Same reason, stated once: our own name is never the supplier.
    if (columnarRows.lab_customer && extracted.supplier
      && String(extracted.supplier).trim().toLowerCase() === String(columnarRows.lab_customer).trim().toLowerCase()) {
      delete extracted.supplier;
    }
    // MERGED, not replaced. The two readers see different row shapes — the
    // columnar one reads the glued "0.008Arsenic" seam, the pattern one reads
    // a plain "Gluten <5 ppm" line — so on a report carrying both, taking
    // either wholesale drops real results. Union by test name, richer reader
    // wins a genuine collision.
    extracted.test_results = mergeTestRows(columnarRows.test_results, extracted.test_results);
    if (columnarRows.test_results.length) read_by = extracted.test_results.length > columnarRows.test_results.length ? 'columns+patterns' : 'columns';
  }

  /**
   * When the patterns find nothing, let a model read it.
   *
   * `parseCTLACoa` wants "Label: value" on one line and a test name with its
   * result beside it. A real CoA is a TABLE, and pdfjs returns a table as cells
   * in reading order — so a label and its value land on different lines and a
   * result sits several lines below its test name. That is why this report came
   * back with readable text and zero fields. No amount of extra regex
   * generalises across labs.
   *
   * Safe because of the step it feeds, not because the model is trusted: the
   * result is a PROPOSAL that a person ticks, exactly like the pattern reader's.
   * It is also only a FALLBACK — when the patterns do find the fields, they win,
   * because a deterministic reader gives the same answer every time.
   */
  //
  // FIRED ON AN INCOMPLETE READ, not only an empty one — same lesson as the
  // columnar gate above. The request says which tests were asked for, so
  // "did the readers find them" is an answerable question rather than a
  // guess: fewer rows than tests requested means something was missed, and a
  // missed heavy-metal result on a compliance record is the failure this
  // exists to prevent. The model's answer is still only taken when it is
  // RICHER than the deterministic read, which keeps the deterministic reader
  // in charge whenever it did the job.
  const requestedCount = splitRequestedTests(request.tests_requested).length;
  const foundCount = extracted.test_results?.length || 0;
  const looksIncomplete = foundCount === 0 || (requestedCount > 0 && foundCount < requestedCount);
  if (aiEnabled() && looksIncomplete) {
    try {
      const ai = await readLabReport({
        text: text.slice(0, 60000),
        itemHint: [request.item_number, request.item_description].filter(Boolean).join(' — '),
        expectedTests: splitRequestedTests(request.tests_requested),
      });
      // Keep anything the patterns did get; the model fills the gaps. Its
      // ROWS are taken only when there are more of them than the
      // deterministic read produced — a model that read fewer tests than the
      // columns did must not overwrite the better answer.
      const aiRows = (ai.test_results || []).length;
      extracted = {
        ...extracted,
        ...Object.fromEntries(Object.entries(ai).filter(([k, v]) => k !== 'test_results' && v && !extracted[k])),
        test_results: mergeTestRows(extracted.test_results || [], (ai.test_results || []).map(t => ({
          test_type: t.test_type,
          result_value: t.result_value,
          unit: t.unit || null,
          pass_fail: t.pass_fail || null,
          method: t.method || null,
          spec_on_report: t.spec_on_report || null,
        }))),
      };
      if (aiRows > foundCount) read_by = read_by === 'patterns' ? 'ai' : `${read_by}+ai`;
    } catch (e) {
      // Never fails the scan — the pattern result and the raw text still stand.
      ai_error = e.message;
    }
  }

  // Header fields, each shown against what the request already holds. A field
  // the request already answers is offered but never pre-ticked — an upload is
  // not a reason to rewrite what somebody keyed in.
  const HEADER_FIELDS = [
    ['item_number', 'Item #'], ['item_description', 'Item description'], ['lot_number', 'Lot #'],
    ['manufacturer_lot', 'Manufacturer lot'], ['vendor_lot', 'Vendor lot'], ['supplier', 'Supplier'],
    ['origin', 'Origin'], ['product_expiration', 'Expiration'], ['received_date', 'Received'],
    ['date_of_results', 'Date of results'], ['tests_requested', 'Tests requested'],
  ];
  const header = HEADER_FIELDS
    .filter(([key]) => extracted[key] != null && String(extracted[key]).trim() !== '')
    .map(([key, label]) => {
      const current = request[key] == null ? null : String(request[key]);
      const found = String(extracted[key]).trim();
      return {
        key, label, found, current,
        changes: (current || '') !== found,
        // Filling a blank is the safe case and is the only one pre-ticked.
        suggested: !current,
      };
    });

  // Grade each extracted test against the item's ACTIVE specs — the same lookup
  // and the same comparison POST /results uses, so the preview cannot promise a
  // verdict the write would not give.
  const specs = db.prepare('SELECT * FROM coa_specifications WHERE item_number = ? AND is_active = 1').all(request.item_number);
  const index = specIndex(specs);
  const draftSpecs = db.prepare(
    "SELECT test_type FROM coa_specifications WHERE item_number = ? AND is_active = 0 AND COALESCE(approval_status,'approved') = 'draft'").all(request.item_number);
  const draftIndex = specIndex(draftSpecs);

  const results = (extracted.test_results || []).map(t => {
    const spec = index.find(t.test_type);
    const graded = gradeResult(t.result_value, spec, t.pass_fail || null);
    return {
      test_type: t.test_type,
      result_value: t.result_value,
      unit: t.unit || spec?.unit || null,
      method: t.method || null,
      spec_on_report: t.spec_on_report || null,
      specification_id: spec?.id || null,
      specification: spec ? (spec.specification || null) : null,
      pass_fail: graded.pass_fail,
      graded_by: graded.graded_by,
      // Why a result carries no verdict, always named — an empty cell reads as
      // a pass to anyone skimming.
      grade_reason: graded.reason,
      no_spec_reason: spec ? null
        : draftIndex.find(t.test_type)
          ? 'A specification for this test exists but is still a DRAFT. Approve it in the Specifications tab and this result will grade itself.'
          : 'No specification on file for this test, so it will be recorded without a pass/fail.',
      suggested: true,
    };
  });

  // Specs the item HAS that this report says nothing about — the tests someone
  // expected to see. Worth naming: a missing test reads as a passed one.
  const reportedIndex = specIndex((extracted.test_results || []).map(t => ({ test_type: t.test_type })));
  const unmatched_specs = specs
    .filter(s => !reportedIndex.find(s.test_type))
    .map(s => ({ test_type: s.test_type, specification: s.specification || null }));

  res.json({
    readable: true,
    source_name: sourceName,
    page_count: parsed.numpages,
    read_by,
    ai_available: aiEnabled(),
    ai_error,
    header,
    results,
    unmatched_specs,
    // So a report the reader could not make sense of is diagnosable rather than
    // just disappointing. Bounded — the client only shows it on request.
    raw_text: text.slice(0, 20000),
    message: results.length === 0
      ? (aiEnabled()
        ? 'The PDF has readable text, but neither the pattern reader nor the AI reader found test results in it. The extracted text is below so it can be checked — results can still be entered by hand.'
        : 'The PDF has readable text, but no test results matched the patterns this reader knows, and AI reading is not configured on this server. The extracted text is below — results can still be entered by hand.')
      : null,
  });
});

/** The requested-tests string as a list, for the reader's benefit only. */
/**
 * One list of test rows from two readers.
 *
 * Keyed on a normalized test name so "E.Coli BAM (MOD)" and "E. coli BAM
 * (MOD)" are one row, not two. `primary` wins a collision — it is the reader
 * that understood the report's layout — and anything only the other reader
 * saw is kept rather than dropped, because a missing result on a compliance
 * record is the failure that matters here.
 */
// Only the METHOD text may hang off the end of a name for the two to be the
// same test. A bare prefix rule is not safe here and the vitamin panel proves
// it: "Vitamin B1" is a prefix of "Vitamin B12", and "Lead" of "Lead
// (dietary)" — dropping the longer one would lose a real result, which is the
// failure this merge exists to prevent. So the remainder has to look like the
// lab's method/specification cell, not like more test name.
// The tail must BEGIN with a method word. A tail that starts with a digit is
// part of the test's name, not the lab's method — "Vitamin B1" vs "Vitamin
// B12", "Zone 1" vs "Zone 12" — and merging those loses a real result.
const METHOD_WORD = '(?:report|result|spec|specification|usp|bam|ch|mod|aoac|iso|icpms|icp|hplc|gcms|lcms|gc|ms|elisa|method|limit)';
const METHOD_TAIL_ONLY = new RegExp(`^${METHOD_WORD}(?:${METHOD_WORD}|[0-9<>.]|ppm|ppb|cfu|g|ml|na)*$`);

function mergeTestRows(primary = [], secondary = []) {
  const key = (t) => String(t?.test_type || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
  const sameTest = (a, b) => {
    if (a === b) return true;
    const [short, long] = a.length <= b.length ? [a, b] : [b, a];
    if (!long.startsWith(short)) return false;
    return METHOD_TAIL_ONLY.test(long.slice(short.length));
  };
  const out = [];
  const seen = [];
  for (const row of [...primary, ...secondary]) {
    const k = key(row);
    if (!k) continue;
    // The crude reader keeps the method text glued to the name ("Total
    // Aerobic Microbial Count (USP) Report USP <"), so an exact-match dedupe
    // would file it as a SECOND test carrying the method number as its
    // result — the same row twice, once right and once wrong.
    if (seen.some(s => sameTest(s, k))) continue;
    seen.push(k);
    out.push(row);
  }
  return out;
}

function splitRequestedTests(s) {
  return String(s || '').split(/[,;\n]+/).map(t => t.trim()).filter(Boolean).slice(0, 40);
}

router.post('/requests/:id/files', upload.single('file'), (req, res) => {
  const db = getDb();
  const request = db.prepare('SELECT * FROM coa_requests WHERE id = ?').get(req.params.id);
  if (!request) {
    if (req.file) unlinkSync(req.file.path);
    return res.status(404).json({ error: 'COA request not found' });
  }

  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  const file_type = req.body.file_type || 'other';
  const id = uuid();
  db.prepare('INSERT INTO coa_files (id, request_id, file_type, filename, original_name, mime_type, size_bytes, uploaded_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, req.params.id, file_type, req.file.filename, req.file.originalname, req.file.mimetype, req.file.size, req.user.name);

  const created = db.prepare('SELECT * FROM coa_files WHERE id = ?').get(id);
  logAudit(req.user, 'upload', 'coa_file', id, { file_type, original_name: req.file.originalname }, null, created);
  res.status(201).json(created);
});

router.get('/files/:id/download', (req, res) => {
  const db = getDb();
  const file = db.prepare('SELECT * FROM coa_files WHERE id = ?').get(req.params.id);
  if (!file) return res.status(404).json({ error: 'File not found' });

  const filePath = path.join(UPLOAD_DIR, file.filename);
  if (!existsSync(filePath)) return res.status(404).json({ error: 'File not found on disk' });

  const stat = statSync(filePath);
  res.setHeader('Content-Length', stat.size);
  res.setHeader('Content-Type', file.mime_type || 'application/octet-stream');
  const safeName = (file.original_name || 'download').replace(/["\r\n]/g, '_');
  res.setHeader('Content-Disposition', `attachment; filename="${safeName}"`);
  createReadStream(filePath).pipe(res);
});

router.delete('/files/:id', (req, res) => {
  const db = getDb();
  const file = db.prepare('SELECT * FROM coa_files WHERE id = ?').get(req.params.id);
  if (!file) return res.status(404).json({ error: 'File not found' });

  const filePath = path.join(UPLOAD_DIR, file.filename);
  db.prepare('DELETE FROM coa_files WHERE id = ?').run(req.params.id);
  if (existsSync(filePath)) unlinkSync(filePath);
  logAudit(req.user, 'delete', 'coa_file', req.params.id, null, file, null);
  res.json({ success: true });
});

// ──────────────── Digital QA sign-off ────────────────
// Maria (QA) signs the certificate in-app: the signature image (drawn once,
// reusable) is snapshotted onto the request so the issued PDF carries it —
// no print/sign/scan loop. Admins can remove a signature if signed in error.
const SIGNATURE_RE = /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/;
const canSignCoa = (u) => !!u && (['admin', 'supervisor'].includes(u.role) || u.department === 'qa');

router.post('/requests/:id/sign', (req, res) => {
  if (!canSignCoa(req.user)) return res.status(403).json({ error: 'Only admins, supervisors, or QA can sign certificates.' });
  const db = getDb();
  const r = db.prepare('SELECT * FROM coa_requests WHERE id = ?').get(req.params.id);
  if (!r) return res.status(404).json({ error: 'COA request not found' });

  let sig = req.body?.signature || null;
  if (!sig) sig = db.prepare('SELECT signature_image FROM users WHERE id = ?').get(req.user.id)?.signature_image || null;
  if (!sig) return res.status(400).json({ error: 'Draw a signature first (it can be saved for next time).' });
  if (typeof sig !== 'string' || sig.length > 400000 || !SIGNATURE_RE.test(sig)) {
    return res.status(400).json({ error: 'Signature must be a PNG/JPEG data URL under 300 KB.' });
  }
  if (req.body?.save) {
    db.prepare("UPDATE users SET signature_image = ?, updated_at = datetime('now') WHERE id = ?").run(sig, req.user.id);
  }

  // Issuing details lock in at signing: certificate number and issuance date.
  const certNum = r.certificate_number || nextCertNumber(db);
  const today = new Date().toISOString().slice(0, 10);
  db.prepare(`UPDATE coa_requests SET qa_signed_by = ?, qa_signed_by_id = ?, qa_signed_at = datetime('now'),
              qa_signature = ?, certificate_number = ?, date_of_issuance = COALESCE(date_of_issuance, ?),
              updated_at = datetime('now') WHERE id = ?`)
    .run(req.user.name, req.user.id, sig, certNum, today, req.params.id);
  logAudit(req.user, 'sign', 'coa_request', req.params.id,
    { certificate_number: certNum, attestation: 'I certify that the results on this Certificate of Analysis are true and accurate as obtained for the lot identified.' },
    null, null, `${r.item_description} · Lot ${r.lot_number}`);
  res.json(db.prepare('SELECT * FROM coa_requests WHERE id = ?').get(req.params.id));
});

router.delete('/requests/:id/sign', requireRole('admin'), (req, res) => {
  const db = getDb();
  const r = db.prepare('SELECT * FROM coa_requests WHERE id = ?').get(req.params.id);
  if (!r) return res.status(404).json({ error: 'COA request not found' });
  db.prepare("UPDATE coa_requests SET qa_signed_by = NULL, qa_signed_by_id = NULL, qa_signed_at = NULL, qa_signature = NULL, updated_at = datetime('now') WHERE id = ?").run(req.params.id);
  logAudit(req.user, 'unsign', 'coa_request', req.params.id, { previous_signer: r.qa_signed_by }, null, null, `${r.item_description} · Lot ${r.lot_number}`);
  res.json({ ok: true });
});

// ──────────────── PDF Export (Facility COA) ────────────────

router.get('/requests/:id/pdf', (req, res) => {
  const db = getDb();
  const r = db.prepare('SELECT * FROM coa_requests WHERE id = ?').get(req.params.id);
  if (!r) return res.status(404).json({ error: 'COA request not found' });

  const testResults = db.prepare('SELECT * FROM coa_test_results WHERE request_id = ? ORDER BY test_type').all(req.params.id);

  const certNum = r.certificate_number || nextCertNumber(db);
  if (!r.certificate_number) {
    db.prepare("UPDATE coa_requests SET certificate_number = ?, updated_at = datetime('now') WHERE id = ?").run(certNum, req.params.id);
  }

  // Specification + method come from the COA Specifications registry: by the
  // result's explicit specification_id when set, else the active spec for
  // this item + test type.
  const specById = {};
  const specByItemTest = {};
  try {
    for (const s of db.prepare('SELECT * FROM coa_specifications WHERE is_active = 1').all()) {
      specById[s.id] = s;
      specByItemTest[`${s.item_number}|${(s.test_type || '').toLowerCase()}`] = s;
    }
  } catch { /* optional */ }
  const specFor = (tr) => specById[tr.specification_id] || specByItemTest[`${r.item_number}|${(tr.test_type || '').toLowerCase()}`] || null;

  const today = new Date().toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' });
  const fmtDate = (d) => {
    if (!d) return 'N/A';
    const parts = String(d).slice(0, 10).split('-');
    if (parts.length === 3) return `${parts[1]}/${parts[2]}/${parts[0]}`;
    return d;
  };

  const SLATE = '#3a3a3a';
  const ORANGE = '#c65d35';
  const LIGHT = '#f5f3f1';
  const RULE = '#d8d4d0';
  const GREEN = '#1a7f37';
  const RED = '#cc0000';

  const doc = new PDFDocument({ size: 'LETTER', margins: { top: 42, bottom: 76, left: 50, right: 50 }, bufferPages: true });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="COA_${certNum}_${(r.item_description || 'item').replace(/[^a-zA-Z0-9]/g, '_')}.pdf"`);
  doc.pipe(res);

  const lm = doc.page.margins.left;
  const pageW = doc.page.width - lm - doc.page.margins.right;
  const bottomY = () => doc.page.height - doc.page.margins.bottom;

  // ── Header: real logo + company block + certificate number ──
  const logoH = 74;
  try { doc.image(LOGO_PATH, lm, 42, { height: logoH }); } catch { /* logo optional */ }
  doc.font('Helvetica-Bold').fontSize(15).fillColor(SLATE).text('POWDER OPS', lm + 75, 50, { characterSpacing: 0.5 });
  doc.font('Helvetica').fontSize(8.5).fillColor('#666')
    .text('281 E 1600 N, Vineyard, UT 84059', lm + 75, 69)
    .text('www.powder-ops.com', lm + 75, 81);
  doc.font('Helvetica').fontSize(8.5).fillColor('#666').text('Certificate No.', lm, 50, { width: pageW, align: 'right' });
  doc.font('Helvetica-Bold').fontSize(12).fillColor(SLATE).text(String(certNum), lm, 61, { width: pageW, align: 'right' });

  let y = 42 + logoH + 18;
  doc.font('Helvetica-Bold').fontSize(17).fillColor(SLATE)
    .text('CERTIFICATE OF ANALYSIS', lm, y, { width: pageW, align: 'center', characterSpacing: 1 });
  y += 24;
  doc.moveTo(lm, y).lineTo(lm + pageW, y).lineWidth(2).strokeColor(ORANGE).stroke();
  y += 14;

  // ── Sample information grid ──
  const na = (v) => v || 'N/A';
  const info = [
    ['Product Name', na(r.item_description), 'Supplier', na(r.supplier)],
    ['Lot Number', na(r.lot_number), 'Vendor Lot', na(r.vendor_lot)],
    ['Product Code', na(r.product_code || r.item_number), 'Manufacturer Lot', na(r.manufacturer_lot)],
    ['Date Received', fmtDate(r.received_date || r.date_sent), 'Origin', r.origin || 'United States'],
    ['Date of Analysis', fmtDate(r.date_of_results), 'Expiration Date', fmtDate(r.product_expiration)],
  ];
  const halfW = pageW / 2;
  const labW = 105;
  doc.fontSize(8.5);

  // EACH ROW IS AS TALL AS ITS TALLEST CELL, measured — not a fixed 16pt.
  //
  // A long product name ("Raspberry Cheesecake Whey Protein Stick") wraps to two
  // lines in the value column, but the row advanced by a constant, so the second
  // line was drawn on top of the next row's label and the rule was struck
  // through the middle of it. The results table below has always measured with
  // heightOfString; the header block simply never did. This is a Certificate of
  // Analysis that goes to a customer, so overlapping text is not cosmetic — it
  // makes the product name unreadable on the document that identifies the lot.
  const valW1 = halfW - labW - 10;
  const valW2 = halfW - labW;
  for (const [l1, v1, l2, v2] of info) {
    // Labels are short and never wrap, but they are measured too — a label that
    // grows later must not reintroduce this.
    doc.font('Helvetica-Bold');
    const labH = Math.max(
      doc.heightOfString(l1.toUpperCase(), { width: labW }),
      doc.heightOfString(l2.toUpperCase(), { width: labW }),
    );
    doc.font('Helvetica');
    const valH = Math.max(
      doc.heightOfString(v1 || ' ', { width: valW1 }),
      doc.heightOfString(v2 || ' ', { width: valW2 }),
    );
    const rowH = Math.max(16, Math.max(labH, valH) + 5);

    doc.font('Helvetica-Bold').fillColor('#777').text(l1.toUpperCase(), lm, y, { width: labW });
    doc.font('Helvetica').fillColor('#111').text(v1, lm + labW, y, { width: valW1 });
    doc.font('Helvetica-Bold').fillColor('#777').text(l2.toUpperCase(), lm + halfW, y, { width: labW });
    doc.font('Helvetica').fillColor('#111').text(v2, lm + halfW + labW, y, { width: valW2 });
    y += rowH;
    doc.moveTo(lm, y - 4).lineTo(lm + pageW, y - 4).lineWidth(0.4).strokeColor(RULE).stroke();
  }
  y += 8;

  // ── Results table ──
  const cols = [
    { label: 'Analysis', w: 158 },
    { label: 'Method', w: 82 },
    { label: 'Specification', w: 92 },
    { label: 'Result', w: 62 },
    { label: 'Units', w: 48 },
    { label: 'Pass / Fail', w: pageW - 158 - 82 - 92 - 62 - 48, center: true },
  ];
  function tableHeader() {
    let x = lm;
    doc.rect(lm, y, pageW, 20).fill(SLATE);
    doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#fff');
    for (const c of cols) { doc.text(c.label, x + 6, y + 6, { width: c.w - 12, align: c.center ? 'center' : 'left' }); x += c.w; }
    y += 20;
  }
  const ensureSpace = (h) => { if (y + h > bottomY()) { doc.addPage(); y = doc.page.margins.top; tableHeader(); } };
  function sectionBand(title) {
    ensureSpace(60);
    doc.rect(lm, y, pageW, 16).fill(LIGHT);
    doc.font('Helvetica-Bold').fontSize(8.5).fillColor(ORANGE).text(title.toUpperCase(), lm + 6, y + 4, { characterSpacing: 0.6 });
    y += 16;
  }
  let zebra = false;
  function resultRow(tr) {
    const spec = specFor(tr);
    const vals = [
      tr.test_type || '',
      spec?.method || tr.notes || '',
      spec?.specification || '',
      tr.result_value || '',
      tr.unit || spec?.unit || '',
    ];
    doc.font('Helvetica').fontSize(8.2);
    let maxH = 0;
    for (let i = 0; i < 5; i++) maxH = Math.max(maxH, doc.heightOfString(vals[i] || ' ', { width: cols[i].w - 12 }));
    const rh = Math.max(17, maxH + 10);
    ensureSpace(rh);
    if (zebra) doc.rect(lm, y, pageW, rh).fill('#fafafa');
    zebra = !zebra;
    let x = lm;
    doc.font('Helvetica').fontSize(8.2).fillColor('#111');
    for (let i = 0; i < 5; i++) { doc.text(vals[i], x + 6, y + 5, { width: cols[i].w - 12 }); x += cols[i].w; }
    const pf = tr.pass_fail === 'pass' ? 'PASS' : tr.pass_fail === 'fail' ? 'FAIL' : 'N/A';
    doc.font('Helvetica-Bold').fillColor(pf === 'PASS' ? GREEN : pf === 'FAIL' ? RED : '#666')
      .text(pf, x + 6, y + 5, { width: cols[5].w - 12, align: 'center' });
    doc.moveTo(lm, y + rh).lineTo(lm + pageW, y + rh).lineWidth(0.4).strokeColor(RULE).stroke();
    y += rh;
  }

  const lc = (s) => (s || '').toLowerCase();
  const microTests = testResults.filter(t => /micro|coli|salmonella|yeast|aerobic|staph|mold|listeria|entero/.test(lc(t.test_type)));
  const hmTests = testResults.filter(t => /arsenic|cadmium|mercury|lead|heavy metal/.test(lc(t.test_type)));
  const otherTests = testResults.filter(t => !microTests.includes(t) && !hmTests.includes(t));

  tableHeader();
  if (microTests.length) { sectionBand('Complete Micro'); microTests.forEach(resultRow); }
  if (hmTests.length) { sectionBand('Heavy Metals'); hmTests.forEach(resultRow); }
  if (otherTests.length) { sectionBand(microTests.length || hmTests.length ? 'Other Tests' : 'Test Results'); otherTests.forEach(resultRow); }
  if (testResults.length === 0) {
    y += 12;
    doc.fontSize(9).font('Helvetica').fillColor('#666')
      .text('No test results recorded. Add test results to generate a complete COA.', lm, y, { width: pageW, align: 'center' });
    y += 24;
  }

  // ── Certification + signature ──
  if (y + 130 > bottomY()) { doc.addPage(); y = doc.page.margins.top; }
  y += 14;
  doc.font('Helvetica').fontSize(7.6).fillColor('#444');
  doc.text('The undersigned certifies that the results above are true and accurate as obtained by the referenced methods for the lot identified. This certificate accompanies the original item to ensure authenticity; reproduction without written consent is prohibited.', lm, y, { width: pageW, lineGap: 2 });
  y += 40;

  const sigW = 200;
  // Digital signature applied in-app (snapshot taken at signing time).
  if (r.qa_signature) {
    try {
      const b64 = r.qa_signature.split(',')[1];
      doc.image(Buffer.from(b64, 'base64'), lm + 10, y - 14, { fit: [sigW - 20, 34] });
    } catch { /* corrupt image — leave line blank */ }
  }
  doc.moveTo(lm, y + 22).lineTo(lm + sigW, y + 22).lineWidth(0.8).strokeColor('#999').stroke();
  doc.font('Helvetica-Bold').fontSize(8.5).fillColor(SLATE)
    .text(r.qa_signed_by ? `${r.qa_signed_by} — Quality` : 'Quality', lm, y + 27);
  doc.font('Helvetica').fontSize(8).fillColor('#666')
    .text(r.qa_signed_at ? `Digitally signed ${fmtDate(r.qa_signed_at)}` : 'Powder Ops Quality Assurance', lm, y + 38);

  doc.moveTo(lm + pageW - sigW, y + 22).lineTo(lm + pageW, y + 22).lineWidth(0.8).strokeColor('#999').stroke();
  doc.font('Helvetica-Bold').fontSize(8.5).fillColor(SLATE).text('Date of Issuance', lm + pageW - sigW, y + 27);
  doc.font('Helvetica').fontSize(8).fillColor('#666').text(fmtDate(r.date_of_issuance) === 'N/A' ? today : fmtDate(r.date_of_issuance), lm + pageW - sigW, y + 38);

  // ── Footer on every page (page count known once all pages exist) ──
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    const keepBottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    const fy = doc.page.height - 58;
    doc.moveTo(lm, fy).lineTo(lm + pageW, fy).lineWidth(0.5).strokeColor(RULE).stroke();
    doc.font('Helvetica').fontSize(6.8).fillColor('#888');
    doc.text('This Certificate of Analysis represents data for the sample submitted and does not constitute a guarantee of quality for the entire lot from which it was taken.', lm, fy + 6, { width: pageW, align: 'center', lineBreak: false });
    doc.text(`Powder Ops  ·  281 E 1600 N, Vineyard, UT 84059  ·  ${certNum}  ·  Page ${i - range.start + 1} of ${range.count}`, lm, fy + 18, { width: pageW, align: 'center', lineBreak: false });
    doc.page.margins.bottom = keepBottom;
  }

  doc.end();
});

// ──────────────── Summary / Stats ────────────────

router.get('/summary', (_req, res) => {
  const db = getDb();
  const totals = db.prepare(`SELECT
    COUNT(*) as total_requests,
    SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
    SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END) as sent,
    SUM(CASE WHEN status = 'pass' THEN 1 ELSE 0 END) as passed,
    SUM(CASE WHEN status = 'fail' THEN 1 ELSE 0 END) as failed,
    SUM(CASE WHEN status = 'hold' THEN 1 ELSE 0 END) as on_hold,
    SUM(CASE WHEN status = 're_test' THEN 1 ELSE 0 END) as retest,
    SUM(CASE WHEN status = 'na' THEN 1 ELSE 0 END) as na
  FROM coa_requests`).get();

  const by_lab = db.prepare(`SELECT lab_name, COUNT(*) as count FROM coa_requests WHERE lab_name IS NOT NULL GROUP BY lab_name ORDER BY count DESC`).all();
  const by_test = db.prepare(`SELECT tests_requested, COUNT(*) as count FROM coa_requests GROUP BY tests_requested ORDER BY count DESC LIMIT 10`).all();
  const recent_failures = db.prepare(`SELECT * FROM coa_requests WHERE status = 'fail' ORDER BY date_of_results DESC LIMIT 5`).all();
  const awaiting_results = db.prepare(`SELECT * FROM coa_requests WHERE status = 'sent' ORDER BY expected_results_date ASC LIMIT 10`).all();

  res.json({ totals, by_lab, by_test, recent_failures, awaiting_results });
});

// ──────────────── Bulk Import ────────────────

router.post('/import', requireRole('admin', 'supervisor'), (req, res) => {
  const db = getDb();
  const { entries, source } = req.body;
  if (!Array.isArray(entries) || entries.length === 0) {
    return res.status(400).json({ error: 'entries array is required' });
  }

  let ctlaLab = db.prepare("SELECT id FROM coa_labs WHERE name = 'CTLA'").get();
  if (!ctlaLab) {
    const labId = uuid();
    db.prepare("INSERT INTO coa_labs (id, name) VALUES (?, 'CTLA')").run(labId);
    ctlaLab = { id: labId };
  }

  const insert = db.prepare(`INSERT INTO coa_requests (id, item_number, item_description, lot_number, product_expiration, tests_requested, status, lab_id, lab_name, date_sent, tat_days, expected_results_date, date_of_results, date_sent_to_customer, requested_by, invoice_amount, retest_required, notes, source, source_ref, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);

  const statusMap = { 'PASS': 'pass', 'FAIL': 'fail', 'HOLD': 'hold', 'RE-TEST': 're_test', 'N/A': 'na', 'NA': 'na' };

  const tx = db.transaction((rows) => {
    let imported = 0;
    let skipped = 0;
    for (const e of rows) {
      if (!e.item_number || !e.item_description) { skipped++; continue; }

      const existing = db.prepare('SELECT id FROM coa_requests WHERE item_number = ? AND lot_number = ? AND source_ref = ?')
        .get(e.item_number, e.lot_number || '', e.source_ref || e.item_number);
      if (existing) { skipped++; continue; }

      const id = uuid();
      const status = statusMap[e.status?.toUpperCase()] || 'pending';
      const labName = e.lab_name || 'CTLA';
      const labId = labName === 'CTLA' ? ctlaLab.id : null;

      insert.run(
        id, e.item_number, e.item_description, e.lot_number || '', e.product_expiration || null,
        e.tests_requested || 'Unknown', status, labId, labName,
        e.date_sent || null, e.tat_days || null, e.expected_results_date || null,
        e.date_of_results || null, e.date_sent_to_customer || null,
        e.requested_by || null, e.invoice_amount || null,
        e.retest_required ? 1 : 0, e.notes || null,
        source || 'import', e.source_ref || e.item_number, req.user.name
      );
      imported++;
    }
    return { imported, skipped };
  });

  try {
    const result = tx(entries);
    logAudit(req.user, 'import', 'coa_requests', null, { count: result.imported, source }, null, null);
    res.status(201).json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ──────────────── CTLA COA PDF Parser ────────────────

function parseCTLACoa(text) {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  const result = {
    item_description: null,
    lot_number: null,
    manufacturer_lot: null,
    vendor_lot: null,
    item_number: null,
    product_code: null,
    supplier: null,
    origin: null,
    product_expiration: null,
    received_date: null,
    date_of_results: null,
    tests_requested: null,
    status: null,
    test_results: [],
  };

  const patterns = {
    item_description: [/Product\s*(?:Name|Description)\s*[:-]\s*(.+)/i, /Sample\s*(?:Name|Description|ID)\s*[:-]\s*(.+)/i, /Material\s*[:-]\s*(.+)/i],
    lot_number: [/(?:Lot|Batch)\s*(?:#|No\.?|Number)\s*[:-]\s*([A-Za-z0-9_.-]+)/i, /^Lot\s*[:-]\s*([A-Za-z0-9_.-]+)/i],
    manufacturer_lot: [/(?:Manufacturer|Mfg|Mfr)(?:'?s?)?\s*Lot\s*(?:#|No\.?|Number)?\s*[:-]\s*([A-Za-z0-9_.-]+)/i],
    vendor_lot: [/Vendor\s*Lot\s*(?:#|No\.?|Number)?\s*[:-]\s*([A-Za-z0-9_.-]+)/i],
    item_number: [/(?:Item|Product|Part)\s*(?:#|No\.?|Number|Code)\s*[:-]\s*([A-Za-z0-9_.-]+)/i, /(?:SKU|UPC|NDC)\s*[:-]\s*([A-Za-z0-9_.-]+)/i],
    supplier: [/(?:Supplier|Manufacturer|Client|Customer)\s*[:-]\s*(.+)/i, /(?:Submitted|Received)\s*(?:By|From)\s*[:-]\s*(.+)/i],
    origin: [/(?:Country\s*of\s*)?Origin\s*[:-]\s*(.+)/i],
    product_expiration: [/(?:Expir(?:ation|y)|Exp|Best\s*By|Use\s*By)\s*(?:Date)?\s*[:-]\s*(\d{1,2}[/-]\d{1,2}[/-]\d{2,4})/i, /(?:Expir(?:ation|y)|Exp)\s*(?:Date)?\s*[:-]\s*(\d{4}-\d{2}-\d{2})/i],
    received_date: [/(?:Date\s*)?Receiv(?:ed|ing)\s*(?:Date)?\s*[:-]\s*(\d{1,2}[/-]\d{1,2}[/-]\d{2,4})/i, /(?:Sample|Date)\s*Receiv(?:ed|ing)\s*[:-]\s*(\d{4}-\d{2}-\d{2})/i],
    date_of_results: [/(?:Date\s*(?:of\s*)?)?(?:Report|Results?|Analysis|Complet(?:ed|ion))\s*(?:Date)?\s*[:-]\s*(\d{1,2}[/-]\d{1,2}[/-]\d{2,4})/i, /(?:Report|Complet(?:ed|ion))\s*(?:Date)?\s*[:-]\s*(\d{4}-\d{2}-\d{2})/i],
  };

  // Match against individual lines for clean field extraction
  for (const line of lines) {
    for (const [field, pats] of Object.entries(patterns)) {
      if (result[field]) continue;
      for (const pat of pats) {
        const m = line.match(pat);
        if (m) { result[field] = m[1].trim(); break; }
      }
    }
  }

  // Parse test results from tabular data
  const testPatterns = [
    /^(Total\s*Aerobic.*?Count|Total\s*Coliform|E\.?\s*Coli|Salmonella|Staphylococcus|Yeast\s*(?:and|&)\s*Mold|Arsenic|Cadmium|Mercury|Lead|Gluten|FTIR|Potency|Moisture|Bacillus|Allergen)/i,
    /^(APC|TPC|TVC|Y\s*&\s*M|TAC|TAMC|TYMC)/i,
  ];

  const passFailRe = /\b(pass(?:ed)?|fail(?:ed)?|comply|complies|does\s*not\s*comply|conform|non[\s-]?conform|detect(?:ed)?|not?\s*detect(?:ed)?|absent|present|positive|negative)\b/i;
  const numericRe = /([<>]?\s*\d+(?:[.,]\d+)?(?:\s*(?:cfu|ppb|ppm|ppt|mg|ug|ng|%|CFU)(?:\/[gml]+)?)?)/i;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let matched = false;
    for (const pat of testPatterns) {
      if (pat.test(line)) { matched = true; break; }
    }
    if (!matched) continue;

    const context = line + ' ' + (lines[i + 1] || '');
    const testName = line.match(/^([A-Za-z][A-Za-z\s()<>&,./-]+)/)?.[1]?.trim();
    if (!testName || testName.length < 3) continue;

    const pfMatch = context.match(passFailRe);
    let pass_fail = null;
    if (pfMatch) {
      const v = pfMatch[1].toLowerCase();
      if (['pass', 'passed', 'comply', 'complies', 'conform', 'not detected', 'absent', 'negative'].some(p => v.includes(p))) pass_fail = 'pass';
      else pass_fail = 'fail';
    }

    const numMatch = context.match(numericRe);

    result.test_results.push({
      test_type: testName.replace(/\s+/g, ' '),
      result_value: numMatch ? numMatch[1].trim() : (pfMatch ? pfMatch[1].trim() : null),
      pass_fail,
      unit: numMatch?.[1]?.match(/(cfu|ppb|ppm|mg|ug|%|CFU)(?:\/[gml]+)?/i)?.[0] || null,
    });
  }

  // Determine overall status
  if (result.test_results.length > 0) {
    const hasFail = result.test_results.some(t => t.pass_fail === 'fail');
    const allPass = result.test_results.every(t => t.pass_fail === 'pass' || !t.pass_fail);
    result.status = hasFail ? 'fail' : allPass && result.test_results.some(t => t.pass_fail === 'pass') ? 'pass' : 'pending';
  }

  // Build tests_requested summary
  const testNames = result.test_results.map(t => t.test_type);
  const hasMicro = testNames.some(t => /aerobic|coliform|coli|salmonella|yeast|mold|staph/i.test(t));
  const hasHM = testNames.some(t => /arsenic|cadmium|mercury|lead/i.test(t));
  if (hasMicro && hasHM) result.tests_requested = 'HM & Micro';
  else if (hasMicro) result.tests_requested = 'Micro';
  else if (hasHM) result.tests_requested = 'Heavy Metals';
  else if (testNames.length > 0) result.tests_requested = testNames.slice(0, 3).join(', ');

  return result;
}

/**
 * Read a PDF's text layer, keeping line breaks.
 *
 * Factored out of /parse-coa so scanning a report INTO an existing request uses
 * exactly the same reader — a second copy would drift, and the drift would show
 * up as the same file extracting differently depending on which screen you used.
 */
async function pdfLines(buffer) {
  const pdfDoc = await getDocument({ data: new Uint8Array(buffer) }).promise;
  const textParts = [];
  for (let i = 1; i <= pdfDoc.numPages; i++) {
    const page = await pdfDoc.getPage(i);
    const content = await page.getTextContent();
    let lastY = null;
    const lineTexts = [];
    for (const item of content.items) {
      const y = item.transform?.[5];
      if (lastY !== null && y !== undefined && Math.abs(y - lastY) > 2) lineTexts.push('\n');
      lineTexts.push(item.str);
      if (y !== undefined) lastY = y;
    }
    textParts.push(lineTexts.join(''));
  }
  return { text: textParts.join('\n'), numpages: pdfDoc.numPages };
}

router.post('/parse-coa', coaUpload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'PDF file required' });

  try {
    const parsed = await pdfLines(req.file.buffer);
    const extracted = parseCTLACoa(parsed.text);

    // Save uploaded PDF to disk for attachment
    const filename = `${uuid()}.pdf`;
    const filePath = path.join(UPLOAD_DIR, filename);
    const { writeFileSync } = await import('fs');
    writeFileSync(filePath, req.file.buffer);

    res.json({
      ...extracted,
      raw_text: parsed.text,
      page_count: parsed.numpages,
      _uploaded_file: {
        filename,
        original_name: req.file.originalname,
        size_bytes: req.file.size,
      },
    });
  } catch (err) {
    res.status(400).json({ error: 'Failed to parse PDF: ' + err.message });
  }
});

router.post('/import-parsed-coa', (req, res) => {
  const db = getDb();
  const { parsed, uploaded_file } = req.body;

  if (!parsed?.item_description && !parsed?.lot_number) {
    return res.status(400).json({ error: 'Parsed data must include at least item_description or lot_number' });
  }

  let ctlaLab = db.prepare("SELECT id FROM coa_labs WHERE name = 'CTLA'").get();
  if (!ctlaLab) {
    const labId = uuid();
    db.prepare("INSERT INTO coa_labs (id, name) VALUES (?, 'CTLA')").run(labId);
    ctlaLab = { id: labId };
  }

  const id = uuid();
  const status = parsed.status || 'pending';

  db.prepare(`INSERT INTO coa_requests (id, item_number, item_description, lot_number, product_expiration, tests_requested, status, lab_id, lab_name, date_of_results, origin, supplier, product_code, manufacturer_lot, vendor_lot, received_date, source, source_ref, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, parsed.item_number || '', parsed.item_description || 'Unknown', parsed.lot_number || '', parsed.product_expiration || null,
      parsed.tests_requested || 'Unknown', status, ctlaLab.id, 'CTLA',
      parsed.date_of_results || null, parsed.origin || null, parsed.supplier || null,
      parsed.product_code || null, parsed.manufacturer_lot || null, parsed.vendor_lot || null,
      parsed.received_date || null, 'ctla_coa_upload', `ctla_${parsed.lot_number || Date.now()}`, req.user.name);

  // Insert test results
  if (parsed.test_results?.length > 0) {
    const insertResult = db.prepare('INSERT INTO coa_test_results (id, request_id, test_type, result_value, unit, pass_fail) VALUES (?, ?, ?, ?, ?, ?)');
    for (const tr of parsed.test_results) {
      insertResult.run(uuid(), id, tr.test_type, tr.result_value, tr.unit, tr.pass_fail);
    }
  }

  // Attach the uploaded PDF
  if (uploaded_file) {
    const fileId = uuid();
    db.prepare('INSERT INTO coa_files (id, request_id, file_type, filename, original_name, mime_type, size_bytes, uploaded_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(fileId, id, 'lab_report', uploaded_file.filename, uploaded_file.original_name, 'application/pdf', uploaded_file.size_bytes, req.user.name);
  }

  const created = db.prepare('SELECT * FROM coa_requests WHERE id = ?').get(id);
  const test_results = db.prepare('SELECT * FROM coa_test_results WHERE request_id = ?').all(id);
  logAudit(req.user, 'import_coa_pdf', 'coa_request', id, { source: 'ctla_upload' }, null, created);
  res.status(201).json({ ...created, test_results });
});

// ──────────────── Distinct values for filters ────────────────

router.get('/distinct', (_req, res) => {
  const db = getDb();
  const items = db.prepare('SELECT DISTINCT item_number, item_description FROM coa_requests ORDER BY item_number').all();
  const tests = db.prepare('SELECT DISTINCT tests_requested FROM coa_requests ORDER BY tests_requested').all().map(r => r.tests_requested);
  const suppliers = db.prepare('SELECT DISTINCT supplier FROM coa_requests WHERE supplier IS NOT NULL AND supplier != \'\' ORDER BY supplier').all().map(r => r.supplier);
  const vendor_lots = db.prepare('SELECT DISTINCT vendor_lot FROM coa_requests WHERE vendor_lot IS NOT NULL AND vendor_lot != \'\' ORDER BY vendor_lot').all().map(r => r.vendor_lot);
  res.json({ items, tests, suppliers, vendor_lots });
});

export default router;
