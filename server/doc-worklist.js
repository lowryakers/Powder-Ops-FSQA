// Document Control's worklist — one queue, worked over days.
//
// The revision upload already does the hard part: it reads a finalised document,
// works out which registry row it is, and proposes a field-by-field change with
// nothing applied until it is ticked. What it does not do is REMEMBER. It is a
// modal: drop files, apply, gone. Over roughly a hundred documents that is a job
// nobody can put down and pick up — do twenty today and tomorrow you are working
// from memory about which twenty.
//
// So the proposals are persisted and ordered, and this module owns the ordering.
// It is pure — items in, an ordered list out, no Express and no database —
// because the order IS the advice, and advice that cannot be checked without
// standing up a server is advice nobody checks.
//
// THE ORDER IS RISK, NOT ALPHABET. What Document Control most needs to see first
// is a document whose revision has actually moved, because until that is applied
// the registry is quoting a revision the plant has superseded — an auditor
// reading the register gets the wrong document. Everything else can wait.

/** A file that matched no registry row. Reported, never attached to a guess. */
export const UNMATCHED = 'unmatched';

/**
 * What one item is asking for, from the changes proposed against it.
 *
 * These are DERIVED from the proposal, never stored as a second copy — a stored
 * kind goes stale the moment somebody re-uploads a corrected file.
 */
export function itemKind(item) {
  if (!item?.document_id) return UNMATCHED;
  const fields = (item.changes || []).map(c => c.field);
  if (fields.includes('revision')) return 'revision_moved';
  if (fields.includes('effective_date')) return 'dates_only';
  if (fields.includes('title')) return 'title_only';
  if (fields.includes('description')) return 'body_only';
  return 'no_change';
}

// Lower sorts first. The gaps are deliberate: a kind added later can slot in
// without renumbering every one of these and silently reordering the queue.
const RANK = {
  revision_moved: 10,   // the registry is quoting a superseded revision
  [UNMATCHED]: 20,      // needs a person to say what this file is
  dates_only: 30,
  title_only: 40,
  body_only: 50,
  no_change: 60,        // the upload matches what is on file — confirm and move on
};

/** True when the document itself is past the date it was due to be reviewed. */
export function isOverdue(item, today) {
  return !!(item?.review_due && today && String(item.review_due) < String(today));
}

/**
 * The queue, in the order it should be worked.
 *
 * Within a kind, a document already PAST its review date comes first — it is
 * the same act for Document Control and it discharges two obligations at once.
 * Ties break on the document number so the order is stable between loads: a
 * queue that reshuffles is one somebody loses their place in.
 */
export function orderWorklist(items, { today = null } = {}) {
  return [...(items || [])]
    .map(i => ({ ...i, kind: itemKind(i), overdue: isOverdue(i, today) }))
    .sort((a, b) =>
      (RANK[a.kind] ?? 99) - (RANK[b.kind] ?? 99)
      || (b.overdue - a.overdue)
      || String(a.doc_number || a.filename || '').localeCompare(String(b.doc_number || b.filename || ''))
    );
}

/**
 * How much is left, for the one line at the top of the screen.
 *
 * Counted from the rows themselves rather than kept as a running total, so it
 * cannot disagree with the list underneath it.
 */
export function worklistProgress(items) {
  const all = items || [];
  const done = all.filter(i => i.state === 'applied').length;
  const skipped = all.filter(i => i.state === 'skipped').length;
  const outstanding = all.filter(i => i.state === 'pending');
  return {
    total: all.length,
    applied: done,
    skipped,
    outstanding: outstanding.length,
    // "12 of 97" is the sentence somebody wants; a percentage alone is not.
    percent: all.length ? Math.round(((done + skipped) / all.length) * 100) : 0,
    needs_a_person: outstanding.filter(i => itemKind(i) === UNMATCHED).length,
  };
}
