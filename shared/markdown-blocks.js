// A controlled document is a STRUCTURE, not a wall of characters.
//
// The document body is stored as Markdown and always will be: the reader view,
// the PDF export, the Spanish translation, search, print and the file importer
// all read `sop_documents.description` as Markdown. Changing the storage would
// touch every one of them.
//
// What was wrong was the EDITING SURFACE. Formatting a vulnerability-assessment
// table by typing pipes into a monospace textarea is not work anybody should be
// asked to do, and it is why Document Control went back to Word. So the body is
// parsed into blocks — heading, paragraph, bullets, numbered list, table — each
// of which gets a real control, and serialized back to the same Markdown.
//
// THE ROUND TRIP IS THE CONTRACT. parse(serialize(blocks)) must equal blocks,
// and serialize(parse(text)) must not lose a line of somebody's approved
// procedure. Anything this parser does not recognise becomes a `paragraph` and
// survives untouched — there is no branch that drops input on the floor.

let seq = 0;
const nextId = () => `b${++seq}`;

const TABLE_SEP = /^\s*\|?[\s:|-]*-[\s:|-]*\|?\s*$/;

function splitRow(row) {
  return row.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());
}

/** Markdown text → an array of editable blocks. */
export function parseBlocks(text) {
  const lines = String(text ?? '').replace(/\r\n?/g, '\n').split('\n');
  const blocks = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const t = line.trim();

    if (!t) { i++; continue; }

    // Table: a pipe row followed by a separator row. Anything else beginning
    // with a pipe is left as text — a half-written table is still somebody's
    // content and must not be silently restructured.
    if (t.startsWith('|') && i + 1 < lines.length && TABLE_SEP.test(lines[i + 1]) && lines[i + 1].includes('-')) {
      const header = splitRow(t);
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) { rows.push(splitRow(lines[i])); i++; }
      const cols = Math.max(header.length, ...rows.map(r => r.length), 1);
      const pad = (r) => { const a = r.slice(0, cols); while (a.length < cols) a.push(''); return a; };
      blocks.push({ id: nextId(), type: 'table', header: pad(header), rows: rows.map(pad) });
      continue;
    }

    const h = t.match(/^(#{1,4})\s+(.*)$/);
    if (h) { blocks.push({ id: nextId(), type: 'heading', level: h[1].length, text: h[2].trim() }); i++; continue; }

    if (/^[-*]\s+/.test(t)) {
      const items = [];
      while (i < lines.length && /^[-*]\s+/.test(lines[i].trim())) { items.push(lines[i].trim().replace(/^[-*]\s+/, '')); i++; }
      blocks.push({ id: nextId(), type: 'bullets', items });
      continue;
    }

    if (/^\d+[.)]\s+/.test(t)) {
      const items = [];
      while (i < lines.length && /^\d+[.)]\s+/.test(lines[i].trim())) { items.push(lines[i].trim().replace(/^\d+[.)]\s+/, '')); i++; }
      blocks.push({ id: nextId(), type: 'numbered', items });
      continue;
    }

    // A paragraph runs to the next blank line or the start of another block, so
    // a wrapped sentence stays one paragraph rather than becoming three.
    const para = [];
    while (i < lines.length) {
      const l = lines[i];
      const lt = l.trim();
      if (!lt) break;
      if (/^(#{1,4}\s|[-*]\s|\d+[.)]\s)/.test(lt)) break;
      if (lt.startsWith('|') && i + 1 < lines.length && TABLE_SEP.test(lines[i + 1])) break;
      para.push(lt);
      i++;
    }
    blocks.push({ id: nextId(), type: 'paragraph', text: para.join('\n') });
  }

  return blocks;
}

