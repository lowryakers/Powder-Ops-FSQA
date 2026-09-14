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
import { canEditAny } from '../module-access.js';
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
  // The Forms tab lives in the Controlled Documents hub, which the nav opens
  // for anyone holding any of its three document modules — so edit on any of
  // them is the grant. (The branch this replaces checked a 'form-registry'
  // grant that is not a module and could never be given — a dead door.)
  return canEditAny(user, ['sops', 'work-instructions', 'job-descriptions']);
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
      // A retired number says what replaced it. Without this a record filed
      // under the old number resolves to a row that reads "retired" and stops
      // — which is the question somebody holding that record is asking.
      superseded_by: r.superseded_by || null,
      superseded_at: r.superseded_at || null,
      superseded_by_whom: r.superseded_by_whom || null,
      supersede_reason: r.supersede_reason || null,
    };
  });
}

/**
 * A FORM NUMBER LIVES IN THREE PLACES, and this reports where they disagree.
 *
 *   1. `qms-config.js` `formCode` — the number PRINTED on the record form.
 *      Gated by controlled.js: it cannot move without Document Control
 *      approving the change, which is right and is not negotiable here.
 *   2. `shared/form-registry.js` — the matching table that decides which number
 *      is stamped on a task or an inspection record. Also code, also not
 *      editable in a settings screen, for the same reason.
 *   3. `controlled_forms` — the register Document Control actually maintains.
 *
 * The first cut of this compared 1 against 2 — TWO CODE FILES — and labelled
 * one of them "the index", which is the word everybody uses for the register.
 * So Document Control read "the index says FORM 408-1", corrected the register,
 * and the warning did not move: nothing they can reach was ever being compared.
 * Naming which of the three is the outlier is the whole value of this report.
 */
