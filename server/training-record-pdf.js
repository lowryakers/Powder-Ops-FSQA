// One training record on paper, with its sign-off (D-282, 21 CFR 11.50).
//
// An auditor asking "show me that Maria was trained on SOP 401 and who signed
// it" gets one page: the person, the course and document revision, the dates,
// how they were trained, and the sign-off printed as name · date and time
// (plant time) · meaning · whether the fingerprint still matches. Renders only;
// every value comes from the record.
import PDFDocument from 'pdfkit';
import { embedUnicodeFaces } from './pdf-unicode.js';
import { competenceSignatureState, meaningOf } from './training-records.js';
import { methodLabel } from '../shared/training-record-fields.js';
import { plantDateTime } from './plant-clock.js';

const MUTED = '#6b7280';

export function renderTrainingRecordPdf(res, rec, { course = null } = {}) {
  const doc = new PDFDocument({ size: 'LETTER', margin: 60 });
  embedUnicodeFaces(doc);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="training-record-${String(rec.employee_name || 'record').replace(/[^A-Za-z0-9]+/g, '-')}.pdf"`);
  doc.pipe(res);
  try {
    doc.fontSize(16).font('Helvetica-Bold').fillColor('#111827').text('Training record');
    doc.fontSize(9).font('Helvetica').fillColor(MUTED).text('Powder Ops · ReadyDoc');
    doc.moveDown(1);
    const line = (label, value) => {
      doc.fontSize(10).font('Helvetica-Bold').fillColor('#374151').text(`${label}:  `, { continued: true });
      doc.font('Helvetica').fillColor('#111827').text(value == null || value === '' ? '—' : String(value));
    };
    line('Employee', rec.employee_name);
    line('Course', course ? `${course.code ? `${course.code} — ` : ''}${course.title}` : (rec.training_topic || rec.course_title));
    line('Document revision trained on', rec.sop_revision);
    line('Training date', rec.training_date);
    line('Completion date', rec.completion_date);
    line('Status', rec.status);
    line('How trained', methodLabel(rec.method));
    line(rec.competence_meaning === 'Recorded external training' ? 'Outside trainer (not a ReadyDoc signer)' : 'Trainer', rec.trainer);
    if (rec.competence_meaning === 'Recorded external training') line('Certificate', rec.document_url || rec.certificate_url);
    line('Language', rec.language);
    if (rec.score != null) line('Score', rec.score);
    line('Recorded by', `${rec.recorded_by || '—'} · ${plantDateTime(rec.created_at)}`);
    doc.moveDown(1);

    doc.fontSize(12).font('Helvetica-Bold').fillColor('#111827').text('Sign-off');
    doc.moveDown(0.3);
    const state = competenceSignatureState(rec);
    if (rec.competence_signed_at) {
      doc.fontSize(10).font('Helvetica-Bold').text(`${rec.competence_signed_by} — ${meaningOf(rec)}`);
      doc.font('Helvetica').fillColor('#374151').text(plantDateTime(rec.competence_signed_at));
      doc.text(rec.competence_statement || '');
      doc.fillColor(state === 'signed' ? '#166534' : '#b91c1c').text(state === 'signed'
        ? 'Electronically signed with the signer\'s password · fingerprint matches this record'
        : 'WARNING: a signed fact on this record changed after it was signed');
    } else if (rec.test_attempt_id || (rec.score != null && rec.passed)) {
      doc.fontSize(10).font('Helvetica').fillColor('#374151').text('Competence shown by a passed test (no trainer signature needed).');
    } else if (rec.competence_statement) {
      doc.fontSize(10).font('Helvetica').fillColor('#374151').text(`${rec.competence_statement}`);
      doc.fillColor(MUTED).text('Recorded before signatures were required (not password-signed).');
    } else {
      doc.fontSize(10).font('Helvetica').fillColor(MUTED).text('No sign-off on this record.');
    }
    if (rec.competence_withdrawn) {
      let w = null; try { w = JSON.parse(rec.competence_withdrawn); } catch { w = null; }
      if (w) {
        doc.moveDown(0.5).fillColor('#b91c1c').text(`A signature by ${w.signed_by} (${plantDateTime(w.signed_at)}) was withdrawn by ${w.withdrawn_by} on ${plantDateTime(w.withdrawn_at)}: ${w.reason}`);
      }
    }
    doc.moveDown(2).fontSize(8).fillColor(MUTED).text(`Printed ${plantDateTime(new Date())}. Record id ${rec.id}.`);
  } catch (e) {
    console.warn('[training-record-pdf]', e.message);
  }
  doc.end();
}
