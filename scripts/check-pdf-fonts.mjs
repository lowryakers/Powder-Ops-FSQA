// Every generated PDF draws in the embedded Unicode font (D-234, D-235).
//
// pdfkit's built-in Helvetica is WinAnsi: "≤ 0.5 ppm" came out as `"d 0.5 ppm`
// and an accented or full-width name as raw bytes. Two checks:
//   1. every `new PDFDocument(` in server/ is followed by embedUnicodeFaces()
//      or registerUnicodeFonts(), so a new export cannot skip it;
//   2. text drawn through the three paths the exports use (plain doc.text,
//      richBlocks, richText) and through a real export (the forklift
//      certificate) reads back from the PDF as written.
import fs from 'node:fs';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import PDFDocument from 'pdfkit';
import { embedUnicodeFaces } from '../server/pdf-unicode.js';
import { richBlocks } from '../server/pdf-rich.js';
import { richText } from '../server/pdf-emoji.js';
import { readPdfColumns } from '../server/coa-pdf-text.js';
import { renderCertificate } from '../server/certificate-pdf.js';

let pass = 0, fail = 0;
const ok = (cond, label, detail = '') => {
  if (cond) { pass++; console.log(`PASS ${label}`); }
  else { fail++; console.log(`FAIL ${label}${detail ? ` — ${detail}` : ''}`); }
};

// 1. Every document in server/ gets the faces.
const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap(e =>
  e.isDirectory() ? (e.name === 'node_modules' ? [] : walk(path.join(dir, e.name)))
    : e.name.endsWith('.js') ? [path.join(dir, e.name)] : []);
for (const file of walk('server')) {
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, i) => {
    if (!/new PDFDocument\(/.test(line) || /^\s*(\*|\/\/)/.test(line)) return;
    const after = lines.slice(i, i + 8).join('\n');
    // renderDeviationForm (deviation-form-pdf.js) registers the faces itself.
    ok(/embedUnicodeFaces\(|registerUnicodeFonts\(|renderDeviationForm\(/.test(after), `${file}:${i + 1} draws in the embedded font`);
  });
}

const SAMPLE = 'Arsenic ≤ 0.5 ppm · 25 µg · José Núñez ±2 °C';

async function render(draw, { faces = true } = {}) {
  const doc = new PDFDocument({ size: 'LETTER', margin: 54 });
  if (faces) embedUnicodeFaces(doc);
  const chunks = [];
  doc.on('data', c => chunks.push(c));
  const done = new Promise(r => doc.on('end', r));
  draw(doc);
  doc.end();
  await done;
  return (await readPdfColumns(Buffer.concat(chunks))).text;
}
// NFKC: the reader hands the micro sign back as Greek mu, the same glyph.
const squash = (s) => s.normalize('NFKC').replace(/\s+/g, ' ');

// 2. The three drawing paths.
const plain = squash(await render(d => d.font('Helvetica-Bold').text(SAMPLE)));
ok(plain.includes(squash(SAMPLE)), 'doc.text in Helvetica-Bold prints the sample as written', plain);
const rich = squash(await render(d => richBlocks(d, `*Limit* ${SAMPLE}\n- _item_ ≥ 1`, 'Helvetica')));
ok(rich.includes(squash(SAMPLE)) && rich.includes('≥ 1'), 'richBlocks (bold, italic, list) prints the sample', rich);
const emoji = squash(await render(d => richText(d, `Welcome 👋 ${SAMPLE}`, 'Helvetica')));
ok(emoji.includes(squash(SAMPLE)), 'richText with an emoji prints the sample', emoji);

// The control: without the faces the sample does not survive.
const control = squash(await render(d => d.font('Helvetica').text(SAMPLE), { faces: false }));
ok(!control.includes('≤ 0.5'), 'control: built-in Helvetica cannot print "≤" (so the check above means something)', control);

// A real export: the forklift certificate carries a person's name.
const res = new PassThrough();
res.setHeader = () => {};
const chunks = [];
res.on('data', c => chunks.push(c));
const ended = new Promise(r => res.on('end', r));
renderCertificate(res, {
  cert: { employee_name: 'Đorđe Ćosić', course_code: 'FORK-101', course_title: 'Forklift Safety', truck_type: 'Sit-down counterbalance',
    trained_on: '2026-10-01', evaluated_on: '2026-10-02', expires_on: '2029-10-02', trained_by: 'Adam Bliss', evaluated_by: 'Adam Bliss',
    evaluation_revision: 'DRAFT-1', not_evaluated: [] },
  form: null,
});
await ended;
const certText = squash((await readPdfColumns(Buffer.concat(chunks))).text);
ok(certText.includes('Đorđe Ćosić'), 'forklift certificate prints a name outside WinAnsi', certText.slice(0, 200));

console.log(`\n${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
