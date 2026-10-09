import { randomBytes, createHash, timingSafeEqual } from 'crypto';
import { v4 as uuid } from 'uuid';
import { getDb, logAudit } from './db.js';
import { writeAreaFor, writeAreaAllows } from './bot-api.js';
import { approveRouteFor, tokenDenyFor } from './middleware/no-token-approve.js';

// API tokens for the bots (D-161).
//
// A bot that drives ReadyDoc through a browser is a bot holding somebody's
// password and clicking where a person would. This replaces that with a token
// tied to ONE named, non-admin account: the bot can do exactly what that
// account can do, minus everything that approves, signs or releases, and every
// call it makes is in the audit log under that account's name.
//
// THE RULES, each one load-bearing:
//  * The token is stored as SHA-256 and shown in clear exactly once — the kiosk
//    key, auditor pass and partner portal shape. Lose it and you mint another.
//  * A token never WIDENS access. It authenticates as its user, so that user's
//    module_access decides every read; a token only ever narrows (scopes).
//  * SCOPES ARE AN ALLOW-LIST OF TWO: `read` (always on) and `write` (D-164 —
//    it replaced `write-drafts`, which is still accepted as INPUT and read back
//    as `write`). There is no approve, delete or admin scope, and normalizeScopes
//    refuses any name that is not in SCOPES — `check:apitokens` asserts that
//    adding one of FORBIDDEN_SCOPES to this list fails the build.
//  * An admin account can never hold one. Bots are non-admin accounts; a token
//    for an admin would be an admin password nobody types.

export const TOKEN_PREFIX = 'rdk_';
export const SCOPES = Object.freeze(['read', 'write']);
// Names that must never become scopes. The check fails if SCOPES ever
// contains one of these — that is a decision for a human session, always.
// 'write-drafts' is here so it can never come back as a second write scope; it
// is accepted only as legacy input and mapped to 'write' (LEGACY_SCOPES).
export const FORBIDDEN_SCOPES = Object.freeze([
  'approve', 'admin', 'sign', 'release', 'write-drafts', 'delete', 'settle', 'verify', 'token-admin', 'user-admin',
]);
const LEGACY_SCOPES = Object.freeze({ 'write-drafts': 'write' });

const TOKEN_RE = /^rdk_[A-Za-z0-9_-]{43}$/;
export const hashToken = (t) => createHash('sha256').update(String(t)).digest('hex');
export const isApiToken = (t) => typeof t === 'string' && t.startsWith(TOKEN_PREFIX);

/** `read` is always on; anything not in SCOPES is refused by name. */
export function normalizeScopes(input) {
  const list = Array.isArray(input) ? input : (input == null ? [] : [input]);
  const out = new Set(['read']);
  for (const raw of list) {
    const s0 = String(raw || '').trim();
    if (!s0) continue;
    const s = LEGACY_SCOPES[s0] || s0;
    if (!SCOPES.includes(s)) throw new ScopeError(`"${s}" is not a scope. A token may hold ${SCOPES.join(' and ')} only.`);
    out.add(s);
  }
  return SCOPES.filter(s => out.has(s));
}

export class ScopeError extends Error {}

function parseScopes(raw) {
  try {
    const a = JSON.parse(raw || '[]');
    if (!Array.isArray(a)) return ['read'];
    const got = new Set(a.map(s => LEGACY_SCOPES[s] || s));
    return SCOPES.filter(s => got.has(s));
  }
  catch { return ['read']; }
}

/**
 * Mint a token. Returns { token: <row without hash>, plaintext } — the only
 * time the clear text exists outside the caller's hands.
 */
