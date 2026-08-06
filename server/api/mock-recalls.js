import { Router } from 'express';
import { v4 as uuid } from 'uuid';
import { getDb, logAudit } from '../db.js';
import {
  SOP_CODE, SOP_REVISION, FORM_CODE, DOCUMENTED_ITEMS, RECALL_CONTACTS,
  TRACKING_PROCEDURES, effectivenessCheck, missingItems, durationMinutes,
  MASS_BALANCE_MIN, MASS_BALANCE_MAX, MAX_DURATION_MINUTES,
} from '../mock-recall-form.js';

const router = Router();

// Everything the caller may set. Listed once so the create and update paths
// cannot drift about which fields exist.
const WRITABLE = [
  'date_initiated', 'product_name', 'item_number', 'lot_number', 'reason', 'initiated_by', 'scope',
  'date_produced', 'date_distributed', 'started_at', 'ended_at',
  'quantity_produced', 'quantity_distributed', 'quantity_recovered',
  'quantity_quarantined', 'quantity_in_market',
  'notification_method', 'customer_disposition', 'batch_records', 'labeling_records',
  'retention_samples', 'reconciliation', 'product_disposition', 'closeout_minutes',
  'distribution_list', 'time_to_notify_minutes', 'time_to_complete_minutes',
  'accounts_contacted', 'accounts_responded', 'effectiveness_pct',
  'mass_balance_pct', 'summary_report_complete', 'form_415_1_checked',
  'root_cause', 'corrective_actions', 'notes', 'tracking_procedure',
];
const BOOLEAN_FIELDS = new Set(['summary_report_complete', 'form_415_1_checked']);

const canSign = (u) => u?.role === 'admin'
  || ['qa', 'document_control'].includes(String(u?.department || '').toLowerCase())
  || u?.role === 'supervisor';

/**
 * Everything a client needs to render or judge one record, computed server-side.
 *
 * The verdict is NOT stored as a separate opinion — it is derived from the
 * numbers on the record every time it is read, so a mass balance corrected
 * after the fact can never leave a stale "pass" behind it.
 */
function decorate(recall) {
  if (!recall) return recall;
  const check = effectivenessCheck(recall);
  const missing = missingItems(recall);
  return {
    ...recall,
    duration_minutes: durationMinutes(recall),
    effectiveness: check,
    missing_items: missing,
    // The SOP: an unsuccessful exercise requires an investigation with root
    // cause and actions taken.
    investigation_required: check.complete && !check.successful,
    can_sign: !recall.approved_at && check.complete && missing.length === 0,
    sign_block_reason: recall.approved_at ? 'Already signed off'
      : !check.complete ? 'The effectiveness check is not complete'
        : missing.length ? `${missing.length} required item${missing.length === 1 ? '' : 's'} still blank`
          : null,
  };
}

// The form definition, so the client renders the SOP's own wording and order.
router.get('/form', (_req, res) => {
  res.json({
    sop_code: SOP_CODE,
    sop_revision: SOP_REVISION,
    form_code: FORM_CODE,
    documented_items: DOCUMENTED_ITEMS,
    contacts: RECALL_CONTACTS,
    tracking_procedures: TRACKING_PROCEDURES,
    criteria: {
      mass_balance_min: MASS_BALANCE_MIN,
      mass_balance_max: MASS_BALANCE_MAX,
      max_duration_minutes: MAX_DURATION_MINUTES,
    },
  });
});

/**
 * "This exercise will be performed at least once annually."
 *
 * Reported rather than enforced — the app can say the plant is overdue, but it
 * cannot run the drill.
 */
router.get('/status', (_req, res) => {
  const db = getDb();
  const last = db.prepare(`
    SELECT recall_number, date_initiated, product_name, result, approved_at
    FROM mock_recalls WHERE approved_at IS NOT NULL
    ORDER BY date_initiated DESC LIMIT 1
  `).get();
  const open = db.prepare("SELECT COUNT(*) c FROM mock_recalls WHERE approved_at IS NULL").get().c;
  let daysSince = null;
  if (last) {
    const d = db.prepare("SELECT CAST(julianday('now') - julianday(?) AS INTEGER) d").get(last.date_initiated);
    daysSince = d?.d ?? null;
  }
  res.json({
    last_completed: last || null,
    days_since: daysSince,
    // No signed exercise at all is overdue by definition — that is the honest
    // reading, and it is the state a new deployment is actually in.
    overdue: last ? (daysSince !== null && daysSince > 365) : true,
    due_in_days: last && daysSince !== null ? 365 - daysSince : null,
    open_exercises: open,
    // "Rotate different types of products at each exercise."
    recent_products: db.prepare(`
      SELECT DISTINCT product_name FROM mock_recalls
      ORDER BY date_initiated DESC LIMIT 5
    `).all().map(r => r.product_name),
  });
});

