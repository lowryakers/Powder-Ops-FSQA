// Universal file importer: bring a log in from Monday, Airtable, Google Drive,
// Slack or a desktop spreadsheet without a one-off script each time.
//
// The flow is deliberately four steps, because a silent bulk write into a
// compliance log is not something anyone should be able to do by accident:
//
//   analyze  upload the file, see the columns it found and a guessed mapping
//   preview  apply the mapping, validate every row, report create/update/skip
//   commit   write, upserting on a natural key so a re-run updates in place
//   record   each row keeps source + external_id, so provenance is answerable
//
// Adding a target is a TARGETS entry — the parsing, mapping UI, validation and
// idempotency are shared.

import { Router } from 'express';
import { randomUUID as uuid } from 'crypto';
import { createHash } from 'crypto';
import multer from 'multer';
import { getDb, logAudit } from '../db.js';
import { hasExplicitEdit } from '../module-access.js';
import { readTable, excelSerialToDate } from '../tabular.js';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

/* ── Coercion ────────────────────────────────────────────────────────────── */

const clean = (v) => String(v ?? '').trim();

// Spreadsheets hand back dates three ways: an Excel serial, an ISO string, or
// something locale-formatted. Normalize all of them to YYYY-MM-DD.
function toDate(v) {
  const s = clean(v);
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  if (/^\d+(\.\d+)?$/.test(s)) {
    const n = Number(s);
    // Excel serials for real dates land far from small counting numbers.
    if (n > 20000 && n < 80000) return excelSerialToDate(n);
  }
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

function toNumber(v) {
  const s = clean(v).replace(/[$,]/g, '');
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined; // undefined = invalid, null = empty
}

// Monday check columns arrive as "v", Airtable as "checked"/TRUE, CSV as 1/0.
function toBool(v) {
  const s = clean(v).toLowerCase();
  if (!s) return 0;
  return ['v', 'x', 'yes', 'true', '1', 'checked', '✓'].includes(s) ? 1 : 0;
}

/* ── Targets ─────────────────────────────────────────────────────────────── */

const TARGETS = {
  receiving_log: {
    label: 'Receiving Log',
    table: 'receiving_log',
    module: 'receiving-log',
    fields: [
      { key: 'inspection_no', label: 'Inspection #', aliases: ['name', 'inspection', 'inspection #'] },
      { key: 'date_received', label: 'Date Received', type: 'date', required: true, aliases: ['date received', 'received date', 'date'] },
      { key: 'po_number', label: 'PO #', aliases: ['po #', 'po', 'po number', 'purchase order'] },
      { key: 'part_number', label: 'Part #', required: true, aliases: ['part #', 'part', 'part number', 'item'] },
      { key: 'part_description', label: 'Part Description', aliases: ['part description', 'description'] },
      { key: 'vendor_lot', label: 'Vendor Lot #', aliases: ['vendor lot #', 'vendor lot', 'lot', 'lot #'] },
      { key: 'expiration_date', label: 'Expiration Date', type: 'date', aliases: ['expiration date', 'expiry', 'expires', 'exp date'] },
      { key: 'quantity_received', label: 'Quantity Received', type: 'number', aliases: ['quantity received', 'qty', 'quantity'] },
      { key: 'uom', label: 'UOM', aliases: ['uom', 'unit', 'unit of measure'] },
      { key: 'received_by', label: 'Received By', aliases: ['received by', 'receiver'] },
      { key: 'part_in_mrp', label: 'Part # in MRPEasy', type: 'bool', aliases: ['part # in mrpeasy', 'part in mrp'] },
      { key: 'received_in_mrp', label: 'Received in MRPEasy', type: 'bool', aliases: ['received in mrpeasy', 'received in mrp'] },
      { key: 'packing_slip_url', label: 'Packing Slip (link)', aliases: ['packing slip', 'packing slip url', 'files'] },
      { key: 'status_of_release', label: 'Status of Release', aliases: ['status of release', 'status', 'release status'] },
      { key: 'release_date', label: 'Release Date', type: 'date', aliases: ['release date', 'released'] },
      { key: 'notes', label: 'Notes', aliases: ['notes', 'comment', 'comments'] },
    ],
    // What makes a row "the same row" on a re-import. Deliberately the whole
    // natural key, not the inspection #: one inspection covers several line
    // items, so the Monday export repeats it (722 distinct values across 2,107
    // rows, "NA" 215 times). Keying on it alone would collapse most of the log
    // into a handful of records.
    identity: ['inspection_no', 'date_received', 'po_number', 'part_number', 'vendor_lot'],
    identityFallback: ['date_received', 'part_description', 'quantity_received'],
  },

  /* ── Monday.com contacts board (people we might hire) ────────────────────── */

  candidates: {
    label: 'People (candidate tracker)',
    table: 'candidates',
    module: 'candidates',
    fields: [
      { key: 'name', label: 'Name', required: true, aliases: ['name', 'contact', 'person'] },
      { key: 'title', label: 'Title', aliases: ['title', 'role', 'position'] },
      { key: 'company', label: 'Company', aliases: ['company', 'employer', 'where'] },
      // The board's "Type" is the area they'd fit, and one cell can hold two of
      // them ("cleaning/Maintenance"). Split on the way in, or she is findable
      // under neither.
      { key: 'areas', label: 'Type / area', aliases: ['type', 'area', 'department', 'areas'] },
      { key: 'phone', label: 'Phone', aliases: ['phone', 'mobile', 'cell', 'number'] },
      { key: 'email', label: 'Email', aliases: ['email', 'e-mail'] },
      // A DATE. The Monday export writes these as Excel serials (46087, 46091,
      // 46094); `toDate` resolves those, and a blank stays blank rather than
      // becoming "not interviewed", which is a different claim.
      { key: 'interviewed_on', label: 'Interviewed', type: 'date', aliases: ['interviewed', 'interview', 'interview date'] },
      { key: 'notes', label: 'Notes', aliases: ['notes', 'note', 'comment', 'comments'] },
    ],
    columns: ['name', 'title', 'company', 'areas', 'phone', 'email', 'interviewed_on', 'notes', 'source'],
    transform: (row) => ({
      ...row,
      areas: JSON.stringify(String(row.areas || '').split(/[/,;]/).map(s => s.trim()).filter(Boolean)),
      source: 'monday',
    }),
    // A function, not an object — it is called per row.
    insertDefaults: () => ({ status: 'prospect' }),
    // Name alone is not enough — the seven real rows contain two people called
    // Vanessa. The phone is what actually tells them apart, and the pair is
    // stable across re-exports of the same board.
    identity: ['name', 'phone'],
    identityFallback: ['name', 'company', 'notes'],
  },

  /* ── Monday.com procurement board ────────────────────────────────────────── */

  purchase_orders: {
    label: 'Purchase Orders (Monday board)',
    table: 'purchase_orders',
    module: 'procurement',
    fields: [
      { key: 'description', label: 'Item', required: true, aliases: ['name', 'item', 'description', 'part description'] },
      { key: 'part_no', label: 'Item #', aliases: ['item #', 'item no', 'part #', 'part no', 'part number'] },
      { key: 'po_number', label: 'PO #', aliases: ['po', 'po #', 'po number', 'purchase order'] },
      { key: 'qty', label: 'Order qty', type: 'number', aliases: ['order qty', 'qty', 'quantity', 'order quantity'] },
      { key: 'expected_date', label: 'ETA', type: 'date', aliases: ['eta', 'expected', 'expected date', 'due'] },
      { key: 'vendor', label: 'Vendor', aliases: ['vendor', 'supplier'] },
      { key: 'source_status', label: 'Status', aliases: ['status'] },
      { key: 'label', label: 'Label', aliases: ['label', 'priority'] },
      { key: 'lead_time_days', label: 'Lead Time', type: 'number', aliases: ['lead time', 'lead time (days)'] },
      { key: 'customer_po', label: 'Customer PO', aliases: ['customer po', 'cust po'] },
      { key: 'customer', label: 'Customer', aliases: ['customer', 'cust'] },
      { key: 'notes', label: 'Notes', aliases: ['notes', 'comment', 'comments'] },
      { key: 'bol', label: 'BOL', aliases: ['bol', 'bill of lading'] },
    ],
    columns: ['description', 'part_no', 'po_number', 'qty', 'expected_date', 'vendor', 'source_status',
      'lead_time_days', 'customer_po', 'customer', 'notes', 'bol', 'status', 'urgent'],
    transform: (row) => ({
      ...row,
      // `vendor` is NOT NULL and 44 of the real rows have none — an inquiry
      // raised before anyone was chosen. Written as Unknown so the row
      // survives and stays findable, rather than being dropped as invalid.
      vendor: clean(row.vendor) || 'Unknown',
      // `qty` is NOT NULL DEFAULT 0 and 145 of the real rows have no quantity —
      // an inquiry raised before anyone decided how much. An explicit NULL
      // violates the constraint, so it takes the column's own default and the
      // row survives.
      qty: Number(row.qty) || 0,
      status: PO_STATUS[String(clean(row.source_status)).toLowerCase()] || 'draft',
      urgent: /urgent/i.test(String(row.label ?? '')) ? 1 : 0,
    }),
    // A board row is one item on one PO. Rows with no PO yet (145 of 351 —
    // they are inquiries) still need identity, so the item carries it.
    identity: ['po_number', 'part_no', 'description'],
    identityFallback: ['description', 'vendor', 'qty'],
  },

  /* ── QuickBooks report exports ─────────────────────────────────────────────
   *
   * The API route to this data is gated behind an Intuit app review that may
   * never clear, so the reports QuickBooks exports natively are a first-class
   * way in rather than a fallback. Column names below are the ones the real
   * Powder Ops exports actually use, read from the files rather than guessed.
   *
   * Every QuickBooks report interleaves subtotal rows with the data, which is
   * what `skipRow` exists for.
   */

  qbo_accounts: {
    label: 'Chart of Accounts (QuickBooks)',
    table: 'qbo_accounts',
    module: 'accounts-payable',
    // NOTE: a QuickBooks Account List gives the FULLY QUALIFIED name in the
    // Account Name column — "Payroll Liabilities:401K Liability" — which is
    // how QuickBooks itself displays it, so it is stored as-is rather than
    // split into a parent that the export never states explicitly.
    fields: [
      { key: 'name', label: 'Account Name', required: true, aliases: ['account name', 'account', 'name', 'full name'] },
      { key: 'account_type', label: 'Type', aliases: ['type', 'account type'] },
      { key: 'account_sub_type', label: 'Detail Type', aliases: ['detail type', 'detail', 'sub type', 'account sub type'] },
      { key: 'description', label: 'Description', aliases: ['description', 'desc'] },
      { key: 'current_balance', label: 'Balance', type: 'number', aliases: ['total balance', 'balance', 'current balance'] },
    ],
    skipRow: (r) => /^total\b/i.test(clean(r['Account Name'] ?? r['Column 1'] ?? '')),
    filteredNote: 'subtotal and total rows',
    identity: ['name'],
    identityFallback: ['name', 'account_type'],
  },

  qbo_vendors: {
    label: 'Vendors (QuickBooks)',
    table: 'qbo_contacts',
    module: 'accounts-payable',
    fields: [
      { key: 'kind', label: 'Kind', const: 'vendor' },
      { key: 'name', label: 'Vendor', required: true, aliases: ['vendor', 'vendor display name', 'name', 'display name'] },
      { key: 'company', label: 'Company', aliases: ['company', 'company name'] },
      { key: 'email', label: 'Email', aliases: ['email', 'e-mail'] },
      { key: 'phone', label: 'Phone', aliases: ['phone numbers', 'phone', 'phone number'] },
      { key: 'address', label: 'Address', aliases: ['billing address', 'bill address', 'address'] },
      { key: 'balance', label: 'Open Balance', type: 'number', aliases: ['open balance', 'balance'] },
    ],
    skipRow: (r) => /^total\b/i.test(clean(r.Vendor ?? '')),
    filteredNote: 'total rows',
    identity: ['kind', 'name'],
    identityFallback: ['kind', 'company', 'email'],
  },

  qbo_customers: {
    label: 'Customers (QuickBooks)',
    table: 'qbo_contacts',
    module: 'accounts-receivable',
    fields: [
      { key: 'kind', label: 'Kind', const: 'customer' },
      { key: 'name', label: 'Customer', required: true, aliases: ['customer full name', 'customer', 'name', 'display name'] },
      { key: 'company', label: 'Company', aliases: ['company', 'company name'] },
      { key: 'email', label: 'Email', aliases: ['email', 'e-mail'] },
      { key: 'phone', label: 'Phone', aliases: ['phone numbers', 'phone', 'phone number'] },
      { key: 'address', label: 'Address', aliases: ['bill address', 'billing address', 'address'] },
      { key: 'balance', label: 'Open Balance', type: 'number', aliases: ['open balance', 'balance'] },
    ],
    skipRow: (r) => /^total\b/i.test(clean(r['Customer full name'] ?? '')),
    filteredNote: 'total rows',
    identity: ['kind', 'name'],
    identityFallback: ['kind', 'email'],
  },

  ap_invoices: {
    label: 'Bills → Accounts Payable (QuickBooks)',
    table: 'ap_invoices',
    module: 'accounts-payable',
    // Takes either report. An A/P Aging Detail carries the open balance, so
    // those rows land as still-owed; a Transaction List has no balance column
    // and lands as paid, which is what a historical bill is.
    fields: [
      { key: 'vendor', label: 'Vendor', required: true, aliases: ['vendor display name', 'vendor', 'name', 'supplier'] },
      { key: 'invoice_number', label: 'Bill #', aliases: ['num', 'bill #', 'invoice #', 'number', 'doc number'] },
      { key: 'invoice_date', label: 'Bill Date', type: 'date', required: true, aliases: ['date', 'bill date', 'txn date', 'transaction date'] },
      { key: 'due_date', label: 'Due Date', type: 'date', aliases: ['due date', 'due'] },
      { key: 'amount', label: 'Amount', type: 'number', required: true, aliases: ['amount', 'total', 'total amount'] },
      { key: 'notes', label: 'Memo', aliases: ['memo', 'description', 'notes'] },
      { key: 'open_balance', label: 'Open Balance', type: 'number', aliases: ['open balance', 'balance', 'amount due'] },
    ],
    // What is still owed decides the status, and the paid figure follows from
    // it. A row with no open-balance column at all is history: fully paid.
    columns: ['vendor', 'invoice_number', 'invoice_date', 'due_date', 'amount', 'notes', 'amount_paid', 'status'],
    transform: (row) => applyLedgerDerivation('ap_invoices', row),
    // A bill from a plain transaction list is history: if it were still owed,
    // the aging report would carry it.
    insertDefaults: (row) => ({ status: 'paid', amount_paid: Number(row.amount) || 0 }),
    // Deliberately NOT keyed on the vendor name. QuickBooks spells the same
    // supplier differently between reports — the aging says "V00301 M4
    // Dynamic" where the transaction list says "M4 Dynamic" — and keying on it
    // imported the same two bills twice. A bill number with its date and
    // amount is the bill; the vendor string is a label.
    identity: ['invoice_number', 'invoice_date', 'amount'],
    identityFallback: ['vendor', 'invoice_date', 'amount'],
    // A Transaction List filtered to Bills still contains every Bill Payment
    // against them — 733 of 1,471 rows in the real export. Importing those
    // would invent 733 bills that were never issued. Subtotal rows go too.
    skipRow: (r) => {
      // Where the file states a transaction type, only Bills are bills. Where
      // it states none, the row is a subtotal or the TOTAL line — those carry
      // "TOTAL" in the date column, so emptiness is not a reliable test.
      if ('Transaction type' in r) return clean(r['Transaction type']) !== 'Bill';
      return /^total\b/i.test(clean(r['Column 1'] ?? '')) || !toDate(r.Date);
    },
    filteredNote: 'bill payments, subtotals and total rows',
  },

  ar_invoices: {
    label: 'Invoices → Accounts Receivable (QuickBooks)',
    table: 'ar_invoices',
    module: 'accounts-receivable',
    fields: [
      { key: 'customer', label: 'Customer', required: true, aliases: ['customer full name', 'customer', 'name'] },
      { key: 'invoice_number', label: 'Invoice #', aliases: ['num', 'invoice #', 'number', 'doc number'] },
      { key: 'invoice_date', label: 'Invoice Date', type: 'date', required: true, aliases: ['date', 'invoice date', 'txn date'] },
      { key: 'due_date', label: 'Due Date', type: 'date', aliases: ['due date', 'due'] },
      { key: 'amount', label: 'Amount', type: 'number', required: true, aliases: ['amount', 'total', 'total amount'] },
      { key: 'notes', label: 'Memo', aliases: ['memo', 'description', 'notes'] },
      { key: 'open_balance', label: 'Open Balance', type: 'number', aliases: ['open balance', 'balance', 'amount due'] },
    ],
    columns: ['customer', 'invoice_number', 'invoice_date', 'due_date', 'amount', 'notes', 'amount_received', 'status'],
    transform: (row) => applyLedgerDerivation('ar_invoices', row),
    insertDefaults: (row) => ({ status: 'paid', amount_received: Number(row.amount) || 0 }),
    identity: ['invoice_number', 'invoice_date', 'amount'],
    identityFallback: ['customer', 'invoice_date', 'amount'],
    skipRow: (r) => {
      if ('Transaction type' in r) return clean(r['Transaction type']) !== 'Invoice';
      return /^total\b/i.test(clean(r['Column 1'] ?? '')) || !toDate(r.Date);
    },
    filteredNote: 'payments, subtotals and total rows',
  },
};

/**
 * Monday's seven states onto the six this table admits.
 *
 * The board distinguishes things the schema does not, so the mapping loses a
 * distinction — which is why `source_status` keeps Monday's own word verbatim
 * on every row. Two calls worth stating out loud:
 *
 *   * "Inquired" is a DRAFT, not an open order. 111 of the 351 rows are
 *     inquiries; counting them as open would say a third of the board is on
 *     order when nothing has been placed.
 *   * "Received (partial)" is OPEN, because the question this board answers is
 *     what is still coming, and part of it is. Calling it received would close
 *     a line that still owes product.
 *
 * A blank status is a draft rather than the table's own `open` default — an
 * unstated status is not a placed order.
 */
const PO_STATUS = {
  inquired: 'draft',
  ordered: 'open',
  payment: 'confirmed',
  paid: 'confirmed',
  shipped: 'shipped',
  'received (partial)': 'open',
  received: 'received',
  cancelled: 'cancelled',
  canceled: 'cancelled',
};

// `open_balance` is read from the file but is not a column on either ledger —
// it is how the status and the paid figure are worked out. A bill with no open
// balance at all came from a plain transaction list, which is history: paid.
const LEDGER_STATUS = {
  ap_invoices: { paidField: 'amount_paid', open: 'approved', settled: 'paid' },
  ar_invoices: { paidField: 'amount_received', open: 'sent', settled: 'paid' },
};

function applyLedgerDerivation(targetKey, row) {
  const cfg = LEDGER_STATUS[targetKey];
  if (!cfg) return row;
  const out = { ...row };
  delete out.open_balance;

  // THE FILE MAY NOT KNOW. An Aging Detail carries an open balance and is the
  // authority on what is still owed; a Transaction List has no such column and
  // is history. Letting history answer "is this paid?" is how importing the
  // second file marked every outstanding bill settled and dropped AP from
  // $112,012.56 to $83,644 — caught by this exact test.
  //
  // So when the column is absent these are left UNDEFINED: a new row takes the
  // insert default (history is paid), and an existing row keeps whatever the
  // aging report already told us.
  if (row.open_balance === undefined) return out;

  const amount = Number(row.amount) || 0;
  const open = row.open_balance === null ? 0 : Number(row.open_balance) || 0;
  out[cfg.paidField] = Math.max(0, amount - open);
  out.status = open <= 0 ? cfg.settled : cfg.open;
  return out;
}

const norm = (s) => clean(s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

// Guess a mapping by matching each target field against the file's headers.
// Exact alias first, then a contains match — the goal is that a Monday export
// lands fully mapped and the person just confirms.
function suggestMapping(target, headers) {
  const map = {};
  const used = new Set();
  for (const f of target.fields) {
    if (f.const !== undefined || f.derive) continue;   // not read from the file
    const cands = [norm(f.label), norm(f.key), ...(f.aliases || []).map(norm)];
    let hit = headers.find(h => !used.has(h) && cands.includes(norm(h)));
    if (!hit) hit = headers.find(h => !used.has(h) && cands.some(c => c && norm(h).includes(c)));
    if (hit) { map[f.key] = hit; used.add(hit); }
  }
  return map;
}

// A stable id for the row so re-importing updates in place instead of
// duplicating.
//
// The business key alone is NOT enough to call two rows the same record. The
// same item legitimately arrives twice against one inspection #, PO and lot —
// two pallets, two partial deliveries — differing only in quantity, expiry or
// packing slip. Treating those as duplicates silently discards real receipts.
//
// So the identity is the business key PLUS which occurrence of that key this
// row is within the file. Two separate receipts get occurrence 0 and 1 and both
// import; re-running the same export lands on the same occurrences and updates
// in place; and a row edited upstream still matches its slot rather than
// duplicating. Only rows that are identical *and* redundant collapse — and that
// check is made on full row content, below.
function identityFor(target, row, occurrence = 0) {
  let parts = target.identity.map(k => clean(row[k]));
  if (!parts.some(Boolean)) {
    parts = target.identityFallback.map(k => clean(row[k]));
    if (!parts.some(Boolean)) return null;
  }
  const seed = `${parts.join('|').toLowerCase()}#${occurrence}`;
  return `${target.table}:${createHash('sha1').update(seed).digest('hex').slice(0, 24)}`;
}

// The business key on its own, used only to count occurrences within a file.
function businessKey(target, row) {
  const parts = target.identity.map(k => clean(row[k]));
  return (parts.some(Boolean) ? parts : target.identityFallback.map(k => clean(row[k]))).join('|').toLowerCase();
}

// Full-content fingerprint. Two rows matching on this are the same receipt
// entered twice — the only case where skipping is right.
function contentHash(target, row) {
  const parts = target.fields.map(f => clean(row[f.key]));
  return createHash('sha1').update(parts.join('|').toLowerCase()).digest('hex');
}

// Some source files carry rows that are not records at all, and some carry
// records for a DIFFERENT target. A QuickBooks report puts "Total for 1 - 30
// days past due" and "TOTAL" subtotal rows in with the data, and a Transaction
// List filtered to Bills still contains every Bill Payment against them — 733
// of them in the real export. Importing those would invent 733 bills that were
// never issued.
//
// So a target may declare `skipRow(src)`. It runs on the SOURCE row before any
// mapping, and its rows are counted as `filtered` rather than `skip` — a
// subtotal line is not a broken row, and reporting 738 errors on a good file is
// how someone concludes the import is broken and gives up.
const filteredOut = (target, src) => !!(target.skipRow && target.skipRow(src));

// Apply a mapping to one source row and validate it.
function buildRow(target, mapping, src) {
  const out = {};
  const errors = [];
  for (const f of target.fields) {
    // A constant: the file doesn't carry it because the file IS that thing.
    // A vendor contact list has no "kind" column; every row is a vendor.
    if (f.const !== undefined) { out[f.key] = f.const; continue; }
    const header = mapping[f.key];
    if (!header) continue;
    const raw = src[header];
    let v;
    if (f.type === 'date') v = toDate(raw);
    else if (f.type === 'number') { v = toNumber(raw); if (v === undefined) { errors.push(`${f.label}: "${clean(raw)}" is not a number`); v = null; } }
    else if (f.type === 'bool') v = toBool(raw);
    else v = clean(raw) || null;
    out[f.key] = v;
  }
  // Values computed from the mapped ones — a status implied by an open
  // balance, say. Runs after mapping so it can read the finished row.
  for (const f of target.fields) {
    if (f.derive) out[f.key] = f.derive(out) ?? null;
  }
  for (const f of target.fields) {
    if (f.required && (out[f.key] === null || out[f.key] === undefined || out[f.key] === '')) {
      errors.push(`${f.label} is required`);
    }
  }
  return { row: out, errors };
}

// What is READ from the file (fields) and what is WRITTEN to the table are not
// always the same set: a ledger reads an open balance in order to work out the
// status and the paid figure, and writes those instead.
const columnsOf = (target) => target.columns || target.fields.map(f => f.key);
const shapeRow = (target, row) => (target.transform ? target.transform(row) : row);

const canImport = (u, target) => u?.role === 'admin' || hasExplicitEdit(u, target.module);

/* ── Endpoints ───────────────────────────────────────────────────────────── */

router.get('/targets', (req, res) => {
  res.json(Object.entries(TARGETS).map(([key, t]) => ({
    key, label: t.label,
    fields: t.fields.map(f => ({ key: f.key, label: f.label, type: f.type || 'text', required: !!f.required })),
    can_import: canImport(req.user, t),
  })));
});

// Step 1 — read the file, stash it, and propose a mapping.
router.post('/analyze', upload.single('file'), (req, res) => {
  const target = TARGETS[req.body?.target];
  if (!target) return res.status(400).json({ error: 'Unknown import target.' });
  if (!canImport(req.user, target)) return res.status(403).json({ error: `Importing into ${target.label} requires an edit grant or admin.` });
  if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });

  let parsed;
  try { parsed = readTable(req.file.buffer, req.file.originalname); }
  catch (e) { return res.status(400).json({ error: `Could not read that file: ${e.message}` }); }
  if (!parsed.rows.length) return res.status(400).json({ error: 'No data rows found in that file.' });

  const db = getDb();
  const id = uuid();
  db.prepare(`INSERT INTO import_batches (id, target, filename, row_count, headers, rows_json, created_by)
              VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(id, req.body.target, req.file.originalname, parsed.rows.length,
      JSON.stringify(parsed.headers), JSON.stringify(parsed.rows), req.user?.name || null);

  res.json({
    batch_id: id,
    filename: req.file.originalname,
    headers: parsed.headers,
    row_count: parsed.rows.length,
    suggested_mapping: suggestMapping(target, parsed.headers),
    sample: parsed.rows.slice(0, 5),
  });
});

// Step 2 — dry run. Nothing is written; this is the "what will happen" screen.
// Thrown to unwind the preview's trial transaction. Its own object so a real
// database error is never mistaken for the deliberate rollback.
const ROLLBACK = Symbol('preview-rollback');

router.post('/:id/preview', (req, res) => {
  const db = getDb();
  const batch = db.prepare('SELECT * FROM import_batches WHERE id = ?').get(req.params.id);
  if (!batch) return res.status(404).json({ error: 'Import not found.' });
  const target = TARGETS[batch.target];
  if (!canImport(req.user, target)) return res.status(403).json({ error: 'Not allowed.' });

  const mapping = req.body?.mapping || {};
  const rows = JSON.parse(batch.rows_json);
  const existing = new Set(db.prepare(`SELECT external_id FROM ${target.table} WHERE external_id IS NOT NULL`).all().map(r => r.external_id));

  const cols = target.columns || target.fields.map(f => f.key);
  let create = 0, update = 0, skip = 0, filtered = 0;
  const accepted = [];
  const issues = [];
  const seenContent = new Set();   // identical rows entered twice
  const keyCounts = new Map();     // occurrences of each business key
  const preview = [];
  rows.forEach((src, i) => {
    if (filteredOut(target, src)) { filtered++; return; }
    const { row, errors } = buildRow(target, mapping, src);
    if (errors.length) {
      skip++;
      if (issues.length < 25) issues.push({ line: i + 2, errors });
      return;
    }
    // Only a row identical in every mapped field is a redundant re-entry. Rows
    // sharing a business key but differing anywhere (quantity, expiry, packing
    // slip) are separate receipts and must both land.
    const content = contentHash(target, row);
    if (seenContent.has(content)) {
      skip++;
      if (issues.length < 25) issues.push({ line: i + 2, errors: ['identical to an earlier row in this file'] });
      return;
    }
    seenContent.add(content);

    const bk = businessKey(target, row);
    const occ = keyCounts.get(bk) || 0;
    keyCounts.set(bk, occ + 1);
    const ext = identityFor(target, row, occ);
    if (ext && existing.has(ext)) update++; else create++;
    if (preview.length < 8) preview.push(row);
    accepted.push(shapeRow(target, row));
  });

  // A PREVIEW THAT THE COMMIT THEN REFUSES IS WORSE THAN NO PREVIEW.
  //
  // Everything above validates the FILE — required fields, duplicates,
  // identity. None of it validates the TABLE, so a column constraint the
  // mapping violates showed a clean "347 will be created" and then threw on
  // commit with nothing written and no explanation. (The real case: the
  // procurement board leaves 145 quantities blank and `qty` is NOT NULL.)
  //
  // So the preview now attempts the inserts for real and rolls them back. The
  // rollback is the whole point — nothing survives — but SQLite has checked
  // every constraint by then, which is the only way to know the commit will go
  // through. Cheap at these row counts (~350 here, ~2,100 on the receiving log)
  // because it is one transaction that is thrown away.
  let blocked = null;
  if (accepted.length) {
    try {
      db.transaction(() => {
        const defaults = (shaped) => (target.insertDefaults ? target.insertDefaults(shaped) : {});
        // Byte-for-byte the statement commit uses, or the trial proves nothing.
        const ins = db.prepare(`INSERT INTO ${target.table}
          (id, ${cols.join(', ')}, source, external_id, created_by)
          VALUES (?, ${cols.map(() => '?').join(', ')}, ?, ?, ?)`);
        for (const shaped of accepted) {
          const d = defaults(shaped);
          ins.run(uuid(), ...cols.map(c => (shaped[c] !== undefined ? shaped[c] : d[c]) ?? null), 'preview', null, null);
        }
        throw ROLLBACK;
      })();
    } catch (e) {
      if (e !== ROLLBACK) blocked = e.message;
    }
  }

  res.json({
    batch_id: batch.id, total: rows.length, create, update, skip, filtered, issues, preview,
    filtered_note: target.filteredNote || null,
    // Non-null means the commit WILL fail. Named here rather than discovered
    // after someone presses the button on two thousand rows.
    blocked,
  });
});

// Step 3 — write. Upsert on external_id inside one transaction so a failure
// can't leave the log half-imported.
router.post('/:id/commit', (req, res) => {
  const db = getDb();
  const batch = db.prepare('SELECT * FROM import_batches WHERE id = ?').get(req.params.id);
  if (!batch) return res.status(404).json({ error: 'Import not found.' });
  if (batch.committed_at) return res.status(409).json({ error: 'This import has already been committed.' });
  const target = TARGETS[batch.target];
  if (!canImport(req.user, target)) return res.status(403).json({ error: 'Not allowed.' });

  const mapping = req.body?.mapping || {};
  const rows = JSON.parse(batch.rows_json);
  const source = `import:${(batch.filename || 'file').slice(0, 40)}`;
  const cols = columnsOf(target);

  let created = 0, updated = 0, skipped = 0, filtered = 0;
  const seenContent = new Set();
  const keyCounts = new Map();

  const insert = db.prepare(`INSERT INTO ${target.table}
    (id, ${cols.join(', ')}, source, external_id, created_by)
    VALUES (?, ${cols.map(() => '?').join(', ')}, ?, ?, ?)`);
  const findByExt = db.prepare(`SELECT id FROM ${target.table} WHERE external_id = ?`);

  // An UPDATE only touches the columns THIS file actually carries. A column
  // the source has nothing to say about must keep its existing value rather
  // than being overwritten with a blank — importing a history export must not
  // erase an open balance the aging report established. Statements are cached
  // per column-set, since there are only a handful.
  const updateCache = new Map();
  const updateFor = (setCols) => {
    const key = setCols.join(',');
    if (!updateCache.has(key)) {
      updateCache.set(key, db.prepare(`UPDATE ${target.table}
        SET ${setCols.map(c => `${c} = ?`).join(', ')}, source = ?, updated_at = datetime('now') WHERE id = ?`));
    }
    return updateCache.get(key);
  };

  db.transaction(() => {
    for (const src of rows) {
      if (filteredOut(target, src)) { filtered++; continue; }
      const { row, errors } = buildRow(target, mapping, src);
      if (errors.length) { skipped++; continue; }
      // Mirrors the preview exactly, so what was approved is what gets written.
      const content = contentHash(target, row);
      if (seenContent.has(content)) { skipped++; continue; }
      seenContent.add(content);
      const bk = businessKey(target, row);
      const occ = keyCounts.get(bk) || 0;
      keyCounts.set(bk, occ + 1);
      const ext = identityFor(target, row, occ);
      const shaped = shapeRow(target, row);
      const hit = ext ? findByExt.get(ext) : null;
      if (hit) {
        const setCols = cols.filter(c => shaped[c] !== undefined);
        if (setCols.length) updateFor(setCols).run(...setCols.map(c => shaped[c] ?? null), source, hit.id);
        updated++;
      } else {
        // What the file couldn't say, filled in for a NEW row only.
        const defaults = target.insertDefaults ? target.insertDefaults(shaped) : {};
        const values = cols.map(c => (shaped[c] !== undefined ? shaped[c] : defaults[c]) ?? null);
        insert.run(uuid(), ...values, source, ext, req.user?.name || null);
        created++;
      }
    }
  })();

  const result = { created, updated, skipped, filtered, total: rows.length };
  db.prepare("UPDATE import_batches SET committed_at = datetime('now'), mapping = ?, result = ? WHERE id = ?")
    .run(JSON.stringify(mapping), JSON.stringify(result), batch.id);
  logAudit(req.user, 'import', 'import_batch', batch.id,
    { target: batch.target, filename: batch.filename, ...result }, null, null, `${target.label} · ${batch.filename}`);

  res.json(result);
});

// Import history — what was loaded, by whom, and what it did.
router.get('/history', (req, res) => {
  const db = getDb();
  const rows = db.prepare(`SELECT id, target, filename, row_count, created_by, created_at, committed_at, result
                           FROM import_batches ORDER BY created_at DESC LIMIT 50`).all();
  res.json(rows.map(r => ({ ...r, result: r.result ? JSON.parse(r.result) : null })));
});

export default router;
