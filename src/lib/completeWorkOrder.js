import { apiPost } from '../hooks/useApi';

// ONE COMPLETION PATH, TWO FORMS. The Operator View and the Task Center both
// complete work orders, and the duplicate-readings question has to be asked
// identically from both — a check that only one screen applies is a check
// somebody works around by using the other screen.
//
// The server refuses a submission whose readings repeat the previous check's
// (409, `duplicate_readings`), naming the record it matched. That is a
// QUESTION, not a refusal: a stable room really does read the same two days
// running. Answering yes re-sends the identical body with the confirmation
// flag; answering no leaves the task untouched so the operator can correct the
// date or the numbers.
//
// `confirmDuplicate` receives the server's descriptor — { prior_date,
// prior_by, message } — and returns truthy to go ahead. The caller composes
// the wording, because the floor screen has to ask in Spanish.
export async function completeWorkOrder(woId, form, confirmDuplicate) {
  try {
    return await apiPost(`/pm/work-orders/${woId}/complete-and-recur`, form);
  } catch (err) {
    const dup = err?.data?.duplicate_readings ? err.data : null;
    // Anything else is a real failure and belongs to the caller — a 400 on the
    // step ticks or a dilution out of range must not be swallowed here.
    if (!dup || typeof confirmDuplicate !== 'function') throw err;
    const go = await confirmDuplicate(dup);
    if (!go) {
      // Not an error: the operator answered the question. The callers treat
      // `cancelled` the way they treat a cancelled signature — silently.
      const cancel = new Error('Completion cancelled');
      cancel.cancelled = true;
      throw cancel;
    }
    return apiPost(`/pm/work-orders/${woId}/complete-and-recur`,
      { ...form, confirm_duplicate_readings: true });
  }
}
