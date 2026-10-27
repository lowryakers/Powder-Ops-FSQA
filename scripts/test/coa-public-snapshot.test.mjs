// What the public certificate may show (D-247), pure: server/coa-public-snapshot.js
// and its renderer. Every output is grepped for the words that must never be
// public: the laboratory, a report number, "accredited", "ISO".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { publicSnapshot, rowVisibility, forbiddenIn, isClean, APPROVED_BY, SAMPLE_STATEMENT } from '../../server/coa-public-snapshot.js';
import { certificateHtml, tombstoneHtml, lotHtml, skuHtml, verifyHtml, embedHtml, NOT_FOUND_HTML, certificatePdf } from '../../server/coa-public-render.js';

const signed = {
  snapshot_version: 2, certificate_number: '160123', date_of_issuance: '2026-10-20', signed_by: 'Maria Servin',
  lab_report_number: 'CTLA-2026-55123', lab_report_date: '2026-10-15',
  request: { lot_number: '101690-1', item_number: 'FG0971', product_expiration: '2027-10-01', lab_name: 'CTLA', lab_id: 'lab-1', supplier: 'Columbia Food Lab' },
  files: [{ id: 'f1', original_name: 'CTLA 55123.pdf', sha256: 'a'.repeat(64), lab_report_number: 'CTLA-2026-55123' }],
  results: [
    { id: 'r1', test_type: 'Lead', result_value: '0.02', unit: 'ppm', pass_fail: 'pass', method: 'USP <233>', specification: '≤ 0.5 ppm', source: 'pdf' },
    { id: 'r2', test_type: 'Gluten Allergen', result_value: '<4', unit: 'ppm', pass_fail: 'pass', method: 'ELISA', specification: 'Internal limit < 20 ppm' },
    { id: 'r3', test_type: 'Organoleptic — Appearance', result_value: 'Conforms', pass_fail: 'pass' },
    { id: 'r4', test_type: 'Moisture', result_value: '4.1', unit: '%', pass_fail: null },
    { id: 'r5', test_type: 'Salmonella', result_value: 'Absent in 25g', pass_fail: 'pass', method: 'ISO 6579 (CTLA accredited)', specification: 'Absent' },
  ],
};
const plan = { status: 'approved', tests: [
  { test_type: 'Lead', evaluation: 'limit' }, { test_type: 'Gluten Allergen', evaluation: 'limit' },
  { test_type: 'Moisture', evaluation: 'report_only', public: 0 }, { test_type: 'Salmonella', evaluation: 'limit' },
] };
const product = { item_number: 'FG0971', display_name: 'Gluten Free Flour', slug: 'gluten-free-flour', gf_claim: 0, brand_owner: 'ProDough' };
const snap = (over = {}) => publicSnapshot({ signed, product, plan, lot: { claim_supported: true }, publicId: 'Ab3dEf9h', batch: '1', baseLot: '101690', ...over });

test('only allowed fields: no lab, no report number, no person, no internal id', () => {
  const s = snap();
  assert.deepEqual(Object.keys(s).sort(), ['approved_by', 'batch', 'best_by', 'certificate_number', 'date_of_issuance', 'gluten_free', 'hidden_counts', 'lot', 'lot_number',
    'other_batches', 'product', 'product_slug', 'public_id', 'public_note', 'results', 'statement', 'template_version', 'tested_on'].sort());
  assert.equal(s.approved_by, APPROVED_BY); assert.equal(s.statement, SAMPLE_STATEMENT);
  const text = JSON.stringify(s);
  for (const word of ['CTLA', '55123', 'Maria', 'Servin', 'FG0971', 'lab-1', 'r1', 'f1', 'Columbia']) assert.ok(!text.includes(word), `"${word}" leaked`);
  assert.deepEqual(forbiddenIn(s), []);
});

test('a method naming the lab or its accreditation is dropped, not printed', () => {
  const salm = snap().results.find(r => r.test === 'Salmonella');
  assert.equal(salm.method, null);
  assert.equal(isClean('ISO 6579'), false); assert.equal(isClean('USP <233>'), true);
});

test('hidden: gluten without a claim, sensory, report-only unless ticked', () => {
  const s = snap();
  assert.deepEqual(s.results.map(r => r.test).sort(), ['Lead', 'Salmonella']);
  assert.deepEqual(s.hidden_counts, { 'gluten (no claim)': 1, sensory: 1, 'report only': 1 });
  const ticked = snap({ plan: { ...plan, tests: plan.tests.map(t => (t.test_type === 'Moisture' ? { ...t, public: 1 } : t)) } });
  assert.ok(ticked.results.some(r => r.test === 'Moisture'));
  assert.equal(rowVisibility({ test_type: 'Environmental swab — Room 4' }, { plan }).show, false);
  assert.equal(rowVisibility({ test_type: 'Gluten Allergen' }, { plan, gfClaim: false, nonclaimGluten: 'visible' }).show, true);
});

test('the gluten-free tile only on a product with the claim, and only when the lot supports it', () => {
  assert.equal(snap().gluten_free, null);
  const gf = snap({ product: { ...product, gf_claim: 1 } });
  assert.equal(gf.gluten_free?.supported, true);
  assert.ok(gf.results.some(r => r.test === 'Gluten Allergen'), 'the claim product shows its gluten result');
  assert.equal(snap({ product: { ...product, gf_claim: 1 }, lot: { claim_supported: false } }).gluten_free, null);
});

test('every rendering is clean, and the PDF is a PDF', async () => {
  const s = snap({ product: { ...product, gf_claim: 1 }, siblings: [{ batch: '2', public_id: 'Zz9yXw8v' }] });
  const pages = [certificateHtml(s), certificateHtml(s, { banner: 'This certificate was replaced.' }), tombstoneHtml({ withdrawnOn: '2026-10-21 10:00:00' }),
    lotHtml({ product: 'Gluten Free Flour', lot: '101690', batches: [{ batch: '1', public_id: 'Ab3dEf9h', certificate_number: '160123' }] }),
    skuHtml({ product: 'Gluten Free Flour', slug: 'gluten-free-flour', lots: [{ base_lot: '101690', batches: 2, issued: '2026-10-20' }] }),
    verifyHtml({ cert: '160123', lot: '101690-1', asked: true, found: { public_id: 'Ab3dEf9h', certificate_number: '160123', lot_number: '101690-1', product: 'Gluten Free Flour' } }),
    embedHtml({ product: 'Gluten Free Flour', slug: 'gluten-free-flour', latest: '101690' }), NOT_FOUND_HTML];
  for (const html of pages) {
    assert.ok(isClean(html), 'a page carries a forbidden word');
    assert.ok(!/<script/i.test(html), 'no script on a public page');
    assert.ok(!/https?:\/\//i.test(html), 'no external resource');
  }
  assert.match(pages[0], /Gluten-free: under 20 ppm/);
  assert.match(pages[0], /Approved by Powder Ops QA/);
  assert.ok(certificateHtml({ ...s, product: '<img src=x onerror=alert(1)>' }).includes('&lt;img'), 'text is escaped');
  const out = new PassThrough(); const chunks = [];
  out.on('data', c => chunks.push(c));
  const done = new Promise(r => out.on('end', r));
  certificatePdf(s, out);
  await done;
  const pdf = Buffer.concat(chunks);
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
});
