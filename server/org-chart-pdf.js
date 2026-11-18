// The Org Chart as a PDF: page 1 is the chart, drawn as boxes and lines on one
// landscape page; the pages after are the same positions as a list, because a
// big chart scaled to one page is a picture and the list is what gets read.
//
// READS what GET /api/org reads (`orgChartData`), so the PDF and the screen
// cannot disagree about who holds a position. Writes nothing.
import PDFDocument from 'pdfkit';
import { embedUnicodeFaces, printable } from './pdf-unicode.js';
import { plantDateTime } from './plant-clock.js';

const BOX_W = 150, BOX_H = 54, GAP_X = 14, GAP_Y = 34;
const DEPT_FILL = {
  admin: '#e0e7ff', office: '#e0e7ff', hr: '#e0e7ff', quality: '#dcfce7', qa: '#dcfce7', document_control: '#dcfce7',
  maintenance: '#ffedd5', warehouse: '#fef3c7', batching: '#fce7f3', filling: '#e0f2fe', kitting: '#f3e8ff', cleaning: '#ccfbf1',
};

/** The tree: roots and children, ordered as the screen orders them. */
export function buildTree(positions) {
  const byId = new Map(positions.map(p => [p.id, { ...p, children: [] }]));
  const roots = [];
  for (const p of byId.values()) {
    const parent = p.parent_id ? byId.get(p.parent_id) : null;
    if (parent && parent !== p) parent.children.push(p); else roots.push(p);
  }
  const order = (a, b) => (a.sort_order || 0) - (b.sort_order || 0) || String(a.title).localeCompare(String(b.title));
  const sortAll = (list) => { list.sort(order); list.forEach(n => sortAll(n.children)); };
  sortAll(roots);
  return roots;
}

/**
 * A tidy layout. A parent sits centred over its children. Children with no
 * reports of their own are STACKED in one column under the parent (with a
 * spine down their left side), the way people draw a manager's direct staff —
 * laid side by side, 23 positions became 15 columns and every box was tiny.
 * `x` is a column, `y` a row; a stacked box sits a fraction of a row lower.
 */
export const STACK_STEP = (BOX_H + 8) / (BOX_H + GAP_Y);
export function layout(roots) {
  let col = 0, depth = 0;
  const place = (n, d) => {
    if (!n.children.length) { n.x = col++; n.y = d; depth = Math.max(depth, d); return; }
    const leaves = n.children.filter(c => !c.children.length);
    const branches = n.children.filter(c => c.children.length);
    const cols = [];
    if (leaves.length) {
      const c = col++;
      leaves.forEach((l, i) => { l.x = c; l.y = d + 1 + i * STACK_STEP; l.stacked = true; depth = Math.max(depth, l.y); });
      cols.push(c);
    }
    branches.forEach(b => { place(b, d + 1); cols.push(b.x); });
    n.stackCol = leaves.length ? cols[0] : null;
    n.x = (Math.min(...cols) + Math.max(...cols)) / 2;
    n.y = d;
  };
  roots.forEach(r => place(r, 0));
  return { cols: Math.max(col, 1), rows: depth + 1 };
}

const fit = (doc, text, width, size) => {
  let s = String(text || '');
  doc.fontSize(size);
  while (s.length > 1 && doc.widthOfString(s) > width) s = s.slice(0, -2) + '…';
  return s;
};

