// WHERE A LOT WAS RELEASED (D-388, A-20261124-001 / R-0829).
//
// Product release — FORM 405-1, and the 405-02 waiver — is signed in KEYCHAIN
// (shared/form-registry.js lists both `where: 'keychain'`). ReadyDoc does not
// release a lot and must not look as if it does. What it keeps is a REFERENCE:
// the Keychain identifier and/or link a person types after the release is
// signed there, with who recorded it and when, shown read-only on the lot in
// Look up records.
//
// - Not a signature: no gateSignature, no release meaning, no release status.
// - A person records it — QA or an admin — never a token or a bot.
// - A correction is a NEW row that supersedes the old one with a reason; the
//   old row stays, so "what did ReadyDoc say on the 3rd" is still answerable.
import { randomUUID as uuid } from 'crypto';
import { isBotAccount } from './trainees.js';

/** One spelling for matching: trimmed, case-insensitive. A batch suffix is part of the lot as typed. */
export const lotKey = (lot) => String(lot || '').trim().toLowerCase();

/** QA (any role) or an admin records the reference. */
export function canRecordRelease(user) {
  if (!user) return false;
  if (user.role === 'admin') return true;
  const d = String(user.department || '').toLowerCase();
  return d === 'qa' || d === 'quality';
}

const shape = (r) => r && ({
  id: r.id, lot: r.lot, keychain_ref: r.keychain_ref, url: r.url, note: r.note,
  recorded_by: r.recorded_by, recorded_at: r.recorded_at,
  superseded_at: r.superseded_at, superseded_by: r.superseded_by, supersede_reason: r.supersede_reason,
});

/** The reference in force for a lot, and the ones it replaced (newest first). */
export function releaseRefFor(db, lot) {
  const key = lotKey(lot);
  if (!key) return { current: null, history: [] };
  const rows = db.prepare('SELECT * FROM lot_release_refs WHERE lot_key = ? ORDER BY recorded_at DESC, rowid DESC').all(key);
  return { current: shape(rows.find(r => !r.superseded_at)) || null, history: rows.filter(r => r.superseded_at).map(shape) };
}

const httpUrl = (u) => { try { const x = new URL(u); return x.protocol === 'https:' || x.protocol === 'http:'; } catch { return false; } };

/**
 * Record (or correct) the reference. Returns { status, body }.
 * `auth` is req.auth; a token is refused whatever its account may do.
 */
export function recordReleaseRef(db, user, auth, body, { logAudit } = {}) {
  if (auth?.kind === 'token' || isBotAccount(db, user)) {
    return { status: 403, body: { code: 'PERSON_ONLY', error: 'A Keychain release reference is recorded by a person.' } };
  }
  if (!canRecordRelease(user)) return { status: 403, body: { error: 'QA or an admin records where a lot was released.' } };
  const lot = String(body?.lot || '').trim();
  const ref = String(body?.keychain_ref || '').trim() || null;
  const url = String(body?.url || '').trim() || null;
  const note = String(body?.note || '').trim() || null;
  if (!lot) return { status: 400, body: { error: 'Name the lot.' } };
  if (!ref && !url) return { status: 400, body: { error: 'Give the Keychain release identifier, its link, or both.' } };
  if (url && !httpUrl(url)) return { status: 400, body: { error: 'The link must be a web address starting with https://.' } };
  const key = lotKey(lot);
  const current = db.prepare('SELECT * FROM lot_release_refs WHERE lot_key = ? AND superseded_at IS NULL').get(key);
  const reason = String(body?.reason || '').trim();
  if (current && reason.length < 5) {
    return { status: 400, body: { code: 'REASON_REQUIRED', error: 'This lot already has a reference. Say why it is being corrected.' } };
  }
  const id = uuid();
  const tx = db.transaction(() => {
    if (current) {
      db.prepare(`UPDATE lot_release_refs SET superseded_at = datetime('now'), superseded_by = ?, supersede_reason = ? WHERE id = ?`)
        .run(id, reason, current.id);
    }
    db.prepare(`INSERT INTO lot_release_refs (id, lot, lot_key, keychain_ref, url, note, recorded_by, recorded_by_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(id, lot, key, ref, url, note, user.name, user.id || null);
  });
  tx();
  logAudit?.(user, current ? 'lot_release_ref_corrected' : 'lot_release_ref_recorded', 'lot_release_ref', id,
    { lot, keychain_ref: ref, url, ...(current ? { replaces: current.id, reason } : {}) },
    current ? shape(current) : null, { lot, keychain_ref: ref, url }, lot);
  return { status: 201, body: releaseRefFor(db, lot) };
}
