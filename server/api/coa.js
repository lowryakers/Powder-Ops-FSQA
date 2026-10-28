import { Router } from 'express';
import { v4 as uuid } from 'uuid';
import multer from 'multer';
import path from 'path';
import { mkdirSync, existsSync, createReadStream, statSync, unlinkSync, readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import PDFDocument from 'pdfkit';
import { embedUnicodeFaces } from '../pdf-unicode.js';
import { readPdfColumns } from '../coa-pdf-text.js';
import { getDb, logAudit, dataDir } from '../db.js';
import { requireRole } from '../middleware/auth.js';
import { gradeResult, specIndex } from '../coa-grade.js';
import { releaseGate, GATE_MODES, specCoverage } from '../../shared/spec-coverage.js';
import { parseColumnarCoa, foundSomething, displayMdl } from '../coa-parse.js';
import { aiEnabled, readLabReport } from '../ai.js';
import { composeSubmission, PROCESSING, processingLabel, PLANT_CONTACT } from '../coa-submission.js';
import { gateSignature, signatureEvidence } from '../signature.js';
import { allocateCertNumber, snapshotFor, signRefusals, canonicalJson, sha256, isSigned, LOCKED_FIELDS, LOCKED_MESSAGE } from '../coa-certificate.js';
import { plantDateOf } from '../plant-clock.js';
import { isQaReviewer } from '../qa-signing.js';
import { labTestFor } from '../lab-test-items.js';
import { lateLabResults } from '../coa-late-results.js';
import { coaCorrectionAllowed, correctionFlags, duplicateDeleteRefusal, coaSignHold, dismissItem, recordDuplicateDecision, DECISION as CORRECTION_DECISION, openItems, itemProgress, emptyDuplicatePlan } from '../coa-review-items.js';
import { stampBaseLot, lotGlutenRollup } from '../coa-lots.js';
import { splitLot } from '../../shared/lot-model.js';
import { readLabFile, squash, MIN_EDIT_REASON, recordUnreadRows, unreadRowsFor, signChecks } from '../coa-checks.js';
import coaPlansRouter from './coa-plans.js';
import { gateMode, MODE_WORDS, signDoor } from '../coa-lot-gate.js';
import coaPublishRouter from './coa-publish.js';

// A drawn signature, as a data URL. One definition — the certificate sign-off
// and the lab submission both validate against it.
const SIGNATURE_RE = /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/;

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
// Test plans, COA products and the readiness report (D-244).
router.use(coaPlansRouter);
router.use(coaPublishRouter);

const REQUEST_FIELDS = ['item_number', 'item_description', 'lot_number', 'product_expiration', 'tests_requested', 'status', 'lab_id', 'lab_name', 'date_sent', 'tat_days', 'expected_results_date', 'date_of_results', 'date_sent_to_customer', 'requested_by', 'invoice_amount', 'retest_required', 'retest_of', 'notes', 'origin', 'supplier', 'product_code', 'manufacturer_lot', 'vendor_lot', 'received_date'];
// certificate_number and date_of_issuance are NOT editable here: they are
// written by signing and cleared by un-signing, nowhere else (D-223).

// The values the tables' CHECK constraints allow. Checked before the write, so
// a wrong value is a 400 that says what is allowed, not a 500 (D-224).
const STATUSES = ['pending', 'sent', 'pass', 'fail', 'hold', 're_test', 'na'];
const FILE_TYPES = ['lab_results', 'customer_coa', 'other'];
const badStatus = (v) => v !== undefined && !STATUSES.includes(v);


// The specification gate's mode (shared/spec-coverage.js). Default WARN: the
// specification program is catching up (CAR 4990683-3), and refusing every
// release today would stop the plant to prove a point. In warn mode a release
// CARRIES its gaps, which is what QA works down. The one reader of the mode is
// coa-lot-gate.js now (D-246): the lot rule and this gate share the switch.
export { gateMode };

/** The gate for one request, from its item's active specs and its results. */
export function gateFor(db, request) {
  const specs = db.prepare('SELECT * FROM coa_specifications WHERE item_number = ? AND is_active = 1').all(request.item_number);
  const results = db.prepare('SELECT test_type, pass_fail FROM coa_test_results WHERE request_id = ?').all(request.id);
  return releaseGate({ specs, results, mode: gateMode(db) });
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

  // A specification is switched ON only by approval (drafts/approve) and OFF
  // only by retiring it (DELETE). Flipping is_active here bypassed approval:
  // a draft or a discarded spec could start grading results (D-225).
  if (req.body.is_active !== undefined) {
    return res.status(400).json({ error: 'A specification is activated by approving it and deactivated by retiring it, not by editing it.' });
  }
  const fields = ['item_number', 'item_description', 'test_type', 'specification', 'unit', 'min_value', 'max_value', 'method', 'sku_number', 'vendor', 'revision'];
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
  // A retirement, not a deletion: the row stays and can be read (D-230).
  logAudit(req.user, 'retire', 'coa_specification', req.params.id, null, existing, { ...existing, is_active: 0 });
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
  // ≤, ≥, µ and a customer's own characters print as written (D-234).
  embedUnicodeFaces(doc);
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
  if (req.query.base_lot) { sql += ' AND base_lot = ?'; params.push(String(req.query.base_lot)); }
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

  const fileCounts = requests.length > 0
    ? db.prepare('SELECT request_id, file_type, COUNT(*) as count FROM coa_files WHERE request_id IN (' + requests.map(() => '?').join(',') + ') GROUP BY request_id, file_type')
      .all(...requests.map(r => r.id))
    : [];
  const fileMap = {};
  for (const fc of fileCounts) {
    if (!fileMap[fc.request_id]) fileMap[fc.request_id] = {};
    fileMap[fc.request_id][fc.file_type] = fc.count;
  }

  // `{ requests, total, shown }` rather than a bare array, the same shape the
  // draft-specifications endpoint uses, so the screen can say what it is
  // showing you out of what exists.
  // What this person may un-sign or delete. An admin: as before. Anyone else:
  // only what an open COA correction names (D-236) — read once, not per row.
  const isAdmin = req.user?.role === 'admin';
  const flagged = new Map();
  if (!isAdmin) {
    const openIds = openRequestIds(db);
    for (const r of requests) {
      if (openIds.has(r.id)) flagged.set(r.id, correctionFlags(db, req.user, r.id));
    }
  }
  const flagsFor = (id) => isAdmin ? { unsign: true, delete: true, item_key: null } : (flagged.get(id) || { unsign: false, delete: false, item_key: null });
  res.json({
    // The drawn signature and the signed snapshot are for the detail and the
    // PDF; a list of 1,500 rows does not carry them.
    requests: requests.map(({ qa_signature, signed_snapshot: _snapshot, ...r }) => ({ ...r, signed: !!qa_signature, file_counts: fileMap[r.id] || {}, correction: flagsFor(r.id) })),
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

  // The signature is optional here and REQUIRED by CTLA. Their form says they
  // will not test until it is signed, so the PDF says so in red when it is
  // missing rather than quietly printing a blank line — but composing the text
  // is not blocked, because somebody may be sending the email now and signing
  // the attachment at a desk.
  let sig = req.body?.signature || null;
  if (sig === true) sig = db.prepare('SELECT signature_image FROM users WHERE id = ?').get(req.user.id)?.signature_image || null;
  if (sig && (typeof sig !== 'string' || sig.length > 400000 || !SIGNATURE_RE.test(sig))) {
    return res.status(400).json({ error: 'Signature must be a PNG/JPEG data URL under 300 KB.' });
  }
  if (sig && req.body?.save_signature) {
    db.prepare("UPDATE users SET signature_image = ?, updated_at = datetime('now') WHERE id = ?").run(sig, req.user.id);
  }

  const today = plantDateOf();
  const submissionId = uuid();
  const tx = db.transaction(() => {
    // The body is FROZEN here. Correcting a request afterwards must never
    // rewrite what the laboratory was actually sent.
    db.prepare(`INSERT INTO coa_submissions
      (id, lab_id, lab_name, processing, body, samples, subject, request_count, released_by, released_by_id, signature, signed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      submissionId, built.labIds[0] || null, built.lab_name, req.body?.processing || 'normal',
      built.text,
      // Frozen alongside the body, for the same reason.
      JSON.stringify(filing.map(r => ({
        id: r.id, item_number: r.item_number, item_description: r.item_description,
        lot_number: r.lot_number, product_expiration: r.product_expiration,
        tests_requested: r.tests_requested,
      }))),
      built.subject, filing.length, req.user.name, req.user.id,
      sig || null, sig ? new Date().toISOString() : null);
    for (const r of filing) {
      const tat = r.tat_days || null;
      const expected = tat
        ? db.prepare("SELECT date(?, ?) d").get(today, `+${tat} days`).d
        : r.expected_results_date || null;
      db.prepare(`UPDATE coa_requests SET status = CASE WHEN status = 'pending' THEN 'sent' ELSE status END,
        date_sent = ?, expected_results_date = ?, submission_id = ?, updated_at = datetime('now') WHERE id = ?`)
        .run(today, expected, submissionId, r.id);
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
    submission_id: submissionId, signed: !!sig,
    subject: built.subject, to: built.to, lab_name: built.lab_name, text: built.text,
    samples: built.samples, warnings: built.warnings, sent: filing.length, skipped,
  });
});

// What went out, and when. An auditor asking "what did we send CTLA on the 4th"
// should not depend on somebody's sent-mail folder.
router.get('/submissions', (req, res) => {
  const db = getDb();
  const limit = Math.min(Number(req.query.limit) || 100, 500);
  res.json(db.prepare(`SELECT s.id, s.lab_name, s.processing, s.subject, s.request_count,
    s.released_by, s.signed_at, s.submitted_at,
    (SELECT COUNT(*) FROM coa_requests r WHERE r.submission_id = s.id) AS linked
    FROM coa_submissions s ORDER BY s.submitted_at DESC LIMIT ?`).all(limit));
});

/**
 * The attachable form.
 *
 * CTLA's terms say they will not perform testing until the submission form is
 * signed, so an emailed body alone is not a request they can act on. This is
 * that form: the same samples, on our letterhead, with the wet signature drawn
 * in-app applied at submission time.
 *
 * An UNSIGNED submission still renders — somebody may want to print it and sign
 * by hand — but it is stamped, in red, as not yet valid. A blank signature line
 * on an otherwise finished-looking form is an invitation to send it anyway.
 */
router.get('/submissions/:id/pdf', (req, res) => {
  const db = getDb();
  const s = db.prepare('SELECT * FROM coa_submissions WHERE id = ?').get(req.params.id);
  if (!s) return res.status(404).json({ error: 'Submission not found' });
  // THE SAMPLES AS SENT, not as they stand now. Somebody correcting a lot
  // number next week must not change the form the laboratory was given —
  // re-downloading it would then show something nobody ever received.
  const frozen = (() => {
    try { return JSON.parse(s.samples || 'null') || []; } catch { return []; }
  })();
  // Submissions written before `samples` existed fall back to the live rows —
  // better than an empty table, and there are none in service.
  const rows = frozen.length
    ? frozen
    : db.prepare('SELECT * FROM coa_requests WHERE submission_id = ? ORDER BY created_at').all(s.id);

  const doc = new PDFDocument({ size: 'LETTER', margins: { top: 42, bottom: 70, left: 50, right: 50 }, bufferPages: true });
  // ≤, ≥, µ and a customer's own characters print as written (D-234).
  embedUnicodeFaces(doc);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="Sample_Submission_${s.submitted_at.slice(0, 10)}.pdf"`);
  doc.pipe(res);
  // ONCE THE STREAM IS PIPED, THERE IS NO SENDING JSON. The global error
  // handler tries anyway and the write-after-end takes the whole process down
  // — one bad glyph position must not be an outage. Ending the document
  // truncates the download instead, which is visible and survivable.
  try {

  // The certificate export keeps these as function-locals, so this has its own
  // rather than reaching for a name that is not in scope here.
  const SLATE = '#3a3a3a', ORANGE = '#c65d35';
  const fmtDate = (d) => {
    if (!d) return '';
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(d));
    if (!m) return String(d);
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
      .toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' });
  };

  const lm = doc.page.margins.left;
  const pageW = doc.page.width - lm - doc.page.margins.right;
  const bottomY = () => doc.page.height - doc.page.margins.bottom;

  const logoH = 74;
  try { doc.image(LOGO_PATH, lm, 42, { height: logoH }); } catch { /* logo optional */ }
  doc.font('Helvetica-Bold').fontSize(15).fillColor(SLATE).text('POWDER OPS', lm + 75, 50, { characterSpacing: 0.5 });
  doc.font('Helvetica').fontSize(8.5).fillColor('#666')
    .text(`${PLANT_CONTACT.address}, ${PLANT_CONTACT.city_state_zip}`, lm + 75, 69)
    .text(`${PLANT_CONTACT.email}  ·  ${PLANT_CONTACT.phone}`, lm + 75, 81);
  doc.font('Helvetica').fontSize(8.5).fillColor('#666').text('Processing', lm, 50, { width: pageW, align: 'right' });
  doc.font('Helvetica-Bold').fontSize(12).fillColor(SLATE).text(processingLabel(s.processing), lm, 61, { width: pageW, align: 'right' });

  let y = 42 + logoH + 18;
  doc.font('Helvetica-Bold').fontSize(17).fillColor(SLATE)
    .text('SAMPLE SUBMISSION FORM', lm, y, { width: pageW, align: 'center', characterSpacing: 1 });
  y += 24;
  doc.moveTo(lm, y).lineTo(lm + pageW, y).lineWidth(2).strokeColor(ORANGE).stroke();
  y += 14;

  doc.font('Helvetica').fontSize(9).fillColor('#444');
  doc.text(`Submitted to: ${s.lab_name || '—'}`, lm, y);
  doc.text(`Date: ${fmtDate(s.submitted_at)}`, lm, y, { width: pageW, align: 'right' });
  y += 14;
  doc.text(`Contact: ${PLANT_CONTACT.contact_name}`, lm, y);
  y += 20;

  // ── Samples ──
  const cols = [{ w: 0.40 }, { w: 0.16 }, { w: 0.14 }, { w: 0.30 }];
  const head = ['Sample Name & Description', 'Lot #', 'Exp', 'Test(s) Requested'];
  const drawHead = () => {
    doc.font('Helvetica-Bold').fontSize(8.5).fillColor(SLATE);
    let x = lm;
    head.forEach((h, i) => { doc.text(h, x + 3, y + 4, { width: cols[i].w * pageW - 6 }); x += cols[i].w * pageW; });
    y += 18;
    doc.moveTo(lm, y).lineTo(lm + pageW, y).lineWidth(0.8).strokeColor('#bbb').stroke();
    y += 5;
  };
  drawHead();

  doc.font('Helvetica').fontSize(8.5).fillColor('#333');
  for (const r of rows) {
    const cells = [
      [r.item_number, r.item_description].filter(Boolean).join(' — ') || 'UNNAMED SAMPLE',
      r.lot_number || 'NOT RECORDED',
      r.product_expiration ? fmtDate(r.product_expiration) : '',
      r.tests_requested || 'NOT RECORDED',
    ];
    const h = Math.max(...cells.map((c, i) => doc.heightOfString(String(c), { width: cols[i].w * pageW - 6 })));
    if (y + h + 12 > bottomY()) { doc.addPage(); y = doc.page.margins.top; drawHead(); doc.font('Helvetica').fontSize(8.5).fillColor('#333'); }
    let x = lm;
    cells.forEach((c, i) => { doc.text(String(c), x + 3, y, { width: cols[i].w * pageW - 6 }); x += cols[i].w * pageW; });
    y += h + 8;
    doc.moveTo(lm, y - 3).lineTo(lm + pageW, y - 3).lineWidth(0.4).strokeColor('#eee').stroke();
  }

  // ── Release + signature ──
  if (y + 120 > bottomY()) { doc.addPage(); y = doc.page.margins.top; }
  y += 16;
  doc.font('Helvetica').fontSize(7.6).fillColor('#444');
  doc.text('The undersigned understands that all testing fees and bills will be charged directly, and agrees to be responsible for any fees and bills necessary to complete testing of the samples listed above. It is understood that this paperwork describes the testing desired for the sample(s) submitted.', lm, y, { width: pageW, lineGap: 2 });
  y += 42;

  const sigW = 220;
  if (s.signature) {
    try {
      const b64 = s.signature.split(',')[1];
      doc.image(Buffer.from(b64, 'base64'), lm + 10, y - 14, { fit: [sigW - 20, 34] });
    } catch { /* corrupt image — leave the line blank */ }
  }
  doc.moveTo(lm, y + 22).lineTo(lm + sigW, y + 22).lineWidth(0.8).strokeColor('#999').stroke();
  doc.font('Helvetica-Bold').fontSize(8.5).fillColor(SLATE).text('Released by', lm, y + 27);
  doc.font('Helvetica').fontSize(8).fillColor('#666')
    .text(s.signature ? `${s.released_by} — digitally signed ${fmtDate(s.signed_at)}` : (s.released_by || ''), lm, y + 38);

  doc.moveTo(lm + pageW - 160, y + 22).lineTo(lm + pageW, y + 22).lineWidth(0.8).strokeColor('#999').stroke();
  doc.font('Helvetica-Bold').fontSize(8.5).fillColor(SLATE).text('Date', lm + pageW - 160, y + 27);
  doc.font('Helvetica').fontSize(8).fillColor('#666').text(fmtDate(s.submitted_at), lm + pageW - 160, y + 38);

  // An unsigned form is not one the laboratory will act on, and it should not
  // look finished. Same doctrine as stamping a withdrawn document.
  if (!s.signature) {
    y += 56;
    doc.font('Helvetica-Bold').fontSize(9).fillColor('#c0392b')
      .text('NOT YET SIGNED — this form is not valid until it is signed.', lm, y, { width: pageW, align: 'center' });
  }

  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    const keep = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc.font('Helvetica').fontSize(7.5).fillColor('#999')
      .text(`Powder Ops · Sample Submission · ${fmtDate(s.submitted_at)} · Page ${i - range.start + 1} of ${range.count}`,
        lm, doc.page.height - 46, { width: pageW, align: 'center' });
    doc.page.margins.bottom = keep;
  }
  } catch (e) {
    console.error('[coa] submission PDF render failed:', e.message);
  }
  doc.end();
});

router.get('/requests/:id', (req, res) => {
  const db = getDb();
  const request = db.prepare('SELECT * FROM coa_requests WHERE id = ?').get(req.params.id);
  if (!request) return res.status(404).json({ error: 'COA request not found' });

  const files = db.prepare('SELECT * FROM coa_files WHERE request_id = ? ORDER BY created_at DESC').all(req.params.id);
  const test_results = db.prepare('SELECT * FROM coa_test_results WHERE request_id = ? ORDER BY test_type').all(req.params.id);
  const specs = db.prepare('SELECT * FROM coa_specifications WHERE item_number = ? AND is_active = 1').all(request.item_number);

  const { suspect } = splitLot(request.lot_number);
  res.json({ ...request, files, test_results, specifications: specs, lot_suspect: suspect,
    correction: correctionFlags(db, req.user, request.id), correction_items: correctionItemsFor(db, request.id),
    unread_rows: unreadRowsFor(db, request.id) });
});

// A line the reader could not read is answered one of two ways: add it as a
// result (which marks it added by itself), or dismiss it here with a reason —
// "this is a footnote, not a result". QA or an admin only (D-243).
router.post('/unread-rows/:id/dismiss', (req, res) => {
  const db = getDb();
  const u = req.user || {};
  const qa = u.role === 'admin' || ['qa', 'quality'].includes(String(u.department || '').toLowerCase());
  if (!qa) return res.status(403).json({ error: 'Only Quality or an admin can answer a line the app could not read.' });
  const row = db.prepare('SELECT * FROM coa_unread_rows WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'That line was not found.' });
  const reason = String(req.body?.reason || '').trim();
  if (reason.length < 3) return res.status(400).json({ error: 'Say why this line is not a result (at least 3 characters).' });
  if (row.status !== 'open') return res.status(409).json({ error: `This line is already ${row.status}.` });
  const request = db.prepare('SELECT * FROM coa_requests WHERE id = ?').get(row.request_id);
  if (request?.qa_signed_at) return res.status(409).json({ error: LOCKED_MESSAGE });
  db.prepare("UPDATE coa_unread_rows SET status = 'dismissed', resolved_reason = ?, resolved_by = ?, resolved_at = datetime('now') WHERE id = ?")
    .run(reason, u.name || null, row.id);
  logAudit(req.user, 'dismiss', 'coa_unread_row', row.id, { request_id: row.request_id, line: row.line_text, reason },
    { status: 'open' }, { status: 'dismissed' }, row.line_text);
  res.json({ ok: true, unread_rows: unreadRowsFor(db, row.request_id) });
});

// D-258: samples at the lab past the date their results were due, and how
// many out have no expected date (and so cannot be called late).
router.get('/late-results', (req, res) => {
  res.json(lateLabResults(getDb()));
});

// D-257: a lab request started from a receiving line's lab-test alert. The
// form is filled from the line (part, description, vendor lot, expiry, the
// date it arrived, the vendor off its checklist) and the tests from QA's
// standing list. Nothing is written here; the person checks it and saves.
router.get('/receiving-prefill/:id', (req, res) => {
  const db = getDb();
  const line = db.prepare('SELECT * FROM receiving_log WHERE id = ?').get(req.params.id);
  if (!line) return res.status(404).json({ error: 'That receiving line is not on file.' });
  const existing = db.prepare('SELECT id, lot_number, status, created_at FROM coa_requests WHERE receiving_log_id = ? ORDER BY created_at DESC LIMIT 1').get(line.id) || null;
  const rules = db.prepare('SELECT * FROM receiving_lab_test_items WHERE is_active = 1').all();
  const rule = labTestFor(line, rules);
  const vendor = line.inspection_no
    ? db.prepare('SELECT vendor FROM receiving_checklists WHERE inspection_no = ?').get(line.inspection_no)?.vendor || null
    : null;
  const where = [line.inspection_no && `inspection ${line.inspection_no}`, line.po_number && `PO ${line.po_number}`].filter(Boolean).join(' · ');
  res.json({
    existing,
    missing: [!line.vendor_lot && 'vendor lot', !rule?.tests && 'tests'].filter(Boolean),
    prefill: {
      receiving_log_id: line.id,
      item_number: line.part_number || '',
      item_description: line.part_description || '',
      lot_number: line.vendor_lot || '',
      vendor_lot: line.vendor_lot || '',
      product_expiration: line.expiration_date || '',
      received_date: line.date_received || '',
      supplier: vendor || '',
      tests_requested: rule?.tests || '',
      notes: `Sample from the receiving line${where ? ` (${where})` : ''}, on QA's lab-test list.`,
    },
  });
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

  // Whose product this is can be set at filing (D-240): Quality or an admin, a
  // brand already on the list. Blank is "unassigned", as before.
  const brand = String(req.body.brand_owner ?? '').trim() || 'unassigned';
  if (brand !== 'unassigned') {
    if (!canSetBrand(req.user)) return res.status(403).json({ error: 'Only an admin or Quality can set whose product this is.' });
    if (!db.prepare('SELECT 1 FROM coa_brands WHERE name = ?').get(brand)) return res.status(400).json({ error: `"${brand}" is not on the brand list.` });
  }

  // D-257: started from a receiving line — the line must exist, and one line
  // gets one lab request (a second is refused, naming the first).
  const receivingId = String(req.body.receiving_log_id || '').trim() || null;
  if (receivingId) {
    if (!db.prepare('SELECT 1 FROM receiving_log WHERE id = ?').get(receivingId)) return res.status(400).json({ error: 'That receiving line is not on file.' });
    const prior = db.prepare('SELECT id, lot_number FROM coa_requests WHERE receiving_log_id = ?').get(receivingId);
    if (prior) return res.status(409).json({ error: `A lab request for this receiving line already exists (lot ${prior.lot_number}).`, existing_id: prior.id });
  }

  const id = uuid();
  const status = date_sent ? 'sent' : 'pending';

  db.prepare(`INSERT INTO coa_requests (id, item_number, item_description, lot_number, product_expiration, tests_requested, status, lab_id, lab_name, date_sent, tat_days, expected_results_date, requested_by, notes, created_by, origin, supplier, product_code, manufacturer_lot, vendor_lot, received_date)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, item_number, item_description, lot_number, product_expiration || null, tests_requested, status, lab_id || null, lab_name, date_sent || null, tat_days || null, expected_results_date || null, requested_by || req.user.name, notes || null, req.user.name, origin || null, supplier || null, product_code || null, manufacturer_lot || null, vendor_lot || null, received_date || null);

  if (brand !== 'unassigned') db.prepare('UPDATE coa_requests SET brand_owner = ? WHERE id = ?').run(brand, id);
  if (receivingId) db.prepare('UPDATE coa_requests SET receiving_log_id = ? WHERE id = ?').run(receivingId, id);
  stampBaseLot(db, id);
  const created = db.prepare('SELECT * FROM coa_requests WHERE id = ?').get(id);
  logAudit(req.user, 'create', 'coa_request', id, req.body, null, created);
  res.status(201).json(created);
});

router.put('/requests/:id', (req, res) => {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM coa_requests WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'COA request not found' });
  if (badStatus(req.body.status)) return res.status(400).json({ error: `Status must be one of ${STATUSES.join(', ')}.` });
  if (req.body.certificate_number !== undefined || req.body.date_of_issuance !== undefined) {
    return res.status(400).json({ error: 'The certificate number and date of issuance are set by signing, not by editing.' });
  }
  if (isSigned(existing)) {
    const touched = LOCKED_FIELDS.filter(f => req.body[f] !== undefined && String(req.body[f] ?? '') !== String(existing[f] ?? ''));
    if (touched.length) return res.status(409).json({ error: LOCKED_MESSAGE, locked: true, fields: touched });
  }

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

  // Setting the status to pass BY HAND is a release too, and goes through the
  // same gate the roll-up applies — otherwise the gate is a formality anyone
  // sidesteps with the status dropdown.
  if (req.body.status === 'pass' && existing.status !== 'pass') {
    const gate = gateFor(db, existing);
    if (gate.blocks) return res.status(400).json({ error: `This lot cannot be released: ${gate.gaps.join('; ')}.`, release_blocked: true, gaps: gate.gaps });
    updates.push('release_gaps = ?', 'release_gate_mode = ?');
    values.push(gate.mode === 'off' || gate.ok ? null : JSON.stringify(gate.gaps), gate.mode);
  }

  updates.push("updated_at = datetime('now')");
  values.push(req.params.id);
  db.prepare(`UPDATE coa_requests SET ${updates.join(', ')} WHERE id = ?`).run(...values);
  if (req.body.lot_number !== undefined) stampBaseLot(db, req.params.id);

  const updated = db.prepare('SELECT * FROM coa_requests WHERE id = ?').get(req.params.id);
  logAudit(req.user, 'update', 'coa_request', req.params.id, req.body, existing, updated);
  res.json(updated);
});

// The gate itself: its mode, and what it has let through carrying gaps.
router.get('/release-gate', (req, res) => {
  const db = getDb();
  const mode = gateMode(db);
  const withGaps = db.prepare("SELECT id, item_number, item_description, lot_number, release_gaps, date_of_results FROM coa_requests WHERE release_gaps IS NOT NULL AND status = 'pass' ORDER BY date_of_results DESC LIMIT 200").all()
    .map(r => ({ ...r, release_gaps: JSON.parse(r.release_gaps || '[]') }));
  const held = db.prepare("SELECT id, item_number, item_description, lot_number, release_gaps FROM coa_requests WHERE status = 'hold' AND release_gaps IS NOT NULL ORDER BY updated_at DESC LIMIT 200").all()
    .map(r => ({ ...r, release_gaps: JSON.parse(r.release_gaps || '[]') }));
  // Coverage per item that has ever been tested — the punch list for the spec program.
  const items = db.prepare('SELECT DISTINCT item_number, item_description FROM coa_requests ORDER BY item_number').all();
  const specsByItem = {};
  for (const s of db.prepare('SELECT item_number, test_type FROM coa_specifications WHERE is_active = 1').all()) (specsByItem[s.item_number] ||= []).push(s);
  const coverage = items.map(i => { const c = specCoverage(specsByItem[i.item_number] || []); return { ...i, missing: c.missing }; });
  // ADVISORY ONLY (D-237): base lots whose batches do not all carry a signed,
  // passing gluten result. Gates nothing; the mode and every refusal are as they were.
  const lot_rollup = (() => { try { return lotGlutenRollup(db); } catch { return null; } })();
  res.json({ mode, modes: GATE_MODES, lot_rollup, released_with_gaps: withGaps, released_with_gaps_count: withGaps.length, held, held_count: held.length,
    items_total: coverage.length, items_fully_covered: coverage.filter(c => c.missing.length === 0).length, coverage });
});

// Moving the mode is an admin decision with a reason and the password (D-246):
// strict stops certificates and production sign-offs, and that is not a click.
router.put('/release-gate', requireRole('admin'), (req, res) => {
  const db = getDb();
  const mode = req.body?.mode;
  if (!GATE_MODES.includes(mode)) return res.status(400).json({ error: `Mode must be one of ${GATE_MODES.join(', ')}.` });
  const before = gateMode(db);
  if (mode === before) return res.json({ mode, unchanged: true });
  const reason = String(req.body?.reason || '').trim();
  if (reason.length < 3) return res.status(400).json({ error: `Say why the release gate is moving from ${MODE_WORDS[before]} to ${MODE_WORDS[mode]}.`, reason_required: true });
  if (!gateSignature(req, res, { action: 'coa_release_gate' })) return;
  db.prepare("INSERT INTO app_settings (key, value) VALUES ('coa_release_gate', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(mode);
  logAudit(req.user, 'coa_release_gate_changed', 'app_setting', 'coa_release_gate', { from: before, to: mode, reason, ...signatureEvidence() });
  res.json({ mode });
});

// Bulk permanent delete of lab requests (with their test results + files).
// Admin only.
// Admin; or Quality for exactly the empty duplicates a COA correction item
// names (D-236) — every id authorized, a reason, the password, and each one
// still empty, unsigned and from the CTLA upload with its report kept elsewhere.
router.post('/requests/bulk-delete', (req, res) => {
  const db = getDb();
  const { ids } = req.body;
  if (!Array.isArray(ids) || !ids.length) return res.status(400).json({ error: 'ids array is required' });
  const auth = new Map();
  if (req.user?.role !== 'admin') {
    for (const id of ids) {
      const a = coaCorrectionAllowed(db, req.user, id, 'delete');
      if (!a) return res.status(403).json({ error: 'Only an admin can delete lab requests, or Quality for an empty duplicate a COA correction in QA Review names.', id });
      const refusal = duplicateDeleteRefusal(db, id, a.item);
      if (refusal) return res.status(409).json({ error: `Request ${id} cannot be deleted as a duplicate: ${refusal}`, id });
      auth.set(id, a.item);
    }
    if (String(req.body?.reason || '').trim().length < 3) return res.status(400).json({ error: 'Say why these requests are being deleted.' });
    if (!gateSignature(req, res, { action: 'coa_delete_duplicate' })) return;
  } else {
    for (const id of ids) { const a = coaCorrectionAllowed(db, req.user, id, 'delete'); if (a?.item) auth.set(id, a.item); }
  }
  const reason = String(req.body?.reason || '').trim() || null;
  const ph = ids.map(() => '?').join(',');
  const all = db.prepare(`SELECT id, certificate_number, qa_signed_at, lot_number FROM coa_requests WHERE id IN (${ph})`).all(...ids);
  // A signed certificate is a record and is never deleted (D-224).
  const skipped_signed = all.filter(isSigned).map(r => ({ id: r.id, lot_number: r.lot_number }));
  const found = all.filter(r => !isSigned(r));
  const del = found.map(r => r.id);
  const dph = del.map(() => '?').join(',');
  const tx = db.transaction(() => {
    if (!del.length) return;
    db.prepare(`DELETE FROM coa_test_results WHERE request_id IN (${dph})`).run(...del);
    db.prepare(`DELETE FROM coa_files WHERE request_id IN (${dph})`).run(...del);
    db.prepare(`DELETE FROM coa_requests WHERE id IN (${dph})`).run(...del);
  });
  tx();
  for (const r of found) {
    const item = auth.get(r.id);
    logAudit(req.user, 'delete', 'coa_request', r.id,
      (reason || item) ? { ...(reason ? { reason } : {}), ...(item ? { authorized_by: item.item_key, decision: CORRECTION_DECISION } : {}),
        ...(req.user?.role !== 'admin' ? signatureEvidence() : {}) } : null, r, null);
  }
  res.json({ deleted: found.length, skipped_signed });
});

// D-256: delete every empty duplicate a COA correction names, in one act.
// Admin or Quality. Each is checked exactly as a single delete is (empty, not
// signed, from the CTLA upload, its lab report kept on another request); one
// that fails is named and left alone, the rest go. `preview: true` writes
// nothing. One reason and one password for the act; one audit row per request.
router.post('/corrections/duplicates/delete', (req, res) => {
  const db = getDb();
  if (req.user?.role !== 'admin' && !isQaReviewer(req.user)) {
    return res.status(403).json({ error: 'Only Quality or an admin can delete the empty duplicates.' });
  }
  const plan = emptyDuplicatePlan(db, { requestIds: req.body?.request_ids });
  if (req.body?.preview) return res.json(plan);
  if (!plan.ready.length) return res.status(409).json({ error: 'There is no empty duplicate ready to delete.', ...plan });
  const reason = String(req.body?.reason || '').trim();
  if (reason.length < 3) return res.status(400).json({ error: 'Say why these requests are being deleted.', reason_required: true });
  if (!gateSignature(req, res, { action: 'coa_delete_duplicates' })) return;
  const ids = plan.ready.map(r => r.request_id);
  const rows = ids.map(id => db.prepare('SELECT * FROM coa_requests WHERE id = ?').get(id));
  const ph = ids.map(() => '?').join(',');
  db.transaction(() => {
    db.prepare(`DELETE FROM coa_test_results WHERE request_id IN (${ph})`).run(...ids);
    db.prepare(`DELETE FROM coa_files WHERE request_id IN (${ph})`).run(...ids);
    db.prepare(`DELETE FROM coa_requests WHERE id IN (${ph})`).run(...ids);
  })();
  rows.forEach((r, i) => logAudit(req.user, 'delete', 'coa_request', r.id,
    { reason, authorized_by: plan.ready[i].item_key, decision: CORRECTION_DECISION, bulk: true, ...signatureEvidence() }, r, null));
  logAudit(req.user, 'coa_duplicates_deleted', 'coa_request', null,
    { reason, deleted: ids.length, refused: plan.refused.length, decision: CORRECTION_DECISION, ...signatureEvidence() });
  res.json({ deleted: ids.length, refused: plan.refused });
});

// Bulk status update for lab requests.
router.post('/requests/bulk-update', (req, res) => {
  const db = getDb();
  const { ids, patch } = req.body;
  if (!Array.isArray(ids) || !ids.length) return res.status(400).json({ error: 'ids array is required' });
  if (!patch || !patch.status) return res.status(400).json({ error: 'patch.status is required' });
  if (badStatus(patch.status)) return res.status(400).json({ error: `Status must be one of ${STATUSES.join(', ')}.` });
  // A bulk pass is a bulk RELEASE and meets the same gate as a single one —
  // a lot the gate holds is skipped and named, never quietly passed in a batch.
  const blocked = [];
  // A signed certificate's status is closed; it is skipped and named.
  let okIds = ids.filter(id => {
    const r = db.prepare('SELECT id, lot_number, item_number, qa_signed_at, status FROM coa_requests WHERE id = ?').get(id);
    if (r && isSigned(r) && r.status !== patch.status) { blocked.push({ id, lot_number: r.lot_number, item_number: r.item_number, gaps: ['signed certificate'] }); return false; }
    return true;
  });
  if (patch.status === 'pass') {
    const candidates = okIds;
    okIds = [];
    const stamp = db.prepare("UPDATE coa_requests SET release_gaps = ?, release_gate_mode = ? WHERE id = ?");
    for (const id of candidates) {
      const r = db.prepare('SELECT * FROM coa_requests WHERE id = ?').get(id);
      if (!r) continue;
      const gate = gateFor(db, r);
      if (gate.blocks) { blocked.push({ id, lot_number: r.lot_number, item_number: r.item_number, gaps: gate.gaps }); continue; }
      stamp.run(gate.mode === 'off' || gate.ok ? null : JSON.stringify(gate.gaps), gate.mode, id);
      okIds.push(id);
    }
  }
  const ph = okIds.map(() => '?').join(',');
  const info = okIds.length ? db.prepare(`UPDATE coa_requests SET status=?, updated_at=datetime('now') WHERE id IN (${ph})`).run(patch.status, ...okIds) : { changes: 0 };
  logAudit(req.user, 'coa_requests_bulk_updated', 'coa_request', null, { count: info.changes, status: patch.status, blocked: blocked.length });
  res.json({ updated: info.changes, blocked });
});

// ──────────────── COA corrections (D-236) ────────────────

// The request ids with an open correction item — read once per list.
function openRequestIds(db) {
  try { return new Set(db.prepare("SELECT DISTINCT request_id FROM coa_review_items WHERE status = 'open'").all().map(r => r.request_id)); }
  catch { return new Set(); }
}
function correctionItemsFor(db, requestId) {
  try {
    // A possible duplicate (D-242) shows on BOTH records of the pair.
    return db.prepare(`SELECT * FROM coa_review_items WHERE request_id = ?
        OR (kind = 'POSSIBLE_DUPLICATE' AND item_key LIKE '%' || ? || '%') ORDER BY created_at`).all(requestId, requestId)
      .map(i => {
        const extra = (() => { try { return JSON.parse(i.steps || '{}'); } catch { return {}; } })();
        const seed = extra.seed || {};
        return { id: i.id, item_key: i.item_key, kind: i.kind, title: i.title, recommended_action: i.recommended_action, reason: i.reason,
          note: extra.note || null, status: i.status, dismissed_reason: i.dismissed_reason,
          evidence: (() => { try { return JSON.parse(i.evidence || '[]'); } catch { return []; } })(),
          decision: (() => { try { return i.decision ? JSON.parse(i.decision) : null; } catch { return null; } })(),
          ...(i.kind === 'POSSIBLE_DUPLICATE' ? { pair: { a: seed.id_a, b: seed.id_b || null }, this_record: seed.id_b === requestId ? 'B' : 'A' } : {}),
          ...itemProgress(db, i) };
      });
  } catch { return []; }
}

// The open items, for the COA screen (QA Review reads the same functions).
router.get('/review-items', (req, res) => {
  const db = getDb();
  res.json({ items: openItems(db).map(i => ({ id: i.id, item_key: i.item_key, kind: i.kind, request_id: i.request_id, title: i.title, ...i.progress })) });
});

// An admin closes an item with a reason. It is the only way the held request
// (8afd7fbe) can be signed again, and it is recorded.
// Closing an item: an admin for every kind; Quality may also dismiss a
// POSSIBLE duplicate ("not a duplicate", D-242). Reason required, recorded.
router.post('/review-items/:id/dismiss', (req, res) => {
  const db = getDb();
  const target = db.prepare('SELECT kind FROM coa_review_items WHERE id = ? OR item_key = ?').get(req.params.id, req.params.id);
  const mayDismiss = req.user?.role === 'admin' || (target?.kind === 'POSSIBLE_DUPLICATE' && isQaReviewer(req.user));
  if (!mayDismiss) return res.status(403).json({ error: target?.kind === 'POSSIBLE_DUPLICATE'
    ? 'Only Quality or an admin can close a possible duplicate.' : 'Only an admin can dismiss a COA correction.' });
  const reason = String(req.body?.reason || '').trim();
  if (reason.length < 3) return res.status(400).json({ error: 'Say why this correction is being dismissed.' });
  const out = dismissItem(db, req.user, req.params.id, reason);
  if (out.error) return res.status(out.status).json({ error: out.error });
  logAudit(req.user, 'dismiss', 'coa_review_item', out.item.id, { reason, item_key: out.item.item_key, request_id: out.item.request_id },
    { status: out.before.status }, { status: 'dismissed' }, out.item.title);
  res.json(out.item);
});

// Maria's answer on a possible duplicate (D-242): the same test, and which
// record goes. Recorded only — an admin deletes it with the ordinary delete.
router.post('/review-items/:id/decide', (req, res) => {
  if (!(req.user?.role === 'admin' || isQaReviewer(req.user))) return res.status(403).json({ error: 'Only Quality or an admin can decide a possible duplicate.' });
  const reason = String(req.body?.reason || '').trim();
  if (reason.length < 3) return res.status(400).json({ error: 'Say why these are the same test.' });
  const db = getDb();
  const out = recordDuplicateDecision(db, req.user, req.params.id, { remove: String(req.body?.remove || '').toUpperCase(), reason });
  if (out.error) return res.status(out.status).json({ error: out.error });
  logAudit(req.user, 'update', 'coa_review_item', out.item.id, { decision: out.decision, item_key: out.item.item_key },
    { decision: out.before.decision ? JSON.parse(out.before.decision) : null }, { decision: out.decision }, out.item.title);
  res.json(out.item);
});

// ──────────────── Test Results ────────────────

// The method and MDL as the lab printed them; blank is null (D-231).
const cleanText = (v) => { const s = String(v ?? '').replace(/\s+/g, ' ').trim(); return s ? s.slice(0, 120) : null; };

router.post('/requests/:id/results', async (req, res) => {
  const db = getDb();
  const request = db.prepare('SELECT * FROM coa_requests WHERE id = ?').get(req.params.id);
  if (!request) return res.status(404).json({ error: 'COA request not found' });

  if (isSigned(request)) return res.status(409).json({ error: LOCKED_MESSAGE, locked: true });
  const { results } = req.body;
  // A report whose every line was unread is applied with no rows ticked — the
  // lines still have to be stored and answered.
  if (!Array.isArray(results) || (results.length === 0 && !req.body.source_file_id)) {
    return res.status(400).json({ error: 'results array is required' });
  }

  // Applying a scanned lab report names the file (D-243). The server reads it
  // again itself — never trusting what the browser says it read — so each row
  // records what the PDF says and that it came from the PDF.
  let file = null; let read = null; let readIdx = null; let fileSha = null;
  if (req.body.source_file_id) {
    file = db.prepare('SELECT * FROM coa_files WHERE id = ? AND request_id = ?').get(req.body.source_file_id, req.params.id);
    if (!file) return res.status(404).json({ error: 'That lab report is not attached to this request.' });
    const r = await readLabFile(file, UPLOAD_DIR);
    if (r.missing) return res.status(404).json({ error: 'That lab report is no longer on the server.' });
    if (r.hash_ok === false) return res.status(409).json({ error: 'That lab report has changed since it was attached. Attach it again.' });
    if (r.image || r.unreadable) return res.status(400).json({ error: 'That lab report is an image scan with no text, so results cannot be read from it. Type them by hand, or ask the lab for the original PDF.' });
    read = r.parsed; fileSha = r.sha256; readIdx = specIndex(read.test_results);
  }

  // One grader, one spec lookup, shared with the scan preview and the edit
  // path — a preview computed differently from the commit is a preview that
  // lies. `specIndex` matches "Total Aerobic Microbial Count (USP)" against a
  // spec written "Total Aerobic Plate Count"; exact string equality (what this
  // used to do) matched almost nothing on a real report.
  const specs = db.prepare('SELECT * FROM coa_specifications WHERE item_number = ? AND is_active = 1').all(request.item_number);
  const index = specIndex(specs);

  // Decide every row before writing any. A hand-set verdict, or a value
  // changed from what the PDF says, needs a reason (D-244).
  const rows = [];
  for (const r of results) {
    const spec = index.find(r.test_type);
    const unit = r.unit || spec?.unit || null;
    const readRow = readIdx ? readIdx.find(r.test_type) : null;
    const wanted = r.pass_fail === '' || r.pass_fail == null ? null : String(r.pass_fail);
    if (wanted && !['pass', 'fail', 'na'].includes(wanted)) return res.status(400).json({ error: 'Pass/fail must be pass, fail or na.' });
    // gradeResult handles "<10", "Not Detected", "Absent in 25g" and the rest
    // of a real micro panel. A verdict the REPORT printed is graded the same way
    // (it can fail a result, never rescue one); a person's verdict is not.
    // Graded on the unit the row states: a number with no unit is "unit not
    // stated", never read in the spec's unit (D-229).
    const auto = gradeResult(r.result_value, spec, r.stated_pass_fail || null, { unit: r.unit || null }).pass_fail;
    const handVerdict = !!wanted && wanted !== auto;
    const handValue = !!readRow && squash(r.result_value) !== squash(readRow.result_value);
    const reason = String(r.edit_reason || '').trim();
    if ((handVerdict || handValue) && reason.length < MIN_EDIT_REASON) {
      const why = [handValue ? `the value differs from the lab report (${readRow.result_value})` : null,
        handVerdict ? `the pass/fail is set by hand (the approved limit gives ${auto || 'no verdict'})` : null].filter(Boolean).join(' and ');
      return res.status(400).json({ error: `${r.test_type}: ${why}. Say why, in at least ${MIN_EDIT_REASON} characters.`, needs_reason: true, test_type: r.test_type });
    }
    rows.push({ r, spec, unit, readRow, pass_fail: handVerdict ? wanted : auto, handVerdict, reason: (handVerdict || handValue || !readRow) && reason ? reason : null });
  }

  const insert = db.prepare(`INSERT INTO coa_test_results (id, request_id, test_type, result_value, unit, specification_id, pass_fail, notes, method, mdl,
    source, source_file_id, source_sha256, read_value, read_unit, read_mdl, verdict_manual, edit_reason, edited_by, edited_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CASE WHEN ? IS NULL THEN NULL ELSE datetime('now') END)`);
  const tx = db.transaction(() => {
    const created = [];
    for (const x of rows) {
      const id = uuid();
      insert.run(id, req.params.id, x.r.test_type, x.r.result_value ?? null, x.unit, x.spec?.id || null, x.pass_fail, x.r.notes || null,
        cleanText(x.r.method), cleanText(x.r.mdl),
        x.readRow ? 'pdf' : 'manual', x.readRow ? file.id : null, x.readRow ? fileSha : null,
        x.readRow?.result_value ?? null, x.readRow?.unit ?? null, x.readRow?.mdl ?? null,
        x.handVerdict ? 1 : 0, x.reason, x.reason ? req.user.name : null, x.reason);
      created.push(db.prepare('SELECT * FROM coa_test_results WHERE id = ?').get(id));
    }
    // The report's own number and date, kept on the file (fills blanks only).
    if (file && read) {
      db.prepare('UPDATE coa_files SET lab_report_number = COALESCE(lab_report_number, ?), lab_report_date = COALESCE(lab_report_date, ?), text_layer = 1 WHERE id = ?')
        .run(read.lab_report_number || null, read.report_date || null, file.id);
    }
    return created;
  });

  const created = tx();
  // Lines the reader could not read become a QA Review item (D-243).
  const unread = file && read ? recordUnreadRows(db, request, file, read.unread, logAudit, req.user) : { stored: 0 };
  rollUpRequestStatus(db, req.params.id);

  logAudit(req.user, 'create', 'coa_test_results', req.params.id,
    { results, source_file_id: file?.id || null, hand_set: rows.filter(x => x.handVerdict || x.reason).map(x => ({ test_type: x.r.test_type, reason: x.reason })), unread_lines: unread.stored },
    null, created);
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
  // At least one real pass: a request whose every result is N/A tested
  // nothing, and must not roll up to a pass (D-224).
  const allDecided = all.every(r => r.pass_fail === 'pass' || r.pass_fail === 'na') && all.some(r => r.pass_fail === 'pass');
  const today = plantDateOf();
  if (hasFail) {
    db.prepare("UPDATE coa_requests SET status = 'fail', date_of_results = COALESCE(date_of_results, ?), updated_at = datetime('now') WHERE id = ?").run(today, requestId);
  } else if (allDecided) {
    // Every test passed. Whether the LOT may be released is a second question
    // (CAR 4990683-3): does the item's specification cover identity, purity,
    // strength, composition and contaminants, and was identity confirmed by
    // more than a look, smell and taste? In `on` mode a gap holds the lot; in
    // `warn` mode the release goes through carrying its gaps, named.
    const request = db.prepare('SELECT * FROM coa_requests WHERE id = ?').get(requestId);
    const gate = gateFor(db, request);
    if (gate.blocks) {
      db.prepare("UPDATE coa_requests SET status = 'hold', release_gaps = ?, release_gate_mode = ?, date_of_results = COALESCE(date_of_results, ?), updated_at = datetime('now') WHERE id = ?")
        .run(JSON.stringify(gate.gaps), gate.mode, today, requestId);
    } else {
      db.prepare("UPDATE coa_requests SET status = 'pass', release_gaps = ?, release_gate_mode = ?, date_of_results = COALESCE(date_of_results, ?), updated_at = datetime('now') WHERE id = ?")
        .run(gate.mode === 'off' || gate.ok ? null : JSON.stringify(gate.gaps), gate.mode, today, requestId);
    }
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
  if (isSigned(request)) return res.status(409).json({ error: LOCKED_MESSAGE, locked: true });

  const test_type = req.body.test_type !== undefined ? String(req.body.test_type || '').trim() : existing.test_type;
  if (!test_type) return res.status(400).json({ error: 'A test name is required.' });
  const result_value = req.body.result_value !== undefined ? req.body.result_value : existing.result_value;
  const notes = req.body.notes !== undefined ? (req.body.notes || null) : existing.notes;
  const method = req.body.method !== undefined ? cleanText(req.body.method) : (existing.method ?? null);
  const mdl = req.body.mdl !== undefined ? cleanText(req.body.mdl) : (existing.mdl ?? null);

  const specs = db.prepare('SELECT * FROM coa_specifications WHERE item_number = ? AND is_active = 1').all(request.item_number);
  const spec = specIndex(specs).find(test_type);

  const unit = req.body.unit !== undefined ? (req.body.unit || null) : (existing.unit || spec?.unit || null);
  // '' means "clear it and let the specification decide again"; a value means
  // the person is overruling. With neither, an edit that leaves the result
  // itself alone (a note, say) keeps the verdict on file; one that changes the
  // value, the test or the unit is graded afresh (D-222).
  let pass_fail;
  if (req.body.pass_fail !== undefined) {
    const wanted = req.body.pass_fail === '' ? null : String(req.body.pass_fail);
    if (wanted && !['pass', 'fail', 'na'].includes(wanted)) {
      return res.status(400).json({ error: 'Pass/fail must be pass, fail or na.' });
    }
    pass_fail = wanted || gradeResult(result_value, spec, null, { unit }).pass_fail;
  } else if (test_type === existing.test_type && String(result_value ?? '') === String(existing.result_value ?? '') && (unit || null) === (existing.unit || null)) {
    pass_fail = existing.pass_fail;
  } else {
    pass_fail = gradeResult(result_value, spec, null, { unit }).pass_fail;
  }

  // A hand-set verdict, or a value changed from what the lab report says,
  // needs a reason and is flagged on the row (D-244). Going back to the PDF's
  // own value and the automatic verdict clears the flag. An edit that leaves an
  // already-explained hand edit as it was keeps its reason.
  const auto = gradeResult(result_value, spec, null, { unit }).pass_fail;
  const changedVerdict = (pass_fail ?? null) !== (existing.pass_fail ?? null);
  const changedValue = squash(result_value) !== squash(existing.result_value);
  // A person's verdict: one they set now, or one already flagged as theirs. A
  // verdict an older row carries from before this rule is not re-asked on an
  // edit that leaves it alone (a note, say).
  const handVerdict = (pass_fail ?? null) !== (auto ?? null) && (changedVerdict || !!existing.verdict_manual);
  const fromPdf = existing.source === 'pdf' && existing.read_value != null;
  const handValue = fromPdf && squash(result_value) !== squash(existing.read_value);
  const given = String(req.body.edit_reason || '').trim();
  const nothingNew = !changedVerdict && !changedValue;
  const reason = given || (nothingNew ? existing.edit_reason : null) || null;
  if ((handVerdict || handValue) && String(reason || '').length < MIN_EDIT_REASON) {
    const why = [handValue ? `the value differs from the lab report (${existing.read_value})` : null,
      handVerdict ? `the pass/fail is set by hand (the approved limit gives ${auto || 'no verdict'})` : null].filter(Boolean).join(' and ');
    return res.status(400).json({ error: `${test_type}: ${why}. Say why, in at least ${MIN_EDIT_REASON} characters.`, needs_reason: true });
  }
  const flagged = handVerdict || handValue;
  // A row typed by hand may carry a reason it was given; a PDF row back at the
  // PDF's value with the automatic verdict carries none.
  const keepReason = flagged ? reason : (existing.source === 'manual' || existing.source == null ? (given || existing.edit_reason || null) : null);

  db.prepare(`UPDATE coa_test_results SET test_type = ?, result_value = ?, unit = ?, specification_id = ?, pass_fail = ?, notes = ?, method = ?, mdl = ?,
      verdict_manual = ?, edit_reason = ?, edited_by = ?, edited_at = CASE WHEN ? = 1 THEN datetime('now') ELSE edited_at END WHERE id = ?`)
    .run(test_type, result_value ?? null, unit, spec?.id || null, pass_fail, notes, method, mdl,
      handVerdict ? 1 : 0, keepReason, keepReason ? (given ? req.user.name : existing.edited_by) : null, given ? 1 : 0, req.params.id);

  rollUpRequestStatus(db, req.params.requestId);
  const updated = db.prepare('SELECT * FROM coa_test_results WHERE id = ?').get(req.params.id);
  logAudit(req.user, 'update', 'coa_test_result', req.params.id,
    { test_type, changed_pass_fail: existing.pass_fail !== pass_fail, hand_verdict: handVerdict, hand_value: handValue, edit_reason: keepReason,
      flag_cleared: !flagged && !!(existing.verdict_manual || (existing.edit_reason && existing.source === 'pdf')) }, existing, updated);
  res.json(updated);
});

router.delete('/requests/:requestId/results/:id', (req, res) => {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM coa_test_results WHERE id = ? AND request_id = ?').get(req.params.id, req.params.requestId);
  if (!existing) return res.status(404).json({ error: 'Test result not found' });
  if (isSigned(db.prepare('SELECT qa_signed_at FROM coa_requests WHERE id = ?').get(req.params.requestId))) {
    return res.status(409).json({ error: LOCKED_MESSAGE, locked: true });
  }

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
  // Which attached file this is (D-243): the scan names it so the apply can
  // record where each result came from. A PDF read without being attached has
  // no file, and its results are saved as typed by hand.
  const scannedSha = sha256(buffer);
  const sourceFile = (req.body?.file_id
    ? db.prepare('SELECT * FROM coa_files WHERE id = ? AND request_id = ?').get(req.body.file_id, req.params.id)
    : db.prepare("SELECT * FROM coa_files WHERE request_id = ? AND sha256 = ? AND file_type = 'lab_results' ORDER BY created_at DESC LIMIT 1").get(req.params.id, scannedSha)) || null;

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
      message: 'This PDF has no text in it — it is a scanned image of the report, so nothing can be read out of it automatically, and a certificate cannot be signed on it. Ask the lab for the original PDF, or type the results in by hand.',
      image_scan: true,
      source_name: sourceName,
      page_count: parsed.numpages,
      header: [], results: [], unmatched_specs: [],
    });
  }

  // The legacy line-pattern reader is a FALLBACK only (D-221): it runs when the
  // columnar reader found nothing, and its rows never carry a verdict. It used
  // to run first on every report, and its glued "<44" gluten row was what
  // reached the record.
  let extracted = { test_results: [] };
  let read_by = 'columns';
  let ai_error = null;

  // The columnar reader, for reports laid out as a table — which is all of
  // them. Deterministic: the same file gives the same answer every time, which
  // is why it is tried before the AI fallback.
  const columnarAll = (() => {
    try { return parseColumnarCoa(text); } catch (e) { console.warn('[coa] columnar read failed:', e.message); return null; }
  })();
  const columnarRows = columnarAll && foundSomething(columnarAll) ? columnarAll : null;
  if (columnarRows) {
    // "Customer:" on the report is US; the columnar reader files it as
    // lab_customer and never as the material's supplier.
    extracted = { ...Object.fromEntries(Object.entries(columnarRows).filter(([k, v]) => k !== 'test_results' && v)) };
    extracted.test_results = columnarRows.test_results;
  } else {
    extracted = legacyFallback(text);
    read_by = extracted.test_results.length ? 'patterns' : 'none';
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
          // A lab's "Specification: Report" is not a verdict (D-222): a stated
          // pass/fail is carried only when the report printed a real limit.
          pass_fail: statedVerdict(t.pass_fail, t.spec_on_report),
          method: t.method || null,
          spec_on_report: t.spec_on_report || null,
        }))),
      };
      if (aiRows > foundCount) read_by = read_by === 'none' ? 'ai' : `${read_by}+ai`;
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
    const graded = gradeResult(t.result_value, spec, t.pass_fail || null, { unit: t.unit || null });
    return {
      test_type: t.test_type,
      result_value: t.result_value,
      unit: t.unit || spec?.unit || null,
      method: t.method || null,
      mdl: t.mdl || null,
      spec_on_report: t.spec_on_report || null,
      specification_id: spec?.id || null,
      specification: spec ? (spec.specification || null) : null,
      pass_fail: graded.pass_fail,
      graded_by: graded.graded_by,
      // Why a result carries no verdict, always named — an empty cell reads as
      // a pass to anyone skimming.
      grade_reason: graded.reason,
      // A pass/fail the report itself printed — sent back on apply so the
      // server grades it the same way, never as a person's decision.
      stated: t.pass_fail || null,
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
    // Where the results come from, the two header facts a certificate needs,
    // and every line the reader could NOT read (D-243). Applying stores those
    // lines and files a QA Review item; this proposal writes nothing.
    file_id: sourceFile?.id || null,
    sha256: scannedSha,
    lab_report_number: columnarAll?.lab_report_number || null,
    report_date: columnarAll?.report_date || null,
    unread: columnarAll?.unread || [],
    counts: columnarAll?.counts || null,
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
  // Refusals come before anything is kept: multer has already written the
  // file, so a refused upload removes it again (D-224).
  const file_type = req.body.file_type || 'other';
  const refuse = (status, body) => { try { unlinkSync(req.file.path); } catch { /* already gone */ } return res.status(status).json(body); };
  if (!FILE_TYPES.includes(file_type)) return refuse(400, { error: `File type must be one of ${FILE_TYPES.join(', ')}.` });
  if (isSigned(request)) return refuse(409, { error: LOCKED_MESSAGE, locked: true });

  const id = uuid();
  const hash = sha256(readFileSync(req.file.path));
  db.prepare('INSERT INTO coa_files (id, request_id, file_type, filename, original_name, mime_type, size_bytes, uploaded_by, sha256) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, req.params.id, file_type, req.file.filename, req.file.originalname, req.file.mimetype, req.file.size, req.user.name, hash);

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
  if (isSigned(db.prepare('SELECT qa_signed_at FROM coa_requests WHERE id = ?').get(file.request_id))) {
    return res.status(409).json({ error: LOCKED_MESSAGE, locked: true });
  }

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
const canSignCoa = (u) => !!u && (['admin', 'supervisor'].includes(u.role) || u.department === 'qa');

router.post('/requests/:id/sign', async (req, res) => {
  if (!canSignCoa(req.user)) return res.status(403).json({ error: 'Only admins, supervisors, or QA can sign certificates.' });
  const db = getDb();
  const r = db.prepare('SELECT * FROM coa_requests WHERE id = ?').get(req.params.id);
  if (!r) return res.status(404).json({ error: 'COA request not found' });
  // The one held request (D-236): a failed lot's certificate is corrected and
  // NOT re-signed while its QA Review item is open.
  const hold = coaSignHold(db, r.id);
  if (hold) return res.status(409).json({ error: hold, held: true });

  let sig = req.body?.signature || null;
  if (!sig) sig = db.prepare('SELECT signature_image FROM users WHERE id = ?').get(req.user.id)?.signature_image || null;
  if (!sig) return res.status(400).json({ error: 'Draw a signature first (it can be saved for next time).' });
  if (typeof sig !== 'string' || sig.length > 400000 || !SIGNATURE_RE.test(sig)) {
    return res.status(400).json({ error: 'Signature must be a PNG/JPEG data URL under 300 KB.' });
  }
  if (req.body?.save) {
    db.prepare("UPDATE users SET signature_image = ?, updated_at = datetime('now') WHERE id = ?").run(sig, req.user.id);
  }

  // What is being certified has to be a clean pass (D-224): the status is
  // pass, every required test has a result, nothing failed or is undecided.
  const refusals = signRefusals(db, r);
  if (refusals.length) return res.status(409).json({ error: `This certificate cannot be signed: ${refusals.join('; ')}.`, sign_refused: true, reasons: refusals });

  // The lab report is read AGAIN and compared with what is saved, and no line
  // the reader could not read may be left open (D-243). In every gate mode:
  // this protects the record, it does not wait for strict.
  const checks = await signChecks(db, r, UPLOAD_DIR);
  if (checks.problems.length) {
    return res.status(409).json({ error: `This certificate cannot be signed: ${checks.problems.join('; ')}`, sign_refused: true, reasons: checks.problems, explained: checks.reread.explained });
  }

  // Signing the certificate IS the release. Same gate as the roll-up.
  const gate = gateFor(db, r);
  if (gate.blocks) return res.status(400).json({ error: `This certificate cannot be issued: ${gate.gaps.join('; ')}.`, release_blocked: true, gaps: gate.gaps });
  // The lot rule (D-246), for an item on the COA product list: this batch must
  // have every required test of an approved plan, all passing. Warn records
  // what strict would do; strict refuses. An override never opens this door.
  const lotDoor = signDoor(db, r, { actor: req.user.name });
  if (lotDoor.block) return res.status(409).json({ error: `This certificate cannot be signed in strict mode: ${lotDoor.reasons.join('; ')}.`, lot_blocked: true, reasons: lotDoor.reasons });

  // The QA signature on a certificate is a 21 CFR 11.200 signature: asked
  // last, after every refusal above, and before anything is written.
  if (!gateSignature(req, res, { action: 'coa_sign' })) return;

  // The number, the issuance date and the frozen snapshot are written in ONE
  // transaction, so two signings can never draw the same number (D-223).
  const issue = db.transaction(() => {
    const fresh = db.prepare('SELECT * FROM coa_requests WHERE id = ?').get(req.params.id);
    if (isSigned(fresh)) return { already: true };
    // Always a fresh number and today's date: a number found on an unsigned
    // request was never issued, and reusing it would certify under a number
    // the PDF view made up (D-228).
    const certNum = allocateCertNumber(db);
    const issued = plantDateOf();
    const snapshot = snapshotFor(db, fresh, { certificate_number: certNum, date_of_issuance: issued, signed_by: req.user.name,
      file_facts: Object.fromEntries(checks.reread.files.map(f => [f.id, f])) });
    const json = canonicalJson(snapshot);
    const hash = sha256(json);
    db.prepare(`UPDATE coa_requests SET qa_signed_by = ?, qa_signed_by_id = ?, qa_signed_at = datetime('now'),
                qa_signature = ?, certificate_number = ?, date_of_issuance = ?,
                signed_snapshot = ?, signed_content_hash = ?,
                release_gaps = ?, release_gate_mode = ?,
                updated_at = datetime('now') WHERE id = ?`)
      .run(req.user.name, req.user.id, sig, certNum, issued, json, hash,
        gate.mode === 'off' || gate.ok ? null : JSON.stringify(gate.gaps), gate.mode, req.params.id);
    return { certNum, hash };
  });
  const done = issue();
  if (done.already) return res.status(409).json({ error: 'This certificate is already signed.' });
  logAudit(req.user, 'sign', 'coa_request', req.params.id,
    { certificate_number: done.certNum, content_sha256: done.hash, ...signatureEvidence(), attestation: 'I certify that the results on this Certificate of Analysis are true and accurate as obtained for the lot identified.' },
    null, null, `${r.item_description} · Lot ${r.lot_number}`);
  res.json(db.prepare('SELECT * FROM coa_requests WHERE id = ?').get(req.params.id));
});

// Un-signing is the one way back, and it says why (D-224). It clears the
// signature AND the certificate number and issuance date: the number is void
// and is never issued again (the counter does not go back). Audited with the
// number and the snapshot hash it voided.
//
// An admin, as before; or a QA reviewer for exactly the requests an open COA
// correction item names (D-236) — then with the password, and the audit row
// says which item and which decision authorized it.
router.delete('/requests/:id/sign', (req, res) => {
  const db = getDb();
  const allowed = coaCorrectionAllowed(db, req.user, req.params.id, 'unsign');
  if (!allowed) return res.status(403).json({ error: 'Only an admin can un-sign a certificate, or Quality while a COA correction in QA Review asks for it.' });
  const r = db.prepare('SELECT * FROM coa_requests WHERE id = ?').get(req.params.id);
  if (!r) return res.status(404).json({ error: 'COA request not found' });
  if (!isSigned(r)) return res.status(409).json({ error: 'This certificate is not signed.' });
  // A certificate on the public page is withdrawn first (D-247): un-signing it
  // underneath would leave the web showing a certificate that no longer exists.
  const live = db.prepare("SELECT public_id FROM coa_publications WHERE request_id = ? AND status = 'published'").get(r.id);
  if (live) return res.status(409).json({ error: 'This certificate is published on the public page. Withdraw the publication first, then un-sign.', published: true });
  const reason = String(req.body?.reason || '').trim();
  if (reason.length < 3) return res.status(400).json({ error: 'Say why the signature is being removed.' });
  if (!allowed.admin && !gateSignature(req, res, { action: 'coa_unsign' })) return;
  db.prepare(`UPDATE coa_requests SET qa_signed_by = NULL, qa_signed_by_id = NULL, qa_signed_at = NULL, qa_signature = NULL,
              certificate_number = NULL, date_of_issuance = NULL, signed_snapshot = NULL, signed_content_hash = NULL,
              updated_at = datetime('now') WHERE id = ?`).run(req.params.id);
  logAudit(req.user, 'unsign', 'coa_request', req.params.id,
    { reason, previous_signer: r.qa_signed_by, voided_certificate_number: r.certificate_number, voided_content_sha256: r.signed_content_hash,
      ...(allowed.item ? { authorized_by: allowed.item.item_key, decision: CORRECTION_DECISION } : {}),
      ...(!allowed.admin ? signatureEvidence() : {}) },
    null, null, `${r.item_description} · Lot ${r.lot_number}`);
  res.json({ ok: true });
});

// ──────────────── PDF Export (Facility COA) ────────────────

router.get('/requests/:id/pdf', (req, res) => {
  const db = getDb();
  const r = db.prepare('SELECT * FROM coa_requests WHERE id = ?').get(req.params.id);
  if (!r) return res.status(404).json({ error: 'COA request not found' });

  // READING THE CERTIFICATE CHANGES NOTHING (D-223). It used to hand out a
  // certificate number to any request it was opened on. A request that is not
  // a signed pass has no certificate: 409, unless an internal DRAFT preview is
  // asked for, which is watermarked and carries no number.
  const issued = !!(isSigned(r) && r.status === 'pass' && r.certificate_number);
  if (!issued && req.query.draft !== '1') {
    return res.status(409).json({ error: 'This request has no issued certificate. Only a signed pass is a Certificate of Analysis; a draft preview is available.', draft_available: true });
  }
  // A signed certificate prints what was signed — its frozen snapshot — so a
  // spec edited next year cannot change the limits on this year's paper.
  // Certificates signed before snapshots existed print from the live rows.
  const snap = (issued && r.signed_snapshot && (() => { try { return JSON.parse(r.signed_snapshot); } catch { return null; } })())
    || snapshotFor(db, r, { certificate_number: issued ? r.certificate_number : null, date_of_issuance: issued ? r.date_of_issuance : null });
  const testResults = snap.results;
  // Version 2 (D-244) prints what version 1 could not: the lab's report number
  // and date, the MDL, and a † on every result entered or graded by hand.
  // Certificates signed before print exactly as they always did.
  const v2 = (snap.snapshot_version || 1) >= 2;
  const signer = v2 ? snap.signed_by : r.qa_signed_by;
  const certNum = issued ? r.certificate_number : 'DRAFT';
  const specFor = (tr) => ({ method: tr.method, specification: tr.specification || (tr.min_value != null || tr.max_value != null ? specText(tr) : null), unit: tr.unit });
  Object.assign(r, snap.request);

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
  // ≤, ≥, µ and a customer's own characters print as written (D-234).
  embedUnicodeFaces(doc);
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
  doc.font('Helvetica-Bold').fontSize(17).fillColor(issued ? SLATE : RED)
    .text(issued ? 'CERTIFICATE OF ANALYSIS' : 'DRAFT — NOT A CERTIFICATE', lm, y, { width: pageW, align: 'center', characterSpacing: 1 });
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
    ...(v2 && (snap.lab_report_number || snap.lab_report_date) ? [['Lab Report No.', na(snap.lab_report_number), 'Report Date', fmtDate(snap.lab_report_date)]] : []),
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
      v2 && tr.mdl ? `${spec?.method || ''}\nMDL ${displayMdl(tr.mdl)}` : (spec?.method || ''),
      spec?.specification || '',
      v2 && tr.manual ? `${tr.result_value || ''} †` : (tr.result_value || ''),
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

  // The hand-entered results, each with its reason (D-244).
  const handRows = v2 ? testResults.filter(t => t.manual) : [];
  if (handRows.length) {
    y += 8;
    doc.font('Helvetica').fontSize(7.4).fillColor('#444');
    for (const t of handRows) {
      const line = `† ${t.test_type}: entered or graded by hand${t.edit_reason ? `: ${t.edit_reason}` : ''}.`;
      const h = doc.heightOfString(line, { width: pageW });
      if (y + h > bottomY()) { doc.addPage(); y = doc.page.margins.top; }
      doc.text(line, lm, y, { width: pageW });
      y += h + 2;
    }
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
    .text(signer ? `${signer} — Quality` : 'Quality', lm, y + 27);
  doc.font('Helvetica').fontSize(8).fillColor('#666')
    .text(r.qa_signed_at ? `Digitally signed ${fmtDate(r.qa_signed_at)}` : 'Powder Ops Quality Assurance', lm, y + 38);

  doc.moveTo(lm + pageW - sigW, y + 22).lineTo(lm + pageW, y + 22).lineWidth(0.8).strokeColor('#999').stroke();
  doc.font('Helvetica-Bold').fontSize(8.5).fillColor(SLATE).text('Date of Issuance', lm + pageW - sigW, y + 27);
  doc.font('Helvetica').fontSize(8).fillColor('#666').text(issued ? fmtDate(r.date_of_issuance) : 'Not issued', lm + pageW - sigW, y + 38);

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
    if (!issued) {
      // The watermark: a draft must not be mistaken for the document.
      doc.save().rotate(-35, { origin: [doc.page.width / 2, doc.page.height / 2] })
        .font('Helvetica-Bold').fontSize(80).fillColor(RED).opacity(0.12)
        .text('DRAFT', 0, doc.page.height / 2 - 40, { width: doc.page.width, align: 'center', lineBreak: false })
        .restore();
    }
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
 * Read a PDF's text layer by cell position (server/coa-pdf-text.js, D-221).
 * One reader for /scan and /parse-coa, so the same file reads the same way on
 * either screen.
 */
const pdfLines = readPdfColumns;

/**
 * The legacy line-pattern read, as a FALLBACK only: called when the columnar
 * reader found no result rows. Its rows never carry a verdict and it sets no
 * status — it once mapped "does not comply" to pass, and a stated verdict
 * outranked the specification (D-222).
 */
/** A verdict the report printed, kept only beside a real specification — never beside "Report" or nothing. */
function statedVerdict(passFail, specOnReport) {
  if (passFail !== 'pass' && passFail !== 'fail') return null;
  const spec = String(specOnReport || '').trim();
  if (!spec || /^(report|reported|result|n\/?a|-+)$/i.test(spec)) return null;
  return passFail;
}

function legacyFallback(text) {
  const r = parseCTLACoa(text);
  delete r.status;
  r.test_results = (r.test_results || []).map(t => ({ ...t, pass_fail: null }));
  return r;
}

router.post('/parse-coa', coaUpload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'PDF file required' });

  try {
    const parsed = await pdfLines(req.file.buffer);
    const columnar = parseColumnarCoa(parsed.text);
    const extracted = foundSomething(columnar) ? { ...columnar } : legacyFallback(parsed.text);

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

// Filing a request straight from a read PDF (D-224). Three fixes:
//  · the file is filed as 'lab_results' — the old 'lab_report' broke the
//    table's CHECK, so every one of these requests lost its PDF;
//  · request, results and file go in ONE transaction, so a failure leaves
//    nothing half-filed;
//  · the ctla_<lot> key is checked: the same lot filed twice is refused and
//    names the request already on file.
// The status is never taken from the client: it is derived from the results.
const UPLOADED_NAME = /^[0-9a-f-]{36}\.pdf$/;
router.post('/import-parsed-coa', (req, res) => {
  const db = getDb();
  const { parsed, uploaded_file } = req.body || {};

  if (!parsed?.item_description && !parsed?.lot_number) {
    return res.status(400).json({ error: 'Parsed data must include at least item_description or lot_number' });
  }
  if (badStatus(parsed.status)) return res.status(400).json({ error: `Status must be one of ${STATUSES.join(', ')}.` });
  for (const t of parsed.test_results || []) {
    if (t.pass_fail != null && t.pass_fail !== '' && !['pass', 'fail', 'na'].includes(t.pass_fail)) {
      return res.status(400).json({ error: 'A result\'s pass/fail must be pass, fail or na.' });
    }
  }
  let fileHash = null;
  if (uploaded_file) {
    if (!UPLOADED_NAME.test(String(uploaded_file.filename || ''))) return res.status(400).json({ error: 'That uploaded file is not one this server stored.' });
    const p = path.join(UPLOAD_DIR, uploaded_file.filename);
    if (!existsSync(p)) return res.status(400).json({ error: 'The uploaded PDF is no longer on the server. Read the file again.' });
    fileHash = sha256(readFileSync(p));
  }

  const sourceRef = parsed.lot_number ? `ctla_${parsed.lot_number}` : `ctla_${Date.now()}`;
  if (parsed.lot_number) {
    const dupe = db.prepare("SELECT id, item_description FROM coa_requests WHERE source_ref = ?").get(sourceRef);
    if (dupe) return res.status(409).json({ error: `Lot ${parsed.lot_number} was already filed from a lab report (${dupe.item_description}).`, existing_id: dupe.id });
  }

  const id = uuid();
  const file = db.transaction(() => {
    let ctlaLab = db.prepare("SELECT id FROM coa_labs WHERE name = 'CTLA'").get();
    if (!ctlaLab) {
      ctlaLab = { id: uuid() };
      db.prepare("INSERT INTO coa_labs (id, name) VALUES (?, 'CTLA')").run(ctlaLab.id);
    }
    db.prepare(`INSERT INTO coa_requests (id, item_number, item_description, lot_number, product_expiration, tests_requested, status, lab_id, lab_name, date_of_results, origin, supplier, product_code, manufacturer_lot, vendor_lot, received_date, source, source_ref, created_by)
      VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, parsed.item_number || '', parsed.item_description || 'Unknown', parsed.lot_number || '', parsed.product_expiration || null,
        parsed.tests_requested || 'Unknown', ctlaLab.id, 'CTLA',
        parsed.date_of_results || null, parsed.origin || null, parsed.supplier || null,
        parsed.product_code || null, parsed.manufacturer_lot || null, parsed.vendor_lot || null,
        parsed.received_date || null, 'ctla_coa_upload', sourceRef, req.user.name);

    if (parsed.test_results?.length > 0) {
      const specs = db.prepare('SELECT * FROM coa_specifications WHERE item_number = ? AND is_active = 1').all(parsed.item_number || '');
      const index = specIndex(specs);
      const insertResult = db.prepare('INSERT INTO coa_test_results (id, request_id, test_type, result_value, unit, specification_id, pass_fail, method, mdl) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
      for (const tr of parsed.test_results) {
        const spec = index.find(tr.test_type);
        const { pass_fail } = gradeResult(tr.result_value, spec, tr.pass_fail || null, { unit: tr.unit || null });
        insertResult.run(uuid(), id, tr.test_type, tr.result_value ?? null, tr.unit || spec?.unit || null, spec?.id || null, pass_fail,
          cleanText(tr.method), cleanText(tr.mdl));
      }
      rollUpRequestStatus(db, id);
    }

    if (uploaded_file) {
      db.prepare('INSERT INTO coa_files (id, request_id, file_type, filename, original_name, mime_type, size_bytes, uploaded_by, sha256) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(uuid(), id, 'lab_results', uploaded_file.filename, uploaded_file.original_name || uploaded_file.filename, 'application/pdf', uploaded_file.size_bytes || null, req.user.name, fileHash);
    }
  });
  try { file(); } catch (e) {
    return res.status(400).json({ error: `Nothing was filed: ${e.message}` });
  }

  const created = db.prepare('SELECT * FROM coa_requests WHERE id = ?').get(id);
  const test_results = db.prepare('SELECT * FROM coa_test_results WHERE request_id = ?').all(id);
  logAudit(req.user, 'import_coa_pdf', 'coa_request', id, { source: 'ctla_upload', file_sha256: fileHash }, null, created);
  res.status(201).json({ ...created, test_results });
});

// ──────────────── Brand owner (default-deny) ────────────────
//
// Whose product a request is. Every row starts 'unassigned', and NOTHING in
// this phase treats any value — or the brand table's publish flag — as
// permission to publish (D-226). Only an admin or Quality sets it; audited.
const canSetBrand = (u) => !!u && (u.role === 'admin' || u.department === 'qa');

router.get('/brands', (_req, res) => {
  res.json(getDb().prepare('SELECT id, name FROM coa_brands ORDER BY name').all());
});

router.put('/requests/:id/brand-owner', (req, res) => {
  if (!canSetBrand(req.user)) return res.status(403).json({ error: 'Only an admin or Quality can set whose product this is.' });
  const db = getDb();
  const r = db.prepare('SELECT * FROM coa_requests WHERE id = ?').get(req.params.id);
  if (!r) return res.status(404).json({ error: 'COA request not found' });
  const value = String(req.body?.brand_owner ?? '').trim();
  const known = value === 'unassigned' || !!db.prepare('SELECT 1 FROM coa_brands WHERE name = ?').get(value);
  if (!known) return res.status(400).json({ error: 'Brand owner must be "unassigned" or a brand on the list.' });
  db.prepare("UPDATE coa_requests SET brand_owner = ?, updated_at = datetime('now') WHERE id = ?").run(value, r.id);
  logAudit(req.user, 'update', 'coa_request', r.id, { brand_owner: { from: r.brand_owner, to: value } },
    { brand_owner: r.brand_owner }, { brand_owner: value }, `${r.item_description} · Lot ${r.lot_number}`);
  res.json({ id: r.id, brand_owner: value });
});

// ──────────────── Brands: create, and assign in bulk (D-238) ────────────────
//
// A new brand is ALWAYS created closed to publishing — the column's default,
// which this file never names, so nothing here can open it or read it. Bulk assignment moves a request
// from `unassigned` to a brand, never from one brand to another unless an
// admin says so with a reason. Preview writes nothing; apply is one
// transaction, signed with the password, one audit row per request.
const canManageBrands = (u) => isQaReviewer(u);
const BRAND_NAME = (v) => String(v ?? '').trim().replace(/\s+/g, ' ');
const brandNameError = (name) => (name.length < 2 || name.length > 60) ? 'A brand name is 2 to 60 characters.'
  : name.toLowerCase() === 'unassigned' ? '"unassigned" is not a brand.' : null;

function insertBrand(db, name) {
  const id = `brand-${uuid()}`;
  db.prepare('INSERT INTO coa_brands (id, name) VALUES (?, ?)').run(id, name);
  return db.prepare('SELECT id, name FROM coa_brands WHERE id = ?').get(id);
}

router.post('/brands', (req, res) => {
  if (!canManageBrands(req.user)) return res.status(403).json({ error: 'Only an admin or Quality can add a brand.' });
  const db = getDb();
  const name = BRAND_NAME(req.body?.name);
  const bad = brandNameError(name);
  if (bad) return res.status(400).json({ error: bad });
  if (db.prepare('SELECT 1 FROM coa_brands WHERE LOWER(name) = LOWER(?)').get(name)) return res.status(409).json({ error: `"${name}" is already on the list.` });
  const created = insertBrand(db, name);
  logAudit(req.user, 'create', 'coa_brand', created.id, { name, publishing: 'closed (default)' }, null, created, name);
  res.status(201).json({ id: created.id, name: created.name });
});

export const BULK_BRAND_MAX = 2000;

/** The plan for a bulk brand assignment. Writes nothing. */
export function planBrandBulk(db, rows, { user, allowChange = false, createMissing = false } = {}) {
  const brands = new Map(db.prepare('SELECT name FROM coa_brands').all().map(b => [b.name.toLowerCase(), b.name]));
  const seen = new Set();
  const out = { changes: [], no_ops: [], errors: [], brands_to_create: [], by_brand: {}, by_confidence: {} };
  const toCreate = new Map();
  rows.forEach((row, i) => {
    const request_id = String(row?.request_id ?? '').trim();
    const target = BRAND_NAME(row?.brand_owner);
    const err = (error) => out.errors.push({ row: i + 1, request_id, brand_owner: target, error });
    if (!request_id) return err('No request id.');
    if (seen.has(request_id)) return err('This request is listed twice.');
    seen.add(request_id);
    const r = db.prepare('SELECT id, brand_owner, item_number, item_description, lot_number FROM coa_requests WHERE id = ?').get(request_id);
    if (!r) return err('No such request.');
    const from = r.brand_owner || 'unassigned';
    if (!target || target.toLowerCase() === 'unassigned') return out.no_ops.push({ row: i + 1, request_id, reason: 'target is unassigned' });
    let name = brands.get(target.toLowerCase()) || toCreate.get(target.toLowerCase());
    if (!name) {
      if (!createMissing) return err(`"${target}" is not a brand on the list.`);
      const bad = brandNameError(target);
      if (bad) return err(bad);
      name = target; toCreate.set(target.toLowerCase(), target);
    }
    if (from === name) return out.no_ops.push({ row: i + 1, request_id, reason: `already ${name}` });
    if (from !== 'unassigned' && !(allowChange && user?.role === 'admin')) {
      return err(`Already assigned to ${from}. Changing an assigned request needs an admin and allow_change.`);
    }
    out.changes.push({ row: i + 1, request_id, from, to: name, item_number: r.item_number, item_description: r.item_description, lot_number: r.lot_number,
      confidence: row?.confidence ?? null });
    out.by_brand[name] = (out.by_brand[name] || 0) + 1;
    if (row?.confidence != null && row.confidence !== '') out.by_confidence[row.confidence] = (out.by_confidence[row.confidence] || 0) + 1;
  });
  out.brands_to_create = [...toCreate.values()].filter(n => out.changes.some(c => c.to === n));
  return out;
}

router.post('/requests/brand-owner/bulk', (req, res) => {
  if (!canManageBrands(req.user)) return res.status(403).json({ error: 'Only an admin or Quality can assign brands.' });
  const db = getDb();
  const rows = Array.isArray(req.body?.rows) ? req.body.rows : null;
  if (!rows || !rows.length) return res.status(400).json({ error: 'rows is required.' });
  if (rows.length > BULK_BRAND_MAX) return res.status(400).json({ error: `At most ${BULK_BRAND_MAX} rows at a time.` });
  const mode = req.body?.mode === 'apply' ? 'apply' : 'preview';
  const allowChange = req.body?.allow_change === true;
  const reason = String(req.body?.reason || '').trim();
  if (allowChange && req.user?.role !== 'admin') return res.status(403).json({ error: 'Only an admin can change a request that already has a brand.' });
  if (allowChange && reason.length < 3) return res.status(400).json({ error: 'Say why assigned requests are being changed.' });
  const plan = planBrandBulk(db, rows, { user: req.user, allowChange, createMissing: req.body?.create_missing_brands === true });
  const summary = { changes: plan.changes.length, no_ops: plan.no_ops.length, errors: plan.errors.length };
  if (mode === 'preview') return res.json({ mode, ...summary, plan });

  if (reason.length < 3) return res.status(400).json({ error: 'Say why these brands are being assigned.' });
  if (!gateSignature(req, res, { action: 'coa_brand_bulk' })) return;
  const batch_id = uuid();
  const created = [];
  db.transaction(() => {
    for (const name of plan.brands_to_create) {
      if (!db.prepare('SELECT 1 FROM coa_brands WHERE LOWER(name) = LOWER(?)').get(name)) created.push(insertBrand(db, name));
    }
    const set = db.prepare("UPDATE coa_requests SET brand_owner = ?, updated_at = datetime('now') WHERE id = ? AND COALESCE(brand_owner, 'unassigned') = ?");
    for (const c of plan.changes) {
      const info = set.run(c.to, c.request_id, c.from);
      if (!info.changes) continue;
      logAudit(req.user, 'update', 'coa_request', c.request_id, { brand_owner: { from: c.from, to: c.to }, batch_id, reason },
        { brand_owner: c.from }, { brand_owner: c.to }, `${c.item_description} · Lot ${c.lot_number}`);
    }
  })();
  for (const b of created) logAudit(req.user, 'create', 'coa_brand', b.id, { name: b.name, publishing: 'closed (default)', batch_id }, null, b, b.name);
  logAudit(req.user, 'bulk_update', 'coa_brand_assignment', batch_id,
    { ...signatureEvidence(), reason, changed: plan.changes.length, no_ops: plan.no_ops.length, errors: plan.errors.length,
      by_brand: plan.by_brand, brands_created: created.map(b => b.name), allow_change: allowChange });
  res.json({ mode, batch_id, ...summary, brands_created: created.map(b => b.name), plan });
});

// ──────────────── COA settings (scaffold, no consumers) ────────────────
//
// Two decisions recorded as settings so they can change later without a
// deploy. Nothing reads them in this phase except this API and its screen.
export const COA_SETTINGS = {
  evidence_disclosure_mode: ['never', 'on_request_approval'],
  public_nonclaim_gluten_display: ['hidden', 'visible'],
};
// A move AWAY from the closed default is a decision someone has to explain:
// sharing lab evidence, or showing a non-claim gluten result (D-233).
const SETTING_NEEDS_REASON = {
  evidence_disclosure_mode: (v) => v !== 'never',
  public_nonclaim_gluten_display: (v) => v === 'visible',
};
router.get('/settings', (_req, res) => {
  const rows = getDb().prepare('SELECT key, value, updated_by, updated_at FROM coa_settings').all();
  res.json({ settings: rows.filter(r => COA_SETTINGS[r.key]), allowed: COA_SETTINGS });
});
router.put('/settings/:key', requireRole('admin'), (req, res) => {
  const allowed = COA_SETTINGS[req.params.key];
  if (!allowed) return res.status(404).json({ error: 'No such setting.' });
  const value = req.body?.value;
  if (!allowed.includes(value)) return res.status(400).json({ error: `Must be one of ${allowed.join(', ')}.` });
  const db = getDb();
  const before = db.prepare('SELECT value FROM coa_settings WHERE key = ?').get(req.params.key)?.value ?? null;
  const reason = String(req.body?.reason ?? '').trim();
  if (value !== before && SETTING_NEEDS_REASON[req.params.key]?.(value) && reason.length < 3) {
    return res.status(400).json({ error: 'Say why this is changing — this setting opens something that is closed by default.', reason_required: true });
  }
  db.prepare(`INSERT INTO coa_settings (key, value, updated_by, updated_at) VALUES (?, ?, ?, datetime('now'))
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_by = excluded.updated_by, updated_at = excluded.updated_at`)
    .run(req.params.key, value, req.user.name);
  logAudit(req.user, 'update', 'coa_setting', req.params.key, { from: before, to: value, ...(reason ? { reason } : {}) }, { value: before }, { value });
  res.json({ key: req.params.key, value });
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
