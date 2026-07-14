import { Router } from 'express';
import { v4 as uuid } from 'uuid';
import PDFDocument from 'pdfkit';
import { getDb, logAudit } from '../db.js';

const router = Router();

const parseApprovals = (raw) => { try { return raw ? JSON.parse(raw) : {}; } catch { return {}; } };

function loadItems(db, disposalId) {
  return db.prepare('SELECT * FROM disposal_items WHERE disposal_id = ? ORDER BY sort_order, rowid').all(disposalId);
}

// GET / — list disposals with their items + a short summary
router.get('/', (req, res) => {
  const db = getDb();
  const { q } = req.query;
  const disposals = db.prepare('SELECT * FROM disposals ORDER BY (disposal_date IS NULL), disposal_date DESC, created_at DESC').all();
  let result = disposals.map(d => ({ ...d, approvals: parseApprovals(d.approvals), items: loadItems(db, d.id) }));
  if (q) {
    const s = q.toLowerCase();
    result = result.filter(d =>
      (d.disposal_number || '').toLowerCase().includes(s) ||
      d.items.some(it => [it.item_name, it.item_number, it.lot_number, it.write_off_number, it.reason_disposed].some(v => v && v.toLowerCase().includes(s)))
    );
  }
  res.json(result);
});

router.get('/summary', (_req, res) => {
  const db = getDb();
  const total = db.prepare('SELECT COUNT(*) c FROM disposals').get().c;
  const items = db.prepare('SELECT COUNT(*) c FROM disposal_items').get().c;
  const unscanned = db.prepare('SELECT COUNT(*) c FROM disposals WHERE scanned = 0').get().c;
  const byReason = db.prepare(`SELECT COALESCE(NULLIF(TRIM(reason_disposed),''),'Unspecified') reason, COUNT(*) c FROM disposal_items GROUP BY reason ORDER BY c DESC LIMIT 8`).all();
  res.json({ total_disposals: total, total_items: items, unscanned, by_reason: byReason });
});

router.get('/:id', (req, res) => {
  const db = getDb();
  const d = db.prepare('SELECT * FROM disposals WHERE id = ?').get(req.params.id);
  if (!d) return res.status(404).json({ error: 'Not found' });
  res.json({ ...d, approvals: parseApprovals(d.approvals), items: loadItems(db, d.id) });
});

function writeItems(db, disposalId, items) {
  db.prepare('DELETE FROM disposal_items WHERE disposal_id = ?').run(disposalId);
  const ins = db.prepare(`INSERT INTO disposal_items (id, disposal_id, item_name, item_number, lot_number, quantity, category, reason_disposed, date_disposed, write_off_number, sort_order)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  (items || []).forEach((it, i) => {
    if (!it || (!it.item_name && !it.item_number && !it.lot_number)) return;
    ins.run(uuid(), disposalId, it.item_name || null, it.item_number || null, it.lot_number || null,
      it.quantity || null, it.category || null, it.reason_disposed || null, it.date_disposed || null,
      it.write_off_number || null, Number.isInteger(it.sort_order) ? it.sort_order : i);
  });
}

// Next sequential disposal number based on the highest numeric value on record.
function nextDisposalNumber(db) {
  const rows = db.prepare('SELECT disposal_number FROM disposals').all();
  let max = 0;
  for (const r of rows) {
    const m = /(\d+)/.exec(r.disposal_number || '');
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return String(max + 1).padStart(3, '0');
}

router.post('/', (req, res) => {
  const db = getDb();
  const { disposal_number, document_rev, disposal_date, reason, witness, scanned, paper_record, document_url, notes, items } = req.body;
  const id = uuid();
  const number = (disposal_number && String(disposal_number).trim()) || nextDisposalNumber(db);
  const tx = db.transaction(() => {
    db.prepare(`INSERT INTO disposals (id, disposal_number, document_rev, disposal_date, reason, witness, paper_record, scanned, document_url, notes, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      id, number, document_rev || null, disposal_date || null, reason || null,
      witness || null, paper_record ? 1 : 0, scanned ? 1 : 0, document_url || null, notes || null, req.user.name);
    writeItems(db, id, items);
  });
  tx();
  const created = db.prepare('SELECT * FROM disposals WHERE id = ?').get(id);
  logAudit(req.user, 'disposal_created', 'disposal', id, { disposal_number: number, items: (items || []).length });
  res.status(201).json({ ...created, approvals: parseApprovals(created.approvals), items: loadItems(db, id) });
});

