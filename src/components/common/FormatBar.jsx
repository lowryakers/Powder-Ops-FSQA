import { Bold, Italic, Underline, Strikethrough, List, ListOrdered, Link2 } from 'lucide-react';
import { flushSync } from 'react-dom';
import { wrapSelection, prefixLines, wrapLink } from '../../lib/textFormat';

// The B / I / U / S + list toolbar that sits above a plain <textarea>.
//
// It edits the textarea's own text with the markers from shared/rich-markup.js
// rather than being a rich-text editor — the stored value stays plain text,
// which is what every consumer (chat renderer, newsletter PDF, translation,
// search) already expects. The caller owns the value and wires its own save.
//
// Extracted from the comms composer so the newsletter can use the same bar and
// the same syntax; people should learn `*bold*` once.

export default function FormatBar({ getEl, value, onChange, disabled = false }) {
  // Synchronous commit, then the caret — the same rule as the keyboard
  // shortcuts in lib/useFormatKeys.js. Deferring the caret to a frame lets
  // anything typed in the meantime land at the old position.
  const apply = (fn) => {
    const el = getEl?.();
    const r = fn(el, value ?? '');
    flushSync(() => onChange(r.next));
    if (el) { el.focus(); el.setSelectionRange(r.selStart, r.selEnd); }
  };
  const cls = 'w-7 h-7 flex items-center justify-center text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded disabled:opacity-40 disabled:hover:bg-transparent';
  // Keep the textarea selection alive across the click.
  const guard = e => e.preventDefault();
  const btn = (tip, Icon, fn) => (
    <button type="button" disabled={disabled} onMouseDown={guard} onClick={() => apply(fn)} className={cls} data-tip={tip}>
      <Icon size={14} />
    </button>
  );
  return (
    <div className="flex items-center gap-0.5">
      {btn('Bold', Bold, (el, v) => wrapSelection(el, v, '*'))}
      {btn('Italic', Italic, (el, v) => wrapSelection(el, v, '_'))}
      {btn('Underline', Underline, (el, v) => wrapSelection(el, v, '__'))}
      {btn('Strikethrough', Strikethrough, (el, v) => wrapSelection(el, v, '~'))}
      {/* The address is ASKED FOR, not invented. A link button that guessed a
          URL from the selection would produce broken links most of the time,
          and the prompt is pre-filled when the selection already is one. */}
      {btn('Link', Link2, (el, v) => {
        const sel = v.slice(el?.selectionStart ?? 0, el?.selectionEnd ?? 0).trim();
        const guess = /^(?:https?:\/\/|mailto:)\S+$/.test(sel) ? sel : '';
        const url = window.prompt('Link to:', guess || 'https://');
        // Cancel leaves the text exactly as it was.
        return url === null ? { next: v, selStart: el?.selectionStart ?? 0, selEnd: el?.selectionEnd ?? 0 }
          : wrapLink(el, v, url);
      })}
      <span className="w-px h-4 bg-gray-200 mx-0.5" />
      {btn('Bulleted list', List, (el, v) => prefixLines(el, v, false))}
      {btn('Numbered list', ListOrdered, (el, v) => prefixLines(el, v, true))}
    </div>
  );
}
