import { useRef, useState, useCallback } from 'react';

/**
 * iMessage-style interactive back: drag right anywhere in a pane to go back to
 * the list, with the pane following your finger and settling either way.
 *
 * The app already has `useEdgeSwipe`, but that only fires when the gesture
 * *starts* within ~28px of the screen edge, which is a small target on a phone
 * held in a glove and gives no feedback until it commits. This is the other
 * half: a gesture you can start anywhere in the conversation, that shows you
 * it's working while you do it, and that snaps back harmlessly if you change
 * your mind.
 *
 * Rules, all there to keep it from firing when you meant something else:
 *  - one finger only (two = pinch-zooming an image)
 *  - rightward only, and only once horizontal movement clearly beats vertical
 *  - never starts on a control, a link, or anything horizontally scrollable
 *  - a vertical scroll that begins first wins for the rest of the gesture
 *
 * Returns `{ handlers, style, dragging }` — spread `handlers` on the pane and
 * apply `style` to it.
 */
export function useSwipeBack(onBack, { enabled = true, commitPx = 70, commitVelocity = 0.5 } = {}) {
  const [dx, setDx] = useState(0);
  const [dragging, setDragging] = useState(false);
  const st = useRef(null);

  const reset = useCallback(() => { st.current = null; setDragging(false); setDx(0); }, []);

  const onTouchStart = useCallback((e) => {
    if (!enabled || e.touches.length !== 1) { st.current = null; return; }
    const t = e.touches[0];
    // Don't hijack a gesture that belongs to something else on the row.
    const el = e.target;
    if (el?.closest?.('input, textarea, select, button, a, [data-no-swipe]')) { st.current = null; return; }
    // Or to a horizontally scrollable ancestor (image galleries, code blocks).
    let n = el;
    while (n && n !== e.currentTarget) {
      if (n.scrollWidth > n.clientWidth + 4) { st.current = null; return; }
      n = n.parentElement;
    }
    st.current = { x: t.clientX, y: t.clientY, t: Date.now(), lastX: t.clientX, lastT: Date.now(), prevX: t.clientX, prevT: Date.now(), axis: null };
  }, [enabled]);

  const onTouchMove = useCallback((e) => {
    const s = st.current;
    if (!s || e.touches.length !== 1) return;
    const t = e.touches[0];
    const ddx = t.clientX - s.x, ddy = t.clientY - s.y;

    // Decide the axis once, then stick to it — an axis that flips mid-gesture is
    // exactly what makes a swipe feel like it's fighting you.
    if (!s.axis) {
      if (Math.abs(ddx) < 8 && Math.abs(ddy) < 8) return;      // below the noise floor
      s.axis = Math.abs(ddx) > Math.abs(ddy) * 1.3 ? 'x' : 'y';
      if (s.axis === 'y') { st.current = null; return; }        // it's a scroll; let it be
      setDragging(true);
    }
    s.prevX = s.lastX; s.prevT = s.lastT;
    s.lastX = t.clientX; s.lastT = Date.now();

    // Rightward only. Past the commit point the pane keeps up 1:1; before it,
    // and for any leftward pull, it resists — so the gesture tells you where
    // the threshold is without a label.
    const raw = Math.max(0, ddx);
    setDx(raw > commitPx ? raw : raw * 0.85);
  }, [commitPx]);

  const finish = useCallback(() => {
    const s = st.current;
    if (!s || s.axis !== 'x') { reset(); return; }
    const travelled = s.lastX - s.x;
    const dt = Math.max(1, s.lastT - s.prevT);
    const velocity = (s.lastX - s.prevX) / dt;           // px per ms at release
    const commit = travelled > commitPx || (travelled > 24 && velocity > commitVelocity);
    st.current = null;
    setDragging(false);
    if (commit) {
      // Let the pane finish sliding out before the view swaps, so the back
      // doesn't read as a jump cut.
      setDx(window.innerWidth);
      setTimeout(() => { setDx(0); onBack?.(); }, 180);
    } else {
      setDx(0);
    }
  }, [commitPx, commitVelocity, onBack, reset]);

  return {
    dragging,
    handlers: { onTouchStart, onTouchMove, onTouchEnd: finish, onTouchCancel: reset },
    style: dx
      ? {
        transform: `translate3d(${dx}px,0,0)`,
        // No transition while the finger is down — that's what makes it feel
        // attached rather than animated.
        transition: dragging ? 'none' : 'transform 180ms cubic-bezier(0.32, 0.72, 0, 1)',
      }
      : undefined,
  };
}
