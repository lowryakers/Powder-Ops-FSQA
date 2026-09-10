// Issuing a signed-in session.
//
// Extracted from users.js rather than copied, because there is now a second way
// in — the auditor pass (api/auditor-pass.js) — and a session minted two
// slightly different ways is exactly the "two mechanisms disagreeing" failure
// this codebase keeps running into. What a session contains, how long it lasts
// and which fields the client is handed are decided here and nowhere else.
import crypto from 'crypto';
import { v4 as uuid } from 'uuid';
import { passwordDaysLeft, passwordExpired } from '../password-policy.js';
import { setFileCookie } from '../middleware/auth.js';
import { disconnectUser } from '../realtime.js';

const SESSION_DAYS = 30;

// `res` is optional and only used to set the file cookie. It lives HERE rather
// than at the three call sites for the same reason the rest of this function
// does: a session issued by a door that forgot the cookie is one where the
// person's photographs silently stop loading.
//
// `notAfter` caps the session short of the usual 30 days. The auditor pass
// needs it: a one-day pass that minted a thirty-day session made the `days`
// on the pass decorative past the first redeem, and nothing later reconciled
// the two. A session can never outlive the credential that opened it.
export function issueSession(db, user, res = null, { notAfter = null } = {}) {
  const token = crypto.randomBytes(32).toString('hex');
  const expires = new Date();
  expires.setDate(expires.getDate() + SESSION_DAYS);
  const cap = notAfter ? new Date(notAfter) : null;
  if (cap && !Number.isNaN(cap.getTime()) && cap < expires) expires.setTime(cap.getTime());
  db.prepare('INSERT INTO sessions (id, user_id, token, expires_at) VALUES (?, ?, ?, ?)')
    .run(uuid(), user.id, token, expires.toISOString());
  setFileCookie(res, token, Math.max(1, Math.ceil((expires - Date.now()) / 86400000)));

  const moduleAccess = user.module_access ? JSON.parse(user.module_access) : null;
  let quickTabs;
  try { quickTabs = user.quick_tabs ? JSON.parse(user.quick_tabs) : null; } catch { quickTabs = null; }

  return {
    token,
    user: {
      id: user.id,
      name: user.name,
      username: user.username || user.name,
      role: user.role,
      department: user.department || 'warehouse',
      module_access: moduleAccess,
      home_workspace: user.home_workspace || 'fsqa',
      quick_tabs: quickTabs,
      password_days_left: passwordDaysLeft(user.password_changed_at),
      password_expired: passwordExpired(user.password_changed_at),
    },
  };
}

/**
 * Cut every live session an account holds, and drop the sockets behind them.
 *
 * ONE HELPER, EVERY DOOR. Deactivation in Settings, ending a contractor's
 * access, revoking an auditor pass and a self-service password change all
 * used to do this differently, or not at all: the auth middleware refuses a
 * deactivated account on the next request, which hid that nothing had
 * actually deleted the rows — so a reactivated account came back with every
 * phone it was ever signed in on, and a revoked auditor pass changed nothing
 * for the visitor who had already redeemed it. Sessions are rows, sockets
 * are connections, push subscriptions are devices; a revocation has to reach
 * all three or it is scheduling access to end rather than ending it.
 *
 * `keepToken` is for the person changing their own password: that session
 * stays, every other one goes.  `devices: true` also forgets the push
 * subscriptions, which is right when the ACCOUNT is being switched off and
 * wrong on a password change (the phone is still theirs).
 */
export function revokeSessions(db, userId, { keepToken = null, devices = false } = {}) {
  if (!userId) return 0;
  const r = keepToken
    ? db.prepare('DELETE FROM sessions WHERE user_id = ? AND token != ?').run(userId, keepToken)
    : db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
  if (devices) {
    try { db.prepare('DELETE FROM chat_push_subscriptions WHERE user_id = ?').run(userId); } catch { /* table may not exist */ }
  }
  try { disconnectUser(userId, { keepToken }); } catch { /* realtime not started (tests, scripts) */ }
  return r.changes;
}
