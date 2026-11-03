// A phone renewed its notification subscription (D-300).
//
// A browser replaces a push subscription now and then (an update, the push
// service expiring it) and fires `pushsubscriptionchange` in the service worker.
// Until this route existed nothing listened: the server kept sending to the old
// address, the push service answered 410, the row was pruned, and the phone got
// nothing until its person signed back in and opened Messages — the only place
// the subscription was re-registered. A person signed out overnight missed
// everything sent overnight.
//
// The service worker has no session, so this route is public. What it proves
// instead is possession of the OLD subscription: its endpoint (a long random
// URL) AND its auth secret, both of which only the server and that browser
// hold. The new subscription keeps the old row's person. Nothing else is
// readable or writable here, and an unknown or mismatched pair gets the same 404.
import { Router } from 'express';
import crypto from 'node:crypto';
import { getDb, logAudit } from '../db.js';
import { pushEnabled, vapidPublicKey } from '../push.js';

const router = Router();

const hits = new Map(); // ip → [timestamps]; 20 a minute is far more than a real phone needs
function limited(ip) {
  const now = Date.now();
  const list = (hits.get(ip) || []).filter(t => now - t < 60000);
  list.push(now);
  hits.set(ip, list);
  return list.length > 20;
}
const same = (a, b) => {
  const x = Buffer.from(String(a || '')), y = Buffer.from(String(b || ''));
  return x.length > 0 && x.length === y.length && crypto.timingSafeEqual(x, y);
};
const validSub = (s) => s && typeof s.endpoint === 'string' && /^https?:\/\//.test(s.endpoint) && s.endpoint.length <= 2048
  && typeof s.keys?.p256dh === 'string' && typeof s.keys?.auth === 'string' && s.keys.p256dh.length <= 256 && s.keys.auth.length <= 256;

router.post('/', (req, res) => {
  if (!pushEnabled()) return res.status(503).json({ error: 'Push is not configured on this server.' });
  const ip = String(req.headers['x-forwarded-for'] || req.ip || '').split(',')[0].trim();
  if (limited(ip)) return res.status(429).json({ error: 'Too many requests.' });
  const { old_endpoint: oldEndpoint, old_auth: oldAuth, subscription } = req.body || {};
  if (!validSub(subscription)) return res.status(400).json({ error: 'Invalid subscription' });
  const db = getDb();
  const row = oldEndpoint ? db.prepare('SELECT * FROM chat_push_subscriptions WHERE endpoint = ?').get(String(oldEndpoint)) : null;
  if (!row || !same(row.auth, oldAuth)) return res.status(404).json({ error: 'Not found' });
  const user = db.prepare('SELECT id, name, is_active FROM users WHERE id = ?').get(row.user_id);
  if (!user?.is_active) return res.status(404).json({ error: 'Not found' });
  db.transaction(() => {
    if (row.endpoint !== subscription.endpoint) db.prepare('DELETE FROM chat_push_subscriptions WHERE endpoint = ?').run(row.endpoint);
    db.prepare(`INSERT INTO chat_push_subscriptions (id, user_id, endpoint, p256dh, auth, vapid_key, user_agent)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh,
                  auth = excluded.auth, vapid_key = excluded.vapid_key, user_agent = excluded.user_agent,
                  last_error = NULL, last_error_at = NULL`)
      .run(crypto.randomUUID(), row.user_id, subscription.endpoint, subscription.keys.p256dh, subscription.keys.auth,
        vapidPublicKey(), (req.headers['user-agent'] || row.user_agent || '').slice(0, 300));
  })();
  // The endpoint is a capability, so it is never written to the log — only that it happened.
  logAudit('system', 'update', 'push_subscription', row.user_id, { event: 'push_subscription_renewed', by: 'service_worker' }, null, null, user.name);
  res.json({ ok: true });
});

export default router;
