// The product's place in the new-product flow, at the top of its drawer
// (D-134, made compact in D-178). Everything here is rendered as the server
// computed it (shared/product-stage.js): the stage, the first unmet gate by
// name, and each gate's state — done, next, to do, or HELD (met, but not
// counted because a gate before it no longer holds).
//
// THE NINE GATES ARE A BAR, NOT A LIST. Each segment is a gate, coloured by its
// state, with its name and reason on hover; the full list with every reason is
// one click away ("How the flow works"). The drawer used to print all nine with
// two lines of explanation each above everything else, and the one thing that
// mattered — what is next, and who does it — was lost in the middle (D-178).
//
// Blocking lives here because it is about the flow rather than a field. The
// packaging PO (gate 9) moved to its own section of the drawer.
import { useState } from 'react';
import { apiFetch } from '../../hooks/useApi';
import { CheckCircle2, Circle, ArrowRightCircle, PauseCircle, Ban, ChevronDown } from 'lucide-react';

const STATE_ICON = {
  done: <CheckCircle2 size={14} className="text-green-600 shrink-0 mt-0.5" />,
  next: <ArrowRightCircle size={14} className="text-amber-600 shrink-0 mt-0.5" />,
  held: <PauseCircle size={14} className="text-amber-500 shrink-0 mt-0.5" />,
  todo: <Circle size={14} className="text-gray-300 shrink-0 mt-0.5" />,
};
// Written out, never built: Tailwind generates only class names it can read.
const SEGMENT = {
  done: 'bg-green-500',
  next: 'bg-amber-400 ring-2 ring-amber-200',
  held: 'bg-amber-200',
  todo: 'bg-gray-200',
};
const STATE_WORD = { done: 'done', next: 'next', held: 'met, held until the gates before it hold again', todo: 'to do' };

