// #ops-requests webhook wake (D-251).
//
// A person posting in #ops-requests or #ops-requests-test wakes the right Grok
// Bot routine within seconds instead of waiting for its hourly check. The POST
// is ONLY a wake-up: the bots still read the channel with their own cursor, so a
// lost or doubled wake cannot lose or double-handle a request.
//
// Two targets, each on only when OPS_WEBHOOK_ENABLED is on AND its own URL and
// key are set:
//   procurement — every new top-level message and thread reply written by a PERSON
//   controller  — only a thread reply from `*Procurement Bot` starting `→ Controller`
//
// RULES, each load-bearing:
//   - The channel list is a CONSTANT. No env var widens it (OPS_WEBHOOK_CHANNELS is
//     deliberately not read). Matched on the channel's current name at post time,
//     so a rename or archive takes effect with nothing cached; never a DM.
//   - Never delays or changes the post: `enqueueOpsWebhook` is called after the
//     response is sent, does one small insert, and sends on a later tick.
//   - An outbox (`ops_webhook_log`) makes delivery durable: a row is sent once at
//     most after a success (unique dedupe_id), a restart resumes `pending` and
//     `sending` rows, and a `sent` row is never sent again.
//   - No URL, key or routine id is ever logged, stored or returned. Logs name the
//     host and the last 6 characters of the routine id.
import crypto from 'crypto';
import { readyDocOrigin } from './links.js';
import { isTestRunnerPost } from './test-runner.js';

export const OPS_CHANNELS = Object.freeze(['ops-requests', 'ops-requests-test']);
export const PROCUREMENT_BOT_NAME = '*Procurement Bot';
export const HANDOFF_PREFIX = '→ Controller';
export const TEXT_CAP = 4000;
export const TIMEOUT_MS = 8000;
// The first send goes at once; a failure is retried after each of these.
export const BACKOFF_MS = [2000, 10000, 30000, 120000, 600000];
export const MAX_IN_FLIGHT = 3;
export const RATE_PER_MINUTE = 60;
const TARGETS = ['procurement', 'controller'];

const on = (v) => /^(1|true|yes|on)$/i.test(String(v || '').trim());

/** Which targets are configured. Reads the environment every time (cheap; lets a test change it). */
export function targetConfig(env = process.env) {
  const enabled = on(env.OPS_WEBHOOK_ENABLED);
  const pair = (url, key) => ({ configured: !!(url && key), enabled: enabled && !!(url && key), url: url || null, key: key || null });
  return {
    flag: enabled,
    procurement: pair(env.OPS_WEBHOOK_URL, env.OPS_WEBHOOK_KEY),
    controller: pair(env.OPS_WEBHOOK_CONTROLLER_URL, env.OPS_WEBHOOK_CONTROLLER_KEY),
    signingSecret: env.OPS_WEBHOOK_SIGNING_SECRET || null,
  };
}

/** A URL as it may appear in a log: host and the last 6 characters of the path. */
export function redactUrl(url) {
  try {
    const u = new URL(url);
    const last = u.pathname.replace(/\/+$/, '').split('/').pop() || '';
    return `${u.host}/…${last.slice(-6)}`;
  } catch { return '(unreadable url)'; }
}

/** Remove any configured URL or key from a piece of text before it is stored or logged. */
export function scrub(text, env = process.env) {
  let s = String(text ?? '');
  for (const v of [env.OPS_WEBHOOK_URL, env.OPS_WEBHOOK_KEY, env.OPS_WEBHOOK_CONTROLLER_URL, env.OPS_WEBHOOK_CONTROLLER_KEY, env.OPS_WEBHOOK_SIGNING_SECRET]) {
    if (v && v.length >= 4) s = s.split(v).join('[redacted]');
  }
  return s.replace(/crsr_[A-Za-z0-9_-]+/g, '[redacted]').slice(0, 500);
}

