import { useMemo, useState, useEffect } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer,
} from 'recharts';
import { getTeamColor } from '../utils/parseSheet';
import { buildMOColorMap, getMOColor } from '../utils/moColors';
import MOLegend from './MOLegend';

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
const DAY_NUMS = [1, 2, 3, 4, 5]; // Mon=1 ... Fri=5

function WeeklyProductionGrid({ runs, selectedWeek, moColorMap }) {
  const weekRuns = useMemo(() => {
    return runs.filter((r) => r.week === selectedWeek);
  }, [runs, selectedWeek]);

  const grid = useMemo(() => {
    const teamDays = new Map();
    weekRuns.forEach((r) => {
      if (!teamDays.has(r.team)) teamDays.set(r.team, {});
      const dayOfWeek = r.date.getDay();
      const dayIdx = dayOfWeek === 0 ? 6 : dayOfWeek - 1; // Mon=0..Sun=6
      const dayName = DAYS[dayIdx];
      if (!dayName) return;
      if (!teamDays.get(r.team)[dayName]) teamDays.get(r.team)[dayName] = [];
      teamDays.get(r.team)[dayName].push(r);
    });

    return [...teamDays.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [weekRuns]);

  const weekTotals = useMemo(() => {
    const totalUnits = weekRuns.reduce((s, r) => s + r.quantity, 0);
    const totalRuns = weekRuns.length;
    const totalManHours = weekRuns.reduce((s, r) => s + (r.manHours || 0), 0);
    return { totalUnits, totalRuns, totalManHours };
  }, [weekRuns]);

  if (!weekRuns.length) {
    return <p className="text-gray-400 text-sm py-4 text-center">No production data for this week</p>;
  }

  return (
    <div>
      <div className="flex gap-4 px-5 py-3 text-sm text-gray-500 border-b border-gray-100">
        <span><strong className="text-gray-900">{weekTotals.totalUnits.toLocaleString(undefined, { maximumFractionDigits: 0 })}</strong> units</span>
        <span><strong className="text-gray-900">{weekTotals.totalRuns}</strong> runs</span>
        <span><strong className="text-gray-900">{weekTotals.totalManHours.toLocaleString(undefined, { maximumFractionDigits: 0 })}</strong> man-hours</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50">
              <th className="px-4 py-2.5 text-left font-medium text-gray-600 sticky left-0 bg-gray-50 min-w-[90px]">Team</th>
              {DAYS.map((day) => (
                <th key={day} className="px-4 py-2.5 text-left font-medium text-gray-600 min-w-[180px]">{day}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {grid.map(([team, days]) => (
              <tr key={team} className="border-t border-gray-100">
                <td className="px-4 py-2.5 sticky left-0 bg-white align-top">
                  <span className="font-semibold text-sm" style={{ color: getTeamColor(team) }}>{team}</span>
                </td>
                {DAYS.map((day) => {
                  const dayRuns = days[day] || [];
                  return (
                    <td key={day} className="px-4 py-2.5 align-top">
                      {dayRuns.length === 0 ? (
                        <span className="text-gray-300">—</span>
                      ) : (
                        <div className="space-y-1">
                          {dayRuns.map((r, i) => {
                            const c = getMOColor(moColorMap, r.mo);
                            return (
                            <div
                              key={i}
                              className="text-xs rounded-md px-2 py-1.5 border"
                              style={{ backgroundColor: c.bg, borderColor: c.border }}
                            >
                              <div className="flex justify-between items-start gap-1">
                                <span className="font-semibold" style={{ color: c.text }}>{r.mo || '—'}</span>
                                <span className="font-semibold whitespace-nowrap" style={{ color: getTeamColor(team) }}>
                                  {r.quantity.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                                </span>
                              </div>
                              <div className="text-gray-500 leading-tight">{r.product?.slice(0, 40)}</div>
                              {(r.people || r.unitsPerMinute) && (
                                <div className="text-gray-400 mt-0.5">
                                  {r.people ? `${r.people}p · ${r.duration?.toFixed(1) || '?'}h` : ''}
                                  {r.unitsPerMinute ? `${r.people ? ' · ' : ''}${r.unitsPerMinute.toFixed(1)} u/min` : ''}
                                </div>
                              )}
                            </div>
                            );
                          })}
                        </div>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function normalizeMO(mo) {
  if (!mo) return null;
  const m = mo.replace(/[^0-9]/g, '');
  return m ? `MO${m}` : null;
}

export default function ProductionTab({ runs, schedule = [] }) {
  const weeks = useMemo(() => {
    const set = [...new Set(runs.map((r) => r.week))].sort((a, b) => b.localeCompare(a));
    return set.map((w) => {
      const mon = new Date(w + 'T00:00:00');
      const fri = new Date(mon);
      fri.setDate(mon.getDate() + 4);
      return {
        key: w,
        label: `${mon.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${fri.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`,
      };
    });
  }, [runs]);

  const [selectedWeek, setSelectedWeek] = useState(weeks[0]?.key || '');
  useEffect(() => {
    if (weeks.length && !weeks.find((w) => w.key === selectedWeek)) {
      setSelectedWeek(weeks[0].key);
    }
  }, [weeks, selectedWeek]);

  const moColorMap = useMemo(() => {
    const weekMOs = runs.filter((r) => r.week === selectedWeek).map((r) => r.mo).filter(Boolean);
    return buildMOColorMap(weekMOs);
  }, [runs, selectedWeek]);

  const scheduleComparison = useMemo(() => {
    if (!schedule.length) return null;

    const weekRuns = runs.filter((r) => r.week === selectedWeek);
    if (!weekRuns.length) return null;

    const scheduledMOs = new Set();
    schedule.forEach((s) => {
      const key = normalizeMO(s.mo);
      if (key) scheduledMOs.add(key);
    });

    const actualMOs = new Map();
    weekRuns.forEach((r) => {
      const key = normalizeMO(r.mo);
      if (!key) return;
      if (!actualMOs.has(key)) actualMOs.set(key, { mo: key, product: r.product, team: r.team, totalQty: 0 });
      actualMOs.get(key).totalQty += r.quantity;
    });

    const unplanned = [];
    const onSchedule = [];
    for (const [mo, info] of actualMOs) {
      if (scheduledMOs.has(mo)) {
        onSchedule.push(info);
      } else {
        unplanned.push(info);
      }
    }

    return { unplanned, onSchedule, scheduledCount: scheduledMOs.size };
  }, [runs, schedule, selectedWeek]);

  const teams = [...new Set(runs.map((r) => r.team))].sort();

  const weeklyData = {};
  runs.forEach((r) => {
    if (!weeklyData[r.week]) weeklyData[r.week] = { week: r.week };
    weeklyData[r.week][r.team] = (weeklyData[r.week][r.team] || 0) + r.quantity;
  });
  const weeklyChart = Object.values(weeklyData).sort((a, b) => a.week.localeCompare(b.week));

  const teamTotals = {};
  runs.forEach((r) => {
    if (!teamTotals[r.team]) teamTotals[r.team] = { team: r.team, units: 0, runs: 0, manHours: 0 };
    teamTotals[r.team].units += r.quantity;
    teamTotals[r.team].runs += 1;
    teamTotals[r.team].manHours += r.manHours || 0;
  });
  const teamCards = Object.values(teamTotals).sort((a, b) => b.units - a.units);
  const maxUnits = Math.max(...teamCards.map((t) => t.units), 1);

  const productTotals = {};
  runs.forEach((r) => {
    const name = r.product || 'Unknown';
    productTotals[name] = (productTotals[name] || 0) + r.quantity;
  });
  const topProducts = Object.entries(productTotals)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([name, value]) => ({ name, value }));

  const maxProductQty = topProducts[0]?.value || 1;
  const COLORS = ['#3b82f6', '#10b981', '#8b5cf6', '#f59e0b', '#ef4444', '#06b6d4', '#ec4899', '#84cc16', '#f97316', '#6366f1'];

  return (
    <div className="space-y-6">
      {/* Weekly production grid */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        <div className="px-5 py-3.5 border-b border-gray-100 flex items-center gap-4">
          <h3 className="text-lg font-semibold text-gray-900">Weekly Production</h3>
          <select
            value={selectedWeek}
            onChange={(e) => setSelectedWeek(e.target.value)}
            className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm bg-white focus:ring-2 focus:ring-powder-500 focus:border-powder-500"
          >
            {weeks.map((w) => (
              <option key={w.key} value={w.key}>{w.label}</option>
            ))}
          </select>
        </div>
        <WeeklyProductionGrid runs={runs} selectedWeek={selectedWeek} moColorMap={moColorMap} />
      </div>

      <MOLegend moColorMap={moColorMap} label="Manufacturing Orders This Week" />

      {/* Schedule vs Actual comparison */}
      {scheduleComparison && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
          <h3 className="text-lg font-semibold text-gray-900 mb-3">Schedule vs. Actual</h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
            <div className="text-center p-3 bg-gray-50 rounded-lg">
              <div className="text-2xl font-bold text-gray-900">{scheduleComparison.onSchedule.length + scheduleComparison.unplanned.length}</div>
              <div className="text-xs text-gray-500 mt-0.5">MOs Worked</div>
            </div>
            <div className="text-center p-3 bg-emerald-50 rounded-lg">
              <div className="text-2xl font-bold text-emerald-600">{scheduleComparison.onSchedule.length}</div>
              <div className="text-xs text-gray-500 mt-0.5">On Schedule</div>
            </div>
            <div className="text-center p-3 rounded-lg" style={{ backgroundColor: scheduleComparison.unplanned.length > 0 ? '#fef3c7' : '#f0fdf4' }}>
              <div className={`text-2xl font-bold ${scheduleComparison.unplanned.length > 0 ? 'text-amber-600' : 'text-emerald-600'}`}>
                {scheduleComparison.unplanned.length}
              </div>
              <div className="text-xs text-gray-500 mt-0.5">Unscheduled</div>
            </div>
          </div>
          {scheduleComparison.unplanned.length > 0 && (
            <div>
              <h4 className="text-sm font-semibold text-amber-700 mb-2">Unscheduled MOs Released to Production</h4>
              <div className="space-y-1.5">
                {scheduleComparison.unplanned.map((u) => {
                  const c = getMOColor(moColorMap, u.mo);
                  return (
                    <div key={u.mo} className="flex items-center justify-between text-sm px-3 py-2 rounded-lg border" style={{ backgroundColor: c.bg, borderColor: c.border }}>
                      <div className="flex items-center gap-2">
                        <span className="font-semibold" style={{ color: c.text }}>{u.mo}</span>
                        <span className="text-gray-500">{u.product?.slice(0, 50)}</span>
                      </div>
                      <div className="flex items-center gap-3 text-xs text-gray-500">
                        <span style={{ color: getTeamColor(u.team) }}>{u.team}</span>
                        <span className="font-medium text-gray-700">{u.totalQty.toLocaleString(undefined, { maximumFractionDigits: 0 })} units</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          {scheduleComparison.unplanned.length === 0 && (
            <p className="text-sm text-emerald-600 text-center py-1">All MOs worked this week were on the schedule</p>
          )}
        </div>
      )}

      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Production by Team (All Weeks)</h3>
        <ResponsiveContainer width="100%" height={350}>
          <BarChart data={weeklyChart}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
            <XAxis
              dataKey="week"
              tick={{ fontSize: 11 }}
              tickFormatter={(v) => {
                const d = new Date(v + 'T00:00:00');
                return `${d.getMonth() + 1}/${d.getDate()}`;
              }}
            />
            <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v} />
            <Tooltip
              formatter={(value) => value.toLocaleString(undefined, { maximumFractionDigits: 0 })}
              labelFormatter={(v) => `Week of ${v}`}
            />
            <Legend />
            {teams.map((team) => (
              <Bar key={team} dataKey={team} stackId="a" fill={getTeamColor(team)} radius={[2, 2, 0, 0]} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Team Summary</h3>
          <div className="space-y-4">
            {teamCards.map((t) => (
              <div key={t.team}>
                <div className="flex justify-between items-center mb-1">
                  <span className="text-sm font-medium" style={{ color: getTeamColor(t.team) }}>{t.team}</span>
                  <span className="text-sm text-gray-600">
                    {t.units.toLocaleString(undefined, { maximumFractionDigits: 0 })} units · {t.runs} runs
                  </span>
                </div>
                <div className="w-full bg-gray-100 rounded-full h-2.5">
                  <div
                    className="h-2.5 rounded-full transition-all"
                    style={{
                      width: `${(t.units / maxUnits) * 100}%`,
                      backgroundColor: getTeamColor(t.team),
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Top 10 Products</h3>
          <div className="space-y-2.5">
            {topProducts.map((p, i) => (
              <div key={i}>
                <div className="flex justify-between items-baseline mb-1">
                  <span className="text-sm text-gray-700 leading-tight" title={p.name}>
                    {p.name}
                  </span>
                  <span className="text-sm font-semibold text-gray-900 ml-2 whitespace-nowrap">
                    {p.value.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                  </span>
                </div>
                <div className="w-full bg-gray-100 rounded-full h-2">
                  <div
                    className="h-2 rounded-full"
                    style={{ width: `${(p.value / maxProductQty) * 100}%`, backgroundColor: COLORS[i % COLORS.length] }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
