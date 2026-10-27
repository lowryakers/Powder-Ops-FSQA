// Real CTLA reports, read the way the scan reads them (D-232). OPTIONAL:
// runs only when COA_REAL_PDF_DIR names a folder of real lab PDFs. Those are
// NSF/customer-confidential and are never committed — point this at a copy.
//
//   COA_REAL_PDF_DIR=/path/to/ctla-pdfs node --test scripts/test/coa-real-pdf.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'fs';
import { spawnSync } from 'child_process';
import path from 'path';
import { readPdfColumns } from '../../server/coa-pdf-text.js';
import { parseColumnarCoa } from '../../server/coa-parse.js';

const dir = process.env.COA_REAL_PDF_DIR;
const files = dir && existsSync(dir) ? readdirSync(dir).filter(f => /\.pdf$/i.test(f)) : [];
const hasPdftotext = !spawnSync('pdftotext', ['-v']).error;

// The gluten line as pdftotext -layout prints it, and the result-shaped tokens on it.
function layoutGlutenTokens(file) {
  if (!hasPdftotext) return null;
  const out = spawnSync('pdftotext', ['-layout', file, '-'], { encoding: 'utf8' });
  if (out.status !== 0) return null;
  const line = out.stdout.split('\n').find(l => /gluten/i.test(l));
  return line ? line.trim().split(/\s{2,}|\s+/).filter(t => /^[<>≤≥]?\s*\d/.test(t)) : null;
}

if (!files.length) test('real CTLA reports', { skip: 'COA_REAL_PDF_DIR is not set (or holds no PDFs)' }, () => {});

for (const f of files) {
  test(`real CTLA report ${f}: no doubled MDL, gluten read as printed`, async () => {
    const full = path.join(dir, f);
    const parsed = parseColumnarCoa((await readPdfColumns(readFileSync(full))).text);
    assert.ok(parsed.test_results.length, 'the reader found test rows');
    for (const r of parsed.test_results) {
      if (!r.mdl) continue;
      const doubled = new RegExp(`^[<>≤≥]?${r.mdl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}{2}$`);
      assert.ok(!doubled.test(r.result_value), `${r.test_type}: "${r.result_value}" is the MDL ${r.mdl} printed twice`);
    }
    const gluten = parsed.test_results.filter(r => /gluten/i.test(r.test_type));
    const printed = layoutGlutenTokens(full);
    for (const g of gluten) {
      if (printed?.length) assert.ok(printed.includes(g.result_value), `${g.test_type}: read "${g.result_value}", pdftotext -layout shows ${printed.join(' ')}`);
      else assert.equal(g.result_value, '<4', `${g.test_type}: read "${g.result_value}"`);
    }
  });
}
