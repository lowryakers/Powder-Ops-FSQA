import { useState, useMemo } from 'react';
import { useApiGet, apiPost } from '../../hooks/useApi';
import { X, ClipboardList, AlertTriangle, Check } from 'lucide-react';

/**
 * "Review and create for all" — turn the maintenance tasks already written on
 * equipment records into recurring PM schedules, in one pass.
 *
 * The plant wrote tasks under Daily / Weekly / Monthly headings expecting that
 * to BE the PM schedule. It never was: the task list and the recurring schedule
 * are different records, so ~80 machines had good tasks that generated nothing.
 * This closes that gap without inventing anything — every schedule carries the
 * operator's own words at the frequency they chose.
 *
 * REVIEWED, NOT AUTOMATIC. Everything is listed with what it would create and
 * nothing is written until it's ticked. A bulk write across 80 machines that
 * nobody looked at is exactly how a maintenance programme fills up with
 * schedules no one meant.
 */
export default function SchedulesFromTasksModal({ onClose, onDone }) {
  const { data, loading, refresh } = useApiGet('/equipment/schedules-from-tasks/preview');
  const [picked, setPicked] = useState(null); // null = "all of them", until touched
  const [expanded, setExpanded] = useState(null);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');

  const machines = data?.machines || [];
  const selected = useMemo(
    () => (picked === null ? new Set(machines.map(m => m.id)) : picked),
    [picked, machines],
  );

  const toggle = (id) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id); else next.add(id);
    setPicked(next);
  };
  const allOn = machines.length > 0 && selected.size === machines.length;
  const scheduleCount = machines.filter(m => selected.has(m.id)).reduce((t, m) => t + m.create.length, 0);

  const commit = async () => {
    setSaving(true); setError('');
    try {
      const r = await apiPost('/equipment/schedules-from-tasks/bulk', { ids: [...selected] });
      setResult(r);
      onDone?.();
      refresh();
    } catch (e) { setError(e.message); }
    finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div onClick={e => e.stopPropagation()} className="bg-white rounded-xl shadow-xl w-full max-w-3xl max-h-[92vh] flex flex-col">
        <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-gray-100">
          <div className="min-w-0">
            <h3 className="text-base font-semibold text-gray-900 flex items-center gap-2">
              <ClipboardList size={17} className="text-gray-400" /> Create PM schedules from written tasks
            </h3>
            <p className="text-xs text-gray-500 mt-0.5">
              These machines have maintenance tasks written but nothing generating them. Each schedule uses
              those tasks exactly as written, at the frequency they were written under.
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 shrink-0"><X size={18} /></button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
          {loading && <p className="text-sm text-gray-400 py-6 text-center">Working out what's missing…</p>}

          {result && (
            <div className="rounded-lg bg-green-50 border border-green-200 p-3">
              <p className="text-sm font-medium text-green-900 flex items-center gap-1.5">
                <Check size={15} /> Created {result.schedules_created} schedule{result.schedules_created === 1 ? '' : 's'} across {result.machines} machine{result.machines === 1 ? '' : 's'}.
              </p>
              <p className="text-xs text-green-800 mt-1">
                Task Center will pick these up on its next housekeeping pass — within about five minutes.
              </p>
            </div>
          )}

          {!loading && !machines.length && !result && (
            <p className="text-sm text-gray-500 py-6 text-center">
              Nothing to create — every machine with written tasks already has a recurring schedule.
            </p>
          )}

          {machines.length > 0 && (
            <>
              <div className="flex items-center gap-3 flex-wrap">
                <label className="flex items-center gap-2 text-sm text-gray-700">
                  <input type="checkbox" checked={allOn}
                    onChange={() => setPicked(allOn ? new Set() : new Set(machines.map(m => m.id)))}
                    className="rounded border-gray-300" />
                  Select all {machines.length}
                </label>
                <span className="text-xs text-gray-500">
                  {selected.size} machine{selected.size === 1 ? '' : 's'} · {scheduleCount} schedule{scheduleCount === 1 ? '' : 's'} to create
                </span>
              </div>

              {machines.map(m => {
                const on = selected.has(m.id);
                const open = expanded === m.id;
                return (
                  <div key={m.id} className={`rounded-lg border ${on ? 'border-powder-200 bg-powder-50/40' : 'border-gray-200 bg-white'}`}>
                    <div className="flex items-start gap-2 px-3 py-2">
                      <input type="checkbox" checked={on} onChange={() => toggle(m.id)} className="rounded border-gray-300 mt-1 shrink-0" />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline gap-2 flex-wrap">
                          <span className="text-sm font-medium text-gray-900">{m.name}</span>
                          <span className="text-[11px] text-gray-500">{m.type}{m.asset_id ? ` · #${m.asset_id}` : ''}</span>
                          {/* A schedule with no team generates work orders that
                              reach nobody, so it's worth seeing before you commit. */}
                          {m.no_team && (
                            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-800">
                              <AlertTriangle size={10} /> no team assigned
                            </span>
                          )}
                        </div>
                        <p className="text-[11px] text-gray-600">
                          {m.create.map(c => `${c.frequency} (${c.step_count})`).join(' · ')}
                        </p>
                        {m.skip.length > 0 && (
                          <p className="text-[11px] text-gray-400">
                            Skipping {m.skip.map(sk => `${sk.frequency} — ${sk.reason}`).join('; ')}
                          </p>
                        )}
                      </div>
                      <button type="button" onClick={() => setExpanded(open ? null : m.id)}
                        className="shrink-0 text-[11px] text-powder-600 hover:underline">
                        {open ? 'Hide' : 'Show tasks'}
                      </button>
                    </div>
                    {open && (
                      <div className="px-3 pb-3 pt-0 space-y-2">
                        {m.create.map(c => (
                          <div key={c.frequency} className="rounded border border-gray-200 bg-white p-2">
                            <p className="text-[10px] font-bold uppercase tracking-wide text-gray-500">{c.frequency}</p>
                            <ul className="mt-1 space-y-0.5">
                              {c.steps.map((st, i) => (
                                <li key={i} className="text-xs text-gray-700 flex items-start gap-1.5">
                                  <span className="mt-1.5 h-1 w-1 rounded-full bg-gray-400 shrink-0" />{st}
                                </li>
                              ))}
                            </ul>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </>
          )}
          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-gray-100">
          <button onClick={onClose} className="px-4 py-2 bg-gray-100 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-200">
            {result ? 'Close' : 'Cancel'}
          </button>
          {!result && (
            <button onClick={commit} disabled={saving || selected.size === 0}
              className="px-4 py-2 bg-powder-600 text-white text-sm font-medium rounded-lg hover:bg-powder-700 disabled:opacity-50">
              {saving ? 'Creating…' : `Create ${scheduleCount} schedule${scheduleCount === 1 ? '' : 's'}`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
