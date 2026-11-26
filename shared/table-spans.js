// Merged cells in a controlled-document table (D-402).
//
// The document body is Markdown, and a Markdown table has no merged cells. SOPs
// copied out of Word are full of them — a "Raw Materials" row across the whole
// table, a heading over two columns — and without a way to say so the editor
// left every merged cell as a row of empty boxes.
//
// So a merge is written IN THE CELL, as a marker, and the storage stays plain
// Markdown that every other reader still parses:
//   `<<`  this cell belongs to the cell on its LEFT  (column span)
//   `^^`  this cell belongs to the cell ABOVE        (row span, body rows only)
//
// THIS FILE IS THE ONE READING OF THOSE MARKERS. The editor, the screen view and
// the PDF all call `spanLayout`; a second reading is how the PDF starts merging a
// cell the screen does not.
//
// The rules keep text visible. A merge only ever swallows marker cells: a cell
// that holds words is never hidden under somebody else's span, so a stray marker
// can cost a border, never a sentence.

export const MERGE_LEFT = '<<';
export const MERGE_UP = '^^';

export const isMergeMarker = (v) => {
  const s = String(v ?? '').trim();
  return s === MERGE_LEFT || s === MERGE_UP;
};

/**
 * Lay out a table's cells with their spans.
 *
 * Returns `{ header, rows }`. Each is a list of the cells that are DRAWN, in
 * column order: `{ c, colspan, rowspan, text }`. Cells covered by a span are
 * left out. A marker with nothing to merge into (a `<<` in the first column, a
 * `^^` under a cell that does not reach it) is drawn as an empty cell.
 */
export function spanLayout(table) {
  const cols = Math.max(1, (table.header || []).length);
  const pad = (r) => { const a = (r || []).slice(0, cols); while (a.length < cols) a.push(''); return a.map(x => String(x ?? '')); };
  const header = pad(table.header);
  const rows = (table.rows || []).map(pad);
  const mark = (v) => v.trim();

  // Columns to the right of `c` in `row` that merge left, stopping at the first
  // cell that does not.
  const widthAt = (row, c) => {
    let w = 1;
    while (c + w < cols && mark(row[c + w]) === MERGE_LEFT) w++;
    return w;
  };

  // Header: column spans only. A header that spans down into the body would
  // stop being a header row.
  const headerCells = [];
  for (let c = 0; c < cols;) {
    const w = mark(header[c]) === MERGE_LEFT && c === 0 ? 1 : widthAt(header, c);
    const text = isMergeMarker(header[c]) ? '' : header[c];
    headerCells.push({ c, colspan: w, rowspan: 1, text });
    c += w;
  }

  const covered = rows.map(() => Array(cols).fill(false));
  const out = rows.map(() => []);
  for (let r = 0; r < rows.length; r++) {
    for (let c = 0; c < cols;) {
      if (covered[r][c]) { c++; continue; }
      const v = rows[r][c];
      if (isMergeMarker(v)) {
        // A marker nothing claimed: draw it empty, and let it start nothing.
        out[r].push({ c, colspan: 1, rowspan: 1, text: '' });
        c++;
        continue;
      }
      // An anchor. Its width: the merge-left cells to its right that nobody
      // above has already claimed.
      let w = 1;
      while (c + w < cols && !covered[r][c + w] && mark(rows[r][c + w]) === MERGE_LEFT) w++;
      // Its height: each row below whose cell under it says ^^ and whose other
      // cells across the same width are all markers. A row with words in that
      // width stops the span, so the words stay on screen.
      let h = 1;
      while (r + h < rows.length) {
        const below = rows[r + h];
        if (mark(below[c]) !== MERGE_UP) break;
        let ok = true;
        for (let k = 1; k < w; k++) if (!isMergeMarker(below[c + k]) || covered[r + h][c + k]) { ok = false; break; }
        if (!ok) break;
        h++;
      }
      for (let dr = 0; dr < h; dr++) for (let dc = 0; dc < w; dc++) if (dr || dc) covered[r + dr][c + dc] = true;
      out[r].push({ c, colspan: w, rowspan: h, text: v });
      c += w;
    }
  }
  return { header: headerCells, rows: out, cols };
}

/* ── Edits. A merge must never delete words: the text of a cell merged away is
      added to the cell it joins. ───────────────────────────────────────────── */

// The same words twice (Word repeats a merged cell's text when it is split) are kept once.
const joinText = (a, b) => {
  const parts = [String(a ?? '').trim(), String(b ?? '').trim()].filter(t => t && !isMergeMarker(t));
  return parts.length === 2 && parts[0] === parts[1] ? parts[0] : parts.join(' ');
};

const copyTable = (t) => {
  const cols = Math.max(1, (t.header || []).length);
  const pad = (r) => { const a = (r || []).slice(0, cols); while (a.length < cols) a.push(''); return a; };
  return { ...t, header: pad(t.header), rows: (t.rows || []).map(pad) };
};

// The cell that currently owns (r, c): walk left over `<<` and up over `^^`.
// r = -1 is the header row.
function ownerOf(t, r, c) {
  const at = (rr, cc) => (rr === -1 ? t.header[cc] : t.rows[rr][cc]);
  let rr = r, cc = c;
  for (let guard = 0; guard < 1000; guard++) {
    const v = String(at(rr, cc) ?? '').trim();
    if (v === MERGE_LEFT && cc > 0) { cc--; continue; }
    if (v === MERGE_UP && rr > 0) { rr--; continue; }
    break;
  }
  return [rr, cc];
}

/** Merge cell (r, c) into the cell on its left. r = -1 is the header. */
export function mergeLeft(t, r, c) {
  if (c <= 0) return t;
  const n = copyTable(t);
  const row = r === -1 ? n.header : n.rows[r];
  if (!row) return t;
  const [or, oc] = ownerOf(n, r, c - 1);
  const ownerRow = or === -1 ? n.header : n.rows[or];
  ownerRow[oc] = joinText(ownerRow[oc], row[c]);
  row[c] = MERGE_LEFT;
  return n;
}

/** Merge body cell (r, c) into the cell above. The header row takes no row spans. */
export function mergeUp(t, r, c) {
  if (r <= 0) return t;
  const n = copyTable(t);
  const [or, oc] = ownerOf(n, r - 1, c);
  n.rows[or][oc] = joinText(n.rows[or][oc], n.rows[r][c]);
  n.rows[r][c] = MERGE_UP;
  return n;
}

/** One cell across the whole row: the section heading Word tables are full of. */
export function mergeRow(t, r) {
  const n = copyTable(t);
  const row = r === -1 ? n.header : n.rows[r];
  if (!row || row.length < 2) return t;
  row[0] = row.reduce((acc, v) => joinText(acc, v), '');
  for (let c = 1; c < row.length; c++) row[c] = MERGE_LEFT;
  return n;
}

/** Undo a merge on one cell. Its text stays where the merge put it. */
export function splitCell(t, r, c) {
  const n = copyTable(t);
  const row = r === -1 ? n.header : n.rows[r];
  if (!row || !isMergeMarker(row[c])) return t;
  row[c] = '';
  return n;
}

/** Undo every merge in a row. */
export function splitRow(t, r) {
  const n = copyTable(t);
  const row = r === -1 ? n.header : n.rows[r];
  if (!row) return t;
  for (let c = 0; c < row.length; c++) if (isMergeMarker(row[c])) row[c] = '';
  return n;
}
