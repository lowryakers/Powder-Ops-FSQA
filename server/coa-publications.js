// Publishing a lot's certificates to the public page, and withdrawing them
// (D-247, COA Phase 2 tasks E2, E3, E6). Signed-in side only — the public
// router reads `coa_publications` and never imports this file.
//
//  · A LOT IS PUBLISHED WHOLE: every batch of the base lot at once, or none.
//  · Every check is named in words. An override is IGNORED here: it opens the
//    production sign-off door and nothing else.
//  · A publication is an immutable snapshot (triggers in db.js): it is never
//    rewritten and never deleted. Publishing a batch again supersedes the old
//    one; withdrawing leaves a tombstone.
import { randomBytes } from 'crypto';
import { v4 as uuid } from 'uuid';
import { evaluateLot, productFor, matcherFor } from './coa-lot-gate.js';
import { openUnreadItems } from './coa-checks.js';
import { canonicalJson, sha256, isSigned, snapshotFor } from './coa-certificate.js';
import { publicSnapshot, publicState, forbiddenIn, TEMPLATE_VERSION } from './coa-public-snapshot.js';

export const PUBLIC_BRAND = 'ProDough';
export const MIN_WITHDRAW_REASON = 10;
const parse = (s) => { try { return JSON.parse(s); } catch { return null; } };
export const newPublicId = () => randomBytes(9).toString('base64url').replace(/[-_]/g, 'x');

/** Does a pre-v2 signed snapshot re-evaluate to the same results today? */
function sameResults(a, b) {
  const key = (r) => `${String(r.test_type).toLowerCase()}|${String(r.result_value ?? '').replace(/\s+/g, '')}|${String(r.unit ?? '').toLowerCase()}|${r.pass_fail ?? ''}`;
  const A = (a || []).map(key).sort(); const B = (b || []).map(key).sort();
  return A.length === B.length && A.every((x, i) => x === B[i]);
}

/**
 * Everything that must be true before this lot can be published, each in
 * words. Reads every lab report again. `{ ok, checks, lot, product, plan, batches }`.
 */
export async function publishChecks(db, itemNumber, baseLot, uploadDir) {
  const checks = [];
  const add = (key, ok, text, batch = null) => checks.push({ key, ok: !!ok, text, batch });
  const { product, plan } = productFor(db, itemNumber);
  const requests = db.prepare('SELECT * FROM coa_requests WHERE item_number = ? AND base_lot = ? ORDER BY created_at').all(itemNumber, baseLot);
  add('brand', product?.brand_owner === PUBLIC_BRAND && requests.length > 0 && requests.every(r => r.brand_owner === PUBLIC_BRAND),
    product?.brand_owner !== PUBLIC_BRAND ? `Only ${PUBLIC_BRAND} products are published, and this product's brand is ${product?.brand_owner || 'not set'}.`
      : requests.every(r => r.brand_owner === PUBLIC_BRAND) ? `The brand is ${PUBLIC_BRAND}.` : `Every lab request in the lot must be assigned to ${PUBLIC_BRAND}.`);
  add('product', !!product && !!product.slug && !!product.display_name,
    !product ? 'The item is not on the COA product list.' : !product.slug || !product.display_name ? 'The product needs a public name and a web slug.' : `The product is "${product.display_name}" (/${product.slug}).`);
  add('plan', plan?.status === 'approved', plan?.status === 'approved' ? `Test plan "${plan.name}" v${plan.version} is approved.` : plan ? `Test plan "${plan.name}" is still a draft.` : 'The product has no test plan.');
  const lot = await evaluateLot(db, itemNumber, baseLot, { reread: true, uploadDir });
  add('lot', lot.met, lot.met ? `Lot rule: ${lot.summary}.` : `Lot rule: ${lot.summary}${lot.at_fault.length ? ` (${lot.at_fault.map(b => `batch ${b.batch ?? '—'}: ${b.reasons.join('; ')}`).join(' · ')})` : lot.problems.length ? ` (${lot.problems.join('; ')})` : ''}. An override does not count here.`);

  const batches = [];
  for (const b of lot.batches) {
    const r = requests.find(x => x.id === b.request_id);
    if (!r) continue;
    const label = b.batch ?? '—';
    const snap = parse(r.signed_snapshot);
    const signedOk = isSigned(r) && r.status === 'pass' && !!snap && sha256(r.signed_snapshot) === r.signed_content_hash;
    add('signed', signedOk, signedOk ? `Batch ${label}: signed certificate ${r.certificate_number}.` : `Batch ${label}: not a currently signed passing certificate.`, label);
    if (!snap) { batches.push({ batch: b.batch, request: r, snapshot: null }); continue; }
    const v2 = (snap.snapshot_version || 1) >= 2;
    const reEval = v2 || sameResults(snap.results, snapshotFor(db, r, { certificate_number: r.certificate_number, date_of_issuance: r.date_of_issuance }).results);
    add('snapshot', reEval, v2 ? `Batch ${label}: the signed record carries its sources.` : reEval ? `Batch ${label}: signed before sources were recorded, and re-evaluates to the same results.` : `Batch ${label}: signed before sources were recorded and no longer re-evaluates the same — re-sign it.`, label);
    const manual = (snap.results || []).filter(x => x.manual);
    add('no_hand_edits', !manual.length, manual.length ? `Batch ${label}: ${manual.map(x => x.test_type).join(', ')} entered or graded by hand. A hand-edited result is never published.` : `Batch ${label}: no result was entered or graded by hand.`, label);
    const fileShas = new Set((snap.files || []).map(f => f.sha256).filter(Boolean));
    const notPdf = (snap.results || []).filter(x => x.source !== 'pdf' || !x.source_file_sha256 || !fileShas.has(x.source_file_sha256));
    add('from_pdf', v2 && !notPdf.length, !v2 ? `Batch ${label}: the signed record does not say which lab report each result came from.` : notPdf.length ? `Batch ${label}: ${notPdf.map(x => x.test_type).join(', ')} not read from the attached lab report.` : `Batch ${label}: every result was read from the lab report.`, label);
    const rr = lot.rereads?.[r.id];
    add('reread', rr?.ok === true, rr?.ok ? `Batch ${label}: the lab report was read again and matches.` : `Batch ${label}: ${(rr?.problems || ['the lab report could not be read again']).join('; ')}.`, label);
    const unread = openUnreadItems(db, r.id).length;
    add('unread', !unread, unread ? `Batch ${label}: lines of the lab report are still unread (QA Review).` : `Batch ${label}: no unread lines.`, label);
    const facts = rr?.files?.find(f => f.lab_report_number || f.report_date) || {};
    const known = !!((snap.lab_report_number || facts.lab_report_number) && (snap.lab_report_date || facts.report_date));
    add('report_facts', known, known ? `Batch ${label}: the lab's report number and date are known (kept internal).` : `Batch ${label}: the lab's report number or report date is not known.`, label);
    batches.push({ batch: b.batch, request: r, snapshot: { ...snap, lab_report_date: snap.lab_report_date || facts.report_date || null } });
  }
  if (!lot.batches.length) add('batches', false, 'No lab request on file for this lot.');
  return { ok: checks.every(c => c.ok), checks, lot, product, plan, batches };
}

