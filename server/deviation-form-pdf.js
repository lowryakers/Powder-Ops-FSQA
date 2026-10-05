// FORM 442-01 — Deviation Report, drawn as the form (D-151).
//
// Quality attaches each deviation to its MO in MRPEasy, and the export they
// were attaching was the generic QMS layout: a column of "Label: value" lines
// with "Form 442-01" in small type under a heading. Nobody holding the paper
// form would recognise it as the same document, and an auditor comparing the
// MO's attachment to the controlled form has to translate one into the other.
//
// So the deviation export IS the form: the same grid, the same sections in the
// same order, the same wording — including the form's own spellings
// ("Product Discription", "disignee", "Bill Or Material"), because a record
// that quietly corrects its controlled form is a record that disagrees with it;
// fixing the form is a Document Change Request. Boxes the record ticks are
// ticked; boxes it does not answer are left empty, never guessed. A value the
// record does not hold (Room#) is left blank, never filled in.
//
// Geometry is taken off the paper form (Rev1) as fractions of the box width, so
// the columns and checkboxes sit where they sit on the paper. Rows that carry
// free text grow with it and break onto another page between rows.
//
// Page 2 carries the ReadyDoc record history, titled as NOT part of the form:
// the chain of custody is worth having in the MO's file, and printing it inside
// the form's grid would make the attachment disagree with the form.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { registerUnicodeFonts, printable } from './pdf-unicode.js';
import { PLANT_TZ, parseServerTime } from './plant-clock.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOGO = path.join(__dirname, 'assets', 'powder-ops-logo.jpg');

const PAGE = { w: 612, h: 792 };
const M = { left: 30, right: 30, top: 26, bottom: 24 };
const W = PAGE.w - M.left - M.right;
const X = (f) => M.left + W * f;               // a fraction of the box, as on the paper
const GREY = '#d9d9d9';
const PAD = 4;

// Where the deviation_type options land on the form's Protocol Deviation row.
// "Protocol" and "Other" have no box of their own on Rev1 — they are written on
// the Other line, which is what the paper asks for.
const PROTOCOL_BOXES = [
  { label: 'Document Or Policy', box: 0.287, values: ['Document'] },
  { label: 'Procedure Or Policy', box: 0.529, values: ['Procedure'] },
  { label: 'Bill Or Material', box: 0.734, values: ['Bill of Material'] },
];

