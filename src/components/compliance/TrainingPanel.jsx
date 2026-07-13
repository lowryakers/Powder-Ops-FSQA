import { useState, useMemo } from 'react';
import { useApiGet, apiPost, apiPut } from '../../hooks/useApi';
import { Plus, Edit2, Search, ExternalLink, CheckCircle } from 'lucide-react';

const STATUS_COLORS = {
  scheduled: 'bg-blue-100 text-blue-800',
  in_progress: 'bg-yellow-100 text-yellow-800',
  completed: 'bg-green-100 text-green-800',
  overdue: 'bg-red-100 text-red-800',
  failed: 'bg-red-100 text-red-800',
};

function TrainingForm({ initial, sops, onSave, onCancel }) {
  const [form, setForm] = useState(initial || {
    employee_name: '', employee_id: '', training_topic: '', sop_id: '', trainer: '',
    training_date: new Date().toISOString().split('T')[0], completion_date: '', status: 'scheduled',
    score: '', certificate_url: '', gdrive_url: '', notes: '',
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
      <h3 className="font-semibold text-gray-900">{initial?.id ? 'Edit Training Record' : 'Add Training Record'}</h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Employee Name *</label>
          <input required value={form.employee_name} onChange={e => set('employee_name', e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Employee ID</label>
          <input value={form.employee_id || ''} onChange={e => set('employee_id', e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Training Topic *</label>
          <input required value={form.training_topic} onChange={e => set('training_topic', e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Linked SOP</label>
          <select value={form.sop_id || ''} onChange={e => set('sop_id', e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
            <option value="">— None —</option>
            {(sops || []).map(s => <option key={s.id} value={s.id}>{s.doc_number} — {s.title}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Trainer</label>
          <input value={form.trainer || ''} onChange={e => set('trainer', e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Training Date *</label>
          <input type="date" required value={form.training_date} onChange={e => set('training_date', e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Completion Date</label>
          <input type="date" value={form.completion_date || ''} onChange={e => set('completion_date', e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Status</label>
          <select value={form.status} onChange={e => set('status', e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
            <option value="scheduled">Scheduled</option>
            <option value="in_progress">In Progress</option>
            <option value="completed">Completed</option>
            <option value="overdue">Overdue</option>
            <option value="failed">Failed</option>
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Score (%)</label>
          <input type="number" min="0" max="100" value={form.score || ''} onChange={e => set('score', e.target.value ? parseFloat(e.target.value) : '')}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3 bg-blue-50 rounded-lg border border-blue-200">
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Google Drive Record URL</label>
          <input value={form.gdrive_url || ''} onChange={e => set('gdrive_url', e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" placeholder="https://drive.google.com/..." />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Certificate URL</label>
          <input value={form.certificate_url || ''} onChange={e => set('certificate_url', e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
        </div>
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-700 mb-1">Notes</label>
        <textarea value={form.notes || ''} onChange={e => set('notes', e.target.value)}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" rows={2} />
      </div>
      <div className="flex gap-2">
        <button type="submit" disabled={saving} className="px-4 py-2 bg-powder-600 text-white rounded-lg text-sm font-medium hover:bg-powder-700 disabled:opacity-50">
          {saving ? 'Saving...' : initial?.id ? 'Update' : 'Add Record'}
        </button>
        <button type="button" onClick={onCancel} className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm hover:bg-gray-200">Cancel</button>
      </div>
    </form>
  );
}

export default function TrainingPanel() {
  const { data: records, loading, refresh } = useApiGet('/training');
  const { data: sops } = useApiGet('/documents?doc_type=sop');
  const { data: matrix, refresh: refreshMatrix } = useApiGet('/training/matrix');
  const [tab, setTab] = useState('records');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);

  const filtered = useMemo(() => {
    let list = records || [];
    if (search) {
      const s = search.toLowerCase();
      list = list.filter(r => r.employee_name.toLowerCase().includes(s) || r.training_topic.toLowerCase().includes(s) || (r.trainer || '').toLowerCase().includes(s));
    }
    if (statusFilter) list = list.filter(r => r.status === statusFilter);
    return list;
  }, [records, search, statusFilter]);

  const stats = useMemo(() => {
    const list = records || [];
    return {
      total: list.length,
      completed: list.filter(r => r.status === 'completed').length,
      overdue: list.filter(r => r.status === 'overdue').length,
      scheduled: list.filter(r => r.status === 'scheduled').length,
      employees: new Set(list.map(r => r.employee_name)).size,
    };
  }, [records]);

  const handleCreate = async (form) => {
    await apiPost('/training', form);
    setShowForm(false);
    refresh();
    refreshMatrix();
  };

  const handleUpdate = async (form) => {
    await apiPut(`/training/${editing.id}`, form);
    setEditing(null);
    refresh();
    refreshMatrix();
  };

  if (loading) return <div className="text-center py-12 text-gray-500">Loading...</div>;

  return (
    <div className="space-y-6">
      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <div className="bg-white rounded-xl border p-3 text-center">
          <div className="text-2xl font-bold text-gray-900">{stats.total}</div>
          <div className="text-xs text-gray-500">Total Records</div>
        </div>
        <div className="bg-white rounded-xl border p-3 text-center">
          <div className="text-2xl font-bold text-green-600">{stats.completed}</div>
          <div className="text-xs text-gray-500">Completed</div>
        </div>
        <div className="bg-white rounded-xl border p-3 text-center">
          <div className={`text-2xl font-bold ${stats.overdue > 0 ? 'text-red-600' : 'text-gray-400'}`}>{stats.overdue}</div>
          <div className="text-xs text-gray-500">Overdue</div>
        </div>
        <div className="bg-white rounded-xl border p-3 text-center">
          <div className="text-2xl font-bold text-blue-600">{stats.scheduled}</div>
          <div className="text-xs text-gray-500">Scheduled</div>
        </div>
        <div className="bg-white rounded-xl border p-3 text-center">
          <div className="text-2xl font-bold text-purple-600">{stats.employees}</div>
          <div className="text-xs text-gray-500">Employees</div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
          <button onClick={() => setTab('records')} className={`px-4 py-1.5 rounded-md text-sm font-medium ${tab === 'records' ? 'bg-white shadow-sm text-gray-900' : 'text-gray-600'}`}>
            Records
          </button>
          <button onClick={() => setTab('matrix')} className={`px-4 py-1.5 rounded-md text-sm font-medium ${tab === 'matrix' ? 'bg-white shadow-sm text-gray-900' : 'text-gray-600'}`}>
            Training Matrix
          </button>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-2.5 text-gray-400" />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search..."
              className="pl-8 pr-3 py-2 border border-gray-300 rounded-lg text-sm w-48" />
          </div>
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm">
            <option value="">All Statuses</option>
            <option value="scheduled">Scheduled</option>
            <option value="in_progress">In Progress</option>
            <option value="completed">Completed</option>
            <option value="overdue">Overdue</option>
            <option value="failed">Failed</option>
          </select>
          <button onClick={() => { setShowForm(true); setEditing(null); }}
            className="flex items-center gap-1 px-3 py-2 bg-powder-600 text-white rounded-lg text-sm font-medium hover:bg-powder-700">
            <Plus size={16} /> Add Record
          </button>
        </div>
      </div>

      {showForm && !editing && <TrainingForm sops={sops} onSave={handleCreate} onCancel={() => setShowForm(false)} />}
      {editing && <TrainingForm initial={editing} sops={sops} onSave={handleUpdate} onCancel={() => setEditing(null)} />}

      {/* Records Table */}
      {tab === 'records' && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Employee</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Topic</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Trainer</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Date</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Status</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Score</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Links</th>
                <th className="text-right px-4 py-3 font-medium text-gray-600">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(r => (
                <tr key={r.id} className={`border-b border-gray-100 hover:bg-gray-50 ${r.status === 'overdue' ? 'bg-red-50' : ''}`}>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <span className="font-medium text-gray-900">{r.employee_name}</span>
                    {r.employee_id && <div className="text-[10px] text-gray-400">{r.employee_id}</div>}
                  </td>
                  <td className="px-4 py-3 w-full">
                    <span className="text-gray-800">{r.training_topic}</span>
                    {r.sop_title && <div className="text-[10px] text-gray-400">SOP: {r.sop_number}</div>}
                  </td>
                  <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{r.trainer || '—'}</td>
                  <td className="px-4 py-3 text-xs text-gray-500 whitespace-nowrap">{r.training_date}</td>
                  <td className="px-4 py-3 whitespace-nowrap"><span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[r.status]}`}>{r.status.replace('_', ' ')}</span></td>
                  <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{r.score != null ? `${r.score}%` : '—'}</td>
                  <td className="px-4 py-3">
                    {r.gdrive_url ? (
                      <a href={r.gdrive_url} target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:text-blue-700"><ExternalLink size={14} /></a>
                    ) : <span className="text-gray-300">—</span>}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button onClick={() => { setEditing(r); setShowForm(false); }} className="text-gray-400 hover:text-powder-600"><Edit2 size={14} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {filtered.length === 0 && <div className="text-center py-8 text-gray-500 text-sm">No training records found</div>}
        </div>
      )}

      {/* Training Matrix */}
      {tab === 'matrix' && matrix && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="text-left px-3 py-2 font-medium text-gray-600 sticky left-0 bg-gray-50 z-10">Employee</th>
                {(matrix.topics || []).map(t => (
                  <th key={t} className="text-center px-2 py-2 font-medium text-gray-600 min-w-[80px]">
                    <div className="truncate max-w-[100px]" title={t}>{t}</div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(matrix.employees || []).map(emp => (
                <tr key={emp} className="border-b border-gray-100 hover:bg-gray-50">
                  <td className="px-3 py-2 font-medium text-gray-900 sticky left-0 bg-white z-10 whitespace-nowrap">{emp}</td>
                  {(matrix.topics || []).map(topic => {
                    const cell = matrix.matrix?.[emp]?.[topic];
                    return (
                      <td key={topic} className="px-2 py-2 text-center">
                        {cell ? (
                          <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-bold ${STATUS_COLORS[cell.status]}`}>
                            {cell.status === 'completed' ? <CheckCircle size={12} className="inline" /> : cell.status}
                          </span>
                        ) : (
                          <span className="text-gray-300">—</span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          {(!matrix.employees || matrix.employees.length === 0) && (
            <div className="text-center py-8 text-gray-500 text-sm">No training data for matrix view yet</div>
          )}
        </div>
      )}
    </div>
  );
}
