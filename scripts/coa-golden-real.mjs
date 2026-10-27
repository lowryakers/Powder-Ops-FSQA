#!/usr/bin/env node
// Check the reader against REAL lab reports (D-243). An admin/dev tool: real
// CTLA PDFs are never committed (their footer forbids reproducing the report),
// so this runs on a folder copied off the production volume.
//
//   node scripts/coa-golden-real.mjs --dir <folder>                    # compare with the reviewed answers
//   node scripts/coa-golden-real.mjs --dir <folder> --strict           # also fail on a PDF nobody has reviewed
//   node scripts/coa-golden-real.mjs --dir <folder> --write-expected   # draft answers for a PERSON to review
//
// For every PDF: read it, parse it, and compare with
// scripts/fixtures/coa/golden/<first 12 of its SHA-256>.expected.json — the
// analyte, value, unit, MDL and method only; no product, lot or customer name
// is ever written to that file. When `pdftotext` is installed, every result is
// also looked for in a second, independent reading of the same page
// (`pdftotext -layout`) and any disagreement is listed.
//
// --write-expected writes what THIS reader read. That is a draft, not an
// answer: Maria or Lowry compares each file with the printed report before it
// is committed. That comparison is the second-person check.
//
// Exit codes: 0 clean · 1 a mismatch, an unread line or (with --strict) an
// unreviewed PDF.
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'fs';
import { spawnSync } from 'child_process';
import { createHash } from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';
import { readPdfColumns } from '../server/coa-pdf-text.js';
import { parseColumnarCoa } from '../server/coa-parse.js';

const GOLDEN = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'coa', 'golden');
const args = process.argv.slice(2);
const di = args.indexOf('--dir');
const dir = di >= 0 ? args[di + 1] : null;
const strict = args.includes('--strict');
const writeExpected = args.includes('--write-expected');
if (!dir || !existsSync(dir)) { console.error('Usage: node scripts/coa-golden-real.mjs --dir <folder of lab PDFs> [--strict] [--write-expected]'); process.exit(1); }

const hasPdftotext = spawnSync('pdftotext', ['-v'], { encoding: 'utf8' }).status !== null && !spawnSync('pdftotext', ['-v']).error;
const squash = (s) => String(s ?? '').replace(/\s+/g, '').toLowerCase();
const rowOf = (r) => ({ test: r.test_type, value: r.result_value, unit: r.unit ?? null, mdl: r.mdl ?? null, method: r.method ?? null });

const totals = { pdfs: 0, rows: 0, analysis_lines: 0, unread: 0, unreviewed: 0, mismatches: 0, second_reader_disagreements: 0 };
const unreadByReason = {};
const report = [];

for (const f of readdirSync(dir).filter(x => /\.pdf$/i.test(x)).sort()) {
  const buf = readFileSync(path.join(dir, f));
  const sha12 = createHash('sha256').update(buf).digest('hex').slice(0, 12);
  totals.pdfs++;
  const { text } = await readPdfColumns(buf);
  const p = parseColumnarCoa(text);
  const rows = p.test_results.map(rowOf);
  totals.rows += rows.length;
  totals.analysis_lines += p.counts.analysis_lines;
  totals.unread += p.counts.unread;
  for (const u of p.unread) { const k = u.reason.replace(/"[^"]*"/g, '"…"'); unreadByReason[k] = (unreadByReason[k] || 0) + 1; }
  const line = { sha12, rows: rows.length, unread: p.counts.unread };

  const golden = path.join(GOLDEN, `${sha12}.expected.json`);
  if (writeExpected) {
    writeFileSync(golden, JSON.stringify({ sha12, tests: rows, unread: p.counts.unread, reviewed_by: null }, null, 2) + '\n');
    line.wrote = true;
  } else if (!existsSync(golden)) {
    totals.unreviewed++; line.unreviewed = true;
  } else {
    const want = JSON.parse(readFileSync(golden, 'utf8'));
    const key = (r) => `${squash(r.test)}|${squash(r.value)}|${squash(r.unit)}|${squash(r.mdl)}|${squash(r.method)}`;
    const a = new Set(rows.map(key)); const b = new Set((want.tests || []).map(key));
    const missing = [...b].filter(k => !a.has(k)); const extra = [...a].filter(k => !b.has(k));
    if (missing.length || extra.length) { totals.mismatches++; line.mismatch = { missing, extra }; }
  }

  // A second, independent reader of the same file.
  if (hasPdftotext) {
    const out = spawnSync('pdftotext', ['-layout', path.join(dir, f), '-'], { encoding: 'utf8' }).stdout || '';
    const lines = out.split('\n').map(squash);
    const disagree = rows.filter(r => {
      const head = squash(r.test).slice(0, 8);
      return !lines.some(l => l.includes(head) && l.includes(squash(r.value)));
    }).map(r => `${r.test}: ${r.value}`);
    if (disagree.length) { totals.second_reader_disagreements += disagree.length; line.second_reader = disagree; }
  }
  report.push(line);
}

for (const l of report) {
  const notes = [l.unreviewed ? 'unreviewed' : null, l.mismatch ? `MISMATCH (missing ${l.mismatch.missing.length}, extra ${l.mismatch.extra.length})` : null,
    l.unread ? `${l.unread} unread` : null, l.second_reader ? `second reader disagrees on ${l.second_reader.length}` : null, l.wrote ? 'draft written' : null].filter(Boolean);
  console.log(`${l.sha12}  ${String(l.rows).padStart(3)} rows  ${notes.join(' · ') || 'ok'}`);
  for (const d of l.second_reader || []) console.log(`    second reader: ${d}`);
  for (const m of l.mismatch?.missing || []) console.log(`    expected, not read: ${m}`);
  for (const m of l.mismatch?.extra || []) console.log(`    read, not expected: ${m}`);
}
console.log(`\nPDFs read: ${totals.pdfs} · rows parsed: ${totals.rows} · analysis lines: ${totals.analysis_lines} · unread rows: ${totals.unread}`);
for (const [r, n] of Object.entries(unreadByReason)) console.log(`  unread ${n}: ${r}`);
console.log(`Unreviewed PDFs (no golden file): ${totals.unreviewed} · mismatches: ${totals.mismatches} · second reader: ${hasPdftotext ? `${totals.second_reader_disagreements} disagreement(s)` : 'pdftotext not installed, not run'}`);
if (writeExpected) console.log('\nDraft answers written. A PERSON compares each with the printed report before committing them.');
const fail = totals.mismatches || totals.unread || (strict && totals.unreviewed);
process.exit(fail ? 1 : 0);
