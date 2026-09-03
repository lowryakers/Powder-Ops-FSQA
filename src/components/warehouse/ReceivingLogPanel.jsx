import { useState, useMemo, useEffect, Fragment } from 'react';
import { useApiGet, apiPost, apiPut, apiDelete } from '../../hooks/useApi';
import {
  PackageCheck, Plus, ClipboardList, Search, Filter, Pencil,
  CheckCircle, Clock, AlertTriangle, ChevronUp, ChevronDown, ExternalLink, Upload, ClipboardCheck,
  ScanLine, FlaskConical,
} from 'lucide-react';
import { localDateStr, daysAgoStr } from '../../utils/dates';
import { CustomFields, CustomFieldValues } from '../common/CustomFields';
import ImportPanel from '../common/ImportPanel';
import ReceivingChecklist from './ReceivingChecklist.jsx';
import FilmPouchInspection, { FilmInspectionsTab } from './FilmPouchInspection.jsx';
import { useRowExpand, stopRowClick } from '../../lib/useRowExpand';
import { useCappedList } from '../../lib/useCappedList';
import ShowMore from '../common/ShowMore.jsx';
import { ExpandCell, DetailRow, DetailFields } from '../common/RowDetail';
import { canFilmInspect } from '../../utils/permissions';
import { getParam, consumeParam } from '../../lib/deepLink';
import { withCurrent } from '../../lib/managedList.js';

// Receiving Log — incoming raw material, labels and components (replaces the
// Monday board). Both dropdowns are managed lists and the extra questions are
// custom fields, so the warehouse changes this form themselves in Settings →
// Log Builder rather than asking for a deploy.

const SCOPE = 'receiving_log';

