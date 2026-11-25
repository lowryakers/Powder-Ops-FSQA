// Leftover formatting in a controlled document's text (D-403).
//
// SOPs reached ReadyDoc through Word, Google Docs and copy-and-paste, and each
// left marks behind: a backslash before a dash ("\-organoleptic", the way a
// Google Docs Markdown export protects a character), runs of spaces, invisible
// characters, table rows and columns with nothing in them. On screen and in the
// PDF those read as typos in an approved procedure.
//
// THIS FILE IS PURE and both sides import it:
//   · `unescapeMarkdown` / `plainInline` — what a READER shows. The screen and
//     the PDF print "\-" as "-" whether or not the stored text has been cleaned.
//   · `cleanDocumentText` — the clean-up a PERSON applies in the editor. It
//     returns the new text and what it changed; nothing here writes a record.
//     An approved document is never rewritten by it: the change goes into a
//     draft or a new revision and is approved like any other edit.
//
// THE RULE IS "FORMATTING ONLY, NEVER WORDS". Each change is listed by kind so
// the person sees what will move before they apply it.

// Characters a backslash may protect in Markdown.
const ESCAPABLE = '\\\\`*_{}\\[\\]()#+\\-.!|<>~=:;\'"&%$@,/?';
const ESC_RE = new RegExp(`\\\\([${ESCAPABLE}])`, 'g');

/**
 * One table row → its cells, as the readers show them. A pipe written as "\|"
 * is part of the cell, not a column break (the editor writes it that way).
 */
export function splitTableRow(row) {
  return String(row ?? '').trim().replace(/^\|/, '').replace(/(?<!\\)\|$/, '')
    .split(/(?<!\\)\|/).map(c => c.trim().replace(/\\\|/g, '|'));
}

/** "\-" → "-" for display. A doubled backslash stays one backslash. */
export function unescapeMarkdown(s) {
  return String(s ?? '').replace(ESC_RE, '$1');
}

/** Inline text with its bold/italic markers removed and escapes undone — for the PDF. */
export function plainInline(s) {
  const text = String(s ?? '');
  // Hold escaped characters aside so "\*" is never read as a marker.
  const held = [];
  const masked = text.replace(ESC_RE, (_, ch) => { held.push(ch); return `\uE000${held.length - 1}\uE001`; });
  const stripped = masked
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/(?<!\*)\*(?!\*)(.+?)\*/g, '$1');
  return stripped.replace(/\uE000(\d+)\uE001/g, (_, i) => held[Number(i)]);
}

/** True when a table cell is one bold run — the PDF draws it in bold. */
export function isWholeBold(s) {
  return /^\*\*[^*].*\*\*$/.test(String(s ?? '').trim());
}

// Escapes the clean-up keeps in storage: these characters are markup here, so
// removing the backslash could turn a footnote star into italics or split a
// table cell. The readers show them as the plain character anyway.
const KEEP_ESCAPED = new Set(['*', '_', '`', '[', ']', '|', '\\']);
const INVISIBLE = /[\u200B-\u200D\u2060\uFEFF\u00AD]/g;

