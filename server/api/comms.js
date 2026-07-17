import { Router } from 'express';
import multer from 'multer';
import { v4 as uuid } from 'uuid';
import { getDb, logAudit } from '../db.js';
import { emitToChannel, emitChannelsChanged, emitChannelsRefresh, emitToUser } from '../realtime.js';
import { storageEnabled, putObject, presignGet, deleteObject } from '../storage.js';
import { voyageEnabled, embed, embeddingModel, vectorToBlob, blobToVector, cosineSim } from '../embeddings.js';
import { aiEnabled, summarizeChat, translateText } from '../ai.js';
import { pushEnabled, vapidPublicKey, pushToUser } from '../push.js';
import { importSlackExport, previewSlackExport } from '../slack-import.js';
import { requireRole } from '../middleware/auth.js';

const router = Router();

// Uploads are buffered in memory then streamed to R2. 25 MB/file, 10 files/msg.
const attachUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024, files: 10 } });
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
  db.prepare(`INSERT INTO chat_push_subscriptions (id, user_id, endpoint, p256dh, auth) VALUES (?, ?, ?, ?, ?)
              ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth`)
    .run(uuid(), req.user.id, s.endpoint, s.keys.p256dh, s.keys.auth);
  res.json({ ok: true });
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
  if (!channel || !canAccess(db, channel, req.user.id, req.user.role === 'admin')) { res.status(404).json({ error: 'Channel not found' }); return null; }
  return channel;
}

function userName(db, id) {
  return db.prepare('SELECT name FROM users WHERE id = ?').get(id)?.name || 'Unknown';
}

// ── Mentions ──────────────────────────────────────────────────────────────────
// Users who can be @mentioned in a channel are its members — a mention should
// never notify someone who can't see the channel. (Now that public channels are
// membership-gated too, this is uniform across kinds.)
function mentionCandidates(db, channel) {
  return db.prepare('SELECT u.id, u.name FROM chat_channel_members m JOIN users u ON u.id = m.user_id WHERE m.channel_id = ? AND u.is_active = 1').all(channel.id);
}
// Match "@<display name>" occurrences (autocomplete inserts full names, which may
// contain spaces). Longest names first so "@Ann Marie" wins over "@Ann".
function extractMentions(db, channel, body, authorId) {
  if (!body || !body.includes('@')) return [];
  const lower = body.toLowerCase();
  return mentionCandidates(db, channel)
    .filter(u => u.id !== authorId)
    .sort((a, b) => b.name.length - a.name.length)
    .filter(u => lower.includes('@' + u.name.toLowerCase()));
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
  if (!recipients.length) return;
  const ins = db.prepare('INSERT INTO chat_mentions (id, message_id, channel_id, user_id) VALUES (?, ?, ?, ?)');
  const label = channel.kind === 'public' ? `#${channel.name}` : (channel.name || 'a channel');
  const broadcast = hasBroadcast(body);
  for (const u of recipients) {
    ins.run(uuid(), messageId, channel.id, u.id);
    emitToUser(u.id, 'mention', { channel_id: channel.id, message_id: messageId, from: author.name, preview: body.slice(0, 140), broadcast });
    const title = broadcast ? `${author.name} notified ${label}` : `${author.name} mentioned you in ${label}`;
    pushToUser(u.id, { title, body: body.slice(0, 140), tag: `mention-${messageId}`, url: '/' }).catch(() => {});
  }
}

