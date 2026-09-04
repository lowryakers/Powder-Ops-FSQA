import { useState, useMemo } from 'react';
import { RecordCard, RecordCards } from '../common/RecordCards.jsx';
import { useApiGet } from '../../hooks/useApi';
import { Users, CheckCircle2, Clock, AlertTriangle, Gauge, TrendingUp } from 'lucide-react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import ActivityDrillDown from './ActivityDrillDown.jsx';

/**
 * Every number on this page opens the tasks behind it.
 *
 * It was a page you could read and not act on: "27 overdue in Quality" is not
 * an answer, it is the start of a question, and working out which twenty-seven
 * meant going to Task Center and rebuilding the filter by hand — which nobody
 * does, so the number got looked at and nothing happened.
 *
 * The drill-down asks the server, which filters with the same predicates that
 * produced the figure (`server/activity-metrics.js`). A count and a list built
 * from two copies of the same rule is how a dashboard starts lying.
 *
 * A rate is not a set, so a percentage drills to the thing a person actually
 * means by clicking it: on-time% opens the LATE ones (the exceptions), and
 * completion% opens what has not been handled.
 */

const RANGES = [
  { key: '30', label: 'Last 30 days', days: 30 },
  { key: '90', label: 'Last 90 days', days: 90 },
  { key: '365', label: 'Last 12 months', days: 365 },
];

const tooltipStyle = { backgroundColor: '#fff', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '8px 12px', fontSize: '13px' };

function iso(d) { return d.toISOString().split('T')[0]; }

function pct(v) { return v == null ? '—' : `${v}%`; }
function days(v) { return v == null ? '—' : `${v.toFixed(1)}d`; }
function onTimeColor(v) { return v == null ? 'text-gray-400' : v >= 95 ? 'text-green-600' : v >= 80 ? 'text-amber-600' : 'text-red-600'; }

/** A number that opens what is behind it, or plain text when there is nothing to open. */
function Drillable({ metric, onDrill, disabled, className = '', title, children }) {
  if (!metric || disabled) return <span className={className}>{children}</span>;
  return (
    <button type="button" onClick={() => onDrill(metric)} title={title || 'Show these tasks'}
      className={`${className} underline decoration-dotted decoration-gray-300 underline-offset-4 hover:decoration-current rounded focus:outline-none focus:ring-2 focus:ring-powder-300`}>
      {children}
    </button>
  );
}

function KpiCard({ icon: Icon, label, value, sub, color, metric, onDrill, disabled }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4 flex flex-col gap-1">
      <div className="flex items-center gap-2 text-gray-400">
        <Icon size={16} />
        <span className="text-xs uppercase tracking-wide font-medium">{label}</span>
      </div>
      <Drillable metric={metric} onDrill={onDrill} disabled={disabled}
        className={`text-2xl font-bold text-left ${color || 'text-gray-900'}`}>
        {value}
      </Drillable>
      {sub && <p className="text-xs text-gray-500">{sub}</p>}
    </div>
  );
}

