import { useRef, useState, useEffect, useCallback } from 'react';
import { apiFetch, apiPost } from '../../hooks/useApi';
import { X, Eraser, Check } from 'lucide-react';

/**
 * The signature pad — drawn once, applied wherever the person signs.
 *
 * Pointer events, so a finger on a phone and a mouse on a desktop are the same
 * code path. The canvas backing store is scaled by devicePixelRatio or the
 * export comes out blurry on exactly the screens people sign on. The export is
 * a plain PNG data URL; the server stores it and every applied signature keeps
 * its own snapshot.
 */
export function SignaturePad({ onSave, onCancel, saving }) {
  const canvasRef = useRef(null);
  const drawingRef = useRef(false);
  const [hasInk, setHasInk] = useState(false);

  // THE BOX CAN CHANGE SIZE UNDER THE PAD, AND THE INK MUST SURVIVE IT.
  //
  // Sizing the backing store once on mount was fine while the lobby tablet was
  // locked to portrait. It stopped being fine the moment rotation was allowed:
  // the CSS box gets a new width, the backing store keeps the old one, and from
  // then on the line lands somewhere other than the finger — which reads as the
  // pad being broken rather than as a resize. So it re-fits, and it carries the
  // existing strokes across rather than clearing them, because losing a
  // half-drawn signature to a rotation is worse than the offset was.
  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return undefined;
    let last = { w: 0, h: 0 };

    const fit = () => {
      const rect = c.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const dpr = window.devicePixelRatio || 1;
      const w = Math.round(rect.width * dpr);
      const h = Math.round(rect.height * dpr);
      // A no-op when nothing moved. The on-screen keyboard fires resize on some
      // browsers without the pad changing at all, and re-blitting a canvas on
      // every keystroke would soften the strokes a little each time.
      if (w === last.w && h === last.h) return;

      // Keep whatever has been drawn, scaled into the new box.
      let previous = null;
      if (last.w && last.h) {
        previous = document.createElement('canvas');
        previous.width = last.w; previous.height = last.h;
        previous.getContext('2d').drawImage(c, 0, 0);
      }

      c.width = w; c.height = h;
      last = { w, h };
      const ctx = c.getContext('2d');
      ctx.scale(dpr, dpr);
      ctx.lineWidth = 2.2;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = '#1e3a8a'; // signature-pen blue
      if (previous) ctx.drawImage(previous, 0, 0, rect.width, rect.height);
    };

    fit();
    // ResizeObserver catches a layout change the window never hears about — a
    // column becoming a row beside it, a panel opening. `orientationchange`
    // fires before the new size is settled on iOS, so re-fit on the next frame.
    const ro = new ResizeObserver(fit);
    ro.observe(c);
    const onRotate = () => requestAnimationFrame(fit);
    window.addEventListener('orientationchange', onRotate);
    return () => { ro.disconnect(); window.removeEventListener('orientationchange', onRotate); };
  }, []);

  const pos = (e) => {
    const rect = canvasRef.current.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  // A STROKE MUST SURVIVE LEAVING THE BOX AND MUST NEVER BECOME A SCROLL.
  //
  // Reported from the lobby tablet: "it starts to sign, then it starts to
  // affect the scroll, almost like the touch isn't read continually." Three
  // things caused that together, and only fixing all three makes a finger
  // behave like a pen:
  //
  //  * `setPointerCapture` was called on the canvas and simply not honoured
  //    part-way through a stroke on iPad Safari, after which no further move
  //    events reached the canvas at all. The stroke stopped dead and the
  //    browser took the gesture back as a pan. Moves and the release are now
  //    tracked on the WINDOW for the life of the stroke, so losing capture
  //    costs nothing.
  //  * `onPointerLeave` ended the stroke. A signature routinely runs past the
  //    edge of a 160px box — the tail of a "y", the cross of a "t" — and each
  //    time it did, the pen lifted. It ends on release or cancellation now,
  //    not on leaving.
  //  * `preventDefault` was called on the first touch only. `touch-action:
  //    none` handles most of it, but a move that is not also defaulted can
  //    still start a scroll on iOS once the gesture is in flight.
  const endStroke = () => {
    drawingRef.current = false;
    window.removeEventListener('pointermove', winMove);
    window.removeEventListener('pointerup', endStroke);
    window.removeEventListener('pointercancel', endStroke);
  };
  const drawTo = (e) => {
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    const p = pos(e);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
  };
  const winMove = (e) => {
    if (!drawingRef.current) return;
    if (e.cancelable) e.preventDefault();
    drawTo(e);
  };
  const down = (e) => {
    e.preventDefault();
    try { canvasRef.current.setPointerCapture?.(e.pointerId); } catch { /* not honoured everywhere */ }
    drawingRef.current = true;
    const ctx = canvasRef.current.getContext('2d');
    const p = pos(e);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    // A dot counts — some initials are dots.
    ctx.lineTo(p.x + 0.1, p.y + 0.1);
    ctx.stroke();
    setHasInk(true);
    // Passive listeners cannot preventDefault, and preventing the default is
    // the half that stops the page panning mid-signature.
    window.addEventListener('pointermove', winMove, { passive: false });
    window.addEventListener('pointerup', endStroke);
    window.addEventListener('pointercancel', endStroke);
  };
  const move = (e) => {
    // The window listener does the work while a stroke is live; this only
    // matters for a mouse that never left the canvas.
    if (!drawingRef.current) return;
    if (e.cancelable) e.preventDefault();
    drawTo(e);
  };

  // A stroke in flight when the pad unmounts would leave listeners on window.
  useEffect(() => endStroke, []);

  const clear = () => {
    const c = canvasRef.current;
    const ctx = c.getContext('2d');
    ctx.clearRect(0, 0, c.width, c.height);
    setHasInk(false);
  };

  const save = () => {
    if (!hasInk) return;
    onSave(canvasRef.current.toDataURL('image/png'));
  };

  return (
    <div className="space-y-2">
      {/* touch-none: the page must not scroll out from under a signature. */}
      <canvas ref={canvasRef}
        onPointerDown={down} onPointerMove={move}
        style={{ touchAction: 'none', overscrollBehavior: 'contain' }}
        className="w-full h-40 sm:h-48 border-2 border-dashed border-gray-300 rounded-xl bg-gray-50 touch-none cursor-crosshair select-none" />
      <p className="text-[11px] text-gray-500">Sign above with your finger or mouse — the way you would on paper.</p>
      <div className="flex gap-2">
        <button type="button" onClick={save} disabled={!hasInk || saving}
          className="inline-flex items-center gap-1.5 px-3 py-2 bg-powder-600 text-white rounded-lg text-sm font-medium disabled:opacity-50">
          <Check size={14} /> {saving ? 'Saving…' : 'Save signature'}
        </button>
        <button type="button" onClick={clear} disabled={!hasInk}
          className="inline-flex items-center gap-1.5 px-3 py-2 border border-gray-300 rounded-lg text-sm disabled:opacity-40">
          <Eraser size={14} /> Clear
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel} className="px-3 py-2 text-sm text-gray-500 hover:text-gray-700">Cancel</button>
        )}
      </div>
    </div>
  );
}