function cleanEscapes(line, counts, inCell = false) {
  const lead = line.length - line.trimStart().length;
  return line.replace(ESC_RE, (m, ch, at) => {
    if (KEEP_ESCAPED.has(ch)) return m;
    // At the start of a line "- ", "+ ", "# " and "> " are structure; "1\." is a number, not a list.
    // Inside a table cell neither is, so a cell's "\-organoleptic" always cleans.
    const next = line.slice(at + 2, at + 3);
    if (!inCell && at === lead && /[-+#>]/.test(ch) && (next === '' || /\s/.test(next))) return m;
    if (!inCell && ch === '.' && /^\s*\d+$/.test(line.slice(0, at))) return m;
    counts.escapes++;
    return ch;
  }).replace(/\\([*_])/g, (m, ch, at, str) => {
    // A lone footnote star (or underscore) has nothing to pair with, so it
    // can never become italics: drop its backslash too.
    if (str.split(ch).length - 1 !== 1) return m;
    counts.escapes++;
    return ch;
  });
}

function cleanSpaces(line, counts) {
  let s = line;
  const invisible = s.match(INVISIBLE);
  if (invisible) { counts.invisible += invisible.length; s = s.replace(INVISIBLE, ''); }
  if (s.includes('\u00A0')) { counts.spaces += (s.match(/\u00A0/g) || []).length; s = s.replace(/\u00A0/g, ' '); }
  // Runs inside the text only: leading indentation can be a nested list.
  const lead = s.match(/^\s*/)[0];
  const body = s.slice(lead.length);
  const collapsed = body.replace(/ {2,}/g, (m) => { counts.spaces += m.length - 1; return ' '; });
  const trimmed = collapsed.replace(/[ \t]+$/, (m) => { counts.trailing += m.length ? 1 : 0; return ''; });
  return (trimmed ? lead : '') + trimmed;
}

const TABLE_SEP = /^\s*\|?[\s:|-]*-[\s:|-]*\|?\s*$/;
// Split on pipes that are not escaped, keeping each cell's text as written.
const splitCells = (row) => row.trim().replace(/^\|/, '').replace(/(?<!\\)\|$/, '').split(/(?<!\\)\|/).map(c => c.trim());

function cleanTable(lines, counts, checks) {
  const header = splitCells(lines[0]);
  const rows = lines.slice(2).map(splitCells);
  const cols = Math.max(header.length, ...rows.map(r => r.length), 1);
  const pad = (r) => { const a = r.slice(0, cols); while (a.length < cols) a.push(''); return a; };
  const cell = (c) => {
    const s = cleanEscapes(cleanSpaces(c, counts), counts, true);
    if (((s.match(/\*\*/g) || []).length) % 2) checks.unmatched_bold++;
    return s;
  };
  let h = pad(header).map(cell);
  let body = rows.map(r => pad(r).map(cell));
  const before = body.length;
  body = body.filter(r => r.some(c => c !== ''));
  counts.empty_rows += before - body.length;
  const keep = h.map((_, i) => h[i] !== '' || body.some(r => r[i] !== ''));
  const dropped = keep.filter(k => !k).length;
  if (dropped && dropped < cols) {
    counts.empty_columns += dropped;
    h = h.filter((_, i) => keep[i]);
    body = body.map(r => r.filter((_, i) => keep[i]));
  }
  const row = (r) => `| ${r.join(' | ')} |`;
  return [row(h), `| ${h.map(() => '---').join(' | ')} |`, ...body.map(row)];
}

/**
 * Clean the leftover formatting out of a document's text.
 * Returns { text, changes: {kind: count}, checks: {kind: count}, total }.
 * `checks` are found and left for a person (an unpaired "**").
 */
export function cleanDocumentText(text) {
  const counts = { escapes: 0, spaces: 0, invisible: 0, trailing: 0, blank_lines: 0, empty_rows: 0, empty_columns: 0 };
  const checks = { unmatched_bold: 0 };
  const src = String(text ?? '').replace(/\r\n?/g, '\n');
  const lines = src.split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (t.startsWith('|') && i + 1 < lines.length && TABLE_SEP.test(lines[i + 1]) && lines[i + 1].includes('-')) {
      let j = i + 2;
      while (j < lines.length && lines[j].trim().startsWith('|')) j++;
      const original = lines.slice(i, j);
      const before = { ...counts };
      const cleaned = cleanTable(original, counts, checks);
      const moved = Object.keys(counts).some(k => counts[k] !== before[k]);
      // A table nothing changed in keeps its own spacing.
      out.push(...(moved ? cleaned : original));
      i = j - 1;
      continue;
    }
    const s = cleanEscapes(cleanSpaces(lines[i], counts), counts);
    if (((s.match(/\*\*/g) || []).length) % 2) checks.unmatched_bold++;
    out.push(s);
  }
  let joined = out.join('\n');
  joined = joined.replace(/\n{3,}/g, (m) => { counts.blank_lines += m.length - 2; return '\n\n'; });
  const final = joined.replace(/^\n+|\n+$/g, '');
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  return { text: total ? final : String(text ?? ''), changes: counts, checks, total };
}

/** Words for each kind of change, for the screen. */
export const CLEANUP_LABELS = {
  escapes: 'stray backslashes',
  spaces: 'extra spaces',
  invisible: 'invisible characters',
  trailing: 'spaces at the end of a line',
  blank_lines: 'extra blank lines',
  empty_rows: 'empty table rows',
  empty_columns: 'empty table columns',
  unmatched_bold: 'unpaired ** bold marks (fix by hand)',
};
