import { useState, useEffect, useCallback } from 'react';
import { CheckCircle2, XCircle, ExternalLink, AlertTriangle, Loader2 } from 'lucide-react';

/**
 * Several nutrition panels on one signed link.
 *
 * Public and token-gated, like the single-panel page — the formulator has no
 * ReadyDoc account and should not need one. What is shared is the trip; each
 * panel is still its own decision, recorded with his name and its own
 * timestamp.
 *
 * The page makes him LOOK. Every panel is listed with its file, its serving
 * size and what changed, and "Approve all" says how many it covers and names
 * them. Approving ten SKUs that carry one change is a thing a person can
 * genuinely mean; approving ten they never saw is not, and a page that hid them
 * behind one button would be building the second kind.
 */
export default function NfpBatchApprovePage({ token }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);
  const [rejecting, setRejecting] = useState(null);
  const [reason, setReason] = useState('');

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/nfp-link/batch/${encodeURIComponent(token)}`);
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'This link is no longer valid.');
      setData(j);
    } catch (e) { setError(e.message); }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  const send = async (body) => {
    setBusy(true); setError(null);
    try {
      const r = await fetch(`/api/nfp-link/batch/${encodeURIComponent(token)}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...body, name }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Could not record that.');
      setDone(j);
      setRejecting(null); setReason('');
      await load();
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };

  if (error && !data) {
    return (
      <Shell>
        <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg p-4">{error}</p>
      </Shell>
    );
  }
  if (!data) {
    return <Shell><p className="text-sm text-gray-500 flex items-center gap-2"><Loader2 size={15} className="animate-spin" /> Loading…</p></Shell>;
  }

  const outstanding = data.panels.filter(p => !p.decided);

  return (
    <Shell>
      <div className="space-y-4">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Nutrition panels for approval</h1>
          <p className="text-sm text-gray-600">
            {data.total} panel{data.total === 1 ? '' : 's'} sent by {data.sent_by}
            {outstanding.length !== data.total && ` · ${data.total - outstanding.length} already decided`}
          </p>
          {data.note && <p className="mt-1 text-sm text-gray-700 bg-gray-50 rounded-lg px-3 py-2">{data.note}</p>}
        </div>

        {done && (
          <div className="rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-900">
            <p className="font-medium">
              Recorded: {done.decided.map(d => `${d.sku} ${d.version}`).join(', ')} {done.decision}.
            </p>
            {done.outstanding > 0 && <p className="mt-0.5">{done.outstanding} still to decide.</p>}
            {done.outstanding === 0 && <p className="mt-0.5">That is all of them — thank you. This link is now closed.</p>}
            {done.stranded?.length > 0 && (
              <p className="mt-1 text-amber-800">
                Note: {done.stranded.length} print-ready artwork version(s) were drawn against an older panel and are
                unchanged. Powder Ops has been told.
              </p>
            )}
          </div>
        )}
        {error && <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg p-3">{error}</p>}

        {outstanding.length > 0 && (
          <div className="rounded-lg border border-gray-200 bg-white p-3 space-y-2">
            <label className="block">
              <span className="block text-xs font-medium text-gray-700 mb-1">Your name *</span>
              <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Matt Rowley"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
            </label>
            <p className="text-[11px] text-gray-500">
              Every approval is recorded against this name and today&rsquo;s date.
            </p>
          </div>
        )}

        <div className="space-y-3">
          {data.panels.map(p => (
            <div key={p.id} className={`rounded-lg border p-3 ${p.decided ? 'border-gray-200 bg-gray-50' : 'border-gray-300 bg-white'}`}>
              <div className="flex items-start justify-between gap-2 flex-wrap">
                <div className="min-w-0">
                  <p className="font-semibold text-gray-900">{p.product} <span className="font-normal text-gray-500">· {p.sku}</span></p>
                  <p className="text-xs text-gray-600">
                    Panel {p.version}
                    {p.serving_size && ` · serving size ${p.serving_size}`}
                    {p.servings_per_container && ` · ${p.servings_per_container} per container`}
                  </p>
                  {p.change_summary && <p className="mt-1 text-sm text-gray-700">{p.change_summary}</p>}
                </div>
                {p.decided && (
                  <span className={`shrink-0 text-xs font-medium ${p.status === 'approved' ? 'text-green-700' : 'text-red-700'}`}>
                    {p.status === 'approved' ? `approved by ${p.approved_by}` : `rejected — ${p.rejected_reason}`}
                  </span>
                )}
              </div>

              {/* Nothing is approved that could not be looked at. */}
              <div className="mt-2 flex flex-wrap gap-2">
                {p.panels?.map(f => (
                  <a key={f.filename} href={f.url} target="_blank" rel="noreferrer"
                    className="inline-flex items-center gap-1 text-xs text-powder-700 underline">
                    <ExternalLink size={11} /> {f.filename}
                  </a>
                ))}
                {p.drive_url && (
                  <a href={p.drive_url} target="_blank" rel="noreferrer"
                    className="inline-flex items-center gap-1 text-xs text-powder-700 underline">
                    <ExternalLink size={11} /> Open in Drive
                  </a>
                )}
                {!p.panels?.length && !p.drive_url && (
                  <span className="inline-flex items-center gap-1 text-xs text-amber-700">
                    <AlertTriangle size={11} /> no file attached
                  </span>
                )}
              </div>

              {!p.decided && (
                <div className="mt-2.5 flex flex-wrap items-center gap-2">
                  <button type="button" disabled={busy || name.trim().length < 2}
                    onClick={() => send({ decision: 'approved', version_id: p.id })}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-green-600 text-white text-xs font-medium hover:bg-green-700 disabled:opacity-50">
                    <CheckCircle2 size={13} /> Approve this one
                  </button>
                  <button type="button" disabled={busy}
                    onClick={() => { setRejecting(rejecting === p.id ? null : p.id); setReason(''); }}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-300 text-gray-700 text-xs font-medium hover:bg-gray-50">
                    <XCircle size={13} /> Something&rsquo;s wrong
                  </button>
                </div>
              )}

              {rejecting === p.id && (
                <div className="mt-2 space-y-1.5">
                  <textarea value={reason} onChange={e => setReason(e.target.value)} rows={2}
                    placeholder="What needs changing on this panel?"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
                  <button type="button" disabled={busy || reason.trim().length < 3 || name.trim().length < 2}
                    onClick={() => send({ decision: 'rejected', version_id: p.id, comments: reason })}
                    className="px-3 py-1.5 rounded-lg bg-red-600 text-white text-xs font-medium hover:bg-red-700 disabled:opacity-50">
                    Send this back
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Approve-all names what it covers. A button that hid ten products
            behind one word would be asking for a decision nobody made. */}
        {outstanding.length > 1 && (
          <div className="rounded-lg border border-green-200 bg-green-50 p-3 space-y-2">
            <p className="text-sm text-green-900">
              If all {outstanding.length} are right, approve them together:
              <span className="block text-xs text-green-800 mt-0.5">
                {outstanding.map(p => `${p.sku} ${p.version}`).join(', ')}
              </span>
            </p>
            <button type="button" disabled={busy || name.trim().length < 2}
              onClick={() => send({ decision: 'approved' })}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-green-600 text-white text-sm font-medium hover:bg-green-700 disabled:opacity-50">
              <CheckCircle2 size={15} /> {busy ? 'Recording…' : `Approve all ${outstanding.length}`}
            </button>
            {name.trim().length < 2 && <p className="text-[11px] text-green-800">Add your name above first.</p>}
          </div>
        )}

        {outstanding.length === 0 && !done && (
          <p className="text-sm text-gray-600 bg-gray-50 rounded-lg p-3">
            Every panel on this link has been decided. Nothing further is needed.
          </p>
        )}
      </div>
    </Shell>
  );
}

function Shell({ children }) {
  return (
    <div className="min-h-screen bg-gray-50 py-6 px-4">
      <div className="max-w-2xl mx-auto">
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-3">Powder Ops · ReadyDoc</p>
        {children}
        <p className="mt-6 text-[11px] text-gray-400">
          This is a one-time approval link. Nothing here can be changed after it is decided.
        </p>
      </div>
    </div>
  );
}
