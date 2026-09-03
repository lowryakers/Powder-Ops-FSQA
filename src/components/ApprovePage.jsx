import { useState, useEffect } from 'react';
import { CheckCircle, XCircle, AlertTriangle } from 'lucide-react';
import { SENSORY_ATTRIBUTES, LEGACY_SENSORY_LABELS, sensoryNoteKey, RESULT_LABELS } from '../../shared/sensory.js';


/**
 * QA's evaluation, as the approver sees it.
 *
 * READ-ONLY AND DELIBERATELY SO. The approver is deciding whether to ship a
 * batch, not running the test — the tasting was done in the plant by QA and
 * this is the evidence it produced. A page that asked the person holding a
 * phone for five answers would get five answers whether or not they had the
 * sample in front of them, and a fabricated sensory record is worse than none.
 *
 * FORM 602-01 V2: each attribute against the product's written specification,
 * Matches or Doesn't match, with what QA saw on a fail. An evaluation recorded
 * on the V1 form still shows its 1–5 scores as filed.
 */
function SensoryPanel({ s }) {
  if (!s || !s.complete) return null;
  const when = s.at ? new Date(s.at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : null;
  const spec = s.spec?.attributes || {};
  return (
    <section className="rounded-xl border border-gray-200 bg-gray-50/70 overflow-hidden" data-sensory-panel={s.shape}>
      <header className="px-4 py-2.5 border-b border-gray-200 bg-white flex items-start justify-between gap-2">
        <div>
          <h2 className="text-[13px] font-semibold text-gray-900">QA sensory evaluation</h2>
          <p className="text-[11px] text-gray-500 mt-0.5">
            {s.by ? <>Checked by <span className="font-medium text-gray-700">{s.by}</span></> : 'Recorded by QA'}
            {when ? ` · ${when}` : ''}
            {s.shape === 'v2' && (s.spec?.status === 'approved' ? ' · against the approved specification' : s.spec ? ' · against a DRAFT specification' : '')}
          </p>
        </div>
        {s.result && (
          <span className={`shrink-0 px-2 py-0.5 rounded-full text-xs font-semibold ${s.result === 'fail' ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'}`}>
            {s.result === 'fail' ? 'FAIL' : 'PASS'}
          </span>
        )}
      </header>
      {s.shape === 'v2' ? (
        <dl className="divide-y divide-gray-200/70">
          {SENSORY_ATTRIBUTES.map(a => {
            const v = String(s[a.key] || '').toLowerCase();
            const seen = s[sensoryNoteKey(a.key)];
            return (
              <div key={a.key} className="px-4 py-2">
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-[13px] font-medium text-gray-800">{a.label}</dt>
                  <dd className={`text-[13px] font-semibold ${v === 'fail' ? 'text-red-700' : 'text-green-700'}`}>{v === 'fail' ? '✕ ' : '✓ '}{RESULT_LABELS[v] || '—'}</dd>
                </div>
                {spec[a.key] && <p className="text-[11px] text-gray-500 mt-0.5">{spec[a.key]}</p>}
                {seen && <p className="text-[12px] text-gray-800 mt-0.5"><span className="text-gray-500">Seen: </span>{seen}</p>}
              </div>
            );
          })}
        </dl>
      ) : (
        <dl className="divide-y divide-gray-200/70">
          {LEGACY_SENSORY_LABELS.map(([k, label]) => {
            const n = Number(s[k]) || 0;
            return (
              <div key={k} className="flex items-center gap-3 px-4 py-2">
                <dt className="text-[13px] text-gray-600 w-24 shrink-0">{label}</dt>
                <dd className="flex items-center gap-2 ml-auto">
                  <span className="flex gap-1" aria-hidden="true">
                    {[1, 2, 3, 4, 5].map(i => <span key={i} className={`h-2 w-2 rounded-full ${i <= n ? 'bg-powder-600' : 'bg-gray-300'}`} />)}
                  </span>
                  <span className="text-[13px] font-semibold text-gray-900 tabular-nums w-7 text-right">{n || '—'}<span className="text-gray-400 font-normal">/5</span></span>
                </dd>
              </div>
            );
          })}
        </dl>
      )}
      {s.notes && (
        <p className="px-4 py-2.5 border-t border-gray-200 bg-white text-[12px] text-gray-700 whitespace-pre-line">
          <span className="font-medium text-gray-500">QA note: </span>{s.notes}
        </p>
      )}
    </section>
  );
}

// Public flavor-approval page opened from a texted magic link — no login.
// Shows the sample details; one tap approves or denies, then the link is done.
export default function ApprovePage({ token }) {
  const [info, setInfo] = useState(null);
  const [error, setError] = useState('');
  const [comments, setComments] = useState('');
  // THE LINK CANNOT KNOW WHO IS HOLDING IT. It may have been texted to a second
  // approver, or handed to a colleague — and the decision used to be filed
  // under Danny's name whoever tapped it. Same rule as the NFP approval page.
  const [name, setName] = useState('');
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
        body: JSON.stringify({ decision, comments, name }),
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
            {/* The product leads, at the size it deserves — it is the one thing
                that must be unmistakable before anyone taps Approve. */}
            <div>
              <h2 className="text-lg font-bold text-gray-900 leading-snug">{info.product_name || 'Untitled batch'}</h2>
              <p className="text-[13px] text-gray-500 mt-0.5">
                {/* Don't re-prefix a value that already carries its own label —
                    the plant writes work orders both ways ("76736" and
                    "WO76736") and "WO WO76736" is the sort of thing that makes
                    a careful reader distrust the rest of the page. */}
                {[info.lot_number && `Lot ${String(info.lot_number).replace(/^lot\s*/i, '')}`,
                  info.work_order && (/^wo/i.test(String(info.work_order).trim())
                    ? String(info.work_order).trim() : `WO ${info.work_order}`)]
                  .filter(Boolean).join(' · ') || 'No lot or work order recorded'}
              </p>
            </div>
            <dl className="space-y-2">
              {[['Batched on', info.batched_on], ['Sample quantity', info.sample_quantity]].map(([k, v]) => (
                <div key={k} className="flex justify-between gap-3 text-sm">
                  <dt className="text-gray-500">{k}</dt>
                  <dd className="font-semibold text-gray-900 text-right">{v || '—'}</dd>
                </div>
              ))}
            </dl>

            <SensoryPanel s={info.sensory} />

            {/* What was changed to get the batch here is a different fact from
                the scores, and it changes what "approved" means. */}
            {info.batch_adjustments && (
              <p className="rounded-xl bg-amber-50 border border-amber-200 px-3 py-2 text-[12px] text-amber-900">
                <span className="font-semibold">Adjusted before this tasting: </span>{info.batch_adjustments}
              </p>
            )}

            <input value={name} onChange={e => setName(e.target.value)} type="text"
              autoComplete="name" placeholder="Your name"
              className="w-full px-3 py-2 border border-gray-300 rounded-xl text-base" />
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
              <>
                <div className="grid grid-cols-2 gap-2">
                  <button onClick={() => setConfirming('approved')} disabled={name.trim().length < 2}
                    className="py-4 rounded-xl bg-green-600 hover:bg-green-700 text-white text-lg font-bold active:scale-[0.98] disabled:opacity-40">
                    ✓ Approve
                  </button>
                  <button onClick={() => setConfirming('denied')} disabled={name.trim().length < 2}
                    className="py-4 rounded-xl bg-red-600 hover:bg-red-700 text-white text-lg font-bold active:scale-[0.98] disabled:opacity-40">
                    ✕ Deny
                  </button>
                </div>
                {name.trim().length < 2 && (
                  <p className="text-xs text-center text-gray-500">Type your name above — the record has to say who decided.</p>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
