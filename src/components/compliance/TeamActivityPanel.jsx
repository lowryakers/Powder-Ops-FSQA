import { useState, useMemo } from 'react';
import { useApiGet } from '../../hooks/useApi';
import { Users, CheckCircle2, Clock, AlertTriangle, Gauge, TrendingUp } from 'lucide-react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';

const RANGES = [
  { key: '30', label: 'Last 30 days', days: 30 },
  { key: '90', label: 'Last 90 days', days: 90 },
  { key: '365', label: 'Last 12 months', days: 365 },
];

const tooltipStyle = { backgroundColor: '#fff', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '8px 12px', fontSize: '13px' };

function iso(d) { return d.toISOString().split('T')[0]; }

function KpiCard({ icon: Icon, label, value, sub, color }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4 flex flex-col gap-1">
      <div className="flex items-center gap-2 text-gray-400">
        <Icon size={16} />
        <span className="text-xs uppercase tracking-wide font-medium">{label}</span>
      </div>
      <p className={`text-2xl font-bold ${color || 'text-gray-900'}`}>{value}</p>
      {sub && <p className="text-xs text-gray-500">{sub}</p>}
    </div>
  );
}

function pct(v) { return v == null ? '—' : `${v}%`; }
function days(v) { return v == null ? '—' : `${v.toFixed(1)}d`; }
function onTimeColor(v) { return v == null ? 'text-gray-400' : v >= 95 ? 'text-green-600' : v >= 80 ? 'text-amber-600' : 'text-red-600'; }

function StatTable({ title, rows, nameKey, nameLabel }) {
  if (!rows || rows.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <h3 className="text-sm font-semibold text-gray-900 mb-2">{title}</h3>
        <p className="text-sm text-gray-400 py-4 text-center">No activity in this period.</p>
      </div>
    );
  }
  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <h3 className="text-sm font-semibold text-gray-900 px-4 pt-4 pb-2">{title}</h3>
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50 text-gray-500 text-xs uppercase tracking-wide">
            <tr>
              <th className="text-left font-medium px-4 py-2">{nameLabel}</th>
              <th className="text-right font-medium px-4 py-2 whitespace-nowrap">Due</th>
              <th className="text-right font-medium px-4 py-2 whitespace-nowrap">Completed</th>
              <th className="text-right font-medium px-4 py-2 whitespace-nowrap">On-time</th>
              <th className="text-right font-medium px-4 py-2 whitespace-nowrap">Overdue</th>
              <th className="text-right font-medium px-4 py-2 whitespace-nowrap">Avg time</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.map(r => (
              <tr key={r[nameKey]}>
                <td className="px-4 py-2 font-medium text-gray-900">{r[nameKey]}</td>
                <td className="px-4 py-2 text-right text-gray-600">{r.total}</td>
                <td className="px-4 py-2 text-right text-gray-600">{r.completed}</td>
                <td className={`px-4 py-2 text-right font-medium ${onTimeColor(r.on_time_pct)}`}>{pct(r.on_time_pct)}</td>
                <td className={`px-4 py-2 text-right ${r.overdue > 0 ? 'text-red-600 font-medium' : 'text-gray-400'}`}>{r.overdue}</td>
                <td className="px-4 py-2 text-right text-gray-600">{days(r.avg_days)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function TeamActivityPanel() {
  const [rangeKey, setRangeKey] = useState('30');
  const range = RANGES.find(r => r.key === rangeKey) || RANGES[0];

  const { from, to } = useMemo(() => {
    const t = new Date();
    const f = new Date();
    f.setDate(f.getDate() - range.days);
    return { from: iso(f), to: iso(t) };
  }, [range.days]);

  const { data, loading } = useApiGet(`/activity/summary?from=${from}&to=${to}`, [from, to]);
  const o = data?.overall;

  const trendData = (data?.trend || []).map(w => ({
    week: w.week.slice(5), // MM-DD
    Completed: w.completed,
    'On-time': w.on_time,
  }));

  return (
    <div className="max-w-6xl mx-auto space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
            <Users size={20} className="text-powder-600" /> Team Activity
          </h2>
          <p className="text-sm text-gray-500 mt-1">
            Task throughput and on-time performance from work-order timing. Operational data — separate from the audit compliance trail.
          </p>
        </div>
        <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-1">
          {RANGES.map(r => (
            <button key={r.key} onClick={() => setRangeKey(r.key)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${rangeKey === r.key ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-gray-400 py-12 text-center">Loading activity...</p>
      ) : !data ? (
        <p className="text-sm text-gray-400 py-12 text-center">No data.</p>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <KpiCard icon={CheckCircle2} label="Completed" value={o.completed} sub={`of ${o.total} due`} />
            <KpiCard icon={Gauge} label="On-time" value={pct(o.on_time_pct)} sub="of completed" color={onTimeColor(o.on_time_pct)} />
            <KpiCard icon={Clock} label="Completion" value={pct(o.completion_pct)} sub="handled / due" />
            <KpiCard icon={AlertTriangle} label="Overdue" value={o.overdue} sub="missed or past due" color={o.overdue > 0 ? 'text-red-600' : 'text-gray-900'} />
            <KpiCard icon={TrendingUp} label="Avg time" value={days(o.avg_days)} sub="create → complete" />
          </div>

          {trendData.length > 0 && (
            <div className="bg-white rounded-xl border border-gray-200 p-4">
              <h3 className="text-sm font-semibold text-gray-900 mb-3">Weekly completion trend</h3>
              <ResponsiveContainer width="100%" height={240}>
                <LineChart data={trendData} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="week" tick={{ fontSize: 12, fill: '#9ca3af' }} />
                  <YAxis tick={{ fontSize: 12, fill: '#9ca3af' }} allowDecimals={false} />
                  <Tooltip contentStyle={tooltipStyle} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Line type="monotone" dataKey="Completed" stroke="#3b82f6" strokeWidth={2} dot={{ r: 3 }} />
                  <Line type="monotone" dataKey="On-time" stroke="#22c55e" strokeWidth={2} dot={{ r: 3 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}

          <StatTable title="By department" rows={data.by_department} nameKey="label" nameLabel="Department" />
          <StatTable title="By person" rows={data.by_person} nameKey="name" nameLabel="Team member" />
        </>
      )}
    </div>
  );
}
