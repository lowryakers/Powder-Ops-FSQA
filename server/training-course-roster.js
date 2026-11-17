// Who was trained on one course, on one page (D-351).
//
// Carol's last piece of evidence for the supplier-audit CAR is "show me QA and
// Purchasing were trained on SOP 404". Every fact was already on file — a
// record per person, its date, how they were trained and who signed it off —
// but the only way to show it was one record at a time, or a matrix with every
// course across the top. This is the list an auditor reads: the course and the
// document revision it teaches, then one line per person in the departments
// asked for, trained or not.
//
// READ ONLY. The state per person is `cellFor` — the same walk the Compliance
// Matrix and By person read — so this page cannot say "current" where the
// matrix says "missing". A person outside the course's audience who was trained
// anyway is shown as trained; with a department filter, a person in that
// department who has no record is shown as NOT TRAINED rather than left off.
import PDFDocument from 'pdfkit';
import { embedUnicodeFaces } from './pdf-unicode.js';
import { trainingSnapshot, cellFor } from './training-status.js';
import { meaningOf, competenceSignatureState } from './training-records.js';
import { methodLabel } from '../shared/training-record-fields.js';
import { plantDateTime, plantDateOf } from './plant-clock.js';

export const STATE_LABEL = {
  current: 'Trained — current', due_soon: 'Trained — due soon', overdue: 'Overdue', outdated: 'Trained on an older revision',
  missing: 'Not trained', exempt: 'Exempt', trained: 'Trained (not required for this person)',
};

const deptKey = (d) => String(d || '').trim().toLowerCase();
export const departmentLabel = (d) => {
  const k = deptKey(d);
  if (!k) return 'No department';
  if (k === 'qa') return 'QA';
  return k.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
};

function signOff(rec) {
  if (!rec) return null;
  if (rec.competence_signed_at) {
    return { by: rec.competence_signed_by, at: rec.competence_signed_at, meaning: meaningOf(rec),
      intact: competenceSignatureState(rec) === 'signed' };
  }
  if (rec.test_attempt_id || (rec.score != null && rec.passed)) return { by: null, test: true, score: rec.score };
  if (rec.competence_statement) return { by: null, statement: rec.competence_statement };
  return null;
}

/**
 * The roster for one course. `departments` (array of department keys) narrows
 * it to those people — and then lists every one of them, record or not.
 */
export function courseRoster(db, courseId, { departments = [] } = {}) {
  const course = db.prepare('SELECT * FROM training_courses WHERE id = ?').get(courseId);
  if (!course) return null;
  const snap = trainingSnapshot(db, { today: plantDateOf() });
  const wanted = departments.map(deptKey).filter(Boolean);
  const doc = course.sop_id ? snap.docs[course.sop_id] || null : null;
  const recordsById = new Map(snap.records.filter(r => r.course_id === course.id).map(r => [r.id, r]));
  const recordFor = (u) => [...recordsById.values()]
    .filter(r => r.employee_user_id === u.id || (r.employee_name || '').toLowerCase() === u.name.toLowerCase())
    .sort((a, b) => String(b.completion_date || '').localeCompare(String(a.completion_date || '')))[0] || null;

  const rows = [];
  for (const u of snap.users) {
    if (wanted.length && !wanted.includes(deptKey(u.department))) continue;
    const cell = cellFor(u, course, snap);
    const rec = cell?.record_id ? recordsById.get(cell.record_id) : recordFor(u);
    let state = cell?.state || (rec ? 'trained' : null);
    if (!state) {
      if (!wanted.length) continue;   // not asked for, not trained: not this course's business
      state = 'missing';
    }
    rows.push({
      user_id: u.id, name: u.name, department: u.department, department_label: departmentLabel(u.department),
      state, state_label: STATE_LABEL[state] || state,
      record_id: rec?.id || null,
      trained_on: rec?.completion_date || rec?.training_date || null,
      next_due: rec?.next_due_date || null,
      method: rec ? methodLabel(rec.method) : null,
      revision: rec?.sop_revision || null,
      trainer: rec?.trainer || null,
      sign_off: signOff(rec),
      recorded_by: rec?.recorded_by || null,
    });
  }
  const order = (r) => (r.state === 'missing' || r.state === 'overdue' || r.state === 'outdated' ? 1 : 0);
  rows.sort((a, b) => a.department_label.localeCompare(b.department_label) || order(a) - order(b) || a.name.localeCompare(b.name));
  const trained = rows.filter(r => ['current', 'due_soon', 'trained'].includes(r.state)).length;
  return {
    course: { id: course.id, code: course.code, title: course.title, retrain_months: course.retrain_months,
      built_on_revision: course.built_on_revision || null },
    document: doc ? { doc_number: doc.doc_number, title: doc.title, revision: doc.revision } : null,
    departments: wanted,
    rows,
    counts: { people: rows.length, trained, not_trained: rows.length - trained },
    departments_available: [...new Set(snap.users.map(u => deptKey(u.department)).filter(Boolean))].sort()
      .map(k => ({ key: k, label: departmentLabel(k) })),
  };
}

