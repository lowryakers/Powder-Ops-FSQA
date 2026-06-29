import { useState, useMemo } from 'react';
import { useApiGet, apiPost, apiPut } from '../../hooks/useApi';
import { useAuth } from '../../hooks/useAuth';
import { Plus, Edit2, Search, ExternalLink, FileText, FolderOpen } from 'lucide-react';

const CATEGORIES = [
  { value: 'production', label: 'Production', color: 'bg-blue-100 text-blue-800' },
  { value: 'quality', label: 'Quality', color: 'bg-teal-100 text-teal-800' },
  { value: 'sanitation', label: 'Sanitation', color: 'bg-green-100 text-green-800' },
  { value: 'maintenance', label: 'Maintenance', color: 'bg-orange-100 text-orange-800' },
  { value: 'safety', label: 'Safety', color: 'bg-red-100 text-red-800' },
  { value: 'haccp', label: 'HACCP', color: 'bg-purple-100 text-purple-800' },
  { value: 'training', label: 'Training', color: 'bg-indigo-100 text-indigo-800' },
  { value: 'admin', label: 'Admin', color: 'bg-gray-100 text-gray-800' },
  { value: 'other', label: 'Other', color: 'bg-gray-100 text-gray-700' },
];

const STATUS_COLORS = {
  draft: 'bg-gray-100 text-gray-700',
  active: 'bg-green-100 text-green-800',
  under_review: 'bg-yellow-100 text-yellow-800',
  superseded: 'bg-orange-100 text-orange-800',
  archived: 'bg-gray-100 text-gray-500',
};

const catColor = (cat) => CATEGORIES.find(c => c.value === cat)?.color || 'bg-gray-100 text-gray-700';

