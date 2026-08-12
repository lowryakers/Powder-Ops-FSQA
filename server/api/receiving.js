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
import {
  CHECKLIST, CHECKLIST_REVISION, getItem, normalizeAnswers, triggeredEscalations, unanswered,
} from '../receiving-checklist.js';
import { sendEscalation } from '../receiving-notify.js';

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

// ── Inspection numbers ──────────────────────────────────────────────────────
// One inspection covers one arrival, and an arrival is often several lines (a
// pallet of three different parts on the same PO). So the number is issued per
// INSPECTION, not per row: start a receipt and you get the next one; add
// another line to that receipt and you keep it. The imported Monday history
// works exactly this way — 1,328 rows share 511 A-100 numbers.
//
// Format is the one the warehouse already writes by hand: A-100-#### (zero
// padded to 4, but it keeps counting past 9999 rather than wrapping).
const INSPECTION_PREFIX = 'A-100-';

function nextInspectionNo(db) {
  const rows = db.prepare(
    "SELECT inspection_no FROM receiving_log WHERE inspection_no LIKE 'A-100-%'"
  ).all();
  let max = 0;
  for (const r of rows) {
    const n = Number(String(r.inspection_no).slice(INSPECTION_PREFIX.length));
    if (Number.isFinite(n) && n > max) max = n;
  }
  return INSPECTION_PREFIX + String(max + 1).padStart(4, '0');
}

// GET /next-inspection-no — what the form shows before anything is saved.
// Advisory only: two people filling the form at once both see the same number,
// and the one who saves second gets the next one assigned at write time.
router.get('/next-inspection-no', (req, res) => {
  res.json({ inspection_no: nextInspectionNo(getDb()) });
});

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

/* ── FORM 204-01: the Receiving Inspection Checklist ────────────────────────
 *
 * One checklist PER INSPECTION, covering every line on the delivery — the
 * paper form has one header and one approval, and an arrival is routinely
 * several receiving_log rows against one PO.
 *
 * The form itself is not editable in-app (see receiving-checklist.js); what is
 * stored here is the answers, the escalations that were actually sent, and the
 * approval.
 *
 * Declared BEFORE `/:id` — Express matches in declaration order and
 * "checklist" is a perfectly good id.
 */

const shapeChecklist = (r) => {
  if (!r) return null;
  const answers = parseJson(r.answers, {}) || {};
  return {
    ...r,
    answers,
    item_notes: parseJson(r.item_notes, []) || [],
    notifications: parseJson(r.notifications, []) || [],
    // Derived on every read, never stored: correct an answer and the
    // escalations move with it. A stored list goes stale exactly when somebody
    // fixes a mis-click.
    escalations: triggeredEscalations(answers),
    unanswered: unanswered(answers),
  };
};

// The blank form. Public to any signed-in reader — a form nobody can see is a
// form nobody fills in.
router.get('/checklist/form', (_req, res) => res.json(CHECKLIST));

// One inspection's checklist, plus the log lines it covers.
router.get('/checklist/:inspectionNo', (req, res) => {
  const db = getDb();
  const no = req.params.inspectionNo;
  const row = db.prepare('SELECT * FROM receiving_checklists WHERE inspection_no = ?').get(no);
  const lines = db.prepare('SELECT * FROM receiving_log WHERE inspection_no = ? ORDER BY created_at').all(no).map(shape);
  res.json({ checklist: shapeChecklist(row), lines, form: CHECKLIST });
});

const HEADER_COLS = ['po_number', 'truck_number', 'pallet_count', 'driver_name', 'vendor', 'vendor_lot', 'customer_number', 'inspection_date', 'system_status'];

/**
 * Start or update a checklist. Get-or-create on the inspection number, so
 * opening the same delivery twice — or on a second device — lands on the same
 * record rather than filing a duplicate.
 *
 * Deliberately validates nothing beyond the answer vocabulary. A form that
 * refuses a half-filled field on the dock is a form people stop using;
 * validation belongs at sign-off, which is where it is.
 */
