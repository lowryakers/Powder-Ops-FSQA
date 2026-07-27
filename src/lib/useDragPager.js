import { useRef, useCallback } from 'react';

// Follow-the-finger horizontal paging for touch devices — the same feel as the
// mobile sidebar drawer, where the content tracks your finger instead of
// snapping only on release.
//
// Usage:
//   const pager = useDragPager({ index, count, onChange });
//   <div {...pager.containerProps}><div ref={pager.trackRef}>…page…</div></div>
//
// The track is translated live during the drag and released with a CSS
// transition, so a partial swipe visibly rubber-bands back and a committed one
// slides out. Rules mirror useEdgeSwipe: a short flick or a longer deliberate
// drag both commit; vertical-dominant drags cancel so page scrolling wins.
export function useDragPager({ index, count, onChange, threshold = 0.28, flickVelocity = 0.4 }) {
  const trackRef = useRef(null);
  const state = useRef({ x: 0, y: 0, w: 0, dragging: false, decided: false, lastX: 0, lastT: 0, prevX: 0, prevT: 0 });

  const setTranslate = (px, animate) => {
    const el = trackRef.current;
    if (!el) return;
    el.style.transition = animate ? 'translate 200ms cubic-bezier(0.22, 1, 0.36, 1)' : 'none';
    el.style.translate = `${px}px 0`;
  };

  const onTouchStart = useCallback((e) => {
    if (e.touches.length !== 1) return;
    const t = e.touches[0];
    const s = state.current;
    s.x = t.clientX; s.y = t.clientY;
    s.w = trackRef.current?.offsetWidth || window.innerWidth;
    s.lastX = s.prevX = t.clientX;
    s.lastT = s.prevT = Date.now();
    s.dragging = true; s.decided = false;
  }, []);

  const onTouchMove = useCallback((e) => {
    const s = state.current;
    if (!s.dragging) return;
    const t = e.touches[0];
    const dx = t.clientX - s.x, dy = t.clientY - s.y;
    // First meaningful movement decides whether this is a page swipe or a
    // vertical scroll. Once it's a scroll we bow out for the rest of the touch.
    if (!s.decided) {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
      s.decided = true;
      if (Math.abs(dy) > Math.abs(dx)) { s.dragging = false; return; }
    }
    s.prevX = s.lastX; s.prevT = s.lastT;
    s.lastX = t.clientX; s.lastT = Date.now();
    // Resist past the ends so first/last pages feel like a wall, not a bug.
    const atStart = index <= 0 && dx > 0;
    const atEnd = index >= count - 1 && dx < 0;
    setTranslate((atStart || atEnd) ? dx * 0.25 : dx, false);
  }, [index, count]);

  const finish = useCallback((dx) => {
    const s = state.current;
    const dt = Math.max(1, s.lastT - s.prevT);
    const vel = Math.abs(s.lastX - s.prevX) / dt;
    const far = Math.abs(dx) > s.w * threshold;
    const flick = Math.abs(dx) > 30 && vel > flickVelocity;
    const dir = dx < 0 ? 1 : -1;
    const next = index + dir;
    if ((far || flick) && next >= 0 && next < count) {
      // Slide the outgoing page fully off, then let the new page render at rest.
      setTranslate(dir > 0 ? -s.w : s.w, true);
      onChange(next);
      setTimeout(() => setTranslate(0, false), 200);
    } else {
      setTranslate(0, true); // rubber-band back
    }
  }, [index, count, onChange, threshold, flickVelocity]);

  const onTouchEnd = useCallback((e) => {
    const s = state.current;
    if (!s.dragging) { setTranslate(0, true); return; }
    s.dragging = false;
    const t = e.changedTouches[0];
    finish(t.clientX - s.x);
  }, [finish]);

  const onTouchCancel = useCallback(() => {
    state.current.dragging = false;
    setTranslate(0, true);
  }, []);

  return {
    trackRef,
    containerProps: { onTouchStart, onTouchMove, onTouchEnd, onTouchCancel },
  };
}
