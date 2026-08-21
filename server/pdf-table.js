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

const SEP = /^\s*\|?[\s:|-]*-[\s:|-]*\|?\s*$/;

const splitRow = (row) => row.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim().replace(/\\\|/g, '|'));

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
 * the whole page.
 */
function columnWidths(table, total, cols) {
  const longest = Array(cols).fill(1);
  for (const row of [table.header, ...table.rows]) {
    row.forEach((c, i) => { longest[i] = Math.max(longest[i], String(c || '').length); });
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
 */
export function drawTable(pdf, table, opts = {}) {
  const left = opts.left ?? pdf.page.margins.left;
  const total = opts.width ?? (pdf.page.width - pdf.page.margins.left - pdf.page.margins.right);
  const pageBottom = opts.pageBottom ?? (pdf.page.height - pdf.page.margins.bottom);
  const fontSize = opts.fontSize ?? 8.5;
  const padX = 4, padY = 3;
  const cols = table.header.length;
  const widths = columnWidths(table, total, cols);

  // MEASURE WITH THE OPTIONS YOU DRAW WITH.
  //
  // heightOfString was called without the lineGap that text() was given, so
  // every line of a cell was measured one point short. On a short cell nobody
  // notices; on a twenty-line preventive-control justification the row box came
  // out twenty points too small and the text ran on into the row beneath it.
  // One options object now serves both, so they cannot drift again.
  const cellOpts = (i) => ({ width: widths[i] - padX * 2, lineGap: 1 });

  const rowHeight = (cells, bold) => {
    pdf.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(fontSize);
    let h = 0;
    cells.forEach((c, i) => {
      const ch = pdf.heightOfString(String(c || ''), cellOpts(i));
      if (ch > h) h = ch;
    });
    // A point of slack. Rounding between measuring and drawing is the whole
    // reason this bug existed, and a hair of extra white space costs nothing
    // next to two rows printed on top of each other.
    return Math.max(14, Math.ceil(h) + padY * 2 + 1);
  };

  const drawRow = (cells, y, bold, fill) => {
    const h = rowHeight(cells, bold);
    let x = left;
    cells.forEach((c, i) => {
      if (fill) pdf.save().rect(x, y, widths[i], h).fill(fill).restore();
      pdf.save().rect(x, y, widths[i], h).lineWidth(0.5).strokeColor('#9ca3af').stroke().restore();
      pdf.fillColor('#111827').font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(fontSize)
        // Deliberately NOT clipped to the box. If a measurement is ever wrong
        // again, a point of overlap is a blemish — a truncated preventive
        // control is a hazard analysis missing its control, which is the kind
        // of quiet loss this codebase exists to avoid.
        .text(String(c || ''), x + padX, y + padY, cellOpts(i));
      x += widths[i];
    });
    return h;
  };

  // The boxes actually drawn, so a test can check that no two overlap rather
  // than reading the rendered page and guessing.
  const boxes = [];
  const place = (cells, y, bold, fill) => {
    const h = drawRow(cells, y, bold, fill);
    boxes.push({ page: pdf.bufferedPageRange ? pdf.bufferedPageRange().count : 0, y, h, cells });
    return h;
  };

  let y = pdf.y;
  const headerH = rowHeight(table.header, true);
  // A header alone at the foot of a page is worse than a page break before it.
  if (y + headerH + 20 > pageBottom) { pdf.addPage(); y = pdf.y; }
  y += place(table.header, y, true, '#f3f4f6');

  for (const row of table.rows) {
    const h = rowHeight(row, false);
    if (y + h > pageBottom) {
      pdf.addPage();
      y = pdf.y;
      y += place(table.header, y, true, '#f3f4f6');
    }
    y += place(row, y, false, null);
  }

  pdf.x = left;
  pdf.y = y + 8;
  pdf.font('Helvetica').fillColor('#111827');
  return { boxes, widths, bottom: y };
}
