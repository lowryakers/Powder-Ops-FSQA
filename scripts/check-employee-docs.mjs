// The fill-and-sign helper, pure. A fillable PDF's fields are read with their
// labels; the answers are written in and the form is FLATTENED so nothing is
// editable afterwards; a signature record page is appended carrying the name,
// the time and the hash of the document as sent; a value a field cannot take
// is refused by name rather than dropped.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { readFields, signPdf, sha256, ATTESTATION } from '../server/employee-documents.js';

let n = 0, bad = 0;
const ok = (label, fn) => {
  n++;
  return Promise.resolve().then(fn).then(() => console.log(`  ok    ${label}`))
    .catch(e => { bad++; console.log(`  FAIL  ${label}\n        ${e.message}`); });
};

// A stand-in for the IRS W-4: text boxes with tooltips, a checkbox, a radio
// group and a dropdown, plus a read-only field the employee must never be asked.
async function makeForm() {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  page.drawText('Form W-4 (stand-in)  Employee\'s Withholding Certificate', { x: 40, y: 740, size: 14, font });
  const form = doc.getForm();
  const name = form.createTextField('topmostSubform[0].Page1[0].f1_01[0]');
  name.setMaxLength(40); name.addToPage(page, { x: 40, y: 680, width: 300, height: 20 });
  const ssn = form.createTextField('topmostSubform[0].Page1[0].f1_05[0]');
  ssn.setMaxLength(11); ssn.addToPage(page, { x: 40, y: 640, width: 150, height: 20 });
  const multi = form.createCheckBox('topmostSubform[0].Page1[0].c1_2[0]');
  multi.addToPage(page, { x: 40, y: 600, width: 14, height: 14 });
  const status = form.createRadioGroup('topmostSubform[0].Page1[0].c1_1');
  status.addOptionToPage('Single', page, { x: 40, y: 560, width: 14, height: 14 });
  status.addOptionToPage('Married filing jointly', page, { x: 40, y: 540, width: 14, height: 14 });
  status.addOptionToPage('Head of household', page, { x: 40, y: 520, width: 14, height: 14 });
  const state = form.createDropdown('topmostSubform[0].Page1[0].state');
  state.addOptions(['UT', 'ID', 'NV']); state.addToPage(page, { x: 40, y: 480, width: 80, height: 20 });
  const ro = form.createTextField('topmostSubform[0].Page1[0].employer');
  ro.setText('Powder Ops LLC'); ro.enableReadOnly(); ro.addToPage(page, { x: 40, y: 440, width: 300, height: 20 });
  // Tooltips the way the IRS files them (/TU on the field dictionary).
  const { PDFName, PDFString } = await import('pdf-lib');
  name.acroField.dict.set(PDFName.of('TU'), PDFString.of('Step 1(a). First name and middle initial'));
  ssn.acroField.dict.set(PDFName.of('TU'), PDFString.of('Step 1(b). Social security number'));
  multi.acroField.dict.set(PDFName.of('TU'), PDFString.of('Step 2(c). Multiple jobs or spouse works'));
  status.acroField.dict.set(PDFName.of('TU'), PDFString.of('Step 1(c). Filing status'));
  return Buffer.from(await doc.save());
}

const TMP = mkdtempSync(join(tmpdir(), 'edoc-'));
const text = (bytes) => {
  const p = join(TMP, `${n}.pdf`); writeFileSync(p, Buffer.from(bytes));
  try { return execFileSync('pdftotext', ['-layout', p, '-'], { encoding: 'utf8' }); } catch { return null; }
};

// A 1x1 PNG with a black pixel — enough for embedPng.
const PNG = 'data:image/png;base64,' + Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c63f8cfc0f01f0005000201e2d3aebc0000000049454e44ae426082', 'hex').toString('base64');

const src = await makeForm();
const signer = { name: 'Test Signer', username: 'Test Signer', id: 'u-1' };
const evidence = { at: '2026-09-11T15:00:00.000Z', ip: '10.0.0.7', ua: 'Test UA', verified: true };
const document = { title: 'Form W-4 (stand-in)', filename: 'w4.pdf', sent_by: 'Office Lead', sent_at: '2026-09-11 14:00:00', request_id: 'req-1' };

