import { useState, useEffect } from 'react';
import { useApiGet, apiPut } from '../../hooks/useApi';
import { Users, Clock } from 'lucide-react';

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
const hrs = (n) => (n ? Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 }) : '—');

function HourInput({ value, onCommit, tone = '' }) {
  const [draft, setDraft] = useState(value ?? 0);
  useEffect(() => { setDraft(value ?? 0); }, [value]);
  return (
    <input type="number" step="0.25" min="0" value={draft}
      onChange={e => setDraft(e.target.value)}
      onBlur={() => { if (Number(draft) !== Number(value)) onCommit(Number(draft) || 0); }}
      onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }}
      className={`w-16 px-1.5 py-1 border border-gray-200 rounded text-sm text-right ${tone}`} />
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
          Weeks run Sunday–Saturday. Enter hours worked; the rest up to each person&apos;s target shows as paid non-working.
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
            <p className={`text-lg font-bold ${c.alert ? 'text-amber-600' : 'text-gray-900'}`}>{hrs(c.value) === '—' ? '0' : hrs(c.value)}</p>
          </div>
        ))}
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50">
            <tr className="text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wide">
              <th className="px-3 py-2">Employee</th>
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
            {(data?.people || []).map(p => (
              <tr key={p.user_id} className="border-t border-gray-100 hover:bg-gray-50">
                <td className="px-3 py-1.5">
                  <span className="font-medium text-gray-900">{p.name}</span>
                  <span className="block text-[10px] text-gray-400 capitalize">{(p.department || '').replace('_', ' ')}</span>
                </td>
                <td className="px-3 py-1.5">
                  <HourInput value={p.target} onCommit={v => saveTarget(p.user_id, v)} tone="text-gray-500" />
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
                </td>
              </tr>
            ))}
            {(data?.people || []).length === 0 && (
              <tr><td colSpan={14} className="px-4 py-8 text-center text-gray-400">
                <Users size={18} className="inline mr-1" /> No active people in Settings yet.
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