// ── QA's standing lab-test list ──────────────────────────────────────────────
//
// The items that must have a sample pulled whenever they arrive. QA keeps this;
// the warehouse can read it, because a receiver whose line raised an alert
// should be able to see the rule that raised it rather than wondering why their
// phone buzzed.
//
// Adding an item here is a QA decision that fires automatically forever after,
// so the screen says what it will do in plain words rather than leaving it to
// be discovered on the next delivery.
function LabTestItemsTab() {
  const { data, refresh } = useApiGet('/receiving/lab-test-items');
  const [form, setForm] = useState({ part_number: '', part_description: '', tests: '', note: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const items = data?.items || [];
  const canEdit = !!data?.can_edit;
  const active = items.filter(i => i.is_active);
  const retired = items.filter(i => !i.is_active);

  const add = async (e) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      await apiPost('/receiving/lab-test-items', form);
      setForm({ part_number: '', part_description: '', tests: '', note: '' });
      refresh();
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  };

  const retire = async (id) => {
    setError(null);
    try { await apiDelete(`/receiving/lab-test-items/${id}`); refresh(); }
    catch (err) { setError(err.message); }
  };

  const cls = 'w-full px-2.5 py-1.5 border border-gray-300 rounded-lg text-sm';
  return (
    <div className="space-y-4">
      <div className="bg-white border border-gray-200 rounded-xl p-4">
        <h3 className="text-base font-semibold text-gray-900 flex items-center gap-2">
          <FlaskConical size={17} className="text-purple-600" /> Items that need a lab test on arrival
        </h3>
        <p className="text-sm text-gray-600 mt-1">
          When one of these is filed on the Receiving Log, QA is messaged straight away so the sample
          can be pulled before the pallet is put away. Matched on the <strong>part #</strong>.
        </p>
        {!canEdit && (
          <p className="text-xs text-gray-500 mt-2 italic">
            Read-only — QA decides what is on this list.
          </p>
        )}
      </div>

      {canEdit && (
        <form onSubmit={add} className="bg-white border border-gray-200 rounded-xl p-4 space-y-2">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <label className="block">
              <span className="block text-[11px] text-gray-600 mb-0.5">Part # <span className="text-red-500">*</span></span>
              <input value={form.part_number} required className={cls} placeholder="RM-WHEY-01"
                onChange={e => setForm(f => ({ ...f, part_number: e.target.value }))} />
            </label>
            <label className="block">
              <span className="block text-[11px] text-gray-600 mb-0.5">Description</span>
              <input value={form.part_description} className={cls} placeholder="Whey Protein Isolate"
                onChange={e => setForm(f => ({ ...f, part_description: e.target.value }))} />
            </label>
            <label className="block">
              <span className="block text-[11px] text-gray-600 mb-0.5">Tests to run</span>
              {/* Free text on purpose: "HM & Micro" is how QA writes it and how
                  1,150 of the real COA requests are written. A picker here
                  would quietly expand a panel into named tests. */}
              <input value={form.tests} className={cls} placeholder="HM &amp; Micro"
                onChange={e => setForm(f => ({ ...f, tests: e.target.value }))} />
            </label>
            <label className="block">
              <span className="block text-[11px] text-gray-600 mb-0.5">Note (optional)</span>
              <input value={form.note} className={cls} placeholder="Every lot — supplier on watch"
                onChange={e => setForm(f => ({ ...f, note: e.target.value }))} />
            </label>
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <button type="submit" disabled={busy || !form.part_number.trim()}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-powder-600 text-white text-sm font-medium rounded-lg hover:bg-powder-700 disabled:opacity-50">
            <Plus size={14} /> {busy ? 'Adding…' : 'Add to the list'}
          </button>
        </form>
      )}

      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <div className="px-4 py-2.5 border-b border-gray-100 text-sm font-semibold text-gray-700">
          On the list ({active.length})
        </div>
        {active.length === 0 ? (
          <p className="px-4 py-6 text-sm text-gray-500 text-center">
            Nothing on the list yet — no receipt will raise a lab request until an item is added.
          </p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {active.map(i => (
              <li key={i.id} className="px-4 py-2.5 flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <span className="font-medium text-gray-900">{i.part_number}</span>
                  {i.part_description && <span className="text-gray-600"> — {i.part_description}</span>}
                  <div className="text-xs text-gray-500 mt-0.5">
                    {i.tests ? <>Tests: {i.tests}</> : <span className="italic">No tests named</span>}
                    {i.note && <> · {i.note}</>}
                  </div>
                </div>
                {canEdit && (
                  <button type="button" onClick={() => retire(i.id)}
                    className="shrink-0 text-xs font-medium text-gray-500 hover:text-red-600">
                    Take off the list
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {retired.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <div className="px-4 py-2.5 border-b border-gray-100 text-sm font-semibold text-gray-500">
            Taken off the list ({retired.length})
          </div>
          {/* Kept visible rather than deleted: a receipt filed in March says a
              lab sample was due, and the rule that made it due has to still be
              readable. Adding the code again puts it back. */}
          <ul className="divide-y divide-gray-100">
            {retired.map(i => (
              <li key={i.id} className="px-4 py-2 text-sm text-gray-500">
                <span className="line-through">{i.part_number}</span>
                {i.part_description && <span> — {i.part_description}</span>}
                <span className="text-xs"> · no longer raises a request</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

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

function ReceivingForm({ user, record, inspectionNo, onSaved, onCancel, onOpenChecklist }) {
  const [form, setForm] = useState(() => (record
    ? { ...BLANK, ...record, part_in_mrp: !!record.part_in_mrp, received_in_mrp: !!record.received_in_mrp }
    : { ...BLANK, received_by: user?.name || '', inspection_no: inspectionNo || '' }));
  const [custom, setCustom] = useState(record?.custom_data || {});
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState(null);
  // The inspection # of the record just filed, so the next line can join it.
  const [lastFiled, setLastFiled] = useState(null);

  // Both dropdowns come from managed lists, so editing them is a Settings task.
  const { data: uomList } = useApiGet('/structure/lists/uom');
  const { data: statusList } = useApiGet('/structure/lists/receiving_release_status');
  // What the next new inspection would be numbered. Advisory — the server
  // issues the real one on save, so two people filing at once can't collide.
  const { data: nextNo } = useApiGet(record ? null : '/receiving/next-inspection-no');

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  // Whichever inspection this checklist would be for: one typed into the field,
  // or the one the last save issued. Blank until there is one to open.
  const checklistTarget = (form.inspection_no || '').trim() || lastFiled || '';

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true); setMsg(null);
    try {
      const payload = { ...form, custom_data: custom };
      if (record) await apiPut(`/receiving/${record.id}`, payload);
      else {
        const created = await apiPost('/receiving', payload);
        setLastFiled(created?.inspection_no || null);
      }
      onSaved?.();
      if (!record) {
        // Keep date + receiver: receipts arrive in batches from one person.
        // Inspection # is deliberately cleared — the default is a NEW
        // inspection, and "add another line" is one click away below.
        setForm({ ...BLANK, date_received: form.date_received, received_by: form.received_by });
        setCustom({});
        setMsg({ type: 'success', text: 'Receiving record saved.' });
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

      {msg && msg.type === 'error' && (
        <div className="px-3 py-2 rounded-lg text-sm bg-red-50 text-red-800">{msg.text}</div>
      )}

      {/* One arrival = one inspection # = as many lines as it took. After
          filing a line, joining it is one click; doing nothing starts a new
          inspection, which is the common case. */}
      {msg?.type === 'success' && lastFiled && (
        <div className="px-3 py-2 rounded-lg text-sm bg-green-50 text-green-900 flex flex-wrap items-center gap-2">
          <span>Filed as <span className="font-semibold">{lastFiled}</span>.</span>
          {form.inspection_no === lastFiled ? (
            <span className="text-green-700">Next line joins this inspection.</span>
          ) : (
            <button type="button" onClick={() => set('inspection_no', lastFiled)}
              className="px-2 py-0.5 rounded-md border border-green-300 bg-white text-xs font-medium text-green-800 hover:bg-green-100">
              Add another line to {lastFiled}
            </button>
          )}
          {/* FORM 204-01 covers the whole delivery, so it belongs here — at
              the moment the receipt exists and the truck may still be on the
              dock — not as something to remember later. */}
          <button type="button" onClick={() => onOpenChecklist?.(lastFiled)}
            className="px-2 py-0.5 rounded-md border border-powder-300 bg-white text-xs font-medium text-powder-800 hover:bg-powder-50 inline-flex items-center gap-1">
            <ClipboardCheck size={12} /> Inspection checklist
          </button>
        </div>
      )}

      {/* FORM 204-01 is part of receiving, not a separate errand — so it is on
          this screen from the moment it opens, not only in the strip that
          appears after a line is saved.
          The truck, driver, vendor, pallet count and customer # live on the
          CHECKLIST rather than on each line: one arrival is several lines and
          those facts belong to the delivery, so asking for them per line would
          be the same answer typed three times and three places to correct it. */}
      <div className="rounded-lg border border-powder-200 bg-powder-50 p-3 flex flex-wrap items-center gap-2">
        <ClipboardCheck size={16} className="text-powder-700 shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-powder-900">Inspection Checklist — FORM 204-01</p>
          <p className="text-xs text-powder-800">
            {checklistTarget
              ? <>Truck, driver, vendor and the 18 inspection checks for <span className="font-semibold">{checklistTarget}</span>.</>
              : 'The inspection comes first — start it on the Inspections tab, then file these lines against its number. Typing an existing number here opens its checklist.'}
          </p>
        </div>
        <button type="button" disabled={!checklistTarget}
          onClick={() => onOpenChecklist?.(checklistTarget)}
          className="shrink-0 px-3 py-1.5 rounded-lg bg-powder-600 text-white text-xs font-semibold hover:bg-powder-700 disabled:opacity-40 disabled:cursor-not-allowed">
          Open checklist
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Inspection #</label>
          <input value={form.inspection_no} onChange={e => set('inspection_no', e.target.value)} className={inputCls}
            placeholder={record ? 'A-100-0492' : (nextNo?.inspection_no ? `${nextNo.inspection_no} (assigned on save)` : 'Assigned on save')} />
          {!record && (
            <p className="mt-1 text-[11px] text-gray-500">
              Leave blank for a new inspection. Type an existing number to add this line to that receipt.
            </p>
          )}
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
            {withCurrent(uomList?.options, form.uom).map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
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
            {withCurrent(statusList?.options, form.status_of_release).map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
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
  // The inspection whose FORM 204-01 checklist is open, if any.
  const [checklist, setChecklist] = useState(null);
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

  const view = useCappedList(sorted);

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
          {view.items.map(r => {
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

      <div className="md:hidden"><ShowMore view={view} noun="receipts" /></div>

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
                {view.items.map(r => {
                  const exp = expiryState(r.expiration_date);
                  return (
                    <Fragment key={r.id}>
                    <tr {...expand.rowProps(r.id)}>
                      <td className="px-2 py-2"><ExpandCell open={expand.isExpanded(r.id)} /></td>
                      <td className="px-3 py-2 text-sm text-gray-900 whitespace-nowrap">{fmtDate(r.date_received)}</td>
                      <td className="px-3 py-2 text-sm text-gray-700 whitespace-nowrap">{r.po_number}</td>
                      <td className="px-3 py-2 text-sm text-gray-700 whitespace-nowrap">{r.part_number}</td>
                      <td className="px-3 py-2 text-sm text-gray-700 min-w-[200px]">
                        {r.part_description}
                        {/* The receipt says a sample was due off this pallet.
                            On the row, not only in the detail panel: it is the
                            thing somebody scanning the log is looking for. */}
                        {r.lab_test_required && (
                          <span className="ml-1.5 px-1.5 py-0.5 rounded bg-purple-100 text-purple-800 text-[10px] font-semibold whitespace-nowrap"
                            title={r.lab_test_notified_to ? `QA notified: ${r.lab_test_notified_to}` : 'QA could not be reached'}>
                            LAB
                          </span>
                        )}
                      </td>
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
                          // Says WHO was told and WHEN, or says plainly that
                          // nobody was reached — "lab sample due" with nothing
                          // behind it would be worse than no line at all.
                          ...(r.lab_test_required ? [{
                            label: 'Lab sample',
                            value: r.lab_test_notified_at
                              ? `Due — QA notified ${fmtDate(r.lab_test_notified_at)} (${r.lab_test_notified_to})`
                              : 'Due — but nobody could be notified. Tell QA.',
                            wide: true,
                          }] : []),
                          { label: 'Notes', value: r.notes, wide: true },
                        ]}>
                          {r.packing_slip_url && (
                            <a href={r.packing_slip_url} target="_blank" rel="noreferrer"
                              className="inline-flex items-center gap-1 text-blue-600 hover:underline text-xs">
                              <ExternalLink size={12} /> Packing slip
                            </a>
                          )}
                          {/* One checklist covers the whole receipt, so it
                              opens from any line that carries the number. */}
                          {r.inspection_no && (
                            <button type="button" onClick={() => setChecklist(r.inspection_no)}
                              className="inline-flex items-center gap-1 text-powder-700 hover:underline text-xs font-medium">
                              <ClipboardCheck size={12} /> Inspection checklist ({r.inspection_no})
                            </button>
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
          <ShowMore view={view} noun="receipts" />
        </div>
      )}

      {checklist && (
        <ReceivingChecklist inspectionNo={checklist} onClose={() => setChecklist(null)} />
      )}
    </div>
  );
}

// Who may file a receipt. Mirrors `canLog` in server/api/receiving.js; kept in
// one place here because both the default tab and the tab list read it.
const canFile = (user) => user?.role === 'admin' || user?.role === 'supervisor'
  || user?.department === 'warehouse'
  || (user?.module_access && !Array.isArray(user.module_access) && !!user.module_access['receiving-log']);

/* ── Inspections: where a delivery actually starts ─────────────────────────
 *
 * The warehouse's real order is: work the checklist at the truck, enter the
 * items in the ERP, then file the receiving lines here. The module used to
 * open on the log with "New Record" as the only action, which is that order
 * backwards — the checklist was reachable only AFTER a line existed, so the
 * first step of the process depended on the last.
 *
 * This is the front door now: start an inspection (which issues the number),
 * or pick up one somebody left half-finished.
 */
function InspectionsTab({ canLog, onOpen }) {
  const { data: rows, refresh } = useApiGet('/receiving/checklists');
  const { data: nextNo } = useApiGet('/receiving/next-inspection-no');
  const [starting, setStarting] = useState(false);
  const [typed, setTyped] = useState('');
  const [error, setError] = useState('');

  const start = async (inspection_no) => {
    setStarting(true); setError('');
    try {
      const c = await apiPost('/receiving/checklist', inspection_no ? { inspection_no } : {});
      setTyped('');
      refresh();
      onOpen(c.inspection_no);
    } catch (e) { setError(e.message || 'Could not start the inspection.'); }
    finally { setStarting(false); }
  };

  const open = (rows || []).filter(r => !r.reviewed_at);
  const done = (rows || []).filter(r => r.reviewed_at);

  const Card = ({ r }) => {
    const pct = r.total ? Math.round((r.answered / r.total) * 100) : 0;
    return (
      <button type="button" onClick={() => onOpen(r.inspection_no)}
        className="w-full text-left bg-white border border-gray-200 rounded-lg px-3 py-2.5 hover:border-powder-300 hover:bg-powder-50/40">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <p className="font-semibold text-gray-900 text-sm">
              {r.inspection_no}
              {r.vendor ? <span className="font-normal text-gray-500"> · {r.vendor}</span> : ''}
              {r.po_number ? <span className="font-normal text-gray-500"> · PO {r.po_number}</span> : ''}
            </p>
            <p className="text-xs text-gray-500">
              {r.inspection_date || '—'} · {r.inspector || 'unassigned'}
              {' · '}{r.line_count} line{r.line_count === 1 ? '' : 's'} filed
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {/* An unsent escalation is the one thing that should pull somebody
                back to a checklist, so it outranks the progress figure. */}
            {r.escalations_outstanding > 0 && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 text-[11px] font-semibold">
                <AlertTriangle size={11} /> {r.escalations_outstanding} to notify
              </span>
            )}
            {r.reviewed_at ? (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-green-100 text-green-800 text-[11px] font-semibold">
                <CheckCircle size={11} /> Signed off
              </span>
            ) : (
              <span className="text-[11px] text-gray-500 tabular-nums">{r.answered}/{r.total} answered</span>
            )}
          </div>
        </div>
        {!r.reviewed_at && (
          <div className="mt-1.5 h-1 rounded-full bg-gray-100 overflow-hidden">
            <div className={`h-full ${pct === 100 ? 'bg-green-500' : 'bg-powder-500'}`} style={{ width: `${pct}%` }} />
          </div>
        )}
      </button>
    );
  };

  return (
    <div className="space-y-4">
      {canLog && (
        <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
          <div>
            <h3 className="font-semibold text-gray-900 flex items-center gap-2">
              <ClipboardCheck size={16} className="text-powder-600" /> Start a receiving inspection
            </h3>
            <p className="text-xs text-gray-500 mt-0.5">
              Step 1 of the delivery: work FORM 204-01 at the truck. It issues the inspection number,
              which the receiving lines join once the items are in the ERP.
            </p>
          </div>
          {error && <p className="text-sm text-red-700 bg-red-50 rounded-lg p-2">{error}</p>}
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" disabled={starting} onClick={() => start(null)}
              className="px-3 py-2 rounded-lg bg-powder-600 text-white text-sm font-semibold hover:bg-powder-700 disabled:opacity-50">
              {starting ? 'Starting…' : `Start ${nextNo?.inspection_no || 'a new inspection'}`}
            </button>
            <span className="text-xs text-gray-400">or</span>
            {/* A paper form already filled in has its own number written on it. */}
            <input value={typed} onChange={e => setTyped(e.target.value)}
              placeholder="Number already on a paper form"
              className="px-2.5 py-2 border border-gray-300 rounded-lg text-sm w-56" />
            <button type="button" disabled={starting || !typed.trim()} onClick={() => start(typed.trim())}
              className="px-3 py-2 rounded-lg border border-gray-300 text-sm font-medium hover:bg-gray-50 disabled:opacity-40">
              Open that one
            </button>
          </div>
        </div>
      )}

      <div>
        <h4 className="text-xs font-bold uppercase tracking-wider text-gray-500 mb-1.5">
          In progress ({open.length})
        </h4>
        {open.length === 0 ? (
          <p className="text-sm text-gray-500">Nothing open. Start one when a truck arrives.</p>
        ) : (
          <div className="space-y-1.5">{open.map(r => <Card key={r.id} r={r} />)}</div>
        )}
      </div>

      {done.length > 0 && (
        <div>
          <h4 className="text-xs font-bold uppercase tracking-wider text-gray-500 mb-1.5">
            Signed off ({done.length})
          </h4>
          <div className="space-y-1.5 max-h-80 overflow-y-auto">{done.map(r => <Card key={r.id} r={r} />)}</div>
        </div>
      )}
    </div>
  );
}

/* ── Module ──────────────────────────────────────────────────────────────── */

export default function ReceivingLogPanel({ user }) {
  // Warehouse lands on Inspections — that is step one of a delivery, and it
  // used to be the step you could only reach after finishing the last one.
  // A ReadyBot escalation deep-links straight to the record it is about
  // (?view=film&film=<id> for QA's draft sheet, ?view=inspections&checklist=<no>
  // for FORM 204-01) — getParam is pure for the initializers, consumeParam in
  // the effect below clears them so a later remount doesn't replay the link.
  const [tab, setTab] = useState(() => {
    const v = getParam('view');
    if (v && ['inspections', 'film', 'log', 'form', 'import', 'lab-tests'].includes(v)) return v;
    return canFile(user) ? 'inspections' : 'log';
  });
  const [refreshKey, setRefreshKey] = useState(0);
  // FORM 204-01 for one inspection — opened from the form after filing, or
  // from any log row carrying that inspection number.
  const [checklist, setChecklist] = useState(() => getParam('checklist') || null);
  // Set when the checklist sends you to file a line, so the form opens against
  // that inspection instead of asking you to retype its number.
  const [prefillInspection, setPrefillInspection] = useState('');
  // FORM 418-01 for one flavour on one delivery.
  const [filmId, setFilmId] = useState(() => getParam('film') || null);
  useEffect(() => { consumeParam('view'); consumeParam('checklist'); consumeParam('film'); }, []);
  const canLog = canFile(user);
  const canFilm = canFilmInspect(user);
  // Importing rewrites the log in bulk — thousands of compliance records in one
  // action — so it stays admin-only rather than riding on the edit grant.
  const canImport = user?.role === 'admin';
  const { data: targets } = useApiGet(canImport ? '/imports/targets' : null);
  const importTarget = (targets || []).find(t => t.key === 'receiving_log');

  // In the order the work actually happens: inspect the delivery, then file
  // the lines, then read the log. Someone who cannot file skips straight to
  // the log, which is all they came for.
  const tabs = [
    ...(canLog ? [{ id: 'inspections', label: 'Inspections', icon: ClipboardCheck }] : []),
    // Read-only for the warehouse, filed by QA: whether QA has cleared the
    // packaging is exactly what the warehouse needs before putting it away, so
    // the tab is not hidden from them.
    { id: 'film', label: 'Packaging QA', icon: ScanLine },
    { id: 'log', label: 'Receiving Log', icon: ClipboardList },
    ...(canLog ? [{ id: 'form', label: 'New Record', icon: Plus }] : []),
    // QA's standing list. Visible to the warehouse read-only, because the
    // receiver whose line raised an alert should be able to see the rule.
    { id: 'lab-tests', label: 'Lab Tests', icon: FlaskConical },
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
      {tab === 'inspections' && canLog && (
        <InspectionsTab canLog={canLog} onOpen={setChecklist} />
      )}
      {tab === 'film' && <FilmInspectionsTab canInspect={canFilm} onOpen={setFilmId} />}
      {filmId && (
        <FilmPouchInspection id={filmId} canInspect={canFilm} onClose={() => setFilmId(null)} />
      )}
      {tab === 'form' && canLog && (
        <ReceivingForm key={prefillInspection} user={user} inspectionNo={prefillInspection}
          onSaved={() => setRefreshKey(k => k + 1)} onOpenChecklist={setChecklist} />
      )}
      {checklist && (
        <ReceivingChecklist inspectionNo={checklist} onClose={() => setChecklist(null)}
          onAddLine={(no) => { setChecklist(null); setPrefillInspection(no); setTab('form'); }} />
      )}
      {tab === 'import' && canImport && importTarget && (
        <ImportPanel target="receiving_log" targetLabel="Receiving Log"
          fields={importTarget.fields} onDone={() => setRefreshKey(k => k + 1)} />
      )}
      {tab === 'lab-tests' && <LabTestItemsTab />}
      {tab === 'log' && <ReceivingTable key={refreshKey} user={user} />}
    </div>
  );
}
