import { useState, useMemo, useCallback } from 'react';
import { useApiGet, apiPost, apiPut, apiFetch } from '../../hooks/useApi';
import { useAuth } from '../../hooks/useAuth';
import { Plus, Edit2, Search, ExternalLink, FileText, FolderOpen, ChevronDown, ChevronRight, Download, History, ArrowUpDown, ArrowUp, ArrowDown, X, Check } from 'lucide-react';

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
    review_due: '', status: 'active', owner: 'Daniela Servin', gdrive_url: '', gdrive_folder: '', description: '',
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
        <label className="block text-xs font-medium text-gray-700 mb-1">Description / Document Content</label>
        <textarea value={form.description || ''} onChange={e => set('description', e.target.value)}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" rows={8} />
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

function ExpandedSOPView({ doc, onClose, onShowHistory }) {
  return (
    <tr>
      <td colSpan={9} className="p-0">
        <div className="bg-gray-50 border-y border-gray-200">
          {/* Document header */}
          <div className="bg-blue-800 text-white px-6 py-4 flex items-start justify-between">
            <div>
              <div className="text-lg font-bold">{doc.title}</div>
              <div className="text-blue-200 text-xs mt-1 flex items-center gap-3">
                <span>{doc.doc_number}</span>
                <span>Rev {doc.revision}</span>
                <span>Owner: {doc.owner || '—'}</span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={onShowHistory} className="text-blue-200 hover:text-white p-1.5 rounded-lg hover:bg-blue-700" title="Version History">
                <History size={16} />
              </button>
              <a href={`/api/sops/${doc.id}/pdf`} className="text-blue-200 hover:text-white p-1.5 rounded-lg hover:bg-blue-700" title="Download PDF">
                <Download size={16} />
              </a>
              <button onClick={onClose} className="text-blue-200 hover:text-white p-1.5 rounded-lg hover:bg-blue-700">
                <X size={16} />
              </button>
            </div>
          </div>

          {/* Metadata bar */}
          <div className="px-6 py-3 bg-white border-b border-gray-200 flex flex-wrap gap-4 text-xs text-gray-600">
            <div><span className="font-medium text-gray-500">Category:</span> <span className={`ml-1 px-2 py-0.5 rounded-full font-medium ${catColor(doc.category)}`}>{doc.category}</span></div>
            <div><span className="font-medium text-gray-500">Status:</span> <span className={`ml-1 px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS[doc.status]}`}>{(doc.status || '').replace('_', ' ')}</span></div>
            <div><span className="font-medium text-gray-500">Effective:</span> {doc.effective_date || '—'}</div>
            <div><span className="font-medium text-gray-500">Review Due:</span> {doc.review_due || '—'}</div>
            {doc.gdrive_url && (
              <a href={doc.gdrive_url} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:text-blue-800 flex items-center gap-1">
                <ExternalLink size={12} /> Google Drive
              </a>
            )}
          </div>

          {/* Document body */}
          <div className="px-6 py-5 max-h-[500px] overflow-y-auto">
            {doc.description ? (
              <div className="prose prose-sm max-w-none text-gray-800 leading-relaxed">
                {doc.description.split('\n').map((line, i) => {
                  const trimmed = line.trim();
                  if (!trimmed) return <br key={i} />;
                  if (trimmed.startsWith('•') || trimmed.startsWith('-')) {
                    return <div key={i} className="pl-4 py-0.5">{trimmed}</div>;
                  }
                  if (trimmed === trimmed.toUpperCase() && trimmed.length > 3 && trimmed.length < 80) {
                    return <div key={i} className="font-bold text-gray-900 mt-3 mb-1">{trimmed}</div>;
                  }
                  return <div key={i} className="py-0.5">{trimmed}</div>;
                })}
              </div>
            ) : (
              <p className="text-gray-400 italic text-sm">No description content available.</p>
            )}
          </div>
        </div>
      </td>
    </tr>
  );
}