router.put('/:id', (req, res) => {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM disposals WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Not found' });
  // Note: approval sign-offs are NOT settable here — they go through /approve
  const { disposal_number, document_rev, disposal_date, reason, witness, scanned, paper_record, document_url, notes, items } = req.body;
  const tx = db.transaction(() => {
    db.prepare(`UPDATE disposals SET disposal_number=?, document_rev=?, disposal_date=?, reason=?, witness=?, paper_record=?, scanned=?, document_url=?, notes=?, updated_at=datetime('now') WHERE id=?`).run(
      disposal_number ?? existing.disposal_number, document_rev ?? existing.document_rev,
      disposal_date ?? existing.disposal_date, reason ?? existing.reason,
      witness !== undefined ? (witness || null) : existing.witness,
      paper_record !== undefined ? (paper_record ? 1 : 0) : existing.paper_record,
      scanned !== undefined ? (scanned ? 1 : 0) : existing.scanned,
      document_url !== undefined ? (document_url || null) : existing.document_url,
      notes ?? existing.notes, req.params.id);
    if (items !== undefined) writeItems(db, req.params.id, items);
  });
  tx();
  const updated = db.prepare('SELECT * FROM disposals WHERE id = ?').get(req.params.id);
  logAudit(req.user, 'disposal_updated', 'disposal', req.params.id, { disposal_number: updated.disposal_number }, existing, updated);
  res.json({ ...updated, approvals: parseApprovals(updated.approvals), items: loadItems(db, req.params.id) });
});

// --- Role-authenticated approval sign-offs ---
// Ops Manager: admin or supervisor. Quality Control: QA department or admin.
function canSign(user, role) {
  if (role === 'ops_manager') return user.role === 'admin' || user.role === 'supervisor';
  if (role === 'quality_control') return user.department === 'qa' || user.role === 'admin';
  return false;
}

router.post('/:id/approve', (req, res) => {
  const db = getDb();
  const d = db.prepare('SELECT * FROM disposals WHERE id = ?').get(req.params.id);
  if (!d) return res.status(404).json({ error: 'Not found' });
  const role = req.body.role;
  if (!['ops_manager', 'quality_control'].includes(role)) return res.status(400).json({ error: 'Invalid approval role' });
  if (!canSign(req.user, role)) {
    return res.status(403).json({ error: role === 'quality_control' ? 'Quality Control sign-off requires a QA (or admin) account' : 'Operations Manager sign-off requires a supervisor or admin account' });
  }
  const approvals = parseApprovals(d.approvals);
  approvals[role] = { name: req.user.name, user_id: req.user.id, signed_at: new Date().toISOString() };
  db.prepare("UPDATE disposals SET approvals = ?, updated_at = datetime('now') WHERE id = ?").run(JSON.stringify(approvals), req.params.id);
  logAudit(req.user, `disposal_signed_${role}`, 'disposal', req.params.id, { disposal_number: d.disposal_number });
  const updated = db.prepare('SELECT * FROM disposals WHERE id = ?').get(req.params.id);
  res.json({ ...updated, approvals: parseApprovals(updated.approvals), items: loadItems(db, req.params.id) });
});

router.delete('/:id/approve/:role', (req, res) => {
  const db = getDb();
  const d = db.prepare('SELECT * FROM disposals WHERE id = ?').get(req.params.id);
  if (!d) return res.status(404).json({ error: 'Not found' });
  const role = req.params.role;
  const approvals = parseApprovals(d.approvals);
  const sig = approvals[role];
  if (!sig) return res.json({ ...d, approvals, items: loadItems(db, req.params.id) });
  // Only an admin or the original signer may revoke
  if (req.user.role !== 'admin' && sig.user_id !== req.user.id) {
    return res.status(403).json({ error: 'Only an admin or the signer can revoke this approval' });
  }
  delete approvals[role];
  db.prepare("UPDATE disposals SET approvals = ?, updated_at = datetime('now') WHERE id = ?").run(JSON.stringify(approvals), req.params.id);
  logAudit(req.user, `disposal_unsigned_${role}`, 'disposal', req.params.id, { disposal_number: d.disposal_number });
  const updated = db.prepare('SELECT * FROM disposals WHERE id = ?').get(req.params.id);
  res.json({ ...updated, approvals: parseApprovals(updated.approvals), items: loadItems(db, req.params.id) });
});

router.delete('/:id', (req, res) => {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM disposals WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Not found' });
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM disposal_items WHERE disposal_id = ?').run(req.params.id);
    db.prepare('DELETE FROM disposals WHERE id = ?').run(req.params.id);
  });
  tx();
  logAudit(req.user, 'disposal_deleted', 'disposal', req.params.id, { disposal_number: existing.disposal_number }, existing, null);
  res.json({ success: true });
});

