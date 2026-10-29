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
// fields alongside it; `many` names an array argument for several files and
// `allow` the extensions it may send. A tool with `upload` (post_channel_message)
// first uploads its files to that path, then sends the returned ids as `ids`
// with the JSON body — two requests, one tool.

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
// What a bot token may attach to a chat message — the server's
// TOKEN_CHAT_ATTACHMENT_TYPES (server/bot-api.js), checked here first so a
// refused file is named before anything is uploaded. The server still decides.
export const CHAT_ATTACHMENT_EXTENSIONS = Object.freeze(['.pdf', '.png', '.jpg', '.jpeg', '.csv', '.xlsx', '.docx']);
const CHAT_FILES = { arg: 'file_path', many: 'file_paths', max: 10, field: 'files', allow: CHAT_ATTACHMENT_EXTENSIONS };
// D-278: a course draft's fields, and the quiz shape (English + Spanish).
const DRAFT_FIELDS = ['course_id', 'title', 'code', 'category', 'description', 'retrain_months', 'passing_score', 'sop_id', 'built_from_revision', 'change_note', 'questions'];
const DRAFT_PROPS = {
  title: str('Course title.'), code: str('Course code, e.g. the document number.'), category: str('Category, e.g. GMP.'),
  description: str('What the course teaches.'), retrain_months: num('Retrain every N months (blank = one-time).'), passing_score: num('Pass mark, 1–100.'),
  sop_id: str('The controlled document the course is built from.'), built_from_revision: str("That document's revision (defaults to the one in force)."),
  change_note: str('What changed and why.'),
  questions: { type: ['array', 'null'], description: 'The quiz. null keeps the live quiz.', items: { type: 'object', properties: {
    type: { type: 'string', enum: ['multiple_choice', 'true_false', 'short_answer'] }, prompt: str('The question in English.'), prompt_es: str('The question in Spanish.'),
    options: { type: 'array', items: { type: 'string' } }, options_es: { type: 'array', items: { type: 'string' }, description: 'Spanish options, one for one with the English.' },
    correct_answer: str('The correct answer (for multiple choice, the option number, e.g. "2").'), points: num('Points (default 1).') }, required: ['prompt', 'correct_answer'] } },
};
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

  // D-171: the Product Manager bot's panel work. The two writes need a token
  // holding the `nfp-panel` grant; any other token is refused by the server.
  { tool: 'get_panel_values', method: 'GET', path: '/api/nfp/:id/panel-values',
    description: "A nutrition panel version's values, the source they were taken from, the reconciliation checks (fill weight, calories 4/4/9) with any warning still to be acknowledged, and the fields that differ from the product's approved panel.",
    properties: { id: str('The panel version id.') }, required: ['id'] },
  { tool: 'upload_panel_pdf', method: 'PUT', path: '/api/nfp/:id/panel-file',
    description: 'Upload or replace the panel file (PDF, PNG or JPG, 25 MB at most) on a DRAFT nutrition panel version. ReadyDoc hashes it, stores it as <SKU>_<version>_<date>.<ext>, and reads its values onto the blank fields of the draft as "extracted from file"; a value already typed is never overwritten and becomes a mismatch a person resolves. Needs a write token with the nutrition-panel grant.',
    file: { arg: 'file_path', field: 'file', required: true, allow: ['.pdf', '.png', '.jpg', '.jpeg'] },
    properties: { id: str('The panel version id.'), file_path: filePath('panel file (pdf, png or jpg)') }, required: ['id', 'file_path'] },
  { tool: 'write_panel_provenance', method: 'PUT', path: '/api/nfp/:id/provenance',
    description: 'Record what a DRAFT nutrition panel was computed from: the formula ref and version, the BOM fill weight, the formula per-serving fill, and the source system. Needs a write token.',
    body: ['formula_ref', 'formula_version', 'bom_fill_weight_g', 'fill_per_serving_g', 'source_system', 'generated_at', 'generated_by', 'notes'],
    properties: {
      id: str('The panel version id.'), formula_ref: str('The formula / BOM id, e.g. "F-00002".'), formula_version: str('The formula revision.'),
      bom_fill_weight_g: str('The BOM fill weight of the pack, in grams.'), fill_per_serving_g: str("The formula's per-serving fill in grams, unrounded."),
      source_system: str('mrpeasy, keychain, manual or genesis.'), generated_at: str('YYYY-MM-DD'), generated_by: str('Who generated the figures.'), notes: str('Notes.'),
    }, required: ['id'] },
  { tool: 'mark_panel_ready', method: 'POST', path: '/api/nfp/:id/ready',
    description: 'Mark a DRAFT nutrition panel ready for review. Returns its flags — what the reviewer will see. Never approves.',
    body: [], properties: { id: str('The panel version id.') }, required: ['id'] },
  { tool: 'get_panel_review_queue', method: 'GET', path: '/api/nfp/review-queue',
    description: 'The nutrition-panel review queue: panels ready for review grouped by product family, with changed fields and flags; products with no approved panel; open-draft count.',
    properties: {}, required: [] },
  { tool: 'write_panel_values', method: 'PUT', path: '/api/nfp/:id/panel-values',
    description: 'Write values on a DRAFT nutrition panel version. Send only the fields to set (a blank clears one) and source_ref, the file name or document id they were taken from — required on every write. The serving size keeps its gram weight. Needs a write token with the nutrition-panel grant; never approves.',
    body: ['values', 'source_ref'],
    properties: {
      id: str('The panel version id.'),
      source_ref: str('The file name or document id the values were taken from.'),
      values: { type: 'object', additionalProperties: false, description: 'Panel values to write.',
        properties: Object.fromEntries(['serving_size', 'serving_household', 'serving_grams', 'servings_per_container', 'calories', 'total_fat', 'saturated_fat',
          'trans_fat', 'cholesterol', 'sodium', 'total_carbohydrate', 'dietary_fiber', 'total_sugars', 'added_sugars',
          'protein', 'vitamin_d', 'calcium', 'iron', 'potassium', 'ingredients', 'allergen_statement']
          .map(k => [k, { type: ['string', 'number', 'null'], description: k.replace(/_/g, ' ') }])) },
    }, required: ['id', 'values', 'source_ref'] },

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
    description: 'Post a message in a channel or DM the account is a member of, as the bot account. No @channel/@here/@everyone. '
      + 'To attach files give file_path (or file_paths, up to 10): they are uploaded first and linked to the message; body is then optional. '
      + 'Needs a write token; account must be a channel member; pdf/png/jpg/csv/xlsx/docx only.',
    body: ['body', 'parent_id'],
    upload: { path: '/api/comms/channels/:channel_id/attachments', ...CHAT_FILES, ids: 'attachment_ids' },
    properties: {
      channel_id: str('The channel id.'), body: str('The message text. Optional when a file is attached.'), parent_id: str('Reply in this thread.'),
      file_path: filePath('file to attach (pdf, png, jpg, csv, xlsx or docx)'),
      file_paths: { type: 'array', items: { type: 'string' }, maxItems: 10, description: 'Up to 10 files to attach (pdf, png, jpg, csv, xlsx or docx), paths on this machine.' },
    },
    required: ['channel_id'], oneOf: [['body'], ['file_path'], ['file_paths']] },
  { tool: 'upload_channel_attachments', method: 'POST', path: '/api/comms/channels/:channel_id/attachments',
    description: 'Upload files to a channel or DM without posting yet; returns their ids for post_channel_message attachment_ids. '
      + 'Prefer post_channel_message with file_path, which does both. Needs a write token; account must be a channel member; pdf/png/jpg/csv/xlsx/docx only.',
    file: { ...CHAT_FILES, required: true },
    properties: {
      channel_id: str('The channel id.'),
      file_path: filePath('file (pdf, png, jpg, csv, xlsx or docx)'),
      file_paths: { type: 'array', items: { type: 'string' }, maxItems: 10, description: 'Up to 10 files, paths on this machine.' },
    },
    required: ['channel_id'] },

  { tool: 'add_reaction', method: 'POST', path: '/api/comms/messages/:message_id/reactions',
    description: "Add the bot account's own emoji reaction (e.g. ✅) to a message in a channel or DM the account is a member of. "
      + 'Never touches anybody else\'s reaction or the message itself. Needs a write token.',
    body: ['emoji'], properties: { message_id: str('The message id.'), emoji: str('The emoji, e.g. ✅.') }, required: ['message_id', 'emoji'] },
  { tool: 'undo_reaction', method: 'DELETE', path: '/api/comms/messages/:message_id/reactions/:emoji',
    description: "Take back the bot account's own reaction with this emoji on a message in a channel it is a member of. Only its own; nothing else. Needs a write token.",
    properties: { message_id: str('The message id.'), emoji: str('The emoji to take back, e.g. ✅.') }, required: ['message_id', 'emoji'] },

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

  { tool: 'list_user_activity', method: 'GET', path: '/api/user-activity', paged: true,
    description: "The activity log: who signed in, signed out or timed out, pages and records opened, changes (with before and after), files opened or downloaded. Newest first. Needs the account's 'User Activity' grant.",
    query: ['user_id', 'from', 'to', 'action', 'q', 'limit', 'offset'],
    properties: {
      user_id: str('Only this person.'), from: str('First day, YYYY-MM-DD (UTC).'), to: str('Last day, YYYY-MM-DD (UTC).'),
      action: { type: 'string', enum: ['login', 'logout', 'session_timeout', 'session_revoked', 'page_view', 'record_view', 'edit', 'download', 'file_open'], description: 'Only this kind of activity.' },
      q: str('Text in the page or record.'),
      ...page,
    }, required: [] },

  // D-278: the Quality bot's course drafts. The writes need a token holding the
  // `course-drafts` grant. Publishing takes two people in ReadyDoc; no tool does it.
  { tool: 'list_course_drafts', method: 'GET', path: '/api/training/drafts',
    description: 'Training course drafts (open by default), with the document and revision each was built from, who staged it and who has signed.',
    query: ['status'], properties: { status: { type: 'string', enum: ['draft', 'published', 'discarded', 'all'], description: 'Which drafts (default draft).' } }, required: [] },
  { tool: 'get_course_draft', method: 'GET', path: '/api/training/drafts/:id',
    description: 'One course draft: content, quiz, files, the document and revision it was built from, what changes against the live course, and its signatures.',
    properties: { id: str('The draft id.') }, required: ['id'] },
  { tool: 'stage_course_draft', method: 'POST', path: '/api/training/drafts',
    description: 'Stage a DRAFT training course. With course_id it starts as a copy of that live course; without it, a new course. Never visible to trainees and never counts; two people publish it in ReadyDoc. Needs a write token with the course-drafts grant.',
    body: DRAFT_FIELDS,
    properties: { course_id: str('The live course to draft a new version of (omit for a new course).'), ...DRAFT_PROPS }, required: [] },
  { tool: 'update_course_draft', method: 'PUT', path: '/api/training/drafts/:id',
    description: 'Edit an open course draft. Send only the fields to change; a blank clears one. Any signature already given is cleared. Needs a write token with the course-drafts grant.',
    body: [...DRAFT_FIELDS.filter(f => f !== 'course_id'), 'remove_material_ids', 'remove_draft_material_ids'],
    properties: {
      id: str('The draft id.'), ...DRAFT_PROPS,
      remove_material_ids: { type: 'array', items: { type: 'string' }, description: 'Live course files this draft takes away.' },
      remove_draft_material_ids: { type: 'array', items: { type: 'string' }, description: 'Files this draft added that should come off it.' },
    }, required: ['id'] },
  { tool: 'upload_course_draft_files', method: 'POST', path: '/api/training/drafts/:id/materials',
    description: 'Upload files to an open course draft: a training video (mp4, mov, m4v, webm; up to 2 GB), or a pdf, png, jpg, docx or pptx. Clears any signature. Needs a write token with the course-drafts grant.',
    body: ['title'], file: { arg: 'file_path', many: 'file_paths', max: 5, field: 'files', required: true, allow: ['.mp4', '.mov', '.m4v', '.webm', '.pdf', '.png', '.jpg', '.jpeg', '.docx', '.pptx'] },
    properties: { id: str('The draft id.'), title: str('A title for the file (optional).'), file_path: filePath('file'),
      file_paths: { type: 'array', items: { type: 'string' }, description: 'Several files (up to 5).' } }, required: ['id'] },
]);

/** The server's own spelling of a path, for comparison with BOT_ROUTES (param names differ). */
export const canonicalPath = (p) => p.replace(/:[A-Za-z_]+/g, ':param');

/** A tool name that so much as suggests a person-only act (approve, delete, administer…). None may exist. */
export const FORBIDDEN_TOOL_NAME = /approve|decide|release|sign|send|verify|settle|delete|remove|void|archive|revoke|admin|token/i;
