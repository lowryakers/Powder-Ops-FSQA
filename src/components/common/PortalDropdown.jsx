import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * A dropdown menu that no modal can clip.
 *
 * Every modal in the app is a max-h card with overflow-y-auto, and a menu
 * absolutely positioned inside one is cut off at the card's edge with no way
 * to reach the rest — the "can't see the full drop-down in a pop-up" bug.
 * This renders the menu on <body> at fixed coordinates measured from the
 * anchor, flips above it when there is more room there, and asks to close on
 * any scroll, because a fixed menu cannot follow its anchor. Same doctrine as
 * comms' MenuPortal; this is the form-input flavour.
 *
 * Usage: wrap the menu contents; pass the input's ref as `anchorRef`.
 */
export default function PortalDropdown({ anchorRef, open, onRequestClose, children, zIndex = 90 }) {
  const [rect, setRect] = useState(null);

  useEffect(() => {
    if (!open) { setRect(null); return undefined; }
    const measure = () => {
      const r = anchorRef.current?.getBoundingClientRect();
      if (!r) return;
      const below = window.innerHeight - r.bottom;
      const dropUp = below < 240 && r.top > below;
      setRect({
        left: r.left, width: r.width,
        top: dropUp ? null : r.bottom + 4,
        bottom: dropUp ? window.innerHeight - r.top + 4 : null,
        maxHeight: Math.max(160, Math.min(224, (dropUp ? r.top : below) - 12)),
      });
    };
    measure();
    const close = () => onRequestClose?.();
    window.addEventListener('resize', measure);
    // Capture phase: the modal's scroller is an ancestor and its scroll
    // doesn't bubble.
    window.addEventListener('scroll', close, true);
    return () => {
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', close, true);
    };
  }, [open, anchorRef, onRequestClose]);

  if (!open || !rect) return null;
  return createPortal(
    <div style={{ position: 'fixed', left: rect.left, width: rect.width, top: rect.top ?? 'auto', bottom: rect.bottom ?? 'auto', maxHeight: rect.maxHeight, zIndex }}
      className="bg-white border border-gray-200 rounded-lg shadow-lg overflow-y-auto">
      {children}
    </div>,
    document.body,
  );
}
