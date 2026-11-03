// Idle sign-out on the screen (D-291). The server keeps the same clock and is
// the authority; this half signs the screen out the moment the limit passes,
// rather than leaving an open page on a shared tablet until its next request.
//
// "Use" is a person touching the screen. Requests made in the minute after an
// input carry ACTIVITY_HEADER; while somebody is reading without triggering a
// request, a light ping every two minutes keeps the server's clock in step.
import { ACTIVITY_HEADER, ACTIVE_WINDOW_MS, LAST_INPUT_KEY, idleText } from '../../shared/session-policy.js';

//
// ONE CLOCK FOR EVERY OPEN COPY (D-300). A second tab, the docked Messages panel
// and the pop-out are separate documents sharing one sign-in. Each used to keep
// its own clock, so the copy nobody was touching ran out and signed the person
// out of the one they were working in. Input in any copy is written to
// localStorage (same origin, so every copy reads it); each copy takes the later
// of its own and the shared time.
let lastInput = Date.now();
let lastWritten = 0;
const INPUTS = ['pointerdown', 'keydown', 'touchstart', 'wheel'];

function sharedInputAt() {
  try { const v = Number(localStorage.getItem(LAST_INPUT_KEY)); return Number.isFinite(v) ? v : 0; } catch { return 0; }
}
/** A person touched this copy of the screen. Shared with every other copy, written at most every 5 s. */
export function noteInput(now = Date.now()) {
  lastInput = now;
  if (now - lastWritten < 5000) return;
  lastWritten = now;
  try { localStorage.setItem(LAST_INPUT_KEY, String(now)); } catch { /* storage off: this copy keeps its own clock */ }
}
/** When a person last touched ANY open copy of ReadyDoc in this browser. */
export function lastInputAt() { return Math.max(lastInput, sharedInputAt()); }

if (typeof window !== 'undefined') {
  for (const ev of INPUTS) window.addEventListener(ev, () => noteInput(), { passive: true, capture: true });
}

/** Headers to add to a request: the activity mark when a person touched any copy of the screen in the last minute. */
export function activityHeaders() {
  return Date.now() - lastInputAt() < ACTIVE_WINDOW_MS ? { [ACTIVITY_HEADER]: '1' } : {};
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
  // Opening a copy is a fresh start for THIS copy only — writing it to the
  // shared clock would let a tab that reloads by itself keep everyone signed in.
  lastInput = Date.now();
  let lastPing = Date.now();
  const timer = setInterval(() => {
    const idle = Date.now() - lastInputAt();
    if (idle > minutes * 60 * 1000) { clearInterval(timer); noteIdleSignOut(minutes); onIdle(); return; }
    if (idle < 2 * 60 * 1000 && Date.now() - lastPing > 2 * 60 * 1000) { lastPing = Date.now(); ping?.(); }
  }, 15 * 1000);
  return () => clearInterval(timer);
}
