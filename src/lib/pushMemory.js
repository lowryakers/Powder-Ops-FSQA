// What the service worker needs to renew this browser's push subscription on
// its own (D-300): the subscription's endpoint and auth secret, and the server's
// public key. Kept in Cache Storage because a service worker cannot read
// localStorage. Written whenever the page registers a subscription.
const CACHE = 'push-meta';
const KEY = '/__push_meta';

export async function rememberPushSubscription(sub, applicationServerKey) {
  try {
    if (!sub || typeof caches === 'undefined') return;
    const j = sub.toJSON ? sub.toJSON() : sub;
    const cache = await caches.open(CACHE);
    await cache.put(KEY, new Response(JSON.stringify({ endpoint: j.endpoint, auth: j.keys?.auth, key: applicationServerKey || null }),
      { headers: { 'Content-Type': 'application/json' } }));
  } catch { /* best effort: without it a renewal waits for the next sign-in */ }
}
