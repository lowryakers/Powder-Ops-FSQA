// "Something I just did should change a number in the sidebar."
//
// The module badges and the notification bell come from one endpoint,
// /compliance/notifications, fetched by App. It used to refetch only when the
// active tab or the signed-in user changed — so marking six time entries
// reviewed left the badge sitting on its old count until you navigated away
// and back. The work was done; the app just hadn't asked again.
//
// Rather than have fifteen modules each remember to announce their writes,
// every successful non-GET through hooks/useApi fires this — so a module (and
// any module added later) gets live badges for free. notifyDataChanged() stays
// exported for the handful of writes that don't go through that path.
//
// Deliberately a plain event with no payload: the badge query is cheap
// (~4ms server-side) and a module should not have to know which of its writes
// feeds which badge.
//
// Coalesced, because a bulk action is a burst of writes and the badge only
// needs to be right once the burst is over.

const EVENT = 'readydoc-data-changed';
const COALESCE_MS = 300;
let timer = null;

export function notifyDataChanged() {
  clearTimeout(timer);
  timer = setTimeout(() => window.dispatchEvent(new CustomEvent(EVENT)), COALESCE_MS);
}

export function onDataChanged(handler) {
  window.addEventListener(EVENT, handler);
  return () => window.removeEventListener(EVENT, handler);
}
