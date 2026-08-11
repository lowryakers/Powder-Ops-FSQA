import { useApiGet } from '../../hooks/useApi';
import { X, ExternalLink, AlertTriangle, CheckCircle2, Circle } from 'lucide-react';
import { formatDate } from '../../lib/datetime.js';

/**
 * The tasks behind a number on Team Activity.
 *
 * "34% completion" and "27 overdue" are answers to questions nobody asked. The
 * question is *which* — which twenty-seven, whose, and how late. A dashboard
 * that can only be read is a dashboard you check once and stop opening.
 *
 * The rows come from `/activity/tasks`, which filters with the same predicates
 * that produced the number, so this list cannot disagree with the card that
 * opened it. Nothing is recomputed here; even "12 days late" is the server's.
 */

const STATUS_STYLE = {
  completed: 'bg-green-100 text-green-800',
  missed: 'bg-red-100 text-red-800',
  overdue: 'bg-red-100 text-red-800',
  open: 'bg-gray-100 text-gray-700',
  in_progress: 'bg-blue-100 text-blue-800',
  not_applicable: 'bg-gray-100 text-gray-500',
  cancelled: 'bg-gray-100 text-gray-500',
};
const pretty = (s) => (s || '').replace(/_/g, ' ');

function Row({ t }) {
  return (
    <div className="px-4 py-2.5 border-b border-gray-100 last:border-0">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-gray-900 break-words">{t.title}</p>
          <p className="text-xs text-gray-500 mt-0.5">
            {[t.equipment_name, t.completed_by || t.assigned_to || 'Unassigned']
              .filter(Boolean).join(' · ')}
          </p>
        </div>
        <span className={`shrink-0 text-[11px] px-2 py-0.5 rounded-full font-medium ${STATUS_STYLE[t.status] || 'bg-gray-100 text-gray-700'}`}>
          {pretty(t.status)}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1 text-xs">
        <span className="text-gray-500">Due {formatDate(t.due_date)}</span>
        {t.completed_at && (
          <span className={t.on_time ? 'text-green-700' : 'text-amber-700'}>
            {t.on_time
              ? <><CheckCircle2 size={11} className="inline mr-0.5 -mt-0.5" />On time</>
              : <>Completed {t.days_late} day{t.days_late === 1 ? '' : 's'} late</>}
          </span>
        )}
        {/* Days late on outstanding work is what makes a list of 27 sortable by
            how bad it is, which is the first thing anyone wants to know. */}
        {!t.completed_at && t.overdue && t.days_late > 0 && (
          <span className="text-red-700 font-medium">
            <AlertTriangle size={11} className="inline mr-0.5 -mt-0.5" />
            {t.days_late} day{t.days_late === 1 ? '' : 's'} overdue
          </span>
        )}
        {!t.completed_at && !t.overdue && (
          <span className="text-gray-400"><Circle size={11} className="inline mr-0.5 -mt-0.5" />Not yet due</span>
        )}
        {t.cycle_days != null && (
          <span className="text-gray-400">{t.cycle_days.toFixed(1)}d to complete</span>
        )}
      </div>
    </div>
  );
}

// `scopeLabel` is the caller's wording for what was clicked ("Quality",
// "Maria Servin", "Everyone"). The server answers with rows, not with how the
// screen described the cell that asked.
export default function ActivityDrillDown({ query, scopeLabel, onClose }) {
  const qs = new URLSearchParams(
    Object.entries(query).filter(([, v]) => v != null && v !== ''),
  ).toString();
  const { data, loading } = useApiGet(`/activity/tasks?${qs}`, [qs]);

  return (
    <div className="fixed inset-0 bg-black/30 z-50 flex justify-end" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()}
        className="bg-white w-full max-w-lg h-full flex flex-col shadow-xl">
        <div className="flex items-start justify-between gap-3 px-4 py-3 border-b border-gray-200">
          <div className="min-w-0">
            <h3 className="text-base font-bold text-gray-900">
              {data?.label || 'Tasks'}
              {data ? <span className="ml-2 text-gray-400 font-medium tabular-nums">{data.total}</span> : null}
            </h3>
            <p className="text-xs text-gray-500">
              {scopeLabel || 'Everyone'}
              {data ? ` · due ${formatDate(data.from)} – ${formatDate(data.to)}` : ''}
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 shrink-0"><X size={20} /></button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {loading && <p className="p-4 text-sm text-gray-400">Loading…</p>}
          {!loading && data?.tasks?.length === 0 && (
            <p className="p-4 text-sm text-gray-500">No tasks match this figure.</p>
          )}
          {data?.tasks?.map((t) => <Row key={t.id} t={t} />)}
          {data?.truncated && (
            <p className="px-4 py-3 text-xs text-gray-500">
              Showing the first {data.tasks.length} of {data.total}. Task Center has the full list with filters.
            </p>
          )}
        </div>

        <div className="border-t border-gray-200 p-3">
          <button
            onClick={() => window.dispatchEvent(new CustomEvent('app-navigate', { detail: { tab: 'pm' } }))}
            className="inline-flex items-center gap-1.5 text-sm font-medium text-powder-700 hover:underline">
            Open Task Center <ExternalLink size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}
