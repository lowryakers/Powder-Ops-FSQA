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

// Send a push to every subscription a user has. Prunes subscriptions the push
// service reports as gone (404/410) so the table doesn't accumulate dead ones.
export async function pushToUser(userId, payload) {
  if (!pushEnabled()) return;
  ensureConfigured();
  const db = getDb();
  const subs = db.prepare('SELECT * FROM chat_push_subscriptions WHERE user_id = ?').all(userId);
  const body = JSON.stringify(payload);
  await Promise.all(subs.map(async (s) => {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, body);
    } catch (e) {
      if (e.statusCode === 404 || e.statusCode === 410) {
        db.prepare('DELETE FROM chat_push_subscriptions WHERE endpoint = ?').run(s.endpoint);
      }
    }
  }));
}
