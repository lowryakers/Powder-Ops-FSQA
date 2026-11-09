// A controlled document's revisions (D-277).
//
// The `sop_documents` row is the APPROVED revision in force — what the floor
// reads, what is printed, what training is measured against. A change to its
// text or its revision number is a DRAFT revision held here until somebody with
// the right to approve signs it; the approved text does not move while the
// draft is being written. Approving gives the draft a NEW revision number (one
// no earlier revision of this document has used), supersedes the revision
// before it — kept, never overwritten — and sends one signal to the Quality bot.
//
// ONE WRITER for an approved revision: `recordApprovedRevision`. Three doors
// reach it — approving a draft here, the revision worklist applying a paper
// revision already approved on paper (`applyRevision` in api/documents.js), and
// a draft document's first move to Approved — so each leaves the same history,
// audit entry and signal.
//
// Nothing is migrated. A document gets its first `document_revisions` row when
// its first new revision is started or recorded; the revision in force then is
// filed beside it as `baseline`, from the row as it stands.
import { v4 as uuid } from 'uuid';
import { createHash } from 'crypto';
import { signatureEvidence } from './signature.js';
import { logAudit } from './db.js';
import { readyDocOrigin } from './links.js';
import { enqueueQualitySignal } from './ops-webhook.js';
import { revisionKey, sameRevision, nextVRevision, isApprovedStatus } from '../shared/document-revision.js';
import { revisionFromFilename } from './filename-meta.js';
import { normalizeDocNumber } from './doc-consistency.js';

// The registry screen each document type lives on (App.jsx nav ids).
const TAB_FOR_TYPE = { sop: 'sops', work_instruction: 'work-instructions', job_description: 'job-descriptions' };

export class RevisionError extends Error {
  constructor(message, status = 400, extra = {}) { super(message); this.status = status; this.extra = extra; }
}

/** Newest first, by when each was APPROVED (a baseline row is written later than the draft that replaces it); a draft first. */
export const listRevisions = (db, documentId) =>
  db.prepare(`SELECT * FROM document_revisions WHERE document_id = ?
    ORDER BY (status = 'draft') DESC, COALESCE(approved_at, created_at) DESC, rowid DESC`).all(documentId);

export const draftOf = (db, documentId) =>
  db.prepare("SELECT * FROM document_revisions WHERE document_id = ? AND status = 'draft'").get(documentId) || null;

// ── A file belongs to the live document or to a draft (D-304) ────────────────
// 'current'  — the live document's file (no draft link, or its revision approved)
// 'draft'    — uploaded for a draft revision not yet approved
// 'discarded'— uploaded for a draft that was thrown away; never the live document's
export const attachmentStateSql = (a = 'a') => `CASE
  WHEN ${a}.revision_discarded_at IS NOT NULL THEN 'discarded'
  WHEN ${a}.revision_id IS NOT NULL AND EXISTS (SELECT 1 FROM document_revisions xr WHERE xr.id = ${a}.revision_id AND xr.status = 'draft') THEN 'draft'
  ELSE 'current' END`;
export const currentAttachmentSql = (a = 'a') => `(${attachmentStateSql(a)}) = 'current'`;

/**
 * Why `number` cannot be this document's new number, or null. Compared the way
 * the consistency review compares ("SOP 105" = "SOP-105"): another live
 * document, or another document's open draft, already carrying it.
 */
export function docNumberProblem(db, doc, number) {
  const n = String(number || '').trim();
  if (!n) return null;
  const key = normalizeDocNumber(n);
  const other = db.prepare("SELECT id, doc_number, title FROM sop_documents WHERE id != ? AND status != 'archived' AND doc_number IS NOT NULL AND doc_number != ''")
    .all(doc.id).find(d => normalizeDocNumber(d.doc_number) === key);
  if (other) return `${n} is already the number of "${other.title}" (${other.doc_number}). Pick another number, or correct that document first.`;
  const drafted = db.prepare(`SELECT r.doc_number, d.title FROM document_revisions r JOIN sop_documents d ON d.id = r.document_id
    WHERE r.status = 'draft' AND r.document_id != ? AND r.doc_number IS NOT NULL AND r.doc_number != ''`)
    .all(doc.id).find(r => normalizeDocNumber(r.doc_number) === key);
  if (drafted) return `${n} is already proposed by the draft revision of "${drafted.title}".`;
  return null;
}

