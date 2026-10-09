import { logAudit } from '../db.js';

// NOTHING A BOT HOLDS CAN APPROVE, SIGN, RELEASE OR SETTLE (D-161).
//
// A token's writes are already default-deny (WRITE_AREAS in server/bot-api.js),
// so in today's code none of these routes is reachable with a token anyway.
// This list is the SECOND, independent statement of the rule — the one that
// still holds the day somebody widens the allow-list by a line too many. It is checked centrally in authenticate() and mounted once
// globally in server.js, and two routes also check it inline (NFP decide and the
// artwork status move) so a router moved off the global mount keeps the rule.
//
// TWO KINDS OF ENTRY:
//  * a SEGMENT rule — any non-GET request with a path segment that names an act
//    of approval (approve, decide, sign, verify, release, settle, …). New routes
//    named that way are covered the day they are written, and check:apitokens
//    greps every router to prove it.
//  * EXPLICIT entries for approve-class acts whose path does not say so — the
//    NFP "send for approval" links, a paper approval filed through the ordinary
//    create, and the artwork status move when the target is approved/print-ready.
//
// The response is 403 `approve_requires_human_session`, and every refusal is in
// the audit log as `api_token_approve_blocked`.

export const APPROVE_SEGMENTS = Object.freeze([
  'approve', 'approved', 'approval', 'approvals', 'bulk-approve', 'flavor-approve',
  'decide', 'decision',
  'sign', 'signature', 'signatures', 'signoff', 'sign-off', 'qa-signoff', 'countersign',
  'verify', 'verification',
  'release', 'release-gate',
  'finalize', 'finalise',
  'settle', 'settlement', 'settlements',
  'sensory',   // QA's tasting record on a flavor approval — a person's senses, never a bot's
  'sensory-specs',      // the QA lead's approved specification a tasting is judged against
  'scale-verification', // a certified weight on a scale — a record of a physical act a bot cannot do
]);
const SEGMENT_SET = new Set(APPROVE_SEGMENTS);
const ARTWORK_APPROVE_STATUSES = new Set(['approved', 'print_ready', 'released']);

// Paths are relative to /api, the PUBLIC_ROUTES convention.
export const APPROVE_ROUTES = Object.freeze([
  { method: '*', segment: true, label: 'any non-GET route with a segment in APPROVE_SEGMENTS' },
  { method: 'POST', re: /^\/nfp\/[^/]+\/send$/, label: 'POST /api/nfp/:id/send — send a panel for approval' },
  { method: 'POST', re: /^\/nfp\/batch\/send$/, label: 'POST /api/nfp/batch/send — send panels for approval' },
  { method: 'POST', re: /^\/nfp\/?$/, label: 'POST /api/nfp with source "paper" — files an APPROVED panel',
    when: (req) => req.body?.source === 'paper' || !!req.body?.approved_by || !!req.body?.approved_at },
  { method: 'POST', re: /^\/qms\/flavor_approval\/[^/]+\/send$/, label: 'POST /api/qms/flavor_approval/:id/send — text a batch for approval' },
  { method: 'POST', re: /^\/artwork\/versions\/[^/]+\/status$/, label: 'POST /api/artwork/versions/:id/status to approved / print_ready',
    when: (req) => ARTWORK_APPROVE_STATUSES.has(String(req.body?.status || '')) },
  { method: 'POST', re: /^\/partners\/settlements\/[^/]+\/proof$/, label: 'POST /api/partners/settlements/:id/proof — evidence of a settlement' },
]);

const segmentsOf = (path) => String(path || '').split('/').filter(Boolean).map(s => s.toLowerCase());

/** The APPROVE_ROUTES entry this request falls under, or null. GET/HEAD never do. */
export function approveRouteFor(req) {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return null;
  const path = req.path;
  for (const r of APPROVE_ROUTES) {
    if (r.segment) {
      if (segmentsOf(path).some(s => SEGMENT_SET.has(s))) return r;
      continue;
    }
    if (r.method !== '*' && r.method !== req.method) continue;
    if (!r.re.test(path)) continue;
    try { if (r.when && !r.when(req)) continue; } catch { /* a predicate that throws refuses */ }
    return r;
  }
  return null;
}

