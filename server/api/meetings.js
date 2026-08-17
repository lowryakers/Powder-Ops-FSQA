// Meetings — management review, food safety team, production, safety.
//
// Two SQF records live here (management review and the food safety team), so
// this is a controlled record, not a notes app. Three rules shape it:
//
//   1. AN ACTION ITEM IS A WORK ORDER. `meeting_actions` holds the wording as
//      minuted plus a link; the status is read live off `work_orders`. A
//      second task list that quietly disagrees with Task Center is exactly the
//      duplication the Operator View clean-up removed.
//   2. ATTENDANCE IS A RECORD, NOT AN INVITE LIST. Who was asked and who was
//      actually there are different facts, and an auditor asks for the second.
//   3. APPROVED MINUTES ARE CLOSED. Once the chair signs, the record is fixed
//      to everyone but an admin — and the way back is to REVOKE the signature
//      (the signer or an admin), correct it, sign again. All three audited.
//
// Meeting types are a managed list (`meeting_types`), so adding "Allergen
// review" is a Settings task rather than a deploy.

import { Router } from 'express';
import { randomUUID as uuid } from 'crypto';
import PDFDocument from 'pdfkit';
import { getDb, logAudit } from '../db.js';
import { hasExplicitEdit, hasExplicitGrant } from '../module-access.js';
import { coerceCustomData, mergeCustomData, parseJson } from '../custom-fields.js';
import { richBlocks } from '../pdf-rich.js';

const router = Router();
const MODULE = 'meetings';

// Minuting a meeting is a supervisory act — it records decisions on behalf of
// the people in the room. Correcting someone else's filed minutes needs an
// explicit edit grant (or admin), same shape as the Receiving Log.
const canMinute = (u) => u?.role === 'admin' || u?.role === 'supervisor' || hasExplicitGrant(u, MODULE);
const canEditAny = (u) => u?.role === 'admin' || hasExplicitEdit(u, MODULE);

// Who may sign the minutes: the chair, an admin, or a supervisor. The chair
// is matched by name because that's what the record stores — the person who
// ran the meeting, not necessarily an account holder.
const canApprove = (u, m) => u?.role === 'admin' || u?.role === 'supervisor'
  || (m?.chair && u?.name && m.chair.trim().toLowerCase() === u.name.trim().toLowerCase());

const STATUSES = new Set(['scheduled', 'held', 'approved']);
const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''));

// Sits with the record it describes: an approved meeting is closed to
// everyone but an admin, and the reason travels to the client so the UI can
// say why the pencil is gone instead of failing a save silently.
function permissions(m, user) {
  if (m.status === 'approved' && user?.role !== 'admin') {
    return { can_edit: false, can_delete: false, edit_block_reason: `Minutes approved by ${m.approved_by}. Revoke the approval to correct them.` };
  }
  const own = m.created_by && user?.name && m.created_by === user.name;
  return {
    can_edit: !!(canEditAny(user) || (own && canMinute(user))),
    can_delete: user?.role === 'admin',
    edit_block_reason: null,
  };
}

const shape = (m, user) => ({
  ...m,
  agenda: parseJson(m.agenda, []),
  attendees: parseJson(m.attendees, []),
  custom_data: parseJson(m.custom_data, null),
  ...permissions(m, user),
});

// Action items with their live status. The work order is the authority — the
// minuted wording is kept so the record reads as it was written even after
// someone renames the task.
function actionsFor(db, meetingId) {
  return db.prepare(`
    SELECT a.*, w.status AS task_status, w.assigned_to AS task_assignee,
           w.due_date AS task_due_date, w.completed_at, w.completed_by
    FROM meeting_actions a
    LEFT JOIN work_orders w ON w.id = a.work_order_id
    WHERE a.meeting_id = ? ORDER BY a.created_at`).all(meetingId);
}

const isOpenAction = (a) => a.work_order_id && !['completed', 'cancelled', 'not_applicable'].includes(a.task_status);

// Fixed columns a create/update may set. Explicit so a client can't write the
// approval columns — those only move through the approve/revoke routes.
const WRITABLE = ['meeting_type', 'title', 'meeting_date', 'start_time', 'end_time', 'location', 'chair', 'minutes'];