router.get('/', (req, res) => {
  const db = getDb();
  const limit = Math.min(Number(req.query.limit) || 200, 500);
  const rows = db.prepare('SELECT * FROM mock_recalls ORDER BY date_initiated DESC LIMIT ?').all(limit);
  res.json(rows.map(decorate));
});

router.get('/:id', (req, res) => {
  const db = getDb();
  const recall = db.prepare('SELECT * FROM mock_recalls WHERE id = ?').get(req.params.id);
  if (!recall) return res.status(404).json({ error: 'Not found' });
  res.json(decorate(recall));
});

router.post('/', (req, res) => {
  const db = getDb();
  const { product_name, lot_number, reason } = req.body;
  if (!product_name || !lot_number || !reason) return res.status(400).json({ error: 'Product name, lot number, and reason are required' });

  const existing = db.prepare('SELECT recall_number FROM mock_recalls ORDER BY recall_number DESC LIMIT 1').get();
  let nextNum = 'MR-001';
  if (existing) {
    const num = parseInt(existing.recall_number.replace('MR-', ''), 10);
    nextNum = `MR-${String(num + 1).padStart(3, '0')}`;
  }

  const id = uuid();
  const cols = ['id', 'recall_number', 'checklist_revision'];
  const vals = [id, nextNum, `${SOP_CODE} ${SOP_REVISION}`];
  for (const f of WRITABLE) {
    if (req.body[f] === undefined) continue;
    cols.push(f);
    vals.push(BOOLEAN_FIELDS.has(f) ? (req.body[f] ? 1 : 0) : req.body[f]);
  }
  // The NOT NULL columns the table has always had.
  if (!cols.includes('date_initiated')) { cols.push('date_initiated'); vals.push(new Date().toISOString().split('T')[0]); }
  if (!cols.includes('initiated_by')) { cols.push('initiated_by'); vals.push(req.user.name); }
  if (!cols.includes('started_at')) { cols.push('started_at'); vals.push(new Date().toISOString()); }

  db.prepare(`INSERT INTO mock_recalls (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`).run(...vals);
  const created = db.prepare('SELECT * FROM mock_recalls WHERE id = ?').get(id);
  logAudit(req.user, 'mock_recall_created', 'mock_recall', id, { recall_number: nextNum, product_name }, null, created, nextNum);
  res.status(201).json(decorate(created));
});

router.put('/:id', (req, res) => {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM mock_recalls WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Not found' });
  // A signed exercise is a compliance record. Correcting one means revoking the
  // signature first, which is audited — the same rule as qms.js and meetings.
  if (existing.approved_at && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'This mock recall is signed off. Revoke the sign-off to correct it.' });
  }

  const sets = [];
  const vals = [];
  for (const f of WRITABLE) {
    if (req.body[f] === undefined) continue;
    sets.push(`${f} = ?`);
    vals.push(BOOLEAN_FIELDS.has(f) ? (req.body[f] ? 1 : 0) : req.body[f]);
  }
  if (req.body.result !== undefined) { sets.push('result = ?'); vals.push(req.body.result); }
  if (!sets.length) return res.json(decorate(existing));
  sets.push("updated_at = datetime('now')");
  db.prepare(`UPDATE mock_recalls SET ${sets.join(', ')} WHERE id = ?`).run(...vals, req.params.id);

  const updated = db.prepare('SELECT * FROM mock_recalls WHERE id = ?').get(req.params.id);
  logAudit(req.user, 'mock_recall_updated', 'mock_recall', req.params.id, null, existing, updated, existing.recall_number);
  res.json(decorate(updated));
});

/**
 * Sign off — the SOP's Recall Authorization.
 *
 * REFUSED while any documented item is blank or the effectiveness check is
 * unfinished. A mock recall filed with half its questions empty reads later as
 * if those areas were covered, which is the same reasoning that blocks signing
 * an internal audit with unanswered items.
 */
