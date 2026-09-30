// Form 117.21's answers as the Sanitation form edits them (D-125). Kept out of
// PreopChecklist.jsx so that file exports components only (fast refresh).

import { PREOP_CHECKS, SWAB_LINES } from '../../shared/preop-form.js';

export function emptyPreop() {
  return {
    product_name: '', wo_lot: '', allergens: [], clean_level: '',
    checks: Object.fromEntries(PREOP_CHECKS.map(c => [c.key, ''])),
    asset_tag: '', condition: '',
    atp: Array.from({ length: SWAB_LINES }, (_, i) => (i ? { location: '', swab_no: '', reading: '' } : { location: '', swab_no: '' })),
    allergen: Array.from({ length: SWAB_LINES }, () => ({ location: '', swab_no: '', result: '' })),
  };
}

/** A stored form onto the editable shape, so nothing reads `null` into an input. */
export function preopToState(stored) {
  const base = emptyPreop();
  if (!stored) return base;
  const s = (v) => v ?? '';
  return {
    ...base,
    product_name: s(stored.product_name), wo_lot: s(stored.wo_lot),
    allergens: stored.allergens || [], clean_level: s(stored.clean_level),
    checks: Object.fromEntries(PREOP_CHECKS.map(c => [c.key, s(stored.checks?.[c.key])])),
    asset_tag: s(stored.asset_tag), condition: s(stored.condition),
    atp: base.atp.map((l, i) => Object.fromEntries(Object.keys(l).map(k => [k, s(stored.atp?.[i]?.[k])]))),
    allergen: base.allergen.map((l, i) => Object.fromEntries(Object.keys(l).map(k => [k, s(stored.allergen?.[i]?.[k])]))),
  };
}
