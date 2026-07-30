// Receiving Log — the Warehouse record of incoming raw material, labels and
// components (the board that used to live in Monday).
//
// This is the first module built on the self-serve structure engine: its two
// dropdowns (UOM, Status of Release) are managed lists the team edits in-app,
// and anything they want to capture beyond the fixed columns goes in
// custom_data. Adding "Pallet count" is a click, not a deploy.

import { Router } from 'express';
import { randomUUID as uuid } from 'crypto';
import { getDb, logAudit } from '../db.js';
import { hasExplicitEdit, hasExplicitGrant } from '../module-access.js';
import { coerceCustomData, mergeCustomData, parseJson } from '../custom-fields.js';

const router = Router();
const MODULE = 'receiving-log';

// Warehouse files receipts; admins and explicit edit grants can correct them.
const canLog = (u) => u?.role === 'admin' || u?.role === 'supervisor'
  || u?.department === 'warehouse' || hasExplicitGrant(u, MODULE);
const canEdit = (u) => u?.role === 'admin' || hasExplicitEdit(u, MODULE);

const shape = (r) => ({
  ...r,
  part_in_mrp: !!r.part_in_mrp,
  received_in_mrp: !!r.received_in_mrp,
  custom_data: parseJson(r.custom_data, null),
});

// Fixed columns a create/update may set. Kept explicit so a client can't write
// to source/external_id and forge provenance.
const WRITABLE = [
  'inspection_no', 'date_received', 'po_number', 'part_number', 'part_description',
  'vendor_lot', 'expiration_date', 'quantity_received', 'uom', 'received_by',
  'part_in_mrp', 'received_in_mrp', 'packing_slip_url', 'packing_slip_name',
  'status_of_release', 'release_date', 'notes',
];
const BOOLS = new Set(['part_in_mrp', 'received_in_mrp']);
const NUMS = new Set(['quantity_received']);

function readBody(body) {
  const out = {};
  for (const k of WRITABLE) {
    if (body[k] === undefined) continue;
    if (BOOLS.has(k)) out[k] = body[k] ? 1 : 0;
    else if (NUMS.has(k)) { const n = Number(body[k]); out[k] = Number.isFinite(n) ? n : null; }
    else out[k] = body[k] === '' ? null : body[k];
  }
  return out;
}

// GET / — the log, filtered. Search spans the identifiers a warehouse lead
// actually reaches for: PO, part, description, lot, inspection #.
router.get('/', (req, res) => {
  const db = getDb();
  const { from, to, status, uom, q, limit } = req.query;
  let sql = 'SELECT * FROM receiving_log WHERE 1=1';
  const params = [];
  if (from) { sql += ' AND date_received >= ?'; params.push(from); }
  if (to) { sql += ' AND date_received <= ?'; params.push(to); }
  if (status) { sql += ' AND status_of_release = ?'; params.push(status); }
  if (uom) { sql += ' AND uom = ?'; params.push(uom); }
  if (q) {
    // Quantity is searchable too — people look up "the 45.36 kg receipt".
    // CAST because the column is REAL and LIKE on a number won't match.
    sql += ` AND (po_number LIKE ? OR part_number LIKE ? OR part_description LIKE ?
             OR vendor_lot LIKE ? OR inspection_no LIKE ? OR received_by LIKE ?
             OR CAST(quantity_received AS TEXT) LIKE ?)`;
    const like = `%${q}%`;
    params.push(like, like, like, like, like, like, like);
  }
  sql += ' ORDER BY date_received DESC, created_at DESC LIMIT ?';
  params.push(Math.min(Number(limit) || 500, 2000));
  res.json(db.prepare(sql).all(...params).map(shape));
});

