// One MCP tool per route on ReadyDoc's bot surface (docs/bot-api.md, D-162).
//
// This is a COPY of server/bot-api.js BOT_ROUTES with a tool name, a
// description and an input schema added. It is a copy on purpose: the package
// has no runtime coupling to the server and is launched on a bot's own machine.
// `npm run check:botmcp` (in the repo) asserts the two lists name exactly the
// same method + path pairs, so the copy cannot drift without failing the build.
//
// There is no tool that approves, decides, signs, verifies, releases, settles,
// deletes, voids, archives, revokes or administers anything. The server would
// refuse one anyway (403 approve_requires_human_session / token_denied); the
// check asserts no tool NAME so much as suggests it, so a bot is never offered
// the act (D-163, D-164).
//
// A tool with `file` uploads one local file (read from `file_path` on the
// machine this server runs on) as multipart form data, the declared `body`
// fields alongside it.

const page = {
  limit: { type: 'integer', minimum: 1, maximum: 200, description: 'Rows per page (at most 200).' },
  offset: { type: 'integer', minimum: 0, description: 'Rows to skip.' },
};
const str = (description) => ({ type: 'string', description });
const num = (description) => ({ type: 'number', description });
const filePath = (what) => str(`Path to the ${what} on this machine. It is uploaded as the request's file.`);
// PUT /api/products/:sku — the catalogue's own WRITABLE list, minus legacy_sku
// (a code that shipped is never cleared). An absent field is left alone.
const PRODUCT_FIELDS = ['gtin', 'category', 'protein_type', 'pack', 'pack_count', 'flavor', 'base_flavor',
  'flavor_code', 'status', 'spec_id', 'eyemark_color', 'dieline_required', 'shopify_sku', 'shopify_variant_id',
  'mrp_formula_id', 'formula_rev', 'amazon_channel', 'amazon_sku', 'amazon_asin', 'drive_url', 'notes', 'fill_weight_g'];
const PO_FIELDS = ['po_number', 'vendor', 'part_no', 'description', 'qty', 'uom', 'unit_price', 'order_date',
  'expected_date', 'received_date', 'status', 'urgent', 'notes', 'quarter'];
const PARTNER_DOC_FIELDS = ['direction', 'doc_type', 'doc_number', 'reference', 'description', 'issued_date',
  'terms_days', 'due_date', 'amount', 'category'];
const anyProps = (keys, extra = {}) => Object.fromEntries(keys.map(k => [k, extra[k] || { type: ['string', 'number', 'boolean', 'null'], description: k.replace(/_/g, ' ') }]));

