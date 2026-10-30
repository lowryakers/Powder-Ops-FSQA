// Idle sign-out on the screen (D-291). The server keeps the same clock and is
// the authority; this half signs the screen out the moment the limit passes,
// rather than leaving an open page on a shared tablet until its next request.
//
// "Use" is a person touching the screen. Requests made in the minute after an
// input carry ACTIVITY_HEADER; while somebody is reading without triggering a
// request, a light ping every two minutes keeps the server's clock in step.
import { ACTIVITY_HEADER, ACTIVE_WINDOW_MS, idleText } from '../../shared/session-policy.js';

let lastInput = Date.now();
const INPUTS = ['pointerdown', 'keydown', 'touchstart', 'wheel'];
if (typeof window !== 'undefined') {
  for (const ev of INPUTS) window.addEventListener(ev, () => { lastInput = Date.now(); }, { passive: true, capture: true });
}

/** Headers to add to a request: the activity mark when a person touched the screen in the last minute. */
export function activityHeaders() {
  return Date.now() - lastInput < ACTIVE_WINDOW_MS ? { [ACTIVITY_HEADER]: '1' } : {};
}

const NOTICE = 'idle_signed_out';
export function noteIdleSignOut(minutes) {
  try { sessionStorage.setItem(NOTICE, `You were signed out after ${idleText(minutes)} without use.`); } catch { /* storage off */ }
}
/** Read once by the login screen, then cleared. */
export function takeIdleNotice() {
  try { const v = sessionStorage.getItem(NOTICE); sessionStorage.removeItem(NOTICE); return v; } catch { return null; }
}

const SHARED_KEY = 'shared_device';
export function isSharedDevice() { try { return localStorage.getItem(SHARED_KEY) === '1'; } catch { return false; } }
export function setSharedDevice(on) { try { localStorage.setItem(SHARED_KEY, on ? '1' : '0'); } catch { /* storage off */ } }

/**
 * Watch for the limit. Returns a stop function. `onIdle` signs out;
 * `ping` keeps the server's clock in step while a person reads.
 */
export function startIdleWatch({ minutes, onIdle, ping }) {
  if (!minutes) return () => {};
  lastInput = Date.now();
  let lastPing = Date.now();
  const timer = setInterval(() => {
    const idle = Date.now() - lastInput;
    if (idle > minutes * 60 * 1000) { clearInterval(timer); noteIdleSignOut(minutes); onIdle(); return; }
    if (idle < 2 * 60 * 1000 && Date.now() - lastPing > 2 * 60 * 1000) { lastPing = Date.now(); ping?.(); }
  }, 15 * 1000);
  return () => clearInterval(timer);
}
