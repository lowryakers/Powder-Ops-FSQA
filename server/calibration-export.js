// What a calibration company needs from us, in one file (D-353).
//
// Every visit started with somebody copying instrument details out of the
// register into an email: which scales, where they are, their serial numbers,
// how heavy they go, how close they must read, when they were last done. All of
// it is on the register already. This reads it — the instruments due (or all in
// service), each with its identity, location, range, required tolerance, the
// points the floor checks it at every morning, and the last calibration — and
// prints the requirements every certificate must meet beside it.
//
// READ ONLY. Nothing is stamped, scheduled or sent; the office emails the file.
import PDFDocument from 'pdfkit';
import { embedUnicodeFaces } from './pdf-unicode.js';
import { getScaleForm } from './scale-forms.js';
import { PLANT_CONTACT } from './coa-submission.js';
import { plantDateOf } from './plant-clock.js';

// What each certificate must carry, and why — the plant's own requirements
// (SQF 2.3.x / 11.2.3, 21 CFR 117.165). Plain words; the company reads them.
export const CERT_REQUIREMENTS = [
  'Traceable to NIST (or another national standard). Name each reference standard used, with its certificate number and due date.',
  'As-found AND as-left readings at each test point, with the tolerance, and whether each point was in or out of tolerance as found.',
  'Identify each instrument by our asset number and its serial number, as listed here.',
  'Date calibrated, next due date, the method or procedure used, and the technician\'s name and signature.',
  'If you are ISO/IEC 17025 accredited, send the accreditation certificate and scope with the reports.',
  'Put a calibration sticker on each instrument: date, due date and initials.',
  'IF ANYTHING IS FOUND OUT OF TOLERANCE, tell us before you adjust it and before you leave — we have to review product made since the last good check.',
];

const COLUMNS = [
  ['Asset #', r => r.asset_number], ['Instrument', r => r.name], ['Type', r => r.type],
  ['Manufacturer', r => r.manufacturer], ['Model', r => r.model], ['Serial #', r => r.serial_number],
  ['Location', r => [r.location, r.room].filter(Boolean).join(' · ')], ['Department', r => r.department],
  ['Capacity / range', r => r.max_capacity], ['Unit', r => r.unit_of_measure], ['Required tolerance', r => r.tolerance],
  ['Daily check points', r => r.check_points], ['Frequency', r => r.calibration_frequency],
  ['Last calibrated', r => r.last_calibrated], ['Due', r => r.next_due], ['Status', r => r.status_label],
  ['Last certificate #', r => r.last_certificate], ['Last calibrated by', r => r.last_calibrated_by],
  ['Critical control', r => (r.is_critical_control ? 'Yes' : '')], ['Notes', r => r.notes],
];

const STATUS = { active: 'In service', due: 'Due', overdue: 'Overdue', out_of_service: 'Out of service' };

/** scope: 'due' (due within `within` days, overdue included) | 'all' (every instrument in service). */
export function calibrationExport(db, { scope = 'due', within = 60, includeOutOfService = false } = {}) {
  const today = plantDateOf();
  const until = new Date(`${today}T12:00:00Z`); until.setUTCDate(until.getUTCDate() + Math.max(0, Math.min(Number(within) || 60, 730)));
  const untilStr = until.toISOString().slice(0, 10);
  const statuses = includeOutOfService ? "('retired')" : "('retired','out_of_service')";
  let sql = `SELECT * FROM calibration_instruments WHERE status NOT IN ${statuses}`;
  const args = [];
  if (scope !== 'all') { sql += ' AND (next_due IS NULL OR next_due = \'\' OR next_due <= ?)'; args.push(untilStr); }
  sql += ' ORDER BY COALESCE(next_due, \'9999\'), department, asset_number, name';
  const lastRec = db.prepare('SELECT certificate_number, calibrated_by, calibrated_at FROM calibration_records WHERE instrument_id = ? ORDER BY calibrated_at DESC LIMIT 1');
  const lastForm = db.prepare('SELECT form_code FROM scale_verifications WHERE instrument_id = ? ORDER BY performed_at DESC LIMIT 1');
  const rows = db.prepare(sql).all(...args).map((i) => {
    const rec = lastRec.get(i.id);
    let checkPoints = null;
    try {
      const fc = lastForm.get(i.id)?.form_code;
      const form = fc ? getScaleForm(fc) : null;
      if (form?.points?.length) checkPoints = form.points.map(p => `${p.nominal} ± ${p.tolerance} ${form.unit}`).join('; ') + ` (FORM ${form.code})`;
    } catch { /* no scale check on file */ }
    const overdue = i.status !== 'out_of_service' && i.next_due && i.next_due < today;
    return { ...i, check_points: checkPoints, last_certificate: rec?.certificate_number || null,
      last_calibrated_by: rec?.calibrated_by || null,
      status_label: overdue ? 'Overdue' : !i.next_due ? 'No due date on file' : (STATUS[i.status] || i.status) };
  });
  return { as_of: today, scope, within: scope === 'all' ? null : Number(within) || 60, until: scope === 'all' ? null : untilStr,
    include_out_of_service: !!includeOutOfService, rows, requirements: CERT_REQUIREMENTS, contact: PLANT_CONTACT };
}

