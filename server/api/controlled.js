import { Router } from 'express';
import { v4 as uuid } from 'uuid';
import { getDb, logAudit } from '../db.js';
import { syncDefinitions, approveDefinition, rejectDefinition, diffSnapshots, pendingCount } from '../controlled.js';
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
  };
}

// Everything, so Document Control can see what the app is currently serving
// and not only what's waiting.
router.get('/', (req, res) => {
  if (!requireReviewer(req, res)) return;
  const rows = getDb().prepare('SELECT * FROM controlled_definitions ORDER BY status DESC, label').all();
  res.json(rows.map(shape));
});

router.get('/pending', (req, res) => {
  if (!requireReviewer(req, res)) return;
  const rows = getDb().prepare("SELECT * FROM controlled_definitions WHERE status = 'pending' ORDER BY pending_seen_at").all();
  res.json(rows.map(shape));
});

router.post('/:id/approve', (req, res) => {
  if (!requireReviewer(req, res)) return;
  const db = getDb();
  const before = db.prepare('SELECT * FROM controlled_definitions WHERE id = ?').get(req.params.id);
  const out = approveDefinition(db, req.params.id, req.user);
  if (out.error) return res.status(400).json({ error: out.error });
  logAudit(req.user, 'update', 'controlled_definition', req.params.id,
    { approved: true, scope: before.scope, key: before.key, version: out.row.version },
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
function dcSupervisors(db) {
  try {
    return db.prepare(`SELECT id, name FROM users
      WHERE is_active = 1 AND (LOWER(department) = 'document_control' OR role = 'admin')`).all();
  } catch { return []; }
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
