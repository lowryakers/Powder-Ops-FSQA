import { useState } from 'react';
import { useApiGet, apiPost, apiPut } from '../../hooks/useApi';
import { CheckCircle, Clock, AlertTriangle, ChevronDown, ChevronUp, Wrench, UserPlus } from 'lucide-react';

const FREQ_COLORS = {
  daily: 'bg-blue-500',
  weekly: 'bg-purple-500',
  monthly: 'bg-amber-500',
  quarterly: 'bg-emerald-500',
  annual: 'bg-rose-500',
};

const FREQ_BG = {
  daily: 'border-blue-200',
  weekly: 'border-purple-200',
  monthly: 'border-amber-200',
  quarterly: 'border-emerald-200',
  annual: 'border-rose-200',
};

function TaskItem({ task, onComplete, onAssign, technicians }) {
  const [expanded, setExpanded] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [name, setName] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  const steps = task.procedure_steps || [];
  const isOverdue = new Date(task.due_date) < new Date() && task.status !== 'completed';

  const handleSubmit = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      await onComplete(task.id, { _actor: name, notes: notes || null });
      setCompleting(false);
      setName('');
      setNotes('');
    } finally { setSaving(false); }
  };

  return (
    <div className={`bg-white rounded-2xl border-2 ${isOverdue ? 'border-red-300' : FREQ_BG[task.frequency_type] || 'border-gray-200'} p-5 ${isOverdue ? 'ring-2 ring-red-100' : ''}`}>
      <div className="flex items-start gap-4">
        {/* Big tap target for complete */}
        {!completing ? (
          <button onClick={() => setCompleting(true)}
            className="shrink-0 w-12 h-12 rounded-full border-2 border-gray-300 flex items-center justify-center text-gray-400 hover:border-green-500 hover:text-green-500 hover:bg-green-50 transition-all active:scale-95">
            <CheckCircle size={24} />
          </button>
        ) : (
          <div className="shrink-0 w-12 h-12 rounded-full bg-green-100 flex items-center justify-center">
            <CheckCircle size={24} className="text-green-600" />
          </div>
        )}

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            {task.frequency_type && (
              <span className={`px-2.5 py-0.5 rounded-full text-xs font-bold text-white ${FREQ_COLORS[task.frequency_type] || 'bg-gray-500'}`}>
                {task.frequency_type.toUpperCase()}
              </span>
            )}
            {isOverdue && (
              <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-red-100 text-red-700 flex items-center gap-1">
                <AlertTriangle size={10} /> OVERDUE
              </span>
            )}
            {task.priority === 'critical' && (
              <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-red-100 text-red-800">CRITICAL</span>
            )}
            {task.priority === 'high' && (
              <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-orange-100 text-orange-800">HIGH</span>
            )}
          </div>

          <h3 className="text-lg font-semibold text-gray-900 leading-tight">{task.title}</h3>
          <p className="text-base text-gray-600 mt-0.5">
            <span className="font-medium">{task.equipment_name}</span>
            {task.location && <span className="text-gray-400"> — {task.location}</span>}
          </p>
          <div className="flex items-center gap-3 mt-1">
            <p className="text-sm text-gray-400">
              <Clock size={12} className="inline mr-1" />
              Due {task.due_date}
              {task.assigned_to && <span> · {task.assigned_to}</span>}
            </p>
            {technicians && technicians.length > 0 && (
              <select
                value={task.assigned_to || ''}
                onChange={e => onAssign(task.id, e.target.value || null)}
                className="text-xs border border-gray-200 rounded-lg px-2 py-1 text-gray-600 bg-white"
              >
                <option value="">Assign to...</option>
                {technicians.map(t => (
                  <option key={t.id} value={t.name}>{t.name}</option>
                ))}
              </select>
            )}
          </div>

          {/* Expandable task steps */}
          {steps.length > 0 && (
            <div className="mt-3">
              <button onClick={() => setExpanded(!expanded)}
                className="text-sm text-powder-600 font-medium flex items-center gap-1 hover:text-powder-700">
                {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                {steps.length} step{steps.length > 1 ? 's' : ''} to complete
              </button>
              {expanded && (
                <ol className="mt-2 space-y-2 text-sm">
                  {steps.map((s, i) => (
                    <li key={i} className="flex items-start gap-3 bg-gray-50 rounded-lg p-3">
                      <span className="shrink-0 w-6 h-6 rounded-full bg-gray-200 text-gray-700 text-xs font-bold flex items-center justify-center">{i + 1}</span>
                      <span className="text-gray-700">{s}</span>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          )}

          {/* Inline completion form */}
          {completing && (
            <div className="mt-4 bg-green-50 rounded-xl p-4 space-y-3 border border-green-200">
              <p className="text-sm font-semibold text-green-800">Mark as Complete</p>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Your Name *</label>
                <input value={name} onChange={e => setName(e.target.value)} autoFocus
                  className="w-full px-4 py-3 border border-gray-300 rounded-xl text-base" placeholder="Enter your name" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Notes (optional)</label>
                <textarea value={notes} onChange={e => setNotes(e.target.value)}
                  className="w-full px-4 py-3 border border-gray-300 rounded-xl text-base" rows={2} placeholder="Any issues or notes..." />
              </div>
              <div className="flex gap-2">
                <button onClick={handleSubmit} disabled={saving || !name.trim()}
                  className="flex-1 py-3 bg-green-600 text-white rounded-xl text-base font-bold hover:bg-green-700 disabled:opacity-50 active:scale-[0.98] transition-transform">
                  {saving ? 'Saving...' : 'Complete Task'}
                </button>
                <button onClick={() => { setCompleting(false); setName(''); setNotes(''); }}
                  className="px-4 py-3 bg-gray-200 text-gray-700 rounded-xl text-base font-medium hover:bg-gray-300">
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function OperatorView() {
  const { data: tasks, loading, refresh } = useApiGet('/pm/operator-tasks');
  const { data: technicians } = useApiGet('/users/technicians');
  const [freqFilter, setFreqFilter] = useState('all');

  const handleComplete = async (woId, form) => {
    await apiPost(`/pm/work-orders/${woId}/complete-and-recur`, form);
    refresh();
  };

  const handleAssign = async (woId, assignedTo) => {
    await apiPut(`/pm/work-orders/${woId}`, { assigned_to: assignedTo });
    refresh();
  };

  const filtered = (tasks || []).filter(t => freqFilter === 'all' || t.frequency_type === freqFilter);

  const freqCounts = {};
  for (const t of (tasks || [])) {
    const f = t.frequency_type || 'other';
    freqCounts[f] = (freqCounts[f] || 0) + 1;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="h-10 w-10 bg-powder-600 rounded-xl flex items-center justify-center">
          <Wrench size={22} className="text-white" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">My Tasks</h1>
          <p className="text-sm text-gray-500">{filtered.length} task{filtered.length !== 1 ? 's' : ''} to complete</p>
        </div>
      </div>

      {/* Big frequency filter buttons */}
      <div className="flex gap-2 flex-wrap">
        <button onClick={() => setFreqFilter('all')}
          className={`px-4 py-2.5 rounded-xl text-sm font-bold transition-all ${freqFilter === 'all' ? 'bg-gray-800 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
          All ({(tasks || []).length})
        </button>
        {['daily', 'weekly', 'monthly', 'quarterly', 'annual'].map(f => freqCounts[f] ? (
          <button key={f} onClick={() => setFreqFilter(f)}
            className={`px-4 py-2.5 rounded-xl text-sm font-bold transition-all ${freqFilter === f ? `${FREQ_COLORS[f]} text-white` : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
            {f.charAt(0).toUpperCase() + f.slice(1)} ({freqCounts[f]})
          </button>
        ) : null)}
      </div>

      {/* Task list */}
      {loading ? (
        <div className="text-center py-16 text-gray-500 text-lg">Loading tasks...</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16">
          <CheckCircle size={48} className="mx-auto text-green-400 mb-3" />
          <p className="text-lg font-semibold text-gray-700">All caught up!</p>
          <p className="text-gray-500">No {freqFilter !== 'all' ? freqFilter + ' ' : ''}tasks pending.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map(task => (
            <TaskItem key={task.id} task={task} onComplete={handleComplete} onAssign={handleAssign} technicians={technicians || []} />
          ))}
        </div>
      )}
    </div>
  );
}
