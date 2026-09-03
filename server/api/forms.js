// THE FORMS MASTER INDEX, as a register Document Control maintains.
//
// It began as a read-only code file. That was right for getting form numbers
// onto tasks quickly and wrong as a permanent home: Document Control issues
// revisions, retires numbers and holds the finalised paper, and none of that
// should need a deploy. The register lives in `controlled_forms` now.
//
// WHAT IS EDITABLE AND WHAT IS NOT — the important line in this file.
//
//   Editable here: revision, title, where the form is worked, the note, the
//   owner, the effective date, and the finalised paper copy attached to it.
//   These are the facts Document Control owns.
//
//   NOT editable, and deliberately still in code: how a form is MATCHED to a
//   task or a record. Those patterns decide which number gets printed on a
//   compliance record. A mistyped pattern in a settings screen would put the
//   wrong form number on every brittle-plastic inspection silently, and the
//   first person to notice would be an auditor. `shared/form-registry.js`
//   supplies the matching; this table supplies the facts.
//
// The coverage report stays, because it answers the thing a spreadsheet cannot:
// WHICH LIVE TASKS AND RECORDS CARRY NO FORM NUMBER.

import { Router } from 'express';
import { v4 as uuid } from 'uuid';
import { getDb, logAudit } from '../db.js';
import { moduleLevel } from '../module-access.js';
import { formFor, FORM_REGISTRY } from '../../shared/form-registry.js';
import { SCALE_FORMS } from '../scale-forms.js';
import { getType, QMS_TYPES } from '../qms-config.js';
import { storageEnabled, putStream, presignGet, deleteObject } from '../storage.js';
import { mediaUpload, rejectOversize, cleanupTemp, uploadErrorMessage } from '../media.js';
import fs from 'fs';

const router = Router();

const WHERE = ['readydoc', 'keychain', 'paper', 'retired'];

// Who may maintain the register. Document Control's own job, plus admins —
// the same rule Controlled Changes and the Doc Review Center use, so access is
// by department rather than a module grant.
function canEditForms(user) {
  if (!user) return false;
  if (user.role === 'admin') return true;
  const dept = String(user.department || '').toLowerCase();
  if (dept === 'document_control') return true;
  if (user.role === 'supervisor' && ['qa', 'document_control'].includes(dept)) return true;
  // The Forms tab lives in the document-control hub, so that hub's edit grant is the
  // grant. (The branch this replaces checked a 'form-registry' grant that is
  // not a module and could never be given — a dead door.)
  return moduleLevel(user, 'document-control') === 'edit';
}

const requireEdit = (req, res) => {
  if (canEditForms(req.user)) return true;
  res.status(403).json({ error: 'Only Document Control, QA supervisors and admins can maintain the form register.' });
  return false;
};

/**
 * The register, with the matching rules the code still owns folded back in.
 *
 * The scale forms' revision comes from scale-forms.js, which is what a check is
 * actually graded against — it is not editable here, and the row says so, or
 * the register could quote a revision the grader has moved past.
 */
function listForms(db) {
  const rows = db.prepare('SELECT * FROM controlled_forms ORDER BY code').all();
  // Which codes the code-side registry actually wires to tasks and records.
  // Shown so Document Control can tell a form that prints its number on live
  // work from one that is only listed.
  const wired = new Set(FORM_REGISTRY.filter(f => f.match).map(f => f.code));
  return rows.map(r => {
    const scale = SCALE_FORMS.find(s => `FORM ${s.code}` === r.code || s.code === r.code);
    return {
      id: r.id,
      code: r.code,
      // scale-forms.js wins for the five scale forms, always.
      revision: scale ? scale.revision : r.revision,
      revision_locked: !!scale,
      title: r.title,
      where: r.where_used,
      note: r.note,
      owner: r.owner,
      effective_date: r.effective_date,
      has_file: !!r.storage_key,
      filename: r.filename,
      size: r.size,
      is_seeded: !!r.is_seeded,
      updated_at: r.updated_at,
      updated_by: r.updated_by,
      // Display only: this form's number is printed on live tasks or records.
      wired: wired.has(r.code),
    };
  });
}

/**
 * Where the register and `qms-config.js` disagree about a number.
 *
 * Neither is silently rewritten: the in-app value is gated by controlled.js,
 * and only Document Control can say which is right.
 */
