// A live bank connection, so nobody has to download a statement.
//
// This is the "can we just link the account like QuickBooks does" answer.
// QuickBooks doesn't talk to banks itself — it uses an aggregator, and the
// standard one to build against is **Plaid**. Same shape as storage.js, ai.js
// and quickbooks.js: without credentials `bankFeedEnabled()` is false, the
// Link button is hidden, the sync endpoint answers 503, and **statement import
// keeps working**. The file path is not a fallback for a broken feed — it is
// how a bank Plaid doesn't cover, or an account nobody wants to connect, still
// reconciles.
//
// Env:
//   PLAID_CLIENT_ID, PLAID_SECRET   — from the Plaid dashboard
//   PLAID_ENV                       — 'production' | 'development' | 'sandbox'
//
// Access tokens are per-connected-institution and long-lived; they are stored
// on the bank account row. `/transactions/sync` is cursor-based, so each call
// asks only for what changed — that cursor is the reason a sync is cheap
// enough to run hourly and idempotent enough to run twice.

import { getDb } from './db.js';

const HOSTS = {
  sandbox: 'https://sandbox.plaid.com',
  development: 'https://development.plaid.com',
  production: 'https://production.plaid.com',
};

export function bankFeedEnabled() {
  return !!(process.env.PLAID_CLIENT_ID && process.env.PLAID_SECRET);
}

export function bankFeedStatus() {
  return {
    enabled: bankFeedEnabled(),
    provider: 'plaid',
    environment: process.env.PLAID_ENV || 'production',
  };
}

const host = () => HOSTS[process.env.PLAID_ENV] || HOSTS.production;

async function plaid(path, body) {
  if (!bankFeedEnabled()) throw new Error('No bank feed is configured on this server.');
  const res = await fetch(`${host()}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: process.env.PLAID_CLIENT_ID,
      secret: process.env.PLAID_SECRET,
      ...body,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    // Plaid's own message is far more useful than a status code — it names the
    // institution and whether the user has to re-authenticate.
    throw new Error(data.error_message || data.error_code || `Plaid error ${res.status}`);
  }
  return data;
}

/* ── Connecting ───────────────────────────────────────────────────────────── */

// Step 1: a short-lived token the browser hands to Plaid Link, which is what
// actually shows the bank's login. Credentials never touch this server, which
// is the reason to use an aggregator rather than asking for them.
export async function createLinkToken(userId) {
  const r = await plaid('/link/token/create', {
    user: { client_user_id: String(userId) },
    client_name: 'ReadyDoc',
    products: ['transactions'],
    country_codes: ['US'],
    language: 'en',
  });
  return r.link_token;
}

// Step 2: swap what Link gives back for a lasting access token, and read the
// accounts behind it.
export async function exchangePublicToken(publicToken) {
  const ex = await plaid('/item/public_token/exchange', { public_token: publicToken });
  const accounts = await plaid('/accounts/get', { access_token: ex.access_token });
  return {
    access_token: ex.access_token,
    item_id: ex.item_id,
    institution: accounts.item?.institution_id || null,
    accounts: (accounts.accounts || []).map(a => ({
      provider_account_id: a.account_id,
      name: a.name || a.official_name || 'Account',
      mask: a.mask || null,
      account_type: [a.type, a.subtype].filter(Boolean).join('/') || null,
      current_balance: a.balances?.current ?? null,
      currency: a.balances?.iso_currency_code || 'USD',
    })),
  };
}

/* ── Syncing ──────────────────────────────────────────────────────────────── */

// Plaid signs the opposite way to a bank statement: a Plaid `amount` is
// POSITIVE for money leaving the account. Every other part of this system reads
// a statement, where money out is negative — so it is flipped exactly here,
// once, at the boundary. Getting this wrong would invert every reconciliation.
const fromPlaid = (t) => ({
  external_id: t.transaction_id,
  posted_date: (t.authorized_date || t.date || '').slice(0, 10),
  amount: -Number(t.amount || 0),
  description: t.name || null,
  counterparty: t.merchant_name || null,
  reference: t.check_number || null,
  pending: t.pending ? 1 : 0,
  category: Array.isArray(t.category) ? t.category[0] : null,
  provider_account_id: t.account_id,
});

/**
 * Pull everything new since the stored cursor.
 *
 * Cursor-based and therefore safe to run again: Plaid replays from wherever it
 * was left, and `removed` carries entries the bank later retracted — a pending
 * charge that never settled has to disappear here too, or the account will
 * never reconcile.
 */
export async function syncItem(accessToken, cursor) {
  let next = cursor || null;
  const added = [], modified = [], removed = [];
  let more = true;
  // Bounded: a first sync of a busy account pages, but a runaway loop against
  // a paid API is not something to leave open-ended.
  for (let page = 0; more && page < 40; page++) {
    const r = await plaid('/transactions/sync', {
      access_token: accessToken,
      cursor: next || undefined,
      count: 500,
    });
    added.push(...(r.added || []).map(fromPlaid));
    modified.push(...(r.modified || []).map(fromPlaid));
    removed.push(...(r.removed || []).map(t => t.transaction_id));
    next = r.next_cursor;
    more = !!r.has_more;
  }
  return { added, modified, removed, cursor: next };
}

export async function fetchBalances(accessToken) {
  const r = await plaid('/accounts/balance/get', { access_token: accessToken });
  return (r.accounts || []).map(a => ({
    provider_account_id: a.account_id,
    current_balance: a.balances?.current ?? null,
  }));
}

/* ── Token storage ────────────────────────────────────────────────────────── */

// Access tokens live in app_settings keyed by item id rather than on the
// account row, so several accounts at one institution share the one token and
// disconnecting revokes it once.
const KEY = (itemId) => `plaid_item_${itemId}`;

export function saveItemToken(itemId, accessToken, cursor = null) {
  getDb().prepare(`INSERT INTO app_settings (key, value, updated_at)
    VALUES (?, ?, datetime('now'))
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`)
    .run(KEY(itemId), JSON.stringify({ access_token: accessToken, cursor }));
}

export function readItemToken(itemId) {
  const row = getDb().prepare('SELECT value FROM app_settings WHERE key = ?').get(KEY(itemId));
  if (!row) return null;
  try { return JSON.parse(row.value); } catch { return null; }
}

export function saveCursor(itemId, cursor) {
  const cur = readItemToken(itemId);
  if (cur) saveItemToken(itemId, cur.access_token, cursor);
}

export async function removeItem(itemId) {
  const cur = readItemToken(itemId);
  if (cur?.access_token) {
    // Best effort — a token we can't revoke remotely must still stop being
    // used locally, so a failure here is not allowed to block the disconnect.
    try { await plaid('/item/remove', { access_token: cur.access_token }); } catch { /* revoke anyway */ }
  }
  getDb().prepare('DELETE FROM app_settings WHERE key = ?').run(KEY(itemId));
}
