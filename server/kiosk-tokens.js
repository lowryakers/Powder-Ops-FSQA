import { randomBytes, createHash } from 'crypto';
import { v4 as uuid } from 'uuid';
import { getDb, logAudit } from './db.js';

// Binding a QR poster to a key.
//
// The kiosk pages have to stay public — a QR code on a wall carries no session,
// and the point of it is that a technician scans it and works without signing
// in. The cost, measured in the kiosk isolation verification, is that the lists
// those pages need (the equipment register, the blade list, the tool and
// chemical catalogue, the scale forms) were readable by anybody who knew the
// address. A key in the poster's URL closes that without asking the floor to
// sign in.
//
// THE ROLLOUT IS THE HARD PART, NOT THE CHECK. Posters are already on walls and
// the lobby tablet is saved to a home screen. Switching enforcement on at
// deploy would break every one of them at once — the front desk included. So
// this ships OFF, and moves through three states the plant controls:
//
//   off    nothing changes. Today's behaviour.
//   warn   untokened requests still work, and are COUNTED. This is the state
//          that answers "have all the posters actually been replaced?" with a
//          number instead of a hope.
//   on     untokened requests are refused.
//
// Nobody should flip to `on` from `off`. Sit in `warn` until the count of
// untokened requests reaches zero and stays there.

const MODE_KEY = 'kiosk_token_mode';
const UNTOKENED_KEY = 'kiosk_untokened_hits';
export const MODES = ['off', 'warn', 'on'];

// The five posters. A slug is the kiosk's own name, and it is what a key is
// bound to — a key for the scale poster cannot read the blade list.
// `short_name` is what a home-screen icon is labelled with — a phone truncates
// at roughly twelve characters, and five icons all reading "ReadyDoc" is how
// somebody opens the wrong one.
export const KIOSKS = [
  { slug: 'knife', label: 'Knife & Blade Sign In/Out', short_name: 'Knives', path: '/kiosk/knife' },
  { slug: 'components', label: 'Component Sign In/Out', short_name: 'Components', path: '/kiosk/components' },
  { slug: 'maintenance', label: 'Equipment, Tool & Chemical Sign Out', short_name: 'Sign Out', path: '/kiosk/maintenance' },
  { slug: 'scale', label: 'Scale Verification', short_name: 'Scales', path: '/kiosk/scale' },
  { slug: 'visitor', label: 'Visitor Sign In (lobby tablet)', short_name: 'Visitors', path: '/kiosk/visitor' },
];
const SLUGS = new Set(KIOSKS.map(k => k.slug));

const hashToken = (t) => createHash('sha256').update(String(t)).digest('hex');

export function kioskMode(db = getDb()) {
  try {
    const row = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(MODE_KEY);
    return MODES.includes(row?.value) ? row.value : 'off';
  } catch { return 'off'; }
}

export function setKioskMode(db, mode, actor) {
  if (!MODES.includes(mode)) throw new Error(`Unknown mode "${mode}"`);
  const before = kioskMode(db);
  db.prepare('INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)').run(MODE_KEY, mode);
  logAudit(actor, 'update', 'kiosk_token_mode', 'mode', { from: before, to: mode }, { mode: before }, { mode }, 'Kiosk key enforcement');
  return mode;
}

// How many requests arrived with no key since the counter was last reset. The
// number that tells you whether it is safe to switch enforcement on.
export function untokenedHits(db = getDb()) {
  try {
    const row = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(UNTOKENED_KEY);
    return JSON.parse(row?.value || '{}') || {};
  } catch { return {}; }
}

function recordUntokened(db, slug) {
  try {
    const hits = untokenedHits(db);
    hits[slug] = (hits[slug] || 0) + 1;
    hits._last_at = new Date().toISOString();
    db.prepare('INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)').run(UNTOKENED_KEY, JSON.stringify(hits));
  } catch { /* counting must never break a kiosk */ }
}

