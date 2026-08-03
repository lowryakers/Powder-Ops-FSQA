import { Bold, Italic, Underline, Strikethrough, List, ListOrdered } from 'lucide-react';
import { wrapSelection, prefixLines } from '../../lib/textFormat';

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
  const apply = (fn) => {
    const el = getEl?.();
    const r = fn(el, value ?? '');
    onChange(r.next);
    requestAnimationFrame(() => { if (el) { el.focus(); el.setSelectionRange(r.selStart, r.selEnd); } });
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
      <span className="w-px h-4 bg-gray-200 mx-0.5" />
      {btn('Bulleted list', List, (el, v) => prefixLines(el, v, false))}
      {btn('Numbered list', ListOrdered, (el, v) => prefixLines(el, v, true))}
    </div>
  );
}
