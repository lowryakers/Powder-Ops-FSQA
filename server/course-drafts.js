// Course DRAFTS staged by the Quality bot, published by two people (D-278).
//
// The Quality bot (an ordinary non-admin account holding a `write` token with
// the `course-drafts` grant, D-161/D-171) stages a new version of a course:
// its content, its quiz in English and Spanish, and its files — a training
// video up to 2 GB. Nothing it stages is live.
//
// A DRAFT IS NEVER TRAINING. It lives in course_drafts / course_draft_materials
// and nothing that counts training reads those tables — the matrix, By person,
// assignment, the Operator View, the course list. A draft cannot be assigned,
// cannot be taken and cannot be completed, by construction rather than by a
// filter somebody has to remember.
//
// PUBLISHING TAKES TWO PEOPLE, EACH WITH THEIR PASSWORD (gateSignature):
//   document     — Document Control confirms the course matches its document;
//   food_safety  — a QA supervisor approves the food safety content.
// Two different people; never the account that staged it; never a bot account,
// and never through a token (the `sign` segment is the approve class, D-161).
// The second signature publishes, in the same request.
//
// An edit after a signature CLEARS the signatures — they signed different
// content — and the draft says so.
//
// Publishing writes the live course: its content, a new quiz version, the new
// files, the live files the draft takes away. When the draft was built on a
// newer revision of its document, publishing is "course updated for revision
// N" (markCourseRevision, D-277) — the one door that assigns retraining. A
// draft built on a revision the document has since moved past is refused.
import { v4 as uuid } from 'uuid';
import { logAudit } from './db.js';
import { isBotAccount } from './trainees.js';
import { deleteObject } from './storage.js';
import { isVideo } from './media.js';
import { markCourseRevision, docRevisionFor, CourseRevisionError } from './course-revision.js';
import { sameRevision, isApprovedStatus } from '../shared/document-revision.js';

export class CourseDraftError extends Error {
  constructor(message, status = 400, extra = {}) { super(message); this.status = status; this.extra = extra; }
}

export const SIGN_ROLES = Object.freeze({
  document: { label: 'Matches the document', who: 'Document Control', by: 'doc_confirmed_by', id: 'doc_confirmed_by_id', at: 'doc_confirmed_at' },
  food_safety: { label: 'Food safety content approved', who: 'Quality (QA supervisor)', by: 'fs_approved_by', id: 'fs_approved_by_id', at: 'fs_approved_at' },
});

const dept = (u) => String(u?.department || '').toLowerCase();
/** Document Control confirms a draft matches its document. */
export const canConfirmDocument = (u) => u?.role === 'admin' || dept(u) === 'document_control';
/** A QA supervisor approves the food safety content. */
export const canApproveFoodSafety = (u) => u?.role === 'admin' || (u?.role === 'supervisor' && ['qa', 'quality'].includes(dept(u)));
const CAN_SIGN = { document: canConfirmDocument, food_safety: canApproveFoodSafety };

export { isBotAccount };

const QUESTION_TYPES = ['multiple_choice', 'true_false', 'short_answer'];
const parse = (raw, fallback) => { if (raw == null) return fallback; try { return JSON.parse(raw); } catch { return fallback; } };
const text = (v, max = 4000) => (v == null ? null : String(v).trim().slice(0, max) || null);

