import { useState, useMemo } from 'react';
import { useApiGet, apiPost, apiPut } from '../../hooks/useApi';
import { useAuth } from '../../hooks/useAuth';
import { CheckCircle, Clock, AlertTriangle, ChevronDown, ChevronUp, Wrench, CalendarDays, ChevronRight, CircleDot, Filter, Search } from 'lucide-react';

const FREQ_COLORS = {
  daily: 'bg-blue-500',
  weekly: 'bg-purple-500',
  monthly: 'bg-amber-500',
  quarterly: 'bg-emerald-500',
  annual: 'bg-rose-500',
};

const PRIORITY_RING = {
  critical: 'ring-2 ring-red-400 border-red-400',
  high: 'ring-2 ring-orange-300 border-orange-300',
};

function daysBetween(a, b) {
  const msPerDay = 86400000;
  return Math.floor((new Date(a) - new Date(b)) / msPerDay);
}

function formatDueLabel(dueDate) {
  const today = new Date().toISOString().split('T')[0];
  const diff = daysBetween(dueDate, today);
  if (diff < 0) return `${Math.abs(diff)}d overdue`;
  if (diff === 0) return 'Due today';
  if (diff === 1) return 'Due tomorrow';
  if (diff <= 7) return `Due in ${diff} days`;
  return `Due ${dueDate}`;
}

