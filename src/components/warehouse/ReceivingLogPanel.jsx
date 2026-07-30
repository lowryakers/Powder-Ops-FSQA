import { useState, useMemo, useEffect, Fragment } from 'react';
import { useApiGet, apiPost, apiPut } from '../../hooks/useApi';
import {
  PackageCheck, Plus, ClipboardList, Search, Filter, Pencil,
  CheckCircle, Clock, AlertTriangle, ChevronUp, ChevronDown, ExternalLink, Upload,
} from 'lucide-react';
import { localDateStr, daysAgoStr } from '../../utils/dates';
import { CustomFields, CustomFieldValues } from '../common/CustomFields';
import ImportPanel from '../common/ImportPanel';
import { useRowExpand, stopRowClick } from '../../lib/useRowExpand';
import { ExpandCell, DetailRow, DetailFields } from '../common/RowDetail';

// Receiving Log — incoming raw material, labels and components (replaces the
// Monday board). Both dropdowns are managed lists and the extra questions are
// custom fields, so the warehouse changes this form themselves in Settings →
// Log Builder rather than asking for a deploy.

const SCOPE = 'receiving_log';

const fmtDate = (d) => {
  if (!d) return '';
  const [y, m, day] = String(d).slice(0, 10).split('-').map(Number);
  return y && m && day ? new Date(y, m - 1, day).toLocaleDateString() : String(d);
};

// A lot inside 90 days of expiry is the thing worth flagging on sight.
function expiryState(d) {
  if (!d) return null;
  const days = Math.round((new Date(d) - new Date()) / 86400000);
  if (Number.isNaN(days)) return null;
  if (days < 0) return { cls: 'bg-red-100 text-red-800', label: 'Expired' };
  if (days <= 90) return { cls: 'bg-amber-100 text-amber-800', label: `${days}d` };
  return null;
}

const STATUS_STYLE = {
  RELEASED: 'bg-green-100 text-green-800',
  'Needs to be tested': 'bg-amber-100 text-amber-800',
  'Sent to the lab': 'bg-blue-100 text-blue-800',
  Rejected: 'bg-red-100 text-red-800',
};

const BLANK = {
  inspection_no: '', date_received: localDateStr(), po_number: '', part_number: '',
  part_description: '', vendor_lot: '', expiration_date: '', quantity_received: '',
  uom: '', received_by: '', part_in_mrp: false, received_in_mrp: false,
  status_of_release: '', release_date: '', notes: '',
};

const inputCls = 'w-full px-3 py-2 border border-gray-300 rounded-lg text-sm';

/* ── Entry / edit form ───────────────────────────────────────────────────── */

