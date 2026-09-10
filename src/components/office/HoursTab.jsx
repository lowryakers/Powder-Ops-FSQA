import { useState, useEffect } from 'react';
import { useApiGet, apiPut, apiPost, apiFetch } from '../../hooks/useApi';
import { Users, Clock, Plus, X } from 'lucide-react';
import { parseHours, formatHours, hoursInputValue } from '../../lib/hoursFormat';

// Hours worked vs paid non-working time, per pay period — merged in from the
// standalone tracker. The roster is live from Settings, so nobody keeps a
// second employee list, and the pay periods are the same biweekly ones the
// absence log uses.
//
// Auto-fill is the habit worth preserving: type what someone actually worked
// and the balance up to their weekly target shows as paid non-working time.
const periodLabel = (p) => {
  const f = (d) => { const x = new Date(`${d}T00:00:00Z`); return `${x.getUTCMonth() + 1}/${x.getUTCDate()}`; };
  return `${f(p.start)} – ${f(p.end)}`;
};
const weekLabel = (w) => {
  const a = new Date(`${w}T00:00:00Z`);
  const b = new Date(a.getTime() + 6 * 86400000);
  return `${a.getUTCMonth() + 1}/${a.getUTCDate()}–${b.getUTCMonth() + 1}/${b.getUTCDate()}`;
};
const hrs = (n) => formatHours(n);

/**
 * Add a contractor or temporary worker.
 *
 * They are STORED on the pay roster (`pay_employees`, `worker_type` =
 * contractor) because that is where a rate and its history already live — but
 * they are added and managed HERE, next to the hours they are paid for, which
 * is the question anybody actually has about a temp. Pay Tracking is raises and
 * reviews, and a contractor has neither.
 *
 * Deliberately NOT a `users` row: a temp who never signs in is not an account,
 * and giving them one would put them in the @mention list, the assignee picker,
 * Team Activity and the comms member list.
 */