export function renderOrgChartPdf(res, { positions, meta, printedBy }) {
  const m = 36;
  const roots = buildTree(positions);
  const { cols, rows } = layout(roots);
  const fullW = cols * BOX_W + (cols - 1) * GAP_X;
  const fullH = rows * BOX_H + (rows - 1) * GAP_Y;
  // Letter landscape unless the chart would shrink below three-quarters size;
  // then the chart page is tabloid (prints scaled to letter just as well).
  const letterK = Math.min(1, (792 - 2 * m) / fullW, (612 - 2 * m - 58) / fullH);
  const chartSize = letterK >= 0.75 ? 'LETTER' : 'TABLOID';
  const doc = new PDFDocument({ size: chartSize, layout: 'landscape', margin: m, bufferPages: true });
  embedUnicodeFaces(doc);
  doc.pipe(res);
  const pageW = doc.page.width, pageH = doc.page.height;

  const header = () => {
    doc.font('Helvetica-Bold').fontSize(15).fillColor('#111827').text('Powder Ops · Organization Chart', m, m);
    const facts = [meta?.version && `Version ${meta.version}`, meta?.approved_by && `Approved by ${meta.approved_by}`,
      meta?.effective_date && `Effective ${meta.effective_date}`].filter(Boolean).join(' · ') || 'No version recorded';
    doc.font('Helvetica').fontSize(9).fillColor('#4b5563').text(printable(facts), m, m + 19);
  };
  header();

  const top = m + 44, availW = pageW - 2 * m, availH = pageH - top - m - 14;
  if (!roots.length) {
    doc.font('Helvetica').fontSize(11).fillColor('#6b7280').text('No positions on the chart yet.', m, top);
  } else {
    const k = Math.min(1, availW / fullW, availH / fullH);
    const ox = m + (availW - fullW * k) / 2, oy = top;
    const at = (n) => ({ x: ox + n.x * (BOX_W + GAP_X) * k, y: oy + n.y * (BOX_H + GAP_Y) * k });
    const w = BOX_W * k, h = BOX_H * k;
    // Lines first, so the boxes sit on top of them.
    const lines = (n) => {
      if (n.children.length) {
        const p = at(n), midY = p.y + h + (GAP_Y * k) / 2;
        doc.lineWidth(0.6).strokeColor('#9ca3af');
        doc.moveTo(p.x + w / 2, p.y + h).lineTo(p.x + w / 2, midY).stroke();
        const spine = (c) => ox + c * (BOX_W + GAP_X) * k - (GAP_X * k) / 2;   // just left of a stacked column
        const xs = n.children.map(c => (c.stacked ? spine(c.x) : at(c).x + w / 2));
        doc.moveTo(Math.min(...xs, p.x + w / 2), midY).lineTo(Math.max(...xs, p.x + w / 2), midY).stroke();
        const stacked = n.children.filter(c => c.stacked);
        if (stacked.length) {
          const sx = spine(stacked[0].x), last = at(stacked[stacked.length - 1]);
          doc.moveTo(sx, midY).lineTo(sx, last.y + h / 2).stroke();
          for (const c of stacked) { const q = at(c); doc.moveTo(sx, q.y + h / 2).lineTo(q.x, q.y + h / 2).stroke(); }
        }
        for (const c of n.children) {
          if (!c.stacked) { const q = at(c); doc.moveTo(q.x + w / 2, midY).lineTo(q.x + w / 2, q.y).stroke(); }
          lines(c);
        }
      }
    };
    roots.forEach(lines);
    const box = (n) => {
      const p = at(n);
      const vacant = !n.name;
      doc.lineWidth(0.8).roundedRect(p.x, p.y, w, h, 4 * k)
        .fillAndStroke(vacant ? '#f9fafb' : (DEPT_FILL[n.department] || '#f3f4f6'), n.person_active === false ? '#dc2626' : '#6b7280');
      const pad = 5 * k, inner = w - 2 * pad;
      doc.fillColor('#111827').font('Helvetica-Bold');
      doc.text(fit(doc, printable(n.title), inner, 8.5 * k), p.x + pad, p.y + pad, { width: inner, lineBreak: false });
      doc.font('Helvetica').fillColor(vacant ? '#9ca3af' : '#1f2937');
      doc.text(fit(doc, printable(vacant ? 'Vacant' : n.name), inner, 8 * k), p.x + pad, p.y + pad + 12 * k, { width: inner, lineBreak: false });
      if (n.backup) {
        doc.fillColor('#6b7280');
        doc.text(fit(doc, printable(`Backup: ${n.backup}`), inner, 6.8 * k), p.x + pad, p.y + pad + 24 * k, { width: inner, lineBreak: false });
      }
      if (n.person_active === false) {
        doc.fillColor('#dc2626');
        doc.text(fit(doc, 'Holder has left', inner, 6.5 * k), p.x + pad, p.y + h - pad - 8 * k, { width: inner, lineBreak: false });
      }
      n.children.forEach(box);
    };
    roots.forEach(box);
    if (k < 0.75) {
      doc.font('Helvetica').fontSize(8).fillColor('#6b7280')
        .text('The chart is scaled to fit one page; every position is listed by name on the next page.', m, pageH - m - 10, { width: availW });
    }
  }

  // The list: every position, under its manager, indented.
  doc.addPage({ size: 'LETTER', layout: 'landscape', margin: m });
  const listW = doc.page.width, listH = doc.page.height;
  header();
  let y = m + 44;
  const listCols = [['Position', 0, 260], ['Person', 260, 170], ['Backup', 430, 150], ['Department', 580, 140]];
  const head = () => {
    doc.font('Helvetica-Bold').fontSize(9).fillColor('#374151');
    listCols.forEach(([t, x, wd]) => doc.text(t, m + x, y, { width: wd }));
    y += 14;
    doc.moveTo(m, y - 3).lineTo(listW - m, y - 3).lineWidth(0.5).strokeColor('#d1d5db').stroke();
  };
  head();
  const row = (n, d) => {
    if (y > listH - m - 24) { doc.addPage({ size: 'LETTER', layout: 'landscape', margin: m }); header(); y = m + 44; head(); }
    doc.font(d === 0 ? 'Helvetica-Bold' : 'Helvetica').fontSize(9).fillColor('#111827');
    doc.text(printable(n.title), m + d * 12, y, { width: 260 - d * 12, lineBreak: false, ellipsis: true });
    doc.font('Helvetica').fillColor(n.name ? '#111827' : '#9ca3af')
      .text(printable(n.name || 'Vacant') + (n.person_active === false ? ' (left)' : ''), m + 260, y, { width: 170, lineBreak: false, ellipsis: true });
    doc.fillColor('#4b5563').text(printable(n.backup || ''), m + 430, y, { width: 150, lineBreak: false, ellipsis: true });
    doc.text(printable(String(n.department || '').replace(/_/g, ' ')), m + 580, y, { width: 140, lineBreak: false, ellipsis: true });
    y += 14;
    n.children.forEach(c => row(c, d + 1));
  };
  roots.forEach(r => row(r, 0));
  doc.font('Helvetica').fontSize(8).fillColor('#6b7280')
    .text(`${positions.length} position${positions.length === 1 ? '' : 's'}`, m, y + 6);

  const range = doc.bufferedPageRange();
  const stamp = `Printed ${plantDateTime(new Date().toISOString())}${printedBy ? ` by ${printedBy}` : ''} · uncontrolled when printed`;
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    // Writing below the bottom margin makes pdfkit start a new page; the footer
    // lives in the margin, so the margin is lifted while it is written.
    const bottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    const pH = doc.page.height, pW = doc.page.width;
    doc.font('Helvetica').fontSize(7.5).fillColor('#9ca3af')
      .text(printable(`${stamp} · Page ${i - range.start + 1} of ${range.count}`), m, pH - m + 8, { width: pW - 2 * m, align: 'right', lineBreak: false });
    doc.page.margins.bottom = bottom;
  }
  doc.end();
}
