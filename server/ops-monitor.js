// Outside monitoring for the #ops-requests bots (D-259).
//
// On 28 Oct 2026, around 2:55 PM MT, the bots' scheduled runs stopped and nobody
// noticed for about twenty minutes, in the middle of a test. This watches two
// things and tells ONE person when either goes wrong, and once more when it clears:
//
//   (a) webhook errors: a target's deliveries (D-251) have failed for
//       OPS_MONITOR_WEBHOOK_MINUTES (default 15) straight, with no success in between;
//   (b) bot silence: no bot has been seen (token use or a post) for
//       OPS_MONITOR_SILENCE_MINUTES (default 120) inside 7:00 AM–5:00 PM plant
//       time, Monday to Friday.
//
// RULES, each load-bearing:
//   - OFF unless OPS_MONITOR_ENABLED. Off means no timer, no table, no channel,
//     no push, no post.
//   - An alert is a post in the private #alerts channel (only the recipient in
//     it) by ReadyBot, plus a push to the recipient through pushToUser. No email.
//   - ONE recipient: the active account whose email is lowry@powder-ops.com, else
//     OPS_MONITOR_USER_ID. Nobody else is ever pushed; there is no fallback to admins.
//   - One alert when an incident opens, one recovery when it clears, nothing in
//     between. State lives in `ops_monitor_incidents`, so a restart resends nothing.
//   - It reads; it writes only its own table and #alerts; it never calls a bot URL.
import { randomUUID } from 'crypto';
import { targetConfig, scrub } from './ops-webhook.js';
import { plantWallClock, parseServerTime, PLANT_TZ } from './plant-clock.js';
import { pushToUser as realPushToUser, pushEnabled as realPushEnabled } from './push.js';
import { postMessageAs as realPostMessageAs, getBotUser, getChannelByName } from './api/comms.js';
import { emitChannelsChanged } from './realtime.js';

export const RECIPIENT_EMAIL = 'lowry@powder-ops.com';
export const ALERTS_CHANNEL = 'alerts';
export const WINDOW_START_HOUR = 7;
export const WINDOW_END_HOUR = 17;
export const RETRY_EVERY_MS = 5 * 60 * 1000;
export const MAX_ALERT_ATTEMPTS = 6;
export const BODY_MAX = 120;
const TARGETS = ['procurement', 'controller'];
const on = (v) => /^(1|true|yes|on)$/i.test(String(v || '').trim());
const num = (v, d) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : d; };

/** Read at every check, so a test (or Railway) can change a threshold without a restart. */
export function monitorConfig(env = process.env) {
  const test = env.NODE_ENV === 'test';
  return {
    enabled: on(env.OPS_MONITOR_ENABLED),
    silenceMinutes: num(env.OPS_MONITOR_SILENCE_MINUTES, 120),
    webhookMinutes: num(env.OPS_MONITOR_WEBHOOK_MINUTES, 15),
    userId: String(env.OPS_MONITOR_USER_ID || '').trim() || null,
    // Test-only overrides, IGNORED unless NODE_ENV=test: the tick, and the plant
    // wall-clock time the window gate reads (e.g. "Wed 10:00").
    tickMs: test ? num(env.OPS_MONITOR_TICK_MS, 60000) : 60000,
    testWall: test ? (String(env.OPS_MONITOR_TEST_WALL || '').trim() || null) : null,
  };
}

