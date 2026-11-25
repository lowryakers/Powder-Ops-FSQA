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
const SUPPLIER_FIELDS = ['vendor_type', 'actively_using', 'website', 'address', 'notes', 'food_contact', 'reason'];
const CONTACT_FIELDS = ['name', 'email', 'phone', 'role', 'notes', 'is_primary'];
const MATERIAL_FIELDS = ['item_description', 'manufacturer_name', 'item_number', 'risk_notes', 'is_active', 'current_part_system', 'parts'];
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

  // Suppliers (D-339). The edits need a write token holding the suppliers-edit
  // grant. A disposition, a banned-list check, a gate mode and every delete are
  // a person's and have no tool.
  { tool: 'list_suppliers', method: 'GET', path: '/api/suppliers',
    description: 'The supplier register with qualification status, gaps and counts.',
    properties: {}, required: [] },
  { tool: 'add_supplier', method: 'POST', path: '/api/suppliers',
    description: 'Add a supplier that is not on the register. It starts unqualified; a near-match of an existing name is refused with the candidates.',
    body: ['name', 'vendor_type', 'actively_using', 'website', 'notes'],
    properties: { name: str('Company name.'), vendor_type: str('Type, e.g. packaging or ingredient.'), actively_using: { type: 'boolean', description: 'We buy from it (default true).' },
      website: str('Website.'), notes: str('Notes.') }, required: ['name'] },
  { tool: 'list_expiring_supplier_documents', method: 'GET', path: '/api/suppliers/documents/expiring',
    description: 'Supplier documents that have expired or expire within `days` (default 90), with the ingredient each is about.',
    query: ['days'], properties: { days: num('Look-ahead in days (at most 365).') }, required: [] },
  { tool: 'search_supplier_documents', method: 'GET', path: '/api/suppliers/files',
    description: 'Search the COC / COA library across every supplier by PO, part, lot, kind or name.',
    query: ['kind', 'po_number', 'part_number', 'lot_number', 'q', 'limit'],
    properties: { kind: str('Document kind, e.g. coc or coa.'), po_number: str('PO number.'), part_number: str('Part number.'),
      lot_number: str('Lot number.'), q: str('Supplier or file name.'), limit: num('At most 500.') }, required: [] },
  { tool: 'get_supplier', method: 'GET', path: '/api/suppliers/:id',
    description: 'One supplier: contacts, ingredients and part numbers, documents, GMP certificate and letter-of-guarantee state.',
    properties: { id: str('The supplier id.') }, required: ['id'] },
  { tool: 'update_supplier', method: 'PUT', path: '/api/suppliers/:id',
    description: "Edit a supplier's details. A supplier we buy from needs a vendor type. Status is never set here. Turning actively_using off needs a reason.",
    body: SUPPLIER_FIELDS, properties: { id: str('The supplier id.'), ...anyProps(SUPPLIER_FIELDS) }, required: ['id'] },
  { tool: 'add_supplier_contact', method: 'POST', path: '/api/suppliers/:id/contacts',
    description: 'Add a contact. Role is quality, orders, sales or admin; is_primary makes it the one primary contact.',
    body: CONTACT_FIELDS, properties: { id: str('The supplier id.'), ...anyProps(CONTACT_FIELDS) }, required: ['id'] },
  { tool: 'update_supplier_contact', method: 'PUT', path: '/api/suppliers/contacts/:cid',
    description: 'Edit a contact (never removes one).',
    body: CONTACT_FIELDS, properties: { cid: str('The contact id.'), ...anyProps(CONTACT_FIELDS) }, required: ['cid'] },
  { tool: 'add_supplier_material', method: 'POST', path: '/api/suppliers/:id/materials',
    description: 'Add an ingredient with its part number(s). `parts` is a list of {system, part_number}; system is mrpeasy, keychain, manual or genesis.',
    body: MATERIAL_FIELDS, properties: { id: str('The supplier id.'), ...anyProps(MATERIAL_FIELDS, { parts: { type: 'array', description: 'Part numbers: [{system, part_number}].' } }) }, required: ['id'] },
  { tool: 'update_supplier_material', method: 'PUT', path: '/api/suppliers/materials/:mid',
    description: 'Edit an ingredient or its part numbers. is_active false retires it; nothing is deleted.',
    body: MATERIAL_FIELDS, properties: { mid: str('The ingredient id.'), ...anyProps(MATERIAL_FIELDS, { parts: { type: 'array', description: 'Part numbers: [{system, part_number}].' } }) }, required: ['mid'] },
  { tool: 'add_supplier_document', method: 'POST', path: '/api/suppliers/:id/files',
    description: 'File a document for a supplier. A GMP certificate or letter of guarantee needs expires_on. A COC or COA with a po_number posts one ReadyBot alert in the receiving channel.',
    body: ['kind', 'expires_on', 'material_id', 'lot_number', 'po_number', 'part_number', 'qty_note', 'mismatch_note', 'notify_receiving'], file: { arg: 'file_path', field: 'files', required: true },
    properties: { id: str('The supplier id.'), file_path: filePath('document'), kind: str('Document kind (coc, coa, …).'), expires_on: str('Expiry date, YYYY-MM-DD.'),
      material_id: str('The ingredient it is about.'), lot_number: str('Lot number(s), comma-separated.'),
      po_number: str('PO number the document covers.'), part_number: str('Part number(s), comma-separated.'),
      qty_note: str('Quantity covered, as written.'), mismatch_note: str('What does not match the PO.'),
      notify_receiving: str('"false" to file a COC/COA with a PO without the receiving alert.'), }, required: ['id', 'file_path'] },
  { tool: 'update_supplier_document', method: 'PUT', path: '/api/suppliers/files/:fileId',
    description: "Correct a filed document's kind, expiry, ingredient or lot. The file itself is never changed.",
    body: ['kind', 'expires_on', 'material_id', 'lot_number', 'po_number', 'part_number', 'qty_note', 'mismatch_note'],
    properties: { fileId: str('The file id.'), kind: str('Document kind.'), expires_on: str('YYYY-MM-DD, or blank to clear.'),
      material_id: str('The ingredient, or blank for the whole supplier.'), lot_number: str('Lot number.'),
      po_number: str('PO number the document covers.'), part_number: str('Part number(s), comma-separated.'),
      qty_note: str('Quantity covered, as written.'), mismatch_note: str('What does not match the PO.'), }, required: ['fileId'] },
  { tool: 'set_supplier_document_renewal', method: 'PUT', path: '/api/suppliers/files/:fileId/renewal',
    description: "Set the date on a letter of guarantee or GMP certificate already on file.",
    body: ['expires_on'], properties: { fileId: str('The file id.'), expires_on: str('YYYY-MM-DD.') }, required: ['fileId', 'expires_on'] },
  { tool: 'mark_supplier_gmp_certificate', method: 'PUT', path: '/api/suppliers/files/:fileId/gmp-certificate',
    description: 'Mark a general certificate on file as the supplier\'s third-party GMP certificate, with its expiry.',
    body: ['expires_on'], properties: { fileId: str('The file id.'), expires_on: str('YYYY-MM-DD.') }, required: ['fileId'] },

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
  { tool: 'read_ops_ask_status', method: 'GET', path: '/api/comms/messages/:message_id/ask-status',
    description: 'The state of the approval asks on an #ops-requests message or thread: open, recognized (the approver replied from a person\'s session), voided or deleted. Read only.',
    properties: { message_id: str('The ask message id, or the thread\'s top-level message id.') }, required: ['message_id'] },
  { tool: 'post_channel_message', method: 'POST', path: '/api/comms/channels/:channel_id/messages',
    description: 'Post a message in a channel or DM the account is a member of, as the bot account. No @channel/@here/@everyone. '
      + 'To attach files give file_path (or file_paths, up to 10): they are uploaded first and linked to the message; body is then optional. '
      + 'Needs a write token; account must be a channel member; pdf/png/jpg/csv/xlsx/docx only.',
    body: ['body', 'parent_id', 'approval_ask'],
    upload: { path: '/api/comms/channels/:channel_id/attachments', ...CHAT_FILES, ids: 'attachment_ids' },
    properties: {
      channel_id: str('The channel id.'), body: str('The message text. Optional when a file is attached.'), parent_id: str('Reply in this thread.'),
      approval_ask: { type: 'object', properties: { category: { type: 'string', enum: ['ops', 'code', 'process', 'staffing', 'training', 'artwork', 'internal', 'money', 'payment', 'qbo', 'bill_pay', 'outside_party'] } },
        required: ['category'], additionalProperties: false,
        description: 'Make this an approval ask (#ops-requests / #ops-requests-test only). money, payment, qbo, bill_pay and outside_party are never recognized.' },
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

  { tool: 'list_coc_drops', method: 'GET', path: '/api/coc-drop', paged: true,
    description: 'COC Drop: COC / COA photos and PDFs the dock dropped. Without the coc-drop or suppliers-edit grant, only drops this account made. Paged.',
    query: ['limit', 'offset', 'status', 'supplier', 'submitter', 'from', 'to', 'q'],
    properties: { ...page, status: str('Not filed (default), all, or one of new, matched, filed, mismatch.'), supplier: str('Supplier id or name.'),
      submitter: str('Who dropped it.'), from: str('YYYY-MM-DD.'), to: str('YYYY-MM-DD.'), q: str('PO, supplier, notes or file name.') },
    required: [] },
  { tool: 'get_coc_drop_meta', method: 'GET', path: '/api/coc-drop/meta',
    description: 'COC Drop: statuses, counts, the supplier list and the POs recently written down in ReadyDoc.',
    properties: {}, required: [] },
  { tool: 'upload_coc_drop', method: 'POST', path: '/api/coc-drop',
    description: 'Drop a COC / COA (a PDF or a photo) into the COC Drop queue. Needs a write token with coc-drop or suppliers-edit.',
    body: ['po_number', 'supplier_id', 'supplier_name', 'kind', 'notes'], file: { arg: 'file_path', field: 'files', required: true },
    properties: { file_path: filePath('PDF or photo'), po_number: str('PO number, if known.'), supplier_id: str('Supplier id.'),
      supplier_name: str('Supplier name, if not on the list.'), kind: str('coc (default) or coa.'), notes: str('A note.') }, required: ['file_path'] },
  { tool: 'update_coc_drop', method: 'PUT', path: '/api/coc-drop/:id',
    description: 'Match a COC drop: PO, part, lot, quantity, mismatch note, supplier, kind. A PO on a new drop makes it matched; a mismatch note makes it mismatch.',
    body: ['po_number', 'part_number', 'lot_number', 'qty_note', 'mismatch_note', 'supplier_id', 'supplier_name', 'kind', 'notes'],
    properties: { id: str('The drop id.'), po_number: str('PO number.'), part_number: str('Part number.'), lot_number: str('Lot number.'),
      qty_note: str('Quantity as written.'), mismatch_note: str('What does not match.'), supplier_id: str('Supplier id.'),
      supplier_name: str('Supplier name.'), kind: str('coc or coa.'), notes: str('Notes.') }, required: ['id'] },
  { tool: 'set_coc_drop_status', method: 'POST', path: '/api/coc-drop/:id/status',
    description: 'Move a COC drop to new, matched or mismatch (mismatch needs a reason). Filed is set by file_coc_drop.',
    body: ['status', 'reason'], properties: { id: str('The drop id.'), status: str('new, matched or mismatch.'), reason: str('Why.') }, required: ['id', 'status'] },
  { tool: 'add_coc_drop_note', method: 'POST', path: '/api/coc-drop/:id/notes',
    description: 'Add a note to a COC drop.',
    body: ['text'], properties: { id: str('The drop id.'), text: str('The note.') }, required: ['id', 'text'] },
  { tool: 'file_coc_drop', method: 'POST', path: '/api/coc-drop/:id/file',
    description: 'File a COC drop into the supplier library as one PDF with its PO, part and lot; the dock is told in the receiving channel. A supplier not on the register is added unqualified (a near-name match is refused). Needs suppliers-edit. Never receives or signs.',
    body: ['supplier_name', 'vendor_type'], properties: { id: str('The drop id.'), supplier_name: str('Supplier name, when the drop has none.'),
      vendor_type: str('Type, when a new supplier is added.') }, required: ['id'] },

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

  // D-303: the Quality bot's SOP staging. The writes need a token holding the
  // grant for the document's type (sops-edit / wi-edit / jd-edit, D-306) and an
  // account with edit on that module. Owners approve with their
  // password in ReadyDoc; no tool approves, signs, deletes or withdraws.
  { tool: 'create_sop_draft', method: 'POST', path: '/api/documents',
    description: 'File a NEW SOP, Work Instruction or Job Description as a draft. Never approved by this call; an owner approves it in ReadyDoc with their password. Needs a write token with the grant for the document type: sops-edit (SOP), wi-edit (Work Instruction), jd-edit (Job Description).',
    body: ['doc_type', 'doc_number', 'title', 'category', 'revision', 'effective_date', 'review_due', 'review_frequency', 'owner', 'content', 'source_file'],
    properties: {
      doc_type: { type: 'string', enum: ['sop', 'work_instruction', 'job_description'], description: 'sop (default), work_instruction or job_description. The token needs that type\'s grant.' },
      doc_number: str('The document number, e.g. "SOP 429".'), title: str('The title.'), category: str('The category (required).'),
      revision: str('The revision label, e.g. "V1".'), effective_date: str('YYYY-MM-DD, from the signed scan.'),
      review_due: str('YYYY-MM-DD (optional).'), review_frequency: str('annual, biennial… (optional).'), owner: str('The owner (optional).'),
      content: str('The SOP text.'), source_file: str('The source file name (optional).'),
    }, required: ['title', 'category'] },
  { tool: 'update_sop_draft', method: 'PUT', path: '/api/documents/:id',
    description: 'Edit a DRAFT SOP\'s fields and text. An approved SOP is refused: start a new revision instead. Needs a write token with the grant for the document type: sops-edit (SOP), wi-edit (Work Instruction), jd-edit (Job Description).',
    body: ['doc_number', 'title', 'category', 'revision', 'effective_date', 'review_due', 'review_frequency', 'owner', 'content', 'content_es', 'source_file', '_change_summary', '_minor'],
    properties: {
      id: str('The document id.'), doc_number: str('The document number.'), title: str('The title.'), category: str('The category.'),
      revision: str('The revision label.'), effective_date: str('YYYY-MM-DD.'), review_due: str('YYYY-MM-DD.'), review_frequency: str('The review frequency.'),
      owner: str('The owner.'), content: str('The SOP text.'), content_es: str('The Spanish text.'), source_file: str('The source file name.'),
      _change_summary: str('What changed, in a line.'), _minor: { type: 'boolean', description: 'A minor edit (does not ask for retraining).' },
    }, required: ['id'] },
  { tool: 'start_sop_revision', method: 'POST', path: '/api/documents/:id/revisions',
    description: 'Start a new draft revision of an APPROVED SOP. The SOP in force does not change until an owner approves the revision. One open draft per SOP. Needs a write token with the grant for the document type: sops-edit (SOP), wi-edit (Work Instruction), jd-edit (Job Description).',
    body: ['revision', 'change_summary'],
    properties: { id: str('The document id.'), revision: str('The new revision label, e.g. "V3".'), change_summary: str('What changes, in a line.') }, required: ['id'] },
  { tool: 'update_sop_revision', method: 'PUT', path: '/api/documents/:id/revisions/:rid',
    description: 'Edit an SOP\'s DRAFT revision: number, title, text, effective date. An approved revision is history and refused. Needs a write token with the grant for the document type: sops-edit (SOP), wi-edit (Work Instruction), jd-edit (Job Description).',
    body: ['revision', 'title', 'description', 'description_es', 'effective_date', 'change_summary', 'doc_number'],
    properties: {
      id: str('The document id.'), rid: str('The draft revision id.'), revision: str('The revision label.'), title: str('The title.'),
      doc_number: str('A new document number, staged on the draft; it moves onto the document only when a person approves the draft. A number another document holds is refused.'),
      description: str('The SOP text.'), description_es: str('The Spanish text.'), effective_date: str('YYYY-MM-DD, from the signed scan.'),
      change_summary: str('What changes, in a line.'),
    }, required: ['id', 'rid'] },
  { tool: 'attach_sop_pdf', method: 'POST', path: '/api/documents/:id/attachments',
    description: 'Attach a PDF (the signed scan) to an SOP. PDF only: the extension, type and contents must agree. Needs a write token with the grant for the document type: sops-edit (SOP), wi-edit (Work Instruction), jd-edit (Job Description).',
    body: ['kind', 'revision', 'title', 'revision_id'], file: { arg: 'file_path', many: 'file_paths', max: 10, field: 'files', required: true, allow: ['.pdf'] },
    properties: {
      id: str('The document id.'), kind: { type: 'string', enum: ['signed_original', 'attachment'], description: 'signed_original for the signed scan.' },
      revision: str('The revision the scan is of, e.g. "V3".'), title: str('A title (optional).'),
      revision_id: str('The open DRAFT revision this scan belongs to. The file waits with the draft and becomes the document\'s only when a person approves it.'),
      file_path: filePath('PDF'), file_paths: { type: 'array', items: { type: 'string' }, maxItems: 10, description: 'Several PDFs (up to 10).' },
    }, required: ['id'] },
  // D-366: the Controller bot's payment run. Writes need a token holding the
  // payment-run-controller grant on the account named Controller in the
  // settings. No tool approves, voids, confirms a class or touches bank details.
  { tool: 'get_payment_run', method: 'GET', path: '/api/payment-run',
    description: 'The live payment run: bills ready to pay and kept off, totals, settings, prepared runs, and the ProDough deposit balance (paid Deposits, oldest first; unpaid ones listed apart).',
    properties: {}, required: [] },
  { tool: 'get_run_closeout', method: 'GET', path: '/api/payment-run/runs/:id/closeout',
    description: "What is done and left on an approved run. Each open item says whose it is: bot (yours), person (Lowry's) or danny.",
    properties: { id: str('The payment run id.') }, required: ['id'] },
  { tool: 'list_production_invoices', method: 'GET', path: '/api/payment-run/production-invoices',
    description: 'Production invoices to ProDough. A to_invoice row carries deposit_preview: create the QBO invoice for its amount_due.',
    properties: {}, required: [] },
  { tool: 'record_bank_balance', method: 'PUT', path: '/api/payment-run/bank-balance',
    description: "This week's Powder Ops bank balance before the run is prepared. Send amount, or from_feed true to use the linked bank feed.",
    body: ['amount', 'from_feed'], properties: { amount: str('The balance in dollars.'), from_feed: { type: 'boolean', description: 'Use the linked bank feed balance.' } }, required: [] },
  { tool: 'record_run_bank_balance', method: 'POST', path: '/api/payment-run/runs/:id/bank-balance',
    description: 'The bank balance on a prepared run, before it goes to Danny.',
    body: ['amount', 'from_feed'], properties: { id: str('The payment run id.'), amount: str('The balance in dollars.'), from_feed: { type: 'boolean', description: 'Use the linked bank feed balance.' } }, required: ['id'] },
  { tool: 'suggest_bill_class', method: 'POST', path: '/api/payment-run/bills/:id/suggest-class',
    description: "Suggest a bill's class (prodough_material or powderops_expense) with the reason. Shown beside the bill; Jake confirms it, never the bot.",
    body: ['bill_class', 'why'], properties: { id: str('The AP Drop id of the bill.'), bill_class: { type: 'string', enum: ['prodough_material', 'powderops_expense'], description: 'The class suggested.' }, why: str('Why.') }, required: ['id', 'bill_class'] },
  { tool: 'record_transfer_received', method: 'POST', path: '/api/payment-run/runs/:id/received',
    description: 'The transfer from ProDough landed. Evidence is required: bank_txn_id (one of the close-out feed_matches) or file_path (a statement or screenshot: pdf, png, jpg, csv).',
    body: ['amount', 'received_on', 'bank_txn_id'], file: { arg: 'file_path', field: 'evidence', required: false, allow: ['.pdf', '.png', '.jpg', '.jpeg', '.csv'] },
    properties: { id: str('The payment run id.'), amount: str('The amount that arrived.'), received_on: str('YYYY-MM-DD it arrived.'), bank_txn_id: str('The matching bank-feed line.'), file_path: filePath('evidence file') }, required: ['id', 'amount'] },
  { tool: 'schedule_bill_payment', method: 'POST', path: '/api/payment-run/runs/:id/lines/:lineId/schedule',
    description: 'A bill payment scheduled (QBO Bill Pay, card or check) for a date. Calling again replaces the schedule. The bill stays open until the payment is recorded.',
    body: ['method', 'scheduled_on', 'reference'], properties: { id: str('The payment run id.'), lineId: str('The run line id.'), method: { type: 'string', enum: ['qbo_ach', 'debit_card', 'check', 'other'], description: 'How it will be paid.' }, scheduled_on: str('YYYY-MM-DD.'), reference: str('The Bill Pay reference.') }, required: ['id', 'lineId', 'method', 'scheduled_on'] },
  { tool: 'record_bill_paid', method: 'POST', path: '/api/payment-run/runs/:id/lines/:lineId/paid',
    description: 'A bill on the run was paid: method, date, reference and the QBO payment number.',
    body: ['method', 'paid_on', 'reference', 'qbo_payment_id'], properties: { id: str('The payment run id.'), lineId: str('The run line id.'), method: { type: 'string', enum: ['qbo_ach', 'debit_card', 'check', 'other'], description: 'How it was paid.' }, paid_on: str('YYYY-MM-DD.'), reference: str('The payment reference.'), qbo_payment_id: str('The QBO payment number.') }, required: ['id', 'lineId', 'method', 'reference'] },
  { tool: 'record_bill_qbo_payment', method: 'POST', path: '/api/payment-run/runs/:id/lines/:lineId/qbo',
    description: 'The QBO payment number for a bill already recorded paid.',
    body: ['qbo_payment_id'], properties: { id: str('The payment run id.'), lineId: str('The run line id.'), qbo_payment_id: str('The QBO payment number.') }, required: ['id', 'lineId', 'qbo_payment_id'] },
  { tool: 'upload_payment_proof', method: 'POST', path: '/api/payment-run/runs/:id/lines/:lineId/proof',
    description: 'Proof of payment for a bill (PDF or photo). Stored and hashed once.',
    file: { arg: 'file_path', field: 'file', required: true, allow: ['.pdf', '.png', '.jpg', '.jpeg'] },
    properties: { id: str('The payment run id.'), lineId: str('The run line id.'), file_path: filePath('proof') }, required: ['id', 'lineId', 'file_path'] },
  { tool: 'record_deposit_invoice', method: 'POST', path: '/api/payment-run/runs/:id/deposit-invoice',
    description: "The week's Deposit invoice number from QBO.",
    body: ['qbo_invoice_no'], properties: { id: str('The payment run id.'), qbo_invoice_no: str('The QBO invoice number.') }, required: ['id', 'qbo_invoice_no'] },
  { tool: 'close_payment_run', method: 'POST', path: '/api/payment-run/runs/:id/close',
    description: 'Close a finished run. Refused while anything is open, naming each item.',
    properties: { id: str('The payment run id.') }, required: ['id'] },
  { tool: 'record_production_order', method: 'POST', path: '/api/payment-run/production-invoices',
    description: "A closed MO or shipped order read from MRPEasy: ProDough's PO and each SKU with its quantity and the unit price on ProDough's PO. Held with reasons when it does not match the all-in price list.",
    body: ['source', 'mo_number', 'order_ref', 'prodough_po', 'event_date', 'lines', 'notes'],
    properties: { source: { type: 'string', enum: ['mo_closed', 'order_shipped'], description: 'What happened.' }, mo_number: str('The MO number.'), order_ref: str('The customer order number.'), prodough_po: str("ProDough's PO number."), event_date: str('YYYY-MM-DD.'),
      lines: { type: 'array', items: { type: 'object', properties: { sku: { type: 'string' }, qty: { type: 'number' }, po_unit_price: { type: 'number' } } }, description: 'The SKUs, quantities and PO unit prices.' }, notes: str('A note.') }, required: ['source', 'prodough_po', 'lines'] },
  { tool: 'recheck_production_order', method: 'POST', path: '/api/payment-run/production-invoices/:id/recheck',
    description: 'Check a held order again (the price list re-read), with a corrected prodough_po or lines if needed.',
    body: ['prodough_po', 'lines'], properties: { id: str('The production invoice id.'), prodough_po: str("ProDough's PO."), lines: { type: 'array', items: { type: 'object' }, description: 'Corrected lines.' } }, required: ['id'] },
  { tool: 'record_production_invoice', method: 'POST', path: '/api/payment-run/production-invoices/:id/invoiced',
    description: "The QBO invoice was created for deposit_preview.amount_due and sent to ProDough. The deposit balance comes off automatically, oldest first; 409 AMOUNT_DUE_CHANGED if it moved.",
    body: ['qbo_invoice_no', 'expected_amount_due'], properties: { id: str('The production invoice id.'), qbo_invoice_no: str('The QBO invoice number.'), expected_amount_due: { type: 'number', description: 'The amount the QBO invoice was made for.' } }, required: ['id', 'qbo_invoice_no', 'expected_amount_due'] },
]);

/** The server's own spelling of a path, for comparison with BOT_ROUTES (param names differ). */
export const canonicalPath = (p) => p.replace(/:[A-Za-z_]+/g, ':param');

/** A tool name that so much as suggests a person-only act (approve, delete, administer…). None may exist. */
export const FORBIDDEN_TOOL_NAME = /approve|decide|release|sign|send|verify|settle|delete|remove|void|archive|revoke|admin|token/i;
