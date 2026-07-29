import { useState, useRef, useCallback, useEffect } from 'react';

// A photo you can actually zoom into.
//
// The app sets `user-scalable=no` on the viewport so a stray double-tap can't
// zoom a form mid-entry, which also means the browser's own pinch-zoom never
// reaches an image. This component gives the viewer its own: pinch on touch,
// wheel on desktop, double-tap/double-click to toggle, and drag to pan once
// you're in. Nothing here leaks outside the overlay.
const MIN = 1;
const MAX = 6;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const dist = (a, b) => Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
const mid = (a, b) => ({ x: (a.clientX + b.clientX) / 2, y: (a.clientY + b.clientY) / 2 });

export default function ZoomableImage({ src, alt, onError, className = '' }) {
  const [scale, setScale] = useState(1);
  const [tx, setTx] = useState(0);
  const [ty, setTy] = useState(0);
  const wrapRef = useRef(null);
  const gesture = useRef(null);   // active pinch
  const pan = useRef(null);       // active one-finger / mouse drag
  const lastTap = useRef(0);
  // Refs can't be read during render, and the transition must be off only
  // while a gesture is actually in flight — so that lives in state.
  const [interacting, setInteracting] = useState(false);

  const reset = useCallback(() => { setScale(1); setTx(0); setTy(0); }, []);

  // Keep the image from being dragged entirely off screen: the further you are
  // zoomed in, the more travel is allowed, and at 1x it always re-centres.
  const clampPan = useCallback((x, y, s) => {
    const el = wrapRef.current;
    if (!el || s <= 1) return { x: 0, y: 0 };
    const r = el.getBoundingClientRect();
    const maxX = (r.width * (s - 1)) / 2;
    const maxY = (r.height * (s - 1)) / 2;
    return { x: clamp(x, -maxX, maxX), y: clamp(y, -maxY, maxY) };
  }, []);

  const zoomAbout = useCallback((nextScale, originX, originY) => {
    const el = wrapRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setScale(prev => {
      const s = clamp(nextScale, MIN, MAX);
      // Keep the point under the fingers/cursor stationary while scaling.
      const cx = originX - (r.left + r.width / 2);
      const cy = originY - (r.top + r.height / 2);
      setTx(ptx => {
        const nx = ptx - cx * (s / prev - 1);
        setTy(pty => clampPan(nx, pty - cy * (s / prev - 1), s).y);
        return clampPan(nx, 0, s).x;
      });
      return s;
    });
  }, [clampPan]);

  const onTouchStart = (e) => {
    if (e.touches.length === 2) {
      const [a, b] = [e.touches[0], e.touches[1]];
      gesture.current = { d: dist(a, b), s: scale, c: mid(a, b) };
      pan.current = null;
      setInteracting(true);
      return;
    }
    if (e.touches.length === 1) {
      const now = Date.now();
      if (now - lastTap.current < 300) {
        // Double-tap: straight to 2.5x on the tapped point, or back out.
        if (scale > 1) reset();
        else zoomAbout(2.5, e.touches[0].clientX, e.touches[0].clientY);
        lastTap.current = 0;
        return;
      }
      lastTap.current = now;
      if (scale > 1) { pan.current = { x: e.touches[0].clientX - tx, y: e.touches[0].clientY - ty }; setInteracting(true); }
    }
  };

  const onTouchMove = (e) => {
    if (gesture.current && e.touches.length === 2) {
      const [a, b] = [e.touches[0], e.touches[1]];
      const g = gesture.current;
      const next = clamp(g.s * (dist(a, b) / (g.d || 1)), MIN, MAX);
      const c = mid(a, b);
      const el = wrapRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const cx = c.x - (r.left + r.width / 2);
      const cy = c.y - (r.top + r.height / 2);
      const k = 1 - next / g.s;
      const p = clampPan(cx * k, cy * k, next);
      setScale(next); setTx(p.x); setTy(p.y);
      return;
    }
    if (pan.current && e.touches.length === 1 && scale > 1) {
      // Panning a zoomed photo must not also swipe the channel underneath.
      e.stopPropagation();
      const p = clampPan(e.touches[0].clientX - pan.current.x, e.touches[0].clientY - pan.current.y, scale);
      setTx(p.x); setTy(p.y);
    }
  };

  const onTouchEnd = (e) => {
    if (e.touches.length === 0) { gesture.current = null; pan.current = null; setInteracting(false); }
    if (scale <= 1.02) reset();
  };

  // Desktop: wheel zooms, drag pans once zoomed, double-click toggles.
  const onWheel = (e) => {
    zoomAbout(scale * (e.deltaY < 0 ? 1.15 : 1 / 1.15), e.clientX, e.clientY);
  };
  const onMouseDown = (e) => {
    if (scale <= 1) return;
    e.preventDefault();
    pan.current = { x: e.clientX - tx, y: e.clientY - ty };
    setInteracting(true);
  };
  useEffect(() => {
    const move = (e) => {
      if (!pan.current) return;
      const p = clampPan(e.clientX - pan.current.x, e.clientY - pan.current.y, scale);
      setTx(p.x); setTy(p.y);
    };
    const up = () => { pan.current = null; setInteracting(false); };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    return () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
  }, [scale, clampPan]);

  // React registers touchmove and wheel as passive listeners, so a
  // preventDefault() inside the synthetic handler is ignored (and logs a
  // warning). Bind them natively with { passive: false } so the gesture is
  // genuinely ours and the page underneath cannot scroll mid-pinch.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return undefined;
    const stop = (e) => {
      if (e.type === 'wheel' || e.touches?.length > 1 || (pan.current && scale > 1)) e.preventDefault();
    };
    el.addEventListener('touchmove', stop, { passive: false });
    el.addEventListener('wheel', stop, { passive: false });
    return () => {
      el.removeEventListener('touchmove', stop);
      el.removeEventListener('wheel', stop);
    };
  }, [scale]);

  // A new photo starts fresh rather than inheriting the last one's zoom.
  useEffect(() => { reset(); }, [src, reset]);

  const zoomed = scale > 1.02;
  return (
    <div ref={wrapRef}
      className={`relative overflow-hidden ${className}`}
      style={{ touchAction: 'none' }}
      onTouchStart={onTouchStart} onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd} onTouchCancel={onTouchEnd}
      onWheel={onWheel} onMouseDown={onMouseDown}
      onDoubleClick={e => (zoomed ? reset() : zoomAbout(2.5, e.clientX, e.clientY))}>
      <img src={src} alt={alt} draggable={false} onError={onError}
        className="max-w-[92vw] max-h-[84vh] object-contain rounded-lg select-none"
        style={{
          transform: `translate3d(${tx}px, ${ty}px, 0) scale(${scale})`,
          transition: interacting ? 'none' : 'transform 140ms ease-out',
          cursor: zoomed ? 'grab' : 'zoom-in',
        }} />
      {zoomed && (
        <button onClick={e => { e.stopPropagation(); reset(); }}
          className="absolute bottom-2 left-1/2 -translate-x-1/2 px-2.5 py-1 rounded-full bg-black/60 text-white text-[11px] font-medium">
          {scale.toFixed(1)}× · tap to reset
        </button>
      )}
    </div>
  );
}