// Bulk permanent delete of disposals (and their items). Admin only.
router.post('/bulk-delete', (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Only an admin can permanently delete disposals.' });
  const db = getDb();
  const { ids } = req.body;
  if (!Array.isArray(ids) || !ids.length) return res.status(400).json({ error: 'ids array is required' });
  const placeholders = ids.map(() => '?').join(',');
  const found = db.prepare(`SELECT id, disposal_number FROM disposals WHERE id IN (${placeholders})`).all(...ids);
  const tx = db.transaction(() => {
    db.prepare(`DELETE FROM disposal_items WHERE disposal_id IN (${placeholders})`).run(...ids);
    db.prepare(`DELETE FROM disposals WHERE id IN (${placeholders})`).run(...ids);
  });
  tx();
  for (const d of found) logAudit(req.user, 'disposal_deleted', 'disposal', d.id, { disposal_number: d.disposal_number }, d, null);
  res.json({ deleted: found.length });
});

// Bulk field update — currently the "logged on paper" flag. Applies to many
// disposals at once (e.g. marking a batch of historical records).
router.post('/bulk-update', (req, res) => {
  const db = getDb();
  const { ids, patch } = req.body;
  if (!Array.isArray(ids) || !ids.length) return res.status(400).json({ error: 'ids array is required' });
  if (!patch || typeof patch !== 'object' || patch.paper_record === undefined) {
    return res.status(400).json({ error: 'patch.paper_record is required' });
  }
  const placeholders = ids.map(() => '?').join(',');
  const info = db.prepare(`UPDATE disposals SET paper_record=?, updated_at=datetime('now') WHERE id IN (${placeholders})`)
    .run(patch.paper_record ? 1 : 0, ...ids);
  logAudit(req.user, 'disposals_bulk_updated', 'disposal', null, { count: info.changes, paper_record: !!patch.paper_record });
  res.json({ updated: info.changes });
});