/** Every revision number this document has ever been APPROVED under, the one in force included. */
function usedNumbers(db, doc) {
  const rows = db.prepare("SELECT revision FROM document_revisions WHERE document_id = ? AND status IN ('approved','superseded')").all(doc.id);
  const out = rows.map(r => r.revision);
  if (isApprovedStatus(doc.status) && doc.revision) out.push(doc.revision);
  return out;
}

/**
 * What else says which V the document is at (D-280). A document filed before
 * revisions were controlled often carries the default "1.0" while its signed
 * copy, its source file or its title says "V3" — that is the number to count on
 * from. Read only; nothing is rewritten.
 */
function revisionEvidence(db, doc) {
  const out = [];
  try {
    // A draft's or a discarded draft's file says nothing about the revision in force (D-304).
    for (const a of db.prepare(`SELECT revision, filename FROM document_attachments a WHERE a.document_id = ? AND ${currentAttachmentSql('a')}`).all(doc.id)) {
      if (a.revision) out.push(a.revision);
      const f = revisionFromFilename(a.filename || ''); if (f) out.push(f);
    }
  } catch { /* no attachments table */ }
  for (const name of [doc.source_file, doc.title]) {
    const f = revisionFromFilename(String(name || '')); if (f) out.push(f);
  }
  return out;
}

/** The revision a new draft is offered: the next V number, never one already used (D-280). */
export function suggestedRevision(db, doc) {
  return nextVRevision(doc.revision, { evidence: revisionEvidence(db, doc), used: usedNumbers(db, doc) });
}

/** Why `revision` cannot be the number of a new approved revision, or null. */
export function revisionNumberProblem(db, doc, revision) {
  if (!revisionKey(revision)) return 'A revision number is required.';
  const clash = usedNumbers(db, doc).find(u => sameRevision(u, revision));
  if (clash) return `Revision ${clash} has already been approved for this document. A new revision needs a new number (next: ${suggestedRevision(db, doc)}).`;
  return null;
}

/** Start a draft from the revision in force. One draft per document. */
export function startDraft(db, doc, actor, { revision, change_summary } = {}) {
  if (doc.status === 'archived') throw new RevisionError('This document is no longer in use. Reinstate it before starting a revision.', 409);
  if (!isApprovedStatus(doc.status)) throw new RevisionError('This document is not approved yet. Edit it directly; it becomes revision-controlled once approved.', 409);
  if (draftOf(db, doc.id)) throw new RevisionError('A draft revision is already open for this document. Edit or discard it.', 409);
  const rev = String(revision || '').trim() || suggestedRevision(db, doc);
  const id = uuid();
  db.prepare(`INSERT INTO document_revisions (id, document_id, revision, status, source, title, description, description_es,
      effective_date, change_summary, previous_revision, created_by, created_by_id)
    VALUES (?, ?, ?, 'draft', 'draft', ?, ?, ?, NULL, ?, ?, ?, ?)`)
    .run(id, doc.id, rev, doc.title, doc.description, doc.description_es, change_summary || null, doc.revision, actor?.name || null, actor?.id || null);
  const row = db.prepare('SELECT * FROM document_revisions WHERE id = ?').get(id);
  logAudit(actor, 'create', 'document_revision', id, { document_id: doc.id, revision: rev, from_revision: doc.revision }, null, row, `${doc.doc_number || doc.title} draft ${rev}`);
  return row;
}

const DRAFT_FIELDS = ['revision', 'title', 'description', 'description_es', 'effective_date', 'change_summary', 'doc_number'];