export function refuseTokenApprove(req, res, route) {
  try {
    logAudit(req.user || 'system', 'api_token_approve_blocked', 'api_token', req.auth?.tokenId || null,
      { method: req.method, path: (req.baseUrl || '') + req.path, rule: route?.label || 'inline guard', prefix: req.auth?.prefix },
      null, null, req.auth?.label || null);
  } catch { /* the refusal stands even if the log write fails */ }
  return res.status(403).json({
    error: 'approve_requires_human_session',
    message: 'Approving, signing or releasing needs a person signed in. A bot token can never do it.',
  });
}

/** Global guard: refuses a token on any APPROVE_ROUTES or TOKEN_DENY match. Mounted once in server.js. */
export function tokenApproveGuard(req, res, next) {
  if (req.auth?.kind !== 'token') return next();
  const route = approveRouteFor(req);
  if (route) return refuseTokenApprove(req, res, route);
  const deny = tokenDenyFor(req);
  if (deny) return refuseTokenDenied(req, res, deny);
  next();
}

/** Inline guard for a route that must never be reached with a token, whatever the list says. */
export function rejectTokenAuth(req, res, next) {
  if (req.auth?.kind === 'token') return refuseTokenApprove(req, res, null);
  next();
}

// ── The other person-only acts (D-164) ──────────────────────────────────────
//
// THIS FILE IS THE ONE LIST OF WHAT A TOKEN CAN NEVER DO. APPROVE_ROUTES above
// is the approve class; TOKEN_DENY below is everything else: deleting or
// voiding, deciding (reject / dismiss / resolve / reopen / close), changing
// users, roles, permissions or access, and managing tokens of any kind.
// ABSOLUTE: no scope lifts an entry and the account's role does not matter — a
// token that matches is refused before the handler runs, so nothing is touched.
// Refusal: 403 `token_denied` with the category; audit `api_token_write_blocked`.
//
// The writes a token MAY make are an allow-list (WRITE_AREAS, server/bot-api.js),
// so this list does not have to be complete to be safe. It exists so that the
// dangerous classes stay refused even if a WRITE_AREAS entry is written too
// wide, and so a bot is told WHY in words it can relay.

export const DELETE_SEGMENTS = Object.freeze([
  'delete', 'bulk-delete', 'remove', 'void', 'archive', 'purge', 'trash', 'discard',
  'cancel', 'withdraw', 'deactivate', 'revoke', 'dispute', 'retire', 'retire-option',
]);
export const DECISION_SEGMENTS = Object.freeze([
  'reject', 'dismiss', 'resolve', 'reopen', 'close', 'reinstate', 'restore', 'waive',
]);
const DELETE_SET = new Set(DELETE_SEGMENTS);
const DECISION_SET = new Set(DECISION_SEGMENTS);
// AP Drop moves a token may make: triage. Paid, closed, in QuickBooks, in a
// payment run, not finance — the office's statements about money — are not.
export const AP_DROP_TOKEN_STATUSES = Object.freeze(['new', 'triaged', 'matched', 'needs_info', 'duplicate_suspect']);
// Artwork moves a token may make: put a draft up for review, or back to draft.
export const ARTWORK_TOKEN_STATUSES = Object.freeze(['draft', 'in_review']);

const nonGet = (req) => !['GET', 'HEAD', 'OPTIONS'].includes(req.method);