export function ensureOpsMonitorSchema(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS ops_monitor_incidents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    incident_key TEXT NOT NULL,
    kind TEXT NOT NULL,
    opened_at TEXT NOT NULL,
    since_at TEXT,
    alert_at TEXT,
    alert_message_id TEXT,
    alert_push TEXT,
    alert_attempts INTEGER NOT NULL DEFAULT 0,
    last_alert_try_at TEXT,
    last_alert_error TEXT,
    recovered_at TEXT,
    recovery_at TEXT,
    recovery_message_id TEXT,
    recovery_push TEXT,
    detail TEXT
  );
  CREATE UNIQUE INDEX IF NOT EXISTS idx_ops_monitor_open ON ops_monitor_incidents(incident_key) WHERE recovered_at IS NULL;
  CREATE INDEX IF NOT EXISTS idx_ops_monitor_recovered ON ops_monitor_incidents(recovered_at);
  CREATE INDEX IF NOT EXISTS idx_chat_messages_user ON chat_messages(user_id, created_at);`);
}

const tableExists = (db, name) => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name);
const iso = (d) => new Date(d).toISOString();
const ms = (v) => { const d = parseServerTime(v); return d ? d.getTime() : null; };

// ── the window ──────────────────────────────────────────────────────────────
const DAYS = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/**
 * Monday–Friday, 7:00 AM–5:00 PM plant time. The wall clock is used for the day
 * and hour GATE only; the window's start is a real instant, "now minus the
 * minutes since 7:00 on the wall clock" (D-124: never subtract wall-clock Dates).
 * Paid holidays are NOT skipped: Lowry asked for weekdays only (open question, D-259).
 */
export function windowAt(now, cfg = monitorConfig()) {
  let day, minutes;
  const m = cfg.testWall && cfg.testWall.match(/^(Sun|Mon|Tue|Wed|Thu|Fri|Sat)\s+(\d{1,2}):(\d{2})$/);
  if (m) { day = DAYS[m[1]]; minutes = Number(m[2]) * 60 + Number(m[3]); }
  else {
    const wall = plantWallClock(new Date(now));
    day = wall.getDay();
    minutes = wall.getHours() * 60 + wall.getMinutes() + wall.getSeconds() / 60;
  }
  const weekday = day >= 1 && day <= 5;
  const inside = weekday && minutes >= WINDOW_START_HOUR * 60 && minutes < WINDOW_END_HOUR * 60;
  return { inside, weekday, start: now - (minutes - WINDOW_START_HOUR * 60) * 60000 };
}

// ── who is a bot ────────────────────────────────────────────────────────────
/**
 * A bot = an active account holding at least one live (not revoked, not expired)
 * API token. Not "the name starts with *": a token is what makes an account a
 * bot that calls ReadyDoc (D-161), and the asterisk is only a naming convention
 * that a renamed account would break silently.
 * EXCLUDED: ReadyBot (the house account that posts from inside the app,
 * including this monitor's own alerts) and the Test Runner (D-252), which posts
 * test questions. Counting either would hide a real outage.
 *
 * Why the silence default is 120 minutes: the weekday P0 sweep runs hourly but
 * reads Gmail and REGISTER.md only, so ReadyDoc never sees it. What ReadyDoc does
 * see regularly is Procurement's backup check every 90 minutes on weekdays (7:07,
 * 8:37, 10:07, 11:37, 1:07, 2:37, 4:07 MT), plus webhook-woken runs and other
 * bots' token calls. A normal gap is ~90 minutes, ~115 with the worst start
 * lateness, so 120 stays quiet on a normal day and still catches a stall.
 */
export function botSignals(db, now) {
  const exclude = new Set(db.prepare("SELECT id FROM users WHERE name = 'ReadyBot'").all().map(r => r.id));
  try {
    const tr = db.prepare("SELECT value FROM app_settings WHERE key = 'test_runner_user_id'").get()?.value;
    if (tr) exclude.add(tr);
  } catch { /* no setting */ }
  const tokens = db.prepare(`SELECT t.user_id, t.last_used_at, t.expires_at, u.name FROM api_tokens t
    JOIN users u ON u.id = t.user_id WHERE t.revoked_at IS NULL AND u.is_active = 1`).all()
    .filter(t => !exclude.has(t.user_id) && !(t.expires_at && ms(t.expires_at) !== null && ms(t.expires_at) <= now));
  const bots = new Map(tokens.map(t => [t.user_id, t.name]));
  let last = null;
  const take = (at, kind, name) => { const v = ms(at); if (v !== null && (!last || v > last.at)) last = { at: v, kind, name }; };
  for (const t of tokens) take(t.last_used_at, 'token', t.name);
  const latestPost = db.prepare('SELECT created_at FROM chat_messages WHERE user_id = ? AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 1');
  for (const [id, name] of bots) take(latestPost.get(id)?.created_at, 'post', name);
  return { bots: bots.size, last };
}

// ── the checks ──────────────────────────────────────────────────────────────
/** (a) Per target: erroring for N minutes straight, no success since. */
export function webhookCheck(db, target, now, env, cfg) {
  const key = `webhook:${target}`;
  if (!targetConfig(env)[target].enabled || !tableExists(db, 'ops_webhook_log')) {
    return { key, kind: 'webhook', target, state: 'not_evaluated', reason: 'target_off', switchedOff: true, recoveredFor: () => true };
  }
  const lastOk = db.prepare("SELECT MAX(last_attempt_at) AS t FROM ops_webhook_log WHERE target = ? AND status = 'sent'").get(target).t || null;
  const err = db.prepare(`SELECT MIN(first_attempt_at) AS since, COUNT(*) AS n FROM ops_webhook_log
    WHERE target = ? AND status IN ('pending','failed') AND attempts > 0 AND last_error IS NOT NULL
      AND first_attempt_at IS NOT NULL AND (? IS NULL OR first_attempt_at > ?)`).get(target, lastOk, lastOk);
  const latest = db.prepare(`SELECT last_http_status, last_error FROM ops_webhook_log
    WHERE target = ? AND status IN ('pending','failed') AND last_error IS NOT NULL ORDER BY last_attempt_at DESC LIMIT 1`).get(target);
  const since = err.n ? ms(err.since) : null;
  const incident = since !== null && now - since >= cfg.webhookMinutes * 60000;
  return {
    key, kind: 'webhook', target, state: incident ? 'incident' : 'ok', since: since !== null ? iso(since) : null,
    lastOk, lastError: latest ? { status: latest.last_http_status, error: scrub(latest.last_error, env) } : null,
    // Recovery: a delivery that went through after the errors began.
    recoveredFor: (open) => !!lastOk && !!open.since_at && ms(lastOk) > ms(open.since_at),
  };
}

/** (b) No bot seen for N minutes inside the window. */
export function silenceCheck(db, now, cfg) {
  const key = 'bot-silence';
  const { bots, last } = botSignals(db, now);
  const win = windowAt(now, cfg);
  // Recovery: a bot seen after the incident opened, inside the window or not.
  const recoveredFor = (open) => !!last && last.at > ms(open.opened_at);
  if (!bots) return { key, kind: 'silence', state: 'not_evaluated', reason: 'no_bots', last: null, recoveredFor };
  if (!win.inside) return { key, kind: 'silence', state: 'not_evaluated', reason: 'outside_window', last, recoveredFor };
  const since = Math.max(last?.at ?? 0, win.start);
  const incident = now - since >= cfg.silenceMinutes * 60000;
  return { key, kind: 'silence', state: incident ? 'incident' : 'ok', since: iso(since), last, recoveredFor };
}

export function evaluate(db, now, env, cfg) {
  return [...TARGETS.map(t => webhookCheck(db, t, now, env, cfg)), silenceCheck(db, now, cfg)];
}

// ── the recipient and #alerts ───────────────────────────────────────────────
/** The one account to alert. Never a role, never a list, never from a request. */
export function resolveRecipient(db, cfg) {
  const byEmail = db.prepare("SELECT id, name FROM users WHERE LOWER(TRIM(email)) = ? AND is_active = 1").all(RECIPIENT_EMAIL);
  if (byEmail.length === 1) return { status: 'resolved', user: byEmail[0] };
  if (byEmail.length > 1) return { status: 'ambiguous', user: null };
  if (cfg.userId) {
    const u = db.prepare('SELECT id, name FROM users WHERE id = ? AND is_active = 1').get(cfg.userId);
    if (u) return { status: 'resolved', user: u };
  }
  return { status: 'not_found', user: null };
}

/**
 * #alerts: private, and the recipient its ONLY member. Created once when it is
 * missing (found through getChannelByName, so a clashing name is never created
 * twice). Anything else is UNSAFE: nothing is posted, nothing is changed, and no
 * second channel is made. Re-checked before every post — an admin can add
 * people to any channel.
 */
export function ensureAlertsChannel(db, recipient, { create = true } = {}) {
  const c = getChannelByName(db, ALERTS_CHANNEL);
  if (c) {
    const members = db.prepare('SELECT user_id FROM chat_channel_members WHERE channel_id = ?').all(c.id).map(m => m.user_id);
    if (c.kind !== 'private') return { status: 'unsafe', channel: null, why: 'the alerts channel is not private' };
    if (!recipient || members.length !== 1 || members[0] !== recipient.id) return { status: 'unsafe', channel: null, why: 'the alerts channel has someone else in it' };
    return { status: 'ok', channel: c };
  }
  if (!create || !recipient) return { status: 'missing', channel: null };
  const id = randomUUID();
  db.transaction(() => {
    db.prepare('INSERT INTO chat_channels (id, kind, name, topic, created_by) VALUES (?, ?, ?, ?, ?)')
      .run(id, 'private', ALERTS_CHANNEL, 'Automatic alerts from ReadyDoc monitoring. Only Lowry.', recipient.id);
    db.prepare("INSERT INTO chat_channel_members (id, channel_id, user_id, role) VALUES (?, ?, ?, 'owner')")
      .run(randomUUID(), id, recipient.id);
  })();
  const channel = db.prepare('SELECT * FROM chat_channels WHERE id = ?').get(id);
  try { emitChannelsChanged(db, channel); } catch { /* no socket server in a test */ }
  return { status: 'created', channel };
}

// ── wording ─────────────────────────────────────────────────────────────────
const mtFmt = new Intl.DateTimeFormat('en-US', { timeZone: PLANT_TZ, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
export const mt = (at) => (at === null || at === undefined || at === '' ? 'never' : `${mtFmt.format(new Date(typeof at === 'number' ? at : ms(at) ?? at))} MT`);
export const duration = (mins) => { const m = Math.max(0, Math.round(mins)); return m >= 60 ? `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min` : `${m} min`; };
const CHECK = "Check the admin status pages (/api/admin/ops-webhook/status and /api/admin/ops-monitor/status), the Railway variables, and whether the bots' routines are running.";
// No @ anywhere: a mention would notify again.
const clean = (s, env) => scrub(String(s).replace(/@/g, '(at)').replace(/\s+/g, ' ').trim(), env);
const short = (s) => (s.length > BODY_MAX ? `${s.slice(0, BODY_MAX - 1)}…` : s);

export function alertText(ev, now, env) {
  const since = ms(ev.since) ?? now;
  const lasted = duration((now - since) / 60000);
  if (ev.kind === 'webhook') {
    const e = ev.lastError;
    const err = e ? `Last error: ${e.status ? `HTTP ${e.status}, ` : ''}${String(e.error || '').split('\n')[0]}.` : '';
    return {
      post: clean(`Bots alert: webhook deliveries to ${ev.target} have failed since ${mt(since)} (${lasted}). Last good delivery: ${mt(ev.lastOk)}. ${err} ${CHECK}`, env),
      push: short(clean(`Webhook errors (${ev.target}) for ${lasted}`, env)),
    };
  }
  const seen = ev.last ? `${mt(ev.last.at)} (${ev.last.kind === 'token' ? 'API use' : 'a post'} by ${ev.last.name})` : 'never';
  return {
    post: clean(`Bots alert: no bot has been seen inside working hours for ${lasted}. Last seen: ${seen}. ${CHECK}`, env),
    push: short(clean(`No bot seen for ${lasted}`, env)),
  };
}

export function recoveryText(open, ev, now, env) {
  const lasted = duration((now - ms(open.opened_at)) / 60000);
  if (open.kind === 'webhook') {
    const target = open.incident_key.split(':')[1];
    if (ev?.switchedOff) {
      return { post: clean(`Bots update: the ${target} webhook was switched off at ${mt(now)}, so it is no longer watched. The problem had lasted about ${lasted} from the alert.`, env),
        push: short(`Webhook (${target}) switched off; no longer watched`) };
    }
    return { post: clean(`Bots recovered: webhook deliveries to ${target} are going through again (${mt(now)}). The problem lasted about ${lasted} from the alert. A recovery is only seen on the next successful delivery, so it can lag when few messages are posted.`, env),
      push: short(`Webhook (${target}) recovered after ${lasted}`) };
  }
  return { post: clean(`Bots recovered: a bot was seen again at ${mt(now)}. The silence lasted about ${lasted} from the alert.`, env),
    push: short(`Bots seen again after ${lasted}`) };
}

// ── delivery ────────────────────────────────────────────────────────────────
const subsOf = (db, userId) => {
  try { return db.prepare('SELECT endpoint, last_success_at, last_error_at FROM chat_push_subscriptions WHERE user_id = ?').all(userId); }
  catch { return []; }
};

/**
 * Post in #alerts (when safe) and push the recipient. pushToUser returns nothing
 * and never throws, so the outcome is read back from the recipient's
 * subscription rows: stamped at or after the moment the alert started = this alert.
 */
async function deliver(db, deps, recipient, text, title, env, log, warnKey) {
  const res = { messageId: null, push: 'none', channel: 'missing', error: null };
  const ch = ensureAlertsChannel(db, recipient);
  res.channel = ch.status;
  if (ch.status === 'unsafe' && !state.warned.has(`${warnKey}:unsafe`)) {
    state.warned.add(`${warnKey}:unsafe`);
    log.warn?.(`[ops-monitor] #alerts is unsafe (${ch.why}); nothing posted, push only`);
  }
  const started = db.prepare("SELECT datetime('now') AS t").get().t;
  const before = subsOf(db, recipient.id).length;
  if (ch.channel) {
    try {
      const m = await deps.postMessageAs(db, ch.channel, getBotUser(db), text.post);
      res.messageId = m?.id || null;
    } catch (e) { res.error = scrub(`post failed: ${e.message}`, env); }
  }
  if (!deps.pushEnabled()) res.push = 'disabled';
  else if (!before) res.push = 'none';
  else {
    const url = ch.channel ? (res.messageId ? `/?c=${ch.channel.id}&m=${res.messageId}` : `/?c=${ch.channel.id}`) : '/';
    // The channel's own push carries this tag, so the phone replaces one with the other.
    const tag = ch.channel ? `channel-${ch.channel.id}` : 'ops-monitor';
    try { await deps.pushToUser(recipient.id, { title, body: short(text.push), tag, renotify: true, url }); }
    catch (e) { res.error = res.error || scrub(`push failed: ${e.message}`, env); }
    const after = subsOf(db, recipient.id);
    const sent = after.some(s => s.last_success_at && s.last_success_at >= started);
    res.push = sent ? 'sent' : 'failed';
    if (!sent && res.error === null) res.error = 'push did not reach a phone';
  }
  res.delivered = !!res.messageId || res.push === 'sent';
  return res;
}

