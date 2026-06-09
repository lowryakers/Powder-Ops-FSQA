import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, BarChart, Bar, Cell,
} from 'recharts';
import { getTeamColor } from '../utils/parseSheet';

function median(arr) {
  if (!arr.length) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export default function EfficiencyTab({ runs }) {
  const teams = [...new Set(runs.map((r) => r.team))].sort();
  const effRuns = runs.filter((r) => r.unitsPerManHour != null);

  // Weekly median efficiency by team
  const weekTeam = {};
  effRuns.forEach((r) => {
    const key = `${r.week}|${r.team}`;
    if (!weekTeam[key]) weekTeam[key] = { week: r.week, team: r.team, values: [] };
    weekTeam[key].values.push(r.unitsPerManHour);
  });

  const weeklyMap = {};
  Object.values(weekTeam).forEach((wt) => {
    if (!weeklyMap[wt.week]) weeklyMap[wt.week] = { week: wt.week };
    weeklyMap[wt.week][wt.team] = median(wt.values);
  });
  const weeklyChart = Object.values(weeklyMap).sort((a, b) => a.week.localeCompare(b.week));

  // Overall median by team
  const teamMedians = teams.map((team) => {
    const vals = effRuns.filter((r) => r.team === team).map((r) => r.unitsPerManHour);
    return { team, median: median(vals), count: vals.length };
  }).sort((a, b) => b.median - a.median);

  // Top/bottom runs
  const topRuns = [...effRuns].sort((a, b) => b.unitsPerManHour - a.unitsPerManHour).slice(0, 5);
  const bottomRuns = [...effRuns].sort((a, b) => a.unitsPerManHour - b.unitsPerManHour).slice(0, 5);

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-1">Efficiency Trend (Median Units/Man-Hour)</h3>
        <p className="text-sm text-gray-500 mb-4">Weekly median by team — smooths out outlier runs</p>
        <ResponsiveContainer width="100%" height={350}>
          <LineChart data={weeklyChart}>
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
            <Tooltip
              formatter={(value) => value.toFixed(1)}
              labelFormatter={(v) => `Week of ${v}`}
            />
            <Legend />
            {teams.map((team) => (
              <Line
                key={team}
                type="monotone"
                dataKey={team}
                stroke={getTeamColor(team)}
                strokeWidth={2}
                dot={{ r: 3 }}
                connectNulls
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Median Efficiency by Team</h3>
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={teamMedians} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis type="number" tick={{ fontSize: 11 }} />
              <YAxis type="category" dataKey="team" tick={{ fontSize: 12 }} width={80} />
              <Tooltip formatter={(v) => `${v.toFixed(1)} units/man-hr`} />
              <Bar dataKey="median" radius={[0, 4, 4, 0]}>
                {teamMedians.map((t) => (
                  <Cell key={t.team} fill={getTeamColor(t.team)} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Best & Worst Runs</h3>
          <div className="space-y-3">
            <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Top 5</h4>
            {topRuns.map((r, i) => (
              <div key={i} className="flex justify-between items-start gap-2 text-sm">
                <span className="text-gray-700 leading-tight" title={r.product}>
                  {r.product}
                </span>
                <span className="font-semibold whitespace-nowrap" style={{ color: getTeamColor(r.team) }}>
                  {r.unitsPerManHour.toFixed(0)} u/mh
                </span>
              </div>
            ))}
            <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mt-4">Bottom 5</h4>
            {bottomRuns.map((r, i) => (
              <div key={i} className="flex justify-between items-start gap-2 text-sm">
                <span className="text-gray-700 leading-tight" title={r.product}>
                  {r.product}
                </span>
                <span className="font-semibold text-red-500 whitespace-nowrap">
                  {r.unitsPerManHour.toFixed(0)} u/mh
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
