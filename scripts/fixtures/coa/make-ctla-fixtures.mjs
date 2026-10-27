// Builds the four golden COA fixtures in CTLA's report layout (D-221).
//
// RECONSTRUCTIONS, NOT THE LAB'S FILES. The real CTLA PDFs (IDs 176906, 176905,
// 176901, 180953) are on the production volume and were not copied out for
// this work. These carry the same table layout, the same cells and the same
// values the review read off the real reports with `pdftotext -layout`, drawn
// at fixed column positions so pdf.js hands back one item per cell — the
// structure that made the old reader glue MDL 4 and result <4 into "<44".
// The cells are drawn in the order the old joined text came out
// ("Gluten Allergen ReportELISA <44 ppm"), so the old reader still fails on
// them; that is the control.
//
// Replace with the real PDFs when Quality copies them out:
// scripts/fixtures/coa/ctla-<id>.pdf, same names.
//
// Run: node scripts/fixtures/coa/make-ctla-fixtures.mjs
import PDFDocument from 'pdfkit';
import { createWriteStream } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
// Column x positions, as on CTLA's report.
const X = { test: 50, method: 205, mdl: 285, spec: 330, result: 405, unit: 470 };

const REPORTS = [
  { id: '176906', received: '7/23/2026', reported: '8/3/2026', sample: 'Whey Protein Stick (Blueberry Muffin)', lot: '101690-1',
    rows: [
      ['Total Aerobic Microbial Count (USP)', 'USP <2021>', '100', '<100', 'cfu/g'],
      ['Total Yeast and Mold (USP)', 'USP <2021>', '10', '<10', 'cfu/g'],
      ['E.Coli BAM (MOD)', 'BAM CH. 4', '', 'Absent', ''],
      ['Salmonella', 'BAM CH. 5', '', 'Absent', ''],
      ['Arsenic', 'USP <233>', '0.005', '0.008', 'ppm'],
      ['Lead', 'USP <233>', '0.005', '0.012', 'ppm'],
      ['Gluten Allergen', 'ELISA', '4', '<4', 'ppm'],
    ] },
  { id: '176905', received: '7/23/2026', reported: '8/3/2026', sample: 'Pancake Mix (Buttermilk)', lot: '101688-1',
    rows: [
      ['Total Aerobic Microbial Count (USP)', 'USP <2021>', '100', '300', 'cfu/g'],
      ['Gluten Allergen', 'ELISA', '4', '<4', 'ppm'],
      ['Cadmium', 'USP <233>', '0.005', '<0.005', 'ppm'],
    ] },
  { id: '176901', received: '7/22/2026', reported: '8/1/2026', sample: 'Donut Mix (Glazed)', lot: '101684-2',
    rows: [
      ['Gluten Allergen', 'ELISA', '4', '<4', 'ppm'],
      ['Mercury', 'USP <233>', '0.005', '<0.005', 'ppm'],
    ] },
  { id: '180953', received: '9/30/2026', reported: '10/9/2026', sample: 'Alkify Electrolyte (Lemon)', lot: '101474',
    rows: [
      ['Soy Allergen', 'ELISA', '0.04', '<0.04', 'ppm'],
      ['Milk Allergen', 'ELISA', '0.4', '<0.4', 'ppm'],
      ['Gluten Allergen', 'ELISA', '4', '<4', 'ppm'],
    ] },
];

for (const r of REPORTS) {
  const doc = new PDFDocument({ size: 'LETTER', margin: 40 });
  doc.pipe(createWriteStream(path.join(here, `ctla-${r.id}.pdf`)));
  doc.font('Helvetica-Bold').fontSize(14).text('Certificate of Analysis', 50, 50, { lineBreak: false });
  doc.font('Helvetica').fontSize(9);
  let y = 90;
  for (const [label, value] of [['CTLA ID:', r.id], ['Date Received:', r.received], ['Sample Name:', r.sample], ['Lot Number:', r.lot], ['Customer:', 'Powder Ops 281 E 1600 N, Vineyard, UT 84059']]) {
    doc.text(label, 50, y, { lineBreak: false });
    doc.text(value, 150, y, { lineBreak: false });
    y += 14;
  }
  y += 16;
  doc.font('Helvetica-Bold');
  for (const [k, label] of [['test', 'Analysis'], ['method', 'Method'], ['mdl', 'MDL'], ['spec', 'Specification'], ['result', 'Result'], ['unit', 'Units']]) {
    doc.text(label, X[k], y, { lineBreak: false });
  }
  doc.font('Helvetica');
  y += 16;
  for (const [test, method, mdl, result, unit] of r.rows) {
    // Stream order matches the old joined text: name, spec, method, result, MDL, units.
    doc.text(test, X.test, y, { lineBreak: false });
    doc.text('Report', X.spec, y, { lineBreak: false });
    doc.text(method, X.method, y, { lineBreak: false });
    doc.text(result, X.result, y, { lineBreak: false });
    if (mdl) doc.text(mdl, X.mdl, y, { lineBreak: false });
    if (unit) doc.text(unit, X.unit, y, { lineBreak: false });
    y += 15;
  }
  y += 20;
  doc.fontSize(7).text('Specifications provided by the Customer. This report does not constitute a guarantee of quality for the entire product.', 50, y, { width: 500 });
  doc.text(r.reported, 50, y + 30, { lineBreak: false });
  doc.end();
}
console.log(`wrote ${REPORTS.length} fixtures to ${here}`);
