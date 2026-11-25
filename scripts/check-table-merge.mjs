// D-402: merged cells in a controlled-document table. Pure — no server.
//   - the markers `<<` / `^^` round-trip through the block editor's Markdown;
//   - spanLayout gives the right spans and never hides a cell with words in it;
//   - a merge moves the merged cell's text into the cell it joins (nothing lost);
//   - the PDF draws one box per drawn cell, spans included, with no overlaps,
//     and a row span is never cut by a page break.
import PDFDocument from 'pdfkit';
import { parseBlocks, serializeBlocks } from '../shared/markdown-blocks.js';
import { spanLayout, mergeLeft, mergeUp, mergeRow, splitCell, splitRow } from '../shared/table-spans.js';
import { tableAt, drawTable } from '../server/pdf-table.js';

let pass = 0, fail = 0;
const t = (n, c, d = '') => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (d ? ' — ' + d : '')); } };
const J = JSON.stringify;

const base = { header: ['Material Format', 'Example', 'Every Batch'], rows: [
  ['Raw Materials', '', ''],
  ['Botanical Powders', 'Ginger Powder', 'organoleptic'],
  ['Botanical', 'Green Tea Extract', 'organoleptic'],
] };

console.log('\n── merging ──');
let m = mergeRow(base, 0);
t('merge row: one cell across the row, text kept', J(m.rows[0]) === J(['Raw Materials', '<<', '<<']), J(m.rows[0]));
t('…laid out as one cell spanning 3', J(spanLayout(m).rows[0]) === J([{ c: 0, colspan: 3, rowspan: 1, text: 'Raw Materials' }]));
const words = mergeRow({ header: ['a', 'b'], rows: [['x', 'y']] }, 0);
t('merging a row with words in two cells keeps both', words.rows[0][0] === 'x y');
m = mergeUp(base, 2, 2);
t('merge up: the same words twice are kept once, the cell becomes ^^', m.rows[1][2] === 'organoleptic' && m.rows[2][2] === '^^', m.rows[1][2]);
t('…different words are both kept', mergeUp({ header: ['a'], rows: [['x'], ['y']] }, 1, 0).rows[0][0] === 'x y');
const L = spanLayout(m);
t('…a row span of 2 on the cell above, and the covered cell is not drawn',
  L.rows[1].find(c => c.c === 2)?.rowspan === 2 && !L.rows[2].some(c => c.c === 2));
m = mergeLeft(base, -1, 2);
t('header merge left: header spans 2', J(spanLayout(m).header.map(c => c.colspan)) === J([1, 2]));
t('mergeUp on the first body row does nothing (the header takes no row spans)', mergeUp(base, 0, 1) === base);
t('mergeLeft in the first column does nothing', mergeLeft(base, 1, 0) === base);

console.log('\n── words are never hidden ──');
const hide = { header: ['A', 'B'], rows: [['x', '<<'], ['^^', 'kept']] };
const H = spanLayout(hide);
t('a ^^ under a two-wide span whose neighbour has words does not swallow the words',
  H.rows[0][0].rowspan === 1 && H.rows[1].some(c => c.text === 'kept'), J(H.rows));
const stray = spanLayout({ header: ['<<', 'B'], rows: [['<<', 'y']] });
t('a stray marker (nothing to its left) draws as an empty cell', stray.rows[0][0].text === '' && stray.header[0].text === '');
const block2x2 = spanLayout({ header: ['A', 'B', 'C'], rows: [['x', '<<', 'z'], ['^^', '^^', 'r']] });
t('a 2×2 block: one cell colspan 2 rowspan 2', block2x2.rows[0][0].colspan === 2 && block2x2.rows[0][0].rowspan === 2 && block2x2.rows[1].length === 1);

console.log('\n── splitting ──');
m = mergeRow(base, 0);
t('split one cell back out', J(splitCell(m, 0, 2).rows[0]) === J(['Raw Materials', '<<', '']));
t('split the whole row', J(splitRow(m, 0).rows[0]) === J(['Raw Materials', '', '']));

console.log('\n── stored as plain Markdown ──');
m = mergeUp(mergeRow(base, 0), 2, 2);
const md = serializeBlocks([{ id: 'x', type: 'table', ...m }]);
t('the markers are written as cell text', md.includes('| Raw Materials | << | << |') && md.includes('| ^^ |'), md);
const back = parseBlocks(md)[0];
t('…and read back unchanged', J(back.header) === J(m.header) && J(back.rows) === J(m.rows));

console.log('\n── PDF ──');
const pdf = new PDFDocument({ size: 'LETTER', margin: 50, bufferPages: true });
const lines = md.split('\n');
const tbl = tableAt(lines, 0);
const out = drawTable(pdf, tbl, { left: 50, width: 512, pageBottom: 742 });
t('PDF: one row box per row', out.boxes.length === 1 + tbl.rows.length);
t('PDF: the merged row prints as one cell', J(out.boxes[1].cells) === J(['Raw Materials']));
// A tall table, with a row span near the foot of a page: the two rows move together.
const tall = { header: ['A', 'B'], rows: [] };
for (let i = 0; i < 40; i++) tall.rows.push([`row ${i} ` + 'word '.repeat(12), `b ${i}`]);
tall.rows[29][1] = 'spans down';
for (let k = 30; k < 33; k++) tall.rows[k][1] = '^^';
const pdf2 = new PDFDocument({ size: 'LETTER', margin: 50, bufferPages: true });
const o2 = drawTable(pdf2, tall, { left: 50, width: 512, pageBottom: 742 });
const bodyBoxes = o2.boxes.filter(b => b.cells[0] !== 'A');
const pages = new Set(bodyBoxes.slice(29, 33).map(b => b.page));
t('PDF: rows joined by a row span stay on one page', pages.size === 1, J([...pages]));
let overlap = false;
for (let i = 1; i < o2.boxes.length; i++) {
  const a = o2.boxes[i - 1], b = o2.boxes[i];
  if (a.page === b.page && b.y < a.y + a.h - 0.01) overlap = true;
}
t('PDF: no two row boxes overlap', !overlap);
t('PDF: every row printed', bodyBoxes.length === 40);

console.log(`\n${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
