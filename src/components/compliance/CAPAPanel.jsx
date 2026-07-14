import { useState, useMemo, useEffect } from 'react';
import { useApiGet, apiPost, apiPut } from '../../hooks/useApi';
import { useAuth } from '../../hooks/useAuth';
import { canEditModule } from '../../utils/permissions';
import { Plus, Edit2, Search, ChevronDown, ChevronUp, FileWarning, Trash2, CheckSquare, Square } from 'lucide-react';

// Typed-confirmation dialog for permanent, irreversible bulk deletion.
function ConfirmDeleteModal({ count, noun, onConfirm, onClose }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const ok = text.trim().toUpperCase() === 'DELETE';
  const go = async () => { setBusy(true); try { await onConfirm(); } finally { setBusy(false); } };
  return (
    <div className="fixed inset-0 bg-black/30 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div onClick={e => e.stopPropagation()} className="bg-white rounded-xl shadow-xl w-full max-w-md p-5 space-y-4">
        <div className="flex items-center gap-2 text-red-600"><Trash2 size={18} /><h3 className="font-semibold">Permanently delete {count} {noun}{count === 1 ? '' : 's'}</h3></div>
        <p className="text-sm text-gray-600">This removes the selected {noun}{count === 1 ? '' : 's'} for good. This cannot be undone. Type <span className="font-mono font-semibold">DELETE</span> to confirm.</p>
        <input value={text} onChange={e => setText(e.target.value)} placeholder="DELETE" className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" autoFocus />
        <div className="flex items-center gap-2">
          <button disabled={!ok || busy} onClick={go} className="flex-1 px-4 py-2 bg-red-600 text-white text-sm font-medium rounded-lg hover:bg-red-700 disabled:opacity-40">{busy ? 'Deleting…' : `Delete ${count} permanently`}</button>
          <button onClick={onClose} className="px-4 py-2 bg-gray-100 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-200">Cancel</button>
        </div>
      </div>
    </div>
  );
}

const STATUS_COLORS = {
  open: 'bg-red-100 text-red-800',
  in_progress: 'bg-yellow-100 text-yellow-800',
  implemented: 'bg-blue-100 text-blue-800',
  verified: 'bg-purple-100 text-purple-800',
  closed: 'bg-green-100 text-green-800',
};

const PRIORITY_COLORS = {
  low: 'bg-gray-100 text-gray-700',
  normal: 'bg-blue-100 text-blue-700',
  high: 'bg-orange-100 text-orange-800',
  critical: 'bg-red-100 text-red-800',
};

const SOURCE_TYPES = [
  { value: 'deviation', label: 'Deviation' },
  { value: 'foreign_object', label: 'Foreign Object' },
  { value: 'customer_complaint', label: 'Customer Complaint' },
  { value: 'internal_audit', label: 'Internal Audit' },
  { value: 'other', label: 'Other' },
];

const CORRECTION_TYPES = [
  { value: 'Re-train', label: 'Re-Train' },
  { value: 'SOP/WI Update', label: 'SOP/WI Update' },
  { value: 'Equipment Repair', label: 'Equipment Repair' },
  { value: 'Document Implementation', label: 'New Document Implementation' },
  { value: 'N/A', label: 'N/A' },
];

