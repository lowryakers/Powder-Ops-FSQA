// Password age policy.
//
// Its own module because BOTH the auth middleware and the users API need it,
// and users.js already imports requireRole from the middleware — putting these
// helpers in users.js would close an import cycle, which ESM tolerates right up
// until the day one of them is needed at module-init time.
//
// A password must be changed at least once a year. Expiry is enforced in the
// middleware, not only on the login screen: a rule the client alone applies is
// a suggestion, and "how do you enforce it" deserves a better answer than "the
// UI asks nicely".
//
// Expiry deliberately does NOT clear password_hash. The admin reset does that,
// and its whole point is that the next sign-in sets a new password WITHOUT
// proving the old one. Doing the same on expiry would mean anyone who knew a
// username could take the account the day it lapsed.

export const PASSWORD_MAX_AGE_DAYS = 365;
export const PASSWORD_WARN_DAYS = 14;

/**
 * Days until this password must be changed. Negative or zero = overdue.
 * `null` when there is no clock yet (a user who has never set a password), and
 * a null NEVER blocks anyone — the set-password flow handles that case.
 */
export function passwordDaysLeft(changedAt) {
  if (!changedAt) return null;
  const raw = String(changedAt);
  // SQLite datetime('now') is "YYYY-MM-DD HH:MM:SS" in UTC with no zone marker.
  const set = new Date(raw.includes('T') ? raw : raw.replace(' ', 'T') + 'Z');
  if (Number.isNaN(set.getTime())) return null;
  const ageDays = (Date.now() - set.getTime()) / 86400000;
  return Math.ceil(PASSWORD_MAX_AGE_DAYS - ageDays);
}

export function passwordExpired(changedAt) {
  const left = passwordDaysLeft(changedAt);
  return left !== null && left <= 0;
}
