// A join link: one text, one tap, choose a password, and you are in the
// channel you were invited to.
//
// WHY THIS EXISTS AND `users.setup_code` DOES NOT COVER IT. A setup code is
// eight readable characters an administrator reads out to somebody standing in
// the room. Five of the people who need an account here work at another company
// and have never been in the building, so there is nobody to read it to them —
// and an eight-character code dictated over the phone, typed into a login
// screen after their own name, is three chances to give up. A link is one tap.
//
// THE RULES ARE THE ONES EVERY OTHER TOKEN IN THIS CODEBASE FOLLOWS
// (`/approve`, `/nfp`, `/partner`, `/supplier-form`):
//   • stored as SHA-256, clear text returned exactly ONCE, looked up by an
//     indexed hash rather than a cleartext scan;
//   • SINGLE USE — spent by the password it sets, so a link forwarded on, left
//     in a message thread or read off a lock screen a week later is dead;
//   • FOURTEEN DAYS, matching the setup code, so the two doors into the same
//     account cannot be open for different lengths of time;
//   • issuing a new one kills the live one, because "I lost the link" must not
//     leave two working;
//   • revocable, and every refusal says WHICH of used / revoked / expired /
//     already-has-a-password it was. "Link not valid" makes the office guess.
//
// AND ONE RULE THAT IS THIS LINK'S OWN: IT IS ONLY EVER ISSUED FOR AN ACCOUNT
// WITH NO PASSWORD. A link that could set a password on an account that already
// has one is a takeover for whoever holds the text, and it would be issued by
// the same button people press without thinking. Somebody who has forgotten
// their password goes through Reset password — which clears the hash as a
// deliberate act — and can then be sent a link.
import crypto from 'crypto';
import { v4 as uuid } from 'uuid';
import { readyDocOrigin } from './links.js';

export const INVITE_DAYS = 14;

export const newInviteToken = () => crypto.randomBytes(16).toString('hex');
export const hashInviteToken = (t) => crypto.createHash('sha256').update(String(t)).digest('hex');

export const inviteUrl = (token) => `${readyDocOrigin()}/join/${token}`;

/** Ten digits, or null. The one reading of a phone number in this app. */
export const tenDigits = (v) => (String(v ?? '').replace(/\D/g, '').slice(-10) || null);

/**
 * Why an account cannot be sent a join link, in words, or null when it can.
 * Read by the issue endpoint AND by the Settings row, so the button is offered
 * only where it would work.
 */
export function inviteBlockedReason(user) {
  if (!user) return 'That account does not exist.';
  if (!user.is_active) return 'That account is deactivated. Reactivate it first.';
  if (user.password_hash) {
    return 'That account already has a password, so there is nothing for a join link to set. '
      + 'If they have forgotten it, reset the password first — that clears it — and then send a link.';
  }
  return null;
}

/**
 * Issue one. Any live invite for the same person is revoked in the same
 * transaction: two working links for one account is a link nobody can retire.
 * The clear token is returned here and NEVER read back out of the database.
 */
export function issueInvite(db, { user_id, channel_id = null, issued_by = null, sent_to = null }) {
  const token = newInviteToken();
  const id = uuid();
  db.transaction(() => {
    db.prepare(`UPDATE user_invites SET revoked_at = datetime('now'), revoked_by = ?
                WHERE user_id = ? AND used_at IS NULL AND revoked_at IS NULL`).run(issued_by || 'system', user_id);
    db.prepare(`INSERT INTO user_invites (id, user_id, token_hash, expires_at, channel_id, issued_by, sent_to)
                VALUES (?, ?, ?, datetime('now', '+${INVITE_DAYS} day'), ?, ?, ?)`)
      .run(id, user_id, hashInviteToken(token), channel_id, issued_by, sent_to);
  })();
  return { id, token, url: inviteUrl(token), invite: db.prepare('SELECT * FROM user_invites WHERE id = ?').get(id) };
}

