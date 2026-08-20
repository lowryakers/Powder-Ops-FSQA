// WHY THE APP JUST DID THAT.
//
// ReadyDoc is full of deliberate refusals — a form number that cannot be edited,
// a signed record that cannot be changed, a back-dated clean that needs a
// reason, a number that is retired rather than deleted. Every one of them
// exists for a reason somebody thought through, and until now that reasoning
// lived in the code and in Lowry's head. To everyone else it read as the app
// being awkward.
//
// So the rules are DATA, shown where the action is:
//   * beside a control that behaves unexpectedly (an input that is disabled,
//     a delete that retires instead), as a quiet "Why?" the reader can open;
//   * and when the server refuses something, so the refusal explains itself
//     rather than just saying no.
//
// TWO THINGS THIS IS NOT.
//
//   It is not a second copy of the rule. The rule is still enforced in exactly
//   one place — the server. This is the EXPLANATION, and if the two ever
//   disagree the server is right; nothing here gates anything.
//
//   It is not a tooltip on every field. A hint that appears everywhere is
//   wallpaper, and people stop reading it. These are for the places where the
//   app does something a reasonable person would not predict.
//
// Adding one is an entry here plus a `<RuleTip id="…" />` where it applies.

export const RULES = {
  /* ── Controlled forms ─────────────────────────────────────────────────── */
  'form.number-immutable': {
    title: 'A form number can’t be changed',
    body: 'The number is the form’s identity — every record ever filed points at it. '
      + 'Renaming it would leave those records pointing at something that no longer exists. '
      + 'When a form is genuinely replaced, issue the new number and retire the old one: both stay '
      + 'resolvable, which is exactly what Document Control does on paper.',
  },
  'form.retire-not-delete': {
    title: 'Forms are retired, never deleted',
    body: 'A retired form stays in the index so records filed under its number still resolve, and so the '
      + 'number is never reissued to something else. It drops out of the active list but an auditor can '
      + 'still follow an old record back to the form it answered.',
  },
  'form.scale-revision-locked': {
    title: 'This revision is set by the check itself',
    body: 'The five scale verification forms carry their own weights and tolerances, and that is what a '
      + 'daily check is graded against. The revision follows those figures, so changing it here would let '
      + 'the register quote a revision the grader has already moved past. Changing the tolerances is a '
      + 'Document Change Request.',
  },
  'form.matching-in-code': {
    title: 'Where form numbers come from',
    body: 'Which form a task or record answers to is worked out from what the task already is — its '
      + 'schedule title, its record type, its area. That matching is deliberately not editable here: a '
      + 'mistyped rule would print the wrong form number on a compliance record silently. The facts about '
      + 'a form are yours to maintain; the matching is a code change.',
  },
  'form.no-guess': {
    title: 'A task with no form number shows nothing',
    body: 'Rather than guess. A wrong form number on a compliance record is worse than an absent one, so '
      + 'anything the index does not cover simply shows no number — and is listed here so it can be fixed.',
  },

  /* ── Records and signatures ───────────────────────────────────────────── */
  'record.signed-is-closed': {
    title: 'A signed record is closed',
    body: 'Once an approval signature is on a record it can’t be edited, because the signature is a '
      + 'statement about the record as it stood. The way back is to revoke the signature — which you can '
      + 'do to your own — correct the record, and sign again. All three steps are audited, so the trail '
      + 'shows what happened instead of hiding it.',
  },
  'record.back-date-needs-reason': {
    title: 'Recording work from an earlier day',
    body: 'Work that was genuinely done but couldn’t be logged at the time should still be recorded, and '
      + 'ReadyDoc keeps BOTH dates: the day the work happened and the day it reached the system. Anything '
      + 'more than a day back asks why, and the record says "entered late" with that reason. A back-dated '
      + 'record that looked identical to one filed on the day would be the dishonest version.',
  },
  'record.no-future': {
    title: 'Nothing can be recorded for a future date',
    body: 'A record dated tomorrow is a claim that something has happened when it hasn’t.',
  },

  /* ── Tasks ────────────────────────────────────────────────────────────── */
  'task.missed-collapses': {
    title: 'Why one card says “3× missed”',
    body: 'A recurring task that was missed regenerates the next day, so a daily job left for a week would '
      + 'otherwise leave seven identical cards behind it. They fold into one card carrying the count and '
      + 'the date it started slipping. Completing the live card is how you catch up; the missed days stay '
      + 'in the record as missed, because they were.',
  },
  'task.steps-required-food-contact': {
    title: 'Why this task needs every step ticked',
    body: 'It’s on food-contact equipment, so QA has to clear the machine before it runs again — and they '
      + 'can’t clear it from a task that doesn’t say what was done. If a step genuinely couldn’t be done, '
      + 'flag an issue rather than leaving it unticked: that’s a fact QA should see.',
  },
  'task.submitted-has-no-schedule': {
    title: '“Submitted” means reported, not scheduled',
    body: 'These are problems reported from the floor — the kiosk QR, or a task raised from a chat message '
      + '— so they have no recurring schedule behind them and no frequency. They’re real work orders and '
      + 'are recorded in the audit log with who reported them.',
  },

  /* ── Backfill and imports ─────────────────────────────────────────────── */
  'backfill.invents-nothing': {
    title: 'What this backfill does and doesn’t do',
    body: 'It files a record for each check that was COMPLETED in ReadyDoc but never produced one, using '
      + 'that completion’s own date, person and readings. It invents nothing: a task nobody completed '
      + 'produces no record. Every record it files is marked entered late with a reason, so an auditor '
      + 'sees the real date, the filing date, and why they differ.',
  },
  'import.preview-first': {
    title: 'Preview writes nothing',
    body: 'Imports and bulk actions show you the counts and the rows first, because this writes to a '
      + 'compliance log. Nothing is saved until you commit, and re-running never duplicates what is '
      + 'already there.',
  },
};

/** The rule, or null. Unknown ids render nothing rather than an empty popover. */
export const ruleFor = (id) => RULES[id] || null;
