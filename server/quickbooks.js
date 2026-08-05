// QuickBooks Online — pulls Bills (AP) and Invoices (AR) into the local
// ledgers so Jake works in one place.
//
// Degrades gracefully, exactly like storage.js and ai.js: without credentials
// quickbooksEnabled() is false, the UI hides the Sync button, and the sync
// endpoint answers 503 instead of erroring.
//
// Env:
//   QBO_CLIENT_ID, QBO_CLIENT_SECRET   — from the Intuit developer app
//   QBO_REFRESH_TOKEN                  — long-lived token from the OAuth grant
//   QBO_REALM_ID                       — the company (realm) id
//   QBO_ENV                            — 'production' (default) or 'sandbox'
//   QBO_API_BASE, QBO_TOKEN_URL        — override the endpoints. Only for
//                                        pointing the test suite at a local
//                                        stand-in; leave unset in production.
//
// Intuit refresh tokens roll: every refresh may return a NEW refresh token and
// the old one stops working after a short overlap. We persist the current one
// in app_settings so a restart doesn't lose the connection, and fall back to
// the env var when nothing is stored yet.
import { getDb } from './db.js';

const TOKEN_URL = () => process.env.QBO_TOKEN_URL
  || 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer';
const API_BASE = () => process.env.QBO_API_BASE || (process.env.QBO_ENV === 'sandbox'
  ? 'https://sandbox-quickbooks.api.intuit.com'
  : 'https://quickbooks.api.intuit.com');

const SETTING_KEY = 'qbo_refresh_token';

export function quickbooksEnabled() {
  return !!(process.env.QBO_CLIENT_ID && process.env.QBO_CLIENT_SECRET
    && process.env.QBO_REALM_ID && (process.env.QBO_REFRESH_TOKEN || storedRefreshToken()));
}

export function quickbooksStatus() {
  const setting = (key) => {
    const db = safeDb();
    if (!db) return null;
    try { return db.prepare('SELECT value FROM app_settings WHERE key = ?').get(key)?.value || null; } catch { return null; }
  };
  // Which of the four values are present — NEVER their contents. "Connect
  // QuickBooks" is a four-part setup done in a browser tab far from this
  // screen, and "it says not connected" with no indication of which part is
  // missing is how someone re-does all four looking for the one that's wrong.
  const present = {
    QBO_CLIENT_ID: !!process.env.QBO_CLIENT_ID,
    QBO_CLIENT_SECRET: !!process.env.QBO_CLIENT_SECRET,
    QBO_REALM_ID: !!process.env.QBO_REALM_ID,
    QBO_REFRESH_TOKEN: !!(process.env.QBO_REFRESH_TOKEN || storedRefreshToken()),
  };
  return {
    enabled: quickbooksEnabled(),
    environment: process.env.QBO_ENV === 'sandbox' ? 'sandbox' : 'production',
    present,
    missing: Object.keys(present).filter(k => !present[k]),
    last_sync: setting('qbo_last_sync'),
    // A full pull is the migration. Whether it has ever run is the difference
    // between "we have a copy of the books" and "we have the last 12 months".
    full_pull_at: setting('qbo_full_pull_at'),
    // Whose books we last actually reached. Development keys can only ever
    // reach Intuit's sandbox, so this being someone else's company name is the
    // difference between a working connection and a useful one.
    company: setting('qbo_company_name'),
  };
}

function safeDb() {
  try { return getDb(); } catch { return null; }
}

function storedRefreshToken() {
  const db = safeDb();
  if (!db) return null;
  try { return db.prepare('SELECT value FROM app_settings WHERE key = ?').get(SETTING_KEY)?.value || null; } catch { return null; }
}

function setSetting(key, value) {
  const db = safeDb();
  if (!db) return;
  try {
    db.prepare(`INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`).run(key, value);
  } catch { /* settings table optional */ }
}

// Access tokens last an hour; keep the live one in memory and refresh on
// demand. The cache is keyed on the credentials it was minted under, so
// changing any of them invalidates it — otherwise a corrected value appears to
// have no effect for up to an hour, which reads as "I fixed it and nothing
// changed" and sends someone off to correct something that was already right.
let accessToken = null;
let accessTokenExpiry = 0;
let accessTokenKey = null;

