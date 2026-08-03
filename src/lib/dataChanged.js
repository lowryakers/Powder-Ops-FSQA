// "Something I just did should change a number in the sidebar."
//
// The module badges and the notification bell come from one endpoint,
// /compliance/notifications, fetched by App. It used to refetch only when the
// active tab or the signed-in user changed — so marking six time entries
// reviewed left the badge sitting on its old count until you navigated away
// and back. The work was done; the app just hadn't asked again.
//
// A module calls notifyDataChanged() after a write that could move one of
// those counts. Deliberately a plain event with no payload: the badge query is
// cheap and server-side, and a module should not have to know which of its
// writes feeds which badge.

const EVENT = 'readydoc-data-changed';

export function notifyDataChanged() {
  window.dispatchEvent(new CustomEvent(EVENT));
}

export function onDataChanged(handler) {
  window.addEventListener(EVENT, handler);
  return () => window.removeEventListener(EVENT, handler);
}
