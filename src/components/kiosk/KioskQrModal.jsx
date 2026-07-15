import { useState, useEffect } from 'react';
import { X, Printer } from 'lucide-react';
import QRCode from 'qrcode';

// Printable QR poster for a module's public kiosk page. The QR encodes the
// absolute kiosk URL so a floor user can scan it and complete the form on a
// phone/tablet without logging in. `cfg` supplies:
//   kioskPath (required), label (required), formCode, kioskTagline, kioskBlurb.
export default function KioskQrModal({ cfg, onClose }) {
  const [dataUrl, setDataUrl] = useState('');
  const url = `${window.location.origin}${cfg.kioskPath}`;
  const tagline = cfg.kioskTagline || 'Scan to Open the Form';
  const blurb = cfg.kioskBlurb || 'Print and post this QR where staff need it. Scanning it opens the form — no login required.';

  useEffect(() => {
    QRCode.toDataURL(url, { width: 512, margin: 1, errorCorrectionLevel: 'M' })
      .then(setDataUrl).catch(() => setDataUrl(''));
  }, [url]);

  const print = () => {
    const w = window.open('', '_blank', 'width=800,height=900');
    if (!w) return;
    w.document.write(`<!doctype html><html><head><title>${cfg.label} — ${tagline}</title>
      <style>
        *{margin:0;padding:0;box-sizing:border-box;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
        body{display:flex;align-items:center;justify-content:center;min-height:100vh;padding:48px}
        .poster{text-align:center;max-width:560px;border:3px solid #0284c7;border-radius:24px;padding:48px 40px}
        h1{font-size:34px;font-weight:800;color:#0f172a;margin-bottom:6px}
        h2{font-size:19px;font-weight:600;color:#0284c7;margin-bottom:28px}
        img{width:340px;height:340px;margin:0 auto 24px}
        p.scan{font-size:22px;font-weight:700;color:#0f172a;margin-bottom:8px}
        p.url{font-size:14px;color:#64748b;word-break:break-all}
        p.code{margin-top:20px;font-size:12px;color:#94a3b8}
      </style></head><body onload="window.print()">
      <div class="poster">
        <h1>${cfg.label}</h1>
        <h2>${tagline}</h2>
        <img src="${dataUrl}" alt="QR code" />
        <p class="scan">📷 Scan with your phone camera</p>
        <p class="url">${url}</p>
        <p class="code">${cfg.formCode || ''}</p>
      </div></body></html>`);
    w.document.close();
  };

  return (
    <div className="fixed inset-0 bg-black/30 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div onClick={e => e.stopPropagation()} className="bg-white rounded-xl shadow-xl w-full max-w-sm p-6 space-y-4 text-center">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-gray-900">Post this at the station</h3>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded-lg"><X size={18} className="text-gray-500" /></button>
        </div>
        <p className="text-sm text-gray-500">{blurb}</p>
        {dataUrl
          ? <img src={dataUrl} alt="Kiosk QR code" className="w-56 h-56 mx-auto border border-gray-200 rounded-lg" />
          : <div className="w-56 h-56 mx-auto bg-gray-50 border border-gray-200 rounded-lg flex items-center justify-center text-gray-400 text-sm">Generating…</div>}
        <a href={cfg.kioskPath} target="_blank" rel="noreferrer" className="block text-xs text-powder-600 hover:underline break-all">{url}</a>
        <div className="flex items-center gap-2">
          <button onClick={print} disabled={!dataUrl} className="flex-1 px-4 py-2 bg-powder-600 text-white text-sm font-medium rounded-lg hover:bg-powder-700 disabled:opacity-40 flex items-center justify-center gap-1.5"><Printer size={15} /> Print poster</button>
          <button onClick={onClose} className="px-4 py-2 bg-gray-100 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-200">Close</button>
        </div>
      </div>
    </div>
  );
}
