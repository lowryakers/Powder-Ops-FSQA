// Where the app's public links point.
//
// Two origins are in play and they are NOT interchangeable:
//
//   • APP_BASE_URL    — the public front door (start.powder-ops.com). That host
//     serves the workspace launcher, and Twilio webhook signatures are computed
//     over this exact origin, so it must match the Twilio console entry.
//
//   • READYDOC_ORIGIN — where the ReadyDoc app itself is served. Every deep link
//     we generate (channel/message jumps, approval magic links, join links,
//     digests) has to target this origin: the launcher host answers page
//     requests with the workspace picker, so a link sent there lands on the
//     picker instead of the record. server.js redirects launcher-host deep
//     links here as a backstop, but generating them correctly saves the hop.
//
// Set READYDOC_ORIGIN when the app moves to its own custom domain. Carriers
// scan the links in A2P traffic and cannot tell a shared hosting subdomain
// (`…up.railway.app`) apart from anyone else's traffic on the same host, which
// is a well-known cause of texts being filtered — so a branded domain here is
// a deliverability setting, not cosmetics.

/**
 * THE SCHEME IS SUPPLIED WHEN IT IS MISSING, and this is the one normalisation
 * these two variables get.
 *
 * `READYDOC_ORIGIN=app.powder-ops.com` is what a person types, and it is
 * unambiguous — there is exactly one reading of a bare hostname in an origin
 * variable. Left alone it produces `app.powder-ops.com/join/<token>` in every
 * texted link and every ReadyBot message: a phone often linkifies that anyway,
 * so it half works, which is the worst kind of broken. It also made
 * `new URL(origin)` throw, and the launcher's `res.redirect(302, origin + path)`
 * a RELATIVE redirect back onto the launcher host.
 *
 * The same value signs the Twilio webhook, where it has to match the console
 * entry character for character — a missing scheme there is a signature that
 * never validates.
 *
 * Normalising the scheme is not inventing a fact; it is the `tenDigits()` rule
 * for a URL. ANYTHING ELSE MALFORMED IS LEFT AS TYPED and named rather than
 * guessed at — `smsStatus().link_warning` reports an origin that still will not
 * parse, and boot logs it, instead of silently falling back to the default and
 * hiding the misconfiguration.
 */
export function normalizeOrigin(raw, fallback) {
  const v = String(raw ?? '').trim();
  if (!v) return fallback;
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(v) ? v : `https://${v}`;
  return withScheme.replace(/\/+$/, '');
}

// Railway's own domain for this service: the default origin, and where the
// home-screen installs made before D-140 still live.
export const RAILWAY_DEFAULT_ORIGIN = 'https://powderops-fsqa.up.railway.app';

export function appBaseUrl() {
  return normalizeOrigin(process.env.APP_BASE_URL, 'https://start.powder-ops.com');
}

export function readyDocOrigin() {
  return normalizeOrigin(process.env.READYDOC_ORIGIN, RAILWAY_DEFAULT_ORIGIN);
}

/**
 * EVERY ADDRESS THIS APP ANSWERS ON (D-156).
 *
 * The same server is reachable on the branded origin, on Railway's own domain
 * (where every home-screen install made before D-140 still lives), and on the
 * launcher host, which forwards any deep link into the app. A link a ReadyBot
 * message carries names ONE of them; the phone reading it may be on another.
 * Comparing the link to `window.location.origin` alone therefore sent an
 * "Open the message" from app.powder-ops.com out to the browser from an app
 * installed on the Railway domain. The client asks this list instead.
 *
 * Only addresses this deployment is configured with, never a pattern: a shared
 * hosting suffix (`*.up.railway.app`) is everybody's, not ours.
 */
export function appOrigins() {
  const out = [readyDocOrigin(), RAILWAY_DEFAULT_ORIGIN, appBaseUrl()];
  if (process.env.RAILWAY_PUBLIC_DOMAIN) out.push(normalizeOrigin(process.env.RAILWAY_PUBLIC_DOMAIN));
  const seen = new Set();
  return out.filter(o => {
    let origin;
    try { origin = new URL(o).origin; } catch { return false; }
    if (seen.has(origin)) return false;
    seen.add(origin);
    return true;
  }).map(o => new URL(o).origin);
}

/**
 * Said once at boot, so a value that will break every link is visible in the
 * deploy log rather than only in a text somebody never received.
 */
export function reportOrigins(log = console) {
  for (const [name, value] of [['APP_BASE_URL', appBaseUrl()], ['READYDOC_ORIGIN', readyDocOrigin()]]) {
    try { new URL(value); } catch { log.warn(`[links] ${name} is not a usable URL (${value}) — links generated from it will be broken.`); }
  }
  const origin = readyDocOrigin();
  if (/\.(up\.railway\.app|onrender\.com|herokuapp\.com|vercel\.app)$/i.test((() => {
    try { return new URL(origin).hostname; } catch { return ''; }
  })())) {
    log.warn(`[links] Texted links point at ${origin}, a shared hosting domain — a known cause of A2P messages being filtered. Set READYDOC_ORIGIN to a branded domain.`);
  }
}
