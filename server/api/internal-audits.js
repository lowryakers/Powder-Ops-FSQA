// Internal audits — Form 403-01, walked one question at a time.
//
// The paper form is five pages of ~100 questions, and a real audit covers two
// or three areas. So the record starts by choosing SECTIONS: only those get
// item rows, and the rest are simply absent from the record. On paper the
// auditor drew a diagonal line through the sections they didn't cover; this is
// the same decision, recorded rather than drawn.
//
// Rules that matter:
//   · A NOT-COMPLIANT ANSWER IS A FINDING, and a finding gets a CAR — the form
//     has a "CAR Completed Y/N" column for exactly this. The CAR is a row in
//     the existing `capas` register with `source_type = 'Internal Audit'`, not
//     a private list, and its status is read live. One CAPA register.
//   · A SIGNED AUDIT IS CLOSED. Same rule as everywhere else: correct it by
//     revoking the signature first, and every step is audited.
//   · The checklist itself is NOT editable in-app (`audit-checklist.js`) —
//     changing what an internal audit asks is a document change.

import { Router } from 'express';
import { randomUUID as uuid } from 'crypto';
import PDFDocument from 'pdfkit';
import { getDb, logAudit } from '../db.js';
import { hasExplicitEdit, hasExplicitGrant } from '../module-access.js';
import { coerceCustomData, mergeCustomData, parseJson } from '../custom-fields.js';
import {
  CHECKLIST_CODE, CHECKLIST_REVISION, SECTIONS, SECTION_IDS, sectionById, itemsForSections,
} from '../audit-checklist.js';

const router = Router();
const MODULE = 'internal-audits';

// Auditing is a quality act. Admin, supervisor, the QA/quality departments, or
// an explicit grant (the plant may certify an auditor who is neither).
const canAudit = (u) => u?.role === 'admin' || u?.role === 'supervisor'
  || ['qa', 'quality'].includes((u?.department || '').toLowerCase())
  || hasExplicitGrant(u, MODULE);
const canEditAny = (u) => u?.role === 'admin' || hasExplicitEdit(u, MODULE);

const RESULTS = new Set(['c', 'nc', 'na']);
const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''));

function permissions(a, user) {
  if (a.status === 'completed' && user?.role !== 'admin') {
    return { can_edit: false, edit_block_reason: `Signed off by ${a.signed_by}. Revoke the sign-off to correct it.` };
  }
  return { can_edit: !!(canAudit(user) || canEditAny(user)), edit_block_reason: null };
}

const shape = (a, user) => ({
  ...a,
  sections: parseJson(a.sections, []),
  custom_data: parseJson(a.custom_data, null),
  ...permissions(a, user),
});

// Items with the live status of any CAR raised against them.
function itemsFor(db, auditId) {
  return db.prepare(`
    SELECT i.*, c.capa_number, c.status AS capa_status, c.due_date AS capa_due_date, c.assigned_to AS capa_assigned_to
    FROM internal_audit_items i
    LEFT JOIN capas c ON c.id = i.capa_id
    WHERE i.audit_id = ? ORDER BY i.sort_order`).all(auditId);
}

// IA-0001 upward. MAX of the numeric suffix, so it keeps counting past 9999
// and a hand-entered legacy number can't reset the sequence.
function nextAuditNo(db) {
  const rows = db.prepare("SELECT audit_no FROM internal_audits WHERE audit_no LIKE 'IA-%'").all();
  let max = 0;
  for (const r of rows) {
    const n = parseInt(String(r.audit_no).replace(/^IA-/, ''), 10);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return `IA-${String(max + 1).padStart(4, '0')}`;
}

// The checklist definition, so the client renders the same questions the
// server will create rows for. Static — safe to cache.
router.get('/checklist', (_req, res) => {
  res.json({ code: CHECKLIST_CODE, revision: CHECKLIST_REVISION, sections: SECTIONS });
});

router.get('/', (req, res) => {
  const db = getDb();
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 200, 1), 1000);
  const rows = db.prepare(`
    SELECT a.*,
      (SELECT COUNT(*) FROM internal_audit_items i WHERE i.audit_id = a.id) AS item_count,
      (SELECT COUNT(*) FROM internal_audit_items i WHERE i.audit_id = a.id AND i.result IS NOT NULL) AS answered_count,
      (SELECT COUNT(*) FROM internal_audit_items i WHERE i.audit_id = a.id AND i.result = 'nc') AS finding_count,
      (SELECT COUNT(*) FROM internal_audit_items i JOIN capas c ON c.id = i.capa_id
        WHERE i.audit_id = a.id AND c.status != 'closed') AS open_car_count
    FROM internal_audits a ORDER BY a.audit_date DESC, a.created_at DESC LIMIT ?`).all(limit);
  res.json(rows.map(r => shape(r, req.user)));
});