export function resetUntokened(db, actor) {
  db.prepare('INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)').run(UNTOKENED_KEY, '{}');
  logAudit(actor, 'update', 'kiosk_token_mode', 'counter', { action: 'reset_untokened' }, null, null, 'Kiosk key counter');
}

export function issueToken(db, { slug, label, note, actor }) {
  if (!SLUGS.has(slug)) throw new Error(`Unknown kiosk "${slug}"`);
  // 32 bytes, url-safe. Long enough that guessing is not a strategy, short
  // enough that the QR stays easy to scan from a metre away.
  const token = randomBytes(24).toString('base64url');
  const id = uuid();
  db.prepare(`INSERT INTO kiosk_tokens (id, slug, label, token_hash, note, created_by)
    VALUES (?, ?, ?, ?, ?, ?)`)
    .run(id, slug, label || KIOSKS.find(k => k.slug === slug).label, hashToken(token), note || null, actor?.name || null);
  logAudit(actor, 'create', 'kiosk_token', id, { slug }, null, null, label || slug);
  // Clear text exactly once — it only ever exists inside the poster after this.
  return { id, slug, token };
}

export function revokeToken(db, id, actor) {
  const row = db.prepare('SELECT * FROM kiosk_tokens WHERE id = ?').get(id);
  if (!row) return null;
  db.prepare("UPDATE kiosk_tokens SET revoked_at = datetime('now'), revoked_by = ? WHERE id = ?")
    .run(actor?.name || null, id);
  logAudit(actor, 'delete', 'kiosk_token', id, { slug: row.slug, reason: 'revoked' }, row, null, row.label);
  return row;
}

export function listTokens(db = getDb()) {
  return db.prepare(`SELECT id, slug, label, note, created_at, created_by, revoked_at, revoked_by,
    last_used_at, use_count FROM kiosk_tokens ORDER BY slug, created_at DESC`).all();
}

/**
 * Does this request carry a live key for this kiosk?
 *
 * The key travels in a header when the page can set one and in the query string
 * when it cannot (the very first load, straight off the QR scan). Both are read
 * so a poster works the moment it is scanned and keeps working after the page
 * has stored it.
 */
export function checkToken(db, req, slug) {
  const raw = req.get('X-Kiosk-Token') || req.query?.k || req.body?.kiosk_token || '';
  if (!raw) return { ok: false, reason: 'missing' };
  const row = db.prepare('SELECT * FROM kiosk_tokens WHERE token_hash = ?').get(hashToken(String(raw)));
  if (!row) return { ok: false, reason: 'unknown' };
  if (row.revoked_at) return { ok: false, reason: 'revoked' };
  // A key is bound to ITS OWN poster. Otherwise one leaked key opens every
  // kiosk in the plant and revoking it means reprinting all five.
  if (row.slug !== slug) return { ok: false, reason: 'wrong_kiosk' };
  try {
    db.prepare("UPDATE kiosk_tokens SET last_used_at = datetime('now'), use_count = use_count + 1 WHERE id = ?").run(row.id);
  } catch { /* usage stamping must never fail a scan */ }
  return { ok: true, row };
}

/**
 * Express middleware for a kiosk's public routes.
 *
 * Deliberately NOT a blanket guard over `/api/submit` — each kiosk names its own
 * slug, so a key is checked against the poster it belongs to.
 */
export function requireKioskToken(slug) {
  return (req, res, next) => {
    const db = getDb();
    const mode = kioskMode(db);
    if (mode === 'off') return next();

    const result = checkToken(db, req, slug);
    if (result.ok) return next();

    if (mode === 'warn') {
      // Still works. Counted, so somebody can see whether a poster was missed
      // BEFORE turning this into a refusal on the floor.
      recordUntokened(db, slug);
      return next();
    }
    // Worded for whoever is standing at the poster, not for a developer: the
    // fix is a current poster, and they cannot produce one themselves.
    return res.status(403).json({
      error: 'This QR code is out of date. Please use the current poster, or ask the office to print a new one.',
      kiosk_token_required: true,
    });
  };
}
