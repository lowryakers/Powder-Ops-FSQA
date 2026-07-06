import { useMemo, useState, useEffect } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer,
} from 'recharts';
import { fetchSnapshot } from '../utils/parseSheet';
import { buildMOColorMap, getMOColor } from '../utils/moColors';
import MOLegend from './MOLegend';

const STATUS_COLORS = {
  completed: '#10b981',
  scheduled: '#3b82f6',
  unplanned: '#f59e0b',
};

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];

function normalizeMO(mo) {
  if (!mo) return null;
  const m = mo.replace(/[^0-9]/g, '');
  return m ? `MO${m}` : null;
}

function getDayName(label) {
  if (!label) return '';
  const match = label.match(/^(\w+)/);
  return match ? match[1] : label;
}

function WeeklyGrid({ entries, moColorMap }) {
  const rooms = useMemo(() => {
    const map = new Map();
    entries.forEach((e) => {
      const room = e.room || '?';
      if (!map.has(room)) map.set(room, {});
      const day = getDayName(e.dayLabel);
      if (!map.get(room)[day]) map.get(room)[day] = [];
      map.get(room)[day].push(e);
    });
    return [...map.entries()].sort((a, b) => {
      const numA = parseFloat(a[0]) || 999;
      const numB = parseFloat(b[0]) || 999;
      return numA - numB;
    });
  }, [entries]);

  if (!entries.length) {
    return <p className="text-gray-400 text-sm py-4 text-center">No schedule entries for this week</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-gray-50">
            <th className="px-4 py-2.5 text-left font-medium text-gray-600 sticky left-0 bg-gray-50 min-w-[70px]">Room</th>
            {DAYS.map((day) => (
              <th key={day} className="px-4 py-2.5 text-left font-medium text-gray-600 min-w-[180px]">{day}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rooms.map(([room, days]) => (
            <tr key={room} className="border-t border-gray-100">
              <td className="px-4 py-2.5 font-semibold text-gray-700 sticky left-0 bg-white align-top">{room}</td>
              {DAYS.map((day) => {
                const dayEntries = days[day] || [];
                return (
                  <td key={day} className="px-4 py-2.5 align-top">
                    {dayEntries.length === 0 ? (
                      <span className="text-gray-300">—</span>
                    ) : (
                      <div className="space-y-1">
                        {dayEntries.map((e, i) => {
                          const c = getMOColor(moColorMap, e.mo);
                          return (
                            <div
                              key={i}
                              className="text-xs rounded-md px-2 py-1.5 border"
                              style={{ backgroundColor: c.bg, borderColor: c.border }}
                            >
                              <div className="font-semibold" style={{ color: c.text }}>{e.mo || '—'}</div>
                              <div className="text-gray-500 leading-tight">{e.product?.slice(0, 50) || e.raw?.slice(0, 50)}</div>
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
  );
}

export default function ScheduleTab({ runs, schedule, snapshots = [] }) {
  const [selectedWeek, setSelectedWeek] = useState('current');
  const [snapshotEntries, setSnapshotEntries] = useState(null);
  const [loadingSnapshot, setLoadingSnapshot] = useState(false);

  useEffect(() => {
    if (selectedWeek === 'current') {
      setSnapshotEntries(null);
      return;
    }
    setLoadingSnapshot(true);
    fetchSnapshot(selectedWeek).then((snap) => {
      setSnapshotEntries(snap?.entries || []);
      setLoadingSnapshot(false);
    });
  }, [selectedWeek]);

  const displayEntries = useMemo(
    () => (selectedWeek === 'current' ? schedule : (snapshotEntries || [])),
    [selectedWeek, schedule, snapshotEntries]
  );

  const moColorMap = useMemo(() => {
    const mos = displayEntries.map((e) => e.mo).filter(Boolean);
    return buildMOColorMap(mos);
  }, [displayEntries]);

  const analysis = useMemo(() => {
    if (!schedule.length && !snapshots.length) return null;

    const allScheduleEntries = selectedWeek === 'current' ? schedule : (snapshotEntries || []);

    const scheduledMOs = new Map();
    const scheduleDates = [];
    allScheduleEntries.forEach((s) => {
      if (s.date) scheduleDates.push(s.date);
      if (!s.mo) return;
      const key = normalizeMO(s.mo);
      if (!key) return;
      if (!scheduledMOs.has(key)) scheduledMOs.set(key, { ...s, dates: [] });
      if (s.date) scheduledMOs.get(key).dates.push(s.date);
    });

    const sortedDates = [...new Set(scheduleDates)].sort();
    const weekStart = sortedDates[0] || '0000';
    const weekEnd = sortedDates[sortedDates.length - 1] || '9999';
    const startDate = new Date(weekStart + 'T00:00:00');
    startDate.setDate(startDate.getDate() - 1);
    const endDate = new Date(weekEnd + 'T00:00:00');
    endDate.setDate(endDate.getDate() + 1);

    const weekRuns = runs.filter((r) => r.date >= startDate && r.date <= endDate);

    const actualMOs = new Map();
    weekRuns.forEach((r) => {
      if (!r.mo) return;
      const key = normalizeMO(r.mo);
      if (!key) return;
      if (!actualMOs.has(key)) {
        actualMOs.set(key, { mo: key, runs: [], totalQty: 0, product: r.product, team: r.team });
      }
      actualMOs.get(key).runs.push(r);
      actualMOs.get(key).totalQty += r.quantity;
    });

    const completed = [];
    const scheduledOnly = [];
    const unplanned = [];

    for (const [mo, sched] of scheduledMOs) {
      if (actualMOs.has(mo)) {
        completed.push({ mo, scheduled: sched, actual: actualMOs.get(mo) });
      } else {
        scheduledOnly.push({ mo, scheduled: sched });
      }
    }

    for (const [mo, actual] of actualMOs) {
      if (!scheduledMOs.has(mo)) unplanned.push({ mo, actual });
    }

    const dailyMap = {};
    allScheduleEntries.forEach((s) => {
      if (!s.date) return;
      if (!dailyMap[s.date]) dailyMap[s.date] = { date: s.date, scheduled: 0, completed: 0 };
      dailyMap[s.date].scheduled += 1;
    });
    weekRuns.forEach((r) => {
      if (!dailyMap[r.dateStr]) dailyMap[r.dateStr] = { date: r.dateStr, scheduled: 0, completed: 0 };
      dailyMap[r.dateStr].completed += 1;
    });
    const dailyChart = Object.values(dailyMap)
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(-30);

    return {
      completed,
      scheduledOnly,
      unplanned,
      dailyChart,
      adherenceRate: scheduledMOs.size > 0
        ? ((completed.length / scheduledMOs.size) * 100).toFixed(0)
        : 0,
    };
  }, [runs, schedule, snapshotEntries, selectedWeek, snapshots.length]);

  if (!schedule.length && !snapshots.length) {
    return (
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8 text-center">
        <p className="text-gray-500 text-lg mb-2">Schedule data not available</p>
        <p className="text-gray-400 text-sm">
          Make sure the <code className="bg-gray-100 px-1.5 py-0.5 rounded text-xs">SCHEDULE_SHEET_URL</code> is set in Railway, then hit Refresh.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Week selector */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 flex items-center gap-4">
        <label className="text-sm font-medium text-gray-600">Week</label>
        <select
          value={selectedWeek}
          onChange={(e) => setSelectedWeek(e.target.value)}
          className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm bg-white focus:ring-2 focus:ring-powder-500 focus:border-powder-500"
        >
          <option value="current">Current Schedule</option>
          {snapshots.map((s) => (
            <option key={s.id} value={s.id}>{s.weekLabel} ({s.entryCount} runs)</option>
          ))}
        </select>
        {loadingSnapshot && <span className="text-xs text-gray-400">Loading…</span>}
      </div>

      {/* Weekly grid */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        <div className="px-5 py-3.5 border-b border-gray-100">
          <h3 className="text-lg font-semibold text-gray-900">
            {selectedWeek === 'current' ? 'Current Weekly Schedule' : snapshots.find((s) => s.id === selectedWeek)?.weekLabel || 'Schedule'}
          </h3>
        </div>
        <WeeklyGrid entries={displayEntries} moColorMap={moColorMap} />
      </div>

      {/* MO Legend */}
      <MOLegend moColorMap={moColorMap} label="Scheduled Manufacturing Orders" />

      {/* Adherence summary */}
      {analysis && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
              <div className="text-sm font-medium text-gray-500 mb-1">Schedule Adherence</div>
              <div className="text-3xl font-bold text-gray-900">{analysis.adherenceRate}%</div>
              <div className="text-xs text-gray-400 mt-1">of scheduled MOs completed</div>
            </div>
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
              <div className="flex items-center gap-2 mb-1">
                <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: STATUS_COLORS.completed }} />
                <span className="text-sm font-medium text-gray-500">Completed</span>
              </div>
              <div className="text-3xl font-bold text-emerald-600">{analysis.completed.length}</div>
            </div>
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
              <div className="flex items-center gap-2 mb-1">
                <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: STATUS_COLORS.scheduled }} />
                <span className="text-sm font-medium text-gray-500">Not Started</span>
              </div>
              <div className="text-3xl font-bold text-blue-600">{analysis.scheduledOnly.length}</div>
            </div>
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
              <div className="flex items-center gap-2 mb-1">
                <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: STATUS_COLORS.unplanned }} />
                <span className="text-sm font-medium text-gray-500">Unplanned</span>
              </div>
              <div className="text-3xl font-bold text-amber-600">{analysis.unplanned.length}</div>
            </div>
          </div>

          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Scheduled vs Completed</h3>
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={analysis.dailyChart}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 11 }}
                  tickFormatter={(v) => {
                    const d = new Date(v + 'T00:00:00');
                    return `${d.getMonth() + 1}/${d.getDate()}`;
                  }}
                />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip labelFormatter={(v) => v} />
                <Legend />
                <Bar dataKey="scheduled" name="Scheduled" fill={STATUS_COLORS.scheduled} radius={[2, 2, 0, 0]} />
                <Bar dataKey="completed" name="Completed" fill={STATUS_COLORS.completed} radius={[2, 2, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </>
      )}
    </div>
  );
}