/** Build the public snapshots for a checked lot. Pure apart from the setting read. */
export function buildPublicSnapshots(db, chk, baseLot, ids) {
  const state = publicState(db);
  const siblings = chk.batches.map((b, i) => ({ batch: b.batch, public_id: ids[i] }));
  return chk.batches.map((b, i) => publicSnapshot({ signed: b.snapshot, product: chk.product, plan: chk.plan, lot: chk.lot, publicId: ids[i],
    batch: b.batch, baseLot, siblings: siblings.filter((_, j) => j !== i), nonclaimGluten: state.nonclaim_gluten, matcher: matcherFor() }));
}

/** Publish a checked lot. Supersedes what was live for each batch. One transaction. */
export function publishLot(db, chk, { by, baseLot }) {
  const ids = chk.batches.map(() => newPublicId());
  const snaps = buildPublicSnapshots(db, chk, baseLot, ids);
  const leak = snaps.flatMap(forbiddenIn);
  if (leak.length) throw Object.assign(new Error(`A public certificate may not carry: ${leak.join('; ')}`), { status: 409 });
  const out = [];
  db.transaction(() => {
    chk.batches.forEach((b, i) => {
      const json = canonicalJson(snaps[i]);
      const id = uuid();
      db.prepare(`INSERT INTO coa_publications (id, public_id, certificate_number, request_id, base_lot, batch, item_number, product_slug, brand_owner, snapshot, snapshot_sha256, template_version, published_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, ids[i], b.request.certificate_number, b.request.id, baseLot, b.batch ?? null,
        chk.product.item_number, chk.product.slug, PUBLIC_BRAND, json, sha256(json), TEMPLATE_VERSION, by);
      const old = db.prepare(`SELECT id, public_id FROM coa_publications WHERE item_number = ? AND base_lot = ? AND COALESCE(batch, '') = COALESCE(?, '')
        AND status = 'published' AND id != ?`).all(chk.product.item_number, baseLot, b.batch ?? null, id);
      for (const o of old) db.prepare("UPDATE coa_publications SET status = 'superseded', superseded_by_id = ? WHERE id = ?").run(id, o.id);
      out.push({ id, public_id: ids[i], batch: b.batch, certificate_number: b.request.certificate_number, superseded: old.map(o => o.public_id), snapshot_sha256: sha256(json) });
    });
  })();
  return out;
}

export function withdrawPublication(db, id, { by, reason }) {
  const p = db.prepare('SELECT * FROM coa_publications WHERE id = ?').get(id);
  if (!p) return { status: 404, error: 'No such publication.' };
  if (p.status !== 'published') return { status: 409, error: `This publication is already ${p.status}.` };
  db.prepare("UPDATE coa_publications SET status = 'withdrawn', withdrawn_by = ?, withdrawn_at = datetime('now'), withdrawn_reason = ? WHERE id = ?").run(by, reason, id);
  return { before: p, after: db.prepare('SELECT * FROM coa_publications WHERE id = ?').get(id) };
}

/** The list for the signed-in screen: no snapshot bodies. */
export function listPublications(db, { item = null, baseLot = null } = {}) {
  const where = []; const args = [];
  if (item) { where.push('item_number = ?'); args.push(item); }
  if (baseLot) { where.push('base_lot = ?'); args.push(baseLot); }
  return db.prepare(`SELECT id, public_id, certificate_number, request_id, base_lot, batch, item_number, product_slug, status, published_by, published_at,
    withdrawn_by, withdrawn_at, withdrawn_reason, superseded_by_id, snapshot_sha256 FROM coa_publications
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY published_at DESC LIMIT 500`).all(...args);
}