export const ROUTES = Object.freeze([
  { tool: 'whoami', method: 'GET', path: '/api/bot/whoami',
    description: 'Who this token acts as in ReadyDoc: the account, its module access, the token scopes, expiry and rate limits.',
    query: [], properties: {}, required: [] },

  { tool: 'list_products', method: 'GET', path: '/api/products', paged: true,
    description: 'The finished-goods catalog (SKU, GTIN, flavor, pack, readiness). Paged.',
    query: ['limit', 'offset'], properties: { ...page }, required: [] },
  { tool: 'get_product', method: 'GET', path: '/api/products/:sku',
    description: 'One product by SKU (current or legacy code), with readiness, stage, colors and packaging spec.',
    properties: { sku: str('The product SKU.') }, required: ['sku'] },

  { tool: 'update_product', method: 'PUT', path: '/api/products/:sku',
    description: "Edit a product's catalog fields. Send only the fields to change; a blank value clears one. NFP and artwork status move only through their approval flows. Needs a write token and an account that manages the catalog.",
    body: PRODUCT_FIELDS,
    properties: { sku: str('The product SKU.'), ...anyProps(PRODUCT_FIELDS) }, required: ['sku'] },

  { tool: 'list_nfp', method: 'GET', path: '/api/nfp', paged: true,
    description: 'Every nutrition panel version, and products with no panel. Paged on versions.',
    query: ['limit', 'offset'], properties: { ...page }, required: [] },
  { tool: 'get_nfp', method: 'GET', path: '/api/nfp/sku/:sku',
    description: "One product's nutrition panel history, newest first.",
    properties: { sku: str('The product SKU.') }, required: ['sku'] },
  { tool: 'create_nfp_draft', method: 'POST', path: '/api/nfp',
    description: 'File a DRAFT nutrition panel version for a product. Always a draft: approval is done by a person in ReadyDoc. Needs a write token.',
    body: ['sku', 'version', 'serving_size', 'servings_per_container', 'drive_url', 'change_summary'],
    properties: {
      sku: str('The product SKU.'), version: str('The panel version label, e.g. "V2".'),
      serving_size: str('Serving size as printed.'), servings_per_container: str('Servings per container.'),
      drive_url: str('Link to the panel file.'), change_summary: str('What changed from the last version.'),
    }, required: ['sku', 'version'] },

  { tool: 'list_artwork', method: 'GET', path: '/api/artwork', paged: true,
    description: 'The current artwork version of each pack, and products with none. Paged on packs.',
    query: ['limit', 'offset', 'status'], properties: { ...page, status: str('Only this artwork status.') }, required: [] },
  { tool: 'get_artwork_for_sku', method: 'GET', path: '/api/artwork/sku/:sku',
    description: 'A product and every artwork version for it.',
    properties: { sku: str('The product SKU.') }, required: ['sku'] },
  { tool: 'get_artwork_version', method: 'GET', path: '/api/artwork/versions/:id',
    description: 'One artwork version with its proofing checks, files and the label snapshot.',
    properties: { id: str('The artwork version id.') }, required: ['id'] },

  { tool: 'attach_artwork_file', method: 'POST', path: '/api/artwork/versions/:id/files',
    description: 'Attach one file (print PDF, preview, dieline, proof report) to an artwork version. Needs a write token and artwork edit access.',
    body: ['kind'], file: { arg: 'file_path', field: 'files', required: true },
    properties: {
      id: str('The artwork version id.'), file_path: filePath('file'),
      kind: { type: 'string', enum: ['print_pdf', 'preview', 'dieline', 'proof_report', 'other'], description: 'What the file is (default print_pdf).' },
    }, required: ['id', 'file_path'] },

  { tool: 'list_supply_orders', method: 'GET', path: '/api/procurement/pos', paged: true,
    description: 'Purchase orders from Procurement. Paged.',
    query: ['limit', 'offset', 'status', 'quarter', 'q', 'vendor'],
    properties: { ...page, status: str('Only this status.'), quarter: str('e.g. 2026-Q4.'), q: str('Search text.'), vendor: str('Only this vendor.') },
    required: [] },
  { tool: 'procurement_summary', method: 'GET', path: '/api/procurement/summary',
    description: 'Open purchase-order totals: open, urgent, delayed, scheduled spend by quarter.',
    query: ['quarter'], properties: { quarter: str('Only this quarter.') }, required: [] },
  { tool: 'list_procurement_demand', method: 'GET', path: '/api/procurement/demand', paged: true,
    description: 'Requested finished-good quantities (demand). Paged.',
    query: ['limit', 'offset', 'scenario'], properties: { ...page, scenario: str('Scenario id.') }, required: [] },

  { tool: 'create_supply_order', method: 'POST', path: '/api/procurement/pos',
    description: 'Create a purchase order in Procurement. vendor is required. Needs a write token and procurement edit access.',
    body: PO_FIELDS,
    properties: anyProps(PO_FIELDS, { vendor: str('The vendor.'), qty: num('Quantity.'), unit_price: num('Unit price.'), urgent: { type: 'boolean', description: 'Urgent.' } }),
    required: ['vendor'] },
  { tool: 'update_supply_order', method: 'PUT', path: '/api/procurement/pos/:id',
    description: 'Edit a purchase order. Send only the fields to change. Needs a write token and procurement edit access.',
    body: PO_FIELDS,
    properties: { id: str('The purchase order id.'), ...anyProps(PO_FIELDS, { qty: num('Quantity.'), unit_price: num('Unit price.'), urgent: { type: 'boolean', description: 'Urgent.' } }) },
    required: ['id'] },

  { tool: 'list_channels', method: 'GET', path: '/api/comms/channels', paged: true,
    description: "Messages channels this account can see, with unread counts. is_member says where it can read and post.",
    query: ['limit', 'offset'], properties: { ...page }, required: [] },
  { tool: 'read_channel_messages', method: 'GET', path: '/api/comms/channels/:channel_id/messages',
    description: 'Messages in a channel the account is a member of, oldest first.',
    query: ['limit', 'before', 'date'],
    properties: {
      channel_id: str('The channel id.'), limit: { type: 'integer', minimum: 1, maximum: 200, description: 'How many (default 50).' },
      before: str('created_at cursor: messages older than this.'), date: str('Only this day, YYYY-MM-DD.'),
    }, required: ['channel_id'] },
  { tool: 'read_thread', method: 'GET', path: '/api/comms/messages/:message_id/thread',
    description: 'A message and its thread replies.',
    properties: { message_id: str('The parent message id.') }, required: ['message_id'] },
  { tool: 'post_channel_message', method: 'POST', path: '/api/comms/channels/:channel_id/messages',
    description: 'Post a message in a channel the account is a member of, as the bot account. No @channel/@here/@everyone. Needs a write token.',
    body: ['body', 'parent_id'],
    properties: { channel_id: str('The channel id.'), body: str('The message text.'), parent_id: str('Reply in this thread.') },
    required: ['channel_id', 'body'] },

  { tool: 'list_ap_drops', method: 'GET', path: '/api/ap-drop', paged: true,
    description: 'AP Drop intake rows (finance PDFs) the account may see. Paged.',
    query: ['limit', 'offset', 'status', 'vendor', 'q'],
    properties: { ...page, status: str('outstanding (default), all, or one status.'), vendor: str('Only this vendor.'), q: str('Search text.') },
    required: [] },

  { tool: 'upload_ap_drop', method: 'POST', path: '/api/ap-drop',
    description: 'Drop one finance PDF or photo into AP Drop. The file is stored first and read after; nothing is paid or sent to QuickBooks. Needs a write token.',
    body: ['vendor_name', 'po_or_co_ref', 'amount', 'due_date', 'notes'], file: { arg: 'file_path', field: 'files', required: true },
    properties: {
      file_path: filePath('PDF or photo'), vendor_name: str('Vendor, if known.'), po_or_co_ref: str('PO or CO reference.'),
      amount: num('Total, if known.'), due_date: str('YYYY-MM-DD.'), notes: str('A note for the office.'),
    }, required: ['file_path'] },
  { tool: 'add_ap_drop_note', method: 'POST', path: '/api/ap-drop/:id/notes',
    description: 'Add a note to an AP Drop row. Needs a write token.',
    body: ['text'], properties: { id: str('The AP Drop id.'), text: str('The note.') }, required: ['id', 'text'] },

  { tool: 'list_partners', method: 'GET', path: '/api/partners', paged: true,
    description: 'Partner accounts on the Partner Reconciliation ledger. Paged.',
    query: ['limit', 'offset'], properties: { ...page }, required: [] },
  { tool: 'get_partner_reconciliation', method: 'GET', path: '/api/partners/:partner_id/reconcile',
    description: "A partner's netted balance as of a date, the documents in it, and what was left out and why.",
    query: ['as_of'], properties: { partner_id: str('The partner id.'), as_of: str('YYYY-MM-DD (default end of this month).') },
    required: ['partner_id'] },
  { tool: 'list_partner_credits', method: 'GET', path: '/api/partners/:partner_id/credits', paged: true,
    description: "A partner's credit facilities and what each has absorbed. Paged.",
    query: ['limit', 'offset'], properties: { partner_id: str('The partner id.'), ...page }, required: ['partner_id'] },
  { tool: 'add_partner_document', method: 'POST', path: '/api/partners/:partner_id/documents',
    description: 'Add an invoice, PO or credit to a partner ledger, optionally with its file. It always lands as a DRAFT; a person approves it as final. Needs a write token and partner-reconciliation edit access.',
    body: PARTNER_DOC_FIELDS, file: { arg: 'file_path', field: 'files', required: false },
    properties: {
      partner_id: str('The partner id.'), file_path: filePath('document (optional)'),
      ...anyProps(PARTNER_DOC_FIELDS, {
        direction: { type: 'string', enum: ['receivable', 'payable'], description: 'receivable = they owe us (default); payable = we owe them.' },
        doc_type: { type: 'string', enum: ['invoice', 'po', 'credit'], description: 'Default invoice.' },
        amount: num('Amount (a credit is positive; its type says it is a credit).'), terms_days: num('Payment terms in days.'),
      }),
    }, required: ['partner_id'] },
  { tool: 'update_partner_document', method: 'PUT', path: '/api/partners/documents/:doc_id',
    description: 'Edit a partner document while it is still a draft. A final, settled or disputed document cannot be changed by a bot. Needs a write token.',
    body: PARTNER_DOC_FIELDS,
    properties: { doc_id: str('The document id.'), ...anyProps(PARTNER_DOC_FIELDS, { amount: num('Amount.'), terms_days: num('Payment terms in days.') }) },
    required: ['doc_id'] },
]);

/** The server's own spelling of a path, for comparison with BOT_ROUTES (param names differ). */
export const canonicalPath = (p) => p.replace(/:[A-Za-z_]+/g, ':param');

/** A tool name that so much as suggests a person-only act (approve, delete, administer…). None may exist. */
export const FORBIDDEN_TOOL_NAME = /approve|decide|release|sign|send|verify|settle|delete|remove|void|archive|revoke|admin|token/i;
