// A task that is CLOSED is closed, whichever way it was closed (D-124).
// Read by every server door that completes a task and by the Task Center card
// that decides whether to offer Done — one list, so the card cannot offer a
// completion the server refuses.
export const CLOSED_STATUSES = ['completed', 'not_applicable', 'cancelled'];
export const isClosedStatus = (status) => CLOSED_STATUSES.includes(status);
