// Optional web push (Comms Phase 5d). Uses VAPID; degrades gracefully — with no
// keys configured, pushEnabled() is false and callers skip sending. Generate a
// keypair once with `npx web-push generate-vapid-keys` and set:
//   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (mailto: or https URL)
import webpush from 'web-push';
import { getDb } from './db.js';

const PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY;
const PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;
const SUBJECT = process.env.VAPID_SUBJECT || 'mailto:admin@powder-ops.com';

let configured = false;
export function pushEnabled() {
  return !!(PUBLIC_KEY && PRIVATE_KEY);
}
export function vapidPublicKey() {
  return PUBLIC_KEY || null;
}
function ensureConfigured() {
  if (configured || !pushEnabled()) return;
  webpush.setVapidDetails(SUBJECT, PUBLIC_KEY, PRIVATE_KEY);
  configured = true;
}

// Send a push to every subscription a user has.
//
// Every outcome is recorded on the row. A push that fails used to disappear
// without a trace: the phone still showed as subscribed, the server had sent
// nothing, and no one could tell which layer was broken. Now the last success
// and the last failure are both stored, so "Jake gets no notifications" is a
// question the app can answer.
//
// Pruning covers the three ways a subscription becomes permanently dead:
//   404/410 — the push service dropped it (uninstalled, cleared data).
//   403     — VapidPkHashMismatch: it was created under a different VAPID key
//             than the server now holds, so it can never be delivered again.
// Anything else (network blips, 5xx) is left alone and retried next time.
const DEAD_STATUSES = new Set([403, 404, 410]);

export async function pushToUser(userId, payload) {
  if (!pushEnabled()) return;
  ensureConfigured();
  const db = getDb();
  const subs = db.prepare('SELECT * FROM chat_push_subscriptions WHERE user_id = ?').all(userId);
  const body = JSON.stringify(payload);
  await Promise.all(subs.map(async (s) => {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, body);
      db.prepare("UPDATE chat_push_subscriptions SET last_success_at = datetime('now'), last_error = NULL, last_error_at = NULL WHERE endpoint = ?")
        .run(s.endpoint);
    } catch (e) {
      const status = e.statusCode || 0;
      const reason = `${status || 'network'}: ${String(e.body || e.message || '').slice(0, 200)}`;
      if (DEAD_STATUSES.has(status)) {
        console.warn(`[push] dropping dead subscription for user ${userId} — ${reason}`);
        db.prepare('DELETE FROM chat_push_subscriptions WHERE endpoint = ?').run(s.endpoint);
      } else {
        console.warn(`[push] send failed for user ${userId} — ${reason}`);
        db.prepare("UPDATE chat_push_subscriptions SET last_error = ?, last_error_at = datetime('now') WHERE endpoint = ?")
          .run(reason, s.endpoint);
      }
    }
  }));
}