// ── Channels ──────────────────────────────────────────────────────────────────
// List channels the user can see: all public + private/DMs they belong to, each
// with an unread count and (for DMs) the other participant's name.
router.get('/channels', (req, res) => {
  const db = getDb();
  const me = req.user.id;
  // Admins see every channel (to administer); everyone else only sees channels
  // they're a member of.
  const isAdmin = req.user.role === 'admin';
  const rows = db.prepare(`
    SELECT c.*, m.last_read_at, m.id AS membership_id
    FROM chat_channels c
    LEFT JOIN chat_channel_members m ON m.channel_id = c.id AND m.user_id = ?
    WHERE c.archived = 0 AND (${isAdmin ? "c.kind != 'dm' OR m.user_id IS NOT NULL" : 'm.user_id IS NOT NULL'})
    ORDER BY c.is_default DESC, c.kind, c.name
  `).all(me);

  const out = rows.map(c => {
    const unread = db.prepare(
      `SELECT COUNT(*) n FROM chat_messages WHERE channel_id = ? AND deleted_at IS NULL AND user_id != ?
       AND (? IS NULL OR created_at > ?)`
    ).get(c.id, me, c.last_read_at, c.last_read_at).n;
    // Unread @mentions of me in this channel (drives a distinct badge).
    const mentions = db.prepare(
      `SELECT COUNT(*) n FROM chat_mentions mn JOIN chat_messages msg ON msg.id = mn.message_id
       WHERE mn.channel_id = ? AND mn.user_id = ? AND msg.deleted_at IS NULL
       AND (? IS NULL OR msg.created_at > ?)`
    ).get(c.id, me, c.last_read_at, c.last_read_at).n;

    let display = c.name, other = null;
    if (c.kind === 'dm') {
      const others = db.prepare('SELECT user_id FROM chat_channel_members WHERE channel_id = ? AND user_id != ?').all(c.id, me);
      other = others[0]?.user_id || me;
      display = userName(db, other);
    }
    return {
      id: c.id, kind: c.kind, name: display, topic: c.topic,
      is_member: !!c.membership_id, unread, mentions, other_user_id: other,
      post_policy: c.post_policy || 'all', is_default: !!c.is_default,
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
    SELECT m.user_id, m.role, u.name FROM chat_channel_members m JOIN users u ON u.id = m.user_id WHERE m.channel_id = ? ORDER BY u.name
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
    SELECT c.id, c.kind, c.name, c.topic, c.archived, c.created_at, c.post_policy, c.is_default,
      (SELECT COUNT(*) FROM chat_channel_members m WHERE m.channel_id = c.id) AS member_count,
      (SELECT COUNT(*) FROM chat_messages msg WHERE msg.channel_id = c.id AND msg.deleted_at IS NULL) AS message_count,
      (SELECT MAX(created_at) FROM chat_messages msg WHERE msg.channel_id = c.id AND msg.deleted_at IS NULL) AS last_activity,
      (SELECT COUNT(*) FROM chat_messages msg WHERE msg.channel_id = c.id AND msg.deleted_at IS NULL AND msg.created_at >= datetime('now','-30 days')) AS recent_count
    FROM chat_channels c
    WHERE c.kind != 'dm'
    ORDER BY c.is_default DESC, c.archived, c.kind, c.name`).all();
  res.json(rows);
});

// Mark every channel the caller can see as read up to now (clears their unread
// badges — handy right after a bulk history import).
router.post('/read-all', (req, res) => {
  const db = getDb();
  const me = req.user.id;
  const now = new Date().toISOString();
  // Update existing memberships…
  db.prepare('UPDATE chat_channel_members SET last_read_at = ? WHERE user_id = ?').run(now, me);
  // …and create read-markers for public channels the user hasn't joined yet.
  const missing = db.prepare(`SELECT c.id FROM chat_channels c
    WHERE c.kind = 'public' AND c.archived = 0
      AND NOT EXISTS (SELECT 1 FROM chat_channel_members m WHERE m.channel_id = c.id AND m.user_id = ?)`).all(me);
  const ins = db.prepare('INSERT OR IGNORE INTO chat_channel_members (id, channel_id, user_id, role, last_read_at) VALUES (?, ?, ?, ?, ?)');
  for (const c of missing) ins.run(uuid(), c.id, me, 'member', now);
  res.json({ ok: true });
});

// Admin: clear the import-driven unread backlog for EVERYONE by marking all
// memberships read as of now. One-shot cleanup after a big import.
router.post('/admin/reset-unread', requireRole('admin'), (req, res) => {
  const db = getDb();
  const info = db.prepare("UPDATE chat_channel_members SET last_read_at = datetime('now')").run();
  logAudit(req.user, 'reset_unread', 'comms', null, { memberships: info.changes });
  res.json({ ok: true, memberships: info.changes });
});

// ── Channel administration (admin only) ──────────────────────────────────────
// Rename, change privacy (public ↔ private), edit topic, or archive/unarchive.
router.put('/channels/:id', requireRole('admin'), (req, res) => {
  const db = getDb();
  const channel = getChannelAny(db, req.params.id);
  if (!channel) return res.status(404).json({ error: 'Channel not found' });
  if (channel.kind === 'dm') return res.status(400).json({ error: 'Direct messages cannot be edited' });
  const { name, kind, topic, archived, post_policy } = req.body;
  const newKind = kind === 'private' ? 'private' : kind === 'public' ? 'public' : channel.kind;
  const newPolicy = post_policy === 'admins' ? 'admins' : post_policy === 'all' ? 'all' : (channel.post_policy || 'all');
  let cleanName = channel.name;
  if (name !== undefined && name !== null && String(name).trim()) {
    cleanName = String(name).trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '') || channel.name;
  }
  db.prepare(`UPDATE chat_channels SET name = ?, kind = ?, topic = ?, archived = ?, post_policy = ?, updated_at = datetime('now') WHERE id = ?`)
    .run(cleanName, newKind, topic !== undefined ? (topic || null) : channel.topic,
      archived !== undefined ? (archived ? 1 : 0) : channel.archived, newPolicy, channel.id);
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
  for (const a of atts) deleteObject(a.storage_key);
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
  emitChannelsRefresh();
  res.json({ deleted: channel.id });
});

// Remove a member from a private channel.
router.delete('/channels/:id/members/:userId', requireRole('admin'), (req, res) => {
  const db = getDb();
  const channel = getChannelAny(db, req.params.id);
  if (!channel) return res.status(404).json({ error: 'Channel not found' });
  const info = db.prepare('DELETE FROM chat_channel_members WHERE channel_id = ? AND user_id = ?').run(channel.id, req.params.userId);
  if (info.changes) emitChannelsRefresh();
  res.json({ removed: info.changes });
});

// Mark a channel read up to now.
router.post('/channels/:id/read', (req, res) => {
  const channel = requireChannel(req, res); if (!channel) return;
  const db = getDb();
  const now = new Date().toISOString();
  const info = db.prepare("UPDATE chat_channel_members SET last_read_at = ? WHERE channel_id = ? AND user_id = ?").run(now, channel.id, req.user.id);
  // Public channels the user hasn't joined have no membership row — create one lazily so reads track.
  if (info.changes === 0 && channel.kind === 'public') {
    db.prepare('INSERT OR IGNORE INTO chat_channel_members (id, channel_id, user_id, role, last_read_at) VALUES (?, ?, ?, ?, ?)')
      .run(uuid(), channel.id, req.user.id, 'member', now);
  }
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
    db.prepare("INSERT INTO chat_channels (id, kind, dm_key, created_by) VALUES (?, 'dm', ?, ?)").run(id, key, req.user.id);
    const add = db.prepare('INSERT OR IGNORE INTO chat_channel_members (id, channel_id, user_id, role) VALUES (?, ?, ?, ?)');
    add.run(uuid(), id, req.user.id, 'member');
    add.run(uuid(), id, other, 'member');
    channel = getChannel(db, id);
    emitChannelsChanged(db, channel); // let the other participant see the new DM
  }
  res.status(201).json({ id: channel.id, kind: 'dm', name: userName(db, other), other_user_id: other });
});

// ── Messages ──────────────────────────────────────────────────────────────────
function flattenMessage(db, m) {
  const reactions = db.prepare('SELECT emoji, user_id FROM chat_reactions WHERE message_id = ?').all(m.id);
  const grouped = {};
  for (const r of reactions) { (grouped[r.emoji] ||= []).push(r.user_id); }
  return {
    id: m.id, channel_id: m.channel_id, user_id: m.user_id, user_name: userName(db, m.user_id),
    body: m.deleted_at ? null : m.body, parent_id: m.parent_id,
    edited: !!m.edited_at, deleted: !!m.deleted_at, created_at: m.created_at,
    reactions: Object.entries(grouped).map(([emoji, users]) => ({ emoji, count: users.length, users })),
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
    url: await presignGet(a.storage_key, a.filename),
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
  db.prepare('INSERT INTO chat_messages (id, channel_id, user_id, body, parent_id) VALUES (?, ?, ?, ?, ?)')
    .run(id, channel.id, req.user.id, body || null, req.body?.parent_id || null);
  // Link only the caller's own still-unattached uploads for this channel.
  const link = db.prepare('UPDATE chat_attachments SET message_id = ? WHERE id = ? AND channel_id = ? AND user_id = ? AND message_id IS NULL');
  for (const aid of attachmentIds) link.run(id, aid, channel.id, req.user.id);
  db.prepare("UPDATE chat_channels SET updated_at = datetime('now') WHERE id = ?").run(channel.id);
  db.prepare("UPDATE chat_channel_members SET last_read_at = datetime('now') WHERE channel_id = ? AND user_id = ?").run(channel.id, req.user.id);
  const message = await serialize(db, db.prepare('SELECT * FROM chat_messages WHERE id = ?').get(id));
  emitToChannel(channel.id, 'message:new', message);
  emitChannelsChanged(db, channel);
  recordMentions(db, channel, id, body, req.user);
  // DMs push to the other participant (mentions already push above).
  if (channel.kind === 'dm' && body) {
    const other = db.prepare('SELECT user_id FROM chat_channel_members WHERE channel_id = ? AND user_id != ?').get(channel.id, req.user.id);
    if (other) pushToUser(other.user_id, { title: `Message from ${req.user.name}`, body: body.slice(0, 140), tag: `dm-${channel.id}`, url: '/' }).catch(() => {});
  }
  embedMessage(db, id, channel.id, body); // fire-and-forget
  res.status(201).json(message);
});

// ── Attachments ─────────────────────────────────────────────────────────────
// Upload one or more files to a channel; they stay unlinked until a message
// references them via attachment_ids. Storage-gated.
router.post('/channels/:id/attachments', attachUpload.array('files', 10), async (req, res) => {
  if (!storageEnabled()) return res.status(503).json({ error: 'File uploads are not configured on this server.' });
  const channel = requireChannel(req, res); if (!channel) return;
  const db = getDb();
  const files = req.files || [];
  if (!files.length) return res.status(400).json({ error: 'No files uploaded' });
  const out = [];
  for (const f of files) {
    const id = uuid();
    const safe = (f.originalname || 'file').replace(/[^\w.-]+/g, '_').slice(0, 120);
    const key = `chat/${channel.id}/${id}-${safe}`;
    await putObject(key, f.buffer, f.mimetype);
    db.prepare('INSERT INTO chat_attachments (id, message_id, channel_id, user_id, filename, content_type, size, storage_key) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(id, null, channel.id, req.user.id, (f.originalname || 'file').slice(0, 255), f.mimetype || null, f.size || null, key);
    out.push({ id, filename: f.originalname, content_type: f.mimetype, size: f.size, is_image: (f.mimetype || '').startsWith('image/') });
  }
  res.status(201).json(out);
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
  if (ctx.m.user_id !== req.user.id && req.user.role !== 'admin') return res.status(403).json({ error: 'You can only delete your own messages' });
  db.prepare("UPDATE chat_messages SET deleted_at = datetime('now'), body = NULL WHERE id = ?").run(ctx.m.id);
  // Purge any attached objects from storage; drop their rows.
  const atts = db.prepare('SELECT storage_key FROM chat_attachments WHERE message_id = ?').all(ctx.m.id);
  for (const a of atts) deleteObject(a.storage_key);
  db.prepare('DELETE FROM chat_attachments WHERE message_id = ?').run(ctx.m.id);
  db.prepare('DELETE FROM chat_message_embeddings WHERE message_id = ?').run(ctx.m.id);
  db.prepare('DELETE FROM chat_message_translations WHERE message_id = ?').run(ctx.m.id);
  db.prepare('DELETE FROM chat_mentions WHERE message_id = ?').run(ctx.m.id);
  emitToChannel(ctx.channel.id, 'message:update', await serialize(db, db.prepare('SELECT * FROM chat_messages WHERE id = ?').get(ctx.m.id)));
  res.json({ ok: true });
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
    res.status(502).json({ error: e.message || 'Translation failed' });
  }
});

// ── Reactions ─────────────────────────────────────────────────────────────────
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
  const other = db.prepare('SELECT user_id FROM chat_channel_members WHERE channel_id = ? AND user_id != ?').get(channel.id, me);
  return userName(db, other?.user_id || me);
}

// Turn ranked message ids into access-checked result rows (order preserved).
function resultsFor(db, me, messageIds, limit = 40, isAdmin = false) {
  const out = [];
  for (const id of messageIds) {
    const m = db.prepare('SELECT * FROM chat_messages WHERE id = ? AND deleted_at IS NULL').get(id);
    if (!m) continue;
    const channel = getChannel(db, m.channel_id);
    if (!canAccess(db, channel, me, isAdmin)) continue;
    out.push({
      id: m.id, channel_id: m.channel_id, channel_kind: channel.kind, channel_name: channelLabel(db, channel, me),
      user_name: userName(db, m.user_id), body: m.body, created_at: m.created_at,
    });
    if (out.length >= limit) break;
  }
  return out;
}

function keywordHits(db, q) {
  const terms = q.split(/\s+/).filter(Boolean).map(t => `"${t.replace(/"/g, '')}"*`).join(' ');
  try {
    return db.prepare('SELECT message_id FROM chat_messages_fts WHERE chat_messages_fts MATCH ? ORDER BY rank LIMIT 200')
      .all(terms).map(h => h.message_id);
  } catch { return []; }
}

// Semantic retrieval: embed the query, cosine-rank message embeddings within the
// caller's accessible channels. Bounded to accessible channels up front so
// private/DM content never enters the ranking for a non-member.
async function semanticHits(db, me, q, limit = 40, isAdmin = false) {
  const channels = db.prepare(`SELECT c.id FROM chat_channels c
    LEFT JOIN chat_channel_members m ON m.channel_id = c.id AND m.user_id = ?
    WHERE c.archived = 0 AND (${isAdmin ? '1=1' : 'm.user_id IS NOT NULL'})`).all(me).map(c => c.id);
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
router.get('/search', async (req, res) => {
  const db = getDb();
  const me = req.user.id;
  const q = (req.query.q || '').trim();
  if (q.length < 2) return res.json([]);
  try {
    const isAdmin = req.user.role === 'admin';
    const semantic = req.query.mode === 'semantic' && voyageEnabled();
    const ids = semantic ? await semanticHits(db, me, q, 40, isAdmin) : keywordHits(db, q);
    res.json(resultsFor(db, me, ids, 40, isAdmin));
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
    const isAdmin = req.user.role === 'admin';
    const ids = await semanticHits(db, me, question, 16, isAdmin);
    const sources = resultsFor(db, me, ids, 16, isAdmin);
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
