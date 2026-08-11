import { useState, useEffect } from 'react';
import { CheckCircle, XCircle, AlertTriangle, FileText, ExternalLink } from 'lucide-react';

/**
 * Public NFP approval page, opened from a texted link — no login.
 *
 * The difference from the flavor-approval page is the panel itself. A flavour
 * approval is a decision about something the approver already tasted; a
 * nutrition panel is a decision about a document, and approving one you have not
 * read is a rubber stamp. So the panel is embedded here and the server refuses
 * to issue a link at all when there is nothing to show.
 *
 * The name field is required. This is a regulatory sign-off and the link cannot
 * know who is holding it — "approved" with nobody's name on it is not an
 * approval, and the record has to be able to say who gave it.
 */
export default function NfpApprovePage({ token }) {
  const [info, setInfo] = useState(null);
  const [error, setError] = useState('');
  const [name, setName] = useState('');
  const [comments, setComments] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);
  const [confirming, setConfirming] = useState(null);

  useEffect(() => {
    fetch(`/api/nfp-link/${encodeURIComponent(token)}`)
      .then((r) => r.json().then((d) => {
        if (!r.ok) throw new Error(d.error || 'Link error');
        setInfo(d);
        // Pre-filled from who it was sent to, still editable — the panel may
        // have been handed to a colleague, and the record should say so.
        if (d.sent_to) setName(d.sent_to);
      }))
      .catch((e) => setError(e.message));
  }, [token]);

  const decide = async (decision) => {
    setBusy(true); setError('');
    try {
      const r = await fetch(`/api/nfp-link/${encodeURIComponent(token)}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision, name, comments }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Something went wrong');
      setDone(decision);
    } catch (e) { setError(e.message); setConfirming(null); }
    finally { setBusy(false); }
  };

  if (done) {
    const ok = done === 'approved';
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
        <div className="text-center max-w-sm">
          {ok ? <CheckCircle size={64} className="mx-auto mb-4 text-green-500" />
            : <XCircle size={64} className="mx-auto mb-4 text-red-500" />}
          <h1 className="text-2xl font-bold text-gray-900 mb-1">Panel {ok ? 'Approved' : 'Sent back'}</h1>
          <p className="text-gray-600">
            {ok
              ? 'Recorded against your name. Artwork can now be released against this panel.'
              : 'Recorded with your note. Whoever sent this has been told.'}
          </p>
          <p className="text-sm text-gray-500 mt-2">You can close this page.</p>
        </div>
      </div>
    );
  }

  if (error && !info) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
        <div className="text-center max-w-sm">
          <AlertTriangle size={48} className="mx-auto mb-3 text-amber-500" />
          <p className="text-gray-700 font-medium">{error}</p>
          <p className="text-sm text-gray-500 mt-1">Ask for a fresh link if you still need to review this panel.</p>
        </div>
      </div>
    );
  }

  const canDecide = name.trim().length >= 2;

  return (
    <div className="min-h-screen bg-gray-50 px-4 py-8">
      <div className="max-w-lg mx-auto">
        <div className="text-center mb-5">
          <div className="h-12 w-12 bg-powder-600 rounded-xl flex items-center justify-center mx-auto mb-3">
            <FileText size={24} className="text-white" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900">Nutrition Panel Approval</h1>
          <p className="text-sm text-gray-500 mt-1">
            {info ? `${info.product} · panel ${info.version}` : 'Loading…'}
          </p>
        </div>

        {!info ? <p className="text-center text-gray-400">Loading…</p> : (
          <div className="space-y-4">
            <div className="bg-white rounded-2xl border border-gray-200 p-5 shadow-sm">
              <dl className="space-y-2">
                {[['SKU', info.sku], ['Product', info.product], ['Pack', info.pack],
                  ['Panel version', info.version], ['Serving size', info.serving_size],
                  ['Servings per container', info.servings_per_container],
                  ['Formula revision', info.formula_rev], ['Sent by', info.sent_by]]
                  .filter(([, v]) => v).map(([k, v]) => (
                    <div key={k} className="flex justify-between gap-3 text-sm">
                      <dt className="text-gray-500">{k}</dt>
                      <dd className="font-semibold text-gray-900 text-right">{v}</dd>
                    </div>
                  ))}
              </dl>
              {info.change_summary && (
                <p className="mt-3 text-sm text-gray-700 bg-gray-50 rounded-lg p-3">
                  <span className="text-xs font-medium text-gray-500 block mb-0.5">What changed</span>
                  {info.change_summary}
                </p>
              )}
            </div>

            {/* The panel. This is the thing being approved, so it is shown at a
                size you can actually read on a phone rather than as a link. */}
            {info.panels?.length > 0 ? (
              <div className="space-y-3">
                {info.panels.map((f, i) => (
                  <div key={i} className="bg-white rounded-2xl border border-gray-200 overflow-hidden shadow-sm">
                    {(f.content_type || '').startsWith('image/') ? (
                      <img src={f.url} alt={f.filename} className="w-full" />
                    ) : (
                      <object data={f.url} type={f.content_type || 'application/pdf'}
                        className="w-full h-[60vh] min-h-[420px]">
                        <div className="p-5 text-center">
                          <p className="text-sm text-gray-600 mb-2">This panel cannot be shown inline on this device.</p>
                          <a href={f.url} target="_blank" rel="noreferrer"
                            className="inline-flex items-center gap-1.5 text-sm font-medium text-powder-700">
                            Open {f.filename} <ExternalLink size={14} />
                          </a>
                        </div>
                      </object>
                    )}
                    <div className="px-4 py-2 border-t border-gray-100 flex items-center justify-between gap-2">
                      <span className="text-xs text-gray-500 truncate">{f.filename}</span>
                      <a href={f.url} target="_blank" rel="noreferrer"
                        className="text-xs font-medium text-powder-700 shrink-0 inline-flex items-center gap-1">
                        Open <ExternalLink size={12} />
                      </a>
                    </div>
                  </div>
                ))}
              </div>
            ) : info.drive_url ? (
              <a href={info.drive_url} target="_blank" rel="noreferrer"
                className="block bg-white rounded-2xl border border-gray-200 p-5 text-center shadow-sm">
                <FileText size={28} className="mx-auto mb-2 text-powder-600" />
                <span className="text-sm font-semibold text-gray-900 inline-flex items-center gap-1.5">
                  Open the panel <ExternalLink size={14} />
                </span>
                <span className="block text-xs text-gray-500 mt-1">Please read it before deciding.</span>
              </a>
            ) : null}

            <div className="bg-white rounded-2xl border border-gray-200 p-5 shadow-sm space-y-3">
              <label className="block">
                <span className="text-xs font-medium text-gray-600">Your name</span>
                <input value={name} onChange={(e) => setName(e.target.value)}
                  placeholder="Who is approving this"
                  className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-xl text-base" />
                <span className="text-[11px] text-gray-500">The approval is recorded against this name.</span>
              </label>
              <textarea value={comments} onChange={(e) => setComments(e.target.value)} rows={2}
                placeholder="Comments (required if sending back)"
                className="w-full px-3 py-2 border border-gray-300 rounded-xl text-base" />
              {error && <p className="text-sm text-red-600">{error}</p>}

              {confirming ? (
                <div className="space-y-2">
                  <p className="text-sm text-center font-medium text-gray-700">
                    {confirming === 'approved'
                      ? `Approve panel ${info.version} for ${info.sku}?`
                      : `Send panel ${info.version} back for correction?`}
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    <button onClick={() => decide(confirming)} disabled={busy}
                      className={`py-3 rounded-xl text-white font-bold disabled:opacity-50 ${confirming === 'approved' ? 'bg-green-600' : 'bg-red-600'}`}>
                      {busy ? 'Saving…' : 'Yes, confirm'}
                    </button>
                    <button onClick={() => setConfirming(null)} disabled={busy}
                      className="py-3 rounded-xl bg-gray-100 text-gray-700 font-bold">Back</button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-2 gap-2">
                    <button onClick={() => setConfirming('approved')} disabled={!canDecide}
                      className="py-4 rounded-xl bg-green-600 hover:bg-green-700 disabled:opacity-40 text-white text-lg font-bold active:scale-[0.98]">
                      ✓ Approve
                    </button>
                    <button onClick={() => setConfirming('rejected')} disabled={!canDecide}
                      className="py-4 rounded-xl bg-red-600 hover:bg-red-700 disabled:opacity-40 text-white text-lg font-bold active:scale-[0.98]">
                      ✕ Send back
                    </button>
                  </div>
                  {!canDecide && <p className="text-xs text-center text-gray-500">Add your name to decide.</p>}
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