async function getAccessToken() {
  const refresh = storedRefreshToken() || process.env.QBO_REFRESH_TOKEN;
  const key = `${process.env.QBO_CLIENT_ID}|${process.env.QBO_REALM_ID}|${refresh}`;
  if (accessToken && accessTokenKey === key && Date.now() < accessTokenExpiry - 60_000) return accessToken;
  accessToken = null;

  if (!refresh) throw new Error('No QuickBooks refresh token available.');
  const basic = Buffer.from(`${process.env.QBO_CLIENT_ID}:${process.env.QBO_CLIENT_SECRET}`).toString('base64');

  const res = await fetch(TOKEN_URL(), {
    method: 'POST',
    headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refresh }).toString(),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`QuickBooks token refresh failed (${res.status}). ${body.slice(0, 200)}`);
  }
  const data = await res.json();
  accessToken = data.access_token;
  accessTokenExpiry = Date.now() + (Number(data.expires_in || 3600) * 1000);
  accessTokenKey = key;
  // Intuit rotates refresh tokens — persist the new one or the connection dies
  // the next time this process restarts.
  if (data.refresh_token && data.refresh_token !== refresh) setSetting(SETTING_KEY, data.refresh_token);
  return accessToken;
}

async function query(sql) {
  const token = await getAccessToken();
  const url = `${API_BASE()}/v3/company/${process.env.QBO_REALM_ID}/query?query=${encodeURIComponent(sql)}&minorversion=70`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`QuickBooks query failed (${res.status}). ${body.slice(0, 200)}`);
  }
  const data = await res.json();
  return data.QueryResponse || {};
}

// QuickBooks caps a query at 1,000 rows and pages with STARTPOSITION, which is
// ONE-based. A single MAXRESULTS query silently returns the first page and
// reports success — on a company with more than a page of bills that reads as
// a clean sync that quietly lost half the books, which is the worst possible
// failure for a migration. So every read goes through here.
const PAGE = 1000;

async function queryAll(entity, where = '') {
  const out = [];
  for (let start = 1; ; start += PAGE) {
    const sql = `SELECT * FROM ${entity}${where ? ` WHERE ${where}` : ''} STARTPOSITION ${start} MAXRESULTS ${PAGE}`;
    const page = (await query(sql))[entity] || [];
    out.push(...page);
    // A short page is the last page. Guard the pathological case where a
    // server keeps returning full pages rather than looping forever.
    if (page.length < PAGE || out.length > 100000) break;
  }
  return out;
}

// COUNT is its own query shape in QBO and comes back as totalCount, so an
// inventory doesn't have to download the rows it's counting.
async function countOf(entity) {
  const r = await query(`SELECT COUNT(*) FROM ${entity}`);
  return Number(r.totalCount ?? 0);
}

const day = (v) => (v ? String(v).slice(0, 10) : null);

/* ── Test the connection, and say what is wrong when it isn't ─────────────── */
//
// Four values set in a Railway tab, from three different screens on Intuit's
// site, one of which is only reachable through an OAuth round trip. When that
// doesn't work, the raw Intuit error ("AuthenticationFailed") tells you nothing
// about which of the four is wrong. This maps the failures onto the actual
// cause, so a misconfiguration is a sentence rather than an afternoon.

// Development keys reach ONLY the sandbox; production keys reach ONLY the real
// company. Mixing them is by far the most common setup failure, and it is the
// one that looks like a broken app rather than a wrong value.
function diagnose(message) {
  const m = String(message || '');
  const env = process.env.QBO_ENV === 'sandbox' ? 'sandbox' : 'production';
  if (/invalid_grant/i.test(m)) {
    return 'The refresh token was rejected. It expires after 100 days unused, and is also invalidated if '
      + 'something else refreshed it. Redo step 4 of the setup (OAuth Playground → Get tokens) and paste '
      + 'the new one into QBO_REFRESH_TOKEN.';
  }
  // ORDER MATTERS: "ApplicationAuthenticationFailed" (wrong company) contains
  // "AuthenticationFailed" (wrong keys), so the longer, more specific name has
  // to be tested first or every wrong-realm setup is reported as wrong keys —
  // and the person goes and regenerates two values that were already correct.
  if (/ApplicationAuthenticationFailed|AuthorizationFailed|\(403\)/i.test(m)) {
    return `The credentials are valid but not for company ${process.env.QBO_REALM_ID}. With development `
      + 'keys the realm id must be the SANDBOX company shown in the OAuth Playground — not the Company ID '
      + 'from your real QuickBooks settings.';
  }
  if (/invalid_client|AuthenticationFailed|\(401\)/i.test(m)) {
    return `The client id and secret were rejected for the ${env} environment. Development keys only work `
      + `with QBO_ENV=sandbox; production keys only work without it. Check that the keys and QBO_ENV agree.`;
  }
  if (/404/.test(m)) {
    return `No company ${process.env.QBO_REALM_ID} on the ${env} API. That realm id belongs to the other `
      + 'environment, or has a stray space in it.';
  }
  return m;
}

