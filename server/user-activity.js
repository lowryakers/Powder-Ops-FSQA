// Who was active in ReadyDoc, and when (D-261).
//
// ONE APPEND-ONLY TABLE, `user_activity` (db.js): who, when (UTC), what kind of
// act, which page or record, and the details. Two triggers refuse any UPDATE or
// DELETE, so nothing here can be edited or pruned — "at least two years" is met
// by keeping everything.
//
// FOUR WAYS IN, each as close as possible to where the fact happens:
//   1. The audit listener (db.js setAuditListener). Every audit entry a PERSON
//      causes becomes an activity row, and an edit carries its field-level before
//      and after, computed from the same previous/new state the audit entry
//      stores. audit_log itself is not touched: the listener runs after its
//      insert and can never fail it.
//   2. The /api middleware. A write that wrote NO audit entry still leaves a row
//      (method, path, the fields sent — no "before", because the route never
//      recorded one; the row says so). A GET that answered with a file is a
//      download; a redirect to stored storage is a file open; a GET of one record
//      (`…/<id>`) is a record view.
//   3. The screen (POST /api/user-activity/events): page views, and files opened
//      or downloaded through a stored link the server never sees fetched.
//   4. The session sweep: a session that ran out of time is a timeout, dated when
//      it expired. Logins and logouts arrive through the audit listener.
//
// BATCHED: page views, record views, downloads and screen events are queued in
// memory and written in one transaction every two seconds (or at 200 rows), so a
// screen change costs the request nothing. Logins, logouts and edits are written
// at once — they are the rows that must not be lost, and they are rare.
//
// NEVER STORED: a password, a token, a setup code, an account or routing number,
// a signature, a file's bytes. Field names that look like any of those are
// recorded as "[redacted]"; a file is its name, never its contents; a query string
// (where a link's token lives) is dropped from every path.
import { getDb, setAuditListener } from './db.js';
import { FORBIDDEN_KEYS } from './bot-api.js';
import { hasExplicitGrant } from './module-access.js';

export const ACTIONS = Object.freeze({
  login: 'Signed in',
  logout: 'Signed out',
  session_timeout: 'Session timed out',
  session_revoked: 'Session ended by an admin or a password change',
  page_view: 'Opened a page',
  record_view: 'Opened a record',
  edit: 'Changed a record',
  download: 'Downloaded a file',
  file_open: 'Opened a file',
});

export const MODULE_ID = 'user-activity';
const AUDITED = Symbol('activity.audited');

// ── Redaction ────────────────────────────────────────────────────────────────

const SECRET_KEY = /pass(word|code)?|token|secret|ssn|social_sec|routing|dd_account|account_number|bank_account|signature|setup_code|\bpin\b|^pin$|_pin$|api_key|apikey|authorization|cookie|otp|_enc$|_hash$|private_key|ein$|^ein_/i;
const BULKY_KEY = /^(extracted_text|body_base64|file_data|data_url|panel_json|signed_snapshot|raw|html|pdf)$/i;
export const REDACTED = '[redacted]';
const MAX_VALUE = 200;
const MAX_FIELDS = 60;

export function isSecretKey(key) {
  const k = String(key || '');
  return FORBIDDEN_KEYS.has(k.toLowerCase()) || SECRET_KEY.test(k);
}

/** A value as it may be stored: secrets redacted, files named, long text cut. */
export function safeValue(key, value) {
  if (isSecretKey(key)) return value == null || value === '' ? value ?? null : REDACTED;
  if (BULKY_KEY.test(String(key || ''))) return value == null ? null : '[not stored]';
  if (value == null) return null;
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  let s = typeof value === 'string' ? value : (() => { try { return JSON.stringify(scrubObject(value)); } catch { return String(value); } })();
  if (/^data:[^;]+;base64,/i.test(s)) return '[file contents not stored]';
  if (s.length > MAX_VALUE) s = `${s.slice(0, MAX_VALUE)}… (${s.length} characters)`;
  return s;
}