// ── the tick ────────────────────────────────────────────────────────────────
let state = { db: null, env: process.env, now: () => Date.now(), log: console, timer: null, deps: null, warned: new Set() };

/** One pass: open, alert, recover. Never throws. */
export async function tickOpsMonitor() {
  const { db, env, log, deps } = state;
  if (!db) return null;
  const cfg = monitorConfig(env);
  if (!cfg.enabled) return null;
  const now = state.now();
  try {
    ensureOpsMonitorSchema(db);
    const evals = evaluate(db, now, env, cfg);
    const openOf = db.prepare('SELECT * FROM ops_monitor_incidents WHERE incident_key = ? AND recovered_at IS NULL');
    const recipient = resolveRecipient(db, cfg);
    for (const ev of evals) {
      const open = openOf.get(ev.key);
      if (open) {
        if (!ev.recoveredFor(open)) continue;
        db.prepare('UPDATE ops_monitor_incidents SET recovered_at = ? WHERE id = ? AND recovered_at IS NULL').run(iso(now), open.id);
        if (!open.alert_at) { log.log?.(`[ops-monitor] ${ev.key} cleared before an alert was delivered; no recovery sent`); continue; }
        if (!recipient.user) { log.warn?.(`[ops-monitor] ${ev.key} recovered; no recipient (${recipient.status})`); continue; }
        const r = await deliver(db, deps, recipient.user, recoveryText(open, ev, now, env), 'ReadyDoc: bots recovered', env, log, `r${open.id}`);
        db.prepare('UPDATE ops_monitor_incidents SET recovery_at = ?, recovery_message_id = ?, recovery_push = ? WHERE id = ?')
          .run(r.delivered ? iso(now) : null, r.messageId, r.push, open.id);
        continue;
      }
      if (ev.state !== 'incident') continue;
      const detail = ev.kind === 'webhook'
        ? `${ev.target}: ${ev.lastError?.status ? `HTTP ${ev.lastError.status} ` : ''}${ev.lastError?.error || 'errors'}`
        : `last seen ${ev.last ? iso(ev.last.at) : 'never'}`;
      const ins = db.prepare(`INSERT OR IGNORE INTO ops_monitor_incidents (incident_key, kind, opened_at, since_at, detail) VALUES (?, ?, ?, ?, ?)`)
        .run(ev.key, ev.kind, iso(now), ev.since, scrub(detail, env).slice(0, 200));
      if (ins.changes) log.warn?.(`[ops-monitor] incident opened: ${ev.key}`);
    }
    // Deliver any open incident not yet alerted: at most every 5 minutes, at most 6 times.
    const pending = db.prepare('SELECT * FROM ops_monitor_incidents WHERE recovered_at IS NULL AND alert_at IS NULL ORDER BY id').all();
    for (const inc of pending) {
      if (inc.alert_attempts >= MAX_ALERT_ATTEMPTS) continue;
      if (inc.last_alert_try_at && now - ms(inc.last_alert_try_at) < RETRY_EVERY_MS) continue;
      let r;
      if (!recipient.user) {
        if (!state.warned.has(`${inc.id}:recipient`)) { state.warned.add(`${inc.id}:recipient`); log.warn?.(`[ops-monitor] no recipient (${recipient.status}); ${inc.incident_key} not alerted`); }
        r = { delivered: false, messageId: null, push: 'none', error: `recipient ${recipient.status}` };
      } else {
        const ev = evals.find(e => e.key === inc.incident_key);
        const text = alertText({ ...ev, kind: inc.kind, since: inc.since_at }, now, env);
        r = await deliver(db, deps, recipient.user, text, 'ReadyDoc alert: bots', env, log, `a${inc.id}`);
      }
      db.prepare(`UPDATE ops_monitor_incidents SET alert_attempts = alert_attempts + 1, last_alert_try_at = ?, alert_at = ?,
        alert_message_id = ?, alert_push = ?, last_alert_error = ? WHERE id = ?`)
        .run(iso(now), r.delivered ? iso(now) : null, r.messageId, r.push, r.delivered ? null : scrub(r.error || 'nothing delivered', env), inc.id);
    }
    return evals;
  } catch (e) {
    log.warn?.(`[ops-monitor] tick failed: ${scrub(e.message, env)}`);
    return null;
  }
}