export function ensureOpsWebhookSchema(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS ops_webhook_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    dedupe_id TEXT NOT NULL UNIQUE,
    target TEXT NOT NULL,
    channel_name TEXT,
    message_id TEXT,
    payload TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    attempts INTEGER NOT NULL DEFAULT 0,
    last_http_status INTEGER,
    last_error TEXT,
    next_attempt_at INTEGER,
    first_attempt_at TEXT,
    last_attempt_at TEXT,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_ops_webhook_status ON ops_webhook_log(status, next_attempt_at);
  CREATE INDEX IF NOT EXISTS idx_ops_webhook_created ON ops_webhook_log(created_at);`);
}

/**
 * A bot account. No single column says so, so any of: posted through an API
 * token, holds a live token, the `*` name convention bot accounts use, or the
 * house ReadyBot.
 */
export function isBotAuthor(db, user, viaToken) {
  if (viaToken) return true;
  if (!user) return true;
  const name = String(user.name || '');
  if (name.startsWith('*') || name === 'ReadyBot') return true;
  try {
    return !!db.prepare(`SELECT 1 FROM api_tokens WHERE user_id = ? AND revoked_at IS NULL
      AND (expires_at IS NULL OR expires_at > datetime('now')) LIMIT 1`).get(user.id);
  } catch { return false; }
}

const isoUtc = (t) => {
  const s = String(t || '');
  if (/Z$|[+-]\d\d:?\d\d$/.test(s)) return new Date(s).toISOString();
  const d = new Date(s.replace(' ', 'T') + 'Z');
  return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
};

/** Which target, if any, a just-created message fires. Pure apart from the bot lookups. */
export function targetFor(db, { channel, message, author, viaToken, attachmentCount = 0 }) {
  if (!channel || channel.kind === 'dm' || channel.archived) return null;
  if (!OPS_CHANNELS.includes(String(channel.name || ''))) return null;
  const body = String(message?.body || '');
  if (!body.trim() && !attachmentCount) return null;
  // The Test Runner's questions in #ops-requests-test count as a person's (D-252).
  if (isTestRunnerPost(db, channel, author)) return 'procurement';
  const bot = isBotAuthor(db, author, viaToken);
  if (!bot) return 'procurement';
  if (message.parent_id && body.trimStart().startsWith(HANDOFF_PREFIX)
      && String(author?.name || '') === PROCUREMENT_BOT_NAME) return 'controller';
  return null;
}

export function buildPayload({ target, channel, message, author, attachmentCount = 0, origin = readyDocOrigin() }) {
  const text = String(message.body || '');
  const truncated = text.length > TEXT_CAP;
  return {
    event: 'ops_request.message',
    version: 1,
    target,
    dedupe_id: `${channel.id}:${message.id}:${target}`,
    channel: { id: channel.id, name: channel.name },
    message_id: message.id,
    thread_id: message.parent_id || message.id,
    is_top_level: !message.parent_id,
    author: { id: author.id, name: author.name },
    text: truncated ? text.slice(0, TEXT_CAP) : text,
    text_truncated: truncated,
    attachment_count: attachmentCount,
    timestamp: isoUtc(message.created_at),
    link: `${String(origin).replace(/\/+$/, '')}/?c=${channel.id}&m=${message.id}`,
  };
}

// ── the sender ──────────────────────────────────────────────────────────────
let state = { db: null, fetch: null, now: () => Date.now(), log: console, inFlight: 0, timer: null, env: process.env, random: Math.random };

/** Wire the sender. Called once at boot; a test passes its own fetch, clock and env. */
export function initOpsWebhook(db, opts = {}) {
  ensureOpsWebhookSchema(db);
  state = { ...state, db, fetch: opts.fetch || globalThis.fetch, now: opts.now || (() => Date.now()),
    log: opts.log || console, env: opts.env || process.env, random: opts.random || Math.random, inFlight: 0 };
  // A row caught mid-send by a restart is sent again once — never a `sent` one.
  db.prepare("UPDATE ops_webhook_log SET status = 'pending' WHERE status = 'sending'").run();
  const cfg = targetConfig(state.env);
  const parts = TARGETS.map(t => `${t} ${cfg[t].enabled ? `ON (${redactUrl(cfg[t].url)})` : cfg[t].configured ? 'off (flag off)' : 'off (not configured)'}`);
  state.log.log?.(`[ops-webhook] ${parts.join(' · ')}`);
  if (opts.loop !== false) {
    if (state.timer) clearInterval(state.timer);
    state.timer = setInterval(() => { pumpOpsWebhook().catch(() => {}); }, 1000);
    state.timer.unref?.();
  }
  return state;
}

export function stopOpsWebhook() { if (state.timer) clearInterval(state.timer); state.timer = null; }

/**
 * Queue the wake for a message that has just been created. Never throws, never
 * awaits a network call. Returns the target queued (or null).
 */
export function enqueueOpsWebhook({ channel, message, author, viaToken = false, attachmentCount = 0 }) {
  try {
    const db = state.db;
    if (!db) return null;
    const cfg = targetConfig(state.env);
    if (!cfg.flag) return null;
    const target = targetFor(db, { channel, message, author, viaToken, attachmentCount });
    if (!target || !cfg[target].enabled) return null;
    const payload = buildPayload({ target, channel, message, author, attachmentCount });
    const now = state.now();
    const recent = db.prepare("SELECT COUNT(*) AS n FROM ops_webhook_log WHERE created_at > ? AND status <> 'rate_limited'").get(now - 60000).n;
    const status = recent >= RATE_PER_MINUTE ? 'rate_limited' : 'pending';
    db.prepare(`INSERT OR IGNORE INTO ops_webhook_log (dedupe_id, target, channel_name, message_id, payload, status, next_attempt_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(payload.dedupe_id, target, channel.name, message.id, JSON.stringify(payload), status, now, now);
    if (status === 'rate_limited') { state.log.warn?.(`[ops-webhook] rate limited: ${payload.dedupe_id}`); return 'rate_limited'; }
    setImmediate(() => { pumpOpsWebhook().catch(() => {}); });
    return target;
  } catch (e) {
    state.log.error?.(`[ops-webhook] enqueue failed: ${scrub(e.message, state.env)}`);
    return null;
  }
}