/**
 * One cheap call that proves the whole chain — token refresh, realm, API base —
 * and comes back with the company NAME. That last part matters more than it
 * sounds: it is the only thing on screen that distinguishes "connected" from
 * "connected to the right books".
 */
export async function testQuickBooks() {
  if (!quickbooksEnabled()) {
    const missing = quickbooksStatus().missing;
    return { ok: false, error: `Not configured yet — still missing ${missing.join(', ')}.`, missing };
  }
  try {
    const r = await query('SELECT * FROM CompanyInfo');
    const info = r.CompanyInfo?.[0] || {};
    const name = info.CompanyName || info.LegalName || null;
    if (name) setSetting('qbo_company_name', name);
    return {
      ok: true,
      company: name,
      legal_name: info.LegalName || null,
      country: info.Country || null,
      realm_id: process.env.QBO_REALM_ID,
      environment: process.env.QBO_ENV === 'sandbox' ? 'sandbox' : 'production',
    };
  } catch (e) {
    return { ok: false, error: diagnose(e.message), raw: String(e.message).slice(0, 300) };
  }
}

/* ── Discovery: what is actually in these books ───────────────────────────── */
//
// The first question asked about replacing QuickBooks was "what do we actually
// use?" — and the honest answer is not a list anyone can write from memory.
// This counts every entity type the API exposes and dates the transactional
// ones, so the replacement gets sized against the books rather than a guess.
// An entity with a count of zero is a whole feature the replacement does not
// have to carry, which is the most valuable line in the report.

const ENTITIES = [
  // Lists — the structure of the books.
  { name: 'Account', label: 'Chart of accounts', group: 'lists' },
  { name: 'Vendor', label: 'Vendors', group: 'lists' },
  { name: 'Customer', label: 'Customers', group: 'lists' },
  { name: 'Item', label: 'Products & services', group: 'lists' },
  { name: 'Employee', label: 'Employees', group: 'lists' },
  { name: 'Term', label: 'Payment terms', group: 'lists' },
  { name: 'TaxCode', label: 'Tax codes', group: 'lists' },
  // Money out.
  { name: 'Bill', label: 'Bills (AP)', group: 'payable', dated: true },
  { name: 'BillPayment', label: 'Bill payments', group: 'payable', dated: true },
  { name: 'VendorCredit', label: 'Vendor credits', group: 'payable', dated: true },
  { name: 'Purchase', label: 'Expenses / card charges', group: 'payable', dated: true },
  { name: 'PurchaseOrder', label: 'Purchase orders', group: 'payable', dated: true },
  // Money in.
  { name: 'Invoice', label: 'Invoices (AR)', group: 'receivable', dated: true },
  { name: 'Payment', label: 'Customer payments', group: 'receivable', dated: true },
  { name: 'SalesReceipt', label: 'Sales receipts', group: 'receivable', dated: true },
  { name: 'CreditMemo', label: 'Credit memos', group: 'receivable', dated: true },
  { name: 'Estimate', label: 'Estimates', group: 'receivable', dated: true },
  { name: 'RefundReceipt', label: 'Refunds', group: 'receivable', dated: true },
  // The general-ledger end — this is the part that decides whether stage 3 is
  // a real project or a formality.
  { name: 'JournalEntry', label: 'Journal entries', group: 'ledger', dated: true },
  { name: 'Deposit', label: 'Deposits', group: 'ledger', dated: true },
  { name: 'Transfer', label: 'Transfers', group: 'ledger', dated: true },
  { name: 'TimeActivity', label: 'Time activities', group: 'ledger', dated: true },
];

// Oldest and newest by transaction date. QBO has no MIN/MAX, but it does have
// ORDERBY, so two one-row queries answer it without downloading the entity.
async function dateRange(entity) {
  const edge = async (dir) => {
    const r = await query(`SELECT * FROM ${entity} ORDERBY TxnDate ${dir} MAXRESULTS 1`);
    return day(r[entity]?.[0]?.TxnDate);
  };
  return { first: await edge('ASC'), last: await edge('DESC') };
}

