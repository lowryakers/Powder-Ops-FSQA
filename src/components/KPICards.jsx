import { Package, Clock, Users, TrendingUp, Zap } from 'lucide-react';

function median(arr) {
  if (!arr.length) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export default function KPICards({ runs }) {
  const totalUnits = runs.reduce((s, r) => s + r.quantity, 0);
  const totalRuns = runs.length;
  const totalManHours = runs.reduce((s, r) => s + (r.manHours || 0), 0);
  const runsWithEfficiency = runs.filter((r) => r.unitsPerManHour != null);
  const medianEfficiency = median(runsWithEfficiency.map((r) => r.unitsPerManHour));
  const runsWithUPM = runs.filter((r) => r.unitsPerMinute != null);
  const medianUPM = median(runsWithUPM.map((r) => r.unitsPerMinute));

  const cards = [
    {
      label: 'Total Units Produced',
      value: totalUnits.toLocaleString(undefined, { maximumFractionDigits: 0 }),
      icon: Package,
      color: 'text-blue-600 bg-blue-50',
    },
    {
      label: 'Total Runs',
      value: totalRuns.toLocaleString(),
      icon: Clock,
      color: 'text-emerald-600 bg-emerald-50',
    },
    {
      label: 'Total Man-Hours',
      value: totalManHours.toLocaleString(undefined, { maximumFractionDigits: 0 }),
      icon: Users,
      color: 'text-purple-600 bg-purple-50',
    },
    {
      label: 'Median Units/Min',
      value: medianUPM.toLocaleString(undefined, { maximumFractionDigits: 1 }),
      icon: Zap,
      color: 'text-cyan-600 bg-cyan-50',
    },
    {
      label: 'Median Units/Man-Hour',
      value: medianEfficiency.toLocaleString(undefined, { maximumFractionDigits: 0 }),
      icon: TrendingUp,
      color: 'text-amber-600 bg-amber-50',
    },
  ];

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
      {cards.map((c) => (
        <div key={c.label} className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm font-medium text-gray-500">{c.label}</span>
            <div className={`p-2 rounded-lg ${c.color}`}>
              <c.icon size={18} />
            </div>
          </div>
          <div className="text-2xl font-bold text-gray-900">{c.value}</div>
        </div>
      ))}
    </div>
  );
}
