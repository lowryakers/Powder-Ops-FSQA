// The key a QR poster carries, from the scan to every request the page makes.
//
// It arrives in the URL (`/kiosk/scale?k=…`) because that is all a QR code can
// carry. From there it has to survive three things the floor actually does:
//
//   * a reload, or the phone locking and waking;
//   * the lobby tablet being SAVED TO THE HOME SCREEN, where the saved address
//     is whatever was in the bar at the time;
//   * navigating within the kiosk, which drops the query string.
//
// So it is stored per kiosk under its own key. Per kiosk, not one shared slot,
// because a phone that scanned the scale poster this morning and the knife
// poster this afternoon must not have the second overwrite the first.

const KEY = (slug) => `kiosk_token_${slug}`;

/**
 * Read the key for this kiosk, preferring the URL (a fresh scan is the most
 * recent instruction) and falling back to what was stored by an earlier one.
 * A key in the URL is remembered on the way past.
 */
export function kioskToken(slug) {
  let fromUrl = null;
  try {
    fromUrl = new URLSearchParams(window.location.search).get('k');
  } catch { fromUrl = null; }

  if (fromUrl) {
    try { localStorage.setItem(KEY(slug), fromUrl); } catch { /* private mode */ }
    return fromUrl;
  }
  try { return localStorage.getItem(KEY(slug)) || null; } catch { return null; }
}

/**
 * Headers for a kiosk request. Returns an empty object when there is no key —
 * which is correct while enforcement is off, and is what makes this safe to
 * wire in before any key has been issued.
 */
export function kioskHeaders(slug) {
  const t = kioskToken(slug);
  return t ? { 'X-Kiosk-Token': t } : {};
}

/**
 * `fetch` for a kiosk page. Same signature as fetch, with the key attached.
 */
export function kioskFetch(slug, path, opts = {}) {
  return fetch(path, { ...opts, headers: { ...(opts.headers || {}), ...kioskHeaders(slug) } });
}

/**
 * Is this page being told its poster is out of date? The server answers a
 * refused kiosk request with `kiosk_token_required`, and every kiosk shows the
 * same sentence for it — the person at the poster cannot fix it themselves, so
 * the message has to point at somebody who can.
 */
export const OUT_OF_DATE = {
  en: 'This QR code is out of date. Please use the current poster, or ask the office to print a new one.',
  es: 'Este código QR ya no es válido. Use el cartel actual o pida a la oficina que imprima uno nuevo.',
};