/**
 * Account-menu modal: view / draw / replace your stored signature. Replacing
 * changes only what FUTURE signings apply — anything already signed keeps the
 * snapshot it was signed with, which is what makes replacement safe.
 */
export default function SignatureModal({ onClose }) {
  const [current, setCurrent] = useState(undefined); // undefined = loading
  const [drawing, setDrawing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const r = await apiFetch('/users/me/signature');
      setCurrent(r.signature_image || null);
      if (!r.signature_image) setDrawing(true);
    } catch (e) { setError(e.message); setCurrent(null); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const save = async (image) => {
    setSaving(true); setError('');
    try {
      await apiPost('/users/me/signature', { image });
      setCurrent(image);
      setDrawing(false);
    } catch (e) { setError(e.message); }
    finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div onClick={e => e.stopPropagation()} className="bg-white rounded-xl shadow-xl w-full max-w-md p-5 space-y-3 max-h-[92vh] overflow-y-auto">
        <div className="flex items-start justify-between">
          <div>
            <h3 className="font-bold text-gray-900">My signature</h3>
            <p className="text-xs text-gray-500 mt-0.5">
              Drawn once, applied when you sign a controlled document. Documents already signed keep the signature they were signed with.
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700"><X size={18} /></button>
        </div>

        {current === undefined ? (
          <p className="text-sm text-gray-400 py-6 text-center">Loading…</p>
        ) : drawing ? (
          <SignaturePad onSave={save} saving={saving} onCancel={current ? () => setDrawing(false) : null} />
        ) : (
          <div className="space-y-2">
            <div className="border border-gray-200 rounded-xl bg-gray-50 p-3 flex items-center justify-center">
              <img src={current} alt="Your signature" className="max-h-28" />
            </div>
            <button type="button" onClick={() => setDrawing(true)}
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm font-medium hover:bg-gray-50">
              Draw a new one
            </button>
          </div>
        )}
        {error && <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg p-2">{error}</p>}
      </div>
    </div>
  );
}