export default function ProductStagePanel({ p, sku, canEdit, onChanged }) {
  const st = p.stage;
  const [showFlow, setShowFlow] = useState(false);
  const [blocking, setBlocking] = useState(false);
  const [blockForm, setBlockForm] = useState({ reason: '', owner: '' });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  if (!st) return null;
  const act = async (fn) => {
    setBusy(true); setErr('');
    try { await fn(); onChanged?.(); } catch (e) { setErr(e.message); }
    setBusy(false);
  };
  const enc = encodeURIComponent(sku);
  const total = st.gates.length;
  return (
    <section className="rounded-lg border border-gray-200 p-3 space-y-2" data-stage-panel data-stage={st.stage}>
      <div className="flex items-baseline justify-between gap-2">
        <h4 className="text-sm font-semibold text-gray-900">
          Stage {st.stage} of {total} · {st.label}
        </h4>
        <button type="button" onClick={() => setShowFlow((v) => !v)} data-stage-flow-toggle
          className="inline-flex items-center gap-0.5 text-xs text-gray-500 hover:text-gray-800 shrink-0">
          {showFlow ? 'Hide the flow' : 'How the flow works'}
          <ChevronDown size={13} className={showFlow ? 'rotate-180' : ''} />
        </button>
      </div>

      <ol className="flex gap-1" aria-label="Stage gates">
        {st.gates.map((g) => (
          <li key={g.key} data-stage-gate={g.key} data-gate-state={g.state}
            title={`${g.n}. ${g.label} (${g.owner}) — ${STATE_WORD[g.state]}`}
            className={`h-2 flex-1 rounded-full ${SEGMENT[g.state]}`} />
        ))}
      </ol>

      {st.next
        ? <p className="text-sm text-amber-950" data-stage-next={st.next.key}>
            <span className="font-semibold">Next:</span> {st.next.label} <span className="text-gray-500">· {st.next.owner}</span>
          </p>
        : <p className="text-sm text-green-800" data-stage-next="">Every gate holds today.</p>}

      {st.blocked && (
        <p className="text-sm text-gray-800 bg-gray-100 border border-gray-300 rounded px-2 py-1" data-stage-blocked>
          <Ban size={13} className="inline mr-1" />Blocked — {st.blocked.reason} · owner <strong>{st.blocked.owner}</strong>{st.blocked.by ? ` · set by ${st.blocked.by}` : ''}
        </p>
      )}

      {showFlow && (
        <ol className="space-y-1 pt-1 border-t border-gray-100" data-stage-flow>
          {st.gates.map((g) => (
            <li key={g.key} className="flex items-start gap-1.5 text-xs">
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
      )}

      {err && <p className="text-xs text-red-700" data-stage-error>{err}</p>}
      {canEdit && (st.blocked || blocking ? (
        st.blocked ? (
          <button type="button" disabled={busy} data-stage-unblock onClick={() => act(() => apiFetch(`/products/${enc}/completeness-block`, { method: 'DELETE' }))}
            className="text-xs text-gray-600 hover:underline">Unblock</button>
        ) : (
          <form className="flex flex-wrap gap-1.5 w-full" data-stage-block-form
            onSubmit={(e) => { e.preventDefault(); act(async () => { await apiFetch(`/products/${enc}/completeness-block`, { method: 'POST', body: blockForm }); setBlocking(false); }); }}>
            <input value={blockForm.reason} onChange={(e) => setBlockForm({ ...blockForm, reason: e.target.value })} placeholder="Why it is waiting (e.g. formula not final)" required
              className="flex-1 min-w-[12rem] px-2 py-1 border border-gray-300 rounded-lg text-xs" data-stage-block-reason />
            <input value={blockForm.owner} onChange={(e) => setBlockForm({ ...blockForm, owner: e.target.value })} placeholder="Who unblocks it" required
              className="w-36 px-2 py-1 border border-gray-300 rounded-lg text-xs" data-stage-block-owner />
            <button type="submit" disabled={busy} className="px-2.5 py-1 bg-gray-800 text-white rounded-lg text-xs" data-stage-block-save>Block</button>
            <button type="button" onClick={() => setBlocking(false)} className="px-2 py-1 text-xs text-gray-500">Cancel</button>
          </form>
        )
      ) : (
        <button type="button" onClick={() => setBlocking(true)} data-stage-block className="text-xs text-gray-500 hover:text-gray-800 hover:underline">Mark blocked…</button>
      ))}
    </section>
  );
}

/**
 * Packaging POs — gate 9. Its own section of the drawer now; the form stays
 * folded behind one button, because most of the time somebody opening a
 * product is reading it, not placing an order (D-178).
 */
export function PackagingPos({ p, sku, canEdit, onChanged }) {
  const [adding, setAdding] = useState(false);
  const [po, setPo] = useState({ po_number: '', vendor: '', placed_on: '' });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const enc = encodeURIComponent(sku);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setErr('');
    try {
      await apiFetch(`/products/${enc}/packaging-po`, { method: 'POST', body: po });
      setPo({ po_number: '', vendor: '', placed_on: '' }); setAdding(false); onChanged?.();
    } catch (e2) { setErr(e2.message); }
    setBusy(false);
  };
  return (
    <div className="space-y-1.5">
      {(p.packaging_pos || []).length === 0 ? <p className="text-xs text-gray-500">None recorded.</p> : (
        <ul className="text-xs text-gray-700 space-y-0.5" data-stage-pos>
          {p.packaging_pos.map((r) => (
            <li key={r.id}>PO {r.po_number}{r.vendor ? ` · ${r.vendor}` : ''}{r.placed_on ? ` · ${r.placed_on}` : ''} · {r.artwork_version ? `artwork V${r.artwork_version}` : 'no released artwork at the time'}</li>
          ))}
        </ul>
      )}
      {err && <p className="text-xs text-red-700" data-stage-error>{err}</p>}
      {canEdit && (adding ? (
        <form className="flex flex-wrap gap-1.5" data-stage-po-form onSubmit={submit}>
          <input value={po.po_number} onChange={(e) => setPo({ ...po, po_number: e.target.value })} placeholder="PO #" required className="w-28 px-2 py-1 border border-gray-300 rounded-lg text-xs" data-stage-po-number />
          <input value={po.vendor} onChange={(e) => setPo({ ...po, vendor: e.target.value })} placeholder="Vendor" className="w-32 px-2 py-1 border border-gray-300 rounded-lg text-xs" />
          <input type="date" value={po.placed_on} onChange={(e) => setPo({ ...po, placed_on: e.target.value })} className="px-2 py-1 border border-gray-300 rounded-lg text-xs" />
          <button type="submit" disabled={busy} className="px-2.5 py-1 bg-powder-600 text-white rounded-lg text-xs" data-stage-po-save>Record PO</button>
          <button type="button" onClick={() => setAdding(false)} className="px-2 py-1 text-xs text-gray-500">Cancel</button>
          <p className="w-full text-[11px] text-gray-500">Recorded against the artwork released today.</p>
        </form>
      ) : (
        <button type="button" onClick={() => setAdding(true)} data-stage-po-add className="text-xs text-powder-700 hover:underline">+ Record a PO</button>
      ))}
    </div>
  );
}