/** Edit the draft. The approved revision on the document row does not move. */
export function saveDraft(db, doc, draft, body, actor) {
  if (draft.status !== 'draft') throw new RevisionError('Only a draft revision can be edited. An approved revision is history.', 409);
  const sets = []; const vals = [];
  for (const k of DRAFT_FIELDS) {
    if (body[k] === undefined) continue;
    if (k === 'revision' && !String(body[k] || '').trim()) throw new RevisionError('A revision number is required.');
    if (k === 'doc_number') {
      // A corrected number rides the revision (D-304). The same number as now is
      // no change; a number another document holds is refused by name.
      const n = String(body[k] ?? '').trim();
      if (!n || n === String(doc.doc_number || '').trim()) { sets.push('doc_number = ?'); vals.push(null); continue; }
      const problem = docNumberProblem(db, doc, n);
      if (problem) throw new RevisionError(problem, 409, { code: 'DOC_NUMBER_USED' });
      sets.push('doc_number = ?'); vals.push(n); continue;
    }
    sets.push(`${k} = ?`); vals.push(body[k] === '' ? null : body[k]);
  }
  if (!sets.length) return draft;
  db.prepare(`UPDATE document_revisions SET ${sets.join(', ')}, updated_at = datetime('now') WHERE id = ?`).run(...vals, draft.id);
  let after = db.prepare('SELECT * FROM document_revisions WHERE id = ?').get(draft.id);
  // QA reviewed the draft as it WAS (D-319). A change to what was reviewed takes
  // the review off; a save that changed nothing QA read leaves it.
  let qaCleared = false;
  if (after.qa_reviewed_at && qaReviewHash(after) !== after.qa_review_hash) {
    db.prepare(`UPDATE document_revisions SET qa_reviewed_by = NULL, qa_reviewed_by_id = NULL, qa_reviewed_at = NULL,
      qa_review_meaning = NULL, qa_review_hash = NULL WHERE id = ?`).run(draft.id);
    after = db.prepare('SELECT * FROM document_revisions WHERE id = ?').get(draft.id);
    qaCleared = true;
  }
  logAudit(actor, 'update', 'document_revision', draft.id, { document_id: doc.id, fields: Object.keys(body).filter(k => DRAFT_FIELDS.includes(k)),
    ...(qaCleared ? { qa_review_cleared: true, qa_reviewed_by: draft.qa_reviewed_by } : {}) }, draft, after, `${doc.doc_number || doc.title} draft ${after.revision}`);
  return after;
}

// ── QA's review of a draft revision (D-319) ──────────────────────────────────
// Three verifications on a controlled document: the owner wrote it, QA reviewed
// it (21 CFR 111.105(a) — the quality unit approves or rejects written
// procedures), Document Control approved it. QA's is a password signature by a
// QA supervisor, given on the draft as it stands; Document Control's approval is
// refused until it is there. The reviewer may not be the document's owner or
// the person who approves it, so the three are three people.
export const QA_REVIEW_MEANING = 'Reviewed and accepted by Quality';
const QA_DEPTS = new Set(['qa', 'quality']);
/** A QA supervisor (or an admin in QA). Never decided by name. */
export const canQaReview = (u) => !!u && QA_DEPTS.has(String(u.department || '').toLowerCase())
  && ['supervisor', 'admin'].includes(u.role);
// What QA reads: the title and the text. The revision NUMBER and a staged
// document number are Document Control's, so renumbering does not undo QA's review.
const QA_HASHED = ['document_id', 'title', 'description', 'description_es'];
export const qaReviewHash = (r) => createHash('sha256').update(JSON.stringify(QA_HASHED.map(k => r?.[k] ?? null))).digest('hex');
/** null (not reviewed) · 'signed' (the draft is still what QA reviewed) · 'changed'. Approved rows keep 'signed'. */
export function qaReviewState(r) {
  if (!r?.qa_reviewed_at) return null;
  if (r.status !== 'draft') return 'signed';
  return r.qa_review_hash === qaReviewHash(r) ? 'signed' : 'changed';
}
const sameName = (a, b) => !!a && !!b && String(a).trim().toLowerCase() === String(b).trim().toLowerCase();

