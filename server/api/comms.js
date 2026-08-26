import { Router } from 'express';
import { createReadStream } from 'fs';
import multer from 'multer';
import { v4 as uuid } from 'uuid';
import { deriveUsername } from '../usernames.js';
import { getDb, logAudit } from '../db.js';
import { emitToChannel, emitChannelsChanged, emitChannelsRefresh, emitToUser } from '../realtime.js';
import { storageEnabled, putStream, presignGet, deleteObject, getObjectBuffer } from '../storage.js';
import { mediaUpload, rejectOversize, cleanupTemp, uploadErrorMessage, isVideo } from '../media.js';
import { voyageEnabled, embed, embeddingModel, vectorToBlob, blobToVector, cosineSim } from '../embeddings.js';
import { aiEnabled, summarizeChat, translateText } from '../ai.js';
import { pushEnabled, vapidPublicKey, pushToUser } from '../push.js';
import { canDeleteMessage } from '../../shared/comms-permissions.js';
import { importSlackExport, previewSlackExport } from '../slack-import.js';
import { requireRole } from '../middleware/auth.js';
import { getType } from '../qms-config.js';
import { readyDocOrigin } from '../links.js';

const router = Router();

// Uploads land on disk and are streamed to R2 — see server/media.js for why
// video can't go through the old memory-buffered path. 10 files/message; up to
// 200 MB for video, 25 MB for anything else.
const attachUpload = mediaUpload({ files: 10 }).array('files', 10);
// Multer rejects an over-limit upload by passing a MulterError to next(), which
// would otherwise surface as a bare 500. Translate it into something the
// composer can show.
const uploadFiles = (req, res, next) => attachUpload(req, res, (err) => {
  if (err) return res.status(413).json({ error: uploadErrorMessage(err) });
  next();
});
// Slack export .zip can be large; buffer in memory up to 300 MB.
const zipUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 300 * 1024 * 1024, files: 1 } });

// Feature flags for the client (uploads / semantic / ask require optional config).
router.get('/status', (_req, res) => {
  res.json({ storage: storageEnabled(), semantic: voyageEnabled(), ask: aiEnabled() && voyageEnabled(), translate: aiEnabled(), push: pushEnabled() });
});

// ── Web push subscriptions (Phase 5d) ─────────────────────────────────────────
router.get('/push/key', (_req, res) => res.json({ key: vapidPublicKey() }));

router.post('/push/subscribe', (req, res) => {
  if (!pushEnabled()) return res.status(503).json({ error: 'Push is not configured on this server.' });
  const s = req.body?.subscription || req.body;
  if (!s?.endpoint || !s?.keys?.p256dh || !s?.keys?.auth) return res.status(400).json({ error: 'Invalid subscription' });
  const db = getDb();
  // Record the VAPID key this subscription was created under. If the server's
  // keys ever change, these rows are the only way to tell a live subscription
  // from one that can never be delivered again.
  db.prepare(`INSERT INTO chat_push_subscriptions (id, user_id, endpoint, p256dh, auth, vapid_key, user_agent)
              VALUES (?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh,
                auth = excluded.auth, vapid_key = excluded.vapid_key, user_agent = excluded.user_agent,
                last_error = NULL, last_error_at = NULL`)
    .run(uuid(), req.user.id, s.endpoint, s.keys.p256dh, s.keys.auth,
      vapidPublicKey(), (req.headers['user-agent'] || '').slice(0, 300));
  res.json({ ok: true });
});

// How many devices this account has registered, and how each one is actually
// doing — surfaced in the notification status panel so "why isn't my phone
// buzzing?" has a visible answer rather than a guess.
router.get('/push/status', (req, res) => {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM chat_push_subscriptions WHERE user_id = ? ORDER BY created_at').all(req.user.id);
  const current = vapidPublicKey();
  res.json({
    enabled: pushEnabled(),
    count: rows.length,
    devices: rows.map(r => ({
      created_at: r.created_at,
      last_success_at: r.last_success_at,
      last_error: r.last_error,
      last_error_at: r.last_error_at,
      // A subscription made under an older key can never be delivered to.
      stale_key: !!(current && r.vapid_key && r.vapid_key !== current),
      device: deviceLabel(r.user_agent),
    })),
  });
});

// Rough device label from the user-agent — enough to tell someone's phone from
// their desktop in the status panel.
function deviceLabel(ua = '') {
  if (/iPhone|iPad|iPod/i.test(ua)) return 'iPhone / iPad';
  if (/Android/i.test(ua)) return 'Android';
  if (/Windows/i.test(ua)) return 'Windows';
  if (/Mac OS X/i.test(ua)) return 'Mac';
  return 'Unknown device';
}

// Admin view of push health across everyone. "Some people aren't getting
// notifications" is otherwise unanswerable without shell access to the server.
router.get('/push/diagnostics', requireRole('admin'), (req, res) => {
  const db = getDb();
  const current = vapidPublicKey();
  const rows = db.prepare(`
    SELECT s.*, u.name, u.username FROM chat_push_subscriptions s
    JOIN users u ON u.id = s.user_id ORDER BY u.name, s.created_at
  `).all();
  const byUser = new Map();
  for (const r of rows) {
    const entry = byUser.get(r.user_id)
      || { user_id: r.user_id, name: shortNameOf(r), devices: [] };
    entry.devices.push({
      device: deviceLabel(r.user_agent),
      created_at: r.created_at,
      last_success_at: r.last_success_at,
      last_error: r.last_error,
      last_error_at: r.last_error_at,
      stale_key: !!(current && r.vapid_key && r.vapid_key !== current),
      // Subscriptions predating this bookkeeping have no key recorded; they're
      // not necessarily broken, just unverifiable until their next send.
      unknown_key: !r.vapid_key,
    });
    byUser.set(r.user_id, entry);
  }
  // Everyone active with no subscription at all — the most common reason for
  // "I get nothing", and invisible from the subscriptions table alone.
  const withSubs = new Set(rows.map(r => r.user_id));
  const noDevices = db.prepare('SELECT id, name, username FROM users WHERE is_active = 1 ORDER BY name').all()
    .filter(u => !withSubs.has(u.id))
    .map(u => ({ user_id: u.id, name: shortNameOf(u) }));

  res.json({
    enabled: pushEnabled(),
    vapid_key_set: !!current,
    users: [...byUser.values()],
    no_devices: noDevices,
  });
});

// Self-test: push to the caller's own devices.
router.post('/push/test', async (req, res) => {
  if (!pushEnabled()) return res.status(503).json({ error: 'Push is not configured on this server.' });
  const count = getDb().prepare('SELECT COUNT(*) c FROM chat_push_subscriptions WHERE user_id = ?').get(req.user.id).c;
  if (!count) return res.status(400).json({ error: 'No devices are subscribed on your account yet.' });
  await pushToUser(req.user.id, {
    title: 'ReadyDoc test', body: 'Notifications are working on this device.',
    tag: 'readydoc-test', renotify: true, url: '/',
  });
  res.json({ ok: true, devices: count });
});

router.post('/push/unsubscribe', (req, res) => {
  const endpoint = req.body?.endpoint;
  if (endpoint) getDb().prepare('DELETE FROM chat_push_subscriptions WHERE endpoint = ? AND user_id = ?').run(endpoint, req.user.id);
  res.json({ ok: true });
});

// ── Embeddings (Phase 4) ──────────────────────────────────────────────────────
// Store/refresh a message's embedding (fire-and-forget from write paths).
async function embedMessage(db, messageId, channelId, body) {
  if (!voyageEnabled() || !body || !body.trim()) return;
  try {
    const [vec] = await embed(body.slice(0, 8000), 'document');
    if (!vec) return;
    db.prepare(`INSERT INTO chat_message_embeddings (message_id, channel_id, model, dim, vector)
                VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(message_id) DO UPDATE SET model=excluded.model, dim=excluded.dim, vector=excluded.vector, created_at=datetime('now')`)
      .run(messageId, channelId, embeddingModel(), vec.length, vectorToBlob(vec));
  } catch (e) { console.warn('[comms] embed failed:', e.message); }
}

// One-time background backfill of messages missing an embedding. Idempotent and
// batched; safe to call on every startup (no-op once caught up / when disabled).
export async function backfillEmbeddings() {
  if (!voyageEnabled()) return;
  const db = getDb();
  const pending = db.prepare(`SELECT m.id, m.channel_id, m.body FROM chat_messages m
    LEFT JOIN chat_message_embeddings e ON e.message_id = m.id
    WHERE e.message_id IS NULL AND m.body IS NOT NULL AND m.deleted_at IS NULL`).all();
  if (!pending.length) return;
  console.log(`[comms] backfilling ${pending.length} message embedding(s)…`);
  const BATCH = 64;
  for (let i = 0; i < pending.length; i += BATCH) {
    const slice = pending.slice(i, i + BATCH);
    try {
      const vecs = await embed(slice.map(m => m.body.slice(0, 8000)), 'document');
      const ins = db.prepare(`INSERT OR REPLACE INTO chat_message_embeddings (message_id, channel_id, model, dim, vector) VALUES (?, ?, ?, ?, ?)`);
      const tx = db.transaction((rows) => { rows.forEach(([m, v]) => ins.run(m.id, m.channel_id, embeddingModel(), v.length, vectorToBlob(v))); });
      tx(slice.map((m, j) => [m, vecs[j]]).filter(([, v]) => v));
    } catch (e) { console.warn('[comms] backfill batch failed:', e.message); break; }
  }
  console.log('[comms] embedding backfill complete');
}

// ── Access layer (the security foundation) ────────────────────────────────────
// Public channels are visible to everyone; private channels and DMs are visible
// only to their members. Every read/write goes through canAccess().
function getChannel(db, id) {
  return db.prepare('SELECT * FROM chat_channels WHERE id = ? AND archived = 0').get(id);
}
// Admin lookups need archived channels too.
function getChannelAny(db, id) {
  return db.prepare('SELECT * FROM chat_channels WHERE id = ?').get(id);
}
function isMember(db, channelId, userId) {
  return !!db.prepare('SELECT 1 FROM chat_channel_members WHERE channel_id = ? AND user_id = ?').get(channelId, userId);
}
// The caller's role within a channel ('owner' | 'member' | null). Group/private
// channels let their owner self-manage members and rename, without platform admin.
function channelRole(db, channelId, userId) {
  const row = db.prepare('SELECT role FROM chat_channel_members WHERE channel_id = ? AND user_id = ?').get(channelId, userId);
  return row?.role || null;
}
// Access model: admins can reach every channel (to administer). Everyone else
// only sees channels they're a member of — public no longer means "everyone",
// so operators are confined to the channels they've been added to (their dept +
// the auto-joined default channels). Membership is the single gate.
function canAccess(db, channel, userId, isAdmin = false) {
  if (!channel) return false;
  if (isAdmin) return true;
  return isMember(db, channel.id, userId);
}
// Resolve a channel and enforce access in one step; sends 404 if not allowed
// (channels a user can't see are hidden, not "forbidden", to avoid leaking existence).
function requireChannel(req, res) {
  const db = getDb();
  const channel = getChannel(db, req.params.id || req.params.channelId);
  // "View as" previews never open direct messages — an admin previewing a
  // user's workspace sees their channels, not their private conversations.
  if (!channel || (req.impersonated && channel.kind === 'dm') ||
      !canAccess(db, channel, req.user.id, req.user.role === 'admin')) {
    res.status(404).json({ error: 'Channel not found' });
    return null;
  }
  return channel;
}

// What a person is called in chat: the short first + last form, same as their
// sign-in name. The full legal name stays on records, signatures and the audit
// log — chat is conversation, not a compliance record, and "Gaston Antonio
// Perez Quintanilla" on every line is noise.
function userName(db, id) {
  const u = db.prepare('SELECT name, username FROM users WHERE id = ?').get(id);
  if (!u) return 'Unknown';
  return u.username || deriveUsername(u.name) || u.name;
}
const shortNameOf = (u) => u?.username || deriveUsername(u?.name) || u?.name || '';

// ── Mentions ──────────────────────────────────────────────────────────────────
// Users who can be @mentioned in a channel are its members — a mention should
// never notify someone who can't see the channel. (Now that public channels are
// membership-gated too, this is uniform across kinds.)
function mentionCandidates(db, channel) {
  return db.prepare('SELECT u.id, u.name, u.username FROM chat_channel_members m JOIN users u ON u.id = m.user_id WHERE m.channel_id = ? AND u.is_active = 1').all(channel.id);
}
// Match "@<display name>" occurrences (autocomplete inserts full names, which may
// contain spaces). Longest names first so "@Ann Marie" wins over "@Ann".
function extractMentions(db, channel, body, authorId) {
  if (!body || !body.includes('@')) return [];
  const lower = body.toLowerCase();
  // Match the short chat name AND the full name: the composer inserts the short
  // one now, but messages written before that still carry the full name and
  // must keep resolving. Longest form first so "@Ann Marie" beats "@Ann".
  const forms = (u) => [...new Set([shortNameOf(u), u.name].filter(Boolean))]
    .sort((a, b) => b.length - a.length);
  return mentionCandidates(db, channel)
    .filter(u => u.id !== authorId)
    .map(u => ({ u, longest: forms(u)[0] || '' }))
    .sort((a, b) => b.longest.length - a.longest.length)
    .filter(({ u }) => forms(u).some(f => lower.includes('@' + f.toLowerCase())))
    .map(({ u }) => u);
}
// True when the body contains a channel-wide broadcast mention (@channel/@here/
// @everyone), which notifies every member rather than named individuals.
function hasBroadcast(body) {
  return /(^|\s)@(channel|here|everyone)\b/i.test(body || '');
}
// Record mentions for a message and push a targeted event to each recipient.
// @channel / @here / @everyone notify every member of the channel; otherwise
// only the individually-named members are notified.
function recordMentions(db, channel, messageId, body, author) {
  let recipients;
  if (hasBroadcast(body)) {
    recipients = db.prepare('SELECT u.id, u.name FROM chat_channel_members m JOIN users u ON u.id = m.user_id WHERE m.channel_id = ? AND u.is_active = 1 AND u.id != ?').all(channel.id, author.id);
  } else {
    recipients = extractMentions(db, channel, body, author.id);
  }
  if (!recipients.length) return [];
  const ins = db.prepare('INSERT INTO chat_mentions (id, message_id, channel_id, user_id) VALUES (?, ?, ?, ?)');
  const label = channel.kind === 'public' ? `#${channel.name}` : (channel.name || 'a channel');
  const broadcast = hasBroadcast(body);
  for (const u of recipients) {
    ins.run(uuid(), messageId, channel.id, u.id);
    const fromName = shortNameOf(author) || author.name;
    emitToUser(u.id, 'mention', { channel_id: channel.id, message_id: messageId, from: fromName, preview: body.slice(0, 140), broadcast });
    const title = broadcast ? `${fromName} notified ${label}` : `${fromName} mentioned you in ${label}`;
    // Mentions re-alert (renotify) — they're higher priority than a normal message.
    pushToUser(u.id, { title, body: body.slice(0, 140), tag: `mention-${messageId}`, renotify: true, url: `/?c=${channel.id}&m=${messageId}` }).catch(() => {});
  }
  return recipients.map(u => u.id);
}

