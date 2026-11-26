// Draw a Markdown table in a pdfkit document.
//
// The controlled-document PDF export understood headings, bullets and numbered
// lists, and nothing else — so a `| Process Step | Vulnerability |` line fell
// through to plain text and the Food Defense Plan downloaded as a page of pipe
// characters. An SOP is mostly tables; a registry that cannot print one is not
// somewhere Document Control will keep its documents.
//
// Widths are proportional to what each column actually holds, so a Notes column
// gets the room and a Date column does not. A row that would cross the page
// break moves whole and the header is redrawn, because a table continuing onto
// a second page with no header is a table nobody can read.

import { spanLayout } from '../shared/table-spans.js';
import { splitTableRow, plainInline, isWholeBold } from '../shared/markdown-text.js';

const SEP = /^\s*\|?[\s:|-]*-[\s:|-]*\|?\s*$/;

const splitRow = splitTableRow;

/** Is a table starting at `lines[i]`? */
export function tableAt(lines, i) {
  const t = (lines[i] || '').trim();
  if (!t.startsWith('|')) return null;
  const next = lines[i + 1];
  if (next === undefined || !SEP.test(next) || !next.includes('-')) return null;

  const header = splitRow(t);
  let j = i + 2;
  const rows = [];
  while (j < lines.length && (lines[j] || '').trim().startsWith('|')) { rows.push(splitRow(lines[j])); j++; }
  const cols = Math.max(header.length, ...rows.map(r => r.length), 1);
  const pad = (r) => { const a = r.slice(0, cols); while (a.length < cols) a.push(''); return a; };
  return { header: pad(header), rows: rows.map(pad), next: j };
}

/**
 * Column widths proportional to the longest cell in each column, with a floor
 * so a narrow column stays readable and a ceiling so one long cell cannot take
 * the whole page. A merged cell (D-402) is left out: a section heading across
 * the whole table would otherwise make its first column the widest.
 */
function columnWidths(layout, total, cols) {
  const longest = Array(cols).fill(1);
  for (const row of [layout.header, ...layout.rows]) {
    for (const cell of row) {
      if (cell.colspan === 1) longest[cell.c] = Math.max(longest[cell.c], String(cell.text || '').length);
    }
  }
  const capped = longest.map(n => Math.min(n, 40));
  const sum = capped.reduce((a, b) => a + b, 0) || 1;
  // The floor is generous on purpose. Too tight and a short column breaks a
  // word across two lines — "Packagin / g" — which reads as a broken document
  // rather than a narrow column. An even share is the ceiling on the floor, so
  // a wide table with many columns still fits.
  const min = Math.min(70, total / cols);
  let widths = capped.map(n => Math.max(min, (n / sum) * total));
  const over = widths.reduce((a, b) => a + b, 0) / total;
  if (over > 1) widths = widths.map(w => w / over);
  return widths;
}

/**
 * Draw the table at pdf.y and leave pdf.y below it.
 *
 * `opts.pageBottom` is where a page has to break; the caller owns the margins,
 * so it is passed in rather than guessed at here.
 *
 * Merged cells (D-402) come from `spanLayout`, the same reading the screen
 * uses. Rows joined by a row span move to the next page together, so a merged
 * cell is never cut in half by a page break.
 */