export const TOKEN_DENY = Object.freeze([
  { category: 'delete', test: (req) => req.method === 'DELETE', label: 'every DELETE' },
  { category: 'delete', test: (req) => nonGet(req) && segmentsOf(req.path).some(s => DELETE_SET.has(s)),
    label: 'any non-GET route with a segment in DELETE_SEGMENTS' },
  { category: 'decision', test: (req) => nonGet(req) && segmentsOf(req.path).some(s => DECISION_SET.has(s)),
    label: 'any non-GET route with a segment in DECISION_SEGMENTS' },
  // Every method, GET included: a bot has no business listing keys either.
  { category: 'token_admin', test: (req) => /^\/(api-tokens|kiosk-tokens)(\/|$)/.test(req.path),
    label: '/api/api-tokens and /api/kiosk-tokens — every method' },
  { category: 'token_admin', test: (req) => nonGet(req) && /^\/partners\/[^/]+\/portal-tokens$/.test(req.path),
    label: 'POST /api/partners/:id/portal-tokens — mint a partner portal link' },
  { category: 'token_admin', test: (req) => nonGet(req) && /^\/auditor-pass(\/|$)/.test(req.path),
    label: '/api/auditor-pass writes — a pass mints a session' },
  { category: 'user_admin', test: (req) => nonGet(req) && /^\/users(\/|$)/.test(req.path),
    label: 'every write under /api/users — accounts, roles, module access, passwords, signatures' },
  { category: 'user_admin', test: (req) => nonGet(req) && /^\/onboarding\/[^/]+\/end-access$/.test(req.path),
    label: 'POST /api/onboarding/:id/end-access' },
  { category: 'user_admin', test: (req) => nonGet(req) && /^\/(comms\/admin|org)(\/|$)/.test(req.path),
    label: '/api/comms/admin and /api/org writes' },
  { category: 'decision', test: (req) => req.method === 'POST' && /^\/products\/[^/]+\/confirm\/[^/]+$/.test(req.path),
    label: 'POST /api/products/:sku/confirm/:step — a person attesting to work in another system' },
  { category: 'decision', test: (req) => req.method === 'POST' && /^\/ap-drop\/[^/]+\/status$/.test(req.path)
      && !AP_DROP_TOKEN_STATUSES.includes(String(req.body?.status || '')),
    label: 'POST /api/ap-drop/:id/status to anything but a triage move' },
  { category: 'decision', test: (req) => req.method === 'POST' && /^\/artwork\/versions\/[^/]+\/status$/.test(req.path)
      && !ARTWORK_TOKEN_STATUSES.includes(String(req.body?.status || '')),
    label: 'POST /api/artwork/versions/:id/status to rejected / superseded (approved and print-ready are the approve class)' },
]);

/** The TOKEN_DENY entry this request falls under, or null. Applies to every method. */
export function tokenDenyFor(req) {
  for (const r of TOKEN_DENY) {
    try { if (r.test(req)) return r; } catch { return r; /* a predicate that throws refuses */ }
  }
  return null;
}

const DENY_MESSAGES = {
  delete: 'Deleting, voiding or retiring anything needs a person signed in. A bot token can never do it.',
  decision: 'Rejecting, dismissing, resolving, closing or confirming needs a person signed in. A bot token can never do it.',
  user_admin: 'Changing users, roles, permissions or access needs a person signed in. A bot token can never do it.',
  token_admin: 'Managing tokens, keys or passes needs a person signed in. A bot token can never do it.',
  not_open_to_tokens: 'This route is not open to bot tokens. A person signed in can do it.',
};

export function refuseTokenDenied(req, res, rule) {
  const category = rule?.category || 'not_open_to_tokens';
  try {
    logAudit(req.user || 'system', 'api_token_write_blocked', 'api_token', req.auth?.tokenId || null,
      { method: req.method, path: (req.baseUrl || '') + req.path, category, rule: rule?.label || null, prefix: req.auth?.prefix },
      null, null, req.auth?.label || null);
  } catch { /* the refusal stands even if the log write fails */ }
  return res.status(403).json({ error: 'token_denied', category, message: DENY_MESSAGES[category] || DENY_MESSAGES.not_open_to_tokens });
}
