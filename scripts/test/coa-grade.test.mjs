// The COA grader, pure (D-222). Run: node --test scripts/test/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gradeResult, parseResult, aliasKey, specIndex, unitScale } from '../../server/coa-grade.js';

const spec = (o) => ({ id: 's', test_type: 'x', specification: null, unit: null, min_value: null, max_value: null, ...o });

test('parseResult reads bounds, plain numbers, units and words', () => {
  assert.deepEqual(parseResult('<10'), { kind: 'bound', value: 10, below: true, unit: null });
  assert.deepEqual(parseResult('< 10 cfu/g'), { kind: 'bound', value: 10, below: true, unit: 'cfu/g' });
  assert.deepEqual(parseResult('0.02 ppm'), { kind: 'number', value: 0.02, unit: 'ppm' });
  assert.equal(parseResult('1,300').value, 1300);
  assert.equal(parseResult('6,564.814').value, 6564.814);
  assert.equal(parseResult('Absent').kind, 'negative');
  assert.equal(parseResult('N.D.').kind, 'negative');
  assert.equal(parseResult('Nondetect').kind, 'negative');
  assert.equal(parseResult('Non-detect').kind, 'negative');
  assert.equal(parseResult('').kind, 'empty');
});

test('a European decimal is refused, never read as a whole number', () => {
  assert.equal(parseResult('0,5').kind, 'ambiguous_decimal');
  assert.equal(parseResult('12,5').kind, 'ambiguous_decimal');
  assert.equal(parseResult('<0,5').kind, 'ambiguous_decimal');
  const g = gradeResult('0,5', spec({ max_value: 1, unit: 'ppm' }));
  assert.equal(g.pass_fail, null);
  assert.match(g.reason, /comma/);
});

test('"does not comply" and "non conform" are FAIL, never pass', () => {
  for (const v of ['Does not comply', 'does not conform', 'Non conforming', 'Non-conform', 'Nonconforming', 'Not compliant']) {
    assert.equal(parseResult(v).kind, 'stated_fail', v);
    assert.equal(gradeResult(v, null).pass_fail, 'fail', v);
  }
  assert.equal(gradeResult('Complies', null).pass_fail, 'pass');
});

test('units are normalised before comparing', () => {
  assert.equal(gradeResult('2 ppm', spec({ max_value: 500, unit: 'ppb' })).pass_fail, 'fail');
  assert.equal(gradeResult('0.2', spec({ max_value: 500, unit: 'ppb' }), null, { unit: 'ppm' }).pass_fail, 'pass');
  assert.equal(gradeResult('0.5 mg/kg', spec({ max_value: 1, unit: 'ppm' })).pass_fail, 'pass');
  assert.equal(gradeResult('<4', spec({ max_value: 20, unit: 'ppm' }), null, { unit: 'mg/kg' }).pass_fail, 'pass');
  assert.equal(unitScale('ppm', 'ppb').scale, 1000);
});

test('a unit mismatch is refused, not guessed', () => {
  const g = gradeResult('50', spec({ max_value: 100, unit: 'ppm' }), null, { unit: 'cfu/g' });
  assert.equal(g.pass_fail, null);
  assert.match(g.reason, /Unit mismatch/);
  assert.equal(gradeResult('50', spec({ max_value: 100, unit: 'cfu/g' }), null, { unit: 'mpn/g' }).pass_fail, null);
  // A unit left blank on either side is not a mismatch.
  assert.equal(gradeResult('50', spec({ max_value: 100, unit: 'cfu/g' })).pass_fail, 'pass');
});

test('"<X" supports a "<L" limit only when X <= L', () => {
  assert.equal(gradeResult('<4', spec({ max_value: 20, unit: 'ppm' })).pass_fail, 'pass');
  assert.equal(gradeResult('<20', spec({ max_value: 20, unit: 'ppm' })).pass_fail, 'pass');
  assert.equal(gradeResult('<44', spec({ max_value: 20, unit: 'ppm' })).pass_fail, null);
});

test('a stated pass never rescues a result the specification fails', () => {
  assert.equal(gradeResult('900', spec({ max_value: 100 }), 'pass').pass_fail, 'fail');
  assert.equal(gradeResult('50', spec({ max_value: 100 }), 'fail').pass_fail, 'fail');
  assert.equal(gradeResult('50', spec({ max_value: 100 }), 'pass').pass_fail, 'pass');
  // "Report" is never itself a verdict.
  assert.equal(gradeResult('Report', null).pass_fail, null);
});

test('aliasKey matches exact names only', () => {
  assert.equal(aliasKey('Arsenic'), 'arsenic');
  assert.equal(aliasKey('Arsenic NMT'), 'arsenic');
  assert.equal(aliasKey('Iron as ferrous fumarate'), null);
  assert.equal(aliasKey('Vitamin C as ascorbic acid'), null);
  assert.equal(aliasKey('E.Coli BAM (MOD)'), 'e coli');
  assert.equal(aliasKey('E. coli O157:H7'), 'e coli o157');
  assert.equal(aliasKey('Listeria monocytogenes'), 'listeria monocytogenes');
  assert.equal(aliasKey('Listeria spp.'), 'listeria spp');
  assert.equal(aliasKey('Gluten, G12 ELISA'), 'gluten g12');
  assert.equal(aliasKey('Gluten R5 ELISA'), 'gluten r5');
  assert.equal(aliasKey('Gluten Allergen'), 'gluten');
  assert.equal(aliasKey('Total Aerobic Microbial Count (USP)'), 'tamc');
  assert.equal(aliasKey('Yeast & Mould'), 'tymc');
});

test('specIndex does not cross the alias lines', () => {
  const idx = specIndex([
    { id: 'as', test_type: 'Arsenic' }, { id: 'ec', test_type: 'E. coli' },
    { id: 'r5', test_type: 'Gluten R5 ELISA' }, { id: 'ls', test_type: 'Listeria spp.' },
  ]);
  assert.equal(idx.find('Iron as ferrous fumarate'), null);
  assert.equal(idx.find('E. coli O157:H7'), null);
  assert.equal(idx.find('Gluten, G12 ELISA'), null);
  assert.equal(idx.find('Listeria monocytogenes'), null);
  assert.equal(idx.find('E.Coli BAM (MOD)')?.id, 'ec');
  assert.equal(idx.find('Arsenic <')?.id, 'as');
});
