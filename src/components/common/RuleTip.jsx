// "Why?" — the explanation for a rule, where the rule bites.
//
// Two shapes, one registry (`src/lib/platformRules.js`):
//
//   <RuleTip id="form.number-immutable" />        a quiet Why? that opens
//   <RuleNote id="backfill.invents-nothing" />    always-open, for a panel
//
// The popover is drawn on <body> through a portal for the same reason the
// message menu is: any ancestor with `overflow-hidden` — a rounded card, a
// scrolling list — would otherwise clip it in half.

import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { HelpCircle, Info, X } from 'lucide-react';
import { ruleFor } from '../../lib/platformRules';

const WIDTH = 320;

export default function RuleTip({ id, label = 'Why?', className = '' }) {
  const rule = ruleFor(id);
  const btnRef = useRef(null);
  const [pos, setPos] = useState(null);

  // A fixed popover can't follow its button, so any scroll closes it.
  useEffect(() => {
    if (!pos) return undefined;
    const close = () => setPos(null);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => { window.removeEventListener('scroll', close, true); window.removeEventListener('resize', close); };
  }, [pos]);

  if (!rule) return null;

  const open = () => {
    const r = btnRef.current.getBoundingClientRect();
    // Clamped horizontally, and flipped above when there is more room there.
    const left = Math.max(8, Math.min(r.left, window.innerWidth - WIDTH - 8));
    const below = window.innerHeight - r.bottom;
    setPos(below > 200 || below > r.top
      ? { left, top: r.bottom + 6, maxHeight: below - 16 }
      : { left, bottom: window.innerHeight - r.top + 6, maxHeight: r.top - 16 });
  };

  return (
    <>
      <button ref={btnRef} type="button" onClick={() => (pos ? setPos(null) : open())}
        className={`inline-flex items-center gap-0.5 text-[11px] text-gray-400 hover:text-powder-600 ${className}`}>
        <HelpCircle size={12} /> {label}
      </button>
      {pos && createPortal(
        <>
          <div className="fixed inset-0 z-[90]" onClick={() => setPos(null)} />
          <div style={{ position: 'fixed', width: WIDTH, ...pos, overflowY: 'auto' }}
            className="z-[91] bg-white rounded-xl border border-gray-200 shadow-xl p-3">
            <div className="flex items-start justify-between gap-2">
              <p className="text-sm font-semibold text-gray-900">{rule.title}</p>
              <button type="button" onClick={() => setPos(null)} className="p-0.5 text-gray-400 hover:text-gray-600 shrink-0">
                <X size={14} />
              </button>
            </div>
            <p className="text-xs text-gray-600 mt-1.5 leading-relaxed">{rule.body}</p>
          </div>
        </>, document.body)}
    </>
  );
}

/** The same explanation, always visible — for the top of a panel. */
export function RuleNote({ id, className = '' }) {
  const rule = ruleFor(id);
  if (!rule) return null;
  return (
    <div className={`flex items-start gap-2 rounded-lg bg-gray-50 border border-gray-200 px-3 py-2 ${className}`}>
      <Info size={14} className="text-gray-400 mt-0.5 shrink-0" />
      <p className="text-xs text-gray-600 leading-relaxed">
        <span className="font-medium text-gray-800">{rule.title}.</span> {rule.body}
      </p>
    </div>
  );
}
