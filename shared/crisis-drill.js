// Crisis Management Drill and Product Integrity Inspection (D-265), SOP 501.
// The record SQF 2.6.4.2 asks for: the annual crisis test, and what it did to
// product and materials. PURE: the server validates with it and the Safety
// screen draws from it.
//
// TRANSCRIBED from Daniela Servin's sheet of 21 Oct 2026, wording kept. It has
// no form number in the Master Index yet, so every record is stamped DRAFT-1
// (the D-052 arrangement); when Document Control issues the number the code
// takes it and DRAFT-1 records are never re-stamped. Do not tidy the wording
// without telling Document Control — once issued it is theirs.

export const DRILL_TITLE = 'Crisis Management Drill and Product Integrity Inspection';
export const DRILL_FORM_CODE = null;
export const DRILL_REVISION = 'DRAFT-1';
export const DRILL_SOP = 'SOP 501';

export const DRILL_OBJECTIVE = 'Verify that employees can identify, isolate, and protect potentially affected ingredients, packaging, work-in-process, and finished product during a crisis.';

export const ACTIVITIES = [
  { key: 'physical_inspection', label: 'Physical inspection' },
  { key: 'tabletop', label: 'Tabletop drill' },
  { key: 'practical', label: 'Practical drill' },
];

export const SCENARIOS = [
  { key: 'fire', label: 'Fire' },
  { key: 'earthquake', label: 'Earthquake' },
  { key: 'power_loss', label: 'Power loss' },
  { key: 'other', label: 'Other' },
];

/** PRODUCT INTEGRITY INSPECTION — Mark: P = Pass, F = Fail, N/A = Not Applicable. */
export const INSPECTION_ITEMS = [
  { key: 'identified', label: 'Potentially affected materials and product were identified.' },
  { key: 'recorded', label: 'Product names, lot numbers, quantities, and locations were recorded.' },
  { key: 'hold_demonstrated', label: 'HOLD identification and isolation methods were demonstrated.' },
  { key: 'controls_verified', label: 'Controls to prevent use or shipment were verified.' },
  { key: 'packaging_assessed', label: 'Packaging condition and contamination risks were assessed.' },
  { key: 'storage_reviewed', label: 'Storage conditions and temperature records were reviewed, if applicable.' },
  { key: 'qa_understood', label: 'QA evaluation and product-disposition responsibilities were understood.' },
  { key: 'restart_reviewed', label: 'Requirements for cleaning, inspection, and restart were reviewed.' },
  { key: 'contacts_checked', label: 'Crisis contacts and communication methods were checked.' },
];
export const MARKS = { P: 'Pass', F: 'Fail', NA: 'N/A' };

export const HOLD_STATUS = [
  { key: 'simulated', label: 'Simulated hold only' },
  { key: 'actual', label: 'Actual hold applied' },
  { key: 'na', label: 'Not applicable' },
];

export const RESULTS = [
  { key: 'effective', label: 'Effective' },
  { key: 'effective_with_improvements', label: 'Effective with improvements' },
  { key: 'not_effective', label: 'Not effective' },
];

/** The two review lines at the foot of the form. */
export const REVIEWS = {
  qa: 'QA / SQF Practitioner Review',
  management: 'Management Review',
};

const has = (v) => String(v ?? '').trim().length > 0;
const pick = (list, k) => list.some(x => x.key === k);

