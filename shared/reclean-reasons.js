// WHY A ROOM OWES A RE-CLEAN — one vocabulary, every place that says it.
//
// THREE conditions raise a re-clean and only ONE of them is the 72-hour rule.
// Every task the rule raised was titled `72h Re-clean — Room 7` regardless,
// with the real reason buried in the description, so a task raised because the
// room ran yesterday read as a 72-hour lapse. The floor reasonably concluded
// the rule was firing on the wrong days — which is exactly the question QA
// asked, and it was a fair reading of what the app said.
//
// The wording had grown four copies: the automatic generator, the manual
// "Assign to Cleaning" button, the Sanitation strip and the Facility Map. The
// generator's and the button's had already drifted apart (the button titled
// the task with the raw room TOKEN and printed "idle nullh" for a room with no
// clean at all), and the Sanitation strip described a room with no clean on
// record as "used after last clean", which is a statement about a clean that
// does not exist. Same rule as shared/rooms.js and shared/clean-levels.js: one
// definition, both sides import it.
//
// THE TITLE'S PARENTHETICAL MUST NOT CONTAIN PARENTHESES. `recordAreaForTask()`
// reads the area back out of a completed task's title with `\([^()]*\)`, and
// that is the only route from a finished task to the cleaning record it files.

export const RECLEAN_REASONS = {
  expired_72h: {
    // Left exactly as it was. This IS the 72-hour rule, it is the name the
    // plant already knows, and `closeRecleanTasksFor`'s legacy title match is
    // written against this string.
    title: (label) => `72h Re-clean — ${label}`,
    line: (e) => (e?.hours_since_clean == null
      ? 'past the 72-hour re-clean rule'
      : `idle ${e.hours_since_clean}h since last clean (72h rule)`),
  },
  dirty: {
    title: (label) => `Re-clean — ${label} (used since last clean)`,
    line: () => 'used in production after its last passed clean',
  },
  no_clean_on_record: {
    title: (label) => `Re-clean — ${label} (no clean on record)`,
    // Said plainly rather than dressed as a 72-hour lapse: these are different
    // problems and this one is worse.
    line: () => 'used in production with no passing clean on record',
  },
};

/** The reason for a flagged room, falling back to the 72-hour wording. */
export function recleanReason(status) {
  return RECLEAN_REASONS[status] || RECLEAN_REASONS.expired_72h;
}

/** The one-line description of why a room is flagged. */
export function recleanReasonLine(entry) {
  return recleanReason(entry?.status).line(entry);
}

/** The work order a flagged room raises: same words from either door. */
export function recleanTaskText(entry, label) {
  const reason = recleanReason(entry?.status);
  return {
    title: reason.title(label),
    description: `${label} needs a full re-clean before next use: ${reason.line(entry)}. `
      + 'Log the clean in Sanitation when done.',
  };
}
