// The query string as it was when the app loaded.
//
// App.jsx consumes `?tab=`, `?form=` and friends in an effect and then calls
// history.replaceState to clear them — which is right, because a deep link
// should fire once and not survive every later re-render. But a LAZILY LOADED
// module mounts after that effect has run, so anything reading
// window.location.search for itself always finds an empty string.
//
// This module is imported at boot, before React renders anything, so it holds
// the original parameters. Same trick useInstallPrompt.js uses to catch
// `beforeinstallprompt` before a component exists to hear it.
//
// A deep link means "open here THIS time", so a parameter is consumed once and
// then gone — otherwise a module keeps jumping back to the linked view every
// time it remounts.
//
// But CONSUMING IT DURING RENDER IS WRONG. React StrictMode deliberately
// double-invokes a useState initializer and keeps the SECOND result; a
// destructive read there hands the value to the throwaway call and null to the
// one that counts. So `getParam` is pure and safe to call while rendering, and
// `consumeParam` is called from an effect once the value has actually been
// used. This cost a working ?view= link before it was caught.

const captured = new URLSearchParams(
  typeof window === 'undefined' ? '' : window.location.search,
);

export function getParam(name) {
  return captured.get(name);
}

export function consumeParam(name) {
  captured.delete(name);
}

export default { getParam, consumeParam };
