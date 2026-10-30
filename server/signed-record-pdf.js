// One signed record, printed (D-293). Every type on the record interface —
// sanitation and QA inspections, the daily scale checks, every QMS form —
// prints from the SAME described row, so a printout says exactly what the
// record interface says, and every signature on it carries its name, the time
// in plant time, and its meaning in words.
import PDFDocument from 'pdfkit';
import { embedUnicodeFaces, printable } from './pdf-unicode.js';
import { plantDateTime } from './plant-clock.js';
import { signatureMeaning } from '../shared/signature-meaning.js';

const KIND_FOR = { sanitation: 'qa_verification', scale: 'scale_verification' };

/** The signatures on a described record, each with its meaning. PURE. */
export function printedSignatures(described) {
  if (described.type === 'qms') {
    return (described.signatures || []).map((s) => ({ name: s.name, at: s.at, meaning: signatureMeaning('qms_approval', s.label) }));
  }
  if (!described.signed_by) return [];
  return [{ name: described.signed_by, at: described.signed_at, meaning: signatureMeaning(KIND_FOR[described.type] || 'qa_verification') }];
}

export function renderSignedRecord(res, described, { printedBy } = {}) {
  const doc = new PDFDocument({ size: 'LETTER', margin: 50 });
  embedUnicodeFaces(doc);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="record-${described.type}-${described.id}.pdf"`);
  doc.pipe(res);
  try {
    doc.font('Helvetica-Bold').fontSize(15).text(printable(described.title || described.form || 'Record'));
    doc.font('Helvetica').fontSize(9).fillColor('#555').text(printable(described.form || ''));
    doc.moveDown(0.8).fillColor('#000').fontSize(10);
    const line = (k, v) => { if (v == null || v === '') return; doc.font('Helvetica-Bold').text(`${k}: `, { continued: true }).font('Helvetica').text(printable(String(v))); };
    line('Performed by', described.performed_by);
    line('When', described.performed_at ? plantDateTime(described.performed_at) : null);
    line('Where', described.place);
    line('Result', described.result);

    doc.moveDown(0.8).font('Helvetica-Bold').fontSize(11).text('Signatures');
    doc.fontSize(10);
    const sigs = printedSignatures(described);
    if (!sigs.length) doc.font('Helvetica-Oblique').text('Not signed.');
    for (const s of sigs) {
      doc.moveDown(0.3).font('Helvetica-Bold').text(printable(s.name || '—'));
      doc.font('Helvetica').text(`Signed: ${plantDateTime(s.at)}`);
      doc.text(`Meaning: ${s.meaning}`);
      doc.fontSize(8).fillColor('#555').text('Signed in ReadyDoc with the signer\'s password at the time of signing.').fillColor('#000').fontSize(10);
    }
    if (described.approvals_pending?.length) doc.moveDown(0.3).font('Helvetica-Oblique').text(`Still to sign: ${described.approvals_pending.join(', ')}`);

    doc.moveDown(1.2).fontSize(8).fillColor('#777').font('Helvetica')
      .text(`Printed ${plantDateTime(new Date().toISOString())}${printedBy ? ` by ${printedBy}` : ''}. Printed copies are uncontrolled; the record in ReadyDoc is the original.`);
  } catch (e) { console.warn('[pdf] signed record render failed:', e.message); }
  doc.end();
}
