// Which revision of its document a course was built on, and the retraining that
// follows a new revision (D-277).
//
// A course linked to a document records the document revision it teaches
// (`training_courses.built_on_revision`). When the document's approved revision
// moves past it, the course NEEDS UPDATE — derived on every read, never stored.
//
// RETRAINING IS ASSIGNED ONLY FROM HERE. A new revision does not by itself put
// anybody on a training list: until the course says what the new revision
// means for it, there is nothing new to train people on. Somebody marks the
// course "updated for revision N" or confirms "no course change needed for
// revision N", and only then is everyone trained on an earlier revision given a
// retraining task. Until then the matrix measures people against the revision
// the course teaches, so nobody reads "out of date" against a course that has
// not caught up.
import { logAudit } from './db.js';
import { assignTraining } from './training-assign.js';
import { TRAINEE_RECORD_SQL } from './trainees.js';
import { sameRevision, isApprovedStatus } from '../shared/document-revision.js';
import { courseNeedsUpdate } from './document-revisions.js';

export const MARK_KINDS = { updated: 'Course updated for this revision', no_change: 'No course change needed for this revision' };

export class CourseRevisionError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

/** The approved revision of the course's document, or null when it has none in force. */
export function docRevisionFor(db, course) {
  if (!course?.sop_id) return null;
  const d = db.prepare('SELECT revision, training_revision, status FROM sop_documents WHERE id = ?').get(course.sop_id);
  if (!d || !isApprovedStatus(d.status)) return null;
  return d.training_revision || d.revision || null;
}

/** A course's revision state, for the course list and the document screen. */
export function courseRevisionState(db, course) {
  const docRevision = docRevisionFor(db, course);
  return {
    doc_revision: docRevision,
    built_on_revision: course.built_on_revision || null,
    needs_update: !!course.sop_id && courseNeedsUpdate(course, docRevision),
  };
}

/** Stamp a course as built on its document's revision in force, when it is linked or relinked. Not an approval; kind 'linked'. */
export function stampLinkedRevision(db, courseId, actor) {
  const c = db.prepare('SELECT * FROM training_courses WHERE id = ?').get(courseId);
  const rev = docRevisionFor(db, c);
  db.prepare(`UPDATE training_courses SET built_on_revision = ?, built_on_kind = ?, built_on_by = ?, built_on_by_id = ?,
      built_on_at = ?, built_on_note = NULL WHERE id = ?`)
    .run(rev, rev ? 'linked' : null, rev ? (actor?.name || null) : null, rev ? (actor?.id || null) : null, rev ? new Date().toISOString() : null, courseId);
}

/**
 * The people a course's retraining for `revision` is owed by: everyone whose
 * current, passing completion of the course was on an earlier revision (or on
 * no recorded revision). Trainees only; one entry per person.
 */
export function retrainingAudience(db, course, revision) {
  const rows = db.prepare(`SELECT tr.employee_user_id, tr.employee_name, tr.sop_revision FROM training_records tr
    WHERE tr.course_id = ? AND tr.superseded = 0 AND tr.status = 'completed' AND COALESCE(tr.passed, 1) = 1
      AND ${TRAINEE_RECORD_SQL('tr')}`).all(course.id);
  const seen = new Set();
  const out = [];
  for (const r of rows) {
    if (sameRevision(r.sop_revision, revision)) continue;
    const key = r.employee_user_id || String(r.employee_name || '').trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(r.employee_user_id ? { user_id: r.employee_user_id } : { name: r.employee_name });
  }
  return out;
}

/**
 * Mark a course for its document's approved revision — `updated` or
 * `no_change` — and assign the retraining that unlocks. Refused when the course
 * has no approved document, or already teaches that revision.
 */
export function markCourseRevision(db, course, { kind, note, actor, due_date = null }) {
  if (!MARK_KINDS[kind]) throw new CourseRevisionError('Say whether the course was updated, or needs no change, for this revision.');
  if (!course.sop_id) throw new CourseRevisionError('This course is not linked to a document.');
  const revision = docRevisionFor(db, course);
  if (!revision) throw new CourseRevisionError('The linked document has no approved revision in force.', 409);
  if (sameRevision(course.built_on_revision, revision) && course.built_on_kind !== 'linked') {
    throw new CourseRevisionError(`This course is already marked for revision ${revision}.`, 409);
  }
  const doc = db.prepare('SELECT doc_number, title FROM sop_documents WHERE id = ?').get(course.sop_id);
  const trimmed = String(note || '').trim().slice(0, 500) || null;
  if (kind === 'no_change' && !trimmed) throw new CourseRevisionError('Say why the course needs no change for this revision.');
  const before = { built_on_revision: course.built_on_revision, built_on_kind: course.built_on_kind };
  db.prepare(`UPDATE training_courses SET built_on_revision = ?, built_on_kind = ?, built_on_by = ?, built_on_by_id = ?,
      built_on_at = ?, built_on_note = ?, updated_at = datetime('now') WHERE id = ?`)
    .run(revision, kind, actor?.name || null, actor?.id || null, new Date().toISOString(), trimmed, course.id);

  // Retraining, only now, and only for a course that retrains on a document change.
  let created = []; let skipped = []; let audience = 0;
  if (course.retrain_on_doc_change) {
    const people = retrainingAudience(db, course, revision);
    audience = people.length;
    if (people.length) {
      const out = assignTraining(db, {
        course_id: course.id, people, due_date,
        assigned_by: actor?.name || 'ReadyDoc', source: 'revision',
        reason: `Retraining: ${doc?.doc_number || doc?.title || 'document'} revision ${revision}`,
      });
      created = out.created || []; skipped = out.skipped || [];
    }
  }
  logAudit(actor, 'update', 'training_course', course.id,
    { action: 'built_on_revision', kind, revision, note: trimmed, retraining_assigned: created.length, retraining_skipped: skipped.length },
    before, { built_on_revision: revision, built_on_kind: kind }, course.code || course.title);
  return { revision, kind, audience, created, skipped };
}
