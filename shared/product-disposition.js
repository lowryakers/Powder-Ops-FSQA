// What happened to product measured on a device that turned out to be out of
// calibration — SQF Code 11.2.3.4, the minor raised at the 29–30 Sep 2026 audit
// ("disposition of product measured by an out-of-calibration device was not
// documented"). PURE: the server decides, the Calibration screen and the scale
// check log render the same words, so the two cannot offer different answers.
//
// WHEN IT IS OWED is part of the definition, not a screen's guess:
//   - a calibration that FAILED, or was ADJUSTED to pass (it was found out of
//     tolerance — that is what "adjusted" means);
//   - a daily scale check that FAILED.
// A calibration that passes as found owes nothing, even if it was late: the
// device was shown to be in tolerance, so the product measured on it was too.
//
// THE STATE IS DERIVED from one stored column, `disposition`:
//   NULL       on a record that owes nothing           → 'not_required'
//   NULL       on a record that owes one (filed before
//              this existed)                           → 'not_recorded'
//   'pending'  owed, filed since, not yet decided      → 'pending'
//   a key      decided                                 → 'recorded'
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
    help: 'Name the lots retested and the result.',
  },
  on_hold: {
    label: 'Affected product placed on hold',
    help: 'Name the lots and give the On Hold or deviation number.',
    needsRef: true,
    refLabel: 'On Hold or deviation number',
  },
  rejected: {
    label: 'Affected product rejected or reworked',
    help: 'Name the lots and give the disposal, deviation or rework record.',
    needsRef: true,
    refLabel: 'Disposal, deviation or rework record',
  },
};

export const DISPOSITION_KEYS = Object.keys(DISPOSITIONS);

/** Does a record of this kind, with this result, owe a product disposition? */
export function dispositionRequired(kind, result) {
  if (kind === 'calibration') return result === 'fail' || result === 'adjusted_pass';
  if (kind === 'scale') return result === 'fail';
  return false;
}

/** 'not_required' | 'not_recorded' | 'pending' | 'recorded' */
export function dispositionState(kind, row) {
  if (!row) return 'not_required';
  const d = row.disposition;
  if (d && d !== 'pending') return 'recorded';
  if (!dispositionRequired(kind, row.result)) return 'not_required';
  return d === 'pending' ? 'pending' : 'not_recorded';
}

/**
 * Validate a disposition as somebody records it. Returns a list of errors in
 * plain words; empty means it may be stored.
 */
export function checkDisposition(body) {
  const errors = [];
  const key = body?.disposition;
  const def = DISPOSITIONS[key];
  if (!def) {
    errors.push('Choose what happened to the product measured on this device.');
    return errors;
  }
  if (String(body?.notes || '').trim().length < 3) {
    errors.push('Say what was assessed — which product and lots, and how you reached the answer.');
  }
  if (def.needsRef && !String(body?.ref || '').trim()) {
    errors.push(`${def.refLabel} is required for “${def.label}”.`);
  }
  return errors;
}

export const dispositionLabel = (key) => DISPOSITIONS[key]?.label || null;