/** Keep only the record's own fields, trimmed and in shape. */
export function cleanDrill(b = {}) {
  const t = (v, n = 2000) => (has(v) ? String(v).trim().slice(0, n) : null);
  const inspection = {};
  for (const it of INSPECTION_ITEMS) {
    const m = String(b.inspection?.[it.key] ?? '').toUpperCase().replace('N/A', 'NA');
    inspection[it.key] = MARKS[m] ? m : null;
  }
  return {
    drill_date: t(b.drill_date, 10),
    time_started: t(b.time_started, 10),
    time_completed: t(b.time_completed, 10),
    area: t(b.area, 200),
    activities: [...new Set((Array.isArray(b.activities) ? b.activities : []).filter(a => pick(ACTIVITIES, a)))],
    scenario: pick(SCENARIOS, b.scenario) ? b.scenario : null,
    scenario_other: b.scenario === 'other' ? t(b.scenario_other, 200) : null,
    conducted_by: t(b.conducted_by, 120),
    participants: (Array.isArray(b.participants) ? b.participants : [])
      .map(p => ({ name: t(p?.name, 120), role: t(p?.role, 120) })).filter(p => p.name),
    scenario_description: t(b.scenario_description),
    actions: t(b.actions),
    inspection,
    product_lot: t(b.product_lot, 300),
    quantity_location: t(b.quantity_location, 300),
    hold_status: pick(HOLD_STATUS, b.hold_status) ? b.hold_status : null,
    what_worked: t(b.what_worked),
    gaps: t(b.gaps),
    result: pick(RESULTS, b.result) ? b.result : null,
    corrective_actions: (Array.isArray(b.corrective_actions) ? b.corrective_actions : [])
      .map(c => ({
        finding: t(c?.finding, 500), action: t(c?.action, 500), responsible: t(c?.responsible, 120),
        due_date: t(c?.due_date, 10), completion_date: t(c?.completion_date, 10),
        verified_by: t(c?.verified_by, 120), verified_date: t(c?.verified_date, 10),
      })).filter(c => c.finding || c.action),
    retest_required: b.retest_required === true || b.retest_required === 'yes' ? 1 : 0,
    retest_date_result: t(b.retest_date_result, 300),
    record_location: t(b.record_location, 200),
    evacuation_id: t(b.evacuation_id, 60),
  };
}

/** What a FILE needs (it may be filed and finished later). [] means it may be stored. */
export function fileErrors(d, today) {
  const out = [];
  if (!d.drill_date) out.push('The date the drill was conducted is required.');
  else if (today && d.drill_date > today) out.push('The drill date cannot be in the future.');
  if (d.scenario === 'other' && !d.scenario_other) out.push('Say what the "Other" scenario was.');
  return out;
}

/**
 * What must be on the record before anyone signs the review. A drill signed
 * with blanks reads later as though those checks passed (the internal-audit
 * rule), and a failed check with no corrective action is the gap the drill
 * exists to find.
 */
export function missingToSign(d) {
  const m = [];
  if (!d.drill_date) m.push('Date conducted');
  if (!d.time_started || !d.time_completed) m.push('Time started and completed');
  if (!d.area) m.push('Area inspected');
  if (!d.activities?.length) m.push('Activity');
  if (!d.scenario) m.push('Scenario');
  if (!d.conducted_by) m.push('Conducted by');
  if (!d.participants?.length) m.push('Participants');
  if (!d.scenario_description) m.push('Describe the simulated emergency');
  if (!d.actions) m.push('Actions performed or discussed');
  const blank = INSPECTION_ITEMS.filter(it => !d.inspection?.[it.key]);
  if (blank.length) m.push(`Product integrity inspection: ${blank.length} line${blank.length === 1 ? '' : 's'} not marked`);
  if (!d.hold_status) m.push('Hold status');
  if (!d.what_worked) m.push('What worked');
  if (!d.result) m.push('Overall result');
  const failed = INSPECTION_ITEMS.filter(it => d.inspection?.[it.key] === 'F');
  if (failed.length) {
    if (!d.gaps) m.push('Gaps or deficiencies (a line was marked Fail)');
    if (!d.corrective_actions?.length) m.push('A corrective action (a line was marked Fail)');
    if (d.result === 'effective') m.push('Overall result cannot be "Effective" with a line marked Fail');
  }
  if (d.result && d.result !== 'effective' && !d.corrective_actions?.length) m.push('A corrective action (the result was not "Effective")');
  if (d.result === 'not_effective' && !d.retest_required) m.push('Retest required (the result was "Not effective")');
  for (const [i, c] of (d.corrective_actions || []).entries()) {
    if (!c.action || !c.responsible || !c.due_date) m.push(`Corrective action ${i + 1}: action, responsible person and due date`);
  }
  return m;
}

export const resultLabel = (k) => RESULTS.find(r => r.key === k)?.label || '—';
export const scenarioLabel = (d) => (d.scenario === 'other' ? `Other: ${d.scenario_other || ''}` : SCENARIOS.find(s => s.key === d.scenario)?.label || '—');
