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

  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = c.getBoundingClientRect();
    c.width = rect.width * dpr;
    c.height = rect.height * dpr;
    const ctx = c.getContext('2d');
    ctx.scale(dpr, dpr);
    ctx.lineWidth = 2.2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#1e3a8a'; // signature-pen blue
  }, []);

  const pos = (e) => {
    const rect = canvasRef.current.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };
  const down = (e) => {
    e.preventDefault();
    canvasRef.current.setPointerCapture?.(e.pointerId);
    drawingRef.current = true;
    const ctx = canvasRef.current.getContext('2d');
    const p = pos(e);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    // A dot counts — some initials are dots.
    ctx.lineTo(p.x + 0.1, p.y + 0.1);
    ctx.stroke();
    setHasInk(true);
  };
  const move = (e) => {
    if (!drawingRef.current) return;
    const ctx = canvasRef.current.getContext('2d');
    const p = pos(e);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
  };
  const up = () => { drawingRef.current = false; };

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
        onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerLeave={up}
        className="w-full h-40 border-2 border-dashed border-gray-300 rounded-xl bg-gray-50 touch-none cursor-crosshair" />
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