async function sendOne(row) {
  const db = state.db;
  const cfg = targetConfig(state.env);
  const t = cfg[row.target];
  const attemptNo = row.attempts + 1;
  const stamp = new Date(state.now()).toISOString();
  let status = null, error = null, ok = false;
  if (!t.enabled) {
    error = 'target not configured or flag off';
  } else {
    const body = row.payload;
    const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${t.key}`, 'X-Powder-Ops-Dedupe': row.dedupe_id };
    if (cfg.signingSecret) headers['X-Powder-Ops-Signature'] = 'sha256=' + crypto.createHmac('sha256', cfg.signingSecret).update(body).digest('hex');
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
    try {
      const res = await state.fetch(t.url, { method: 'POST', headers, body, signal: ctl.signal });
      status = res.status;
      let json = null;
      try { json = JSON.parse(await res.text()); } catch { json = null; }
      ok = res.status === 200 && json?.success === true;
      if (!ok) error = json?.error ? `HTTP ${res.status}: ${json.error}` : `HTTP ${res.status}${json ? '' : ' (not JSON)'}`;
    } catch (e) {
      error = e?.name === 'AbortError' ? `timeout after ${TIMEOUT_MS / 1000}s` : `network: ${e?.message || e}`;
    } finally { clearTimeout(timer); }
  }
  error = error ? scrub(error, state.env) : null;
  if (ok) {
    db.prepare(`UPDATE ops_webhook_log SET status = 'sent', attempts = ?, last_http_status = ?, last_error = NULL,
      first_attempt_at = COALESCE(first_attempt_at, ?), last_attempt_at = ? WHERE id = ?`).run(attemptNo, status, stamp, stamp, row.id);
    return;
  }
  const exhausted = attemptNo > BACKOFF_MS.length;
  const wait = exhausted ? null : Math.round(BACKOFF_MS[attemptNo - 1] * (0.8 + 0.4 * state.random()));
  db.prepare(`UPDATE ops_webhook_log SET status = ?, attempts = ?, last_http_status = ?, last_error = ?, next_attempt_at = ?,
    first_attempt_at = COALESCE(first_attempt_at, ?), last_attempt_at = ? WHERE id = ?`)
    .run(exhausted ? 'failed' : 'pending', attemptNo, status, error, exhausted ? null : state.now() + wait, stamp, stamp, row.id);
  const loud = status === 401 || status === 400 || exhausted;
  const line = `[ops-webhook] ${row.target} ${row.dedupe_id} attempt ${attemptNo} failed: ${error}${exhausted ? ' — giving up' : ''} (${redactUrl(t.url)})`;
  if (loud) state.log.error?.(line); else state.log.warn?.(line);
}

/** Send every due row, at most MAX_IN_FLIGHT at once. Returns when the batch it started has finished. */
export async function pumpOpsWebhook() {
  const db = state.db;
  if (!db) return 0;
  const free = MAX_IN_FLIGHT - state.inFlight;
  if (free <= 0) return 0;
  const due = db.prepare("SELECT * FROM ops_webhook_log WHERE status = 'pending' AND next_attempt_at <= ? ORDER BY id LIMIT ?").all(state.now(), free);
  if (!due.length) return 0;
  const claim = db.prepare("UPDATE ops_webhook_log SET status = 'sending' WHERE id = ? AND status = 'pending'");
  const mine = due.filter(r => claim.run(r.id).changes === 1);
  state.inFlight += mine.length;
  await Promise.all(mine.map(r => sendOne(r).catch(e => {
    db.prepare("UPDATE ops_webhook_log SET status = 'pending' WHERE id = ? AND status = 'sending'").run(r.id);
    state.log.error?.(`[ops-webhook] send crashed: ${scrub(e.message, state.env)}`);
  }).finally(() => { state.inFlight--; })));
  return mine.length;
}

/** The admin status: per target enabled/configured, the last 20 attempts, failures in 24h, last success. */
export function opsWebhookStatus(db, env = process.env) {
  ensureOpsWebhookSchema(db);
  const cfg = targetConfig(env);
  const since = Date.now() - 24 * 3600 * 1000;
  const targets = {};
  for (const t of TARGETS) {
    targets[t] = {
      enabled: cfg[t].enabled, configured: cfg[t].configured,
      failed_24h: db.prepare("SELECT COUNT(*) AS n FROM ops_webhook_log WHERE target = ? AND status = 'failed' AND created_at > ?").get(t, since).n,
      last_success_at: db.prepare("SELECT MAX(last_attempt_at) AS t FROM ops_webhook_log WHERE target = ? AND status = 'sent'").get(t).t || null,
    };
  }
  const recent = db.prepare(`SELECT id, dedupe_id, target, channel_name, message_id, status, attempts, last_http_status, last_error,
    first_attempt_at, last_attempt_at FROM ops_webhook_log ORDER BY id DESC LIMIT 20`).all()
    .map(r => ({ ...r, last_error: r.last_error ? scrub(r.last_error, env) : null }));
  return { flag: cfg.flag, channels: [...OPS_CHANNELS], targets, recent };
}
