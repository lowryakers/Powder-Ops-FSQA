import { useState, useMemo } from 'react';
import { useApiGet } from '../../hooks/useApi';
import { BarChart3, TrendingUp, Users, Package, ClipboardCheck, Calendar } from 'lucide-react';
import { localDateStr } from '../../utils/dates';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  LineChart, Line, PieChart, Pie, Cell,
} from 'recharts';

const COLORS = ['#3b82f6', '#22c55e', '#f59e0b', '#a855f7', '#14b8a6', '#f43f5e'];

function formatDate(d) {
  return localDateStr(d);
}

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

const customTooltipStyle = {
  backgroundColor: '#fff',
  border: '1px solid #e5e7eb',
  borderRadius: '8px',
  padding: '8px 12px',
  fontSize: '13px',
};

export default function ProductionDashboard() {
  const today = new Date();
  const thirtyDaysAgo = new Date(today);
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const [from, setFrom] = useState(formatDate(thirtyDaysAgo));
  const [to, setTo] = useState(formatDate(today));

  const { data: summary, loading: summaryLoading, error: summaryError } = useApiGet(
    `/production/entries/summary?from=${from}&to=${to}`, [from, to]
  );
  const { data: entries, loading: entriesLoading } = useApiGet(
    `/production/entries?from=${from}&to=${to}`, [from, to]
  );

  const loading = summaryLoading || entriesLoading;

  // Compute daily totals and efficiency from individual entries
  const { dailyOutput, efficiencyTrend } = useMemo(() => {
    if (!entries || !Array.isArray(entries)) return { dailyOutput: [], efficiencyTrend: [] };

    const byDay = {};
    const effByDay = {};

    entries.forEach(e => {
      const day = (e.date || e.created_at || '').slice(0, 10);
      if (!day) return;

      if (!byDay[day]) byDay[day] = 0;
      byDay[day] += e.quantity || 0;

      const hours = e.duration_hours || 0;
      const qty = e.quantity || 0;
      if (hours > 0) {
        if (!effByDay[day]) effByDay[day] = { totalRate: 0, count: 0 };
        effByDay[day].totalRate += qty / hours;
        effByDay[day].count += 1;
      }
    });

    const dailyOutput = Object.entries(byDay)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, quantity]) => ({ date, quantity }));

    const efficiencyTrend = Object.entries(effByDay)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, { totalRate, count }]) => ({
        date,
        avg_units_per_hour: Math.round(totalRate / count),
      }));

    return { dailyOutput, efficiencyTrend };
  }, [entries]);

  if (loading) return <div className="text-center py-12 text-gray-500">Loading production dashboard...</div>;
  if (summaryError) return <div className="text-center py-12 text-red-600">{summaryError}</div>;

  const hasData = summary && summary.total_entries > 0;

  const qaRate = hasData
    ? Math.round(((summary.total_entries - summary.entries_pending_qa) / summary.total_entries) * 100)
    : 0;
  const qaColor = qaRate >= 95 ? 'text-green-600' : qaRate >= 80 ? 'text-amber-600' : 'text-red-600';

  return (
    <div className="space-y-6">
      {/* Date range picker */}
      <div className="flex flex-wrap items-center gap-3">
        <Calendar size={16} className="text-gray-400" />
        <label className="text-sm text-gray-600 font-medium">From</label>
        <input
          type="date"
          value={from}
          onChange={e => setFrom(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
        />
        <label className="text-sm text-gray-600 font-medium">To</label>
        <input
          type="date"
          value={to}
          onChange={e => setTo(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
        />
      </div>

      {!hasData ? (
        <div className="text-center py-16 text-gray-500">
          <BarChart3 size={40} className="mx-auto mb-3 text-gray-300" />
          <p className="text-sm">No production data for this period. Start logging entries to see analytics here.</p>
        </div>
      ) : (
        <>
          {/* KPI Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
            <KpiCard
              icon={BarChart3}
              label="Total Entries"
              value={summary.total_entries.toLocaleString()}
              sub="production logs"
            />
            <KpiCard
              icon={Package}
              label="Total Output"
              value={summary.total_quantity.toLocaleString()}
              sub="units produced"
            />
            <KpiCard
              icon={Users}
              label="Active MOs"
              value={summary.unique_mos}
            />
            <KpiCard
              icon={TrendingUp}
              label="QA Signoff Rate"
              value={`${qaRate}%`}
              color={qaColor}
            />
            <KpiCard
              icon={ClipboardCheck}
              label="Pending QA"
              value={summary.entries_pending_qa}
              color={summary.entries_pending_qa > 0 ? 'text-red-600' : 'text-gray-900'}
            />
          </div>

          {/* Charts 2x2 */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Daily Output */}
            <div className="bg-white rounded-xl border border-gray-200 p-4">
              <h3 className="text-sm font-semibold text-gray-700 mb-3">Daily Output</h3>
              <ResponsiveContainer width="100%" height={250}>
                <BarChart data={dailyOutput}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={v => v.slice(5)} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip contentStyle={customTooltipStyle} />
                  <Bar dataKey="quantity" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Output by Team */}
            <div className="bg-white rounded-xl border border-gray-200 p-4">
              <h3 className="text-sm font-semibold text-gray-700 mb-3">Output by Team</h3>
              <ResponsiveContainer width="100%" height={250}>
                <PieChart>
                  <Pie
                    data={summary.entries_by_team || []}
                    dataKey="total_qty"
                    nameKey="team"
                    cx="50%"
                    cy="50%"
                    outerRadius={90}
                    label={({ team, percent }) => `${team} ${(percent * 100).toFixed(0)}%`}
                    labelLine={false}
                  >
                    {(summary.entries_by_team || []).map((_, i) => (
                      <Cell key={i} fill={COLORS[i % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={customTooltipStyle} />
                </PieChart>
              </ResponsiveContainer>
            </div>

            {/* Entries by Room */}
            <div className="bg-white rounded-xl border border-gray-200 p-4">
              <h3 className="text-sm font-semibold text-gray-700 mb-3">Entries by Room</h3>
              <ResponsiveContainer width="100%" height={250}>
                <BarChart data={summary.entries_by_room || []}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
                  <XAxis dataKey="room" tick={{ fontSize: 11 }} tickFormatter={v => `Room ${v}`} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip contentStyle={customTooltipStyle} />
                  <Bar dataKey="count" fill="#14b8a6" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Efficiency Trend */}
            <div className="bg-white rounded-xl border border-gray-200 p-4">
              <h3 className="text-sm font-semibold text-gray-700 mb-3">Efficiency Trend</h3>
              {efficiencyTrend.length > 0 ? (
                <ResponsiveContainer width="100%" height={250}>
                  <LineChart data={efficiencyTrend}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
                    <XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={v => v.slice(5)} />
                    <YAxis tick={{ fontSize: 11 }} unit=" u/h" />
                    <Tooltip contentStyle={customTooltipStyle} />
                    <Line
                      type="monotone"
                      dataKey="avg_units_per_hour"
                      stroke="#a855f7"
                      strokeWidth={2}
                      dot={{ r: 3 }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex items-center justify-center h-[250px] text-gray-400 text-sm">
                  No efficiency data available
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
