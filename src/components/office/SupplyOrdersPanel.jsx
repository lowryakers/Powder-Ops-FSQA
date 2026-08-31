import { useState, useMemo, useRef, Fragment } from 'react';
import { useApiGet, apiPost, apiPut, apiFetch, apiUpload } from '../../hooks/useApi';
import { useAuth } from '../../hooks/useAuth';
import { Search, Repeat, Trash2, Upload, FileText, Download, AlertTriangle, ExternalLink, Pencil, X, ChevronUp, ChevronDown, Lightbulb, Plus, PackageCheck, ScanLine } from 'lucide-react';
import FilePreview from '../FilePreview.jsx';
import { usePageTranslation } from '../../lib/usePageTranslation.js';
import LangToggle from '../LangToggle.jsx';
import SpendTab from './SpendTab.jsx';
import { useRowExpand, stopRowClick } from '../../lib/useRowExpand';
import { ExpandCell, DetailRow, DetailFields } from '../common/RowDetail';

const LABELS = ['Warehouse/Production', 'Cleaning', 'Break room', 'Maintenance', 'Office'];

// Items reported "used up / ran out" when they were signed back in — the
// earliest anyone knows to reorder something.
//
// Deliberately SUGGESTIONS in their own strip, not rows in the orders list.
// Three people finishing the same sanitizer would otherwise put three
// near-identical requests in the queue, and a queue with duplicates in it
// stops being read. Grouped by item, dismissible, and one click turns one into
// a real request — the decision about what gets ordered stays with the office.
function SuggestionStrip({ tr = (x) => x, onOrdered }) {
  const { data, refresh } = useApiGet('/office/supply/suggestions');
  const [busy, setBusy] = useState('');
  const list = data || [];
  if (!list.length) return null;

  const act = async (s, kind) => {
    setBusy(s.item_name);
    try {
      if (kind === 'dismiss') await apiPost('/office/supply/suggestions/dismiss', { ids: s.ids, item_name: s.item_name });
      else {
        await apiPost('/office/supply/suggestions/order', { ids: s.ids, item_name: s.item_name, reported_by: s.reported_by });
        onOrdered?.();
      }
      refresh();
    } finally { setBusy(''); }
  };

  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 space-y-2">
      <p className="text-xs font-semibold text-amber-900 flex items-center gap-1.5">
        <Lightbulb size={14} />
        {list.length} {list.length === 1 ? tr('item reported used up') : tr('items reported used up')}
        <span className="font-normal text-amber-700/80">· {tr('not requests yet')}</span>
      </p>
      <div className="space-y-1.5">
        {list.map(s => (
          <div key={s.item_name} className="flex flex-wrap items-center gap-2 rounded-lg bg-white/70 px-2.5 py-1.5">
            <span className="font-medium text-sm text-gray-900 min-w-0 break-words">{s.item_name}</span>
            {s.count > 1 && <span className="px-1.5 py-0.5 rounded-full bg-amber-200 text-amber-900 text-[10px] font-bold">×{s.count}</span>}
            <span className="text-[11px] text-gray-500 truncate">
              {s.reported_by.slice(0, 3).join(', ')}{s.reported_by.length > 3 ? '…' : ''}
              {s.last_reported ? ` · ${s.last_reported}` : ''}
            </span>
            <div className="ml-auto flex items-center gap-1.5 shrink-0">
              <button onClick={() => act(s, 'order')} disabled={busy === s.item_name}
                className="inline-flex items-center gap-1 px-2 py-1 bg-powder-600 text-white rounded-lg text-[11px] font-medium hover:bg-powder-700 disabled:opacity-50">
                <Plus size={11} /> {tr('Add to orders')}
              </button>
              <button onClick={() => act(s, 'dismiss')} disabled={busy === s.item_name}
                className="p-1 text-gray-400 hover:text-gray-700 disabled:opacity-50" data-tip="Dismiss"><X size={13} /></button>
            </div>
          </div>
        ))}
      </div>
      {list.some(s => s.notes.length > 0) && (
        <p className="text-[11px] text-amber-800/80">{list.filter(s => s.notes.length).map(s => `${s.item_name}: ${s.notes[0]}`).join(' · ')}</p>
      )}
    </div>
  );
}
const STATUS_FLOW = ['new', 'ordered', 'received', 'paid'];
// People paste links as "amazon.com/..." as often as with the scheme, and a
// bare href like that is treated as a path — the click goes nowhere. Normalize
// before rendering so the link in a request is always the link that opens.
function externalUrl(raw) {
  const v = String(raw || '').trim();
  if (!v) return null;
  if (/^https?:\/\//i.test(v)) return v;
  if (/^[\w.-]+\.[a-z]{2,}(\/|$|\?)/i.test(v)) return `https://${v}`;
  return null;
}

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

const money = (v) => `$${Number(v).toFixed(2)}`;

// "1 of 3 received" — the part-delivered state, derived server-side and only
// rendered here. Nothing shows for an order where nothing has arrived, or one
// that came in complete: a chip on every row is a chip nobody reads.
function ReceivedChip({ o, className = '' }) {
  if (o.receipt_state === 'none' || !o.qty_known) return null;
  const partial = o.receipt_state === 'partial';
  return (
    <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-semibold whitespace-nowrap ${partial ? 'bg-amber-100 text-amber-800' : 'bg-green-100 text-green-700'} ${className}`}>
      {o.qty_received} of {o.qty} {partial ? 'received' : 'received'}
    </span>
  );
}

// Taking in a delivery. Defaults to everything still outstanding, because the
// whole order arriving is the common case and the partial one is what needed a
// form at all.
function ReceiveModal({ order, onClose, onSaved }) {
  const outstanding = order.qty_known ? order.outstanding : null;
  const [qty, setQty] = useState(outstanding != null ? String(outstanding) : '');
  const [note, setNote] = useState('');
  const [err, setErr] = useState(null);
  const [saving, setSaving] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true); setErr(null);
    try {
      await apiPost(`/office/supply/orders/${order.id}/receive`, { qty: Number(qty), note });
      onSaved(); onClose();
    } catch (e2) { setErr(e2.message || 'Failed'); }
    finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/30 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <form onSubmit={submit} onClick={e => e.stopPropagation()} className="bg-white rounded-xl shadow-xl w-full max-w-sm p-5 space-y-3 max-h-[92vh] overflow-y-auto">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-gray-900 truncate">Receive {order.item_name}</h3>
          <button type="button" onClick={onClose} className="p-1 hover:bg-gray-100 rounded-lg"><X size={18} className="text-gray-500" /></button>
        </div>
        {order.qty_known ? (
          <p className="text-xs text-gray-500">
            {order.qty} {order.uom || ''} ordered · {order.qty_received} already received · <span className="font-medium text-gray-700">{outstanding} still outstanding</span>
          </p>
        ) : (
          <p className="text-xs text-amber-700">No quantity was recorded on this order, so it can only be received in full. Add a quantity first if part of it arrived.</p>
        )}
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">How many arrived?</label>
          <input type="number" step="any" autoFocus required value={qty} onChange={e => setQty(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
          <p className="mt-1 text-[11px] text-gray-400">A negative number corrects an earlier miscount — it needs a reason, and the correction stays on the record.</p>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Note{Number(qty) < 0 ? ' *' : ''}</label>
          <input value={note} onChange={e => setNote(e.target.value)} placeholder="Back-ordered, damaged, short shipped…"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
        </div>
        {err && <p className="text-sm text-red-600">{err}</p>}
        <div className="flex gap-2">
          <button type="submit" disabled={saving} className="px-4 py-2 bg-powder-600 text-white rounded-lg text-sm font-medium hover:bg-powder-700 disabled:opacity-50">
            {saving ? 'Saving…' : 'Record delivery'}
          </button>
          <button type="button" onClick={onClose} className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm hover:bg-gray-200">Cancel</button>
        </div>
      </form>
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
      <div onClick={e => e.stopPropagation()} className="bg-white rounded-xl shadow-xl w-full max-w-md p-5 space-y-3 max-h-[92vh] overflow-y-auto">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-gray-900 truncate">{order.item_name}</h3>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded-lg"><X size={18} className="text-gray-500" /></button>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="block text-xs font-medium text-gray-700 mb-1">Qty</label>
            <input type="number" step="any" value={form.qty} onChange={e => setForm({ ...form, qty: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" /></div>
          <div><label className="block text-xs font-medium text-gray-700 mb-1">Total ($)</label>
            <input type="number" step="0.01" value={form.total} onChange={e => setForm({ ...form, total: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
            {order.suggested_total != null && form.total === '' && (
              <button type="button" onClick={() => setForm(f => ({ ...f, total: String(order.suggested_total) }))}
                className="mt-1 text-[11px] text-powder-700 hover:underline text-left">
                Use {money(order.suggested_total)} from {order.suggested_total_from}
              </button>
            )}
          </div>
          <div><label className="block text-xs font-medium text-gray-700 mb-1">ETA</label>
            <input type="date" value={form.eta} onChange={e => setForm({ ...form, eta: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" /></div>
          <div><label className="block text-xs font-medium text-gray-700 mb-1">Supplier</label>
            <input value={form.supplier} onChange={e => setForm({ ...form, supplier: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" /></div>
          <div className="col-span-2">
            <div className="flex items-center justify-between mb-1">
              <label className="block text-xs font-medium text-gray-700">Link</label>
              {externalUrl(form.link) && (
                <a href={externalUrl(form.link)} target="_blank" rel="noreferrer"
                  className="inline-flex items-center gap-1 text-xs font-medium text-powder-700 hover:underline">
                  Open <ExternalLink size={11} />
                </a>
              )}
            </div>
            <input value={form.link} onChange={e => setForm({ ...form, link: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
          </div>
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
  const [receiving, setReceiving] = useState(null);
  const expand = useRowExpand();
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

  // Advancing to "received" goes through the receive form, so what arrived is
  // counted rather than assumed — for an order with no quantity written down
  // there is nothing to count and the status control still marks it in full.
  const advance = async (o) => {
    const next = STATUS_META[o.status]?.next;
    if (!next) return;
    if (next === 'received' && o.qty_known) { setReceiving(o); return; }
    await apiPut(`/office/supply/orders/${o.id}`, { status: next });
    refresh(); onChanged?.();
  };
  const applySuggestedTotal = async (o) => {
    await apiPut(`/office/supply/orders/${o.id}`, { total: o.suggested_total });
    refresh(); onChanged?.();
  };
  const del = async (o) => {
    if (!confirm(`Delete "${o.item_name}"?`)) return;
    await apiFetch(`/office/supply/orders/${o.id}`, { method: 'DELETE' });
    refresh();
  };

  return (
    <div className="space-y-3">
      <SuggestionStrip onOrdered={refresh} />
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
              <div className="shrink-0 flex flex-col items-end gap-1">
                <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_META[o.status].tone}`}>{STATUS_META[o.status].label}</span>
                <ReceivedChip o={o} />
              </div>
            </div>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500">
              <span>{o.requested_by || '—'} · {(o.submitted_at || '').slice(0, 10)}</span>
              {o.total != null && <span>{money(o.total)}</span>}
              {o.total == null && o.suggested_total != null && (
                <button onClick={() => applySuggestedTotal(o)} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-powder-50 text-powder-700 font-medium hover:bg-powder-100">
                  Use {money(o.suggested_total)} from invoice
                </button>
              )}
              {externalUrl(o.link) && (
                <a href={externalUrl(o.link)} target="_blank" rel="noreferrer"
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-powder-50 text-powder-700 font-medium hover:bg-powder-100">
                  Open link <ExternalLink size={10} />
                </a>
              )}
            </div>
            <div className="mt-2 flex items-center gap-2">
              {STATUS_META[o.status].next && (
                <button onClick={() => advance(o)} className="px-2.5 py-1 bg-powder-600 text-white rounded-lg text-xs font-medium">
                  {STATUS_META[o.status].next === 'received' && o.qty_known ? (o.receipt_state === 'partial' ? 'Receive more…' : 'Receive…') : STATUS_META[o.status].nextLabel}
                </button>
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
                <th className="w-8 px-2 py-2.5" />
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
                <Fragment key={o.id}>
                <tr {...expand.rowProps(o.id, 'border-b border-gray-100')}>
                  <td className="px-2 py-2.5"><ExpandCell open={expand.isExpanded(o.id)} /></td>
                  <td className="px-3 py-2.5 w-full">
                    {externalUrl(o.link) ? (
                      <a href={externalUrl(o.link)} target="_blank" rel="noreferrer" onClick={stopRowClick}
                        className="font-medium text-powder-700 hover:underline inline-flex items-center gap-1"
                        title={o.link}>
                        {o.item_name} <ExternalLink size={11} />
                      </a>
                    ) : (
                      <span className="font-medium text-gray-900">{o.item_name}</span>
                    )}
                    {o.urgent && (o.status === 'new' || o.status === 'ordered') && <span className="ml-1.5 text-[10px] font-bold text-red-600">URGENT</span>}
                    {o.notes && <div className="text-[11px] text-gray-400">{o.notes}</div>}
                  </td>
                  <td className="px-3 py-2.5 whitespace-nowrap text-gray-600">
                    {o.qty ?? '—'} {o.uom || ''}
                    {o.receipt_state === 'partial' && <div className="text-[11px] font-semibold text-amber-700">{o.qty_received} in · {o.outstanding} to come</div>}
                  </td>
                  <td className="px-3 py-2.5 whitespace-nowrap text-gray-600">{o.supplier || '—'}</td>
                  <td className="px-3 py-2.5 whitespace-nowrap text-gray-500 text-xs">{o.label || '—'}</td>
                  <td className="px-3 py-2.5 whitespace-nowrap text-gray-500 text-xs">{o.requested_by || '—'}<div className="text-gray-400">{(o.submitted_at || '').slice(0, 10)}</div></td>
                  <td className="px-3 py-2.5 whitespace-nowrap text-gray-600">
                    {o.total != null ? money(o.total) : (o.suggested_total == null ? '—' : null)}
                    {o.total == null && o.suggested_total != null && (
                      <button onClick={(e) => { stopRowClick(e); applySuggestedTotal(o); }}
                        title={`From ${o.suggested_total_from}${o.suggested_total_evidence ? ` — read from "${o.suggested_total_evidence}"` : ''}`}
                        className="px-1.5 py-0.5 rounded-md bg-powder-50 text-powder-700 text-xs font-medium hover:bg-powder-100">
                        Use {money(o.suggested_total)}
                      </button>
                    )}
                  </td>
                  <td className="px-3 py-2.5 whitespace-nowrap">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_META[o.status].tone}`}>{STATUS_META[o.status].label}</span>
                    <ReceivedChip o={o} className="ml-1" />
                  </td>
                  <td className="px-3 py-2.5 whitespace-nowrap text-right" onClick={stopRowClick}>
                    <div className="flex items-center gap-1 justify-end">
                      {STATUS_META[o.status].next && (
                        <button onClick={() => advance(o)} className="px-2 py-1 bg-powder-600 text-white rounded-lg text-xs font-medium hover:bg-powder-700 inline-flex items-center gap-1">
                          {STATUS_META[o.status].next === 'received' && o.qty_known
                            ? <><PackageCheck size={12} /> {o.receipt_state === 'partial' ? 'Receive more' : 'Receive'}</>
                            : STATUS_META[o.status].nextLabel}
                        </button>
                      )}
                      <button onClick={() => setEditing(o)} className="p-1.5 text-gray-400 hover:text-powder-600" data-tip="Edit"><Pencil size={14} /></button>
                      <button onClick={() => del(o)} className="p-1.5 text-gray-400 hover:text-red-500" data-tip="Delete"><Trash2 size={14} /></button>
                    </div>
                  </td>
                </tr>
                {expand.isExpanded(o.id) && (
                  <DetailRow colSpan={9}>
                    <DetailFields fields={[
                      { label: 'Item', value: o.item_name },
                      { label: 'Quantity', value: `${o.qty ?? ''} ${o.uom || ''}`.trim() },
                      { label: 'Received', value: o.receipt_state === 'none' ? '' : `${o.qty_received}${o.qty_known ? ` of ${o.qty}` : ''} ${o.uom || ''}`.trim() },
                      { label: 'Outstanding', value: o.receipt_state === 'partial' ? `${o.outstanding} ${o.uom || ''}`.trim() : '' },
                      { label: 'Supplier', value: o.supplier },
                      { label: 'For', value: o.label },
                      { label: 'Requested by', value: o.requested_by },
                      { label: 'Requested', value: (o.submitted_at || '').slice(0, 16).replace('T', ' ') },
                      { label: 'Unit price', value: o.unit_price != null ? `$${Number(o.unit_price).toFixed(2)}` : '' },
                      { label: 'Total', value: o.total != null ? `$${Number(o.total).toFixed(2)}` : '' },
                      { label: 'Status', value: STATUS_META[o.status].label },
                      { label: 'Urgent', value: o.urgent ? 'Yes' : '' },
                      { label: 'Ordered', value: (o.ordered_at || '').slice(0, 10) },
                      { label: 'Received in full', value: (o.received_at || '').slice(0, 10) },
                      { label: 'Link', value: o.link, wide: true },
                      { label: 'Notes', value: o.notes, wide: true },
                    ]} />
                    {o.receipt_history?.length > 0 && (
                      <div className="mt-3">
                        <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">Deliveries</p>
                        <ul className="mt-1 space-y-0.5 text-xs text-gray-600">
                          {o.receipt_history.map((h, k) => (
                            <li key={k}>
                              <span className={`font-medium ${h.qty < 0 ? 'text-red-600' : 'text-gray-900'}`}>{h.qty > 0 ? `+${h.qty}` : h.qty}</span>
                              {' '}{o.uom || ''} · {(h.at || '').slice(0, 10)} · {h.by}
                              {h.note ? ` — ${h.note}` : ''}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </DetailRow>
                )}
                </Fragment>
              ))}
              {list.length === 0 && <tr><td colSpan={9} className="px-4 py-8 text-center text-gray-400">No orders</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
      {editing && <EditOrderModal order={editing} onClose={() => setEditing(null)} onSaved={refresh} />}
      {receiving && <ReceiveModal order={receiving} onClose={() => setReceiving(null)} onSaved={() => { refresh(); onChanged?.(); }} />}
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
      <div onClick={e => e.stopPropagation()} className="bg-white rounded-xl shadow-xl w-full max-w-md p-5 space-y-3 max-h-[92vh] overflow-y-auto">
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
          {/* The line the figure was read from, so it can be checked against the
              document without opening the document. Editing the total makes it
              a typed figure and no later read will move it. */}
          {inv.total_source === 'read' && inv.figures?.total_evidence && (
            <p className="col-span-2 text-[11px] text-gray-500">
              Total read from the file: <span className="font-mono text-gray-700">“{inv.figures.total_evidence}”</span>
            </p>
          )}
          {inv.figures?.invoice_date_evidence && !inv.figures?.total_evidence && (
            <p className="col-span-2 text-[11px] text-gray-500">
              Date read from the file: <span className="font-mono text-gray-700">“{inv.figures.invoice_date_evidence}”</span>
            </p>
          )}
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
  // Read the figures off a file already on the shelf. Blanks only — a total
  // somebody typed is never moved by this.
  const [reading, setReading] = useState('');
  const readFigures = async (inv) => {
    setReading(inv.id);
    try {
      const out = await apiPost(`/office/supply/invoices/${inv.id}/read`, {});
      if (out.total == null) alert(`Nothing on "${inv.filename}" is labelled as a total — enter it by hand.`);
      refresh();
    } catch (e) { alert(e.message || 'Could not read the file'); }
    finally { setReading(''); }
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
                <div className="text-xs text-gray-400 mt-0.5">
                  {[inv.supplier, inv.invoice_date, inv.total != null ? money(inv.total) : null].filter(Boolean).join(' · ') || 'No details tagged'}
                  {inv.total_source === 'read' && <span className="ml-1 text-powder-600">· read from the file</span>}
                </div>
                {inv.total == null && inv.searchable && (
                  <button onClick={() => readFigures(inv)} disabled={reading === inv.id}
                    className="mt-1 px-2 py-0.5 rounded-md bg-powder-50 text-powder-700 text-[11px] font-medium disabled:opacity-50">
                    {reading === inv.id ? 'Reading…' : 'Read total from file'}
                  </button>
                )}
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
                  <td className="px-3 py-2.5 whitespace-nowrap text-gray-600">
                    {inv.total != null ? money(inv.total) : '—'}
                    {inv.total_source === 'read' && (
                      <span className="ml-1 inline-flex items-center align-middle text-powder-600"
                        title={inv.figures?.total_evidence ? `Read from the file: "${inv.figures.total_evidence}"` : 'Read from the file'}>
                        <ScanLine size={12} />
                      </span>
                    )}
                    {inv.total == null && inv.searchable && (
                      <button onClick={() => readFigures(inv)} disabled={reading === inv.id}
                        className="ml-1 px-1.5 py-0.5 rounded-md bg-powder-50 text-powder-700 text-xs font-medium hover:bg-powder-100 disabled:opacity-50">
                        {reading === inv.id ? 'Reading…' : 'Read from file'}
                      </button>
                    )}
                    {inv.total == null && inv.searchable === false && (
                      <span className="ml-1 text-[11px] text-gray-400" title="No text could be read out of this file, so nothing could be picked up automatically.">no text</span>
                    )}
                  </td>
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

// Labels the EN/ES toggle covers on this page.
const PAGE_STRINGS = [
  'Supply Orders', 'Orders', 'New Request', 'Invoices', 'Item', 'Quantity', 'Supplier',
  'Status', 'Urgent', 'Needed by', 'Notes', 'Requested by', 'Total', 'No orders', 'Spend',
];

export default function SupplyOrdersPanel() {
  const { user } = useAuth() || {};
  const isAdmin = user?.role === 'admin';
  const [tab, setTab] = useState(isAdmin ? 'log' : 'form');
  const [refreshKey, setRefreshKey] = useState(0);
  const { data: items, refresh: refreshItems } = useApiGet('/office/supply/items', [refreshKey]);
  const bump = () => setRefreshKey(k => k + 1);
  const { lang, setLang, tr, translating } = usePageTranslation(PAGE_STRINGS);

  const tabs = isAdmin
    ? [['log', 'Orders'], ['form', 'New Request'], ['invoices', 'Invoices'], ['spend', 'Spend']]
    : [['form', 'New Request']];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-xl font-bold text-gray-900">{tr('Supply Orders')}</h2>
        <div className="flex items-center gap-2 flex-wrap w-full sm:w-auto">
          {tabs.length > 1 && (
            <div className="flex gap-1 bg-gray-100 rounded-lg p-1 overflow-x-auto max-w-full">
              {tabs.map(([v, l]) => (
                <button key={v} onClick={() => setTab(v)}
                  className={`px-3 py-1.5 rounded-md text-sm font-medium whitespace-nowrap shrink-0 ${tab === v ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>{tr(l)}</button>
              ))}
            </div>
          )}
          <LangToggle lang={lang} setLang={setLang} translating={translating} />
        </div>
      </div>
      {tab === 'form' && (
        <div className="space-y-4">
          <OrderForm items={items} onCreated={() => { bump(); refreshItems(); }} />
          <QuickReorder items={items} onCreated={bump} />
        </div>
      )}
      {tab === 'log' && isAdmin && <OrdersLog refreshKey={refreshKey} onChanged={refreshItems} />}
      {tab === 'invoices' && isAdmin && <InvoiceRepo />}
      {tab === 'spend' && isAdmin && <SpendTab />}
    </div>
  );
}