/** Wire it. Off unless the flag is on; a test passes its own clock, env and dependencies. */
export function startOpsMonitor(db, opts = {}) {
  stopOpsMonitor();
  const env = opts.env || process.env;
  state = {
    db, env, now: opts.now || (() => Date.now()), log: opts.log || console, timer: null, warned: new Set(),
    deps: { pushToUser: opts.pushToUser || realPushToUser, pushEnabled: opts.pushEnabled || realPushEnabled, postMessageAs: opts.postMessageAs || realPostMessageAs },
  };
  const cfg = monitorConfig(env);
  if (!cfg.enabled) { state.log.log?.('[ops-monitor] off'); return state; }
  ensureOpsMonitorSchema(db);
  const r = resolveRecipient(db, cfg);
  const ch = r.user ? ensureAlertsChannel(db, r.user) : { status: 'missing' };
  state.log.log?.(`[ops-monitor] on · recipient ${r.status} · #alerts ${ch.status} · silence ${cfg.silenceMinutes} min · webhook ${cfg.webhookMinutes} min`);
  if (opts.loop !== false) {
    state.timer = setInterval(() => { tickOpsMonitor().catch(() => {}); }, cfg.tickMs);
    state.timer.unref?.();
  }
  return state;
}

export function stopOpsMonitor() { if (state.timer) clearInterval(state.timer); state.timer = null; }

