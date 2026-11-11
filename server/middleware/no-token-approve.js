import { logAudit, getDb } from '../db.js';
import { isBotAccount } from '../trainees.js';
import { isActiveStatus } from '../../shared/product-status.js';

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
  // COA Phase 2 (D-244 … D-247): publishing, withdrawing, overriding the lot
  // rule and approving a test plan are a person's acts, never a bot's.
  'publish', 'withdraw', 'override', 'approve-plan',
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
const APPROVED_DOC_STATUSES = new Set(['active', 'under_review', 'approved']);

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
  // A product decision and a scale's return to use are password-signed by a person (D-194, D-195).
  // A supplier's disposition (SOP 404 § V.C.III) and a material's banned-list
  // check are Quality's decisions (D-339). Neither path names an approve word,
  // so they are listed here, not left to WRITE_AREAS staying narrow.
  { method: 'POST', re: /^\/suppliers\/[^/]+\/disposition$/, label: 'POST /api/suppliers/:id/disposition — the qualification decision' },
  { method: 'POST', re: /^\/suppliers\/[^/]+\/materials\/[^/]+\/banned-check$/, label: 'POST /api/suppliers/:id/materials/:mid/banned-check — a banned-list decision' },
  { method: 'POST', re: /^\/calibration\/dispositions\/[^/]+\/[^/]+$/, label: 'POST /api/calibration/dispositions/:source/:id — a signed product decision' },
  { method: 'POST', re: /^\/calibration\/incidents\/[^/]+\/return$/, label: 'POST /api/calibration/incidents/:id/return — QA returns a scale to use' },
  { method: 'POST', re: /^\/calibration\/records$/, label: 'POST /api/calibration/records carrying a product decision',
    when: (req) => !!req.body?.product_disposition?.disposition },
  // D-279: approvals whose path does not say so. A document filed or moved into
  // force, a paper revision applied, a training sign-off carrying the trainer's
  // competence statement, and marking a course updated for a revision.
  { method: 'POST', re: /^\/documents\/?$/, label: 'POST /api/documents filed as approved (status active / under review, or an approver named)',
    when: (req) => APPROVED_DOC_STATUSES.has(String(req.body?.status || '')) || !!req.body?.approved_by },
  { method: 'PUT', re: /^\/documents\/[^/]+$/, label: 'PUT /api/documents/:id carrying an approved status or an approver',
    when: (req) => APPROVED_DOC_STATUSES.has(String(req.body?.status || '')) || !!req.body?.approved_by },
  { method: 'POST', re: /^\/documents\/[^/]+\/apply-revision$/, label: 'POST /api/documents/:id/apply-revision — records an approved revision from the signed paper' },
  { method: 'POST', re: /^\/documents\/revisions\/items\/[^/]+\/apply$/, label: 'POST /api/documents/revisions/items/:id/apply — records an approved revision from the signed paper' },
  { method: 'POST', re: /^\/training\/?$/, label: 'POST /api/training carrying the trainer\'s competence statement',
    when: (req) => !!req.body?.competence_confirmed },
  { method: 'PUT', re: /^\/training\/[^/]+$/, label: 'PUT /api/training/:id carrying the trainer\'s competence statement',
    when: (req) => !!req.body?.competence_confirmed },
  { method: 'POST', re: /^\/pm\/work-orders\/[^/]+\/complete-and-recur$/, label: 'POST /api/pm/work-orders/:id/complete-and-recur carrying the trainer\'s competence statement',
    when: (req) => !!req.body?.check?.competence_confirmed },
  { method: 'POST', re: /^\/training\/bulk-complete$/, label: 'POST /api/training/bulk-complete — a group sign-off' },
  { method: 'POST', re: /^\/training\/courses\/[^/]+\/revision$/, label: 'POST /api/training/courses/:id/revision — a person says the course is updated for a revision' },
  // D-328: QA's password-signed review of a controlled value typed in the app.
  { method: 'POST', re: /^\/controlled\/[^/]+\/qa-review$/, label: 'POST /api/controlled/:id/qa-review — QA reviews a controlled value' },
  // D-302: a GTIN goes on a pack, and confirming a merch colour is what lets one
  // be drawn. A bot may suggest or reserve a number; only a person assigns it.
  { method: 'POST', re: /^\/products\/merch\/variants\/[^/]+\/gtin$/, label: 'POST /api/products/merch/variants/:sku/gtin — a person assigns a GTIN' },
  { method: 'POST', re: /^\/products\/merch\/colors\/[^/]+\/confirm$/, label: 'POST /api/products/merch/colors/:code/confirm — a person confirms a colour' },
  // R-0645 (D-342): moving a product to Active is the one commercial gate, and
  // only the configured approver makes it, in a person's own session. A token
  // or a bot account is refused here, before the handler, even on that
  // person's account; the handler checks it again (server/product-sot-gate.js).
  { method: 'PUT', re: /^\/products\/[^/]+$/, label: 'PUT /api/products/:sku moving the status to Active',
    when: (req) => isActiveStatus(req.body?.status) },
  { method: 'POST', re: /^\/products\/?$/, label: 'POST /api/products created as Active',
    when: (req) => isActiveStatus(req.body?.status) },
  { method: 'POST', re: /^\/products\/bulk-edit$/, label: 'POST /api/products/bulk-edit setting status to Active',
    when: (req) => req.body?.field === 'status' && isActiveStatus(req.body?.value) },
  // Who may sign the crisis drill's Management review (D-266) is a person's decision, never a token's.
  { method: 'PUT', re: /^\/safety\/drill-signers$/, label: 'PUT /api/safety/drill-signers — who signs the crisis drill for Management' },
  // D-313: "Apply to products" writes live specifications from an approved
  // plan — a password-signed act. A coa-prep token prepares the plan; a person applies it.
  { method: 'POST', re: /^\/coa\/plans\/[^/]+\/apply$/, label: 'POST /api/coa/plans/:id/apply — "Apply to products" writes live specifications; a person does it' },
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
    reason: route?.label || null,
  });
}

