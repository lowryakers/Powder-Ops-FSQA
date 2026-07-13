import { useState } from 'react';
import { useApiGet, apiPost, apiPut, apiFetch } from '../../hooks/useApi';
import { useAuth } from '../../hooks/useAuth';
import { canEditModule } from '../../utils/permissions';
import FileUpload from '../FileUpload';
import { Plus, Search, Edit2, Trash2, Download, Upload, X, Trash, ChevronDown, ChevronRight, Check, Paperclip, FileText } from 'lucide-react';

const CATEGORIES = [
  { value: '', label: '—' },
  { value: 'raw_material', label: 'Raw Material / Component' },
  { value: 'finished_good', label: 'Finished Good' },
  { value: 'document', label: 'Document' },
];
const CAT_LABEL = Object.fromEntries(CATEGORIES.map(c => [c.value, c.label]));
const APPROVAL_ROLES = [
  ['ops_manager', 'Operations Manager'],
  ['quality_control', 'Quality Control'],
  ['warehouse_manager', 'Warehouse Manager'],
  ['disposal_by', 'Disposal done by'],
  ['witnessed_by', 'Disposal witnessed by'],
];
const REV_OPTIONS = ['V1', 'V2', 'V3', 'V4', 'V5'];
const emptyItem = () => ({ item_name: '', item_number: '', lot_number: '', quantity: '', category: '', reason_disposed: '', date_disposed: '', write_off_number: '' });

async function downloadDisposalPdf(id, num) {
  const t = localStorage.getItem('auth_token');
  const r = await fetch(`/api/disposals/${id}/pdf`, { headers: { Authorization: `Bearer ${t}` } });
  if (!r.ok) return;
  const b = await r.blob();
  const u = URL.createObjectURL(b);
  const a = document.createElement('a');
  a.href = u; a.download = `Disposal_${(num || id).toString().replace(/[^a-zA-Z0-9_-]/g, '_')}.pdf`;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(u);
}

