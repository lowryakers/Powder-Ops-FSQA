import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ScatterChart, Scatter, ZAxis,
} from 'recharts';
import { getTeamColor } from '../utils/parseSheet';

function avg(arr) {
  return arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : 0;
}

export default function StaffingTab({ runs }) {
  const teams = [...new Set(runs.map((r) => r.team))].sort();

  const teamStats = teams.map((team) => {
    const teamRuns = runs.filter((r) => r.team === team);
    const withPeople = teamRuns.filter((r) => r.people != null);
    const avgPeople = avg(withPeople.map((r) => r.people));
    const totalManHours = teamRuns.reduce((s, r) => s + (r.manHours || 0), 0);
    const totalUnits = teamRuns.reduce((s, r) => s + r.quantity, 0);
    return { team, avgPeople, totalManHours, totalUnits, runs: teamRuns.length };
  });

  // Daily staffing heatmap-like data
  const dailyTeam = {};
  runs.forEach((r) => {
    if (r.people == null) return;
    const key = `${r.dateStr}|${r.team}`;
    if (!dailyTeam[key]) dailyTeam[key] = { date: r.dateStr, team: r.team, people: [] };
    dailyTeam[key].people.push(r.people);
  });

  // People vs output scatter per team
  const scatterData = runs
    .filter((r) => r.people != null && r.unitsPerManHour != null)
    .map((r) => ({
      people: r.people,
      efficiency: r.unitsPerManHour,
      team: r.team,
      quantity: r.quantity,
    }));

  // Weekly people deployed
  const weeklyPeople = {};
  runs.forEach((r) => {
    if (r.people == null) return;
    if (!weeklyPeople[r.week]) weeklyPeople[r.week] = { week: r.week };
    if (!weeklyPeople[r.week][r.team]) weeklyPeople[r.week][r.team] = [];
    weeklyPeople[r.week][r.team].push(r.people);
  });
  const weeklyChart = Object.values(weeklyPeople)
    .map((w) => {
      const row = { week: w.week };
      teams.forEach((t) => {
        row[t] = w[t] ? Math.round(avg(w[t]) * 10) / 10 : 0;
      });
      return row;
    })
    .sort((a, b) => a.week.localeCompare(b.week));

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {teamStats.map((t) => (
          <div key={t.team} className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-3 h-3 rounded-full" style={{ backgroundColor: getTeamColor(t.team) }} />
              <span className="font-semibold text-gray-900">{t.team}</span>
            </div>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <div className="text-gray-500">Avg People/Run</div>
                <div className="font-bold text-lg">{t.avgPeople.toFixed(1)}</div>
              </div>
              <div>
                <div className="text-gray-500">Total Man-Hours</div>
                <div className="font-bold text-lg">{t.totalManHours.toFixed(0)}</div>
              </div>
              <div>
                <div className="text-gray-500">Total Runs</div>
                <div className="font-bold text-lg">{t.runs}</div>
              </div>
              <div>
                <div className="text-gray-500">Units/Man-Hour</div>
                <div className="font-bold text-lg">
                  {t.totalManHours > 0 ? (t.totalUnits / t.totalManHours).toFixed(0) : '–'}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Avg People Deployed Per Run (Weekly)</h3>
        <ResponsiveContainer width="100%" height={300}>
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
            <YAxis tick={{ fontSize: 11 }} />
            <Tooltip labelFormatter={(v) => `Week of ${v}`} />
            {teams.map((team) => (
              <Bar key={team} dataKey={team} fill={getTeamColor(team)} radius={[2, 2, 0, 0]} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-1">People vs Efficiency</h3>
        <p className="text-sm text-gray-500 mb-4">Does adding more people improve units/man-hour?</p>
        <ResponsiveContainer width="100%" height={300}>
          <ScatterChart>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
            <XAxis type="number" dataKey="people" name="People" tick={{ fontSize: 11 }} label={{ value: 'People on Run', position: 'bottom', fontSize: 12 }} />
            <YAxis type="number" dataKey="efficiency" name="Units/Man-Hr" tick={{ fontSize: 11 }} />
            <ZAxis type="number" dataKey="quantity" range={[20, 200]} />
            <Tooltip
              formatter={(v, name) => [name === 'efficiency' ? `${v.toFixed(0)} u/mh` : v, name === 'efficiency' ? 'Efficiency' : name === 'people' ? 'People' : 'Quantity']}
            />
            {teams.map((team) => (
              <Scatter
                key={team}
                name={team}
                data={scatterData.filter((d) => d.team === team)}
                fill={getTeamColor(team)}
                opacity={0.7}
              />
            ))}
          </ScatterChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
