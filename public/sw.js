/* Powder Ops service worker — app-shell caching (Phase 5c) + web push (Phase 5d).
   Bump CACHE_VERSION to force clients onto a new shell. */
const CACHE_VERSION = 'v9';  // v9 (D-153): drops every v8 cache, which may hold HTML stored under a chunk's name
const SHELL_CACHE = `powder-shell-${CACHE_VERSION}`;
const OFFLINE_URL = '/';

const isPage = (res) => /text\/html/i.test(res.headers.get('Content-Type') || '');

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    await cache.addAll([OFFLINE_URL, '/favicon.svg', '/icon-192.png']).catch(() => {});
    self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    // 'push-meta' is not a cache of the site — it is what renews this device's
    // notifications while nobody is signed in (D-300), and an update must not wipe it.
    await Promise.all(keys.filter(k => k !== SHELL_CACHE && k !== 'push-meta').map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;          // only same-origin
  if (url.pathname.startsWith('/api') || url.pathname.startsWith('/socket.io')) return; // never cache API / sockets

  // Navigations: network-first, fall back to the cached app shell when offline.
  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        return await fetch(request);
      } catch {
        const cache = await caches.open(SHELL_CACHE);
        return (await cache.match(OFFLINE_URL)) || Response.error();
      }
    })());
    return;
  }

  // Hashed build assets & icons: cache-first (immutable), revalidate in background.
  // A page is never a build file (D-153). Before this, a missing chunk answered
  // with the app shell was stored under the chunk's name and served cache-first
  // on every load after, so the import failed and Reload could not get out.
  // Only a real file is stored, and an HTML entry already cached is thrown away.
  if (url.pathname.startsWith('/assets') || url.pathname.endsWith('.png') || url.pathname.endsWith('.svg')) {
    event.respondWith((async () => {
      const cache = await caches.open(SHELL_CACHE);
      let cached = await cache.match(request);
      if (cached && isPage(cached)) { await cache.delete(request); cached = null; }
      const network = fetch(request).then(res => {
        if (res.ok && !isPage(res)) cache.put(request, res.clone());
        return res;
      }).catch(() => null);
      return cached || (await network) || Response.error();
    })());
  }
});

// ── Web push (Phase 5d) ───────────────────────────────────────────────────────
self.addEventListener('push', (event) => {
  let data;
  try { data = event.data ? event.data.json() : {}; } catch { data = { body: event.data && event.data.text() }; }
  // Legacy safety net: the server no longer sends "dismiss" pushes (a push with
  // no visible notification makes Android show a generic fallback one — the
  // phantom-notification bug), but handle any still in flight from the push
  // service by closing the matching notifications.
  if (data.dismiss) {
    event.waitUntil((async () => {
      const shown = await self.registration.getNotifications();
      for (const n of shown) {
        const url = (n.data && n.data.url) || '';
        if (n.tag === data.dismiss || url.includes('c=' + data.channelId)) n.close();
      }
    })());
    return;
  }
  const title = data.title || 'Powder Ops';
  const options = {
    body: data.body || '',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    tag: data.tag || undefined,
    // renotify re-alerts when a notification with the same tag is replaced
    // (e.g. a busy channel) instead of updating silently.
    renotify: !!data.renotify && !!data.tag,
    data: { url: data.url || '/' },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

// ── The browser renewed this device's push subscription (D-300) ─────────────
// Without this the server kept the old address, the push service answered 410,
// the row was pruned, and the phone got nothing until its person signed back in
// and opened Messages. The worker has no session: it proves possession of the
// OLD subscription (endpoint + auth secret, which the page left in Cache
// Storage) to /api/push-rotate, and the new one keeps the same person.
const PUSH_META = '/__push_meta';
const b64ToBytes = (s) => {
  const pad = '='.repeat((4 - (s.length % 4)) % 4);
  const raw = atob((s + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
};
const bytesToB64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil((async () => {
    let meta = {};
    try {
      const cache = await caches.open('push-meta');
      const hit = await cache.match(PUSH_META);
      if (hit) meta = await hit.json();
    } catch { /* no memory of the old one */ }
    const old = event.oldSubscription;
    const oldEndpoint = (old && old.endpoint) || meta.endpoint;
    const oldAuth = (old && old.getKey && old.getKey('auth') && bytesToB64(old.getKey('auth'))) || meta.auth;
    if (!oldEndpoint || !oldAuth) return;
    let sub = event.newSubscription;
    if (!sub) {
      const appKey = (old && old.options && old.options.applicationServerKey) || (meta.key ? b64ToBytes(meta.key) : null);
      if (!appKey) return;
      sub = await self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: appKey });
    }
    const res = await fetch('/api/push-rotate', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ old_endpoint: oldEndpoint, old_auth: oldAuth, subscription: sub.toJSON() }),
    });
    if (res.ok) {
      const j = sub.toJSON();
      const cache = await caches.open('push-meta');
      await cache.put(PUSH_META, new Response(JSON.stringify({ endpoint: j.endpoint, auth: j.keys && j.keys.auth, key: meta.key || null }), { headers: { 'Content-Type': 'application/json' } }));
    }
  })().catch(() => {}));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || '/';
  let channelId = null, messageId = null;
  try {
    const u = new URL(target, self.location.origin);
    channelId = u.searchParams.get('c');
    messageId = u.searchParams.get('m');
  } catch { /* ignore */ }
  event.waitUntil((async () => {
    // Persist the target where the page can read it. iOS PWAs launch at the
    // manifest start_url and drop the notification's query string, so the URL
    // alone can't be trusted — the client reads this on load and on focus.
    if (channelId) {
      try {
        const cache = await caches.open('pending-nav');
        await cache.put('/__pending_nav', new Response(JSON.stringify({ channelId, messageId, ts: Date.now() }), { headers: { 'Content-Type': 'application/json' } }));
      } catch { /* ignore */ }
    }
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    // An app window is already open: tell it in-app which channel to open (more
    // reliable than navigate, especially on iOS) and focus it.
    for (const c of all) {
      if (channelId) c.postMessage({ type: 'open-channel', channelId, messageId });
      if ('focus' in c) return c.focus();
    }
    // Otherwise launch a fresh window at /?c=<id>; the app reads it on load.
    if (self.clients.openWindow) return self.clients.openWindow(target);
  })());
});
