import { useEffect } from 'react';

// Global edge-swipe gestures for touch devices. Fires only when a horizontal
// swipe *starts* within `edge` px of a screen edge, so it never fights content
// scrolling or mid-screen carousels (e.g. the schedule day pager). Vertical
// drags are ignored.
export function useEdgeSwipe({ onSwipeRightFromLeft, onSwipeLeftFromRight, edge = 24, threshold = 70 } = {}) {
  useEffect(() => {
    let sx = 0, sy = 0, st = 0, fromLeft = false, fromRight = false, tracking = false;
    const onStart = (e) => {
      if (e.touches.length !== 1) { tracking = false; return; }
      const t = e.touches[0];
      sx = t.clientX; sy = t.clientY; st = Date.now();
      fromLeft = sx <= edge;
      fromRight = sx >= window.innerWidth - edge;
      tracking = fromLeft || fromRight;
    };
    const onEnd = (e) => {
      if (!tracking) return;
      tracking = false;
      const t = e.changedTouches[0];
      const dx = t.clientX - sx, dy = t.clientY - sy;
      const dt = Date.now() - st;
      // Intentional edge swipe: far enough, clearly horizontal (not a diagonal
      // scroll), and a flick rather than a slow drag.
      if (Math.abs(dx) < threshold) return;
      if (Math.abs(dx) < Math.abs(dy) * 1.8) return;
      if (dt > 700) return;
      if (fromLeft && dx > 0) onSwipeRightFromLeft?.();
      else if (fromRight && dx < 0) onSwipeLeftFromRight?.();
    };
    document.addEventListener('touchstart', onStart, { passive: true });
    document.addEventListener('touchend', onEnd, { passive: true });
    return () => {
      document.removeEventListener('touchstart', onStart);
      document.removeEventListener('touchend', onEnd);
    };
  }, [onSwipeRightFromLeft, onSwipeLeftFromRight, edge, threshold]);
}
