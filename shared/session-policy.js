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
export const IDLE_MINUTES_PERSONAL = 8 * 60;
export const ACTIVITY_HEADER = 'X-User-Activity';
export const ACTIVE_WINDOW_MS = 60 * 1000;

export const idleMinutes = (sharedDevice) => (sharedDevice ? IDLE_MINUTES_SHARED : IDLE_MINUTES_PERSONAL);

/** Plain words for a sign-out screen. */
export function idleText(minutes) {
  if (minutes >= 60 && minutes % 60 === 0) return `${minutes / 60} hour${minutes === 60 ? '' : 's'}`;
  return `${minutes} minutes`;
}
