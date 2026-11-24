// The sell-sheet shelf life is READ FROM THE STABILITY JUSTIFICATION (D-384).
//
// One fact, one owner: how long a SKU keeps is what its current stability
// justification says (`stability_justifications.shelf_life_months`, read through
// `shelfLifeBasis` in server/stability.js). The sell sheet, the distributor
// export and the readiness step read that figure; nobody types it on the product.
//
// - No justification on file ⇒ no figure: "no stability basis", and nothing can
//   be entered in its place.
// - A person may claim LESS than the basis (a customer wants a shorter date, a
//   conservative label), never more. That override is stored with who and why
//   (products.shelf_life_override_*), and it only counts while it is still
//   shorter than the basis: if the basis later drops below it, the basis wins
//   and the override is reported as stale.
// - The value people typed before this rule (`products.shelf_life_months_commercial`)
//   is left exactly as it was. It is no longer read as the figure; it is only
//   compared, so a typed value LONGER than the justification is flagged on
//   Completeness for a person to look at.
//
// PURE: both sides import it, so the product page cannot show a figure the
// server would refuse.

const whole = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

export const NO_BASIS_LABEL = 'No stability basis';

/**
 * @param {{ basis_months?: number|null, override_months?: number|null, typed_months?: number|null }} input
 * @returns {{ months: number|null, source: 'stability'|'override'|null, no_basis: boolean,
 *   basis_months: number|null, override_months: number|null, override_active: boolean,
 *   override_stale: boolean, typed_months: number|null, typed_longer: boolean }}
 */
export function sellSheetShelfLife({ basis_months, override_months, typed_months } = {}) {
  const basis = whole(basis_months);
  const override = whole(override_months);
  const typed = whole(typed_months);
  const noBasis = basis === null;
  const overrideActive = !noBasis && override !== null && override > 0 && override < basis;
  return {
    months: noBasis ? null : (overrideActive ? override : basis),
    source: noBasis ? null : (overrideActive ? 'override' : 'stability'),
    no_basis: noBasis,
    basis_months: basis,
    override_months: override,
    override_active: overrideActive,
    // An override on file that no longer applies — no basis any more, or the
    // basis is now as short as (or shorter than) the override.
    override_stale: override !== null && !overrideActive,
    typed_months: typed,
    typed_longer: !noBasis && typed !== null && typed > basis,
  };
}

/** Why an override is refused, or null. `basis_months` null ⇒ no basis. */
export function overrideRefusal(months, basis_months) {
  const basis = whole(basis_months);
  if (basis === null) {
    return { status: 409, code: 'NO_STABILITY_BASIS', error: 'This SKU has no stability justification on file, so it has no shelf life to shorten. Record the basis under Retention Samples → Stability first.' };
  }
  const n = whole(months);
  if (n === null || !Number.isInteger(n) || n <= 0) {
    return { status: 400, code: 'FIELD_FORMAT', error: 'The shelf life is a whole number of months, more than 0.' };
  }
  if (n >= basis) {
    return { status: 400, code: 'OVERRIDE_NOT_SHORTER', basis_months: basis,
      error: `An override must be shorter than the stability basis (${basis} months). The sell sheet already reads ${basis} months without one.` };
  }
  return null;
}
