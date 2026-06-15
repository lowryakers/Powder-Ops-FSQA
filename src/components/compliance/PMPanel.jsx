import { useState } from 'react';
import { useApiGet, apiPost, apiPut } from '../../hooks/useApi';
import { Plus, CheckCircle, Clock, Wrench, ChevronDown, ChevronUp, Archive, RotateCcw, Paperclip, Calendar, Download } from 'lucide-react';
import FileUpload from '../FileUpload';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, ReferenceLine } from 'recharts';
import { exportToCsv } from '../../utils/exportCsv';

const FREQ_TABS = [
  { value: 'all', label: 'All' },
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'quarterly', label: 'Quarterly' },
  { value: 'annual', label: 'Annual' },
];

const FREQ_COLORS = {
  daily: 'bg-blue-100 text-blue-800',
  weekly: 'bg-purple-100 text-purple-800',
  monthly: 'bg-amber-100 text-amber-800',
  quarterly: 'bg-emerald-100 text-emerald-800',
  semi_annual: 'bg-cyan-100 text-cyan-800',
  annual: 'bg-rose-100 text-rose-800',
  unscheduled: 'bg-gray-100 text-gray-600',
};

const STATUS_COLORS = {
  open: 'bg-yellow-100 text-yellow-800',
  in_progress: 'bg-blue-100 text-blue-800',
  completed: 'bg-green-100 text-green-800',
  overdue: 'bg-red-100 text-red-800',
  missed: 'bg-gray-200 text-gray-700',
};

function CompleteForm({ wo, onComplete, onCancel }) {
  const [form, setForm] = useState({ notes: '', lubricant_used: '', lubricant_is_food_grade: true, _actor: '' });
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try { await onComplete(wo.id, form); } finally { setSaving(false); }
  };

  return (
    <form onSubmit={handleSubmit} className="bg-green-50 rounded-lg border border-green-200 p-3 mt-2 space-y-2">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Completed By *</label>
          <input required value={form._actor} onChange={e => setForm({ ...form, _actor: e.target.value })}
            className="w-full px-2 py-1.5 border border-gray-300 rounded-lg text-sm" placeholder="Your name" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Lubricant Used</label>
          <input value={form.lubricant_used} onChange={e => setForm({ ...form, lubricant_used: e.target.value })}
            className="w-full px-2 py-1.5 border border-gray-300 rounded-lg text-sm" placeholder="e.g. NSF H1 Grease" />
        </div>
      </div>
      {form.lubricant_used && (
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={form.lubricant_is_food_grade} onChange={e => setForm({ ...form, lubricant_is_food_grade: e.target.checked })} />
          <span className="text-xs text-gray-700">Food-grade lubricant (NSF H1/H2)</span>
        </label>
      )}
      <div>
        <label className="block text-xs font-medium text-gray-700 mb-1">Notes</label>
        <textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })}
          className="w-full px-2 py-1.5 border border-gray-300 rounded-lg text-sm" rows={2} />
      </div>
      <div className="flex gap-2">
        <button type="submit" disabled={saving} className="px-3 py-1.5 bg-green-600 text-white rounded-lg text-xs font-medium hover:bg-green-700 disabled:opacity-50">
          {saving ? 'Saving...' : 'Complete & Generate Next'}
        </button>
        <button type="button" onClick={onCancel} className="px-3 py-1.5 bg-gray-100 text-gray-700 rounded-lg text-xs hover:bg-gray-200">Cancel</button>
      </div>
    </form>
  );
}