/** Why this person cannot give QA's review on this draft, or null. Checked before the password. */
export function qaReviewRefusal(doc, draft, actor) {
  if (draft.status !== 'draft') return { status: 409, error: 'Only a draft revision is reviewed. This one is already history.' };
  if (!canQaReview(actor)) return { status: 403, error: 'QA review is given by a supervisor in Quality.', code: 'QA_REVIEW_NOT_ALLOWED' };
  if (!String(draft.description || '').trim()) return { status: 400, error: 'The draft has no text to review.' };
  if (qaReviewState(draft) === 'signed') return { status: 409, error: `QA review was already given by ${draft.qa_reviewed_by}.`, code: 'QA_REVIEW_DONE' };
  if (sameName(doc.owner, actor.name)) {
    return { status: 409, error: `${actor.name} owns this document. QA review has to come from somebody else in Quality.`, code: 'QA_REVIEW_OWNER' };
  }
  return null;
}

/** Record QA's review. The route has already checked the password. */
export function qaReviewDraft(db, doc, draft, actor) {
  const at = new Date().toISOString();
  const hash = qaReviewHash(draft);
  db.prepare(`UPDATE document_revisions SET qa_reviewed_by = ?, qa_reviewed_by_id = ?, qa_reviewed_at = ?, qa_review_meaning = ?,
    qa_review_hash = ?, updated_at = datetime('now') WHERE id = ?`).run(actor.name, actor.id || null, at, QA_REVIEW_MEANING, hash, draft.id);
  const after = db.prepare('SELECT * FROM document_revisions WHERE id = ?').get(draft.id);
  logAudit(actor, 'sign', 'document_revision', draft.id,
    { event: 'qa_review', document_id: doc.id, revision: draft.revision, meaning: QA_REVIEW_MEANING, hash, ...signatureEvidence() },
    draft, after, `${doc.doc_number || doc.title} draft ${draft.revision} — QA review`);
  return after;
}

/** Take QA's review back before approval: the reviewer, or an admin. A reason is required. */
export function withdrawQaReview(db, doc, draft, actor, reason) {
  if (draft.status !== 'draft') throw new RevisionError('An approved revision\'s QA review is history and cannot be withdrawn.', 409);
  if (!draft.qa_reviewed_at) throw new RevisionError('This draft has no QA review to withdraw.', 409);
  const mine = (draft.qa_reviewed_by_id && draft.qa_reviewed_by_id === actor?.id) || sameName(draft.qa_reviewed_by, actor?.name);
  if (!mine && actor?.role !== 'admin') throw new RevisionError('Only the person who gave the QA review, or an admin, can withdraw it.', 403);
  if (String(reason || '').trim().length < 3) throw new RevisionError('Say why the QA review is being withdrawn.');
  db.prepare(`UPDATE document_revisions SET qa_reviewed_by = NULL, qa_reviewed_by_id = NULL, qa_reviewed_at = NULL,
    qa_review_meaning = NULL, qa_review_hash = NULL, updated_at = datetime('now') WHERE id = ?`).run(draft.id);
  const after = db.prepare('SELECT * FROM document_revisions WHERE id = ?').get(draft.id);
  logAudit(actor, 'revoke', 'document_revision', draft.id,
    { event: 'qa_review_withdrawn', document_id: doc.id, revision: draft.revision, reviewed_by: draft.qa_reviewed_by, reason: String(reason).trim() },
    draft, after, `${doc.doc_number || doc.title} draft ${draft.revision} — QA review`);
  return after;
}

/** Why Document Control cannot approve this draft yet because of QA's review, or null. */
export function approvalNeedsQa(draft, actor) {
  const state = qaReviewState(draft);
  if (state !== 'signed') {
    return { status: 409, code: 'QA_REVIEW_REQUIRED', error: state === 'changed'
      ? 'The draft changed after QA reviewed it. QA has to review it again before it can be approved.'
      : 'QA has not reviewed this draft yet. A QA supervisor reviews it first, then it can be approved.' };
  }
  if ((draft.qa_reviewed_by_id && draft.qa_reviewed_by_id === actor?.id) || sameName(draft.qa_reviewed_by, actor?.name)) {
    return { status: 409, code: 'QA_REVIEWER_CANNOT_APPROVE', error: `${draft.qa_reviewed_by} gave the QA review. The approval has to come from somebody else.` };
  }
  return null;
}

