// A scale (or any measuring instrument) that is dropped or damaged — D-194.
//
// The words are the plant's: the caution and the product-control steps were
// written by Carol and Daniela for the SQF 11.2.3.4 corrective action (October
// 2026) and belong to the Equipment Calibration SOP. WHICH NUMBER that SOP
// carries is the registry's answer, not this file's: the seeded DCR log says
// SOP 417, the live registry says SOP 415 V2 (415 is right — D-197), and the server reads it from
// `sop_documents` by title at serve time (`cautionWithDocument`), so a
// renumbering by Document Control needs no deploy. They live here, in
// `shared/`, because three screens print them — the scale kiosk, the
// Calibration screen and the dropped-scale report — and a second copy is how
// the kiosk and the office start telling the floor two different things.
//
// They are registered with `controlled.js` (`procedure:scale-caution`), so a
// change to the wording here parks for Document Control like a tolerance does;
// the app goes on printing the approved wording until it is approved.

export const SCALE_CAUTION = {
  // Filled from the registry by the server; null until it is found there.
  document: null,
  revision: null,
  document_title: 'Equipment Calibration',
  title: 'Caution',
  text: 'If a scale is dropped or subjected to impact, immediately stop using it, label it “OUT OF SERVICE,” '
    + 'and notify QA/QC; the scale must be inspected for damage, recalibrated by qualified personnel, and '
    + 'verified to meet established accuracy limits before QA/QC authorizes its return to use.',
  text_es: 'Si una báscula se cae o recibe un golpe, deje de usarla de inmediato, etiquétela “FUERA DE SERVICIO” '
    + 'y avise a QA/QC; la báscula debe ser inspeccionada por daños, recalibrada por personal calificado y '
    + 'verificada dentro de los límites de exactitud establecidos antes de que QA/QC autorice su regreso al uso.',
  product_control: [
    { step: 'Stop use', text: 'Remove the scale from service and notify Production and QA/QC. Record the time of the incident and the scale ID.' },
    { step: 'Identify affected product', text: 'Before the incident: QA reviews the last acceptable accuracy check and production records to determine whether earlier measurements are reliable. During or after the incident: place any product weighed using the dropped scale on HOLD until QA/QC completes its evaluation. If the timing or accuracy is uncertain, hold potentially affected product back to the last documented acceptable accuracy check.' },
    { step: 'Verify product', text: 'Reweigh or otherwise evaluate affected product using a verified, accurate scale. QA/QC determines whether the product meets weight, formulation, and other applicable requirements.' },
    { step: 'Determine disposition', text: 'QA/QC documents whether the product may be released, reworked, or rejected. Product remains on hold until authorized release.' },
    { step: 'Document and restart', text: 'Record affected lots, quantities, evaluation results, corrective actions, and QA/QC approval. Resume use of the scale only after inspection, recalibration, and documented verification that it meets accuracy limits.' },
  ],
};

export const INCIDENT_KINDS = {
  dropped: 'Dropped',
  impact: 'Hit or knocked',
  damaged: 'Damaged some other way',
};

/**
 * Check a report as somebody files it. Returns errors in plain words.
 * `now` is injectable so the "not in the future" rule can be tested.
 */
export function checkIncident(body, now = new Date()) {
  const errors = [];
  if (!INCIDENT_KINDS[body?.kind]) errors.push('Say what happened — dropped, hit, or damaged some other way.');
  if (!body?.instrument_id && !String(body?.scale_label || '').trim()) {
    errors.push('Say which scale it was.');
  }
  if (!String(body?.reported_by || '').trim()) errors.push('Your name is required.');
  if (!body?.occurred_at) errors.push('Say when it happened — the time matters, because product weighed after it goes on hold.');
  else {
    const t = Date.parse(body.occurred_at);
    if (!Number.isFinite(t)) errors.push('The time it happened could not be read.');
    else if (t > now.getTime() + 5 * 60 * 1000) errors.push('The time it happened cannot be in the future.');
  }
  return errors;
}

/**
 * What a return to use needs, in one place: the inspection, and a passing
 * check dated after the incident. `check` is { kind, result, at } or null.
 */
export function returnBlockers({ incident, check, inspection }) {
  const out = [];
  if (!String(inspection || '').trim() || String(inspection).trim().length < 3) {
    out.push('Say what the inspection found — the scale must be inspected for damage.');
  }
  if (!check) {
    out.push('No passing calibration or verification is on record since the incident. Recalibrate and verify the scale first.');
  } else if (incident?.occurred_at && String(check.at) < String(incident.occurred_at)) {
    out.push('The passing check is from before the incident, so it says nothing about the scale now.');
  }
  return out;
}