// Debounce window: at most one channel push per person+channel in this span, so
// a burst of messages coalesces into one (tag-collapsed) alert instead of a
// buzz per message. In-memory is fine on a single instance.
// Rapid messages in one channel are coalesced rather than dropped: the first
// pushes immediately, and anything arriving inside the window schedules ONE
// trailing "catch-up" push at the end of it. (The old behavior skipped those
// pushes entirely, so a second message ~20 s after the first silently never
// notified — the "I'm getting messages but no notification" bug.)
const PUSH_COALESCE_MS = 20000;
const lastChannelPushAt = new Map();  // `${userId}:${channelId}` -> epoch ms
const pendingTrailing = new Map();    // `${userId}:${channelId}` -> timeout handle

// Thread replies are deliberately NOT counted here. A reply buried three levels
// down a conversation from Tuesday isn't "the channel has something new" — it
// belongs to that thread, and counting it in the channel is what made a reply
// look like a fresh channel message and drop the reader at the bottom of the
// channel instead of in the thread. Replies are counted by threadUnread().
function channelUnread(db, channelId, userId) {
  const m = db.prepare('SELECT last_read_at, deliberate_unread FROM chat_channel_members WHERE channel_id = ? AND user_id = ?').get(channelId, userId);
  const lr = m?.last_read_at || null;
  // Own messages never count as unread — EXCEPT past a deliberate mark, or a
  // message you authored yourself (a forwarded request) could never be marked.
  const own = m?.deliberate_unread ? 1 : 0;
  return db.prepare(
    `SELECT COUNT(*) n FROM chat_messages WHERE channel_id = ? AND deleted_at IS NULL AND (user_id != ? OR ? = 1)
     AND parent_id IS NULL AND (? IS NULL OR created_at > ?)`
  ).get(channelId, userId, own, lr, lr).n;
}

// Threads behave like their own channel: each one is read or unread on its own,
// tracked per person in chat_thread_reads.
//
// The baseline matters. If someone has never opened a particular thread there's
// no chat_thread_reads row, and counting *every* reply that isn't theirs made a
// long or Slack-imported thread read as hundreds of "new" — the phantom "huge
// number" bug. So when there's no per-thread mark, fall back to when they last
// read the channel: replies they'd already scrolled past there aren't new, and
// only replies since they last caught up count. Opening the thread writes a
// chat_thread_reads row, which then takes precedence.
// SQL fragment: does this row (aliased however the caller aliases chat_messages)
// @mention $me? Used to give mentions their own read rule below.
const MENTIONS_ME = (alias) =>
  `EXISTS (SELECT 1 FROM chat_mentions mx WHERE mx.message_id = ${alias}.id AND mx.user_id = $me)`;

/**
 * The two read markers a thread reply can be measured against.
 *
 * `thread` is the per-thread row; `effective` falls back to the channel's, which
 * is what stops a thread you never opened from counting its entire imported
 * history as unread.
 */
function threadMarkers(db, parentId, userId) {
  const row = db.prepare('SELECT last_read_at, deliberate_unread FROM chat_thread_reads WHERE parent_id = ? AND user_id = ?')
    .get(parentId, userId);
  const thread = row?.last_read_at || null;
  let channel = null;
  const parent = db.prepare('SELECT channel_id FROM chat_messages WHERE id = ?').get(parentId);
  if (parent) {
    channel = db.prepare('SELECT last_read_at FROM chat_channel_members WHERE channel_id = ? AND user_id = ?')
      .get(parent.channel_id, userId)?.last_read_at || null;
  }
  return { thread, effective: thread || channel, deliberate: row?.deliberate_unread ? 1 : 0 };
}

/**
 * The read marker one Activity item is measured against.
 *
 * Deliberately the same rule the badges use, so the feed and the sidebar can
 * never disagree: channel marker for a top-level message, thread marker for a
 * reply — and for a reply that mentions you, the thread marker *only*, with no
 * fall back to the channel.
 */
function activityMarker(db, { parentId, channelId, isMention }, userId) {
  if (!parentId) {
    return db.prepare('SELECT last_read_at FROM chat_channel_members WHERE channel_id = ? AND user_id = ?')
      .get(channelId, userId)?.last_read_at || null;
  }
  const { thread, effective } = threadMarkers(db, parentId, userId);
  return isMention ? thread : effective;
}

/**
 * Unread replies in one thread.
 *
 * Two different rules, on purpose:
 *  - An ordinary reply is measured against `effective` — the per-thread marker
 *    if there is one, otherwise the channel's. Catching up on the channel
 *    catches you up on chatter you were never named in, which is what keeps a
 *    thread you've never opened from reporting hundreds of unread replies.
 *  - **A reply that @mentions you is measured against the thread marker ALONE.**
 *    It is addressed to you personally, and reading the rest of the channel is
 *    not an acknowledgement of it. Before this, someone could @ you inside a
 *    thread and the mention would clear itself the moment you opened the
 *    channel — off the thread badge, off the channel's @ badge and out of
 *    Activity, without you ever seeing it.
 */
function threadUnread(db, parentId, userId) {
  const { thread, effective, deliberate } = threadMarkers(db, parentId, userId);
  // Own replies never count — except past a deliberate mark, same carve-out as
  // channelUnread, or a reply you wrote yourself could never be marked.
  return db.prepare(
    `SELECT COUNT(*) n FROM chat_messages m
     WHERE m.parent_id = $parent AND m.deleted_at IS NULL AND (m.user_id != $me OR $own = 1)
       AND CASE WHEN ${MENTIONS_ME('m')}
                THEN ($thread IS NULL OR m.created_at > $thread)
                ELSE ($effective IS NULL OR m.created_at > $effective) END`
  ).get({ parent: parentId, me: userId, thread, effective, own: deliberate }).n;
}

// Push a normal channel message to every member (except the author and anyone
// already @mentioned/DM'd). Grouped per channel via a stable tag so the phone
// shows ONE notification per channel that updates with a running count, and
// debounced so rapid messages don't each buzz.
function notifyChannelMessage(db, channel, body, author, excludeUserIds = [], messageId = null) {
  if (!pushEnabled() || !body || channel.kind === 'dm') return;
  const exclude = new Set([author.id, ...excludeUserIds]);
  const members = db.prepare(
    'SELECT u.id FROM chat_channel_members m JOIN users u ON u.id = m.user_id WHERE m.channel_id = ? AND u.is_active = 1'
  ).all(channel.id);
  const label = channel.kind === 'public' ? `#${channel.name}` : (channel.name || 'Channel');
  const now = Date.now();
  // Deep-link to the triggering message so a tap lands on it, not just the channel.
  const url = messageId ? `/?c=${channel.id}&m=${messageId}` : `/?c=${channel.id}`;
  // Build + send the notification for one member from their CURRENT unread
  // state, so a trailing push reflects everything that landed meanwhile.
  const sendFor = (uid) => {
    const n = channelUnread(db, channel.id, uid);
    if (n === 0) return; // they read it in the meantime — don't buzz for nothing
    const from = shortNameOf(author);
    const summary = n > 1
      ? `${n} new · ${from}: ${body.slice(0, 80)}`
      : `${from}: ${body.slice(0, 120)}`;
    pushToUser(uid, { title: label, body: summary, tag: `channel-${channel.id}`, renotify: true, url }).catch(() => {});
  };

  for (const { id: uid } of members) {
    if (exclude.has(uid)) continue;
    const key = `${uid}:${channel.id}`;
    const since = now - (lastChannelPushAt.get(key) || 0);
    if (since >= PUSH_COALESCE_MS) {
      lastChannelPushAt.set(key, now);
      sendFor(uid);
    } else if (!pendingTrailing.has(key)) {
      // Inside the window: queue exactly one catch-up push for when it closes.
      const wait = PUSH_COALESCE_MS - since;
      const handle = setTimeout(() => {
        pendingTrailing.delete(key);
        lastChannelPushAt.set(key, Date.now());
        try { sendFor(uid); } catch { /* best effort */ }
      }, wait);
      handle.unref?.();
      pendingTrailing.set(key, handle);
    }
  }
}

