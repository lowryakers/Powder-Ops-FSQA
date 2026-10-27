// The synthetic golden set (D-243): every committed look-alike CTLA report is
// read and compared with what a person reading the printed page recorded.
// Runs in CI on every build (inside verify:coa) and never skips: no fixtures
// found is a failure, not a pass.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { readPdfColumns } from '../../server/coa-pdf-text.js';
import { parseColumnarCoa } from '../../server/coa-parse.js';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'coa', 'golden');
const synthetic = readdirSync(dir).filter(f => /^synthetic-.*\.expected\.json$/.test(f)).sort();
const real = readdirSync(dir).filter(f => /^[0-9a-f]{12}\.expected\.json$/.test(f));
console.log(`# golden set: ${synthetic.length} synthetic reports; real PDFs: not run in CI (${real.length} reviewed on record)`);

test('the synthetic golden set is there (at least 10 reports)', () => {
  assert.ok(synthetic.length >= 10, `only ${synthetic.length} synthetic reports found in ${dir}`);
});

const norm = (t) => ({ test: t.test, value: t.value, unit: t.unit ?? null, mdl: t.mdl ?? null, method: t.method ?? null });
for (const f of synthetic) {
  const want = JSON.parse(readFileSync(path.join(dir, f), 'utf8'));
  test(`golden: ${want.fixture}`, async () => {
    const { text } = await readPdfColumns(readFileSync(path.join(dir, `${want.fixture}.pdf`)));
    if (!want.text_layer) {
      assert.ok(text.replace(/\s/g, '').length < 40, 'a file with no text layer reads as an image scan');
      return;
    }
    const p = parseColumnarCoa(text);
    const got = p.test_results.map(r => norm({ test: r.test_type, value: r.result_value, unit: r.unit, mdl: r.mdl, method: r.method }));
    const byTest = (a, b) => a.test.localeCompare(b.test);
    assert.deepEqual(got.sort(byTest), want.tests.map(norm).sort(byTest));
    assert.equal(p.unread.length, want.unread, `unread: ${JSON.stringify(p.unread.map(u => u.reason))}`);
    assert.equal(p.counts.noise, want.noise);
    assert.equal(p.counts.analysis_lines, p.counts.parsed + p.counts.noise + p.counts.unread);
    assert.equal(p.lab_report_number, want.lab_report_number);
    assert.equal(p.report_date, want.report_date);
  });
}
