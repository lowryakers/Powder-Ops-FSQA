import { Router } from 'express';
import { v4 as uuid } from 'uuid';
import multer from 'multer';
import path from 'path';
import { mkdirSync, existsSync, createReadStream, statSync, unlinkSync } from 'fs';
import { fileURLToPath } from 'url';
import { getDb, logAudit } from '../db.js';
import { requireRole } from '../middleware/auth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOAD_DIR = path.join(__dirname, '..', '..', 'data', 'coa-files');
mkdirSync(UPLOAD_DIR, { recursive: true });

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
  logAudit(req.user.name, 'create', 'coa_lab', id, req.body, null, created);
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
  logAudit(req.user.name, 'update', 'coa_lab', req.params.id, req.body, existing, updated);
  res.json(updated);
});

// ──────────────── Specifications ────────────────

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
  const { item_number, item_description, test_type, specification, unit, min_value, max_value, method } = req.body;
  if (!item_number || !item_description || !test_type) {
    return res.status(400).json({ error: 'item_number, item_description, and test_type are required' });
  }

  const id = uuid();
  db.prepare(`INSERT INTO coa_specifications (id, item_number, item_description, test_type, specification, unit, min_value, max_value, method, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, item_number, item_description, test_type, specification || null, unit || null, min_value ?? null, max_value ?? null, method || null, req.user.name);

  const created = db.prepare('SELECT * FROM coa_specifications WHERE id = ?').get(id);
  logAudit(req.user.name, 'create', 'coa_specification', id, req.body, null, created);
  res.status(201).json(created);
});

router.put('/specifications/:id', (req, res) => {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM coa_specifications WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Specification not found' });

  const fields = ['item_number', 'item_description', 'test_type', 'specification', 'unit', 'min_value', 'max_value', 'method', 'is_active'];
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
  logAudit(req.user.name, 'update', 'coa_specification', req.params.id, req.body, existing, updated);
  res.json(updated);
});

router.delete('/specifications/:id', (req, res) => {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM coa_specifications WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Specification not found' });

  db.prepare("UPDATE coa_specifications SET is_active = 0, updated_at = datetime('now') WHERE id = ?").run(req.params.id);
  logAudit(req.user.name, 'delete', 'coa_specification', req.params.id, null, existing, null);
  res.json({ success: true });
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
    sql += ' AND (item_number LIKE ? OR item_description LIKE ? OR lot_number LIKE ?)';
    const s = `%${search}%`;
    params.push(s, s, s);
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
  const { item_number, item_description, lot_number, product_expiration, tests_requested, lab_id, date_sent, tat_days, expected_results_date, requested_by, notes } = req.body;

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

  db.prepare(`INSERT INTO coa_requests (id, item_number, item_description, lot_number, product_expiration, tests_requested, status, lab_id, lab_name, date_sent, tat_days, expected_results_date, requested_by, notes, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, item_number, item_description, lot_number, product_expiration || null, tests_requested, status, lab_id || null, lab_name, date_sent || null, tat_days || null, expected_results_date || null, requested_by || req.user.name, notes || null, req.user.name);

  const created = db.prepare('SELECT * FROM coa_requests WHERE id = ?').get(id);
  logAudit(req.user.name, 'create', 'coa_request', id, req.body, null, created);
  res.status(201).json(created);
});

router.put('/requests/:id', (req, res) => {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM coa_requests WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'COA request not found' });

  const fields = ['item_number', 'item_description', 'lot_number', 'product_expiration', 'tests_requested', 'status', 'lab_id', 'lab_name', 'date_sent', 'tat_days', 'expected_results_date', 'date_of_results', 'date_sent_to_customer', 'requested_by', 'invoice_amount', 'retest_required', 'retest_of', 'notes'];
  const updates = [];
  const values = [];

  for (const f of fields) {
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
  logAudit(req.user.name, 'update', 'coa_request', req.params.id, req.body, existing, updated);
  res.json(updated);
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

  logAudit(req.user.name, 'create', 'coa_test_results', req.params.id, { results }, null, created);
  res.status(201).json(created);
});

router.delete('/requests/:requestId/results/:id', (req, res) => {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM coa_test_results WHERE id = ? AND request_id = ?').get(req.params.id, req.params.requestId);
  if (!existing) return res.status(404).json({ error: 'Test result not found' });

  db.prepare('DELETE FROM coa_test_results WHERE id = ?').run(req.params.id);
  logAudit(req.user.name, 'delete', 'coa_test_result', req.params.id, null, existing, null);
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
  logAudit(req.user.name, 'upload', 'coa_file', id, { file_type, original_name: req.file.originalname }, null, created);
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
  res.setHeader('Content-Disposition', `attachment; filename="${file.original_name}"`);
  createReadStream(filePath).pipe(res);
});

router.delete('/files/:id', (req, res) => {
  const db = getDb();
  const file = db.prepare('SELECT * FROM coa_files WHERE id = ?').get(req.params.id);
  if (!file) return res.status(404).json({ error: 'File not found' });

  const filePath = path.join(UPLOAD_DIR, file.filename);
  db.prepare('DELETE FROM coa_files WHERE id = ?').run(req.params.id);
  if (existsSync(filePath)) unlinkSync(filePath);
  logAudit(req.user.name, 'delete', 'coa_file', req.params.id, null, file, null);
  res.json({ success: true });
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
    logAudit(req.user.name, 'import', 'coa_requests', null, { count: result.imported, source }, null, null);
    res.status(201).json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ──────────────── Distinct values for filters ────────────────

router.get('/distinct', (_req, res) => {
  const db = getDb();
  const items = db.prepare('SELECT DISTINCT item_number, item_description FROM coa_requests ORDER BY item_number').all();
  const tests = db.prepare('SELECT DISTINCT tests_requested FROM coa_requests ORDER BY tests_requested').all().map(r => r.tests_requested);
  res.json({ items, tests });
});

export default router;
