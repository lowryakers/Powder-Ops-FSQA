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
  { method: 'POST', path: '/api/nfp', module: 'products (edit)', scope: 'write' },
  { method: 'GET', path: '/api/nfp/:id/panel-values', module: 'products', scope: 'read' },
  { method: 'PUT', path: '/api/nfp/:id/panel-file', module: 'products (edit)', scope: 'write' },
  { method: 'PUT', path: '/api/nfp/:id/panel-values', module: 'products (edit)', scope: 'write' },
  { method: 'PUT', path: '/api/nfp/:id/provenance', module: 'products (edit)', scope: 'write' },
  { method: 'POST', path: '/api/nfp/:id/ready', module: 'products (edit)', scope: 'write' },
  { method: 'GET', path: '/api/nfp/review-queue', module: 'products', scope: 'read' },
  { method: 'PUT', path: '/api/products/:sku', module: 'products (edit)', scope: 'write' },
  { method: 'GET', path: '/api/artwork', module: 'artwork', scope: 'read', paged: true },
  { method: 'GET', path: '/api/artwork/sku/:sku', module: 'artwork', scope: 'read' },
  { method: 'GET', path: '/api/artwork/versions/:id', module: 'artwork', scope: 'read' },
  { method: 'POST', path: '/api/artwork/versions/:id/files', module: 'artwork (edit)', scope: 'write' },
  { method: 'GET', path: '/api/procurement/pos', module: 'procurement', scope: 'read', paged: true },
  { method: 'GET', path: '/api/procurement/summary', module: 'procurement', scope: 'read' },
  { method: 'GET', path: '/api/procurement/demand', module: 'procurement', scope: 'read', paged: true },
  { method: 'POST', path: '/api/procurement/pos', module: 'procurement (edit)', scope: 'write' },
  { method: 'PUT', path: '/api/procurement/pos/:id', module: 'procurement (edit)', scope: 'write' },
  { method: 'GET', path: '/api/comms/channels', module: null, scope: 'read', paged: true },
  { method: 'GET', path: '/api/comms/channels/:id/messages', module: null, scope: 'read' },
  { method: 'GET', path: '/api/comms/messages/:id/thread', module: null, scope: 'read' },
  { method: 'POST', path: '/api/comms/channels/:id/messages', module: null, scope: 'write' },
  { method: 'POST', path: '/api/comms/channels/:id/attachments', module: null, scope: 'write' },
  { method: 'POST', path: '/api/comms/messages/:id/reactions', module: null, scope: 'write' },
  { method: 'DELETE', path: '/api/comms/messages/:id/reactions/:emoji', module: null, scope: 'write' },
  { method: 'GET', path: '/api/ap-drop', module: null, scope: 'read', paged: true },
  { method: 'POST', path: '/api/ap-drop', module: null, scope: 'write' },
  { method: 'POST', path: '/api/ap-drop/:id/notes', module: null, scope: 'write' },
  { method: 'GET', path: '/api/partners', module: 'partner-reconciliation', scope: 'read', paged: true },
  { method: 'GET', path: '/api/partners/:id/reconcile', module: 'partner-reconciliation', scope: 'read' },
  { method: 'GET', path: '/api/partners/:id/credits', module: 'partner-reconciliation', scope: 'read', paged: true },
  { method: 'POST', path: '/api/partners/:id/documents', module: 'partner-reconciliation (edit)', scope: 'write' },
  { method: 'PUT', path: '/api/partners/documents/:docId', module: 'partner-reconciliation (edit)', scope: 'write' },
  { method: 'GET', path: '/api/user-activity', module: 'user-activity', scope: 'read', paged: true },
]);

