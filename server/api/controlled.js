import { resolve, byNames, byDept } from '../readybot-recipients.js';
import { Router } from 'express';
import { v4 as uuid } from 'uuid';
import { getDb, logAudit } from '../db.js';
import { syncDefinitions, approveDefinition, rejectDefinition, diffSnapshots, pendingCount, registry, hashOf } from '../controlled.js';
import { editableFields, buildProposal } from '../controlled-edit.js';
import { gateSignature } from '../signature.js';
import { canQaReview } from '../document-revisions.js';
import { postMessageAs, botDm } from './comms.js';
import { getType } from '../qms-config.js';

const router = Router();

// Reviewing a controlled definition is Document Control's job, plus admins.
// Deliberately narrower than the records roles: this is "may this change take
// effect", not "may I correct a record".
function mayReview(user) {
  if (user?.role === 'admin') return true;
  return (user?.department || '').toLowerCase() === 'document_control';
}
function requireReviewer(req, res) {
  if (!mayReview(req.user)) { res.status(403).json({ error: 'Only Document Control or an admin can review controlled changes.' }); return false; }
  return true;
}
// A QA supervisor reads the screen too: a value proposed in the app waits for
// QA's review before it can be approved (D-328).
function requireReader(req, res) {
  if (!mayReview(req.user) && !canQaReview(req.user)) { res.status(403).json({ error: 'Only Document Control, a QA supervisor or an admin can see controlled changes.' }); return false; }
  return true;
}
const entryFor = (row) => registry().find(e => e.scope === row.scope && e.key === row.key) || null;

const parse = (raw) => { try { return JSON.parse(raw || 'null'); } catch { return null; } };

function shape(row) {
  const approved = parse(row.approved_snapshot);
  const pending = parse(row.pending_snapshot);
  return {
    id: row.id, scope: row.scope, key: row.key, label: row.label,
    status: row.status, version: row.version,
    approved_at: row.approved_at, approved_by: row.approved_by,
    pending_seen_at: row.pending_seen_at, pending_dcr_id: row.pending_dcr_id,
    rejected_at: row.rejected_at, rejected_by: row.rejected_by, rejected_reason: row.rejected_reason,
    changes: pending ? diffSnapshots(approved, pending) : [],
    // D-328: changed in the app, not only in code.
    editable: typeof entryFor(row)?.editable === 'function',
    pending_source: row.status === 'pending' || row.status === 'rejected' ? (row.pending_source || 'code') : null,
    proposed_by: row.proposed_by, proposed_by_id: row.proposed_by_id, proposed_at: row.proposed_at, proposed_reason: row.proposed_reason,
    qa_reviewed_by: row.qa_reviewed_by, qa_reviewed_by_id: row.qa_reviewed_by_id, qa_reviewed_at: row.qa_reviewed_at,
  };
}

// Everything, so Document Control can see what the app is currently serving
// and not only what's waiting.
router.get('/', (req, res) => {
  if (!requireReader(req, res)) return;
  const rows = getDb().prepare('SELECT * FROM controlled_definitions ORDER BY status DESC, label').all();
  res.json(rows.map(shape));
});

router.get('/pending', (req, res) => {
  if (!requireReviewer(req, res)) return;
  const rows = getDb().prepare("SELECT * FROM controlled_definitions WHERE status = 'pending' ORDER BY pending_seen_at").all();
  res.json(rows.map(shape));
});

// ── D-328: Document Control changes a value in the app ──────────────────────
// Propose (Document Control) → QA review (a QA supervisor, password, not the
// proposer) → approve (Document Control or an admin, password, not the QA
// reviewer). The same three steps as an SOP revision (D-319).

