// The evacuation drills that were performed on paper, transcribed from the
// signed Form 501-02 V1 sheets.
//
// Four sheets, and between them they tell one story worth keeping intact: a
// fire drill in October run by HR, then a combined fire-and-earthquake drill in
// April that some people missed, and TWO make-up sessions for the people who
// were not there. The make-ups are separate records rather than adjustments to
// the April 17th one, because that is what the paper is — three sheets, three
// dates, three headcounts — and rolling them into a single "everyone did it"
// row would erase the fact that a first attempt left people out. That gap, and
// the fact that it was closed within a week, is the evidence the drill
// programme is working.
//
// Rules this follows, the same as the paper internal-audit import:
//   * NOTHING IS INVENTED. Every number and every note here is on a sheet. The
//     notes are transcribed verbatim, including their own wording.
//   * Idempotent on the event date, so a redeploy adds nothing and a record
//     someone has since corrected by hand is never overwritten.
//   * Marked as a paper import in `created_by`, so an auditor can see that the
//     record was transcribed rather than filed on the day.
import { randomUUID as uuid } from 'crypto';
import { logAudit } from './db.js';
import { EVAC_REVISION } from './safety-forms.js';

// A row per work area, in the form's printed order. `reasons` is what was
// circled — the April sheets circle BOTH F (fire) and N (natural disaster),
// because one evacuation covered both drills.
const areas = (counts, reasons) => [
  ['Production', counts[0]], ['Warehouse', counts[1]], ['Cleaning Crew', counts[2]],
  ['Maintenance', counts[3]], ['Office', counts[4]], ['Contractors', counts[5]],
].map(([area, n]) => ({
  area, total: n, accounted: n,
  // A row with nobody in it was left uncircled on the paper.
  reasons: n > 0 ? reasons : [],
}));

const PAPER_EVACUATIONS = [
  {
    event_date: '2025-10-15',
    // Production 26 · Warehouse 1 · Cleaning 2 · Maintenance 1 · Office 3 ·
    // Contractors 0 — which sums to the 33 written in the total row, and that
    // arithmetic is what settles two digits the handwriting leaves ambiguous.
    counts: [26, 1, 2, 1, 3, 0],
    reasons: ['F'],           // only F is circled on this sheet
    completed_by: 'Selena Castillo',
    notes: '10/15/2025 Fire Drill was performed by Human Resources. Selena Castillo.',
  },
  {
    event_date: '2026-04-17',
    counts: [15, 2, 0, 1, 1, 0],   // 19
    reasons: ['F', 'N'],
    completed_by: 'Daniela Servin',
    notes: 'There was some employees missing for the Fire & Natural (Earthquake) Evacuation '
      + 'performed on 04/17/2026. DS 04/17/2026. Training individual) Daniela Servin is part of '
      + '1 production employee. DS 04/17/26',
  },
  {
    event_date: '2026-04-20',
    counts: [2, 0, 2, 0, 0, 0],    // 4
    reasons: ['F', 'N'],
    completed_by: 'Daniela Servin',
    notes: 'From previous Fire & Natural (Earthquake) Evacuation performed on 04/17/2026, '
      + 'these employees were missing. DS 04/20/2026',
  },
  {
    event_date: '2026-04-23',
    counts: [4, 0, 0, 0, 0, 0],    // 4
    reasons: ['F', 'N'],
    completed_by: 'Daniela Servin',
    notes: 'From previous Fire & Natural (Earthquake) Evacuation performed on 04/17/2026, '
      + 'these employees were missing and performed it on 04/23/2026. DS 04/23/26',
  },
];

export function importPaperEvacuations(db) {
  try {
    const exists = db.prepare('SELECT 1 FROM evacuation_headcounts WHERE event_date = ?');
    const ins = db.prepare(`INSERT INTO evacuation_headcounts
      (id, form_revision, event_date, event_time, is_drill, areas, notes, completed_by, created_by)
      VALUES (?, ?, ?, NULL, 1, ?, ?, ?, 'system (paper import)')`);

    let added = 0;
    const run = db.transaction(() => {
      for (const e of PAPER_EVACUATIONS) {
        // A date already on the log is left completely alone — it may have been
        // filed by hand or corrected since, and either is a decision.
        if (exists.get(e.event_date)) continue;
        const id = uuid();
        const rows = areas(e.counts, e.reasons);
        ins.run(id, EVAC_REVISION, e.event_date, JSON.stringify(rows), e.notes, e.completed_by);
        logAudit('system (paper import)', 'evacuation_filed', 'evacuation_headcount', id,
          {
            source: 'Signed Form 501-02 V1 sheet',
            event_date: e.event_date,
            accounted: e.counts.reduce((s, n) => s + n, 0),
            reasons: e.reasons,
          }, null, null, `Evacuation ${e.event_date}`);
        added++;
      }
    });
    run();
    if (added) console.log(`[safety] Imported ${added} evacuation headcount sheet(s) from paper`);
    return added;
  } catch (err) {
    // A seeder must never take the boot down with it.
    console.warn('[safety] Evacuation paper import skipped:', err.message);
    return 0;
  }
}
