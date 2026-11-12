// Inner and case GS1 codes: CHECKED, NEVER BUILT (R-0645, D-342).
//
// Every GTIN is allocated in the GS1 US Data Hub and copied into ReadyDoc. This
// file only ever answers "is the code a person pasted a good copy?" — the check
// digit, the indicator the policy expects, and whether it belongs to this
// product's unit (the same twelve middle digits). It never computes a check
// digit for a code that lacks one, never flips an indicator to make a case
// from a unit, and never "fixes" a pasted value. A refusal says to copy the
// code from GS1.
//
// Display typography IS allowed: the unit GTIN-14 of a stored UPC-12 is `00` +
// the UPC-12 — the same number with the same check digit (shared/gtin.js) — and
// the sell sheet groups a GTIN-14 as 3-5-5-1. Nothing here is stored.

import { normalizeGtin, gtinValid } from './gtin.js';
import { INDICATOR_POLICY, INDICATOR_POLICY_MODE } from './product-sot-config.js';

const LEVEL_NAME = { inner: 'inner pack', case: 'case' };
const digits = (raw) => String(raw ?? '').replace(/[\s-]/g, '');

/** The GTIN-14 spelling of a stored unit code, for display and export only. Null when there is none. */
export function unitGtin14(unit) {
  const u = normalizeGtin(unit);
  if (!u || !/^\d+$/.test(u) || u.length > 14) return null;
  return u.padStart(14, '0');
}

/** The twelve digits between the indicator and the check digit of a GTIN-14. */
export const mid12 = (gtin14) => (gtin14 && gtin14.length === 14 ? gtin14.slice(1, 13) : null);

/** `008-50046-72682-8` — the 3-5-5-1 grouping the distributor sheet prints. */
export function groupGtin14(gtin14) {
  const g = digits(gtin14);
  if (!/^\d{14}$/.test(g)) return g || '';
  return `${g.slice(0, 3)}-${g.slice(3, 8)}-${g.slice(8, 13)}-${g.slice(13)}`;
}

/** Does an inner/case code belong to this unit (same twelve middle digits)? Null when either is missing. */
export function sameItem(levelGtin, unit) {
  const u = unitGtin14(unit);
  const l = digits(levelGtin);
  if (!u || !/^\d{14}$/.test(l)) return null;
  return mid12(l) === mid12(u);
}

/**
 * Check a pasted inner or case code. `{ ok: true, value, warning? }` with the
 * value to store exactly as pasted (spacing removed), or `{ ok: false, error,
 * expected }`. A blank clears the field.
 *
 * `opts.unit` is the product's stored unit GTIN; when present the code must
 * share its twelve middle digits. `opts.mode` overrides INDICATOR_POLICY_MODE
 * (tests only).
 */
export function checkLevelGtin(level, raw, opts = {}) {
  if (raw === null || raw === undefined || String(raw).trim() === '') return { ok: true, value: null };
  const name = LEVEL_NAME[level] || level;
  const want = INDICATOR_POLICY[level];
  const fromGs1 = 'Copy it from the GS1 Data Hub — ReadyDoc never makes or corrects a GTIN.';
  const expected = `a 14-digit GTIN-14 with indicator ${want} and a valid check digit, as allocated in GS1`;
  const v = digits(raw);
  if (!/^\d{14}$/.test(v)) {
    return { ok: false, expected, error: `The ${name} GTIN must be the 14-digit GTIN-14 (indicator ${want} first). "${String(raw).trim()}" is not. ${fromGs1}` };
  }
  if (!gtinValid(v)) {
    return { ok: false, expected, error: `${v} fails its GS1 check digit. ${fromGs1}` };
  }
  if (opts.unit) {
    const same = sameItem(v, opts.unit);
    if (same === false) {
      return { ok: false, expected, error: `${v} is not this product's ${name}: its middle twelve digits do not match the unit GTIN ${normalizeGtin(opts.unit)}. ${fromGs1}` };
    }
  }
  if (v[0] !== want) {
    const msg = `${v} starts with indicator ${v[0]}; a new ${name} code is expected to start with ${want} (Each 0, Inner 3, Case 1). ${fromGs1}`;
    if ((opts.mode || INDICATOR_POLICY_MODE) === 'reject') return { ok: false, expected, error: msg };
    return { ok: true, value: v, warning: msg };
  }
  return { ok: true, value: v };
}
