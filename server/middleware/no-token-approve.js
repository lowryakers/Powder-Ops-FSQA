import { logAudit } from '../db.js';

// NOTHING A BOT HOLDS CAN APPROVE, SIGN, RELEASE OR SETTLE (D-161).
//
// A token's writes are already default-deny (WRITE_DRAFT_ALLOW in
// server/api-tokens.js), so in today's code none of these routes is reachable
// with a token anyway. This list is the SECOND, independent statement of the
// rule — the one that still holds the day somebody widens the allow-list by a
// line too many. It is checked centrally in authenticate() and mounted once
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

/** Global guard: refuses a token on any APPROVE_ROUTES match. Mounted once in server.js. */
export function tokenApproveGuard(req, res, next) {
  if (req.auth?.kind !== 'token') return next();
  const route = approveRouteFor(req);
  if (route) return refuseTokenApprove(req, res, route);
  next();
}

/** Inline guard for a route that must never be reached with a token, whatever the list says. */
export function rejectTokenAuth(req, res, next) {
  if (req.auth?.kind === 'token') return refuseTokenApprove(req, res, null);
  next();
}