function SOPForm({ initial, onSave, onCancel }) {
  const [form, setForm] = useState(initial || {
    doc_number: '', title: '', category: 'production', revision: '1.0', effective_date: '',
    review_due: '', status: 'active', owner: '', gdrive_url: '', gdrive_folder: '', description: '',
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
      <h3 className="font-semibold text-gray-900">{initial?.id ? 'Edit SOP' : 'Add SOP Document'}</h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Document # *</label>
          <input required value={form.doc_number} onChange={e => set('doc_number', e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" placeholder="SOP-PRD-001" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Title *</label>
          <input required value={form.title} onChange={e => set('title', e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Category *</label>
          <select value={form.category} onChange={e => set('category', e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
            {CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Revision</label>
          <input value={form.revision || ''} onChange={e => set('revision', e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" placeholder="1.0" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Effective Date</label>
          <input type="date" value={form.effective_date || ''} onChange={e => set('effective_date', e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Review Due</label>
          <input type="date" value={form.review_due || ''} onChange={e => set('review_due', e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Status</label>
          <select value={form.status} onChange={e => set('status', e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
            <option value="draft">Draft</option>
            <option value="active">Active</option>
            <option value="under_review">Under Review</option>
            <option value="superseded">Superseded</option>
            <option value="archived">Archived</option>
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Owner</label>
          <input value={form.owner || ''} onChange={e => set('owner', e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3 bg-blue-50 rounded-lg border border-blue-200">
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Google Drive Document URL</label>
          <input value={form.gdrive_url || ''} onChange={e => set('gdrive_url', e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" placeholder="https://docs.google.com/..." />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Google Drive Folder URL</label>
          <input value={form.gdrive_folder || ''} onChange={e => set('gdrive_folder', e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" placeholder="https://drive.google.com/drive/folders/..." />
        </div>
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-700 mb-1">Description</label>
        <textarea value={form.description || ''} onChange={e => set('description', e.target.value)}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" rows={2} />
      </div>
      <div className="flex gap-2">
        <button type="submit" disabled={saving} className="px-4 py-2 bg-powder-600 text-white rounded-lg text-sm font-medium hover:bg-powder-700 disabled:opacity-50">
          {saving ? 'Saving...' : initial?.id ? 'Update' : 'Add SOP'}
        </button>
        <button type="button" onClick={onCancel} className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm hover:bg-gray-200">Cancel</button>
      </div>
    </form>
  );
}

export default function SOPPanel() {
  const { user } = useAuth();
  const { data: sops, loading, refresh } = useApiGet('/sops');
  const [search, setSearch] = useState('');
  const [catFilter, setCatFilter] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);

  const filtered = useMemo(() => {
    let list = sops || [];
    if (search) {
      const s = search.toLowerCase();
      list = list.filter(d => d.title.toLowerCase().includes(s) || d.doc_number.toLowerCase().includes(s) || (d.owner || '').toLowerCase().includes(s));
    }
    if (catFilter) list = list.filter(d => d.category === catFilter);
    return list;
  }, [sops, search, catFilter]);

  const grouped = useMemo(() => {
    const groups = {};
    for (const doc of filtered) {
      if (!groups[doc.category]) groups[doc.category] = [];
      groups[doc.category].push(doc);
    }
    return groups;
  }, [filtered]);

  const stats = useMemo(() => {
    const list = sops || [];
    const now = new Date().toISOString().split('T')[0];
    return {
      total: list.length,
      active: list.filter(d => d.status === 'active').length,
      reviewDue: list.filter(d => d.review_due && d.review_due <= now).length,
      withLink: list.filter(d => d.gdrive_url || d.gdrive_folder).length,
    };
  }, [sops]);

  const handleCreate = async (form) => {
    await apiPost('/sops', { ...form, _actor: user?.name });
    setShowForm(false);
    refresh();
  };

  const handleUpdate = async (form) => {
    await apiPut(`/sops/${editing.id}`, { ...form, _actor: user?.name });
    setEditing(null);
    refresh();
  };

  if (loading) return <div className="text-center py-12 text-gray-500">Loading...</div>;

  return (
    <div className="space-y-6">
      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-white rounded-xl border p-3 text-center">
          <div className="text-2xl font-bold text-gray-900">{stats.total}</div>
          <div className="text-xs text-gray-500">Total SOPs</div>
        </div>
        <div className="bg-white rounded-xl border p-3 text-center">
          <div className="text-2xl font-bold text-green-600">{stats.active}</div>
          <div className="text-xs text-gray-500">Active</div>
        </div>
        <div className="bg-white rounded-xl border p-3 text-center">
          <div className={`text-2xl font-bold ${stats.reviewDue > 0 ? 'text-orange-600' : 'text-gray-400'}`}>{stats.reviewDue}</div>
          <div className="text-xs text-gray-500">Review Due</div>
        </div>
        <div className="bg-white rounded-xl border p-3 text-center">
          <div className="text-2xl font-bold text-blue-600">{stats.withLink}</div>
          <div className="text-xs text-gray-500">Linked to Drive</div>
        </div>
      </div>

      {/* Controls */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-2.5 text-gray-400" />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search SOPs..."
              className="pl-8 pr-3 py-2 border border-gray-300 rounded-lg text-sm w-48" />
          </div>
          <select value={catFilter} onChange={e => setCatFilter(e.target.value)}
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm">
            <option value="">All Categories</option>
            {CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
        </div>
        <button onClick={() => { setShowForm(true); setEditing(null); }}
          className="flex items-center gap-1 px-3 py-2 bg-powder-600 text-white rounded-lg text-sm font-medium hover:bg-powder-700">
          <Plus size={16} /> Add SOP
        </button>
      </div>

      {showForm && !editing && <SOPForm onSave={handleCreate} onCancel={() => setShowForm(false)} />}
      {editing && <SOPForm initial={editing} onSave={handleUpdate} onCancel={() => setEditing(null)} />}

      {/* SOP Table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b">
            <tr>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Doc #</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Title</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Category</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Rev</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Status</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Review Due</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Links</th>
              <th className="text-right px-4 py-3 font-medium text-gray-600">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(doc => {
              const overdue = doc.review_due && doc.review_due <= new Date().toISOString().split('T')[0];
              return (
                <tr key={doc.id} className={`border-b border-gray-100 hover:bg-gray-50 ${overdue ? 'bg-orange-50' : ''}`}>
                  <td className="px-4 py-3 font-mono text-xs font-bold text-gray-900">{doc.doc_number}</td>
                  <td className="px-4 py-3">
                    <span className="font-medium text-gray-900">{doc.title}</span>
                    {doc.owner && <div className="text-[10px] text-gray-400">Owner: {doc.owner}</div>}
                  </td>
                  <td className="px-4 py-3"><span className={`px-2 py-0.5 rounded-full text-xs font-medium ${catColor(doc.category)}`}>{doc.category}</span></td>
                  <td className="px-4 py-3 text-gray-600">{doc.revision}</td>
                  <td className="px-4 py-3"><span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[doc.status]}`}>{doc.status.replace('_', ' ')}</span></td>
                  <td className={`px-4 py-3 text-xs ${overdue ? 'text-orange-700 font-bold' : 'text-gray-500'}`}>{doc.review_due || '—'}</td>
                  <td className="px-4 py-3">
                    <div className="flex gap-1">
                      {doc.gdrive_url && (
                        <a href={doc.gdrive_url} target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:text-blue-700" title="Open document">
                          <FileText size={14} />
                        </a>
                      )}
                      {doc.gdrive_folder && (
                        <a href={doc.gdrive_folder} target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:text-blue-700" title="Open folder">
                          <FolderOpen size={14} />
                        </a>
                      )}
                      {!doc.gdrive_url && !doc.gdrive_folder && <span className="text-gray-300">—</span>}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button onClick={() => { setEditing(doc); setShowForm(false); }} className="text-gray-400 hover:text-powder-600">
                      <Edit2 size={14} />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {filtered.length === 0 && <div className="text-center py-8 text-gray-500 text-sm">No SOPs found. Add your first SOP document or link your Google Drive folder.</div>}
      </div>
    </div>
  );
}
