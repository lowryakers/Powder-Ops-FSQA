import { useState, useMemo } from 'react';
import { useApiGet, apiPost } from '../../hooks/useApi';
import { useAuth } from '../../hooks/useAuth';
import { CheckCircle2, XCircle, ExternalLink, RefreshCw, ClipboardCheck, AlertTriangle } from 'lucide-react';
import { useCappedList } from '../../lib/useCappedList';
import ShowMore from '../common/ShowMore.jsx';

// QA Review Center — everything waiting on a QA signature, in one place.
//
// Adriana's sign-offs live in four different modules: production entries, QA
// inspections, cleaning records and scale verifications. Each is a different
// screen with a different filter, and the only way to know what was outstanding
// was to visit all four. This is the list she works instead.
//
// Signing here signs in the module. The server hands each record to the owning
// module's own sign function, so the record, its columns and its audit entry
// are identical to signing it on its own screen — this is a different door, not
// a second signature path.
//
// The piles that are NOT here are the ones that shouldn't be: deviations,
// non-conformances, on-hold records and disposals are multi-party approvals
// with an e-signature intent statement. Approving one is a decision about
// product and belongs on the record, next to the investigation.

const fmtDate = (d) => (d ? String(d).slice(0, 10) : '—');

function ResultChip({ result }) {
  if (!result) return null;
  const fail = String(result).toLowerCase() === 'fail';
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold ${
      fail ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'}`}>
      {fail ? <XCircle size={10} /> : <CheckCircle2 size={10} />}
      {String(result).toUpperCase()}
    </span>
  );
}

