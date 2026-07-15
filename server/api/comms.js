import { Router } from 'express';
import multer from 'multer';
import { v4 as uuid } from 'uuid';
import { getDb } from '../db.js';
import { emitToChannel, emitChannelsChanged } from '../realtime.js';
import { storageEnabled, putObject, presignGet, deleteObject } from '../storage.js';
import { voyageEnabled, embed, embeddingModel, vectorToBlob, blobToVector, cosineSim } from '../embeddings.js';
import { aiEnabled, summarizeChat } from '../ai.js';

const router = Router();

// Uploads are buffered in memory then streamed to R2. 25 MB/file, 10 files/msg.
const attachUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024, files: 10 } });

// Feature flags for the client (uploads / semantic / ask require optional config).
router.get('/status', (_req, res) => {
  res.json({ storage: storageEnabled(), semantic: voyageEnabled(), ask: aiEnabled() && voyageEnabled() });
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
function isMember(db, channelId, userId) {
  return !!db.prepare('SELECT 1 FROM chat_channel_members WHERE channel_id = ? AND user_id = ?').get(channelId, userId);
}
function canAccess(db, channel, userId) {
  if (!channel) return false;
  if (channel.kind === 'public') return true;
  return isMember(db, channel.id, userId);
}
// Resolve a channel and enforce access in one step; sends 404 if not allowed
// (private channels are hidden, not "forbidden", to avoid leaking existence).
function requireChannel(req, res) {
  const db = getDb();
  const channel = getChannel(db, req.params.id || req.params.channelId);
  if (!channel || !canAccess(db, channel, req.user.id)) { res.status(404).json({ error: 'Channel not found' }); return null; }
  return channel;
}

function userName(db, id) {
  return db.prepare('SELECT name FROM users WHERE id = ?').get(id)?.name || 'Unknown';
}

// ── Channels ──────────────────────────────────────────────────────────────────
// List channels the user can see: all public + private/DMs they belong to, each
// with an unread count and (for DMs) the other participant's name.
router.get('/channels', (req, res) => {
  const db = getDb();
  const me = req.user.id;
  const rows = db.prepare(`
    SELECT c.*, m.last_read_at, m.id AS membership_id
    FROM chat_channels c
    LEFT JOIN chat_channel_members m ON m.channel_id = c.id AND m.user_id = ?
    WHERE c.archived = 0 AND (c.kind = 'public' OR m.user_id IS NOT NULL)
    ORDER BY c.kind, c.name
  `).all(me);

  const out = rows.map(c => {
    const unread = db.prepare(
      `SELECT COUNT(*) n FROM chat_messages WHERE channel_id = ? AND deleted_at IS NULL AND user_id != ?
       AND (? IS NULL OR created_at > ?)`
    ).get(c.id, me, c.last_read_at, c.last_read_at).n;

    let display = c.name, other = null;
    if (c.kind === 'dm') {
      const others = db.prepare('SELECT user_id FROM chat_channel_members WHERE channel_id = ? AND user_id != ?').all(c.id, me);
      other = others[0]?.user_id || me;
      display = userName(db, other);
    }
    return {
      id: c.id, kind: c.kind, name: display, topic: c.topic,
      is_member: !!c.membership_id, unread, other_user_id: other,
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
  const channel = requireChannel(req, res); if (!channel) return;
  const db = getDb();
  const members = db.prepare(`
    SELECT m.user_id, m.role, u.name FROM chat_channel_members m JOIN users u ON u.id = m.user_id WHERE m.channel_id = ? ORDER BY u.name
  `).all(channel.id);
  res.json({ ...channel, members });
});

router.post('/channels/:id/members', (req, res) => {
  const channel = requireChannel(req, res); if (!channel) return;
  const db = getDb();
  const ids = Array.isArray(req.body?.user_ids) ? req.body.user_ids : [];
  const add = db.prepare('INSERT OR IGNORE INTO chat_channel_members (id, channel_id, user_id, role) VALUES (?, ?, ?, ?)');
  let added = 0;
  for (const uid of ids) added += add.run(uuid(), channel.id, uid, 'member').changes;
  if (added) emitChannelsChanged(db, channel);
  res.json({ added });
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
    const safe = (f.originalname || 'file').replace(/[^\w.\-]+/g, '_').slice(0, 120);
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
  emitToChannel(ctx.channel.id, 'message:update', await serialize(db, db.prepare('SELECT * FROM chat_messages WHERE id = ?').get(ctx.m.id)));
  res.json({ ok: true });
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
function resultsFor(db, me, messageIds, limit = 40) {
  const out = [];
  for (const id of messageIds) {
    const m = db.prepare('SELECT * FROM chat_messages WHERE id = ? AND deleted_at IS NULL').get(id);
    if (!m) continue;
    const channel = getChannel(db, m.channel_id);
    if (!canAccess(db, channel, me)) continue;
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
async function semanticHits(db, me, q, limit = 40) {
  const channels = db.prepare(`SELECT c.id FROM chat_channels c
    LEFT JOIN chat_channel_members m ON m.channel_id = c.id AND m.user_id = ?
    WHERE c.archived = 0 AND (c.kind = 'public' OR m.user_id IS NOT NULL)`).all(me).map(c => c.id);
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
    const semantic = req.query.mode === 'semantic' && voyageEnabled();
    const ids = semantic ? await semanticHits(db, me, q) : keywordHits(db, q);
    res.json(resultsFor(db, me, ids));
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

export default router;