export function renderCourseRosterPdf(res, roster) {
  const doc = new PDFDocument({ size: 'LETTER', layout: 'landscape', margin: 40 });
  embedUnicodeFaces(doc);
  const safe = String(roster.course.code || roster.course.title || 'course').replace(/[^A-Za-z0-9]+/g, '-');
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="training-roster-${safe}.pdf"`);
  doc.pipe(res);
  try {
    const W = doc.page.width - 80;
    doc.fontSize(16).font('Helvetica-Bold').fillColor('#111827').text('Training roster');
    doc.fontSize(9).font('Helvetica').fillColor('#6b7280').text('Powder Ops · ReadyDoc');
    doc.moveDown(0.6);
    doc.fontSize(11).font('Helvetica-Bold').fillColor('#111827')
      .text(`${roster.course.code ? `${roster.course.code} — ` : ''}${roster.course.title}`);
    doc.fontSize(9).font('Helvetica').fillColor('#374151');
    if (roster.document) {
      doc.text(`Document: ${roster.document.doc_number || ''} ${roster.document.title || ''} · revision in force ${roster.document.revision || '—'}`
        + (roster.course.built_on_revision ? ` · course built on ${roster.course.built_on_revision}` : ''));
    }
    doc.text(roster.departments.length
      ? `Departments: ${roster.departments.map(departmentLabel).join(', ')} — everyone in them is listed, trained or not.`
      : 'Everyone the course applies to, and anyone else trained on it.');
    doc.text(`${roster.counts.trained} of ${roster.counts.people} trained.`);
    doc.moveDown(0.6);

    const cols = [
      { h: 'Employee', w: 0.16 }, { h: 'Department', w: 0.10 }, { h: 'Status', w: 0.15 }, { h: 'Date trained', w: 0.09 },
      { h: 'How', w: 0.08 }, { h: 'Revision', w: 0.07 }, { h: 'Signed off', w: 0.35 },
    ];
    const xs = []; let x = 40; for (const c of cols) { xs.push(x); x += c.w * W; }
    const header = () => {
      const y = doc.y;
      doc.fontSize(8).font('Helvetica-Bold').fillColor('#374151');
      cols.forEach((c, i) => doc.text(c.h, xs[i], y, { width: c.w * W - 6 }));
      doc.moveTo(40, doc.y + 2).lineTo(40 + W, doc.y + 2).strokeColor('#d1d5db').stroke();
      doc.y += 5;
    };
    header();
    for (const r of roster.rows) {
      const so = r.sign_off;
      const signed = !so ? '—'
        : so.by ? `${so.by} · ${plantDateTime(so.at)} · ${so.meaning}${so.intact ? '' : ' · CHANGED AFTER SIGNING'}`
        : so.test ? `Passed test${so.score != null ? ` (${so.score}%)` : ''}`
        : 'Recorded before signatures were required';
      const cells = [r.name, r.department_label, r.state_label, r.trained_on || '—', r.method || '—', r.revision || '—', signed];
      doc.fontSize(8).font('Helvetica');
      const h = Math.max(...cells.map((t, i) => doc.heightOfString(String(t), { width: cols[i].w * W - 6 })));
      if (doc.y + h > doc.page.height - 50) { doc.addPage(); header(); }
      const y = doc.y;
      cells.forEach((t, i) => {
        const bad = i === 2 && ['missing', 'overdue', 'outdated'].includes(r.state);
        doc.fillColor(bad ? '#b91c1c' : '#111827').text(String(t), xs[i], y, { width: cols[i].w * W - 6 });
      });
      doc.y = y + h + 4;
    }
    if (!roster.rows.length) doc.fontSize(9).fillColor('#6b7280').text('Nobody to list.', 40);
    doc.moveDown(1).fontSize(7).fillColor('#6b7280')
      .text(`Printed ${plantDateTime(new Date())}. Each line is read from the person's training record in ReadyDoc; open the record for its full sign-off.`, 40, doc.y, { width: W });
  } catch (e) {
    console.warn('[training-roster-pdf]', e.message);
  }
  doc.end();
}
