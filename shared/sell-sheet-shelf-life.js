// THE SELL SHEET'S SHELF LIFE IS READ OFF THE STABILITY BASIS (D-374). PURE.
//
// `products.shelf_life_months_commercial` (D-342) was a typed number, and the
// stability justification in force for the SKU (D-133) carries its own months.
// Two owners of one fact: a sell sheet could promise 24 months on a SKU whose
// basis supports 18, and nothing compared them. Now the figure every reader
// sees under `shelf_life_months_commercial` is DERIVED here:
//
//   - no basis on file (or a basis that records no months) ⇒ null, "no stability
//     basis", and nothing may be typed in its place;
//   - otherwise the basis's months;
//   - unless a person has recorded an OVERRIDE that is LOWER than the basis —
//     a shorter commercial promise is always safe, a longer one never is. An
//     override that is no longer lower (the basis later dropped to or below it)
//     is SUPERSEDED: the basis wins and the override is reported, not applied.
//
// The stored column is no longer read for the value. A figure typed there before
// this change is reported as `legacy_months` so a disagreement can be seen; it is
// never rewritten.

export const SELL_SHEET_FIELD = 'shelf_life_months_commercial';
export const OVERRIDE_REASON_MIN = 10;
export const NO_BASIS_LABEL = 'No stability basis';

const posInt = (v) => (v === null || v === undefined || v === '' ? null : (Number.isInteger(Number(v)) && Number(v) > 0 ? Number(v) : null));

/**
 * basis: the D-133 answer for the SKU ({ recorded, shelf_life_months, justification_id, decided_on }) or null.
 * row:   the product row (override columns + the legacy stored figure).
 */
export function sellSheetShelfLife(basis, row = {}) {
  const basisMonths = basis?.recorded ? posInt(basis.shelf_life_months) : null;
  const overrideMonths = posInt(row.shelf_life_override_months);
  const override = overrideMonths === null ? null : {
    months: overrideMonths,
    reason: row.shelf_life_override_reason || null,
    by: row.shelf_life_override_by || null,
    at: row.shelf_life_override_at || null,
    superseded: basisMonths === null || overrideMonths >= basisMonths,
  };
  let months = basisMonths;
  let source = basisMonths === null ? 'no_basis' : 'basis';
  if (override && !override.superseded) { months = override.months; source = 'override'; }
  return {
    months,
    source,
    basis_months: basisMonths,
    basis_recorded: !!basis?.recorded,
    justification_id: basis?.justification_id || null,
    basis_decided_on: basis?.decided_on || null,
    override,
    legacy_months: posInt(row[SELL_SHEET_FIELD]),
    label: months === null ? NO_BASIS_LABEL : `${months} months${source === 'override' ? ' (override)' : ''}`,
  };
}

/** Why an override cannot be recorded, or null. `months` is the proposed figure. */
export function overrideRefusal(basisMonths, months, reason) {
  if (basisMonths === null) {
    return { status: 409, code: 'NO_STABILITY_BASIS', error: 'This SKU has no stability basis with a shelf life in months, so there is nothing to lower. Record the basis on Retention Samples → Stability first.' };
  }
  const m = posInt(months);
  if (m === null) return { status: 400, code: 'OVERRIDE_NOT_A_NUMBER', error: 'The override is a whole number of months, above zero.' };
  if (m >= basisMonths) {
    return { status: 400, code: 'OVERRIDE_NOT_LOWER', basis_months: basisMonths,
      error: `An override must be lower than the stability basis (${basisMonths} months). A longer shelf life than the data supports cannot go on a sell sheet.` };
  }
  if (String(reason || '').trim().length < OVERRIDE_REASON_MIN) {
    return { status: 400, code: 'REASON_REQUIRED', error: `Say why the sell sheet promises less than the basis (at least ${OVERRIDE_REASON_MIN} characters).` };
  }
  return null;
}
