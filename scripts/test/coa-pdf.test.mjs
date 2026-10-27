// Golden COA PDFs (D-221): the column reader must never merge two cells.
// Fixtures: scripts/fixtures/coa/ (reconstructions — see make-ctla-fixtures.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { readPdfColumns, layoutPage } from '../../server/coa-pdf-text.js';
import { parseColumnarCoa } from '../../server/coa-parse.js';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'coa');
const read = async (id) => parseColumnarCoa((await readPdfColumns(readFileSync(path.join(dir, `ctla-${id}.pdf`)))).text);
const row = (parsed, name) => parsed.test_results.find(r => r.test_type === name);

for (const id of ['176906', '176905', '176901', '180953']) {
  test(`CTLA ${id}: gluten reads <4 ppm with MDL 4, never <44`, async () => {
    const p = await read(id);
    const g = row(p, 'Gluten Allergen');
    assert.ok(g, 'gluten row found');
    assert.equal(g.result_value, '<4');
    assert.equal(g.mdl, '4');
    assert.equal(g.unit, 'ppm');
    assert.equal(g.method, 'ELISA', 'the Method column is carried (D-231)');
    assert.equal(p.lab_reference, id);
    assert.ok(!p.test_results.some(r => /44/.test(r.result_value)), 'no merged <44');
  });
}

test('CTLA 180953 (Alkify): soy <0.04 and milk <0.4, never doubled', async () => {
  const p = await read('180953');
  assert.equal(row(p, 'Soy Allergen').result_value, '<0.04');
  assert.equal(row(p, 'Soy Allergen').mdl, '0.04');
  assert.equal(row(p, 'Milk Allergen').result_value, '<0.4');
  assert.equal(row(p, 'Milk Allergen').mdl, '0.4');
});

test('CTLA 176906: blank MDL cells stay blank; the rest of the panel lines up', async () => {
  const p = await read('176906');
  assert.equal(row(p, 'E.Coli BAM (MOD)').result_value, 'Absent');
  assert.equal(row(p, 'E.Coli BAM (MOD)').mdl, null);
  assert.equal(row(p, 'Arsenic').result_value, '0.008');
  assert.equal(row(p, 'Arsenic').method, 'USP <233>');
  assert.equal(row(p, 'Arsenic').mdl, '0.005');
  assert.equal(row(p, 'E.Coli BAM (MOD)').method, 'BAM CH. 4');
  assert.equal(row(p, 'Total Aerobic Microbial Count (USP)').result_value, '<100');
  assert.equal(p.lot_number, '101690-1');
  assert.equal(p.received_date, '2026-07-23');
});

test('the spaced-row reader keeps the method it trims off the test name (D-231)', () => {
  const p = parseColumnarCoa([
    'Analysis Specification Method Result MDL Units',
    'Gluten Allergen Report ELISA <4 4 ppm',
    'Arsenic Report ICP-MS 0.008 0.005 ppm',
  ].join('\n'));
  assert.equal(row(p, 'Gluten Allergen').method, 'ELISA');
  assert.equal(row(p, 'Arsenic').method, 'ICP-MS');
  assert.equal(row(p, 'Gluten Allergen').mdl, '4');
  assert.equal(row(p, 'Arsenic').mdl, '0.005');
});

test('layoutPage places cells under their header columns', () => {
  const it = (str, x, y, w = str.length * 4) => ({ str, x, y, w, h: 9 });
  const lines = layoutPage([
    it('Analysis', 50, 500), it('MDL', 285, 500, 18), it('Result', 405, 500, 25), it('Units', 470, 500, 22),
    it('Gluten Allergen', 50, 485), it('4', 285, 485, 5), it('<4', 405, 485, 9), it('ppm', 470, 485, 14),
    it('Salmonella', 50, 470), it('Absent', 405, 470, 28),
  ]);
  assert.deepEqual(lines, [
    '| Analysis | MDL | Result | Units |',
    '| Gluten Allergen | 4 | <4 | ppm |',
    '| Salmonella |  | Absent |  |',
  ]);
});

// THE REAL HEADER (D-239): "MDL Specification" is one cell on CTLA's reports,
// and the reader used to return mdl null on every real row. Synthetic fixture.
test('merged "MDL Specification" header: the MDL is split out of "4 Report"', async () => {
  const p = parseColumnarCoa((await readPdfColumns(readFileSync(path.join(dir, 'ctla-merged-header.pdf')))).text);
  const g = row(p, 'Gluten Allergen');
  assert.equal(g.result_value, '<4');
  assert.equal(g.mdl, '4');
  assert.equal(g.method, 'ELISA');
  assert.equal(row(p, 'Total Coliforms (BAM) (MOD)').mdl, '10');
  assert.equal(row(p, 'Total Coliforms (BAM) (MOD)').method, 'BAM CH. 4');
  assert.equal(row(p, 'E.Coli BAM (MOD)').mdl, null, 'a cell that is only "Report" has no MDL');
  assert.equal(row(p, 'E.Coli BAM (MOD)').result_value, 'Absent');
  assert.equal(row(p, 'Arsenic').mdl, '.001', 'a leading-dot MDL is kept as printed');
});

test('splitMdlSpec and displayMdl', async () => {
  const { splitMdlSpec, displayMdl } = await import('../../server/coa-parse.js');
  assert.deepEqual(splitMdlSpec('4 Report'), { mdl: '4', spec: 'Report' });
  assert.deepEqual(splitMdlSpec('10 Report'), { mdl: '10', spec: 'Report' });
  assert.deepEqual(splitMdlSpec('.001 Report'), { mdl: '.001', spec: 'Report' });
  assert.deepEqual(splitMdlSpec('Report'), { mdl: null, spec: 'Report' });
  assert.deepEqual(splitMdlSpec(''), { mdl: null, spec: null });
  assert.equal(displayMdl('.001'), '0.001');
  assert.equal(displayMdl('4'), '4');
});

test('pipe rows with the merged header, as the real reader prints them', () => {
  const p = parseColumnarCoa([
    '| Analysis | Method | MDL Specification | Result | Units |',
    '| Gluten Allergen | ELISA | 4 Report | <4 | ppm |',
    '| Total Coliforms (BAM) (MOD) | BAM CH. 4 | 10 Report | <10 | cfu/g |',
    '| E.Coli BAM (MOD) | BAM CH. 4 | Report | Absent |',
  ].join('\n'));
  assert.equal(row(p, 'Gluten Allergen').mdl, '4');
  assert.equal(row(p, 'Total Coliforms (BAM) (MOD)').mdl, '10');
  assert.equal(row(p, 'E.Coli BAM (MOD)').mdl, null);
});