// Post a message into a channel as `author`, reusing the normal create path
// (socket emit, unread bump, grouped push, embedding). Used by other modules —
// e.g. the production schedule publishing per-team updates. Best-effort: callers
// should catch. Returns the created message. `getChannelByName` finds the target.
export function getChannelByName(db, name) {
  const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const want = norm(name);
  const rows = db.prepare("SELECT * FROM chat_channels WHERE kind IN ('public','private') AND (archived IS NULL OR archived = 0)").all();
  return rows.find(c => norm(c.name) === want) || null;
}
export async function postMessageAs(db, channel, author, body, parentId = null) {
  const text = String(body || '').trim();
  if (!channel || !text) return null;
  const id = uuid();
  const now = db.prepare("SELECT strftime('%Y-%m-%d %H:%M:%f','now') AS t").get().t;
  db.prepare('INSERT INTO chat_messages (id, channel_id, user_id, body, parent_id, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(id, channel.id, author.id, text, parentId, now);
  db.prepare("UPDATE chat_channels SET updated_at = datetime('now') WHERE id = ?").run(channel.id);
  db.prepare("UPDATE chat_channel_members SET last_read_at = ? WHERE channel_id = ? AND user_id = ?").run(now, channel.id, author.id);
  const message = await serialize(db, db.prepare('SELECT * FROM chat_messages WHERE id = ?').get(id));
  emitToChannel(channel.id, 'message:new', message);
  emitChannelsChanged(db, channel);
  // @mentions in system-posted messages (issue alerts, schedule updates) notify
  // like any other mention.
  const mentioned = recordMentions(db, channel, id, text, author);
  notifyChannelMessage(db, channel, text, author, mentioned, id);
  embedMessage(db, id, channel.id, text);
  return message;
}

// ── ReadyBot ─────────────────────────────────────────────────────────────────
// The house bot account used for hygiene nudges, digests, and job notices.
// Login-less (no password/PIN) and hidden from mention pools by simply never
// being a channel member.
export function getBotUser(db) {
  let bot = db.prepare("SELECT * FROM users WHERE name = 'ReadyBot' LIMIT 1").get();
  if (!bot) {
    const id = uuid();
    db.prepare("INSERT INTO users (id, name, role, department, is_active, module_access) VALUES (?, 'ReadyBot', 'operator', 'office', 1, '{}')").run(id);
    bot = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  }
  return bot;
}

// Channel-hygiene rules: gentle, threaded nudges that keep the right info in
// the right place (e.g. "I'm running late" belongs with a supervisor + Time
// Tracking, not #general). Conservative on purpose — false nudges are worse
// than missed ones. Public channels only; the bot never nudges itself.
const HYGIENE_RULES = [
  {
    match: /\b(running late|be late|late today|gonna be late|call(ing)? (in|out)|out sick|sick today|feeling sick|can'?t (make it|come in)|no.?call.?no.?show)\b/i,
    skipChannels: /time|office/i,
    reply: '👋 Heads up: lates and absences should go to your supervisor directly — they log it in Time Tracking (Requests → Time Tracking) so it\'s recorded. That keeps this channel clean and makes sure nothing is missed.',
  },
  {
    match: /\b(broken|not working|won'?t (start|turn on|run)|jammed|leaking|stopped working|down again)\b/i,
    onlyChannels: /^general$/i,
    reply: '🔧 Equipment problem? Flag it on the task in the Task Center or report it as an issue so maintenance sees it, it\'s prioritized, and it\'s tracked — a message in #general can get missed.',
  },
];
function channelHygiene(db, channel, message, author) {
  if (!message?.body || channel.kind === 'dm' || message.parent_id) return;
  if (author?.name === 'ReadyBot') return;
  for (const rule of HYGIENE_RULES) {
    if (rule.skipChannels && rule.skipChannels.test(channel.name || '')) continue;
    if (rule.onlyChannels && !rule.onlyChannels.test(channel.name || '')) continue;
    if (!rule.match.test(message.body)) continue;
    const bot = getBotUser(db);
    postMessageAs(db, channel, bot, rule.reply, message.id).catch(() => {});
    return; // one nudge max
  }
}

// ── Channels ──────────────────────────────────────────────────────────────────
// List channels the user can see: all public + private/DMs they belong to, each
// with an unread count and (for DMs) the other participant's name.
router.get('/channels', (req, res) => {
  const db = getDb();
  const me = req.user.id;
  // Everyone — admins included — only sees channels they belong to, so admins
  // aren't buried under every channel. Channel administration (all channels)
  // happens through GET /admin/channels + the Comms settings panel instead.
  let rows = db.prepare(`
    SELECT c.*, m.last_read_at, m.deliberate_unread, m.id AS membership_id
    FROM chat_channels c
    LEFT JOIN chat_channel_members m ON m.channel_id = c.id AND m.user_id = ?
    WHERE c.archived = 0 AND m.user_id IS NOT NULL
    ORDER BY c.is_default DESC, c.sort_order, c.kind, c.name
  `).all(me);
  // "View as" preview: hide the previewed user's direct messages entirely.
  if (req.impersonated) rows = rows.filter(c => c.kind !== 'dm');

  const out = rows.map(c => {
    // Only channels you've actually joined get an unread count. Admins can SEE
    // every channel, but a channel they never joined shouldn't dump its whole
    // (imported) history on them as unread.
    // parent_id IS NULL: thread replies belong to Threads, not to the channel.
    // Keep this in step with channelUnread() — including the deliberate_unread
    // carve-out that lets a mark-unread count the caller's own messages.
    const unread = !c.membership_id ? 0 : db.prepare(
      `SELECT COUNT(*) n FROM chat_messages WHERE channel_id = ? AND deleted_at IS NULL AND (user_id != ? OR ? = 1)
       AND parent_id IS NULL AND (? IS NULL OR created_at > ?)`
    ).get(c.id, me, c.deliberate_unread ? 1 : 0, c.last_read_at, c.last_read_at).n;
    // Unread @mentions of me in this channel (drives a distinct badge).
    //
    // A mention on a thread reply is measured against that THREAD's read row,
    // not the channel's — same rule as threadUnread(). Otherwise opening the
    // channel silently cleared the @ badge for a mention buried in a thread you
    // never opened, and the one message actually addressed to you was the one
    // you never saw. A mention on a top-level message still clears normally:
    // reading the channel is reading it.
    const mentions = db.prepare(
      `SELECT COUNT(*) n FROM chat_mentions mn JOIN chat_messages msg ON msg.id = mn.message_id
       WHERE mn.channel_id = $c AND mn.user_id = $me AND msg.deleted_at IS NULL
       AND CASE WHEN msg.parent_id IS NULL
                THEN ($read IS NULL OR msg.created_at > $read)
                ELSE (SELECT last_read_at FROM chat_thread_reads tr
                       WHERE tr.parent_id = msg.parent_id AND tr.user_id = $me) IS NULL
                     OR msg.created_at > (SELECT last_read_at FROM chat_thread_reads tr
                       WHERE tr.parent_id = msg.parent_id AND tr.user_id = $me) END`
    ).get({ c: c.id, me, read: c.last_read_at }).n;

    // Most recent message time — lets the client sort channels by activity.
    const lastActivity = db.prepare(
      'SELECT MAX(created_at) t FROM chat_messages WHERE channel_id = ? AND deleted_at IS NULL'
    ).get(c.id).t || null;

    let display = c.name, other = null;
    if (c.kind === 'dm') {
      const others = db.prepare('SELECT user_id FROM chat_channel_members WHERE channel_id = ? AND user_id != ?').all(c.id, me);
      other = others[0]?.user_id || me;
      // 1:1 → the other person; group DM → all other participants' names.
      display = others.length ? others.map(o => userName(db, o.user_id)).join(', ') : userName(db, me);
    }
    return {
      id: c.id, kind: c.kind, name: display, topic: c.topic,
      is_member: !!c.membership_id, unread, mentions, other_user_id: other,
      post_policy: c.post_policy || 'all', is_default: !!c.is_default,
      section_id: c.section_id || null, sort_order: c.sort_order || 0,
      last_activity: lastActivity,
      // Where the reader left off — drives the "New" divider line client-side.
      last_read_at: c.last_read_at || null,
    };
  });
  res.json(out);
});

router.post('/channels', (req, res) => {
  const db = getDb();
  const { name, kind, topic, member_ids } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'Channel name is required' });
  const k = kind === 'private' ? 'private' : 'public';
  const id = uuid();
  const clean = name.trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
  db.prepare('INSERT INTO chat_channels (id, kind, name, topic, created_by) VALUES (?, ?, ?, ?, ?)')
    .run(id, k, clean || name.trim(), topic || null, req.user.id);
  const addMember = db.prepare('INSERT OR IGNORE INTO chat_channel_members (id, channel_id, user_id, role) VALUES (?, ?, ?, ?)');
  addMember.run(uuid(), id, req.user.id, 'owner');
  if (Array.isArray(member_ids)) for (const uid of member_ids) if (uid !== req.user.id) addMember.run(uuid(), id, uid, 'member');
  const created = getChannel(db, id);
  emitChannelsChanged(db, created);
  res.status(201).json(created);
});

router.get('/channels/:id', (req, res) => {
  const db = getDb();
  // Admins can inspect any channel's roster (for settings); everyone else is
  // limited to channels they can access.
  const channel = req.user.role === 'admin' ? getChannelAny(db, req.params.id) : requireChannel(req, res);
  if (!channel) { if (req.user.role === 'admin') res.status(404).json({ error: 'Channel not found' }); return; }
  const members = db.prepare(`
    SELECT m.user_id, m.role, u.name, u.username FROM chat_channel_members m JOIN users u ON u.id = m.user_id WHERE m.channel_id = ? ORDER BY u.name
  `).all(channel.id);
  res.json({ ...channel, members });
});

router.post('/channels/:id/members', (req, res) => {
  const db = getDb();
  // Members can invite; admins can manage membership of any channel (including
  // ones they haven't joined) so channel administration works from settings.
  const channel = req.user.role === 'admin'
    ? getChannelAny(db, req.params.id)
    : requireChannel(req, res);
  if (!channel) { if (req.user.role === 'admin') res.status(404).json({ error: 'Channel not found' }); return; }
  const ids = Array.isArray(req.body?.user_ids) ? req.body.user_ids : [];
  const add = db.prepare('INSERT OR IGNORE INTO chat_channel_members (id, channel_id, user_id, role) VALUES (?, ?, ?, ?)');
  let added = 0;
  for (const uid of ids) added += add.run(uuid(), channel.id, uid, 'member').changes;
  if (added) emitChannelsChanged(db, channel);
  res.json({ added });
});

// Admin roster of every channel (incl. private & archived) with member counts,
// for the comms settings screen. DMs are excluded — they aren't managed here.
router.get('/admin/channels', requireRole('admin'), (req, res) => {
  const db = getDb();
  const rows = db.prepare(`
    SELECT c.id, c.kind, c.name, c.topic, c.archived, c.created_at, c.post_policy, c.is_default, c.section_id, c.sort_order,
      (SELECT COUNT(*) FROM chat_channel_members m WHERE m.channel_id = c.id) AS member_count,
      (SELECT COUNT(*) FROM chat_messages msg WHERE msg.channel_id = c.id AND msg.deleted_at IS NULL) AS message_count,
      (SELECT MAX(created_at) FROM chat_messages msg WHERE msg.channel_id = c.id AND msg.deleted_at IS NULL) AS last_activity,
      (SELECT COUNT(*) FROM chat_messages msg WHERE msg.channel_id = c.id AND msg.deleted_at IS NULL AND msg.created_at >= datetime('now','-30 days')) AS recent_count
    FROM chat_channels c
    WHERE c.kind != 'dm'
    ORDER BY c.is_default DESC, c.archived, c.sort_order, c.kind, c.name`).all();
  res.json(rows);
});

// ── Sidebar sections (admin-defined channel groupings) ────────────────────────
router.get('/sections', (req, res) => {
  const db = getDb();
  res.json(db.prepare('SELECT id, name, sort_order FROM chat_sections ORDER BY sort_order, name').all());
});
router.post('/sections', requireRole('admin'), (req, res) => {
  const db = getDb();
  const name = (req.body?.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Section name is required' });
  const id = uuid();
  const next = (db.prepare('SELECT MAX(sort_order) m FROM chat_sections').get().m ?? -1) + 1;
  db.prepare('INSERT INTO chat_sections (id, name, sort_order) VALUES (?, ?, ?)').run(id, name, next);
  emitChannelsRefresh();
  res.status(201).json(db.prepare('SELECT id, name, sort_order FROM chat_sections WHERE id = ?').get(id));
});
router.put('/sections/:id', requireRole('admin'), (req, res) => {
  const db = getDb();
  const s = db.prepare('SELECT * FROM chat_sections WHERE id = ?').get(req.params.id);
  if (!s) return res.status(404).json({ error: 'Not found' });
  const name = req.body?.name !== undefined ? String(req.body.name).trim() || s.name : s.name;
  db.prepare("UPDATE chat_sections SET name = ? WHERE id = ?").run(name, s.id);
  emitChannelsRefresh();
  res.json(db.prepare('SELECT id, name, sort_order FROM chat_sections WHERE id = ?').get(s.id));
});
// Reorder sections: body { order: [sectionId, …] } sets sort_order by index.
router.post('/sections/reorder', requireRole('admin'), (req, res) => {
  const db = getDb();
  const order = Array.isArray(req.body?.order) ? req.body.order : [];
  const upd = db.prepare('UPDATE chat_sections SET sort_order = ? WHERE id = ?');
  db.transaction(() => order.forEach((id, i) => upd.run(i, id)))();
  emitChannelsRefresh();
  res.json({ ok: true });
});
router.delete('/sections/:id', requireRole('admin'), (req, res) => {
  const db = getDb();
  db.prepare('UPDATE chat_channels SET section_id = NULL WHERE section_id = ?').run(req.params.id);
  db.prepare('DELETE FROM chat_sections WHERE id = ?').run(req.params.id);
  emitChannelsRefresh();
  res.json({ ok: true });
});
// Assign a channel to a section and/or set its order within the section.
router.put('/channels/:id/section', requireRole('admin'), (req, res) => {
  const db = getDb();
  const channel = getChannelAny(db, req.params.id);
  if (!channel) return res.status(404).json({ error: 'Channel not found' });
  const sectionId = req.body?.section_id || null;
  if (sectionId && !db.prepare('SELECT 1 FROM chat_sections WHERE id = ?').get(sectionId)) return res.status(400).json({ error: 'Unknown section' });
  const sortOrder = Number.isInteger(req.body?.sort_order) ? req.body.sort_order : channel.sort_order;
  db.prepare("UPDATE chat_channels SET section_id = ?, sort_order = ?, updated_at = datetime('now') WHERE id = ?").run(sectionId, sortOrder, channel.id);
  emitChannelsRefresh();
  res.json({ ok: true });
});
// Reorder channels within a section: body { order: [channelId, …] }.
router.post('/channels/reorder', requireRole('admin'), (req, res) => {
  const db = getDb();
  const order = Array.isArray(req.body?.order) ? req.body.order : [];
  const upd = db.prepare('UPDATE chat_channels SET sort_order = ? WHERE id = ?');
  db.transaction(() => order.forEach((id, i) => upd.run(i, id)))();
  emitChannelsRefresh();
  res.json({ ok: true });
});

// Mark every channel the caller can see as read up to now (clears their unread
// badges — handy right after a bulk history import).
router.post('/read-all', (req, res) => {
  const db = getDb();
  const me = req.user.id;
  // Must match chat_messages.created_at's format (SQLite 'YYYY-MM-DD HH:MM:SS'),
  // NOT ISO 8601 — the unread check is a string comparison (created_at >
  // last_read_at), and an ISO 'T'/'Z' value sorts wrong against the space format,
  // which is why marking read didn't clear/hold. Millisecond precision for exact ordering.
  const now = db.prepare("SELECT strftime('%Y-%m-%d %H:%M:%f','now') AS t").get().t;
  // Update existing memberships… (read-all also clears deliberate marks —
  // "mark everything read" means the bookmarks too).
  db.prepare('UPDATE chat_channel_members SET last_read_at = ?, deliberate_unread = 0 WHERE user_id = ?').run(now, me);
  // …and create read-markers for public channels the user hasn't joined yet.
  const missing = db.prepare(`SELECT c.id FROM chat_channels c
    WHERE c.kind = 'public' AND c.archived = 0
      AND NOT EXISTS (SELECT 1 FROM chat_channel_members m WHERE m.channel_id = c.id AND m.user_id = ?)`).all(me);
  const ins = db.prepare('INSERT OR IGNORE INTO chat_channel_members (id, channel_id, user_id, role, last_read_at) VALUES (?, ?, ?, ?, ?)');
  for (const c of missing) ins.run(uuid(), c.id, me, 'member', now);
  // Thread mentions are no longer cleared by reading their channel (see
  // threadUnread) — so "Mark all read" has to stamp them explicitly, or an @
  // buried in a thread would be the one badge this button can never clear.
  // Bounded by the caller's own mentions, which is a small set.
  const mentionThreads = db.prepare(`SELECT DISTINCT msg.parent_id AS parent_id
    FROM chat_mentions mn JOIN chat_messages msg ON msg.id = mn.message_id
    WHERE mn.user_id = ? AND msg.parent_id IS NOT NULL AND msg.deleted_at IS NULL`).all(me);
  const markThread = db.prepare(`INSERT INTO chat_thread_reads (user_id, parent_id, last_read_at, deliberate_unread) VALUES (?, ?, ?, 0)
    ON CONFLICT(user_id, parent_id) DO UPDATE SET last_read_at = excluded.last_read_at, deliberate_unread = 0`);
  db.transaction(() => { for (const t of mentionThreads) markThread.run(me, t.parent_id, now); })();
  res.json({ ok: true });
});

// Admin: clear the import-driven unread backlog for EVERYONE by marking all
// memberships read as of now. One-shot cleanup after a big import.
router.post('/admin/reset-unread', requireRole('admin'), (req, res) => {
  const db = getDb();
  // Millisecond precision to match chat_messages.created_at so the unread
  // comparison is exact (see the read endpoints).
  const now = db.prepare("SELECT strftime('%Y-%m-%d %H:%M:%f','now') AS t").get().t;
  // Everyone's existing memberships → read as of now (deliberate marks included
  // — this is the blunt one-shot cleanup, and it says so).
  const info = db.prepare('UPDATE chat_channel_members SET last_read_at = ?, deliberate_unread = 0').run(now);
  // Also give the calling admin read-markers for public channels they haven't
  // joined, so their own sidebar clears completely (admins see every channel).
  const me = req.user.id;
  const missing = db.prepare(`SELECT c.id FROM chat_channels c
    WHERE c.kind = 'public' AND c.archived = 0
      AND NOT EXISTS (SELECT 1 FROM chat_channel_members m WHERE m.channel_id = c.id AND m.user_id = ?)`).all(me);
  const ins = db.prepare('INSERT OR IGNORE INTO chat_channel_members (id, channel_id, user_id, role, last_read_at) VALUES (?, ?, ?, ?, ?)');
  for (const c of missing) ins.run(uuid(), c.id, me, 'member', now);
  logAudit(req.user, 'reset_unread', 'comms', null, { memberships: info.changes });
  emitChannelsRefresh();
  res.json({ ok: true, memberships: info.changes });
});

// ── Channel administration (admin only) ──────────────────────────────────────
// Rename, change privacy (public ↔ private), edit topic, or archive/unarchive.
router.put('/channels/:id', (req, res) => {
  const db = getDb();
  const channel = getChannelAny(db, req.params.id);
  if (!channel) return res.status(404).json({ error: 'Channel not found' });
  if (channel.kind === 'dm') return res.status(400).json({ error: 'Direct messages cannot be edited' });
  // Platform admins can edit any channel; a channel's owner can rename / set the
  // topic / post policy of their own group, but privacy + archive stay admin-only.
  const isAdmin = req.user.role === 'admin';
  const isOwner = channelRole(db, channel.id, req.user.id) === 'owner';
  if (!isAdmin && !isOwner) return res.status(403).json({ error: 'Only the group owner or an admin can change this' });
  const { name, kind, topic, archived, post_policy } = req.body;
  const newKind = isAdmin ? (kind === 'private' ? 'private' : kind === 'public' ? 'public' : channel.kind) : channel.kind;
  const newPolicy = post_policy === 'admins' ? 'admins' : post_policy === 'all' ? 'all' : (channel.post_policy || 'all');
  let cleanName = channel.name;
  if (name !== undefined && name !== null && String(name).trim()) {
    cleanName = String(name).trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '') || channel.name;
  }
  const newArchived = (isAdmin && archived !== undefined) ? (archived ? 1 : 0) : channel.archived;
  db.prepare(`UPDATE chat_channels SET name = ?, kind = ?, topic = ?, archived = ?, post_policy = ?, updated_at = datetime('now') WHERE id = ?`)
    .run(cleanName, newKind, topic !== undefined ? (topic || null) : channel.topic,
      newArchived, newPolicy, channel.id);
  // Making a channel private: ensure the admin who owns it stays a member so it
  // doesn't vanish from everyone. Existing members are preserved either way.
  if (newKind === 'private' && channel.kind === 'public') {
    db.prepare("INSERT OR IGNORE INTO chat_channel_members (id, channel_id, user_id, role) VALUES (?, ?, ?, 'owner')")
      .run(uuid(), channel.id, req.user.id);
  }
  emitChannelsRefresh(); // visibility set may have changed for anyone
  res.json(getChannel(db, channel.id));
});

// Archive a channel (default) or permanently purge it with ?purge=true.
router.delete('/channels/:id', requireRole('admin'), (req, res) => {
  const db = getDb();
  const channel = getChannelAny(db, req.params.id);
  if (!channel) return res.status(404).json({ error: 'Channel not found' });
  const purge = req.query.purge === 'true' || req.query.purge === '1';
  if (!purge) {
    db.prepare("UPDATE chat_channels SET archived = 1, updated_at = datetime('now') WHERE id = ?").run(channel.id);
    emitChannelsRefresh();
    return res.json({ archived: channel.id });
  }
  // Hard delete: purge attachment objects, then all child rows, then the channel.
  const atts = db.prepare(`SELECT a.storage_key FROM chat_attachments a
    JOIN chat_messages m ON m.id = a.message_id WHERE m.channel_id = ?`).all(channel.id);
  const purgeTx = db.transaction(() => {
    db.prepare(`DELETE FROM chat_attachments WHERE message_id IN (SELECT id FROM chat_messages WHERE channel_id = ?)`).run(channel.id);
    db.prepare(`DELETE FROM chat_message_embeddings WHERE message_id IN (SELECT id FROM chat_messages WHERE channel_id = ?)`).run(channel.id);
    db.prepare(`DELETE FROM chat_message_translations WHERE message_id IN (SELECT id FROM chat_messages WHERE channel_id = ?)`).run(channel.id);
    db.prepare(`DELETE FROM chat_mentions WHERE message_id IN (SELECT id FROM chat_messages WHERE channel_id = ?)`).run(channel.id);
    db.prepare(`DELETE FROM chat_reactions WHERE message_id IN (SELECT id FROM chat_messages WHERE channel_id = ?)`).run(channel.id);
    db.prepare('DELETE FROM chat_messages WHERE channel_id = ?').run(channel.id);
    db.prepare('DELETE FROM chat_channel_members WHERE channel_id = ?').run(channel.id);
    db.prepare('DELETE FROM chat_channels WHERE id = ?').run(channel.id);
  });
  purgeTx();
  // A forwarded copy in another channel references the same stored object —
  // only delete objects nothing references any more (rows are already gone,
  // so a remaining row means a live copy elsewhere).
  const stillRef = db.prepare('SELECT 1 FROM chat_attachments WHERE storage_key = ? LIMIT 1');
  for (const a of atts) { if (!stillRef.get(a.storage_key)) deleteObject(a.storage_key); }
  emitChannelsRefresh();
  res.json({ deleted: channel.id });
});

// Remove a member from a private/group channel. Admins manage any channel; a
// group owner can remove others; anyone can remove themselves (leave).
router.delete('/channels/:id/members/:userId', (req, res) => {
  const db = getDb();
  const channel = getChannelAny(db, req.params.id);
  if (!channel) return res.status(404).json({ error: 'Channel not found' });
  const isAdmin = req.user.role === 'admin';
  const isOwner = channelRole(db, channel.id, req.user.id) === 'owner';
  const isSelf = req.params.userId === req.user.id;
  if (!isAdmin && !isOwner && !isSelf) return res.status(403).json({ error: 'Not allowed' });
  const info = db.prepare('DELETE FROM chat_channel_members WHERE channel_id = ? AND user_id = ?').run(channel.id, req.params.userId);
  if (info.changes) emitChannelsRefresh();
  res.json({ removed: info.changes });
});

// Mark a channel read up to now.
router.post('/channels/:id/read', (req, res) => {
  const channel = requireChannel(req, res); if (!channel) return;
  const db = getDb();
  // SQLite datetime format (not ISO) so it compares correctly against
  // chat_messages.created_at in the unread query. See /read-all.
  const now = db.prepare("SELECT strftime('%Y-%m-%d %H:%M:%f','now') AS t").get().t;
  // Reading the channel is what stands a deliberate mark-unread down.
  const info = db.prepare("UPDATE chat_channel_members SET last_read_at = ?, deliberate_unread = 0 WHERE channel_id = ? AND user_id = ?").run(now, channel.id, req.user.id);
  // Public channels the user hasn't joined have no membership row — create one lazily so reads track.
  if (info.changes === 0 && channel.kind === 'public') {
    db.prepare('INSERT OR IGNORE INTO chat_channel_members (id, channel_id, user_id, role, last_read_at) VALUES (?, ?, ?, ?, ?)')
      .run(uuid(), channel.id, req.user.id, 'member', now);
  }
  // NOTE: no cross-device "dismiss" push here. Web push requires every push to
  // surface a notification; a silent one makes Android show a generic fallback
  // ("phantom") notification instead. The client clears this channel's
  // notifications locally on whichever device the channel is viewed on.
  res.json({ ok: true });
});

// Mark a specific message (and everything after it) as unread again. Sets the
// caller's last_read to just before this message, and raises deliberate_unread:
// a mark someone CHOSE has to survive two things the plain marker can't —
// the unread counts excluding your own messages (a request YOU forwarded into
// the channel would otherwise be a silent no-op to mark), and your own next
// reply advancing last_read_at past the mark. Reading the channel clears it.
router.post('/messages/:id/unread', (req, res) => {
  const db = getDb();
  const msg = db.prepare('SELECT * FROM chat_messages WHERE id = ?').get(req.params.id);
  if (!msg) return res.status(404).json({ error: 'Message not found' });
  const channel = getChannel(db, msg.channel_id);
  if (!channel || !canAccess(db, channel, req.user.id, req.user.role === 'admin')) return res.status(404).json({ error: 'Not found' });
  // A thread reply (or a parent marked from inside its thread drawer, which
  // the client says with {thread: true}) rewinds the THREAD's marker, not the
  // channel's — threads carry their own read state, and the channel marker
  // can't say "this thread needs me again".
  const threadParent = msg.parent_id || (req.body?.thread ? msg.id : null);
  if (threadParent) {
    const tprev = msg.parent_id
      ? db.prepare('SELECT MAX(created_at) t FROM chat_messages WHERE parent_id = ? AND deleted_at IS NULL AND created_at < ?')
          .get(threadParent, msg.created_at).t || '1970-01-01 00:00:00.000'
      : '1970-01-01 00:00:00.000'; // marked at the parent → the whole thread is new again
    db.prepare(`INSERT INTO chat_thread_reads (user_id, parent_id, last_read_at, deliberate_unread) VALUES (?, ?, ?, 1)
                ON CONFLICT(user_id, parent_id) DO UPDATE SET last_read_at = excluded.last_read_at, deliberate_unread = 1`)
      .run(req.user.id, threadParent, tprev);
    emitChannelsChanged(db, channel);
    return res.json({ ok: true, thread: threadParent });
  }

  // Newest message strictly before the target; a floor if it's the first.
  const prev = db.prepare('SELECT MAX(created_at) t FROM chat_messages WHERE channel_id = ? AND deleted_at IS NULL AND created_at < ?')
    .get(channel.id, msg.created_at).t || '1970-01-01 00:00:00.000';
  const info = db.prepare('UPDATE chat_channel_members SET last_read_at = ?, deliberate_unread = 1 WHERE channel_id = ? AND user_id = ?').run(prev, channel.id, req.user.id);
  if (info.changes === 0 && channel.kind === 'public') {
    db.prepare('INSERT OR IGNORE INTO chat_channel_members (id, channel_id, user_id, role, last_read_at, deliberate_unread) VALUES (?, ?, ?, ?, ?, 1)')
      .run(uuid(), channel.id, req.user.id, 'member', prev);
  }
  emitChannelsChanged(db, channel);
  res.json({ ok: true });
});

// ── Direct messages ───────────────────────────────────────────────────────────
// Get-or-create the 1:1 DM channel between the caller and another user.
router.post('/dm/:userId', (req, res) => {
  const db = getDb();
  const other = req.params.userId;
  if (other === req.user.id) return res.status(400).json({ error: 'Cannot DM yourself' });
  if (!db.prepare('SELECT 1 FROM users WHERE id = ? AND is_active = 1').get(other)) return res.status(404).json({ error: 'User not found' });
  const key = [req.user.id, other].sort().join(':');
  let channel = db.prepare("SELECT * FROM chat_channels WHERE kind = 'dm' AND dm_key = ?").get(key);
  if (!channel) {
    const id = uuid();
    db.transaction(() => {
      db.prepare("INSERT INTO chat_channels (id, kind, dm_key, created_by) VALUES (?, 'dm', ?, ?)").run(id, key, req.user.id);
      const add = db.prepare('INSERT OR IGNORE INTO chat_channel_members (id, channel_id, user_id, role) VALUES (?, ?, ?, ?)');
      add.run(uuid(), id, req.user.id, 'member');
      add.run(uuid(), id, other, 'member');
    })();
    channel = getChannel(db, id);
    emitChannelsChanged(db, channel); // let the other participant see the new DM
  }
  res.status(201).json({ id: channel.id, kind: 'dm', name: userName(db, other), other_user_id: other });
});

// Get-or-create a group DM among the caller and 1+ other users. Identified by
// the sorted set of member ids, so the same group always maps to one channel.
router.post('/dm', (req, res) => {
  const db = getDb();
  const ids = Array.isArray(req.body?.user_ids) ? req.body.user_ids.filter(Boolean) : [];
  const memberIds = [...new Set([req.user.id, ...ids])];
  const others = memberIds.filter(id => id !== req.user.id);
  if (others.length === 0) return res.status(400).json({ error: 'Pick at least one other person' });
  // Everyone must be an active user.
  for (const id of others) {
    if (!db.prepare('SELECT 1 FROM users WHERE id = ? AND is_active = 1').get(id)) return res.status(404).json({ error: 'A selected person was not found' });
  }
  const key = [...memberIds].sort().join(':');
  let channel = db.prepare("SELECT * FROM chat_channels WHERE kind = 'dm' AND dm_key = ?").get(key);
  if (!channel) {
    const id = uuid();
    db.transaction(() => {
      db.prepare("INSERT INTO chat_channels (id, kind, dm_key, created_by) VALUES (?, 'dm', ?, ?)").run(id, key, req.user.id);
      const add = db.prepare('INSERT OR IGNORE INTO chat_channel_members (id, channel_id, user_id, role) VALUES (?, ?, ?, ?)');
      for (const mid of memberIds) add.run(uuid(), id, mid, 'member');
    })();
    channel = getChannel(db, id);
    emitChannelsChanged(db, channel);
  }
  res.status(201).json({ id: channel.id, kind: 'dm', name: others.map(id => userName(db, id)).join(', ') });
});

// ── Messages ──────────────────────────────────────────────────────────────────
function flattenMessage(db, m) {
  const reactions = db.prepare('SELECT emoji, user_id FROM chat_reactions WHERE message_id = ?').all(m.id);
  const grouped = {};
  for (const r of reactions) { (grouped[r.emoji] ||= []).push(r.user_id); }
  // Thread summary for a top-level message: how many replies and who's in it.
  const thread = db.prepare('SELECT COUNT(*) c, MAX(created_at) last FROM chat_messages WHERE parent_id = ? AND deleted_at IS NULL').get(m.id);
  const repliers = thread.c > 0
    ? db.prepare('SELECT DISTINCT user_id FROM chat_messages WHERE parent_id = ? AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 3').all(m.id).map(r => userName(db, r.user_id))
    : [];
  return {
    id: m.id, channel_id: m.channel_id, user_id: m.user_id, user_name: userName(db, m.user_id),
    body: m.deleted_at ? null : m.body, parent_id: m.parent_id,
    edited: !!m.edited_at, deleted: !!m.deleted_at, created_at: m.created_at,
    reactions: Object.entries(grouped).map(([emoji, users]) => ({ emoji, count: users.length, users })),
    reply_count: thread.c, last_reply_at: thread.last, reply_names: repliers,
    attachments: [],
  };
}

// Attachments carry a short-lived presigned download URL — only ever produced
// here, after the caller has already passed the channel access check.
async function attachmentsFor(db, messageId, deleted) {
  if (deleted) return [];
  const rows = db.prepare('SELECT * FROM chat_attachments WHERE message_id = ? ORDER BY created_at').all(messageId);
  return Promise.all(rows.map(async a => ({
    id: a.id, filename: a.filename, content_type: a.content_type, size: a.size,
    is_image: (a.content_type || '').startsWith('image/'),
    is_video: isVideo(a.content_type, a.filename),
    // `url` is the presigned R2 link, used to RENDER (an <img>/<video> needs no
    // CORS). `download_url` is our own origin and is what a Download button
    // must use — see the endpoint for why.
    url: await presignGet(a.storage_key, a.filename),
    download_url: `/api/comms/attachments/${a.id}/download`,
  })));
}

// Full message serialization (reactions + attachment URLs). Async because
// presigning is async; callers await it.
async function serialize(db, m) {
  const base = flattenMessage(db, m);
  base.attachments = await attachmentsFor(db, m.id, !!m.deleted_at);
  return base;
}

router.get('/channels/:id/messages', async (req, res) => {
  const channel = requireChannel(req, res); if (!channel) return;
  const db = getDb();
  // Jump-to-date: return the window starting at that day (oldest first) so the
  // client can land the reader at the top of it.
  if (/^\d{4}-\d{2}-\d{2}$/.test(req.query.date || '')) {
    const limit = Math.min(parseInt(req.query.limit) || 200, 400);
    const rows = db.prepare('SELECT * FROM chat_messages WHERE channel_id = ? AND parent_id IS NULL AND created_at >= ? ORDER BY created_at ASC LIMIT ?')
      .all(channel.id, req.query.date, limit);
    return res.json(await Promise.all(rows.map(m => serialize(db, m))));
  }
  const limit = Math.min(parseInt(req.query.limit) || 50, 200);
  const before = req.query.before;
  let sql = 'SELECT * FROM chat_messages WHERE channel_id = ? AND parent_id IS NULL';
  const params = [channel.id];
  if (before) { sql += ' AND created_at < ?'; params.push(before); }
  sql += ' ORDER BY created_at DESC LIMIT ?';
  params.push(limit);
  const rows = db.prepare(sql).all(...params).reverse();
  res.json(await Promise.all(rows.map(m => serialize(db, m))));
});

// The caller's Threads inbox: every thread they started or replied to (or were
// mentioned in the root of), newest activity first, with parent + replies.
router.get('/threads', async (req, res) => {
  const db = getDb();
  const me = req.user.id;
  const isAdmin = req.user.role === 'admin';
  const rows = db.prepare(`
    SELECT p.id, MAX(r.created_at) AS last_reply
    FROM chat_messages p
    JOIN chat_messages r ON r.parent_id = p.id AND r.deleted_at IS NULL
    WHERE p.parent_id IS NULL AND p.deleted_at IS NULL
      AND (
        p.user_id = ?
        OR EXISTS (SELECT 1 FROM chat_messages rr WHERE rr.parent_id = p.id AND rr.user_id = ?)
        OR EXISTS (SELECT 1 FROM chat_mentions mn WHERE mn.message_id = p.id AND mn.user_id = ?)
        -- …or a REPLY named you. Being @mentioned deep in a thread is the
        -- clearest possible signal that it involves you, and it was the one
        -- case this list missed: the mention check only looked at the parent,
        -- so the thread never appeared in your inbox at all.
        OR EXISTS (SELECT 1 FROM chat_mentions mr JOIN chat_messages rm ON rm.id = mr.message_id
                   WHERE rm.parent_id = p.id AND rm.deleted_at IS NULL AND mr.user_id = ?)
      )
    GROUP BY p.id
    ORDER BY last_reply DESC
    LIMIT 40`).all(me, me, me, me);

  const out = [];
  for (const row of rows) {
    const parent = db.prepare('SELECT * FROM chat_messages WHERE id = ?').get(row.id);
    if (!parent) continue;
    const channel = getChannel(db, parent.channel_id);
    if (!channel || !canAccess(db, channel, me, isAdmin)) continue;
    const replies = db.prepare('SELECT * FROM chat_messages WHERE parent_id = ? ORDER BY created_at ASC').all(parent.id);
    const lastRead = db.prepare('SELECT last_read_at FROM chat_thread_reads WHERE parent_id = ? AND user_id = ?')
      .get(parent.id, me)?.last_read_at || null;
    out.push({
      channel_id: channel.id,
      channel_name: channelLabel(db, channel, me),
      channel_kind: channel.kind,
      parent: await serialize(db, parent),
      replies: await Promise.all(replies.map(m => serialize(db, m))),
      last_reply: row.last_reply,
      unread: threadUnread(db, parent.id, me),
      // Where to draw the "new replies" line inside the thread.
      last_read_at: lastRead,
    });
  }
  res.json(out);
});

// ── Activity ──────────────────────────────────────────────────────────────────
// One feed of everything that involved YOU: mentions, direct messages, and
// replies on threads you're part of. Deliberately not "every message in every
// channel" — that's the channel list, and duplicating it here would bury the
// things that actually need an answer.
//
// It doubles as the way people find an old message they half-remember, which is
// why it pages back through history rather than only showing what's unread.

// Kinds in precedence order: an @mention inside a DM is a mention first.
const ACTIVITY_KINDS = ['mention', 'dm', 'thread'];

// A direct message is your activity only if you are IN it.
//
// This has to be enforced in the query, not left to the post-query access
// check: canAccess() deliberately grants admins every channel so channel
// administration works, and the DM branch selects every DM in the database.
// Without this join an admin's Activity feed listed the whole plant's private
// conversations — and worse, POST /activity/read then created a membership row
// in each one, permanently adding every DM to their channel list.
//
// Only the DM branch needs the guard: an @mention names you and a thread reply
// is filtered to threads you started, replied to, or were mentioned in, so both
// are self-selecting by construction.
const DM_MEMBER_JOIN = 'JOIN chat_channel_members cm ON cm.channel_id = m.channel_id AND cm.user_id = $me';

router.get('/activity', (req, res) => {
  const db = getDb();
  const me = req.user.id;
  const isAdmin = req.user.role === 'admin';
  const filter = ['mentions', 'dms', 'threads'].includes(req.query.filter) ? req.query.filter : 'all';
  const unreadOnly = req.query.unread === '1';
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const before = req.query.before || null; // created_at cursor for "load older"

  const want = (k) => filter === 'all' || filter === `${k}s`;
  const parts = [];
  // Nothing you wrote yourself is activity — it never needs your attention.
  if (want('mention')) {
    parts.push(`SELECT m.id, m.created_at, 'mention' AS kind FROM chat_messages m
                JOIN chat_mentions mn ON mn.message_id = m.id AND mn.user_id = $me
                WHERE m.deleted_at IS NULL AND m.user_id != $me`);
  }
  if (want('dm')) {
    parts.push(`SELECT m.id, m.created_at, 'dm' AS kind FROM chat_messages m
                JOIN chat_channels c ON c.id = m.channel_id
                ${DM_MEMBER_JOIN}
                WHERE c.kind = 'dm' AND m.deleted_at IS NULL AND m.user_id != $me`);
  }
  if (want('thread')) {
    // Replies on threads you started, replied to, or were mentioned in.
    parts.push(`SELECT m.id, m.created_at, 'thread' AS kind FROM chat_messages m
                JOIN chat_messages p ON p.id = m.parent_id
                WHERE m.parent_id IS NOT NULL AND m.deleted_at IS NULL AND m.user_id != $me
                  AND (p.user_id = $me
                    OR EXISTS (SELECT 1 FROM chat_messages rr WHERE rr.parent_id = p.id AND rr.user_id = $me)
                    OR EXISTS (SELECT 1 FROM chat_mentions m2 WHERE m2.message_id = p.id AND m2.user_id = $me))`);
  }
  if (!parts.length) return res.json({ items: [], has_more: false });

  const cursor = before ? ' AND created_at < $before' : '';
  const sql = `SELECT id, created_at, kind FROM (${parts.join(' UNION ALL ')})
               WHERE 1=1 ${cursor} ORDER BY created_at DESC LIMIT $scan`;
  // Over-fetch: access checks and de-duplication both drop rows after the query.
  const rows = db.prepare(sql).all({ me, before, scan: limit * 4 });

  const best = new Map(); // message id → highest-precedence kind
  for (const r of rows) {
    const prev = best.get(r.id);
    if (!prev || ACTIVITY_KINDS.indexOf(r.kind) < ACTIVITY_KINDS.indexOf(prev.kind)) best.set(r.id, r);
  }
  const ordered = [...best.values()].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));

  const items = [];
  let scanned = 0;
  for (const r of ordered) {
    scanned++;
    const m = db.prepare('SELECT * FROM chat_messages WHERE id = ?').get(r.id);
    if (!m) continue;
    const channel = getChannel(db, m.channel_id);
    if (!channel || !canAccess(db, channel, me, isAdmin)) continue;

    // Unread is measured against the thread when it's a reply, the channel
    // otherwise — the same rule the badges use, so the two never disagree.
    const lastRead = activityMarker(db,
      { parentId: m.parent_id, channelId: channel.id, isMention: r.kind === 'mention' }, me);
    const unread = !lastRead || String(m.created_at) > String(lastRead);
    if (unreadOnly && !unread) continue;

    items.push({
      id: m.id,
      kind: r.kind,
      channel_id: channel.id,
      channel_name: channelLabel(db, channel, me),
      channel_kind: channel.kind,
      parent_id: m.parent_id || null,
      user_id: m.user_id,
      user_name: userName(db, m.user_id),
      body: m.body,
      created_at: m.created_at,
      unread,
    });
    if (items.length >= limit) break;
  }

  res.json({ items, has_more: scanned < ordered.length || rows.length >= limit * 4 });
});