function AddContractorModal({ onClose, onAdded }) {
  const [form, setForm] = useState({ name: '', contractor_company: '', team: '', pay_rate: '', hire_date: '', ends_on: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const save = async () => {
    if (!form.name.trim()) { setError('Name is required'); return; }
    setBusy(true); setError('');
    try {
      await apiPost('/pay/employees', {
        name: form.name.trim(), worker_type: 'contractor',
        contractor_company: form.contractor_company.trim() || null,
        team: form.team.trim() || null,
        pay_rate: form.pay_rate !== '' ? Number(form.pay_rate) : null,
        hire_date: form.hire_date || null, ends_on: form.ends_on || null,
      });
      onAdded?.(); onClose();
    } catch (e) { setError(e.message); setBusy(false); }
  };
  const field = 'w-full px-3 py-2 border border-gray-300 rounded-lg text-sm';
  const label = 'block text-xs font-medium text-gray-700 mb-1';
  return (
    <div className="fixed inset-0 z-[70] bg-black/30 flex items-center justify-center p-4" onClick={onClose}>
      <div onClick={e => e.stopPropagation()} className="bg-white rounded-xl shadow-xl w-full max-w-md p-4 space-y-3 max-h-[92vh] overflow-y-auto" data-add-contractor>
        <h3 className="font-semibold text-gray-900 text-sm">Add a contractor or temporary worker</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <div className="sm:col-span-2">
            <label className={label}>Name *</label>
            <input value={form.name} onChange={e => set('name', e.target.value)} className={field} data-contractor-name />
          </div>
          <div>
            <label className={label}>Agency or company</label>
            <input value={form.contractor_company} onChange={e => set('contractor_company', e.target.value)}
              className={field} placeholder="Leave blank if direct" />
          </div>
          <div>
            <label className={label}>Team</label>
            <input value={form.team} onChange={e => set('team', e.target.value)} className={field} />
          </div>
          <div>
            <label className={label}>Pay rate</label>
            <input type="number" step="0.01" min="0" value={form.pay_rate} onChange={e => set('pay_rate', e.target.value)} className={field} />
          </div>
          <div>
            <label className={label}>Started</label>
            <input type="date" value={form.hire_date} onChange={e => set('hire_date', e.target.value)} className={field} />
          </div>
          <div className="sm:col-span-2">
            <label className={label}>Expected to end</label>
            <input type="date" value={form.ends_on} onChange={e => set('ends_on', e.target.value)} className={field} />
            <p className="text-[11px] text-gray-500 mt-0.5">A reminder, not a rule — nothing happens on this date by itself.</p>
          </div>
        </div>
        {error && <p className="text-xs text-red-600">{error}</p>}
        <div className="flex gap-2 justify-end">
          <button onClick={onClose} className="px-3 py-2 border border-gray-300 rounded-lg text-sm">Cancel</button>
          <button onClick={save} disabled={busy}
            className="px-4 py-2 bg-powder-600 text-white rounded-lg text-sm font-semibold disabled:opacity-50">
            {busy ? 'Adding…' : 'Add'}
          </button>
        </div>
      </div>
    </div>
  );
}

// Hours are typed and shown as h:mm (39:56) and stored as decimal — see
// lib/hoursFormat. It has to be a text box, not type="number": a number input
// rejects the colon outright and a phone keyboard would never offer one.
// inputMode="text" keeps the numeric keypad's punctuation available.
function HourInput({ value, onCommit, tone = '', className = 'w-16' }) {
  const [draft, setDraft] = useState(hoursInputValue(value));
  // Re-sync when the saved value changes (a refresh after someone else's edit).
  useEffect(() => { setDraft(hoursInputValue(value)); }, [value]);

  const commit = () => {
    const next = parseHours(draft);
    // Normalize what's on screen ("39.93" → "39:56") whether or not it changed.
    setDraft(hoursInputValue(next));
    if (Math.abs(next - (Number(value) || 0)) > 0.0001) onCommit(next);
  };

  return (
    <input type="text" inputMode="text" value={draft} placeholder="0:00"
      onChange={e => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }}
      className={`${className} px-1.5 py-1 border border-gray-200 rounded text-sm text-right tabular-nums ${tone}`} />
  );
}

export default function HoursTab() {
  const { data: periods } = useApiGet('/office/periods');
  const [period, setPeriod] = useState('');
  const activePeriod = period || periods?.[0]?.start || '';
  const { data, refresh } = useApiGet(activePeriod ? `/office/hours?period=${activePeriod}` : null, [activePeriod]);

  const save = async (userId, weekStart, patch) => {
    await apiPut('/office/hours', { user_id: userId, week_start: weekStart, ...patch });
    refresh();
  };
  // Employees first, then a labelled break, then contractors. One list rather
  // than two tables: the columns are identical and a second table would double
  // every future change to this grid.
  const people = data?.people || [];
  const employeeRows = people.filter(p => !p.is_contractor);
  const contractorRows = people.filter(p => p.is_contractor);
  const rows = [...employeeRows, { __divider: true }, ...contractorRows];
  const [addingContractor, setAddingContractor] = useState(false);

  // Taking a temp off the list DEACTIVATES rather than deletes. What we paid
  // somebody is a payroll record: the row and its rate history stay, the list
  // simply stops showing them, and the hours already logged for the period they
  // worked are untouched. Deleting outright is still possible in Pay Tracking
  // while nothing has been paid.
  const endContractor = async (p) => {
    if (!window.confirm(`Take ${p.name} off the list? Their hours and pay history are kept.`)) return;
    await apiFetch(`/pay/employees/${p.user_id}`, { method: 'PUT', body: JSON.stringify({ active: 0 }) });
    refresh();
  };

  const saveTarget = async (userId, target) => {
    await apiPut(`/office/hours/target/${userId}`, { target });
    refresh();
  };

  const t = data?.totals || {};

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <select value={activePeriod} onChange={e => setPeriod(e.target.value)}
          className="px-2.5 py-2 border border-gray-200 rounded-lg text-sm bg-white text-gray-700">
          {(periods || []).map(p => (
            <option key={p.start} value={p.start}>{periodLabel(p)}{p.current ? ' · current' : ''}</option>
          ))}
        </select>
        <span className="text-xs text-gray-400">
          Weeks run Sunday–Saturday. Enter hours as <span className="font-medium text-gray-500">h:mm</span> (39:56) — decimals still work.
          The rest up to each person&apos;s target shows as paid non-working.
        </span>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
        {[
          { label: 'Worked', value: t.worked, icon: Clock },
          { label: 'PTO', value: t.pto },
          { label: 'Holiday', value: t.holiday },
          { label: 'Paid non-working', value: t.non_working, alert: (t.non_working || 0) > 0 },
          { label: 'Overtime', value: t.overtime, alert: (t.overtime || 0) > 0 },
        ].map(c => (
          <div key={c.label} className="bg-white rounded-xl border border-gray-200 px-3 py-2">
            <p className="text-[10px] font-medium text-gray-500 uppercase tracking-wide">{c.label}</p>
            <p className={`text-lg font-bold tabular-nums ${c.alert ? 'text-amber-600' : 'text-gray-900'}`}>{formatHours(c.value, { zero: '0:00' })}</p>
          </div>
        ))}
      </div>

      {/* Desktop: both weeks side by side */}
      <div className="hidden lg:block bg-white rounded-xl border border-gray-200 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50">
            <tr className="text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wide">
              {/* Say how it's sorted — the names show first-name-first, so an
                  A–Z-by-surname list otherwise reads as no order at all. */}
              <th className="px-3 py-2">Employee <span className="text-gray-400 normal-case font-normal">· by last name</span></th>
              <th className="px-3 py-2">Target/wk</th>
              {(data?.weeks || []).map(w => (
                <th key={w} colSpan={5} className="px-3 py-2 text-center border-l border-gray-200">Week of {weekLabel(w)}</th>
              ))}
              <th className="px-3 py-2 text-right border-l border-gray-200">Period total</th>
            </tr>
            <tr className="text-left text-[10px] font-medium text-gray-400">
              <th className="px-3 pb-2" /><th className="px-3 pb-2" />
              {(data?.weeks || []).map(w => (
                <th key={w} colSpan={5} className="px-3 pb-2 border-l border-gray-200">
                  <div className="grid grid-cols-5 gap-1 text-center">
                    <span>Worked</span><span>PTO</span><span>Holiday</span><span>Unpaid</span><span>Non-work</span>
                  </div>
                </th>
              ))}
              <th className="px-3 pb-2 border-l border-gray-200" />
            </tr>
          </thead>
          <tbody>
            {rows.map(p => (p.__divider ? (
              <tr key="contractor-divider" className="border-t-2 border-gray-300 bg-gray-50">
                <td colSpan={14} className="px-3 py-1.5">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-600">Contractors &amp; temporary workers</span>
                    <span className="text-[11px] text-gray-400">No weekly target — their paid hours are the hours worked.</span>
                    <button onClick={() => setAddingContractor(true)} data-add-contractor-btn
                      className="ml-auto inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-medium border border-gray-200 bg-white text-gray-700 hover:bg-gray-50">
                      <Plus size={12} /> Add a contractor
                    </button>
                  </div>
                </td>
              </tr>
            ) : (
              <tr key={p.user_id} className="border-t border-gray-100 hover:bg-gray-50">
                <td className="px-3 py-1.5">
                  <span className="font-medium text-gray-900">{p.name}</span>
                  <span className="block text-[10px] text-gray-400 capitalize">
                    {p.is_contractor
                      ? (p.contractor_company || 'contractor')
                      : (p.department || '').replace('_', ' ')}
                  </span>
                </td>
                <td className="px-3 py-1.5">
                  {p.is_contractor
                    ? <span className="text-[11px] text-gray-300" title="A contractor has no weekly target">—</span>
                    : <HourInput value={p.target} onCommit={v => saveTarget(p.user_id, v)} tone="text-gray-500" />}
                </td>
                {p.weeks.map(w => (
                  <td key={w.week_start} colSpan={5} className="px-3 py-1.5 border-l border-gray-200">
                    <div className="grid grid-cols-5 gap-1 items-center">
                      <HourInput value={w.worked} onCommit={v => save(p.user_id, w.week_start, { worked: v })} />
                      <HourInput value={w.pto} onCommit={v => save(p.user_id, w.week_start, { pto: v })} />
                      <HourInput value={w.holiday} onCommit={v => save(p.user_id, w.week_start, { holiday: v })} />
                      <HourInput value={w.unpaid} onCommit={v => save(p.user_id, w.week_start, { unpaid: v })} />
                      <button
                        onClick={() => save(p.user_id, w.week_start, { auto_fill: !w.auto_fill })}
                        title={w.auto_fill ? 'Auto-filling to target — click to stop' : 'Not auto-filling — click to fill to target'}
                        className={`px-1.5 py-1 rounded text-xs font-medium ${
                          w.non_working > 0 ? 'bg-amber-100 text-amber-700'
                          : w.auto_fill ? 'text-gray-400 hover:bg-gray-100' : 'text-gray-300 line-through hover:bg-gray-100'}`}>
                        {w.non_working > 0 ? hrs(w.non_working) : (w.auto_fill ? 'auto' : 'off')}
                      </button>
                    </div>
                  </td>
                ))}
                <td className="px-3 py-1.5 text-right border-l border-gray-200">
                  <span className="font-semibold text-gray-900">{hrs(p.period.total)}</span>
                  {p.period.overtime > 0 && <span className="block text-[10px] text-amber-600">{hrs(p.period.overtime)} OT</span>}
                  {p.is_contractor && (
                    <button onClick={() => endContractor(p)} title="Take them off the list — hours and pay history are kept"
                      data-end-contractor className="block ml-auto mt-0.5 text-[10px] text-gray-400 hover:text-red-600">
                      <X size={11} className="inline" /> remove
                    </button>
                  )}
                </td>
              </tr>
            )))}
            {(data?.people || []).length === 0 && (
              <tr><td colSpan={14} className="px-4 py-8 text-center text-gray-400">
                <Users size={18} className="inline mr-1" /> No active people in Settings yet.
              </td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Phone and tablet: one card per person, one block per week. The same
          four numbers, big enough to actually tap. */}
      <div className="lg:hidden space-y-2">
        {people.map(p => (
          <div key={p.user_id} className="bg-white rounded-xl border border-gray-200 p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="font-medium text-gray-900">{p.name}</p>
                <p className="text-[11px] text-gray-400 capitalize">{(p.department || '').replace('_', ' ')}</p>
              </div>
              <div className="text-right shrink-0">
                <p className="text-lg font-bold text-gray-900">{hrs(p.period.total)}</p>
                <p className="text-[10px] text-gray-400">period total</p>
              </div>
            </div>

            <div className="mt-2 flex items-center gap-2">
              <span className="text-[11px] text-gray-500">Target / week</span>
              {p.is_contractor
                ? <span className="text-[11px] text-gray-300">—</span>
                : <HourInput value={p.target} onCommit={v => saveTarget(p.user_id, v)} tone="text-gray-500" />}
              {p.period.overtime > 0 && (
                <span className="ml-auto text-[11px] font-semibold text-amber-600">{hrs(p.period.overtime)} OT</span>
              )}
            </div>

            {p.weeks.map(w => (
              <div key={w.week_start} className="mt-2 rounded-lg bg-gray-50 p-2">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-[11px] font-semibold text-gray-600">Week of {weekLabel(w.week_start)}</span>
                  <button onClick={() => save(p.user_id, w.week_start, { auto_fill: !w.auto_fill })}
                    className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                      w.non_working > 0 ? 'bg-amber-100 text-amber-700'
                      : w.auto_fill ? 'bg-gray-200 text-gray-500' : 'bg-gray-100 text-gray-400 line-through'}`}>
                    {w.non_working > 0 ? `${hrs(w.non_working)} non-working` : (w.auto_fill ? 'auto-fill on' : 'auto-fill off')}
                  </button>
                </div>
                <div className="grid grid-cols-4 gap-2">
                  {[
                    ['Worked', 'worked'], ['PTO', 'pto'], ['Holiday', 'holiday'], ['Unpaid', 'unpaid'],
                  ].map(([label, key]) => (
                    <label key={key} className="block">
                      <span className="block text-[10px] text-gray-400 mb-0.5">{label}</span>
                      <HourInput value={w[key]} className="w-full"
                        onCommit={v => save(p.user_id, w.week_start, { [key]: v })} />
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ))}
        {(data?.people || []).length === 0 && (
          <p className="text-center py-8 text-sm text-gray-400">No active people in Settings yet.</p>
        )}
        {/* Phone: the section header carries its own Add button, since the
            table's divider row is not rendered in this layout. */}
        <button onClick={() => setAddingContractor(true)}
          className="mt-2 w-full inline-flex items-center justify-center gap-1 px-3 py-2 rounded-lg text-xs font-medium border border-gray-200 bg-white text-gray-700">
          <Plus size={13} /> Add a contractor
        </button>
      </div>

      {addingContractor && (
        <AddContractorModal onClose={() => setAddingContractor(false)} onAdded={refresh} />
      )}
    </div>
  );
}
