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
//
// Intuit refresh tokens roll: every refresh may return a NEW refresh token and
// the old one stops working after a short overlap. We persist the current one
// in app_settings so a restart doesn't lose the connection, and fall back to
// the env var when nothing is stored yet.
import { getDb } from './db.js';

const TOKEN_URL = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer';
const API_BASE = () => (process.env.QBO_ENV === 'sandbox'
  ? 'https://sandbox-quickbooks.api.intuit.com'
  : 'https://quickbooks.api.intuit.com');

const SETTING_KEY = 'qbo_refresh_token';

export function quickbooksEnabled() {
  return !!(process.env.QBO_CLIENT_ID && process.env.QBO_CLIENT_SECRET
    && process.env.QBO_REALM_ID && (process.env.QBO_REFRESH_TOKEN || storedRefreshToken()));
}

export function quickbooksStatus() {
  const db = safeDb();
  let lastSync = null;
  if (db) {
    try { lastSync = db.prepare("SELECT value FROM app_settings WHERE key = 'qbo_last_sync'").get()?.value || null; } catch { /* optional */ }
  }
  return {
    enabled: quickbooksEnabled(),
    environment: process.env.QBO_ENV === 'sandbox' ? 'sandbox' : 'production',
    last_sync: lastSync,
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

// Access tokens last an hour; keep the live one in memory and refresh on demand.
let accessToken = null;
let accessTokenExpiry = 0;

async function getAccessToken() {
  if (accessToken && Date.now() < accessTokenExpiry - 60_000) return accessToken;

  const refresh = storedRefreshToken() || process.env.QBO_REFRESH_TOKEN;
  if (!refresh) throw new Error('No QuickBooks refresh token available.');
  const basic = Buffer.from(`${process.env.QBO_CLIENT_ID}:${process.env.QBO_CLIENT_SECRET}`).toString('base64');

  const res = await fetch(TOKEN_URL, {
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

const day = (v) => (v ? String(v).slice(0, 10) : null);

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

// Pull everything changed since the last sync (or the last 12 months on a cold
// start) and upsert it. Returns a per-ledger tally for the UI.
export async function syncFromQuickBooks(db) {
  if (!quickbooksEnabled()) throw new Error('QuickBooks is not configured.');
  const since = (() => {
    try { return db.prepare("SELECT value FROM app_settings WHERE key = 'qbo_last_sync'").get()?.value || null; } catch { return null; }
  })();
  const cutoff = since ? since.slice(0, 10) : new Date(Date.now() - 365 * 86400000).toISOString().slice(0, 10);

  const tally = { bills: { created: 0, updated: 0 }, invoices: { created: 0, updated: 0 } };

  const bills = (await query(`SELECT * FROM Bill WHERE MetaData.LastUpdatedTime > '${cutoff}T00:00:00' MAXRESULTS 500`)).Bill || [];
  const apTx = db.transaction(() => {
    for (const b of bills) tally.bills[upsert(db, 'ap_invoices', apFromBill(b), 'amount_paid')]++;
  });
  apTx();

  const invoices = (await query(`SELECT * FROM Invoice WHERE MetaData.LastUpdatedTime > '${cutoff}T00:00:00' MAXRESULTS 500`)).Invoice || [];
  const arTx = db.transaction(() => {
    for (const i of invoices) tally.invoices[upsert(db, 'ar_invoices', arFromInvoice(i), 'amount_received')]++;
  });
  arTx();

  setSetting('qbo_last_sync', new Date().toISOString());
  return tally;
}
