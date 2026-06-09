import { useState } from 'react';
import { useApiGet, apiPost, apiPut } from '../../hooks/useApi';
import { Plus, CheckCircle, AlertTriangle, Clock, Wrench, ChevronDown, ChevronUp } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, ReferenceLine } from 'recharts';

const FREQ_OPTIONS = [
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'biweekly', label: 'Bi-Weekly' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'quarterly', label: 'Quarterly' },
  { value: 'semi_annual', label: 'Semi-Annual' },
  { value: 'annual', label: 'Annual' },
];

const STATUS_COLORS = {
  open: 'bg-yellow-100 text-yellow-800',
  in_progress: 'bg-blue-100 text-blue-800',
  completed: 'bg-green-100 text-green-800',
  overdue: 'bg-red-100 text-red-800',
  missed: 'bg-gray-100 text-gray-600',
  cancelled: 'bg-gray-100 text-gray-400',
};

function WOForm({ equipment, onSave, onCancel }) {
  const [form, setForm] = useState({ equipment_id: '', title: '', description: '', priority: 'normal', assigned_to: '', due_date: '' });
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
            {(equipment || []).map(eq => <option key={eq.id} value={eq.id}>{eq.name} ({eq.room || 'No room'})</option>)}
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
          <input value={form.assigned_to} onChange={e => setForm({ ...form, assigned_to: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" placeholder="Technician name" />
        </div>
      </div>
      <div className="flex gap-2">
        <button type="submit" disabled={saving} className="px-4 py-2 bg-powder-600 text-white rounded-lg text-sm font-medium hover:bg-powder-700 disabled:opacity-50">
          {saving ? 'Creating...' : 'Create Work Order'}
        </button>
        <button type="button" onClick={onCancel} className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm hover:bg-gray-200">Cancel</button>
      </div>
    </form>
  );
}

function CompleteWOForm({ wo, onSave, onCancel }) {
  const [form, setForm] = useState({ notes: '', lubricant_used: '', lubricant_is_food_grade: true, _actor: '' });
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await onSave({
        status: 'completed',
        notes: form.notes,
        lubricant_used: form.lubricant_used || null,
        lubricant_is_food_grade: form.lubricant_used ? form.lubricant_is_food_grade : null,
        _actor: form._actor,
      });
    } finally { setSaving(false); }
  };

  return (
    <form onSubmit={handleSubmit} className="bg-green-50 rounded-lg border border-green-200 p-3 mt-2 space-y-2">
      <p className="text-sm font-medium text-green-800">Complete: {wo.title}</p>
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
          <span className="text-xs text-gray-700">Food-grade lubricant (NSF H1/H2 certified)</span>
        </label>
      )}
      <div>
        <label className="block text-xs font-medium text-gray-700 mb-1">Notes</label>
        <textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })}
          className="w-full px-2 py-1.5 border border-gray-300 rounded-lg text-sm" rows={2} />
      </div>
      <div className="flex gap-2">
        <button type="submit" disabled={saving} className="px-3 py-1.5 bg-green-600 text-white rounded-lg text-xs font-medium hover:bg-green-700 disabled:opacity-50">
          {saving ? 'Saving...' : 'Mark Completed'}
        </button>
        <button type="button" onClick={onCancel} className="px-3 py-1.5 bg-gray-100 text-gray-700 rounded-lg text-xs hover:bg-gray-200">Cancel</button>
      </div>
    </form>
  );
}