const cell = (v) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
export function calibrationCsv(exp) {
  const lines = [COLUMNS.map(([h]) => cell(h)).join(',')];
  for (const r of exp.rows) lines.push(COLUMNS.map(([, get]) => cell(get(r))).join(','));
  return lines.join('\r\n') + '\r\n';
}

export function renderCalibrationRequestPdf(res, exp) {
  const doc = new PDFDocument({ size: 'LETTER', layout: 'landscape', margin: 36 });
  embedUnicodeFaces(doc);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="calibration-request-${exp.as_of}.pdf"`);
  doc.pipe(res);
  try {
    const W = doc.page.width - 72;
    const c = exp.contact;
    doc.fontSize(16).font('Helvetica-Bold').fillColor('#111827').text('Calibration service request');
    doc.fontSize(9).font('Helvetica').fillColor('#374151')
      .text(`${c.company} · ${c.address}, ${c.city_state_zip} · ${c.phone} · ${c.email} · Contact: ${c.contact_name}`)
      .text(`Prepared ${exp.as_of}. ${exp.scope === 'all' ? 'Every instrument in service' : `Instruments due by ${exp.until} (overdue included)`}${exp.include_out_of_service ? ', out-of-service instruments included' : ''}: ${exp.rows.length}.`);
    doc.moveDown(0.5).fontSize(10).font('Helvetica-Bold').fillColor('#111827').text('What we need on every certificate');
    doc.fontSize(8.5).font('Helvetica').fillColor('#111827');
    exp.requirements.forEach((t, i) => doc.text(`${i + 1}. ${t}`, { width: W }));
    doc.moveDown(0.6);
    const cols = [
      { h: 'Asset #', w: 0.06, g: r => r.asset_number }, { h: 'Instrument', w: 0.14, g: r => r.name },
      { h: 'Make / model / serial', w: 0.16, g: r => [r.manufacturer, r.model, r.serial_number && `S/N ${r.serial_number}`].filter(Boolean).join(' · ') },
      { h: 'Location', w: 0.11, g: r => [r.location, r.room].filter(Boolean).join(' · ') },
      { h: 'Range', w: 0.08, g: r => [r.max_capacity, r.unit_of_measure].filter(Boolean).join(' ') },
      { h: 'Tolerance', w: 0.08, g: r => r.tolerance },
      { h: 'Daily check points', w: 0.17, g: r => r.check_points },
      { h: 'Last cal · cert #', w: 0.11, g: r => [r.last_calibrated, r.last_certificate].filter(Boolean).join(' · ') },
      { h: 'Due', w: 0.09, g: r => `${r.next_due || '—'}${r.status_label === 'Overdue' ? ' (overdue)' : r.status_label === 'Out of service' ? ' (out of service)' : ''}` },
    ];
    const xs = []; let x = 36; for (const col of cols) { xs.push(x); x += col.w * W; }
    const header = () => {
      const y = doc.y; doc.fontSize(7.5).font('Helvetica-Bold').fillColor('#374151');
      cols.forEach((col, i) => doc.text(col.h, xs[i], y, { width: col.w * W - 5 }));
      doc.moveTo(36, doc.y + 2).lineTo(36 + W, doc.y + 2).strokeColor('#d1d5db').stroke(); doc.y += 4;
    };
    header();
    for (const r of exp.rows) {
      const cells = cols.map(col => String(col.g(r) ?? '') || '—');
      doc.fontSize(7.5).font('Helvetica');
      const h = Math.max(...cells.map((t, i) => doc.heightOfString(t, { width: cols[i].w * W - 5 })));
      if (doc.y + h > doc.page.height - 40) { doc.addPage(); header(); }
      const y = doc.y;
      cells.forEach((t, i) => doc.fillColor(i === 8 && r.status_label === 'Overdue' ? '#b91c1c' : '#111827').text(t, xs[i], y, { width: cols[i].w * W - 5 }));
      doc.y = y + h + 3;
    }
    if (!exp.rows.length) doc.fontSize(9).fillColor('#6b7280').text('No instruments in this list.', 36);
  } catch (e) { console.warn('[calibration-request-pdf]', e.message); }
  doc.end();
}
