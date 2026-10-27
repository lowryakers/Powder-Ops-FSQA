// Reading a lab report PDF by WHERE each piece of text sits on the page (D-221).
//
// The old reader joined every text item on a line into one string. A table cell
// has no separator of its own, so two cells side by side became one word:
// CTLA prints `Gluten Allergen | ELISA | 4 | Report | <4 | ppm` (MDL 4, result
// <4) and the joined line read `… <44 ppm`. Twenty-two gluten results were
// stored as "<44" that way. The same seam turned Alkify's soy `<0.04` (MDL
// 0.04) into `<0.040.04`.
//
// So nothing here is joined by order. Each pdf.js item carries its x position
// (`transform[4]`) and width; items on one line are split into CELLS wherever
// there is a real gap between them, and once a table's header row is seen
// ("Analysis … Result … Units") every later cell is placed in the column whose
// header it sits under. A blank cell stays blank instead of letting the next
// one slide left. The output is the pipe-row text `parseColumnarCoa` already
// reads (`| Gluten Allergen | ELISA | 4 | Report | <4 | ppm |`).
//
// PURE apart from pdf.js: bytes in, text out. `layoutPage` takes plain items so
// it can be tested without a PDF at all.
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

// The header words a results table uses. Same vocabulary as the pipe reader in
// coa-parse.js; a header row is one that names a test column and a result column.
const ROLE = {
  analysis: 'test', test: 'test', parameter: 'test', 'test name': 'test', analyte: 'test',
  result: 'result', results: 'result', value: 'result',
  unit: 'unit', units: 'unit', mdl: 'mdl', loq: 'mdl', 'detection limit': 'mdl',
  method: 'method', specification: 'spec', spec: 'spec', limit: 'spec',
};
const roleOf = (s) => ROLE[String(s || '').trim().toLowerCase().replace(/\s+/g, ' ')];

function itemsOf(content) {
  return content.items
    .filter(it => typeof it.str === 'string' && it.str.trim() !== '' && it.transform)
    .map(it => {
      const h = Math.abs(it.height || it.transform[3] || it.transform[0] || 10) || 10;
      return { str: it.str, x: it.transform[4], y: it.transform[5], w: Math.max(0, it.width || 0), h };
    });
}

/** Group items into lines (same baseline, within a tolerance), top of the page first. */
function linesOf(items) {
  const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x);
  const lines = [];
  for (const it of sorted) {
    const tol = Math.max(2, it.h * 0.4);
    const line = lines.find(l => Math.abs(l.y - it.y) <= tol);
    if (line) line.items.push(it); else lines.push({ y: it.y, items: [it] });
  }
  for (const l of lines) l.items.sort((a, b) => a.x - b.x);
  return lines.sort((a, b) => b.y - a.y);
}

/** Split one line into cells wherever the gap between two items is wider than a space. */
function cellsOf(line) {
  const cells = [];
  let cur = null;
  for (const it of line.items) {
    if (cur) {
      const gap = it.x - (cur.x + cur.w);
      const space = Math.max(3, it.h * 0.6);
      if (gap <= space) {
        const joiner = gap > it.h * 0.12 && !/\s$/.test(cur.str) && !/^\s/.test(it.str) ? ' ' : '';
        cur.str += joiner + it.str;
        cur.w = Math.max(cur.w, it.x + it.w - cur.x);
        continue;
      }
      cells.push(cur);
    }
    cur = { str: it.str, x: it.x, w: it.w };
  }
  if (cur) cells.push(cur);
  return cells.map(c => ({ ...c, str: c.str.replace(/\s+/g, ' ').trim() })).filter(c => c.str);
}

const pipe = (cells) => `| ${cells.join(' | ')} |`;

/**
 * One page's items → text lines. Table rows come out as pipe rows aligned to
 * their header's columns; anything else keeps its cells apart the same way.
 */
export function layoutPage(items) {
  const out = [];
  let columns = null; // [{ start, end }] from the current table's header row
  for (const line of linesOf(items)) {
    const cells = cellsOf(line);
    if (!cells.length) continue;
    const roles = cells.map(c => roleOf(c.str));
    if (cells.length >= 3 && roles.includes('test') && roles.includes('result') && roles.filter(Boolean).length >= 3) {
      columns = cells.map(c => ({ start: c.x, end: c.x + c.w }));
      out.push(pipe(cells.map(c => c.str)));
      continue;
    }
    if (columns && cells.length >= 2) {
      // Each cell goes to the column its middle sits in. The boundary between
      // two columns is halfway between one header's end and the next header's
      // start, so a centred number under "MDL" stays under "MDL".
      const bounds = columns.slice(0, -1).map((c, i) => (c.end + columns[i + 1].start) / 2);
      const row = columns.map(() => []);
      for (const c of cells) {
        const mid = c.x + c.w / 2;
        let k = bounds.findIndex(b => mid < b);
        if (k === -1) k = columns.length - 1;
        row[k].push(c.str);
      }
      out.push(pipe(row.map(parts => parts.join(' '))));
      continue;
    }
    if (cells.length >= 2) { out.push(pipe(cells.map(c => c.str))); continue; }
    out.push(cells[0].str);
  }
  return out;
}

/** Read a PDF's text layer by position. `{ text, numpages }`, the shape the old reader returned. */
export async function readPdfColumns(buffer) {
  const pdfDoc = await getDocument({ data: new Uint8Array(buffer), isEvalSupported: false, verbosity: 0 }).promise;
  const pages = [];
  for (let i = 1; i <= pdfDoc.numPages; i++) {
    const page = await pdfDoc.getPage(i);
    pages.push(layoutPage(itemsOf(await page.getTextContent())).join('\n'));
  }
  return { text: pages.join('\n'), numpages: pdfDoc.numPages };
}
