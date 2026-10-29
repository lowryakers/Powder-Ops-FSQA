// The screen's half of the activity log (D-261): which page a person opened, and
// files opened through a stored link the server never sees fetched. Everything
// else (sign-ins, edits, record views, downloads from /api) is recorded by the
// server where it happens.
//
// BATCHED so a page change costs nothing: events wait in memory and go in one
// request every 15 seconds, at 20 events, or when the tab is hidden or closed
// (`keepalive`, so the last page of a visit is not lost). The same page twice in
// a row is one event. Nothing is retried and nothing is queued offline — a lost
// page view is not worth a stuck outbox.
//
// Never sent: a query string (a link's token lives there) or a file's contents.

const MAX_BATCH = 20;
const FLUSH_MS = 15000;
let queue = [];
let timer = null;
let lastPage = null;
let listening = false;

const strip = (s) => String(s || '').split('?')[0].split('#')[0].slice(0, 200);

function send({ closing = false } = {}) {
  if (timer) { clearTimeout(timer); timer = null; }
  if (!queue.length) return;
  let token = null;
  try { token = localStorage.getItem('auth_token'); } catch { /* private mode */ }
  const events = queue.splice(0, 50);
  if (!token) return;
  // On the way out, a beacon: the browser delivers it after the page is gone,
  // where a fetch is cancelled with the page. It cannot carry a header, so the
  // session token goes in the body (POST /api/user-activity/beacon checks it).
  if (closing && navigator.sendBeacon) {
    try {
      if (navigator.sendBeacon('/api/user-activity/beacon', new Blob([JSON.stringify({ token, events })], { type: 'text/plain' }))) {
        if (queue.length) send({ closing });
        return;
      }
    } catch { /* fall through to fetch */ }
  }
  try {
    fetch('/api/user-activity/events', {
      method: 'POST',
      keepalive: closing,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ events }),
    }).catch(() => { /* a page view is not worth an error */ });
  } catch { /* fetch unavailable */ }
  if (queue.length) send({ closing });
}

function listen() {
  if (listening || typeof window === 'undefined') return;
  listening = true;
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') send({ closing: true }); });
  window.addEventListener('pagehide', () => send({ closing: true }));
}

function push(event) {
  listen();
  queue.push({ ...event, at: new Date().toISOString() });
  if (queue.length >= MAX_BATCH) send();
  else if (!timer) timer = setTimeout(() => send(), FLUSH_MS);
}

/** A page (module, and the tab inside it) was opened. */
export function logPageView(page, view = null) {
  const p = strip(page);
  if (!p) return;
  const key = `${p}|${view || ''}`;
  if (key === lastPage) return;
  lastPage = key;
  push({ type: 'page_view', page: p, ...(view ? { view: strip(view) } : {}) });
}

/** A file was opened from a link the server hands out (a stored or blob: url). */
export function logFileOpen(url, name, type = 'file_open') {
  const path = (() => {
    try {
      const u = new URL(url, window.location.href);
      // /api urls are seen — and recorded — by the server already.
      if (u.origin === window.location.origin && u.pathname.startsWith('/api/')) return null;
      return u.origin === window.location.origin ? u.pathname : (u.protocol === 'blob:' ? 'blob' : u.host);
    } catch { return null; }
  })();
  if (path === null) return;
  push({ type, page: strip(path), name: strip(name || '').split('/').pop() || null });
}

/** Send what is waiting now (sign-out). */
export function flushActivityLog() { send({ closing: true }); }

/** Tests only. */
export function _pending() { return queue.slice(); }
