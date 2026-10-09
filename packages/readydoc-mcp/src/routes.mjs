// One MCP tool per route on ReadyDoc's bot surface (docs/bot-api.md, D-162).
//
// This is a COPY of server/bot-api.js BOT_ROUTES with a tool name, a
// description and an input schema added. It is a copy on purpose: the package
// has no runtime coupling to the server and is launched on a bot's own machine.
// `npm run check:botmcp` (in the repo) asserts the two lists name exactly the
// same method + path pairs, so the copy cannot drift without failing the build.
//
// There is no tool that approves, decides, sends, releases or signs. The server
// would refuse one anyway (403 approve_requires_human_session); the check
// asserts no tool NAME so much as suggests it, so a bot is never offered the act.

const page = {
  limit: { type: 'integer', minimum: 1, maximum: 200, description: 'Rows per page (at most 200).' },
  offset: { type: 'integer', minimum: 0, description: 'Rows to skip.' },
};
const str = (description) => ({ type: 'string', description });

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

  { tool: 'list_nfp', method: 'GET', path: '/api/nfp', paged: true,
    description: 'Every nutrition panel version, and products with no panel. Paged on versions.',
    query: ['limit', 'offset'], properties: { ...page }, required: [] },
  { tool: 'get_nfp', method: 'GET', path: '/api/nfp/sku/:sku',
    description: "One product's nutrition panel history, newest first.",
    properties: { sku: str('The product SKU.') }, required: ['sku'] },
  { tool: 'create_nfp_draft', method: 'POST', path: '/api/nfp',
    description: 'File a DRAFT nutrition panel version for a product. Always a draft: approval is done by a person in ReadyDoc. Needs a write-drafts token.',
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
    description: 'Post a message in a channel the account is a member of, as the bot account. No @channel/@here/@everyone. Needs a write-drafts token.',
    body: ['body', 'parent_id'],
    properties: { channel_id: str('The channel id.'), body: str('The message text.'), parent_id: str('Reply in this thread.') },
    required: ['channel_id', 'body'] },

  { tool: 'list_ap_drops', method: 'GET', path: '/api/ap-drop', paged: true,
    description: 'AP Drop intake rows (finance PDFs) the account may see. Paged.',
    query: ['limit', 'offset', 'status', 'vendor', 'q'],
    properties: { ...page, status: str('outstanding (default), all, or one status.'), vendor: str('Only this vendor.'), q: str('Search text.') },
    required: [] },

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
]);

/** The server's own spelling of a path, for comparison with BOT_ROUTES (param names differ). */
export const canonicalPath = (p) => p.replace(/:[A-Za-z_]+/g, ':param');

/** A tool name that so much as suggests an approval-class act. None may exist. */
export const FORBIDDEN_TOOL_NAME = /approve|decide|release|sign|send/i;
