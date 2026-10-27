// What the public certificate page may show (D-247, COA Phase 2 task E).
//
// `publicSnapshot()` is PURE: a signed certificate's frozen snapshot, the
// product row, the plan and the lot's state in — the ONLY fields the public
// page may carry out. The page, its JSON and its PDF all render this object
// and nothing else, so a field that is not built here cannot leak.
//
//  · NEVER: the laboratory's name, its report number, a person's name, an
//    internal id, the item number, "accredited" or "ISO". Any string carrying
//    one of the FORBIDDEN words is dropped, not printed (a belt for the braces).
//  · HIDDEN rows: gluten on a product that makes no gluten-free claim (decided
//    A-20261027-005, setting `public_nonclaim_gluten_display` = hidden), sensory
//    (organoleptic) tests, environmental tests, and report-only tests unless the
//    plan ticks them `public`.
//  · The gluten-free tile appears ONLY on a product with `gf_claim`, and only
//    when every batch of the lot supports the claim.
//  · Approved by "Powder Ops QA" — the plant, never a person.
export const TEMPLATE_VERSION = 1;
export const APPROVED_BY = 'Powder Ops QA';
export const SAMPLE_STATEMENT = 'Results apply to the sample tested.';
// Words that must never reach a public output, whatever field they arrive in.
export const FORBIDDEN = [/\bCTLA\b/i, /Columbia\s+(Food|Lab)/i, /accredit/i, /\bISO\b/i, /\bA2LA\b/i, /\bPJLA\b/i, /report\s*(no|number|#)/i];
export const isClean = (s) => !FORBIDDEN.some(re => re.test(String(s ?? '')));
const clean = (s) => (s == null || s === '' ? null : (isClean(s) ? String(s) : null));

const norm = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '');
export const isGluten = (name) => /gluten/i.test(String(name || ''));
export const isSensory = (name) => /organoleptic|sensory|appearance|odou?r|taste|flavou?r|colou?r|texture/i.test(String(name || ''));
export const isEnvironmental = (name) => /environment|swab|settle\s*plate|\bemp\b|air\s*(sample|quality)/i.test(String(name || ''));

/** Which plan test a result answers to (exact, normalized). */
const planTestFor = (plan, testType, matcher) => (plan?.tests || []).find(t => (matcher ? matcher(t.test_type, testType) : norm(t.test_type) === norm(testType))) || null;

/** Should this result row be on the public page? `{ show, why }`. */
export function rowVisibility(result, { plan, gfClaim, nonclaimGluten = 'hidden', matcher } = {}) {
  const name = result.test_type;
  if (isSensory(name)) return { show: false, why: 'sensory' };
  if (isEnvironmental(name)) return { show: false, why: 'environmental' };
  if (isGluten(name) && !gfClaim && nonclaimGluten !== 'visible') return { show: false, why: 'gluten (no claim)' };
  const pt = planTestFor(plan, name, matcher);
  if (pt?.evaluation === 'report_only' && !pt.public) return { show: false, why: 'report only' };
  if (!pt && !(result.min_value != null || result.max_value != null || result.specification)) return { show: false, why: 'no limit' };
  return { show: true };
}

const PASS_WORD = { pass: 'Pass', fail: 'Fail' };

/**
 * One batch's public certificate. `signed` is the request's frozen signed
 * snapshot (v2), `product` the coa_products row, `lot` the lot's readiness
 * (for the gluten-free tile), `publicId` the opaque public id.
 */
export function publicSnapshot({ signed, product, plan, lot, publicId, batch, baseLot, siblings = [], nonclaimGluten = 'hidden', matcher = null }) {
  const req = signed.request || {};
  const rows = [];
  const hidden = {};
  for (const r of signed.results || []) {
    const v = rowVisibility(r, { plan, gfClaim: !!product.gf_claim, nonclaimGluten, matcher });
    if (!v.show) { hidden[v.why] = (hidden[v.why] || 0) + 1; continue; }
    rows.push({
      test: clean(r.test_type),
      method: clean(r.method),
      result: clean(r.result_value),
      unit: clean(r.unit),
      limit: clean(r.specification) || limitText(r),
      outcome: PASS_WORD[r.pass_fail] || null,
    });
  }
  rows.sort((a, b) => String(a.test).localeCompare(String(b.test)));
  const gf = product.gf_claim ? { claimed: true, supported: lot?.claim_supported === true, text: lot?.claim_supported === true ? 'Gluten-free: under 20 ppm in every batch of this lot.' : null } : null;
  return {
    template_version: TEMPLATE_VERSION,
    public_id: publicId,
    product: clean(product.display_name),
    product_slug: product.slug,
    public_note: clean(product.public_note),
    lot: clean(baseLot),
    batch: batch == null ? null : String(batch),
    lot_number: clean(req.lot_number),
    certificate_number: clean(signed.certificate_number),
    date_of_issuance: clean(signed.date_of_issuance),
    tested_on: clean(signed.lab_report_date),
    best_by: clean(req.product_expiration),
    results: rows,
    hidden_counts: hidden,
    gluten_free: gf && gf.supported ? gf : null,
    other_batches: siblings.map(s => ({ batch: s.batch, public_id: s.public_id })),
    approved_by: APPROVED_BY,
    statement: SAMPLE_STATEMENT,
  };
}

function limitText(r) {
  const u = r.unit ? ` ${r.unit}` : '';
  if (r.min_value != null && r.max_value != null) return `${r.min_value} – ${r.max_value}${u}`;
  if (r.max_value != null) return `≤ ${round(r.max_value)}${u}`;
  if (r.min_value != null) return `≥ ${round(r.min_value)}${u}`;
  return null;
}
const round = (n) => String(Number(Number(n).toPrecision(6)));

/** Every string anywhere inside an object — what the forbidden-word check reads. */
export function allStrings(v, out = []) {
  if (v == null) return out;
  if (typeof v === 'string') out.push(v);
  else if (Array.isArray(v)) v.forEach(x => allStrings(x, out));
  else if (typeof v === 'object') Object.values(v).forEach(x => allStrings(x, out));
  return out;
}
export const forbiddenIn = (obj) => allStrings(obj).filter(s => !isClean(s));

/** The three switches, read. A database without the rows reads all closed. */
export function publicState(db) {
  const setting = (k, d) => { try { return db.prepare('SELECT value FROM coa_settings WHERE key = ?').get(k)?.value ?? d; } catch { return d; } };
  const brand = (() => { try { return db.prepare("SELECT public_publish_allowed p FROM coa_brands WHERE name = 'ProDough'").get()?.p === 1; } catch { return false; } })();
  return {
    enabled: setting('public_coa_enabled', 'off'),
    indexable: setting('public_coa_indexable', 'off'),
    frame_ancestors: setting('public_coa_frame_ancestors', 'none'),
    nonclaim_gluten: setting('public_nonclaim_gluten_display', 'hidden'),
    brand_allowed: brand,
  };
}
export const isLive = (s) => s.enabled === 'on' && s.brand_allowed === true;
