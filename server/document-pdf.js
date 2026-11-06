// The controlled-document PDF, with its identity on every page (R-0621 / A-20261106-002, D-318).
//
// The signed Word originals repeat the title, document number, revision and
// "page x of y" at the top of every page, and the identifier and CONFIDENTIAL at
// the bottom. The export carried the number, revision and status on page 1 only,
// and on pages 2–13 nothing said which document a loose page came from. A page
// that has fallen out of a binder is exactly the page that needs to say so.
//
// THE CHROME IS DRAWN BY THE RENDERER, NEVER WRITTEN INTO THE BODY. The body is
// the controlled text; adding a footer line to it would change what was approved.
// Pages are buffered, so the header and footer are drawn last, when the page
// count is known.
//
// TWO COPIES, NAMED. `copy: 'approved'` is the document in force (the default,
// unchanged). `copy: 'draft'` is the pending revision — its own text, its own
// revision, stamped DRAFT on every page and never labelled approved. A pending
// revision used to be reachable only by reading it on screen, and the PDF of a
// document with one quietly gave the older revision.

import PDFDocument from 'pdfkit';
import { tableAt, drawTable } from './pdf-table.js';
import { embedUnicodeFaces } from './pdf-unicode.js';
import { plantDateTime, plantDateOf } from './plant-clock.js';
import { sameRevision } from '../shared/document-revision.js';
import { approvalState, draftOf } from './document-revisions.js';

export const TYPE_LABEL = {
  sop: 'SOP', work_instruction: 'Work Instruction', job_description: 'Job Description',
  policy: 'Policy', form: 'Form', reference: 'Reference',
};
export const STATUS_LABEL = {
  draft: 'Draft', under_review: 'In Review', active: 'Approved / Effective',
  superseded: 'Superseded', archived: 'No longer in use',
};
export const CONFIDENTIAL = 'CONFIDENTIAL';
export const DRAFT_LABEL = 'DRAFT — not approved';

/** What a page of this copy is called, in words (also used by the checks). */
export function statusLabel(doc) {
  if (doc.print_copy === 'draft') return DRAFT_LABEL;
  return STATUS_LABEL[doc.status] || doc.status || '—';
}

const shortTitle = (t, max = 56) => {
  const s = String(t || '').replace(/\s+/g, ' ').trim();
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
};

/** The words in the header and footer of one page. PURE, so the check can read them. */
export function pageChrome(doc, page, pages) {
  const number = doc.doc_number || TYPE_LABEL[doc.doc_type] || 'Document';
  const rev = doc.revision ? `Rev ${doc.revision}` : 'Rev —';
  return {
    headerLeft: `${number} · ${rev} · ${shortTitle(doc.title)}`,
    headerRight: `Page ${page} of ${pages}`,
    footerLeft: `${number} · ${rev} · ${statusLabel(doc)}`,
    footerRight: CONFIDENTIAL,
  };
}

/**
 * Which copy to print. `copy` is 'approved' (default) or 'draft'; `revisionId`
 * names the draft explicitly. Returns { doc, approvals, sigs } or { error, status, code }.
 */
export function printableCopy(db, doc, { copy, revisionId } = {}) {
  const want = revisionId ? 'draft' : (copy || 'approved');
  if (!['approved', 'draft'].includes(want)) return { status: 400, code: 'BAD_COPY', error: 'copy must be "approved" or "draft".' };
  if (want === 'approved') {
    const approvals = db.prepare(`SELECT * FROM document_revisions WHERE document_id = ?
      AND status IN ('approved','superseded') AND approved_at IS NOT NULL ORDER BY approved_at`).all(doc.id)
      .filter(r => sameRevision(r.revision, doc.revision));
    const sigs = db.prepare('SELECT * FROM document_signatures WHERE document_id = ? ORDER BY signed_at').all(doc.id);
    return { doc: { ...doc, print_copy: 'approved' }, approvals, sigs };
  }
  const draft = revisionId
    ? db.prepare('SELECT * FROM document_revisions WHERE id = ? AND document_id = ?').get(revisionId, doc.id)
    : draftOf(db, doc.id);
  if (!draft) return { status: 404, code: 'NO_DRAFT', error: 'This document has no pending revision to print.' };
  if (draft.status !== 'draft') return { status: 400, code: 'NOT_A_DRAFT', error: `Revision ${draft.revision} is not a pending draft; print the approved copy instead.` };
  return {
    doc: {
      ...doc,
      print_copy: 'draft',
      draft_revision_id: draft.id,
      in_force_revision: doc.revision,
      title: draft.title || doc.title,
      description: draft.description ?? doc.description,
      revision: draft.revision,
      doc_number: draft.doc_number || doc.doc_number,
      effective_date: draft.effective_date || null,
      approved_by: null, approved_at: null,
    },
    // A draft has no approval, and the in-force revision's signatures are not its.
    approvals: [], sigs: [],
  };
}