/** The admin status. No URL, key, id or email. */
export function opsMonitorStatus(db, env = process.env, now = Date.now(), deps = { pushEnabled: realPushEnabled }) {
  const cfg = monitorConfig(env);
  const base = { enabled: cfg.enabled, window: 'Mon–Fri 7:00 AM–5:00 PM MT', silence_minutes: cfg.silenceMinutes, webhook_minutes: cfg.webhookMinutes };
  if (!cfg.enabled) return base;
  const recipient = resolveRecipient(db, cfg);
  const vapid = !!deps.pushEnabled();
  const subscribed = recipient.user ? subsOf(db, recipient.user.id).length > 0 : false;
  const ch = ensureAlertsChannel(db, recipient.user, { create: false });
  const evals = evaluate(db, now, env, cfg);
  const has = tableExists(db, 'ops_monitor_incidents');
  const open = has ? db.prepare('SELECT * FROM ops_monitor_incidents WHERE recovered_at IS NULL ORDER BY id').all() : [];
  const closed = has ? db.prepare('SELECT * FROM ops_monitor_incidents WHERE recovered_at IS NOT NULL ORDER BY id DESC LIMIT 10').all() : [];
  const row = (i) => ({
    incident: i.incident_key, kind: i.kind, opened_at: i.opened_at, since: i.since_at,
    alerted_at: i.alert_at, unalerted: !i.alert_at, alert_posted: !!i.alert_message_id, alert_push: i.alert_push,
    alert_attempts: i.alert_attempts, last_alert_error: i.last_alert_error ? scrub(i.last_alert_error, env) : null,
    detail: i.detail ? scrub(i.detail, env) : null,
    recovered_at: i.recovered_at, recovery_posted: !!i.recovery_message_id, recovery_push: i.recovery_push,
  });
  const silence = evals.find(e => e.key === 'bot-silence');
  return {
    ...base,
    recipient: recipient.status,
    push_ready: { vapid_configured: vapid, phone_subscribed: subscribed, ready: vapid && subscribed },
    alerts_channel: ch.status,
    checks: Object.fromEntries(evals.map(e => [e.key, { state: e.state, ...(e.reason ? { reason: e.reason } : {}) }])),
    last_seen: silence.last ? { at: iso(silence.last.at), signal: silence.last.kind === 'token' ? 'API use' : 'post', bot: silence.last.name } : null,
    open: open.map(row),
    recent: closed.map(row),
  };
}