router.post('/checklist', (req, res) => {
  if (!canLog(req.user)) return res.status(403).json({ error: 'Filing a receiving inspection needs the Receiving Log.' });
  const db = getDb();
  const no = String(req.body?.inspection_no || '').trim();
  if (!no) return res.status(400).json({ error: 'An inspection number is required.' });

  let row = db.prepare('SELECT * FROM receiving_checklists WHERE inspection_no = ?').get(no);
  if (!row) {
    db.prepare(`INSERT INTO receiving_checklists
      (id, inspection_no, checklist_revision, inspection_date, inspector, created_by)
      VALUES (?, ?, ?, COALESCE(?, date('now')), ?, ?)`).run(
      uuid(), no, CHECKLIST_REVISION, req.body?.inspection_date || null,
      req.body?.inspector || req.user.name, req.user.name);
    row = db.prepare('SELECT * FROM receiving_checklists WHERE inspection_no = ?').get(no);
  }
  // An approved checklist is the record of the delivery that was accepted.
  if (row.reviewed_at) return res.status(409).json({ error: 'This checklist has been signed off. Revoke the sign-off to correct it.' });

  const patch = {};
  for (const c of HEADER_COLS) if (req.body?.[c] !== undefined) patch[c] = req.body[c] === '' ? null : req.body[c];
  if (req.body?.answers !== undefined) {
    patch.answers = JSON.stringify({ ...parseJson(row.answers, {}), ...normalizeAnswers(req.body.answers) });
  }
  if (req.body?.item_notes !== undefined) patch.item_notes = JSON.stringify(req.body.item_notes || []);
  if (Object.keys(patch).length) {
    db.prepare(`UPDATE receiving_checklists SET ${Object.keys(patch).map(c => `${c} = ?`).join(', ')},
      updated_at = datetime('now') WHERE id = ?`).run(...Object.values(patch), row.id);
  }
  const updated = db.prepare('SELECT * FROM receiving_checklists WHERE id = ?').get(row.id);
  logAudit(req.user, 'receiving_checklist_updated', 'receiving_checklist', row.id,
    { inspection_no: no, fields: Object.keys(patch) }, row, updated, no);
  res.json(shapeChecklist(updated));
});

/**
 * Send the escalation the form asks for.
 *
 * A separate, deliberate act rather than an automatic side effect of ticking a
 * box: the receiver may be correcting a mis-tap, and an alert that fires on
 * every keystroke is one people learn to ignore. What IS automatic is the
 * prompt — the app puts the button in front of them the moment the answer
 * triggers it, which the paper never did.
 */
router.post('/checklist/:inspectionNo/notify', async (req, res) => {
  if (!canLog(req.user)) return res.status(403).json({ error: 'Filing a receiving inspection needs the Receiving Log.' });
  const db = getDb();
  const no = req.params.inspectionNo;
  const row = db.prepare('SELECT * FROM receiving_checklists WHERE inspection_no = ?').get(no);
  if (!row) return res.status(404).json({ error: 'No checklist for this inspection yet.' });

  const item = getItem(String(req.body?.item || ''));
  if (!item?.notify) return res.status(400).json({ error: 'That checklist item has nobody to notify.' });
  const answers = parseJson(row.answers, {}) || {};
  // Refuse to send an escalation the answers do not support — otherwise the
  // record says QA was told about contamination that was never reported.
  if (answers[item.key] !== item.notify.answer) {
    return res.status(409).json({ error: `"${item.text}" is not answered ${item.notify.answer.toUpperCase()}, so there is nothing to escalate.` });
  }

  const { sent, reason } = await sendEscalation(db, {
    item: item.text,
    target: item.notify.target,
    inspectionNo: no,
    detail: String(req.body?.detail || '').slice(0, 500),
    from: req.user,
  });
  if (!sent.length) return res.status(503).json({ error: `Could not reach anyone — ${reason || 'no matching accounts'}. Tell them directly.` });

  const log = parseJson(row.notifications, []) || [];
  log.push({ item: item.key, text: item.text, target: item.notify.target, to: sent, at: new Date().toISOString(), by: req.user.name });
  db.prepare("UPDATE receiving_checklists SET notifications = ?, updated_at = datetime('now') WHERE id = ?")
    .run(JSON.stringify(log), row.id);
  logAudit(req.user, 'receiving_escalation_sent', 'receiving_checklist', row.id,
    { inspection_no: no, item: item.key, target: item.notify.target, to: sent }, null, null, no);
  res.json({ ok: true, sent, notifications: log });
});

