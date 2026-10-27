// Lots, batches, the per-lot gluten roll-up, the gluten-free claim helper and
// the audit labels (D-237, D-239). Synthetic data only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitLot, rollUpLots, glutenSupportsGfClaim } from '../../shared/lot-model.js';
import { actionLabel } from '../../shared/audit-labels.js';
import { glutenCorrected } from '../../server/coa-review-items.js';

test('splitLot: a trailing -N or " N" after a 5+ character base is a batch', () => {
  assert.deepEqual(splitLot('101690-1'), { base_lot: '101690', batch: '1', suspect: false });
  assert.deepEqual(splitLot('101690 2'), { base_lot: '101690', batch: '2', suspect: false });
  assert.deepEqual(splitLot('101055 3'), { base_lot: '101055', batch: '3', suspect: false });
  assert.deepEqual(splitLot('101715 1'), { base_lot: '101715', batch: '1', suspect: false });
  assert.deepEqual(splitLot('101706'), { base_lot: '101706', batch: null, suspect: false });
});

test('splitLot: plain and vendor lots are unchanged; odd ProDough lots are flagged, never fixed', () => {
  assert.deepEqual(splitLot('L001118'), { base_lot: 'L001118', batch: null, suspect: false });
  assert.deepEqual(splitLot('958463'), { base_lot: '958463', batch: null, suspect: false });
  assert.deepEqual(splitLot('AB-1'), { base_lot: 'AB-1', batch: null, suspect: false }, 'base under five characters');
  assert.deepEqual(splitLot('10169-1'), { base_lot: '10169', batch: '1', suspect: true });
  assert.equal(splitLot('1011383').suspect, true);
  assert.equal(splitLot('1452306').suspect, false, 'a vendor number that does not start 10 is not a ProDough lot');
  assert.deepEqual(splitLot(''), { base_lot: null, batch: null, suspect: false });
});

const pass = [{ pass_fail: 'pass', result_value: '<4', unit: 'ppm' }];
test('roll-up: every batch a signed pass ⇒ the base lot meets the policy', () => {
  const [l] = rollUpLots([
    { lot_number: '101690-1', signed: true, gluten: pass },
    { lot_number: '101690-2', signed: true, gluten: pass },
  ]);
  assert.equal(l.base_lot, '101690');
  assert.equal(l.met, true);
  assert.equal(l.batches.length, 2);
});

for (const [label, row, state] of [
  ['missing gluten result', { lot_number: '101690-2', signed: true, gluten: [] }, 'missing'],
  ['unsigned', { lot_number: '101690-2', signed: false, gluten: pass }, 'unsigned'],
  ['failing', { lot_number: '101690-2', signed: true, gluten: [{ pass_fail: 'fail' }] }, 'failing'],
  ['ungraded', { lot_number: '101690-2', signed: true, gluten: [{ pass_fail: null }] }, 'ungraded'],
]) {
  test(`roll-up: one ${label} batch ⇒ NOT met, and that batch is named`, () => {
    const [l] = rollUpLots([{ lot_number: '101690-1', signed: true, gluten: pass }, row]);
    assert.equal(l.met, false);
    assert.deepEqual(l.at_fault.map(b => [b.batch, b.state]), [['2', state]]);
  });
}

test('roll-up: a lot with no suffix is one batch; a re-test of the same batch supersedes its failure', () => {
  const [single] = rollUpLots([{ lot_number: '101703', signed: true, gluten: pass }]);
  assert.equal(single.met, true);
  assert.equal(single.batches.length, 1);
  const [retest] = rollUpLots([
    { lot_number: '101706', signed: false, gluten: [{ pass_fail: 'fail' }] },
    { lot_number: '101706', signed: true, gluten: pass },
  ]);
  assert.equal(retest.met, true);
});

test('gluten-free claim: <4 ppm supports <20; <44, no unit and ≥20 do not', () => {
  assert.equal(glutenSupportsGfClaim({ result_value: '<4', unit: 'ppm', method: 'ELISA', mdl: '4' }), true);
  assert.equal(glutenSupportsGfClaim({ result_value: '<44', unit: 'ppm' }), false);
  assert.equal(glutenSupportsGfClaim({ result_value: '12', unit: '' }), false);
  assert.equal(glutenSupportsGfClaim({ result_value: '20', unit: 'ppm' }), false);
  assert.equal(glutenSupportsGfClaim({ result_value: '25', unit: 'ppm' }), false);
  assert.equal(glutenSupportsGfClaim({ result_value: '19.9', unit: 'ppm' }), true);
  assert.equal(glutenSupportsGfClaim({ result_value: 'Not Detected', unit: 'ppm' }), false);
});

test('the gluten correction is done only with one "Gluten Allergen" row reading <4 ppm', () => {
  assert.equal(glutenCorrected([{ test_type: 'Gluten Allergen', result_value: '<4', unit: 'ppm' }]), true);
  assert.equal(glutenCorrected([{ test_type: 'Gluten Allergen ReportELISA <', result_value: '<44', unit: 'ppm' }]), false);
  assert.equal(glutenCorrected([{ test_type: 'Gluten Allergen', result_value: '<4', unit: 'ppm' },
    { test_type: 'Gluten Allergen ReportELISA <', result_value: '<4', unit: 'ppm' }]), false, 'two gluten rows');
  assert.equal(glutenCorrected([{ test_type: 'Gluten Allergen', result_value: '<4', unit: 'ppm' },
    { test_type: 'Lead', result_value: '<44', unit: 'ppm' }]), false, 'a <44 anywhere');
  assert.equal(glutenCorrected([{ test_type: 'Gluten Allergen', result_value: '<4', unit: 'ppb' }]), false);
});

test('audit labels: retire, unsign, void; an old retirement recorded as delete reads as one', () => {
  assert.equal(actionLabel({ action: 'retire' }), 'Retired');
  assert.equal(actionLabel({ action: 'unsign' }), 'Un-signed');
  assert.equal(actionLabel({ action: 'void' }), 'Voided');
  assert.equal(actionLabel({ action: 'delete', details: JSON.stringify({ reason: 'Retired by ReadyDoc (D-225): malformed' }) }), 'Retired (recorded as delete)');
  assert.equal(actionLabel({ action: 'delete', details: { reason: 'typo' } }), 'delete');
  assert.equal(actionLabel({ action: 'bulk_update' }), 'bulk update');
});