// Unread counts per activity tab — drives the badges without loading the feed.
router.get('/activity/unread', (req, res) => {
  const db = getDb();
  const me = req.user.id;
  const isAdmin = req.user.role === 'admin';
  const counts = { all: 0, mentions: 0, dms: 0, threads: 0 };

  const rows = db.prepare(`
    SELECT m.id, m.channel_id, m.parent_id, m.created_at, 'mention' AS kind FROM chat_messages m
      JOIN chat_mentions mn ON mn.message_id = m.id AND mn.user_id = $me
      WHERE m.deleted_at IS NULL AND m.user_id != $me
    UNION ALL
    SELECT m.id, m.channel_id, m.parent_id, m.created_at, 'dm' FROM chat_messages m
      JOIN chat_channels c ON c.id = m.channel_id
      ${DM_MEMBER_JOIN}
      WHERE c.kind = 'dm' AND m.deleted_at IS NULL AND m.user_id != $me
    UNION ALL
    SELECT m.id, m.channel_id, m.parent_id, m.created_at, 'thread' FROM chat_messages m
      JOIN chat_messages p ON p.id = m.parent_id
      WHERE m.parent_id IS NOT NULL AND m.deleted_at IS NULL AND m.user_id != $me
        AND (p.user_id = $me
          OR EXISTS (SELECT 1 FROM chat_messages rr WHERE rr.parent_id = p.id AND rr.user_id = $me)
          OR EXISTS (SELECT 1 FROM chat_mentions m2 WHERE m2.message_id = p.id AND m2.user_id = $me))
  `).all({ me });

  const best = new Map();
  for (const r of rows) {
    const prev = best.get(r.id);
    if (!prev || ACTIVITY_KINDS.indexOf(r.kind) < ACTIVITY_KINDS.indexOf(prev.kind)) best.set(r.id, r);
  }
  const accessCache = new Map();
  for (const r of best.values()) {
    let ok = accessCache.get(r.channel_id);
    if (ok === undefined) {
      const ch = getChannel(db, r.channel_id);
      ok = !!ch && canAccess(db, ch, me, isAdmin);
      accessCache.set(r.channel_id, ok);
    }
    if (!ok) continue;
    const lastRead = activityMarker(db,
      { parentId: r.parent_id, channelId: r.channel_id, isMention: r.kind === 'mention' }, me);
    if (lastRead && String(r.created_at) <= String(lastRead)) continue;
    counts.all++;
    counts[`${r.kind}s`]++;
  }
  res.json(counts);
});