function readBody(body) {
  const out = {};
  for (const k of WRITABLE) {
    if (body[k] === undefined) continue;
    out[k] = body[k] === '' ? null : String(body[k]);
  }
  if (Array.isArray(body.agenda)) out.agenda = JSON.stringify(body.agenda.map(String).filter(s => s.trim()));
  if (Array.isArray(body.attendees)) {
    out.attendees = JSON.stringify(body.attendees
      .filter(a => a && String(a.name || '').trim())
      .map(a => ({
        user_id: a.user_id || null,
        name: String(a.name).trim(),
        role: a.role ? String(a.role) : null,
        // Present is a positive assertion. Undefined means "not marked yet",
        // which on a scheduled meeting is the honest state — so it stores as
        // false and the UI shows it as unmarked until the meeting is held.
        present: !!a.present,
      })));
  }
  return out;
}

// ── Reads ───────────────────────────────────────────────────────────────────

// Bounded like every other list endpoint. Newest first: the question is
// almost always "what happened at the last one".
router.get('/', (req, res) => {
  const db = getDb();
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 200, 1), 1000);
  const where = [];
  const args = [];
  if (req.query.type) { where.push('meeting_type = ?'); args.push(req.query.type); }
  if (req.query.status && STATUSES.has(req.query.status)) { where.push('status = ?'); args.push(req.query.status); }
  const rows = db.prepare(`
    SELECT m.*,
      (SELECT COUNT(*) FROM meeting_actions a WHERE a.meeting_id = m.id) AS action_count,
      (SELECT COUNT(*) FROM meeting_actions a JOIN work_orders w ON w.id = a.work_order_id
        WHERE a.meeting_id = m.id AND w.status IN ('open','in_progress','overdue','missed')) AS open_action_count
    FROM meetings m
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY m.meeting_date DESC, m.created_at DESC LIMIT ?`).all(...args, limit);
  res.json(rows.map(r => shape(r, req.user)));
});

router.get('/:id', (req, res) => {
  const db = getDb();
  const m = db.prepare('SELECT * FROM meetings WHERE id = ?').get(req.params.id);
  if (!m) return res.status(404).json({ error: 'Not found' });
  res.json({ ...shape(m, req.user), actions: actionsFor(db, m.id) });
});

// ── Writes ──────────────────────────────────────────────────────────────────

router.post('/', (req, res) => {
  if (!canMinute(req.user)) return res.status(403).json({ error: 'Supervisor access is needed to record a meeting.' });
  const db = getDb();
  const body = readBody(req.body);
  if (!body.title?.trim()) return res.status(400).json({ error: 'A title is required.' });
  if (!body.meeting_type) return res.status(400).json({ error: 'A meeting type is required.' });
  if (!isDate(body.meeting_date)) return res.status(400).json({ error: 'A meeting date is required.' });

  const { data, errors } = coerceCustomData(db, 'meeting', req.body?.custom_data);
  if (errors.length) return res.status(400).json({ error: errors.join(' ') });

  const id = uuid();
  const status = STATUSES.has(req.body?.status) && req.body.status !== 'approved' ? req.body.status : 'scheduled';
  const cols = { ...body, id, status, created_by: req.user.name, custom_data: data ? JSON.stringify(data) : null };
  const keys = Object.keys(cols);
  db.prepare(`INSERT INTO meetings (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`)
    .run(...keys.map(k => cols[k]));

  const created = db.prepare('SELECT * FROM meetings WHERE id = ?').get(id);
  logAudit(req.user, 'create', 'meeting', id, { title: created.title, meeting_type: created.meeting_type, meeting_date: created.meeting_date }, null, created, created.title);
  res.status(201).json(shape(created, req.user));
});

