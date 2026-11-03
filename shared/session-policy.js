// HOW LONG A SESSION MAY SIT UNUSED (D-291). One definition, both sides.
//
// A shared floor tablet is signed in as whoever touched it last; fifteen
// minutes without use and it signs itself out, so the next person cannot sign
// or file as the last one. A person's own phone or desk gets a working day.
//
// "Use" means a person touched the screen, not that the page polled: the
// browser marks a request with ACTIVITY_HEADER only when there was input in the
// last minute, and only those requests move the server's clock. A badge
// refreshing on an unattended tablet never keeps it signed in.
export const IDLE_MINUTES_SHARED = 15;
export const IDLE_MINUTES_PERSONAL = 7 * 24 * 60;
export const ACTIVITY_HEADER = 'X-User-Activity';
export const ACTIVE_WINDOW_MS = 60 * 1000;
// Every open copy of ReadyDoc (a second tab, the docked Messages panel, the
// pop-out) shares ONE sign-in, so they share one idle clock (D-300): a copy
// nobody is touching must not sign the person out of the one they are using.
export const LAST_INPUT_KEY = 'idle_last_input_at';

export const idleMinutes = (sharedDevice) => (sharedDevice ? IDLE_MINUTES_SHARED : IDLE_MINUTES_PERSONAL);

/** Plain words for a sign-out screen. */
export function idleText(minutes) {
  if (minutes >= 1440 && minutes % 1440 === 0) return `${minutes / 1440} day${minutes === 1440 ? '' : 's'}`;
  if (minutes >= 60 && minutes % 60 === 0) return `${minutes / 60} hour${minutes === 60 ? '' : 's'}`;
  return `${minutes} minutes`;
}
