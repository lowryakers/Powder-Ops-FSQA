// A review advances its ANNIVERSARY, not the day somebody got to it.
//
// Three places computed "next due" from `now`: the document review
// (`recomputeDocumentReview`), the supplier annual review (SOP 404 § IV.B) and
// the daily/weekly checklists. All three raise their task ahead of the due
// date, so reviewing on the day the task appears — which is what a diligent
// person does — moved the anniversary a month earlier, permanently, every
// cycle. Reviewed three years running on the day the task came up, an annual
// review had become a nine-month one, and nothing said so.
//
// One rule, pure, both directions covered:
//   done BEFORE it was due  → the next is measured from the DUE date. Being
//                             early does not move the anniversary.
//   done on or after the due → the next is measured from the day it was DONE.
//                             A review fourteen months late must not produce
//                             a next-due already in the past and a second
//                             task the same morning; the gap that already
//                             happened is what the late review closes.
// That is D-047's rule for work orders ("advance from the day the work was
// DONE") with the early case made explicit.
//
// No database, no Express: rows in, a date out.

export function isoDay(v) {
  if (v == null || v === '') return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString().slice(0, 10);
  const s = String(v).trim();
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(s);
  if (m) return m[1];
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

// Calendar arithmetic on a bare date, in UTC so no timezone can move the day.
// A month step lands on the same day-of-month, clamped to the end of the
// target month: the review due on 31 January comes round on 28 February, not
// 3 March. SQLite's date(..., '+1 month') overflows instead; this is the one
// place the arithmetic is done so the two can never disagree.
export function addInterval(day, { months = 0, days = 0 } = {}) {
  const base = isoDay(day);
  if (!base) return null;
  const [y, m, d] = base.split('-').map(Number);
  let out;
  if (months) {
    const total = (y * 12 + (m - 1)) + months;
    const ny = Math.floor(total / 12);
    const nm = total - ny * 12; // 0-based
    const last = new Date(Date.UTC(ny, nm + 1, 0)).getUTCDate();
    out = new Date(Date.UTC(ny, nm, Math.min(d, last)));
  } else {
    out = new Date(Date.UTC(y, m - 1, d));
  }
  if (days) out.setUTCDate(out.getUTCDate() + days);
  return out.toISOString().slice(0, 10);
}

// `due`: the date the review WAS due (may be null — never reviewed, or never
// scheduled). `doneOn`: the day the review was performed; defaults to today.
export function nextReviewDue({ due, doneOn, months = 0, days = 0 } = {}) {
  const done = isoDay(doneOn) || new Date().toISOString().slice(0, 10);
  const wasDue = isoDay(due);
  const anchor = wasDue && wasDue > done ? wasDue : done;
  return addInterval(anchor, { months, days });
}
