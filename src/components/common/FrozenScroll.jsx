// A log table that stays where it is while its rows and columns scroll (D-149).
//
// D-143 gave the office DataGrid a scroll box capped at `100dvh - 11rem`. That
// number assumed the grid sat near the top of the page; it never does — the
// header, the cards and the tab strip push it down 250-300px — so the box's
// bottom edge, and the horizontal scrollbar with it, sat below the fold until
// the page itself was scrolled down to it. Reported as "I'm not seeing that
// functionality", which was accurate.
//
// So the height is MEASURED, not guessed: the box ends `gap` px above the
// bottom of whatever scrolls it (the window, or a modal's own scroller), from
// wherever it actually starts. The page does not scroll; the table does, its
// header pinned (the `[data-frozen-scroll]` rule in index.css) and both
// scrollbars on screen from the first look.
//
// - Where so much sits above the table that less than `minHeight` would be
//   left, the box takes the whole viewport instead: one short page scroll
//   brings it fully into view and then it holds.
// - It caps, never stretches — a short table is exactly as tall as it was.
// - Where the table still starts below the fold (a module with a lot above it,
//   a short laptop screen), a COPY of its horizontal scrollbar is pinned to the
//   bottom of the window until the real one comes into view, and the two move
//   together. A wide table whose scrollbar is a page away reads as cut off.
// - Phones keep the page scroll. A table that traps the thumb inside a box on a
//   390px screen is worse than one that scrolls with the page, and most of
//   these logs render as cards there anyway.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useCompactLayout } from '../../lib/useCompactLayout';

function scrollParent(el) {
  for (let p = el.parentElement; p && p !== document.body && p !== document.documentElement; p = p.parentElement) {
    const oy = getComputedStyle(p).overflowY;
    if (oy === 'auto' || oy === 'scroll') return p;
  }
  return null;
}

function frozenHeight({ top, available, gap, minHeight }) {
  const fit = Math.floor(available - top - gap);
  return Math.max(fit >= minHeight ? fit : Math.floor(available - 2 * gap), minHeight);
}

export default function FrozenScroll({ className = '', style, children, minHeight = 260, gap = 16, ...rest }) {
  const ref = useRef(null);
  const compact = useCompactLayout();
  const [maxHeight, setMaxHeight] = useState(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (compact || !el) { setMaxHeight(null); return undefined; }
    const parent = scrollParent(el);
    let raf = 0;
    const measure = () => {
      const r = el.getBoundingClientRect();
      if (!r.width && !r.height) return;      // display:none at this width
      let top, available;
      if (parent) {
        const pr = parent.getBoundingClientRect();
        top = r.top - pr.top + parent.scrollTop;
        available = parent.clientHeight;
      } else {
        top = r.top + window.scrollY;
        available = window.innerHeight;
      }
      setMaxHeight(frozenHeight({ top, available, gap, minHeight }));
    };
    const soon = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(measure); };
    measure();
    window.addEventListener('resize', soon);
    // Content above the table settles after mount (cards load, a strip
    // appears); any of it moves where the box starts.
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(soon) : null;
    ro?.observe(document.body);
    if (parent) ro?.observe(parent);
    return () => { cancelAnimationFrame(raf); window.removeEventListener('resize', soon); ro?.disconnect(); };
  }, [compact, minHeight, gap]);

  // The floating scrollbar: shown while the table is wide and its own
  // scrollbar is below the bottom of the window. Only for a window-scrolled
  // page — inside a modal the box always fits its scroller.
  const barRef = useRef(null);
  const [bar, setBar] = useState(null);
  useEffect(() => {
    const el = ref.current;
    if (compact || !el || scrollParent(el)) { setBar(null); return undefined; }
    let raf = 0;
    const update = () => {
      const r = el.getBoundingClientRect();
      const vh = window.innerHeight;
      const wide = el.scrollWidth > el.clientWidth + 1;
      const show = r.width > 0 && wide && r.top < vh - 48 && r.bottom > vh;
      const next = show ? { left: Math.round(r.left + el.clientLeft), width: el.clientWidth, inner: el.scrollWidth } : null;
      setBar((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
    };
    const soon = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(update); };
    const follow = () => { if (barRef.current && barRef.current.scrollLeft !== el.scrollLeft) barRef.current.scrollLeft = el.scrollLeft; };
    update();
    window.addEventListener('scroll', soon, { passive: true });
    window.addEventListener('resize', soon);
    el.addEventListener('scroll', follow, { passive: true });
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(soon) : null;
    ro?.observe(el); ro?.observe(document.body);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('scroll', soon); window.removeEventListener('resize', soon);
      el.removeEventListener('scroll', follow); ro?.disconnect();
    };
  }, [compact]);
  useEffect(() => {
    if (bar && barRef.current && ref.current) barRef.current.scrollLeft = ref.current.scrollLeft;
  }, [bar]);

  return (
    <>
      <div ref={ref} data-frozen-scroll="" {...rest}
        className={`overflow-auto ${className}`}
        style={maxHeight ? { ...style, maxHeight } : style}>
        {children}
      </div>
      {bar && createPortal(
        <div ref={barRef} data-frozen-scrollbar="" aria-hidden="true"
          onScroll={(e) => { if (ref.current && ref.current.scrollLeft !== e.currentTarget.scrollLeft) ref.current.scrollLeft = e.currentTarget.scrollLeft; }}
          className="fixed bottom-0 z-30 overflow-x-auto overflow-y-hidden bg-white/95 border-t border-gray-200 shadow-[0_-2px_6px_rgba(0,0,0,0.06)]"
          style={{ left: bar.left, width: bar.width, height: 14 }}>
          <div style={{ width: bar.inner, height: 1 }} />
        </div>,
        document.body)}
    </>
  );
}