export async function discoverQuickBooks(db) {
  if (!quickbooksEnabled()) throw new Error('QuickBooks is not configured.');
  const entities = [];
  for (const e of ENTITIES) {
    // One entity being unavailable (a permission, a feature that company never
    // turned on) must not lose the other twenty-one. Report it and carry on.
    try {
      const count = await countOf(e.name);
      const range = (count > 0 && e.dated) ? await dateRange(e.name) : { first: null, last: null };
      entities.push({ ...e, count, ...range });
    } catch (err) {
      entities.push({ ...e, count: null, error: err.message.slice(0, 160) });
    }
  }
  const report = {
    checked_at: new Date().toISOString(),
    realm_id: process.env.QBO_REALM_ID || null,
    environment: process.env.QBO_ENV === 'sandbox' ? 'sandbox' : 'production',
    entities,
    // The headline: what is in use, and what the replacement can ignore.
    in_use: entities.filter(e => e.count > 0).map(e => e.name),
    unused: entities.filter(e => e.count === 0).map(e => e.name),
    unreadable: entities.filter(e => e.count === null).map(e => e.name),
  };
  if (db) setSetting('qbo_inventory', JSON.stringify(report));
  return report;
}

export function lastInventory() {
  const raw = (() => {
    const db = safeDb();
    if (!db) return null;
    try { return db.prepare("SELECT value FROM app_settings WHERE key = 'qbo_inventory'").get()?.value || null; } catch { return null; }
  })();
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

// Map a QBO Bill onto our AP row. Anything QBO doesn't carry (payment method,
// our own notes) is left alone on update so local edits survive a re-sync.
function apFromBill(b) {
  const balance = Number(b.Balance ?? 0);
  const total = Number(b.TotalAmt ?? 0);
  return {
    qb_id: String(b.Id),
    vendor: b.VendorRef?.name || 'Unknown vendor',
    invoice_number: b.DocNumber || null,
    invoice_date: day(b.TxnDate),
    due_date: day(b.DueDate),
    terms: b.SalesTermRef?.name || null,
    amount: total,
    amount_paid: Math.max(0, total - balance),
    status: balance <= 0 ? 'paid' : 'approved',
  };
}

function arFromInvoice(inv) {
  const balance = Number(inv.Balance ?? 0);
  const total = Number(inv.TotalAmt ?? 0);
  return {
    qb_id: String(inv.Id),
    customer: inv.CustomerRef?.name || 'Unknown customer',
    invoice_number: inv.DocNumber || null,
    invoice_date: day(inv.TxnDate),
    due_date: day(inv.DueDate),
    terms: inv.SalesTermRef?.name || null,
    amount: total,
    amount_received: Math.max(0, total - balance),
    status: balance <= 0 ? 'paid' : (balance < total ? 'partial' : 'sent'),
  };
}

// Upsert on qb_id: QuickBooks owns the money fields, we own everything else.
function upsert(db, table, row, paidField) {
  const existing = db.prepare(`SELECT id FROM ${table} WHERE qb_id = ?`).get(row.qb_id);
  const party = table === 'ap_invoices' ? 'vendor' : 'customer';
  if (existing) {
    db.prepare(`UPDATE ${table} SET ${party} = ?, invoice_number = ?, invoice_date = ?, due_date = ?,
      terms = ?, amount = ?, ${paidField} = ?, status = ?, qb_synced_at = datetime('now'), updated_at = datetime('now')
      WHERE id = ?`)
      .run(row[party], row.invoice_number, row.invoice_date, row.due_date, row.terms,
        row.amount, row[paidField], row.status, existing.id);
    return 'updated';
  }
  db.prepare(`INSERT INTO ${table} (id, ${party}, invoice_number, invoice_date, due_date, terms,
    amount, ${paidField}, status, qb_id, qb_synced_at, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), 'QuickBooks')`)
    .run(cryptoId(), row[party], row.invoice_number, row.invoice_date, row.due_date, row.terms,
      row.amount, row[paidField], row.status, row.qb_id);
  return 'created';
}

function cryptoId() {
  return globalThis.crypto?.randomUUID?.() || `qb-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

/* ── The lists: chart of accounts, vendors, customers ─────────────────────── */
//
// Copied out of QuickBooks, never authored here. While QBO is still the system
// of record, an account that can be edited in two places is worse than one you
// have to go and read — so these tables are overwritten by each pull and carry
// no local fields to lose.

function upsertAccounts(db, rows) {
  const tally = { created: 0, updated: 0 };
  const tx = db.transaction(() => {
    for (const a of rows) {
      const qbId = String(a.Id);
      const vals = [
        a.AcctNum || null, a.Name || '(unnamed)', a.FullyQualifiedName || a.Name || null,
        a.AccountType || null, a.AccountSubType || null, a.Classification || null,
        a.ParentRef?.value ? String(a.ParentRef.value) : null,
        a.Active === false ? 0 : 1,
        a.CurrentBalance === undefined ? null : Number(a.CurrentBalance),
      ];
      const existing = db.prepare('SELECT id FROM qbo_accounts WHERE qb_id = ?').get(qbId);
      if (existing) {
        db.prepare(`UPDATE qbo_accounts SET acct_number = ?, name = ?, fully_qualified = ?,
          account_type = ?, account_sub_type = ?, classification = ?, parent_qb_id = ?,
          active = ?, current_balance = ?, synced_at = datetime('now') WHERE id = ?`)
          .run(...vals, existing.id);
        tally.updated++;
      } else {
        db.prepare(`INSERT INTO qbo_accounts (id, qb_id, acct_number, name, fully_qualified,
          account_type, account_sub_type, classification, parent_qb_id, active, current_balance)
          VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(cryptoId(), qbId, ...vals);
        tally.created++;
      }
    }
  });
  tx();
  return tally;
}

