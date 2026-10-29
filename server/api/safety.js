// Safety module: crisis contacts (FORM 501-01), evacuation headcounts
// (Form 501-02), first aid injury log (FORM 502-01).
//
// The contacts are a REFERENCE served from safety-forms.js — the document's
// list, never the roster. The other two file records. Filing is deliberately
// open to any signed-in user: the person holding the clipboard at the
// evacuation site, or the supervisor at the first aid kit, is whoever was
// there, and a safety record that only a manager may start is one that gets
// written up hours later from memory. Corrections and deletes are narrower.

import { Router } from 'express';
import { randomUUID as uuid } from 'crypto';
import { getDb, logAudit } from '../db.js';
import { parseJson } from '../custom-fields.js';
import { withCurrentNames } from '../person-links.js';
import {
  SAFETY_FORMS, EVAC_REVISION, EVAC_WORK_AREAS, EVAC_REASONS, FIRST_AID_REVISION,
} from '../safety-forms.js';
import { checkImpact, cleanImpact, impactState, EXPOSED, IMPACT_SOURCE } from '../../shared/crisis-impact.js';
import {
  DRILL_TITLE, DRILL_FORM_CODE, DRILL_REVISION, DRILL_SOP, DRILL_OBJECTIVE, ACTIVITIES, SCENARIOS, INSPECTION_ITEMS, MARKS,
  HOLD_STATUS, RESULTS, REVIEWS, cleanDrill, fileErrors, missingToSign,
} from '../../shared/crisis-drill.js';
import { gateSignature, signatureEvidence } from '../signature.js';
import { plantDateOf } from '../plant-clock.js';

const router = Router();

// Assessing what an evacuation did to product is QA's call (SQF 2.6.4.2), not
// whoever held the clipboard.
const canAssess = (u) => u?.role === 'admin' || u?.role === 'supervisor'
  || ['qa', 'quality'].includes((u?.department || '').toLowerCase());

// The crisis drill (D-265): Document Control runs it (Daniela conducted the
// 21 Oct drill), so filing is the correcting departments plus DC. QA signs the
// QA / SQF Practitioner line; a manager signs the Management line.
const dept = (u) => (u?.department || '').toLowerCase();
const canFileDrill = (u) => u?.role === 'admin' || u?.role === 'supervisor'
  || ['qa', 'quality', 'office', 'hr', 'document_control'].includes(dept(u));
const canSignQa = (u) => u?.role === 'admin' || ['qa', 'quality'].includes(dept(u));
// The Management line (D-266): admins, plus the accounts named in
// app_settings.crisis_drill_management_signers — an account id list, never a
// name test. Unset, it is filled ONCE from the active account called "Adam
// Bliss" (Lowry's decision, 29 Oct 2026); none or two such accounts leaves it
// empty and only admins sign. An admin changes it on Safety → Crisis Drills.
const MGMT_KEY = 'crisis_drill_management_signers';
function mgmtSignerIds(db) {
  const row = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(MGMT_KEY);
  if (row) return parseJson(row.value, []) || [];
  const adam = db.prepare("SELECT id FROM users WHERE LOWER(TRIM(name)) = 'adam bliss' AND is_active = 1").all();
  const ids = adam.length === 1 ? [adam[0].id] : [];
  if (db.prepare('SELECT COUNT(*) n FROM users').get().n > 0) {
    db.prepare('INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO NOTHING').run(MGMT_KEY, JSON.stringify(ids));
  }
  return ids;
}
const canSignMgmt = (u) => u?.role === 'admin' || (!!u?.id && mgmtSignerIds(getDb()).includes(u.id));
const mgmtSigners = (db) => {
  const ids = mgmtSignerIds(db);
  if (!ids.length) return [];
  return db.prepare(`SELECT id, name FROM users WHERE id IN (${ids.map(() => '?').join(',')})`).all(...ids);
};

const canCorrect = (u) => u?.role === 'admin' || u?.role === 'supervisor'
  || ['qa', 'quality', 'office', 'hr'].includes((u?.department || '').toLowerCase());

