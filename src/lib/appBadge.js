// PWA home-screen icon badge (Badging API). Reflects unread comms so an
// installed ReadyDoc shows a count on its icon like a native app. Degrades
// silently where unsupported (e.g. iOS today) — the in-app badges still show.
export function setAppBadge(count) {
  try {
    if (typeof navigator === 'undefined' || !('setAppBadge' in navigator)) return;
    if (count > 0) navigator.setAppBadge(count);
    else navigator.clearAppBadge?.();
  } catch { /* not supported / not installed */ }
}
