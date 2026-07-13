import { useState, useMemo } from 'react';
import { useApiGet } from '../../hooks/useApi';
import { BarChart3, TrendingUp, Users, Package, ClipboardCheck, Calendar, ChevronLeft, ChevronRight, CalendarDays } from 'lucide-react';
import { localDateStr } from '../../utils/dates';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  LineChart, Line, PieChart, Pie, Cell,
} from 'recharts';

const COLORS = ['#3b82f6', '#22c55e', '#f59e0b', '#a855f7', '#14b8a6', '#f43f5e'];

const WEEK_DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
const WEEK_DAYS_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
const TEAM_ORDER = ['Batching', 'Kitting', 'Stick Pack', 'Hand Fill', 'Quality', 'Warehouse', 'Sanitation', 'Other'];
const TEAM_TEXT = {
  Batching: 'text-yellow-700',
  Kitting: 'text-blue-700',
  'Stick Pack': 'text-cyan-700',
  'Hand Fill': 'text-violet-700',
  Quality: 'text-red-700',
  Warehouse: 'text-gray-700',
  Sanitation: 'text-emerald-700',
  Other: 'text-gray-600',
};

function formatDate(d) {
  return localDateStr(d);
}

function getMonday(date) {
  const d = new Date(date);
  const day = d.getDay();
  d.setDate(d.getDate() - day + (day === 0 ? -6 : 1));
  d.setHours(0, 0, 0, 0);
  return d;
}

function fmtTime(t) {
  if (!t) return '';
  const [h, m] = String(t).split(':').map(Number);
  if (Number.isNaN(h)) return t;
  const ap = h >= 12 ? 'PM' : 'AM';
  return `${h % 12 || 12}:${String(m ?? 0).padStart(2, '0')} ${ap}`;
}

// Normalize MO numbers so "MO76721" and "76721" match
const normMo = (m) => (m || '').toString().replace(/[^0-9]/g, '');

