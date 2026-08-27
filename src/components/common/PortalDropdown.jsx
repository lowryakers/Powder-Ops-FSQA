import { useEffect, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';

/**
 * A dropdown menu that no modal can clip — and that you can actually scroll.
 *
 * Every modal in the app is a max-h card with overflow-y-auto, and a menu
 * absolutely positioned inside one is cut off at the card's edge with no way
 * to reach the rest — the "can't see the full drop-down in a pop-up" bug. This
 * renders the menu on <body> at fixed coordinates measured from the anchor.
 *
 * TWO THINGS THE FIRST VERSION GOT WRONG, both reported as "the list won't
 * scroll":
 *
 *  1. IT CLOSED ON ITS OWN SCROLL. The scroll listener is on `window` in the
 *     CAPTURE phase — which it has to be, because a modal's scroller is an
 *     ancestor and its scroll event does not bubble. But capture sees every
 *     scroll in the document, including the menu's. So the first flick of the
 *     list closed it, and the catalogue looked stuck on its first few rows.
 *     A scroll that starts INSIDE the menu is the user reading it.
 *
 *  2. AN ANCESTOR SCROLL CLOSED IT RATHER THAN MOVING IT. Scrolling the modal
 *     to see the field you are filling in threw the list away, which is most
 *     of what "a little glitchy" meant. A fixed menu cannot follow its anchor
 *     by itself, so it is re-measured instead — and only closed once the
 *     anchor has actually left the viewport, where there is nothing to hang
 *     off any more.
 */
export default function PortalDropdown({ anchorRef, open, onRequestClose, children, zIndex = 90 }) {
  const [rect, setRect] = useState(null);
  // The menu node, so a scroll can be told apart from an ancestor's.
  const [menuEl, setMenuEl] = useState(null);

  const measure = useCallback(() => {
    const r = anchorRef.current?.getBoundingClientRect();
    if (!r) return null;
    const below = window.innerHeight - r.bottom;
    const dropUp = below < 240 && r.top > below;
    const room = (dropUp ? r.top : below) - 12;
    setRect({
      left: r.left, width: r.width,
      top: dropUp ? null : r.bottom + 4,
      bottom: dropUp ? window.innerHeight - r.top + 4 : null,
      // Up to 320 where there is room: at 224 these lists were about six rows
      // tall, which made scrolling the only way through them and so made the
      // scroll bug impossible to work around.
      maxHeight: Math.max(160, Math.min(320, room)),
    });
    return r;
  }, [anchorRef]);

  useEffect(() => {
    if (!open) { setRect(null); return undefined; }
    measure();

    const onScroll = (e) => {
      // Our own scroll is the user reading the list, not leaving it.
      if (menuEl && e.target instanceof Node && menuEl.contains(e.target)) return;
      const r = anchorRef.current?.getBoundingClientRect();
      // The anchor has scrolled out of sight — there is nothing to attach to.
      if (!r || r.bottom < 0 || r.top > window.innerHeight) { onRequestClose?.(); return; }
      measure();
    };

    window.addEventListener('resize', measure);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [open, anchorRef, onRequestClose, measure, menuEl]);

  if (!open || !rect) return null;
  return createPortal(
    <div ref={setMenuEl}
      // KEEP FOCUS IN THE INPUT. Pressing the menu's scrollbar (or anywhere
      // that is not an option) would otherwise blur the input, and the blur
      // handler closes the list 150ms later — so dragging the scrollbar threw
      // the menu away mid-drag. The option buttons call their own handler on
      // mousedown, so nothing here needs the focus.
      onMouseDown={e => e.preventDefault()}
      style={{ position: 'fixed', left: rect.left, width: rect.width, top: rect.top ?? 'auto', bottom: rect.bottom ?? 'auto', maxHeight: rect.maxHeight, zIndex }}
      // `overscroll-contain` stops a flick that reaches the end of this list
      // from carrying on into the page behind it, which on a phone reads as
      // the menu jumping away under your finger.
      className="bg-white border border-gray-200 rounded-lg shadow-lg overflow-y-auto overscroll-contain">
      {children}
    </div>,
    document.body,
  );
}
