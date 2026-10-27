// The synthetic golden set (D-243): lab reports in CTLA's layout, each with the
// answer written down BEFORE the reader sees it.
//
// SYNTHETIC, NOT THE LAB'S FILES. CTLA's footer forbids reproducing its
// reports, so no real one is committed (D-221). These copy the layout — cells
// at fixed column positions, so pdf.js hands back one item per cell — and the
// forms a real report uses or might use: the 11-test panel, the merged "MDL
// Specification" header, gluten <4 with MDL 4, "Report"-only rows, Absent /
// Not Detected, a sample-size result, scientific notation, thousands
// separators, a leading-dot MDL, the allergen panel, a repeated test, wrapped
// lines, two pages, an unreadable row and a file with no text at all.
//
// `expected` is what a person reading the printed page would record — never
// the reader's own output — so the test can catch the reader being wrong.
//
// Run: node scripts/fixtures/coa/golden/make-golden.mjs   (writes the PDFs and *.expected.json here)
import PDFDocument from 'pdfkit';
import { createWriteStream, writeFileSync } from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const SEP = { test: 50, method: 205, mdl: 285, spec: 330, result: 405, unit: 470 };   // MDL in its own column
const MERGED = { test: 50, method: 205, mdlspec: 285, result: 405, unit: 470 };      // "MDL Specification" as one cell

const PANEL = [
  ['Total Aerobic Microbial Count (USP)', 'USP <2021>', '100', '<100', 'cfu/g'],
  ['Total Coliforms (BAM) (MOD)', 'BAM CH. 4', '10', '<10', 'cfu/g'],
  ['E.Coli BAM (MOD)', 'BAM CH. 4', '', 'Absent', ''],
  ['Salmonella', 'BAM CH. 5', '', 'Absent', ''],
  ['Staphylococcus aureus', 'USP <2022>', '10', '<10', 'cfu/g'],
  ['Yeast & Mold', 'USP <2021>', '10', '<10', 'cfu/g'],
  ['Arsenic', 'USP <233>', '0.005', '0.008', 'ppm'],
  ['Cadmium', 'USP <233>', '0.005', '<0.005', 'ppm'],
  ['Mercury', 'USP <233>', '0.005', '<0.005', 'ppm'],
  ['Lead', 'USP <233>', '0.005', '0.012', 'ppm'],
  ['Gluten Allergen', 'ELISA', '4', '<4', 'ppm'],
];
const row = ([test, method, mdl, value, unit]) => ({ test, method, mdl, value, unit });
const t = (test, value, unit, mdl, method) => ({ test, value, unit: unit || null, mdl: mdl || null, method: method || null });
const fromPanel = (rows) => rows.map(([test, method, mdl, value, unit]) => t(test, value, unit, mdl, method));