/** Nested objects keep their shape with secret keys redacted (for JSON values). */
function scrubObject(v, depth = 0) {
  if (depth > 4 || v == null || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.slice(0, 50).map(x => scrubObject(x, depth + 1));
  const out = {};
  for (const [k, x] of Object.entries(v)) out[k] = isSecretKey(k) ? REDACTED : scrubObject(x, depth + 1);
  return out;
}

function asObject(v) {
  if (v == null) return null;
  if (typeof v === 'string') { try { const p = JSON.parse(v); return p && typeof p === 'object' ? p : { value: v }; } catch { return { value: v }; } }
  return typeof v === 'object' ? v : { value: v };
}

const NOISE_FIELD = /^(updated_at|modified_at|last_modified|version_ts)$/;
const same = (a, b) => {
  if (a === b) return true;
  try { return JSON.stringify(a) === JSON.stringify(b); } catch { return false; }
};

/**
 * Field-level changes between two states: [{field, from, to}]. A create lists the
 * fields it set (no `from`), a delete the fields it removed (no `to`).
 */
export function fieldChanges(prev, next) {
  const a = asObject(prev);
  const b = asObject(next);
  if (!a && !b) return [];
  const keys = [...new Set([...Object.keys(a || {}), ...Object.keys(b || {})])];
  const out = [];
  for (const k of keys) {
    if (NOISE_FIELD.test(k)) continue;
    const from = a ? a[k] : undefined;
    const to = b ? b[k] : undefined;
    if (a && b && same(from, to)) continue;
    if (!a && (to == null || to === '')) continue;
    if (!b && (from == null || from === '')) continue;
    const row = { field: k };
    if (a) row.from = safeValue(k, from === undefined ? null : from);
    if (b) row.to = safeValue(k, to === undefined ? null : to);
    out.push(row);
    if (out.length >= MAX_FIELDS) { out.push({ field: '…', note: `more than ${MAX_FIELDS} fields changed` }); break; }
  }
  return out;
}

/** The fields a request sent, made safe: names always, values unless `namesOnly`. */
export function sentFields(body, { namesOnly = false } = {}) {
  const o = body && typeof body === 'object' && !Array.isArray(body) ? body : null;
  if (!o) return Array.isArray(body) ? [{ field: '(list)', to: `${body.length} item(s)` }] : [];
  const out = [];
  for (const [k, v] of Object.entries(o)) {
    if (out.length >= MAX_FIELDS) break;
    out.push(namesOnly ? { field: k } : { field: k, to: safeValue(k, v) });
  }
  return out;
}

/** A path with its query string (and any token in it) removed. */
export function cleanPath(p) {
  return String(p || '').split('?')[0].split('#')[0].slice(0, 300);
}

const ID_SEGMENT = /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|\d+|(?=[A-Za-z0-9_-]*\d)[A-Za-z0-9]+(?:[-_][A-Za-z0-9]+)*)$/i;

/** `/api/pm/schedules/<id>` → { record_type: 'pm/schedules', record_id: '<id>' }, else null. */
export function recordFromPath(path) {
  const segs = cleanPath(path).replace(/^\/api\//, '').split('/').filter(Boolean);
  if (segs.length < 2) return null;
  const last = decodeURIComponent(segs[segs.length - 1]);
  if (!ID_SEGMENT.test(last) || last.length > 80) return null;
  return { record_type: segs.slice(0, -1).join('/'), record_id: last };
}

const FILE_TYPE = /application\/(pdf|zip|octet-stream|vnd\.|msword|x-zip|gzip)|text\/csv|image\/|video\/|audio\//i;
const STORAGE_URL = /X-Amz-Signature|r2\.cloudflarestorage\.com|amazonaws\.com/i;

/** Whether a finished GET handed over a file: 'download', 'file_open' or null. */
export function fileKindOf(status, headers) {
  const h = (k) => String(headers[k] ?? headers[k.toLowerCase()] ?? '');
  if (status >= 300 && status < 400) return STORAGE_URL.test(h('location')) ? 'file_open' : null;
  if (status >= 300) return null;
  if (/attachment/i.test(h('content-disposition'))) return 'download';
  if (FILE_TYPE.test(h('content-type'))) return /inline/i.test(h('content-disposition')) ? 'file_open' : 'download';
  return null;
}

function fileNameOf(headers) {
  const cd = String(headers['content-disposition'] || '');
  const m = cd.match(/filename\*=UTF-8''([^;]+)|filename="?([^";]+)"?/i);
  if (!m) return null;
  try { return decodeURIComponent(m[1] || m[2]).slice(0, 200); } catch { return (m[1] || m[2]).slice(0, 200); }
}

