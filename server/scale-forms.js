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