// The three forms, verbatim. Everything the panel renders comes from here.
router.get('/forms', (req, res) => res.json({
  ...SAFETY_FORMS,
  drill: {
    title: DRILL_TITLE, form_code: DRILL_FORM_CODE, revision: DRILL_REVISION, sop: DRILL_SOP, objective: DRILL_OBJECTIVE,
    activities: ACTIVITIES, scenarios: SCENARIOS, inspection_items: INSPECTION_ITEMS, marks: MARKS,
    hold_status: HOLD_STATUS, results: RESULTS, reviews: REVIEWS,
    can_file: canFileDrill(req.user), can_sign_qa: canSignQa(req.user), can_sign_management: canSignMgmt(req.user), management_signers: mgmtSigners(getDb()),
  },
  impact: { source: IMPACT_SOURCE, exposed: EXPOSED, can_assess: canAssess(req.user) },
}));

// ── Evacuation headcounts ───────────────────────────────────────────────────

// "Circle ANY Evacuation reason" — the paper says any, and the plant means it:
// the April sheets have both F and N circled on every row, because one
// evacuation covered a fire drill and an earthquake drill at the same time.
// Storing a single code would have kept the F and silently dropped the N, so a
// record of an earthquake drill would read as a record of a fire drill.
const normalizeReasons = (a) => {
  const raw = Array.isArray(a?.reasons) ? a.reasons : (a?.reason ? [a.reason] : []);
  const seen = [];
  for (const r of raw) {
    const code = String(r || '').toUpperCase();
    // A code the form does not print is dropped rather than stored as a reason
    // the paper cannot show.
    if (EVAC_REASONS[code] && !seen.includes(code)) seen.push(code);
  }
  return seen;
};

const normalizeAreas = (input) => {
  if (!Array.isArray(input)) return [];
  return input.map(a => ({
    area: String(a?.area || '').slice(0, 60),
    total: Number.isFinite(Number(a?.total)) && a?.total !== '' && a?.total !== null ? Number(a.total) : null,
    accounted: Number.isFinite(Number(a?.accounted)) && a?.accounted !== '' && a?.accounted !== null ? Number(a.accounted) : null,
    reasons: normalizeReasons(a),
  })).filter(a => a.area);
};

const shapeEvac = (r) => {
  const stored = parseJson(r.areas, []) || [];
  // Rows filed before reasons could be plural carry a single `reason`; they are
  // upgraded on READ rather than migrated, so nothing rewrites a filed safety
  // record. `reason` is still returned as the first code for any older caller.
  const areas = stored.map(a => {
    const reasons = Array.isArray(a.reasons) ? a.reasons : (a.reason ? [a.reason] : []);
    return { ...a, reasons, reason: reasons[0] || null };
  });
  return {
    ...r,
    areas,
    // Derived on read, never stored — correct a row and the totals move.
    total_in_areas: areas.reduce((s, a) => s + (a.total || 0), 0),
    total_accounted: areas.reduce((s, a) => s + (a.accounted || 0), 0),
    // The one number that matters at an evacuation site.
    unaccounted: areas.reduce((s, a) => s + Math.max(0, (a.total || 0) - (a.accounted || 0)), 0),
    impact: parseJson(r.impact, null),
    impact_state: impactState(r),
  };
};

router.get('/evacuations', (req, res) => {
  const db = getDb();
  const limit = Math.min(Number(req.query.limit) || 200, 500);
  res.json(db.prepare('SELECT * FROM evacuation_headcounts ORDER BY event_date DESC, created_at DESC LIMIT ?')
    .all(limit).map(shapeEvac));
});

