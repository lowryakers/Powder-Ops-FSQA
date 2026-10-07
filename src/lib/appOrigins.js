// Every web address this app answers on (D-156).
//
// The same server is reachable on the branded origin (app.powder-ops.com), on
// Railway's own domain — where every home-screen install made before D-140
// still lives — and on the launcher host. A ReadyBot message carries a link to
// ONE of them; the app reading it may be running on another. Checking a link
// against `window.location.origin` alone sent "Open the message" out to the
// browser from an installed app on the other address.
//
// The list is the server's (`app_origins` on /comms/status, from
// `appOrigins()` in server/links.js) — never a pattern guessed here. It is
// remembered so the first render after a cold start already knows it.

const KEY = 'app_origins';

let known = (() => {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || '[]');
    return new Set(Array.isArray(v) ? v : []);
  } catch { return new Set(); }
})();

export function rememberAppOrigins(list) {
  if (!Array.isArray(list) || !list.length) return;
  known = new Set(list);
  try { localStorage.setItem(KEY, JSON.stringify(list)); } catch { /* private mode */ }
}

export function isAppOrigin(origin) {
  if (!origin) return false;
  if (origin === window.location.origin) return true;
  return known.has(origin);
}
