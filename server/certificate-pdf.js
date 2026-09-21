// The operator certification, on paper.
//
// 29 CFR 1910.178(l)(6) names exactly what a certification has to carry — the
// name of the operator, the date of the training, the date of the evaluation,
// and the identity of the person(s) performing the training or evaluation —
// so this is a transcription of a requirement rather than a document design.
// Nothing here is decorative: every field on the page is one the rule asks
// for, plus the truck it was earned on and the date it runs out.
//
// TWO THINGS ON ONE PAGE. The certificate goes in the training file; the card
// at the bottom is cut out and carried, which is what an operator is actually
// asked for on the floor. Printing them separately would mean two trips to the
// printer and a card that gets skipped.
//
// NOTHING IS INVENTED HERE. Every value comes from the derived certification,
// which comes from the two records — this renders, it does not decide. A
// second opinion about whether somebody is certified, formed inside a PDF
// writer, is exactly the disagreement that makes a certificate untrustworthy.

import PDFDocument from 'pdfkit';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOGO_PATH = path.join(__dirname, 'assets', 'powder-ops-logo.jpg');
const SLATE = '#1f2937';
const ORANGE = '#ea580c';
const RULE = '#d4d4d4';
const MUTED = '#6b7280';

const pretty = (iso) => {
  if (!iso) return '—';
  const d = new Date(`${String(iso).slice(0, 10)}T00:00:00`);
  return Number.isNaN(d.getTime()) ? String(iso)
    : d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
};

