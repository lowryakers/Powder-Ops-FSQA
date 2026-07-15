import { io } from 'socket.io-client';

// Single shared socket.io connection for the Comms realtime layer (Phase 2).
// Auth reuses the session bearer token; the connection is same-origin so it
// rides the existing HTTP server with no extra config in production.
let socket = null;

export function getSocket() {
  const token = localStorage.getItem('auth_token');
  if (!socket) {
    socket = io({ path: '/socket.io', auth: { token }, transports: ['websocket', 'polling'] });
  } else if (socket.auth?.token !== token) {
    socket.auth = { token };
    if (!socket.connected) socket.connect();
  }
  return socket;
}

export function disconnectSocket() {
  if (socket) { socket.disconnect(); socket = null; }
}
