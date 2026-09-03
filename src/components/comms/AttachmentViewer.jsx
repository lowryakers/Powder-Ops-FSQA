import { useState, useRef, useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X, ChevronLeft, ChevronRight, Download, Share2, Copy, Check, ExternalLink, FileText, ZoomIn, ZoomOut, Maximize2 } from 'lucide-react';
import { pdfViewerUrl } from '../../lib/pdfUrl.js';
import { copyImage, canCopyImage } from '../../lib/copyImage.js';

// The full-screen viewer for a message's attachments.
//
// ON `document.body`, NOT INSIDE THE MESSAGE. The old lightbox rendered inside
// the message row, so every touch inside it also reached the message's own
// handlers: the 450ms long-press timer opened the action sheet on top of a
// pinch, the tap-to-open-thread fired on a pan, and the swipe-back pane's
// transform made `position: fixed` fixed to the pane rather than the screen.
// A portal puts it outside all of that, and the root stops propagation anyway.
//
// One gesture vocabulary, the one every phone's photo app taught:
//   pinch / wheel / buttons  zoom about the point under the fingers
//   double-tap / double-click  2.5× there, or back to fit
//   drag                     pan once zoomed
//   swipe sideways at fit    next / previous attachment
//   swipe down at fit        close
//   tap the photo            hide or show the controls
//   tap the backdrop, ✕, Esc close
// The chrome is small and stays out of the picture; Copy is the first action,
// because "text me that screenshot" was the whole request.

const MIN = 1;
const MAX = 8;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const dist = (a, b) => Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
const mid = (a, b) => ({ x: (a.clientX + b.clientX) / 2, y: (a.clientY + b.clientY) / 2 });