router.put('/:id', (req, res) => {
  const db = getDb();
  const m = db.prepare('SELECT * FROM meetings WHERE id = ?').get(req.params.id);
  if (!m) return res.status(404).json({ error: 'Not found' });
  const perms = permissions(m, req.user);
  if (!perms.can_edit) return res.status(403).json({ error: perms.edit_block_reason || 'You cannot change this record.' });

  const body = readBody(req.body);
  // A corrected date is a real edit (the paper was minuted under the wrong
  // day); a BLANK date would leave an SQF record floating in time — refuse it
  // rather than store it.
  if (body.meeting_date !== undefined && !isDate(body.meeting_date)) {
    return res.status(400).json({ error: 'The meeting date must be a real date (YYYY-MM-DD).' });
  }
  if (req.body?.status !== undefined) {
    // Approved is reached by signing, never by setting a field.
    if (req.body.status === 'approved') return res.status(400).json({ error: 'Approve the minutes to set that status.' });
    if (STATUSES.has(req.body.status)) body.status = req.body.status;
  }
  if (req.body?.custom_data !== undefined) {
    const { data, errors } = coerceCustomData(db, 'meeting', req.body.custom_data);
    if (errors.length) return res.status(400).json({ error: errors.join(' ') });
    // Merge so values captured under since-retired fields survive the edit.
    const merged = mergeCustomData(m.custom_data, data);
    body.custom_data = merged ? JSON.stringify(merged) : null;
  }
  const keys = Object.keys(body);
  if (!keys.length) return res.json(shape(m, req.user));
  db.prepare(`UPDATE meetings SET ${keys.map(k => `${k} = ?`).join(', ')}, updated_at = datetime('now') WHERE id = ?`)
    .run(...keys.map(k => body[k]), m.id);

  const next = db.prepare('SELECT * FROM meetings WHERE id = ?').get(m.id);
  logAudit(req.user, 'update', 'meeting', m.id, { fields: keys }, m, next, next.title);
  res.json(shape(next, req.user));
});

// Admin only, and never once the minutes are approved — an approved record is
// changed by status, not removed. Linked work orders are left alone: they are
// real assignments people may already have acted on.
router.delete('/:id', (req, res) => {
  const db = getDb();
  const m = db.prepare('SELECT * FROM meetings WHERE id = ?').get(req.params.id);
  if (!m) return res.status(404).json({ error: 'Not found' });
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Admin access required.' });
  if (m.status === 'approved') return res.status(400).json({ error: 'Approved minutes cannot be deleted. Revoke the approval first.' });
  db.prepare('DELETE FROM meeting_actions WHERE meeting_id = ?').run(m.id);
  db.prepare('DELETE FROM meetings WHERE id = ?').run(m.id);
  logAudit(req.user, 'delete', 'meeting', m.id, { title: m.title }, m, null, m.title);
  res.json({ deleted: m.id });
});

// ── Action items ────────────────────────────────────────────────────────────

