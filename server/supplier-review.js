// The annual vendor review — SOP 404 § IV.B, and the piece that stops this
// register going quiet the way the tracker did.
//
// The register landed knowing WHEN a review is due (`next_review_due`, stamped
// a year out by every disposition) and doing nothing about it. A date nothing
// watches is the state the whole project keeps finding: the 72-hour re-clean
// that waited for a supervisor to press Assign, the QA inspection whose task
// completed and filed no record, the certificate that expired thirteen months
// ago in a folder.
//
// TWO MECHANISMS, DELIBERATELY DIFFERENT, because they are different work.
//
//  1. A REVIEW THAT FALLS DUE RAISES ITS OWN WORK ORDER. Nobody is looking for
//     it — an annual date arrives with no other prompt — so it must arrive in
//     somebody's list. Same shape as generateRecleanTasks(): idempotent on a
//     key, raised by the system, cancelled if the review happens first.
//
//  2. A SUPPLIER THAT HAS NEVER BEEN QUALIFIED IS NUDGED, NOT TASKED. On the
//     plant's data that is 22 vendors, and raising 22 work orders on the first
//     boot is a queue nobody asked for — the "a task raised on every stray
//     reading is one people learn to dismiss" rule. It is also not the same
//     job: a review is a recurring obligation with a date, a first
//     qualification is a chase. The screen already counts them and the nudge
//     makes sure somebody is told; neither invents work.
//
// A supplier with no qualification therefore generates NO review task. That is
// not an oversight — it has no annual review to be due, because it has never
// had a first one.

import { randomUUID as uuid } from 'crypto';
import { readyDocOrigin } from './links.js';

/** How far ahead of the due date the work should appear. */
export const LEAD_DAYS = 30;

const dayStr = (d) => d.toISOString().slice(0, 10);

/**
 * What is due, what is overdue, and what has never been qualified.
 *
 * PURE-ish: reads, decides nothing, writes nothing. Both the generator and the
 * nudge take their numbers from here, so a task and the message about it can
 * never disagree — the activity-metrics rule.
 */
export function reviewStatus(db, { today = dayStr(new Date()) } = {}) {
  const horizon = dayStr(new Date(Date.parse(today) + LEAD_DAYS * 86400000));
  const due = db.prepare(`
    SELECT q.id AS qualification_id, q.supplier_id, q.period_label, q.next_review_due,
           s.name AS supplier_name, s.actively_using, s.status
    FROM supplier_qualifications q
    JOIN suppliers s ON s.id = q.supplier_id
    WHERE q.next_review_due IS NOT NULL
      AND q.next_review_due <= ?
      -- Only the LATEST period per supplier can be due: an older year's review
      -- is superseded by the one that replaced it, and raising work for both
      -- would put two tasks on one vendor for the same obligation.
      AND q.next_review_due = (SELECT MAX(q2.next_review_due) FROM supplier_qualifications q2
                               WHERE q2.supplier_id = q.supplier_id)
    ORDER BY q.next_review_due`).all(horizon);

  // Never qualified: actively used, no disposition anywhere. Counted, never
  // tasked — see the header.
  const never = db.prepare(`
    SELECT s.id AS supplier_id, s.name AS supplier_name
    FROM suppliers s
    WHERE s.actively_using = 1 AND s.status = 'unqualified'
      AND NOT EXISTS (SELECT 1 FROM supplier_qualifications q
                      WHERE q.supplier_id = s.id AND q.disposition IS NOT NULL)
    ORDER BY s.name COLLATE NOCASE`).all();

  return {
    due: due.filter(r => r.next_review_due >= today),
    overdue: due.filter(r => r.next_review_due < today),
    never_qualified: never,
    today, horizon,
  };
}

// Idempotence is (qualification, due date) — the same shape work_orders
// already uses for quality_schedule_id and pm_schedule_id, rather than a
// generic key column or a side table. It matters that the DUE DATE is part of
// it: recording a review stamps next year's date, so next year's task is a new
// one instead of being suppressed as a duplicate of this year's.

/**
 * Raise a work order for every review that has come due.
 *
 * Idempotent on the key, which changes only when the DUE DATE moves — so
 * recording a review (which stamps the next year's date) closes the loop and
 * next year's task is a new one rather than a duplicate of this year's.
 */
