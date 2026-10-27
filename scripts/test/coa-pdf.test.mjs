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
  assert.equal(row(p, 'Total Aerobic Microbial Count (USP)').result_value, '<100');
  assert.equal(p.lot_number, '101690-1');
  assert.equal(p.received_date, '2026-07-23');
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
