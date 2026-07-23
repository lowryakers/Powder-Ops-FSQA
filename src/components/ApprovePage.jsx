import { useState, useEffect } from 'react';
import { CheckCircle, XCircle, AlertTriangle } from 'lucide-react';

// Public flavor-approval page opened from a texted magic link — no login.
// Shows the sample details; one tap approves or denies, then the link is done.
export default function ApprovePage({ token }) {
  const [info, setInfo] = useState(null);
  const [error, setError] = useState('');
  const [comments, setComments] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null); // 'approved' | 'denied'
  const [confirming, setConfirming] = useState(null);

  useEffect(() => {
    fetch(`/api/submit/flavor-approval/${encodeURIComponent(token)}`)
      .then(r => r.json().then(d => { if (!r.ok) throw new Error(d.error || 'Link error'); setInfo(d); }))
      .catch(e => setError(e.message));
  }, [token]);

  const decide = async (decision) => {
    setBusy(true); setError('');
    try {
      const r = await fetch(`/api/submit/flavor-approval/${encodeURIComponent(token)}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision, comments }),
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
          {ok ? <CheckCircle size={64} className="mx-auto mb-4 text-green-500" /> : <XCircle size={64} className="mx-auto mb-4 text-red-500" />}
          <h1 className="text-2xl font-bold text-gray-900 mb-1">Flavor {ok ? 'Approved' : 'Denied'}</h1>
          <p className="text-gray-600">Recorded and announced to the batching team. You can close this page.</p>
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
          <p className="text-sm text-gray-500 mt-1">This link may have already been used.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 px-4 py-10">
      <div className="max-w-md mx-auto">
        <div className="text-center mb-5">
          <div className="h-12 w-12 bg-powder-600 rounded-xl flex items-center justify-center mx-auto mb-3">
            <CheckCircle size={24} className="text-white" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900">Flavor Approval</h1>
          <p className="text-sm text-gray-500 mt-1">Taste test sign-off {info?.record_number ? `· ${info.record_number}` : ''}</p>
        </div>
        {!info ? <p className="text-center text-gray-400">Loading…</p> : (
          <div className="bg-white rounded-2xl border border-gray-200 p-5 shadow-sm space-y-4">
            <dl className="space-y-2">
              {[['Product', info.product_name], ['Lot Number', info.lot_number], ['Work Order', info.work_order],
                ['Batched On', info.batched_on], ['Sample Quantity', info.sample_quantity]].map(([k, v]) => (
                <div key={k} className="flex justify-between gap-3 text-sm">
                  <dt className="text-gray-500">{k}</dt>
                  <dd className="font-semibold text-gray-900 text-right">{v || '—'}</dd>
                </div>
              ))}
            </dl>
            <textarea value={comments} onChange={e => setComments(e.target.value)} rows={2}
              placeholder="Comments (optional)" className="w-full px-3 py-2 border border-gray-300 rounded-xl text-base" />
            {error && <p className="text-sm text-red-600">{error}</p>}
            {confirming ? (
              <div className="space-y-2">
                <p className="text-sm text-center font-medium text-gray-700">
                  {confirming === 'approved' ? 'Approve this flavor?' : 'Deny this flavor?'}
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <button onClick={() => decide(confirming)} disabled={busy}
                    className={`py-3 rounded-xl text-white font-bold disabled:opacity-50 ${confirming === 'approved' ? 'bg-green-600' : 'bg-red-600'}`}>
                    {busy ? 'Saving…' : 'Yes, confirm'}
                  </button>
                  <button onClick={() => setConfirming(null)} disabled={busy} className="py-3 rounded-xl bg-gray-100 text-gray-700 font-bold">Back</button>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                <button onClick={() => setConfirming('approved')} className="py-4 rounded-xl bg-green-600 hover:bg-green-700 text-white text-lg font-bold active:scale-[0.98]">
                  ✓ Approve
                </button>
                <button onClick={() => setConfirming('denied')} className="py-4 rounded-xl bg-red-600 hover:bg-red-700 text-white text-lg font-bold active:scale-[0.98]">
                  ✕ Deny
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