const fmtSize = (n) => { if (!n && n !== 0) return ''; if (n < 1024) return `${n} B`; if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`; return `${(n / 1024 / 1024).toFixed(1)} MB`; };

function ZoomStage({ src, alt, scale, tx, ty, interacting, onBroken }) {
  return (
    <img src={src} alt={alt} draggable={false} onError={onBroken}
      className="max-w-full max-h-full object-contain select-none"
      style={{
        transform: `translate3d(${tx}px, ${ty}px, 0) scale(${scale})`,
        transition: interacting ? 'none' : 'transform 160ms ease-out',
        cursor: scale > 1.02 ? 'grab' : 'zoom-in',
        willChange: 'transform',
      }} />
  );
}

export default function AttachmentViewer({ atts, index, onNav, onClose, helpers, actions }) {
  const { browserRenderable, videoPlayable, isPdf } = helpers;
  const { download, share, canShare } = actions;
  const a = atts[index];
  const isImage = !!a && browserRenderable(a) && !!a.url;

  const [scale, setScale] = useState(1);
  const [tx, setTx] = useState(0);
  const [ty, setTy] = useState(0);
  const [interacting, setInteracting] = useState(false);
  const [chrome, setChrome] = useState(true);
  const [toast, setToast] = useState(null);
  const [broken, setBroken] = useState(false);
  const [busy, setBusy] = useState(false);
  // A PHONE CANNOT PINCH AN EMBEDDED PDF. The app disables viewport zoom and
  // the browser's PDF frame ignores touch gestures anyway, so on a compact
  // screen a document is handed to the phone's own viewer, which zooms —
  // rather than drawn two centimetres wide in a frame nobody can read.
  const [compact, setCompact] = useState(() => typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)');
    const on = (e) => setCompact(e.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  const stageRef = useRef(null);
  const trackRef = useRef(null);
  const pinch = useRef(null);
  const pan = useRef(null);
  const swipe = useRef(null);      // one-finger swipe at fit: page or close
  const lastTap = useRef(0);
  const tapTimer = useRef(null);
  const toastTimer = useRef(null);
  // A touch tap is followed by synthetic click/dblclick events; the touch path
  // has already handled them, so the mouse path stands down for half a second.
  const lastTouchAt = useRef(0);
  const fromTouch = (e) => e.timeStamp - lastTouchAt.current < 500;

  const reset = useCallback(() => { setScale(1); setTx(0); setTy(0); }, []);
  const zoomed = scale > 1.02;

  // A new attachment starts at fit, with the controls showing.
  useEffect(() => { reset(); setBroken(false); setChrome(true); }, [index, reset]);

  // The page behind must not scroll while the viewer is up.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  const clampPan = useCallback((x, y, s) => {
    const el = stageRef.current;
    if (!el || s <= 1) return { x: 0, y: 0 };
    const r = el.getBoundingClientRect();
    const maxX = (r.width * (s - 1)) / 2;
    const maxY = (r.height * (s - 1)) / 2;
    return { x: clamp(x, -maxX, maxX), y: clamp(y, -maxY, maxY) };
  }, []);

  // Scale about a screen point, keeping what is under it where it is.
  const zoomAbout = useCallback((nextScale, originX, originY) => {
    const el = stageRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const s = clamp(nextScale, MIN, MAX);
    const cx = originX - (r.left + r.width / 2);
    const cy = originY - (r.top + r.height / 2);
    setScale(prev => {
      const k = s / prev;
      setTx(ptx => { const nx = ptx - cx * (k - 1); setTy(pty => clampPan(nx, pty - cy * (k - 1), s).y); return clampPan(nx, 0, s).x; });
      return s;
    });
  }, [clampPan]);
  const zoomBy = (f) => {
    const el = stageRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    zoomAbout(scale * f, r.left + r.width / 2, r.top + r.height / 2);
  };

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowRight') onNav(1);
      else if (e.key === 'ArrowLeft') onNav(-1);
      else if (e.key === '+' || e.key === '=') zoomBy(1.25);
      else if (e.key === '-' || e.key === '_') zoomBy(1 / 1.25);
      else if (e.key === '0') reset();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // ── touch ──────────────────────────────────────────────────────────────
  const onTouchStart = (e) => {
    e.stopPropagation();
    lastTouchAt.current = e.timeStamp;
    if (e.touches.length === 2) {
      const [p, q] = [e.touches[0], e.touches[1]];
      pinch.current = { d: dist(p, q), s: scale, c: mid(p, q) };
      pan.current = null; swipe.current = null;
      clearTimeout(tapTimer.current);
      setInteracting(true);
      return;
    }
    if (e.touches.length !== 1) return;
    const t = e.touches[0];
    if (zoomed) { pan.current = { x: t.clientX - tx, y: t.clientY - ty, moved: false }; setInteracting(true); }
    else swipe.current = { x: t.clientX, y: t.clientY, dx: 0, dy: 0, axis: null, t: e.timeStamp };
  };
  const onTouchMove = (e) => {
    e.stopPropagation();
    if (pinch.current && e.touches.length === 2) {
      const [p, q] = [e.touches[0], e.touches[1]];
      const g = pinch.current;
      const next = clamp(g.s * (dist(p, q) / (g.d || 1)), MIN, MAX);
      const c = mid(p, q);
      const el = stageRef.current; if (!el) return;
      const r = el.getBoundingClientRect();
      const cx = c.x - (r.left + r.width / 2), cy = c.y - (r.top + r.height / 2);
      const k = 1 - next / g.s;
      const pp = clampPan(cx * k, cy * k, next);
      setScale(next); setTx(pp.x); setTy(pp.y);
      return;
    }
    const t = e.touches[0]; if (!t) return;
    if (pan.current && zoomed) {
      pan.current.moved = true;
      const p = clampPan(t.clientX - pan.current.x, t.clientY - pan.current.y, scale);
      setTx(p.x); setTy(p.y);
      return;
    }
    const s = swipe.current; if (!s) return;
    s.dx = t.clientX - s.x; s.dy = t.clientY - s.y;
    if (!s.axis) {
      if (Math.abs(s.dx) < 8 && Math.abs(s.dy) < 8) return;
      s.axis = Math.abs(s.dx) > Math.abs(s.dy) ? 'x' : 'y';
      setInteracting(true);
    }
    const track = trackRef.current; if (!track) return;
    if (s.axis === 'x') {
      const atEdge = (index <= 0 && s.dx > 0) || (index >= atts.length - 1 && s.dx < 0);
      track.style.transition = 'none';
      track.style.transform = `translate3d(${atEdge ? s.dx * 0.25 : s.dx}px, 0, 0)`;
    } else if (s.dy > 0) {
      track.style.transition = 'none';
      track.style.transform = `translate3d(0, ${s.dy}px, 0) scale(${1 - Math.min(s.dy, 300) / 1200})`;
      track.style.opacity = String(1 - Math.min(s.dy, 300) / 400);
    }
  };
  const onTouchEnd = (e) => {
    e.stopPropagation();
    lastTouchAt.current = e.timeStamp;
    if (pinch.current && e.touches.length < 2) { pinch.current = null; setInteracting(false); if (scale <= 1.05) reset(); return; }
    if (pan.current) {
      const moved = pan.current.moved; pan.current = null; setInteracting(false);
      if (!moved) tapOrDoubleTap(e.changedTouches[0], e.timeStamp);
      return;
    }
    const s = swipe.current; swipe.current = null;
    setInteracting(false);
    const track = trackRef.current;
    if (!s) return;
    if (!s.axis) { tapOrDoubleTap(e.changedTouches[0], e.timeStamp); return; }
    const fast = Math.abs(s.dx) > 30 && (e.timeStamp - s.t) < 250;
    if (s.axis === 'x' && track) {
      const w = track.offsetWidth || window.innerWidth;
      const dir = s.dx < 0 ? 1 : -1;
      const next = index + dir;
      if ((Math.abs(s.dx) > w * 0.28 || fast) && next >= 0 && next < atts.length) {
        track.style.transition = 'transform 180ms ease-out';
        track.style.transform = `translate3d(${dir > 0 ? -w : w}px, 0, 0)`;
        setTimeout(() => { onNav(dir); if (trackRef.current) { trackRef.current.style.transition = 'none'; trackRef.current.style.transform = ''; } }, 180);
      } else {
        track.style.transition = 'transform 180ms ease-out';
        track.style.transform = '';
      }
    } else if (s.axis === 'y' && track) {
      if (s.dy > 90 || (s.dy > 30 && (e.timeStamp - s.t) < 250)) { onClose(); return; }
      track.style.transition = 'transform 180ms ease-out, opacity 180ms ease-out';
      track.style.transform = ''; track.style.opacity = '';
    }
  };
  // One tap toggles the controls; a second within 300ms zooms instead.
  const tapOrDoubleTap = (t, now) => {
    if (!t) return;
    if (now - lastTap.current < 300) {
      clearTimeout(tapTimer.current); lastTap.current = 0;
      if (zoomed) reset(); else zoomAbout(2.5, t.clientX, t.clientY);
      return;
    }
    lastTap.current = now;
    tapTimer.current = setTimeout(() => { setChrome(c => !c); }, 300);
  };

  // ── mouse / wheel ─────────────────────────────────────────────────────
  const onWheel = (e) => { zoomAbout(scale * (e.deltaY < 0 ? 1.15 : 1 / 1.15), e.clientX, e.clientY); };
  const onMouseDown = (e) => {
    if (!zoomed) return;
    e.preventDefault();
    pan.current = { x: e.clientX - tx, y: e.clientY - ty, moved: false };
    setInteracting(true);
  };
  useEffect(() => {
    const move = (e) => { if (!pan.current) return; pan.current.moved = true; const p = clampPan(e.clientX - pan.current.x, e.clientY - pan.current.y, scale); setTx(p.x); setTy(p.y); };
    const up = () => { if (pan.current) { pan.current = null; setInteracting(false); } };
    window.addEventListener('mousemove', move); window.addEventListener('mouseup', up);
    return () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
  }, [scale, clampPan]);
  // React binds touchmove and wheel passively; the page underneath must not
  // scroll or pinch-zoom while the gesture is ours.
  useEffect(() => {
    const el = stageRef.current; if (!el) return undefined;
    const stop = (e) => { e.preventDefault(); };
    el.addEventListener('touchmove', stop, { passive: false });
    el.addEventListener('wheel', stop, { passive: false });
    return () => { el.removeEventListener('touchmove', stop); el.removeEventListener('wheel', stop); };
  }, [a?.id]);

  // ── actions ───────────────────────────────────────────────────────────
  const say = (text, ok = true) => {
    clearTimeout(toastTimer.current);
    setToast({ text, ok });
    toastTimer.current = setTimeout(() => setToast(null), 2200);
  };
  const doCopy = async () => {
    if (busy) return;
    setBusy(true);
    const r = await copyImage(a, { share: canShare ? share : null });
    setBusy(false);
    if (r === 'copied') say('Copied — paste it into a text or a message');
    else if (r === 'shared') return;
    else say('This browser cannot copy images — use Download', false);
  };

  if (!a) return null;

  const node = (
    <div className="fixed inset-0 z-[80] bg-black select-none" role="dialog" aria-modal="true" aria-label={a.filename}
      data-attachment-viewer
      onClick={onClose}
      onTouchStart={e => e.stopPropagation()} onTouchMove={e => e.stopPropagation()} onTouchEnd={e => e.stopPropagation()}>

      {/* top bar */}
      <div className={`absolute top-0 inset-x-0 z-20 flex items-center gap-2 px-2 pt-[max(env(safe-area-inset-top),0.5rem)] pb-2 bg-gradient-to-b from-black/70 to-transparent transition-opacity ${chrome ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
        onClick={e => e.stopPropagation()}>
        <button type="button" onClick={onClose} aria-label="Close" className="p-2 rounded-full text-white/90 hover:bg-white/15 active:bg-white/25"><X size={22} /></button>
        <div className="min-w-0 flex-1 text-white/90 text-sm">
          <div className="truncate">{a.filename}</div>
          <div className="text-[11px] text-white/55 truncate">{atts.length > 1 ? `${index + 1} of ${atts.length} · ` : ''}{fmtSize(a.size)}{a.uploaded_by ? ` · ${a.uploaded_by}` : ''}</div>
        </div>
        {isImage && (
          <div className="hidden md:flex items-center gap-0.5 text-white/90" data-zoom-controls>
            <button type="button" onClick={() => zoomBy(1 / 1.25)} aria-label="Zoom out" className="p-2 rounded-full hover:bg-white/15"><ZoomOut size={18} /></button>
            <button type="button" onClick={() => (zoomed ? reset() : zoomBy(2))} className="min-w-[3.5rem] text-center text-xs tabular-nums px-1 py-1 rounded hover:bg-white/15" title={zoomed ? 'Fit to screen' : 'Zoom in'}>{Math.round(scale * 100)}%</button>
            <button type="button" onClick={() => zoomBy(1.25)} aria-label="Zoom in" className="p-2 rounded-full hover:bg-white/15"><ZoomIn size={18} /></button>
          </div>
        )}
      </div>

      {/* prev / next — mouse users; touch swipes */}
      {atts.length > 1 && chrome && (
        <>
          <button type="button" onClick={e => { e.stopPropagation(); onNav(-1); }} aria-label="Previous"
            className="hidden md:flex absolute left-3 top-1/2 -translate-y-1/2 z-20 p-3 rounded-full bg-white/10 text-white hover:bg-white/25"><ChevronLeft size={26} /></button>
          <button type="button" onClick={e => { e.stopPropagation(); onNav(1); }} aria-label="Next"
            className="hidden md:flex absolute right-3 top-1/2 -translate-y-1/2 z-20 p-3 rounded-full bg-white/10 text-white hover:bg-white/25"><ChevronRight size={26} /></button>
        </>
      )}

      {/* the stage */}
      <div ref={trackRef} className="absolute inset-0 flex items-center justify-center will-change-transform"
        onClick={e => e.stopPropagation()}>
        {isImage && !broken ? (
          <div ref={stageRef} className="w-full h-full flex items-center justify-center overflow-hidden"
            style={{ touchAction: 'none' }}
            onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd} onTouchCancel={onTouchEnd}
            onWheel={onWheel} onMouseDown={onMouseDown}
            onClick={e => { e.stopPropagation(); if (fromTouch(e) || pan.current?.moved) return; setChrome(c => !c); }}
            onDoubleClick={e => { e.stopPropagation(); if (fromTouch(e)) return; setChrome(true); if (zoomed) reset(); else zoomAbout(2.5, e.clientX, e.clientY); }}>
            <ZoomStage src={a.url} alt={a.filename} scale={scale} tx={tx} ty={ty} interacting={interacting} onBroken={() => setBroken(true)} />
          </div>
        ) : videoPlayable(a) && a.url ? (
          <video src={a.url} controls playsInline autoPlay className="max-w-[96vw] max-h-[80vh] bg-black rounded-lg" />
        ) : isPdf(a) && a.url && compact ? (
          <div className="bg-white rounded-xl p-6 flex flex-col items-center gap-3 min-w-[260px] max-w-[88vw]" data-pdf-card>
            <FileText size={40} className="text-powder-600" />
            <div className="text-sm font-medium text-gray-900 text-center break-all">{a.filename}</div>
            <div className="text-xs text-gray-400">{fmtSize(a.size)}</div>
            <div className="text-[11px] text-gray-500 text-center">Opens in your phone's own viewer, where you can pinch to zoom.</div>
            <a href={a.url} target="_blank" rel="noreferrer"
              className="mt-1 inline-flex items-center gap-1.5 px-4 py-2 bg-powder-600 text-white text-sm font-medium rounded-lg hover:bg-powder-700">
              <ExternalLink size={15} /> Open
            </a>
          </div>
        ) : isPdf(a) && a.url ? (
          <div className="relative w-[98vw] h-[86vh] max-w-6xl">
            <iframe src={pdfViewerUrl(a.url)} title={a.filename} className="w-full h-full bg-white rounded-lg" />
            <a href={a.url} target="_blank" rel="noreferrer"
              className="absolute bottom-2 left-1/2 -translate-x-1/2 inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-gray-900/85 text-white text-xs font-medium shadow-lg hover:bg-gray-900">
              <ExternalLink size={13} /> Open full size
            </a>
          </div>
        ) : (
          <div className="bg-white rounded-xl p-6 flex flex-col items-center gap-3 min-w-[260px] max-w-[88vw]">
            <FileText size={40} className="text-powder-600" />
            <div className="text-sm font-medium text-gray-900 text-center break-all">{a.filename}</div>
            <div className="text-xs text-gray-400">{fmtSize(a.size)}</div>
            {(a.is_image && !browserRenderable(a)) && <div className="text-[11px] text-gray-500 text-center">This photo format (HEIC/TIFF) can't be shown in the browser — download it to view.</div>}
            {broken && <div className="text-[11px] text-gray-500 text-center">This photo could not be displayed — download it to view.</div>}
            <button type="button" onClick={() => download(a)} className="mt-1 flex items-center gap-1.5 px-4 py-2 bg-powder-600 text-white text-sm font-medium rounded-lg hover:bg-powder-700"><Download size={15} /> Download</button>
          </div>
        )}
      </div>

      {/* zoom pill — only while zoomed, so at fit nothing sits on the picture */}
      {isImage && zoomed && (
        <button type="button" onClick={e => { e.stopPropagation(); reset(); }} data-zoom-pill
          className="absolute left-1/2 -translate-x-1/2 z-20 bottom-[calc(env(safe-area-inset-bottom)+4.5rem)] inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-black/70 text-white text-xs font-medium shadow">
          <Maximize2 size={12} /> {scale.toFixed(1)}× · fit
        </button>
      )}

      {/* actions */}
      <div className={`absolute bottom-0 inset-x-0 z-20 flex items-center justify-center gap-1 px-2 pt-3 pb-[max(env(safe-area-inset-bottom),0.75rem)] bg-gradient-to-t from-black/75 to-transparent transition-opacity ${chrome ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
        onClick={e => e.stopPropagation()} data-viewer-actions>
        {isImage && (canCopyImage || canShare) && (
          <button type="button" onClick={doCopy} disabled={busy} data-action="copy"
            className="flex flex-col items-center gap-0.5 min-w-[4.5rem] px-2 py-1.5 rounded-lg text-white/90 hover:bg-white/15 active:bg-white/25 disabled:opacity-60">
            <Copy size={20} /><span className="text-[11px]">Copy</span>
          </button>
        )}
        {canShare && (
          <button type="button" onClick={() => share(a)} data-action="share"
            className="flex flex-col items-center gap-0.5 min-w-[4.5rem] px-2 py-1.5 rounded-lg text-white/90 hover:bg-white/15 active:bg-white/25">
            <Share2 size={20} /><span className="text-[11px]">Share</span>
          </button>
        )}
        <button type="button" onClick={() => download(a)} data-action="download"
          className="flex flex-col items-center gap-0.5 min-w-[4.5rem] px-2 py-1.5 rounded-lg text-white/90 hover:bg-white/15 active:bg-white/25">
          <Download size={20} /><span className="text-[11px]">Download</span>
        </button>
        {a.url && (
          <a href={a.url} target="_blank" rel="noreferrer" data-action="open"
            className="flex flex-col items-center gap-0.5 min-w-[4.5rem] px-2 py-1.5 rounded-lg text-white/90 hover:bg-white/15 active:bg-white/25">
            <ExternalLink size={20} /><span className="text-[11px]">Open</span>
          </a>
        )}
      </div>

      {toast && (
        <div data-viewer-toast className={`absolute left-1/2 -translate-x-1/2 z-30 top-[calc(env(safe-area-inset-top)+4rem)] inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full text-sm shadow-lg ${toast.ok ? 'bg-white text-gray-900' : 'bg-amber-100 text-amber-900'}`}>
          {toast.ok && <Check size={15} className="text-green-600" />}{toast.text}
        </div>
      )}
    </div>
  );
  return createPortal(node, document.body);
}