function ComplaintForm({ initial, onSave, onCancel }) {
  const [form, setForm] = useState(initial || {
    complaint_number: '', date_received: new Date().toISOString().split('T')[0], customer_name: '',
    lot_number: '', item_number: '', complaint_text: '', person_responsible: '',
    investigation: '', corrective_action: '', resolved: false, date_resolved: '', capa_needed: false,
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
      <h3 className="font-semibold text-gray-900">{initial?.id ? 'Edit Complaint' : 'Log New Complaint'}</h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Complaint # *</label>
          <input required value={form.complaint_number} onChange={e => set('complaint_number', e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" placeholder="CC25-006" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Date Received *</label>
          <input type="date" required value={form.date_received} onChange={e => set('date_received', e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Customer Name *</label>
          <input required value={form.customer_name} onChange={e => set('customer_name', e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Lot #</label>
          <input value={form.lot_number || ''} onChange={e => set('lot_number', e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Item #</label>
          <input value={form.item_number || ''} onChange={e => set('item_number', e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Person Responsible</label>
          <input value={form.person_responsible || ''} onChange={e => set('person_responsible', e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
        </div>
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-700 mb-1">Complaint *</label>
        <textarea required value={form.complaint_text} onChange={e => set('complaint_text', e.target.value)}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" rows={2} />
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-700 mb-1">Investigation</label>
        <textarea value={form.investigation || ''} onChange={e => set('investigation', e.target.value)}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" rows={2} />
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-700 mb-1">Corrective Action</label>
        <textarea value={form.corrective_action || ''} onChange={e => set('corrective_action', e.target.value)}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" rows={2} />
      </div>
      <div className="flex items-center gap-6">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={!!form.resolved} onChange={e => set('resolved', e.target.checked)} className="rounded border-gray-300" />
          <span className="font-medium text-gray-700">Resolved</span>
        </label>
        {form.resolved && (
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Date Resolved</label>
            <input type="date" value={form.date_resolved || ''} onChange={e => set('date_resolved', e.target.value)}
              className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm" />
          </div>
        )}
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={!!form.capa_needed} onChange={e => set('capa_needed', e.target.checked)} className="rounded border-gray-300" />
          <span className="font-medium text-gray-700">CAPA Needed</span>
        </label>
      </div>
      <div className="flex gap-2">
        <button type="submit" disabled={saving} className="px-4 py-2 bg-powder-600 text-white rounded-lg text-sm font-medium hover:bg-powder-700 disabled:opacity-50">
          {saving ? 'Saving...' : initial?.id ? 'Update' : 'Log Complaint'}
        </button>
        <button type="button" onClick={onCancel} className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm hover:bg-gray-200">Cancel</button>
      </div>
    </form>
  );
}

function CAPAForm({ initial, complaints, onSave, onCancel }) {
  const [form, setForm] = useState(initial || {
    complaint_id: '', title: '', description: '', root_cause: '', corrective_action: '',
    preventive_action: '', proposed_solution: '', assigned_to: '', priority: 'normal', due_date: '', status: 'open',
    verification_notes: '', date_issued: new Date().toISOString().split('T')[0],
    item_lot: '', item_number: '', item_description: '', work_order_number: '', po_number: '',
    source_type: '', immediate_correction: '', series_of_document: '',
    mgmt_verification_date: '', mgmt_verification_by: '', nc_number: '', linked_complaint_number: '',
    is_preventive_action: false,
  });
  const [saving, setSaving] = useState(false);
  const set = (k, v) => setForm({ ...form, [k]: v });

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try { await onSave(form); } finally { setSaving(false); }
  };

  return (
    <form onSubmit={handleSubmit} className="bg-white rounded-xl border border-red-200 p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-gray-900">{initial?.id ? 'Edit CAPA' : 'Create CAPA'}</h3>
        <span className="text-xs text-gray-400">Form 408-2</span>
      </div>

      {/* Section 1: CAPA Information */}
      <div className="p-3 bg-gray-50 rounded-lg border border-gray-200 space-y-3">
        <h4 className="text-xs font-bold text-gray-600 uppercase">1. CAPA Information</h4>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">CAPA Title *</label>
            <input required value={form.title} onChange={e => set('title', e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Date Issued</label>
            <input type="date" value={form.date_issued || ''} onChange={e => set('date_issued', e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Assigned Investigator</label>
            <input value={form.assigned_to || ''} onChange={e => set('assigned_to', e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Item Lot</label>
            <input value={form.item_lot || ''} onChange={e => set('item_lot', e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Item / Work Order #</label>
            <input value={form.item_number || ''} onChange={e => set('item_number', e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Item Description</label>
            <input value={form.item_description || ''} onChange={e => set('item_description', e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Work Order #</label>
            <input value={form.work_order_number || ''} onChange={e => set('work_order_number', e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">PO # (if applicable)</label>
            <input value={form.po_number || ''} onChange={e => set('po_number', e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Series of Document</label>
            <input value={form.series_of_document || ''} onChange={e => set('series_of_document', e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" placeholder="e.g. 25-001" />
          </div>
        </div>

        {/* Reference & Source */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 pt-2 border-t border-gray-200">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Source of Issue</label>
            <select value={form.source_type || ''} onChange={e => set('source_type', e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
              <option value="">— Select —</option>
              {SOURCE_TYPES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">NC #</label>
            <input value={form.nc_number || ''} onChange={e => set('nc_number', e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Linked Complaint #</label>
            <input value={form.linked_complaint_number || ''} onChange={e => set('linked_complaint_number', e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" placeholder="e.g. CC25-005" />
          </div>
          <div className="flex items-end pb-1">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={!!form.is_preventive_action} onChange={e => set('is_preventive_action', e.target.checked)} className="rounded border-gray-300" />
              <span className="font-medium text-gray-700">Preventive Action</span>
            </label>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t border-gray-200">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Linked Complaint (from log)</label>
            <select value={form.complaint_id || ''} onChange={e => set('complaint_id', e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
              <option value="">— None —</option>
              {(complaints || []).map(c => <option key={c.id} value={c.id}>{c.complaint_number} — {c.customer_name}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Priority</label>
              <select value={form.priority} onChange={e => set('priority', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
                <option value="low">Low</option>
                <option value="normal">Normal</option>
                <option value="high">High</option>
                <option value="critical">Critical</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Status</label>
              <select value={form.status} onChange={e => set('status', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
                <option value="open">Open</option>
                <option value="in_progress">In Progress</option>
                <option value="implemented">Implemented</option>
                <option value="verified">Verified</option>
                <option value="closed">Closed</option>
              </select>
            </div>
          </div>
        </div>
      </div>

      {/* Section 2: CAPA Description */}
      <div className="p-3 bg-gray-50 rounded-lg border border-gray-200 space-y-3">
        <h4 className="text-xs font-bold text-gray-600 uppercase">2. CAPA Description</h4>
        <textarea value={form.description || ''} onChange={e => set('description', e.target.value)}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" rows={3} placeholder="Describe the issue that triggered this CAPA..." />
      </div>

      {/* Section 3: Root Cause Analysis */}
      <div className="p-3 bg-gray-50 rounded-lg border border-gray-200 space-y-3">
        <h4 className="text-xs font-bold text-gray-600 uppercase">3. Root Cause Analysis</h4>
        <textarea value={form.root_cause || ''} onChange={e => set('root_cause', e.target.value)}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" rows={3} />
      </div>

      {/* Section 4: Proposed Solution + Immediate Correction */}
      <div className="p-3 bg-gray-50 rounded-lg border border-gray-200 space-y-3">
        <h4 className="text-xs font-bold text-gray-600 uppercase">4. Proposed Solution & Immediate Correction</h4>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Proposed Solution</label>
          <textarea value={form.proposed_solution || ''} onChange={e => set('proposed_solution', e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" rows={3} />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Immediate Correction Taken</label>
          <select value={form.immediate_correction || ''} onChange={e => set('immediate_correction', e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
            <option value="">— Select —</option>
            {CORRECTION_TYPES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
        </div>
      </div>

      {/* Section 5: Management Verification */}
      <div className="p-3 bg-blue-50 rounded-lg border border-blue-200 space-y-3">
        <h4 className="text-xs font-bold text-blue-700 uppercase">5. Management Verification</h4>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Verification Date</label>
            <input type="date" value={form.mgmt_verification_date || ''} onChange={e => set('mgmt_verification_date', e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Verified By</label>
            <input value={form.mgmt_verification_by || ''} onChange={e => set('mgmt_verification_by', e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
          </div>
        </div>
        {initial?.id && (
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Effectiveness / Verification Notes</label>
            <textarea value={form.verification_notes || ''} onChange={e => set('verification_notes', e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" rows={2} />
          </div>
        )}
      </div>

      <div className="flex gap-2">
        <button type="submit" disabled={saving} className="px-4 py-2 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-700 disabled:opacity-50">
          {saving ? 'Saving...' : initial?.id ? 'Update CAPA' : 'Create CAPA'}
        </button>
        <button type="button" onClick={onCancel} className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm hover:bg-gray-200">Cancel</button>
      </div>
    </form>
  );
}

function DetailRow({ label, value }) {
  if (!value) return null;
  return (
    <div>
      <span className="text-xs font-medium text-gray-500">{label}:</span>{' '}
      <span className="text-sm text-gray-800">{value}</span>
    </div>
  );
}

export default function CAPAPanel() {
  const { user } = useAuth() || {};
  const canEdit = canEditModule(user, 'capa');
  const isAdmin = user?.role === 'admin';
  const { data: complaints, loading: loadingC, refresh: refreshC } = useApiGet('/complaints');
  const { data: capas, loading: loadingCA, refresh: refreshCA } = useApiGet('/complaints/capas/all');
  const [tab, setTabRaw] = useState('complaints');
  const [search, setSearch] = useState('');

  // When a Deviation/NC "CAPA #" link navigates here, jump to the CAPA tab and
  // filter to that number (stashed in localStorage so the mount timing is safe).
  useEffect(() => {
    let focus = null;
    try { focus = localStorage.getItem('capa_focus'); } catch { /* ignore */ }
    if (focus) {
      setTabRaw('capas');
      setSearch(focus.replace(/[^0-9A-Za-z\s-]/g, '').trim());
      try { localStorage.removeItem('capa_focus'); } catch { /* ignore */ }
    }
  }, []);
  const [showForm, setShowForm] = useState(false);
  const [showCAPAForm, setShowCAPAForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [editingCAPA, setEditingCAPA] = useState(null);
  const [expanded, setExpanded] = useState(null);
  const [filter, setFilter] = useState('all');
  const [selected, setSelected] = useState(() => new Set());
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [msg, setMsg] = useState(null);
  const setTab = (t) => { setSelected(new Set()); setTabRaw(t); };

  const filteredComplaints = useMemo(() => {
    let list = complaints || [];
    if (search) {
      const s = search.toLowerCase();
      list = list.filter(c => c.complaint_number.toLowerCase().includes(s) || c.customer_name.toLowerCase().includes(s) || c.complaint_text.toLowerCase().includes(s));
    }
    if (filter === 'open') list = list.filter(c => !c.resolved);
    if (filter === 'capa') list = list.filter(c => c.capa_needed);
    return list;
  }, [complaints, search, filter]);

  const filteredCAPAs = useMemo(() => {
    let list = capas || [];
    if (search) {
      const s = search.toLowerCase();
      list = list.filter(c => (c.capa_number || '').toLowerCase().includes(s) || c.title.toLowerCase().includes(s) || (c.item_description || '').toLowerCase().includes(s));
    }
    if (filter === 'open') list = list.filter(c => c.status !== 'closed');
    return list;
  }, [capas, search, filter]);

  const handleCreateComplaint = async (form) => {
    await apiPost('/complaints', form);
    setShowForm(false);
    refreshC();
  };
  const handleUpdateComplaint = async (form) => {
    await apiPut(`/complaints/${editing.id}`, form);
    setEditing(null);
    refreshC();
  };
  const handleCreateCAPA = async (form) => {
    await apiPost('/complaints/capas', form);
    setShowCAPAForm(false);
    refreshCA(); refreshC();
  };
  const handleUpdateCAPA = async (form) => {
    await apiPut(`/complaints/capas/${editingCAPA.id}`, form);
    setEditingCAPA(null);
    refreshCA();
  };

  // --- Bulk selection (scoped to the active tab) ---
  const currentList = tab === 'complaints' ? filteredComplaints : filteredCAPAs;
  const visibleIds = currentList.map(x => x.id);
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every(id => selected.has(id));
  const toggleOne = (id) => setSelected(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const toggleAll = () => setSelected(prev => {
    const n = new Set(prev);
    if (allVisibleSelected) visibleIds.forEach(id => n.delete(id));
    else visibleIds.forEach(id => n.add(id));
    return n;
  });
  const clearSelection = () => setSelected(new Set());
  const flash = (m) => { setMsg(m); setTimeout(() => setMsg(null), 6000); };

  const handleBulkComplaintUpdate = async (resolved) => {
    const res = await apiPost('/complaints/bulk-update', { ids: [...selected], patch: { resolved } });
    clearSelection(); flash(`Marked ${res.updated} complaint${res.updated === 1 ? '' : 's'} ${resolved ? 'resolved' : 'open'}.`); refreshC();
  };
  const handleBulkCapaUpdate = async (status) => {
    const res = await apiPost('/complaints/capas/bulk-update', { ids: [...selected], patch: { status } });
    clearSelection(); flash(`Updated ${res.updated} CAPA${res.updated === 1 ? '' : 's'} to “${status.replace('_', ' ')}”.`); refreshCA();
  };
  const handleBulkDelete = async () => {
    const ids = [...selected];
    if (tab === 'complaints') {
      const res = await apiPost('/complaints/bulk-delete', { ids });
      flash(`Permanently deleted ${res.deleted} complaint${res.deleted === 1 ? '' : 's'}.`); refreshC(); refreshCA();
    } else {
      const res = await apiPost('/complaints/capas/bulk-delete', { ids });
      flash(`Permanently deleted ${res.deleted} CAPA${res.deleted === 1 ? '' : 's'}.`); refreshCA(); refreshC();
    }
    setConfirmDelete(false); clearSelection();
  };

  const stats = useMemo(() => {
    const c = complaints || [];
    const ca = capas || [];
    return {
      totalComplaints: c.length,
      openComplaints: c.filter(x => !x.resolved).length,
      capaNeeded: c.filter(x => x.capa_needed).length,
      openCAPAs: ca.filter(x => x.status !== 'closed').length,
      totalCAPAs: ca.length,
    };
  }, [complaints, capas]);

  if (loadingC || loadingCA) return <div className="text-center py-12 text-gray-500">Loading...</div>;

  return (
    <div className="space-y-6">
      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <div className="bg-white rounded-xl border p-3 text-center">
          <div className="text-2xl font-bold text-gray-900">{stats.totalComplaints}</div>
          <div className="text-xs text-gray-500">Total Complaints</div>
        </div>
        <div className="bg-white rounded-xl border p-3 text-center">
          <div className="text-2xl font-bold text-orange-600">{stats.openComplaints}</div>
          <div className="text-xs text-gray-500">Open</div>
        </div>
        <div className="bg-white rounded-xl border p-3 text-center">
          <div className="text-2xl font-bold text-red-600">{stats.capaNeeded}</div>
          <div className="text-xs text-gray-500">CAPA Needed</div>
        </div>
        <div className="bg-white rounded-xl border p-3 text-center">
          <div className="text-2xl font-bold text-yellow-600">{stats.openCAPAs}</div>
          <div className="text-xs text-gray-500">Open CAPAs</div>
        </div>
        <div className="bg-white rounded-xl border p-3 text-center">
          <div className="text-2xl font-bold text-green-600">{stats.totalCAPAs - stats.openCAPAs}</div>
          <div className="text-xs text-gray-500">Closed CAPAs</div>
        </div>
      </div>

      {/* Tabs + Controls */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
          <button onClick={() => setTab('complaints')} className={`px-4 py-1.5 rounded-md text-sm font-medium ${tab === 'complaints' ? 'bg-white shadow-sm text-gray-900' : 'text-gray-600'}`}>
            Complaint Log ({(complaints || []).length})
          </button>
          <button onClick={() => setTab('capas')} className={`px-4 py-1.5 rounded-md text-sm font-medium ${tab === 'capas' ? 'bg-white shadow-sm text-gray-900' : 'text-gray-600'}`}>
            CAPA Report Log ({(capas || []).length})
          </button>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-2.5 text-gray-400" />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search..."
              className="pl-8 pr-3 py-2 border border-gray-300 rounded-lg text-sm w-48" />
          </div>
          <select value={filter} onChange={e => setFilter(e.target.value)}
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm">
            <option value="all">All</option>
            <option value="open">Open Only</option>
            {tab === 'complaints' && <option value="capa">CAPA Needed</option>}
          </select>
          {tab === 'complaints' ? (
            <button onClick={() => { setShowForm(true); setEditing(null); }}
              className="flex items-center gap-1 px-3 py-2 bg-powder-600 text-white rounded-lg text-sm font-medium hover:bg-powder-700">
              <Plus size={16} /> Log Complaint
            </button>
          ) : (
            <button onClick={() => { setShowCAPAForm(true); setEditingCAPA(null); }}
              className="flex items-center gap-1 px-3 py-2 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-700">
              <Plus size={16} /> Create CAPA
            </button>
          )}
        </div>
      </div>

      {/* Forms */}
      {showForm && !editing && <ComplaintForm onSave={handleCreateComplaint} onCancel={() => setShowForm(false)} />}
      {editing && <ComplaintForm initial={editing} onSave={handleUpdateComplaint} onCancel={() => setEditing(null)} />}
      {showCAPAForm && !editingCAPA && <CAPAForm complaints={complaints} onSave={handleCreateCAPA} onCancel={() => setShowCAPAForm(false)} />}
      {editingCAPA && <CAPAForm initial={editingCAPA} complaints={complaints} onSave={handleUpdateCAPA} onCancel={() => setEditingCAPA(null)} />}

      {msg && <div className="bg-green-50 border border-green-200 text-green-800 text-sm rounded-lg px-4 py-2">{msg}</div>}

      {canEdit && (
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={toggleAll} disabled={visibleIds.length === 0} className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-powder-600 disabled:opacity-40">
            {allVisibleSelected ? <CheckSquare size={16} className="text-powder-600" /> : <Square size={16} />}
            {allVisibleSelected ? 'Deselect all' : 'Select all'}
          </button>
          {selected.size > 0 && (
            <div className="flex items-center gap-2 flex-wrap flex-1 bg-powder-50 border border-powder-200 rounded-lg px-3 py-1.5">
              <span className="text-sm font-medium text-powder-800">{selected.size} selected</span>
              <div className="flex-1" />
              {tab === 'complaints' ? (
                <>
                  <button onClick={() => handleBulkComplaintUpdate(true)} className="px-3 py-1 bg-white border border-gray-200 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50">Mark resolved</button>
                  <button onClick={() => handleBulkComplaintUpdate(false)} className="px-3 py-1 bg-white border border-gray-200 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50">Mark open</button>
                </>
              ) : (
                <>
                  <button onClick={() => handleBulkCapaUpdate('closed')} className="px-3 py-1 bg-white border border-gray-200 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50">Mark closed</button>
                  <button onClick={() => handleBulkCapaUpdate('open')} className="px-3 py-1 bg-white border border-gray-200 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50">Mark open</button>
                </>
              )}
              {isAdmin && (
                <button onClick={() => setConfirmDelete(true)} className="flex items-center gap-1.5 px-3 py-1 bg-red-600 text-white text-sm font-medium rounded-lg hover:bg-red-700"><Trash2 size={14} /> Delete permanently</button>
              )}
              <button onClick={clearSelection} className="px-3 py-1 text-gray-500 text-sm font-medium rounded-lg hover:bg-gray-100">Clear</button>
            </div>
          )}
        </div>
      )}

      {/* Complaint List */}
      {tab === 'complaints' && (
        <div className="space-y-2">
          {filteredComplaints.map(c => (
            <div key={c.id} className={`bg-white rounded-xl border ${c.capa_needed && !c.resolved ? 'border-red-200' : 'border-gray-200'}`}>
              <div className="px-4 py-3 flex items-center justify-between cursor-pointer" onClick={() => setExpanded(expanded === c.id ? null : c.id)}>
                <div className="flex items-center gap-3 min-w-0">
                  {canEdit && (
                    <button onClick={e => { e.stopPropagation(); toggleOne(c.id); }} className="text-gray-400 hover:text-powder-600 shrink-0" title={selected.has(c.id) ? 'Deselect' : 'Select'}>
                      {selected.has(c.id) ? <CheckSquare size={16} className="text-powder-600" /> : <Square size={16} />}
                    </button>
                  )}
                  <span className="text-sm font-mono font-bold text-gray-900">{c.complaint_number}</span>
                  <span className="text-sm text-gray-600 truncate">{c.customer_name}</span>
                  <span className="text-xs text-gray-400">{c.date_received}</span>
                  {c.capa_needed ? <span className="px-1.5 py-0.5 bg-red-100 text-red-700 rounded text-[10px] font-bold">CAPA</span> : null}
                  {c.capa_number ? <span className="px-1.5 py-0.5 bg-purple-100 text-purple-700 rounded text-[10px] font-bold">{c.capa_number}</span> : null}
                </div>
                <div className="flex items-center gap-2">
                  <span className={`px-2 py-0.5 rounded-full text-xs ${c.resolved ? 'bg-green-100 text-green-800' : 'bg-orange-100 text-orange-800'}`}>
                    {c.resolved ? 'Resolved' : 'Open'}
                  </span>
                  <button onClick={e => { e.stopPropagation(); setEditing(c); setShowForm(false); }} className="text-gray-400 hover:text-powder-600">
                    <Edit2 size={14} />
                  </button>
                  {expanded === c.id ? <ChevronUp size={16} className="text-gray-400" /> : <ChevronDown size={16} className="text-gray-400" />}
                </div>
              </div>
              {expanded === c.id && (
                <div className="px-4 pb-4 border-t border-gray-100 pt-3 space-y-2">
                  <DetailRow label="Complaint" value={c.complaint_text} />
                  {c.lot_number && <DetailRow label="Lot" value={`${c.lot_number}${c.item_number ? ` / Item: ${c.item_number}` : ''}`} />}
                  <DetailRow label="Responsible" value={c.person_responsible} />
                  <DetailRow label="Investigation" value={c.investigation} />
                  <DetailRow label="Corrective Action" value={c.corrective_action} />
                  <DetailRow label="Resolved" value={c.date_resolved} />
                  {c.capa_needed && !c.capa_id && (
                    <button onClick={() => { setShowCAPAForm(true); setEditingCAPA(null); setTab('capas'); }}
                      className="flex items-center gap-1 px-3 py-1.5 bg-red-50 text-red-700 rounded-lg text-xs font-medium hover:bg-red-100 border border-red-200">
                      <FileWarning size={14} /> Create CAPA for this complaint
                    </button>
                  )}
                </div>
              )}
            </div>
          ))}
          {filteredComplaints.length === 0 && <div className="text-center py-8 text-gray-500 text-sm">No complaints found</div>}
        </div>
      )}

      {/* CAPA Report Log */}
      {tab === 'capas' && (
        <div className="space-y-2">
          {filteredCAPAs.map(ca => (
            <div key={ca.id} className={`bg-white rounded-xl border ${ca.status === 'open' || ca.status === 'in_progress' ? 'border-red-200' : 'border-gray-200'}`}>
              <div className="px-4 py-3 flex items-center justify-between cursor-pointer" onClick={() => setExpanded(expanded === ca.id ? null : ca.id)}>
                <div className="flex items-center gap-3 min-w-0">
                  {canEdit && (
                    <button onClick={e => { e.stopPropagation(); toggleOne(ca.id); }} className="text-gray-400 hover:text-powder-600 shrink-0" title={selected.has(ca.id) ? 'Deselect' : 'Select'}>
                      {selected.has(ca.id) ? <CheckSquare size={16} className="text-powder-600" /> : <Square size={16} />}
                    </button>
                  )}
                  <span className="text-sm font-mono font-bold text-red-700">{ca.capa_number}</span>
                  <span className="text-sm text-gray-800 truncate">{ca.title}</span>
                  {ca.item_description && <span className="text-xs text-gray-400 truncate hidden sm:inline">{ca.item_description}</span>}
                  {ca.linked_complaint_number && <span className="px-1.5 py-0.5 bg-gray-100 text-gray-600 rounded text-[10px] font-bold">{ca.linked_complaint_number}</span>}
                </div>
                <div className="flex items-center gap-2">
                  {ca.is_preventive_action ? <span className="px-1.5 py-0.5 bg-indigo-100 text-indigo-700 rounded text-[10px] font-bold">PA</span> : null}
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${PRIORITY_COLORS[ca.priority]}`}>{ca.priority}</span>
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[ca.status]}`}>{ca.status.replace('_', ' ')}</span>
                  <button onClick={e => { e.stopPropagation(); setEditingCAPA(ca); setShowCAPAForm(false); }} className="text-gray-400 hover:text-red-600">
                    <Edit2 size={14} />
                  </button>
                  {expanded === ca.id ? <ChevronUp size={16} className="text-gray-400" /> : <ChevronDown size={16} className="text-gray-400" />}
                </div>
              </div>
              {expanded === ca.id && (
                <div className="px-4 pb-4 border-t border-gray-100 pt-3 space-y-3">
                  {/* Info row */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs p-2 bg-gray-50 rounded-lg">
                    <div><span className="text-gray-500">Date Issued:</span> <span className="font-medium">{ca.date_issued || '—'}</span></div>
                    <div><span className="text-gray-500">Investigator:</span> <span className="font-medium">{ca.assigned_to || '—'}</span></div>
                    <div><span className="text-gray-500">Lot:</span> <span className="font-medium">{ca.item_lot || '—'}</span></div>
                    <div><span className="text-gray-500">Item #:</span> <span className="font-medium">{ca.item_number || '—'}</span></div>
                    <div><span className="text-gray-500">W/O:</span> <span className="font-medium">{ca.work_order_number || '—'}</span></div>
                    <div><span className="text-gray-500">Source:</span> <span className="font-medium">{(ca.source_type || '—').replace('_', ' ')}</span></div>
                    <div><span className="text-gray-500">Doc Series:</span> <span className="font-medium">{ca.series_of_document || '—'}</span></div>
                    <div><span className="text-gray-500">Correction:</span> <span className="font-medium">{ca.immediate_correction || '—'}</span></div>
                  </div>

                  <DetailRow label="Description" value={ca.description} />
                  <DetailRow label="Root Cause" value={ca.root_cause} />
                  <DetailRow label="Proposed Solution" value={ca.proposed_solution} />
                  <DetailRow label="Corrective Action" value={ca.corrective_action} />
                  <DetailRow label="Preventive Action" value={ca.preventive_action} />

                  {(ca.mgmt_verification_date || ca.mgmt_verification_by) && (
                    <div className="p-2 bg-blue-50 rounded-lg text-xs">
                      <span className="font-medium text-blue-700">Management Verification:</span>{' '}
                      {ca.mgmt_verification_by && <span>{ca.mgmt_verification_by}</span>}
                      {ca.mgmt_verification_date && <span> on {ca.mgmt_verification_date}</span>}
                    </div>
                  )}
                  <DetailRow label="Verification Notes" value={ca.verification_notes} />
                  {ca.closed_at && <DetailRow label="Closed" value={`${new Date(ca.closed_at).toLocaleDateString()} by ${ca.closed_by}`} />}
                </div>
              )}
            </div>
          ))}
          {filteredCAPAs.length === 0 && <div className="text-center py-8 text-gray-500 text-sm">No CAPAs found</div>}
        </div>
      )}

      {confirmDelete && (
        <ConfirmDeleteModal count={selected.size} noun={tab === 'complaints' ? 'complaint' : 'CAPA'} onConfirm={handleBulkDelete} onClose={() => setConfirmDelete(false)} />
      )}
    </div>
  );
}
