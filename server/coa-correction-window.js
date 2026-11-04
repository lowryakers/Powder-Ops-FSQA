// THE COA CORRECTION WINDOW (D-307). A temporary relaxation, off by default.
//
// Un-signing a certificate is an admin's act (D-224), or Quality's while an open
// QA Review item names that request (D-236). This adds one more door, and only
// for a while: an admin opens a WINDOW, names the QA people it covers, says why,
// and gives it an end (default 7 days, never more than 14). Inside it those
// people may un-sign a certificate to correct a wrong date, lot, expiry or a
// misread result — with a reason, a plan of what they will correct, and their
// password. Deleting a request is NEVER widened by a window.
//
// Three things make it safe to hand out:
//  - EXPIRY IS CHECKED ON EVERY CALL against the clock, so nothing depends on a
//    job having run; the nightly pass only marks rows and writes the audit.
//  - THE ORIGINAL SIGNATURE IS KEPT. Before any un-sign clears the request, the
//    signature image, snapshot, hash and number go into coa_signature_history,
//    which triggers make append-only. Before D-307 they were simply NULLed.
//  - A REOPENED CERTIFICATE CAN ONLY LEAVE THAT STATE BY BEING SIGNED AGAIN.
//    Window expiry does not re-sign it: it stays reopened, its PDF is not
//    issued, and it is listed for QA (and fails the readiness line at 3 days).
import { v4 as uuid } from 'uuid';
import { isQaReviewer } from './qa-signing.js';
import { isBotAccount } from './trainees.js';

export const WINDOW_DEFAULT_HOURS = 168;
export const WINDOW_MAX_HOURS = 336;
export const WINDOW_MIN_REASON = 20;
export const UNSIGN_WINDOW_MIN_REASON = 10;
export const REOPENED_STALE_DAYS = 3;

const parseScope = (raw) => { try { const a = JSON.parse(raw || '[]'); return Array.isArray(a) ? a : []; } catch { return []; } };
const nowIso = (now = new Date()) => now.toISOString();

/** A window row as the screen and the API read it. */
export function windowView(db, w, now = new Date()) {
  if (!w) return null;
  const scope = parseScope(w.scope);
  const live = w.status === 'open' && new Date(w.expires_at) > now;
  const names = scope.length
    ? db.prepare(`SELECT id, name FROM users WHERE id IN (${scope.map(() => '?').join(',')})`).all(...scope)
    : [];
  const byId = Object.fromEntries(names.map(u => [u.id, u.name]));
  return { ...w, scope, people: scope.map(id => ({ id, name: byId[id] || null })),
    state: live ? 'open' : (w.status === 'open' ? 'expired' : w.status) };
}

/** Every window, newest first. */
export function listWindows(db, now = new Date()) {
  return db.prepare('SELECT * FROM coa_correction_windows ORDER BY opened_at DESC, rowid DESC').all().map(w => windowView(db, w, now));
}

/** The open, unexpired window that covers this user, or null. */
export function activeWindowFor(db, user, now = new Date()) {
  if (!user?.id) return null;
  let rows;
  try { rows = db.prepare("SELECT * FROM coa_correction_windows WHERE status = 'open'").all(); } catch { return null; }
  return rows.find(w => new Date(w.expires_at) > now && parseScope(w.scope).includes(user.id)) || null;
}

/** Why a window cannot be opened as asked; null when it can. Pure. */
export function openWindowRefusal({ user_ids, hours, reason }) {
  if (!Array.isArray(user_ids) || !user_ids.length) return 'Name at least one person the window covers.';
  const h = hours == null || hours === '' ? WINDOW_DEFAULT_HOURS : Number(hours);
  if (!Number.isInteger(h) || h < 1 || h > WINDOW_MAX_HOURS) return `The window lasts 1 to ${WINDOW_MAX_HOURS} hours (14 days).`;
  if (String(reason || '').trim().length < WINDOW_MIN_REASON) return `Say why the window is needed (at least ${WINDOW_MIN_REASON} characters).`;
  return null;
}

/** Opens a window. The caller has checked admin + password. */
export function openWindow(db, user, { user_ids, hours, reason }, now = new Date()) {
  const refusal = openWindowRefusal({ user_ids, hours, reason });
  if (refusal) return { status: 400, error: refusal };
  const ids = [...new Set(user_ids.map(String))];
  const people = db.prepare(`SELECT id, name, role, department, module_access, is_active FROM users WHERE id IN (${ids.map(() => '?').join(',')})`).all(...ids);
  const missing = ids.filter(id => !people.some(p => p.id === id));
  if (missing.length) return { status: 400, error: `No such account: ${missing.join(', ')}.` };
  const parsed = people.map(p => ({ ...p, module_access: (() => { try { return JSON.parse(p.module_access || 'null'); } catch { return p.module_access; } })() }));
  // A bot account never signs or un-signs (D-279), so a window never covers one.
  const notQa = parsed.filter(p => !p.is_active || !isQaReviewer(p) || isBotAccount(db, p));
  if (notQa.length) return { status: 400, error: `A window covers active Quality reviewers only. Not one: ${notQa.map(p => p.name).join(', ')}.` };
  const h = hours == null || hours === '' ? WINDOW_DEFAULT_HOURS : Number(hours);
  const id = uuid();
  const expires = new Date(now.getTime() + h * 3600 * 1000).toISOString();
  db.prepare(`INSERT INTO coa_correction_windows (id, opened_by, opened_by_id, opened_at, expires_at, reason, scope)
    VALUES (?, ?, ?, ?, ?, ?, ?)`).run(id, user.name, user.id || null, nowIso(now), expires, String(reason).trim(), JSON.stringify(ids));
  return { window: windowView(db, db.prepare('SELECT * FROM coa_correction_windows WHERE id = ?').get(id), now) };
}