/**
 * Resolve a token. Returns `{ ok: false, reason }` with a sentence a person can
 * act on, or `{ ok: true, invite, user }`.
 *
 * The account is re-checked here, not only at issue time: somebody can be
 * deactivated, or can set a password another way, between the text being sent
 * and the link being tapped.
 */
export function resolveInvite(db, token) {
  const hash = hashInviteToken(token || '');
  const invite = db.prepare('SELECT * FROM user_invites WHERE token_hash = ?').get(hash);
  if (!invite) return { ok: false, reason: 'This link is not recognised. Ask whoever sent it for a new one.' };
  if (invite.revoked_at) return { ok: false, reason: 'This link was withdrawn. Ask for a new one.' };
  if (invite.used_at) {
    return { ok: false, reason: 'This link has already been used to set a password. Sign in instead, or ask for a new link.' };
  }
  const expired = db.prepare("SELECT datetime('now') > expires_at AS x FROM user_invites WHERE id = ?").get(invite.id)?.x;
  if (expired) return { ok: false, reason: `This link has expired — they last ${INVITE_DAYS} days. Ask for a new one.` };
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(invite.user_id);
  const blocked = inviteBlockedReason(user);
  if (blocked) return { ok: false, reason: blocked };
  return { ok: true, invite, user };
}

/** Spend it. Called inside the same transaction that writes the password. */
export function markInviteUsed(db, inviteId, { ip = null, ua = null } = {}) {
  db.prepare("UPDATE user_invites SET used_at = datetime('now'), used_ip = ?, used_ua = ? WHERE id = ? AND used_at IS NULL")
    .run(ip, ua ? String(ua).slice(0, 300) : null, inviteId);
}

/** Withdraw the live one, if there is one. */
export function revokeInvites(db, userId, by) {
  return db.prepare(`UPDATE user_invites SET revoked_at = datetime('now'), revoked_by = ?
                     WHERE user_id = ? AND used_at IS NULL AND revoked_at IS NULL`).run(by || 'system', userId).changes;
}

/**
 * What Settings shows next to a person: the state of their latest link, never
 * the link itself. `live` / `used` / `expired` / `revoked` / `none` are five
 * different answers and the office needs all five — "no link" and "the link you
 * sent on Tuesday has expired" call for different actions.
 */
export function inviteState(db, userId) {
  const row = db.prepare('SELECT * FROM user_invites WHERE user_id = ? ORDER BY issued_at DESC, rowid DESC LIMIT 1').get(userId);
  if (!row) return { state: 'none' };
  const expired = db.prepare("SELECT datetime('now') > ? AS x").get(row.expires_at)?.x;
  const state = row.used_at ? 'used' : row.revoked_at ? 'revoked' : expired ? 'expired' : 'live';
  return {
    state,
    issued_at: row.issued_at, expires_at: row.expires_at, used_at: row.used_at,
    issued_by: row.issued_by, sent_to: row.sent_to,
  };
}

/**
 * The text. SHORT AND PLAIN, and every character inside GSM-03.38 — no dashes
 * that are not hyphens, no curly quotes, no separator dots. `gsmSafe` in
 * sms.js would transliterate them anyway; not writing them is how this message
 * stays two segments instead of four, which is the difference between arriving
 * and being filtered (see the em-dash note in CLAUDE.md).
 *
 * It names the sender, says what the link does, and states both limits, because
 * a link with no stated expiry is one people leave until next week.
 */
export function inviteMessage({ name, channelLabel, url }) {
  const who = String(name || '').split(' ')[0];
  const what = channelLabel ? `join ${channelLabel} on ReadyDoc` : 'set up your ReadyDoc account';
  return `Powder Ops: ${who ? who + ', ' : ''}${what}. Set a password on this link. `
    + `It works once and expires in ${INVITE_DAYS} days.\n${url}`;
}
