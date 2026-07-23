import { Router } from 'express';
import { v4 as uuid } from 'uuid';
import multer from 'multer';
import path from 'path';
import { mkdirSync, existsSync, createReadStream, statSync, unlinkSync } from 'fs';
import { fileURLToPath } from 'url';
import PDFDocument from 'pdfkit';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { getDb, logAudit } from '../db.js';
import { requireRole } from '../middleware/auth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOAD_DIR = path.join(__dirname, '..', '..', 'data', 'coa-files');
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

  sql += ' ORDER BY date_sent DESC, created_at DESC';
  const requests = db.prepare(sql).all(...params);

  const fileCountStmt = db.prepare('SELECT request_id, file_type, COUNT(*) as count FROM coa_files WHERE request_id IN (' + requests.map(() => '?').join(',') + ') GROUP BY request_id, file_type');
  const fileCounts = requests.length > 0 ? fileCountStmt.all(...requests.map(r => r.id)) : [];
  const fileMap = {};
  for (const fc of fileCounts) {
    if (!fileMap[fc.request_id]) fileMap[fc.request_id] = {};
    fileMap[fc.request_id][fc.file_type] = fc.count;
  }

  res.json(requests.map(r => ({ ...r, file_counts: fileMap[r.id] || {} })));
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

  const specs = db.prepare('SELECT * FROM coa_specifications WHERE item_number = ? AND is_active = 1').all(request.item_number);
  const specMap = {};
  for (const s of specs) {
    specMap[s.test_type] = s;
  }

  const tx = db.transaction((rows) => {
    const created = [];
    for (const r of rows) {
      const id = uuid();
      const spec = specMap[r.test_type];
      let pass_fail = r.pass_fail || null;

      if (spec && r.result_value != null && !pass_fail) {
        const val = parseFloat(r.result_value);
        if (!isNaN(val)) {
          if (spec.min_value != null && spec.max_value != null) {
            pass_fail = val >= spec.min_value && val <= spec.max_value ? 'pass' : 'fail';
          } else if (spec.max_value != null) {
            pass_fail = val <= spec.max_value ? 'pass' : 'fail';
          } else if (spec.min_value != null) {
            pass_fail = val >= spec.min_value ? 'pass' : 'fail';
          }
        }
      }

      insert.run(id, req.params.id, r.test_type, r.result_value ?? null, r.unit || spec?.unit || null, spec?.id || null, pass_fail, r.notes || null);
      created.push(db.prepare('SELECT * FROM coa_test_results WHERE id = ?').get(id));
    }
    return created;
  });

  const created = tx(results);

  const allResults = db.prepare('SELECT pass_fail FROM coa_test_results WHERE request_id = ?').all(req.params.id);
  const hasFail = allResults.some(r => r.pass_fail === 'fail');
  const allPass = allResults.length > 0 && allResults.every(r => r.pass_fail === 'pass' || r.pass_fail === 'na');
  if (hasFail) {
    db.prepare("UPDATE coa_requests SET status = 'fail', date_of_results = COALESCE(date_of_results, date('now')), updated_at = datetime('now') WHERE id = ?").run(req.params.id);
  } else if (allPass) {
    db.prepare("UPDATE coa_requests SET status = 'pass', date_of_results = COALESCE(date_of_results, date('now')), updated_at = datetime('now') WHERE id = ?").run(req.params.id);
  }

  logAudit(req.user, 'create', 'coa_test_results', req.params.id, { results }, null, created);
  res.status(201).json(created);
});

router.delete('/requests/:requestId/results/:id', (req, res) => {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM coa_test_results WHERE id = ? AND request_id = ?').get(req.params.id, req.params.requestId);
  if (!existing) return res.status(404).json({ error: 'Test result not found' });

  db.prepare('DELETE FROM coa_test_results WHERE id = ?').run(req.params.id);
  logAudit(req.user, 'delete', 'coa_test_result', req.params.id, null, existing, null);
  res.json({ success: true });
});

// ──────────────── File Upload/Download ────────────────

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
  for (const [l1, v1, l2, v2] of info) {
    doc.font('Helvetica-Bold').fillColor('#777').text(l1.toUpperCase(), lm, y, { width: labW });
    doc.font('Helvetica').fillColor('#111').text(v1, lm + labW, y, { width: halfW - labW - 10 });
    doc.font('Helvetica-Bold').fillColor('#777').text(l2.toUpperCase(), lm + halfW, y, { width: labW });
    doc.font('Helvetica').fillColor('#111').text(v2, lm + halfW + labW, y, { width: halfW - labW });
    y += 16;
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

const coaUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    cb(null, path.extname(file.originalname).toLowerCase() === '.pdf');
  },
});

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

router.post('/parse-coa', coaUpload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'PDF file required' });

  try {
    const pdfDoc = await getDocument({ data: new Uint8Array(req.file.buffer) }).promise;
    const textParts = [];
    for (let i = 1; i <= pdfDoc.numPages; i++) {
      const page = await pdfDoc.getPage(i);
      const content = await page.getTextContent();
      let lastY = null;
      const lineTexts = [];
      for (const item of content.items) {
        const y = item.transform?.[5];
        if (lastY !== null && y !== undefined && Math.abs(y - lastY) > 2) {
          lineTexts.push('\n');
        }
        lineTexts.push(item.str);
        if (y !== undefined) lastY = y;
      }
      textParts.push(lineTexts.join(''));
    }
    const parsed = { text: textParts.join('\n'), numpages: pdfDoc.numPages };
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
