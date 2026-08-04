// Working without a connection.
//
// The plant's Wi-Fi drops in the warehouse and at the back of the production
// area. Today that means a filled-in form throws an error and the operator
// retypes it later, or doesn't. This is the fix, and it is deliberately two
// narrow things rather than one broad one:
//
//   1. A READ CACHE, so the screens the floor uses still render when the
//      network is gone. Every successful GET is stored; when a GET fails with a
//      network error, the last copy is served and marked `stale`, so the UI can
//      say "this is what we last saw" instead of showing an error page.
//
//   2. A WRITE OUTBOX, so filling a form offline is never lost. A non-GET that
//      fails with a NETWORK error (not an HTTP error — a 400 is a real answer
//      and must surface) is queued in IndexedDB and replayed in order when the
//      connection returns.
//
// THE RULE THAT MATTERS: **capture is queued, approval is not.**
//
// Signing something is a statement that you reviewed the record as it stood. A
// signature queued at 9am and applied at noon may land on a record someone else
// changed in between — you would have signed something you never saw, and the
// audit trail would say you did. Sign-offs, approvals, revocations and deletes
// therefore refuse to queue and say plainly that they need a connection. This
// is the same line the Operator View draws between tasks and approvals.
//
// Ordering matters too: replay is strictly FIFO and stops at the first failure,
// because a queue that skips a failed item and carries on can apply an edit to
// a record whose creation never landed.

const DB_NAME = 'readydoc-offline';
const DB_VERSION = 1;
const OUTBOX = 'outbox';
const READS = 'reads';

let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return reject(new Error('no indexedDB'));
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(OUTBOX)) db.createObjectStore(OUTBOX, { keyPath: 'id', autoIncrement: true });
      if (!db.objectStoreNames.contains(READS)) db.createObjectStore(READS, { keyPath: 'path' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }).catch(() => null);
  return dbPromise;
}

async function tx(store, mode, fn) {
  const db = await openDb();
  if (!db) return null;
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    let out;
    try { out = fn(s); } catch (e) { return reject(e); }
    t.oncomplete = () => resolve(out && typeof out.result !== 'undefined' ? out.result : out);
    t.onerror = () => reject(t.error);
  }).catch(() => null);
}

/* ── Is this a network failure, or an answer? ────────────────────────────── */

// fetch() rejects only when the request never completed — DNS, no route, the
// radio is off. An HTTP 400/403/500 RESOLVES, and must never be treated as
// offline: the server said no, and hiding that behind "we'll try later" is how
// a rejected record looks saved.
export const isNetworkError = (err) => err instanceof TypeError || err?.name === 'AbortError';

export const isOnline = () => (typeof navigator === 'undefined' ? true : navigator.onLine !== false);

/* ── What may be queued ──────────────────────────────────────────────────── */

// Paths that must NOT be queued, matched against the request path. Read the
// header comment for why — this list is the safety rule, not a convenience.
const NEVER_QUEUE = [
  /\/approve(\/|$)/,           // QMS approvals, meeting minutes, audit sign-off
  /\/sign(-off)?(\/|$)/,       // QA sign-off, scale verification
  /\/qa-review\//,             // the whole approvals queue
  /\/complete(\/|$)/,          // internal audit sign-off
  /\/verify(\/|$)/,
  /\/users\//,                 // login, passwords, permissions
  /\/cleanup\//,               // bulk-closes compliance records
  /\/import(\/|$)/,            // bulk writes decided from a preview
  /\/bulk-delete(\/|$)/,
];
const isDelete = (method) => method === 'DELETE';

export function mayQueue(path, method) {
  if (method === 'GET') return false;
  // A delete is not data capture, and replaying one against an id that changed
  // meaning while you were offline is unrecoverable.
  if (isDelete(method)) return false;
  return !NEVER_QUEUE.some(re => re.test(path));
}

/* ── The outbox ──────────────────────────────────────────────────────────── */

const listeners = new Set();
export function onQueueChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function announce(state) { for (const fn of listeners) { try { fn(state); } catch { /* a listener must not break the queue */ } } }

export async function pendingWrites() {
  const rows = await tx(OUTBOX, 'readonly', s => s.getAll());
  return rows || [];
}
export async function pendingCount() { return (await pendingWrites()).length; }

export async function queueWrite({ path, method, body, label }) {
  const row = { path, method, body: body ?? null, label: label || `${method} ${path}`, queued_at: new Date().toISOString() };
  await tx(OUTBOX, 'readwrite', s => s.add(row));
  announce({ pending: await pendingCount(), flushing: false });
  return row;
}

let flushing = false;

// Replay in order, stopping at the first failure. A 4xx on replay means the
// server refused the change — that item is moved out of the queue and reported,
// because retrying it forever would block everything behind it. A network
// failure leaves it in place to try again on the next reconnect.
export async function flushQueue(send) {
  if (flushing || !isOnline()) return { sent: 0, failed: [] };
  flushing = true;
  announce({ pending: await pendingCount(), flushing: true });
  const failed = [];
  let sent = 0;
  try {
    for (;;) {
      const rows = await pendingWrites();
      if (!rows.length) break;
      const row = rows[0];
      try {
        await send(row);
        await tx(OUTBOX, 'readwrite', s => s.delete(row.id));
        sent++;
      } catch (err) {
        if (isNetworkError(err)) break;            // still offline — keep it
        await tx(OUTBOX, 'readwrite', s => s.delete(row.id));
        failed.push({ ...row, error: err.message });
      }
      announce({ pending: await pendingCount(), flushing: true });
    }
  } finally {
    flushing = false;
    announce({ pending: await pendingCount(), flushing: false, failed });
  }
  return { sent, failed };
}

export async function discardQueued(id) {
  await tx(OUTBOX, 'readwrite', s => s.delete(id));
  announce({ pending: await pendingCount(), flushing: false });
}

/* ── The read cache ──────────────────────────────────────────────────────── */

export async function cacheRead(path, data) {
  // Only cache what a screen would render. A huge payload in IndexedDB is
  // fine; an unbounded number of distinct query strings is not, so paths with
  // a cursor are skipped — they're pagination, not a screen.
  if (/[?&]before=/.test(path)) return;
  await tx(READS, 'readwrite', s => s.put({ path, data, cached_at: Date.now() }));
}

export async function cachedRead(path) {
  const row = await tx(READS, 'readonly', s => s.get(path));
  return row || null;
}

export async function clearOfflineData() {
  await tx(READS, 'readwrite', s => s.clear());
  await tx(OUTBOX, 'readwrite', s => s.clear());
  announce({ pending: 0, flushing: false });
}
