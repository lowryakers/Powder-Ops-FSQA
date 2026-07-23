import { useEffect } from 'react';

// Global edge-swipe gestures for touch devices. Fires only when a horizontal
// swipe *starts* within `edge` px of a screen edge, so it never fights content
// scrolling or mid-screen carousels (e.g. the schedule day pager).
//
// Commit rules — tuned so the gesture feels forgiving instead of "sticky":
//   - a quick flick commits at `threshold` px (default 60), OR
//   - a slower deliberate drag commits at `dragThreshold` px (default 110)
//     with NO time limit (the old 700 ms cutoff silently ate slow swipes), OR
//   - a fast release (velocity > 0.35 px/ms over the last stretch) commits
//     even short of the distance thresholds.
// Vertical-dominant drags never fire.
//
// Optional live-drag callbacks let a caller render follow-the-finger UI (the
// mobile sidebar drawer): `onLeftDragStart()` → return true to opt in, then
// `onLeftDragMove(dx)` per move and `onLeftDragEnd(committed)` on release.
export function useEdgeSwipe({
  onSwipeRightFromLeft, onSwipeLeftFromRight,
  onLeftDragStart, onLeftDragMove, onLeftDragEnd,
  edge = 28, threshold = 60, dragThreshold = 110,
} = {}) {
  useEffect(() => {
    let sx = 0, sy = 0, st = 0, fromLeft = false, fromRight = false, tracking = false;
    let lastX = 0, lastT = 0, prevX = 0, prevT = 0, dragging = false;

    const commitCheck = (dx, dy) => {
      if (Math.abs(dx) < Math.abs(dy) * 1.6) return false; // diagonal scroll, not a swipe
      if (Math.abs(dx) >= dragThreshold) return true;      // deliberate drag, any speed
      const dt = Math.max(1, lastT - prevT);
      const vel = Math.abs(lastX - prevX) / dt;            // velocity at release
      if (Math.abs(dx) >= threshold && (Date.now() - st) <= 700) return true; // classic flick
      return Math.abs(dx) >= 40 && vel > 0.35;             // short but decisive
    };

    const onStart = (e) => {
      if (e.touches.length !== 1) { tracking = false; return; }
      const t = e.touches[0];
      sx = t.clientX; sy = t.clientY; st = Date.now();
      lastX = prevX = sx; lastT = prevT = st;
      fromLeft = sx <= edge;
      fromRight = sx >= window.innerWidth - edge;
      tracking = fromLeft || fromRight;
      dragging = false;
      if (tracking && fromLeft && onLeftDragStart) dragging = onLeftDragStart() === true;
    };

    const onMove = (e) => {
      if (!tracking) return;
      const t = e.touches[0];
      prevX = lastX; prevT = lastT;
      lastX = t.clientX; lastT = Date.now();
      if (dragging && onLeftDragMove) {
        const dx = t.clientX - sx, dy = t.clientY - sy;
        // A clearly vertical drag cancels the visual drag.
        if (Math.abs(dy) > 60 && Math.abs(dy) > Math.abs(dx) * 1.5) {
          dragging = false; tracking = false;
          onLeftDragEnd?.(false);
          return;
        }
        onLeftDragMove(Math.max(0, dx));
      }
    };

    const onEnd = (e) => {
      if (!tracking) return;
      tracking = false;
      const t = e.changedTouches[0];
      const dx = t.clientX - sx, dy = t.clientY - sy;
      const commit = commitCheck(dx, dy);
      if (dragging) {
        dragging = false;
        onLeftDragEnd?.(commit && dx > 0);
        if (commit && fromLeft && dx > 0) onSwipeRightFromLeft?.();
        return;
      }
      if (!commit) return;
      if (fromLeft && dx > 0) onSwipeRightFromLeft?.();
      else if (fromRight && dx < 0) onSwipeLeftFromRight?.();
    };

    const onCancel = () => {
      if (dragging) { dragging = false; onLeftDragEnd?.(false); }
      tracking = false;
    };

    document.addEventListener('touchstart', onStart, { passive: true });
    document.addEventListener('touchmove', onMove, { passive: true });
    document.addEventListener('touchend', onEnd, { passive: true });
    document.addEventListener('touchcancel', onCancel, { passive: true });
    return () => {
      document.removeEventListener('touchstart', onStart);
      document.removeEventListener('touchmove', onMove);
      document.removeEventListener('touchend', onEnd);
      document.removeEventListener('touchcancel', onCancel);
    };
  }, [onSwipeRightFromLeft, onSwipeLeftFromRight, onLeftDragStart, onLeftDragMove, onLeftDragEnd, edge, threshold, dragThreshold]);
}
