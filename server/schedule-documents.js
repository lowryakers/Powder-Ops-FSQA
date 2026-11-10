// A recurring task follows a controlled document (D-328).
//
// The steps on a recurring task are written from an SOP or a WI, and nothing
// tied the two together: approving a new revision of the SOP left the task
// giving last revision's steps until somebody remembered. A schedule now names
// the document it follows (`pm_schedules.document_id`) and the revision it was
// last checked against. A newer approved revision puts it on Doc Control Review
// — "these tasks follow a document that changed: check them" — and it leaves
// the list when somebody marks it checked or edits it to match.
//
// DERIVED on every read: nothing is raised, nothing stored but the link and the
// revision last checked.

const ACTIVE_DOC = "d.status != 'archived'";

/** Active schedules whose document has an approved revision they were not checked against. */
export function schedulesToCheck(db, limit = 200) {
  return db.prepare(`SELECT s.id, s.title, s.task_group, s.document_revision_checked,
      d.id AS document_id, d.doc_number, d.title AS document_title, d.revision AS document_revision
    FROM pm_schedules s JOIN sop_documents d ON d.id = s.document_id
    WHERE s.is_active = 1 AND ${ACTIVE_DOC}
      AND COALESCE(s.document_revision_checked, '') != COALESCE(d.revision, '')
    ORDER BY d.doc_number, s.title LIMIT ?`).all(limit);
}

/** The recurring tasks that follow one document. */
export function schedulesForDocument(db, documentId) {
  const doc = db.prepare('SELECT revision FROM sop_documents WHERE id = ?').get(documentId);
  return db.prepare(`SELECT id, title, task_group, is_active, document_revision_checked FROM pm_schedules
    WHERE document_id = ? ORDER BY is_active DESC, title`).all(documentId)
    .map(s => ({ ...s, needs_check: !!s.is_active && (s.document_revision_checked || '') !== (doc?.revision || '') }));
}

/** Link a schedule to a document; it starts checked against the revision in force. */
export function linkSchedule(db, scheduleId, documentId) {
  const doc = db.prepare('SELECT id, revision FROM sop_documents WHERE id = ?').get(documentId);
  if (!doc) return { error: 'Document not found', status: 404 };
  const s = db.prepare('SELECT id, document_id FROM pm_schedules WHERE id = ?').get(scheduleId);
  if (!s) return { error: 'Recurring task not found', status: 404 };
  db.prepare('UPDATE pm_schedules SET document_id = ?, document_revision_checked = ? WHERE id = ?')
    .run(doc.id, doc.revision || '', s.id);
  return { ok: true, previous: s.document_id || null };
}

export function unlinkSchedule(db, scheduleId, documentId) {
  const r = db.prepare('UPDATE pm_schedules SET document_id = NULL, document_revision_checked = NULL WHERE id = ? AND document_id = ?')
    .run(scheduleId, documentId);
  return r.changes ? { ok: true } : { error: 'That task does not follow this document.', status: 404 };
}

/** "I have looked at this task against the new revision." */
export function markScheduleChecked(db, scheduleId) {
  const row = db.prepare(`SELECT s.id, d.revision FROM pm_schedules s JOIN sop_documents d ON d.id = s.document_id WHERE s.id = ?`).get(scheduleId);
  if (!row) return { error: 'That task does not follow a document.', status: 404 };
  db.prepare('UPDATE pm_schedules SET document_revision_checked = ? WHERE id = ?').run(row.revision || '', row.id);
  return { ok: true, revision: row.revision || '' };
}

/** Recurring tasks to pick from when linking (title search). */
export function findSchedules(db, q, limit = 50) {
  const like = `%${String(q || '').trim()}%`;
  return db.prepare(`SELECT s.id, s.title, s.task_group, s.is_active, s.document_id, d.doc_number AS linked_to
    FROM pm_schedules s LEFT JOIN sop_documents d ON d.id = s.document_id
    WHERE s.title LIKE ? ORDER BY s.is_active DESC, s.title LIMIT ?`).all(like, limit);
}