// How long something has been sitting. The queue is sorted oldest-first, so
// this is the number that says whether the pile is healthy.
function ageDays(date) {
  if (!date) return null;
  const then = Date.parse(`${String(date).slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(then)) return null;
  return Math.floor((Date.now() - then) / 86400000);
}

function AgeChip({ date }) {
  const n = ageDays(date);
  if (n === null || n < 3) return null;
  const bad = n >= 14;
  return (
    <span className={`shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded ${
      bad ? 'bg-red-50 text-red-600' : 'bg-amber-50 text-amber-700'}`}>
      {n}d
    </span>
  );
}

export default function QAReviewPanel() {
  const { user } = useAuth();
  const { data, loading, refresh } = useApiGet('/qa-review');
  const [active, setActive] = useState(null);
  const [selected, setSelected] = useState(() => new Set());
  const [busy, setBusy] = useState(false);
  const [problems, setProblems] = useState([]);

  const sources = useMemo(() => data?.sources || [], [data]);
  // Default to the biggest pile rather than the first one — that's where the
  // work is, and it saves a click every single time.
  const current = useMemo(() => {
    if (active) return sources.find(s => s.key === active) || null;
    return [...sources].sort((a, b) => b.count - a.count)[0] || null;
  }, [sources, active]);

  const items = useMemo(() => current?.items || [], [current]);
  const view = useCappedList(items);

  const pick = (id) => setSelected(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const allShownSelected = view.items.length > 0 && view.items.every(i => selected.has(i.id));
  const toggleAllShown = () => setSelected(prev => {
    const next = new Set(prev);
    if (allShownSelected) view.items.forEach(i => next.delete(i.id));
    else view.items.forEach(i => next.add(i.id));
    return next;
  });

  const switchSource = (key) => { setActive(key); setSelected(new Set()); setProblems([]); };

  const sign = async (ids) => {
    if (!current || !ids.length) return;
    setBusy(true);
    setProblems([]);
    try {
      const res = await apiPost('/qa-review/sign', { source: current.key, ids });
      // Partial success is the normal case when someone else signed a record
      // while this list was open — report it rather than silently dropping it.
      setProblems(res?.failed || []);
      setSelected(new Set());
      refresh();
    } catch (e) {
      setProblems([{ id: null, error: e?.message || 'Could not sign those records.' }]);
    } finally {
      setBusy(false);
    }
  };

  const openModule = () => {
    if (current?.module) window.dispatchEvent(new CustomEvent('app-navigate', { detail: { tab: current.module } }));
  };

  const total = data?.total || 0;

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="text-xl font-bold text-gray-900">QA Review</h2>
          <p className="text-sm text-gray-500">
            Everything waiting on your signature, across every log. Signing here signs it in its own module.
          </p>
        </div>
        <button onClick={refresh} className="p-2 rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-600"
          data-tip="Refresh" data-tip-left>
          <RefreshCw size={17} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {loading && !data ? (
        <div className="text-center py-12 text-gray-400 text-sm">Loading…</div>
      ) : total === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 text-center py-16">
          <ClipboardCheck size={40} className="mx-auto mb-3 text-green-500" />
          <p className="font-semibold text-gray-900">Nothing is waiting on QA.</p>
          <p className="text-sm text-gray-500 mt-1">Every log is signed off.</p>
        </div>
      ) : (
        <>
          {/* One card per pile. The count is the whole point, so it leads. */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
            {sources.map(s => (
              <button key={s.key} onClick={() => switchSource(s.key)}
                className={`text-left rounded-xl border px-3 py-2.5 transition-colors ${
                  current?.key === s.key
                    ? 'border-powder-500 bg-powder-50 ring-1 ring-powder-500'
                    : 'border-gray-200 bg-white hover:bg-gray-50'}`}>
                <p className={`text-2xl font-bold tabular-nums ${s.count ? 'text-gray-900' : 'text-gray-300'}`}>{s.count}</p>
                <p className="text-xs font-medium text-gray-700 leading-tight mt-0.5">{s.label}</p>
                {s.form && <p className="text-[10px] text-gray-400 font-mono mt-0.5">{s.form}</p>}
              </button>
            ))}
          </div>

          {problems.length > 0 && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5">
              <p className="text-sm font-semibold text-amber-800 flex items-center gap-1.5">
                <AlertTriangle size={15} /> {problems.length} record{problems.length === 1 ? '' : 's'} could not be signed
              </p>
              <ul className="mt-1 text-xs text-amber-700 list-disc list-inside">
                {problems.slice(0, 5).map((p, i) => <li key={p.id || i}>{p.error}</li>)}
              </ul>
            </div>
          )}

          {current && (
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-100 bg-gray-50 flex-wrap">
                <label className="flex items-center gap-2 text-sm text-gray-600">
                  <input type="checkbox" checked={allShownSelected} onChange={toggleAllShown}
                    disabled={!current.can_sign || !view.items.length}
                    className="rounded border-gray-300 w-4 h-4" />
                  Select all shown
                </label>
                <span className="text-xs text-gray-400">
                  {current.count} {current.count === 1 ? current.noun : current.plural} pending · oldest first
                </span>
                <button onClick={openModule}
                  className="ml-auto inline-flex items-center gap-1 text-xs font-medium text-powder-600 hover:underline">
                  Open {current.label} <ExternalLink size={12} />
                </button>
              </div>

              {!current.can_sign && (
                <p className="px-3 py-2 text-xs text-gray-500 bg-gray-50 border-b border-gray-100">
                  You can see this queue but not sign it — {current.label.toLowerCase()} sign-off is granted separately.
                </p>
              )}

              {items.length === 0 ? (
                <p className="text-center py-10 text-sm text-gray-400">Nothing pending here.</p>
              ) : (
                <ul className="divide-y divide-gray-100">
                  {view.items.map(r => (
                    <li key={r.id} className="flex items-start gap-3 px-3 py-2.5">
                      <input type="checkbox" checked={selected.has(r.id)} onChange={() => pick(r.id)}
                        disabled={!current.can_sign}
                        className="mt-1 rounded border-gray-300 w-4 h-4 shrink-0" />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-[15px] font-medium text-gray-900 leading-snug">{r.title}</p>
                          <ResultChip result={r.result} />
                        </div>
                        <p className="text-xs text-gray-500 mt-0.5">
                          {[r.subtitle, r.by, fmtDate(r.date)].filter(Boolean).join(' · ')}
                        </p>
                        {r.extra && <p className="text-xs text-gray-400 mt-0.5 truncate">{r.extra}</p>}
                      </div>
                      <AgeChip date={r.date} />
                      {current.can_sign && (
                        <button onClick={() => sign([r.id])} disabled={busy}
                          className="shrink-0 px-2.5 py-1 bg-powder-600 text-white text-xs font-semibold rounded-md disabled:opacity-50">
                          Sign
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              <ShowMore view={view} noun={current.plural} />
            </div>
          )}
        </>
      )}

      {/* Batch bar — only while something is ticked, and it names what it will
          sign as, because a signature is attributable. */}
      {selected.size > 0 && current?.can_sign && (
        <div className="sticky bottom-20 sm:bottom-4 z-20 mx-auto max-w-lg bg-gray-900 text-white rounded-xl shadow-lg px-4 py-3 flex items-center gap-3">
          <span className="text-sm font-medium">
            {selected.size} selected
          </span>
          <span className="text-xs text-gray-400 truncate">sign as {user?.name}</span>
          <button onClick={() => setSelected(new Set())} className="ml-auto text-xs text-gray-300 hover:text-white">
            Clear
          </button>
          <button onClick={() => sign([...selected])} disabled={busy}
            className="px-3 py-1.5 bg-powder-500 hover:bg-powder-400 rounded-lg text-sm font-semibold disabled:opacity-50">
            {busy ? 'Signing…' : 'Sign off'}
          </button>
        </div>
      )}
    </div>
  );
}
