// Marker-editing helpers for a plain <textarea> that uses the ReadyDoc
// formatting grammar (shared/rich-markup.js). Kept out of FormatBar.jsx so that
// file only exports a component — a mixed module breaks React Fast Refresh.

/** Wrap the current selection in `before`/`after`, returning the new value. */
export function wrapSelection(el, value, before, after = before) {
  const start = el?.selectionStart ?? value.length;
  const end = el?.selectionEnd ?? value.length;
  const inner = value.slice(start, end);
  const next = value.slice(0, start) + before + inner + after + value.slice(end);
  const selStart = start + before.length;
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
