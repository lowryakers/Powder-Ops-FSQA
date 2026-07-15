/* Powder Ops service worker — app-shell caching (Phase 5c) + web push (Phase 5d).
   Bump CACHE_VERSION to force clients onto a new shell. */
const CACHE_VERSION = 'v1';
const SHELL_CACHE = `powder-shell-${CACHE_VERSION}`;
const OFFLINE_URL = '/';

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
    await Promise.all(keys.filter(k => k !== SHELL_CACHE).map(k => caches.delete(k)));
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
  if (url.pathname.startsWith('/assets') || url.pathname.endsWith('.png') || url.pathname.endsWith('.svg')) {
    event.respondWith((async () => {
      const cache = await caches.open(SHELL_CACHE);
      const cached = await cache.match(request);
      const network = fetch(request).then(res => { if (res.ok) cache.put(request, res.clone()); return res; }).catch(() => null);
      return cached || (await network) || Response.error();
    })());
  }
});

// ── Web push (Phase 5d) ───────────────────────────────────────────────────────
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { body: event.data && event.data.text() }; }
  const title = data.title || 'Powder Ops';
  const options = {
    body: data.body || '',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    tag: data.tag || undefined,
    data: { url: data.url || '/' },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of all) { if ('focus' in c) { c.navigate(target).catch(() => {}); return c.focus(); } }
    if (self.clients.openWindow) return self.clients.openWindow(target);
  })());
});
