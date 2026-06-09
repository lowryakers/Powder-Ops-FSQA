import { RefreshCw } from 'lucide-react';
import { startOfWeek, endOfWeek, startOfMonth, endOfMonth, subWeeks, subMonths } from 'date-fns';

function getQuickRange(key) {
  const now = new Date();
  switch (key) {
    case 'this-week':
      return { start: startOfWeek(now, { weekStartsOn: 1 }), end: endOfWeek(now, { weekStartsOn: 1 }) };
    case 'last-week': {
      const prev = subWeeks(now, 1);
      return { start: startOfWeek(prev, { weekStartsOn: 1 }), end: endOfWeek(prev, { weekStartsOn: 1 }) };
    }
    case 'this-month':
      return { start: startOfMonth(now), end: endOfMonth(now) };
    case 'last-month': {
      const prev = subMonths(now, 1);
      return { start: startOfMonth(prev), end: endOfMonth(prev) };
    }
    default:
      return { start: null, end: null };
  }
}

const QUICK_RANGES = [
  { key: 'last-week', label: 'Last Week' },
  { key: 'this-week', label: 'This Week' },
  { key: 'last-month', label: 'Last Month' },
  { key: 'this-month', label: 'This Month' },
];

function isActiveRange(dateRange, key) {
  const range = getQuickRange(key);
  if (!dateRange.start || !dateRange.end || !range.start || !range.end) return false;
  return (
    dateRange.start.toDateString() === range.start.toDateString() &&
    dateRange.end.toDateString() === range.end.toDateString()
  );
}

export default function FilterBar({
  teams,
  products,
  teamFilter,
  setTeamFilter,
  productFilter,
  setProductFilter,
  dateRange,
  setDateRange,
  lastRefresh,
  onRefresh,
  loading,
}) {
  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 flex flex-wrap items-center gap-4">
      <div className="flex items-center gap-2">
        <label className="text-sm font-medium text-gray-600">Team</label>
        <select
          value={teamFilter}
          onChange={(e) => setTeamFilter(e.target.value)}
          className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm bg-white focus:ring-2 focus:ring-powder-500 focus:border-powder-500"
        >
          <option value="All">All Teams</option>
          {teams.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
      </div>

      <div className="flex items-center gap-2">
        <label className="text-sm font-medium text-gray-600">Product</label>
        <select
          value={productFilter}
          onChange={(e) => setProductFilter(e.target.value)}
          className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm bg-white focus:ring-2 focus:ring-powder-500 focus:border-powder-500 max-w-[220px]"
        >
          <option value="All">All Products</option>
          {products.map((p) => (
            <option key={p} value={p}>{p.length > 50 ? p.slice(0, 50) + '…' : p}</option>
          ))}
        </select>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <label className="text-sm font-medium text-gray-600">From</label>
        <input
          type="date"
          value={dateRange.start ? dateRange.start.toISOString().split('T')[0] : ''}
          onChange={(e) =>
            setDateRange((prev) => ({
              ...prev,
              start: e.target.value ? new Date(e.target.value + 'T00:00:00') : null,
            }))
          }
          className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm"
        />
        <label className="text-sm font-medium text-gray-600">To</label>
        <input
          type="date"
          value={dateRange.end ? dateRange.end.toISOString().split('T')[0] : ''}
          onChange={(e) =>
            setDateRange((prev) => ({
              ...prev,
              end: e.target.value ? new Date(e.target.value + 'T23:59:59') : null,
            }))
          }
          className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm"
        />
        <div className="flex gap-1">
          {QUICK_RANGES.map((r) => (
            <button
              key={r.key}
              onClick={() => {
                if (isActiveRange(dateRange, r.key)) {
                  setDateRange({ start: null, end: null });
                } else {
                  setDateRange(getQuickRange(r.key));
                }
              }}
              className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                isActiveRange(dateRange, r.key)
                  ? 'bg-powder-600 text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      <div className="ml-auto flex items-center gap-3">
        {lastRefresh && (
          <span className="text-xs text-gray-400">
            Updated {lastRefresh.toLocaleTimeString()}
          </span>
        )}
        <button
          onClick={onRefresh}
          disabled={loading}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-powder-600 text-white text-sm font-medium hover:bg-powder-700 transition-colors disabled:opacity-50"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>
    </div>
  );
}