function qmsDisagreements() {
  const out = [];
  const norm = s => String(s || '').toUpperCase().replace(/[\s-]/g, '');
  for (const type of Object.keys(QMS_TYPES)) {
    const cfg = getType(type);
    if (!cfg?.formCode) continue;
    const entry = formFor({ qmsType: type });
    if (!entry) continue;
    if (norm(entry.code) !== norm(cfg.formCode)) {
      out.push({ record_type: type, label: cfg.label, in_app: cfg.formCode, in_registry: entry.code });
    }
  }
  return out;
}

// A gap someone has looked at and decided is fine. Most equipment PMs answer to
// no controlled form at all — servicing a scale is not a numbered inspection —
// so a register that lists ninety of them forever is one nobody reads. Kept as
// a row with a REASON and a name rather than a hidden flag: dismissing is a
// decision, and a decision with nobody's name on it is indistinguishable from
// an oversight six months later. Undismissing puts it straight back.
function dismissals(db) {
  try { return db.prepare('SELECT * FROM form_gap_dismissals').all(); } catch { return []; }
}

/** Live work that maps to no form number. Grouped, so it is bounded by shape. */
function coverage(db) {
  const unmapped = { schedules: [], record_areas: [] };
  const mapped = { schedules: 0, record_areas: 0 };

  const scheds = db.prepare(`
    SELECT title, task_group, COUNT(*) n FROM pm_schedules
    WHERE task_group IN ('qa','cleaning') AND is_active = 1
    GROUP BY title, task_group ORDER BY title
  `).all();
  const dismissed = new Map(dismissals(db).map(d => [`${d.kind}:${d.subject}`, d]));
  for (const s of scheds) {
    if (formFor({ taskTitle: s.title })) { mapped.schedules += 1; continue; }
    const d = dismissed.get(`schedule:${s.title}`);
    unmapped.schedules.push({
      title: s.title, task_group: s.task_group, count: s.n,
      dismissed: !!d, reason: d?.reason || null, dismissed_by: d?.created_by || null,
    });
  }

  const areas = db.prepare(`
    SELECT area, COALESCE(record_group, 'sanitation') AS record_group, COUNT(*) n FROM sanitation_records
    GROUP BY area, COALESCE(record_group, 'sanitation') ORDER BY n DESC
  `).all();
  for (const a of areas) {
    if (formFor({ sanitationArea: a.area })) { mapped.record_areas += 1; continue; }
    const d = dismissed.get(`record_area:${a.area}`);
    unmapped.record_areas.push({
      area: a.area, record_group: a.record_group, count: a.n,
      dismissed: !!d, reason: d?.reason || null, dismissed_by: d?.created_by || null,
    });
  }
  return { mapped, unmapped };
}

// GET /api/forms — the register, the coverage report and any disagreement.
router.get('/', (req, res) => {
  const db = getDb();
  let forms;
  try { forms = listForms(db); } catch (e) {
    console.error('[forms] register read failed:', e.message);
    return res.status(500).json({ error: e.message });
  }
  const payload = {
    forms,
    counts: forms.reduce((acc, f) => ({ ...acc, [f.where]: (acc[f.where] || 0) + 1 }), {}),
    can_edit: canEditForms(req.user),
    storage_enabled: storageEnabled(),
  };
  try {
    Object.assign(payload, coverage(db), { disagreements: qmsDisagreements() });
  } catch (e) {
    // The list itself never depends on those queries. A register that 500s
    // takes a Document Control screen down; a missing coverage panel does not.
    console.error('[forms] coverage failed:', e.message);
    Object.assign(payload, {
      mapped: null, unmapped: { schedules: [], record_areas: [] },
      disagreements: [], coverage_error: e.message,
    });
  }
  res.json(payload);
});

// Mark a gap as deliberate, or put it back. A reason is required, because
// "we looked and it doesn't answer to a form" is the answer an auditor wants
// and a silently hidden row cannot give it.
router.post('/gaps/dismiss', (req, res) => {
  if (!requireEdit(req, res)) return;
  const kind = ['schedule', 'record_area'].includes(req.body?.kind) ? req.body.kind : null;
  const subject = String(req.body?.subject || '').trim();
  const reason = String(req.body?.reason || '').trim();
  if (!kind || !subject) return res.status(400).json({ error: 'kind and subject are required.' });
  if (reason.length < 3) return res.status(400).json({ error: 'Say why this needs no form number.' });
  const db = getDb();
  db.prepare(`INSERT INTO form_gap_dismissals (id, kind, subject, reason, created_by)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(kind, subject) DO UPDATE SET reason = excluded.reason,
      created_by = excluded.created_by, created_at = datetime('now')`)
    .run(uuid(), kind, subject, reason, req.user?.name || 'system');
  logAudit(req.user, 'update', 'form_gap', subject, `Marked as needing no form number: ${reason}`);
  res.json({ ok: true });
});