router.get('/:id/edit', (req, res) => {
  if (!requireReader(req, res)) return;
  const row = getDb().prepare('SELECT * FROM controlled_definitions WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  const entry = entryFor(row);
  if (typeof entry?.editable !== 'function') return res.status(400).json({ error: 'This definition is changed in code, not here.', code: 'NOT_EDITABLE' });
  const approved = parse(row.approved_snapshot);
  const proposed = row.status === 'pending' && row.pending_source === 'app' ? parse(row.pending_snapshot) : null;
  res.json({ id: row.id, label: row.label, fields: editableFields(entry, approved), proposed: proposed ? editableFields(entry, proposed) : null });
});

router.post('/:id/propose', (req, res) => {
  if (!requireReviewer(req, res)) return;
  const db = getDb();
  const row = db.prepare('SELECT * FROM controlled_definitions WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  const entry = entryFor(row);
  if (typeof entry?.editable !== 'function') return res.status(400).json({ error: 'This definition is changed in code, not here.', code: 'NOT_EDITABLE' });
  if (row.status === 'pending' && row.pending_source !== 'app') {
    return res.status(409).json({ error: 'A deployed change to this definition is waiting. Approve or deny it first.', code: 'CODE_CHANGE_WAITING' });
  }
  const reason = String(req.body?.reason || '').trim();
  if (reason.length < 3) return res.status(400).json({ error: 'Say why it is changing (for example, the DCR number).', code: 'REASON_REQUIRED' });
  const approved = parse(row.approved_snapshot);
  const { snapshot, changes, errors } = buildProposal(entry, approved, req.body?.values || {});
  if (errors.length) return res.status(400).json({ error: errors.join(' '), errors, code: 'INVALID' });
  if (!changes.length) return res.status(400).json({ error: 'Nothing was changed.', code: 'NO_CHANGE' });
  db.prepare(`UPDATE controlled_definitions SET pending_hash = ?, pending_snapshot = ?, pending_seen_at = datetime('now'),
      status = 'pending', pending_source = 'app', pending_dcr_id = NULL,
      proposed_by = ?, proposed_by_id = ?, proposed_at = datetime('now'), proposed_reason = ?,
      qa_reviewed_by = NULL, qa_reviewed_by_id = NULL, qa_reviewed_at = NULL,
      rejected_at = NULL, rejected_by = NULL, rejected_reason = NULL
    WHERE id = ?`).run(hashOf(snapshot), JSON.stringify(snapshot), req.user.name, req.user.id, reason, row.id);
  const after = db.prepare('SELECT * FROM controlled_definitions WHERE id = ?').get(row.id);
  logAudit(req.user, 'update', 'controlled_definition', row.id,
    { proposed: true, reason, changes, scope: row.scope, key: row.key }, row, after, row.label);
  res.json(shape(after));
});

router.post('/:id/qa-review', (req, res) => {
  const db = getDb();
  const row = db.prepare('SELECT * FROM controlled_definitions WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  if (!canQaReview(req.user)) return res.status(403).json({ error: 'QA review is given by a supervisor in Quality.', code: 'QA_REVIEW_NOT_ALLOWED' });
  if (row.status !== 'pending' || row.pending_source !== 'app') return res.status(400).json({ error: 'Nothing proposed in the app is waiting on this definition.' });
  if (row.proposed_by_id && row.proposed_by_id === req.user.id) return res.status(403).json({ error: 'The person who proposed the change cannot also review it.', code: 'SELF_REVIEW' });
  if (row.qa_reviewed_at) return res.status(409).json({ error: `Already reviewed by ${row.qa_reviewed_by}.` });
  if (!gateSignature(req, res)) return;
  db.prepare(`UPDATE controlled_definitions SET qa_reviewed_by = ?, qa_reviewed_by_id = ?, qa_reviewed_at = datetime('now') WHERE id = ?`)
    .run(req.user.name, req.user.id, row.id);
  const after = db.prepare('SELECT * FROM controlled_definitions WHERE id = ?').get(row.id);
  logAudit(req.user, 'sign', 'controlled_definition', row.id,
    { qa_review: true, signature_verified: true, meaning: 'Reviewed by QA', scope: row.scope, key: row.key }, row, after, row.label);
  res.json(shape(after));
});

router.post('/:id/approve', (req, res) => {
  if (!requireReviewer(req, res)) return;
  const db = getDb();
  const before = db.prepare('SELECT * FROM controlled_definitions WHERE id = ?').get(req.params.id);
  if (!before) return res.status(404).json({ error: 'Not found' });
  // A value typed in the app is approved like an SOP revision: QA has reviewed
  // it, the QA reviewer is not the approver, and the approver signs.
  const fromApp = before.pending_source === 'app' && ['pending', 'rejected'].includes(before.status);
  if (fromApp) {
    if (!before.qa_reviewed_at) return res.status(409).json({ error: 'QA has not reviewed this change yet.', code: 'QA_REVIEW_REQUIRED' });
    if (before.qa_reviewed_by_id && before.qa_reviewed_by_id === req.user.id) {
      return res.status(403).json({ error: 'The person who gave QA review cannot also approve.', code: 'REVIEWER_CANNOT_APPROVE' });
    }
    if (!gateSignature(req, res)) return;
  }
  const out = approveDefinition(db, req.params.id, req.user);
  if (out.error) return res.status(400).json({ error: out.error });
  logAudit(req.user, 'update', 'controlled_definition', req.params.id,
    { approved: true, scope: before.scope, key: before.key, version: out.row.version, from_app: fromApp, ...(fromApp ? { signature_verified: true, meaning: 'Approved' } : {}) },
    before, out.row, before.label);
  res.json(shape(out.row));
});

router.post('/:id/reject', (req, res) => {
  if (!requireReviewer(req, res)) return;
  const db = getDb();
  const before = db.prepare('SELECT * FROM controlled_definitions WHERE id = ?').get(req.params.id);
  const out = rejectDefinition(db, req.params.id, req.user, req.body?.reason);
  if (out.error) return res.status(400).json({ error: out.error });
  logAudit(req.user, 'update', 'controlled_definition', req.params.id,
    { rejected: true, reason: req.body?.reason || null, scope: before.scope, key: before.key },
    before, out.row, before.label);
  res.json(shape(out.row));
});

export default router;

// ── Boot: sync, raise the change requests, tell Document Control ────────────

// A blocked change nobody is told about is just an outage. Document Control
// gets a ReadyBot DM naming what's waiting; the DCR is the auditable record.
/**
 * Who is told a change is parked.
 *
 * It is Document Control who approves one, so it is Document Control who is
 * named — not every admin. The fallback stays the department rather than
 * nothing: a parked change nobody is told about is just an outage, which is the
 * whole reason this message exists.
 */
export function controlledChangeRecipients(db) {
  return resolve(db, 'controlled_change_recipients', () => {
    const named = byNames(db, ['daniela servin', 'dayanna meza', 'maria servin']);
    return named.length ? named : byDept(db, ['document_control', 'document control']);
  });
}
function dcSupervisors(db) {
  return controlledChangeRecipients(db).users;
}

// One Document Change Request per parked definition, so the review lives in
// the module Document Control already works in and leaves the trail an auditor
// reads. The DCR is the paperwork; the gate itself is the row in
// controlled_definitions.
function raiseDcr(db, entry) {
  const cfg = getType('document_change_request');
  if (!cfg) return null;
  try {
    const rows = db.prepare("SELECT record_number FROM qms_records WHERE record_type = 'document_change_request'").all();
    let max = 0;
    for (const r of rows) {
      const m = String(r.record_number || '').match(/\d+/g);
      if (m) max = Math.max(max, parseInt(m[m.length - 1], 10));
    }
    const number = String(max + 1).padStart(cfg.numberPad || 4, '0');
    const id = uuid();
    const changes = diffSnapshots(entry.approved, entry.snapshot);
    const summary = changes.map(c => `${c.kind}: ${c.what}`).join('; ') || 'definition changed';
    const data = {
      initiator: 'ReadyDoc (deployed change)',
      doc_name: entry.label,
      change_type: 'New Revision',
      description: `A deployed change to this controlled definition is waiting on Document Control.\n\n${summary}\n\nThe app is still serving the approved version until it is approved in Document Control → Controlled Changes.`,
    };
    db.prepare(`INSERT INTO qms_records (id, record_type, record_number, record_date, status, data, paper_record, created_by)
      VALUES (?, 'document_change_request', ?, date('now'), NULL, ?, 0, 'ReadyDoc')`)
      .run(id, number, JSON.stringify(data));
    db.prepare('UPDATE controlled_definitions SET pending_dcr_id = ? WHERE id = ?').run(id, entry.id);
    logAudit('system', 'create', 'document_change_request', id,
      { raised_for: entry.label, scope: entry.scope, key: entry.key, auto: true }, null, null, entry.label);
    return number;
  } catch (e) {
    console.warn('[controlled] could not raise a change request:', e.message);
    return null;
  }
}

export async function runControlledSync(db) {
  let pending;
  try { pending = syncDefinitions(db); }
  catch (e) { console.warn('[controlled] sync failed:', e.message); return; }

  const total = pendingCount(db);
  if (!pending.length) {
    if (total) console.log(`[controlled] ${total} definition(s) still waiting on Document Control`);
    return;
  }

  const numbers = [];
  for (const entry of pending) {
    const n = raiseDcr(db, entry);
    if (n) numbers.push(n);
  }
  console.log(`[controlled] ${pending.length} definition(s) changed and are waiting on Document Control: ${pending.map(p => p.label).join(', ')}`);

  // Tell the people who can act on it.
  try {
    const lines = pending.map(p => `• ${p.label}`).join('\n');
    const body = `*${pending.length} controlled change${pending.length > 1 ? 's are' : ' is'} waiting on Document Control*\n${lines}\n\n`
      + `The app is still using the approved version${pending.length > 1 ? 's' : ''}. Review in Document Control → Controlled Changes`
      + `${numbers.length ? ` (${numbers.map(n => `DCR ${n}`).join(', ')})` : ''}.`;
    for (const u of dcSupervisors(db)) {
      const { bot, dm } = botDm(db, u.id);
      if (dm) await postMessageAs(db, dm, bot, body);
    }
  } catch (e) {
    console.warn('[controlled] could not notify Document Control:', e.message);
  }
}