function upsertContacts(db, kind, rows) {
  const tally = { created: 0, updated: 0 };
  const tx = db.transaction(() => {
    for (const c of rows) {
      const qbId = String(c.Id);
      const vals = [
        c.DisplayName || c.CompanyName || '(unnamed)', c.CompanyName || null,
        c.PrimaryEmailAddr?.Address || null, c.PrimaryPhone?.FreeFormNumber || null,
        c.Active === false ? 0 : 1,
        c.Balance === undefined ? null : Number(c.Balance),
      ];
      const existing = db.prepare('SELECT id FROM qbo_contacts WHERE kind = ? AND qb_id = ?').get(kind, qbId);
      if (existing) {
        db.prepare(`UPDATE qbo_contacts SET name = ?, company = ?, email = ?, phone = ?,
          active = ?, balance = ?, synced_at = datetime('now') WHERE id = ?`).run(...vals, existing.id);
        tally.updated++;
      } else {
        db.prepare(`INSERT INTO qbo_contacts (id, kind, qb_id, name, company, email, phone, active, balance)
          VALUES (?,?,?,?,?,?,?,?,?)`).run(cryptoId(), kind, qbId, ...vals);
        tally.created++;
      }
    }
  });
  tx();
  return tally;
}

/**
 * Pull from QuickBooks and upsert.
 *
 * Two modes, and the difference matters. The **incremental** sync takes what
 * changed since last time (12 months on a cold start) and is what the Sync
 * button runs day to day. The **full** pull takes everything, ever, plus the
 * lists — that is a migration, run once, and a 12-month default would quietly
 * leave the older history behind in a system they are trying to leave.
 */
export async function syncFromQuickBooks(db, { full = false } = {}) {
  if (!quickbooksEnabled()) throw new Error('QuickBooks is not configured.');
  const since = (() => {
    try { return db.prepare("SELECT value FROM app_settings WHERE key = 'qbo_last_sync'").get()?.value || null; } catch { return null; }
  })();
  const cutoff = since ? since.slice(0, 10) : new Date(Date.now() - 365 * 86400000).toISOString().slice(0, 10);
  const where = full ? '' : `MetaData.LastUpdatedTime > '${cutoff}T00:00:00'`;

  const tally = {
    mode: full ? 'full' : 'incremental',
    since: full ? null : cutoff,
    bills: { created: 0, updated: 0 },
    invoices: { created: 0, updated: 0 },
  };

  // The lists come first on a full pull: a bill names a vendor, and having the
  // vendor already on file is what makes the pulled ledger readable.
  if (full) {
    tally.accounts = upsertAccounts(db, await queryAll('Account'));
    tally.vendors = upsertContacts(db, 'vendor', await queryAll('Vendor'));
    tally.customers = upsertContacts(db, 'customer', await queryAll('Customer'));
  }

  const bills = await queryAll('Bill', where);
  const apTx = db.transaction(() => {
    for (const b of bills) tally.bills[upsert(db, 'ap_invoices', apFromBill(b), 'amount_paid')]++;
  });
  apTx();

  const invoices = await queryAll('Invoice', where);
  const arTx = db.transaction(() => {
    for (const i of invoices) tally.invoices[upsert(db, 'ar_invoices', arFromInvoice(i), 'amount_received')]++;
  });
  arTx();

  setSetting('qbo_last_sync', new Date().toISOString());
  if (full) setSetting('qbo_full_pull_at', new Date().toISOString());
  return tally;
}