// Each fixture: what to draw, then what a person reading it would record.
export const FIXTURES = [
  { name: 'synthetic-01-standard-panel', id: '190001', lot: '101690-1', reported: '8/3/2026', layout: 'sep', pages: [PANEL.map(row)],
    expected: { tests: fromPanel(PANEL), unread: 0, noise: 0 } },
  { name: 'synthetic-02-merged-header-dot-mdl', id: '190002', lot: '101685-1', reported: '8/4/2026', layout: 'merged',
    pages: [[
      row(['Total Aerobic Microbial Count (USP)', 'USP <2021>', '100', '<100', 'cfu/g']),
      row(['Arsenic', 'USP <233>', '.001', '0.002', 'ppm']),
      row(['Gluten Allergen', 'ELISA', '4', '<4', 'ppm']),
    ]],
    expected: { tests: [t('Total Aerobic Microbial Count (USP)', '<100', 'cfu/g', '100', 'USP <2021>'), t('Arsenic', '0.002', 'ppm', '.001', 'USP <233>'), t('Gluten Allergen', '<4', 'ppm', '4', 'ELISA')], unread: 0, noise: 0 } },
  { name: 'synthetic-03-gluten-and-report-only', id: '190003', lot: '101700', reported: '8/5/2026', layout: 'sep',
    pages: [[
      row(['Gluten Allergen', 'ELISA', '4', '<4', 'ppm']),
      row(['Water Activity', 'AOAC 978.18', '', '0.32', '']),
      row(['Moisture', 'AOAC 925.10', '', '4.1', '%']),
    ]],
    expected: { tests: [t('Gluten Allergen', '<4', 'ppm', '4', 'ELISA'), t('Water Activity', '0.32', null, null, 'AOAC 978.18'), t('Moisture', '4.1', '%', null, 'AOAC 925.10')], unread: 0, noise: 0 } },
  { name: 'synthetic-04-qualitative-words', id: '190004', lot: '101701', reported: '8/6/2026', layout: 'sep',
    pages: [[
      row(['E.Coli BAM (MOD)', 'BAM CH. 4', '', 'Absent', '']),
      row(['Listeria', 'BAM CH. 10', '', 'Not Detected', '']),
      row(['Coagulase Positive Staph', 'BAM CH. 12', '', 'Negative', '']),
      row(['Salmonella', 'BAM CH. 5', '', 'Not Detected in 25g', '']),
      row(['Cronobacter', 'ISO 22964', '', 'ND in 25 g', '']),
    ]],
    // A result with a sample size is not read automatically: two lines unread, named.
    expected: { tests: [t('E.Coli BAM (MOD)', 'Absent', null, null, 'BAM CH. 4'), t('Listeria', 'NotDetected', null, null, 'BAM CH. 10'), t('Coagulase Positive Staph', 'Negative', null, null, 'BAM CH. 12')], unread: 2, noise: 0 } },
  { name: 'synthetic-05-scientific-notation', id: '190005', lot: '101702', reported: '8/7/2026', layout: 'sep',
    pages: [[
      row(['Total Aerobic Microbial Count (USP)', 'USP <2021>', '10', '1.3E+03', 'cfu/g']),
      row(['Yeast & Mold', 'USP <2021>', '10', '2.0x10^2', 'cfu/g']),
      row(['Lead', 'USP <233>', '0.005', '0.012', 'ppm']),
    ]],
    expected: { tests: [t('Lead', '0.012', 'ppm', '0.005', 'USP <233>')], unread: 2, noise: 0 } },
  { name: 'synthetic-06-thousands-separators', id: '190006', lot: '101703', reported: '8/8/2026', layout: 'sep',
    pages: [[
      row(['Potassium', 'ICP-OES', '10', '6,564.814', 'mg/kg']),
      row(['Total Aerobic Microbial Count (USP)', 'USP <2021>', '10', '1,300', 'cfu/g']),
    ]],
    expected: { tests: [t('Potassium', '6,564.814', 'mg/kg', '10', 'ICP-OES'), t('Total Aerobic Microbial Count (USP)', '1,300', 'cfu/g', '10', 'USP <2021>')], unread: 0, noise: 0 } },
  { name: 'synthetic-07-allergen-panel', id: '190007', lot: '101474', reported: '10/9/2026', layout: 'sep',
    pages: [[
      row(['Soy Allergen', 'ELISA', '0.04', '<0.04', 'ppm']),
      row(['Milk Allergen', 'ELISA', '0.4', '<0.4', 'ppm']),
      row(['Peanut Allergen', 'ELISA', '0.04', '<0.04', 'ppm']),
      row(['Gluten Allergen', 'ELISA', '4', '<4', 'ppm']),
    ]],
    expected: { tests: [t('Soy Allergen', '<0.04', 'ppm', '0.04', 'ELISA'), t('Milk Allergen', '<0.4', 'ppm', '0.4', 'ELISA'), t('Peanut Allergen', '<0.04', 'ppm', '0.04', 'ELISA'), t('Gluten Allergen', '<4', 'ppm', '4', 'ELISA')], unread: 0, noise: 0 } },
  { name: 'synthetic-08-repeated-test', id: '190008', lot: '101704', reported: '8/9/2026', layout: 'sep',
    pages: [[
      row(['Gluten Allergen', 'ELISA', '4', '<4', 'ppm']),
      row(['Lead', 'USP <233>', '0.005', '0.012', 'ppm']),
      row(['Gluten Allergen', 'ELISA', '4', '<4', 'ppm']),
      row(['Lead', 'USP <233>', '0.005', '0.020', 'ppm']),
    ]],
    // The same row twice is noise; the same test with another value is unread — a person keeps the right one.
    expected: { tests: [t('Gluten Allergen', '<4', 'ppm', '4', 'ELISA'), t('Lead', '0.012', 'ppm', '0.005', 'USP <233>')], unread: 1, noise: 1 } },
  { name: 'synthetic-09-wrapped-lines', id: '190009', lot: '101705', reported: '8/10/2026', layout: 'sep',
    pages: [[
      row(['Total Coliforms (BAM)', 'BAM CH. 4', '10', '<10', 'cfu/g']),
      { wrap: { test: '(MOD)', method: '(MOD)' } },
      row(['E.Coli BAM', 'BAM CH. 4', '', 'Absent', '']),
      { wrap: { method: '(MOD)' } },
      row(['Arsenic', 'USP <233>', '0.005', '0.008', 'ppm']),
    ]],
    expected: { tests: [t('Total Coliforms (BAM)', '<10', 'cfu/g', '10', 'BAM CH. 4'), t('E.Coli BAM', 'Absent', null, null, 'BAM CH. 4'), t('Arsenic', '0.008', 'ppm', '0.005', 'USP <233>')], unread: 0, noise: 0 } },
  { name: 'synthetic-10-two-pages', id: '190010', lot: '101706-2', reported: '8/11/2026', layout: 'sep',
    pages: [PANEL.slice(0, 6).map(row), PANEL.slice(6).map(row)],
    expected: { tests: fromPanel(PANEL), unread: 0, noise: 0 } },
  { name: 'synthetic-11-unreadable-row', id: '190011', lot: '101707', reported: '8/12/2026', layout: 'sep',
    pages: [[
      row(['Total Aerobic Microbial Count (USP)', 'USP <2021>', '10', 'TNTC', 'cfu/g']),
      row(['Vitamin C', 'HPLC', '', 'See note', 'mg/g']),
      row(['Lead', 'USP <233>', '0.005', '0.012', 'ppm']),
    ]],
    expected: { tests: [t('Lead', '0.012', 'ppm', '0.005', 'USP <233>')], unread: 2, noise: 0 } },
  { name: 'synthetic-12-no-text-layer', id: null, image: true,
    expected: { tests: [], unread: 0, noise: 0, text_layer: false } },
];

