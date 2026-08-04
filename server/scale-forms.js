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
export const SCALE_PROCEDURE = {
  title: 'Scale Calibration Verification — procedure',
  note: 'Perform daily when operating in a production room. Scales are assigned to production rooms — check that the scale\'s asset tag matches the room number. If more than one scale will be used in the same room, notify QA for approval first.',
  about: 'Three points, in order: minimum, target, maximum. Place the weights at the centre of the scale and at two opposing corners.',
  steps: [
    'Zero the scale before you begin.',
    'Place the MINIMUM weight in the centre of the scale and record the reading.',
    'Without removing the first weight, add the second weight at a corner to reach the TARGET, and record the reading.',
    'Add the third weight at the opposite corner to reach the MAXIMUM, and record the reading.',
    'You may re-check the zero between each point, and re-zero if it has drifted.',
    'QA/QC verifies the record before production starts.',
  ],
};

export const SCALE_FORMS = [
  {
    code: '417-01',
    revision: 'V4',
    title: 'Scale Verification — Batching (Platform Scale)',
    short: 'Batching · Platform',
    area: 'Batching',
    unit: 'kg',
    points: [
      { nominal: 25, tolerance: 0.003 },
      { nominal: 50, tolerance: 0.005 },
      { nominal: 75, tolerance: 0.008 },
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