export function createToken(db, { userId, label, scopes, expiresAt = null }, actor) {
  const user = db.prepare('SELECT id, name, role, is_active FROM users WHERE id = ?').get(userId);
  if (!user) throw new ScopeError('No such account.');
  if (!user.is_active) throw new ScopeError(`${user.name}'s account is deactivated.`);
  if (user.role === 'admin') {
    throw new ScopeError(`${user.name} is an admin. A bot token must belong to a non-admin account — create one for the bot and give it only the modules it needs.`);
  }
  const name = String(label || '').trim().slice(0, 80);
  if (name.length < 3) throw new ScopeError('Give the token a label that says which bot holds it.');
  const s = normalizeScopes(scopes);
  let exp = null;
  if (expiresAt) {
    const d = new Date(expiresAt);
    if (Number.isNaN(d.getTime())) throw new ScopeError('The expiry is not a date.');
    if (d.getTime() <= Date.now()) throw new ScopeError('The expiry is in the past.');
    exp = d.toISOString();
  }
  const plaintext = TOKEN_PREFIX + randomBytes(32).toString('base64url');
  const id = uuid();
  db.prepare(`INSERT INTO api_tokens (id, user_id, label, token_prefix, token_hash, scopes, created_by, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, user.id, name, plaintext.slice(0, 8), hashToken(plaintext), JSON.stringify(s), actor?.name || 'system', exp);
  logAudit(actor, 'create', 'api_token', id, { for: user.name, user_id: user.id, label: name, scopes: s, expires_at: exp, prefix: plaintext.slice(0, 8) }, null, null, name);
  return { token: getToken(db, id), plaintext };
}

export function getToken(db, id) {
  const r = db.prepare(`SELECT t.id, t.user_id, t.label, t.token_prefix, t.scopes, t.created_by, t.created_at,
      t.last_used_at, t.last_used_ip, t.expires_at, t.revoked_at, t.revoked_by, u.name AS user_name, u.role AS user_role, u.is_active AS user_active
    FROM api_tokens t LEFT JOIN users u ON u.id = t.user_id WHERE t.id = ?`).get(id);
  return r ? { ...r, scopes: parseScopes(r.scopes), user_active: !!r.user_active, state: stateOf(r) } : null;
}

export function listTokens(db = getDb()) {
  return db.prepare('SELECT id FROM api_tokens ORDER BY created_at DESC').all().map(r => getToken(db, r.id));
}

function stateOf(r) {
  if (r.revoked_at) return 'revoked';
  if (r.expires_at && r.expires_at <= new Date().toISOString()) return 'expired';
  if (!r.user_active) return 'account_inactive';
  if (r.user_role === 'admin') return 'account_is_admin';
  return 'live';
}

export function revokeToken(db, id, actor) {
  const t = getToken(db, id);
  if (!t) return null;
  if (t.revoked_at) return t;
  db.prepare("UPDATE api_tokens SET revoked_at = datetime('now'), revoked_by = ? WHERE id = ?").run(actor?.name || 'system', id);
  logAudit(actor, 'revoke', 'api_token', id, { for: t.user_name, label: t.label, prefix: t.token_prefix }, null, null, t.label);
  tokenUse.delete(id);
  return getToken(db, id);
}

/**
 * Resolve a presented token to { token, user } or null. Refuses a malformed,
 * unknown, revoked or expired token, and one whose account is inactive or has
 * since become an admin — a promotion must not quietly hand a bot admin rights.
 */
export function verifyToken(plaintext, db = getDb()) {
  if (!TOKEN_RE.test(String(plaintext || ''))) return null;
  const h = hashToken(plaintext);
  const row = db.prepare(`SELECT t.*, u.name, u.role, u.department, u.module_access, u.is_active, u.is_external
    FROM api_tokens t JOIN users u ON u.id = t.user_id WHERE t.token_hash = ?`).get(h);
  if (!row) return null;
  // The lookup was by hash; compare again in constant time so the answer does
  // not depend on how much of the stored value matched.
  const a = Buffer.from(row.token_hash, 'hex'), b = Buffer.from(h, 'hex');
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  if (row.revoked_at) return null;
  if (row.expires_at && row.expires_at <= new Date().toISOString()) return null;
  if (!row.is_active || row.role === 'admin') return null;
  return {
    token: { id: row.id, prefix: row.token_prefix, label: row.label, scopes: parseScopes(row.scopes) },
    user: row,
  };
}

// last_used_at at most once a minute per token — every call writing a row
// would turn a read API into a write load.
const tokenUse = new Map();
export function touchToken(tokenId, ip, db = getDb()) {
  const now = Date.now();
  if (now - (tokenUse.get(tokenId) || 0) < 60_000) return;
  tokenUse.set(tokenId, now);
  try { db.prepare("UPDATE api_tokens SET last_used_at = datetime('now'), last_used_ip = ? WHERE id = ?").run(String(ip || '').slice(0, 64), tokenId); }
  catch { /* a usage stamp must never fail a request */ }
}

// ── Rate limit ──────────────────────────────────────────────────────────────
//
// Per token, sliding one-minute window, reads and writes counted apart. IN
// MEMORY AND PER PROCESS — right for the single Railway instance this runs on
// today; a second instance would give each token twice the allowance and this
// would need a shared store. Same shape as uploadRateLimit in server.js.
const windows = new Map(); // `${tokenId}:${kind}` -> timestamps[]
const RATE_WINDOW_MS = 60_000;
export function rateLimits() {
  const n = (v, d) => { const x = Number(v); return Number.isFinite(x) && x > 0 ? Math.floor(x) : d; };
  return {
    read: n(process.env.API_TOKEN_RPM, 120),
    write: n(process.env.API_TOKEN_WRITE_RPM, 20),
    // A bulk write (bulk-edit, an import commit, applying a scenario) changes
    // many rows in one call; its own, lower bucket (D-164).
    bulk: n(process.env.API_TOKEN_BULK_RPM, 5),
  };
}
/** 'read' | 'write' | 'bulk' — which bucket a request draws on. */
export function rateKindOf(req) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return 'read';
  return writeAreaFor(req)?.bulk ? 'bulk' : 'write';
}
/** null when allowed; otherwise the seconds until a slot frees. `kind` may be a boolean (legacy: isWrite). */
export function takeRateSlot(tokenId, kindOrIsWrite, now = Date.now()) {
  const kind = typeof kindOrIsWrite === 'string' ? kindOrIsWrite : (kindOrIsWrite ? 'write' : 'read');
  const limit = rateLimits()[kind];
  const key = `${tokenId}:${kind}`;
  const hits = (windows.get(key) || []).filter(t => now - t < RATE_WINDOW_MS);
  if (hits.length >= limit) {
    windows.set(key, hits);
    return Math.max(1, Math.ceil((RATE_WINDOW_MS - (now - hits[0])) / 1000));
  }
  hits.push(now);
  windows.set(key, hits);
  return null;
}

// ── What a `write` token may write (D-164) ──────────────────────────────────
//
// DEFAULT-DENY, in this order — each a separate statement of the rule:
//   a) no `write` scope → read-only;
//   b) TOKEN_DENY or APPROVE_ROUTES (no-token-approve.js) → refused, whatever
//      the role and whatever the scope;
//   c) on WRITE_AREAS (bot-api.js), with its `when` holding (a nutrition panel
//      or a partner document only while it is a draft) → allowed;
//   d) anything else → refused.
// Allowed here means the request reaches the route as its account; the
// account's module access and the handler's own checks still decide.
export function tokenWriteAllowed(req, scopes, db = getDb()) {
  if (!scopes.includes('write')) return false;
  if (approveRouteFor(req) || tokenDenyFor(req)) return false;
  return writeAreaAllows(req, db);
}

/** For a handler that logs its own audit entry: the token behind the call, if any. */
export function auditActorDetails(req, details = {}) {
  if (req?.auth?.kind !== 'token') return details;
  return { ...details, via_token: { id: req.auth.tokenId, prefix: req.auth.prefix } };
}
