import { useState } from 'react';
import { Copy, Check } from 'lucide-react';

// The public and semi-public ways in: the QR-code work order form, the end-of-
// day entry form, and the auditor portal.
//
// window.location.origin is safe here, unlike in server-side link building:
// the launcher host 302s every GET except the bare landing request, so the app
// itself can only ever be running on the ReadyDoc origin. A link built from
// where this page is loaded is therefore already the right host.

const LINKS = [
  {
    path: '/submit',
    title: 'Work Order Submission',
    blurb: 'Public form for anyone to submit a work order. Accessible via QR code — no login required.',
    tone: 'border-gray-200', code: 'text-powder-600',
  },
  {
    path: '/production-entry',
    title: 'End of Day / Production Entry',
    blurb: 'SQF production report form for supervisors. Requires login — tracks who submitted each entry.',
    tone: 'border-green-200', code: 'text-green-600',
    note: null,
  },
  {
    path: '/auditor',
    title: 'Auditor Portal',
    blurb: 'Read-only compliance view with export functionality. Give this link to auditors.',
    tone: 'border-purple-200', code: 'text-purple-600',
    note: 'Auditor signs in as auditor@powder-ops.com and sets a password on first sign-in.',
  },
];

export default function ShareableLinksSection() {
  const [copied, setCopied] = useState(null);
  const origin = window.location.origin;

  const copy = async (url) => {
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(url);
      else {
        // A plant tablet on plain http has no secure context and therefore no
        // clipboard API — fall back rather than failing silently.
        const ta = document.createElement('textarea');
        ta.value = url; ta.style.position = 'fixed'; ta.style.opacity = '0';
        document.body.appendChild(ta); ta.select(); document.execCommand('copy');
        document.body.removeChild(ta);
      }
      setCopied(url);
      setTimeout(() => setCopied(c => (c === url ? null : c)), 2000);
    } catch { /* nothing useful to say */ }
  };

  return (
    <div className="space-y-3">
      {LINKS.map(l => {
        const url = `${origin}${l.path}`;
        return (
          <div key={l.path} className={`bg-white rounded-xl border p-4 ${l.tone}`}>
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div className="min-w-0">
                <h3 className="font-semibold text-gray-900">{l.title}</h3>
                <p className="text-sm text-gray-500">{l.blurb}</p>
                <code className={`text-xs mt-1 block break-all ${l.code}`}>{url}</code>
                {l.note && <p className="text-xs text-gray-400 mt-1">{l.note}</p>}
              </div>
              <button onClick={() => copy(url)}
                className="px-3 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm hover:bg-gray-200 flex items-center gap-1 shrink-0">
                {copied === url ? <><Check size={14} className="text-green-600" /> Copied!</> : <><Copy size={14} /> Copy</>}
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