/**
 * Sign the checklist off — the paper form's "Packet Reviewed By".
 *
 * REFUSED WHILE ANY ITEM IS BLANK, the same rule as an internal audit: a
 * checklist filed with empty questions reads later as if those checks passed.
 * Also refused while an escalation the form demanded has not been sent — the
 * whole reason those lines are on the form is that somebody has to be told.
 */
router.post('/checklist/:inspectionNo/review', (req, res) => {
  if (!canLog(req.user)) return res.status(403).json({ error: 'Filing a receiving inspection needs the Receiving Log.' });
  const db = getDb();
  const row = db.prepare('SELECT * FROM receiving_checklists WHERE inspection_no = ?').get(req.params.inspectionNo);
  if (!row) return res.status(404).json({ error: 'No checklist for this inspection yet.' });
  if (row.reviewed_at) return res.status(409).json({ error: 'Already signed off.' });

  const answers = parseJson(row.answers, {}) || {};
  const blanks = unanswered(answers);
  if (blanks.length) {
    return res.status(400).json({
      error: `${blanks.length} question${blanks.length === 1 ? '' : 's'} still blank. A checklist filed with blanks reads later as if those checks passed.`,
      unanswered: blanks,
    });
  }
  const notified = new Set((parseJson(row.notifications, []) || []).map(n => n.item));
  const outstanding = triggeredEscalations(answers).filter(e => !notified.has(e.key));
  if (outstanding.length) {
    return res.status(400).json({
      error: `${outstanding.length} escalation${outstanding.length === 1 ? '' : 's'} the form requires ${outstanding.length === 1 ? 'has' : 'have'} not been sent.`,
      outstanding,
    });
  }

  db.prepare(`UPDATE receiving_checklists SET reviewed_by = ?, reviewed_at = datetime('now'),
    system_status = COALESCE(?, system_status), updated_at = datetime('now') WHERE id = ?`)
    .run(req.user.name, req.body?.system_status || null, row.id);
  const updated = db.prepare('SELECT * FROM receiving_checklists WHERE id = ?').get(row.id);
  logAudit(req.user, 'receiving_checklist_reviewed', 'receiving_checklist', row.id,
    { inspection_no: row.inspection_no, system_status: updated.system_status }, row, updated, row.inspection_no);
  res.json(shapeChecklist(updated));
});

/** The way back from a signature is revoke, correct, sign again — all audited. */
router.delete('/checklist/:inspectionNo/review', (req, res) => {
  const db = getDb();
  const row = db.prepare('SELECT * FROM receiving_checklists WHERE inspection_no = ?').get(req.params.inspectionNo);
  if (!row) return res.status(404).json({ error: 'Not found' });
  if (!row.reviewed_at) return res.status(409).json({ error: 'This checklist is not signed off.' });
  if (req.user.role !== 'admin' && row.reviewed_by !== req.user.name) {
    return res.status(403).json({ error: 'Only the person who signed it, or an admin, can revoke a sign-off.' });
  }
  db.prepare("UPDATE receiving_checklists SET reviewed_by = NULL, reviewed_at = NULL, updated_at = datetime('now') WHERE id = ?").run(row.id);
  logAudit(req.user, 'receiving_checklist_review_revoked', 'receiving_checklist', row.id,
    { inspection_no: row.inspection_no, was_signed_by: row.reviewed_by }, row, null, row.inspection_no);
  res.json({ ok: true });
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

  // Left blank = a new inspection, so issue the next number. Sent = the filer
  // is adding another line to a receipt that's already open; keep it.
  if (!cols.inspection_no) cols.inspection_no = nextInspectionNo(db);

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
