// PROVE IT IS YOU, AT THE MOMENT YOU SIGN.
//
// A QA signature is the plant's statement that a named person reviewed a record
// and accepted it. Until now the only thing standing behind that name was a
// session opened at some point earlier in the day — on a shared floor tablet
// that can be hours ago and two people back. 21 CFR 11.200 asks for the
// signature to be executed with at least one component the signer alone
// supplies, at the time of signing; this is that component.
//
// ONE DEFINITION, FOUR DOORS. Production sign-off, sanitation/QA verification,
// scale verification and the QA Review batch all call this. A second copy is
// how one of them quietly stops asking.
//
// A BATCH IS ONE ACT. QA Review signs many records at once, and demanding the
// password per record would make the queue unusable — which is how a control
// gets switched off. The password authenticates the ACT of signing; the batch
// then records a signature per record as it always did.
//
// THE PASSWORD IS NEVER STORED, LOGGED OR ECHOED. What is recorded is that the
// signature was verified, and when.
import crypto from 'crypto';
import { getDb, logAudit } from './db.js';

/**
 * Compare a password against a stored `salt:hash`.
 *
 * The same scrypt shape `api/users.js` writes. Kept here rather than imported
 * from there because users.js imports the auth middleware and this is used by
 * four routers — a shared leaf beats an import cycle.
 */
export function passwordMatches(password, stored) {
  if (!stored || !String(stored).includes(':')) return false;
  const [salt, hash] = String(stored).split(':');
  try {
    const test = crypto.scryptSync(String(password ?? ''), salt, 64);
    const known = Buffer.from(hash, 'hex');
    return known.length === test.length && crypto.timingSafeEqual(known, test);
  } catch { return false; }
}

// A signature endpoint that accepts unlimited guesses is a password oracle that
// happens to also file records. In memory rather than a table: the window is
// five minutes, a restart clearing it is not a meaningful weakening, and a
// write on every failed attempt is a write on a path that must stay fast.
const WINDOW_MS = 5 * 60 * 1000;
const MAX_FAILURES = 5;
const failures = new Map();

function recentFailures(userId) {
  const list = (failures.get(userId) || []).filter((t) => Date.now() - t < WINDOW_MS);
  if (list.length) failures.set(userId, list); else failures.delete(userId);
  return list;
}

export function noteSignatureFailure(userId) {
  const list = recentFailures(userId);
  list.push(Date.now());
  failures.set(userId, list);
  return list.length;
}

export function clearSignatureFailures(userId) { failures.delete(userId); }

/** Test seam — the limiter is process-wide and would otherwise leak between cases. */
export function resetSignatureLimiter() { failures.clear(); }

/**
 * The gate. Returns `null` when the signature may proceed, or `{ status, error }`.
 *
 * CALLED BEFORE ANY WRITE. A signature half-applied and then refused is worse
 * than one refused outright, and in the batch case it would leave some records
 * signed and some not with nothing saying which.
 */
export function requireSignature(req, { action = 'signature' } = {}) {
  const user = req.user;
  if (!user?.id) return { status: 401, error: 'Sign in again to sign this record.' };

  const db = getDb();
  const row = db.prepare('SELECT password_hash, must_change_password, name, username FROM users WHERE id = ?').get(user.id);
  // Everybody who can hold a session has a password — the PIN bridge sets one
  // before a session is ever issued — so this is a broken account, not a
  // routine state, and it must not silently wave the signature through.
  if (!row?.password_hash) {
    return { status: 403, error: 'This account has no password set, so it cannot sign. Set one under your account first.' };
  }

  // A temporary password from an admin reset cannot sign (D-292): the admin
  // knows it. No signature_required flag, so the screen shows this sentence
  // rather than asking for the password again.
  if (row.must_change_password) {
    return { status: 403, error: 'You signed in with a temporary password, and it cannot sign. Choose your own password first.', temporary_password: true };
  }

  const tries = recentFailures(user.id).length;
  if (tries >= MAX_FAILURES) {
    return { status: 429, error: 'Too many incorrect passwords. Wait a few minutes and try again.' };
  }

  // THE FIRST SIGNATURE OF A SESSION TAKES BOTH COMPONENTS (D-292, 21 CFR
  // 11.200(a)(1)(i)): the sign-in name AND the password. Later signatures in
  // the same session take the password alone. A token session never signs.
  const firstOfSession = needsNameNow(user);
  const password = req.body?.signature_password;
  if (firstOfSession && (!password || !req.body?.signature_name)) {
    return { status: 403, error: 'This is your first signature since you signed in. Type your sign-in name and your password.', signature_required: true, signature_name_required: true };
  }
  if (!password) {
    // 403, NOT 401, and this is load-bearing: the client clears the token and
    // logs out on any 401, so asking for a password that way would sign QA out
    // every time they pressed Sign. The session is fine — this act needs a
    // second factor, which is what 403 with a flag says.
    return { status: 403, error: 'Confirm your password to sign.', signature_required: true };
  }

  if (!passwordMatches(password, row.password_hash)) {
    const n = noteSignatureFailure(user.id);
    logAudit(user, 'signature_failed', 'user', user.id, { action, attempt: n });
    return {
      status: 403,
      error: n >= MAX_FAILURES
        ? 'Incorrect password. Too many attempts — wait a few minutes.'
        : 'That password is not correct.',
      signature_required: true,
    };
  }

  if (firstOfSession && !nameMatches(req.body.signature_name, row)) {
    const n = noteSignatureFailure(user.id);
    logAudit(user, 'signature_failed', 'user', user.id, { action, attempt: n, reason: 'name' });
    return { status: 403, error: 'That name is not the one you signed in with.', signature_required: true, signature_name_required: true };
  }

  clearSignatureFailures(user.id);
  if (firstOfSession && user.session?.id) {
    const at = new Date().toISOString();
    db.prepare('UPDATE sessions SET first_signed_at = ? WHERE id = ? AND first_signed_at IS NULL').run(at, user.session.id);
    user.session.first_signed_at = at; // a batch in this request is one act
  }
  return null;
}

const fold = (v) => String(v ?? '').trim().replace(/\s+/g, ' ').toLowerCase();

/** The typed name is the account's sign-in name or its full name. */
export function nameMatches(typed, row) {
  const t = fold(typed);
  return !!t && (t === fold(row?.username) || t === fold(row?.name));
}

/**
 * Whether this signature must also carry the name. Only a session that has
 * not signed yet. SIGNATURE_NAME_OPTIONAL is a TEST-ONLY switch, honoured only
 * under NODE_ENV=test, so the older verifies that sign with a password alone
 * keep testing what they test; verify:sessionsec runs with it
 * off. The installation qualification confirms NODE_ENV is production.
 */
function needsNameNow(user) {
  if (!user?.session) return false;
  if (user.session.first_signed_at) return false;
  if (process.env.NODE_ENV === 'test' && process.env.SIGNATURE_NAME_OPTIONAL === '1') return false;
  return true;
}

/**
 * What goes in the audit entry beside the signature.
 *
 * The record's own columns already carry who signed and when. This says the act
 * was authenticated at the time, which is the part an auditor asks about and
 * the part that was previously missing.
 */
export function signatureEvidence() {
  return { signature_verified: true, verified_at: new Date().toISOString(), verified_via: 'password' };
}

/** Convenience for a route: answers the response itself and returns false. */
export function gateSignature(req, res, opts) {
  const bad = requireSignature(req, opts);
  if (!bad) return true;
  const { status, ...body } = bad;
  res.status(status).json(body);
  return false;
}
