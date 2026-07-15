import { Router } from 'express';
import { v4 as uuid } from 'uuid';
import { getDb } from '../db.js';

const router = Router();

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
  res.status(201).json(getChannel(db, id));
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
  };
}

router.get('/channels/:id/messages', (req, res) => {
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
  res.json(rows.map(m => flattenMessage(db, m)));
});

router.post('/channels/:id/messages', (req, res) => {
  const channel = requireChannel(req, res); if (!channel) return;
  const db = getDb();
  const body = (req.body?.body || '').trim();
  if (!body) return res.status(400).json({ error: 'Message body is required' });
  const id = uuid();
  db.prepare('INSERT INTO chat_messages (id, channel_id, user_id, body, parent_id) VALUES (?, ?, ?, ?, ?)')
    .run(id, channel.id, req.user.id, body, req.body?.parent_id || null);
  db.prepare("UPDATE chat_channels SET updated_at = datetime('now') WHERE id = ?").run(channel.id);
  db.prepare("UPDATE chat_channel_members SET last_read_at = datetime('now') WHERE channel_id = ? AND user_id = ?").run(channel.id, req.user.id);
  res.status(201).json(flattenMessage(db, db.prepare('SELECT * FROM chat_messages WHERE id = ?').get(id)));
});

function ownedMessage(req, res) {
  const db = getDb();
  const m = db.prepare('SELECT * FROM chat_messages WHERE id = ?').get(req.params.id);
  if (!m) { res.status(404).json({ error: 'Message not found' }); return null; }
  const channel = getChannel(db, m.channel_id);
  if (!canAccess(db, channel, req.user.id)) { res.status(404).json({ error: 'Message not found' }); return null; }
  return { m, channel };
}

router.put('/messages/:id', (req, res) => {
  const ctx = ownedMessage(req, res); if (!ctx) return;
  const db = getDb();
  if (ctx.m.user_id !== req.user.id) return res.status(403).json({ error: 'You can only edit your own messages' });
  const body = (req.body?.body || '').trim();
  if (!body) return res.status(400).json({ error: 'Message body is required' });
  db.prepare("UPDATE chat_messages SET body = ?, edited_at = datetime('now') WHERE id = ?").run(body, ctx.m.id);
  res.json(flattenMessage(db, db.prepare('SELECT * FROM chat_messages WHERE id = ?').get(ctx.m.id)));
});

router.delete('/messages/:id', (req, res) => {
  const ctx = ownedMessage(req, res); if (!ctx) return;
  const db = getDb();
  if (ctx.m.user_id !== req.user.id && req.user.role !== 'admin') return res.status(403).json({ error: 'You can only delete your own messages' });
  db.prepare("UPDATE chat_messages SET deleted_at = datetime('now'), body = NULL WHERE id = ?").run(ctx.m.id);
  res.json({ ok: true });
});

// ── Reactions ─────────────────────────────────────────────────────────────────
router.post('/messages/:id/reactions', (req, res) => {
  const ctx = ownedMessage(req, res); if (!ctx) return;
  const db = getDb();
  const emoji = (req.body?.emoji || '').trim();
  if (!emoji) return res.status(400).json({ error: 'emoji is required' });
  db.prepare('INSERT OR IGNORE INTO chat_reactions (id, message_id, user_id, emoji) VALUES (?, ?, ?, ?)').run(uuid(), ctx.m.id, req.user.id, emoji);
  res.json(flattenMessage(db, db.prepare('SELECT * FROM chat_messages WHERE id = ?').get(ctx.m.id)));
});

router.delete('/messages/:id/reactions/:emoji', (req, res) => {
  const ctx = ownedMessage(req, res); if (!ctx) return;
  const db = getDb();
  db.prepare('DELETE FROM chat_reactions WHERE message_id = ? AND user_id = ? AND emoji = ?').run(ctx.m.id, req.user.id, decodeURIComponent(req.params.emoji));
  res.json(flattenMessage(db, db.prepare('SELECT * FROM chat_messages WHERE id = ?').get(ctx.m.id)));
});

export default router;