function ReceivingForm({ user, record, onSaved, onCancel }) {
  const [form, setForm] = useState(() => (record
    ? { ...BLANK, ...record, part_in_mrp: !!record.part_in_mrp, received_in_mrp: !!record.received_in_mrp }
    : { ...BLANK, received_by: user?.name || '' }));
  const [custom, setCustom] = useState(record?.custom_data || {});
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState(null);

  // Both dropdowns come from managed lists, so editing them is a Settings task.
  const { data: uomList } = useApiGet('/structure/lists/uom');
  const { data: statusList } = useApiGet('/structure/lists/receiving_release_status');

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true); setMsg(null);
    try {
      const payload = { ...form, custom_data: custom };
      if (record) await apiPut(`/receiving/${record.id}`, payload);
      else await apiPost('/receiving', payload);
      onSaved?.();
      if (!record) {
        // Keep date + receiver: receipts arrive in batches from one person.
        setForm({ ...BLANK, date_received: form.date_received, received_by: form.received_by });
        setCustom({});
        setMsg({ type: 'success', text: 'Receiving record saved.' });
        setTimeout(() => setMsg(null), 3000);
      }
    } catch (err) {
      setMsg({ type: 'error', text: err.message || 'Could not save.' });
    } finally { setSaving(false); }
  };

  return (
    <form onSubmit={submit} className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
      <h3 className="font-semibold text-gray-900 flex items-center gap-2">
        <Plus size={16} /> {record ? 'Correct receiving record' : 'New Receiving Record'}
      </h3>

      {msg && (
        <div className={`px-3 py-2 rounded-lg text-sm ${msg.type === 'success' ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-800'}`}>
          {msg.text}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Inspection #</label>
          <input value={form.inspection_no} onChange={e => set('inspection_no', e.target.value)} className={inputCls} placeholder="A-100-0492" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Date Received <span className="text-red-600">*</span></label>
          <input required type="date" value={form.date_received} onChange={e => set('date_received', e.target.value)} className={inputCls} />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">PO #</label>
          <input value={form.po_number} onChange={e => set('po_number', e.target.value)} className={inputCls} placeholder="00461" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Part # <span className="text-red-600">*</span></label>
          <input required value={form.part_number} onChange={e => set('part_number', e.target.value)} className={inputCls} placeholder="202634" />
        </div>
        <div className="sm:col-span-2">
          <label className="block text-xs font-medium text-gray-700 mb-1">Part Description</label>
          <input value={form.part_description} onChange={e => set('part_description', e.target.value)} className={inputCls}
            placeholder="Flavor, Natural Chocolate, MET0001981" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Vendor Lot #</label>
          <input value={form.vendor_lot} onChange={e => set('vendor_lot', e.target.value)} className={inputCls} />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Expiration Date</label>
          <input type="date" value={form.expiration_date || ''} onChange={e => set('expiration_date', e.target.value)} className={inputCls} />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Quantity Received</label>
          <input type="number" step="any" min="0" value={form.quantity_received} onChange={e => set('quantity_received', e.target.value)} className={inputCls} placeholder="0" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">UOM</label>
          <select value={form.uom || ''} onChange={e => set('uom', e.target.value)} className={inputCls}>
            <option value="">Select…</option>
            {(uomList?.options || []).map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Received By</label>
          <input value={form.received_by || ''} onChange={e => set('received_by', e.target.value)} className={inputCls} />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Status of Release</label>
          <select value={form.status_of_release || ''} onChange={e => set('status_of_release', e.target.value)} className={inputCls}>
            <option value="">Select…</option>
            {(statusList?.options || []).map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Release Date</label>
          <input type="date" value={form.release_date || ''} onChange={e => set('release_date', e.target.value)} className={inputCls} />
        </div>
        <div className="flex items-end gap-4 pb-2">
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input type="checkbox" checked={form.part_in_mrp} onChange={e => set('part_in_mrp', e.target.checked)} />
            Part # in MRPEasy
          </label>
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input type="checkbox" checked={form.received_in_mrp} onChange={e => set('received_in_mrp', e.target.checked)} />
            Received in MRPEasy
          </label>
        </div>
        <div className="sm:col-span-2 lg:col-span-3">
          <label className="block text-xs font-medium text-gray-700 mb-1">Notes</label>
          <textarea value={form.notes || ''} onChange={e => set('notes', e.target.value)} rows={2} className={inputCls} />
        </div>
      </div>

      {/* Anything the warehouse added themselves. Renders nothing when empty. */}
      <CustomFields scope={SCOPE} values={custom} onChange={setCustom} title="Additional fields" />

      <div className="flex justify-end gap-2">
        {onCancel && (
          <button type="button" onClick={onCancel} className="px-3 py-2 text-sm rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50">Cancel</button>
        )}
        <button type="submit" disabled={saving}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
          {saving ? 'Saving…' : record ? 'Save correction' : 'Save Record'}
        </button>
      </div>
    </form>
  );
}

/* ── Log ─────────────────────────────────────────────────────────────────── */

const COLUMNS = [
  { key: 'date_received', label: 'Received', type: 'date' },
  { key: 'po_number', label: 'PO #' },
  { key: 'part_number', label: 'Part #' },
  { key: 'part_description', label: 'Description' },
  { key: 'vendor_lot', label: 'Vendor Lot' },
  { key: 'expiration_date', label: 'Expires', type: 'date' },
  { key: 'quantity_received', label: 'Qty', type: 'number' },
  { key: 'uom', label: 'UOM' },
  { key: 'received_by', label: 'Received By' },
  { key: 'status_of_release', label: 'Status' },
];

function ReceivingTable({ user }) {
  const [from, setFrom] = useState(daysAgoStr(90));
  const [to, setTo] = useState(localDateStr());
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [sortCol, setSortCol] = useState('date_received');
  const [sortDir, setSortDir] = useState('desc');
  const [editing, setEditing] = useState(null);
  const expand = useRowExpand();

  // Searching runs on the server and deliberately IGNORES the date filter.
  // Filtering client-side inside the loaded window meant a search for a receipt
  // older than the default 90 days silently found nothing, even though the
  // record was right there — the log goes back years after the Monday import.
  const [qDebounced, setQDebounced] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setQDebounced(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);
  const searching = qDebounced.length > 0;

  const listUrl = searching
    ? `/receiving?q=${encodeURIComponent(qDebounced)}${status ? `&status=${encodeURIComponent(status)}` : ''}`
    : `/receiving?from=${from}&to=${to}${status ? `&status=${encodeURIComponent(status)}` : ''}`;
  const { data: rows, loading, error, refresh } = useApiGet(listUrl, [listUrl]);
  const { data: stats } = useApiGet(`/receiving/stats?from=${from}&to=${to}`, [from, to]);
  const { data: statusList } = useApiGet('/structure/lists/receiving_release_status');

  const sorted = useMemo(() => {
    const list = rows || [];
    const col = COLUMNS.find(c => c.key === sortCol);
    const dir = sortDir === 'asc' ? 1 : -1;
    return [...list].sort((a, b) => {
      let cmp;
      if (col?.type === 'number') cmp = (Number(a[sortCol]) || 0) - (Number(b[sortCol]) || 0);
      else if (col?.type === 'date') cmp = String(a[sortCol] || '').localeCompare(String(b[sortCol] || ''));
      else cmp = String(a[sortCol] || '').toLowerCase().localeCompare(String(b[sortCol] || '').toLowerCase());
      return cmp * dir;
    });
  }, [rows, sortCol, sortDir]);

  const sort = (k) => {
    if (sortCol === k) setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortCol(k); setSortDir('asc'); }
  };

  const canEdit = user?.role === 'admin' || user?.role === 'supervisor'
    || (user?.module_access && !Array.isArray(user.module_access) && user.module_access['receiving-log'] === 'edit');

  if (editing) {
    return <ReceivingForm user={user} record={editing} onCancel={() => setEditing(null)}
      onSaved={() => { setEditing(null); refresh(); }} />;
  }

  return (
    <div className="space-y-4">
      {stats && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {[
            { label: 'Receipts', value: stats.total, icon: PackageCheck, tone: 'text-gray-900' },
            { label: 'Released', value: stats.released || 0, icon: CheckCircle, tone: 'text-green-700' },
            { label: 'Awaiting lab', value: stats.pending_lab || 0, icon: Clock, tone: 'text-amber-700' },
            { label: 'Expiring ≤90d', value: stats.expiring_90d || 0, icon: AlertTriangle, tone: 'text-red-700' },
          ].map(c => (
            <div key={c.label} className="bg-white rounded-xl border border-gray-200 p-3">
              <div className="flex items-center gap-1.5 text-xs text-gray-500"><c.icon size={13} /> {c.label}</div>
              <div className={`mt-1 text-2xl font-semibold ${c.tone}`}>{c.value ?? 0}</div>
            </div>
          ))}
        </div>
      )}

      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <div className="flex items-center gap-2 mb-3">
          <Filter size={16} className="text-gray-500" />
          <span className="text-sm font-medium text-gray-700">Filters</span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">From</label>
            <input type="date" value={from} onChange={e => setFrom(e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">To</label>
            <input type="date" value={to} onChange={e => setTo(e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Status</label>
            <select value={status} onChange={e => setStatus(e.target.value)} className={inputCls}>
              <option value="">All</option>
              {(statusList?.options || []).map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Search</label>
            <div className="relative">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
              <input value={q} onChange={e => setQ(e.target.value)} className={`${inputCls} pl-8`}
                placeholder="PO, part, lot, qty, receiver…" />
            </div>
          </div>
        </div>
      </div>

      {searching && !loading && (
        <p className="text-xs text-gray-500 -mt-2">
          Showing {sorted.length} match{sorted.length === 1 ? '' : 'es'} for “{qDebounced}” across <span className="font-medium">all dates</span> — the date filter is ignored while searching.
        </p>
      )}

      {loading && <div className="text-center py-8 text-gray-500 text-sm">Loading…</div>}
      {error && <div className="text-center py-8 text-red-600 text-sm">{error}</div>}

      {/* Mobile cards */}
      {!loading && !error && (
        <div className="md:hidden space-y-2">
          {sorted.length === 0 && (
            <div className="bg-white rounded-xl border border-gray-200 px-4 py-8 text-center text-sm text-gray-500">No receipts found.</div>
          )}
          {sorted.map(r => {
            const exp = expiryState(r.expiration_date);
            return (
              <div key={r.id} className="bg-white rounded-xl border border-gray-200 p-3 shadow-sm">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-medium text-gray-900 break-words">{r.part_description || r.part_number}</div>
                    <div className="text-xs text-gray-500">{fmtDate(r.date_received)} · PO {r.po_number || '—'}</div>
                  </div>
                  {r.status_of_release && (
                    <span className={`shrink-0 px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_STYLE[r.status_of_release] || 'bg-gray-100 text-gray-700'}`}>
                      {r.status_of_release}
                    </span>
                  )}
                </div>
                <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-gray-600">
                  <span>Part {r.part_number}</span>
                  {r.vendor_lot && <span>Lot {r.vendor_lot}</span>}
                  {r.quantity_received != null && <span>{Number(r.quantity_received).toLocaleString()} {r.uom}</span>}
                  {exp && <span className={`px-1.5 rounded ${exp.cls}`}>Exp {exp.label}</span>}
                </div>
                <CustomFieldValues scope={SCOPE} data={r.custom_data} className="mt-2" />
                {canEdit && (
                  <button type="button" onClick={() => setEditing(r)}
                    className="mt-2 inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-gray-300 text-xs font-medium text-gray-700 hover:bg-gray-50">
                    <Pencil size={12} /> Correct
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Desktop table */}
      {!loading && !error && (
        <div className="hidden md:block bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="w-8 px-2 py-3" />
                  {COLUMNS.map(c => (
                    <th key={c.key} onClick={() => sort(c.key)}
                      className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap cursor-pointer select-none hover:text-gray-900 hover:bg-gray-100">
                      <span className="inline-flex items-center gap-1">
                        {c.label}
                        {sortCol === c.key && (sortDir === 'asc' ? <ChevronUp size={13} className="text-blue-600" /> : <ChevronDown size={13} className="text-blue-600" />)}
                      </span>
                    </th>
                  ))}
                  <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">MRP</th>
                  <th className="px-3 py-3" />
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {sorted.length === 0 && (
                  <tr><td colSpan={COLUMNS.length + 3} className="px-3 py-8 text-center text-sm text-gray-500">No receipts found.</td></tr>
                )}
                {sorted.map(r => {
                  const exp = expiryState(r.expiration_date);
                  return (
                    <Fragment key={r.id}>
                    <tr {...expand.rowProps(r.id)}>
                      <td className="px-2 py-2"><ExpandCell open={expand.isExpanded(r.id)} /></td>
                      <td className="px-3 py-2 text-sm text-gray-900 whitespace-nowrap">{fmtDate(r.date_received)}</td>
                      <td className="px-3 py-2 text-sm text-gray-700 whitespace-nowrap">{r.po_number}</td>
                      <td className="px-3 py-2 text-sm text-gray-700 whitespace-nowrap">{r.part_number}</td>
                      <td className="px-3 py-2 text-sm text-gray-700 min-w-[200px]">{r.part_description}</td>
                      <td className="px-3 py-2 text-sm text-gray-700 whitespace-nowrap">{r.vendor_lot}</td>
                      <td className="px-3 py-2 text-sm whitespace-nowrap">
                        {fmtDate(r.expiration_date)}
                        {exp && <span className={`ml-1 px-1.5 rounded text-[10px] font-semibold ${exp.cls}`}>{exp.label}</span>}
                      </td>
                      <td className="px-3 py-2 text-sm text-gray-700 whitespace-nowrap">
                        {r.quantity_received != null ? Number(r.quantity_received).toLocaleString() : ''}
                      </td>
                      <td className="px-3 py-2 text-sm text-gray-700 whitespace-nowrap">{r.uom}</td>
                      <td className="px-3 py-2 text-sm text-gray-700 whitespace-nowrap">{r.received_by}</td>
                      <td className="px-3 py-2 text-sm whitespace-nowrap">
                        {r.status_of_release && (
                          <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_STYLE[r.status_of_release] || 'bg-gray-100 text-gray-700'}`}>
                            {r.status_of_release}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-xs whitespace-nowrap">
                        <span className={r.received_in_mrp ? 'text-green-600' : 'text-gray-300'} title="Received in MRPEasy">●</span>
                        <span className={`ml-1 ${r.part_in_mrp ? 'text-green-600' : 'text-gray-300'}`} title="Part # in MRPEasy">●</span>
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap" onClick={stopRowClick}>
                        {canEdit && (
                          <button type="button" onClick={() => setEditing(r)} className="text-gray-400 hover:text-amber-600" data-tip="Correct this record" data-tip-left>
                            <Pencil size={13} />
                          </button>
                        )}
                      </td>
                    </tr>
                    {expand.isExpanded(r.id) && (
                      <DetailRow colSpan={COLUMNS.length + 3}>
                        <DetailFields fields={[
                          { label: 'Inspection #', value: r.inspection_no },
                          { label: 'Received', value: fmtDate(r.date_received) },
                          { label: 'PO #', value: r.po_number },
                          { label: 'Part #', value: r.part_number },
                          { label: 'Description', value: r.part_description },
                          { label: 'Vendor lot', value: r.vendor_lot },
                          { label: 'Expires', value: fmtDate(r.expiration_date) },
                          { label: 'Quantity', value: r.quantity_received != null ? `${Number(r.quantity_received).toLocaleString()} ${r.uom || ''}`.trim() : '' },
                          { label: 'Received by', value: r.received_by },
                          { label: 'Status of release', value: r.status_of_release },
                          { label: 'Release date', value: fmtDate(r.release_date) },
                          { label: 'In MRPEasy', value: `Part ${r.part_in_mrp ? 'yes' : 'no'} · Receipt ${r.received_in_mrp ? 'yes' : 'no'}` },
                          { label: 'Notes', value: r.notes, wide: true },
                        ]}>
                          {r.packing_slip_url && (
                            <a href={r.packing_slip_url} target="_blank" rel="noreferrer"
                              className="inline-flex items-center gap-1 text-blue-600 hover:underline text-xs">
                              <ExternalLink size={12} /> Packing slip
                            </a>
                          )}
                          <CustomFieldValues scope={SCOPE} data={r.custom_data} />
                          {r.source && (
                            <div className="mt-2 text-[11px] text-gray-500">
                              Imported from {r.source}{r.external_id ? ` · ${r.external_id}` : ''}
                            </div>
                          )}
                        </DetailFields>
                      </DetailRow>
                    )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Module ──────────────────────────────────────────────────────────────── */

export default function ReceivingLogPanel({ user }) {
  const [tab, setTab] = useState('log');
  const [refreshKey, setRefreshKey] = useState(0);
  const canLog = user?.role === 'admin' || user?.role === 'supervisor'
    || user?.department === 'warehouse'
    || (user?.module_access && !Array.isArray(user.module_access) && !!user.module_access['receiving-log']);
  // Importing rewrites the log in bulk — thousands of compliance records in one
  // action — so it stays admin-only rather than riding on the edit grant.
  const canImport = user?.role === 'admin';
  const { data: targets } = useApiGet(canImport ? '/imports/targets' : null);
  const importTarget = (targets || []).find(t => t.key === 'receiving_log');

  const tabs = [
    { id: 'log', label: 'Receiving Log', icon: ClipboardList },
    ...(canLog ? [{ id: 'form', label: 'New Record', icon: Plus }] : []),
    ...(canImport ? [{ id: 'import', label: 'Import', icon: Upload }] : []),
  ];

  return (
    <div className="space-y-4">
      <div className="flex gap-1 bg-gray-100 rounded-lg p-1 w-fit">
        {tabs.map(t => (
          <button key={t.id} type="button" onClick={() => setTab(t.id)}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-md text-sm font-medium ${tab === t.id ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600 hover:text-gray-900'}`}>
            <t.icon size={15} /> {t.label}
          </button>
        ))}
      </div>
      {tab === 'form' && canLog && (
        <ReceivingForm user={user} onSaved={() => setRefreshKey(k => k + 1)} />
      )}
      {tab === 'import' && canImport && importTarget && (
        <ImportPanel target="receiving_log" targetLabel="Receiving Log"
          fields={importTarget.fields} onDone={() => setRefreshKey(k => k + 1)} />
      )}
      {tab === 'log' && <ReceivingTable key={refreshKey} user={user} />}
    </div>
  );
}
