// Point the page at ITS OWN manifest before anybody presses "Add to Home Screen".
//
// A phone installs whatever the manifest's `start_url` says, not the page you
// are looking at. index.html links the app manifest, whose start_url is "/", so
// adding the lobby tablet from the visitor kiosk produced an icon that opened
// the ReadyDoc SIGN-IN PAGE — in front of a visitor, which is the one screen
// that tablet must never show.
//
// Swapping the <link rel="manifest"> href while a kiosk route is on screen is
// enough: the installer reads it at the moment of the tap.
//
// The key travels with it. It lives in the URL (`?k=…`), and an icon saved
// without it would stop working the day enforcement is switched on — which is
// exactly the breakage the staged rollout exists to avoid.

import { kioskToken } from './kioskToken.js';

const LINK_ID = 'kiosk-manifest-link';

/**
 * @param {string|null} slug  a kiosk slug, or null to restore the app manifest.
 * Returns a cleanup function, so a component can call it from an effect.
 * NOT a hook — it touches the document, nothing else — so it is not named like
 * one; `use…` would put it under the rules-of-hooks lint for no reason.
 */
export function applyKioskManifest(slug) {
  const link = document.querySelector('link[rel="manifest"]');
  if (!link) return () => {};
  const original = link.getAttribute('href');
  if (!slug) return () => {};

  const key = kioskToken(slug);
  link.setAttribute('href', `/kiosk-manifest/${slug}.webmanifest${key ? `?k=${encodeURIComponent(key)}` : ''}`);
  link.setAttribute('data-kiosk', slug);
  link.id = LINK_ID;

  // iOS reads this for the home-screen label rather than the manifest, so both
  // have to be set or the icon still says "Powder Ops".
  const apple = document.querySelector('meta[name="apple-mobile-web-app-title"]');
  const appleWas = apple?.getAttribute('content') || null;

  return () => {
    link.setAttribute('href', original);
    link.removeAttribute('data-kiosk');
    if (apple && appleWas) apple.setAttribute('content', appleWas);
  };
}

/**
 * The same thing for a title, kept separate so the caller can set it from the
 * kiosk's own strings rather than this module holding a second copy of them.
 */
export function setKioskAppTitle(title) {
  const apple = document.querySelector('meta[name="apple-mobile-web-app-title"]');
  if (apple && title) apple.setAttribute('content', title);
  if (title) document.title = title;
}