router.get('/:id', (req, res) => {
  const db = getDb();
  const a = db.prepare('SELECT * FROM internal_audits WHERE id = ?').get(req.params.id);
  if (!a) return res.status(404).json({ error: 'Not found' });
  res.json({ ...shape(a, req.user), items: itemsFor(db, a.id) });
});

router.post('/', (req, res) => {
  if (!canAudit(req.user)) return res.status(403).json({ error: 'Quality access is needed to run an internal audit.' });
  const db = getDb();
  const auditDate = String(req.body?.audit_date || '').trim();
  if (!isDate(auditDate)) return res.status(400).json({ error: 'An audit date is required.' });

  const picked = Array.isArray(req.body?.sections) ? req.body.sections.filter(s => SECTION_IDS.includes(s)) : [];
  // Auditing nothing is not an audit. Better to refuse than to file an empty
  // record that reads later as "we looked and found nothing".
  if (!picked.length) return res.status(400).json({ error: 'Pick at least one section to audit.' });

  const { data, errors } = coerceCustomData(db, 'internal_audit', req.body?.custom_data);
  if (errors.length) return res.status(400).json({ error: errors.join(' ') });

  const id = uuid();
  const rows = itemsForSections(picked);
  const tx = db.transaction(() => {
    db.prepare(`INSERT INTO internal_audits
      (id, audit_no, checklist_code, checklist_revision, focus_areas, audit_date, lead_auditor, sections, status, custom_data, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'in_progress', ?, ?)`)
      .run(id, nextAuditNo(db), CHECKLIST_CODE, CHECKLIST_REVISION,
        String(req.body?.focus_areas || '').trim() || null, auditDate,
        String(req.body?.lead_auditor || '').trim() || req.user.name,
        JSON.stringify(picked), data ? JSON.stringify(data) : null, req.user.name);
    const ins = db.prepare('INSERT INTO internal_audit_items (id, audit_id, section, item_key, prompt, sort_order) VALUES (?, ?, ?, ?, ?, ?)');
    rows.forEach((r, i) => ins.run(uuid(), id, r.section, r.item_key, r.prompt, i));
  });
  tx();

  const created = db.prepare('SELECT * FROM internal_audits WHERE id = ?').get(id);
  logAudit(req.user, 'create', 'internal_audit', id,
    { audit_no: created.audit_no, sections: picked, items: rows.length, revision: CHECKLIST_REVISION },
    null, created, created.audit_no);
  res.status(201).json({ ...shape(created, req.user), items: itemsFor(db, id) });
});

// Header fields. The section list is deliberately NOT editable here — adding a
// section mid-audit goes through /sections so the item rows follow.
router.put('/:id', (req, res) => {
  const db = getDb();
  const a = db.prepare('SELECT * FROM internal_audits WHERE id = ?').get(req.params.id);
  if (!a) return res.status(404).json({ error: 'Not found' });
  const perms = permissions(a, req.user);
  if (!perms.can_edit) return res.status(403).json({ error: perms.edit_block_reason || 'You cannot change this record.' });

  const cols = {};
  for (const k of ['focus_areas', 'lead_auditor', 'summary']) {
    if (req.body[k] !== undefined) cols[k] = String(req.body[k] || '').trim() || null;
  }
  if (isDate(req.body?.audit_date)) cols.audit_date = req.body.audit_date;
  if (req.body?.custom_data !== undefined) {
    const { data, errors } = coerceCustomData(db, 'internal_audit', req.body.custom_data);
    if (errors.length) return res.status(400).json({ error: errors.join(' ') });
    const merged = mergeCustomData(a.custom_data, data);
    cols.custom_data = merged ? JSON.stringify(merged) : null;
  }
  const keys = Object.keys(cols);
  if (!keys.length) return res.json(shape(a, req.user));
  db.prepare(`UPDATE internal_audits SET ${keys.map(k => `${k} = ?`).join(', ')}, updated_at = datetime('now') WHERE id = ?`)
    .run(...keys.map(k => cols[k]), a.id);
  const next = db.prepare('SELECT * FROM internal_audits WHERE id = ?').get(a.id);
  logAudit(req.user, 'update', 'internal_audit', a.id, { fields: keys }, a, next, a.audit_no);
  res.json(shape(next, req.user));
});