// --- CSV log import ---
// Minimal RFC-4180 CSV parser (handles quoted fields, embedded commas + newlines)
function parseCsv(text) {
  const rows = [];
  let row = [], field = '', i = 0, inQuotes = false;
  const s = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  while (i < s.length) {
    const ch = s[i];
    if (inQuotes) {
      if (ch === '"') { if (s[i + 1] === '"') { field += '"'; i += 2; continue; } inQuotes = false; i++; continue; }
      field += ch; i++; continue;
    }
    if (ch === '"') { inQuotes = true; i++; continue; }
    if (ch === ',') { row.push(field); field = ''; i++; continue; }
    if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++; continue; }
    field += ch; i++;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

// Parse + group the Disposal Log CSV and insert. Reused by the import route
// and the one-time historical seed. Returns { disposals, items }.
export function importDisposalLog(db, csv, actor) {
  const rows = parseCsv(csv);
  let headerIdx = rows.findIndex(r => r.some(c => /item name/i.test(c)));
  if (headerIdx === -1) headerIdx = 2;

  const groups = new Map();
  let currentNum = null;
  for (let r = headerIdx + 1; r < rows.length; r++) {
    const [numeration, rev, item, part, lot, qty, reason, date, writeoff, scanned] = rows[r].map(c => (c || '').trim());
    if (/traceability of disposal/i.test(numeration)) continue;
    if (numeration && !item && !part && !lot) { currentNum = numeration; continue; }
    if (!item && !part && !lot && !writeoff) continue;
    if (numeration) currentNum = numeration;
    const key = currentNum || `Unnumbered ${r}`;
    if (!groups.has(key)) groups.set(key, { rev, date, scanned: /true/i.test(scanned), items: [] });
    const g = groups.get(key);
    if (!g.rev && rev) g.rev = rev;
    if (/true/i.test(scanned)) g.scanned = true;
    g.items.push({ item_name: item, item_number: part, lot_number: lot, quantity: qty, reason_disposed: reason, date_disposed: date, write_off_number: writeoff });
  }

  // Imported log rows are historical paper records: signatures live on the
  // uploaded form, so mark them paper_record so they don't flag as awaiting approval.
  const insDisp = db.prepare(`INSERT INTO disposals (id, disposal_number, document_rev, disposal_date, scanned, paper_record, created_by) VALUES (?, ?, ?, ?, ?, 1, ?)`);
  const insItem = db.prepare(`INSERT INTO disposal_items (id, disposal_id, item_name, item_number, lot_number, quantity, reason_disposed, date_disposed, write_off_number, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  let disposals = 0, items = 0;
  const tx = db.transaction(() => {
    for (const [num, g] of groups) {
      const id = uuid();
      insDisp.run(id, num, g.rev || null, g.items[0]?.date_disposed || g.date || null, g.scanned ? 1 : 0, actor);
      g.items.forEach((it, i) => { insItem.run(uuid(), id, it.item_name || null, it.item_number || null, it.lot_number || null, it.quantity || null, it.reason_disposed || null, it.date_disposed || null, it.write_off_number || null, i); items++; });
      disposals++;
    }
  });
  tx();
  return { disposals, items };
}

// POST /import — ingest the Disposal Log CSV (their exact format)
router.post('/import', (req, res) => {
  const db = getDb();
  const { csv } = req.body;
  if (!csv || typeof csv !== 'string') return res.status(400).json({ error: 'csv text is required' });
  const result = importDisposalLog(db, csv, req.user.name);
  logAudit(req.user, 'disposals_imported', 'disposal', null, result);
  res.status(201).json(result);
});

// --- PDF (digital Form 411-1) ---
router.get('/:id/pdf', (req, res) => {
  const db = getDb();
  const d = db.prepare('SELECT * FROM disposals WHERE id = ?').get(req.params.id);
  if (!d) return res.status(404).json({ error: 'Not found' });
  const items = loadItems(db, d.id);
  const approvals = parseApprovals(d.approvals);

  const pdf = new PDFDocument({ size: 'LETTER', layout: 'landscape', margin: 40 });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="Disposal_${(d.disposal_number || d.id).toString().replace(/[^a-zA-Z0-9_-]/g, '_')}.pdf"`);
  pdf.pipe(res);

  pdf.fontSize(16).font('Helvetica-Bold').text('DISPOSAL FORM', { align: 'center' });
  pdf.fontSize(8).font('Helvetica').text('Form 411-1', { align: 'center' });
  pdf.moveDown(0.5);
  pdf.fontSize(10).font('Helvetica-Bold')
    .text(`Disposal #: ${d.disposal_number || '—'}`, 40, pdf.y, { continued: true })
    .text(`     Rev: ${d.document_rev || '—'}`, { continued: true })
    .text(`     Date: ${d.disposal_date || '—'}`);
  pdf.moveDown(0.5);

  const cols = [
    { k: 'i', label: '#', w: 24 },
    { k: 'item_name', label: 'Product Description', w: 210 },
    { k: 'item_number', label: 'Item #', w: 70 },
    { k: 'lot_number', label: 'Lot #', w: 90 },
    { k: 'quantity', label: 'Quantity', w: 80 },
    { k: 'reason_disposed', label: 'Reason for Disposal', w: 150 },
    { k: 'write_off_number', label: 'Write-off #', w: 96 },
  ];
  let x = 40;
  const top = pdf.y;
  pdf.fontSize(8).font('Helvetica-Bold');
  cols.forEach(c => { pdf.text(c.label, x + 2, top + 3, { width: c.w - 4 }); x += c.w; });
  pdf.moveTo(40, top).lineTo(40 + cols.reduce((s, c) => s + c.w, 0), top).stroke('#999');
  let y = top + 16;
  pdf.font('Helvetica');
  items.forEach((it, idx) => {
    x = 40;
    const vals = { i: String(idx + 1), ...it };
    const h = Math.max(16, ...cols.map(c => pdf.heightOfString(String(vals[c.k] ?? ''), { width: c.w - 4 })));
    pdf.moveTo(40, y).lineTo(40 + cols.reduce((s, c) => s + c.w, 0), y).stroke('#ddd');
    cols.forEach(c => { pdf.text(String(vals[c.k] ?? '—'), x + 2, y + 3, { width: c.w - 4 }); x += c.w; });
    y += h + 6;
  });
  pdf.y = y + 10;

  pdf.font('Helvetica-Bold').fontSize(9).text('Approvals', 40, pdf.y);
  pdf.font('Helvetica').fontSize(8).moveDown(0.3);
  if (d.paper_record) {
    pdf.font('Helvetica-Oblique').text('Logged on paper — signatures on file on the original disposal form.', 40, pdf.y);
    pdf.font('Helvetica').moveDown(0.4);
  }
  const sigDate = (s) => (s?.signed_at ? new Date(s.signed_at).toLocaleDateString() : '__________');
  const rows2 = [
    ['Operations Manager', approvals.ops_manager],
    ['Quality Control', approvals.quality_control],
  ];
  for (const [label, s] of rows2) {
    pdf.text(`${label}: ${s?.name || '__________________'}     Date: ${sigDate(s)}`, 40, pdf.y);
    pdf.moveDown(0.4);
  }
  pdf.text(`Disposal witnessed by: ${d.witness || '__________________'}`, 40, pdf.y);
  pdf.end();
});

export default router;