router.post('/gaps/restore', (req, res) => {
  if (!requireEdit(req, res)) return;
  const { kind, subject } = req.body || {};
  getDb().prepare('DELETE FROM form_gap_dismissals WHERE kind = ? AND subject = ?').run(kind, String(subject || ''));
  logAudit(req.user, 'update', 'form_gap', String(subject || ''), 'Restored to the unmapped list');
  res.json({ ok: true });
});

function normalize(body) {
  const code = String(body.code || '').trim();
  const title = String(body.title || '').trim();
  const where = WHERE.includes(body.where) ? body.where : 'readydoc';
  return {
    code, title, where,
    revision: String(body.revision || '').trim() || null,
    note: String(body.note || '').trim() || null,
    owner: String(body.owner || '').trim() || null,
    effective_date: String(body.effective_date || '').trim() || null,
  };
}

// POST /api/forms — issue a form number.
router.post('/', (req, res) => {
  if (!requireEdit(req, res)) return;
  const db = getDb();
  const f = normalize(req.body);
  if (!f.code || !f.title) return res.status(400).json({ error: 'A form number and a title are both required.' });

  // The code IS the identity, and a number is never reissued — a record filed
  // under it must still resolve to the form it was filed against.
  const clash = db.prepare('SELECT code, where_used FROM controlled_forms WHERE code = ?').get(f.code);
  if (clash) {
    return res.status(409).json({
      error: clash.where_used === 'retired'
        ? `${f.code} exists and is retired. A retired number is never reissued — issue the next number instead.`
        : `${f.code} is already in the register.`,
    });
  }

  const id = uuid();
  db.prepare(`
    INSERT INTO controlled_forms (id, code, revision, title, where_used, note, owner, effective_date, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, f.code, f.revision, f.title, f.where, f.note, f.owner, f.effective_date, req.user?.name || 'system');
  logAudit(req.user, 'create', 'controlled_form', id, `Issued ${f.code} — ${f.title}`, null, f, f.code);
  res.status(201).json({ ok: true, id });
});

// PUT /api/forms/:id — correct the facts about a form.
router.put('/:id', (req, res) => {
  if (!requireEdit(req, res)) return;
  const db = getDb();
  const before = db.prepare('SELECT * FROM controlled_forms WHERE id = ?').get(req.params.id);
  if (!before) return res.status(404).json({ error: 'Form not found.' });
  const f = normalize({ ...req.body, code: req.body.code ?? before.code });
  if (!f.title) return res.status(400).json({ error: 'A title is required.' });

  // Renaming the number is renaming the identity, so it is refused rather than
  // done quietly. Issue the new number and retire the old one — which is what
  // Document Control does on paper, and it leaves both resolvable.
  if (f.code !== before.code) {
    return res.status(400).json({ error: 'A form number cannot be edited. Issue the new number and retire this one, so records filed under the old number still resolve.' });
  }

  const scale = SCALE_FORMS.find(s => `FORM ${s.code}` === before.code || s.code === before.code);
  const revision = scale ? before.revision : f.revision;

  db.prepare(`
    UPDATE controlled_forms SET revision = ?, title = ?, where_used = ?, note = ?, owner = ?,
      effective_date = ?, updated_at = datetime('now'), updated_by = ? WHERE id = ?
  `).run(revision, f.title, f.where, f.note, f.owner, f.effective_date, req.user?.name || 'system', req.params.id);
  logAudit(req.user, 'update', 'controlled_form', req.params.id, `Updated ${before.code}`, before, f, before.code);
  res.json({
    ok: true,
    ...(scale && f.revision && f.revision !== before.revision
      ? { warning: `${before.code}'s revision is set by its weights and tolerances, which are a controlled change — it was not altered here.` }
      : {}),
  });
});

