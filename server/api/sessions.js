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

const SESSION_DAYS = 30;

// `res` is optional and only used to set the file cookie. It lives HERE rather
// than at the three call sites for the same reason the rest of this function
// does: a session issued by a door that forgot the cookie is one where the
// person's photographs silently stop loading.
export function issueSession(db, user, res = null) {
  const token = crypto.randomBytes(32).toString('hex');
  const expires = new Date();
  expires.setDate(expires.getDate() + SESSION_DAYS);
  db.prepare('INSERT INTO sessions (id, user_id, token, expires_at) VALUES (?, ?, ?, ?)')
    .run(uuid(), user.id, token, expires.toISOString());
  setFileCookie(res, token, SESSION_DAYS);

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