export function generateSupplierReviewTasks(db, { today = dayStr(new Date()) } = {}) {
  let status;
  try { status = reviewStatus(db, { today }); } catch { return { created: 0 }; }
  const rows = [...status.overdue, ...status.due];
  if (!rows.length) return { created: 0 };

  const exists = db.prepare(
    'SELECT 1 FROM work_orders WHERE supplier_qualification_id = ? AND due_date = ? LIMIT 1');
  const ins = db.prepare(`INSERT INTO work_orders
    (id, equipment_id, title, description, priority, due_date, procedure_steps, task_group, status, supplier_qualification_id)
    VALUES (?, NULL, ?, ?, ?, ?, ?, 'qa', 'open', ?)`);

  // The SOP's own words for what a review is, so the task carries the
  // requirement rather than a paraphrase of it.
  const steps = JSON.stringify([
    'Review the vendor\'s status and update it as needed (SOP 404 § V.E.B.I)',
    'Check the questionnaire and certificates on file are current',
    'Review non-conformances raised against this vendor since the last review',
    'Record the disposition in Suppliers — approved, conditionally approved, or not approved',
  ]);

  let created = 0;
  const tx = db.transaction(() => {
    for (const r of rows) {
      if (exists.get(r.qualification_id, r.next_review_due)) continue;
      const overdue = r.next_review_due < today;
      ins.run(uuid(),
        `Annual vendor review — ${r.supplier_name}`,
        `SOP 404 § IV.B requires an annual review of each vendor. Due ${r.next_review_due}`
          + `${overdue ? ' (overdue)' : ''}. Last qualified period: ${r.period_label || 'undated'}.`,
        overdue ? 'high' : 'medium',
        r.next_review_due, steps, r.qualification_id);
      created += 1;
    }
  });
  tx();
  return { created, due: status.due.length, overdue: status.overdue.length };
}

/**
 * Tell QA and Purchasing what the register is carrying.
 *
 * Best-effort and never throws out of the job: a comms outage must not stop the
 * tasks above from being raised.
 */
export async function supplierReviewNudge(db, deps = {}) {
  const { botDm, pushToUser } = deps;
  if (!botDm) return { sent: 0 };
  let s;
  try { s = reviewStatus(db); } catch { return { sent: 0 }; }
  const overdue = s.overdue.length;
  const never = s.never_qualified.length;
  if (!overdue && !never) return { sent: 0, quiet: true };

  // An IIFE returning the value, not `let … = []` then a try that reassigns:
  // the initialiser is never read, which is the one lint rule this codebase
  // keeps tripping over. Correct by construction rather than by remembering.
  const people = (() => {
    try {
      return db.prepare(`
        SELECT id, name FROM users
        WHERE is_active = 1 AND name != 'ReadyBot'
          AND (role = 'admin'
               OR (role IN ('supervisor', 'manager')
                   AND LOWER(COALESCE(department, '')) IN ('qa', 'quality', 'purchasing')))`).all();
    } catch { return []; }
  })();
  if (!people.length) return { sent: 0 };

  const link = `${readyDocOrigin()}/?tab=suppliers`;
  const lines = [];
  // TWO NUMBERS, NOT ONE — the same split the screen makes, because they are
  // different work for different people and one figure tells neither what to do.
  if (overdue) {
    lines.push(`*${overdue} vendor review${overdue === 1 ? '' : 's'} overdue.* `
      + `A work order has been raised for each: ${s.overdue.slice(0, 5).map(r => r.supplier_name).join(', ')}`
      + `${overdue > 5 ? `, +${overdue - 5} more` : ''}.`);
  }
  if (never) {
    lines.push(`*${never} vendor${never === 1 ? ' is' : 's are'} actively used and never qualified.* `
      + `No task is raised for these — a first qualification is a chase, not a recurring review. `
      + `SOP 404 § V.A permits ordering through qualified vendors only.`);
  }
  const body = `${lines.join('\n')}\n${link}`;

  let sent = 0;
  for (const p of people) {
    try { await botDm(p.id, body); sent += 1; } catch { /* one failure must not stop the rest */ }
    try { await pushToUser?.(p.id, { title: 'Supplier reviews', body: lines[0].replace(/\*/g, '') }); } catch { /* best effort */ }
  }
  return { sent, overdue, never_qualified: never };
}