router.post('/:id/approve', (req, res) => {
  const db = getDb();
  const recall = db.prepare('SELECT * FROM mock_recalls WHERE id = ?').get(req.params.id);
  if (!recall) return res.status(404).json({ error: 'Not found' });
  if (!canSign(req.user)) return res.status(403).json({ error: 'Only QA, Document Control, a supervisor or an admin can authorize a mock recall.' });
  if (recall.approved_at) return res.status(400).json({ error: 'Already signed off' });

  const check = effectivenessCheck(recall);
  const missing = missingItems(recall);
  if (!check.complete) return res.status(400).json({ error: 'The effectiveness check is not complete — record the mass balance, both times, and the Form 415-1 box.' });
  if (missing.length) {
    return res.status(400).json({ error: `${missing.length} item(s) the SOP requires are still blank: ${missing.map(m => m.label).join(', ')}` });
  }
  // An unsuccessful exercise needs its investigation before it can be closed.
  if (!check.successful && !String(recall.root_cause || '').trim()) {
    return res.status(400).json({ error: 'This exercise did not meet the effectiveness criteria, so SOP 415 requires an investigation. Record the root cause and the actions taken.' });
  }

  const result = check.successful ? 'pass' : 'fail';
  db.prepare(`UPDATE mock_recalls SET approved_by = ?, approved_at = ?, result = ?, completed_at = COALESCE(completed_at, ?),
    investigation_required = ?, updated_at = datetime('now') WHERE id = ?`).run(
    req.user.name, new Date().toISOString(), result, new Date().toISOString(),
    check.successful ? 0 : 1, req.params.id,
  );
  const updated = db.prepare('SELECT * FROM mock_recalls WHERE id = ?').get(req.params.id);
  logAudit(req.user, 'mock_recall_approved', 'mock_recall', req.params.id, { result }, recall, updated, recall.recall_number);
  res.json(decorate(updated));
});

// The way back from a signature is revoke → correct → sign again, all audited.
// Allowed to the original signer or an admin, same as qms.js.
router.delete('/:id/approve', (req, res) => {
  const db = getDb();
  const recall = db.prepare('SELECT * FROM mock_recalls WHERE id = ?').get(req.params.id);
  if (!recall) return res.status(404).json({ error: 'Not found' });
  if (!recall.approved_at) return res.status(400).json({ error: 'Not signed off' });
  if (req.user.role !== 'admin' && recall.approved_by !== req.user.name) {
    return res.status(403).json({ error: 'Only the person who signed this off, or an admin, can revoke it.' });
  }
  db.prepare("UPDATE mock_recalls SET approved_by = NULL, approved_at = NULL, result = 'pending', updated_at = datetime('now') WHERE id = ?").run(req.params.id);
  const updated = db.prepare('SELECT * FROM mock_recalls WHERE id = ?').get(req.params.id);
  logAudit(req.user, 'mock_recall_approval_revoked', 'mock_recall', req.params.id, { reason: req.body?.reason || null }, recall, updated, recall.recall_number);
  res.json(decorate(updated));
});

/**
 * "All documentation generated from the Mock Recall will be filed with the
 * Document Control department." Recorded as a fact with a name and a time,
 * not a tick — the question an auditor asks is who filed it and when.
 */
router.post('/:id/file-with-dc', (req, res) => {
  const db = getDb();
  const recall = db.prepare('SELECT * FROM mock_recalls WHERE id = ?').get(req.params.id);
  if (!recall) return res.status(404).json({ error: 'Not found' });
  if (!recall.approved_at) return res.status(400).json({ error: 'Sign the mock recall off before filing it with Document Control.' });
  db.prepare("UPDATE mock_recalls SET filed_with_dc_at = ?, filed_with_dc_by = ?, updated_at = datetime('now') WHERE id = ?")
    .run(new Date().toISOString(), req.user.name, req.params.id);
  const updated = db.prepare('SELECT * FROM mock_recalls WHERE id = ?').get(req.params.id);
  logAudit(req.user, 'mock_recall_filed_with_dc', 'mock_recall', req.params.id, null, recall, updated, recall.recall_number);
  res.json(decorate(updated));
});

export default router;
