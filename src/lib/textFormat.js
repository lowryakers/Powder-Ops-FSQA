// Marker-editing helpers for a plain <textarea> that uses the ReadyDoc
// formatting grammar (shared/rich-markup.js). Kept out of FormatBar.jsx so that
// file only exports a component — a mixed module breaks React Fast Refresh.

/**
 * Wrap the current selection in `before`/`after`, returning the new value.
 *
 * Whitespace at the edges of the selection stays OUTSIDE the markers. This is
 * not cosmetic: the grammar requires a non-space next to a marker (that guard
 * is what stops `MO_4471_lot` italicizing), so `_italicize _` doesn't parse and
 * the underscores render literally. Double-clicking a word takes the trailing
 * space with it in every browser, which made the toolbar look broken for the
 * most ordinary way there is to select a word.
 */
export function wrapSelection(el, value, before, after = before) {
  const start = el?.selectionStart ?? value.length;
  const end = el?.selectionEnd ?? value.length;
  const raw = value.slice(start, end);

  // Split the selection into [leading space][text][trailing space].
  const lead = raw.length - raw.trimStart().length;
  const trail = raw.length - raw.trimEnd().length;
  // An all-whitespace (or empty) selection has nothing to wrap — drop the
  // markers in as-is so the caret lands between them and typing just works.
  const inner = raw.trim() ? raw.slice(lead, raw.length - trail) : '';
  const pre = raw.trim() ? raw.slice(0, lead) : raw;

  const next = value.slice(0, start) + pre + before + inner + after
    + (raw.trim() ? raw.slice(raw.length - trail) : '') + value.slice(end);
  const selStart = start + pre.length + before.length;
  return { next, selStart, selEnd: selStart + inner.length };
}

// Turn the selected lines into a list, stripping any existing list marker first
// so toggling between bullet/numbered (or off→on) doesn't stack markers.
export function prefixLines(el, value, numbered) {
  const start = el?.selectionStart ?? value.length;
  const end = el?.selectionEnd ?? value.length;
  const lineStart = value.lastIndexOf('\n', start - 1) + 1;
  let lineEnd = value.indexOf('\n', end);
  if (lineEnd === -1) lineEnd = value.length;
  let n = 1;
  const out = value.slice(lineStart, lineEnd).split('\n').map(l => {
    const stripped = l.replace(/^\s*(?:[-*]\s+|\d+\.\s+)/, '');
    return numbered ? `${n++}. ${stripped}` : `- ${stripped}`;
  }).join('\n');
  const next = value.slice(0, lineStart) + out + value.slice(lineEnd);
  return { next, selStart: lineStart, selEnd: lineStart + out.length };
}
