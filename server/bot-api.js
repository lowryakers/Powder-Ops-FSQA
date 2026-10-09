// The REST surface the bots use (D-162). NOT a parallel /api/v1: the existing
// routes already answer JSON, and a copy would drift from the screens within a
// month. This module is the list of which routes are the bot surface, the
// pagination they share, and the one filter that keeps secrets out of anything
// a token caller is sent.
//
// BOT_ROUTES is the contract. docs/bot-api.md documents exactly these and
// check:botapi asserts the two agree, both ways — a route documented and not
// listed, or listed and not documented, fails the build.

export const BOT_ROUTES = Object.freeze([
  { method: 'GET', path: '/api/bot/whoami', module: null, scope: 'read' },
  { method: 'GET', path: '/api/products', module: 'products', scope: 'read', paged: true },
  { method: 'GET', path: '/api/products/:sku', module: 'products', scope: 'read' },
  { method: 'GET', path: '/api/nfp', module: 'products', scope: 'read', paged: true },
  { method: 'GET', path: '/api/nfp/sku/:sku', module: 'products', scope: 'read' },
  { method: 'POST', path: '/api/nfp', module: 'products (edit)', scope: 'write-drafts' },
  { method: 'GET', path: '/api/artwork', module: 'artwork', scope: 'read', paged: true },
  { method: 'GET', path: '/api/artwork/sku/:sku', module: 'artwork', scope: 'read' },
  { method: 'GET', path: '/api/artwork/versions/:id', module: 'artwork', scope: 'read' },
  { method: 'GET', path: '/api/procurement/pos', module: 'procurement', scope: 'read', paged: true },
  { method: 'GET', path: '/api/procurement/summary', module: 'procurement', scope: 'read' },
  { method: 'GET', path: '/api/procurement/demand', module: 'procurement', scope: 'read', paged: true },
  { method: 'GET', path: '/api/comms/channels', module: null, scope: 'read', paged: true },
  { method: 'GET', path: '/api/comms/channels/:id/messages', module: null, scope: 'read' },
  { method: 'GET', path: '/api/comms/messages/:id/thread', module: null, scope: 'read' },
  { method: 'POST', path: '/api/comms/channels/:id/messages', module: null, scope: 'write-drafts' },
  { method: 'GET', path: '/api/ap-drop', module: null, scope: 'read', paged: true },
  { method: 'GET', path: '/api/partners', module: 'partner-reconciliation', scope: 'read', paged: true },
  { method: 'GET', path: '/api/partners/:id/reconcile', module: 'partner-reconciliation', scope: 'read' },
  { method: 'GET', path: '/api/partners/:id/credits', module: 'partner-reconciliation', scope: 'read', paged: true },
]);

export const PAGE_MAX = 200;

/**
 * The page a caller asked for, or null for "the whole list as before".
 * A TOKEN caller is always paged (default and ceiling 200); a session is paged
 * only when it passes limit/offset, so no screen changes behaviour.
 */
export function pageOf(req) {
  const q = req.query || {};
  const asked = q.limit !== undefined || q.offset !== undefined;
  if (req.auth?.kind !== 'token' && !asked) return null;
  const lim = parseInt(q.limit, 10);
  const off = parseInt(q.offset, 10);
  return {
    limit: Number.isFinite(lim) && lim > 0 ? Math.min(lim, PAGE_MAX) : PAGE_MAX,
    offset: Number.isFinite(off) && off > 0 ? off : 0,
  };
}

/**
 * Slice a list to the page and say so in headers — X-Total-Count, X-Limit,
 * X-Offset. The body keeps its shape, so a paged response reads exactly like
 * the unpaged one the screens get.
 */
export function pageList(req, res, rows) {
  const page = pageOf(req);
  if (!page || !Array.isArray(rows)) return rows;
  res.set('X-Total-Count', String(rows.length));
  res.set('X-Limit', String(page.limit));
  res.set('X-Offset', String(page.offset));
  return rows.slice(page.offset, page.offset + page.limit);
}

// ── What a token caller is never sent ───────────────────────────────────────
//
// One filter at the door rather than a check in every handler: a handler added
// next month that returns SELECT * cannot leak a hash to a bot. A file's bytes
// and storage key are never returned — the bot asks the route's own /files/:id
// for a short-lived URL, the same as a screen does.
export const FORBIDDEN_KEYS = Object.freeze(new Set([
  'password_hash', 'password', 'pin', 'pin_hash', 'setup_code', 'setup_code_expires_at',
  'token', 'token_hash', 'refresh_token', 'access_token', 'client_secret', 'secret', 'session',
  'signature_image', 'extracted_text', 'storage_key', 'body_base64', 'file_data', 'data_url',
  'ssn', 'dd_account', 'dd_routing',
]));
const FORBIDDEN_SUFFIX = /(_hash|_secret|_encrypted|_enc|_cipher)$/;
export const isForbiddenKey = (k) => FORBIDDEN_KEYS.has(k) || FORBIDDEN_SUFFIX.test(k);

export function stripForbidden(value, depth = 0) {
  if (depth > 12 || value == null || typeof value !== 'object') return value;
  if (Buffer.isBuffer(value)) return undefined;
  if (Array.isArray(value)) return value.map(v => stripForbidden(v, depth + 1));
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    if (isForbiddenKey(k)) continue;
    out[k] = stripForbidden(v, depth + 1);
  }
  return out;
}

// @channel / @here / @everyone notify every member; a bot may name a person,
// never the room. Same pattern comms.js uses to decide a broadcast.
export const isBroadcastMention = (body) => /(^|\s)@(channel|here|everyone)\b/i.test(String(body || ''));
