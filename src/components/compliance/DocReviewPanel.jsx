import { useState, useMemo } from 'react';
import { useApiGet, apiPost } from '../../hooks/useApi';
import {
  FileCheck2, AlertTriangle, CheckCircle2, ExternalLink, Loader2, Info,
} from 'lucide-react';

// Document Control Review Center — Daniela's "what do I owe today".
//
// The same screen as QA Review, with one difference that matters: **not every
// pile can be cleared from a list, and this says so.** Documents past their
// review date are batchable — "I've read it, it's still correct" is exactly
// what a review date asks for. A parked Controlled Change is not: approving one
// changes what the app serves the whole plant, and it belongs on the screen
// showing the difference. So a tab either has checkboxes or it has a way
// through to where the decision is actually made — never a button that can't
// finish the job.

// Same event the QA Review panel and the dashboard use to change tab.
const openModule = (moduleId) => {
  window.dispatchEvent(new CustomEvent('app-navigate', { detail: { tab: moduleId } }));
};

function Row({ item, source, checked, onToggle }) {
  return (
    <li className="flex items-start gap-3 px-3 py-2.5 hover:bg-gray-50">
      {source.action && source.can_act && (
        <input type="checkbox" checked={checked} onChange={onToggle} className="mt-1 shrink-0" />
      )}
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-gray-900 break-words">{item.title}</p>
        {item.subtitle && <p className="text-xs text-gray-500 break-words">{item.subtitle}</p>}
        {item.extra && <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">{item.extra}</p>}
      </div>
      {item.date && (
        <span className={`text-xs whitespace-nowrap shrink-0 ${item.overdue ? 'text-red-600 font-semibold' : 'text-gray-500'}`}>
          {item.overdue && <AlertTriangle size={11} className="inline mr-0.5 -mt-0.5" />}
          {item.date}
        </span>
      )}
    </li>
  );
}

export default function DocReviewPanel() {
  const [tab, setTab] = useState(null);
  const [picked, setPicked] = useState(() => new Set());
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  const query = tab ? `/doc-review?source=${tab}` : '/doc-review';
  const { data, loading, error, refresh } = useApiGet(query, [query]);

  const sources = useMemo(() => data?.sources || [], [data]);
  const active = sources.find(s => s.key === (tab || sources[0]?.key)) || sources[0];
  const items = active?.items || [];

  const toggle = (id) => {
    const next = new Set(picked);
    if (next.has(id)) next.delete(id); else next.add(id);
    setPicked(next);
  };
  const allPicked = items.length > 0 && items.every(i => picked.has(i.id));

  const run = async () => {
    if (!active?.action || !picked.size) return;
    setBusy(true); setMsg(null);
    try {
      const out = await apiPost('/doc-review/act', { source: active.key, ids: [...picked] });
      setPicked(new Set());
      setMsg(out.failed?.length
        ? { kind: 'warn', text: `${out.done.length} ${active.action.done}; ${out.failed.length} could not be — ${out.failed[0].error}` }
        : { kind: 'ok', text: `${out.done.length} ${out.done.length === 1 ? active.noun : active.plural} ${active.action.done}.` });
      await refresh();
    } catch (e) { setMsg({ kind: 'warn', text: e.message }); }
    finally { setBusy(false); }
  };

  if (error) return <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg p-3">{error}</p>;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">
          <FileCheck2 size={20} className="text-powder-600" /> Document Control Review
        </h2>
        <p className="text-sm text-gray-500">
          Everything waiting on Document Control, in one list.
          {data?.total ? <> <span className="font-semibold text-gray-700">{data.total}</span> outstanding.</> : ' Nothing outstanding.'}
        </p>
      </div>

      <div className="flex gap-1 bg-gray-100 rounded-lg p-1 flex-wrap w-fit">
        {sources.map(s => (
          <button key={s.key} onClick={() => { setTab(s.key); setPicked(new Set()); setMsg(null); }}
            className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors ${active?.key === s.key ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
            {s.label}
            {s.count > 0 && (
              <span className="ml-1.5 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[10px] font-bold">
                {s.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {active && (
        <div className="border border-gray-200 rounded-xl overflow-hidden bg-white">
          <div className="px-3 py-2.5 border-b border-gray-100 bg-gray-50/60 flex items-start gap-2 flex-wrap">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-gray-900">
                {active.label}
                {active.form && <span className="font-normal text-gray-500"> · Form {active.form}</span>}
              </p>
              {active.help && (
                <p className="text-xs text-gray-500 flex items-start gap-1 mt-0.5">
                  <Info size={12} className="mt-0.5 shrink-0" /> {active.help}
                </p>
              )}
            </div>
            <button onClick={() => openModule(active.module)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-gray-300 text-gray-700 text-xs font-medium rounded-lg hover:bg-gray-50 shrink-0">
              <ExternalLink size={13} /> Open the module
            </button>
          </div>

          {msg && (
            <p className={`px-3 py-2 text-xs ${msg.kind === 'ok' ? 'bg-green-50 text-green-800' : 'bg-amber-50 text-amber-900'}`}>{msg.text}</p>
          )}

          {loading && <p className="px-3 py-6 text-sm text-gray-500">Loading…</p>}
          {!loading && items.length === 0 && (
            <p className="px-3 py-8 text-sm text-gray-500 text-center">Nothing outstanding here.</p>
          )}

          {items.length > 0 && (
            <>
              {active.action && active.can_act && (
                <div className="px-3 py-2 border-b border-gray-100 flex items-center gap-2 flex-wrap">
                  <label className="flex items-center gap-1.5 text-xs text-gray-600">
                    <input type="checkbox" checked={allPicked}
                      onChange={() => setPicked(allPicked ? new Set() : new Set(items.map(i => i.id)))} />
                    Select all {items.length}
                  </label>
                  <button onClick={run} disabled={busy || !picked.size}
                    className="ml-auto flex items-center gap-1.5 px-3 py-1.5 bg-powder-600 text-white text-xs font-medium rounded-lg hover:bg-powder-700 disabled:opacity-50">
                    {busy ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 size={13} />}
                    {active.action.verb}{picked.size ? ` (${picked.size})` : ''}
                  </button>
                </div>
              )}
              {!active.action && (
                <p className="px-3 py-2 border-b border-gray-100 text-xs text-gray-500">
                  These are worked on the record — open the module to see what each one is asking for.
                </p>
              )}
              <ul className="divide-y divide-gray-50 max-h-[60vh] overflow-y-auto">
                {items.map(i => (
                  <Row key={i.id} item={i} source={active} checked={picked.has(i.id)} onToggle={() => toggle(i.id)} />
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </div>
  );
}