// ── Writing ──────────────────────────────────────────────────────────────────

const nowIso = () => new Date().toISOString();
let queue = [];
let insertStmt = null;

function insert(db, r) {
  if (!insertStmt || insertStmt.database !== db) {
    insertStmt = db.prepare(`INSERT INTO user_activity
      (occurred_at, user_id, user_name, action, page, record_type, record_id, record_label, details, via, audit_id)
      VALUES (@occurred_at, @user_id, @user_name, @action, @page, @record_type, @record_id, @record_label, @details, @via, @audit_id)`);
  }
  insertStmt.run({
    occurred_at: r.occurred_at || nowIso(),
    user_id: r.user_id ?? null,
    user_name: r.user_name ?? null,
    action: r.action,
    page: r.page ? String(r.page).slice(0, 300) : null,
    record_type: r.record_type ? String(r.record_type).slice(0, 120) : null,
    record_id: r.record_id != null ? String(r.record_id).slice(0, 120) : null,
    record_label: r.record_label ? String(r.record_label).slice(0, 200) : null,
    details: r.details ? JSON.stringify(r.details) : null,
    via: r.via || 'session',
    audit_id: r.audit_id ?? null,
  });
}

/** Written now — logins, logouts, edits, timeouts. */
export function recordActivity(row, db = getDb()) {
  if (!ACTIONS[row.action]) throw new Error(`Unknown activity "${row.action}"`);
  insert(db, row);
}

/** Queued — page views, record views, downloads, file opens. */
export function enqueueActivity(row) {
  if (!ACTIONS[row.action]) return;
  queue.push({ ...row, occurred_at: row.occurred_at || nowIso() });
  if (queue.length >= 200) flushActivity();
}

export function flushActivity(db = getDb()) {
  if (!queue.length) return 0;
  const rows = queue;
  queue = [];
  try {
    db.transaction(() => { for (const r of rows) insert(db, r); })();
  } catch (e) {
    console.warn('[activity] could not write queued activity:', e.message);
  }
  return rows.length;
}

// Record views and page views repeat (a screen polls, a person flicks back and
// forth). The same person on the same page or record within the window is one row.
const recent = new Map();
const WINDOW_MS = { record_view: 5 * 60 * 1000, page_view: 5 * 1000 };
function isRepeat(kind, userId, key, at = Date.now()) {
  const k = `${kind}|${userId}|${key}`;
  const prev = recent.get(k);
  recent.set(k, at);
  if (recent.size > 5000) {
    const cut = at - 10 * 60 * 1000;
    for (const [kk, t] of recent) if (t < cut) recent.delete(kk);
  }
  return prev != null && at - prev < WINDOW_MS[kind];
}

// ── 1. The audit listener ────────────────────────────────────────────────────

const NOT_ACTIVITY = new Set(['api_token_call', 'login_failed', 'login_locked']);
const DOWNLOAD_ACTIONS = new Set(['export', 'download']);

