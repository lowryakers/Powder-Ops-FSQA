// A group training session waiting to be recorded (D-352).
//
// When a course is marked updated for its document's new revision, the people
// who were trained on the old one owe it again (D-277 assigns each a task). The
// trainer then records ONE session for them — and had to pick every one of them
// by hand. This writes that session out ahead of time: the course, the revision
// and the people, ready to open in Group Training. It is never a record; the
// records are written only when someone records the session (bulk-complete),
// with the password, exactly as before.
import { v4 as uuid } from 'uuid';
import { logAudit } from './db.js';

const parse = (t) => { try { const v = JSON.parse(t || '[]'); return Array.isArray(v) ? v : []; } catch { return []; } };

/** `people` is retrainingAudience()'s output: { user_id } or { name }. */
export function createSessionDraft(db, { course, revision, people, reason, actor }) {
  const byId = db.prepare('SELECT id, name, is_active FROM users WHERE id = ?');
  const byName = db.prepare('SELECT id, name, is_active FROM users WHERE lower(name) = lower(?) AND is_active = 1');
  const out = [];
  const seen = new Set();
  for (const p of people || []) {
    const u = p.user_id ? byId.get(p.user_id) : byName.all(p.name || '').length === 1 ? byName.get(p.name) : null;
    if (u && u.is_active === 0) continue;               // left the plant: owes nothing
    const key = u ? u.id : `name:${String(p.name || '').toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(u ? { user_id: u.id, name: u.name } : { user_id: null, name: p.name });
  }
  if (!out.length) return null;
  // One open draft per course and revision: marking twice must not file two.
  const existing = db.prepare(`SELECT id FROM training_session_drafts WHERE course_id = ? AND COALESCE(sop_revision,'') = COALESCE(?, '') AND status = 'open'`)
    .get(course.id, revision || null);
  if (existing) return existing.id;
  const id = uuid();
  db.prepare(`INSERT INTO training_session_drafts (id, course_id, sop_id, sop_revision, people, reason, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?)`).run(id, course.id, course.sop_id || null, revision || null, JSON.stringify(out), reason || null, actor?.name || 'ReadyDoc');
  logAudit(actor || 'ReadyDoc', 'create', 'training_session_draft', id, { course_id: course.id, revision, people: out.length }, null, null, course.code || course.title);
  return id;
}

export function openSessionDrafts(db) {
  return db.prepare(`SELECT d.*, c.code AS course_code, c.title AS course_title, s.doc_number
      FROM training_session_drafts d JOIN training_courses c ON c.id = d.course_id
      LEFT JOIN sop_documents s ON s.id = d.sop_id
      WHERE d.status = 'open' ORDER BY d.created_at DESC`).all()
    .map(d => ({ ...d, people: parse(d.people) }));
}

/** Recorded through bulk-complete: the draft closes and points at the session. */
export function markSessionDraftUsed(db, draftId, sessionId, actor) {
  if (!draftId) return false;
  const r = db.prepare(`UPDATE training_session_drafts SET status = 'recorded', session_id = ?, closed_by = ?, closed_at = datetime('now')
    WHERE id = ? AND status = 'open'`).run(sessionId, actor?.name || null, draftId);
  return r.changes > 0;
}

export function dismissSessionDraft(db, draftId, reason, actor) {
  const why = String(reason || '').trim();
  if (why.length < 3) return { error: 'Say why this session will not be recorded.', status: 400 };
  const r = db.prepare(`UPDATE training_session_drafts SET status = 'dismissed', close_reason = ?, closed_by = ?, closed_at = datetime('now')
    WHERE id = ? AND status = 'open'`).run(why, actor?.name || null, draftId);
  if (!r.changes) return { error: 'No open session draft with that id.', status: 404 };
  logAudit(actor, 'dismiss', 'training_session_draft', draftId, { reason: why });
  return { ok: true };
}
