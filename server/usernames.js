// Sign-in names.
//
// Several people here carry three or four names ("Maria Fernanda Agudelo",
// "Gaston Antonio Perez Quintanilla"), and typing the whole thing on a phone
// at shift change is the worst part of signing in. So the full name stays on
// the record — compliance signatures, the audit log and every historical entry
// keep naming the person exactly as before — and a short `username` (first +
// last) is what they actually type. Admins can override any of them in
// Settings, which matters for Spanish two-surname names where the surname
// people go by is often the second-to-last word, not the last.

// Words that are part of a surname rather than a name of their own, so
// "Juan de la Cruz" shortens to "Juan de la Cruz" rather than "Juan Cruz".
const PARTICLES = new Set(['de', 'del', 'de la', 'la', 'las', 'los', 'da', 'das', 'do', 'dos',
  'van', 'von', 'der', 'den', 'di', 'du', 'st', 'st.', 'mc', 'mac', 'bin', 'al']);

// Titles and suffixes nobody signs in with.
const DROP = new Set(['jr', 'jr.', 'sr', 'sr.', 'ii', 'iii', 'iv', 'dr', 'dr.', 'mr', 'mr.', 'mrs', 'mrs.', 'ms', 'ms.']);

const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();

// First name + last name, keeping any particles attached to the surname.
export function deriveUsername(fullName) {
  const parts = clean(fullName).split(' ').filter(w => w && !DROP.has(w.toLowerCase()));
  if (parts.length <= 2) return parts.join(' ');

  // Walk back from the end while the preceding word is a particle, so
  // "Cruz" becomes "de la Cruz".
  let start = parts.length - 1;
  while (start > 1 && PARTICLES.has(parts[start - 1].toLowerCase())) start--;
  return [parts[0], ...parts.slice(start)].join(' ');
}

const taken = (db, username, excludeId) => !!db.prepare(
  'SELECT 1 FROM users WHERE LOWER(username) = LOWER(?) AND id IS NOT ?',
).get(username, excludeId ?? null);

// Two "Jose Garcia"s can't share a sign-in, so fall back to the middle name,
// then to a number. Returns a username that is free right now.
export function uniqueUsername(db, fullName, excludeId) {
  const base = deriveUsername(fullName) || clean(fullName);
  if (!base) return null;
  if (!taken(db, base, excludeId)) return base;

  const parts = clean(fullName).split(' ').filter(Boolean);
  if (parts.length > 2) {
    const withMiddle = `${parts[0]} ${parts[1][0]} ${base.split(' ').slice(1).join(' ')}`;
    if (!taken(db, withMiddle, excludeId)) return withMiddle;
  }
  for (let n = 2; n < 50; n++) {
    const candidate = `${base} ${n}`;
    if (!taken(db, candidate, excludeId)) return candidate;
  }
  return null;
}

// Letters (incl. accents), spaces, apostrophes, hyphens and dots. No @ or
// digits-only handles — this is a name, not an email.
const VALID = /^[\p{L}][\p{L}\s'.-]{1,39}$/u;

// Returns { username } or { error }. Used by both create and update.
export function validateUsername(db, raw, excludeId) {
  const username = clean(raw);
  if (!username) return { error: 'Username is required' };
  if (!VALID.test(username)) return { error: 'Use letters, spaces, apostrophes or hyphens (2–40 characters)' };
  if (taken(db, username, excludeId)) return { error: `"${username}" is already taken` };
  return { username };
}

// Give every user a sign-in name. Idempotent: only fills the blanks, so an
// admin's override is never overwritten on the next boot.
export function backfillUsernames(db) {
  const rows = db.prepare("SELECT id, name FROM users WHERE username IS NULL OR username = ''").all();
  if (!rows.length) return 0;
  const upd = db.prepare('UPDATE users SET username = ? WHERE id = ?');
  const tx = db.transaction(() => {
    for (const u of rows) {
      const username = uniqueUsername(db, u.name, u.id);
      if (username) upd.run(username, u.id);
    }
  });
  tx();
  return rows.length;
}