/** Throw the draft away. Kept out of the history it never joined; audited with a reason. */
export function discardDraft(db, doc, draft, reason, actor) {
  if (draft.status !== 'draft') throw new RevisionError('Only a draft revision can be discarded.', 409);
  if (String(reason || '').trim().length < 3) throw new RevisionError('Say why the draft is being discarded.');
  // Its files never become the live document's (D-304): marked discarded, then
  // unlinked so the draft row can go.
  let filesKept = 0;
  db.transaction(() => {
    filesKept = db.prepare(`UPDATE document_attachments SET revision_discarded_at = datetime('now'), discarded_revision = ?, revision_id = NULL
      WHERE revision_id = ?`).run(draft.revision, draft.id).changes;
    db.prepare('DELETE FROM document_revisions WHERE id = ?').run(draft.id);
  })();
  logAudit(actor, 'delete', 'document_revision', draft.id, { document_id: doc.id, revision: draft.revision, reason: String(reason).trim(),
    files_kept_off_document: filesKept || undefined }, draft, null, `${doc.doc_number || doc.title} draft ${draft.revision}`);
}

/** A course needs updating when the revision it was built on is not the document's approved one. */
export const courseNeedsUpdate = (course, docRevision) => !!docRevision && !sameRevision(course.built_on_revision, docRevision);

/** The courses built on this document, each with the revision it was built on and whether it now needs updating. */
export function linkedCourses(db, doc) {
  const current = doc.training_revision || doc.revision || null;
  return db.prepare('SELECT id, code, title, built_on_revision, built_on_kind, retrain_on_doc_change FROM training_courses WHERE sop_id = ? AND active = 1 ORDER BY code, title')
    .all(doc.id)
    .map(c => ({ ...c, built_on_revision: c.built_on_revision || null, needs_update: courseNeedsUpdate(c, current) }));
}

/**
 * THE one writer of an approved revision. In one transaction: the revision in
 * force is filed as superseded (as `baseline` when it was never filed), the new
 * revision is filed as approved, and the document row takes its number, text
 * and `training_revision`. Then, after the commit, one signal to the Quality bot.
 *
 * @param fields { revision, title?, description?, description_es?, effective_date?, change_summary? }
 * @param opts   { source: 'draft' | 'transcribed' | 'first_approval', draftId?, actor }
 */
