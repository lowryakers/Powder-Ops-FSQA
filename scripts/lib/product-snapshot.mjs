// What the Products module says about the FOOD catalogue, read through the API.
//
// Used to prove that adding merch (D-302) changed nothing for food: take it
// before, take it after, compare. Merch rows are recognised by their line
// (`MCH-` SKUs) so the same function works on code that has never heard of
// product_type. Every figure is read off the API the screens read, and the
// per-SKU detail is hashed so "identical" means identical, not "the totals
// happen to agree".
import { createHash } from 'crypto';

const isMerch = (sku) => /^MCH-/i.test(String(sku || ''));
const food = (rows) => (rows || []).filter((r) => !isMerch(r.sku));
const hash = (v) => createHash('sha256').update(JSON.stringify(v)).digest('hex').slice(0, 16);
const tally = (rows, key) => rows.reduce((m, r) => { const k = String(key(r)); m[k] = (m[k] || 0) + 1; return m; }, {});
const sortObj = (o) => Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b)));

export async function productSnapshot(url, headers, { proofToken } = {}) {
  const get = async (p) => {
    const r = await fetch(`${url}/api${p}`, { headers });
    if (!r.ok) throw new Error(`${p} → ${r.status}`);
    return r.json();
  };
  const list = food((await get('/products')).products);
  // Strip the fields that legitimately differ between runs (stamps, ids).
  const perSku = list.map((p) => ({
    sku: p.sku, status: p.status, gtin: p.gtin, preferred_sku: p.preferred_sku,
    preferred_sku_blocked_by: p.preferred_sku_blocked_by,
    readiness: (p.readiness?.steps || []).map((s) => [s.key, s.state, s.reason]),
    stage: [p.stage?.stage, p.stage?.next?.key, (p.stage?.gates || []).map((g) => [g.key, g.state, g.why])],
  }));

  const nfp = await get('/nfp/review-queue');
  const nfpMissing = food(nfp.missing_panel);
  const nfpList = food((await get('/nfp')).missing);

  const comp = await get('/products/completeness');
  const compRows = food(comp.rows || comp.products || comp.skus || []);

  const bc = await get('/products/barcodes');
  const bcRows = food(bc.rows || bc.products || []);

  const dh = await get('/products/data-health');
  const fc = await get('/products/flavor-codes');

  let master = null;
  if (proofToken) {
    const r = await fetch(`${url}/api/products/master.csv?token=${encodeURIComponent(proofToken)}`);
    const text = await r.text();
    master = { status: r.status, lines: text.split('\n').length, hash: hash(text) };
  }

  return {
    products: list.length,
    by_status: sortObj(tally(list, (p) => p.status)),
    no_approved_panel: list.filter((p) => !p.nfp_approved_at).length,
    readiness: sortObj(tally(list, (p) => `${p.readiness?.done}/${p.readiness?.total}`)),
    readiness_stale: list.filter((p) => (p.readiness?.stale || []).length).length,
    stage: sortObj(tally(list, (p) => p.stage?.stage)),
    stage_needs_work: list.filter((p) => p.stage?.needs_work).length,
    nfp_missing_panel: nfpMissing.length,
    nfp_list_missing: nfpList.length,
    completeness: sortObj(tally(compRows, (r) => r.state)),
    completeness_hash: hash(compRows.map((r) => [r.sku, r.state, r.missing, r.na])),
    barcodes: sortObj(tally(bcRows, (r) => r.state)),
    prefixes: (bc.prefixes || []).map((x) => `${x.prefix} ${x.used}/${x.free}${x.low ? ' low' : ''}`).sort(),
    data_health: { products: dh.products, counts: dh.counts, noted: dh.noted, amazon: dh.amazon, affected: dh.affected },
    flavor_codes: { codes: (fc.codes || []).length, needs_decision: (fc.needs_decision || []).length },
    master_csv: master,
    per_sku_hash: hash(perSku),
  };
}