function TaskCard({ task, onComplete, onAssign, technicians, userName }) {
  const [expanded, setExpanded] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  const steps = task.procedure_steps || [];
  const today = new Date().toISOString().split('T')[0];
  const isOverdue = task.due_date < today;
  const isDueToday = task.due_date === today;
  const isCritical = task.priority === 'critical' || task.priority === 'high';

  const handleSubmit = async () => {
    setSaving(true);
    try {
      await onComplete(task.id, { _actor: userName || 'Operator', notes: notes || null });
      setCompleting(false);
      setNotes('');
    } finally { setSaving(false); }
  };

  return (
    <div className={`bg-white rounded-2xl border-2 transition-all ${
      isOverdue ? 'border-red-400 bg-red-50/30' :
      isCritical ? (PRIORITY_RING[task.priority] || 'border-gray-200') :
      isDueToday ? 'border-powder-400' :
      'border-gray-200'
    }`}>
      {/* Main card content */}
      <div className="p-4">
        <div className="flex items-start gap-3">
          {/* Complete button */}
          {!completing ? (
            <button onClick={() => setCompleting(true)}
              className="shrink-0 w-11 h-11 rounded-full border-2 border-gray-300 flex items-center justify-center text-gray-400 hover:border-green-500 hover:text-green-500 hover:bg-green-50 transition-all active:scale-90 mt-0.5">
              <CheckCircle size={22} />
            </button>
          ) : (
            <div className="shrink-0 w-11 h-11 rounded-full bg-green-500 flex items-center justify-center mt-0.5">
              <CheckCircle size={22} className="text-white" />
            </div>
          )}

          <div className="flex-1 min-w-0">
            {/* Title row */}
            <h3 className="text-base font-semibold text-gray-900 leading-snug">{task.title}</h3>

            {/* Equipment + location */}
            <p className="text-sm text-gray-500 mt-0.5">
              {task.equipment_name}
              {task.location && <span className="text-gray-400"> &middot; {task.location}</span>}
            </p>

            {/* Meta row: badges + due */}
            <div className="flex items-center gap-2 mt-2 flex-wrap">
              {task.frequency_type && (
                <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold text-white uppercase tracking-wide ${FREQ_COLORS[task.frequency_type] || 'bg-gray-400'}`}>
                  {task.frequency_type}
                </span>
              )}

              <span className={`text-xs font-medium flex items-center gap-1 ${
                isOverdue ? 'text-red-600' : isDueToday ? 'text-powder-600' : 'text-gray-400'
              }`}>
                {isOverdue ? <AlertTriangle size={11} /> : <Clock size={11} />}
                {formatDueLabel(task.due_date)}
              </span>

              {task.assigned_to && (
                <span className="text-xs text-gray-400">&middot; {task.assigned_to}</span>
              )}
            </div>
          </div>

          {/* Expand chevron if steps exist */}
          {steps.length > 0 && !completing && (
            <button onClick={() => setExpanded(!expanded)}
              className="shrink-0 w-8 h-8 rounded-lg flex items-center justify-center text-gray-400 hover:bg-gray-100 mt-0.5">
              {expanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
            </button>
          )}
        </div>

        {/* Steps accordion */}
        {expanded && steps.length > 0 && (
          <div className="mt-3 ml-14">
            <ol className="space-y-1.5">
              {steps.map((s, i) => (
                <li key={i} className="flex items-start gap-2.5 text-sm">
                  <span className="shrink-0 w-5 h-5 rounded-full bg-gray-100 text-gray-500 text-xs font-bold flex items-center justify-center mt-0.5">{i + 1}</span>
                  <span className="text-gray-600 leading-snug">{s}</span>
                </li>
              ))}
            </ol>
          </div>
        )}

        {/* Inline completion */}
        {completing && (
          <div className="mt-3 ml-14 bg-green-50 rounded-xl p-3 space-y-2 border border-green-200">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Notes (optional)</label>
              <textarea value={notes} onChange={e => setNotes(e.target.value)} autoFocus
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" rows={2} placeholder="Any issues or observations..." />
            </div>
            {technicians && technicians.length > 0 && !task.assigned_to && (
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Assign to</label>
                <select onChange={e => { if (e.target.value) onAssign(task.id, e.target.value); }}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" defaultValue="">
                  <option value="">Leave unassigned</option>
                  {technicians.map(t => <option key={t.id} value={t.name}>{t.name}</option>)}
                </select>
              </div>
            )}
            <div className="flex gap-2">
              <button onClick={handleSubmit} disabled={saving}
                className="flex-1 py-2.5 bg-green-600 text-white rounded-lg text-sm font-bold hover:bg-green-700 disabled:opacity-50 active:scale-[0.98] transition-transform">
                {saving ? 'Saving...' : 'Mark Complete'}
              </button>
              <button onClick={() => { setCompleting(false); setNotes(''); }}
                className="px-4 py-2.5 bg-white text-gray-600 rounded-lg text-sm font-medium border border-gray-200 hover:bg-gray-50">
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function SectionHeader({ icon: Icon, title, count, color, defaultOpen = true, children }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div>
      <button onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 py-2 group">
        <div className={`w-7 h-7 rounded-lg flex items-center justify-center ${color}`}>
          <Icon size={14} className="text-white" />
        </div>
        <span className="text-sm font-bold text-gray-900 flex-1 text-left">{title}</span>
        <span className="text-xs font-medium text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">{count}</span>
        <ChevronRight size={16} className={`text-gray-400 transition-transform ${open ? 'rotate-90' : ''}`} />
      </button>
      {open && <div className="space-y-2 pb-4">{children}</div>}
    </div>
  );
}

export default function OperatorView() {
  const { user } = useAuth() || {};
  const dept = user?.role === 'admin' ? null : (user?.department || 'warehouse');
  const groupParam = dept ? `?group=${dept}` : '';
  const { data: tasks, loading, refresh } = useApiGet(`/pm/operator-tasks${groupParam}`);
  const { data: technicians } = useApiGet('/users/technicians');
  const [freqFilter, setFreqFilter] = useState('all');
  const [showFilters, setShowFilters] = useState(false);
  const [search, setSearch] = useState('');

  const handleComplete = async (woId, form) => {
    await apiPost(`/pm/work-orders/${woId}/complete-and-recur`, form);
    refresh();
  };

  const handleAssign = async (woId, assignedTo) => {
    await apiPut(`/pm/work-orders/${woId}`, { assigned_to: assignedTo });
    refresh();
  };

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    return (tasks || []).filter(t => {
      if (freqFilter !== 'all' && t.frequency_type !== freqFilter) return false;
      if (q && ![t.title, t.equipment_name, t.location, t.assigned_to].some(v => v && v.toLowerCase().includes(q))) return false;
      return true;
    });
  }, [tasks, freqFilter, search]);

  const { overdue, today, thisWeek, upcoming } = useMemo(() => {
    const now = new Date();
    const todayStr = now.toISOString().split('T')[0];
    const weekEnd = new Date(now);
    weekEnd.setDate(weekEnd.getDate() + 7);
    const weekEndStr = weekEnd.toISOString().split('T')[0];

    const groups = { overdue: [], today: [], thisWeek: [], upcoming: [] };
    for (const t of filtered) {
      if (t.due_date < todayStr) groups.overdue.push(t);
      else if (t.due_date === todayStr) groups.today.push(t);
      else if (t.due_date <= weekEndStr) groups.thisWeek.push(t);
      else groups.upcoming.push(t);
    }
    return groups;
  }, [filtered]);

  const freqCounts = useMemo(() => {
    const c = {};
    for (const t of (tasks || [])) {
      const f = t.frequency_type || 'other';
      c[f] = (c[f] || 0) + 1;
    }
    return c;
  }, [tasks]);

  const userName = user?.name || '';

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="text-center">
          <div className="w-10 h-10 bg-powder-600 rounded-xl flex items-center justify-center mx-auto mb-3 animate-pulse">
            <Wrench size={20} className="text-white" />
          </div>
          <p className="text-gray-500 text-sm">Loading tasks...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header with summary */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">
            {userName ? `Hi, ${userName.split(' ')[0]}` : 'My Tasks'}
          </h1>
          <p className="text-sm text-gray-500">
            {overdue.length > 0 && <span className="text-red-600 font-semibold">{overdue.length} overdue &middot; </span>}
            {today.length} due today &middot; {filtered.length} total
          </p>
        </div>
        <button onClick={() => setShowFilters(!showFilters)}
          className={`w-9 h-9 rounded-lg flex items-center justify-center border transition-colors ${showFilters ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-500 border-gray-200 hover:bg-gray-50'}`}>
          <Filter size={16} />
        </button>
      </div>

      {/* Search bar */}
      <div className="relative">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search tasks, equipment, location..."
          className="w-full pl-9 pr-3 py-2.5 border border-gray-200 rounded-xl text-sm bg-white focus:outline-none focus:ring-2 focus:ring-powder-500 focus:border-transparent"
        />
        {search && (
          <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-xs font-medium">
            Clear
          </button>
        )}
      </div>

      {/* Quick stats bar */}
      <div className="grid grid-cols-4 gap-2">
        <div className={`rounded-xl p-2.5 text-center ${overdue.length > 0 ? 'bg-red-50 border border-red-200' : 'bg-gray-50 border border-gray-100'}`}>
          <p className={`text-lg font-bold ${overdue.length > 0 ? 'text-red-600' : 'text-gray-400'}`}>{overdue.length}</p>
          <p className="text-[10px] font-medium text-gray-500 uppercase">Overdue</p>
        </div>
        <div className={`rounded-xl p-2.5 text-center ${today.length > 0 ? 'bg-powder-50 border border-powder-200' : 'bg-gray-50 border border-gray-100'}`}>
          <p className={`text-lg font-bold ${today.length > 0 ? 'text-powder-600' : 'text-gray-400'}`}>{today.length}</p>
          <p className="text-[10px] font-medium text-gray-500 uppercase">Today</p>
        </div>
        <div className="rounded-xl p-2.5 text-center bg-gray-50 border border-gray-100">
          <p className="text-lg font-bold text-gray-600">{thisWeek.length}</p>
          <p className="text-[10px] font-medium text-gray-500 uppercase">This Week</p>
        </div>
        <div className="rounded-xl p-2.5 text-center bg-gray-50 border border-gray-100">
          <p className="text-lg font-bold text-gray-400">{upcoming.length}</p>
          <p className="text-[10px] font-medium text-gray-500 uppercase">Later</p>
        </div>
      </div>

      {/* Collapsible filter row */}
      {showFilters && (
        <div className="flex gap-1.5 flex-wrap bg-white rounded-xl border border-gray-200 p-3">
          <button onClick={() => setFreqFilter('all')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${freqFilter === 'all' ? 'bg-gray-800 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
            All ({(tasks || []).length})
          </button>
          {['daily', 'weekly', 'monthly', 'quarterly', 'annual'].map(f => freqCounts[f] ? (
            <button key={f} onClick={() => setFreqFilter(f)}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${freqFilter === f ? `${FREQ_COLORS[f]} text-white` : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
              {f.charAt(0).toUpperCase() + f.slice(1)} ({freqCounts[f]})
            </button>
          ) : null)}
        </div>
      )}

      {/* Task sections */}
      {filtered.length === 0 ? (
        <div className="text-center py-16">
          <CheckCircle size={48} className="mx-auto text-green-400 mb-3" />
          <p className="text-lg font-semibold text-gray-700">All caught up!</p>
          <p className="text-gray-500 text-sm">No {freqFilter !== 'all' ? freqFilter + ' ' : ''}tasks pending.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {overdue.length > 0 && (
            <SectionHeader icon={AlertTriangle} title="Overdue" count={overdue.length} color="bg-red-500" defaultOpen={true}>
              {overdue.map(t => (
                <TaskCard key={t.id} task={t} onComplete={handleComplete} onAssign={handleAssign} technicians={technicians || []} userName={userName} />
              ))}
            </SectionHeader>
          )}

          {today.length > 0 && (
            <SectionHeader icon={CircleDot} title="Due Today" count={today.length} color="bg-powder-600" defaultOpen={true}>
              {today.map(t => (
                <TaskCard key={t.id} task={t} onComplete={handleComplete} onAssign={handleAssign} technicians={technicians || []} userName={userName} />
              ))}
            </SectionHeader>
          )}

          {thisWeek.length > 0 && (
            <SectionHeader icon={CalendarDays} title="This Week" count={thisWeek.length} color="bg-gray-500" defaultOpen={overdue.length + today.length < 10}>
              {thisWeek.map(t => (
                <TaskCard key={t.id} task={t} onComplete={handleComplete} onAssign={handleAssign} technicians={technicians || []} userName={userName} />
              ))}
            </SectionHeader>
          )}

          {upcoming.length > 0 && (
            <SectionHeader icon={Clock} title="Upcoming" count={upcoming.length} color="bg-gray-400" defaultOpen={overdue.length + today.length + thisWeek.length < 5}>
              {upcoming.map(t => (
                <TaskCard key={t.id} task={t} onComplete={handleComplete} onAssign={handleAssign} technicians={technicians || []} userName={userName} />
              ))}
            </SectionHeader>
          )}
        </div>
      )}
    </div>
  );
}