function WOForm({ equipment, technicians, onSave, onCancel }) {
  const [form, setForm] = useState({ equipment_id: '', title: '', description: '', priority: 'normal', assigned_to: '', due_date: '', attachments: [] });
  const [saving, setSaving] = useState(false);
  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try { await onSave(form); } finally { setSaving(false); }
  };

  return (
    <form onSubmit={handleSubmit} className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
      <h3 className="font-semibold text-gray-900">New Work Order</h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Equipment *</label>
          <select required value={form.equipment_id} onChange={e => setForm({ ...form, equipment_id: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
            <option value="">Select...</option>
            {(equipment || []).map(eq => <option key={eq.id} value={eq.id}>{eq.name} ({eq.location || 'No location'})</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Title *</label>
          <input required value={form.title} onChange={e => setForm({ ...form, title: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Due Date *</label>
          <input type="date" required value={form.due_date} onChange={e => setForm({ ...form, due_date: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Priority</label>
          <select value={form.priority} onChange={e => setForm({ ...form, priority: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
            <option value="low">Low</option>
            <option value="normal">Normal</option>
            <option value="high">High</option>
            <option value="critical">Critical</option>
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Assigned To</label>
          <select value={form.assigned_to} onChange={e => setForm({ ...form, assigned_to: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
            <option value="">Unassigned</option>
            {(technicians || []).map(t => <option key={t.id} value={t.name}>{t.name} ({t.role})</option>)}
          </select>
        </div>
      </div>
      <FileUpload files={form.attachments} onChange={attachments => setForm({ ...form, attachments })} />
      <div className="flex gap-2">
        <button type="submit" disabled={saving} className="px-4 py-2 bg-powder-600 text-white rounded-lg text-sm font-medium hover:bg-powder-700 disabled:opacity-50">
          {saving ? 'Creating...' : 'Create Work Order'}
        </button>
        <button type="button" onClick={onCancel} className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm hover:bg-gray-200">Cancel</button>
      </div>
    </form>
  );
}

function TaskCard({ wo, onStartComplete, completing, onComplete, onCancelComplete }) {
  const steps = wo.procedure_steps || [];
  const attachments = (() => { try { return JSON.parse(wo.attachments || '[]'); } catch { return []; } })();
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4">
      <div className="flex items-start justify-between">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${FREQ_COLORS[wo.frequency_type] || FREQ_COLORS.unscheduled}`}>
              {wo.frequency_type || 'ad-hoc'}
            </span>
            <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[wo.status]}`}>{wo.status}</span>
            {wo.priority === 'critical' && <span className="px-2 py-0.5 bg-red-100 text-red-800 rounded-full text-xs">Critical</span>}
            {wo.priority === 'high' && <span className="px-2 py-0.5 bg-orange-100 text-orange-800 rounded-full text-xs">High</span>}
            {attachments.length > 0 && <span className="flex items-center gap-0.5 px-2 py-0.5 bg-gray-100 text-gray-600 rounded-full text-xs"><Paperclip size={10} />{attachments.length}</span>}
          </div>
          <h4 className="font-medium text-gray-900 truncate">{wo.title}</h4>
          <p className="text-sm text-gray-500">{wo.equipment_name} — {wo.location || 'No location'}</p>
          <p className="text-xs text-gray-400 mt-0.5">Due: {wo.due_date}{wo.assigned_to ? ` · Assigned: ${wo.assigned_to}` : ''}</p>
        </div>
        <div className="flex gap-1 ml-2 shrink-0">
          {wo.status === 'open' && (
            <button onClick={() => onStartComplete(wo.id, 'start')}
              className="px-2 py-1 bg-blue-50 text-blue-700 rounded text-xs hover:bg-blue-100">Start</button>
          )}
          <button onClick={() => onStartComplete(wo.id, 'complete')}
            className="px-2 py-1 bg-green-50 text-green-700 rounded text-xs hover:bg-green-100 flex items-center gap-1">
            <CheckCircle size={12} /> Done
          </button>
        </div>
      </div>

      {steps.length > 0 && (
        <div className="mt-2">
          <button onClick={() => setExpanded(!expanded)} className="text-xs text-powder-600 hover:text-powder-700 flex items-center gap-1">
            {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
            {steps.length} task{steps.length > 1 ? 's' : ''}
          </button>
          {expanded && (
            <ul className="mt-1 space-y-1 text-xs text-gray-600 pl-4">
              {steps.map((s, i) => <li key={i} className="flex items-start gap-1.5"><span className="text-gray-400 mt-0.5">•</span><span>{s}</span></li>)}
            </ul>
          )}
        </div>
      )}

      {attachments.length > 0 && expanded && (
        <div className="mt-2 flex gap-2 flex-wrap">
          {attachments.map((a, i) => (
            <a key={i} href={a.url} target="_blank" rel="noopener noreferrer">
              {/\.(jpg|jpeg|png|gif|webp|heic)$/i.test(a.originalName || a.filename) ? (
                <img src={a.url} alt={a.originalName} className="h-20 w-20 object-cover rounded-lg border border-gray-200 hover:ring-2 hover:ring-powder-400" />
              ) : (
                <div className="h-20 w-20 rounded-lg border border-gray-200 flex flex-col items-center justify-center bg-gray-50 hover:ring-2 hover:ring-powder-400">
                  <Paperclip size={16} className="text-gray-400" />
                  <span className="text-[9px] text-gray-500 truncate w-16 text-center mt-1">{a.originalName || a.filename}</span>
                </div>
              )}
            </a>
          ))}
        </div>
      )}

      {completing === wo.id && (
        <CompleteForm wo={wo} onComplete={onComplete} onCancel={onCancelComplete} />
      )}
    </div>
  );
}

export default function PMPanel() {
  const { data: metrics, loading: metricsLoading } = useApiGet('/pm/metrics');
  const { data: grouped, loading: taskLoading, refresh: refreshTasks } = useApiGet('/pm/by-frequency');
  const { data: equipment } = useApiGet('/equipment');
  const { data: technicians } = useApiGet('/users/technicians');
  const [freqFilter, setFreqFilter] = useState('all');
  const [showWOForm, setShowWOForm] = useState(false);
  const [completing, setCompleting] = useState(null);
  const [view, setView] = useState('active');
  const [archiveData, setArchiveData] = useState(null);
  const [archiveLoading, setArchiveLoading] = useState(false);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const handleCreateWO = async (form) => {
    await apiPost('/pm/work-orders', form);
    setShowWOForm(false);
    refreshTasks();
  };

  const handleStartWO = async (woId, action) => {
    if (action === 'start') {
      await apiPut(`/pm/work-orders/${woId}`, { status: 'in_progress' });
      refreshTasks();
    } else {
      setCompleting(completing === woId ? null : woId);
    }
  };

  const handleComplete = async (woId, form) => {
    await apiPost(`/pm/work-orders/${woId}/complete-and-recur`, form);
    setCompleting(null);
    refreshTasks();
  };

  const loadArchive = async (freq, from, to) => {
    setArchiveLoading(true);
    try {
      const params = new URLSearchParams({ limit: '50' });
      if (freq && freq !== 'all') params.set('frequency', freq);
      if (from) params.set('from', from);
      if (to) params.set('to', to);
      const res = await fetch(`/api/pm/completed-history?${params}`);
      const data = await res.json();
      setArchiveData(data);
    } finally { setArchiveLoading(false); }
  };

  const handleViewChange = (v) => {
    setView(v);
    if (v === 'completed') loadArchive(freqFilter, dateFrom, dateTo);
  };

  const freqOrder = ['daily', 'weekly', 'monthly', 'quarterly', 'semi_annual', 'annual', 'unscheduled'];
  const filteredGroups = grouped ? freqOrder
    .filter(f => grouped[f]?.length > 0)
    .filter(f => freqFilter === 'all' || f === freqFilter)
    .map(f => ({ freq: f, items: grouped[f] })) : [];

  const totalActive = filteredGroups.reduce((sum, g) => sum + g.items.length, 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-xl font-bold text-gray-900">Preventive Maintenance</h2>
        <button onClick={() => setShowWOForm(true)}
          className="flex items-center gap-1 px-3 py-2 bg-powder-600 text-white rounded-lg text-sm font-medium hover:bg-powder-700">
          <Plus size={16} /> New Work Order
        </button>
      </div>

      {/* Metrics */}
      {!metricsLoading && metrics && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <div className={`rounded-xl border p-4 ${metrics.meets_sqf_target ? 'border-green-200 bg-green-50' : 'border-red-200 bg-red-50'}`}>
            <p className="text-xs text-gray-600 mb-1">Completion Rate</p>
            <p className="text-2xl font-bold">{metrics.completion_rate}%</p>
            <p className="text-xs mt-1">{metrics.meets_sqf_target ? 'SQF Target Met' : 'Below 95% Target'}</p>
          </div>
          <div className="rounded-xl border border-gray-200 bg-white p-4">
            <p className="text-xs text-gray-600 mb-1">Total WOs</p>
            <p className="text-2xl font-bold">{metrics.total}</p>
          </div>
          <div className="rounded-xl border border-gray-200 bg-white p-4">
            <p className="text-xs text-gray-600 mb-1">Open</p>
            <p className="text-2xl font-bold text-yellow-600">{metrics.open}</p>
          </div>
          <div className={`rounded-xl border p-4 ${metrics.missed > 0 ? 'border-gray-300 bg-gray-50' : 'border-gray-200 bg-white'}`}>
            <p className="text-xs text-gray-600 mb-1">Missed</p>
            <p className="text-2xl font-bold text-gray-600">{metrics.missed}</p>
          </div>
          <div className={`rounded-xl border p-4 ${metrics.overdue > 0 ? 'border-red-200 bg-red-50' : 'border-gray-200 bg-white'}`}>
            <p className="text-xs text-gray-600 mb-1">Overdue</p>
            <p className="text-2xl font-bold text-red-600">{metrics.overdue}</p>
          </div>
        </div>
      )}

      {/* Trend Chart */}
      {metrics?.monthly_trend?.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <h3 className="text-sm font-semibold text-gray-900 mb-3">Monthly PM Completion Trend</h3>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={metrics.monthly_trend}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="month" tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 12 }} />
              <Tooltip />
              <ReferenceLine y={95} stroke="#e03131" strokeDasharray="3 3" label={{ value: '95% SQF', position: 'right', fontSize: 10 }} />
              <Bar dataKey="completed" name="Completed" fill="#40c057" />
              <Bar dataKey="missed" name="Missed" fill="#868e96" />
              <Bar dataKey="total" name="Total" fill="#dee2e6" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {showWOForm && <WOForm equipment={equipment} technicians={technicians} onSave={handleCreateWO} onCancel={() => setShowWOForm(false)} />}

      {/* View Toggle + Frequency Filter */}
      <div className="space-y-2">
        <div className="flex gap-2">
          <button onClick={() => handleViewChange('active')}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium flex items-center gap-1 ${view === 'active' ? 'bg-powder-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
            <Wrench size={14} /> Active ({totalActive})
          </button>
          <button onClick={() => handleViewChange('completed')}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium flex items-center gap-1 ${view === 'completed' ? 'bg-powder-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
            <Archive size={14} /> Completed
          </button>
        </div>
        <div className="flex gap-1 flex-wrap">
          {FREQ_TABS.map(f => {
            const count = f.value === 'all'
              ? Object.values(grouped || {}).reduce((s, arr) => s + arr.length, 0)
              : (grouped?.[f.value]?.length || 0);
            return (
              <button key={f.value} onClick={() => { setFreqFilter(f.value); if (view === 'completed') loadArchive(f.value, dateFrom, dateTo); }}
                className={`px-2.5 py-1 rounded-md text-xs font-medium ${freqFilter === f.value ? 'bg-gray-800 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
                {f.label} {view === 'active' && count > 0 ? `(${count})` : ''}
              </button>
            );
          })}
        </div>
      </div>

      {/* Active Tasks by Frequency */}
      {view === 'active' && (
        <div className="space-y-6">
          {taskLoading ? (
            <div className="text-center py-8 text-gray-500">Loading PM tasks...</div>
          ) : filteredGroups.length === 0 ? (
            <div className="text-center py-8 text-gray-500">No active PM tasks{freqFilter !== 'all' ? ` for ${freqFilter}` : ''}</div>
          ) : filteredGroups.map(({ freq, items }) => (
            <div key={freq}>
              <div className="flex items-center gap-2 mb-3">
                <span className={`px-3 py-1 rounded-full text-sm font-semibold ${FREQ_COLORS[freq]}`}>
                  {freq.charAt(0).toUpperCase() + freq.slice(1).replace('_', '-')}
                </span>
                <span className="text-sm text-gray-500">{items.length} task{items.length > 1 ? 's' : ''}</span>
              </div>
              <div className="space-y-2">
                {items.map(wo => (
                  <TaskCard key={wo.id} wo={wo} completing={completing}
                    onStartComplete={handleStartWO} onComplete={handleComplete}
                    onCancelComplete={() => setCompleting(null)} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Completed Archive */}
      {view === 'completed' && (
        <div className="space-y-3">
          <div className="flex items-end gap-3 flex-wrap bg-white rounded-xl border border-gray-200 p-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">From</label>
              <input type="date" value={dateFrom} onChange={e => { setDateFrom(e.target.value); loadArchive(freqFilter, e.target.value, dateTo); }}
                className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">To</label>
              <input type="date" value={dateTo} onChange={e => { setDateTo(e.target.value); loadArchive(freqFilter, dateFrom, e.target.value); }}
                className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm" />
            </div>
            {(dateFrom || dateTo) && (
              <button onClick={() => { setDateFrom(''); setDateTo(''); loadArchive(freqFilter, '', ''); }}
                className="px-3 py-1.5 text-xs text-gray-600 hover:text-gray-900 bg-gray-100 rounded-lg">Clear dates</button>
            )}
            <div className="ml-auto">
              <button onClick={() => {
                if (!archiveData?.items?.length) return;
                exportToCsv(`pm-history-${new Date().toISOString().split('T')[0]}.csv`, [
                  { label: 'Status', value: r => r.status },
                  { label: 'Title', value: r => r.title || r.pm_title },
                  { label: 'Equipment', value: r => r.equipment_name },
                  { label: 'Location', value: r => r.location },
                  { label: 'Frequency', value: r => r.frequency_type || 'ad-hoc' },
                  { label: 'Due Date', value: r => r.due_date },
                  { label: 'Completed At', value: r => r.completed_at || '' },
                  { label: 'Completed By', value: r => r.completed_by || '' },
                  { label: 'Assigned To', value: r => r.assigned_to || '' },
                  { label: 'Priority', value: r => r.priority },
                  { label: 'Notes', value: r => r.notes || '' },
                ], archiveData.items);
              }} className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200">
                <Download size={14} /> Export CSV
              </button>
            </div>
          </div>

          {archiveLoading ? (
            <div className="text-center py-8 text-gray-500">Loading completed tasks...</div>
          ) : !archiveData?.items?.length ? (
            <div className="text-center py-8 text-gray-500">No completed tasks{dateFrom || dateTo ? ' in selected date range' : ' yet'}</div>
          ) : (
            <>
              <div className="flex items-center gap-3 flex-wrap">
                <p className="text-sm text-gray-500">{archiveData.total} task{archiveData.total !== 1 ? 's' : ''}{dateFrom || dateTo ? ' (filtered)' : ''}</p>
                {archiveData.missed_count > 0 && (
                  <span className="text-xs px-2 py-0.5 bg-gray-200 text-gray-700 rounded-full font-medium">{archiveData.missed_count} missed total</span>
                )}
              </div>
              {archiveData.items.map(wo => {
                const isMissed = wo.status === 'missed';
                return (
                  <div key={wo.id} className={`rounded-xl border p-4 ${isMissed ? 'bg-gray-50 border-gray-300' : 'bg-white border-gray-200 opacity-80'}`}>
                    <div className="flex items-center gap-2 mb-1">
                      {isMissed ? (
                        <span className="px-2 py-0.5 bg-gray-200 text-gray-700 rounded-full text-xs font-semibold">MISSED</span>
                      ) : (
                        <CheckCircle size={14} className="text-green-600" />
                      )}
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${FREQ_COLORS[wo.frequency_type] || FREQ_COLORS.unscheduled}`}>
                        {wo.frequency_type || 'ad-hoc'}
                      </span>
                    </div>
                    <h4 className={`font-medium ${isMissed ? 'text-gray-600' : 'text-gray-700'}`}>{wo.title || wo.pm_title}</h4>
                    <p className="text-sm text-gray-500">{wo.equipment_name} — {wo.location}</p>
                    {isMissed ? (
                      <p className="text-xs text-gray-500 mt-1">Due: {wo.due_date}{wo.assigned_to ? ` · Assigned: ${wo.assigned_to}` : ''}</p>
                    ) : (
                      <p className="text-xs text-green-600 mt-1">
                        Completed {new Date(wo.completed_at).toLocaleString()} by {wo.completed_by}
                      </p>
                    )}
                    {wo.notes && <p className="text-xs text-gray-500 mt-1">Notes: {wo.notes}</p>}
                  </div>
                );
              })}
            </>
          )}
        </div>
      )}
    </div>
  );
}
