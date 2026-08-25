import { useState, useEffect } from 'react';
import { useApiGet, apiPost } from '../../hooks/useApi';
import { X, AlertTriangle, Check } from 'lucide-react';

// Putting a PM checklist back to what the Equipment list says.
//
// A schedule's steps are a COPY of the machine's written tasks for that
// cadence, and a bug used to write every cadence into every schedule — so the
// forklift's daily task, 11 items on the Equipment list, reached the floor as
// 39 lines including the annual load test. The cause is fixed; this is for the
// schedules that were already flattened.
//
// Reviewed rather than automatic, and never "all" by default in the request,
// because it rewrites a maintenance procedure — the same rule the other two
// repairs on this screen follow.

export default function ResyncStepsModal({ onClose, onDone }) {
  const { data, loading, refresh } = useApiGet('/equipment/procedure-steps/resync/preview');
  const [selected, setSelected] = useState(new Set());
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);
  const [error, setError] = useState('');
  // Over-carrying first — that is the complaint that brought anyone here.
  const machines = [...(data?.machines || [])].sort((a, b) => (b.has_extra ? 1 : 0) - (a.has_extra ? 1 : 0));

  // ONLY THE MACHINES CARRYING EXTRA STEPS ARE PRE-SELECTED. A schedule with
  // FEWER steps than are written is usually deliberate — a procedure typed by
  // hand, or one narrowed on purpose — and pre-ticking it would quietly put
  // back work somebody removed. The bug is over-carrying; that is the default.
  useEffect(() => {
    setSelected(new Set(machines.filter(m => m.has_extra).map(m => m.id)));
  }, [data]);   // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = (id) => setSelected(s => {
    const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n;
  });

  const run = async () => {
    setBusy(true); setError('');
    try {
      const r = await apiPost('/equipment/procedure-steps/resync', { ids: [...selected] });
      setDone(r); refresh(); onDone?.();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50" onClick={onClose}>
      <div className="bg-white rounded-2xl max-w-3xl w-full max-h-[92vh] overflow-y-auto p-5"
        onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-bold text-gray-900">Re-sync PM steps to the Equipment list</h3>
            <p className="text-sm text-gray-500 mt-0.5">
              Each schedule goes back to exactly the tasks written under its own frequency.
              A frequency with nothing written is left alone.
            </p>
          </div>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-700">
            <X size={20} />
          </button>
        </div>

        {loading && <p className="text-sm text-gray-400 py-8 text-center">Checking…</p>}

        {done && (
          <div className="mt-4 bg-green-50 border border-green-200 rounded-xl p-3 flex items-start gap-2">
            <Check size={16} className="text-green-600 shrink-0 mt-0.5" />
            <p className="text-sm text-green-900">
              Re-synced {done.machines} machine{done.machines === 1 ? '' : 's'}. Open tasks already on the
              floor were updated too, so nobody is left working from the old checklist.
            </p>
          </div>
        )}

        {!loading && !machines.length && !done && (
          <p className="text-sm text-gray-500 py-8 text-center">
            Every schedule already matches the Equipment list. Nothing to do.
          </p>
        )}

        {!!machines.length && (
          <>
            <div className="mt-4 flex items-center justify-between text-sm">
              <span className="text-gray-600">
                {data.extra_schedules} carrying steps that aren&rsquo;t theirs
                {data.fewer_schedules > 0 && ` · ${data.fewer_schedules} carrying fewer than written`}
                {data.reworded_schedules > 0 && ` · ${data.reworded_schedules} worded differently`}
              </span>
              <button type="button"
                onClick={() => setSelected(s => (s.size === machines.length ? new Set() : new Set(machines.map(m => m.id))))}
                className="text-powder-600 font-medium">
                {selected.size === machines.length ? 'Select none' : 'Select every machine'}
              </button>
            </div>

            {data.fewer_schedules > 0 && (
              <p className="mt-2 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-2.5">
                Only the machines carrying <span className="font-medium">extra</span> steps are ticked.
                A schedule holding <span className="font-medium">fewer</span> steps than are written is often
                deliberate — someone narrowed it — so re-syncing would put that work back. Tick those only if
                you mean to.
              </p>
            )}

            <div className="mt-2 border border-gray-200 rounded-xl divide-y divide-gray-100 max-h-[46vh] overflow-y-auto">
              {machines.map(m => (
                <label key={m.id} className="flex items-start gap-3 p-3 cursor-pointer hover:bg-gray-50">
                  <input type="checkbox" className="mt-1 h-4 w-4" checked={selected.has(m.id)}
                    onChange={() => toggle(m.id)} />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium text-gray-900">
                      {m.name}{m.asset_id ? <span className="text-gray-400 font-normal"> · {m.asset_id}</span> : null}
                    </span>
                    <span className="flex flex-wrap gap-x-4 gap-y-0.5 mt-0.5">
                      {m.schedules.map(s => (
                        <span key={s.id} className="text-xs text-gray-600 tabular-nums">
                          {s.frequency_type}{' '}
                          {s.direction === 'reworded' ? (
                            <span className="text-gray-500">{s.now} steps, worded differently</span>
                          ) : (
                            <>
                              <span className={s.direction === 'extra' ? 'text-red-700 font-medium' : 'text-amber-700 font-medium'}>{s.now}</span>
                              {' → '}
                              <span className="text-green-700 font-medium">{s.should_be}</span>
                              {' steps'}
                            </>
                          )}
                        </span>
                      ))}
                    </span>
                  </span>
                </label>
              ))}
            </div>

            {error && (
              <p className="mt-3 flex items-start gap-2 text-sm text-red-700">
                <AlertTriangle size={16} className="shrink-0 mt-0.5" />{error}
              </p>
            )}

            <div className="mt-4 flex items-center gap-2">
              <button type="button" onClick={run} disabled={busy || !selected.size}
                className="px-4 py-2 bg-powder-600 text-white rounded-lg text-sm font-medium disabled:opacity-40">
                {busy ? 'Re-syncing…' : `Re-sync ${selected.size} machine${selected.size === 1 ? '' : 's'}`}
              </button>
              <button type="button" onClick={onClose}
                className="px-4 py-2 text-gray-600 text-sm font-medium">Close</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
