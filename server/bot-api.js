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
  // D-278: the Quality bot's course drafts (writes need the course-drafts grant).
  { method: 'GET', path: '/api/training/drafts', module: 'training', scope: 'read' },
  { method: 'GET', path: '/api/training/drafts/:id', module: 'training', scope: 'read' },
  { method: 'POST', path: '/api/training/drafts', module: 'training (edit)', scope: 'write' },
  { method: 'PUT', path: '/api/training/drafts/:id', module: 'training (edit)', scope: 'write' },
  { method: 'POST', path: '/api/training/drafts/:id/materials', module: 'training (edit)', scope: 'write' },
  // D-303: SOP staging, with the sops-edit grant. Owners approve with their password.
  { method: 'POST', path: '/api/documents', module: 'sops (edit)', scope: 'write' },
  { method: 'PUT', path: '/api/documents/:id', module: 'sops (edit)', scope: 'write' },
  { method: 'POST', path: '/api/documents/:id/revisions', module: 'sops (edit)', scope: 'write' },
  { method: 'PUT', path: '/api/documents/:id/revisions/:rid', module: 'sops (edit)', scope: 'write' },
  { method: 'POST', path: '/api/documents/:id/attachments', module: 'sops (edit)', scope: 'write' },
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
const openDraft = (db, id) => {
  const d = db.prepare('SELECT status FROM course_drafts WHERE id = ?').get(id);
  return !d || d.status === 'draft'; // missing → the handler 404s
};
// SOP staging (D-303). Each `when` returns false — the token gets 403
// not_open_to_tokens — unless every condition holds, and says WHY on
// `req.tokenWriteRefusal`, which the refusal logs and returns. A document that
// does not exist passes, so the handler answers 404 rather than a bare refusal.
const SOP_SIBLINGS = '(?!(?:revisions|attachments|bulk|bulk-update|bulk-delete|pdf|extract|propose-revisions)(?:/|$))';
export const SOP_DRAFT_EDIT_KEYS = Object.freeze(['doc_number', 'title', 'category', 'revision', 'effective_date', 'review_due',
  'review_frequency', 'owner', 'content', 'content_es', 'source_file', '_change_summary', '_minor']);