/* ───────── Create / edit (digital Form 411-1) ───────── */
function DisposalForm({ initial, onSave, onCancel }) {
  const [form, setForm] = useState(() => ({
    disposal_number: initial?.disposal_number || '',
    document_rev: initial?.document_rev || 'V4',
    disposal_date: initial?.disposal_date || '',
    notes: initial?.notes || '',
    scanned: !!initial?.scanned,
    document_url: initial?.document_url || '',
    approvals: initial?.approvals || {},
    items: initial?.items?.length ? initial.items.map(i => ({ ...i })) : [emptyItem()],
  }));
  const [saving, setSaving] = useState(false);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const setItem = (idx, k, v) => setForm(f => ({ ...f, items: f.items.map((it, i) => i === idx ? { ...it, [k]: v } : it) }));
  const addItem = () => setForm(f => ({ ...f, items: [...f.items, emptyItem()] }));
  const removeItem = (idx) => setForm(f => ({ ...f, items: f.items.filter((_, i) => i !== idx) }));
  const setApproval = (role, field, v) => setForm(f => ({ ...f, approvals: { ...f.approvals, [role]: { ...(f.approvals[role] || {}), [field]: v } } }));

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await onSave({ ...form, items: form.items.filter(it => it.item_name || it.item_number || it.lot_number) });
    } finally { setSaving(false); }
  };

  const docFiles = form.document_url ? [{ url: form.document_url, originalName: 'Scanned form' }] : [];

  return (
    <div className="fixed inset-0 bg-black/30 z-50 flex items-start justify-center p-4 overflow-y-auto" onClick={onCancel}>
      <form onClick={e => e.stopPropagation()} onSubmit={submit} className="bg-white rounded-xl shadow-xl w-full max-w-5xl my-6 p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-gray-900">{initial?.id ? 'Edit Disposal' : 'New Disposal'} <span className="text-xs font-normal text-gray-400">(Form 411-1)</span></h3>
          <button type="button" onClick={onCancel} className="p-1 hover:bg-gray-100 rounded-lg"><X size={18} className="text-gray-500" /></button>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Disposal #</label>
            <input value={form.disposal_number} onChange={e => set('disposal_number', e.target.value)} placeholder="e.g. 007"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Form Rev</label>
            <select value={form.document_rev} onChange={e => set('document_rev', e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
              {REV_OPTIONS.map(v => <option key={v} value={v}>{v}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Date</label>
            <input type="date" value={form.disposal_date || ''} onChange={e => set('disposal_date', e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
          </div>
          <label className="flex items-center gap-2 text-sm text-gray-700 mt-6">
            <input type="checkbox" checked={form.scanned} onChange={e => set('scanned', e.target.checked)} className="rounded border-gray-300" />
            Form scanned
          </label>
        </div>

        {/* Line items */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="block text-xs font-medium text-gray-700">Items disposed</label>
            <button type="button" onClick={addItem} className="text-xs font-medium text-powder-600 hover:underline flex items-center gap-1"><Plus size={12} /> Add item</button>
          </div>
          <div className="overflow-x-auto border border-gray-200 rounded-lg">
            <table className="w-full text-xs">
              <thead className="bg-gray-50 text-gray-500">
                <tr>
                  <th className="px-1 py-1.5 w-6">#</th>
                  <th className="text-left px-2 py-1.5 min-w-[160px]">Product Description</th>
                  <th className="text-left px-2 py-1.5">Item #</th>
                  <th className="text-left px-2 py-1.5">Lot #</th>
                  <th className="text-left px-2 py-1.5">Quantity</th>
                  <th className="text-left px-2 py-1.5">Category</th>
                  <th className="text-left px-2 py-1.5 min-w-[140px]">Reason</th>
                  <th className="text-left px-2 py-1.5">Date</th>
                  <th className="text-left px-2 py-1.5">Write-off #</th>
                  <th className="px-1 py-1.5"></th>
                </tr>
              </thead>
              <tbody>
                {form.items.map((it, i) => (
                  <tr key={i} className="border-t border-gray-100">
                    <td className="px-1 py-1 text-center text-gray-400">{i + 1}</td>
                    <td className="px-1 py-1"><input value={it.item_name || ''} onChange={e => setItem(i, 'item_name', e.target.value)} className="w-full px-1.5 py-1 border border-gray-200 rounded" /></td>
                    <td className="px-1 py-1"><input value={it.item_number || ''} onChange={e => setItem(i, 'item_number', e.target.value)} className="w-20 px-1.5 py-1 border border-gray-200 rounded" /></td>
                    <td className="px-1 py-1"><input value={it.lot_number || ''} onChange={e => setItem(i, 'lot_number', e.target.value)} className="w-24 px-1.5 py-1 border border-gray-200 rounded" /></td>
                    <td className="px-1 py-1"><input value={it.quantity || ''} onChange={e => setItem(i, 'quantity', e.target.value)} placeholder="e.g. 0.63 Kg" className="w-24 px-1.5 py-1 border border-gray-200 rounded" /></td>
                    <td className="px-1 py-1">
                      <select value={it.category || ''} onChange={e => setItem(i, 'category', e.target.value)} className="px-1 py-1 border border-gray-200 rounded">
                        {CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                      </select>
                    </td>
                    <td className="px-1 py-1"><input value={it.reason_disposed || ''} onChange={e => setItem(i, 'reason_disposed', e.target.value)} className="w-full px-1.5 py-1 border border-gray-200 rounded" /></td>
                    <td className="px-1 py-1"><input value={it.date_disposed || ''} onChange={e => setItem(i, 'date_disposed', e.target.value)} placeholder="MM/DD/YYYY" className="w-24 px-1.5 py-1 border border-gray-200 rounded" /></td>
                    <td className="px-1 py-1"><input value={it.write_off_number || ''} onChange={e => setItem(i, 'write_off_number', e.target.value)} className="w-24 px-1.5 py-1 border border-gray-200 rounded" /></td>
                    <td className="px-1 py-1 text-center">
                      {form.items.length > 1 && <button type="button" onClick={() => removeItem(i)} className="text-gray-300 hover:text-red-500"><Trash size={13} /></button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Approvals */}
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Approvals</label>
          <div className="grid sm:grid-cols-2 gap-2">
            {APPROVAL_ROLES.map(([role, label]) => (
              <div key={role} className="flex items-center gap-2">
                <span className="text-xs text-gray-500 w-40 shrink-0">{label}</span>
                <input value={form.approvals[role]?.name || ''} onChange={e => setApproval(role, 'name', e.target.value)} placeholder="Name"
                  className="flex-1 px-2 py-1 border border-gray-200 rounded text-xs" />
                <input type="date" value={form.approvals[role]?.date || ''} onChange={e => setApproval(role, 'date', e.target.value)}
                  className="px-2 py-1 border border-gray-200 rounded text-xs" />
              </div>
            ))}
          </div>
        </div>

        <div className="grid sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Notes</label>
            <textarea value={form.notes} onChange={e => set('notes', e.target.value)} rows={2} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Scanned form (optional — historical)</label>
            <FileUpload files={docFiles} maxFiles={1} onChange={(files) => set('document_url', files[0]?.url || '')} />
          </div>
        </div>

        <div className="flex items-center gap-2 pt-1">
          <button type="submit" disabled={saving} className="flex-1 px-4 py-2 bg-powder-600 text-white text-sm font-medium rounded-lg hover:bg-powder-700 disabled:opacity-50">{saving ? 'Saving…' : 'Save Disposal'}</button>
          <button type="button" onClick={onCancel} className="px-4 py-2 bg-gray-100 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-200">Cancel</button>
        </div>
      </form>
    </div>
  );
}

/* ───────── CSV log import ───────── */
function CsvImportModal({ onImported, onClose }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const handleFile = async (file) => {
    if (!file) return;
    setBusy(true); setError(null);
    try {
      const csv = await file.text();
      const res = await apiPost('/disposals/import', { csv });
      onImported(res);
    } catch (err) {
      console.error(err); setError(err.message || 'Import failed.'); setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/30 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-5 space-y-4" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-gray-900">Import Disposal Log (CSV)</h3>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded-lg"><X size={18} className="text-gray-500" /></button>
        </div>
        <p className="text-xs text-gray-500">Upload the exported Disposal Log CSV. Rows are grouped by disposal number (carried forward on blank rows), and each row becomes a line item.</p>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <label className={`flex flex-col items-center justify-center gap-2 border-2 border-dashed border-gray-300 rounded-xl py-10 cursor-pointer hover:bg-gray-50 ${busy ? 'opacity-60 pointer-events-none' : ''}`}>
          <Upload size={26} className="text-gray-400" />
          <span className="text-sm text-gray-600 font-medium">{busy ? 'Importing…' : 'Choose CSV file'}</span>
          <input type="file" accept=".csv,text/csv" className="hidden" onChange={e => handleFile(e.target.files?.[0])} />
        </label>
      </div>
    </div>
  );
}

/* ───────── View ───────── */
function DisposalView({ d, canEdit, onEdit, onDelete, onClose }) {
  return (
    <div className="fixed inset-0 bg-black/30 z-50 flex items-start justify-center p-4 overflow-y-auto" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-3xl my-6" onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between px-5 py-4 border-b border-gray-200">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-semibold text-gray-900">Disposal {d.disposal_number || '—'}</span>
              {d.document_rev && <span className="text-xs text-gray-400">{d.document_rev}</span>}
              {d.scanned ? <span className="px-2 py-0.5 rounded-full text-xs bg-green-100 text-green-700 flex items-center gap-1"><Check size={11} /> Scanned</span> : <span className="px-2 py-0.5 rounded-full text-xs bg-amber-100 text-amber-700">Not scanned</span>}
            </div>
            <p className="text-xs text-gray-500 mt-0.5">{d.disposal_date || ''} · {d.items?.length || 0} item{d.items?.length === 1 ? '' : 's'}</p>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded-lg"><X size={18} className="text-gray-500" /></button>
        </div>
        <div className="px-5 py-4 max-h-[55vh] overflow-y-auto">
          <div className="overflow-x-auto border border-gray-200 rounded-lg">
            <table className="w-full text-xs">
              <thead className="bg-gray-50 text-gray-500">
                <tr>
                  <th className="text-left px-2 py-1.5">Product</th><th className="text-left px-2 py-1.5">Item #</th>
                  <th className="text-left px-2 py-1.5">Lot #</th><th className="text-left px-2 py-1.5">Qty</th>
                  <th className="text-left px-2 py-1.5">Reason</th><th className="text-left px-2 py-1.5">Date</th><th className="text-left px-2 py-1.5">Write-off</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {(d.items || []).map(it => (
                  <tr key={it.id}>
                    <td className="px-2 py-1.5 text-gray-800">{it.item_name}{it.category ? <span className="block text-[10px] text-gray-400">{CAT_LABEL[it.category] || it.category}</span> : null}</td>
                    <td className="px-2 py-1.5 text-gray-600 whitespace-nowrap">{it.item_number || '—'}</td>
                    <td className="px-2 py-1.5 text-gray-600 whitespace-nowrap">{it.lot_number || '—'}</td>
                    <td className="px-2 py-1.5 text-gray-600 whitespace-nowrap">{it.quantity || '—'}</td>
                    <td className="px-2 py-1.5 text-gray-600">{it.reason_disposed || '—'}</td>
                    <td className="px-2 py-1.5 text-gray-600 whitespace-nowrap">{it.date_disposed || '—'}</td>
                    <td className="px-2 py-1.5 text-gray-600 whitespace-pre-line">{it.write_off_number || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {d.document_url && (
            <a href={d.document_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 mt-3 text-sm text-powder-600 hover:underline">
              <Paperclip size={14} /> View scanned form
            </a>
          )}
          {d.notes && <p className="text-xs text-gray-500 mt-3">{d.notes}</p>}
        </div>
        <div className="flex items-center gap-2 px-5 py-3 border-t border-gray-200">
          <button onClick={() => downloadDisposalPdf(d.id, d.disposal_number)} className="px-3 py-1.5 bg-gray-100 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-200 flex items-center gap-1.5"><Download size={14} /> PDF</button>
          <div className="flex-1" />
          {canEdit && <button onClick={() => onDelete(d)} className="px-3 py-1.5 text-red-600 text-sm font-medium rounded-lg hover:bg-red-50 flex items-center gap-1.5"><Trash2 size={14} /> Delete</button>}
          {canEdit && <button onClick={() => onEdit(d)} className="px-3 py-1.5 bg-powder-600 text-white text-sm font-medium rounded-lg hover:bg-powder-700 flex items-center gap-1.5"><Edit2 size={14} /> Edit</button>}
        </div>
      </div>
    </div>
  );
}

/* ───────── Panel ───────── */
export default function DisposalsPanel() {
  const { user } = useAuth() || {};
  const canEdit = canEditModule(user, 'disposals');
  const { data: disposals, loading, refresh } = useApiGet('/disposals');
  const { data: summary } = useApiGet('/disposals/summary');
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState({});
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState(null);
  const [viewing, setViewing] = useState(null);
  const [importing, setImporting] = useState(false);
  const [msg, setMsg] = useState(null);

  const q = search.toLowerCase().trim();
  const filtered = (disposals || []).filter(d => !q ||
    (d.disposal_number || '').toLowerCase().includes(q) ||
    (d.items || []).some(it => [it.item_name, it.item_number, it.lot_number, it.write_off_number, it.reason_disposed].some(v => v && v.toLowerCase().includes(q))));

  const handleCreate = async (form) => { await apiPost('/disposals', form); setCreating(false); refresh(); };
  const handleUpdate = async (form) => { await apiPut(`/disposals/${editing.id}`, form); setEditing(null); setViewing(null); refresh(); };
  const handleDelete = async (d) => { if (!window.confirm(`Delete disposal ${d.disposal_number || ''} and its ${d.items?.length || 0} item(s)?`)) return; await apiFetch(`/disposals/${d.id}`, { method: 'DELETE' }); setViewing(null); refresh(); };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="text-xl font-bold text-gray-900">Disposals</h2>
          <p className="text-sm text-gray-500">{filtered.length} disposal{filtered.length === 1 ? '' : 's'}</p>
        </div>
        {canEdit && (
          <div className="flex items-center gap-2">
            <button onClick={() => setImporting(true)} className="flex items-center gap-1.5 px-3 py-2 bg-gray-100 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-200"><Upload size={15} /> Import Log (CSV)</button>
            <button onClick={() => setCreating(true)} className="flex items-center gap-1.5 px-4 py-2 bg-powder-600 text-white text-sm font-medium rounded-lg hover:bg-powder-700"><Plus size={16} /> New Disposal</button>
          </div>
        )}
      </div>

      {msg && <div className="bg-green-50 border border-green-200 text-green-800 text-sm rounded-lg px-4 py-2">{msg}</div>}

      {summary && (
        <div className="grid grid-cols-3 gap-3">
          <div className="bg-white rounded-xl border border-gray-200 p-3"><p className="text-2xl font-bold text-gray-900">{summary.total_disposals}</p><p className="text-xs text-gray-500">Disposals</p></div>
          <div className="bg-white rounded-xl border border-gray-200 p-3"><p className="text-2xl font-bold text-gray-900">{summary.total_items}</p><p className="text-xs text-gray-500">Items disposed</p></div>
          <div className={`rounded-xl border p-3 ${summary.unscanned > 0 ? 'border-amber-200 bg-amber-50' : 'border-gray-200 bg-white'}`}><p className={`text-2xl font-bold ${summary.unscanned > 0 ? 'text-amber-700' : 'text-gray-900'}`}>{summary.unscanned}</p><p className="text-xs text-gray-500">Forms not scanned</p></div>
        </div>
      )}

      <div className="relative">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search item, lot, write-off, disposal #…" className="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-powder-500" />
      </div>

      {loading ? (
        <div className="text-center py-12 text-gray-500">Loading disposals…</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 text-gray-400"><FileText size={36} className="mx-auto mb-2 text-gray-300" /><p className="text-sm">No disposals yet.{canEdit ? ' Create one or import your log.' : ''}</p></div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100">
          {filtered.map(d => {
            const isOpen = expanded[d.id];
            return (
              <div key={d.id}>
                <div className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50">
                  <button onClick={() => setExpanded(e => ({ ...e, [d.id]: !e[d.id] }))} className="text-gray-400 shrink-0">
                    {isOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                  </button>
                  <div className="flex-1 min-w-0 cursor-pointer" onClick={() => setViewing(d)}>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-gray-900 text-sm">{d.disposal_number || 'Unnumbered'}</span>
                      {d.document_rev && <span className="text-[11px] text-gray-400">{d.document_rev}</span>}
                      <span className="text-xs text-gray-500">· {d.items?.length || 0} item{d.items?.length === 1 ? '' : 's'}</span>
                      {d.disposal_date && <span className="text-xs text-gray-400">· {d.disposal_date}</span>}
                    </div>
                    <p className="text-xs text-gray-500 truncate">{(d.items || []).slice(0, 3).map(i => i.item_name).filter(Boolean).join(', ')}{(d.items?.length || 0) > 3 ? '…' : ''}</p>
                  </div>
                  {d.scanned
                    ? <span className="px-2 py-0.5 rounded-full text-[11px] bg-green-100 text-green-700 shrink-0 flex items-center gap-1"><Check size={10} /> Scanned</span>
                    : <span className="px-2 py-0.5 rounded-full text-[11px] bg-amber-100 text-amber-700 shrink-0">Not scanned</span>}
                  <button onClick={() => downloadDisposalPdf(d.id, d.disposal_number)} className="p-1 text-gray-400 hover:text-gray-700 shrink-0" title="PDF"><Download size={15} /></button>
                  {canEdit && <button onClick={() => setEditing(d)} className="p-1 text-gray-400 hover:text-powder-600 shrink-0" title="Edit"><Edit2 size={15} /></button>}
                </div>
                {isOpen && (
                  <div className="px-4 pb-3 overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead className="text-gray-400">
                        <tr><th className="text-left px-2 py-1">Product</th><th className="text-left px-2 py-1">Item #</th><th className="text-left px-2 py-1">Lot #</th><th className="text-left px-2 py-1">Qty</th><th className="text-left px-2 py-1">Reason</th><th className="text-left px-2 py-1">Write-off</th></tr>
                      </thead>
                      <tbody className="divide-y divide-gray-50">
                        {(d.items || []).map(it => (
                          <tr key={it.id}>
                            <td className="px-2 py-1 text-gray-800">{it.item_name}</td>
                            <td className="px-2 py-1 text-gray-500 whitespace-nowrap">{it.item_number || '—'}</td>
                            <td className="px-2 py-1 text-gray-500 whitespace-nowrap">{it.lot_number || '—'}</td>
                            <td className="px-2 py-1 text-gray-500 whitespace-nowrap">{it.quantity || '—'}</td>
                            <td className="px-2 py-1 text-gray-500">{it.reason_disposed || '—'}</td>
                            <td className="px-2 py-1 text-gray-500 whitespace-pre-line">{it.write_off_number || '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {creating && <DisposalForm onSave={handleCreate} onCancel={() => setCreating(false)} />}
      {editing && <DisposalForm initial={editing} onSave={handleUpdate} onCancel={() => setEditing(null)} />}
      {viewing && !editing && <DisposalView d={viewing} canEdit={canEdit} onEdit={(d) => { setViewing(null); setEditing(d); }} onDelete={handleDelete} onClose={() => setViewing(null)} />}
      {importing && <CsvImportModal onClose={() => setImporting(false)} onImported={(res) => { setImporting(false); setMsg(`Imported ${res.disposals} disposals (${res.items} items).`); setTimeout(() => setMsg(null), 6000); refresh(); }} />}
    </div>
  );
}