// Bring another section into scope part-way through, or drop one that turned
// out not to apply. An added section's items are appended; a REMOVED section
// only goes if nothing in it was answered — deleting answered items would
// erase evidence, so the request is refused and says why.
router.post('/:id/sections', (req, res) => {
  const db = getDb();
  const a = db.prepare('SELECT * FROM internal_audits WHERE id = ?').get(req.params.id);
  if (!a) return res.status(404).json({ error: 'Not found' });
  const perms = permissions(a, req.user);
  if (!perms.can_edit) return res.status(403).json({ error: perms.edit_block_reason || 'You cannot change this record.' });

  const picked = Array.isArray(req.body?.sections) ? req.body.sections.filter(s => SECTION_IDS.includes(s)) : [];
  if (!picked.length) return res.status(400).json({ error: 'An audit must cover at least one section.' });
  const current = parseJson(a.sections, []);
  const removing = current.filter(s => !picked.includes(s));

  for (const s of removing) {
    const answered = db.prepare("SELECT COUNT(*) n FROM internal_audit_items WHERE audit_id = ? AND section = ? AND result IS NOT NULL").get(a.id, s).n;
    if (answered) {
      return res.status(400).json({ error: `${sectionById(s)?.title || s} has ${answered} answered item(s). Clear those answers before dropping the section.` });
    }
  }

  const adding = picked.filter(s => !current.includes(s));
  const tx = db.transaction(() => {
    if (removing.length) {
      const ph = removing.map(() => '?').join(',');
      db.prepare(`DELETE FROM internal_audit_items WHERE audit_id = ? AND section IN (${ph})`).run(a.id, ...removing);
    }
    if (adding.length) {
      let order = db.prepare('SELECT COALESCE(MAX(sort_order), -1) n FROM internal_audit_items WHERE audit_id = ?').get(a.id).n;
      const ins = db.prepare('INSERT INTO internal_audit_items (id, audit_id, section, item_key, prompt, sort_order) VALUES (?, ?, ?, ?, ?, ?)');
      for (const r of itemsForSections(adding)) ins.run(uuid(), a.id, r.section, r.item_key, r.prompt, ++order);
    }
    db.prepare("UPDATE internal_audits SET sections = ?, updated_at = datetime('now') WHERE id = ?").run(JSON.stringify(picked), a.id);
  });
  tx();

  logAudit(req.user, 'update', 'internal_audit', a.id, { sections_added: adding, sections_removed: removing }, a,
    db.prepare('SELECT * FROM internal_audits WHERE id = ?').get(a.id), a.audit_no);
  const next = db.prepare('SELECT * FROM internal_audits WHERE id = ?').get(a.id);
  res.json({ ...shape(next, req.user), items: itemsFor(db, a.id) });
});

// Answer one item. `result: null` clears it — an answer given by mistake has
// to be removable, and clearing is recorded like any other change.
router.put('/:id/items/:itemId', (req, res) => {
  const db = getDb();
  const a = db.prepare('SELECT * FROM internal_audits WHERE id = ?').get(req.params.id);
  if (!a) return res.status(404).json({ error: 'Not found' });
  const perms = permissions(a, req.user);
  if (!perms.can_edit) return res.status(403).json({ error: perms.edit_block_reason || 'You cannot change this record.' });
  const item = db.prepare('SELECT * FROM internal_audit_items WHERE id = ? AND audit_id = ?').get(req.params.itemId, a.id);
  if (!item) return res.status(404).json({ error: 'Item not found' });

  const raw = req.body?.result;
  const result = raw === null || raw === '' ? null : String(raw);
  if (result !== null && !RESULTS.has(result)) return res.status(400).json({ error: 'Result must be c, nc or na.' });
  const comments = req.body?.comments === undefined ? item.comments : (String(req.body.comments || '').trim() || null);

  db.prepare(`UPDATE internal_audit_items SET result = ?, comments = ?,
      answered_by = ?, answered_at = CASE WHEN ? IS NULL THEN NULL ELSE datetime('now') END WHERE id = ?`)
    .run(result, comments, result === null ? null : req.user.name, result, item.id);
  db.prepare("UPDATE internal_audits SET updated_at = datetime('now') WHERE id = ?").run(a.id);

  res.json({ items: itemsFor(db, a.id) });
});