// ── What a `write` token may write (D-164) ──────────────────────────────────
//
// DEFAULT-DENY. A token's non-GET request is refused unless it matches one of
// these AND nothing in TOKEN_DENY / APPROVE_ROUTES (server/middleware/
// no-token-approve.js) — those win over this list, always. Matching here only
// opens the door to the route: the token authenticates AS its account, so
// requireModuleWrite, requireRole and every check inside the handler still
// decide, exactly as they would for that person. A token never does more than
// its account can.
//
// Why an allow-list and not "anything the role permits": walked on 9 Oct, 480
// of the 642 non-GET routes fall outside every deny pattern, and far more than
// three of those are destructive in ways no pattern names — bulk-delete, the
// pre-launch cleanup close, a pay raise, end-access, retire, reinstate. A
// deny-list that misses one is a door nobody notices; an allow-list that
// misses one is a bot that says so within the hour.
//
// Paths are relative to /api. `bulk: true` routes count against their own
// lower rate bucket (API_TOKEN_BULK_RPM, default 5 a minute). `when(req, m, db)`
// narrows a route further and refuses when it throws.
// A draft, or one the bot has marked ready for review (D-173) — still open to
// correction until a person approves it.
const draftNfp = (db, id) => ['draft', 'ready_for_review'].includes(db.prepare('SELECT status FROM nfp_versions WHERE id = ?').get(id)?.status);
const draftPartnerDoc = (db, id) => {
  const d = db.prepare('SELECT status, settlement_id FROM partner_documents WHERE id = ?').get(id);
  return !d || (d.status === 'draft' && !d.settlement_id); // missing → the handler 404s
};
export const WRITE_AREAS = Object.freeze([
  // products
  { area: 'products', method: 'POST', re: /^\/products\/?$/, label: 'POST /api/products' },
  { area: 'products', method: 'PUT', re: /^\/products\/specs\/[^/]+$/, label: 'PUT /api/products/specs/:specId' },
  { area: 'products', method: 'POST', re: /^\/products\/specs$/, label: 'POST /api/products/specs' },
  { area: 'products', method: 'POST', re: /^\/products\/bottle-drafts$/, label: 'POST /api/products/bottle-drafts' },
  { area: 'products', method: 'POST', re: /^\/products\/bulk-edit$/, label: 'POST /api/products/bulk-edit', bulk: true },
  { area: 'products', method: 'POST', re: /^\/products\/import\/preview$/, label: 'POST /api/products/import/preview (writes nothing)' },
  { area: 'products', method: 'POST', re: /^\/products\/import\/commit$/, label: 'POST /api/products/import/commit', bulk: true },
  { area: 'products', method: 'POST', re: /^\/products\/shelf\/[^/]+$/, label: 'POST /api/products/shelf/:slot' },
  { area: 'products', method: 'PUT', re: /^\/products\/shelf\/[^/]+$/, label: 'PUT /api/products/shelf/:slot' },
  { area: 'products', method: 'PUT', re: /^\/products\/[^/]+$/, label: 'PUT /api/products/:sku' },
  { area: 'products', method: 'PUT', re: /^\/products\/[^/]+\/colors$/, label: 'PUT /api/products/:sku/colors' },
  { area: 'products', method: 'POST', re: /^\/products\/[^/]+\/na$/, label: 'POST /api/products/:sku/na' },
  { area: 'products', method: 'POST', re: /^\/products\/[^/]+\/barcode$/, label: 'POST /api/products/:sku/barcode' },
  { area: 'products', method: 'POST', re: /^\/products\/[^/]+\/packaging-po$/, label: 'POST /api/products/:sku/packaging-po' },
  // artwork and its files
  { area: 'artwork', method: 'POST', re: /^\/artwork\/?$/, label: 'POST /api/artwork' },
  { area: 'artwork', method: 'POST', re: /^\/artwork\/versions\/[^/]+\/files$/, label: 'POST /api/artwork/versions/:id/files' },
  { area: 'artwork', method: 'POST', re: /^\/artwork\/versions\/[^/]+\/checks$/, label: 'POST /api/artwork/versions/:id/checks' },
  { area: 'artwork', method: 'POST', re: /^\/artwork\/versions\/[^/]+\/status$/, label: 'POST /api/artwork/versions/:id/status (to draft / in review only)' },
  // supply orders (Procurement)
  { area: 'supply-orders', method: 'POST', re: /^\/procurement\/pos$/, label: 'POST /api/procurement/pos' },
  { area: 'supply-orders', method: 'PUT', re: /^\/procurement\/pos\/bulk$/, label: 'PUT /api/procurement/pos/bulk', bulk: true },
  { area: 'supply-orders', method: 'PUT', re: /^\/procurement\/pos\/[^/]+$/, label: 'PUT /api/procurement/pos/:id' },
  { area: 'supply-orders', method: 'PUT', re: /^\/procurement\/demand\/[^/]+$/, label: 'PUT /api/procurement/demand/:id' },
  { area: 'supply-orders', method: 'POST', re: /^\/procurement\/scenarios$/, label: 'POST /api/procurement/scenarios' },
  { area: 'supply-orders', method: 'POST', re: /^\/procurement\/scenarios\/[^/]+\/apply$/, label: 'POST /api/procurement/scenarios/:id/apply', bulk: true },
  { area: 'supply-orders', method: 'PUT', re: /^\/procurement\/parts\/[^/]+$/, label: 'PUT /api/procurement/parts/:id' },
  // AP Drop
  { area: 'ap-drop', method: 'POST', re: /^\/ap-drop\/?$/, label: 'POST /api/ap-drop (upload)' },
  { area: 'ap-drop', method: 'PUT', re: /^\/ap-drop\/[^/]+$/, label: 'PUT /api/ap-drop/:id' },
  { area: 'ap-drop', method: 'POST', re: /^\/ap-drop\/[^/]+\/notes$/, label: 'POST /api/ap-drop/:id/notes' },
  { area: 'ap-drop', method: 'POST', re: /^\/ap-drop\/[^/]+\/reparse$/, label: 'POST /api/ap-drop/:id/reparse' },
  { area: 'ap-drop', method: 'POST', re: /^\/ap-drop\/[^/]+\/route-partner$/, label: 'POST /api/ap-drop/:id/route-partner (files a DRAFT on the ledger)' },
  { area: 'ap-drop', method: 'POST', re: /^\/ap-drop\/[^/]+\/status$/, label: 'POST /api/ap-drop/:id/status (triage moves only)' },
  // partner reconciliation — documents stay drafts while a token touches them
  { area: 'partner-recon', method: 'POST', re: /^\/partners\/[^/]+\/documents$/, label: 'POST /api/partners/:id/documents' },
  { area: 'partner-recon', method: 'POST', re: /^\/partners\/[^/]+\/documents\/scan$/, label: 'POST /api/partners/:id/documents/scan' },
  { area: 'partner-recon', method: 'POST', re: /^\/partners\/[^/]+\/documents\/import$/, label: 'POST /api/partners/:id/documents/import', bulk: true },
  { area: 'partner-recon', method: 'PUT', re: /^\/partners\/documents\/([^/]+)$/, label: 'PUT /api/partners/documents/:docId (while draft)',
    when: (req, m, db) => draftPartnerDoc(db, m[1]) },
  { area: 'partner-recon', method: 'PUT', re: /^\/partners\/documents\/([^/]+)\/category$/, label: 'PUT /api/partners/documents/:docId/category (while draft)',
    when: (req, m, db) => draftPartnerDoc(db, m[1]) },
  { area: 'partner-recon', method: 'POST', re: /^\/partners\/documents\/([^/]+)\/file$/, label: 'POST /api/partners/documents/:docId/file (while draft)',
    when: (req, m, db) => draftPartnerDoc(db, m[1]) },
  { area: 'partner-recon', method: 'POST', re: /^\/partners\/documents\/([^/]+)\/read-lines$/, label: 'POST /api/partners/documents/:docId/read-lines (while draft)',
    when: (req, m, db) => draftPartnerDoc(db, m[1]) },
  { area: 'partner-recon', method: 'POST', re: /^\/partners\/[^/]+\/credits$/, label: 'POST /api/partners/:id/credits' },
  { area: 'partner-recon', method: 'PUT', re: /^\/partners\/[^/]+$/, label: 'PUT /api/partners/:id (partner terms — office/admin accounts only)' },
  // nutrition panels — always a draft (nfp.js forces it; a paper approval is the approve class)
  { area: 'nfp-draft', method: 'POST', re: /^\/nfp\/?$/, label: 'POST /api/nfp — lands as a draft' },
  { area: 'nfp-draft', method: 'PUT', re: /^\/nfp\/([^/]+)$/, label: 'PUT /api/nfp/:id (while draft)',
    when: (req, m, db) => draftNfp(db, m[1]) },
  { area: 'nfp-draft', method: 'PUT', re: /^\/nfp\/([^/]+)\/panel$/, label: 'PUT /api/nfp/:id/panel (while draft)',
    when: (req, m, db) => draftNfp(db, m[1]) },
  // D-173: the formula/BOM the draft was computed from, and marking it ready.
  { area: 'nfp-draft', method: 'PUT', re: /^\/nfp\/([^/]+)\/provenance$/, label: 'PUT /api/nfp/:id/provenance (while draft)',
    when: (req, m, db) => draftNfp(db, m[1]) },
  { area: 'nfp-draft', method: 'POST', re: /^\/nfp\/([^/]+)\/ready$/, label: 'POST /api/nfp/:id/ready — mark a draft ready for review' },
  // The Product Manager bot's panel work (D-171) — only a token holding the
  // `nfp-panel` GRANT. No `when`: the handler refuses a non-draft with its own
  // 403 that says why, rather than a bare not_open_to_tokens.
  { area: 'nfp-panel', grant: 'nfp-panel', method: 'PUT', re: /^\/nfp\/[^/]+\/panel-file$/, label: 'PUT /api/nfp/:id/panel-file — the panel PDF (draft only; nfp-panel grant)' },
  { area: 'nfp-panel', grant: 'nfp-panel', method: 'PUT', re: /^\/nfp\/[^/]+\/panel-values$/, label: 'PUT /api/nfp/:id/panel-values — panel values + source (draft only; nfp-panel grant)' },
  // messages
  { area: 'messages', method: 'POST', re: /^\/comms\/channels\/[^/]+\/messages$/, label: 'POST /api/comms/channels/:id/messages' },
  { area: 'messages', method: 'POST', re: /^\/comms\/channels\/[^/]+\/attachments$/, label: 'POST /api/comms/channels/:id/attachments' },
  // Reactions (D-170): the token's own reaction, on a message in a channel it is
  // a member of. The handler only ever touches the caller's own row.
  { area: 'messages', method: 'POST', re: /^\/comms\/messages\/[^/]+\/reactions$/, label: 'POST /api/comms/messages/:id/reactions' },
  { area: 'messages', method: 'DELETE', re: /^\/comms\/messages\/[^/]+\/reactions\/[^/]+$/, label: 'DELETE /api/comms/messages/:id/reactions/:emoji' },
]);