/** Closes a window early. */
export function closeWindow(db, user, id, reason, now = new Date()) {
  const w = db.prepare('SELECT * FROM coa_correction_windows WHERE id = ?').get(id);
  if (!w) return { status: 404, error: 'No such correction window.' };
  if (w.status !== 'open') return { status: 409, error: `This window is already ${w.status}.` };
  db.prepare("UPDATE coa_correction_windows SET status = 'closed', closed_by = ?, closed_at = ?, close_reason = ? WHERE id = ?")
    .run(user.name, nowIso(now), String(reason || '').trim() || null, id);
  return { window: windowView(db, db.prepare('SELECT * FROM coa_correction_windows WHERE id = ?').get(id), now), before: w };
}

/** The nightly pass: marks open windows past their end as expired. Returns the ones it marked. */
export function expireWindows(db, now = new Date()) {
  const due = db.prepare("SELECT * FROM coa_correction_windows WHERE status = 'open' AND expires_at <= ?").all(nowIso(now));
  const mark = db.prepare("UPDATE coa_correction_windows SET status = 'expired' WHERE id = ? AND status = 'open'");
  for (const w of due) mark.run(w.id);
  return due;
}

/** Keeps the signature that is about to be removed. Never deleted. */
export function recordSignatureHistory(db, request, { user, reason, field_plan = null, window_id = null }) {
  const id = uuid();
  db.prepare(`INSERT INTO coa_signature_history (id, request_id, certificate_number, date_of_issuance, qa_signed_by, qa_signed_by_id,
    qa_signed_at, qa_signature, signed_snapshot, signed_content_hash, unsigned_by, unsigned_by_id, reason, field_plan, window_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, request.id, request.certificate_number || null, request.date_of_issuance || null, request.qa_signed_by || null,
      request.qa_signed_by_id || null, request.qa_signed_at || null, request.qa_signature || null, request.signed_snapshot || null,
      request.signed_content_hash || null, user.name, user.id || null, reason, field_plan, window_id);
  return id;
}

/** The signatures this request has had removed, oldest first, without the images. */
export function signatureHistoryFor(db, requestId) {
  return db.prepare(`SELECT id, request_id, certificate_number, date_of_issuance, qa_signed_by, qa_signed_at, signed_content_hash,
    unsigned_by, unsigned_at, reason, field_plan, window_id, (qa_signature IS NOT NULL) AS has_signature_image,
    (signed_snapshot IS NOT NULL) AS has_snapshot
    FROM coa_signature_history WHERE request_id = ? ORDER BY unsigned_at, rowid`).all(requestId)
    .map(h => ({ ...h, has_signature_image: !!h.has_signature_image, has_snapshot: !!h.has_snapshot }));
}

/** Requests reopened for correction and not yet re-signed, with their age. */
export function reopenedRequests(db, now = new Date()) {
  return db.prepare(`SELECT id, item_number, item_description, lot_number, reopened_at, reopened_window_id, reopened_reason,
    supersedes_certificate_number FROM coa_requests WHERE reopened_for_correction = 1 ORDER BY reopened_at`).all()
    .map(r => {
      const t = Date.parse(String(r.reopened_at || '').replace(' ', 'T') + (/[zZ]|[+-]\d\d:?\d\d$/.test(r.reopened_at || '') ? '' : 'Z'));
      const days = Number.isFinite(t) ? Math.floor((now - t) / 86400000) : null;
      return { ...r, days_open: days, stale: days != null && days > REOPENED_STALE_DAYS };
    });
}

/**
 * While a request is reopened, who may change its lot details and results:
 * an admin, or a QA reviewer the window that reopened it covers (if that window
 * is still open). Returns null when allowed, else the refusal text.
 */
export function reopenedEditRefusal(db, user, request, now = new Date()) {
  if (!request?.reopened_for_correction) return null;
  if (user?.role === 'admin') return null;
  const w = request.reopened_window_id ? db.prepare('SELECT * FROM coa_correction_windows WHERE id = ?').get(request.reopened_window_id) : null;
  if (w && w.status === 'open' && new Date(w.expires_at) > now && parseScope(w.scope).includes(user?.id) && isQaReviewer(user)) return null;
  // Reopened by an admin or a QA Review item (no window): Quality may correct.
  if (!request.reopened_window_id && isQaReviewer(user)) return null;
  return 'This certificate is reopened for correction. Only an admin, or a Quality reviewer the correction window covers, may change it while it is open.';
}
