// Filing a training completion — the ONE writer, so a completion filed from
// the Training Records screen and one filed by finishing an assigned task are
// byte-for-byte the same record.
//
// Extracted from api/training.js rather than copied when assignments shipped:
// `check-records.js` files the record a completed assignment is evidence for,
// and a second insert there would be a second answer to "what does a
// completion look like" — the drift this codebase keeps unpicking. Same
// arrangement as `capa-raise.js`, which both the internal audit and the check
// records raise CARs through.

import { v4 as uuid } from 'uuid';

export const addMonths = (isoDate, months) => {
  if (!isoDate || !months) return null;
  const d = new Date(isoDate + (isoDate.length <= 10 ? 'T00:00:00' : ''));
  if (Number.isNaN(d.getTime())) return null;
  d.setMonth(d.getMonth() + months);
  return d.toISOString().slice(0, 10);
};

/** A completion's retraining due date, from the course's own cadence. */
export function dueDateFor(db, courseId, completionDate) {
  if (!courseId || !completionDate) return null;
  const c = db.prepare('SELECT retrain_months FROM training_courses WHERE id = ?').get(courseId);
  if (!c || !c.retrain_months) return null;
  return addMonths(completionDate, c.retrain_months);
}

/**
 * Mark earlier completions of the same course by the same person superseded,
 * so the matrix reflects the most recent one.
 *
 * MATCHED ON THE ACCOUNT WHERE THERE IS ONE, the name otherwise. Name-only
 * matching left a renamed person with two "current" completions — the record
 * filed under the old spelling was never superseded — the same split the
 * time-adjustment and pay-roster keys had.
 */
export function supersedeOlder(db, employeeName, courseId, keepId, employeeUserId = null) {
  if (!courseId) return;
  db.prepare(`UPDATE training_records SET superseded = 1
    WHERE id != ? AND course_id = ?
      AND (LOWER(employee_name) = LOWER(?) OR (? IS NOT NULL AND employee_user_id = ?))`)
    .run(keepId, courseId, employeeName, employeeUserId, employeeUserId);
}

/** The revision of a course's linked document that current training must reflect. */
export function courseTrainingRevision(db, courseId) {
  if (!courseId) return null;
  const c = db.prepare('SELECT sop_id FROM training_courses WHERE id = ?').get(courseId);
  if (!c?.sop_id) return null;
  const d = db.prepare('SELECT training_revision, revision FROM sop_documents WHERE id = ?').get(c.sop_id);
  return d?.training_revision || d?.revision || null;
}

/** File one completion. Returns the stored row. */
export function insertCompletion(db, body) {
  const id = uuid();
  const completion = body.completion_date || (body.status === 'completed' ? (body.training_date || new Date().toISOString().slice(0, 10)) : null);
  const next_due = dueDateFor(db, body.course_id, completion);
  // Stamp the document revision this completion was trained against.
  const sopRevision = body.sop_revision || courseTrainingRevision(db, body.course_id);
  db.prepare(`INSERT INTO training_records
    (id, employee_name, employee_id, employee_user_id, training_topic, course_id, sop_id, trainer, method,
     training_date, completion_date, status, passed, score, next_due_date, certificate_url, document_url, gdrive_url, test_attempt_id, notes, sop_revision)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    id, body.employee_name, body.employee_id || null, body.employee_user_id || null,
    body.training_topic || body.course_title || '', body.course_id || null, body.sop_id || null,
    body.trainer || null, body.method || null,
    body.training_date || new Date().toISOString().slice(0, 10), completion,
    body.status || (completion ? 'completed' : 'scheduled'),
    body.passed === undefined ? null : (body.passed ? 1 : 0), body.score ?? null, next_due,
    body.certificate_url || null, body.document_url || null, body.gdrive_url || null, body.test_attempt_id || null, body.notes || null, sopRevision);
  if (body.status === 'completed' || completion) supersedeOlder(db, body.employee_name, body.course_id, id, body.employee_user_id || null);
  return db.prepare('SELECT * FROM training_records WHERE id = ?').get(id);
}
