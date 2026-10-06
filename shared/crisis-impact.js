// The product and material impact of an evacuation or crisis test — SQF Code
// 2.6.4.2, the minor raised at the 29–30 Sep 2026 audit: "the annual crisis
// management test (fire drill) did not document the impact on product and
// materials". PURE: the server validates with it and the Safety screen runs
// the same check before it sends (D-154).
//
// NOT PART OF FORM 501-02 V1. The headcount form is transcribed verbatim and
// has no such section; this is held BESIDE it, labelled as such, until
// Document Control adds it at the next revision (the D-052 arrangement).
//
// AN ADDENDUM SAYS IT IS ONE. The assessment carries who wrote it and when;
// one written more than a day after the event reads as an addendum, never as
// if it had been written at the evacuation site. Nothing here back-dates.

export const IMPACT_SOURCE = 'SQF 2.6.4.2 — not on Form 501-02 V1';

export const EXPOSED = {
  no: 'No product, ingredient or packaging was affected',
  yes: 'Product, ingredient or packaging was affected',
};

/** Validate an assessment. [] means it may be stored. */
export function checkImpact(body) {
  const errors = [];
  const exposed = body?.product_exposed;
  if (!EXPOSED[exposed]) {
    errors.push('Say whether any product, ingredient or packaging was affected.');
    return errors;
  }
  if (String(body?.summary || '').trim().length < 3) {
    errors.push('Describe what was checked and what was found — open product, lines running, doors left open, materials in the dock.');
  }
  if (exposed === 'yes') {
    if (!String(body?.affected || '').trim()) errors.push('Name the product, lots or materials affected.');
    if (!String(body?.disposition || '').trim()) errors.push('Say what was done with them — held, inspected and released, or discarded (give the record number).');
  }
  return errors;
}

/** Keep only the assessment's own fields, trimmed. */
export function cleanImpact(body) {
  const t = (v) => String(v || '').trim() || null;
  return {
    product_exposed: body.product_exposed,
    summary: t(body.summary),
    affected: body.product_exposed === 'yes' ? t(body.affected) : null,
    disposition: body.product_exposed === 'yes' ? t(body.disposition) : null,
    actions: t(body.actions),
  };
}

/**
 * 'missing' | 'recorded' | 'addendum'. An assessment recorded more than one
 * day after the event is an addendum and is shown as one.
 */
export function impactState(row) {
  if (!row?.impact_at) return 'missing';
  const event = Date.parse(`${row.event_date}T00:00:00Z`);
  const at = Date.parse(String(row.impact_at).replace(' ', 'T') + (/[zZ]|[+-]\d\d:?\d\d$/.test(row.impact_at) ? '' : 'Z'));
  if (Number.isFinite(event) && Number.isFinite(at) && at - event > 2 * 86400000) return 'addendum';
  return 'recorded';
}