/** The WRITE_AREAS entry this request's method + path names, before any `when`. */
export function writeAreaFor(req) {
  for (const r of WRITE_AREAS) {
    if (r.method === req.method && r.re.test(req.path)) return r;
  }
  return null;
}

/** True when the request is on WRITE_AREAS and its `when`, if any, holds. */
export function writeAreaAllows(req, db) {
  const r = writeAreaFor(req);
  if (!r) return false;
  // A GRANTED area opens only for a token holding that grant (D-171).
  if (r.grant && !(req.auth?.grants || []).includes(r.grant)) return false;
  if (!r.when) return true;
  try { return !!r.when(req, req.path.match(r.re), db); } catch { return false; }
}

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

// ── What a token may attach to a chat message (D-166) ───────────────────────
//
// A person's upload takes any file (the composer is for people who know what
// they are sending). A token's takes only these, because a bot attaches the
// documents it was built to move — a PO, a spec sheet, a photo, a sheet — and
// an .html or .svg posted as the bot account is a page that runs in whoever
// opens it. Both the EXTENSION and the declared MIME type must be on the
// list, and the first bytes must be what the extension claims: a .pdf whose
// body is HTML is refused. Same size limits as a person (server/media.js) —
// there is deliberately no second limit.
export const TOKEN_CHAT_ATTACHMENT_TYPES = Object.freeze({
  pdf: { mimes: ['application/pdf'], magic: 'pdf' },
  png: { mimes: ['image/png'], magic: 'png' },
  jpg: { mimes: ['image/jpeg'], magic: 'jpeg' },
  jpeg: { mimes: ['image/jpeg'], magic: 'jpeg' },
  csv: { mimes: ['text/csv', 'application/vnd.ms-excel', 'text/plain'], magic: 'text' },
  xlsx: { mimes: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'], magic: 'zip' },
  docx: { mimes: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'], magic: 'zip' },
});

const MAGIC = {
  pdf: (b) => b.length >= 5 && b.subarray(0, 5).toString('latin1') === '%PDF-',
  png: (b) => b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  jpeg: (b) => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  zip: (b) => b.length >= 4 && b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04,
  // A CSV has no signature; it must at least be text — no NUL byte in what was read.
  text: (b) => b.length > 0 && !b.includes(0),
};

const ALLOWED_NAMES = 'pdf, png, jpg, csv, xlsx or docx';

/**
 * null when a token may attach this file; otherwise the reason, worded for the
 * caller. `head` is the file's first bytes (4 KB is plenty).
 */
export function tokenAttachmentRefusal({ filename, mimetype, head }) {
  const name = String(filename || '');
  const ext = (name.match(/\.([A-Za-z0-9]+)$/)?.[1] || '').toLowerCase();
  const rule = Object.prototype.hasOwnProperty.call(TOKEN_CHAT_ATTACHMENT_TYPES, ext) ? TOKEN_CHAT_ATTACHMENT_TYPES[ext] : null;
  if (!rule) return `${name || 'This file'}: a bot token may attach only ${ALLOWED_NAMES} files.`;
  const mime = String(mimetype || '').toLowerCase().split(';')[0].trim();
  if (!rule.mimes.includes(mime)) return `${name}: declared as ${mime || 'no type'}, which is not a .${ext} file. Send it as ${rule.mimes[0]}.`;
  if (!MAGIC[rule.magic](Buffer.isBuffer(head) ? head : Buffer.alloc(0))) return `${name}: the contents are not a .${ext} file.`;
  return null;
}