// POST /activity/read — clear the Activity badge.
//
// Activity has no read state of its own: an item is unread when it's newer than
// the caller's last_read_at on its thread (for a reply) or its channel. So
// clearing the feed means stamping exactly those rows — narrower than
// /read-all, which marks EVERY channel read and would also wipe unread counts
// for channels the person hasn't looked at yet.
router.post('/activity/read', (req, res) => {
  const db = getDb();
  const me = req.user.id;
  const isAdmin = req.user.role === 'admin';
  // Same clock format as chat_messages.created_at — the unread check is a
  // string comparison, so an ISO value would sort wrong. See /read-all.
  const now = db.prepare("SELECT strftime('%Y-%m-%d %H:%M:%f','now') AS t").get().t;

  const rows = db.prepare(`
    SELECT m.channel_id, m.parent_id FROM chat_messages m
      JOIN chat_mentions mn ON mn.message_id = m.id AND mn.user_id = $me
      WHERE m.deleted_at IS NULL AND m.user_id != $me
    UNION
    SELECT m.channel_id, m.parent_id FROM chat_messages m
      JOIN chat_channels c ON c.id = m.channel_id
      ${DM_MEMBER_JOIN}
      WHERE c.kind = 'dm' AND m.deleted_at IS NULL AND m.user_id != $me
    UNION
    SELECT m.channel_id, m.parent_id FROM chat_messages m
      JOIN chat_messages p ON p.id = m.parent_id
      WHERE m.parent_id IS NOT NULL AND m.deleted_at IS NULL AND m.user_id != $me
        AND (p.user_id = $me
          OR EXISTS (SELECT 1 FROM chat_messages rr WHERE rr.parent_id = p.id AND rr.user_id = $me)
          OR EXISTS (SELECT 1 FROM chat_mentions m2 WHERE m2.message_id = p.id AND m2.user_id = $me))
  `).all({ me });

  const markThread = db.prepare(`INSERT INTO chat_thread_reads (user_id, parent_id, last_read_at, deliberate_unread) VALUES (?, ?, ?, 0)
    ON CONFLICT(user_id, parent_id) DO UPDATE SET last_read_at = excluded.last_read_at, deliberate_unread = 0`);
  const markChannel = db.prepare('UPDATE chat_channel_members SET last_read_at = ? WHERE channel_id = ? AND user_id = ?');
  const joinChannel = db.prepare('INSERT OR IGNORE INTO chat_channel_members (id, channel_id, user_id, role, last_read_at) VALUES (?, ?, ?, ?, ?)');

  const accessCache = new Map();
  const threads = new Set();
  const channels = new Set();
  for (const r of rows) {
    let ok = accessCache.get(r.channel_id);
    if (ok === undefined) {
      const ch = getChannel(db, r.channel_id);
      ok = !!ch && canAccess(db, ch, me, isAdmin);
      accessCache.set(r.channel_id, ok);
    }
    if (!ok) continue;
    if (r.parent_id) threads.add(r.parent_id);
    else channels.add(r.channel_id);
  }

  db.transaction(() => {
    for (const parentId of threads) markThread.run(me, parentId, now);
    for (const channelId of channels) {
      const changed = markChannel.run(now, channelId, me).changes;
      // A PUBLIC channel the caller never joined has no membership row to
      // update — @mentions land there too, so give them one.
      //
      // Restricted to public on purpose. Joining is a side effect of reading a
      // badge, and a side effect that quiet must never be able to add someone
      // to a private channel or a DM. The DM branch above is membership-scoped
      // now, so this is belt and braces — keep both.
      if (!changed && getChannel(db, channelId)?.kind === 'public') {
        joinChannel.run(uuid(), channelId, me, 'member', now);
      }
    }
  })();

  res.json({ ok: true, channels: channels.size, threads: threads.size });
});

