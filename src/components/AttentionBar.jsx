import { AlertTriangle, OctagonAlert } from 'lucide-react';

// Explains a module's sidebar badge on the page it belongs to: the badge says
// "7", this says which 7 things they are. Rendered above the module's content
// whenever that module has open critical/warning items.
export default function AttentionBar({ detail }) {
  const actionable = (detail || []).filter(d => d.severity === 'critical' || d.severity === 'warning');
  const upcoming = (detail || []).filter(d => d.severity === 'info');
  if (!actionable.length && !upcoming.length) return null;
  const total = actionable.reduce((n, d) => n + (d.count || 1), 0);
  const worst = actionable.some(d => d.severity === 'critical') ? 'critical' : 'warning';
  const tone = worst === 'critical'
    ? { box: 'border-red-200 bg-red-50', head: 'text-red-800', icon: 'text-red-600', Icon: OctagonAlert }
    : { box: 'border-amber-200 bg-amber-50', head: 'text-amber-800', icon: 'text-amber-600', Icon: AlertTriangle };
  const { Icon } = tone;

  // Nothing actionable, only heads-up items: a quiet neutral note instead of
  // an alarm-colored bar.
  if (!actionable.length) {
    return (
      <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-2.5 mb-4">
        <p className="text-[13px] text-gray-600">
          <span className="font-medium text-gray-700">Coming up:</span> {upcoming.map(d => d.label).join(' · ')}
        </p>
      </div>
    );
  }

  return (
    <div className={`rounded-xl border ${tone.box} px-4 py-3 mb-4`}>
      <div className="flex items-start gap-2.5">
        <Icon size={17} className={`${tone.icon} mt-0.5 shrink-0`} />
        <div className="min-w-0">
          <p className={`text-sm font-semibold ${tone.head}`}>
            {total} item{total === 1 ? '' : 's'} on this page need attention
          </p>
          <ul className="mt-1 space-y-0.5">
            {actionable.map(d => (
              <li key={d.id} className="text-[13px] text-gray-700 flex items-start gap-1.5">
                <span className={`mt-1.5 h-1.5 w-1.5 rounded-full shrink-0 ${d.severity === 'critical' ? 'bg-red-500' : 'bg-amber-500'}`} />
                {d.label}
              </li>
            ))}
          </ul>
          {upcoming.length > 0 && (
            <p className="mt-1.5 text-[12px] text-gray-500">
              Coming up: {upcoming.map(d => d.label).join(' · ')}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
