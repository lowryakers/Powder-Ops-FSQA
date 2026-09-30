// The daily Pre-Op / Changeover Clean task is retired (D-125).
//
// The clean is real and it is PC #1's monitoring — but Protocol 003 V4 places it
// "at the beginning of every run", which is an event, not a date. A daily card
// raised whether or not anything ran was either closed as "not applicable" (the
// June card Daniela opened) or left to go missed, and neither is a record of a
// clean. The clean is now filed on the Sanitation record when it is done, with
// Form 117.21's checklist on it (shared/preop-form.js).
//
// WHAT THIS DOES, ONCE PER DATABASE (the caller's marker):
//  - pauses every active schedule titled "Production Line Pre-Op…" — PAUSED,
//    not deleted: the schedule is the procedure's history and a person can
//    resume it (D-055);
//  - cancels the cards those schedules left open, with the reason on each —
//    pausing alone cascades nothing (D-012), which is how a retired job keeps
//    sitting on the floor's screen;
//  - takes three lines off the step list that a cleaner should never have been
//    ticking: "ATP Test …" and "Allergen Test …" (the swabs are ENTERED on the
//    record, with a reading — a tick beside the swab box said the same thing
//    twice), and "QA sign-off" (QA's signature is QA's act, through Verify).
//    Exact match only, so an edited list is left as its owner wrote it.
//
// Completed work is untouched: those cleans happened.

export const PREOP_TITLE_LIKE = 'Production Line Pre-Op%';

export const RETIRED_STEPS = [
  'ATP Test — swab surface, record location, swab #, and result',
  'Allergen Test — swab surface, record location, swab #, and result',
  'QA sign-off',
];

const REASON = 'The daily Pre-Op task is retired (D-125): the clean happens at the start of a run, '
  + 'not on a calendar. File it in Sanitation (New record → Pre-Op, the room) when it is done — '
  + 'Form 117.21 is on that record.';

const OUTSTANDING = "('open','in_progress','overdue','missed')";

function withoutRetiredSteps(json) {
  let steps;
  try { steps = JSON.parse(json || '[]'); } catch { return null; }
  if (!Array.isArray(steps)) return null;
  const kept = steps.filter(s => !RETIRED_STEPS.includes(typeof s === 'string' ? s.trim() : s));
  return kept.length === steps.length ? null : JSON.stringify(kept);
}

export function retireDailyPreOp(db, logAudit) {
  const schedules = db.prepare(`SELECT * FROM pm_schedules WHERE title LIKE ?`).all(PREOP_TITLE_LIKE);
  let paused = 0, cancelled = 0, stepsFixed = 0;
  const tx = db.transaction(() => {
    for (const s of schedules) {
      const steps = withoutRetiredSteps(s.procedure_steps);
      if (steps) { db.prepare('UPDATE pm_schedules SET procedure_steps = ? WHERE id = ?').run(steps, s.id); stepsFixed++; }
      if (s.is_active) {
        db.prepare("UPDATE pm_schedules SET is_active = 0, updated_at = datetime('now') WHERE id = ?").run(s.id);
        paused++;
        logAudit?.('system', 'update', 'pm_schedule', s.id, { paused: true, reason: REASON }, null, null, s.title);
      }
      const open = db.prepare(`SELECT id, title FROM work_orders WHERE pm_schedule_id = ? AND status IN ${OUTSTANDING}`).all(s.id);
      for (const w of open) {
        db.prepare(`UPDATE work_orders SET status = 'cancelled', completed_at = datetime('now'), completed_by = 'ReadyDoc',
          notes = COALESCE(notes || char(10), '') || ?, updated_at = datetime('now') WHERE id = ?`).run(REASON, w.id);
        logAudit?.('system', 'update', 'work_order', w.id, { status: 'cancelled', reason: REASON }, null, null, w.title);
        cancelled++;
      }
    }
  });
  tx();
  return { schedules: schedules.length, paused, cancelled, steps_fixed: stepsFixed };
}