/** Blocks → Markdown. The inverse of parseBlocks for everything it produces. */
export function serializeBlocks(blocks) {
  const out = [];
  for (const b of blocks || []) {
    switch (b.type) {
      case 'heading':
        if (!String(b.text || '').trim()) break;
        out.push(`${'#'.repeat(Math.min(4, Math.max(1, b.level || 2)))} ${String(b.text).trim()}`);
        break;
      case 'bullets': {
        const items = (b.items || []).map(s => String(s).trim()).filter(Boolean);
        if (items.length) out.push(items.map(s => `- ${s}`).join('\n'));
        break;
      }
      case 'numbered': {
        const items = (b.items || []).map(s => String(s).trim()).filter(Boolean);
        if (items.length) out.push(items.map((s, i) => `${i + 1}. ${s}`).join('\n'));
        break;
      }
      case 'table': {
        const cols = Math.max(1, (b.header || []).length);
        const cell = (c) => String(c ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ').trim();
        const row = (r) => {
          const a = (r || []).slice(0, cols);
          while (a.length < cols) a.push('');
          return `| ${a.map(cell).join(' | ')} |`;
        };
        const lines = [row(b.header), `| ${Array(cols).fill('---').join(' | ')} |`];
        for (const r of b.rows || []) lines.push(row(r));
        out.push(lines.join('\n'));
        break;
      }
      default: {
        const text = String(b.text ?? '').trim();
        if (text) out.push(text);
      }
    }
  }
  return out.join('\n\n');
}

export const BLOCK_LABEL = {
  heading: 'Heading', paragraph: 'Paragraph', bullets: 'Bulleted list',
  numbered: 'Numbered list', table: 'Table',
};

/** A new, empty block of the given kind — what "insert below" produces. */
export function emptyBlock(type) {
  switch (type) {
    case 'heading': return { id: nextId(), type: 'heading', level: 2, text: '' };
    case 'bullets': return { id: nextId(), type: 'bullets', items: [''] };
    case 'numbered': return { id: nextId(), type: 'numbered', items: [''] };
    case 'table': return { id: nextId(), type: 'table', header: ['', '', ''], rows: [['', '', '']] };
    default: return { id: nextId(), type: 'paragraph', text: '' };
  }
}

/* ── Table edits. Kept here rather than in the component so the shape a table
      can take is defined in ONE place: a row that is shorter than the header is
      how a grid starts disagreeing with its own column count. ─────────────── */

const widthOf = (t) => Math.max(1, (t.header || []).length);
const padRow = (r, n) => { const a = (r || []).slice(0, n); while (a.length < n) a.push(''); return a; };

export function tableNormalize(t) {
  const n = widthOf(t);
  return { ...t, header: padRow(t.header, n), rows: (t.rows || []).map(r => padRow(r, n)) };
}
export function tableAddColumn(t, at = null) {
  const n = widthOf(t);
  const idx = at == null ? n : Math.max(0, Math.min(n, at));
  const ins = (r) => { const a = padRow(r, n); a.splice(idx, 0, ''); return a; };
  return { ...t, header: ins(t.header), rows: (t.rows || []).map(ins) };
}
export function tableRemoveColumn(t, idx) {
  const n = widthOf(t);
  if (n <= 1) return t; // a table with no columns is not a table
  const del = (r) => { const a = padRow(r, n); a.splice(idx, 1); return a; };
  return { ...t, header: del(t.header), rows: (t.rows || []).map(del) };
}
export function tableAddRow(t, at = null) {
  const rows = (t.rows || []).slice();
  const blank = Array(widthOf(t)).fill('');
  rows.splice(at == null ? rows.length : at + 1, 0, blank);
  return { ...t, rows };
}
export function tableRemoveRow(t, idx) {
  const rows = (t.rows || []).slice();
  rows.splice(idx, 1);
  return { ...t, rows };
}
export function tableMoveRow(t, idx, dir) {
  const rows = (t.rows || []).slice();
  const to = idx + dir;
  if (to < 0 || to >= rows.length) return t;
  [rows[idx], rows[to]] = [rows[to], rows[idx]];
  return { ...t, rows };
}

/**
 * Paste a block of tab- or comma-separated text straight into a grid.
 *
 * This is the one thing a Markdown textarea could never do and a word processor
 * does badly: copying a range out of Excel and having it land as rows and
 * columns. Tabs are what a spreadsheet actually puts on the clipboard.
 */
export function tableFromPaste(text) {
  const rows = String(text ?? '').replace(/\r\n?/g, '\n').split('\n')
    .map(l => l.trimEnd()).filter(l => l.trim() !== '')
    .map(l => (l.includes('\t') ? l.split('\t') : l.split(',')).map(c => c.trim()));
  if (rows.length < 2) return null;
  const cols = Math.max(...rows.map(r => r.length));
  if (cols < 2) return null;
  const pad = (r) => padRow(r, cols);
  return { id: nextId(), type: 'table', header: pad(rows[0]), rows: rows.slice(1).map(pad) };
}