// GET /stats — the counts the warehouse and QA care about at a glance.
router.get('/stats', (req, res) => {
  const db = getDb();
  const { from, to } = req.query;
  let where = '1=1';
  const params = [];
  if (from) { where += ' AND date_received >= ?'; params.push(from); }
  if (to) { where += ' AND date_received <= ?'; params.push(to); }
  const totals = db.prepare(`SELECT COUNT(*) total,
      SUM(CASE WHEN status_of_release = 'RELEASED' THEN 1 ELSE 0 END) released,
      SUM(CASE WHEN status_of_release IN ('Needs to be tested','Sent to the lab') THEN 1 ELSE 0 END) pending_lab,
      SUM(CASE WHEN received_in_mrp = 0 THEN 1 ELSE 0 END) not_in_mrp
    FROM receiving_log WHERE ${where}`).get(...params);
  // Lots going out of date are the ones that bite; surface the near-term ones.
  const expiring = db.prepare(`SELECT COUNT(*) n FROM receiving_log
      WHERE expiration_date IS NOT NULL AND expiration_date != ''
        AND date(expiration_date) <= date('now', '+90 days')
        AND date(expiration_date) >= date('now')`).get().n;
  res.json({ ...totals, expiring_90d: expiring });
});

router.post('/', (req, res) => {
  if (!canLog(req.user)) return res.status(403).json({ error: 'You do not have access to file receiving records.' });
  const db = getDb();
  const cols = readBody(req.body);
  if (!cols.date_received) return res.status(400).json({ error: 'Date received is required.' });
  if (!cols.part_number && !cols.part_description) {
    return res.status(400).json({ error: 'A part # or description is required.' });
  }

  const { data, errors } = coerceCustomData(db, 'receiving_log', req.body.custom_data);
  if (errors.length) return res.status(400).json({ error: errors.join(' ') });

  const id = uuid();
  cols.id = id;
  cols.created_by = req.user?.name || null;
  cols.custom_data = data ? JSON.stringify(data) : null;
  if (!cols.received_by) cols.received_by = req.user?.name || null;

  const keys = Object.keys(cols);
  db.prepare(`INSERT INTO receiving_log (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`)
    .run(...keys.map(k => cols[k]));

  const created = db.prepare('SELECT * FROM receiving_log WHERE id = ?').get(id);
  logAudit(req.user, 'create', 'receiving_record', id, req.body, null, created,
    `${created.part_number || created.part_description || ''} · PO ${created.po_number || '—'}`);
  res.status(201).json(shape(created));
});

router.put('/:id', (req, res) => {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM receiving_log WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Receiving record not found' });
  // Filing is broad; changing a filed record is the narrower right.
  if (!canEdit(req.user) && existing.created_by !== req.user?.name) {
    return res.status(403).json({ error: 'Correcting someone else\'s receiving record requires an edit grant (Settings) or admin.' });
  }

  const cols = readBody(req.body);
  if (req.body.custom_data !== undefined) {
    const { data, errors } = coerceCustomData(db, 'receiving_log', req.body.custom_data);
    if (errors.length) return res.status(400).json({ error: errors.join(' ') });
    // Merge so values captured under since-retired fields survive the edit.
    const merged = mergeCustomData(existing.custom_data, data);
    cols.custom_data = merged ? JSON.stringify(merged) : null;
  }
  if (!Object.keys(cols).length) return res.status(400).json({ error: 'Nothing was changed.' });

  const keys = Object.keys(cols);
  db.prepare(`UPDATE receiving_log SET ${keys.map(k => `${k} = ?`).join(', ')}, updated_at = datetime('now') WHERE id = ?`)
    .run(...keys.map(k => cols[k]), req.params.id);

  const updated = db.prepare('SELECT * FROM receiving_log WHERE id = ?').get(req.params.id);
  logAudit(req.user, 'update', 'receiving_record', req.params.id, req.body, existing, updated,
    `${updated.part_number || updated.part_description || ''} · PO ${updated.po_number || '—'}`);
  res.json(shape(updated));
});

router.delete('/:id', (req, res) => {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Only an admin can delete a receiving record.' });
  const db = getDb();
  const existing = db.prepare('SELECT * FROM receiving_log WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Receiving record not found' });
  db.prepare('DELETE FROM receiving_log WHERE id = ?').run(req.params.id);
  logAudit(req.user, 'delete', 'receiving_record', req.params.id, null, existing, null,
    `${existing.part_number || ''} · PO ${existing.po_number || '—'}`);
  res.json({ ok: true });
});

export default router;
