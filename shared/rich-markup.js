// The little formatting grammar ReadyDoc uses for human-written text.
//
// It is the same grammar the comms composer already uses, on purpose: people
// should learn `*bold*` once and have it work wherever they type. This module
// is the single definition of it, imported by BOTH the browser (to render a
// preview) and the server (to draw the newsletter PDF) — a second copy would
// drift, and the first sign of the drift would be a PDF that doesn't match
// what the author saw.
//
//   *bold*        _italic_        __underline__        ~strike~        `code`
//   - bullet      1. numbered
//
// Deliberately flat: one mark per run, no nesting. That's what the chat
// renderer does, and combining marks is not something anyone has asked for.

// Inline marks. Order matters: __underline__ is listed before _italic_ so the
// two-underscore form wins, and the lookbehind/lookahead guards keep
// snake_case identifiers (MO_4471_lot) from turning into italics.
const INLINE = [
  ['code', '`[^`\\n]+`', 1],
  ['bold', '\\*(?=\\S)[^*\\n]*?\\S\\*', 1],
  ['underline', '(?<![A-Za-z0-9_])__(?=\\S)[^_\\n]*?\\S__(?![A-Za-z0-9_])', 2],
  ['italic', '(?<![A-Za-z0-9_])_(?=\\S)[^_\\n]*?\\S_(?![A-Za-z0-9_])', 1],
  ['strike', '~(?=\\S)[^~\\n]*?\\S~', 1],
];
const INLINE_RE = new RegExp('(' + INLINE.map(([, re]) => re).join('|') + ')', 'g');

/** One line → styled runs. Plain text yields a single unstyled run. */
export function parseRuns(line) {
  const s = String(line ?? '');
  const out = [];
  let last = 0, m;
  INLINE_RE.lastIndex = 0;
  while ((m = INLINE_RE.exec(s)) !== null) {
    if (m.index > last) out.push({ text: s.slice(last, m.index) });
    const tok = m[0];
    // Which mark matched? Test each in order and take the first that fits the
    // whole token — the alternation already resolved the ambiguity.
    const hit = INLINE.find(([, re]) => new RegExp('^(?:' + re + ')$').test(tok));
    if (hit) {
      const [kind, , pad] = hit;
      out.push({ text: tok.slice(pad, -pad), [kind]: true });
    } else {
      out.push({ text: tok });
    }
    last = m.index + tok.length;
  }
  if (last < s.length) out.push({ text: s.slice(last) });
  return out.length ? out : [{ text: '' }];
}

/**
 * One line → spans that cover EVERY character, markers included.
 *
 * `parseRuns` throws the markers away, which is right for a renderer and wrong
 * for the live overlay behind the composer textarea: that has to reproduce the
 * typed text character for character or the highlight drifts off the words.
 * Same grammar, same regex — a second parser is how the composer and the PDF
 * would start disagreeing about what is bold.
 *
 * Marker spans carry `marker: true` alongside their kind, so the overlay can
 * fade the punctuation while styling the content.
 */
export function parseSpans(line) {
  const s = String(line ?? '');
  const out = [];
  let last = 0, m;
  INLINE_RE.lastIndex = 0;
  while ((m = INLINE_RE.exec(s)) !== null) {
    if (m.index > last) out.push({ text: s.slice(last, m.index) });
    const tok = m[0];
    const hit = INLINE.find(([, re]) => new RegExp('^(?:' + re + ')$').test(tok));
    if (hit) {
      const [kind, , pad] = hit;
      out.push({ text: tok.slice(0, pad), kind, marker: true });
      out.push({ text: tok.slice(pad, -pad), kind });
      out.push({ text: tok.slice(-pad), kind, marker: true });
    } else {
      out.push({ text: tok });
    }
    last = m.index + tok.length;
  }
  if (last < s.length) out.push({ text: s.slice(last) });
  return out;
}

const BULLET = /^\s*[-*]\s+(.*)$/;
const NUMBERED = /^\s*\d+[.)]\s+(.*)$/;

/** The list marker at the start of a line, if any — used by the composer's
 *  Enter-continues-the-list and Tab-indents behaviour. */
export function listPrefix(line) {
  const s = String(line ?? '');
  const b = /^(\s*)([-*])(\s+)(.*)$/.exec(s);
  if (b) return { kind: 'ul', indent: b[1], marker: b[2], space: b[3], content: b[4] };
  const n = /^(\s*)(\d+)([.)])(\s+)(.*)$/.exec(s);
  if (n) return { kind: 'ol', indent: n[1], n: Number(n[2]), dot: n[3], space: n[4], content: n[5] };
  return null;
}

/**
 * Whole text → blocks.
 *
 *   { type: 'p',  runs }                      a paragraph
 *   { type: 'ul' | 'ol', items: [runs, …] }   a run of list lines
 *   { type: 'spacer' }                        a deliberate blank line
 *
 * Consecutive list lines of the same kind collapse into one block so a renderer
 * can draw a real list rather than a series of lines that happen to start with
 * a dash.
 */
export function parseBlocks(text) {
  const lines = String(text ?? '').split('\n');
  const blocks = [];
  for (const line of lines) {
    const bullet = BULLET.exec(line);
    const numbered = !bullet && NUMBERED.exec(line);
    const kind = bullet ? 'ul' : numbered ? 'ol' : null;

    if (kind) {
      const runs = parseRuns((bullet || numbered)[1]);
      const prev = blocks[blocks.length - 1];
      if (prev && prev.type === kind) prev.items.push(runs);
      else blocks.push({ type: kind, items: [runs] });
      continue;
    }
    if (!line.trim()) { blocks.push({ type: 'spacer' }); continue; }
    blocks.push({ type: 'p', runs: parseRuns(line) });
  }
  return blocks;
}

/** Does this text use any of the grammar? Lets a caller skip the styled path. */
export function hasMarkup(text) {
  const s = String(text ?? '');
  if (!s) return false;
  INLINE_RE.lastIndex = 0;
  return INLINE_RE.test(s) || s.split('\n').some(l => BULLET.test(l) || NUMBERED.test(l));
}

/** Strip the markers — for plain-text contexts (a chat post, a search index). */
export function toPlainText(text) {
  return parseBlocks(text).map(b => {
    if (b.type === 'spacer') return '';
    if (b.type === 'p') return b.runs.map(r => r.text).join('');
    const marker = (i) => (b.type === 'ol' ? `${i + 1}. ` : '• ');
    return b.items.map((runs, i) => marker(i) + runs.map(r => r.text).join('')).join('\n');
  }).join('\n');
}
