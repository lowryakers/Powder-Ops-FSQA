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

/**
 * Where the registry disagrees with itself — computed server-side
 * (doc-consistency.js), rendered as-told. Every finding names documents to
 * LOOK at, not verdicts: this is the starting point for bringing the digital
 * copies in line with the finalised paper, and a machine-made punch list that
 * pretended to be a decision would just get ignored.
 */
function ConsistencyReview() {
  const { data, loading, error } = useApiGet('/doc-review/consistency');
  if (loading) return <p className="text-sm text-gray-500 py-4">Reading every document…</p>;
  if (error) return <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg p-3">{error}</p>;
  if (!data) return null;
  const DOT = { critical: 'bg-red-500', warning: 'bg-amber-500', info: 'bg-gray-400' };
  const docLine = (d) => `${d.doc_number || '(no number)'} — ${d.title}${d.status === 'draft' ? ' (draft)' : ''}`;
  return (
    <div className="border border-gray-200 rounded-xl bg-white">
      <div className="px-4 py-3 border-b border-gray-100">
        <p className="text-sm font-semibold text-gray-900">
          {data.findings === 0
            ? `No inconsistencies found across ${data.documents_reviewed} documents.`
            : `${data.findings} finding${data.findings === 1 ? '' : 's'} across ${data.documents_reviewed} documents`}
        </p>
        <p className="text-xs text-gray-500 mt-0.5">
          A finding is a place to look, not a verdict — an unreferenced WI can be deliberate.
          Fix the paper first, then bring the digital copy in line.
        </p>
      </div>
      <div className="divide-y divide-gray-100 max-h-[65vh] overflow-y-auto">
        {data.sections.filter(s => s.items.length > 0).map(sec => (
          <div key={sec.key} className="px-4 py-3">
            <p className="text-sm font-semibold text-gray-800 flex items-center gap-2">
              <span className={`w-2 h-2 rounded-full ${DOT[sec.severity]}`} />
              {sec.label} <span className="font-normal text-gray-400">({sec.items.length})</span>
            </p>
            <ul className="mt-1.5 space-y-1">
              {sec.items.map((it, i) => (
                <li key={i} className="text-xs text-gray-700">
                  {sec.key === 'duplicate_numbers' && (
                    <><span className="font-semibold">{it.number}</span> is carried by {it.documents.length} documents: {it.documents.map(docLine).join(' · ')}</>
                  )}
                  {sec.key === 'duplicate_titles' && (
                    <><span className="font-semibold">“{it.title}”</span> appears on: {it.documents.map(docLine).join(' · ')}</>
                  )}
                  {(sec.key === 'dangling_references') && (
                    <>{docLine(it.document)} cites <span className="font-semibold">{it.cites}</span>, which is not in the registry</>
                  )}
                  {(sec.key === 'references_to_retired') && (
                    <>{docLine(it.document)} cites <span className="font-semibold">{it.cites}</span>, which is {it.cited_status}</>
                  )}
                  {['orphaned_wis', 'empty_shells', 'drafts', 'no_effective_date'].includes(sec.key) && docLine(it)}
                  {sec.key === 'past_review' && <>{docLine(it)} — review was due {it.review_due}</>}
                </li>
              ))}
            </ul>
          </div>
        ))}
        {data.findings === 0 && (
          <p className="px-4 py-8 text-sm text-gray-500 text-center">The registry agrees with itself. Nothing to hand Daniela.</p>
        )}
      </div>
    </div>
  );
}

export default function DocReviewPanel() {
  const [tab, setTab] = useState(null);
  const [showConsistency, setShowConsistency] = useState(false);
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
          <button key={s.key} onClick={() => { setTab(s.key); setShowConsistency(false); setPicked(new Set()); setMsg(null); }}
            className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors ${!showConsistency && active?.key === s.key ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
            {s.label}
            {s.count > 0 && (
              <span className="ml-1.5 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[10px] font-bold">
                {s.count}
              </span>
            )}
          </button>
        ))}
        <button onClick={() => { setShowConsistency(true); setMsg(null); }}
          className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors ${showConsistency ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
          Consistency Review
        </button>
      </div>

      {showConsistency && <ConsistencyReview />}

      {!showConsistency && active && (
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