// A not-compliant answer becomes a Corrective Action Request in the CAPA
// register — the form's own "CAR Completed Y/N" column. Idempotent: an item
// that already has one returns it rather than raising a second.
router.post('/:id/items/:itemId/car', (req, res) => {
  const db = getDb();
  const a = db.prepare('SELECT * FROM internal_audits WHERE id = ?').get(req.params.id);
  if (!a) return res.status(404).json({ error: 'Not found' });
  if (!canAudit(req.user)) return res.status(403).json({ error: 'Quality access required.' });
  const item = db.prepare('SELECT * FROM internal_audit_items WHERE id = ? AND audit_id = ?').get(req.params.itemId, a.id);
  if (!item) return res.status(404).json({ error: 'Item not found' });
  if (item.capa_id) return res.json({ items: itemsFor(db, a.id), already: true });
  if (item.result !== 'nc') return res.status(400).json({ error: 'A CAR follows a not-compliant finding.' });

  const existing = db.prepare("SELECT capa_number FROM capas WHERE capa_number LIKE 'CAPA-%' ORDER BY capa_number DESC LIMIT 1").get();
  let num = 'CAPA-001';
  if (existing) {
    const m = String(existing.capa_number).match(/(\d+)/);
    if (m) num = `CAPA-${String(parseInt(m[1], 10) + 1).padStart(3, '0')}`;
  }
  const capaId = uuid();
  const section = sectionById(item.section);
  // The finding IS the title; the auditor's comment is the description. An
  // assignee reading only the CAPA register still knows what was seen.
  db.prepare(`INSERT INTO capas (id, capa_number, title, description, assigned_to, priority, due_date, status, date_issued, source_type)
              VALUES (?, ?, ?, ?, ?, ?, ?, 'open', ?, 'Internal Audit')`)
    .run(capaId, num, item.prompt.slice(0, 160),
      `Raised from internal audit ${a.audit_no} (${a.audit_date}), section "${section?.title || item.section}".\n\n${item.comments || 'No comment recorded.'}`,
      String(req.body?.assigned_to || '').trim() || null,
      String(req.body?.priority || 'normal'),
      String(req.body?.due_date || '').trim() || null, a.audit_date);

  db.prepare('UPDATE internal_audit_items SET capa_id = ? WHERE id = ?').run(capaId, item.id);
  logAudit(req.user, 'create', 'capa', capaId, { capa_number: num, from_internal_audit: a.audit_no, section: item.section }, null,
    db.prepare('SELECT * FROM capas WHERE id = ?').get(capaId), num);
  res.status(201).json({ items: itemsFor(db, a.id) });
});

// ── Sign-off ────────────────────────────────────────────────────────────────

// The lead auditor signs the completed checklist — the signature block on the
// last page of Form 403-01. Unanswered items block it: an audit filed with
// half its questions blank reads later as if those areas passed.
router.post('/:id/complete', (req, res) => {
  const db = getDb();
  const a = db.prepare('SELECT * FROM internal_audits WHERE id = ?').get(req.params.id);
  if (!a) return res.status(404).json({ error: 'Not found' });
  if (!canAudit(req.user)) return res.status(403).json({ error: 'Quality access required.' });
  if (a.status === 'completed') return res.status(400).json({ error: 'Already signed off.' });
  const blank = db.prepare('SELECT COUNT(*) n FROM internal_audit_items WHERE audit_id = ? AND result IS NULL').get(a.id).n;
  if (blank) return res.status(400).json({ error: `${blank} item${blank === 1 ? '' : 's'} still unanswered. Mark them compliant, not compliant, or N/A first.` });

  db.prepare(`UPDATE internal_audits SET status = 'completed', signed_by = ?, signed_at = datetime('now'),
      completed_at = date('now'), summary = COALESCE(?, summary), updated_at = datetime('now') WHERE id = ?`)
    .run(req.user.name, String(req.body?.summary || '').trim() || null, a.id);
  const next = db.prepare('SELECT * FROM internal_audits WHERE id = ?').get(a.id);
  logAudit(req.user, 'approve', 'internal_audit', a.id, { audit_no: a.audit_no }, a, next, a.audit_no);
  res.json({ ...shape(next, req.user), items: itemsFor(db, a.id) });
});

