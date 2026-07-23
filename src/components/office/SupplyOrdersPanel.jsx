import { useState, useMemo, useRef } from 'react';
import { useApiGet, apiPost, apiPut, apiFetch, apiUpload } from '../../hooks/useApi';
import { useAuth } from '../../hooks/useAuth';
import { Search, Repeat, Trash2, Upload, FileText, Download, AlertTriangle, ExternalLink, Pencil, X, ChevronUp, ChevronDown } from 'lucide-react';
import FilePreview from '../FilePreview.jsx';

const LABELS = ['Warehouse/Production', 'Cleaning', 'Break room', 'Maintenance', 'Office'];
const STATUS_FLOW = ['new', 'ordered', 'received', 'paid'];
const STATUS_META = {
  new: { label: 'New', tone: 'bg-blue-100 text-blue-700', next: 'ordered', nextLabel: 'Mark ordered' },
  ordered: { label: 'Ordered', tone: 'bg-amber-100 text-amber-700', next: 'received', nextLabel: 'Mark received' },
  received: { label: 'Received', tone: 'bg-green-100 text-green-700', next: 'paid', nextLabel: 'Mark paid' },
  paid: { label: 'Paid', tone: 'bg-gray-100 text-gray-600', next: null },
};

// Request form — supervisors + admins. Autocompletes from order history so a
// repeat item fills supplier/link/uom/label in one pick.
export function OrderForm({ items, onCreated }) {
  const blank = { item_name: '', qty: '', uom: '', supplier: '', link: '', label: '', urgent: false, notes: '' };
  const [form, setForm] = useState(blank);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState(null);

  const pickHistory = (name) => {
    const h = (items || []).find(i => i.item_name.toLowerCase() === name.toLowerCase());
    if (h) setForm(f => ({ ...f, item_name: h.item_name, uom: h.uom || f.uom, supplier: h.supplier || f.supplier, link: h.link || f.link, label: h.label || f.label, qty: f.qty || h.qty || '' }));
  };

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true); setMsg(null);
    try {
      await apiPost('/office/supply/orders', { ...form, qty: form.qty === '' ? null : Number(form.qty) });
      setMsg(`Requested: ${form.item_name}`);
      setForm(blank);
      onCreated?.();
    } catch (err) { setMsg(err.message || 'Failed'); }
    finally { setSaving(false); }
  };

  return (
    <form onSubmit={submit} className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
      <h3 className="font-semibold text-gray-900">Request a supply order</h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="sm:col-span-2">
          <label className="block text-xs font-medium text-gray-700 mb-1">Item *</label>
          <input required list="supply-item-history" value={form.item_name}
            onChange={e => { setForm({ ...form, item_name: e.target.value }); pickHistory(e.target.value); }}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" placeholder="Start typing — past orders autocomplete" />
          <datalist id="supply-item-history">
            {(items || []).map((i, k) => <option key={k} value={i.item_name}>{i.supplier || ''}</option>)}
          </datalist>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Qty</label>
            <input type="number" min="0" step="any" value={form.qty} onChange={e => setForm({ ...form, qty: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Unit</label>
            <input value={form.uom} onChange={e => setForm({ ...form, uom: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" placeholder="box, bag, case…" />
          </div>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Supplier</label>
          <input value={form.supplier} onChange={e => setForm({ ...form, supplier: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" placeholder="Amazon, Costco…" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Link</label>
          <input value={form.link} onChange={e => setForm({ ...form, link: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" placeholder="https://…" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">For</label>
          <select value={form.label} onChange={e => setForm({ ...form, label: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white">
            <option value="">—</option>
            {LABELS.map(l => <option key={l} value={l}>{l}</option>)}
          </select>
        </div>
        <div className="sm:col-span-2">
          <label className="block text-xs font-medium text-gray-700 mb-1">Notes</label>
          <input value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" placeholder="Anything the orderer should know" />
        </div>
      </div>
      <div className="flex items-center gap-3">
        <button type="submit" disabled={saving} className="px-4 py-2 bg-powder-600 text-white rounded-lg text-sm font-medium hover:bg-powder-700 disabled:opacity-50">
          {saving ? 'Submitting…' : 'Submit request'}
        </button>
        <label className="flex items-center gap-1.5 text-sm text-gray-700 cursor-pointer">
          <input type="checkbox" checked={form.urgent} onChange={e => setForm({ ...form, urgent: e.target.checked })} className="rounded border-gray-300" />
          <span className="inline-flex items-center gap-1"><AlertTriangle size={13} className="text-red-500" /> Urgent</span>
        </label>
        {msg && <span className="text-sm text-green-600">{msg}</span>}
      </div>
    </form>
  );
}

// Frequently ordered: one-click "Order again" for the admin's ad-hoc repeats.
export function QuickReorder({ items, onCreated }) {
  const top = (items || []).filter(i => i.times_ordered > 1).slice(0, 10);
  const [busy, setBusy] = useState(null);
  if (!top.length) return null;
  const orderAgain = async (i) => {
    setBusy(i.item_name);
    try { await apiPost('/office/supply/orders', { item_name: i.item_name, qty: i.qty, uom: i.uom, supplier: i.supplier, link: i.link, label: i.label }); onCreated?.(); }
    finally { setBusy(null); }
  };
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4">
      <h3 className="text-sm font-semibold text-gray-900 mb-2 flex items-center gap-1.5"><Repeat size={14} className="text-powder-600" /> Frequently ordered</h3>
      <div className="flex flex-wrap gap-1.5">
        {top.map((i, k) => (
          <button key={k} onClick={() => orderAgain(i)} disabled={busy === i.item_name}
            className="px-2.5 py-1.5 rounded-lg border border-gray-200 text-xs text-gray-700 hover:bg-powder-50 hover:border-powder-300 disabled:opacity-50">
            {busy === i.item_name ? 'Adding…' : <>{i.item_name} <span className="text-gray-400">·{i.supplier || '—'} ·{i.times_ordered}x</span></>}
          </button>
        ))}
      </div>
    </div>
  );
}

function EditOrderModal({ order, onClose, onSaved }) {
  const [form, setForm] = useState({ qty: order.qty ?? '', total: order.total ?? '', eta: order.eta || '', supplier: order.supplier || '', link: order.link || '', notes: order.notes || '' });
  const save = async () => {
    await apiPut(`/office/supply/orders/${order.id}`, { ...form, qty: form.qty === '' ? null : Number(form.qty), total: form.total === '' ? null : Number(form.total) });
    onSaved(); onClose();
  };
  return (
    <div className="fixed inset-0 bg-black/30 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div onClick={e => e.stopPropagation()} className="bg-white rounded-xl shadow-xl w-full max-w-md p-5 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-gray-900 truncate">{order.item_name}</h3>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded-lg"><X size={18} className="text-gray-500" /></button>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="block text-xs font-medium text-gray-700 mb-1">Qty</label>
            <input type="number" step="any" value={form.qty} onChange={e => setForm({ ...form, qty: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" /></div>
          <div><label className="block text-xs font-medium text-gray-700 mb-1">Total ($)</label>
            <input type="number" step="0.01" value={form.total} onChange={e => setForm({ ...form, total: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" /></div>
          <div><label className="block text-xs font-medium text-gray-700 mb-1">ETA</label>
            <input type="date" value={form.eta} onChange={e => setForm({ ...form, eta: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" /></div>
          <div><label className="block text-xs font-medium text-gray-700 mb-1">Supplier</label>
            <input value={form.supplier} onChange={e => setForm({ ...form, supplier: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" /></div>
          <div className="col-span-2"><label className="block text-xs font-medium text-gray-700 mb-1">Link</label>
            <input value={form.link} onChange={e => setForm({ ...form, link: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" /></div>
          <div className="col-span-2"><label className="block text-xs font-medium text-gray-700 mb-1">Notes</label>
            <input value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" /></div>
        </div>
        <div className="flex gap-2">
          <button onClick={save} className="px-4 py-2 bg-powder-600 text-white rounded-lg text-sm font-medium hover:bg-powder-700">Save</button>
          <button onClick={onClose} className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm hover:bg-gray-200">Cancel</button>
        </div>
      </div>
    </div>
  );
}

function SortHeader({ label, field, sortField, sortDir, onSort, className = '' }) {
  return (
    <th onClick={() => onSort(field)}
      className={`text-left px-3 py-2.5 font-medium text-gray-600 whitespace-nowrap cursor-pointer select-none hover:text-gray-900 ${className}`}>
      <span className="inline-flex items-center gap-1">{label}{sortField === field && (sortDir === 'asc' ? <ChevronUp size={12} /> : <ChevronDown size={12} />)}</span>
    </th>
  );
}

function OrdersLog({ refreshKey, onChanged }) {
  const [statusFilter, setStatusFilter] = useState('open');
  const [labelFilter, setLabelFilter] = useState('');
  const [q, setQ] = useState('');
  const [sortField, setSortField] = useState('submitted_at');
  const [sortDir, setSortDir] = useState('desc');
  const query = statusFilter === 'open' ? '' : statusFilter === 'all' ? '' : `status=${statusFilter}`;
  const { data: orders, refresh } = useApiGet(`/office/supply/orders?${query}${q ? `&q=${encodeURIComponent(q)}` : ''}`, [statusFilter, q, refreshKey]);
  const [editing, setEditing] = useState(null);
  const onSort = (f) => { if (sortField === f) setSortDir(d => d === 'asc' ? 'desc' : 'asc'); else { setSortField(f); setSortDir(f === 'submitted_at' || f === 'total' ? 'desc' : 'asc'); } };
  const list = useMemo(() => {
    let l = orders || [];
    if (statusFilter === 'open') l = l.filter(o => o.status === 'new' || o.status === 'ordered');
    if (labelFilter) l = l.filter(o => (o.label || '') === labelFilter);
    const dir = sortDir === 'asc' ? 1 : -1;
    const val = (o) => {
      if (sortField === 'qty' || sortField === 'total') return Number(o[sortField] ?? -Infinity);
      if (sortField === 'status') return STATUS_FLOW.indexOf(o.status);
      if (sortField === 'requested_by') return `${o.requested_by || ''}`.toLowerCase();
      if (sortField === 'submitted_at') return o.submitted_at || '';
      return String(o[sortField] ?? '').toLowerCase();
    };
    // Needs-action first: urgent open orders pin to the very top, then new
    // (unordered) requests, then everything else in the chosen sort order —
    // so what Marnee has to act on is always the first thing on screen.
    const actionRank = (o) => {
      const open = o.status === 'new' || o.status === 'ordered';
      if (o.urgent && open) return 0;
      if (o.status === 'new') return 1;
      return 2;
    };
    return [...l].sort((a, b) => {
      const ra = actionRank(a), rb = actionRank(b);
      if (ra !== rb) return ra - rb;
      const av = val(a), bv = val(b);
      return av < bv ? -dir : av > bv ? dir : 0;
    });
  }, [orders, statusFilter, labelFilter, sortField, sortDir]);

  const advance = async (o) => {
    const next = STATUS_META[o.status]?.next;
    if (!next) return;
    await apiPut(`/office/supply/orders/${o.id}`, { status: next });
    refresh(); onChanged?.();
  };
  const del = async (o) => {
    if (!confirm(`Delete "${o.item_name}"?`)) return;
    await apiFetch(`/office/supply/orders/${o.id}`, { method: 'DELETE' });
    refresh();
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        {[['open', 'Open'], ['new', 'New'], ['ordered', 'Ordered'], ['received', 'Received'], ['paid', 'Paid'], ['all', 'All']].map(([v, l]) => (
          <button key={v} onClick={() => setStatusFilter(v)}
            className={`px-2.5 py-1 rounded-lg text-xs font-medium ${statusFilter === v ? 'bg-gray-800 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>{l}</button>
        ))}
        <select value={labelFilter} onChange={e => setLabelFilter(e.target.value)}
          className="px-2.5 py-1.5 border border-gray-200 rounded-lg text-xs bg-white text-gray-600">
          <option value="">For: all</option>
          {LABELS.map(l => <option key={l} value={l}>{l}</option>)}
        </select>
        <div className="relative flex-1 min-w-[180px]">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search item, supplier…"
            className="w-full pl-8 pr-3 py-1.5 border border-gray-200 rounded-lg text-sm" />
        </div>
      </div>

      {/* Mobile cards */}
      <div className="md:hidden space-y-2">
        {list.map(o => (
          <div key={o.id} className={`bg-white rounded-xl border border-gray-200 border-l-4 ${o.urgent && (o.status === 'new' || o.status === 'ordered') ? 'border-red-400' : 'border-gray-200'} p-3 shadow-sm`}>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <div className="font-medium text-gray-900 break-words">{o.item_name}{o.urgent ? <span className="ml-1.5 text-[10px] font-bold text-red-600">URGENT</span> : null}</div>
                <div className="text-xs text-gray-500">{[o.qty && `${o.qty} ${o.uom || ''}`.trim(), o.supplier, o.label].filter(Boolean).join(' · ')}</div>
              </div>
              <span className={`shrink-0 px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_META[o.status].tone}`}>{STATUS_META[o.status].label}</span>
            </div>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500">
              <span>{o.requested_by || '—'} · {(o.submitted_at || '').slice(0, 10)}</span>
              {o.total != null && <span>${Number(o.total).toFixed(2)}</span>}
              {o.link && <a href={o.link} target="_blank" rel="noreferrer" className="text-powder-600 inline-flex items-center gap-0.5">link <ExternalLink size={10} /></a>}
            </div>
            <div className="mt-2 flex items-center gap-2">
              {STATUS_META[o.status].next && (
                <button onClick={() => advance(o)} className="px-2.5 py-1 bg-powder-600 text-white rounded-lg text-xs font-medium">{STATUS_META[o.status].nextLabel}</button>
              )}
              <button onClick={() => setEditing(o)} className="px-2 py-1 text-gray-500 text-xs rounded-lg hover:bg-gray-100">Edit</button>
              <button onClick={() => del(o)} className="px-2 py-1 text-red-500 text-xs rounded-lg hover:bg-red-50">Delete</button>
            </div>
          </div>
        ))}
        {list.length === 0 && <div className="bg-white rounded-xl border border-gray-200 px-4 py-8 text-center text-gray-400 text-sm">No orders</div>}
      </div>

      {/* Desktop table */}
      <div className="hidden md:block bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                <SortHeader label="Item" field="item_name" sortField={sortField} sortDir={sortDir} onSort={onSort} />
                <SortHeader label="Qty" field="qty" sortField={sortField} sortDir={sortDir} onSort={onSort} />
                <SortHeader label="Supplier" field="supplier" sortField={sortField} sortDir={sortDir} onSort={onSort} />
                <SortHeader label="For" field="label" sortField={sortField} sortDir={sortDir} onSort={onSort} />
                <SortHeader label="Requested" field="submitted_at" sortField={sortField} sortDir={sortDir} onSort={onSort} />
                <SortHeader label="Total" field="total" sortField={sortField} sortDir={sortDir} onSort={onSort} />
                <SortHeader label="Status" field="status" sortField={sortField} sortDir={sortDir} onSort={onSort} />
                <th className="px-3 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {list.map(o => (
                <tr key={o.id} className="border-b border-gray-100 hover:bg-gray-50">
                  <td className="px-3 py-2.5 w-full">
                    <span className="font-medium text-gray-900">{o.item_name}</span>
                    {o.urgent && (o.status === 'new' || o.status === 'ordered') && <span className="ml-1.5 text-[10px] font-bold text-red-600">URGENT</span>}
                    {o.link && <a href={o.link} target="_blank" rel="noreferrer" className="ml-1.5 text-powder-600 inline-flex items-center"><ExternalLink size={11} /></a>}
                    {o.notes && <div className="text-[11px] text-gray-400">{o.notes}</div>}
                  </td>
                  <td className="px-3 py-2.5 whitespace-nowrap text-gray-600">{o.qty ?? '—'} {o.uom || ''}</td>
                  <td className="px-3 py-2.5 whitespace-nowrap text-gray-600">{o.supplier || '—'}</td>
                  <td className="px-3 py-2.5 whitespace-nowrap text-gray-500 text-xs">{o.label || '—'}</td>
                  <td className="px-3 py-2.5 whitespace-nowrap text-gray-500 text-xs">{o.requested_by || '—'}<div className="text-gray-400">{(o.submitted_at || '').slice(0, 10)}</div></td>
                  <td className="px-3 py-2.5 whitespace-nowrap text-gray-600">{o.total != null ? `$${Number(o.total).toFixed(2)}` : '—'}</td>
                  <td className="px-3 py-2.5 whitespace-nowrap"><span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_META[o.status].tone}`}>{STATUS_META[o.status].label}</span></td>
                  <td className="px-3 py-2.5 whitespace-nowrap text-right">
                    <div className="flex items-center gap-1 justify-end">
                      {STATUS_META[o.status].next && (
                        <button onClick={() => advance(o)} className="px-2 py-1 bg-powder-600 text-white rounded-lg text-xs font-medium hover:bg-powder-700">{STATUS_META[o.status].nextLabel}</button>
                      )}
                      <button onClick={() => setEditing(o)} className="p-1.5 text-gray-400 hover:text-powder-600" data-tip="Edit"><Pencil size={14} /></button>
                      <button onClick={() => del(o)} className="p-1.5 text-gray-400 hover:text-red-500" data-tip="Delete"><Trash2 size={14} /></button>
                    </div>
                  </td>
                </tr>
              ))}
              {list.length === 0 && <tr><td colSpan={8} className="px-4 py-8 text-center text-gray-400">No orders</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
      {editing && <EditOrderModal order={editing} onClose={() => setEditing(null)} onSaved={refresh} />}
    </div>
  );
}

function EditInvoiceModal({ inv, onClose, onSaved }) {
  const [form, setForm] = useState({ supplier: inv.supplier || '', invoice_date: inv.invoice_date || '', total: inv.total ?? '', notes: inv.notes || '' });
  const save = async () => {
    await apiPut(`/office/supply/invoices/${inv.id}`, { ...form, total: form.total === '' ? null : Number(form.total) });
    onSaved(); onClose();
  };
  return (
    <div className="fixed inset-0 bg-black/30 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div onClick={e => e.stopPropagation()} className="bg-white rounded-xl shadow-xl w-full max-w-md p-5 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-gray-900 truncate">{inv.filename}</h3>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded-lg"><X size={18} className="text-gray-500" /></button>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="block text-xs font-medium text-gray-700 mb-1">Supplier</label>
            <input value={form.supplier} onChange={e => setForm({ ...form, supplier: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" /></div>
          <div><label className="block text-xs font-medium text-gray-700 mb-1">Invoice date</label>
            <input type="date" value={form.invoice_date} onChange={e => setForm({ ...form, invoice_date: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" /></div>
          <div><label className="block text-xs font-medium text-gray-700 mb-1">Total ($)</label>
            <input type="number" step="0.01" value={form.total} onChange={e => setForm({ ...form, total: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" /></div>
          <div><label className="block text-xs font-medium text-gray-700 mb-1">Notes</label>
            <input value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" /></div>
        </div>
        <div className="flex gap-2">
          <button onClick={save} className="px-4 py-2 bg-powder-600 text-white rounded-lg text-sm font-medium hover:bg-powder-700">Save</button>
          <button onClick={onClose} className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm hover:bg-gray-200">Cancel</button>
        </div>
      </div>
    </div>
  );
}

// One repository for every invoice: multi-file upload, search, supplier filter,
// sortable columns. Tag supplier/date/total on a row (pencil) to make the
// filters more useful for accounting later.
function InvoiceRepo() {
  const [q, setQ] = useState('');
  const [supplierFilter, setSupplierFilter] = useState('');
  const [sortField, setSortField] = useState('date');
  const [sortDir, setSortDir] = useState('desc');
  const { data: invoices, refresh } = useApiGet(`/office/supply/invoices${q ? `?q=${encodeURIComponent(q)}` : ''}`, [q]);
  const fileRef = useRef(null);
  const [uploading, setUploading] = useState(false);
  const [editing, setEditing] = useState(null);

  const suppliers = useMemo(() => [...new Set((invoices || []).map(i => i.supplier).filter(Boolean))].sort(), [invoices]);
  const onSort = (f) => { if (sortField === f) setSortDir(d => d === 'asc' ? 'desc' : 'asc'); else { setSortField(f); setSortDir(f === 'date' || f === 'total' ? 'desc' : 'asc'); } };
  const list = useMemo(() => {
    let l = invoices || [];
    if (supplierFilter) l = l.filter(i => (i.supplier || '') === supplierFilter);
    const dir = sortDir === 'asc' ? 1 : -1;
    const val = (i) => {
      if (sortField === 'total') return Number(i.total ?? -Infinity);
      if (sortField === 'date') return i.invoice_date || (i.created_at || '').slice(0, 10);
      return String(i[sortField === 'file' ? 'filename' : sortField] ?? '').toLowerCase();
    };
    return [...l].sort((a, b) => { const av = val(a), bv = val(b); return av < bv ? -dir : av > bv ? dir : 0; });
  }, [invoices, supplierFilter, sortField, sortDir]);

  const upload = async (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    if (!files.length) return;
    setUploading(true);
    try {
      // The server takes up to 20 per request; batch beyond that transparently.
      for (let i = 0; i < files.length; i += 20) {
        const fd = new FormData();
        for (const f of files.slice(i, i + 20)) fd.append('files', f);
        await apiUpload('/office/supply/invoices', fd);
      }
      refresh();
    } catch (err) { alert(err.message || 'Upload failed'); }
    finally { setUploading(false); }
  };
  const del = async (inv) => {
    if (!confirm(`Delete invoice "${inv.filename}"?`)) return;
    await apiFetch(`/office/supply/invoices/${inv.id}`, { method: 'DELETE' });
    refresh();
  };

  // In-app preview overlay: clicking a filename opens the file right here
  // (arrow through neighbors) instead of jumping to a browser tab.
  const [previewIdx, setPreviewIdx] = useState(null);
  const previewItems = list.filter(i => i.url).map(i => ({ url: i.url, name: i.filename }));
  const openPreview = (inv) => {
    const idx = previewItems.findIndex(p => p.url === inv.url);
    if (idx >= 0) setPreviewIdx(idx);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search invoices — filename, supplier, or what's written inside the file…"
            className="w-full pl-8 pr-3 py-2 border border-gray-200 rounded-lg text-sm" />
        </div>
        {suppliers.length > 0 && (
          <select value={supplierFilter} onChange={e => setSupplierFilter(e.target.value)}
            className="px-2.5 py-2 border border-gray-200 rounded-lg text-xs bg-white text-gray-600">
            <option value="">Supplier: all</option>
            {suppliers.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        )}
        <input ref={fileRef} type="file" multiple className="hidden" onChange={upload} accept=".pdf,.png,.jpg,.jpeg,.heic,.webp" />
        <button onClick={() => fileRef.current?.click()} disabled={uploading}
          className="flex items-center gap-1.5 px-3 py-2 bg-powder-600 text-white rounded-lg text-sm font-medium hover:bg-powder-700 disabled:opacity-50">
          <Upload size={15} /> {uploading ? 'Uploading…' : 'Upload invoices'}
        </button>
      </div>

      {/* Mobile cards */}
      <div className="md:hidden space-y-2">
        {list.map(inv => (
          <div key={inv.id} className="bg-white rounded-xl border border-gray-200 p-3 shadow-sm">
            <div className="flex items-start gap-2.5">
              <FileText size={18} className="text-powder-600 shrink-0 mt-0.5" />
              <div className="min-w-0 flex-1">
                <button onClick={() => inv.url ? openPreview(inv) : null} className="text-sm font-medium text-gray-900 break-all text-left">{inv.filename}</button>
                <div className="text-xs text-gray-400 mt-0.5">{[inv.supplier, inv.invoice_date, inv.total != null ? `$${Number(inv.total).toFixed(2)}` : null].filter(Boolean).join(' · ') || 'No details tagged'}</div>
                <div className="text-[11px] text-gray-400">{inv.uploaded_by} · {(inv.created_at || '').slice(0, 10)}</div>
              </div>
              <div className="flex items-center gap-0.5 shrink-0">
                <button onClick={() => setEditing(inv)} className="p-1.5 text-gray-400 hover:text-powder-600"><Pencil size={14} /></button>
                <button onClick={() => del(inv)} className="p-1.5 text-gray-400 hover:text-red-500"><Trash2 size={14} /></button>
              </div>
            </div>
          </div>
        ))}
        {list.length === 0 && <div className="bg-white rounded-xl border border-gray-200 px-4 py-10 text-center text-sm text-gray-400">No invoices yet. Upload PDFs or photos — everything is searchable for accounting later.</div>}
      </div>

      {/* Desktop table */}
      <div className="hidden md:block bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                <SortHeader label="File" field="file" sortField={sortField} sortDir={sortDir} onSort={onSort} />
                <SortHeader label="Supplier" field="supplier" sortField={sortField} sortDir={sortDir} onSort={onSort} />
                <SortHeader label="Date" field="date" sortField={sortField} sortDir={sortDir} onSort={onSort} />
                <SortHeader label="Total" field="total" sortField={sortField} sortDir={sortDir} onSort={onSort} />
                <SortHeader label="Uploaded by" field="uploaded_by" sortField={sortField} sortDir={sortDir} onSort={onSort} />
                <th className="px-3 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {list.map(inv => (
                <tr key={inv.id} className="border-b border-gray-100 hover:bg-gray-50">
                  <td className="px-3 py-2.5 w-full">
                    <button onClick={() => inv.url ? openPreview(inv) : null} className="flex items-center gap-2 font-medium text-gray-900 hover:text-powder-700 text-left">
                      <FileText size={15} className="text-powder-600 shrink-0" /><span className="break-all">{inv.filename}</span>
                    </button>
                    {inv.notes && <div className="text-[11px] text-gray-400 ml-6">{inv.notes}</div>}
                  </td>
                  <td className="px-3 py-2.5 whitespace-nowrap text-gray-600">{inv.supplier || '—'}</td>
                  <td className="px-3 py-2.5 whitespace-nowrap text-gray-600">{inv.invoice_date || (inv.created_at || '').slice(0, 10)}</td>
                  <td className="px-3 py-2.5 whitespace-nowrap text-gray-600">{inv.total != null ? `$${Number(inv.total).toFixed(2)}` : '—'}</td>
                  <td className="px-3 py-2.5 whitespace-nowrap text-gray-500 text-xs">{inv.uploaded_by || '—'}</td>
                  <td className="px-3 py-2.5 whitespace-nowrap text-right">
                    <div className="flex items-center gap-1 justify-end">
                      {inv.url && <a href={inv.url} target="_blank" rel="noreferrer" className="p-1.5 text-gray-400 hover:text-powder-600" data-tip="Download"><Download size={14} /></a>}
                      <button onClick={() => setEditing(inv)} className="p-1.5 text-gray-400 hover:text-powder-600" data-tip="Tag supplier/date/total"><Pencil size={14} /></button>
                      <button onClick={() => del(inv)} className="p-1.5 text-gray-400 hover:text-red-500" data-tip="Delete"><Trash2 size={14} /></button>
                    </div>
                  </td>
                </tr>
              ))}
              {list.length === 0 && <tr><td colSpan={6} className="px-4 py-10 text-center text-gray-400">No invoices yet. Upload PDFs or photos — everything is searchable for accounting later.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
      {editing && <EditInvoiceModal inv={editing} onClose={() => setEditing(null)} onSaved={refresh} />}
      {previewIdx !== null && (
        <FilePreview items={previewItems} index={previewIdx} onNav={setPreviewIdx} onClose={() => setPreviewIdx(null)} />
      )}
    </div>
  );
}

export default function SupplyOrdersPanel() {
  const { user } = useAuth() || {};
  const isAdmin = user?.role === 'admin';
  const [tab, setTab] = useState(isAdmin ? 'log' : 'form');
  const [refreshKey, setRefreshKey] = useState(0);
  const { data: items, refresh: refreshItems } = useApiGet('/office/supply/items', [refreshKey]);
  const bump = () => setRefreshKey(k => k + 1);

  const tabs = isAdmin
    ? [['log', 'Orders'], ['form', 'New Request'], ['invoices', 'Invoices']]
    : [['form', 'New Request']];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-xl font-bold text-gray-900">Supply Orders</h2>
        {tabs.length > 1 && (
          <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
            {tabs.map(([v, l]) => (
              <button key={v} onClick={() => setTab(v)}
                className={`px-3 py-1.5 rounded-md text-sm font-medium ${tab === v ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>{l}</button>
            ))}
          </div>
        )}
      </div>
      {tab === 'form' && (
        <div className="space-y-4">
          <OrderForm items={items} onCreated={() => { bump(); refreshItems(); }} />
          <QuickReorder items={items} onCreated={bump} />
        </div>
      )}
      {tab === 'log' && isAdmin && <OrdersLog refreshKey={refreshKey} onChanged={refreshItems} />}
      {tab === 'invoices' && isAdmin && <InvoiceRepo />}
    </div>
  );
}