// Every action item creates a work order, so it lands in the owner's Task
// Center rather than only in a document nobody opens again. A due date is
// required for the same reason: an action with no date is a note.
router.post('/:id/actions', (req, res) => {
  const db = getDb();
  const m = db.prepare('SELECT * FROM meetings WHERE id = ?').get(req.params.id);
  if (!m) return res.status(404).json({ error: 'Not found' });
  if (!canMinute(req.user)) return res.status(403).json({ error: 'Supervisor access is needed to assign an action.' });

  const description = String(req.body?.description || '').trim();
  const owner = String(req.body?.owner || '').trim();
  const dueDate = String(req.body?.due_date || '').trim();
  if (!description) return res.status(400).json({ error: 'Describe the action.' });
  if (!isDate(dueDate)) return res.status(400).json({ error: 'An action needs a due date.' });

  const woId = uuid();
  const group = String(req.body?.task_group || 'office');
  // The meeting is the context an assignee needs to understand the task, so it
  // travels with the work order rather than being findable only from here.
  const description_wo = `From ${m.title} (${m.meeting_date}).\n\n${description}`;
  db.prepare(`INSERT INTO work_orders (id, equipment_id, title, description, priority, assigned_to, due_date, procedure_steps, attachments, task_group)
              VALUES (?, NULL, ?, ?, 'normal', ?, ?, '[]', '[]', ?)`)
    .run(woId, description.slice(0, 120), description_wo, owner || null, dueDate, group);

  const id = uuid();
  db.prepare('INSERT INTO meeting_actions (id, meeting_id, description, owner, due_date, work_order_id, carried_from) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(id, m.id, description, owner || null, dueDate, woId, req.body?.carried_from || null);

  logAudit(req.user, 'create', 'work_order', woId, { from_meeting: m.title, due_date: dueDate, assigned_to: owner || null }, null, db.prepare('SELECT * FROM work_orders WHERE id = ?').get(woId), description.slice(0, 120));
  res.status(201).json({ actions: actionsFor(db, m.id) });
});

// Removing an action removes the work order only while it is still untouched.
// Once someone has started or finished it, the task is their record of work
// and deleting it would erase that — the link is dropped instead.
router.delete('/actions/:actionId', (req, res) => {
  const db = getDb();
  const a = db.prepare('SELECT * FROM meeting_actions WHERE id = ?').get(req.params.actionId);
  if (!a) return res.status(404).json({ error: 'Not found' });
  if (!canMinute(req.user)) return res.status(403).json({ error: 'Supervisor access required.' });
  const wo = a.work_order_id ? db.prepare('SELECT * FROM work_orders WHERE id = ?').get(a.work_order_id) : null;
  let taskRemoved = false;
  if (wo && wo.status === 'open' && !wo.completed_at) {
    db.prepare('DELETE FROM work_orders WHERE id = ?').run(wo.id);
    taskRemoved = true;
  }
  db.prepare('DELETE FROM meeting_actions WHERE id = ?').run(a.id);
  logAudit(req.user, 'delete', 'meeting_action', a.id, { meeting_id: a.meeting_id, task_removed: taskRemoved }, a, null, a.description.slice(0, 80));
  res.json({ actions: actionsFor(db, a.meeting_id), task_removed: taskRemoved });
});

// ── Signing the minutes ─────────────────────────────────────────────────────

router.post('/:id/approve', (req, res) => {
  const db = getDb();
  const m = db.prepare('SELECT * FROM meetings WHERE id = ?').get(req.params.id);
  if (!m) return res.status(404).json({ error: 'Not found' });
  if (!canApprove(req.user, m)) return res.status(403).json({ error: 'The chair, a supervisor or an admin approves the minutes.' });
  if (m.status === 'approved') return res.status(400).json({ error: 'Already approved.' });
  if (!String(m.minutes || '').trim()) return res.status(400).json({ error: 'There are no minutes to approve yet.' });

  db.prepare(`UPDATE meetings SET status = 'approved', approved_by = ?, approved_at = datetime('now'), approval_note = ?, updated_at = datetime('now') WHERE id = ?`)
    .run(req.user.name, String(req.body?.note || '').trim() || null, m.id);
  const next = db.prepare('SELECT * FROM meetings WHERE id = ?').get(m.id);
  logAudit(req.user, 'approve', 'meeting', m.id, { title: m.title, meeting_date: m.meeting_date }, m, next, m.title);
  res.json({ ...shape(next, req.user), actions: actionsFor(db, m.id) });
});

// The way back from a signature is revoke, not "find an admin" — the normal
// case is the chair spotting a wrong figure in their own minutes.
router.delete('/:id/approve', (req, res) => {
  const db = getDb();
  const m = db.prepare('SELECT * FROM meetings WHERE id = ?').get(req.params.id);
  if (!m) return res.status(404).json({ error: 'Not found' });
  if (m.status !== 'approved') return res.status(400).json({ error: 'These minutes are not approved.' });
  const isSigner = m.approved_by && req.user?.name && m.approved_by.trim().toLowerCase() === req.user.name.trim().toLowerCase();
  if (req.user?.role !== 'admin' && !isSigner) return res.status(403).json({ error: 'Only the person who approved these minutes, or an admin, can revoke it.' });

  db.prepare(`UPDATE meetings SET status = 'held', approved_by = NULL, approved_at = NULL, approval_note = NULL, updated_at = datetime('now') WHERE id = ?`).run(m.id);
  const next = db.prepare('SELECT * FROM meetings WHERE id = ?').get(m.id);
  logAudit(req.user, 'revoke', 'meeting', m.id, { title: m.title, was_approved_by: m.approved_by }, m, next, m.title);
  res.json({ ...shape(next, req.user), actions: actionsFor(db, m.id) });
});

// ── The next one ────────────────────────────────────────────────────────────

// Minutes end with "next meeting". This creates it: same type, title, chair,
// location and attendee list, and it CARRIES FORWARD every action still open
// — carrying business forward is what the follow-up meeting is for, and
// retyping it is where the practice quietly stops.
router.post('/:id/next', (req, res) => {
  const db = getDb();
  const m = db.prepare('SELECT * FROM meetings WHERE id = ?').get(req.params.id);
  if (!m) return res.status(404).json({ error: 'Not found' });
  if (!canMinute(req.user)) return res.status(403).json({ error: 'Supervisor access required.' });
  const date = String(req.body?.meeting_date || '').trim();
  if (!isDate(date)) return res.status(400).json({ error: 'Pick a date for the next meeting.' });

  const id = uuid();
  // Attendance restarts unmarked: who came last time is not a claim about who
  // will come to this one.
  const attendees = parseJson(m.attendees, []).map(a => ({ ...a, present: false }));
  db.prepare(`INSERT INTO meetings (id, meeting_type, title, meeting_date, start_time, location, chair, agenda, attendees, status, previous_meeting_id, created_by)
              VALUES (?, ?, ?, ?, ?, ?, ?, '[]', ?, 'scheduled', ?, ?)`)
    .run(id, m.meeting_type, m.title, date, m.start_time, m.location, m.chair, JSON.stringify(attendees), m.id, req.user.name);

  const carried = actionsFor(db, m.id).filter(isOpenAction);
  const ins = db.prepare('INSERT INTO meeting_actions (id, meeting_id, description, owner, due_date, work_order_id, carried_from) VALUES (?, ?, ?, ?, ?, ?, ?)');
  // Carried actions keep their ORIGINAL work order. Re-creating the task would
  // double it in the owner's list and reset the clock on work already late.
  for (const a of carried) ins.run(uuid(), id, a.description, a.owner, a.due_date, a.work_order_id, a.id);

  const created = db.prepare('SELECT * FROM meetings WHERE id = ?').get(id);
  logAudit(req.user, 'create', 'meeting', id, { title: created.title, meeting_date: date, follows: m.id, carried_actions: carried.length }, null, created, created.title);
  res.status(201).json({ ...shape(created, req.user), actions: actionsFor(db, id) });
});

// ── Minutes as a document ───────────────────────────────────────────────────

// Meetings get printed and posted, and an auditor asks for the minutes rather
// than a screen. Rich markup goes through richBlocks so the PDF matches what
// the author saw in the editor.
router.get('/:id/pdf', (req, res) => {
  const db = getDb();
  const m = db.prepare('SELECT * FROM meetings WHERE id = ?').get(req.params.id);
  if (!m) return res.status(404).json({ error: 'Not found' });
  const attendees = parseJson(m.attendees, []);
  const agenda = parseJson(m.agenda, []);
  const actions = actionsFor(db, m.id);

  const doc = new PDFDocument({ size: 'LETTER', margin: 54 });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="minutes-${m.meeting_date}-${m.meeting_type.replace(/\W+/g, '-').toLowerCase()}.pdf"`);
  doc.pipe(res);

  doc.font('Helvetica-Bold').fontSize(16).text(m.title);
  doc.font('Helvetica').fontSize(10).fillColor('#555')
    .text(`${m.meeting_type} · ${m.meeting_date}${m.start_time ? ` · ${m.start_time}${m.end_time ? `–${m.end_time}` : ''}` : ''}${m.location ? ` · ${m.location}` : ''}`);
  if (m.chair) doc.text(`Chaired by ${m.chair}`);
  doc.fillColor('#000').moveDown();

  const heading = (t) => { doc.moveDown(0.6).font('Helvetica-Bold').fontSize(11).text(t).font('Helvetica').fontSize(10); };

  heading(`Attendance (${attendees.filter(a => a.present).length} of ${attendees.length})`);
  if (!attendees.length) doc.fillColor('#777').text('Not recorded').fillColor('#000');
  for (const a of attendees) doc.text(`${a.present ? '[x]' : '[ ]'}  ${a.name}${a.role ? ` — ${a.role}` : ''}`);

  if (agenda.length) {
    heading('Agenda');
    agenda.forEach((item, i) => doc.text(`${i + 1}. ${item}`));
  }

  heading('Minutes');
  if (String(m.minutes || '').trim()) richBlocks(doc, m.minutes, 'Helvetica');
  else doc.fillColor('#777').text('No minutes recorded').fillColor('#000');

  if (actions.length) {
    heading('Action items');
    for (const a of actions) {
      const done = a.task_status === 'completed';
      doc.text(`${done ? '[x]' : '[ ]'}  ${a.description}`);
      doc.fillColor('#555').fontSize(9)
        .text(`     ${a.owner || 'unassigned'} · due ${a.due_date || '—'} · ${a.task_status || 'no task'}${a.carried_from ? ' · carried forward' : ''}`)
        .fillColor('#000').fontSize(10);
    }
  }

  doc.moveDown(1.2).fontSize(9).fillColor('#555');
  doc.text(m.status === 'approved'
    ? `Minutes approved by ${m.approved_by} on ${String(m.approved_at || '').slice(0, 10)}.${m.approval_note ? ` ${m.approval_note}` : ''}`
    : 'DRAFT — these minutes have not been approved.');
  doc.text('Uncontrolled when printed — verify against ReadyDoc.');
  doc.end();
});

export default router;