export function recordApprovedRevision(db, doc, fields, { source, draftId = null, actor } = {}) {
  const revision = String(fields.revision || '').trim();
  const wasApproved = isApprovedStatus(doc.status);
  const problem = wasApproved || db.prepare('SELECT 1 FROM document_revisions WHERE document_id = ? LIMIT 1').get(doc.id)
    ? revisionNumberProblem(db, doc, revision) : (revisionKey(revision) ? null : 'A revision number is required.');
  if (problem) throw new RevisionError(problem, 409, { code: 'REVISION_NUMBER_USED', suggested: suggestedRevision(db, doc) });
  // A corrected number staged on the draft (D-304) moves with this approval, and
  // is checked again: another document may have taken it since it was staged.
  const stagedNumber = String(fields.doc_number || '').trim();
  const newNumber = stagedNumber && stagedNumber !== String(doc.doc_number || '').trim() ? stagedNumber : null;
  if (newNumber) {
    const numProblem = docNumberProblem(db, doc, newNumber);
    if (numProblem) throw new RevisionError(numProblem, 409, { code: 'DOC_NUMBER_USED' });
  }

  const nowIso = new Date().toISOString();
  // The approver is the signed-in person (D-282), never a typed name.
  const approver = actor?.name || 'system';
  const next = {
    title: fields.title || doc.title,
    description: fields.description !== undefined ? fields.description : doc.description,
    description_es: fields.description_es !== undefined ? fields.description_es : doc.description_es,
    effective_date: fields.effective_date || doc.effective_date || nowIso.slice(0, 10),
  };
  let revId = draftId;
  db.transaction(() => {
    if (wasApproved) {
      const inForce = db.prepare("SELECT id FROM document_revisions WHERE document_id = ? AND status = 'approved'").get(doc.id);
      if (inForce) {
        db.prepare("UPDATE document_revisions SET status = 'superseded', superseded_at = datetime('now') WHERE id = ?").run(inForce.id);
      } else {
        db.prepare(`INSERT INTO document_revisions (id, document_id, revision, status, source, title, description, description_es,
            effective_date, change_summary, approved_by, approved_at, superseded_at, created_by)
          VALUES (?, ?, ?, 'superseded', 'baseline', ?, ?, ?, ?, 'The revision in force when revision control started', ?, ?, datetime('now'), 'system')`)
          .run(uuid(), doc.id, doc.revision, doc.title, doc.description, doc.description_es, doc.effective_date, doc.approved_by, doc.approved_at);
      }
    }
    if (draftId) {
      db.prepare(`UPDATE document_revisions SET status = 'approved', revision = ?, title = ?, description = ?, description_es = ?,
          effective_date = ?, change_summary = COALESCE(?, change_summary), previous_revision = ?, approved_by = ?, approved_by_id = ?,
          approved_at = ?, updated_at = datetime('now') WHERE id = ?`)
        .run(revision, next.title, next.description, next.description_es, next.effective_date, fields.change_summary || null,
          wasApproved ? doc.revision : null, approver, actor?.id || null, nowIso, draftId);
    } else {
      revId = uuid();
      db.prepare(`INSERT INTO document_revisions (id, document_id, revision, status, source, title, description, description_es,
          effective_date, change_summary, previous_revision, created_by, created_by_id, approved_by, approved_by_id, approved_at)
        VALUES (?, ?, ?, 'approved', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(revId, doc.id, revision, source || 'draft', next.title, next.description, next.description_es,
          next.effective_date, fields.change_summary || null, wasApproved ? doc.revision : null,
          actor?.name || null, actor?.id || null, approver, actor?.id || null, nowIso);
    }
    db.prepare(`UPDATE sop_documents SET revision = ?, title = ?, description = ?, description_es = ?, effective_date = ?,
        approved_by = ?, approved_at = ?, training_revision = ?, status = 'active', doc_number = COALESCE(?, doc_number), updated_at = datetime('now') WHERE id = ?`)
      .run(revision, next.title, next.description, next.description_es, next.effective_date, approver, nowIso, revision, newNumber, doc.id);
    const signedRow = db.prepare('SELECT * FROM document_revisions WHERE id = ?').get(revId);
    db.prepare('UPDATE document_revisions SET approved_meaning = ?, approved_hash = ? WHERE id = ?')
      .run(APPROVAL_MEANING[source] || 'Approved', revisionHash(signedRow), revId);
    const after = db.prepare('SELECT * FROM sop_documents WHERE id = ?').get(doc.id);
    db.prepare('INSERT INTO sop_versions (id, sop_id, revision, changed_by, change_summary, snapshot) VALUES (?, ?, ?, ?, ?, ?)')
      .run(uuid(), doc.id, revision, actor?.name || 'system',
        fields.change_summary || `Revision ${revision} approved${wasApproved ? ` (was ${doc.revision})` : ''}`, JSON.stringify(after));
  })();

  const after = db.prepare('SELECT * FROM sop_documents WHERE id = ?').get(doc.id);
  const courses = linkedCourses(db, after);
  logAudit(actor, 'approve', 'document_revision', revId,
    // Every door into this writer asks for the approver's password first (D-282).
    { document_id: doc.id, from_revision: wasApproved ? doc.revision : null, to_revision: revision, source,
      ...(newNumber ? { from_doc_number: doc.doc_number || null, to_doc_number: newNumber } : {}),
      meaning: APPROVAL_MEANING[source] || 'Approved', ...signatureEvidence(),
      courses_needing_update: courses.filter(c => c.needs_update).map(c => c.code || c.title) },
    doc, after, `${doc.doc_number || doc.title} rev ${revision}`);
  const signal = qualitySignalFor(after, { from: wasApproved ? doc.revision : null, to: revision, approver, approvedAt: nowIso, source, changeSummary: fields.change_summary, courses });
  const queued = enqueueQualitySignal(signal);
  return { document: after, revision: db.prepare('SELECT * FROM document_revisions WHERE id = ?').get(revId), courses, signal: queued };
}

// ── An approval is a signature (D-282, 21 CFR 11.50 / 11.70) ──────────────────
// Who (the signed-in person, never a typed name), when, what it means, and a
// fingerprint of the exact revision approved — so the approval cannot be read
// as covering text it was not given over.
export const APPROVAL_MEANING = {
  draft: 'Approved',
  first_approval: 'Approved',
  transcribed: 'Approved on paper — recorded from the signed original',
};
const HASHED = ['document_id', 'revision', 'title', 'description', 'description_es', 'effective_date', 'approved_by_id', 'approved_at'];
// A staged number change is part of what was signed (D-304). Added only when
// present, so every fingerprint taken before it reads exactly as it did.
export const revisionHash = (r) => createHash('sha256')
  .update(JSON.stringify([...HASHED.map(k => r?.[k] ?? null), ...(r?.doc_number ? [r.doc_number] : [])])).digest('hex');
/** 'signed' (intact) · 'changed' · 'not_recorded' (approved before fingerprints) · null (not approved). */
export function approvalState(r) {
  if (!r || !['approved', 'superseded'].includes(r.status) || !r.approved_at) return null;
  if (!r.approved_hash) return 'not_recorded';
  return r.approved_hash === revisionHash(r) ? 'signed' : 'changed';
}

/** The Quality bot's payload: the document, old and new revision, the linked courses. */
export function qualitySignalFor(doc, { from, to, approver, approvedAt, source, changeSummary, courses, origin = readyDocOrigin() }) {
  return {
    event: 'document.revision_approved',
    version: 1,
    target: 'quality',
    dedupe_id: `doc-rev:${doc.id}:${revisionKey(to)}`,
    document: { id: doc.id, doc_number: doc.doc_number || null, title: doc.title, doc_type: doc.doc_type, category: doc.category },
    old_revision: from || null,
    new_revision: to,
    effective_date: doc.effective_date || null,
    approved_by: approver,
    approved_at: approvedAt,
    source,
    change_summary: changeSummary || null,
    linked_courses: courses.map(c => ({ id: c.id, code: c.code || null, title: c.title, built_on_revision: c.built_on_revision, needs_update: c.needs_update })),
    link: `${String(origin).replace(/\/+$/, '')}/?tab=${TAB_FOR_TYPE[doc.doc_type] || 'sops'}&doc=${doc.id}`,
  };
}

/**
 * The one draft-tied file uploaded before files could be tied to a draft
 * (D-304): the signed SOP-202 V3 scan, filed while the bot staged V3. Exact
 * match only, so it is idempotent by construction and does nothing on any
 * database where those two rows are not exactly as found: the attachment
 * untied, the revision still an open draft of the same document.
 */
export const KNOWN_DRAFT_ATTACHMENTS = Object.freeze([
  { attachment_id: 'e542c5b5-b482-4033-ab27-b1a2f8d3b238', revision_id: 'a1fabff3-eb54-4470-ad1d-988c5aef8f04' },
]);
export function tieKnownDraftAttachments(db) {
  let tied = 0;
  for (const k of KNOWN_DRAFT_ATTACHMENTS) {
    try {
      const a = db.prepare('SELECT id, document_id, revision_id, revision_discarded_at FROM document_attachments WHERE id = ?').get(k.attachment_id);
      const r = db.prepare('SELECT id, document_id, status, revision FROM document_revisions WHERE id = ?').get(k.revision_id);
      if (!a || !r || a.revision_id || a.revision_discarded_at || r.status !== 'draft' || r.document_id !== a.document_id) continue;
      db.prepare('UPDATE document_attachments SET revision_id = ? WHERE id = ? AND revision_id IS NULL').run(r.id, a.id);
      logAudit('system', 'update', 'document_attachment', a.id, { event: 'tied_to_draft_revision', revision_id: r.id, revision: r.revision, decision: 'D-304' });
      tied++;
    } catch (e) { console.warn('[doc-revisions] tieKnownDraftAttachments:', e.message); }
  }
  if (tied) console.log(`[doc-revisions] tied ${tied} attachment(s) to their draft revision (D-304)`);
  return tied;
}
