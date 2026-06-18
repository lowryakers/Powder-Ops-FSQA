import { useState } from 'react';
import { useApiGet, apiPost, apiPut } from '../../hooks/useApi';
import { useAuth } from '../../hooks/useAuth';
import { Plus, Edit2, FlaskConical, ShieldCheck, AlertTriangle } from 'lucide-react';

const CATEGORIES = [
  { value: 'lubricant', label: 'Lubricant', color: 'bg-blue-100 text-blue-800' },
  { value: 'sanitizer', label: 'Sanitizer', color: 'bg-green-100 text-green-800' },
  { value: 'cleaner', label: 'Cleaner', color: 'bg-purple-100 text-purple-800' },
  { value: 'degreaser', label: 'Degreaser', color: 'bg-orange-100 text-orange-800' },
  { value: 'other', label: 'Other', color: 'bg-gray-100 text-gray-700' },
];

const catColor = (cat) => CATEGORIES.find(c => c.value === cat)?.color || 'bg-gray-100 text-gray-700';

function ChemicalForm({ initial, onSave, onCancel }) {
  const [form, setForm] = useState(initial || {
    name: '', category: 'sanitizer', manufacturer: '', product_code: '', sds_number: '',
    is_food_grade: false, nsf_rating: '', max_concentration: '', required_contact_time_minutes: '',
    review_due: '', notes: '',
  });
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try { await onSave({ ...form, is_food_grade: form.is_food_grade ? 1 : 0 }); } finally { setSaving(false); }
  };

  const set = (k, v) => setForm({ ...form, [k]: v });

  return (
    <form onSubmit={handleSubmit} className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
      <h3 className="font-semibold text-gray-900">{initial?.id ? 'Edit Chemical' : 'Add Approved Chemical'}</h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Name *</label>
          <input required value={form.name} onChange={e => set('name', e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" placeholder="e.g. Sani-512" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Category *</label>
          <select value={form.category} onChange={e => set('category', e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
            {CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Manufacturer</label>
          <input value={form.manufacturer || ''} onChange={e => set('manufacturer', e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Product Code</label>
          <input value={form.product_code || ''} onChange={e => set('product_code', e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">SDS Number</label>
          <input value={form.sds_number || ''} onChange={e => set('sds_number', e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" placeholder="Safety Data Sheet #" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">NSF Rating</label>
          <input value={form.nsf_rating || ''} onChange={e => set('nsf_rating', e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" placeholder="e.g. H1, 3H" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Max Concentration</label>
          <input value={form.max_concentration || ''} onChange={e => set('max_concentration', e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" placeholder="e.g. 200-250 ppm" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Contact Time (min)</label>
          <input type="number" value={form.required_contact_time_minutes || ''} onChange={e => set('required_contact_time_minutes', e.target.value ? parseInt(e.target.value) : '')}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Review Due Date</label>
          <input type="date" value={form.review_due || ''} onChange={e => set('review_due', e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
        </div>
      </div>
      <div className="flex items-center gap-4">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={!!form.is_food_grade} onChange={e => set('is_food_grade', e.target.checked)}
            className="rounded border-gray-300" />
          <span className="font-medium text-gray-700">Food-Grade Approved</span>
        </label>
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-700 mb-1">Notes</label>
        <textarea value={form.notes || ''} onChange={e => set('notes', e.target.value)} rows={2}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
      </div>
      <div className="flex gap-2">
        <button type="submit" disabled={saving} className="px-4 py-2 bg-powder-600 text-white rounded-lg text-sm font-medium hover:bg-powder-700 disabled:opacity-50">
          {saving ? 'Saving...' : initial?.id ? 'Update' : 'Add Chemical'}
        </button>
        <button type="button" onClick={onCancel} className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm hover:bg-gray-200">Cancel</button>
      </div>
    </form>
  );
}

export default function ChemicalsPanel() {
  const { user } = useAuth() || {};
  const isAdmin = user?.role === 'admin' || user?.role === 'supervisor';
  const { data: chemicals, loading, refresh } = useApiGet('/chemicals?active=false');
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [catFilter, setCatFilter] = useState('all');

  const handleCreate = async (form) => {
    await apiPost('/chemicals', { ...form, _actor: user?.name });
    setShowForm(false);
    refresh();
  };

  const handleUpdate = async (form) => {
    await apiPut(`/chemicals/${editing.id}`, { ...form, _actor: user?.name });
    setEditing(null);
    refresh();
  };

  const handleToggleActive = async (chem) => {
    await apiPut(`/chemicals/${chem.id}`, { is_active: !chem.is_active, _actor: user?.name });
    refresh();
  };

  const filtered = (chemicals || []).filter(c => catFilter === 'all' || c.category === catFilter);
  const today = new Date().toISOString().split('T')[0];

  if (loading) return <div className="text-center py-12 text-gray-500">Loading...</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-gray-900">Approved Chemicals Registry</h2>
          <p className="text-sm text-gray-500">Food-grade lubricants, sanitizers, and cleaners approved for use</p>
        </div>
        {isAdmin && (
          <button onClick={() => { setShowForm(true); setEditing(null); }}
            className="flex items-center gap-1 px-3 py-2 bg-powder-600 text-white rounded-lg text-sm font-medium hover:bg-powder-700">
            <Plus size={16} /> Add Chemical
          </button>
        )}
      </div>

      <div className="flex gap-1 flex-wrap">
        <button onClick={() => setCatFilter('all')}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium ${catFilter === 'all' ? 'bg-gray-800 text-white' : 'bg-gray-100 text-gray-600'}`}>
          All ({(chemicals || []).length})
        </button>
        {CATEGORIES.map(c => {
          const count = (chemicals || []).filter(ch => ch.category === c.value).length;
          return count > 0 ? (
            <button key={c.value} onClick={() => setCatFilter(c.value)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium ${catFilter === c.value ? 'bg-gray-800 text-white' : 'bg-gray-100 text-gray-600'}`}>
              {c.label} ({count})
            </button>
          ) : null;
        })}
      </div>

      {(showForm && !editing) && <ChemicalForm onSave={handleCreate} onCancel={() => setShowForm(false)} />}
      {editing && <ChemicalForm initial={editing} onSave={handleUpdate} onCancel={() => setEditing(null)} />}

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b">
            <tr>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Chemical</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Category</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">SDS #</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Food Grade</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Concentration</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Status</th>
              {isAdmin && <th className="text-right px-4 py-3 font-medium text-gray-600">Actions</th>}
            </tr>
          </thead>
          <tbody>
            {filtered.map(c => (
              <tr key={c.id} className={`border-b border-gray-100 hover:bg-gray-50 ${!c.is_active ? 'opacity-50' : ''}`}>
                <td className="px-4 py-3">
                  <div className="font-medium text-gray-900">{c.name}</div>
                  {c.manufacturer && <div className="text-xs text-gray-500">{c.manufacturer}{c.product_code ? ` — ${c.product_code}` : ''}</div>}
                </td>
                <td className="px-4 py-3">
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${catColor(c.category)}`}>{c.category}</span>
                </td>
                <td className="px-4 py-3 text-gray-600 font-mono text-xs">{c.sds_number || '—'}</td>
                <td className="px-4 py-3">
                  {c.is_food_grade ? (
                    <span className="flex items-center gap-1 text-green-700"><ShieldCheck size={14} /> Yes{c.nsf_rating ? ` (${c.nsf_rating})` : ''}</span>
                  ) : (
                    <span className="text-gray-400">No</span>
                  )}
                </td>
                <td className="px-4 py-3 text-gray-600 text-xs">{c.max_concentration || '—'}</td>
                <td className="px-4 py-3">
                  {!c.is_active ? (
                    <span className="px-2 py-0.5 bg-gray-100 text-gray-600 rounded-full text-xs">Inactive</span>
                  ) : c.review_due && c.review_due < today ? (
                    <span className="flex items-center gap-1 text-amber-700 text-xs"><AlertTriangle size={12} /> Review overdue</span>
                  ) : (
                    <span className="px-2 py-0.5 bg-green-100 text-green-800 rounded-full text-xs">Active</span>
                  )}
                </td>
                {isAdmin && (
                  <td className="px-4 py-3 text-right flex gap-1 justify-end">
                    <button onClick={() => { setEditing(c); setShowForm(false); }} className="text-gray-400 hover:text-powder-600">
                      <Edit2 size={14} />
                    </button>
                    <button onClick={() => handleToggleActive(c)}
                      className={`px-2 py-0.5 rounded text-xs ${c.is_active ? 'text-red-600 hover:bg-red-50' : 'text-green-600 hover:bg-green-50'}`}>
                      {c.is_active ? 'Deactivate' : 'Activate'}
                    </button>
                  </td>
                )}
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr><td colSpan={isAdmin ? 7 : 6} className="px-4 py-8 text-center text-gray-400">No chemicals registered yet</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
