import { useState } from 'react';
import { AlertTriangle, OctagonAlert, X, ChevronRight } from 'lucide-react';
import { useApiGet } from '../hooks/useApi';

// Explains a module's sidebar badge on the page it belongs to: the badge says
// "7", this says which 7 things they are — and, where the server can answer it,
// WHICH seven.
//
// "85 machines with no work instruction linked" is the start of a question, not
// an answer. A line the server marks `drillable` opens the rows behind it, and
// those rows come from the same walk that produced the number — a drawer built
// from a second query is a list that disagrees with the figure above it.
//
// A line with nothing behind it stays plain text. A button that opens an empty
// drawer is worse than no button.

function DetailDrawer({ item, onClose }) {
  const { data, loading, error } = useApiGet(`/compliance/attention/${item.id}`, [item.id]);
  const rows = data?.rows || [];
  return (
    <div className="fixed inset-0 bg-black/30 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div onClick={e => e.stopPropagation()}
        className="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[85vh] flex flex-col">
        <div className="flex items-start justify-between gap-2 px-5 py-4 border-b border-gray-100">
          <div className="min-w-0">
            <h3 className="font-semibold text-gray-900 text-sm">{item.label}</h3>
            {data && (
              <p className="text-xs text-gray-500 mt-0.5">
                {data.total} in total{data.shown < data.total ? ` · showing the first ${data.shown}` : ''}
              </p>
            )}
          </div>
          <button type="button" onClick={onClose} className="p-1 hover:bg-gray-100 rounded-lg shrink-0">
            <X size={18} className="text-gray-500" />
          </button>
        </div>
        <div className="overflow-y-auto px-5 py-3">
          {loading && <p className="text-sm text-gray-400 py-6 text-center">Loading…</p>}
          {error && <p className="text-sm text-red-600 py-6 text-center">{error.message || 'Could not load these.'}</p>}
          {!loading && !error && rows.length === 0 && (
            <p className="text-sm text-gray-400 py-6 text-center">Nothing outstanding — the count has moved since this page loaded.</p>
          )}
          <ul className="divide-y divide-gray-100">
            {rows.map(r => (
              <li key={r.id} className="py-2">
                <p className="text-sm font-medium text-gray-900">{r.title}</p>
                {r.subtitle && <p className="text-xs text-gray-500">{r.subtitle}</p>}
                {r.note && <p className="text-xs text-gray-400 mt-0.5">{r.note}</p>}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

// One line of the bar: a button when the server says there is something to
// open, otherwise the plain text it has always been.
function Line({ d, onOpen, className }) {
  if (!d.drillable) return <span className={className}>{d.label}</span>;
  return (
    <button type="button" onClick={() => onOpen(d)}
      className={`${className} text-left hover:underline decoration-dotted underline-offset-2 inline-flex items-baseline gap-0.5`}>
      {d.label}
      <ChevronRight size={12} className="shrink-0 self-center opacity-60" />
    </button>
  );
}

// Module level, not defined inside the component — a component created during
// render is remounted on every render and the compiler rightly refuses it.
function UpcomingLines({ items, onOpen }) {
  return (
    <>
      {items.map((d, i) => (
        <span key={d.id}>
          {i > 0 && ' \u00b7 '}
          <Line d={d} onOpen={onOpen} className="text-inherit" />
        </span>
      ))}
    </>
  );
}

export default function AttentionBar({ detail }) {
  const [open, setOpen] = useState(null);
  const actionable = (detail || []).filter(d => d.severity === 'critical' || d.severity === 'warning');
  const upcoming = (detail || []).filter(d => d.severity === 'info');
  if (!actionable.length && !upcoming.length) return null;
  const total = actionable.reduce((n, d) => n + (d.count || 1), 0);
  const worst = actionable.some(d => d.severity === 'critical') ? 'critical' : 'warning';
  const tone = worst === 'critical'
    ? { box: 'border-red-200 bg-red-50', head: 'text-red-800', icon: 'text-red-600', Icon: OctagonAlert }
    : { box: 'border-amber-200 bg-amber-50', head: 'text-amber-800', icon: 'text-amber-600', Icon: AlertTriangle };
  const { Icon } = tone;

  // The "Coming up" items are every bit as worth opening as the actionable
  // ones — 85 machines with no work instruction is the biggest number on the
  // Equipment page and it lives down here.
  const drawer = open ? <DetailDrawer item={open} onClose={() => setOpen(null)} /> : null;

  // Nothing actionable, only heads-up items: a quiet neutral note instead of
  // an alarm-colored bar.
  if (!actionable.length) {
    return (
      <>
        <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-2.5 mb-4">
          <p className="text-[13px] text-gray-600">
            <span className="font-medium text-gray-700">Coming up:</span> <UpcomingLines items={upcoming} onOpen={setOpen} />
          </p>
        </div>
        {drawer}
      </>
    );
  }

  return (
    <>
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
                  <Line d={d} onOpen={setOpen} className="text-gray-700" />
                </li>
              ))}
            </ul>
            {upcoming.length > 0 && (
              <p className="mt-1.5 text-[12px] text-gray-500">
                Coming up: <UpcomingLines items={upcoming} onOpen={setOpen} />
              </p>
            )}
          </div>
        </div>
      </div>
      {drawer}
    </>
  );
}
