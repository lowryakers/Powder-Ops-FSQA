// What happened to product measured on a device that turned out to be out of
// calibration — SQF Code 11.2.3.4, the minor raised at the 29–30 Sep 2026 audit
// ("disposition of product measured by an out-of-calibration device was not
// documented"). PURE: the server decides, the Calibration screen and the scale
// check log render the same words, so the two cannot offer different answers.
//
// WHEN IT IS OWED is part of the definition, not a screen's guess:
//   - a calibration that FAILED, or was ADJUSTED to pass (it was found out of
//     tolerance — that is what "adjusted" means);
//   - a daily scale check that FAILED;
//   - a scale reported DROPPED OR DAMAGED (D-194) — an event, not a
//     measurement, so it always owes one.
// A calibration that passes as found owes nothing, even if it was late: the
// device was shown to be in tolerance, so the product measured on it was too.
//
// THE STATE IS DERIVED from one stored column, `disposition`:
//   NULL       on a record that owes nothing           → 'not_required'
//   NULL       on a record that owes one (filed before
//              this existed)                           → 'not_recorded'
//   'pending'  owed, filed since, not yet decided      → 'pending'
//   'on_hold'  product held, not yet released          → 'held'      (D-194)
//   a key      decided                                 → 'recorded'
// ON HOLD IS NOT AN ANSWER, IT IS A STATE (D-194). Carol's procedure: "Product
// remains on hold until authorized release." So a finding answered "on hold"
// stays open — listed apart as held — until QA records what finally happened:
// released after evaluation, or rejected / reworked. The hold is kept in
// `disposition_history`, so the record shows both steps.
// Records filed before the rule are NOT rewritten to 'pending' — nothing is
// backfilled — but they are not hidden either: they read as 'not_recorded' and
// the screen lists them apart from the new ones, so the history the auditor
// asked about can be answered without lighting up the bell at deploy.

export const DISPOSITIONS = {
  not_used: {
    label: 'Not used on product',
    help: 'The device was not used to measure, test or inspect product since its last good check. Say how you know.',
  },
  no_impact: {
    label: 'Assessed — no effect on product',
    help: 'The error is too small to have put any product out of specification. Say what was assessed and why.',
  },
  retested_released: {
    label: 'Affected product retested and released',
    help: 'Name the lots, say how they were evaluated (reweighed on which verified scale) and the result.',
    needsLots: true,
    needsEvaluation: true,
  },
  on_hold: {
    label: 'Affected product placed on hold',
    help: 'Name the lots and give the On Hold number (FORM 424-01) or deviation number. This stays open until QA records the release, rework or rejection.',
    needsRef: true,
    refLabel: 'On Hold or deviation number',
    needsLots: true,
    interim: true,
  },
  rejected: {
    label: 'Affected product rejected or reworked',
    help: 'Name the lots and give the disposal, deviation or rework record.',
    needsRef: true,
    refLabel: 'Disposal, deviation or rework record',
    needsLots: true,
    needsEvaluation: true,
  },
};

/** Answers that close a held finding: the hold itself cannot close it. */
export const FINAL_AFTER_HOLD = ['retested_released', 'no_impact', 'rejected'];

export const DISPOSITION_KEYS = Object.keys(DISPOSITIONS);

/** Does a record of this kind, with this result, owe a product disposition? */
export function dispositionRequired(kind, result) {
  if (kind === 'calibration') return result === 'fail' || result === 'adjusted_pass';
  if (kind === 'scale') return result === 'fail';
  if (kind === 'incident') return true;
  return false;
}

/** 'not_required' | 'not_recorded' | 'pending' | 'held' | 'recorded' */
export function dispositionState(kind, row) {
  if (!row) return 'not_required';
  const d = row.disposition;
  if (d === 'on_hold') return 'held';
  if (d && d !== 'pending') return 'recorded';
  if (!dispositionRequired(kind, row.result)) return 'not_required';
  return d === 'pending' ? 'pending' : 'not_recorded';
}

/**
 * Validate a disposition as somebody records it. Returns a list of errors in
 * plain words; empty means it may be stored.
 */
export function checkDisposition(body, { held = false } = {}) {
  const errors = [];
  const key = body?.disposition;
  const def = DISPOSITIONS[key];
  if (!def) {
    errors.push('Choose what happened to the product measured on this device.');
    return errors;
  }
  if (held && !FINAL_AFTER_HOLD.includes(key)) {
    errors.push('The product is already on hold. Record how it was released, reworked or rejected.');
    return errors;
  }
  if (String(body?.notes || '').trim().length < 3) {
    errors.push('Say what was assessed — which product and lots, and how you reached the answer.');
  }
  if (def.needsRef && !String(body?.ref || '').trim()) {
    errors.push(`${def.refLabel} is required for “${def.label}”.`);
  }
  // Carol's list: affected lots, quantities, evaluation results. Lots and the
  // evaluation are asked where the answer is about product that exists;
  // quantity is recorded when given (a lot is not always counted in one unit).
  if (def.needsLots && !String(body?.lots || '').trim()) {
    errors.push(`Name the affected lots for “${def.label}”.`);
  }
  if (def.needsEvaluation && !String(body?.evaluation || '').trim()) {
    errors.push(`Record the evaluation result for “${def.label}” — how the product was checked and what it showed.`);
  }
  return errors;
}

export const dispositionLabel = (key) => DISPOSITIONS[key]?.label || null;
