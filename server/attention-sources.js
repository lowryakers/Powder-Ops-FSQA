// What is behind a badge.
//
// A module's attention bar says "85 machines with no work instruction linked",
// which is the start of a question, not an answer — working out WHICH eighty-five
// meant rebuilding the filter by hand, which nobody does. This is the registry
// that makes those lines openable.
//
// THE ONE RULE: the number and the list come from the SAME walk. A drill-down
// built from a second query is a list that disagrees with the figure above it,
// and whoever clicked cannot tell which is wrong — the same reconciliation rule
// `activity-metrics.js` follows for Team Activity. So `equipmentSetupGaps()`
// returns the ROWS, and compliance.js counts them with `.length` rather than
// keeping a counting loop of its own.

import { equipmentReadiness } from './equipment-readiness.js';
import { recleanRooms } from './api/sanitation.js';

// Who owns each unfinished setup step, and how it reads in a sentence. Moved
// here from compliance.js so the badge, the bar and the drawer share one
// definition of both the wording and the audience.
export const EQUIPMENT_OWNERS = {
  pm_schedule: { depts: ['maintenance'], label: (n) => `${n} machine${n > 1 ? 's' : ''} with no recurring PM schedule — nothing generates their tasks` },
  pm_assignee: { depts: ['maintenance'], label: (n) => `${n} machine${n > 1 ? 's' : ''} whose PM work is not assigned to a team` },
  hygienic_design: { depts: ['qa'], label: (n) => `${n} food-contact machine${n > 1 ? 's' : ''} with no hygienic design verification` },
  calibration: { depts: ['qa'], label: (n) => `${n} measuring device${n > 1 ? 's' : ''} not set up for calibration` },
  training_course: { depts: ['document_control', 'qa'], label: (n) => `${n} machine${n > 1 ? 's' : ''} with no training course` },
  work_instruction: { depts: ['document_control'], label: (n) => `${n} machine${n > 1 ? 's' : ''} with no work instruction linked` },
};

/**
 * One walk over active equipment, returning the MACHINES behind each gap.
 *
 * `equipmentReadiness` is the single rule — this does not re-implement any of
 * it, it only collects. Callers that want counts take `.length`.
 */
export function equipmentSetupGaps(db) {
  const gaps = {};
  for (const key of Object.keys(EQUIPMENT_OWNERS)) gaps[key] = [];
  for (const eq of db.prepare("SELECT * FROM equipment WHERE status = 'active' ORDER BY name").all()) {
    const steps = equipmentReadiness(db, eq).steps;
    const noSchedule = steps.some(x => x.id === 'pm_schedule' && !x.done);
    for (const step of steps) {
      if (step.done || !EQUIPMENT_OWNERS[step.id]) continue;
      // Don't report the same machine twice. A machine with no recurring
      // schedule doesn't yet need a team assigned — the team only matters once
      // something generates, so counting both turns one problem into two
      // numbers and inflates the headline.
      if (step.id === 'pm_assignee' && noSchedule) continue;
      gaps[step.id].push({
        id: eq.id,
        title: eq.name,
        subtitle: [eq.asset_id ? `#${eq.asset_id}` : null, eq.type, eq.location].filter(Boolean).join(' · '),
        note: step.detail || null,
        tab: 'equipment',
      });
    }
  }
  return gaps;
}

/**
 * The registry: badge id → the rows behind it.
 *
 * Adding a drill-down is one entry. A badge with no entry simply renders as
 * text — a figure with nothing behind it must never become a button that opens
 * an empty drawer.
 */
export function attentionRows(db, id) {
  if (id.startsWith('equip-setup-')) {
    const step = id.slice('equip-setup-'.length);
    if (!EQUIPMENT_OWNERS[step]) return null;
    return equipmentSetupGaps(db)[step] || [];
  }
  if (id === 'sanitation-reclean') {
    const WHY = {
      expired_72h: 'Past the 72-hour rule',
      dirty: 'Used since the last clean',
      no_clean_on_record: 'No clean on record',
    };
    return recleanRooms(db).filter(r => r.needs_attention).map(r => ({
      id: r.room,
      title: r.room,
      subtitle: r.hours_since_clean != null ? `${Math.round(r.hours_since_clean)}h since last clean` : 'No clean on record',
      note: WHY[r.status] || r.status,
      tab: 'sanitation',
    }));
  }
  return null;
}

// Which badge ids can be opened — stamped onto badgeDetail so the client
// renders a button only where there is something to show.
export function isDrillable(id) {
  return id.startsWith('equip-setup-') || id === 'sanitation-reclean';
}
