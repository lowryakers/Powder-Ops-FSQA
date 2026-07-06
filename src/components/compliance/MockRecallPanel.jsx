import { useState, useMemo } from 'react';
import { useApiGet, apiPost, apiPut } from '../../hooks/useApi';
import { Plus, Edit2, ChevronDown, ChevronUp, Package, Clock } from 'lucide-react';

const RESULT_COLORS = {
  pending: 'bg-yellow-100 text-yellow-800',
  pass: 'bg-green-100 text-green-800',
  fail: 'bg-red-100 text-red-800',
  conditional: 'bg-orange-100 text-orange-800',
};

function RecallForm({ initial, onSave, onCancel }) {
  const [form, setForm] = useState(initial || {
    date_initiated: new Date().toISOString().split('T')[0], product_name: '', lot_number: '',
    reason: '', initiated_by: '', scope: 'internal', quantity_produced: '', quantity_distributed: '',
    quantity_recovered: '', distribution_list: '', time_to_notify_minutes: '', time_to_complete_minutes: '',
    accounts_contacted: '', accounts_responded: '', effectiveness_pct: '', result: 'pending',
    corrective_actions: '', notes: '',
  });
  const [saving, setSaving] = useState(false);
  const set = (k, v) => setForm({ ...form, [k]: v });

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try { await onSave(form); } finally { setSaving(false); }
  };

  return (
    <form onSubmit={handleSubmit} className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
      <h3 className="font-semibold text-gray-900">{initial?.id ? 'Edit Mock Recall' : 'Start Mock Recall Exercise'}</h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Date Initiated *</label>
          <input type="date" required value={form.date_initiated} onChange={e => set('date_initiated', e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Product Name *</label>
          <input required value={form.product_name} onChange={e => set('product_name', e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Lot Number *</label>
          <input required value={form.lot_number} onChange={e => set('lot_number', e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Reason *</label>
          <input required value={form.reason} onChange={e => set('reason', e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" placeholder="e.g. Foreign material detected" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Initiated By</label>
          <input value={form.initiated_by || ''} onChange={e => set('initiated_by', e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Scope</label>
          <select value={form.scope} onChange={e => set('scope', e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
            <option value="internal">Internal</option>
            <option value="customer">Customer Level</option>
            <option value="public">Public</option>
          </select>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 p-3 bg-gray-50 rounded-lg border border-gray-200">
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Qty Produced</label>
          <input value={form.quantity_produced || ''} onChange={e => set('quantity_produced', e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Qty Distributed</label>
          <input value={form.quantity_distributed || ''} onChange={e => set('quantity_distributed', e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Qty Recovered</label>
          <input value={form.quantity_recovered || ''} onChange={e => set('quantity_recovered', e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
        </div>
      </div>

      <div>
        <label className="block text-xs font-medium text-gray-700 mb-1">Distribution List</label>
        <textarea value={form.distribution_list || ''} onChange={e => set('distribution_list', e.target.value)}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" rows={2} placeholder="Customers/facilities that received product" />
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-3 bg-blue-50 rounded-lg border border-blue-200">
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Time to Notify (min)</label>
          <input type="number" value={form.time_to_notify_minutes || ''} onChange={e => set('time_to_notify_minutes', e.target.value ? parseInt(e.target.value) : '')}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Time to Complete (min)</label>
          <input type="number" value={form.time_to_complete_minutes || ''} onChange={e => set('time_to_complete_minutes', e.target.value ? parseInt(e.target.value) : '')}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Accounts Contacted</label>
          <input type="number" value={form.accounts_contacted || ''} onChange={e => set('accounts_contacted', e.target.value ? parseInt(e.target.value) : '')}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Accounts Responded</label>
          <input type="number" value={form.accounts_responded || ''} onChange={e => set('accounts_responded', e.target.value ? parseInt(e.target.value) : '')}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Effectiveness (%)</label>
          <input type="number" min="0" max="100" value={form.effectiveness_pct || ''} onChange={e => set('effectiveness_pct', e.target.value ? parseFloat(e.target.value) : '')}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Result</label>
          <select value={form.result} onChange={e => set('result', e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
            <option value="pending">Pending</option>
            <option value="pass">Pass</option>
            <option value="fail">Fail</option>
            <option value="conditional">Conditional</option>
          </select>
        </div>
      </div>

      <div>
        <label className="block text-xs font-medium text-gray-700 mb-1">Corrective Actions</label>
        <textarea value={form.corrective_actions || ''} onChange={e => set('corrective_actions', e.target.value)}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" rows={2} />
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-700 mb-1">Notes</label>
        <textarea value={form.notes || ''} onChange={e => set('notes', e.target.value)}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" rows={2} />
      </div>

      <div className="flex gap-2">
        <button type="submit" disabled={saving} className="px-4 py-2 bg-powder-600 text-white rounded-lg text-sm font-medium hover:bg-powder-700 disabled:opacity-50">
          {saving ? 'Saving...' : initial?.id ? 'Update' : 'Start Recall'}
        </button>
        <button type="button" onClick={onCancel} className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm hover:bg-gray-200">Cancel</button>
      </div>
    </form>
  );
}

export default function MockRecallPanel() {
  const { data: recalls, loading, refresh } = useApiGet('/mock-recalls');
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [expanded, setExpanded] = useState(null);

  const stats = useMemo(() => {
    const list = recalls || [];
    return {
      total: list.length,
      passed: list.filter(r => r.result === 'pass').length,
      failed: list.filter(r => r.result === 'fail').length,
      pending: list.filter(r => r.result === 'pending').length,
      avgTime: list.filter(r => r.time_to_complete_minutes).length > 0
        ? Math.round(list.filter(r => r.time_to_complete_minutes).reduce((a, r) => a + r.time_to_complete_minutes, 0) / list.filter(r => r.time_to_complete_minutes).length)
        : null,
    };
  }, [recalls]);

  const handleCreate = async (form) => {
    await apiPost('/mock-recalls', form);
    setShowForm(false);
    refresh();
  };

  const handleUpdate = async (form) => {
    await apiPut(`/mock-recalls/${editing.id}`, form);
    setEditing(null);
    refresh();
  };

  if (loading) return <div className="text-center py-12 text-gray-500">Loading...</div>;

  return (
    <div className="space-y-6">
      {/* Info Banner */}
      <div className="bg-purple-50 border border-purple-200 rounded-xl p-4">
        <h3 className="font-semibold text-purple-900 text-sm">Mock Recall Exercises</h3>
        <p className="text-xs text-purple-700 mt-1">SQF requires annual mock recall exercises to verify traceability. Track product, lot, distribution, response times, and effectiveness. Target: 100% traceability within 4 hours.</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <div className="bg-white rounded-xl border p-3 text-center">
          <div className="text-2xl font-bold text-gray-900">{stats.total}</div>
          <div className="text-xs text-gray-500">Total Exercises</div>
        </div>
        <div className="bg-white rounded-xl border p-3 text-center">
          <div className="text-2xl font-bold text-green-600">{stats.passed}</div>
          <div className="text-xs text-gray-500">Passed</div>
        </div>
        <div className="bg-white rounded-xl border p-3 text-center">
          <div className={`text-2xl font-bold ${stats.failed > 0 ? 'text-red-600' : 'text-gray-400'}`}>{stats.failed}</div>
          <div className="text-xs text-gray-500">Failed</div>
        </div>
        <div className="bg-white rounded-xl border p-3 text-center">
          <div className="text-2xl font-bold text-yellow-600">{stats.pending}</div>
          <div className="text-xs text-gray-500">Pending</div>
        </div>
        <div className="bg-white rounded-xl border p-3 text-center">
          <div className="text-2xl font-bold text-blue-600">{stats.avgTime ? `${stats.avgTime}m` : '—'}</div>
          <div className="text-xs text-gray-500">Avg Time</div>
        </div>
      </div>

      {/* Controls */}
      <div className="flex items-center justify-end">
        <button onClick={() => { setShowForm(true); setEditing(null); }}
          className="flex items-center gap-1 px-3 py-2 bg-powder-600 text-white rounded-lg text-sm font-medium hover:bg-powder-700">
          <Plus size={16} /> Start Mock Recall
        </button>
      </div>

      {showForm && !editing && <RecallForm onSave={handleCreate} onCancel={() => setShowForm(false)} />}
      {editing && <RecallForm initial={editing} onSave={handleUpdate} onCancel={() => setEditing(null)} />}

      {/* Recall List */}
      <div className="space-y-2">
        {(recalls || []).map(r => (
          <div key={r.id} className="bg-white rounded-xl border border-gray-200">
            <div className="px-4 py-3 flex items-center justify-between cursor-pointer" onClick={() => setExpanded(expanded === r.id ? null : r.id)}>
              <div className="flex items-center gap-3 min-w-0">
                <span className="text-sm font-mono font-bold text-purple-700">{r.recall_number}</span>
                <span className="text-sm font-medium text-gray-900">{r.product_name}</span>
                <span className="text-xs text-gray-400">Lot: {r.lot_number}</span>
                <span className="text-xs text-gray-400">{r.date_initiated}</span>
              </div>
              <div className="flex items-center gap-2">
                {r.time_to_complete_minutes && (
                  <span className="flex items-center gap-1 text-xs text-gray-500"><Clock size={12} /> {r.time_to_complete_minutes}m</span>
                )}
                {r.effectiveness_pct != null && (
                  <span className={`text-xs font-bold ${r.effectiveness_pct >= 100 ? 'text-green-600' : 'text-orange-600'}`}>{r.effectiveness_pct}%</span>
                )}
                <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${RESULT_COLORS[r.result]}`}>{r.result}</span>
                <button onClick={e => { e.stopPropagation(); setEditing(r); setShowForm(false); }} className="text-gray-400 hover:text-powder-600">
                  <Edit2 size={14} />
                </button>
                {expanded === r.id ? <ChevronUp size={16} className="text-gray-400" /> : <ChevronDown size={16} className="text-gray-400" />}
              </div>
            </div>
            {expanded === r.id && (
              <div className="px-4 pb-4 border-t border-gray-100 pt-3 space-y-2">
                <div><span className="text-xs font-medium text-gray-500">Reason:</span> <span className="text-sm text-gray-800">{r.reason}</span></div>
                <div><span className="text-xs font-medium text-gray-500">Scope:</span> <span className="text-sm text-gray-800">{r.scope}</span></div>
                {r.initiated_by && <div><span className="text-xs font-medium text-gray-500">Initiated By:</span> <span className="text-sm text-gray-800">{r.initiated_by}</span></div>}
                <div className="grid grid-cols-3 gap-3 p-2 bg-gray-50 rounded-lg text-xs">
                  <div><span className="text-gray-500">Produced:</span> <span className="font-medium">{r.quantity_produced || '—'}</span></div>
                  <div><span className="text-gray-500">Distributed:</span> <span className="font-medium">{r.quantity_distributed || '—'}</span></div>
                  <div><span className="text-gray-500">Recovered:</span> <span className="font-medium">{r.quantity_recovered || '—'}</span></div>
                </div>
                {r.distribution_list && <div><span className="text-xs font-medium text-gray-500">Distribution:</span> <span className="text-sm text-gray-800">{r.distribution_list}</span></div>}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-2 bg-blue-50 rounded-lg text-xs">
                  <div><span className="text-gray-500">Time to Notify:</span> <span className="font-medium">{r.time_to_notify_minutes ? `${r.time_to_notify_minutes} min` : '—'}</span></div>
                  <div><span className="text-gray-500">Time to Complete:</span> <span className="font-medium">{r.time_to_complete_minutes ? `${r.time_to_complete_minutes} min` : '—'}</span></div>
                  <div><span className="text-gray-500">Contacted:</span> <span className="font-medium">{r.accounts_contacted ?? '—'}</span></div>
                  <div><span className="text-gray-500">Responded:</span> <span className="font-medium">{r.accounts_responded ?? '—'}</span></div>
                </div>
                {r.corrective_actions && <div><span className="text-xs font-medium text-gray-500">Corrective Actions:</span> <span className="text-sm text-gray-800">{r.corrective_actions}</span></div>}
                {r.notes && <div><span className="text-xs font-medium text-gray-500">Notes:</span> <span className="text-sm text-gray-800">{r.notes}</span></div>}
              </div>
            )}
          </div>
        ))}
        {(!recalls || recalls.length === 0) && (
          <div className="text-center py-12 text-gray-500">
            <Package size={32} className="mx-auto mb-3 text-gray-300" />
            <p className="text-sm">No mock recall exercises yet. SQF requires at least one per year.</p>
          </div>
        )}
      </div>
    </div>
  );
}
