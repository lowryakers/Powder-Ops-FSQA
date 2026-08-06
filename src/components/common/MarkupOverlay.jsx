import { useEffect, useRef } from 'react';
import { parseSpans, listPrefix } from '../../../shared/rich-markup.js';

/**
 * Live formatting behind a plain <textarea>.
 *
 * The textarea's own text is made transparent (the caret stays visible) and
 * this layer, sitting exactly underneath with identical metrics, draws the same
 * characters with the marks styled. So the stored value stays plain text —
 * which is what the chat renderer, the translation cache, search and the PDF
 * all expect — and the author still sees what they are marking up.
 *
 * THE ONE RULE THAT MAKES THIS WORK: NOTHING MAY CHANGE THE ADVANCE WIDTH OF A
 * GLYPH. The caret and the selection are drawn by the textarea, which knows
 * nothing about this layer, so the moment a styled span is one pixel wider than
 * the plain one the caret drifts off the text and the whole thing reads as
 * broken. That rules out `font-weight` and `font-style`, the two obvious
 * choices, and is why:
 *   bold      → text-shadow, which thickens the glyph without re-laying it out
 *   italic    → skewX, a transform, which never affects layout
 *   underline / strikethrough / code tint → decorations and backgrounds, free
 * Markers themselves are faded rather than hidden: hiding them WOULD change the
 * width, and seeing the syntax recede is the point anyway.
 */
const STYLE = {
  bold: { textShadow: '0.35px 0 0 currentColor, -0.35px 0 0 currentColor', color: '#111827' },
  italic: { display: 'inline-block', transform: 'skewX(-11deg)', color: '#374151' },
  underline: { textDecoration: 'underline', textUnderlineOffset: '2px' },
  strike: { textDecoration: 'line-through', color: '#6b7280' },
  code: { background: '#f3f4f6', borderRadius: '3px', color: '#9333ea' },
};

const MARKER_COLOR = '#c7cbd1';

function Line({ text }) {
  const pfx = listPrefix(text);
  // A list marker is prefix punctuation, not part of the sentence — fading it
  // is what makes a typed list read as a list.
  const head = pfx
    ? (pfx.kind === 'ol'
      ? `${pfx.indent}${pfx.n}${pfx.dot}${pfx.space}`
      : `${pfx.indent}${pfx.marker}${pfx.space}`)
    : '';
  const rest = pfx ? text.slice(head.length) : text;

  return (
    <>
      {head && <span style={{ color: MARKER_COLOR }}>{head}</span>}
      {parseSpans(rest).map((s, i) => (
        <span key={i} style={s.marker ? { color: MARKER_COLOR } : (STYLE[s.kind] || undefined)}>{s.text}</span>
      ))}
      {'\n'}
    </>
  );
}

export default function MarkupOverlay({ textareaRef, value, className = '' }) {
  const ref = useRef(null);

  // The textarea scrolls independently once it hits its max height, so the
  // layer has to follow it or long messages slide out of register.
  useEffect(() => {
    const ta = textareaRef?.current;
    const el = ref.current;
    if (!ta || !el) return undefined;
    const sync = () => { el.scrollTop = ta.scrollTop; el.scrollLeft = ta.scrollLeft; };
    sync();
    ta.addEventListener('scroll', sync);
    return () => ta.removeEventListener('scroll', sync);
  }, [textareaRef, value]);

  return (
    <div ref={ref} aria-hidden="true"
      // Mobile browsers inflate text in block elements but not in form
      // controls, which would make this layer wider than the textarea by a
      // fraction per character — the caret then walks away from the words as
      // you type. Opting out keeps the two in step.
      style={{ textSizeAdjust: 'none', WebkitTextSizeAdjust: 'none' }}
      // Inherits every metric that matters from the textarea's own classes; the
      // caller passes the same padding/border/font classes it gave the field.
      className={`pointer-events-none absolute inset-0 overflow-hidden whitespace-pre-wrap break-words text-gray-900 ${className}`}>
      {String(value ?? '').split('\n').map((line, i) => <Line key={i} text={line} />)}
    </div>
  );
}