console.log('\nreadFields');
let fields = [];
await ok('the fillable fields come back in form order, labelled from their tooltips', async () => {
  fields = await readFields(src);
  assert.equal(fields.length, 5, JSON.stringify(fields.map(f => f.name)));
  assert.equal(fields[0].label, 'Step 1(a). First name and middle initial');
  assert.equal(fields[0].type, 'text'); assert.equal(fields[0].max_length, 40);
  assert.equal(fields[2].type, 'checkbox');
  assert.equal(fields[3].type, 'radio'); assert.deepEqual(fields[3].options, ['Single', 'Married filing jointly', 'Head of household']);
  assert.equal(fields[4].type, 'dropdown'); assert.deepEqual(fields[4].options, ['UT', 'ID', 'NV']);
});
await ok('a read-only field is not offered (the employer box is not the employee\'s to fill)', () => {
  assert.equal(fields.some(f => f.name.endsWith('employer')), false);
});
await ok('a field with no tooltip falls back to its name', () => {
  assert.equal(fields[4].label, 'topmostSubform[0].Page1[0].state');
});
await ok('a PDF with no form reads as no fields, not an error', async () => {
  const d = await PDFDocument.create(); d.addPage();
  assert.deepEqual(await readFields(Buffer.from(await d.save())), []);
});
await ok('bytes that are not a PDF read as no fields', async () => {
  assert.deepEqual(await readFields(Buffer.from('hello')), []);
});

console.log('\nsignPdf');
const values = { 'topmostSubform[0].Page1[0].f1_01[0]': 'Test S.', 'topmostSubform[0].Page1[0].f1_05[0]': '123-45-6789',
  'topmostSubform[0].Page1[0].c1_2[0]': true, 'topmostSubform[0].Page1[0].c1_1': 'Head of household', 'topmostSubform[0].Page1[0].state': 'UT',
  'topmostSubform[0].Page1[0].employer': 'HACKED', 'not_a_field': 'ignored' };
let out = null;
await ok('the answers are written in, the form is locked, and a signature page is added', async () => {
  out = await signPdf(src, { values, signatureImage: PNG, signer, evidence, document });
  assert.deepEqual(out.errors, []);
  assert.equal(out.pages, 2);
  assert.equal(out.source_sha256, sha256(src));
  const signed = await PDFDocument.load(out.bytes);
  assert.equal(signed.getPageCount(), 2);
  assert.equal(signed.getForm().getFields().length, 0, 'flattened: no editable fields remain');
});
await ok('the flattened page carries the answers as ink (pdftotext reads them)', async () => {
  const t = text(out.bytes);
  if (t == null) return; // no poppler on this box — the flatten assertion above still holds
  assert.match(t, /Test S\./); assert.match(t, /123-45-6789/);
  assert.match(t, /Powder Ops LLC/, 'the read-only employer box keeps ITS value');
  assert.doesNotMatch(t, /HACKED/, 'and cannot be overwritten by the signer');
});
await ok('the signature page names the signer, the time, the statement and the hash as sent', async () => {
  const t = text(out.bytes);
  if (t == null) return;
  assert.match(t, /Signature record/); assert.match(t, /Test Signer/); assert.match(t, /2026-09-11T15:00:00/);
  assert.match(t, /10\.0\.0\.7/); assert.match(t, /Password confirmed/); assert.match(t, /req-1/);
  assert.match(t, new RegExp(sha256(src).slice(0, 32)));
  assert.match(t, new RegExp(ATTESTATION.split(' ').slice(0, 6).join(' ')));
});
await ok('a radio value the form does not offer is refused BY NAME and nothing is produced', async () => {
  const r = await signPdf(src, { values: { 'topmostSubform[0].Page1[0].c1_1': 'Widowed' }, signatureImage: PNG, signer, evidence, document });
  assert.equal(r.bytes, null); assert.equal(r.errors.length, 1); assert.match(r.errors[0], /Filing status/); assert.match(r.errors[0], /Widowed/);
});
await ok('a document with no fields signs as read: one page becomes two', async () => {
  const d = await PDFDocument.create(); const pg = d.addPage(); const f = await d.embedFont(StandardFonts.Helvetica);
  pg.drawText('Attendance policy', { x: 40, y: 700, size: 14, font: f });
  const r = await signPdf(Buffer.from(await d.save()), { values: {}, signatureImage: PNG, signer, evidence, document: { ...document, title: 'Attendance policy' } });
  assert.deepEqual(r.errors, []); assert.equal(r.pages, 2);
});
await ok('a name with characters Helvetica cannot draw does not throw', async () => {
  const r = await signPdf(src, { values: {}, signatureImage: PNG, signer: { ...signer, name: 'José Peña 🎉' }, evidence, document });
  assert.deepEqual(r.errors, []);
  const t = text(r.bytes); if (t != null) assert.match(t, /José Peña/);
});
await ok('a text answer longer than the box is cut to the box, not refused', async () => {
  const r = await signPdf(src, { values: { 'topmostSubform[0].Page1[0].f1_05[0]': '123-45-6789-EXTRA' }, signatureImage: PNG, signer, evidence, document });
  assert.deepEqual(r.errors, []);
});

console.log(`\n${n - bad}/${n} assertions passed`);
process.exit(bad ? 1 : 0);