function qmsDisagreements() {
  const db = getDb();
  const norm = s => String(s || '').toUpperCase().replace(/[\s-]/g, '');
  const registerRows = (() => {
    try { return db.prepare('SELECT code, where_used FROM controlled_forms').all(); }
    catch { return []; }
  })();
  const inRegister = (code) => registerRows.find(r => norm(r.code) === norm(code));

  const out = [];
  for (const type of Object.keys(QMS_TYPES)) {
    const cfg = getType(type);
    if (!cfg?.formCode) continue;
    const entry = formFor({ qmsType: type });
    const inApp = cfg.formCode;
    const inCode = entry?.code || null;
    // The register's own spelling of whichever number the app is printing.
    const appRow = inRegister(inApp);
    const codeRow = inCode ? inRegister(inCode) : null;

    const spellings = [...new Set([inApp, inCode].filter(Boolean).map(norm))];
    const codeAgrees = spellings.length < 2;
    // Live means: the app prints a number the register carries and has not
    // retired. That is the only state with nothing to settle.
    const appLive = appRow && appRow.where_used !== 'retired';
    if (codeAgrees && appLive) continue;

    out.push({
      record_type: type,
      label: cfg.label,
      in_app: inApp,
      in_code_registry: inCode,
      in_register: appRow ? appRow.code : (codeRow ? codeRow.code : null),
      register_state: appRow ? appRow.where_used : (codeRow ? codeRow.where_used : 'absent'),
    });
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

/* ── Changing a number, the way Document Control does it on paper ─────────── */

/**
 * ISSUE THE NEW NUMBER AND SUPERSEDE THE OLD ONE, as ONE act.
 *
 * `PUT` has always refused to rename a form number, and that refusal is right:
 * the code IS the identity and renaming it orphans every record filed under it.
 * But the refusal named the remedy in prose and offered no way to carry it out,
 * so the one screen where the problem is visible was a dead end — Document
 * Control read "issue the new number and retire this one", and then had to do
 * two things on two screens and remember the second.
 *
 * Doing it in two steps also loses the link. A number retired by hand says
 * "retired" and nothing else; the paper index says "superseded by FORM 408-01",
 * which is the line that keeps a two-year-old record resolvable.
 *
 * So: one transaction. The new row carries the old row's facts, INCLUDING the
 * finalised paper copy — by REFERENCE, never a second upload (the forwarded
 * attachment rule), so both numbers show the same document and deleting one
 * cannot take the other's file with it.
 */
router.post('/:id/renumber', (req, res) => {
  if (!requireEdit(req, res)) return;
  const db = getDb();
  const from = db.prepare('SELECT * FROM controlled_forms WHERE id = ?').get(req.params.id);
  if (!from) return res.status(404).json({ error: 'Form not found.' });

  const code = String(req.body?.code || '').trim();
  const reason = String(req.body?.reason || '').trim();
  if (!code) return res.status(400).json({ error: 'Give the number this form is being reissued as.' });
  if (code === from.code) return res.status(400).json({ error: `${code} is the number it already has.` });
  // A reason, because this is a change to a controlled register and "why" is
  // what an auditor asks. Same floor as every other reasoned act here.
  if (reason.length < 3) return res.status(400).json({ error: 'Say why the number is changing.' });
  // Already superseded once. Renumbering a number that is itself retired would
  // build a chain nobody can read — correct the live number instead.
  if (from.where_used === 'retired') {
    return res.status(400).json({
      error: from.superseded_by
        ? `${from.code} is retired and already superseded by ${from.superseded_by}. Renumber ${from.superseded_by} instead.`
        : `${from.code} is retired. A retired number is not reissued under a new one.`,
    });
  }
  const clash = db.prepare('SELECT code, where_used FROM controlled_forms WHERE code = ?').get(code);
  if (clash) {
    return res.status(409).json({
      error: clash.where_used === 'retired'
        ? `${code} exists and is retired. A retired number is never reissued — pick the next free number.`
        : `${code} is already in the register. If it is the same form twice, retire one of them instead.`,
    });
  }

  const id = uuid();
  const by = req.user?.name || 'system';
  db.transaction(() => {
    db.prepare(`
      INSERT INTO controlled_forms
        (id, code, revision, title, where_used, note, owner, effective_date,
         storage_key, filename, content_type, size, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, code, from.revision, from.title, from.where_used, from.note, from.owner,
      from.effective_date, from.storage_key, from.filename, from.content_type, from.size, by);
    db.prepare(`
      UPDATE controlled_forms SET where_used = 'retired', superseded_by = ?, superseded_at = datetime('now'),
        superseded_by_whom = ?, supersede_reason = ?, updated_at = datetime('now'), updated_by = ?
      WHERE id = ?
    `).run(code, by, reason, by, from.id);
  })();

  // Audited as two entries because they are two facts about two numbers, and
  // somebody looking up either one must find it.
  logAudit(req.user, 'create', 'controlled_form', id,
    `Issued ${code} — ${from.title}, replacing ${from.code}: ${reason}`, null, { code, replaces: from.code }, code);
  logAudit(req.user, 'update', 'controlled_form', from.id,
    `Retired ${from.code}, superseded by ${code}: ${reason}`, from, { where: 'retired', superseded_by: code }, from.code);

  res.status(201).json({
    ok: true, id, code, retired: from.code,
    // Named, not silently done: the number printed on a record form lives in
    // code and is gated by controlled.js. The register moving does not move it.
    note: FORM_REGISTRY.some(f => f.match && f.code === from.code)
      ? `${from.code} is wired to live tasks and records in the app. That half is a controlled change and has NOT moved — raise it with the app before ${code} starts printing.`
      : null,
  });
});

/* ── What is still inconsistent about the numbering ───────────────────────── */

// The series a number belongs to, and how it is written. `FORM 108-03` is
// series 108 in PADDED style; `FORM 108-1` is series 108 in BARE style. A
// series written both ways is the thing the index cannot be read consistently
// against, and it is derivable from the register alone.
function numberParts(code) {
  const m = /^(?:FORM\s+)?(\d{3})-(\d{1,3})\b/i.exec(String(code || '').trim());
  if (!m) return null;
  return { series: m[1], item: m[2], style: m[2].length > 1 && m[2].startsWith('0') ? 'padded' : 'bare' };
}

/**
 * The numbering worklist — DERIVED on every read, never stored.
 *
 * Two kinds, and both clear themselves the moment the register is put right,
 * which is why there is no stored to-do list: one would go stale the first time
 * somebody acted on it and then disagree with the screen it is printed on.
 *
 *   `qms_mismatch` — a record form's number in the app disagrees with the index.
 *   `style_mixed`  — one series is written two ways in the register.
 *
 * A third answer exists and is NOT derivable: "we looked, and it is correct as
 * it stands". That is `form_numbering_decisions` — a reason and a name, the
 * same shape as a dismissed coverage gap.
 */
function numberingWork(db) {
  const norm = s => String(s || '').toUpperCase().replace(/[\s-]/g, '');
  const decided = (() => {
    try {
      return new Map(db.prepare('SELECT * FROM form_numbering_decisions').all()
        .map(d => [`${d.kind}:${d.subject}`, d]));
    } catch { return new Map(); }
  })();
  const rows = db.prepare("SELECT * FROM controlled_forms WHERE where_used != 'retired' ORDER BY code").all();
  const items = [];

  for (const d of qmsDisagreements()) {
    // WHICH OF THE THREE IS THE OUTLIER decides what the instruction says, and
    // whether this screen can do anything about it at all. Offering a button
    // for the half that is a controlled change would be a lie.
    const codeSplit = d.in_code_registry && d.in_code_registry !== d.in_app;
    const evidence = [
      `The record form in the app prints ${d.in_app}.`,
      codeSplit ? `The matching table in the app says ${d.in_code_registry}.` : null,
      d.register_state === 'absent'
        ? 'The register below does not carry that number at all.'
        : d.register_state === 'retired'
          ? `The register below has ${d.in_register} RETIRED.`
          : `The register below carries ${d.in_register}.`,
    ].filter(Boolean).join(' ');

    const action = d.register_state === 'absent'
      ? `Issue ${d.in_app} in the register below if that is the correct number, or — if the app is printing the wrong one — raise it in Controlled Changes. The number printed on a filed record cannot move without Document Control approving it.`
      : d.register_state === 'retired'
        ? `The app is printing a number the register has retired. Either put the register right, or raise the app's number in Controlled Changes — it cannot move on its own.`
        : `Decide which number is correct. The register half you can change here (reissue the number below). The app half is a controlled change and goes through Controlled Changes — nothing on this screen moves it.`;

    items.push({
      kind: 'qms_mismatch',
      subject: d.record_type,
      title: `${d.label} — one form, more than one number`,
      evidence,
      action,
      // OFFERED ONLY WHEN THE REGISTER IS THE OUTLIER. Once the register
      // carries the number the app prints, there is nothing left here to
      // reissue — what remains is the matching table, which is code and a
      // controlled change. A button on a row that is already correct is how
      // somebody reissues a number that did not need reissuing.
      can_renumber: d.register_state !== 'absent'
        && d.register_state !== 'retired'
        && norm(d.in_register) !== norm(d.in_app)
        ? d.in_register : null,
      detail: d,
    });
  }

  const bySeries = new Map();
  for (const r of rows) {
    const p = numberParts(r.code);
    if (!p) continue;
    if (!bySeries.has(p.series)) bySeries.set(p.series, []);
    bySeries.get(p.series).push({ code: r.code, ...p });
  }
  for (const [series, members] of [...bySeries.entries()].sort()) {
    const styles = new Set(members.map(m => m.style));
    if (styles.size < 2) continue;
    const padded = members.filter(m => m.style === 'padded').map(m => m.code);
    const bare = members.filter(m => m.style === 'bare').map(m => m.code);
    items.push({
      kind: 'style_mixed',
      subject: series,
      title: `Series ${series} is written two ways`,
      evidence: `Padded: ${padded.join(', ')}. Bare: ${bare.join(', ')}.`,
      action: `Rule one style for series ${series}. Renumber the odd ones out below, or rule it as it stands if both spellings are already on filed records.`,
      can_renumber: null,
      detail: { series, padded, bare },
    });
  }

  return items.map(i => {
    const d = decided.get(`${i.kind}:${i.subject}`);
    return { ...i, ruled: !!d, ruled_reason: d?.reason || null, ruled_by: d?.created_by || null, ruled_at: d?.created_at || null };
  });
}

// GET /api/forms/numbering — declared BEFORE /:id, or Express reads
// "numbering" as a form id.
router.get('/numbering', (req, res) => {
  const db = getDb();
  const items = (() => {
    try { return numberingWork(db); } catch (e) {
      console.error('[forms] numbering worklist failed:', e.message);
      return null;
    }
  })();
  if (!items) return res.status(500).json({ error: 'The numbering worklist could not be built.' });
  const open = items.filter(i => !i.ruled);
  res.json({
    items,
    // Counted from the rows returned, never a second query — a progress line
    // that disagrees with the list under it is worse than no progress line.
    total: items.length,
    open: open.length,
    ruled: items.length - open.length,
    can_edit: canEditForms(req.user),
  });
});

// Rule a conflict as correct where it stands. A reason and a name, because
// "both spellings are on filed records and this one is right" is an answer an
// auditor accepts and a silently hidden row is not.
router.post('/numbering/rule', (req, res) => {
  if (!requireEdit(req, res)) return;
  const kind = String(req.body?.kind || '').trim();
  const subject = String(req.body?.subject || '').trim();
  const reason = String(req.body?.reason || '').trim();
  if (!kind || !subject) return res.status(400).json({ error: 'kind and subject are required.' });
  if (reason.length < 3) return res.status(400).json({ error: 'Say why this numbering is correct as it stands.' });
  getDb().prepare(`INSERT INTO form_numbering_decisions (id, kind, subject, decision, reason, created_by)
    VALUES (?, ?, ?, 'ruled', ?, ?)
    ON CONFLICT(kind, subject) DO UPDATE SET reason = excluded.reason,
      created_by = excluded.created_by, created_at = datetime('now')`)
    .run(uuid(), kind, subject, reason, req.user?.name || 'system');
  logAudit(req.user, 'update', 'form_numbering', `${kind}:${subject}`, `Ruled as correct: ${reason}`);
  res.json({ ok: true });
});

router.post('/numbering/reopen', (req, res) => {
  if (!requireEdit(req, res)) return;
  const { kind, subject } = req.body || {};
  getDb().prepare('DELETE FROM form_numbering_decisions WHERE kind = ? AND subject = ?')
    .run(String(kind || ''), String(subject || ''));
  logAudit(req.user, 'update', 'form_numbering', `${kind}:${subject}`, 'Put back on the numbering list');
  res.json({ ok: true });
});

/**
 * Purge a stored object only when NO row still references it.
 *
 * A renumbered form carries the finalised paper over BY REFERENCE, so two
 * numbers legitimately point at one object — and deleting the file from either
 * one used to take the other's document with it, silently. Same refcount rule
 * as a forwarded comms attachment and a shared equipment manual: clear the
 * rows first, then ask whether the key is still spoken for.
 */
async function purgeFormObject(db, key, exceptId) {
  if (!key) return;
  const stillUsed = db.prepare(
    'SELECT 1 FROM controlled_forms WHERE storage_key = ? AND id IS NOT ?').get(key, exceptId ?? null);
  if (stillUsed) return;
  try { await deleteObject(key); } catch { /* the row is the record */ }
}

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
    if (old && old !== key) await purgeFormObject(db, old, req.params.id);
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
  // The row clears FIRST, then the object is purged only if nothing else
  // points at it — a renumbered form shares its predecessor's paper copy.
  db.prepare(`UPDATE controlled_forms SET storage_key = NULL, filename = NULL, content_type = NULL,
    size = NULL, updated_at = datetime('now'), updated_by = ? WHERE id = ?`)
    .run(req.user?.name || 'system', req.params.id);
  await purgeFormObject(db, form.storage_key, null);
  logAudit(req.user, 'update', 'controlled_form', req.params.id, `Removed the file from ${form.code}`, null, null, form.code);
  res.json({ ok: true });
});

export default router;
