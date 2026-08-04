import { useState } from 'react';
import { useApiGet, apiPost } from '../../hooks/useApi';
import { FlaskConical, ChevronDown, ChevronUp, CheckCircle2, XCircle } from 'lucide-react';

// Starter specifications waiting on QA.
//
// The Specifications tab used to start empty, which means an uploaded lab
// result has nothing to grade itself against — the test with no spec is the one
// that quietly passes. The seeder files the standard panel for every item the
// plant has sent to a lab, as DRAFTS.
//
// A draft is `is_active = 0`, and every grading path reads `is_active = 1`, so
// nothing here can affect a real result until it's approved. That's why it's
// safe to file a hundred of them and let QA work through the list.
//
// Heavy metals arrive with NO limit on purpose: USP <2232> sets a limit per
// daily dose, and converting that to a per-gram number needs the item's serving
// size. Those rows are approved WITH their number typed in right here — a spec
// approved empty would be a test that can never fail.

function DraftRow({ draft, checked, onToggle, limit, onLimit }) {
  const needsLimit = draft.min_value == null && draft.max_value == null && !!draft.unit;
  return (
    <tr className={`text-sm ${checked ? 'bg-powder-50/50' : ''}`}>
      <td className="px-3 py-2"><input type="checkbox" checked={checked} onChange={onToggle} /></td>
      <td className="px-3 py-2 whitespace-nowrap">{draft.test_type}</td>
      <td className="px-3 py-2 text-gray-600">{draft.specification || '—'}</td>
      <td className="px-3 py-2 whitespace-nowrap">
        {needsLimit ? (
          <span className="flex items-center gap-1">
            <input value={limit?.max_value ?? ''} onChange={e => onLimit({ ...limit, max_value: e.target.value })}
              placeholder="max" className="w-20 px-2 py-1 border border-amber-300 bg-amber-50 rounded text-xs" />
            <span className="text-[11px] text-gray-500">{draft.unit}</span>
          </span>
        ) : (
          <span className="text-gray-600">
            {draft.max_value != null ? `≤ ${draft.max_value.toLocaleString()} ${draft.unit || ''}` : '—'}
          </span>
        )}
      </td>
      <td className="px-3 py-2 text-gray-500 text-xs">{draft.method || '—'}</td>
    </tr>
  );
}

function ItemGroup({ item, drafts, onDone }) {
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState(() => new Set(drafts.map(d => d.id)));
  const [limits, setLimits] = useState({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const toggle = (id) => {
    const next = new Set(picked);
    if (next.has(id)) next.delete(id); else next.add(id);
    setPicked(next);
  };

  const run = async (action) => {
    setBusy(true); setError('');
    try {
      await apiPost(`/coa/specifications/drafts/${action}`, { ids: [...picked], limits });
      await onDone();
    } catch (e) { setError(e.message); setBusy(false); }
  };

  return (
    <div className="border border-gray-200 rounded-xl overflow-hidden">
      <button onClick={() => setOpen(!open)} className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-gray-50">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-gray-900 truncate">
            {item.item_number} <span className="font-normal text-gray-500">· {item.item_description}</span>
          </p>
          <p className="text-xs text-gray-500">{drafts.length} draft specification{drafts.length === 1 ? '' : 's'}</p>
        </div>
        {open ? <ChevronUp size={16} className="text-gray-400" /> : <ChevronDown size={16} className="text-gray-400" />}
      </button>
      {open && (
        <div className="border-t border-gray-100">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 text-xs text-gray-500">
                <tr>
                  <th className="px-3 py-2 w-8"></th>
                  <th className="px-3 py-2 text-left font-medium">Test</th>
                  <th className="px-3 py-2 text-left font-medium">Requirement</th>
                  <th className="px-3 py-2 text-left font-medium">Limit</th>
                  <th className="px-3 py-2 text-left font-medium">Method</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {drafts.map(d => (
                  <DraftRow key={d.id} draft={d} checked={picked.has(d.id)} onToggle={() => toggle(d.id)}
                    limit={limits[d.id]} onLimit={(v) => setLimits(l => ({ ...l, [d.id]: v }))} />
                ))}
              </tbody>
            </table>
          </div>
          {error && <p className="px-3 py-2 text-xs text-red-600">{error}</p>}
          <div className="flex flex-wrap items-center gap-2 px-3 py-2.5 border-t border-gray-100 bg-gray-50/50">
            <button onClick={() => run('approve')} disabled={busy || !picked.size}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-green-600 text-white text-xs font-medium rounded-lg hover:bg-green-700 disabled:opacity-50">
              <CheckCircle2 size={14} /> Approve {picked.size}
            </button>
            <button onClick={() => run('discard')} disabled={busy || !picked.size}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-100 text-gray-700 text-xs font-medium rounded-lg hover:bg-gray-200 disabled:opacity-50">
              <XCircle size={14} /> Discard {picked.size}
            </button>
            <span className="text-[11px] text-gray-500">
              Approved specs start grading uploaded results. Discarded drafts are kept as the record they were offered and turned down.
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

export default function DraftSpecsReview() {
  const [expanded, setExpanded] = useState(false);
  const { data, refresh } = useApiGet('/coa/specifications/drafts');
  const drafts = data?.drafts || [];
  const items = data?.items || [];
  if (!drafts.length) return null;

  return (
    <div className="border border-amber-200 bg-amber-50/40 rounded-xl">
      <button onClick={() => setExpanded(!expanded)} className="w-full flex items-start gap-2.5 p-3 text-left">
        <FlaskConical size={16} className="text-amber-600 mt-0.5 shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-amber-900">
            {data.total} starter specification{data.total === 1 ? '' : 's'} waiting on review
            <span className="font-normal">
              {' · '}{items.length} item{items.length === 1 ? '' : 's'} shown
              {data.total > drafts.length && ` (${drafts.length} of ${data.total}; approve or discard these and the rest follow)`}
            </span>
          </p>
          <p className="text-xs text-amber-800 mt-0.5">
            Standard limits filed for every item that has been sent to a lab. They grade nothing until you approve
            them. Heavy metals arrive without a number — USP &lt;2232&gt; sets a per-daily-dose limit, so the
            per-gram figure depends on this item&apos;s serving size and is yours to enter.
          </p>
        </div>
        {expanded ? <ChevronUp size={16} className="text-amber-600 shrink-0" /> : <ChevronDown size={16} className="text-amber-600 shrink-0" />}
      </button>
      {expanded && (
        <div className="p-3 pt-0 space-y-2 max-h-[60vh] overflow-y-auto">
          {items.map(it => (
            <ItemGroup key={it.item_number} item={it}
              drafts={drafts.filter(d => d.item_number === it.item_number)} onDone={refresh} />
          ))}
        </div>
      )}
    </div>
  );
}