router.post('/evacuations', (req, res) => {
  const db = getDb();
  const { event_date, event_time, is_drill, areas, notes, completed_by, impact } = req.body || {};
  if (!event_date) return res.status(400).json({ error: 'The evacuation needs its date.' });
  // An impact assessment offered with the sheet is checked first and is QA's
  // to give; refused out loud rather than dropped, or it looks saved.
  if (impact) {
    if (!canAssess(req.user)) return res.status(403).json({ error: 'The product and material impact is recorded by QA, a supervisor or an admin. File the headcount and they will add it.' });
    const errs = checkImpact(impact);
    if (errs.length) return res.status(400).json({ error: errs.join(' '), errors: errs });
  }
  const id = uuid();
  // A blank sheet starts with the form's own work areas so the person at the
  // evacuation site fills rows in rather than remembering which teams exist.
  const rows = normalizeAreas(areas?.length ? areas : EVAC_WORK_AREAS.map(a => ({ area: a })));
  db.prepare(`INSERT INTO evacuation_headcounts
    (id, form_revision, event_date, event_time, is_drill, areas, notes, completed_by, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    id, EVAC_REVISION, event_date, event_time || null, is_drill === false || is_drill === 0 ? 0 : 1,
    JSON.stringify(rows), notes || null, completed_by || req.user.name, req.user.name);
  if (impact) {
    db.prepare("UPDATE evacuation_headcounts SET impact = ?, impact_by = ?, impact_at = datetime('now') WHERE id = ?")
      .run(JSON.stringify(cleanImpact(impact)), req.user.name, id);
  }
  const row = db.prepare('SELECT * FROM evacuation_headcounts WHERE id = ?').get(id);
  logAudit(req.user, 'evacuation_filed', 'evacuation_headcount', id,
    { event_date, is_drill: !!(is_drill ?? true) }, null, row, `Evacuation ${event_date}`);
  res.status(201).json(shapeEvac(row));
});

router.put('/evacuations/:id', (req, res) => {
  const db = getDb();
  const row = db.prepare('SELECT * FROM evacuation_headcounts WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  // The filer may keep working their own sheet; anyone else needs the ladder.
  if (row.created_by !== req.user.name && !canCorrect(req.user)) {
    return res.status(403).json({ error: 'Correcting someone else\'s record needs a supervisor, QA or the office.' });
  }
  const { event_date, event_time, is_drill, areas, notes, completed_by } = req.body || {};
  db.prepare(`UPDATE evacuation_headcounts SET
    event_date = COALESCE(?, event_date), event_time = COALESCE(?, event_time),
    is_drill = COALESCE(?, is_drill), areas = COALESCE(?, areas),
    notes = COALESCE(?, notes), completed_by = COALESCE(?, completed_by),
    updated_at = datetime('now') WHERE id = ?`).run(
    event_date || null, event_time || null,
    is_drill === undefined ? null : (is_drill ? 1 : 0),
    areas === undefined ? null : JSON.stringify(normalizeAreas(areas)),
    notes === undefined ? null : notes, completed_by || null, row.id);
  const updated = db.prepare('SELECT * FROM evacuation_headcounts WHERE id = ?').get(row.id);
  logAudit(req.user, 'evacuation_updated', 'evacuation_headcount', row.id, {}, row, updated,
    `Evacuation ${updated.event_date}`);
  res.json(shapeEvac(updated));
});

// Record (or correct) the product and material impact of one evacuation. Dated
// when it is written, never when the evacuation happened — one written later
// reads as an addendum (shared/crisis-impact.js).
router.post('/evacuations/:id/impact', (req, res) => {
  if (!canAssess(req.user)) return res.status(403).json({ error: 'The product and material impact is recorded by QA, a supervisor or an admin.' });
  const db = getDb();
  const row = db.prepare('SELECT * FROM evacuation_headcounts WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  const errs = checkImpact(req.body);
  if (errs.length) return res.status(400).json({ error: errs.join(' '), errors: errs });
  db.prepare("UPDATE evacuation_headcounts SET impact = ?, impact_by = ?, impact_at = datetime('now'), updated_at = datetime('now') WHERE id = ?")
    .run(JSON.stringify(cleanImpact(req.body)), req.user.name, row.id);
  const updated = db.prepare('SELECT * FROM evacuation_headcounts WHERE id = ?').get(row.id);
  logAudit(req.user, row.impact ? 'evacuation_impact_corrected' : 'evacuation_impact_recorded', 'evacuation_headcount', row.id,
    { product_exposed: req.body.product_exposed, addendum: impactState(updated) === 'addendum' }, row, updated,
    `Evacuation ${row.event_date}`);
  res.json(shapeEvac(updated));
});

router.delete('/evacuations/:id', (req, res) => {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Only an admin can delete an evacuation record.' });
  const db = getDb();
  const row = db.prepare('SELECT * FROM evacuation_headcounts WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  db.prepare('DELETE FROM evacuation_headcounts WHERE id = ?').run(row.id);
  logAudit(req.user, 'evacuation_deleted', 'evacuation_headcount', row.id, {}, row, null,
    `Evacuation ${row.event_date}`);
  res.json({ ok: true });
});

// ── First aid injuries ──────────────────────────────────────────────────────

router.get('/first-aid', (req, res) => {
  const db = getDb();
  const limit = Math.min(Number(req.query.limit) || 200, 500);
  const { q } = req.query;
  let sql = 'SELECT * FROM first_aid_injuries WHERE 1=1';
  const params = [];
  if (q && String(q).trim()) {
    sql += ' AND (employee_name LIKE ? OR employee_user_id IN (SELECT id FROM users WHERE name LIKE ?) OR injury_description LIKE ? OR explanation LIKE ?)';
    const like = `%${q}%`;
    params.push(like, like, like, like);
  }
  sql += ' ORDER BY injury_date DESC, created_at DESC LIMIT ?';
  params.push(limit);
  // The account's current name where one is linked; what was filed travels as
  // employee_name_renamed_from.
  res.json(withCurrentNames(db, db.prepare(sql).all(...params), { idCol: 'employee_user_id', nameCol: 'employee_name' }));
});

router.post('/first-aid', (req, res) => {
  const db = getDb();
  const { employee_name, injury_date, injury_description, explanation, supervisor_name, supervisor_date } = req.body || {};
  if (!employee_name || !injury_date) {
    return res.status(400).json({ error: 'The employee\'s name and the date of injury are required.' });
  }
  const id = uuid();
  db.prepare(`INSERT INTO first_aid_injuries
    (id, form_revision, employee_name, injury_date, injury_description, explanation, supervisor_name, supervisor_date, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    id, FIRST_AID_REVISION, employee_name, injury_date, injury_description || null,
    explanation || null, supervisor_name || null, supervisor_date || null, req.user.name);
  const row = db.prepare('SELECT * FROM first_aid_injuries WHERE id = ?').get(id);
  logAudit(req.user, 'first_aid_filed', 'first_aid_injury', id,
    { employee_name, injury_date }, null, row, `${employee_name} · ${injury_date}`);
  res.status(201).json(row);
});

router.put('/first-aid/:id', (req, res) => {
  const db = getDb();
  const row = db.prepare('SELECT * FROM first_aid_injuries WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  if (row.created_by !== req.user.name && !canCorrect(req.user)) {
    return res.status(403).json({ error: 'Correcting someone else\'s record needs a supervisor, QA or the office.' });
  }
  const cols = ['employee_name', 'injury_date', 'injury_description', 'explanation', 'supervisor_name', 'supervisor_date'];
  const patch = {};
  for (const c of cols) if (req.body?.[c] !== undefined) patch[c] = req.body[c] === '' ? null : req.body[c];
  if (Object.keys(patch).length) {
    db.prepare(`UPDATE first_aid_injuries SET ${Object.keys(patch).map(c => `${c} = ?`).join(', ')},
      updated_at = datetime('now') WHERE id = ?`).run(...Object.values(patch), row.id);
  }
  const updated = db.prepare('SELECT * FROM first_aid_injuries WHERE id = ?').get(row.id);
  logAudit(req.user, 'first_aid_updated', 'first_aid_injury', row.id, { fields: Object.keys(patch) },
    row, updated, `${updated.employee_name} · ${updated.injury_date}`);
  res.json(updated);
});

router.delete('/first-aid/:id', (req, res) => {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Only an admin can delete an injury record.' });
  const db = getDb();
  const row = db.prepare('SELECT * FROM first_aid_injuries WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  db.prepare('DELETE FROM first_aid_injuries WHERE id = ?').run(row.id);
  logAudit(req.user, 'first_aid_deleted', 'first_aid_injury', row.id, {}, row, null,
    `${row.employee_name} · ${row.injury_date}`);
  res.json({ ok: true });
});

// ── Crisis Management Drill and Product Integrity Inspection (D-265) ───────

const shapeDrill = (r) => {
  const d = parseJson(r.data, {}) || {};
  const missing = missingToSign(d);
  return {
    id: r.id, form_revision: r.form_revision, drill_date: r.drill_date, result: r.result, evacuation_id: r.evacuation_id,
    ...d,
    qa_signed_by: r.qa_signed_by, qa_signed_at: r.qa_signed_at,
    mgmt_signed_by: r.mgmt_signed_by, mgmt_signed_at: r.mgmt_signed_at,
    created_by: r.created_by, created_at: r.created_at, updated_at: r.updated_at,
    missing_to_sign: missing,
    // Any review signature closes the record; the way back is to revoke it.
    signed: !!(r.qa_signed_at || r.mgmt_signed_at),
    failed_lines: INSPECTION_ITEMS.filter(it => d.inspection?.[it.key] === 'F').map(it => it.label),
  };
};

router.get('/drills', (req, res) => {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM crisis_drills ORDER BY drill_date DESC, created_at DESC LIMIT 200').all();
  res.json(rows.map(shapeDrill));
});

router.post('/drills', (req, res) => {
  if (!canFileDrill(req.user)) return res.status(403).json({ error: 'Filing a crisis drill is for QA, Document Control, office/HR, supervisors and admins.' });
  const d = cleanDrill(req.body || {});
  const errors = fileErrors(d, plantDateOf());
  if (errors.length) return res.status(400).json({ error: errors.join(' ') });
  const db = getDb();
  const id = uuid();
  db.prepare(`INSERT INTO crisis_drills (id, form_revision, drill_date, result, data, evacuation_id, created_by, created_by_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(id, DRILL_REVISION, d.drill_date, d.result, JSON.stringify(d), d.evacuation_id, req.user?.name || null, req.user?.id || null);
  logAudit(req.user, 'create', 'crisis_drill', id, { drill_date: d.drill_date, scenario: d.scenario, result: d.result }, null, d, `Crisis drill ${d.drill_date}`);
  res.status(201).json(shapeDrill(db.prepare('SELECT * FROM crisis_drills WHERE id = ?').get(id)));
});

router.put('/drills/:id', (req, res) => {
  const db = getDb();
  const row = db.prepare('SELECT * FROM crisis_drills WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  if (!canFileDrill(req.user)) return res.status(403).json({ error: 'You cannot correct this record.' });
  if (row.qa_signed_at || row.mgmt_signed_at) {
    return res.status(409).json({ error: 'This drill has been reviewed and signed. Revoke the signature first, then correct it.' });
  }
  const before = parseJson(row.data, {}) || {};
  const d = cleanDrill({ ...before, ...(req.body || {}) });
  const errors = fileErrors(d, plantDateOf());
  if (errors.length) return res.status(400).json({ error: errors.join(' ') });
  db.prepare(`UPDATE crisis_drills SET drill_date = ?, result = ?, data = ?, evacuation_id = ?, updated_at = datetime('now') WHERE id = ?`)
    .run(d.drill_date, d.result, JSON.stringify(d), d.evacuation_id, row.id);
  logAudit(req.user, 'update', 'crisis_drill', row.id, { drill_date: d.drill_date }, before, d, `Crisis drill ${d.drill_date}`);
  res.json(shapeDrill(db.prepare('SELECT * FROM crisis_drills WHERE id = ?').get(row.id)));
});

// Sign one of the two review lines, with the password (the QA-signature rule).
router.post('/drills/:id/sign/:review', (req, res) => {
  const db = getDb();
  const review = req.params.review;
  if (!REVIEWS[review]) return res.status(404).json({ error: 'Unknown review line.' });
  const row = db.prepare('SELECT * FROM crisis_drills WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  const may = review === 'qa' ? canSignQa(req.user) : canSignMgmt(req.user);
  if (!may) return res.status(403).json({ error: review === 'qa' ? 'The QA / SQF Practitioner review is signed by Quality or an admin.' : 'The Management review is signed by the named management reviewer or an admin.' });
  const col = review === 'qa' ? 'qa' : 'mgmt';
  if (row[`${col}_signed_at`]) return res.status(409).json({ error: `${REVIEWS[review]} is already signed by ${row[`${col}_signed_by`]}.` });
  const other = review === 'qa' ? row.mgmt_signed_by_id : row.qa_signed_by_id;
  if (other && other === req.user?.id) return res.status(409).json({ error: 'The two reviews are signed by two different people.' });
  const missing = missingToSign(parseJson(row.data, {}) || {});
  if (missing.length) return res.status(409).json({ error: `Finish the record before it is reviewed: ${missing.join('; ')}.`, missing });
  if (!gateSignature(req, res, { action: `crisis_drill_${review}_review` })) return;
  db.prepare(`UPDATE crisis_drills SET ${col}_signed_by = ?, ${col}_signed_by_id = ?, ${col}_signed_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`)
    .run(req.user.name, req.user.id, row.id);
  logAudit(req.user, 'sign', 'crisis_drill', row.id, { review: REVIEWS[review], ...signatureEvidence() }, null, null, `Crisis drill ${row.drill_date}`);
  res.json(shapeDrill(db.prepare('SELECT * FROM crisis_drills WHERE id = ?').get(row.id)));
});

// Revoke a review signature: the signer or an admin, with a reason.
router.delete('/drills/:id/sign/:review', (req, res) => {
  const db = getDb();
  const review = req.params.review;
  if (!REVIEWS[review]) return res.status(404).json({ error: 'Unknown review line.' });
  const row = db.prepare('SELECT * FROM crisis_drills WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  const col = review === 'qa' ? 'qa' : 'mgmt';
  if (!row[`${col}_signed_at`]) return res.status(409).json({ error: 'That review is not signed.' });
  if (req.user?.role !== 'admin' && row[`${col}_signed_by_id`] !== req.user?.id) return res.status(403).json({ error: 'Only the person who signed, or an admin, can revoke it.' });
  const reason = String(req.body?.reason || '').trim();
  if (reason.length < 3) return res.status(400).json({ error: 'Say why the signature is being revoked.' });
  db.prepare(`UPDATE crisis_drills SET ${col}_signed_by = NULL, ${col}_signed_by_id = NULL, ${col}_signed_at = NULL, updated_at = datetime('now') WHERE id = ?`).run(row.id);
  logAudit(req.user, 'revoke', 'crisis_drill', row.id, { review: REVIEWS[review], was_signed_by: row[`${col}_signed_by`], reason }, null, null, `Crisis drill ${row.drill_date}`);
  res.json(shapeDrill(db.prepare('SELECT * FROM crisis_drills WHERE id = ?').get(row.id)));
});

// Who signs the Management line, besides admins (D-266). Admin only to change.
router.put('/drill-signers', (req, res) => {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Only an admin can change who signs the Management review.' });
  const db = getDb();
  const ids = [...new Set((Array.isArray(req.body?.user_ids) ? req.body.user_ids : []).map(String))];
  const found = ids.length ? db.prepare(`SELECT id, name FROM users WHERE is_active = 1 AND COALESCE(is_external, 0) = 0 AND id IN (${ids.map(() => '?').join(',')})`).all(...ids) : [];
  if (found.length !== ids.length) return res.status(400).json({ error: 'Every signer must be an active employee account.' });
  const before = mgmtSigners(db).map(u => u.name);
  db.prepare('INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(MGMT_KEY, JSON.stringify(ids));
  logAudit(req.user, 'update', 'setting', MGMT_KEY, { management_review_signers: { from: before, to: found.map(u => u.name) } }, null, null, 'Crisis drill: Management review signers');
  res.json({ management_signers: found });
});

// Admin only, and never once signed — a reviewed drill is history.
router.delete('/drills/:id', (req, res) => {
  const db = getDb();
  const row = db.prepare('SELECT * FROM crisis_drills WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Only an admin can delete a drill record.' });
  if (row.qa_signed_at || row.mgmt_signed_at) return res.status(409).json({ error: 'A reviewed drill cannot be deleted.' });
  db.prepare('DELETE FROM crisis_drills WHERE id = ?').run(row.id);
  logAudit(req.user, 'delete', 'crisis_drill', row.id, { drill_date: row.drill_date }, parseJson(row.data, {}), null, `Crisis drill ${row.drill_date}`);
  res.json({ deleted: true });
});

export default router;
