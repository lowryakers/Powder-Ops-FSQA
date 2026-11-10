// normDocNumber, pure: one invoice number written several ways compares as one.
// Used by Partner Reconciliation and by AP Drop's link to an existing ledger
// document. Folding is for comparison only — stored numbers are never rewritten.
import assert from 'node:assert/strict';
import { normDocNumber as n } from '../server/partner-recon.js';

let count = 0, bad = 0;
const ok = (label, fn) => {
  count++;
  try { fn(); } catch (e) { bad++; console.log(`  FAIL  ${label}\n        ${e.message}`); return; }
  console.log(`  ok    ${label}`);
};

ok('INV-1589 = 1589', () => assert.equal(n('INV-1589'), n('1589')));
ok('Invoice #1589, invoice no. 1589, INV 1589, Invoice Number 1589 = 1589', () => {
  for (const v of ['Invoice #1589', 'invoice no. 1589', 'INV 1589', 'Invoice Number 1589', '#1589', ' 1589 ']) assert.equal(n(v), '1589', v);
});
ok('leading zeros fold on an all-digit number: inv 01589 = 01589 = 1589', () => {
  assert.equal(n('inv 01589'), '1589');
  assert.equal(n('01589'), '1589');
  assert.equal(n('0'), '0');
  assert.equal(n('000'), '0');
});
ok('I123 keeps its I; INV-I123 is still I123', () => {
  assert.equal(n('I123'), 'I123');
  assert.equal(n('INV-I123'), 'I123');
  assert.notEqual(n('I123'), n('123'));
});
ok('I0123 keeps its zero — zeros fold only on an all-digit number', () => {
  assert.equal(n('I0123'), 'I0123');
  assert.notEqual(n('I0123'), n('I123'));
});
ok('internal hyphens are part of the identity: M4-2210 stays, and is not M42210', () => {
  assert.equal(n('M4-2210'), 'M4-2210');
  assert.notEqual(n('M4-2210'), n('M42210'));
  assert.equal(n('I-7001'), 'I-7001');
  assert.equal(n('acme-91'), 'ACME-91');
});
ok('a number that merely starts with INV letters is left alone', () => {
  assert.equal(n('INVENTORY-7'), 'INVENTORY-7');
});
ok('null, empty and whitespace are null', () => {
  for (const v of [null, undefined, '', '   ', 'INV-', '#']) assert.equal(n(v), null, String(v));
});

console.log(`\n${count - bad} PASS / ${bad} FAIL`);
process.exit(bad ? 1 : 0);