router.delete('/:id/complete', (req, res) => {
  const db = getDb();
  const a = db.prepare('SELECT * FROM internal_audits WHERE id = ?').get(req.params.id);
  if (!a) return res.status(404).json({ error: 'Not found' });
  if (a.status !== 'completed') return res.status(400).json({ error: 'This audit is not signed off.' });
  const isSigner = a.signed_by && req.user?.name && a.signed_by.trim().toLowerCase() === req.user.name.trim().toLowerCase();
  if (req.user?.role !== 'admin' && !isSigner) return res.status(403).json({ error: 'Only the auditor who signed, or an admin, can revoke it.' });

  db.prepare(`UPDATE internal_audits SET status = 'in_progress', signed_by = NULL, signed_at = NULL, completed_at = NULL, updated_at = datetime('now') WHERE id = ?`).run(a.id);
  const next = db.prepare('SELECT * FROM internal_audits WHERE id = ?').get(a.id);
  logAudit(req.user, 'revoke', 'internal_audit', a.id, { audit_no: a.audit_no, was_signed_by: a.signed_by }, a, next, a.audit_no);
  res.json({ ...shape(next, req.user), items: itemsFor(db, a.id) });
});

// Admin only, and never once signed — a signed audit is a record.
router.delete('/:id', (req, res) => {
  const db = getDb();
  const a = db.prepare('SELECT * FROM internal_audits WHERE id = ?').get(req.params.id);
  if (!a) return res.status(404).json({ error: 'Not found' });
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Admin access required.' });
  if (a.status === 'completed') return res.status(400).json({ error: 'A signed audit cannot be deleted. Revoke the sign-off first.' });
  db.prepare('DELETE FROM internal_audit_items WHERE audit_id = ?').run(a.id);
  db.prepare('DELETE FROM internal_audits WHERE id = ?').run(a.id);
  logAudit(req.user, 'delete', 'internal_audit', a.id, { audit_no: a.audit_no }, a, null, a.audit_no);
  res.json({ deleted: a.id });
});

// ── The completed checklist as a document ───────────────────────────────────

const RESULT_MARK = { c: 'C', nc: 'N/C', na: 'N/A' };

router.get('/:id/pdf', (req, res) => {
  const db = getDb();
  const a = db.prepare('SELECT * FROM internal_audits WHERE id = ?').get(req.params.id);
  if (!a) return res.status(404).json({ error: 'Not found' });
  const items = itemsFor(db, a.id);

  const doc = new PDFDocument({ size: 'LETTER', margin: 48 });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="internal-audit-${a.audit_no || a.id}.pdf"`);
  doc.pipe(res);

  doc.font('Helvetica-Bold').fontSize(14).text('Internal Audit Checklist', { align: 'center' });
  doc.font('Helvetica').fontSize(9).fillColor('#555')
    .text(`${a.checklist_code}  ·  Revision ${a.checklist_revision}  ·  ${a.audit_no || ''}`, { align: 'center' });
  doc.fillColor('#000').moveDown(0.8);
  doc.fontSize(10).text(`Audit date: ${a.audit_date}`);
  doc.text(`Focus area(s): ${a.focus_areas || '—'}`);
  doc.text(`Lead auditor: ${a.lead_auditor || '—'}`);
  doc.moveDown(0.5);
  doc.fontSize(9).fillColor('#555')
    .text('For each procedure identify as compliant or not compliant. Sections not listed were not in scope for this audit.')
    .fillColor('#000');

  let currentSection = null;
  for (const it of items) {
    if (it.section !== currentSection) {
      currentSection = it.section;
      doc.moveDown(0.6).font('Helvetica-Bold').fontSize(10.5)
        .text(sectionById(it.section)?.title || it.section).font('Helvetica').fontSize(9.5);
    }
    if (doc.y > 700) doc.addPage();
    const mark = RESULT_MARK[it.result] || '—';
    doc.text(`[${mark}]  ${it.prompt}`, { indent: 4 });
    const notes = [];
    if (it.comments) notes.push(it.comments);
    if (it.capa_number) notes.push(`CAR ${it.capa_number} — ${it.capa_status}`);
    if (notes.length) doc.fillColor('#555').fontSize(8.5).text(notes.join('  ·  '), { indent: 22 }).fillColor('#000').fontSize(9.5);
  }

  if (a.summary) {
    doc.moveDown(0.8).font('Helvetica-Bold').fontSize(10).text('Summary').font('Helvetica').fontSize(9.5).text(a.summary);
  }

  doc.moveDown(1.2).fontSize(10);
  doc.text(`Lead Auditor Name: ${a.lead_auditor || ''}`);
  doc.text(`Auditor Signature: ${a.signed_by ? `${a.signed_by} (electronic)` : ''}`);
  doc.text(`Date of Internal Audit Completion: ${a.completed_at || ''}`);
  doc.moveDown(0.6).fontSize(8.5).fillColor('#555');
  if (a.status !== 'completed') doc.text('DRAFT — this audit has not been signed off.');
  doc.text('Uncontrolled when printed — verify against ReadyDoc.');
  doc.end();
});

export default router;