/** Validate and normalise a quiz. Throws a CourseDraftError naming the question. */
export function normalizeQuestions(list) {
  if (!Array.isArray(list)) throw new CourseDraftError('questions must be a list.');
  if (!list.length) throw new CourseDraftError('A quiz needs at least one question. Send questions: null to keep the live quiz.');
  if (list.length > 100) throw new CourseDraftError('A quiz can have at most 100 questions.');
  return list.map((q, i) => {
    const n = i + 1;
    const type = q?.type || 'multiple_choice';
    if (!QUESTION_TYPES.includes(type)) throw new CourseDraftError(`Question ${n}: type must be one of ${QUESTION_TYPES.join(', ')}.`);
    const prompt = text(q?.prompt, 2000);
    if (!prompt) throw new CourseDraftError(`Question ${n}: the English question is required.`);
    const options = Array.isArray(q?.options) ? q.options.map(o => String(o ?? '').trim()).filter(Boolean) : [];
    if (type === 'multiple_choice' && options.length < 2) throw new CourseDraftError(`Question ${n}: a multiple-choice question needs at least two options.`);
    const optionsEs = Array.isArray(q?.options_es) ? q.options_es.map(o => String(o ?? '').trim()) : [];
    if (optionsEs.length && optionsEs.length !== options.length) {
      throw new CourseDraftError(`Question ${n}: the Spanish options must match the English ones one for one (${options.length} English, ${optionsEs.length} Spanish).`);
    }
    const correct = q?.correct_answer == null ? '' : String(q.correct_answer).trim();
    if (!correct) throw new CourseDraftError(`Question ${n}: the correct answer is required.`);
    const points = Number(q?.points ?? 1);
    return {
      type, prompt, prompt_es: text(q?.prompt_es, 2000), options, options_es: optionsEs,
      correct_answer: correct, points: Number.isFinite(points) && points > 0 ? points : 1,
    };
  });
}

const CONTENT_FIELDS = ['code', 'title', 'category', 'description', 'retrain_months', 'passing_score', 'change_note'];

function contentPatch(body) {
  const out = {};
  for (const k of CONTENT_FIELDS) {
    if (body[k] === undefined) continue;
    if (k === 'retrain_months') { const v = body[k] === '' || body[k] == null ? null : parseInt(body[k], 10); out[k] = Number.isFinite(v) && v > 0 ? v : null; continue; }
    if (k === 'passing_score') {
      if (body[k] === '' || body[k] == null) { out[k] = null; continue; }
      const v = Number(body[k]);
      if (!Number.isFinite(v) || v <= 0 || v > 100) throw new CourseDraftError('passing_score must be a number from 1 to 100.');
      out[k] = v; continue;
    }
    out[k] = text(body[k], k === 'description' ? 20000 : 500);
  }
  if (out.title === null) throw new CourseDraftError('A course needs a title.');
  return out;
}

const docFor = (db, sopId) => (sopId ? db.prepare('SELECT id, doc_number, title, revision, training_revision, status FROM sop_documents WHERE id = ?').get(sopId) : null);
const docInForce = (doc) => (doc && isApprovedStatus(doc.status) ? (doc.training_revision || doc.revision || null) : null);

/** The draft row, or throws 404. */
export function getDraft(db, id) {
  const d = db.prepare('SELECT * FROM course_drafts WHERE id = ?').get(id);
  if (!d) throw new CourseDraftError('Course draft not found.', 404);
  return d;
}

function requireOpen(d) {
  if (d.status !== 'draft') throw new CourseDraftError(`This draft is ${d.status} and can no longer be changed.`, 409);
}

const actorName = (a) => a?.name || 'ReadyDoc';

