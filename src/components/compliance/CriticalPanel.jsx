import { useApiGet } from '../../hooks/useApi';
import { CheckCircle, AlertTriangle, OctagonAlert, ChevronRight, RefreshCw } from 'lucide-react';

// Audit Prep Phase 2 — Critical Tracking: one screen of program health.
// Every category shows its worst offenders and links into the owning module.
const TONE = {
  ok: { ring: 'border-green-200', bg: 'bg-green-50', text: 'text-green-700', icon: CheckCircle, chip: 'bg-green-100 text-green-800' },
  warn: { ring: 'border-amber-200', bg: 'bg-amber-50', text: 'text-amber-700', icon: AlertTriangle, chip: 'bg-amber-100 text-amber-800' },
  crit: { ring: 'border-red-200', bg: 'bg-red-50', text: 'text-red-700', icon: OctagonAlert, chip: 'bg-red-100 text-red-800' },
};

function CategoryCard({ cat, onNavigate }) {
  const tone = TONE[cat.status] || TONE.ok;
  const Icon = tone.icon;
  return (
    <div className={`bg-white rounded-xl border ${cat.status === 'ok' ? 'border-gray-200' : tone.ring} overflow-hidden flex flex-col`}>
      <div className={`flex items-center gap-2.5 px-4 py-3 ${cat.status === 'ok' ? '' : tone.bg}`}>
        <Icon size={18} className={cat.status === 'ok' ? 'text-green-500' : tone.text} />
        <span className="font-semibold text-gray-900 text-sm flex-1">{cat.label}</span>
        <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${cat.count === 0 ? 'bg-gray-100 text-gray-500' : tone.chip}`}>{cat.count}</span>
      </div>
      {cat.items?.length > 0 && (
        <div className="px-4 py-2 divide-y divide-gray-50 flex-1">
          {cat.items.map((it, i) => (
            <div key={i} className="py-1.5">
              <p className="text-xs font-medium text-gray-800 leading-snug">{it.title}</p>
              {it.detail && <p className="text-[11px] text-gray-400">{it.detail}</p>}
            </div>
          ))}
          {cat.count > cat.items.length && <p className="py-1.5 text-[11px] text-gray-400">…and {cat.count - cat.items.length} more</p>}
        </div>
      )}
      {cat.count === 0 && <div className="px-4 py-3 text-xs text-gray-400 flex-1">All clear.</div>}
      {cat.module && (
        <button onClick={() => onNavigate(cat.module)}
          className="flex items-center justify-between px-4 py-2 border-t border-gray-100 text-xs font-medium text-powder-700 hover:bg-powder-50">
          Open module <ChevronRight size={13} />
        </button>
      )}
    </div>
  );
}

export default function CriticalPanel({ onNavigate = () => {} }) {
  const { data, loading, refresh } = useApiGet('/compliance/critical');
  if (loading && !data) return <div className="text-center py-12 text-gray-500">Loading program health…</div>;
  if (!data?.categories) return <div className="text-center py-12 text-gray-400">Critical Tracking is available to admins and supervisors.</div>;

  const cats = Object.values(data.categories);
  const attention = cats.filter(c => c.status !== 'ok');
  const overall = TONE[data.overall] || TONE.ok;
  const OverallIcon = overall.icon;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="text-xl font-bold text-gray-900">Critical Tracking</h2>
          <p className="text-sm text-gray-500">Program health at a glance — everything an auditor would flag, before they do.</p>
        </div>
        <button onClick={refresh} className="flex items-center gap-1.5 px-3 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-200">
          <RefreshCw size={14} /> Refresh
        </button>
      </div>

      <div className={`rounded-xl border p-4 flex items-center gap-3 ${overall.ring} ${overall.bg}`}>
        <OverallIcon size={24} className={overall.text} />
        <div>
          <p className="font-semibold text-gray-900">
            {data.overall === 'ok' ? 'All programs on track' : data.overall === 'warn' ? `${attention.length} area${attention.length === 1 ? '' : 's'} need attention` : 'Critical items need action now'}
          </p>
          <p className="text-sm text-gray-600">
            {attention.length ? attention.map(c => `${c.label} (${c.count})`).join(' · ') : 'No overdue tasks, unsigned records, expiring certifications, or open holds.'}
          </p>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {cats.map(cat => <CategoryCard key={cat.label} cat={cat} onNavigate={onNavigate} />)}
      </div>
    </div>
  );
}
