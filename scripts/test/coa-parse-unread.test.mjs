// Every analysis line ends in exactly one place: parsed, noise or unread
// (D-243). Built from plain pipe rows, the shape the positional reader emits.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseColumnarCoa } from '../../server/coa-parse.js';

const HEAD = '| Analysis | Method | MDL | Specification | Result | Units |';
const rows = (...r) => [HEAD, ...r].join('\n');
const sum = (c) => c.parsed + c.noise + c.unread;

test('analysis lines = parsed + noise + unread, and a clean table is all parsed', () => {
  const p = parseColumnarCoa(rows('| Lead | USP <233> | 0.005 | Report | 0.012 | ppm |', '| Gluten Allergen | ELISA | 4 | Report | <4 | ppm |'));
  assert.deepEqual(p.counts, { analysis_lines: 2, parsed: 2, noise: 0, unread: 0 });
});

test('a result the reader cannot read is unread, with a plain reason, and is not invented', () => {
  const p = parseColumnarCoa(rows('| Total Aerobic Count | USP <2021> | 10 | Report | 1.3E+03 | cfu/g |', '| Salmonella | BAM | | Report | Not Detected in 25g | |'));
  assert.equal(p.test_results.length, 0);
  assert.equal(p.counts.unread, 2);
  assert.match(p.unread[0].reason, /scientific notation/);
  assert.match(p.unread[1].reason, /sample size/);
  assert.equal(p.counts.analysis_lines, sum(p.counts));
});

test('a repeated test: same value is noise, a different value is unread; the first stays read', () => {
  const p = parseColumnarCoa(rows('| Lead | USP <233> | 0.005 | Report | 0.012 | ppm |', '| Lead | USP <233> | 0.005 | Report | 0.012 | ppm |',
    '| Arsenic | USP <233> | 0.005 | Report | 0.008 | ppm |', '| Arsenic | USP <233> | 0.005 | Report | 0.009 | ppm |'));
  assert.deepEqual(p.test_results.map(r => r.result_value), ['0.012', '0.008']);
  assert.equal(p.counts.noise, 1);
  assert.equal(p.counts.unread, 1);
  assert.match(p.unread[0].reason, /twice with different results/);
  assert.equal(p.counts.analysis_lines, sum(p.counts));
});

test('section bands, wrapped tails, separators and lines outside a table are not analysis lines', () => {
  const text = ['| CTLA ID: | 176906 |', HEAD, '| --- | --- | --- | --- | --- | --- |', '| Heavy Metals | | | | | |',
    '| Total Coliforms (BAM) | BAM CH. 4 | 10 | Report | <10 | cfu/g |', '| (MOD) | (MOD) | | | | |', 'Specifications provided by the Customer.'].join('\n');
  const p = parseColumnarCoa(text);
  assert.deepEqual(p.counts, { analysis_lines: 1, parsed: 1, noise: 0, unread: 0 });
  assert.equal(p.lab_report_number, '176906');
});

test('a line with no result printed is unread', () => {
  const p = parseColumnarCoa(rows('| Vitamin D | HPLC | | Report | | IU/g |'));
  assert.equal(p.counts.unread, 1);
  assert.match(p.unread[0].reason, /No result is printed/);
});