export function onAuditEntry({ actor, action, entityType, entityId, entityLabel, details, previousState, newState, auditId }) {
  if (!actor || typeof actor !== 'object' || !actor.id) return;
  if (NOT_ACTIVITY.has(action)) return;
  const via = actor.via_token ? 'token' : 'session';
  const base = { user_id: actor.id, user_name: actor.name || null, via, audit_id: auditId,
    record_type: entityType || null, record_id: entityId || null, record_label: entityLabel || null };
  if (action === 'login' || action === 'logout') {
    recordActivity({ ...base, action, record_type: null, record_id: null, record_label: null });
  } else {
    const changes = fieldChanges(previousState, newState);
    const note = details && typeof details === 'object' ? sentFields(details).slice(0, 20) : (details != null ? [{ field: 'detail', to: safeValue('detail', details) }] : []);
    recordActivity({ ...base, action: DOWNLOAD_ACTIONS.has(action) ? 'download' : 'edit',
      details: { audit_action: action, ...(changes.length ? { changes } : {}), ...(note.length ? { details: note } : {}) } });
  }
  actor[AUDITED] = true;
}

// ── 2. The /api middleware ───────────────────────────────────────────────────

// Writes that change no record: reading markers, typing, push devices, the
// screen's own event batch, translations, sign-in. Not activity.
const NOT_AN_EDIT = [
  /^\/api\/user-activity\//,
  /^\/api\/users\/(login|logout|set-password|lookup)$/,
  /^\/api\/push\//,
  /^\/api\/ai\/(translate|translate-content)/,
  /^\/api\/comms\/(channels\/[^/]+\/(read|unread|typing)|threads\/[^/]+\/read|read-all|activity\/read|presence)$/,
];
// Writes whose VALUES are somebody's words (a chat message, a question): the
// row names the fields, never what was typed.
const NAMES_ONLY = [/^\/api\/comms\//, /^\/api\/ai\//];

export function activityMiddleware(req, res, next) {
  res.on('finish', () => { try { afterResponse(req, res); } catch (e) { console.warn('[activity] not recorded:', e.message); } });
  next();
}

function afterResponse(req, res) {
  const actor = req.realAdmin || req.user;
  if (!actor?.id) return;
  const path = cleanPath(req.originalUrl || req.url);
  const via = req.auth?.kind === 'token' ? 'token' : 'session';
  const status = res.statusCode;
  const base = { user_id: actor.id, user_name: actor.name || null, via, page: path };
  if (req.method === 'GET' || req.method === 'HEAD') {
    if (status >= 400) return;
    const headers = res.getHeaders();
    const kind = fileKindOf(status, headers);
    // Reading the activity log is not itself a record view; exporting it is a download.
    if (!kind && /^\/api\/user-activity(\/|$)/.test(path)) return;
    const rec = recordFromPath(path);
    if (kind) {
      const name = fileNameOf(headers);
      enqueueActivity({ ...base, action: kind, ...(rec || {}), details: name ? { file: name } : null });
      return;
    }
    if (via === 'session' && status === 200 && rec && !isRepeat('record_view', actor.id, path)) {
      enqueueActivity({ ...base, action: 'record_view', ...rec });
    }
    return;
  }
  if (status >= 400 || req.user?.[AUDITED] || actor[AUDITED]) return;
  if (NOT_AN_EDIT.some(re => re.test(path))) return;
  const namesOnly = NAMES_ONLY.some(re => re.test(path));
  const files = [].concat(req.file || [], Array.isArray(req.files) ? req.files : Object.values(req.files || {}).flat())
    .map(f => f?.originalname).filter(Boolean).slice(0, 20);
  recordActivity({ ...base, action: 'edit', ...(recordFromPath(path) || {}), details: {
    method: req.method,
    status,
    sent: sentFields(req.body, { namesOnly }),
    ...(files.length ? { files } : {}),
    before: 'not recorded — this route writes no audit entry',
  } });
}

// ── 3. The screen's events ───────────────────────────────────────────────────

const CLIENT_KINDS = new Set(['page_view', 'file_open', 'download']);
export const MAX_EVENTS = 50;

/** Accept a batch from the screen. Returns how many were queued. */
export function acceptClientEvents(user, events) {
  if (!user?.id || !Array.isArray(events)) return 0;
  let n = 0;
  const now = Date.now();
  for (const e of events.slice(0, MAX_EVENTS)) {
    if (!e || !CLIENT_KINDS.has(e.type)) continue;
    const page = cleanPath(e.page || '').slice(0, 200) || null;
    const at = Date.parse(e.at);
    // The screen's clock is believed only within the last ten minutes.
    const occurred_at = Number.isFinite(at) && at <= now + 5000 && now - at <= 10 * 60 * 1000 ? new Date(at).toISOString() : new Date(now).toISOString();
    if (e.type === 'page_view' && isRepeat('page_view', user.id, page, Date.parse(occurred_at))) continue;
    const name = e.name ? String(e.name).split('?')[0].slice(0, 200) : null;
    const rec = e.record_id ? { record_type: String(e.record_type || '').slice(0, 120) || null, record_id: String(e.record_id).slice(0, 120) } : {};
    enqueueActivity({ user_id: user.id, user_name: user.name || null, via: 'session', action: e.type, page, occurred_at,
      ...rec, record_label: e.label ? String(e.label).slice(0, 200) : null,
      details: name ? { file: name } : (e.view ? { view: String(e.view).slice(0, 80) } : null) });
    n++;
  }
  return n;
}

// ── 4. Sessions that ran out ─────────────────────────────────────────────────

/** A session past its expiry is a timeout, dated when it expired. Once each. */
export function sweepSessionTimeouts(db = getDb()) {
  const rows = db.prepare(`SELECT s.id, s.user_id, s.created_at, s.expires_at, u.name
    FROM sessions s LEFT JOIN users u ON u.id = s.user_id
    WHERE s.activity_ended_at IS NULL AND datetime(s.expires_at) <= datetime('now')
    ORDER BY s.expires_at LIMIT 500`).all();
  if (!rows.length) return 0;
  const mark = db.prepare('UPDATE sessions SET activity_ended_at = ? WHERE id = ?');
  db.transaction(() => {
    for (const s of rows) {
      const at = new Date(Date.parse(String(s.expires_at).includes('T') ? s.expires_at : `${s.expires_at.replace(' ', 'T')}Z`));
      recordActivity({ user_id: s.user_id, user_name: s.name || null, action: 'session_timeout',
        occurred_at: Number.isNaN(at.getTime()) ? nowIso() : at.toISOString(),
        details: { signed_in_at: s.created_at } }, db);
      mark.run(nowIso(), s.id);
    }
  })();
  return rows.length;
}

/** Sessions about to be deleted by a revoke: one row each. */
export function recordRevokedSessions(db, userId, { keepToken = null, reason = null } = {}) {
  const rows = keepToken
    ? db.prepare(`SELECT s.id, s.created_at, u.name FROM sessions s LEFT JOIN users u ON u.id = s.user_id
        WHERE s.user_id = ? AND s.token != ? AND datetime(s.expires_at) > datetime('now')`).all(userId, keepToken)
    : db.prepare(`SELECT s.id, s.created_at, u.name FROM sessions s LEFT JOIN users u ON u.id = s.user_id
        WHERE s.user_id = ? AND datetime(s.expires_at) > datetime('now')`).all(userId);
  for (const s of rows) {
    recordActivity({ user_id: userId, user_name: s.name || null, action: 'session_revoked',
      details: { signed_in_at: s.created_at, ...(reason ? { reason } : {}) } }, db);
  }
  return rows.length;
}

// ── Reading ──────────────────────────────────────────────────────────────────

/** People: admins only. A bot: a token whose account was granted "User activity". */
export function mayReadActivity(req) {
  if (!req.user) return false;
  if (req.auth?.kind === 'token') return hasExplicitGrant(req.user, MODULE_ID);
  return req.user.role === 'admin' && !req.impersonated;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;
function filters(q = {}) {
  const where = [];
  const args = [];
  if (q.user_id) { where.push('user_id = ?'); args.push(String(q.user_id)); }
  if (q.action && ACTIONS[q.action]) { where.push('action = ?'); args.push(q.action); }
  if (q.from) {
    if (!DAY.test(q.from) && Number.isNaN(Date.parse(q.from))) throw new RangeError('from must be a date (YYYY-MM-DD)');
    where.push('occurred_at >= ?'); args.push(DAY.test(q.from) ? q.from : new Date(q.from).toISOString());
  }
  if (q.to) {
    if (!DAY.test(q.to) && Number.isNaN(Date.parse(q.to))) throw new RangeError('to must be a date (YYYY-MM-DD)');
    // A day means the whole of that day.
    if (DAY.test(q.to)) { where.push("occurred_at < strftime('%Y-%m-%d', ?, '+1 day')"); args.push(q.to); }
    else { where.push('occurred_at <= ?'); args.push(new Date(q.to).toISOString()); }
  }
  if (q.q) {
    where.push('(page LIKE ? OR record_label LIKE ? OR record_id LIKE ? OR record_type LIKE ?)');
    const like = `%${String(q.q).slice(0, 100)}%`;
    args.push(like, like, like, like);
  }
  return { sql: where.length ? `WHERE ${where.join(' AND ')}` : '', args };
}

function shape(r) {
  const details = (() => { try { return r.details ? JSON.parse(r.details) : null; } catch { return r.details; } })();
  return { ...r, details, action_label: ACTIONS[r.action] || r.action };
}

export function listActivity(db, q = {}) {
  flushActivity(db);
  sweepSessionTimeouts(db);
  const { sql, args } = filters(q);
  const limit = Math.min(Math.max(parseInt(q.limit, 10) || 200, 1), 200);
  const offset = Math.max(parseInt(q.offset, 10) || 0, 0);
  const total = db.prepare(`SELECT COUNT(*) n FROM user_activity ${sql}`).get(...args).n;
  const rows = db.prepare(`SELECT * FROM user_activity ${sql} ORDER BY occurred_at DESC, id DESC LIMIT ? OFFSET ?`)
    .all(...args, limit, offset).map(shape);
  return { rows, total, limit, offset };
}

const csvCell = (v) => {
  if (v == null) return '';
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
export const CSV_HEADER = ['occurred_at_utc', 'user', 'user_id', 'action', 'page', 'record_type', 'record_id', 'record', 'via', 'details'];

/** Every matching row as CSV lines, oldest first, written in chunks. */
export function* activityCsv(db, q = {}) {
  flushActivity(db);
  sweepSessionTimeouts(db);
  const { sql, args } = filters(q);
  yield `${CSV_HEADER.join(',')}\n`;
  for (const r of db.prepare(`SELECT * FROM user_activity ${sql} ORDER BY occurred_at, id`).iterate(...args)) {
    yield `${[r.occurred_at, r.user_name, r.user_id, r.action, r.page, r.record_type, r.record_id, r.record_label, r.via, r.details].map(csvCell).join(',')}\n`;
  }
}

// ── Starting ─────────────────────────────────────────────────────────────────

let timer = null;
export function startUserActivity() {
  setAuditListener(onAuditEntry);
  if (timer) return;
  let ticks = 0;
  timer = setInterval(() => {
    flushActivity();
    if (++ticks % 150 === 0) { try { sweepSessionTimeouts(); } catch (e) { console.warn('[activity] timeout sweep:', e.message); } }
  }, 2000);
  timer.unref?.();
  try { sweepSessionTimeouts(); } catch (e) { console.warn('[activity] timeout sweep:', e.message); }
}
