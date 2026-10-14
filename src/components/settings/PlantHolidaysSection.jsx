import { useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useApiGet, apiPut, apiFetch } from '../../hooks/useApi';

// Settings → Plant holidays (D-175). The paid holidays are RULES; a year's dates
// are derived. This is where the plant corrects ONE year of one rule — observe
// it on another day, skip it, or switch a Monday's Tuesday–Friday shift off or
// on — with a reason, audited. Nothing here adds a new holiday.
export default function PlantHolidaysSection() {
  const [year, setYear] = useState(() => new Date().getFullYear());
  const { data, refresh } = useApiGet(`/plant-calendar?year=${year}`, [year]);
  const [editing, setEditing] = useState(null);
  const rows = data?.holidays || [];

  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-600">
        The plant observes these paid holidays every year ({data?.holiday_hours ?? 8} hours each). A holiday on a weekend
        is observed the Friday before; one on a Monday moves production to Tuesday–Friday that week. Change a single
        year here — the rules themselves are the plant's decision of 14 October 2026.
      </p>
      <div className="flex items-center gap-2">
        <button onClick={() => setYear(y => y - 1)} className="rounded-lg p-1.5 hover:bg-gray-100" aria-label="Previous year"><ChevronLeft size={18} /></button>
        <span className="text-lg font-semibold tabular-nums" data-holiday-year>{year}</span>
        <button onClick={() => setYear(y => y + 1)} className="rounded-lg p-1.5 hover:bg-gray-100" aria-label="Next year"><ChevronRight size={18} /></button>
      </div>
      <ul className="divide-y divide-gray-100 rounded-xl border border-gray-200 bg-white">
        {rows.map(h => (
          <li key={h.key} data-holiday-row={h.key} className="px-4 py-3 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className={`font-medium ${h.cancelled ? 'text-gray-400 line-through' : 'text-gray-900'}`}>{h.name}</div>
                <div className="text-xs text-gray-500">
                  {h.cancelled ? 'Not observed this year' : fmt(h.date)}
                  {!h.cancelled && h.moved && <> · observed (falls on {fmt(h.natural_date)})</>}
                  {h.shift_week && <span className="ml-1 rounded-full bg-emerald-100 px-1.5 py-0.5 font-semibold text-emerald-800">Tue–Fri production</span>}
                </div>
                {h.override && (
                  <div className="mt-0.5 text-xs text-amber-800">Changed for {year} by {h.override.set_by || 'an admin'}: {h.override.reason}</div>
                )}
              </div>
              {data?.can_edit && (
                <div className="flex gap-1.5">
                  {h.override && (
                    <button onClick={async () => { await apiFetch(`/plant-calendar/${h.key}/${h.year}`, { method: 'DELETE' }); refresh(); }}
                      className="rounded-lg border border-gray-200 px-2.5 py-1 text-xs hover:bg-gray-50">Back to the rule</button>
                  )}
                  <button data-holiday-edit={h.key} onClick={() => setEditing(h)}
                    className="rounded-lg border border-gray-200 px-2.5 py-1 text-xs hover:bg-gray-50">Change {year}</button>
                </div>
              )}
            </div>
          </li>
        ))}
      </ul>
      {editing && <EditHoliday h={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); refresh(); }} />}
    </div>
  );
}

function fmt(d) {
  try { return new Date(d + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }); }
  catch { return d; }
}

function EditHoliday({ h, onClose, onSaved }) {
  const [observed, setObserved] = useState(h.override?.observed_on || h.date);
  const [skip, setSkip] = useState(!!h.cancelled);
  const [shift, setShift] = useState(h.override?.shift_week == null ? 'default' : (h.override.shift_week ? 'on' : 'off'));
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const save = async () => {
    setError('');
    try {
      await apiPut(`/plant-calendar/${h.key}/${h.year}`, {
        observed_on: skip || observed === h.date && !h.override?.observed_on ? null : observed,
        cancelled: skip,
        shift_week: shift === 'default' ? null : shift === 'on',
        reason,
      });
      onSaved();
    } catch (e) { setError(e.message || 'Could not save'); }
  };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div className="max-h-[92vh] w-full max-w-md space-y-3 overflow-y-auto rounded-xl bg-white p-5 shadow-xl" onClick={e => e.stopPropagation()}>
        <h3 className="font-semibold text-gray-900">{h.name} — {h.year}</h3>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" className="h-4 w-4 shrink-0" checked={skip} onChange={e => setSkip(e.target.checked)} />
          Not observed this year
        </label>
        {!skip && (
          <>
            <label className="block text-sm">
              <span className="text-xs font-medium text-gray-700">Observed on</span>
              <input id="holiday-observed" type="date" value={observed} onChange={e => setObserved(e.target.value)}
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
            </label>
            <label className="block text-sm">
              <span className="text-xs font-medium text-gray-700">Production that week</span>
              <select id="holiday-shift" value={shift} onChange={e => setShift(e.target.value)}
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm">
                <option value="default">The rule (a Monday holiday moves production to Tue–Fri)</option>
                <option value="on">Move production to Tuesday–Friday</option>
                <option value="off">Keep production Monday–Thursday</option>
              </select>
            </label>
          </>
        )}
        <label className="block text-sm">
          <span className="text-xs font-medium text-gray-700">Reason (required)</span>
          <input id="holiday-reason" value={reason} onChange={e => setReason(e.target.value)}
            className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" placeholder="e.g. Customer order — we run that Monday" />
        </label>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg px-3 py-1.5 text-sm hover:bg-gray-100">Cancel</button>
          <button data-holiday-save onClick={save} className="rounded-lg bg-powder-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-powder-700">Save</button>
        </div>
      </div>
    </div>
  );
}
