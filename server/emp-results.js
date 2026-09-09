// Grading an environmental monitoring result against FORM 604-01 — PURE.
//
// The alert and action levels are the form's (emp-site-list.js); nothing here
// is a preference. A result is graded once, when it is entered, and the limits
// it was graded against are FROZEN onto the record (`alert_limit` /
// `action_limit`) — the `sanitation_records.atp_limit` rule — so a sample
// graded under one revision goes on saying so after the form moves.
//
// Outcomes:
//   pending — sampled, no result yet
//   ok      — under the alert level (or absent, for a presence test)
//   alert   — over the alert level, under action
//   action  — over the action level, or PRESENT for Salmonella / Listeria
//   info    — the form sets no limit (air): recorded for information only

import { EMP_REVISION, EMP_FORM_CODE } from './emp-site-list.js';

export { EMP_REVISION, EMP_FORM_CODE };

// Limits as the form writes them, per zone and test. `numeric` limits are
// read as "greater than N"; `presence` tests grade PRESENT as the action.
const LIMITS = {
  water: {
    'Total Aerobic Bacteria Count': { kind: 'numeric', unit: 'CFU/mL', alert: 500, action: 1000, alert_text: '>500 CFU/mL', action_text: '>1000 CFU/mL' },
    'Total Coliforms': { kind: 'presence', alert_text: 'Present/100mL', action_text: 'Present/100mL' },
    'Free Chlorine': { kind: 'numeric', unit: 'ppm', alert: null, action: 2.0, alert_text: 'NA', action_text: '>2.0 ppm' },
  },
  zone1: {
    'Total Aerobic Bacteria Count': { kind: 'numeric', unit: 'CFU/cm²', alert: 300, action: 1000, alert_text: '>300 CFU/cm²', action_text: '>1000 CFU/cm²' },
    'Total Yeast and Mold Count': { kind: 'numeric', unit: 'CFU/cm²', alert: 150, action: 500, alert_text: '>150 CFU/cm²', action_text: '>500 CFU/cm²' },
  },
};
const PRESENCE = { kind: 'presence', alert_text: 'NA', action_text: 'Present in Sample' };
for (const z of ['zone2', 'zone3', 'zone4']) {
  LIMITS[z] = { 'Salmonella species': PRESENCE, 'Listeria monocytogenes': PRESENCE };
}
const INFO_ONLY = { kind: 'info', alert_text: 'For Information Only', action_text: 'For Information Only' };
LIMITS.air = { 'Settle plate': INFO_ONLY };
LIMITS.compressed_air = { 'Compressed air quality': INFO_ONLY };

export function limitsFor(zone, test) {
  const z = LIMITS[zone];
  if (!z) return null;
  if (z[test]) return z[test];
  // A test the form does not name for this zone is recorded, never graded —
  // a limit invented for it would be a number nobody chose.
  return null;
}

/** "<10", "2,300", "TNTC", "45 CFU" → a number, or null when it cannot be read. */
export function parseNumeric(value) {
  const s = String(value ?? '').trim().toLowerCase();
  if (!s) return null;
  if (/tntc|too numerous/.test(s)) return Number.POSITIVE_INFINITY;
  const m = s.replace(/,/g, '').match(/-?\d+(\.\d+)?/);
  if (!m) return null;
  let n = parseFloat(m[0]);
  // "<10" is under the detection limit: graded as 0 for the comparison, the
  // written value is kept on the record.
  if (/^<\s*\d/.test(s)) n = 0;
  return n;
}

export function parsePresence(value) {
  const s = String(value ?? '').trim().toLowerCase();
  if (!s) return null;
  if (/^(present|positive|detected|pos|\+)/.test(s)) return 'present';
  if (/^(absent|negative|not detected|nd|neg|none|-)/.test(s)) return 'absent';
  return null;
}

/**
 * Grade one result. Returns { outcome, numeric, alert_limit, action_limit,
 * unit, unreadable } — `unreadable` when the text could not be interpreted,
 * in which case the outcome stays 'pending' rather than guessing.
 */
export function gradeEmpResult(zone, test, value) {
  const lim = limitsFor(zone, test);
  const base = { alert_limit: lim?.alert_text || null, action_limit: lim?.action_text || null, unit: lim?.unit || null, numeric: null, unreadable: false };
  if (!lim) return { ...base, outcome: 'info' };
  if (lim.kind === 'info') return { ...base, outcome: 'info', numeric: parseNumeric(value) };
  if (lim.kind === 'presence') {
    const p = parsePresence(value);
    if (!p) return { ...base, outcome: 'pending', unreadable: true };
    return { ...base, outcome: p === 'present' ? 'action' : 'ok' };
  }
  const n = parseNumeric(value);
  if (n == null) return { ...base, outcome: 'pending', unreadable: true };
  let outcome = 'ok';
  if (lim.action != null && n > lim.action) outcome = 'action';
  else if (lim.alert != null && n > lim.alert) outcome = 'alert';
  return { ...base, outcome, numeric: n };
}
