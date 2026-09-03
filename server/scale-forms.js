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

// The procedure that goes with these forms, transcribed from the plant's own
// Scale Calibration Verification procedure sheet. Wording follows the sheet; it
// is not editable in-app for the same reason the tolerances aren't.
//
// MOST of it is genuinely shared — zeroing, the order of the three points, the
// re-check between points, QA verifying before production. What is NOT shared
// is WHERE THE WEIGHTS GO, because the sheet was revised for one scale only.
//
// That split is the whole point of this structure. The placement wording and
// the placement diagram describe the same physical act, so they must travel
// together: a form showing corners while its steps say "on both sides of the
// centre weight" is telling an operator two different things about where to put
// a certified weight. Both now come from `PLACEMENT_PATTERNS`, keyed on the
// form's `diagram`, so neither can be changed without the other.
//
// The file it came from is served alongside this (`SCALE_PROCEDURE.document`)
// so an operator — or an auditor — can read the controlled sheet itself rather
// than only this rendering of it.
export const PLACEMENT_PATTERNS = {
  // The plant's long-standing sheet, and still the pattern on four of the five
  // forms: centre, then two opposing corners.
  corners: {
    about: 'Three points, in order: minimum, target, maximum. Place the weights at the centre of the scale and at two opposing corners.',
    second: 'Without removing the first weight, add the second weight at a corner to reach the TARGET, and record the reading.',
    third: 'Add the third weight at the opposite corner to reach the MAXIMUM, and record the reading.',
  },
  // The revised sheet, supplied for the Batching PALLET scale. The weights go
  // either side of the centre weight rather than at corners — a different
  // physical instruction, which is why it is not applied to the other forms.
  centerline: {
    about: 'Three points, in this order: minimum, target, maximum. Place the first weight at the centre of the scale and the other two either side of it. Make sure the scale is zeroed before any weight goes on it.',
    second: 'Without removing the first weight, add the second weight(s) on both sides of the first weight(s) to reach the TARGET weight, and record the result.',
    third: 'Add the third weight(s) on the sides of the centre weight to reach the MAXIMUM weight, and record the result.',
  },
};

export const SCALE_PROCEDURE = {
  title: 'Scale Calibration Verification — procedure',
  note: 'Perform daily when operating in a production room. Scales are assigned to production rooms — check that the scale\'s asset tag matches the room number. If more than one scale will be used in the same room, notify QA for approval first.',
  // Filled in per form by `procedureFor()`. Present here so a caller that
  // renders the bare procedure still shows the common pattern rather than
  // an empty step.
  ...PLACEMENT_PATTERNS.corners,
  steps: [
    'Zero the scale before you begin.',
    'Place the MINIMUM weight in the centre of the scale and record the reading.',
    PLACEMENT_PATTERNS.corners.second,
    PLACEMENT_PATTERNS.corners.third,
    'You may re-check the zero between each point, and re-zero if it has drifted.',
    'QA/QC verifies the record before production starts.',
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

/**
 * The procedure as THIS form's operator should read it.
 *
 * Steps 3 and 4 are the placement steps and come from the form's own pattern;
 * everything else is shared. Served already assembled so the client renders
 * what it is given rather than deciding which wording applies — the same rule
 * the drill-downs follow.
 */
export function procedureFor(form) {
  const p = PLACEMENT_PATTERNS[form?.diagram] || PLACEMENT_PATTERNS.corners;
  const steps = SCALE_PROCEDURE.steps.slice();
  steps[2] = p.second;
  steps[3] = p.third;
  return { ...SCALE_PROCEDURE, about: p.about, steps };
}

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
    // The one scale whose placement sheet was revised: all three weights sit
    // in a row across the centre line rather than at opposing corners. Every
    // other form keeps the corner pattern, which is why this is a per-form
    // property and not a global change to the drawing.
    diagram: 'centerline',
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
  // VACUOUS TRUTH: `[].every()` is true, so a form with no points graded as
  // COMPLETE and PASS with zero readings -- the exact inversion of what this
  // function exists to refuse. Not hypothetical: controlled.js applies an
  // approved snapshot's `points` whenever it is an array, and [] is an array.
  // No points means nothing was weighed, and nothing weighed is not a pass.
  const empty = readings.length === 0;
  const complete = !empty && readings.every(r => r.value !== null);
  return { readings, complete, empty, result: complete && readings.every(r => r.pass) ? 'pass' : 'fail' };
}