export function renderCertificate(res, { cert, form }) {
  const doc = new PDFDocument({ size: 'LETTER', margins: { top: 42, bottom: 48, left: 50, right: 50 } });
  const safe = String(cert.employee_name).replace(/[^a-zA-Z0-9]/g, '_');
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${cert.course_code}_Certificate_${safe}.pdf"`);
  doc.pipe(res);

  const lm = doc.page.margins.left;
  const pageW = doc.page.width - lm - doc.page.margins.right;

  // ── Letterhead ────────────────────────────────────────────────────────────
  const logoH = 64;
  try { doc.image(LOGO_PATH, lm, 42, { height: logoH }); } catch { /* logo optional */ }
  doc.font('Helvetica-Bold').fontSize(14).fillColor(SLATE).text('POWDER OPS', lm + 70, 50, { characterSpacing: 0.5 });
  doc.font('Helvetica').fontSize(8.5).fillColor(MUTED)
    .text('281 E 1600 N, Vineyard, UT 84059', lm + 70, 68)
    .text('www.powder-ops.com', lm + 70, 80);

  let y = 42 + logoH + 20;
  doc.font('Helvetica-Bold').fontSize(17).fillColor(SLATE)
    .text('POWERED INDUSTRIAL TRUCK', lm, y, { width: pageW, align: 'center', characterSpacing: 1.2 });
  y += 21;
  doc.text('OPERATOR CERTIFICATION', lm, y, { width: pageW, align: 'center', characterSpacing: 1.2 });
  y += 22;
  doc.font('Helvetica').fontSize(8).fillColor(MUTED)
    .text('Issued under 29 CFR 1910.178(l)(6)', lm, y, { width: pageW, align: 'center' });
  y += 14;
  doc.moveTo(lm, y).lineTo(lm + pageW, y).lineWidth(2).strokeColor(ORANGE).stroke();
  y += 20;

  // ── The operator ──────────────────────────────────────────────────────────
  doc.font('Helvetica').fontSize(9.5).fillColor(MUTED)
    .text('Powder Ops certifies that', lm, y, { width: pageW, align: 'center' });
  y += 16;
  doc.font('Helvetica-Bold').fontSize(24).fillColor(SLATE)
    .text(cert.employee_name, lm, y, { width: pageW, align: 'center' });
  y += 32;
  doc.font('Helvetica').fontSize(9.5).fillColor(MUTED).text(
    'has received training and has been evaluated in the operation of the powered industrial truck named below,',
    lm, y, { width: pageW, align: 'center' });
  y += 12;
  doc.text('and is authorized to operate it at this facility.', lm, y, { width: pageW, align: 'center' });
  y += 24;

  // ── The four facts the rule names ─────────────────────────────────────────
  const rows = [
    ['Truck type', cert.truck_type || 'Not recorded'],
    ['Date of training', `${pretty(cert.trained_on)}${cert.training_score != null ? `  ·  written test ${Math.round(cert.training_score)}%` : ''}`],
    ['Training delivered by', cert.trained_by || 'Not recorded'],
    ['Date of evaluation', pretty(cert.evaluated_on)],
    ['Evaluated by', cert.evaluated_by || 'Not recorded'],
    ['Re-evaluation due by', pretty(cert.expires_on)],
  ];
  const labW = 150;
  doc.fontSize(9.5);
  for (const [label, value] of rows) {
    doc.font('Helvetica-Bold').fillColor('#777').text(String(label).toUpperCase(), lm, y, { width: labW });
    doc.font('Helvetica').fillColor('#111').text(String(value), lm + labW, y, { width: pageW - labW });
    y += 17;
    doc.moveTo(lm, y - 4).lineTo(lm + pageW, y - 4).lineWidth(0.4).strokeColor(RULE).stroke();
  }
  y += 10;

  // ── What was NOT evaluated, named rather than left out ────────────────────
  //
  // A certificate that quietly omitted the tasks nobody watched would be the
  // more flattering document and the less useful one. An auditor reading this
  // can see exactly what the evaluation covered.
  if (cert.not_evaluated?.length) {
    doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#92400e')
      .text('NOT EVALUATED ON THIS OCCASION', lm, y, { width: pageW });
    y += 12;
    doc.font('Helvetica').fontSize(8).fillColor('#78350f');
    for (const item of cert.not_evaluated) {
      const line = `• ${item.label}${item.note ? ` — ${item.note}` : ''}`;
      doc.text(line, lm + 6, y, { width: pageW - 12 });
      y = doc.y + 2;
    }
    y += 8;
  }

  // ── Provenance ────────────────────────────────────────────────────────────
  doc.font('Helvetica').fontSize(7.5).fillColor(MUTED).text(
    `${cert.course_code} · ${cert.course_title}`
    + `  ·  Evaluation form ${form?.form_code || 'not yet issued'} ${cert.evaluation_revision || ''}`.trimEnd()
    + `  ·  Printed ${new Date().toLocaleDateString('en-US')}`,
    lm, y, { width: pageW });
  y += 12;
  if (!form?.form_code) {
    doc.fontSize(7.5).fillColor('#92400e').text(
      'The practical evaluation was recorded on a draft form pending Document Control. '
      + 'The evaluation itself, its date and its evaluator are the record; only the form number is outstanding.',
      lm, y, { width: pageW });
    y = doc.y + 6;
  }

  // ── The cut-out card ──────────────────────────────────────────────────────
  y = Math.max(y + 18, doc.page.height - doc.page.margins.bottom - 132);
  doc.save().dash(3, { space: 3 }).moveTo(lm, y).lineTo(lm + pageW, y)
    .lineWidth(0.7).strokeColor('#999').stroke().restore();
  doc.font('Helvetica').fontSize(7).fillColor(MUTED).text('cut along the line — operator card', lm, y + 4, { width: pageW, align: 'right' });
  y += 18;

  const cardW = 245, cardH = 96;
  doc.roundedRect(lm, y, cardW, cardH, 6).lineWidth(0.8).strokeColor(SLATE).stroke();
  doc.font('Helvetica-Bold').fontSize(7.5).fillColor(ORANGE)
    .text('POWDER OPS', lm + 10, y + 9, { characterSpacing: 0.6 });
  doc.font('Helvetica-Bold').fontSize(8).fillColor(SLATE)
    .text('FORKLIFT OPERATOR', lm + 10, y + 20, { characterSpacing: 0.4 });
  doc.font('Helvetica-Bold').fontSize(13).fillColor(SLATE)
    .text(cert.employee_name, lm + 10, y + 34, { width: cardW - 20 });
  doc.font('Helvetica').fontSize(7.5).fillColor('#374151')
    .text(cert.truck_type || 'Truck type not recorded', lm + 10, y + 54, { width: cardW - 20 })
    .text(`Evaluated ${pretty(cert.evaluated_on)}`, lm + 10, y + 66, { width: cardW - 20 })
    .text(`Valid to ${pretty(cert.expires_on)}`, lm + 10, y + 78, { width: cardW - 20 });

  doc.end();
}
