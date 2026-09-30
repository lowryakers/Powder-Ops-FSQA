// The product's place in the new-product flow, at the top of its drawer
// (D-134). Everything here is rendered as the server computed it
// (shared/product-stage.js): the stage, the first unmet gate by name, and each
// gate's state — done, next, to do, or HELD (met, but not counted because a
// gate before it no longer holds: the artwork released against a panel the
// formula has since moved past). Two acts live here because they are about
// the flow rather than a field: blocking the product with a reason and an
// owner, and recording the packaging PO that is stage 9.
import { useState } from 'react';
import { apiFetch } from '../../hooks/useApi';
import { CheckCircle2, Circle, ArrowRightCircle, PauseCircle, Ban } from 'lucide-react';

const STATE_ICON = {
  done: <CheckCircle2 size={14} className="text-green-600 shrink-0 mt-0.5" />,
  next: <ArrowRightCircle size={14} className="text-amber-600 shrink-0 mt-0.5" />,
  held: <PauseCircle size={14} className="text-amber-500 shrink-0 mt-0.5" />,
  todo: <Circle size={14} className="text-gray-300 shrink-0 mt-0.5" />,
};

export default function ProductStagePanel({ p, sku, canEdit, onChanged }) {
  const st = p.stage;
  const [blocking, setBlocking] = useState(false);
  const [blockForm, setBlockForm] = useState({ reason: '', owner: '' });
  const [po, setPo] = useState({ po_number: '', vendor: '', placed_on: '' });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  if (!st) return null;
  const act = async (fn) => {
    setBusy(true); setErr('');
    try { await fn(); onChanged?.(); } catch (e) { setErr(e.message); }
    setBusy(false);
  };
  const enc = encodeURIComponent(sku);
  return (
    <section className="rounded-lg border border-gray-200 p-3 space-y-2" data-stage-panel data-stage={st.stage}>
      <div className="flex flex-wrap items-baseline gap-x-2">
        <h4 className="text-sm font-semibold text-gray-900">Stage {st.stage} · {st.label}</h4>
        <span className="text-[11px] text-gray-500">derived from the record — never typed</span>
      </div>
      {st.next
        ? <p className="text-sm text-amber-900 bg-amber-50 border border-amber-200 rounded px-2 py-1" data-stage-next={st.next.key}>
            Next: <strong>{st.next.label}</strong> ({st.next.owner}) — {st.next.why}
          </p>
        : <p className="text-sm text-green-800 bg-green-50 border border-green-200 rounded px-2 py-1" data-stage-next="">Every gate holds today. A new formula version sends it back through the flow.</p>}
      {st.blocked && (
        <p className="text-sm text-gray-800 bg-gray-100 border border-gray-300 rounded px-2 py-1" data-stage-blocked>
          <Ban size={13} className="inline mr-1" />Blocked — {st.blocked.reason} · owner <strong>{st.blocked.owner}</strong>{st.blocked.by ? ` · set by ${st.blocked.by}` : ''}
        </p>
      )}
      <ol className="space-y-1">
        {st.gates.map((g) => (
          <li key={g.key} data-stage-gate={g.key} data-gate-state={g.state} className="flex items-start gap-1.5 text-xs">
            {STATE_ICON[g.state]}
            <span>
              <span className={g.state === 'done' ? 'text-gray-900' : g.state === 'held' ? 'text-amber-800' : 'text-gray-700'}>{g.n}. {g.label}</span>
              <span className="text-gray-400"> · {g.owner}</span>
              {g.state === 'held' && <span className="text-amber-700"> · met, held until the gates before it hold again</span>}
              <span className="block text-[11px] text-gray-500">{g.why}</span>
            </span>
          </li>
        ))}
      </ol>
      {err && <p className="text-xs text-red-700" data-stage-error>{err}</p>}
      {canEdit && (
        <div className="flex flex-wrap gap-2 pt-1 border-t border-gray-100">
          {st.blocked ? (
            <button type="button" disabled={busy} data-stage-unblock onClick={() => act(() => apiFetch(`/products/${enc}/completeness-block`, { method: 'DELETE' }))}
              className="px-2.5 py-1 border border-gray-300 rounded-lg text-xs hover:bg-gray-50">Unblock</button>
          ) : blocking ? (
            <form className="flex flex-wrap gap-1.5 w-full" data-stage-block-form
              onSubmit={(e) => { e.preventDefault(); act(async () => { await apiFetch(`/products/${enc}/completeness-block`, { method: 'POST', body: blockForm }); setBlocking(false); }); }}>
              <input value={blockForm.reason} onChange={(e) => setBlockForm({ ...blockForm, reason: e.target.value })} placeholder="Why it is waiting (e.g. formula not final)" required
                className="flex-1 min-w-[12rem] px-2 py-1 border border-gray-300 rounded-lg text-xs" data-stage-block-reason />
              <input value={blockForm.owner} onChange={(e) => setBlockForm({ ...blockForm, owner: e.target.value })} placeholder="Who unblocks it" required
                className="w-36 px-2 py-1 border border-gray-300 rounded-lg text-xs" data-stage-block-owner />
              <button type="submit" disabled={busy} className="px-2.5 py-1 bg-gray-800 text-white rounded-lg text-xs" data-stage-block-save>Block</button>
            </form>
          ) : (
            <button type="button" onClick={() => setBlocking(true)} data-stage-block className="px-2.5 py-1 border border-gray-300 rounded-lg text-xs hover:bg-gray-50">Mark blocked…</button>
          )}
        </div>
      )}
      <div className="pt-1 border-t border-gray-100 space-y-1" data-gate-anchor="po">
        <p className="text-xs font-medium text-gray-700">Packaging POs</p>
        {(p.packaging_pos || []).length === 0 ? <p className="text-[11px] text-gray-500">None recorded.</p> : (
          <ul className="text-[11px] text-gray-700 space-y-0.5" data-stage-pos>
            {p.packaging_pos.map((r) => (
              <li key={r.id}>PO {r.po_number}{r.vendor ? ` · ${r.vendor}` : ''}{r.placed_on ? ` · ${r.placed_on}` : ''} · {r.artwork_version ? `against artwork V${r.artwork_version}` : 'no released artwork at the time'}</li>
            ))}
          </ul>
        )}
        {canEdit && (
          <form className="flex flex-wrap gap-1.5" data-stage-po-form
            onSubmit={(e) => { e.preventDefault(); act(async () => { await apiFetch(`/products/${enc}/packaging-po`, { method: 'POST', body: po }); setPo({ po_number: '', vendor: '', placed_on: '' }); }); }}>
            <input value={po.po_number} onChange={(e) => setPo({ ...po, po_number: e.target.value })} placeholder="PO #" required className="w-28 px-2 py-1 border border-gray-300 rounded-lg text-xs" data-stage-po-number />
            <input value={po.vendor} onChange={(e) => setPo({ ...po, vendor: e.target.value })} placeholder="Vendor" className="w-32 px-2 py-1 border border-gray-300 rounded-lg text-xs" />
            <input type="date" value={po.placed_on} onChange={(e) => setPo({ ...po, placed_on: e.target.value })} className="px-2 py-1 border border-gray-300 rounded-lg text-xs" />
            <button type="submit" disabled={busy} className="px-2.5 py-1 border border-gray-300 rounded-lg text-xs hover:bg-gray-50" data-stage-po-save>Record PO against the current artwork</button>
          </form>
        )}
      </div>
    </section>
  );
}