// ── Table-of-contents page numbers ──────────────────────────────────────────
// A body converted from Word keeps its contents list with the page numbers the
// Word layout had ("Purpose ........ 3"). This export paginates differently, so
// those numbers point at the wrong page. At PRINT time only — the stored body is
// untouched — a contents entry loses its trailing page number, and a contents
// table loses its Page column. Nothing else in the body is read this way.

const TOC_TITLE = /^#{0,6}\s*\**\s*(table\s+of\s+contents|contents)\s*\**\s*:?\s*$/i;
const LEADER = /^(.*?\S)\s*(?:[.·…_]{3,}|\.\s(?:\.\s){2,})\s*\d{1,3}\s*$/;   // "Purpose ...... 3"
const TRAILING = /^(.*?\S)(?:\t+|\s{2,}|\s+)\d{1,3}\s*$/;                       // "1.0 Purpose    3" / "1.0 Purpose 3"
const PAGE_HEAD = /^(page|pg\.?|page\s*#|page\s*no\.?)$/i;

export function softenTocPageNumbers(text) {
  if (!text) return { text, softened: 0 };
  const lines = String(text).split('\n');
  let softened = 0;
  let inToc = false;
  let tableDropCol = null;      // within a TOC table: index of the Page column, or -1 = none
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const t = raw.trim();
    if (TOC_TITLE.test(t)) { inToc = true; tableDropCol = null; continue; }
    // A dot-leader entry is a contents line wherever it sits.
    const lead = t.match(LEADER);
    if (lead && !t.startsWith('|')) { lines[i] = raw.replace(t, lead[1].replace(/[\s.·…_]+$/, '')); softened++; continue; }
    if (!inToc) continue;
    if (!t) continue;
    if (t.startsWith('|')) {
      const cells = t.replace(/^\||\|$/g, '').split('|');
      if (tableDropCol === null) {
        const idx = cells.findIndex(c => PAGE_HEAD.test(c.trim()));
        tableDropCol = idx;
      }
      if (tableDropCol >= 0 && cells.length > tableDropCol) {
        cells.splice(tableDropCol, 1);
        lines[i] = `|${cells.join('|')}|`;
        if (!/^[\s:|-]+$/.test(t)) softened++;
      }
      continue;
    }
    tableDropCol = null;
    const m = t.match(TRAILING);
    // A line ending in a page number is an entry; anything else ends the contents.
    if (m && !/^#/.test(t)) { lines[i] = raw.replace(t, m[1]); softened++; continue; }
    inToc = false;
  }
  // The header row counted as a "softened" line only when it lost a column; keep the number honest.
  return { text: lines.join('\n'), softened };
}

/**
 * Render one or more documents. `items` is [{ doc, approvals, sigs }] from
 * printableCopy. Pipes into `res` and ends it.
 */
export function renderDocumentsPdf(res, items, { now = new Date() } = {}) {
  const LEFT = 72;
  const RIGHT = 540;
  const BODY_W = RIGHT - LEFT;
  const BULLET_LEFT = LEFT + 18;
  const BULLET_W = RIGHT - BULLET_LEFT;
  const PAGE_BOTTOM = 712;

  const pdf = new PDFDocument({ size: 'LETTER', bufferPages: true, margins: { top: 72, bottom: 80, left: LEFT, right: 72 } });
  embedUnicodeFaces(pdf); // embedded Unicode faces, so ≤, µ and accented text print (D-235)
  const first = items[0].doc;
  const typeLabel = TYPE_LABEL[first.doc_type] || 'Document';
  const name = items.length === 1
    ? `${first.doc_number || typeLabel} - ${first.title}${first.print_copy === 'draft' ? ` - DRAFT ${first.revision}` : ''}`
    : `${typeLabel}_${items.length}_docs`;
  const safeName = (name || 'document').replace(/[^a-zA-Z0-9_-]/g, '_');
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${safeName}.pdf"`);
  res.setHeader('X-Document-Copy', items.length === 1 ? first.print_copy : 'approved');
  pdf.pipe(res);

  const ensureSpace = (needed) => { if (pdf.y > PAGE_BOTTOM - needed) pdf.addPage(); };
  const starts = [];
  const generated = `Generated ${plantDateOf(now)} — Powder Ops FSQA · uncontrolled when printed; verify the revision against the registry`;

  items.forEach(({ doc, approvals = [], sigs = [] }, idx) => {
    if (idx > 0) pdf.addPage();
    starts.push(pdf.bufferedPageRange().start + pdf.bufferedPageRange().count - 1);
    const isDraft = doc.print_copy === 'draft';

    pdf.save();
    pdf.rect(LEFT, 54, BODY_W, 36).fill(isDraft ? '#92400e' : '#1e40af');
    pdf.fillColor('#ffffff').fontSize(16).font('Helvetica-Bold').text(doc.title, LEFT + 12, 63, { width: BODY_W - 24, height: 22, ellipsis: true });
    pdf.restore();

    pdf.y = 104;
    pdf.x = LEFT;
    pdf.fontSize(9);
    const meta = [
      ['Type', TYPE_LABEL[doc.doc_type] || 'Document'],
      ['Document #', doc.doc_number || '—'],
      ['Category', (doc.category || '').charAt(0).toUpperCase() + (doc.category || '').slice(1)],
      ['Revision', doc.revision || '—'],
      ['Status', statusLabel(doc)],
      ...(isDraft ? [['Revision in force', doc.in_force_revision || 'none — never approved']] : []),
      ['Owner', doc.owner || '—'],
      ['Approved By', isDraft ? 'not approved' : (doc.approved_by || '—')],
      ['Approved At', isDraft ? 'not approved' : (doc.approved_at ? plantDateTime(doc.approved_at) : 'not recorded')],
      ['Effective Date', doc.effective_date || '—'],
      ['Review Due', isDraft ? '—' : (doc.review_due || '—')],
    ];
    for (const [label, value] of meta) {
      pdf.font('Helvetica-Bold').fillColor(label === 'Status' && isDraft ? '#b45309' : '#374151').text(label + ':  ', LEFT, pdf.y, { continued: true });
      pdf.font('Helvetica').text(value);
    }

    // A withdrawn document never prints looking current (the AuditorView rule).
    if (!isDraft && doc.status === 'archived') {
      pdf.y += 8;
      const note = `NO LONGER IN USE${doc.archived_at ? ` — withdrawn ${doc.archived_at}` : ''}${doc.archived_by ? ` by ${doc.archived_by}` : ''}.`
        + `${doc.archive_reason ? ` ${doc.archive_reason}` : ''} Do not work to this document; check the registry for the current one.`;
      pdf.fillColor('#b91c1c').font('Helvetica-Bold').fontSize(9).text(note, LEFT, pdf.y, { width: BODY_W });
    }

    pdf.y += 10;
    pdf.moveTo(LEFT, pdf.y).lineTo(RIGHT, pdf.y).strokeColor('#d1d5db').stroke();
    pdf.y += 16;

    const { text: body, softened } = softenTocPageNumbers(doc.description);
    if (body) {
      pdf.fillColor('#111827').fontSize(10).font('Helvetica');
      const bodyLines = body.split('\n');
      let tocNoted = false;
      for (let li = 0; li < bodyLines.length; li++) {
        const raw = bodyLines[li];
        const trimmed = raw.trim();
        if (!trimmed) { pdf.y += 6; continue; }
        const table = tableAt(bodyLines, li);
        if (table) {
          pdf.y += 4;
          drawTable(pdf, table, { left: LEFT, width: BODY_W, pageBottom: PAGE_BOTTOM });
          li = table.next - 1;
          continue;
        }
        ensureSpace(30);
        const clean = (s) => s.replace(/\*\*(.+?)\*\*/g, '$1').replace(/(?<!\*)\*(?!\*)(.+?)\*/g, '$1');
        if (/^#{1,6}\s+/.test(trimmed)) {
          const level = trimmed.startsWith('# ') ? 1 : 2;
          const text = trimmed.replace(/^#{1,6}\s+/, '');
          pdf.y += 4;
          pdf.font('Helvetica-Bold').fontSize(level === 1 ? 12 : 11).text(clean(text), LEFT, pdf.y, { width: BODY_W, lineGap: 2 });
          pdf.font('Helvetica').fontSize(10);
        } else if (/^[-*•]\s+/.test(trimmed)) {
          pdf.text('•  ' + clean(trimmed.replace(/^[-*•]\s+/, '')), BULLET_LEFT, pdf.y, { width: BULLET_W, lineGap: 2 });
        } else if (/^\d+\.\s+/.test(trimmed)) {
          pdf.text(clean(trimmed), BULLET_LEFT, pdf.y, { width: BULLET_W, lineGap: 2 });
        } else {
          pdf.text(clean(trimmed), LEFT, pdf.y, { width: BODY_W, lineGap: 2 });
        }
        if (softened && !tocNoted && TOC_TITLE.test(trimmed)) {
          tocNoted = true;
          pdf.fillColor('#6b7280').fontSize(8).font('Helvetica-Oblique')
            .text('Page numbers from the original layout are omitted; use the section headings.', LEFT, pdf.y, { width: BODY_W });
          pdf.fillColor('#111827').fontSize(10).font('Helvetica');
        }
      }
    } else {
      pdf.fillColor('#9ca3af').fontSize(10).font('Helvetica-Oblique').text('No content yet.', LEFT, pdf.y, { width: BODY_W });
    }

    // Signatures (D-282). Every approval of this revision, printed as name ·
    // date and time (plant time) · meaning · whether the fingerprint still
    // matches. A draft has none, and says so rather than printing nothing.
    if (isDraft) {
      ensureSpace(50);
      pdf.moveDown(1.5);
      pdf.fillColor('#b45309').fontSize(10).font('Helvetica-Bold')
        .text(`Not approved. This is pending revision ${doc.revision}; the revision in force is ${doc.in_force_revision || 'none'}.`, LEFT, pdf.y, { width: BODY_W });
    } else if (approvals.length || sigs.length) {
      ensureSpace(60 + (approvals.length + sigs.length) * 30);
      pdf.moveDown(1.5);
      pdf.fillColor('#111827').fontSize(11).font('Helvetica-Bold').text('Signatures', LEFT, pdf.y, { width: BODY_W });
      pdf.moveDown(0.4);
      for (const a of approvals) {
        ensureSpace(32);
        const state = approvalState(a);
        const seal = state === 'signed' ? 'Electronically signed (password) · fingerprint matches this revision'
          : state === 'changed' ? 'WARNING: this revision changed after it was signed'
          : 'Signed before fingerprints were recorded';
        pdf.fillColor('#111827').fontSize(10).font('Helvetica-Bold').text(`${a.approved_by || '—'} — ${a.approved_meaning || 'Approved'} (rev ${a.revision})`, LEFT, pdf.y, { width: BODY_W });
        pdf.fillColor('#4b5563').fontSize(9).font('Helvetica').text(`${plantDateTime(a.approved_at)} · ${seal}`, LEFT, pdf.y, { width: BODY_W });
        pdf.moveDown(0.5);
      }
      for (const s of sigs) {
        ensureSpace(30);
        pdf.fillColor('#6b7280').fontSize(9).font('Helvetica')
          .text(`${s.name} · ${s.capacity} · ${plantDateTime(s.signed_at)} · drawn signature recorded before D-282 (history)`, LEFT, pdf.y, { width: BODY_W });
        pdf.moveDown(0.3);
      }
    }
  });

  // The identity on every page, drawn now that the page count is known.
  const range = pdf.bufferedPageRange();
  const end = range.start + range.count;
  for (let p = range.start; p < end; p++) {
    let k = 0;
    while (k + 1 < starts.length && starts[k + 1] <= p) k++;
    const doc = items[k].doc;
    const docEnd = k + 1 < starts.length ? starts[k + 1] : end;
    const chrome = pageChrome(doc, p - starts[k] + 1, docEnd - starts[k]);
    pdf.switchToPage(p);
    pdf.save();
    pdf.page.margins.bottom = 0;
    pdf.page.margins.top = 0;
    pdf.fontSize(8).font('Helvetica').fillColor('#374151')
      .text(chrome.headerLeft, LEFT, 30, { width: BODY_W - 80, lineBreak: false, ellipsis: true });
    pdf.font('Helvetica-Bold').text(chrome.headerRight, RIGHT - 80, 30, { width: 80, align: 'right', lineBreak: false });
    pdf.moveTo(LEFT, 43).lineTo(RIGHT, 43).lineWidth(0.5).strokeColor('#9ca3af').stroke();
    pdf.moveTo(LEFT, 738).lineTo(RIGHT, 738).lineWidth(0.5).strokeColor('#9ca3af').stroke();
    pdf.font('Helvetica').fontSize(8).fillColor(doc.print_copy === 'draft' ? '#b45309' : '#374151')
      .text(chrome.footerLeft, LEFT, 744, { width: BODY_W - 90, lineBreak: false, ellipsis: true });
    pdf.font('Helvetica-Bold').fillColor('#b91c1c').text(chrome.footerRight, RIGHT - 90, 744, { width: 90, align: 'right', lineBreak: false });
    pdf.font('Helvetica').fontSize(6.5).fillColor('#9ca3af').text(generated, LEFT, 758, { width: BODY_W, align: 'center', lineBreak: false });
    if (doc.print_copy === 'draft') {
      pdf.fillColor('#f59e0b').opacity(0.12).font('Helvetica-Bold').fontSize(96)
        .rotate(-35, { origin: [306, 396] }).text('DRAFT', 110, 350, { width: 400, align: 'center', lineBreak: false });
      pdf.opacity(1);
    }
    pdf.restore();
  }

  pdf.end();
}