export function drawTable(pdf, table, opts = {}) {
  const left = opts.left ?? pdf.page.margins.left;
  const total = opts.width ?? (pdf.page.width - pdf.page.margins.left - pdf.page.margins.right);
  const pageBottom = opts.pageBottom ?? (pdf.page.height - pdf.page.margins.bottom);
  const fontSize = opts.fontSize ?? 8.5;
  const padX = 4, padY = 3;
  const layout = spanLayout(table);
  const cols = layout.cols;
  const widths = columnWidths(layout, total, cols);
  const xAt = (c) => left + widths.slice(0, c).reduce((a, b) => a + b, 0);
  const wOf = (cell) => widths.slice(cell.c, cell.c + cell.colspan).reduce((a, b) => a + b, 0);

  // MEASURE WITH THE OPTIONS YOU DRAW WITH.
  //
  // heightOfString was called without the lineGap that text() was given, so
  // every line of a cell was measured one point short. On a short cell nobody
  // notices; on a twenty-line preventive-control justification the row box came
  // out twenty points too small and the text ran on into the row beneath it.
  // One options object now serves both, so they cannot drift again.
  const cellOpts = (cell) => ({ width: wOf(cell) - padX * 2, lineGap: 1 });

  // What a cell prints: its words without Markdown markers or stray backslashes
  // (D-403), and in bold when the whole cell is one **bold** run.
  const shown = (cell) => plainInline(cell.text || '');
  const boldOf = (cell, bold) => bold || isWholeBold(cell.text);

  const measure = (cell, bold) => {
    pdf.font(boldOf(cell, bold) ? 'Helvetica-Bold' : 'Helvetica').fontSize(fontSize);
    // A point of slack. Rounding between measuring and drawing is the whole
    // reason this bug existed, and a hair of extra white space costs nothing
    // next to two rows printed on top of each other.
    return Math.ceil(pdf.heightOfString(shown(cell), cellOpts(cell))) + padY * 2 + 1;
  };

  const drawCell = (cell, y, h, bold, fill) => {
    const x = xAt(cell.c), w = wOf(cell);
    if (fill) pdf.save().rect(x, y, w, h).fill(fill).restore();
    pdf.save().rect(x, y, w, h).lineWidth(0.5).strokeColor('#9ca3af').stroke().restore();
    pdf.fillColor('#111827').font(boldOf(cell, bold) ? 'Helvetica-Bold' : 'Helvetica').fontSize(fontSize)
      // Deliberately NOT clipped to the box. If a measurement is ever wrong
      // again, a point of overlap is a blemish — a truncated preventive
      // control is a hazard analysis missing its control, which is the kind
      // of quiet loss this codebase exists to avoid.
      .text(shown(cell), x + padX, y + padY, cellOpts(cell));
  };

  // The boxes actually drawn, so a test can check that no two overlap rather
  // than reading the rendered page and guessing.
  const boxes = [];
  const pageNo = () => (pdf.bufferedPageRange ? pdf.bufferedPageRange().count : 0);

  const headerH = Math.max(14, ...layout.header.map(cell => measure(cell, true)));
  const drawHeader = (y) => {
    layout.header.forEach(cell => drawCell(cell, y, headerH, true, '#f3f4f6'));
    boxes.push({ page: pageNo(), y, h: headerH, cells: layout.header.map(cell => cell.text) });
    return headerH;
  };

  // Row heights: the tallest unmerged-down cell in the row, then a row span
  // that needs more room than its rows give takes it from its last row.
  const n = layout.rows.length;
  const rowH = layout.rows.map(cells => Math.max(14, ...cells.filter(cell => cell.rowspan === 1).map(cell => measure(cell, false))));
  layout.rows.forEach((cells, r) => cells.forEach(cell => {
    if (cell.rowspan < 2) return;
    const have = rowH.slice(r, r + cell.rowspan).reduce((a, b) => a + b, 0);
    const need = measure(cell, false);
    if (need > have) rowH[r + cell.rowspan - 1] += need - have;
  }));

  let y = pdf.y;
  // A header alone at the foot of a page is worse than a page break before it.
  if (y + headerH + 20 > pageBottom) { pdf.addPage(); y = pdf.y; }
  y += drawHeader(y);

  for (let r = 0; r < n;) {
    // The rows a row span ties together, drawn as one unit.
    let end = r;
    for (let k = r; k <= end; k++) for (const cell of layout.rows[k]) end = Math.max(end, k + cell.rowspan - 1);
    const blockH = rowH.slice(r, end + 1).reduce((a, b) => a + b, 0);
    if (y + blockH > pageBottom) {
      pdf.addPage();
      y = pdf.y;
      y += drawHeader(y);
    }
    let ry = y;
    for (let k = r; k <= end; k++) {
      for (const cell of layout.rows[k]) {
        const h = rowH.slice(k, k + cell.rowspan).reduce((a, b) => a + b, 0);
        drawCell(cell, ry, h, false, null);
      }
      boxes.push({ page: pageNo(), y: ry, h: rowH[k], cells: layout.rows[k].map(cell => cell.text) });
      ry += rowH[k];
    }
    y = ry;
    r = end + 1;
  }

  pdf.x = left;
  pdf.y = y + 8;
  pdf.font('Helvetica').fillColor('#111827');
  return { boxes, widths, bottom: y };
}
