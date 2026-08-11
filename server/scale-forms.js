// Scale Calibration Verification — Forms 417-01 … 417-05.
//
// Five near-identical paper forms, one per scale/area, each a three-point check
// against certified weights with a per-point tolerance. Supervisors run them
// daily before production starts, so the form has to be reachable in seconds
// from the floor: it's a kiosk form (QR + in-app shortcut) like the sign in/out
// sheets, and the submission lands in Calibration Management for QA to verify.
//
// Nominals and tolerances are transcribed from the controlled forms. They are
// NOT user-editable on purpose — changing a tolerance is a document change
// (a new revision through Document Control), not a settings toggle.

// The procedure that goes with every one of these forms, transcribed from the
// plant's own Scale Calibration Verification procedure sheet.
//
// It is the SAME for all five forms — the only thing that differs between them
// is the three weights, which the form already knows — so it lives here once
// and every form renders it. Wording follows the sheet; it is not editable
// in-app for the same reason the tolerances aren't.
// Re-transcribed from the plant's updated PROCEDURE FOR SCALE CALIBRATION
// VERIFICATION sheet. Two steps changed and they change what the operator
// physically does, which is why the wording is followed rather than tidied:
// the second and third weights go on BOTH SIDES OF the weight already on the
// scale, not on one corner and then the opposite one. The sheet also makes
// "ensure the scale is zeroed before placing any weights" part of the setup,
// not just the first step.
//
// The file it came from is served alongside this (`SCALE_PROCEDURE.document`)
// so an operator — or an auditor — can read the controlled sheet itself rather
// than only this rendering of it.
export const SCALE_PROCEDURE = {
  title: 'Scale Calibration Verification — procedure',
  note: 'Perform daily when operating in a production room. Scales are assigned to production rooms — check that the scale\'s asset tag matches the room number. If more than one scale will be used in the same room, notify QA for approval first.',
  about: 'Three points, in this order: minimum, target, maximum. Place the weights at the centre of the scale and at two opposing corners. Make sure the scale is zeroed before any weight goes on it.',
  steps: [
    'Zero the scale before beginning the test.',
    'Place the MINIMUM weight in the centre of the scale and record the result.',
    'Without removing the first weight, add the second weight(s) on both sides of the first weight(s) to reach the TARGET weight, and record the result.',
    'Add the third weight(s) on the sides of the centre weight to reach the MAXIMUM weight, and record the result.',
    'The zero may be checked between each location to see that it has not changed; re-zero between tests if necessary.',
    'QA/QC personnel must verify the documentation before production starts.',
  ],
  // The controlled sheet itself. Kept in `public/forms` rather than R2 for the
  // same reason as FORM 431-01: it is a reference an operator must be able to
  // open with no storage configured.
  document: {
    code: 'SOP 417',
    title: 'Procedure for Scale Calibration Verification',
    url: '/forms/Procedure-for-Scale-Calibration-Verification.pdf',
  },
};

export const SCALE_FORMS = [
  {
    code: '417-01',
    revision: 'V4',
    title: 'Scale Verification — Batching (Platform Scale)',
    short: 'Batching · Platform',
    area: 'Batching',
    // Back to KILOGRAMS, and on new weights.
    //
    // This briefly read `lb`, transcribed from a diagram that printed pounds.
    // The plant has standardised the scale on kg and re-specified the three
    // points, so the form follows the metal: 10 / 25 / 50 kg.
    //
    // The tolerances travel WITH THEIR WEIGHT rather than with their position:
    // 25 kg keeps ± 0.003 and 50 kg keeps ± 0.005, exactly as they read before,
    // and 10 kg's ± 0.001 was supplied by the plant. Sliding the old column
    // down the new rows would have quietly loosened 25 kg from ± 0.003 to
    // ± 0.005 — a real change in what passes, made as a side effect of
    // renumbering the weights.
    //
    // This change is GATED: `controlled.js` snapshots `{points, unit}`, so the
    // app keeps serving the approved 25/50/75 lb until Document Control
    // approves the parked change. That is the gate working, not a bug.
    unit: 'kg',
    points: [
      { nominal: 10, tolerance: 0.001 },
      { nominal: 25, tolerance: 0.003 },
      { nominal: 50, tolerance: 0.005 },
    ],
  },
  {
    code: '417-02',
    revision: 'V3',
    title: 'Scale Verification — Batching (Pallet Scale)',
    short: 'Batching · Pallet',
    area: 'Batching',
    unit: 'kg',
    // The paper form prints the third row as "150kg (± .1g)"; the header for
    // the same form says "± .1kg", as do the other two points. Taking the
    // header — a 0.1 g tolerance on a 150 kg pallet scale isn't achievable.
    points: [
      { nominal: 25, tolerance: 0.1 },
      { nominal: 75, tolerance: 0.1 },
      { nominal: 150, tolerance: 0.1 },
    ],
  },
  {
    code: '417-03',
    revision: 'V3',
    title: 'Scale Verification — Stick Filling',
    short: 'Stick Filling',
    area: 'Filling',
    unit: 'g',
    points: [
      { nominal: 5, tolerance: 0.01 },
      { nominal: 25, tolerance: 0.01 },
      { nominal: 65, tolerance: 0.01 },
    ],
  },
  {
    code: '417-04',
    revision: 'V1',
    title: 'Scale Verification — Filling',
    short: 'Filling',
    area: 'Filling',
    unit: 'g',
    points: [
      { nominal: 50, tolerance: 0.01 },
      { nominal: 250, tolerance: 0.03 },
      { nominal: 750, tolerance: 0.08 },
    ],
  },
  {
    code: '417-05',
    revision: 'V1',
    title: 'Scale Verification — Kitting',
    short: 'Kitting',
    area: 'Kitting',
    unit: 'g',
    points: [
      { nominal: 50, tolerance: 0.01 },
      { nominal: 250, tolerance: 0.03 },
      { nominal: 750, tolerance: 0.08 },
    ],
  },
];

export function getScaleForm(code) {
  return SCALE_FORMS.find(f => f.code === String(code || '').trim()) || null;
}

/** Label a point the way the form prints it: "25 kg (± 0.003 kg)". */
export function pointLabel(point, unit) {
  return `${point.nominal} ${unit} (± ${point.tolerance} ${unit})`;
}

/**
 * Grade a submission. The paper form has the operator circle Pass or Fail;
 * here the readings decide it, so a reading outside tolerance can't be filed
 * as a pass. Every point must be within tolerance for the check to pass.
 */
export function gradeReadings(form, values) {
  const readings = form.points.map((p, i) => {
    const raw = Array.isArray(values) ? values[i] : values?.[String(i)];
    const value = raw === '' || raw === null || raw === undefined ? null : Number(raw);
    const valid = value !== null && Number.isFinite(value);
    return {
      nominal: p.nominal,
      tolerance: p.tolerance,
      unit: form.unit,
      label: pointLabel(p, form.unit),
      value: valid ? value : null,
      deviation: valid ? Number((value - p.nominal).toFixed(6)) : null,
      pass: valid ? Math.abs(value - p.nominal) <= p.tolerance + 1e-9 : false,
    };
  });
  const complete = readings.every(r => r.value !== null);
  return { readings, complete, result: complete && readings.every(r => r.pass) ? 'pass' : 'fail' };
}
