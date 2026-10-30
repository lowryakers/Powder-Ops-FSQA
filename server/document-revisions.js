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
import { logAudit } from './db.js';
import { readyDocOrigin } from './links.js';
import { enqueueQualitySignal } from './ops-webhook.js';
import { revisionKey, sameRevision, nextVRevision, isApprovedStatus } from '../shared/document-revision.js';
import { revisionFromFilename } from './filename-meta.js';

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
    for (const a of db.prepare('SELECT revision, filename FROM document_attachments WHERE document_id = ?').all(doc.id)) {
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

const DRAFT_FIELDS = ['revision', 'title', 'description', 'description_es', 'effective_date', 'change_summary'];

/** Edit the draft. The approved revision on the document row does not move. */
export function saveDraft(db, doc, draft, body, actor) {
  if (draft.status !== 'draft') throw new RevisionError('Only a draft revision can be edited. An approved revision is history.', 409);
  const sets = []; const vals = [];
  for (const k of DRAFT_FIELDS) {
    if (body[k] === undefined) continue;
    if (k === 'revision' && !String(body[k] || '').trim()) throw new RevisionError('A revision number is required.');
    sets.push(`${k} = ?`); vals.push(body[k] === '' ? null : body[k]);
  }
  if (!sets.length) return draft;
  db.prepare(`UPDATE document_revisions SET ${sets.join(', ')}, updated_at = datetime('now') WHERE id = ?`).run(...vals, draft.id);
  const after = db.prepare('SELECT * FROM document_revisions WHERE id = ?').get(draft.id);
  logAudit(actor, 'update', 'document_revision', draft.id, { document_id: doc.id, fields: Object.keys(body).filter(k => DRAFT_FIELDS.includes(k)) }, draft, after, `${doc.doc_number || doc.title} draft ${after.revision}`);
  return after;
}

/** Throw the draft away. Kept out of the history it never joined; audited with a reason. */
export function discardDraft(db, doc, draft, reason, actor) {
  if (draft.status !== 'draft') throw new RevisionError('Only a draft revision can be discarded.', 409);
  if (String(reason || '').trim().length < 3) throw new RevisionError('Say why the draft is being discarded.');
  db.prepare('DELETE FROM document_revisions WHERE id = ?').run(draft.id);
  logAudit(actor, 'delete', 'document_revision', draft.id, { document_id: doc.id, revision: draft.revision, reason: String(reason).trim() }, draft, null, `${doc.doc_number || doc.title} draft ${draft.revision}`);
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
 * @param opts   { source: 'draft' | 'transcribed' | 'first_approval', draftId?, actor, approved_by? }
 */
export function recordApprovedRevision(db, doc, fields, { source, draftId = null, actor, approved_by = null } = {}) {
  const revision = String(fields.revision || '').trim();
  const wasApproved = isApprovedStatus(doc.status);
  const problem = wasApproved || db.prepare('SELECT 1 FROM document_revisions WHERE document_id = ? LIMIT 1').get(doc.id)
    ? revisionNumberProblem(db, doc, revision) : (revisionKey(revision) ? null : 'A revision number is required.');
  if (problem) throw new RevisionError(problem, 409, { code: 'REVISION_NUMBER_USED', suggested: suggestedRevision(db, doc) });

  const nowIso = new Date().toISOString();
  const approver = approved_by || actor?.name || 'system';
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
        approved_by = ?, approved_at = ?, training_revision = ?, status = 'active', updated_at = datetime('now') WHERE id = ?`)
      .run(revision, next.title, next.description, next.description_es, next.effective_date, approver, nowIso, revision, doc.id);
    const after = db.prepare('SELECT * FROM sop_documents WHERE id = ?').get(doc.id);
    db.prepare('INSERT INTO sop_versions (id, sop_id, revision, changed_by, change_summary, snapshot) VALUES (?, ?, ?, ?, ?, ?)')
      .run(uuid(), doc.id, revision, actor?.name || 'system',
        fields.change_summary || `Revision ${revision} approved${wasApproved ? ` (was ${doc.revision})` : ''}`, JSON.stringify(after));
  })();

  const after = db.prepare('SELECT * FROM sop_documents WHERE id = ?').get(doc.id);
  const courses = linkedCourses(db, after);
  logAudit(actor, 'approve', 'document_revision', revId,
    { document_id: doc.id, from_revision: wasApproved ? doc.revision : null, to_revision: revision, source,
      courses_needing_update: courses.filter(c => c.needs_update).map(c => c.code || c.title) },
    doc, after, `${doc.doc_number || doc.title} rev ${revision}`);
  const signal = qualitySignalFor(after, { from: wasApproved ? doc.revision : null, to: revision, approver, approvedAt: nowIso, source, changeSummary: fields.change_summary, courses });
  const queued = enqueueQualitySignal(signal);
  return { document: after, revision: db.prepare('SELECT * FROM document_revisions WHERE id = ?').get(revId), courses, signal: queued };
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