function num(v) {
  return Number(v || 0).toLocaleString();
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

function CompareTile({ count, label, tone }) {
  const tones = {
    green: 'bg-green-50 border-green-200 text-green-700',
    amber: 'bg-amber-50 border-amber-200 text-amber-700',
    blue: 'bg-blue-50 border-blue-200 text-blue-700',
  };
  return (
    <div className={`rounded-xl border p-4 text-center ${tones[tone]}`}>
      <p className="text-3xl font-bold">{count}</p>
      <p className="text-xs font-medium mt-1">{label}</p>
    </div>
  );
}

// At-a-glance view of what actually ran this week (from the Production Log / EOD entries),
// grouped by team and day, plus a Schedule vs Actual comparison.
function WeeklyProductionView() {
  const [weekOffset, setWeekOffset] = useState(0);
  const monday = useMemo(() => {
    const m = getMonday(new Date());
    m.setDate(m.getDate() + weekOffset * 7);
    return m;
  }, [weekOffset]);
  const weekDates = useMemo(
    () => [0, 1, 2, 3, 4].map(i => { const d = new Date(monday); d.setDate(d.getDate() + i); return localDateStr(d); }),
    [monday]
  );
  const monStr = weekDates[0];
  const friStr = weekDates[4];
  const dateIndex = useMemo(() => Object.fromEntries(weekDates.map((d, i) => [d, i])), [weekDates]);

  const { data: entries, loading } = useApiGet(`/production/entries?from=${monStr}&to=${friStr}`, [monStr, friStr]);
  const { data: sched } = useApiGet(`/production/schedule?week_start=${monStr}`, [monStr]);

  const { teamGrid, teamsWithData, totals, mos, compare } = useMemo(() => {
    const grid = {};
    let units = 0, runs = 0, manHours = 0;
    const moActual = new Map();
    const rows = Array.isArray(entries) ? entries : [];
    for (const e of rows) {
      const idx = dateIndex[(e.date || '').slice(0, 10)];
      if (idx == null) continue;
      const team = e.team || 'Other';
      if (!grid[team]) grid[team] = [[], [], [], [], []];
      grid[team][idx].push(e);
      units += e.quantity_completed || 0;
      runs += 1;
      manHours += (e.duration_hours || 0) * (e.people_count || 0);
      if (e.mo_number) moActual.set(normMo(e.mo_number), e.mo_number);
    }
    const teams = TEAM_ORDER.filter(t => grid[t]).concat(Object.keys(grid).filter(t => !TEAM_ORDER.includes(t)));

    const schedRows = (sched?.assignments || []).filter(a => a.mo_number || a.product_name);
    const moSched = new Map();
    for (const a of schedRows) { if (a.mo_number) moSched.set(normMo(a.mo_number), a.mo_number); }
    const ran = [...moSched.keys()].filter(m => moActual.has(m)).map(m => moActual.get(m));
    const notRun = [...moSched.keys()].filter(m => !moActual.has(m)).map(m => moSched.get(m));
    const unscheduled = [...moActual.keys()].filter(m => !moSched.has(m)).map(m => moActual.get(m));

    return {
      teamGrid: grid,
      teamsWithData: teams,
      totals: { units, runs, manHours },
      mos: [...moActual.values()],
      compare: { ran, notRun, unscheduled, hasSchedule: schedRows.length > 0 },
    };
  }, [entries, sched, dateIndex]);

  const rangeLabel = `${monday.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${new Date(weekDates[4]).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-4">
      {/* Header + week nav */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h3 className="font-semibold text-gray-900 flex items-center gap-2">
          <CalendarDays size={16} className="text-gray-400" /> Weekly Production
          <span className="text-sm font-normal text-gray-500">{rangeLabel}</span>
          {weekOffset === 0 && <span className="text-[10px] font-semibold uppercase tracking-wide text-green-600 bg-green-50 px-1.5 py-0.5 rounded">This week</span>}
        </h3>
        <div className="flex items-center gap-1">
          <button onClick={() => setWeekOffset(w => w - 1)} className="p-1.5 hover:bg-gray-100 rounded-lg" title="Previous week">
            <ChevronLeft size={16} className="text-gray-600" />
          </button>
          <button onClick={() => setWeekOffset(0)} className="px-2.5 py-1 text-xs font-medium text-blue-600 hover:bg-blue-50 rounded-lg">This week</button>
          <button onClick={() => setWeekOffset(w => w + 1)} className="p-1.5 hover:bg-gray-100 rounded-lg" title="Next week">
            <ChevronRight size={16} className="text-gray-600" />
          </button>
        </div>
      </div>

      {/* Week summary */}
      <div className="text-sm text-gray-600">
        <span className="font-semibold text-gray-900">{num(totals.units)}</span> units ·{' '}
        <span className="font-semibold text-gray-900">{totals.runs}</span> run{totals.runs === 1 ? '' : 's'} ·{' '}
        <span className="font-semibold text-gray-900">{Math.round(totals.manHours).toLocaleString()}</span> man-hours
      </div>

      {loading ? (
        <div className="text-center py-8 text-gray-400 text-sm">Loading week…</div>
      ) : teamsWithData.length === 0 ? (
        <div className="text-center py-8 text-gray-400 text-sm">No production logged for this week.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse min-w-[720px]">
            <thead>
              <tr className="border-b border-gray-200">
                <th className="text-left px-2 py-2 text-xs font-semibold text-gray-500 w-24">Team</th>
                {WEEK_DAYS.map((d, i) => (
                  <th key={d} className="text-left px-2 py-2 text-xs font-semibold text-gray-500">
                    {WEEK_DAYS_SHORT[i]} <span className="font-normal text-gray-400">{new Date(weekDates[i]).toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' })}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {teamsWithData.map(team => (
                <tr key={team} className="border-b border-gray-100 align-top">
                  <td className="px-2 py-2">
                    <span className={`text-sm font-semibold ${TEAM_TEXT[team] || 'text-gray-700'}`}>{team}</span>
                  </td>
                  {[0, 1, 2, 3, 4].map(di => (
                    <td key={di} className="px-2 py-2 align-top">
                      {teamGrid[team][di].length === 0 ? (
                        <span className="text-gray-300 text-sm">—</span>
                      ) : (
                        teamGrid[team][di].map(e => (
                          <div key={e.id} className="rounded-lg border border-gray-200 bg-gray-50/50 px-2 py-1.5 mb-1 last:mb-0">
                            <div className="flex items-start justify-between gap-2">
                              <span className={`text-xs font-semibold ${TEAM_TEXT[team] || 'text-gray-700'}`}>{e.mo_number}</span>
                              <span className="text-xs font-semibold text-gray-800">{num(e.quantity_completed)}</span>
                            </div>
                            {e.product_name && <div className="text-[11px] text-gray-600 leading-tight">{e.product_name}</div>}
                            <div className="text-[10px] text-gray-400 mt-0.5">
                              {e.people_count}p · {Number(e.duration_hours || 0).toFixed(1)}h · {Number(e.units_per_minute || 0).toFixed(1)} u/min
                              {e.start_time ? ` · ${fmtTime(e.start_time)}` : ''}
                            </div>
                          </div>
                        ))
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* MOs this week */}
      {mos.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 pt-1">
          <span className="text-xs font-medium text-gray-500 mr-1">MOs this week ({mos.length}):</span>
          {mos.map(m => (
            <span key={m} className="text-[11px] font-medium bg-gray-100 text-gray-700 rounded-full px-2 py-0.5">{m}</span>
          ))}
        </div>
      )}

      {/* Schedule vs Actual */}
      <div className="pt-2 border-t border-gray-100">
        <h4 className="text-sm font-semibold text-gray-700 mb-2">Schedule vs. Actual</h4>
        {!compare.hasSchedule ? (
          <p className="text-sm text-gray-400">No schedule saved for this week.</p>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-3">
              <CompareTile count={compare.ran.length} label="Ran as scheduled" tone="green" />
              <CompareTile count={compare.notRun.length} label="Scheduled, not run" tone="amber" />
              <CompareTile count={compare.unscheduled.length} label="Unscheduled runs" tone="blue" />
            </div>
            {(compare.notRun.length > 0 || compare.unscheduled.length > 0) && (
              <div className="grid sm:grid-cols-2 gap-3 mt-3">
                {compare.notRun.length > 0 && (
                  <div className="text-xs text-gray-600">
                    <p className="font-medium text-amber-700 mb-1">Scheduled but not yet run</p>
                    <div className="flex flex-wrap gap-1">
                      {compare.notRun.map(m => <span key={m} className="bg-amber-50 text-amber-700 rounded-full px-2 py-0.5">{m}</span>)}
                    </div>
                  </div>
                )}
                {compare.unscheduled.length > 0 && (
                  <div className="text-xs text-gray-600">
                    <p className="font-medium text-blue-700 mb-1">Ran without a schedule entry</p>
                    <div className="flex flex-wrap gap-1">
                      {compare.unscheduled.map(m => <span key={m} className="bg-blue-50 text-blue-700 rounded-full px-2 py-0.5">{m}</span>)}
                    </div>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

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
      byDay[day] += e.quantity_completed || 0;

      const hours = e.duration_hours || 0;
      const qty = e.quantity_completed || 0;
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

  const hasData = summary && summary.total_entries > 0;

  const qaRate = hasData
    ? Math.round(((summary.total_entries - summary.entries_pending_qa) / summary.total_entries) * 100)
    : 0;
  const qaColor = qaRate >= 95 ? 'text-green-600' : qaRate >= 80 ? 'text-amber-600' : 'text-red-600';

  return (
    <div className="space-y-6">
      {/* Weekly production — scheduled vs actual, at a glance */}
      <WeeklyProductionView />

      {/* Range analytics */}
      <div className="flex items-center gap-2 pt-2">
        <h3 className="text-base font-bold text-gray-900">Analytics</h3>
        <span className="text-xs text-gray-400">— trends over a custom date range</span>
      </div>

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

      {loading ? (
        <div className="text-center py-16 text-gray-500">Loading analytics…</div>
      ) : summaryError ? (
        <div className="text-center py-16 text-red-600">{summaryError}</div>
      ) : !hasData ? (
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