function header(doc, f) {
  doc.font('Helvetica-Bold').fontSize(14).text('Certificate of Analysis', 50, 50, { lineBreak: false });
  doc.font('Helvetica').fontSize(9);
  let y = 90;
  for (const [label, value] of [['CTLA ID:', f.id], ['Date Received:', '7/23/2026'], ['Sample Name:', 'Synthetic Sample'], ['Lot Number:', f.lot], ['Customer:', 'Powder Ops 281 E 1600 N, Vineyard, UT 84059']]) {
    doc.text(label, 50, y, { lineBreak: false });
    doc.text(value, 150, y, { lineBreak: false });
    y += 14;
  }
  return y + 16;
}

function tableHeader(doc, f, y) {
  doc.font('Helvetica-Bold').fontSize(9);
  if (f.layout === 'merged') {
    for (const [k, label] of [['test', 'Analysis'], ['method', 'Method'], ['mdlspec', 'MDL Specification'], ['result', 'Result'], ['unit', 'Units']]) doc.text(label, MERGED[k], y, { lineBreak: false });
  } else {
    for (const [k, label] of [['test', 'Analysis'], ['method', 'Method'], ['mdl', 'MDL'], ['spec', 'Specification'], ['result', 'Result'], ['unit', 'Units']]) doc.text(label, SEP[k], y, { lineBreak: false });
  }
  doc.font('Helvetica');
  return y + 16;
}

function drawRow(doc, f, r, y) {
  if (r.wrap) {
    if (r.wrap.test) doc.text(r.wrap.test, SEP.test, y, { lineBreak: false });
    if (r.wrap.method) doc.text(r.wrap.method, SEP.method, y, { lineBreak: false });
    return y + 13;
  }
  doc.text(r.test, SEP.test, y, { lineBreak: false });
  doc.text(r.method, SEP.method, y, { lineBreak: false });
  if (f.layout === 'merged') {
    const w = r.mdl ? doc.widthOfString(`${r.mdl} `) : 0;
    if (r.mdl) doc.text(r.mdl, MERGED.mdlspec + 5, y, { lineBreak: false });
    doc.text('Report', MERGED.mdlspec + 5 + w, y, { lineBreak: false });
  } else {
    // `tight` puts the MDL hard against the result, the seam that once read "<0.040.04".
    if (r.mdl) doc.text(r.mdl, f.tight ? SEP.result - 30 : SEP.mdl, y, { lineBreak: false });
    doc.text('Report', SEP.spec, y, { lineBreak: false });
  }
  doc.text(r.value, SEP.result, y, { lineBreak: false });
  if (r.unit) doc.text(r.unit, SEP.unit, y, { lineBreak: false });
  return y + 15;
}

export function writeFixture(f, dir = here) {
  return new Promise((resolve) => {
    const doc = new PDFDocument({ size: 'LETTER', margin: 40, autoFirstPage: true });
    const out = createWriteStream(path.join(dir, `${f.name}.pdf`));
    out.on('finish', resolve);
    doc.pipe(out);
    if (f.image) {
      // A photograph of a report: shapes only, no text layer at all.
      doc.rect(50, 50, 500, 30).fill('#333');
      for (let i = 0; i < 12; i++) doc.rect(50, 110 + i * 18, 480, 8).fill('#999');
      doc.end();
      return;
    }
    f.pages.forEach((rows, p) => {
      if (p > 0) doc.addPage();
      let y = p === 0 ? header(doc, f) : 60;
      y = tableHeader(doc, f, y);
      for (const r of rows) y = drawRow(doc, f, r, y);
      doc.fontSize(7).text('Specifications provided by the Customer. This report does not constitute a guarantee of quality for the entire product.', 50, y + 20, { width: 500 });
      doc.fontSize(9);
      if (p === f.pages.length - 1) doc.text(f.reported, 50, y + 50, { lineBreak: false });
      doc.text(`Page ${p + 1} of ${f.pages.length}`, 470, 740, { lineBreak: false });
    });
    doc.end();
  });
}

export function expectedFor(f) {
  const iso = (d) => { const m = String(d || '').match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/); return m ? `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}` : null; };
  return {
    fixture: f.name,
    text_layer: f.expected.text_layer !== false,
    lab_report_number: f.id,
    report_date: iso(f.reported),
    tests: f.expected.tests,
    unread: f.expected.unread,
    noise: f.expected.noise,
  };
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  for (const f of FIXTURES) {
    await writeFixture(f);
    writeFileSync(path.join(here, `${f.name}.expected.json`), JSON.stringify(expectedFor(f), null, 2) + '\n');
  }
  console.log(`wrote ${FIXTURES.length} synthetic reports and their expected answers to ${here}`);
}