// Total unread across every thread the caller follows — the badge on the
// Threads entry, which is the only reason a thread reply is worth surfacing
// outside the thread itself.
router.get('/threads/unread', (req, res) => {
  const db = getDb();
  const me = req.user.id;
  const isAdmin = req.user.role === 'admin';
  const parents = db.prepare(`
    SELECT DISTINCT p.id, p.channel_id FROM chat_messages p
    JOIN chat_messages r ON r.parent_id = p.id AND r.deleted_at IS NULL
    WHERE p.parent_id IS NULL AND p.deleted_at IS NULL
      AND (
        p.user_id = ?
        OR EXISTS (SELECT 1 FROM chat_messages rr WHERE rr.parent_id = p.id AND rr.user_id = ?)
        OR EXISTS (SELECT 1 FROM chat_mentions mn WHERE mn.message_id = p.id AND mn.user_id = ?)
        -- …or a REPLY named you. Being @mentioned deep in a thread is the
        -- clearest possible signal that it involves you, and it was the one
        -- case this list missed: the mention check only looked at the parent,
        -- so the thread never appeared in your inbox at all.
        OR EXISTS (SELECT 1 FROM chat_mentions mr JOIN chat_messages rm ON rm.id = mr.message_id
                   WHERE rm.parent_id = p.id AND rm.deleted_at IS NULL AND mr.user_id = ?)
      )`).all(me, me, me, me);
  let total = 0, threads = 0;
  for (const p of parents) {
    const channel = getChannel(db, p.channel_id);
    if (!channel || !canAccess(db, channel, me, isAdmin)) continue;
    const n = threadUnread(db, p.id, me);
    if (n > 0) { total += n; threads++; }
  }
  res.json({ total, threads });
});

// Opening a thread marks it read, the same way opening a channel does.
router.post('/threads/:parentId/read', (req, res) => {
  const db = getDb();
  const parent = db.prepare('SELECT * FROM chat_messages WHERE id = ?').get(req.params.parentId);
  if (!parent) return res.status(404).json({ error: 'Thread not found' });
  const channel = getChannel(db, parent.channel_id);
  if (!channel || !canAccess(db, channel, req.user.id, req.user.role === 'admin')) {
    return res.status(404).json({ error: 'Thread not found' });
  }
  // Millisecond precision, same as the channel read endpoint — datetime('now')
  // is second-precision, and a reply landing in the same second as the read
  // compares GREATER than the marker, so the thread never fully cleared.
  const tnow = db.prepare("SELECT strftime('%Y-%m-%d %H:%M:%f','now') AS t").get().t;
  db.prepare(`INSERT INTO chat_thread_reads (user_id, parent_id, last_read_at, deliberate_unread) VALUES (?, ?, ?, 0)
              ON CONFLICT(user_id, parent_id) DO UPDATE SET last_read_at = excluded.last_read_at, deliberate_unread = 0`)
    .run(req.user.id, parent.id, tnow);
  res.json({ ok: true });
});

// A message's thread: the parent plus all its replies in order. Access is
// enforced through the parent's channel.
router.get('/messages/:id/thread', async (req, res) => {
  const db = getDb();
  const parent = db.prepare('SELECT * FROM chat_messages WHERE id = ?').get(req.params.id);
  if (!parent) return res.status(404).json({ error: 'Message not found' });
  const channel = getChannel(db, parent.channel_id);
  if (!channel || !canAccess(db, channel, req.user.id, req.user.role === 'admin')) return res.status(404).json({ error: 'Not found' });
  const replies = db.prepare('SELECT * FROM chat_messages WHERE parent_id = ? ORDER BY created_at ASC').all(parent.id);
  res.json({
    parent: await serialize(db, parent),
    replies: await Promise.all(replies.map(m => serialize(db, m))),
  });
});