/**
 * A BOT ACCOUNT NEVER APPROVES, WHATEVER DOOR IT USES (D-279). A token is
 * refused above; this is the same refusal for a bot account signed in with a
 * password — any account that has ever held a token, ReadyBot, the Test Runner,
 * a "*"-named account. Its role and department do not matter.
 */
export function refuseBotAccountApprove(req, res, route) {
  try {
    logAudit(req.user || 'system', 'bot_approve_blocked', 'user', req.user?.id || null,
      { method: req.method, path: (req.baseUrl || '') + req.path, rule: route?.label || 'inline guard', via: 'session' },
      null, null, req.user?.name || null);
  } catch { /* the refusal stands even if the log write fails */ }
  return res.status(403).json({
    error: 'bot_account_cannot_approve',
    message: 'This is a bot account. Approving, signing, verifying or publishing needs a person signed in with their own account.',
  });
}

/** Global guard: refuses a token on any APPROVE_ROUTES or TOKEN_DENY match, and a bot account on any APPROVE_ROUTES match. Mounted once in server.js. */
export function tokenApproveGuard(req, res, next) {
  if (req.auth?.kind !== 'token') {
    const route = req.user ? approveRouteFor(req) : null;
    if (route) {
      const bot = (() => { try { return isBotAccount(getDb(), req.user); } catch { return false; } })();
      if (bot) return refuseBotAccountApprove(req, res, route);
    }
    return next();
  }
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
  'reject', 'dismiss', 'resolve', 'reopen', 'close', 'reinstate', 'restore', 'waive', 'acknowledge',
]);
const DELETE_SET = new Set(DELETE_SEGMENTS);
const DECISION_SET = new Set(DECISION_SEGMENTS);
// AP Drop moves a token may make: triage, and in_qbo (D-335) — the route
// refuses a token's in_qbo unless a QuickBooks bill id is sent or already
// stored. Paid, closed, in a payment run, not finance, receivable-other — the
// office's statements about money — are not.
export const AP_DROP_TOKEN_STATUSES = Object.freeze(['new', 'triaged', 'matched', 'needs_info', 'duplicate_suspect', 'in_qbo']);
// Artwork moves a token may make: put a draft up for review or back to draft,
// retire a version a newer one replaced (superseded), or reject one with a
// stated reason (D-330). NEVER approved, print_ready or released — those are the
// approve class above and are refused before this list is read.
export const ARTWORK_TOKEN_STATUSES = Object.freeze(['draft', 'in_review', 'superseded', 'rejected']);

const nonGet = (req) => !['GET', 'HEAD', 'OPTIONS'].includes(req.method);

// The ONE DELETE a token may make (D-170): taking back its OWN reaction on a
// message in a channel it is a member of. It removes nothing anybody else wrote
// — the handler deletes only the caller's row (user_id = the token's account)
// — so it is not the "delete" this list exists to refuse. Keep this list to
// paths whose DELETE can only ever undo the caller's own mark; check:apitokens
// asserts it holds exactly this one and that it is on WRITE_AREAS.
export const TOKEN_DELETE_EXEMPT = Object.freeze([
  { re: /^\/comms\/messages\/[^/]+\/reactions\/[^/]+$/, label: 'DELETE /api/comms/messages/:id/reactions/:emoji — remove its own reaction' },
]);
const deleteExempt = (req) => req.method === 'DELETE' && TOKEN_DELETE_EXEMPT.some(e => e.re.test(req.path));

export const TOKEN_DENY = Object.freeze([
  { category: 'delete', test: (req) => req.method === 'DELETE' && !deleteExempt(req), label: 'every DELETE but TOKEN_DELETE_EXEMPT (removing its own reaction)' },
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
    label: 'POST /api/ap-drop/:id/status to anything but a triage move or in_qbo (in_qbo needs a bill id — the route checks)' },
  { category: 'decision', test: (req) => req.method === 'POST' && /^\/artwork\/versions\/[^/]+\/status$/.test(req.path)
      && !ARTWORK_TOKEN_STATUSES.includes(String(req.body?.status || '')),
    label: 'POST /api/artwork/versions/:id/status to anything but draft / in_review / superseded / rejected (approved and print-ready are the approve class)' },
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
  return res.status(403).json({ error: 'token_denied', category, message: DENY_MESSAGES[category] || DENY_MESSAGES.not_open_to_tokens,
    ...(rule?.reason ? { reason: rule.reason } : {}) });
}