function VersionHistoryModal({ doc, onClose }) {
  const { data: versions, loading } = useApiGet(`/sops/${doc.id}/versions`);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg mx-4 max-h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
          <div>
            <h3 className="font-semibold text-gray-900">Version History</h3>
            <p className="text-xs text-gray-500">{doc.doc_number} — {doc.title}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-3">
          {loading ? (
            <p className="text-gray-500 text-sm py-4 text-center">Loading history...</p>
          ) : !versions || versions.length === 0 ? (
            <p className="text-gray-400 text-sm py-4 text-center">No version history available.</p>
          ) : (
            <div className="relative">
              <div className="absolute left-3 top-2 bottom-2 w-px bg-gray-200" />
              {versions.map((v, i) => (
                <div key={v.id} className="relative pl-8 pb-4">
                  <div className={`absolute left-1.5 top-1.5 w-3 h-3 rounded-full border-2 ${i === 0 ? 'bg-powder-600 border-powder-600' : 'bg-white border-gray-300'}`} />
                  <div className="bg-gray-50 rounded-lg p-3 border border-gray-200">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-gray-900">Rev {v.revision}</span>
                      <span className="text-[10px] text-gray-400">{new Date(v.created_at).toLocaleString()}</span>
                    </div>
                    <div className="text-xs text-gray-600 mt-1">{v.change_summary}</div>
                    <div className="text-[10px] text-gray-400 mt-1">by {v.changed_by}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function SortableHeader({ label, field, sortField, sortOrder, onSort }) {
  const active = sortField === field;
  return (
    <th
      className="text-left px-4 py-3 font-medium text-gray-600 cursor-pointer hover:text-gray-900 select-none"
      onClick={() => onSort(field)}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        {active ? (
          sortOrder === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />
        ) : (
          <ArrowUpDown size={12} className="text-gray-300" />
        )}
      </span>
    </th>
  );
}

export default function SOPPanel() {
  const { user } = useAuth();
  const [sortField, setSortField] = useState('category');
  const [sortOrder, setSortOrder] = useState('asc');
  const { data: sops, loading, refresh } = useApiGet(`/sops?sort=${sortField}&order=${sortOrder}`, [sortField, sortOrder]);
  const [search, setSearch] = useState('');
  const [catFilter, setCatFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [expandedId, setExpandedId] = useState(null);
  const [historyDoc, setHistoryDoc] = useState(null);
  const [selected, setSelected] = useState(new Set());
  const [reviewDueOnly, setReviewDueOnly] = useState(false);

  const handleSort = useCallback((field) => {
    if (sortField === field) {
      setSortOrder(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortOrder('asc');
    }
  }, [sortField]);

  const filtered = useMemo(() => {
    let list = sops || [];
    if (search) {
      const s = search.toLowerCase();
      list = list.filter(d => d.title.toLowerCase().includes(s) || d.doc_number.toLowerCase().includes(s) || (d.owner || '').toLowerCase().includes(s) || (d.description || '').toLowerCase().includes(s));
    }
    if (catFilter) list = list.filter(d => d.category === catFilter);
    if (statusFilter) list = list.filter(d => d.status === statusFilter);
    if (reviewDueOnly) {
      const now = new Date().toISOString().split('T')[0];
      list = list.filter(d => d.review_due && d.review_due <= now);
    }
    return list;
  }, [sops, search, catFilter, statusFilter, reviewDueOnly]);

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

  const toggleSelect = (id) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (selected.size === filtered.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(filtered.map(d => d.id)));
    }
  };

  const downloadSelectedPDF = async () => {
    const ids = [...selected];
    if (!ids.length) return;
    try {
      const res = await fetch('/api/sops/pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids }),
      });
      if (!res.ok) throw new Error('PDF generation failed');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `SOP_Registry_${ids.length}_docs.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('PDF download failed:', err);
    }
  };

  if (loading) return <div className="text-center py-12 text-gray-500">Loading...</div>;

  return (
    <div className="space-y-6">
      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div onClick={() => { setStatusFilter(''); setCatFilter(''); setReviewDueOnly(false); }}
          className="bg-white rounded-xl border p-3 text-center cursor-pointer hover:shadow-md transition-shadow">
          <div className="text-2xl font-bold text-gray-900">{stats.total}</div>
          <div className="text-xs text-gray-500">Total SOPs</div>
        </div>
        <div onClick={() => { setStatusFilter(statusFilter === 'active' ? '' : 'active'); setReviewDueOnly(false); }}
          className={`bg-white rounded-xl border p-3 text-center cursor-pointer hover:shadow-md transition-shadow ${statusFilter === 'active' ? 'ring-2 ring-green-500' : ''}`}>
          <div className="text-2xl font-bold text-green-600">{stats.active}</div>
          <div className="text-xs text-gray-500">Active</div>
        </div>
        <div onClick={() => setReviewDueOnly(!reviewDueOnly)}
          className={`bg-white rounded-xl border p-3 text-center cursor-pointer hover:shadow-md transition-shadow ${reviewDueOnly ? 'ring-2 ring-orange-500' : ''}`}>
          <div className={`text-2xl font-bold ${stats.reviewDue > 0 ? 'text-orange-600' : 'text-gray-400'}`}>{stats.reviewDue}</div>
          <div className="text-xs text-gray-500">{reviewDueOnly ? 'Showing Review Due' : 'Review Due'}</div>
        </div>
        <div className="bg-white rounded-xl border p-3 text-center">
          <div className="text-2xl font-bold text-blue-600">{stats.withLink}</div>
          <div className="text-xs text-gray-500">Linked to Drive</div>
        </div>
      </div>

      {/* Controls */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2 flex-wrap">
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
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm">
            <option value="">All Statuses</option>
            <option value="draft">Draft</option>
            <option value="active">Active</option>
            <option value="under_review">Under Review</option>
            <option value="superseded">Superseded</option>
            <option value="archived">Archived</option>
          </select>
        </div>
        <div className="flex items-center gap-2">
          {selected.size > 0 && (
            <button onClick={downloadSelectedPDF}
              className="flex items-center gap-1 px-3 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-200">
              <Download size={14} /> PDF ({selected.size})
            </button>
          )}
          <button onClick={() => { setShowForm(true); setEditing(null); }}
            className="flex items-center gap-1 px-3 py-2 bg-powder-600 text-white rounded-lg text-sm font-medium hover:bg-powder-700">
            <Plus size={16} /> Add SOP
          </button>
        </div>
      </div>

      {showForm && !editing && <SOPForm onSave={handleCreate} onCancel={() => setShowForm(false)} />}
      {editing && <SOPForm initial={editing} onSave={handleUpdate} onCancel={() => setEditing(null)} />}

      {/* Mobile SOP Cards */}
      <div className="md:hidden space-y-3">
        {filtered.map(doc => {
          const overdue = doc.review_due && doc.review_due <= new Date().toISOString().split('T')[0];
          const isExpanded = expandedId === doc.id;
          return (
            <div key={doc.id} className={`bg-white rounded-xl border ${overdue ? 'border-orange-200' : 'border-gray-200'} overflow-hidden`}>
              <div className="p-3" onClick={() => setExpandedId(isExpanded ? null : doc.id)}>
                <div className="flex items-start gap-2">
                  <input type="checkbox" checked={selected.has(doc.id)} onChange={() => toggleSelect(doc.id)}
                    onClick={e => e.stopPropagation()} className="rounded border-gray-300 mt-1 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <span className="font-mono text-xs font-bold text-gray-900">{doc.doc_number}</span>
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${catColor(doc.category)}`}>{doc.category}</span>
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${STATUS_COLORS[doc.status]}`}>{doc.status.replace('_', ' ')}</span>
                    </div>
                    <p className="font-medium text-sm text-gray-900">{doc.title}</p>
                    <div className="flex items-center gap-3 mt-1 text-xs text-gray-500">
                      <span>Rev {doc.revision}</span>
                      <span>{doc.owner || '—'}</span>
                      {doc.review_due && <span className={overdue ? 'text-orange-700 font-bold' : ''}>Due {doc.review_due}</span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0" onClick={e => e.stopPropagation()}>
                    <a href={`/api/sops/${doc.id}/pdf`} className="text-gray-400 hover:text-gray-600 p-1.5"><Download size={16} /></a>
                    <button onClick={() => setHistoryDoc(doc)} className="text-gray-400 hover:text-gray-600 p-1.5"><History size={16} /></button>
                    <button onClick={() => { setEditing(doc); setShowForm(false); }} className="text-gray-400 hover:text-powder-600 p-1.5"><Edit2 size={16} /></button>
                  </div>
                </div>
              </div>
              {isExpanded && (
                <div className="border-t border-gray-200">
                  <div className="bg-blue-800 text-white px-4 py-3">
                    <div className="text-sm font-bold">{doc.title}</div>
                    <div className="text-blue-200 text-xs mt-0.5">{doc.doc_number} · Rev {doc.revision} · {doc.owner || '—'}</div>
                  </div>
                  <div className="px-4 py-3 flex flex-wrap gap-2 text-xs text-gray-600 border-b border-gray-100">
                    <span className={`px-2 py-0.5 rounded-full font-medium ${catColor(doc.category)}`}>{doc.category}</span>
                    <span className={`px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS[doc.status]}`}>{(doc.status || '').replace('_', ' ')}</span>
                    <span>Effective: {doc.effective_date || '—'}</span>
                    <span>Review: {doc.review_due || '—'}</span>
                  </div>
                  <div className="px-4 py-4 max-h-[400px] overflow-y-auto">
                    {doc.description ? (
                      <div className="text-sm text-gray-800 leading-relaxed">
                        {doc.description.split('\n').map((line, i) => {
                          const trimmed = line.trim();
                          if (!trimmed) return <br key={i} />;
                          if (trimmed.startsWith('•') || trimmed.startsWith('-')) return <div key={i} className="pl-4 py-0.5">{trimmed}</div>;
                          if (trimmed === trimmed.toUpperCase() && trimmed.length > 3 && trimmed.length < 80) return <div key={i} className="font-bold text-gray-900 mt-3 mb-1">{trimmed}</div>;
                          return <div key={i} className="py-0.5">{trimmed}</div>;
                        })}
                      </div>
                    ) : (
                      <p className="text-gray-400 italic text-sm">No description content available.</p>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
        {filtered.length === 0 && <div className="text-center py-8 text-gray-500 text-sm">No SOPs found.</div>}
      </div>

      {/* Desktop SOP Table */}
      <div className="hidden md:block bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="px-4 py-3 w-8">
                  <input type="checkbox" checked={filtered.length > 0 && selected.size === filtered.length}
                    onChange={toggleAll} className="rounded border-gray-300" />
                </th>
                <SortableHeader label="Doc #" field="doc_number" sortField={sortField} sortOrder={sortOrder} onSort={handleSort} />
                <SortableHeader label="Title" field="title" sortField={sortField} sortOrder={sortOrder} onSort={handleSort} />
                <SortableHeader label="Category" field="category" sortField={sortField} sortOrder={sortOrder} onSort={handleSort} />
                <SortableHeader label="Rev" field="revision" sortField={sortField} sortOrder={sortOrder} onSort={handleSort} />
                <SortableHeader label="Status" field="status" sortField={sortField} sortOrder={sortOrder} onSort={handleSort} />
                <SortableHeader label="Owner" field="owner" sortField={sortField} sortOrder={sortOrder} onSort={handleSort} />
                <SortableHeader label="Review Due" field="review_due" sortField={sortField} sortOrder={sortOrder} onSort={handleSort} />
                <th className="text-right px-4 py-3 font-medium text-gray-600">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(doc => {
                const overdue = doc.review_due && doc.review_due <= new Date().toISOString().split('T')[0];
                const isExpanded = expandedId === doc.id;
                return (
                  <>
                    <tr key={doc.id} className={`border-b border-gray-100 hover:bg-gray-50 cursor-pointer ${overdue ? 'bg-orange-50' : ''} ${isExpanded ? 'bg-blue-50' : ''}`}>
                      <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                        <input type="checkbox" checked={selected.has(doc.id)} onChange={() => toggleSelect(doc.id)} className="rounded border-gray-300" />
                      </td>
                      <td className="px-4 py-3 font-mono text-xs font-bold text-gray-900" onClick={() => setExpandedId(isExpanded ? null : doc.id)}>
                        <span className="inline-flex items-center gap-1">
                          {isExpanded ? <ChevronDown size={14} className="text-blue-600" /> : <ChevronRight size={14} className="text-gray-400" />}
                          {doc.doc_number}
                        </span>
                      </td>
                      <td className="px-4 py-3" onClick={() => setExpandedId(isExpanded ? null : doc.id)}>
                        <span className="font-medium text-gray-900">{doc.title}</span>
                      </td>
                      <td className="px-4 py-3"><span className={`px-2 py-0.5 rounded-full text-xs font-medium ${catColor(doc.category)}`}>{doc.category}</span></td>
                      <td className="px-4 py-3 text-gray-600">{doc.revision}</td>
                      <td className="px-4 py-3"><span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[doc.status]}`}>{doc.status.replace('_', ' ')}</span></td>
                      <td className="px-4 py-3 text-xs text-gray-600">{doc.owner || '—'}</td>
                      <td className={`px-4 py-3 text-xs ${overdue ? 'text-orange-700 font-bold' : 'text-gray-500'}`}>{doc.review_due || '—'}</td>
                      <td className="px-4 py-3 text-right" onClick={e => e.stopPropagation()}>
                        <div className="flex items-center justify-end gap-1">
                          <a href={`/api/sops/${doc.id}/pdf`} className="text-gray-400 hover:text-gray-600 p-1" title="Download PDF">
                            <Download size={14} />
                          </a>
                          <button onClick={() => setHistoryDoc(doc)} className="text-gray-400 hover:text-gray-600 p-1" title="Version History">
                            <History size={14} />
                          </button>
                          <button onClick={() => { setEditing(doc); setShowForm(false); }} className="text-gray-400 hover:text-powder-600 p-1" title="Edit">
                            <Edit2 size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                    {isExpanded && (
                      <ExpandedSOPView
                        key={`exp-${doc.id}`}
                        doc={doc}
                        onClose={() => setExpandedId(null)}
                        onShowHistory={() => setHistoryDoc(doc)}
                      />
                    )}
                  </>
                );
              })}
            </tbody>
          </table>
        </div>
        {filtered.length === 0 && <div className="text-center py-8 text-gray-500 text-sm">No SOPs found. Add your first SOP document or link your Google Drive folder.</div>}
      </div>

      {historyDoc && <VersionHistoryModal doc={historyDoc} onClose={() => setHistoryDoc(null)} />}
    </div>
  );
}
