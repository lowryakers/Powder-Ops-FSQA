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
  // `transform` does not apply to a non-replaced INLINE box, so the slant needs
  // an inline-block — and an inline-block cannot break across lines. A long
  // italic run therefore wrapped as one unit while the field wrapped it word by
  // word, and everything after it sat somewhere else entirely: measured at 316px
  // of horizontal drift in an 900px composer, which is precisely the "lots of
  // space between where I am typing and where the cursor is" report. The run is
  // split into per-WORD inline-blocks below, so the line can still break at
  // every space exactly where the field breaks it.
  italic: { display: 'inline-block', transform: 'skewX(-11deg)', color: '#374151' },
  underline: { textDecoration: 'underline', textUnderlineOffset: '2px' },
  strike: { textDecoration: 'line-through', color: '#6b7280' },
  code: { background: '#f3f4f6', borderRadius: '3px', color: '#9333ea' },
  // Underline only — no colour change on the label, because the faded brackets
  // and address around it already say it is a link, and an underline costs no
  // advance width.
  link: { textDecoration: 'underline', textUnderlineOffset: '2px', color: '#0369a1' },
};

const MARKER_COLOR = '#c7cbd1';

/**
 * One styled span — except italic, which becomes one inline-block per word.
 *
 * The spaces stay OUTSIDE the boxes as ordinary inline text, so the line breaks
 * at exactly the same places the textarea breaks it. Splitting on the space and
 * keeping it in its own span preserves every character: the layer has to
 * reproduce the typed text one for one or the caret walks off it.
 */
function Span({ span }) {
  const style = span.marker ? { color: MARKER_COLOR } : (STYLE[span.kind] || undefined);
  if (span.kind !== 'italic' || span.marker) return <span style={style}>{span.text}</span>;
  return (
    <>
      {span.text.split(/( )/).map((piece, i) => (piece === ' '
        ? <span key={i}> </span>
        : <span key={i} style={style}>{piece}</span>))}
    </>
  );
}

function Line({ text, last }) {
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
      {parseSpans(rest).map((s, i) => <Span key={i} span={s} />)}
      {/* NOT after the last line. The field's value has no trailing newline, so
          emitting one here made the layer's content a line taller than the
          field's — which changes how far it can scroll, and the two slid apart
          vertically as soon as a message passed the composer's height cap
          (measured: 149px out). */}
      {last ? null : '\n'}
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
    // THE BOX IS TAKEN FROM THE FIELD, not inferred from the wrapper.
    //
    // `inset-0` sizes this layer to its parent and trusts that the parent is
    // exactly the field's size. It is not always: the composer grows to fit its
    // content and the wrapper picks up its own few pixels, so the layer ended
    // up 7px taller than the field, could not scroll as far, and drifted
    // vertically once a message passed the height cap. Copying the field's own
    // offset box makes the two content boxes coincide by construction, whatever
    // the wrapper does — the padding and border classes are already identical,
    // so matching the outer box matches the inner one.
    const sync = () => {
      el.style.top = `${ta.offsetTop}px`;
      el.style.left = `${ta.offsetLeft}px`;
      el.style.width = `${ta.offsetWidth}px`;
      el.style.height = `${ta.offsetHeight}px`;
      el.scrollTop = ta.scrollTop;
      el.scrollLeft = ta.scrollLeft;
    };
    sync();
    ta.addEventListener('scroll', sync);
    // The composer resizes itself as it fills up, and that is not a scroll.
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(sync) : null;
    ro?.observe(ta);
    return () => { ta.removeEventListener('scroll', sync); ro?.disconnect(); };
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
      className={`pointer-events-none absolute overflow-hidden whitespace-pre-wrap break-words text-gray-900 ${className}`}>
      {(() => { const lines = String(value ?? '').split('\n');
        return lines.map((line, i) => <Line key={i} text={line} last={i === lines.length - 1} />); })()}
    </div>
  );
}
