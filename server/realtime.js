import { Server } from 'socket.io';
import { getDb } from './db.js';

// ── Realtime layer (Comms Phase 2) ────────────────────────────────────────────
// A thin socket.io wrapper that pushes chat events to connected clients, replacing
// the Phase 1 polling. Auth reuses the session bearer token; sockets join a
// per-channel room (access-checked) so messages only reach members. A single
// Railway instance means the default in-memory adapter is sufficient — a Redis
// adapter would only be needed to scale beyond one process.

let io = null;

const channelRoom = (id) => `channel:${id}`;
const userRoom = (id) => `user:${id}`;

// Resolve a session token to a user (same shape the REST auth middleware uses).
function userForToken(token) {
  if (!token) return null;
  const db = getDb();
  const row = db.prepare(`
    SELECT u.id, u.name, u.role FROM sessions s JOIN users u ON s.user_id = u.id
    WHERE s.token = ? AND s.expires_at > datetime('now') AND u.is_active = 1
  `).get(token);
  return row || null;
}

// Mirror of comms.canAccess: public channels are open; private/DM require membership.
function canAccess(db, channelId, userId) {
  const channel = db.prepare('SELECT * FROM chat_channels WHERE id = ? AND archived = 0').get(channelId);
  if (!channel) return false;
  if (channel.kind === 'public') return true;
  return !!db.prepare('SELECT 1 FROM chat_channel_members WHERE channel_id = ? AND user_id = ?').get(channelId, userId);
}

export function initRealtime(httpServer) {
  io = new Server(httpServer, {
    path: '/socket.io',
    cors: { origin: true, credentials: true },
    serveClient: false,
  });

  // Handshake auth — reject sockets without a valid session token.
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token || socket.handshake.headers?.authorization?.replace(/^Bearer /, '');
    const user = userForToken(token);
    if (!user) return next(new Error('unauthorized'));
    socket.data.user = user;
    next();
  });

  io.on('connection', (socket) => {
    const user = socket.data.user;
    socket.join(userRoom(user.id)); // personal room for channel-list nudges

    // Client asks to stream a channel; verify access before joining its room.
    socket.on('channel:join', (channelId) => {
      if (typeof channelId !== 'string') return;
      if (canAccess(getDb(), channelId, user.id)) socket.join(channelRoom(channelId));
    });
    socket.on('channel:leave', (channelId) => {
      if (typeof channelId === 'string') socket.leave(channelRoom(channelId));
    });

    // Lightweight typing indicator — broadcast to the room, never persisted.
    socket.on('typing', (channelId) => {
      if (typeof channelId !== 'string') return;
      if (socket.rooms.has(channelRoom(channelId))) {
        socket.to(channelRoom(channelId)).emit('typing', { channel_id: channelId, user_id: user.id, user_name: user.name });
      }
    });
  });

  return io;
}

// ── Emit helpers (called from the REST handlers) ──────────────────────────────
export function emitToChannel(channelId, event, payload) {
  io?.to(channelRoom(channelId)).emit(event, payload);
}

// Emit an event to a single user's personal room (all their connected tabs).
export function emitToUser(userId, event, payload) {
  io?.to(userRoom(userId)).emit(event, payload);
}

// Nudge affected users to refresh their channel list (unread counts / ordering).
// Public channel activity reaches everyone; private/DM only its members.
export function emitChannelsChanged(db, channel) {
  if (!io) return;
  if (channel.kind === 'public') {
    io.emit('channels:changed', { channel_id: channel.id });
  } else {
    const members = db.prepare('SELECT user_id FROM chat_channel_members WHERE channel_id = ?').all(channel.id);
    for (const m of members) io.to(userRoom(m.user_id)).emit('channels:changed', { channel_id: channel.id });
  }
}

// Tell every connected client to refresh its channel list. Used for admin
// channel-management ops (rename, privacy change, archive/delete) where the
// visibility set can change for anyone.
export function emitChannelsRefresh() {
  if (io) io.emit('channels:changed', {});
}