const usDate = (v) => {
  const s = String(v || '').slice(0, 10);
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[2]}/${m[3]}/${m[1]}` : (v ? String(v) : '');
};
const plantDateTime = (v) => {
  const d = parseServerTime(v);
  if (!d) return '';
  return new Intl.DateTimeFormat('en-US', { timeZone: PLANT_TZ, month: '2-digit', day: '2-digit', year: 'numeric',
    hour: 'numeric', minute: '2-digit' }).format(d);
};
/** "V1" on the register reads "Rev1" on the paper; anything else is printed as written. */
export function revisionLabel(rev) {
  const s = String(rev || '').trim();
  const m = s.match(/^v(?:er(?:sion)?)?\s*(\d+)$/i);
  return m ? `Rev${m[1]}` : (s || 'Rev1');
}

/**
 * Render a deviation onto `doc` (a pdfkit document created with bufferPages).
 * `rec` is the flattened qms record (data fields on the row), `approvals` the
 * cfg.approvals list, `history` the audit rows, `revision` the register's.
 */
export function renderDeviationForm(doc, { rec, approvals = [], history = [], revision = 'V1' }) {
  const F = registerUnicodeFonts(doc);
  const rev = revisionLabel(revision);
  let y = M.top;

  const ensure = (h) => {
    if (y + h > PAGE.h - M.bottom - 12) { doc.addPage({ size: 'LETTER', margin: 0 }); y = M.top; }
  };
  const text = (s, x, ty, opts = {}) => {
    const { font = F.regular, size = 8, width, color = '#000', align } = opts;
    doc.font(font).fontSize(size).fillColor(color).text(printable(s), x, ty, { width, align, lineBreak: width != null });
  };
  const measure = (s, width, font = F.regular, size = 8.5) => {
    doc.font(font).fontSize(size);
    return s ? doc.heightOfString(printable(s), { width }) : 0;
  };
  const cell = (x0, x1, h) => { doc.lineWidth(0.6).strokeColor('#000').rect(x0, y, x1 - x0, h).stroke(); };
  const box = (fx, ty, checked) => {
    const x = X(fx);
    doc.lineWidth(0.6).strokeColor('#555').rect(x, ty, 8, 8).stroke();
    if (checked) {
      doc.lineWidth(1.1).strokeColor('#000').moveTo(x + 1.5, ty + 1.5).lineTo(x + 6.5, ty + 6.5)
        .moveTo(x + 6.5, ty + 1.5).lineTo(x + 1.5, ty + 6.5).stroke();
    }
  };
  // A label and its value on one line inside a cell.
  const labelled = (label, value, x0, x1, ty, { labelFont = F.bold, valueFont = F.regular } = {}) => {
    doc.font(labelFont).fontSize(7.5);
    const lw = doc.widthOfString(label) + 4;
    text(label, x0 + PAD, ty, { font: labelFont, size: 7.5 });
    if (value) text(value, x0 + PAD + lw, ty - 0.5, { font: valueFont, size: 8.5, width: x1 - x0 - PAD * 2 - lw });
  };
  const sectionBar = (title) => {
    ensure(20);
    doc.rect(M.left, y, W, 20).fillAndStroke(GREY, '#000');
    text(title, M.left + PAD, y + 6, { font: F.boldItalic, size: 9 });
    y += 20;
  };

  // ── Header: logo + title ────────────────────────────────────────────────
  cell(M.left, M.left + W, 54);
  try { doc.image(LOGO, X(0.235), y + 3, { height: 48 }); } catch { /* the title still identifies the form */ }
  text('Deviation Report', X(0.36), y + 17, { font: F.bold, size: 19 });
  y += 54;

  // ── Deviation Information ───────────────────────────────────────────────
  sectionBar('Deviation Information:');
  const split = 0.489;
  const twoCol = (l1, v1, l2, v2, f1, f2) => {
    const h = 21;
    ensure(h);
    cell(M.left, X(split), h); cell(X(split), M.left + W, h);
    labelled(l1, v1, M.left, X(split), y + 7, { labelFont: f1 });
    labelled(l2, v2, X(split), M.left + W, y + 7, { labelFont: f2 });
    y += h;
  };
  twoCol('Deviation Control #:', rec.record_number || '', 'Initiator:', rec.initiator || '', F.boldItalic, F.boldItalic);
  twoCol('Date:', usDate(rec.record_date), 'Room#:', rec.room || '', F.bold, F.bold);

  ensure(36);
  cell(M.left, M.left + W, 36);
  text('Change type:', M.left + PAD, y + 9, { font: F.italic, size: 7.5 });
  const temp = rec.change_type === 'Temporary';
  const longTerm = rec.change_type === 'Long Term';
  text('Temporary', X(0.287) - 46, y + 9, { size: 7.5 }); box(0.287, y + 8, temp);
  text('Long Term', X(0.734) - 42, y + 9, { size: 7.5 }); box(0.734, y + 8, longTerm);
  y += 36;

  ensure(52);
  cell(M.left, M.left + W, 52);
  text('Protocol Deviation:', M.left + PAD, y + 9, { size: 7.5 });
  for (const p of PROTOCOL_BOXES) {
    doc.font(F.regular).fontSize(7.5);
    text(p.label, X(p.box) - doc.widthOfString(p.label) - 5, y + 9, { size: 7.5 });
    box(p.box, y + 8, p.values.includes(rec.deviation_type));
  }
  const other = ['Protocol', 'Other'].includes(rec.deviation_type) ? rec.deviation_type : '';
  text('Other:', X(0.32), y + 35, { size: 7.5 });
  doc.lineWidth(0.5).strokeColor('#000').moveTo(X(0.32) + 24, y + 43).lineTo(X(0.676), y + 43).stroke();
  if (other) text(other, X(0.32) + 28, y + 34, { size: 8.5, width: X(0.676) - X(0.32) - 30 });
  y += 52;

  // ── Deviation Description ───────────────────────────────────────────────
  sectionBar('Deviation Description:');
  {
    const cols = [[M.left, X(split), 'Product Discription:', rec.product_description],
      [X(split), X(0.731), 'Lot:', rec.lot], [X(0.731), M.left + W, 'Item #:', rec.item_number]];
    const h = Math.max(36, ...cols.map(([a, b, , v]) => 16 + measure(v, b - a - PAD * 2) + PAD));
    ensure(h);
    for (const [a, b, label, v] of cols) {
      cell(a, b, h);
      text(label, a + PAD, y + 5, { font: F.bold, size: 7.5 });
      if (v) text(v, a + PAD, y + 16, { size: 8.5, width: b - a - PAD * 2 });
    }
    y += h;
  }
  const freeBox = (value, minH) => {
    const h = Math.max(minH, measure(value, W - PAD * 2) + PAD * 3);
    ensure(Math.min(h, PAGE.h - M.top - M.bottom - 40));
    cell(M.left, M.left + W, h);
    if (value) text(value, M.left + PAD, y + PAD + 1, { size: 8.5, width: W - PAD * 2 });
    y += h;
  };
  freeBox(rec.description, 68);

  // ── Deviation Impact / Comments ─────────────────────────────────────────
  sectionBar('Deviation Impact / Comments:');
  freeBox(rec.impact, 100);

  twoCol('Deviation Start Date:', usDate(rec.start_date), 'Deviation End Date:', usDate(rec.end_date), F.regular, F.regular);

  ensure(18);
  cell(M.left, M.left + W, 18);
  text('Is a CAPA needed for this deviation:', M.left + PAD, y + 6, { size: 7.5 });
  const answered = rec.capa_needed === true || rec.capa_needed === false || rec.capa_needed === 1 || rec.capa_needed === 0;
  text('YES', X(0.499) - 19, y + 6, { size: 7.5 }); box(0.499, y + 5, answered && !!rec.capa_needed);
  text('NO', X(0.734) - 15, y + 6, { size: 7.5 }); box(0.734, y + 5, answered && !rec.capa_needed);
  y += 18;

  ensure(17);
  cell(M.left, M.left + W, 17);
  labelled('CAPA#:', rec.capa_number || '', M.left, M.left + W, y + 5, { labelFont: F.regular });
  y += 17;

  {
    const h = Math.max(44, 16 + measure(rec.notes, W - PAD * 2) + PAD);
    ensure(h);
    cell(M.left, M.left + W, h);
    text('Comments:', M.left + PAD, y + 5, { size: 7.5 });
    if (rec.notes) text(rec.notes, M.left + PAD, y + 16, { size: 8.5, width: W - PAD * 2 });
    y += h;
  }

  // ── Deviation Approval ──────────────────────────────────────────────────
  ensure(20 + 40 * 3);
  doc.rect(M.left, y, W, 20).fillAndStroke(GREY, '#000');
  text('Deviation Approval:', M.left + PAD, y + 6, { font: F.bold, size: 8 });
  y += 20;
  const formLabel = { manufacturing_manager: 'Manufacturing Manager and / or disignee:', qa_director: 'QA Director  and  / or designee:', customer: 'Customer:' };
  const aSplit = 0.524;
  for (const a of approvals) {
    const s = rec.approvals?.[a.key];
    const h = 40;
    cell(M.left, X(aSplit), h); cell(X(aSplit), M.left + W, h);
    text(formLabel[a.key] || `${a.label}:`, M.left + PAD, y + 7, { font: F.italic, size: 7.5 });
    text('Date:', X(aSplit) + PAD, y + 7, { size: 7.5 });
    if (s?.name) {
      text(`${s.name}  (electronically signed in ReadyDoc)`, M.left + PAD, y + 18, { font: F.bold, size: 8.5, width: X(aSplit) - M.left - PAD * 2 });
      if (s.attestation) text(`"${s.attestation}"`, M.left + PAD, y + 29, { font: F.italic, size: 6, width: X(aSplit) - M.left - PAD * 2 });
      text(plantDateTime(s.signed_at), X(aSplit) + PAD + 24, y + 6.5, { size: 8.5 });
    } else if (rec.paper_record) {
      text('Signed on the paper original', M.left + PAD, y + 20, { font: F.italic, size: 7.5, color: '#444' });
    }
    y += h;
  }

  // ── Record history (page 2, not part of the form) ───────────────────────
  if (history.length) {
    doc.addPage({ size: 'LETTER', margin: 0 });
    y = M.top;
    text('Record history — ReadyDoc', M.left, y, { font: F.bold, size: 12 });
    y += 16;
    text(`Not part of Form 442-01. The audit trail of Deviation ${rec.record_number || ''} as kept in ReadyDoc, times in plant time (${PLANT_TZ}).`,
      M.left, y, { font: F.italic, size: 8, width: W, color: '#444' });
    y += 20;
    for (const h of history) {
      ensure(13);
      text(plantDateTime(h.timestamp), M.left, y, { size: 8 });
      text(h.actor || 'system', M.left + 110, y, { size: 8 });
      text(h.action, M.left + 230, y, { size: 8, width: W - 230 });
      y += 13;
    }
  }

  // ── Footer on every page: the form's own ────────────────────────────────
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    const fy = PAGE.h - M.bottom - 10;
    text('Form 442-01', M.left, fy, { size: 7.5 });
    text(rev, M.left, fy, { size: 7.5, width: W, align: 'center' });
    text(`Page ${i - range.start + 1} of ${range.count}`, M.left, fy, { size: 7.5, width: W, align: 'right' });
  }
}