// DELETE /api/forms/:id — retire, and only ever retire.
//
// A number is never removed from the index: a record filed under it must still
// resolve, and a deleted row is indistinguishable from a number that never
// existed, which is exactly the gap an auditor asks about.
router.delete('/:id', (req, res) => {
  if (!requireEdit(req, res)) return;
  const db = getDb();
  const before = db.prepare('SELECT * FROM controlled_forms WHERE id = ?').get(req.params.id);
  if (!before) return res.status(404).json({ error: 'Form not found.' });
  db.prepare(`UPDATE controlled_forms SET where_used = 'retired', updated_at = datetime('now'), updated_by = ? WHERE id = ?`)
    .run(req.user?.name || 'system', req.params.id);
  logAudit(req.user, 'update', 'controlled_form', req.params.id, `Retired ${before.code}`, before, { where: 'retired' }, before.code);
  res.json({ ok: true, retired: true });
});

/* ── The finalised paper copy ─────────────────────────────────────────────── */

const upload = mediaUpload({ files: 1 });

router.post('/:id/file', upload.array('files', 1), async (req, res) => {
  if (!requireEdit(req, res)) { cleanupTemp(req.files); return; }
  if (!storageEnabled()) { cleanupTemp(req.files); return res.status(503).json({ error: 'File storage is not configured.' }); }
  const db = getDb();
  const form = db.prepare('SELECT * FROM controlled_forms WHERE id = ?').get(req.params.id);
  if (!form) { cleanupTemp(req.files); return res.status(404).json({ error: 'Form not found.' }); }
  const file = (req.files || [])[0];
  if (!file) return res.status(400).json({ error: 'No file was uploaded.' });

  const tooBig = rejectOversize(req.files);
  if (tooBig) { cleanupTemp(req.files); return res.status(400).json({ error: tooBig }); }

  try {
    const key = `forms/${form.code.replace(/[^A-Za-z0-9-]+/g, '_')}/${uuid()}-${file.originalname}`;
    await putStream(key, fs.createReadStream(file.path), file.mimetype);
    // Replacing removes the previous object rather than orphaning it in R2.
    const old = form.storage_key;
    db.prepare(`UPDATE controlled_forms SET storage_key = ?, filename = ?, content_type = ?, size = ?,
      updated_at = datetime('now'), updated_by = ? WHERE id = ?`)
      .run(key, file.originalname, file.mimetype, file.size, req.user?.name || 'system', req.params.id);
    if (old && old !== key) { try { await deleteObject(old); } catch { /* the row is what matters */ } }
    logAudit(req.user, 'update', 'controlled_form', req.params.id,
      `Attached ${file.originalname} to ${form.code}`, null, null, form.code);
    res.json({ ok: true, filename: file.originalname });
  } catch (e) {
    console.error('[forms] upload failed:', e);
    res.status(500).json({ error: uploadErrorMessage(e) || e.message });
  } finally {
    cleanupTemp(req.files);
  }
});

// Reading the paper is open to anyone who can see the register — it is the
// controlled form itself, which is the thing people are meant to work from.
router.get('/:id/file', async (req, res) => {
  const db = getDb();
  const form = db.prepare('SELECT * FROM controlled_forms WHERE id = ?').get(req.params.id);
  if (!form) return res.status(404).json({ error: 'Form not found.' });
  if (!form.storage_key) return res.status(404).json({ error: 'No file is attached to this form.' });
  try {
    res.json({ url: await presignGet(form.storage_key, form.filename), filename: form.filename });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.delete('/:id/file', async (req, res) => {
  if (!requireEdit(req, res)) return;
  const db = getDb();
  const form = db.prepare('SELECT * FROM controlled_forms WHERE id = ?').get(req.params.id);
  if (!form?.storage_key) return res.status(404).json({ error: 'No file is attached to this form.' });
  try { await deleteObject(form.storage_key); } catch { /* row still clears */ }
  db.prepare(`UPDATE controlled_forms SET storage_key = NULL, filename = NULL, content_type = NULL,
    size = NULL, updated_at = datetime('now'), updated_by = ? WHERE id = ?`)
    .run(req.user?.name || 'system', req.params.id);
  logAudit(req.user, 'update', 'controlled_form', req.params.id, `Removed the file from ${form.code}`, null, null, form.code);
  res.json({ ok: true });
});

export default router;