/** Stage a draft. From a live course (course_id) it starts as a copy of that course; otherwise it is a new course. */
export function createDraft(db, body, actor) {
  const viaToken = !!actor?.via_token;
  let course = null;
  if (body.course_id) {
    course = db.prepare('SELECT * FROM training_courses WHERE id = ?').get(body.course_id);
    if (!course) throw new CourseDraftError('Course not found.', 404);
    const open = db.prepare("SELECT id FROM course_drafts WHERE course_id = ? AND status = 'draft'").get(course.id);
    if (open) throw new CourseDraftError('This course already has an open draft. Edit that one.', 409, { draft_id: open.id });
  }
  const patch = contentPatch(body);
  const sopId = body.sop_id !== undefined ? (body.sop_id || null) : (course?.sop_id || null);
  const doc = docFor(db, sopId);
  if (sopId && !doc) throw new CourseDraftError('The document named in sop_id does not exist.', 404);
  const builtFrom = body.built_from_revision !== undefined ? text(body.built_from_revision, 40) : docInForce(doc);
  const questions = body.questions === undefined || body.questions === null ? null : normalizeQuestions(body.questions);
  const title = patch.title ?? course?.title;
  if (!title) throw new CourseDraftError('A new course needs a title.');
  const id = uuid();
  db.prepare(`INSERT INTO course_drafts (id, course_id, code, title, category, description, retrain_months, passing_score,
      sop_id, built_from_revision, questions, change_note, staged_by, staged_by_id, staged_via_token)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    id, course?.id || null,
    patch.code !== undefined ? patch.code : (course?.code || null),
    title,
    patch.category !== undefined ? patch.category : (course?.category || 'GMP'),
    patch.description !== undefined ? patch.description : (course?.description || null),
    patch.retrain_months !== undefined ? patch.retrain_months : (course?.retrain_months ?? null),
    patch.passing_score !== undefined ? patch.passing_score : (course?.passing_score ?? 80),
    sopId, builtFrom, questions ? JSON.stringify(questions) : null, patch.change_note ?? null,
    actorName(actor), actor?.id || null, viaToken ? 1 : 0);
  logAudit(actor, 'create', 'course_draft', id,
    { course_id: course?.id || null, sop_id: sopId, built_from_revision: builtFrom, questions: questions?.length ?? null, via_token: viaToken || undefined },
    null, null, title);
  return getDraft(db, id);
}

/** Clear both signatures; returns the names that were cleared. */
function clearSignatures(db, d) {
  const cleared = [d.doc_confirmed_by, d.fs_approved_by].filter(Boolean);
  if (cleared.length) {
    db.prepare(`UPDATE course_drafts SET doc_confirmed_by = NULL, doc_confirmed_by_id = NULL, doc_confirmed_at = NULL,
      fs_approved_by = NULL, fs_approved_by_id = NULL, fs_approved_at = NULL WHERE id = ?`).run(d.id);
  }
  return cleared;
}

/** Edit an open draft. An absent field is left alone; a blank one clears it. Any signature already given is cleared. */
export function updateDraft(db, d, body, actor) {
  requireOpen(d);
  const patch = contentPatch(body);
  const sets = []; const args = [];
  for (const [k, v] of Object.entries(patch)) { sets.push(`${k} = ?`); args.push(v); }
  if (body.sop_id !== undefined) {
    const sopId = body.sop_id || null;
    if (sopId && !docFor(db, sopId)) throw new CourseDraftError('The document named in sop_id does not exist.', 404);
    sets.push('sop_id = ?'); args.push(sopId);
    if (body.built_from_revision === undefined) { sets.push('built_from_revision = ?'); args.push(docInForce(docFor(db, sopId))); }
  }
  if (body.built_from_revision !== undefined) { sets.push('built_from_revision = ?'); args.push(text(body.built_from_revision, 40)); }
  if (body.questions !== undefined) {
    sets.push('questions = ?'); args.push(body.questions === null ? null : JSON.stringify(normalizeQuestions(body.questions)));
  }
  if (body.remove_material_ids !== undefined) {
    const ids = Array.isArray(body.remove_material_ids) ? [...new Set(body.remove_material_ids.map(String))] : [];
    const own = d.course_id ? new Set(db.prepare('SELECT id FROM training_materials WHERE course_id = ?').all(d.course_id).map(r => r.id)) : new Set();
    const bad = ids.filter(i => !own.has(i));
    if (bad.length) throw new CourseDraftError(`Only files on the live course can be taken away; not on it: ${bad.join(', ')}.`);
    sets.push('remove_material_ids = ?'); args.push(JSON.stringify(ids));
  }
  // Removing a file the draft itself added (not a live one) — it never went live.
  let removedOwn = [];
  if (body.remove_draft_material_ids !== undefined) {
    const ids = Array.isArray(body.remove_draft_material_ids) ? body.remove_draft_material_ids.map(String) : [];
    for (const mid of ids) {
      const m = db.prepare('SELECT * FROM course_draft_materials WHERE id = ? AND draft_id = ?').get(mid, d.id);
      if (!m) throw new CourseDraftError(`File ${mid} is not on this draft.`);
      removedOwn.push(m);
    }
  }
  if (!sets.length && !removedOwn.length) throw new CourseDraftError('Nothing to change.');
  const cleared = clearSignatures(db, d);
  sets.push('updated_by = ?', 'updated_by_id = ?', "updated_at = datetime('now')");
  args.push(actorName(actor), actor?.id || null);
  db.prepare(`UPDATE course_drafts SET ${sets.join(', ')} WHERE id = ?`).run(...args, d.id);
  for (const m of removedOwn) {
    db.prepare('DELETE FROM course_draft_materials WHERE id = ?').run(m.id);
    purgeIfUnreferenced(db, m.storage_key);
  }
  logAudit(actor, 'update', 'course_draft', d.id,
    { fields: Object.keys(body).filter(k => body[k] !== undefined), signatures_cleared: cleared.length ? cleared : undefined,
      draft_files_removed: removedOwn.length ? removedOwn.map(m => m.filename) : undefined, via_token: actor?.via_token || undefined },
    null, null, d.title);
  return { draft: getDraft(db, d.id), signatures_cleared: cleared };
}

/** Record files uploaded to a draft (already stored). Clears signatures like any edit. */
export function addDraftMaterials(db, d, stored, actor) {
  requireOpen(d);
  const ins = db.prepare(`INSERT INTO course_draft_materials (id, draft_id, title, filename, content_type, size, storage_key, uploaded_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
  for (const f of stored) ins.run(f.id, d.id, f.title || null, f.filename, f.content_type || null, f.size || null, f.storage_key, actorName(actor));
  const cleared = clearSignatures(db, d);
  db.prepare("UPDATE course_drafts SET updated_by = ?, updated_by_id = ?, updated_at = datetime('now') WHERE id = ?").run(actorName(actor), actor?.id || null, d.id);
  logAudit(actor, 'update', 'course_draft', d.id,
    { files_added: stored.map(f => f.filename), signatures_cleared: cleared.length ? cleared : undefined, via_token: actor?.via_token || undefined },
    null, null, d.title);
  return cleared;
}

/** Delete a stored object only when no live material and no draft file still points at it. */
export function purgeIfUnreferenced(db, key) {
  if (!key) return;
  const live = db.prepare('SELECT 1 FROM training_materials WHERE storage_key = ? LIMIT 1').get(key);
  const draft = db.prepare('SELECT 1 FROM course_draft_materials WHERE storage_key = ? LIMIT 1').get(key);
  if (!live && !draft) deleteObject(key);
}

function liveQuiz(db, courseId) {
  if (!courseId) return null;
  const t = db.prepare('SELECT * FROM training_tests WHERE course_id = ? AND is_current = 1').get(courseId);
  if (!t) return null;
  const qs = db.prepare('SELECT * FROM training_questions WHERE test_id = ? ORDER BY position').all(t.id).map(q => ({
    type: q.type, prompt: q.prompt, prompt_es: q.prompt_es || null, options: parse(q.options, []), options_es: parse(q.options_es, []),
    correct_answer: q.correct_answer == null ? '' : String(q.correct_answer), points: q.points,
  }));
  return { test: t, questions: qs };
}

const sameQ = (a, b) => a.type === b.type && a.prompt === b.prompt && (a.prompt_es || null) === (b.prompt_es || null)
  && JSON.stringify(a.options) === JSON.stringify(b.options) && JSON.stringify(a.options_es || []) === JSON.stringify(b.options_es || [])
  && String(a.correct_answer) === String(b.correct_answer) && Number(a.points) === Number(b.points);

/** What publishing this draft would change on the live course. */
export function draftDiff(db, d) {
  const course = d.course_id ? db.prepare('SELECT * FROM training_courses WHERE id = ?').get(d.course_id) : null;
  const fields = [];
  for (const k of ['code', 'title', 'category', 'description', 'retrain_months', 'passing_score', 'sop_id']) {
    const live = course ? (course[k] ?? null) : null;
    const next = d[k] ?? null;
    if (String(live ?? '') !== String(next ?? '')) fields.push({ field: k, live, draft: next });
  }
  const lq = liveQuiz(db, d.course_id);
  let quiz = { changed: false, kept: true };
  if (d.questions) {
    const dq = parse(d.questions, []);
    const lqs = lq?.questions || [];
    const rows = [];
    const n = Math.max(dq.length, lqs.length);
    for (let i = 0; i < n; i++) {
      const a = lqs[i]; const b = dq[i];
      if (a && !b) rows.push({ position: i + 1, change: 'removed', live: a.prompt });
      else if (!a && b) rows.push({ position: i + 1, change: 'added', draft: b.prompt });
      else if (!sameQ(a, b)) rows.push({ position: i + 1, change: 'changed', live: a.prompt, draft: b.prompt });
    }
    quiz = { changed: rows.length > 0, kept: false, live_count: lqs.length, draft_count: dq.length, live_version: lq?.test?.version ?? null, rows,
      spanish_missing: dq.filter(q => !q.prompt_es).length };
  }
  const added = db.prepare('SELECT id, filename, content_type, size FROM course_draft_materials WHERE draft_id = ? ORDER BY created_at').all(d.id);
  const removeIds = parse(d.remove_material_ids, []);
  const removed = removeIds.length
    ? db.prepare(`SELECT id, filename FROM training_materials WHERE id IN (${removeIds.map(() => '?').join(',')})`).all(...removeIds)
    : [];
  return { new_course: !course, fields, quiz, files: { added: added.map(f => f.filename), removed: removed.map(f => f.filename) } };
}

/** Everything a screen or the bot needs about one draft. */
export function draftView(db, d, user = null) {
  const course = d.course_id ? db.prepare('SELECT id, code, title, built_on_revision, active FROM training_courses WHERE id = ?').get(d.course_id) : null;
  const doc = docFor(db, d.sop_id);
  const inForce = docInForce(doc);
  const bot = user ? isBotAccount(db, user) : true;
  const signer = (role) => {
    const r = SIGN_ROLES[role];
    return d[r.by] ? { by: d[r.by], by_id: d[r.id], at: d[r.at] } : null;
  };
  const signatures = { document: signer('document'), food_safety: signer('food_safety') };
  const maySign = (role) => !!user && d.status === 'draft' && !bot && CAN_SIGN[role](user) && !signatures[role]
    && user.id !== d.staged_by_id
    && !Object.entries(signatures).some(([k, s]) => k !== role && s?.by_id === user.id);
  return {
    ...d,
    questions: parse(d.questions, null),
    remove_material_ids: parse(d.remove_material_ids, []),
    staged_via_token: !!d.staged_via_token,
    course,
    document: doc ? { id: doc.id, doc_number: doc.doc_number, title: doc.title, revision_in_force: inForce } : null,
    // The document has moved past the revision the draft was built from: publishing is refused.
    document_moved: !!(d.sop_id && d.built_from_revision && inForce && !sameRevision(d.built_from_revision, inForce)),
    signatures,
    diff: draftDiff(db, d),
    can_sign: { document: maySign('document'), food_safety: maySign('food_safety') },
  };
}

/** The list for the Course drafts screen and the bot. */
export function listDrafts(db, { status = 'draft' } = {}) {
  const rows = status === 'all'
    ? db.prepare('SELECT * FROM course_drafts ORDER BY created_at DESC LIMIT 500').all()
    : db.prepare('SELECT * FROM course_drafts WHERE status = ? ORDER BY created_at DESC LIMIT 500').all(status);
  return rows.map(d => {
    const doc = docFor(db, d.sop_id);
    const inForce = docInForce(doc);
    return {
      id: d.id, course_id: d.course_id, title: d.title, code: d.code, status: d.status,
      staged_by: d.staged_by, staged_via_token: !!d.staged_via_token, created_at: d.created_at, updated_at: d.updated_at,
      document: doc ? { doc_number: doc.doc_number, title: doc.title, revision_in_force: inForce } : null,
      built_from_revision: d.built_from_revision,
      document_moved: !!(d.sop_id && d.built_from_revision && inForce && !sameRevision(d.built_from_revision, inForce)),
      doc_confirmed_by: d.doc_confirmed_by, fs_approved_by: d.fs_approved_by, published_at: d.published_at,
    };
  });
}

/**
 * One of the two signatures. The route has already checked the password
 * (gateSignature). When this is the second, the draft publishes in the same
 * transaction-bounded call.
 */
export function signDraft(db, d, role, user) {
  const r = SIGN_ROLES[role];
  if (!r) throw new CourseDraftError('Sign as "document" (matches the document) or "food_safety" (food safety content).');
  requireOpen(d);
  if (isBotAccount(db, user)) throw new CourseDraftError('A bot account can never approve or publish a course.', 403);
  if (!CAN_SIGN[role](user)) throw new CourseDraftError(`${r.label} is signed by ${r.who}.`, 403);
  if (d[r.by]) throw new CourseDraftError(`${r.label} is already signed by ${d[r.by]}.`, 409);
  if (user.id && user.id === d.staged_by_id) throw new CourseDraftError('Whoever staged a draft cannot sign it.', 403);
  const other = role === 'document' ? SIGN_ROLES.food_safety : SIGN_ROLES.document;
  if (d[other.id] && d[other.id] === user.id) throw new CourseDraftError('The two signatures must be two different people.', 403);
  // Refuse before signing if publishing could not go through.
  if (d[other.by]) assertPublishable(db, d);
  db.prepare(`UPDATE course_drafts SET ${r.by} = ?, ${r.id} = ?, ${r.at} = datetime('now') WHERE id = ?`).run(user.name, user.id, d.id);
  logAudit(user, 'sign', 'course_draft', d.id, { role, label: r.label, signature_verified: true }, null, null, d.title);
  const after = getDraft(db, d.id);
  if (after.doc_confirmed_by && after.fs_approved_by) return { published: publishDraft(db, after, user) };
  return { published: null };
}

/** Take back a signature: the signer, or an admin. */
export function revokeSignature(db, d, role, user, reason) {
  const r = SIGN_ROLES[role];
  if (!r) throw new CourseDraftError('Unknown signature.');
  requireOpen(d);
  if (!d[r.by]) throw new CourseDraftError('There is no signature to take back.', 409);
  if (user.role !== 'admin' && d[r.id] !== user.id) throw new CourseDraftError('Only the person who signed, or an admin, can take a signature back.', 403);
  db.prepare(`UPDATE course_drafts SET ${r.by} = NULL, ${r.id} = NULL, ${r.at} = NULL WHERE id = ?`).run(d.id);
  logAudit(user, 'revoke', 'course_draft', d.id, { role, signer: d[r.by], reason: text(reason, 500) }, null, null, d.title);
}

/** Discard an open draft: a person, with a reason. Its own files are removed; the row stays. */
export function discardDraft(db, d, user, reason) {
  requireOpen(d);
  const why = text(reason, 500);
  if (!why || why.length < 3) throw new CourseDraftError('Say why the draft is being discarded.');
  db.prepare("UPDATE course_drafts SET status = 'discarded', discarded_by = ?, discarded_at = datetime('now'), discard_reason = ? WHERE id = ?").run(user.name, why, d.id);
  const files = db.prepare('SELECT storage_key FROM course_draft_materials WHERE draft_id = ?').all(d.id);
  db.prepare('DELETE FROM course_draft_materials WHERE draft_id = ?').run(d.id);
  for (const f of files) purgeIfUnreferenced(db, f.storage_key);
  logAudit(user, 'discard', 'course_draft', d.id, { reason: why, files_removed: files.length }, null, null, d.title);
}

function assertPublishable(db, d) {
  if (d.course_id && !db.prepare('SELECT 1 FROM training_courses WHERE id = ?').get(d.course_id)) {
    throw new CourseDraftError('The live course this draft was staged against no longer exists.', 409);
  }
  if (d.sop_id) {
    const inForce = docInForce(docFor(db, d.sop_id));
    if (d.built_from_revision && inForce && !sameRevision(d.built_from_revision, inForce)) {
      throw new CourseDraftError(`The document is now at revision ${inForce}; this draft was built from revision ${d.built_from_revision}. Stage a new draft from the current revision.`, 409, { code: 'DOCUMENT_MOVED' });
    }
  }
}

/** Write the draft into the live course. Called only by signDraft, after both signatures. */
function publishDraft(db, d, actor) {
  assertPublishable(db, d);
  const questions = parse(d.questions, null);
  let courseId = d.course_id;
  let testId = null;
  const tx = db.transaction(() => {
    if (!courseId) {
      courseId = uuid();
      db.prepare(`INSERT INTO training_courses (id, code, title, category, description, sop_id, retrain_months, required_roles, required_departments,
          required_positions, has_test, passing_score, active, retrain_on_doc_change)
        VALUES (?, ?, ?, ?, ?, ?, ?, '[]', '[]', '[]', ?, ?, 1, 1)`).run(
        courseId, d.code, d.title, d.category || 'GMP', d.description, d.sop_id, d.retrain_months, questions ? 1 : 0, d.passing_score ?? 80);
    } else {
      db.prepare(`UPDATE training_courses SET code = ?, title = ?, category = ?, description = ?, sop_id = ?, retrain_months = ?,
          passing_score = ?, updated_at = datetime('now') WHERE id = ?`).run(
        d.code, d.title, d.category || 'GMP', d.description, d.sop_id, d.retrain_months, d.passing_score ?? 80, courseId);
    }
    if (questions) {
      const prev = db.prepare('SELECT MAX(version) v FROM training_tests WHERE course_id = ?').get(courseId);
      testId = uuid();
      db.prepare('UPDATE training_tests SET is_current = 0 WHERE course_id = ?').run(courseId);
      db.prepare('INSERT INTO training_tests (id, course_id, version, title, passing_score, is_current, sop_revision) VALUES (?, ?, ?, ?, ?, 1, ?)')
        .run(testId, courseId, (prev?.v || 0) + 1, `${d.title} Test`, d.passing_score ?? 80, d.built_from_revision || null);
      const insQ = db.prepare('INSERT INTO training_questions (id, test_id, position, type, prompt, prompt_es, options, options_es, correct_answer, points) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
      questions.forEach((q, i) => insQ.run(uuid(), testId, i, q.type, q.prompt, q.prompt_es || null, JSON.stringify(q.options || []),
        JSON.stringify(q.options_es || []), String(q.correct_answer), q.points ?? 1));
      db.prepare("UPDATE training_courses SET has_test = 1 WHERE id = ?").run(courseId);
    } else if (d.passing_score != null) {
      // One pass mark (D-158): the course and its current test say the same number.
      db.prepare('UPDATE training_tests SET passing_score = ? WHERE course_id = ? AND is_current = 1').run(d.passing_score, courseId);
    }
    for (const m of db.prepare('SELECT * FROM course_draft_materials WHERE draft_id = ?').all(d.id)) {
      db.prepare(`INSERT INTO training_materials (id, course_id, title, filename, content_type, size, storage_key, uploaded_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(uuid(), courseId, m.title, m.filename, m.content_type, m.size, m.storage_key, m.uploaded_by);
    }
    const removeIds = parse(d.remove_material_ids, []);
    for (const mid of removeIds) db.prepare('DELETE FROM training_materials WHERE id = ? AND course_id = ?').run(mid, courseId);
    db.prepare("UPDATE course_drafts SET status = 'published', course_id = ?, published_at = datetime('now'), published_test_id = ? WHERE id = ?")
      .run(courseId, testId, d.id);
  });
  const removedKeys = parse(d.remove_material_ids, []).length
    ? db.prepare(`SELECT storage_key FROM training_materials WHERE id IN (${parse(d.remove_material_ids, []).map(() => '?').join(',')})`).all(...parse(d.remove_material_ids, []))
    : [];
  tx();
  for (const r of removedKeys) purgeIfUnreferenced(db, r.storage_key);

  // Built on a newer revision → "course updated for revision N" (D-277): the
  // one door that assigns retraining. Not when it already teaches that revision.
  let retraining = null;
  const course = db.prepare('SELECT * FROM training_courses WHERE id = ?').get(courseId);
  const docRev = docRevisionFor(db, course);
  if (course.sop_id && docRev && sameRevision(d.built_from_revision || docRev, docRev)
      && (!sameRevision(course.built_on_revision, docRev) || course.built_on_kind === 'linked' || !course.built_on_kind)) {
    try {
      const out = markCourseRevision(db, course, { kind: 'updated', note: `Published from course draft (staged by ${d.staged_by || 'unknown'})`, actor });
      retraining = { revision: out.revision, assigned: out.created.length, already_open: out.skipped.length };
    } catch (e) {
      if (!(e instanceof CourseRevisionError)) throw e;
    }
  }
  logAudit(actor, 'publish', 'course_draft', d.id,
    { course_id: courseId, new_course: !d.course_id, test_id: testId, document_confirmed_by: d.doc_confirmed_by, food_safety_approved_by: d.fs_approved_by,
      staged_by: d.staged_by, staged_via_token: !!d.staged_via_token, retraining },
    null, null, d.title);
  logAudit(actor, d.course_id ? 'update' : 'create', 'training_course', courseId, { from_draft: d.id, staged_by: d.staged_by }, null, null, d.title);
  return { course_id: courseId, test_id: testId, retraining };
}

export const draftMaterialShape = async (m, presign) => ({
  id: m.id, title: m.title, filename: m.filename, content_type: m.content_type, size: m.size, uploaded_by: m.uploaded_by,
  created_at: m.created_at, is_video: isVideo(m.content_type, m.filename), url: presign ? await presign(m.storage_key, m.filename) : null,
});

// What a TOKEN may upload to a draft. A person's upload takes the course
// material route's own rules; a bot's takes only these — the files a course is
// built from — so an .html or .svg is never stored under the bot's name.
export const TOKEN_DRAFT_FILE_EXT = Object.freeze(['mp4', 'mov', 'm4v', 'webm', 'pdf', 'png', 'jpg', 'jpeg', 'docx', 'pptx']);
export function tokenDraftFileRefusal(filename) {
  const ext = (String(filename || '').match(/\.([A-Za-z0-9]+)$/)?.[1] || '').toLowerCase();
  return TOKEN_DRAFT_FILE_EXT.includes(ext) ? null
    : `${filename || 'This file'}: a bot token may upload only ${TOKEN_DRAFT_FILE_EXT.join(', ')} files to a course draft.`;
}

// The two signatures are reachable at Training VIEW (the mount's taskWrites
// allow list): who signs is decided by department and role in signDraft, not
// by whether somebody can edit courses. Document Control and the QA supervisor
// should not need course-edit access to sign a draft.
export const DRAFT_SIGN_WRITES = [
  /^POST \/drafts\/[^/]+\/sign\/[^/]+$/,
  /^DELETE \/drafts\/[^/]+\/sign\/[^/]+$/,
];
