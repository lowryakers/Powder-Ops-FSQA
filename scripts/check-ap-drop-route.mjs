// The M4 detector, pure. A vendor or bill-to that names the partner routes
// with high confidence; a mention in the body text alone is a question, not a
// draft; an unrelated vendor is nothing. Direction follows who is billed.
import assert from 'node:assert/strict';
import { detectPartner, partnerPatterns } from '../server/ap-drop-route.js';

let n = 0, bad = 0;
const ok = (label, fn) => {
  n++;
  try { fn(); } catch (e) { bad++; console.log(`  FAIL  ${label}\n        ${e.message}`); return; }
  console.log(`  ok    ${label}`);
};
const M4 = { id: 'p-m4', name: 'M4 Dynamics', code: 'M4', terms_days: 30 };
const partners = [M4];

console.log('\nPatterns');
ok('the partner is matched by its full name, the singular QuickBooks spelling, and its code as a whole word', () => {
  const texts = partnerPatterns(M4).map(p => p.text);
  assert.deepEqual(texts, ['M4 Dynamics', 'M4 Dynamic', 'M4']);
});
ok('the code is a whole word: "M4FF Matcha" and "KM40" are not the partner', () => {
  const pats = partnerPatterns(M4);
  assert.equal(pats.some(p => p.re.test('M4FF Matcha Finished Good')), false);
  assert.equal(pats.some(p => p.re.test('Model KM40')), false);
  assert.equal(pats.some(p => p.re.test('Bill To: M4')), true);
  assert.equal(pats.some(p => p.re.test('m4-invoice-0917.pdf')), true);
});

console.log('\nHigh confidence — a party to the document');
ok('vendor = M4 → high, payable', () => {
  const r = detectPartner({ partners, fields: { vendor_name: 'M4 Dynamic', bill_to: 'Powder Ops LLC' }, text: 'M4 Dynamic INVOICE Bill To: Powder Ops' });
  assert.equal(r.confidence, 'high'); assert.equal(r.direction, 'payable'); assert.equal(r.partner.id, 'p-m4');
  assert.deepEqual(r.matched_on, ['vendor']);
});
ok('bill-to = M4 → high, receivable', () => {
  const r = detectPartner({ partners, fields: { vendor_name: 'Powder Ops', bill_to: 'M4 Dynamics' }, text: 'Powder Ops INVOICE Bill To: M4 Dynamics' });
  assert.equal(r.confidence, 'high'); assert.equal(r.direction, 'receivable');
});
ok('the submitter typing M4 in the note is enough on its own', () => {
  const r = detectPartner({ partners, fields: { vendor_name: null }, typed: { notes: 'This one is for the M4 recon' }, text: '' });
  assert.equal(r.confidence, 'high'); assert.deepEqual(r.matched_on, ['typed_notes']);
});
ok('the filename counts (a photo named m4-inv-771.jpg with no readable text)', () => {
  const r = detectPartner({ partners, fields: { filename: 'm4-inv-771.jpg' }, text: '' });
  assert.equal(r.confidence, 'high'); assert.equal(r.direction, 'payable'); assert.match(r.direction_reason, /filed as payable/);
});
ok('vendor AND bill-to both M4 (a credit memo) falls back to the text reader', () => {
  const r = detectPartner({ partners, fields: { vendor_name: 'M4 Dynamics', bill_to: 'M4 Dynamics' }, text: 'Powder Ops LLC\nCREDIT MEMO\nBill To: M4 Dynamics' });
  assert.equal(r.confidence, 'high'); assert.equal(r.direction, 'receivable');
});

console.log('\nLow confidence — a mention');
ok('M4 only in the body text → low, no direction, reason names the gap', () => {
  const r = detectPartner({ partners, fields: { vendor_name: 'Mountain Flavor Supply', bill_to: 'Powder Ops' }, text: 'Mountain Flavor Supply\nShip To: M4 Dynamics warehouse\nAmount Due $12.00' });
  assert.equal(r.confidence, 'low'); assert.equal(r.direction, null); assert.deepEqual(r.matched_on, ['text']);
  assert.match(r.reason, /neither the vendor nor the bill-to/);
});
ok('a PO reference READ off the page is body text, not a typed one', () => {
  const r = detectPartner({ partners, fields: { vendor_name: 'Acme Films', po_or_co_ref: 'CO M4-2210' }, text: 'Acme Films CO M4-2210' });
  assert.equal(r.confidence, 'low');
});

console.log('\nNothing');
ok('an ordinary vendor matches nothing', () => {
  const r = detectPartner({ partners, fields: { vendor_name: 'Mountain Flavor Supply', bill_to: 'Powder Ops' }, text: 'Mountain Flavor Supply INVOICE Bill To: Powder Ops Amount Due $873.44' });
  assert.equal(r.partner, null); assert.equal(r.confidence, null);
});
ok('no partners set up → nothing, and says so', () => {
  const r = detectPartner({ partners: [], fields: { vendor_name: 'M4 Dynamics' } });
  assert.equal(r.partner, null); assert.match(r.reason, /No reconciliation partners/);
});

console.log(`\n${n - bad}/${n} assertions passed`);
process.exit(bad ? 1 : 0);