export default function PMPanel() {
  const { data: metrics, loading: metricsLoading } = useApiGet('/pm/metrics');
  const { data: workOrders, loading: woLoading, refresh: refreshWOs } = useApiGet('/pm/work-orders');
  const { data: equipment } = useApiGet('/equipment');
  const [showWOForm, setShowWOForm] = useState(false);
  const [completing, setCompleting] = useState(null);
  const [view, setView] = useState('active');

  const handleCreateWO = async (form) => {
    await apiPost('/pm/work-orders', form);
    setShowWOForm(false);
    refreshWOs();
  };

  const handleCompleteWO = async (woId, form) => {
    await apiPut(`/pm/work-orders/${woId}`, form);
    setCompleting(null);
    refreshWOs();
  };

  const handleStartWO = async (woId) => {
    await apiPut(`/pm/work-orders/${woId}`, { status: 'in_progress' });
    refreshWOs();
  };

  const filteredWOs = (workOrders || []).filter(wo => {
    if (view === 'active') return ['open', 'in_progress', 'overdue'].includes(wo.status);
    if (view === 'completed') return wo.status === 'completed';
    return true;
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-gray-900">Preventive Maintenance</h2>
        <button onClick={() => setShowWOForm(true)}
          className="flex items-center gap-1 px-3 py-2 bg-powder-600 text-white rounded-lg text-sm font-medium hover:bg-powder-700">
          <Plus size={16} /> New Work Order
        </button>
      </div>

      {/* PM Metrics */}
      {!metricsLoading && metrics && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className={`rounded-xl border p-4 ${metrics.meets_sqf_target ? 'border-green-200 bg-green-50' : 'border-red-200 bg-red-50'}`}>
            <p className="text-xs text-gray-600 mb-1">Completion Rate</p>
            <p className="text-2xl font-bold">{metrics.completion_rate}%</p>
            <p className="text-xs mt-1">{metrics.meets_sqf_target ? 'SQF Target Met' : 'Below 95% Target'}</p>
          </div>
          <div className="rounded-xl border border-gray-200 bg-white p-4">
            <p className="text-xs text-gray-600 mb-1">Total WOs</p>
            <p className="text-2xl font-bold">{metrics.total}</p>
            <p className="text-xs text-gray-500 mt-1">{metrics.period.from} to {metrics.period.to}</p>
          </div>
          <div className="rounded-xl border border-gray-200 bg-white p-4">
            <p className="text-xs text-gray-600 mb-1">Open</p>
            <p className="text-2xl font-bold text-yellow-600">{metrics.open}</p>
          </div>
          <div className={`rounded-xl border p-4 ${metrics.overdue > 0 ? 'border-red-200 bg-red-50' : 'border-gray-200 bg-white'}`}>
            <p className="text-xs text-gray-600 mb-1">Overdue</p>
            <p className="text-2xl font-bold text-red-600">{metrics.overdue}</p>
          </div>
        </div>
      )}

      {/* Monthly Trend Chart */}
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
              <Bar dataKey="total" name="Total" fill="#dee2e6" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {showWOForm && <WOForm equipment={equipment} onSave={handleCreateWO} onCancel={() => setShowWOForm(false)} />}

      {/* Filter Tabs */}
      <div className="flex gap-2">
        {['active', 'completed', 'all'].map(v => (
          <button key={v} onClick={() => setView(v)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium ${view === v ? 'bg-powder-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
            {v.charAt(0).toUpperCase() + v.slice(1)}
          </button>
        ))}
      </div>

      {/* Work Orders List */}
      <div className="space-y-2">
        {woLoading ? (
          <div className="text-center py-8 text-gray-500">Loading work orders...</div>
        ) : filteredWOs.length === 0 ? (
          <div className="text-center py-8 text-gray-500">No work orders found</div>
        ) : filteredWOs.map(wo => (
          <div key={wo.id} className="bg-white rounded-xl border border-gray-200 p-4">
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[wo.status]}`}>{wo.status}</span>
                  {wo.priority === 'critical' && <span className="px-2 py-0.5 bg-red-100 text-red-800 rounded-full text-xs">Critical</span>}
                  {wo.priority === 'high' && <span className="px-2 py-0.5 bg-orange-100 text-orange-800 rounded-full text-xs">High</span>}
                </div>
                <h4 className="font-medium text-gray-900">{wo.title}</h4>
                <p className="text-sm text-gray-500">{wo.equipment_name} {wo.room ? `(${wo.room})` : ''}</p>
                <div className="flex gap-4 mt-1 text-xs text-gray-500">
                  <span>Due: {wo.due_date}</span>
                  {wo.assigned_to && <span>Assigned: {wo.assigned_to}</span>}
                  {wo.pm_title && <span>PM: {wo.pm_title} ({wo.frequency_type})</span>}
                </div>
                {wo.completed_at && (
                  <p className="text-xs text-green-600 mt-1">Completed {new Date(wo.completed_at).toLocaleString()} by {wo.completed_by}</p>
                )}
                {wo.lubricant_used && (
                  <p className="text-xs mt-1">
                    Lubricant: {wo.lubricant_used} {wo.lubricant_is_food_grade ? '(Food-Grade)' : '(NOT food-grade)'}
                  </p>
                )}
              </div>
              {wo.status !== 'completed' && wo.status !== 'cancelled' && (
                <div className="flex gap-1">
                  {wo.status === 'open' && (
                    <button onClick={() => handleStartWO(wo.id)}
                      className="px-2 py-1 bg-blue-50 text-blue-700 rounded text-xs hover:bg-blue-100">Start</button>
                  )}
                  <button onClick={() => setCompleting(completing === wo.id ? null : wo.id)}
                    className="px-2 py-1 bg-green-50 text-green-700 rounded text-xs hover:bg-green-100">Complete</button>
                </div>
              )}
            </div>
            {completing === wo.id && (
              <CompleteWOForm wo={wo} onSave={(form) => handleCompleteWO(wo.id, form)} onCancel={() => setCompleting(null)} />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