router.post('/channels/:id/messages', async (req, res) => {
  const channel = requireChannel(req, res); if (!channel) return;
  const db = getDb();
  // Announcement channels: only admins may post (everyone still reads/reacts).
  if (channel.post_policy === 'admins' && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Only admins can post in this channel' });
  }
  const body = (req.body?.body || '').trim();
  const attachmentIds = Array.isArray(req.body?.attachment_ids) ? req.body.attachment_ids : [];
  if (!body && attachmentIds.length === 0) return res.status(400).json({ error: 'A message or an attachment is required' });
  const id = uuid();
  // Millisecond-precision created_at (not the second-precision datetime('now')
  // column default) so unread ordering is exact — a message that arrives in the
  // same second as a read is still correctly newer. Reuse the same value as the
  // sender's read marker so they never see their own message as unread.
  const now = db.prepare("SELECT strftime('%Y-%m-%d %H:%M:%f','now') AS t").get().t;
  db.prepare('INSERT INTO chat_messages (id, channel_id, user_id, body, parent_id, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, channel.id, req.user.id, body || null, req.body?.parent_id || null, now);
  // Link only the caller's own still-unattached uploads for this channel.
  const link = db.prepare('UPDATE chat_attachments SET message_id = ? WHERE id = ? AND channel_id = ? AND user_id = ? AND message_id IS NULL');
  for (const aid of attachmentIds) link.run(id, aid, channel.id, req.user.id);
  db.prepare("UPDATE chat_channels SET updated_at = datetime('now') WHERE id = ?").run(channel.id);
  // deliberate_unread = 0 guard: replying must not silently wipe a mark-unread
  // the sender set — the bookmark survives until they actually read the channel.
  db.prepare("UPDATE chat_channel_members SET last_read_at = ? WHERE channel_id = ? AND user_id = ? AND deliberate_unread = 0").run(now, channel.id, req.user.id);
  const message = await serialize(db, db.prepare('SELECT * FROM chat_messages WHERE id = ?').get(id));
  emitToChannel(channel.id, 'message:new', message);
  emitChannelsChanged(db, channel);
  const mentionedIds = recordMentions(db, channel, id, body, req.user) || [];
  // DMs push to the other participant(s) — everyone in the DM but the sender.
  if (channel.kind === 'dm' && body) {
    const recips = db.prepare('SELECT user_id FROM chat_channel_members WHERE channel_id = ? AND user_id != ?').all(channel.id, req.user.id);
    for (const r of recips) pushToUser(r.user_id, { title: `Message from ${shortNameOf(req.user)}`, body: body.slice(0, 140), tag: `dm-${channel.id}`, renotify: true, url: `/?c=${channel.id}&m=${id}` }).catch(() => {});
  } else if (body) {
    // Every other channel message: grouped, summarized, debounced push to members
    // who weren't already @mentioned (they got a higher-priority alert above).
    notifyChannelMessage(db, channel, body, req.user, mentionedIds, id);
  }
  embedMessage(db, id, channel.id, body); // fire-and-forget
  try { channelHygiene(db, channel, message, req.user); } catch { /* best-effort */ }
  res.status(201).json(message);
});

// ── Attachments ─────────────────────────────────────────────────────────────
// Upload one or more files to a channel; they stay unlinked until a message
// GET /attachments/:id/download — same-origin download.
//
// The presigned R2 URL is a DIFFERENT ORIGIN, so `<a download>` is ignored and
// the browser just opens the file in a tab; the client worked around that by
// fetching the bytes and saving a blob, which needs a CORS rule on the bucket.
// Without one the fetch throws and the fallback opens a tab — which is exactly
// what "download behaves like open in a new tab" looks like.
//
// Streaming the bytes back through our own origin removes the question: no
// CORS, the filename survives, and it behaves the same on a phone. The channel
// access check runs first, so this widens nothing.
router.get('/attachments/:id/download', async (req, res) => {
  const db = getDb();
  const a = db.prepare('SELECT * FROM chat_attachments WHERE id = ?').get(req.params.id);
  if (!a) return res.status(404).json({ error: 'Not found' });
  const channel = getChannel(db, a.channel_id);
  if (!channel || (req.impersonated && channel.kind === 'dm') ||
      !canAccess(db, channel, req.user.id, req.user.role === 'admin')) {
    return res.status(404).json({ error: 'Not found' });
  }
  const buf = await getObjectBuffer(a.storage_key);
  if (!buf) return res.status(404).json({ error: 'File is no longer stored.' });
  const safe = String(a.filename || 'download').replace(/["\\\r\n]/g, '_');
  res.setHeader('Content-Type', a.content_type || 'application/octet-stream');
  res.setHeader('Content-Disposition', `attachment; filename="${safe}"`);
  res.setHeader('Content-Length', buf.length);
  res.send(buf);
});

// references them via attachment_ids. Storage-gated.
router.post('/channels/:id/attachments', uploadFiles, async (req, res) => {
  const files = req.files || [];
  try {
    if (!storageEnabled()) return res.status(503).json({ error: 'File uploads are not configured on this server.' });
    const channel = requireChannel(req, res); if (!channel) return;
    const db = getDb();
    if (!files.length) return res.status(400).json({ error: 'No files uploaded' });
    const tooBig = rejectOversize(files);
    if (tooBig) return res.status(413).json({ error: tooBig });
    const out = [];
    for (const f of files) {
      const id = uuid();
      const safe = (f.originalname || 'file').replace(/[^\w.-]+/g, '_').slice(0, 120);
      const key = `chat/${channel.id}/${id}-${safe}`;
      await putStream(key, createReadStream(f.path), f.mimetype);
      db.prepare('INSERT INTO chat_attachments (id, message_id, channel_id, user_id, filename, content_type, size, storage_key) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .run(id, null, channel.id, req.user.id, (f.originalname || 'file').slice(0, 255), f.mimetype || null, f.size || null, key);
      out.push({
        id, filename: f.originalname, content_type: f.mimetype, size: f.size,
        is_image: (f.mimetype || '').startsWith('image/'),
        is_video: isVideo(f.mimetype, f.originalname),
      });
    }
    res.status(201).json(out);
  } finally {
    cleanupTemp(files);
  }
});

function ownedMessage(req, res) {
  const db = getDb();
  const m = db.prepare('SELECT * FROM chat_messages WHERE id = ?').get(req.params.id);
  if (!m) { res.status(404).json({ error: 'Message not found' }); return null; }
  const channel = getChannel(db, m.channel_id);
  if (!canAccess(db, channel, req.user.id)) { res.status(404).json({ error: 'Message not found' }); return null; }
  return { m, channel };
}

router.put('/messages/:id', async (req, res) => {
  const ctx = ownedMessage(req, res); if (!ctx) return;
  const db = getDb();
  if (ctx.m.user_id !== req.user.id) return res.status(403).json({ error: 'You can only edit your own messages' });
  const body = (req.body?.body || '').trim();
  if (!body) return res.status(400).json({ error: 'Message body is required' });
  db.prepare("UPDATE chat_messages SET body = ?, edited_at = datetime('now') WHERE id = ?").run(body, ctx.m.id);
  db.prepare('DELETE FROM chat_message_translations WHERE message_id = ?').run(ctx.m.id); // stale after edit
  db.prepare('DELETE FROM chat_mentions WHERE message_id = ?').run(ctx.m.id);
  recordMentions(db, ctx.channel, ctx.m.id, body, req.user); // re-detect after edit
  const updated = await serialize(db, db.prepare('SELECT * FROM chat_messages WHERE id = ?').get(ctx.m.id));
  emitToChannel(ctx.channel.id, 'message:update', updated);
  embedMessage(db, ctx.m.id, ctx.channel.id, body); // re-embed edited text
  res.json(updated);
});

router.delete('/messages/:id', async (req, res) => {
  const ctx = ownedMessage(req, res); if (!ctx) return;
  const db = getDb();
  if (!canDeleteMessage(req.user, ctx.m)) {
    return res.status(403).json({ error: 'Only an admin can delete a message. You can edit your own instead.' });
  }
  // WHO REMOVED IT IS PART OF THE RECORD. While anybody could delete their own,
  // the answer to "where did that message go" was always "its author took it
  // down". Now that removing one is a moderation action taken on somebody
  // else's words, an unattributed deletion is the version of this that cannot
  // be questioned six months later.
  db.prepare("UPDATE chat_messages SET deleted_at = datetime('now'), deleted_by = ?, body = NULL WHERE id = ?")
    .run(req.user.id, ctx.m.id);
  logAudit(req.user, 'delete', 'chat_message', ctx.m.id,
    { channel: ctx.channel.name || ctx.channel.id, author_id: ctx.m.user_id },
    { body: ctx.m.body }, null, `Message in ${ctx.channel.name || 'a conversation'}`);
  // Drop the attachment rows, then purge only objects with no remaining
  // reference — a forwarded copy of this message shares the same storage_key,
  // and deleting the original must not break the copy (or vice versa).
  const atts = db.prepare('SELECT storage_key FROM chat_attachments WHERE message_id = ?').all(ctx.m.id);
  db.prepare('DELETE FROM chat_attachments WHERE message_id = ?').run(ctx.m.id);
  const stillRef = db.prepare('SELECT 1 FROM chat_attachments WHERE storage_key = ? LIMIT 1');
  for (const a of atts) { if (!stillRef.get(a.storage_key)) deleteObject(a.storage_key); }
  db.prepare('DELETE FROM chat_message_embeddings WHERE message_id = ?').run(ctx.m.id);
  db.prepare('DELETE FROM chat_message_translations WHERE message_id = ?').run(ctx.m.id);
  db.prepare('DELETE FROM chat_mentions WHERE message_id = ?').run(ctx.m.id);
  emitToChannel(ctx.channel.id, 'message:update', await serialize(db, db.prepare('SELECT * FROM chat_messages WHERE id = ?').get(ctx.m.id)));
  res.json({ ok: true });
});

// ── Forward a message to another channel ────────────────────────────────────
// The alternative people actually use is a screenshot, which loses the text,
// the file and the author. Forwarding posts a copy into the target channel
// (access-checked on BOTH ends) with an attribution line, and re-references
// the same stored attachment objects — the delete paths above only purge an
// object once nothing references it.
//
// Mentions in the forwarded text are deliberately NOT re-recorded: an @name in
// the original was aimed at the original conversation, and re-pinging that
// person every time the message travels turns forwards into spam.
router.post('/messages/:id/forward', async (req, res) => {
  const ctx = ownedMessage(req, res); if (!ctx) return; // access-checks the source
  const db = getDb();
  if (ctx.m.deleted_at) return res.status(400).json({ error: 'That message was deleted.' });

  const target = getChannel(db, req.body?.channel_id);
  if (!target || !canAccess(db, target, req.user.id, req.user.role === 'admin')) {
    return res.status(404).json({ error: 'Channel not found' });
  }
  if (target.id === ctx.channel.id) return res.status(400).json({ error: 'That message is already in this channel.' });
  if (target.post_policy === 'admins' && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Only admins can post in that channel' });
  }

  const authorName = userName(db, ctx.m.user_id);
  const fromLabel = ctx.channel.kind === 'dm' ? 'a direct message' : `#${ctx.channel.name}`;
  const note = String(req.body?.note || '').trim();
  const bodyParts = [];
  if (note) bodyParts.push(note);
  bodyParts.push(`↪ *Forwarded from ${fromLabel}* — originally by ${authorName}:`);
  if (ctx.m.body) bodyParts.push(ctx.m.body);
  const body = bodyParts.join('\n');

  const id = uuid();
  const now = db.prepare("SELECT strftime('%Y-%m-%d %H:%M:%f','now') AS t").get().t;
  db.prepare('INSERT INTO chat_messages (id, channel_id, user_id, body, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(id, target.id, req.user.id, body, now);

  // Re-reference the source attachments: new rows in the target channel
  // pointing at the SAME storage objects — no copy in R2, no second upload.
  const atts = db.prepare('SELECT * FROM chat_attachments WHERE message_id = ?').all(ctx.m.id);
  const insertAtt = db.prepare('INSERT INTO chat_attachments (id, message_id, channel_id, user_id, filename, content_type, size, storage_key) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
  for (const a of atts) insertAtt.run(uuid(), id, target.id, req.user.id, a.filename, a.content_type, a.size, a.storage_key);

  db.prepare("UPDATE chat_channels SET updated_at = datetime('now') WHERE id = ?").run(target.id);
  db.prepare('UPDATE chat_channel_members SET last_read_at = ? WHERE channel_id = ? AND user_id = ? AND deliberate_unread = 0').run(now, target.id, req.user.id);

  const message = await serialize(db, db.prepare('SELECT * FROM chat_messages WHERE id = ?').get(id));
  emitToChannel(target.id, 'message:new', message);
  emitChannelsChanged(db, target);
  if (target.kind === 'dm') {
    const recips = db.prepare('SELECT user_id FROM chat_channel_members WHERE channel_id = ? AND user_id != ?').all(target.id, req.user.id);
    for (const r of recips) pushToUser(r.user_id, { title: `Message from ${shortNameOf(req.user)}`, body: body.slice(0, 140), tag: `dm-${target.id}`, renotify: true, url: `/?c=${target.id}&m=${id}` }).catch(() => {});
  } else {
    notifyChannelMessage(db, target, body, req.user, [], id);
  }
  embedMessage(db, id, target.id, body); // fire-and-forget
  res.status(201).json(message);
});

// ── Message → compliance record ──────────────────────────────────────────────
// Promote a chat message into a draft QMS record (deviation / non-conformance /
// on-hold), pre-filled from the message + author + timestamp and back-linked to
// the source for an audit trail. Channel access is required; the record lands
// as a draft for the owning module to complete.
const CONVERT_TYPES = {
  deviation: (m, authorName) => ({ initiator: authorName, description: m.body }),
  non_conformance: (m, authorName) => ({ discovered_by: authorName, description: m.body }),
  on_hold: (m, authorName) => ({ reason: m.body, placed_by: `${new Date().toISOString().slice(0, 10)} ${authorName}` }),
};
function nextRecordNumber(db, cfg) {
  const rows = db.prepare('SELECT record_number FROM qms_records WHERE record_type = ?').all(cfg.key);
  let max = 0;
  for (const r of rows) {
    const m = String(r.record_number || '').match(/\d+/g);
    if (m) max = Math.max(max, parseInt(m[m.length - 1], 10));
  }
  return (cfg.numberPrefix || '') + String(max + 1).padStart(cfg.numberPad || 3, '0');
}
router.post('/messages/:id/to-record', (req, res) => {
  const ctx = ownedMessage(req, res); if (!ctx) return;
  const db = getDb();
  const type = String(req.body?.type || '');
  const build = CONVERT_TYPES[type];
  const cfg = getType(type);
  if (!build || !cfg) return res.status(400).json({ error: 'Unsupported record type' });
  if (ctx.m.deleted_at || !ctx.m.body) return res.status(400).json({ error: 'This message has no content to convert.' });

  const authorName = db.prepare('SELECT name FROM users WHERE id = ?').get(ctx.m.user_id)?.name || 'Unknown';
  const chanLabel = ctx.channel.kind === 'public' ? `#${ctx.channel.name}` : (ctx.channel.name || 'a direct message');
  const id = uuid();
  const number = nextRecordNumber(db, cfg);
  const data = {
    ...build(ctx.m, authorName),
    source_message_id: ctx.m.id,
    source_channel_id: ctx.channel.id,
  };
  const notes = `Created from a chat message in ${chanLabel} — ${authorName}, ${ctx.m.created_at}. Converted by ${req.user.name}.`;
  db.prepare(`INSERT INTO qms_records (id, record_type, record_number, record_date, status, data, paper_record, notes, created_by)
    VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)`).run(
    id, cfg.key, number, new Date().toISOString().slice(0, 10), cfg.defaultStatus || null,
    JSON.stringify(data), notes, req.user.name);
  logAudit(req.user, 'qms_created', cfg.key, id,
    { record_number: number, from_message: ctx.m.id, channel: ctx.channel.name }, null, null, number);
  res.status(201).json({ ok: true, record_number: number, record_id: id, type: cfg.key, label: cfg.singular, module: cfg.moduleId });
});

// ── Chat message → Task Center task ──────────────────────────────────────────
// A directive typed into a department channel is a task that nobody can follow
// up on. This turns it into one at the moment it's sent, and leaves a note in
// the channel saying who assigned it and when — so the conversation still shows
// what happened, and the work is tracked somewhere it can be closed out.
//
// Assigning work is a supervisor/admin act, matching who can create tasks in
// the Task Center itself.
router.post('/channels/:id/to-task', (req, res) => {
  const channel = requireChannel(req, res); if (!channel) return;
  if (!['admin', 'supervisor'].includes(req.user?.role)) {
    return res.status(403).json({ error: 'Only supervisors and admins can assign tasks.' });
  }
  if (channel.kind === 'dm') return res.status(400).json({ error: 'Tasks come from channel messages, not direct messages.' });

  const db = getDb();
  const title = String(req.body?.title || '').trim();
  const dueDate = String(req.body?.due_date || '').trim();
  if (!title) return res.status(400).json({ error: 'A task title is required.' });
  if (!dueDate) return res.status(400).json({ error: 'A due date is required.' });

  const group = String(req.body?.task_group || 'warehouse');
  if (group === 'document_control') {
    const canAssignDC = req.user.role === 'admin' ||
      (req.user.role === 'supervisor' && ['qa', 'document_control'].includes(req.user.department));
    if (!canAssignDC) return res.status(403).json({ error: 'Only admins or QA / Document Control supervisors can assign Document Control tasks.' });
  }

  const id = uuid();
  // The original wording is kept as the description — the title is a summary,
  // and the exact instruction is what the assignee actually needs.
  const description = String(req.body?.description || '').trim() || null;
  db.prepare(`INSERT INTO work_orders (id, equipment_id, title, description, priority, assigned_to, due_date, procedure_steps, attachments, task_group)
              VALUES (?, NULL, ?, ?, ?, ?, ?, '[]', '[]', ?)`)
    .run(id, title, description, String(req.body?.priority || 'normal'),
      String(req.body?.assigned_to || '').trim() || null, dueDate, group);

  const created = db.prepare('SELECT * FROM work_orders WHERE id = ?').get(id);
  logAudit(req.user, 'create', 'work_order', id,
    { title, task_group: group, due_date: dueDate, from_channel: channel.name }, null, created, title);

  // Leave the trail in the channel, threaded under the message it came from
  // when there is one.
  const who = shortNameOf(req.user) || req.user.name;
  const assignee = String(req.body?.assigned_to || '').trim();
  // Single asterisks: the chat renderer's bold syntax is *text*, not markdown's
  // **text** — doubling them shows a literal asterisk inside the bold run.
  const note = `📋 Task created by ${who} — *${title}*\n${assignee ? `Assigned to ${assignee} · ` : ''}${group.replace('_', ' ')} · due ${dueDate}`;
  const bot = getBotUser(db);
  postMessageAs(db, channel, bot, note, req.body?.parent_id || null).catch(() => {});

  res.status(201).json({ ok: true, work_order: created });
});

// ── Translation (on-display) ──────────────────────────────────────────────────
// Translate a message to the viewer's language, caching the result so repeat
// views (and other viewers) are free. Access-checked; AI-gated.
router.post('/messages/:id/translate', async (req, res) => {
  const ctx = ownedMessage(req, res); if (!ctx) return;
  if (!aiEnabled()) return res.status(503).json({ error: 'Translation is not configured on this server.' });
  const lang = req.body?.lang === 'en' ? 'en' : 'es';
  const db = getDb();
  if (ctx.m.deleted_at || !ctx.m.body) return res.status(400).json({ error: 'Nothing to translate' });
  const cached = db.prepare('SELECT text FROM chat_message_translations WHERE message_id = ? AND lang = ?').get(ctx.m.id, lang);
  if (cached) return res.json({ lang, text: cached.text, cached: true });
  try {
    const [text] = await translateText([ctx.m.body], lang);
    db.prepare('INSERT OR REPLACE INTO chat_message_translations (message_id, lang, text) VALUES (?, ?, ?)').run(ctx.m.id, lang, text);
    res.json({ lang, text });
  } catch (e) {
    // Logged server-side because the client used to swallow this entirely —
    // "translation stopped working" with nothing in any log is undiagnosable.
    console.warn('[comms] translate failed:', e.message);
    res.status(502).json({ error: e.message || 'Translation failed' });
  }
});

// Batch translate for channel auto-translate: one request per screenful instead
// of a burst of per-message calls (which rate-limited and looked broken).
// Cache-first; a single translateText call covers all misses.
router.post('/channels/:id/translate', async (req, res) => {
  const channel = requireChannel(req, res); if (!channel) return;
  if (!aiEnabled()) return res.status(503).json({ error: 'Translation is not configured on this server.' });
  const lang = req.body?.lang === 'en' ? 'en' : 'es';
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.slice(0, 120) : [];
  const db = getDb();
  const out = {};
  const misses = [];
  const getMsg = db.prepare('SELECT id, body, deleted_at FROM chat_messages WHERE id = ? AND channel_id = ?');
  const getCached = db.prepare('SELECT text FROM chat_message_translations WHERE message_id = ? AND lang = ?');
  for (const id of ids) {
    const m = getMsg.get(id, channel.id);
    if (!m || m.deleted_at || !m.body) continue;
    const cached = getCached.get(id, lang);
    if (cached) out[id] = cached.text;
    else misses.push(m);
  }
  if (misses.length) {
    // CHUNKED, because one call for the whole screenful has a failure mode
    // that looks exactly like "translation stopped working": the model's
    // output is a single JSON array capped by max_tokens, and once a channel
    // accumulates enough uncached messages the array TRUNCATES, the parse
    // fails, the whole batch returns nothing — and the client retries the
    // same doomed batch on every pass, forever. Small chunks keep each call
    // far from the cap, and one chunk failing no longer takes out the rest.
    const CHUNK = 20, CHUNK_CHARS = 6000;
    const chunks = [];
    let cur = [], chars = 0;
    for (const m of misses) {
      if (cur.length && (cur.length >= CHUNK || chars + m.body.length > CHUNK_CHARS)) { chunks.push(cur); cur = []; chars = 0; }
      cur.push(m); chars += m.body.length;
    }
    if (cur.length) chunks.push(cur);
    const put = db.prepare('INSERT OR REPLACE INTO chat_message_translations (message_id, lang, text) VALUES (?, ?, ?)');
    for (const chunk of chunks) {
      try {
        const texts = await translateText(chunk.map(m => m.body), lang);
        chunk.forEach((m, i) => { const t = texts[i]; if (t) { out[m.id] = t; put.run(m.id, lang, t); } });
      } catch (e) {
        // Log it — the silent version of this catch is why a broken batch
        // looked like nothing at all. The client retries missing ids next pass.
        console.warn('[comms] batch translate chunk failed:', e.message);
      }
    }
  }
  res.json({ lang, translations: out });
});

// Single message lookup (access-checked) — used by notification deep-links to
// resolve a thread reply to its parent so the client can drill in.
router.get('/messages/:id', async (req, res) => {
  const ctx = ownedMessage(req, res); if (!ctx) return;
  res.json(await serialize(getDb(), ctx.m));
});

// ── Module ↔ channel cross-links ─────────────────────────────────────────────
// Which comms channel a module's "Discuss" button (and any auto-posting) targets.
// Stored as one JSON object in app_settings: { "production-schedule": "<name>" }.
// An empty/absent entry means the module has no linked channel (button hidden).
export function getModuleLinks(db) {
  try { return JSON.parse(db.prepare("SELECT value FROM app_settings WHERE key = 'module_channel_links'").get()?.value || '{}'); }
  catch { return {}; }
}
router.get('/module-links', (req, res) => {
  res.json({ links: getModuleLinks(getDb()) });
});
router.put('/module-links', requireRole('admin'), (req, res) => {
  const { module, channel } = req.body || {};
  if (!module) return res.status(400).json({ error: 'module is required' });
  const db = getDb();
  const links = getModuleLinks(db);
  // Empty string = explicitly unlinked (distinct from "never configured", which
  // lets a module fall back to its default channel).
  links[module] = channel ? String(channel) : '';
  db.prepare(`INSERT INTO app_settings (key, value, updated_at) VALUES ('module_channel_links', ?, datetime('now'))
              ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`).run(JSON.stringify(links));
  logAudit(req.user, 'update', 'module_channel_links', module, { channel: channel || null }, null, null);
  res.json({ links });
});

// ── Reactions ─────────────────────────────────────────────────────────────────
// ── Remind me (Slack-style) ──────────────────────────────────────────────────
// Store a reminder; the minute-loop below has ReadyBot DM the user at the
// chosen time with an excerpt and a deep link back to the message.
router.post('/messages/:id/remind', (req, res) => {
  const ctx = ownedMessage(req, res); if (!ctx) return;
  const db = getDb();
  const at = req.body?.at ? new Date(req.body.at) : null;
  if (!at || isNaN(at.getTime()) || at.getTime() <= Date.now()) {
    return res.status(400).json({ error: 'Pick a future time.' });
  }
  const id = uuid();
  db.prepare('INSERT INTO chat_reminders (id, user_id, message_id, channel_id, remind_at) VALUES (?, ?, ?, ?, ?)')
    .run(id, req.user.id, ctx.m.id, ctx.channel.id, at.toISOString());
  res.status(201).json({ id, remind_at: at.toISOString() });
});

// Get-or-create the ReadyBot ↔ user DM used for reminder delivery — and by
// anything else that needs to tell one person something (controlled changes).
export function botDm(db, userId) {
  const bot = getBotUser(db);
  const key = [bot.id, userId].sort().join(':');
  let dm = db.prepare("SELECT * FROM chat_channels WHERE kind = 'dm' AND dm_key = ?").get(key);
  if (!dm) {
    const id = uuid();
    db.transaction(() => {
      db.prepare("INSERT INTO chat_channels (id, kind, dm_key, created_by) VALUES (?, 'dm', ?, ?)").run(id, key, bot.id);
      const add = db.prepare('INSERT OR IGNORE INTO chat_channel_members (id, channel_id, user_id, role) VALUES (?, ?, ?, ?)');
      add.run(uuid(), id, bot.id, 'member');
      add.run(uuid(), id, userId, 'member');
    })();
    dm = getChannel(db, id);
    emitChannelsChanged(db, dm);
  }
  return { bot, dm };
}

// Minute loop: deliver due reminders. Marked fired BEFORE posting so a crash
// can drop a reminder but never double-send it.
export function startReminderLoop(db) {
  const tick = async () => {
    try {
      const due = db.prepare('SELECT * FROM chat_reminders WHERE fired_at IS NULL AND remind_at <= ?')
        .all(new Date().toISOString());
      for (const r of due) {
        db.prepare("UPDATE chat_reminders SET fired_at = datetime('now') WHERE id = ?").run(r.id);
        const orig = db.prepare('SELECT * FROM chat_messages WHERE id = ?').get(r.message_id);
        const chan = db.prepare('SELECT * FROM chat_channels WHERE id = ?').get(r.channel_id);
        const { bot, dm } = botDm(db, r.user_id);
        const from = orig ? userName(db, orig.user_id) : 'someone';
        const label = !chan ? 'a channel' : chan.kind === 'dm' ? 'your DM' : `#${chan.name}`;
        const excerpt = (orig?.body || '(attachment)').replace(/\s+/g, ' ').slice(0, 140);
        const link = `${readyDocOrigin()}/?c=${r.channel_id}&m=${r.message_id}`;
        await postMessageAs(db, dm, bot, `⏰ Reminder — ${from} in ${label}:\n"${excerpt}"\nOpen the message: ${link}`);
        // DMs aren't covered by the grouped channel push — notify directly.
        pushToUser(r.user_id, {
          title: '⏰ Reminder', body: `${from}: ${excerpt}`.slice(0, 120),
          tag: `channel-${dm.id}`, renotify: true, url: `/?c=${r.channel_id}&m=${r.message_id}`,
        }).catch(() => {});
      }
    } catch (e) { console.warn('[reminders] tick failed:', e.message); }
  };
  setInterval(tick, 60 * 1000).unref();
  setTimeout(tick, 15 * 1000);
}

router.post('/messages/:id/reactions', async (req, res) => {
  const ctx = ownedMessage(req, res); if (!ctx) return;
  const db = getDb();
  const emoji = (req.body?.emoji || '').trim();
  if (!emoji) return res.status(400).json({ error: 'emoji is required' });
  db.prepare('INSERT OR IGNORE INTO chat_reactions (id, message_id, user_id, emoji) VALUES (?, ?, ?, ?)').run(uuid(), ctx.m.id, req.user.id, emoji);
  const updated = await serialize(db, db.prepare('SELECT * FROM chat_messages WHERE id = ?').get(ctx.m.id));
  emitToChannel(ctx.channel.id, 'message:update', updated);
  res.json(updated);
});

router.delete('/messages/:id/reactions/:emoji', async (req, res) => {
  const ctx = ownedMessage(req, res); if (!ctx) return;
  const db = getDb();
  db.prepare('DELETE FROM chat_reactions WHERE message_id = ? AND user_id = ? AND emoji = ?').run(ctx.m.id, req.user.id, decodeURIComponent(req.params.emoji));
  const updated = await serialize(db, db.prepare('SELECT * FROM chat_messages WHERE id = ?').get(ctx.m.id));
  emitToChannel(ctx.channel.id, 'message:update', updated);
  res.json(updated);
});

// ── Search ────────────────────────────────────────────────────────────────────
// FTS5 keyword search over messages, scoped to channels the caller can access.
// The channel access check is applied after ranking so private/DM content never
// leaks to non-members.
// Resolve a display channel name (DMs show the other participant).
function channelLabel(db, channel, me) {
  if (channel.kind !== 'dm') return channel.name;
  const others = db.prepare('SELECT user_id FROM chat_channel_members WHERE channel_id = ? AND user_id != ?').all(channel.id, me);
  return others.length ? others.map(o => userName(db, o.user_id)).join(', ') : userName(db, me);
}

// Turn ranked message ids into access-checked result rows (order preserved).
// noDms: "View as" previews exclude direct-message content entirely.
//
// MEMBERSHIP-SCOPED FOR EVERYONE, INCLUDING ADMINS. canAccess() grants admins
// every channel — that is for channel ADMINISTRATION, and using it here put
// the whole plant's DMs into an admin's search results (the same class of
// leak as the Activity feed's DM branch). A search result is READING, and
// membership is the read gate; an admin who needs to search a channel joins
// it, which is a deliberate act visible in the member list.
//
// `rank` is the position the retriever put it in — sorting by date has to be
// able to get back to "most relevant" without a second query.
function resultsFor(db, me, messageIds, limit = 40, noDms = false) {
  const out = [];
  for (const id of messageIds) {
    const m = db.prepare('SELECT * FROM chat_messages WHERE id = ? AND deleted_at IS NULL').get(id);
    if (!m) continue;
    const channel = getChannel(db, m.channel_id);
    if (!channel || !isMember(db, channel.id, me)) continue;
    if (noDms && channel.kind === 'dm') continue;
    out.push({
      id: m.id, channel_id: m.channel_id, channel_kind: channel.kind, channel_name: channelLabel(db, channel, me),
      user_id: m.user_id, user_name: userName(db, m.user_id), parent_id: m.parent_id || null,
      body: m.body, created_at: m.created_at, rank: out.length,
    });
    if (out.length >= limit) break;
  }
  return out;
}

// What the caller can narrow by, counted from the results they actually got —
// so the filter list never offers a channel or a person with nothing behind it.
function facetsFor(rows) {
  const byChannel = new Map();
  const byPerson = new Map();
  for (const r of rows) {
    const c = byChannel.get(r.channel_id)
      || { id: r.channel_id, name: r.channel_name, kind: r.channel_kind, count: 0 };
    c.count++; byChannel.set(r.channel_id, c);
    const p = byPerson.get(r.user_id) || { id: r.user_id, name: r.user_name, count: 0 };
    p.count++; byPerson.set(r.user_id, p);
  }
  const bySize = (a, b) => b.count - a.count || a.name.localeCompare(b.name);
  return {
    channels: [...byChannel.values()].sort(bySize),
    people: [...byPerson.values()].sort(bySize),
  };
}

/**
 * THE MEMBERSHIP SCOPE GOES IN THE QUERY, BEFORE THE CAP.
 *
 * This used to take the top 200 FTS matches across the WHOLE plant and let
 * `resultsFor` drop the inaccessible ones afterwards. For any common word that
 * silently ate the caller's own results: the global top 200 could be entirely
 * messages in channels they are not in, so a term with plenty of hits in their
 * own channels returned few or none — which reads exactly like "search only
 * works in some channels". Same class as the QuickBooks `MAXRESULTS 500` and
 * the `LIKE '%%'` bug: a limit applied before the filter that decides what
 * counts.
 *
 * `semanticHits` already bounded to member channels up front; keyword did not,
 * so the two modes disagreed about scope on exactly the words people search.
 * `resultsFor` still re-checks membership — that stays as the authority, this
 * is what makes the pool it is given the RIGHT 300 rows.
 */
function keywordHits(db, me, q, limit = 300) {
  const terms = q.split(/\s+/).filter(Boolean).map(t => `"${t.replace(/"/g, '')}"*`).join(' ');
  try {
    return db.prepare(`
      SELECT f.message_id FROM chat_messages_fts f
      JOIN chat_messages m ON m.id = f.message_id
      JOIN chat_channels c ON c.id = m.channel_id
      JOIN chat_channel_members cm ON cm.channel_id = m.channel_id AND cm.user_id = ?
      WHERE chat_messages_fts MATCH ? AND m.deleted_at IS NULL AND c.archived = 0
      ORDER BY rank LIMIT ?`)
      .all(me, terms, limit).map(h => h.message_id);
  } catch { return []; }
}

// Semantic retrieval: embed the query, cosine-rank message embeddings within
// the caller's MEMBER channels. Bounded up front so private/DM content never
// enters the ranking — for admins too; the old admin bypass here is what let
// an admin's search read other people's DMs (see resultsFor).
async function semanticHits(db, me, q, limit = 40) {
  const channels = db.prepare(`SELECT c.id FROM chat_channels c
    JOIN chat_channel_members m ON m.channel_id = c.id AND m.user_id = ?
    WHERE c.archived = 0`).all(me).map(c => c.id);
  if (!channels.length) return [];
  const [qvec] = await embed(q, 'query');
  if (!qvec) return [];
  const ph = channels.map(() => '?').join(',');
  const rows = db.prepare(`SELECT e.message_id, e.vector FROM chat_message_embeddings e
    JOIN chat_messages msg ON msg.id = e.message_id
    WHERE e.channel_id IN (${ph}) AND msg.deleted_at IS NULL`).all(...channels);
  const scored = rows.map(r => ({ id: r.message_id, score: cosineSim(qvec, blobToVector(r.vector)) }));
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map(s => s.id);
}

// FTS5 keyword search (default) or embedding-based semantic search (?mode=semantic).
//
// Retrieval is wider than what's returned so the narrowing happens over the
// whole hit set, not over a page of it: filter by channel/person/date, sort by
// relevance or date, then cut to a page. Facets are counted before the
// channel/person filters are applied so the filter list doesn't collapse to the
// one option you just picked.
const SEARCH_POOL = 300;   // access-checked rows to consider
const SEARCH_PAGE = 60;    // rows actually returned

router.get('/search', async (req, res) => {
  const db = getDb();
  const me = req.user.id;
  const q = (req.query.q || '').trim();
  const empty = { results: [], facets: { channels: [], people: [] }, total: 0, truncated: false };
  if (q.length < 2) return res.json(empty);
  try {
    const semantic = req.query.mode === 'semantic' && voyageEnabled();
    const ids = semantic ? await semanticHits(db, me, q, SEARCH_POOL) : keywordHits(db, me, q, SEARCH_POOL);
    const all = resultsFor(db, me, ids, SEARCH_POOL, !!req.impersonated);

    const facets = facetsFor(all);

    const { channel_id, user_id, from, to } = req.query;
    let rows = all;
    if (channel_id) rows = rows.filter(r => r.channel_id === channel_id);
    if (user_id) rows = rows.filter(r => r.user_id === user_id);
    // created_at is 'YYYY-MM-DD HH:MM:SS.mmm', so a plain string compare against
    // a date bound works — 'to' gets the whole day by comparing past midnight.
    if (from) rows = rows.filter(r => r.created_at >= from);
    if (to) rows = rows.filter(r => r.created_at <= `${to} 99`);

    const sort = req.query.sort || 'relevance';
    if (sort === 'newest') rows = [...rows].sort((a, b) => b.created_at.localeCompare(a.created_at));
    else if (sort === 'oldest') rows = [...rows].sort((a, b) => a.created_at.localeCompare(b.created_at));
    else rows = [...rows].sort((a, b) => a.rank - b.rank);

    res.json({
      results: rows.slice(0, SEARCH_PAGE),
      facets,
      total: rows.length,
      // The retriever itself capped out, so "312 results" would be a lie.
      truncated: all.length >= SEARCH_POOL,
    });
  } catch (e) {
    res.status(502).json({ error: e.message || 'Search failed' });
  }
});

// ── Ask (RAG over messages) ───────────────────────────────────────────────────
// Retrieve the most relevant accessible messages via embeddings and let the AI
// synthesize an answer. Membership-scoped: only messages the caller can see enter
// the context. Requires both Voyage (retrieval) and Anthropic (synthesis).
router.post('/ask', async (req, res) => {
  if (!voyageEnabled() || !aiEnabled()) return res.status(503).json({ error: 'Ask is not configured on this server.' });
  const db = getDb();
  const me = req.user.id;
  const question = (req.body?.question || '').trim();
  if (question.length < 3) return res.status(400).json({ error: 'A question is required.' });
  try {
    const ids = await semanticHits(db, me, question, 16);
    const sources = resultsFor(db, me, ids, 16);
    const answer = await summarizeChat({ question, contextMessages: sources });
    res.json({ answer, sources });
  } catch (e) {
    res.status(502).json({ error: e.message || 'Ask failed' });
  }
});

// ── Slack history import (Phase 5f, admin only) ───────────────────────────────
// Parse an export and return its channel list so the admin can choose which
// channels to restore as private before running the actual import.
router.post('/import/slack/preview', requireRole('admin'), zipUpload.single('file'), (req, res) => {
  if (!req.file?.buffer) return res.status(400).json({ error: 'A Slack export .zip is required' });
  try {
    res.json(previewSlackExport(req.file.buffer));
  } catch (e) {
    res.status(422).json({ error: e.message || 'Could not read this file. Is it a valid Slack export .zip?' });
  }
});

router.post('/import/slack', requireRole('admin'), zipUpload.single('file'), async (req, res) => {
  if (!req.file?.buffer) return res.status(400).json({ error: 'A Slack export .zip is required' });
  // private_channels: JSON array (or comma list) of channel names to make private.
  let privateChannels = [];
  const raw = req.body?.private_channels;
  if (Array.isArray(raw)) privateChannels = raw;
  else if (typeof raw === 'string' && raw.trim()) {
    try { const p = JSON.parse(raw); if (Array.isArray(p)) privateChannels = p; }
    catch { privateChannels = raw.split(',').map(s => s.trim()).filter(Boolean); }
  }
  // user_map: { slackId: existingUserId } — admin remaps for authors whose names
  // don't match (export was taken before display names were fixed).
  let userMap = {};
  const rawMap = req.body?.user_map;
  if (rawMap && typeof rawMap === 'string') { try { const m = JSON.parse(rawMap); if (m && typeof m === 'object') userMap = m; } catch { /* ignore */ } }
  else if (rawMap && typeof rawMap === 'object') userMap = rawMap;
  try {
    const summary = importSlackExport(req.file.buffer, req.user, { privateChannels, userMap });
    res.json(summary);
  } catch (e) {
    res.status(422).json({ error: e.message || 'Import failed. Is this a valid Slack export .zip?' });
  }
});

export default router;