export const SOP_REVISION_START_KEYS = Object.freeze(['revision', 'change_summary']);
// doc_number is STAGED on the draft (D-304) and moves onto the document only when a person approves it.
export const SOP_REVISION_EDIT_KEYS = Object.freeze(['revision', 'title', 'description', 'description_es', 'effective_date', 'change_summary', 'doc_number']);
const sopRefuse = (req, why) => { req.tokenWriteRefusal = why; return false; };
const sopDoc = (db, id) => db.prepare('SELECT id, doc_type, status FROM sop_documents WHERE id = ?').get(id);
const extraKeys = (body, allowed) => Object.keys(body || {}).filter((k) => !allowed.includes(k));
const approvalFields = (body) => ['approved_by', 'approved_at'].filter((k) => body?.[k] != null && body[k] !== '');
function sopCreateOk(req) {
  const b = req.body || {};
  if (b.status != null && b.status !== 'draft') return sopRefuse(req, `A bot files a document as a draft only (status "${b.status}" refused).`);
  if (approvalFields(b).length) return sopRefuse(req, `A bot never names an approver (${approvalFields(b).join(', ')} refused).`);
  if (b.doc_type != null && b.doc_type !== 'sop') return sopRefuse(req, `The sops-edit grant covers SOPs only (doc_type "${b.doc_type}" refused).`);
  return true;
}
function sopDraftEditOk(req, m, db) {
  const d = sopDoc(db, m[1]);
  if (!d) return true;
  if (d.doc_type !== 'sop') return sopRefuse(req, 'The sops-edit grant covers SOPs only.');
  if (d.status !== 'draft') return sopRefuse(req, `Only a draft SOP is edited by a bot; this one is ${d.status}. Start a new revision instead.`);
  const b = req.body || {};
  if (b.status != null && b.status !== 'draft') return sopRefuse(req, `A bot cannot move a document's status (status "${b.status}" refused).`);
  if (approvalFields(b).length) return sopRefuse(req, `A bot never names an approver (${approvalFields(b).join(', ')} refused).`);
  const extra = extraKeys(b, [...SOP_DRAFT_EDIT_KEYS, 'status']);
  if (extra.length) return sopRefuse(req, `Fields not open to a bot: ${extra.join(', ')}.`);
  return true;
}
function sopRevisionStartOk(req, m, db) {
  const d = sopDoc(db, m[1]);
  if (!d) return true;
  if (d.doc_type !== 'sop') return sopRefuse(req, 'The sops-edit grant covers SOPs only.');
  // A draft SOP passes here; the handler refuses it (409, edit it directly), which says more.
  const extra = extraKeys(req.body, SOP_REVISION_START_KEYS);
  if (extra.length) return sopRefuse(req, `Fields not open to a bot: ${extra.join(', ')}.`);
  return true;
}
function sopRevisionEditOk(req, m, db) {
  const d = sopDoc(db, m[1]);
  if (!d) return true;
  if (d.doc_type !== 'sop') return sopRefuse(req, 'The sops-edit grant covers SOPs only.');
  const r = db.prepare('SELECT status FROM document_revisions WHERE id = ? AND document_id = ?').get(m[2], m[1]);
  if (!r) return true; // the handler 404s: no such revision on this document
  if (r.status !== 'draft') return sopRefuse(req, `Only a draft revision is edited by a bot; this one is ${r.status}.`);
  const extra = extraKeys(req.body, SOP_REVISION_EDIT_KEYS);
  if (extra.length) return sopRefuse(req, `Fields not open to a bot: ${extra.join(', ')}.`);
  return true;
}
function sopAttachOk(req, m, db) {
  const d = sopDoc(db, m[1]);
  if (!d) return true;
  if (d.doc_type !== 'sop') return sopRefuse(req, 'The sops-edit grant covers SOPs only.');
  return true; // the file rules are the handler's (multipart): tokenSopAttachmentRefusal
}
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
  // D-302: holding a GS1 number is a bot's job; assigning it never is (APPROVE_ROUTES).
  { area: 'products', method: 'POST', re: /^\/products\/merch\/gtin\/reserve$/, label: 'POST /api/products/merch/gtin/reserve' },
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
  // The Quality bot's course drafts (D-278) — only a token holding the
  // `course-drafts` GRANT, and only while the draft is open. Live courses,
  // tests, materials and records stay off this list, so every write to them is
  // refused to every token. Signing and discarding are person-only by segment.
  { area: 'course-drafts', grant: 'course-drafts', method: 'POST', re: /^\/training\/drafts\/?$/, label: 'POST /api/training/drafts — stage a draft course (course-drafts grant)' },
  { area: 'course-drafts', grant: 'course-drafts', method: 'PUT', re: /^\/training\/drafts\/([^/]+)$/, label: 'PUT /api/training/drafts/:id (while draft; course-drafts grant)',
    when: (req, m, db) => openDraft(db, m[1]) },
  { area: 'course-drafts', grant: 'course-drafts', method: 'POST', re: /^\/training\/drafts\/([^/]+)\/materials$/, label: 'POST /api/training/drafts/:id/materials — files, a video up to 2 GB (while draft; course-drafts grant)',
    when: (req, m, db) => openDraft(db, m[1]) },
  // The Quality bot's SOP staging (D-303) — only a token holding the
  // `sops-edit` GRANT. Approving, signing, making effective, deleting,
  // withdrawing and reinstating stay off this list and on the deny lists.
  { area: 'sops', grant: 'sops-edit', method: 'POST', re: /^\/documents\/?$/, label: 'POST /api/documents — a draft SOP (sops-edit grant)', when: (req) => sopCreateOk(req) },
  { area: 'sops', grant: 'sops-edit', method: 'PUT', re: new RegExp(`^/documents/${SOP_SIBLINGS}([^/]+)$`), label: 'PUT /api/documents/:id — a draft SOP\'s fields and text (sops-edit grant)', when: sopDraftEditOk },
  { area: 'sops', grant: 'sops-edit', method: 'POST', re: new RegExp(`^/documents/${SOP_SIBLINGS}([^/]+)/revisions$`), label: 'POST /api/documents/:id/revisions — start a new revision of an approved SOP (sops-edit grant)', when: sopRevisionStartOk },
  { area: 'sops', grant: 'sops-edit', method: 'PUT', re: new RegExp(`^/documents/${SOP_SIBLINGS}([^/]+)/revisions/([^/]+)$`), label: 'PUT /api/documents/:id/revisions/:rid — the draft revision (sops-edit grant)', when: sopRevisionEditOk },
  { area: 'sops', grant: 'sops-edit', method: 'POST', re: new RegExp(`^/documents/${SOP_SIBLINGS}([^/]+)/attachments$`), label: 'POST /api/documents/:id/attachments — a PDF on an SOP (sops-edit grant)', when: sopAttachOk },
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

// A token is never told it may approve (D-279). A screen's `can_approve` /
// `can_sign` flag is computed from the ACCOUNT's role and department, and a bot
// filed under QA read "can_approve: true" on a document it can never approve —
// the server refuses the act at the door. Every such flag a token is sent reads
// false, so a bot cannot report a permission it does not have.
export const APPROVE_FLAG = /^can_(approve|sign|verify|publish|release|settle|decide|countersign|signoff)(_|$)/;
const falsify = (v) => (v && typeof v === 'object' && !Array.isArray(v))
  ? Object.fromEntries(Object.keys(v).map(k => [k, false])) : false;

export function stripForbidden(value, depth = 0) {
  if (depth > 12 || value == null || typeof value !== 'object') return value;
  if (Buffer.isBuffer(value)) return undefined;
  if (Array.isArray(value)) return value.map(v => stripForbidden(v, depth + 1));
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    if (isForbiddenKey(k)) continue;
    if (APPROVE_FLAG.test(k) && (typeof v === 'boolean' || (v && typeof v === 'object' && !Array.isArray(v)))) { out[k] = falsify(v); continue; }
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
/**
 * The SOP attach rule for a token (D-303): PDF only — the .pdf extension, the
 * application/pdf type and the %PDF- bytes must all agree. null when allowed.
 */
export function tokenSopAttachmentRefusal({ filename, mimetype, head }) {
  const name = String(filename || '');
  if (!/\.pdf$/i.test(name)) return `${name || 'This file'}: a bot token may attach only a PDF to an SOP.`;
  const mime = String(mimetype || '').toLowerCase().split(';')[0].trim();
  if (mime !== 'application/pdf') return `${name}: declared as ${mime || 'no type'}, not application/pdf.`;
  if (!MAGIC.pdf(Buffer.isBuffer(head) ? head : Buffer.alloc(0))) return `${name}: the contents are not a PDF.`;
  return null;
}

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
