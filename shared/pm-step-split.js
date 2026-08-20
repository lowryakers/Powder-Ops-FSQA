// A weekly task must not hand the technician the annual checklist.
//
// The plant writes its maintenance procedure the way the manual prints it —
// one block per machine with the cadences as headings:
//
//   Weekly:
//     Inspect hydraulic hoses, fittings, cylinders, and fluid level
//   Monthly:
//     Inspect scissor arms, pins, bushings, fasteners, and welds
//   Annual:
//     Full inspection, load test, safety decals, and service record review
//
// Pasted whole into a PM schedule's procedure steps, that block becomes ONE
// checklist. The scissor lift's weekly task asked for twelve steps including
// the annual load test, every week. What that costs is not the extra scrolling:
// a checklist that is mostly work you are not doing today is one people learn
// to tick through, and on a food-contact machine the ticks are what QA reads
// when clearing it to run.
//
// THE RULE IS MECHANICAL, NOT INTERPRETIVE. A step is a frequency heading only
// when the whole line IS a cadence — "Monthly", "Monthly:", "MONTHLY PM:" —
// never when a line merely mentions one ("Do the following weekly:" is a step,
// and "Check filters monthly" is a step). Everything below a heading belongs to
// it until the next one. Nothing is reworded, and nothing that was written is
// invented, dropped silently, or moved to a cadence nobody chose.

const FREQUENCY_TYPES = {
  daily: 'daily',
  weekly: 'weekly',
  biweekly: 'biweekly',
  'bi-weekly': 'biweekly',
  fortnightly: 'biweekly',
  monthly: 'monthly',
  quarterly: 'quarterly',
  'semi-annual': 'semi_annual',
  'semi annual': 'semi_annual',
  semiannual: 'semi_annual',
  'semi-annually': 'semi_annual',
  'twice yearly': 'semi_annual',
  annual: 'annual',
  annually: 'annual',
  yearly: 'annual',
};

// Words a heading may carry without ceasing to be one. "Monthly PM:" and
// "MONTHLY MAINTENANCE" are the same heading as "Monthly:".
const HEADING_SUFFIX = /\s+(pm|pms|maintenance|tasks?|checks?|inspections?|service|items?)$/i;

export const FREQUENCY_LABEL = {
  daily: 'Daily', weekly: 'Weekly', biweekly: 'Bi-weekly', monthly: 'Monthly',
  quarterly: 'Quarterly', semi_annual: 'Semi-Annual', annual: 'Annual',
};

/**
 * The frequency this step is a heading FOR, or null if it is ordinary work.
 *
 * Whole-line equality is what keeps this safe: a task that happens to contain
 * the word "weekly" is a task, and mis-reading one as a heading would silently
 * move every step under it onto a different schedule.
 */
export function headingFrequency(step) {
  let t = String(step ?? '').trim();
  if (!t) return null;
  t = t.replace(/^[-•*•\s]+/, '').replace(/[:：]\s*$/, '').trim();
  t = t.replace(HEADING_SUFFIX, '').trim();
  return FREQUENCY_TYPES[t.toLowerCase()] || null;
}

/**
 * Split a flat checklist into what came before the first cadence heading and
 * one section per heading.
 *
 * Preamble steps are the ones written above every heading. They are kept
 * wherever they are found rather than assigned to a cadence — they were written
 * to apply generally, and guessing otherwise would move work off a schedule.
 */
export function splitSteps(steps) {
  const list = Array.isArray(steps) ? steps : [];
  const preamble = [];
  const sections = [];
  let current = null;
  for (const raw of list) {
    const step = typeof raw === 'string' ? raw : String(raw ?? '');
    if (!step.trim()) continue;
    const freq = headingFrequency(step);
    if (freq) {
      current = { frequency_type: freq, heading: step.trim(), steps: [] };
      sections.push(current);
      continue;
    }
    (current ? current.steps : preamble).push(step);
  }
  return { preamble, sections: sections.filter(s => s.steps.length) };
}

/**
 * What splitting ONE schedule would do, or null when there is nothing merged.
 *
 * `existingFrequencies` is every OTHER active schedule this machine already
 * has. A cadence that already has its own schedule is not created again — the
 * steps under that heading are reported as dropped, with the reason, because a
 * second schedule at the same cadence is the duplicate-task complaint arriving
 * from the other direction.
 */
export function planStepSplit(schedule, existingFrequencies = []) {
  let steps;
  try { steps = JSON.parse(schedule.procedure_steps || '[]'); } catch { return null; }
  if (!Array.isArray(steps) || !steps.length) return null;

  const { preamble, sections } = splitSteps(steps);
  // One heading is a label, not a merge — a weekly schedule headed "Weekly:" is
  // simply tidy. Two or more cadences in one checklist is the bug.
  const distinct = new Set(sections.map(s => s.frequency_type));
  if (distinct.size < 2) return null;

  const own = sections.filter(s => s.frequency_type === schedule.frequency_type);
  // NEVER GUESS WHICH SECTION IS "REALLY" THIS ONE. A weekly schedule holding
  // only monthly and annual sections is a schedule set to the wrong cadence,
  // which is a decision about how often work happens — a person's call.
  if (!own.length) {
    return {
      refuse: `This is a ${FREQUENCY_LABEL[schedule.frequency_type] || schedule.frequency_type} schedule, but none of its sections are ${FREQUENCY_LABEL[schedule.frequency_type] || schedule.frequency_type}. Check the schedule's frequency before splitting it.`,
    };
  }

  const keep = [...preamble, ...own.flatMap(s => s.steps)];
  if (!keep.length) return { refuse: 'Splitting this would leave the schedule with no steps.' };

  const existing = new Set(existingFrequencies);
  const move = [];
  for (const s of sections) {
    if (s.frequency_type === schedule.frequency_type) continue;
    const already = existing.has(s.frequency_type);
    const found = move.find(m => m.frequency_type === s.frequency_type);
    if (found) { found.steps.push(...s.steps); continue; }
    move.push({
      frequency_type: s.frequency_type,
      label: FREQUENCY_LABEL[s.frequency_type] || s.frequency_type,
      steps: [...s.steps],
      // 'create' gives these steps a schedule of their own; 'drop' leaves them
      // to the schedule that already runs at that cadence.
      disposition: already ? 'drop' : 'create',
      reason: already ? `This machine already has a ${FREQUENCY_LABEL[s.frequency_type] || s.frequency_type} schedule — these steps belong on it, and a second one would double the task.` : null,
    });
  }

  return {
    refuse: null,
    before: steps.filter(s => String(s ?? '').trim()).length,
    keep,
    preamble_count: preamble.length,
    move,
    creates: move.filter(m => m.disposition === 'create').length,
  };
}
