import { useState, useMemo, useRef } from 'react';
import { ChevronDown, X } from 'lucide-react';

/**
 * A dropdown you can TYPE INTO — for the lists too long to scroll on a phone.
 *
 * Options are strings, or grouped `[{ group, items }]` (the same two shapes
 * QMS selects already use). Typing filters on the option text and the group
 * name; ↑/↓ move, Enter picks, Escape closes. Focusing opens the full list,
 * so it still works as a plain dropdown for someone who doesn't type.
 *
 * `allowFree` decides what a typed value that matches nothing MEANS:
 *   - false (default): it is a search, not a value — blur snaps the box back
 *     to the last real selection, so a half-typed search can never be saved
 *     as data. This is the mode for controlled option lists.
 *   - true: the text itself is the value (suggestions from history, where a
 *     brand-new item is legitimate) — every keystroke IS an onChange.
 *
 * `big` bumps the paddings to kiosk size — these get used standing at a
 * shelf with gloves on.
 */
// HIGH ENOUGH TO REACH THE LAST GROUP. At 60 the sign-out catalogue cut off
// at exactly the boundary where the Chemicals group begins (40 tool-box + 8
// equipment + 11 weights = 59), so opening the picker and scrolling showed no
// chemicals at all and it read as the feature being removed. A cap exists only
// to keep the menu from rendering thousands of rows; it must never be low
// enough to hide a whole category behind knowing what to type.
const LIST_CAP = 300;

export default function SearchSelect({
  value, onChange, options, placeholder = 'Type to search…',
  allowFree = false, big = false, disabled = false, exclude = [],
}) {
  const [q, setQ] = useState(null);      // null = not searching, show the value
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const inputRef = useRef(null);

  const grouped = Array.isArray(options) && options.some(o => o && typeof o === 'object' && Array.isArray(o.items));
  const flat = useMemo(() => {
    const list = grouped
      ? (options || []).flatMap(g => (g.items || []).map(o => ({ group: g.group, name: String(o) })))
      : (options || []).map(o => ({ group: null, name: String(o) }));
    return exclude.length ? list.filter(o => !exclude.includes(o.name)) : list;
  }, [options, grouped, exclude]);

  const needle = (q ?? '').trim().toLowerCase();
  const matches = useMemo(() => {
    if (!needle) return flat;
    return flat.filter(o => o.name.toLowerCase().includes(needle) || (o.group || '').toLowerCase().includes(needle));
  }, [flat, needle]);

  const shown = q ?? (value || '');
  const size = big ? 'px-4 py-3 rounded-xl text-base' : 'px-3 py-2 rounded-lg text-sm';

  const pick = (name) => {
    onChange(name);
    setQ(null); setOpen(false);
    inputRef.current?.blur();
  };
  const type = (text) => {
    setQ(text); setOpen(true); setHi(0);
    if (allowFree) onChange(text);
  };
  const close = () => {
    setOpen(false);
    // A half-typed search is not a value; the box goes back to what is
    // actually selected. In free mode the text IS the value, so it stays.
    setQ(null);
  };

  return (
    <div className="relative">
      <input ref={inputRef} value={shown} disabled={disabled}
        onChange={e => type(e.target.value)}
        onFocus={() => { setOpen(true); setHi(0); }}
        onBlur={() => setTimeout(close, 150)}
        onKeyDown={e => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setHi(h => Math.min(h + 1, matches.length - 1)); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setHi(h => Math.max(h - 1, 0)); }
          else if (e.key === 'Enter') {
            if (open && matches.length) { e.preventDefault(); pick(matches[Math.max(0, Math.min(hi, matches.length - 1))].name); }
            else if (!allowFree) e.preventDefault(); // Enter must not submit a form with a search in the box
          } else if (e.key === 'Escape') { close(); inputRef.current?.blur(); }
        }}
        placeholder={placeholder} autoComplete="off"
        className={`w-full ${size} border border-gray-300 bg-white pr-8 ${disabled ? 'opacity-50' : ''}`} />
      {/* Clear when something is picked; a chevron otherwise, so it still reads as a dropdown. */}
      {value && !disabled ? (
        <button type="button" onMouseDown={e => { e.preventDefault(); onChange(''); setQ(null); inputRef.current?.focus(); }}
          className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 text-gray-400 hover:text-gray-600" aria-label="Clear">
          <X size={14} />
        </button>
      ) : (
        <ChevronDown size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
      )}
      {open && matches.length > 0 && (
        <div className="absolute z-30 left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-56 overflow-y-auto">
          {matches.slice(0, LIST_CAP).map((o, i, arr2) => (
            <div key={`${o.group}|${o.name}`}>
              {grouped && o.group !== arr2[i - 1]?.group && (
                <div className="px-3 pt-2 pb-0.5 text-[10px] font-bold uppercase tracking-wide text-gray-400">{o.group}</div>
              )}
              <button type="button" onMouseDown={e => { e.preventDefault(); pick(o.name); }}
                className={`w-full text-left px-3 ${big ? 'py-2.5 text-base' : 'py-1.5 text-sm'} text-gray-800 hover:bg-powder-50 ${i === hi ? 'bg-powder-50' : ''} ${o.name === value ? 'font-semibold text-powder-700' : ''}`}>
                {o.name}
              </button>
            </div>
          ))}
          {matches.length > LIST_CAP && <div className="px-3 py-1.5 text-[11px] text-gray-400">Keep typing to narrow down…</div>}
        </div>
      )}
    </div>
  );
}