function StatTable({ title, rows, nameKey, nameLabel, scopeKey, onDrill }) {
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
      <p className="text-xs text-gray-500 px-4 pb-2">Any figure opens the tasks behind it.</p>
      {/* The same rows, the same Drillable figures, as cards below md. */}
      <RecordCards count={rows.length} className="px-3 pb-3">
        {rows.map(r => {
          const scope = { [scopeKey]: scopeKey === 'department' ? r.key : r.name };
          const drill = (metric) => onDrill({ metric, scope, label: r[nameKey] });
          return (
            <RecordCard key={r[nameKey]} title={r[nameKey]}
              fields={[
                { label: 'Due', value: <Drillable metric="due" onDrill={drill} disabled={!r.total}>{r.total}</Drillable> },
                { label: 'Completed', value: <Drillable metric="completed" onDrill={drill} disabled={!r.completed}>{r.completed}</Drillable> },
                { label: 'On-time', value: <span className={onTimeColor(r.on_time_pct)}><Drillable metric="late" onDrill={drill} disabled={r.on_time_pct == null || r.completed === r.on_time} title="Show the ones completed late">{pct(r.on_time_pct)}</Drillable></span> },
                { label: 'Overdue', value: <span className={r.overdue > 0 ? 'text-red-600 font-medium' : ''}><Drillable metric="overdue" onDrill={drill} disabled={!r.overdue}>{r.overdue}</Drillable></span> },
                { label: 'Avg time', value: <Drillable metric="completed" onDrill={drill} disabled={r.avg_days == null} title="Show the completed tasks this average is over">{days(r.avg_days)}</Drillable> },
              ]} />
          );
        })}
      </RecordCards>
      <div className="hidden md:block overflow-x-auto">
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
            {rows.map(r => {
              // The scope this row narrows to: a department key, or a person's
              // name — whichever table this is.
              const scope = { [scopeKey]: scopeKey === 'department' ? r.key : r.name };
              const label = r[nameKey];
              const drill = (metric) => onDrill({ metric, scope, label });
              return (
                <tr key={r[nameKey]}>
                  <td className="px-4 py-2 font-medium text-gray-900">{label}</td>
                  <td className="px-4 py-2 text-right text-gray-600">
                    <Drillable metric="due" onDrill={drill} disabled={!r.total}>{r.total}</Drillable>
                  </td>
                  <td className="px-4 py-2 text-right text-gray-600">
                    <Drillable metric="completed" onDrill={drill} disabled={!r.completed}>{r.completed}</Drillable>
                  </td>
                  <td className={`px-4 py-2 text-right font-medium ${onTimeColor(r.on_time_pct)}`}>
                    <Drillable metric="late" onDrill={drill}
                      disabled={r.on_time_pct == null || r.completed === r.on_time}
                      title="Show the ones completed late">
                      {pct(r.on_time_pct)}
                    </Drillable>
                  </td>
                  <td className={`px-4 py-2 text-right ${r.overdue > 0 ? 'text-red-600 font-medium' : 'text-gray-400'}`}>
                    <Drillable metric="overdue" onDrill={drill} disabled={!r.overdue}>{r.overdue}</Drillable>
                  </td>
                  <td className="px-4 py-2 text-right text-gray-600">
                    <Drillable metric="completed" onDrill={drill} disabled={r.avg_days == null}
                      title="Show the completed tasks this average is over">
                      {days(r.avg_days)}
                    </Drillable>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function TeamActivityPanel() {
  const [rangeKey, setRangeKey] = useState('30');
  const [drill, setDrill] = useState(null);
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

  const openOverall = (metric) => setDrill({ query: { from, to, metric }, scopeLabel: 'Everyone' });
  const openScoped = ({ metric, scope, label }) =>
    setDrill({ query: { from, to, metric, ...scope }, scopeLabel: label });

  return (
    <div className="max-w-6xl mx-auto space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
            <Users size={20} className="text-powder-600" /> Team Activity
          </h2>
          <p className="text-sm text-gray-500 mt-1">
            Task throughput and on-time performance from work-order timing. Operational data — separate from the audit compliance trail.
            <span className="block">Every figure below opens the tasks behind it.</span>
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
            <KpiCard icon={CheckCircle2} label="Completed" value={o.completed} sub={`of ${o.total} due`}
              metric="completed" onDrill={openOverall} disabled={!o.completed} />
            {/* A rate has no rows of its own — clicking it means "show me the
                ones that were late", which is the exception people are after. */}
            <KpiCard icon={Gauge} label="On-time" value={pct(o.on_time_pct)} sub="of completed"
              color={onTimeColor(o.on_time_pct)}
              metric="late" onDrill={openOverall} disabled={o.completed === o.on_time} />
            <KpiCard icon={Clock} label="Completion" value={pct(o.completion_pct)} sub="handled / due"
              metric="outstanding" onDrill={openOverall} disabled={o.completion_pct === 100} />
            <KpiCard icon={AlertTriangle} label="Overdue" value={o.overdue} sub="missed or past due"
              color={o.overdue > 0 ? 'text-red-600' : 'text-gray-900'}
              metric="overdue" onDrill={openOverall} disabled={!o.overdue} />
            <KpiCard icon={TrendingUp} label="Avg time" value={days(o.avg_days)} sub="create → complete"
              metric="completed" onDrill={openOverall} disabled={o.avg_days == null} />
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

          <StatTable title="By department" rows={data.by_department} nameKey="label" nameLabel="Department"
            scopeKey="department" onDrill={openScoped} />
          <StatTable title="By person" rows={data.by_person} nameKey="name" nameLabel="Team member"
            scopeKey="person" onDrill={openScoped} />
        </>
      )}

      {drill && (
        <ActivityDrillDown query={drill.query} scopeLabel={drill.scopeLabel} onClose={() => setDrill(null)} />
      )}
    </div>
  );
}
