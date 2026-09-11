import { useEffect, useMemo, useRef, useState } from 'react';
import { useApiGet, apiFetch, apiPost, apiPut, apiUpload } from '../../hooks/useApi';
import { useModuleTabs } from '../../lib/useModuleTabs';
import ModuleTabs from '../common/ModuleTabs.jsx';
import { useCappedList } from '../../lib/useCappedList';
import ShowMore from '../common/ShowMore';
import { useCompactLayout } from '../../lib/useCompactLayout';
import { formatDate, formatDateTime } from '../../lib/datetime';
import { pdfViewerUrl } from '../../lib/pdfUrl';
import FilePreview from '../FilePreview';
import TextCell from '../common/TextCell.jsx';
import PhotoPicker from '../common/PhotoPicker.jsx';
import { Inbox, Upload, FileText, X, Search, RefreshCw, ExternalLink, AlertTriangle, Copy, Mail } from 'lucide-react';

// AP Drop — hand in a finance PDF, and the queue the office works it through.
//
// Two screens and a drawer. DROP is what everyone gets: a drop zone, a few
// optional fields, and the last ten things they handed in. OUTSTANDING is
// where the office lands: everything not yet paid, closed or rejected, with
// the filters that answer "what is overdue" and "what is waiting on somebody".
// The drawer is the same for both — the document, what the reader pulled off
// it (editable, each value beside the line it came from), the status, and the
// activity log. The server decides who may edit (`can_work`); this renders
// what it is told.

const STATUS_LABEL = {
  new: 'New', triaged: 'Triaged', matched: 'Matched to PO/CO', in_qbo: 'In QuickBooks',
  in_payment_run: 'In payment run', paid: 'Paid', closed: 'Closed',
  needs_info: 'Needs info', duplicate_suspect: 'Possible duplicate', not_finance: 'Not finance',
};
const STATUS_TONE = {
  new: 'bg-blue-50 text-blue-700 border-blue-200', triaged: 'bg-gray-100 text-gray-700 border-gray-200',
  matched: 'bg-indigo-50 text-indigo-700 border-indigo-200', in_qbo: 'bg-purple-50 text-purple-700 border-purple-200',
  in_payment_run: 'bg-teal-50 text-teal-700 border-teal-200', paid: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  closed: 'bg-gray-100 text-gray-500 border-gray-200', needs_info: 'bg-amber-50 text-amber-800 border-amber-200',
  duplicate_suspect: 'bg-orange-50 text-orange-800 border-orange-200', not_finance: 'bg-gray-100 text-gray-500 border-gray-200 line-through',
};
const PARSE_LABEL = { pending: 'reading…', ok: 'read', partial: 'partly read', failed: 'could not read' };
const money = (v, cur) => (v == null ? '—' : `${cur && cur !== 'USD' ? cur + ' ' : '$'}${Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const IMG_RE = /\.(png|jpe?g|gif|webp)$/i;
const PDF_RE = /\.pdf$/i;

const StatusChip = ({ status }) => (
  <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${STATUS_TONE[status] || 'bg-gray-100 text-gray-600 border-gray-200'}`}>
    {STATUS_LABEL[status] || status}
  </span>
);

export default function ApDropPanel({ user }) {
  const { data: meta, refresh: refreshMeta } = useApiGet('/ap-drop/meta');
  // The landing tab depends on who is asking (the office → the queue, anyone
  // else → the drop zone), and useModuleTabs reads its `initial` once, on
  // mount. So the tabbed body waits for /meta rather than mounting with the
  // wrong default and correcting itself a render later.
  if (!meta) return <div className="p-6 text-sm text-gray-500">Loading…</div>;
  return <ApDropBody user={user} meta={meta} refreshMeta={refreshMeta} />;
}

function ApDropBody({ user, meta, refreshMeta }) {
  const compact = useCompactLayout();
  const canWork = !!meta?.can_work;
  const outstanding = useMemo(() => {
    if (!meta?.counts) return 0;
    const term = new Set(meta.terminal || []);
    return Object.entries(meta.counts).filter(([s]) => !term.has(s)).reduce((n, [, c]) => n + c, 0);
  }, [meta]);
  const tabs = useMemo(() => [
    { id: 'queue', label: canWork ? 'Outstanding' : 'My drops', icon: Inbox, badge: outstanding, badgeTone: outstanding ? 'alert' : undefined },
    { id: 'drop', label: 'Drop a file', icon: Upload },
  ], [canWork, outstanding]);
  // The office lands on the queue; everyone else on the drop zone.
  const { tab, setTab } = useModuleTabs({ id: 'ap-drop', tabs, user, initial: canWork ? 'queue' : 'drop' });
  const [openId, setOpenId] = useState(null);
  const [bump, setBump] = useState(0);
  const changed = () => { setBump(b => b + 1); refreshMeta(); };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <h2 className="text-xl font-semibold text-gray-900 flex items-center gap-2"><Inbox size={20} className="text-powder-600" /> AP Drop</h2>
          <p className="text-sm text-gray-500">Got an invoice? Drop it here or forward it to <a className="text-powder-700 underline" href={`mailto:${meta?.inbox_email || 'ap@powder-ops.com'}`}>{meta?.inbox_email || 'ap@powder-ops.com'}</a>. Nothing is paid or sent from here — this is the queue the office works from.</p>
        </div>
        <ModuleTabs tabs={tabs} value={tab} onChange={setTab} className="sm:ml-auto" hideWhenSingle={false} />
      </div>

      {tab === 'drop' && <DropZone meta={meta} user={user} onDropped={changed} onOpen={setOpenId} bump={bump} compact={compact} />}
      {tab === 'queue' && <Queue meta={meta} canWork={canWork} onOpen={setOpenId} bump={bump} compact={compact} />}

      {openId && <DropDrawer id={openId} canWork={canWork} onClose={() => setOpenId(null)} onChanged={changed} compact={compact} />}
    </div>
  );
}

// ── Drop ─────────────────────────────────────────────────────────────────────

function DropZone({ meta, user, onDropped, onOpen, bump, compact }) {
  const [files, setFiles] = useState([]);
  const [form, setForm] = useState({ vendor_name: '', po_or_co_ref: '', amount: '', due_date: '', notes: '' });
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [err, setErr] = useState('');
  const [done, setDone] = useState(null);
  const inputRef = useRef(null);
  const { data: recent, refresh } = useApiGet('/ap-drop/recent', [bump]);
  const storageOn = meta ? meta.storage_enabled : true;

  // Copy the FileList NOW: the state updater runs later, and by then the
  // input's value has been reset and the list it pointed at is empty — so the
  // picker looked like it worked and the form said nothing was attached.
  const add = (list) => { const picked = Array.from(list || []); setFiles(f => [...f, ...picked].slice(0, 10)); };
  const submit = async (e) => {
    e.preventDefault();
    if (!files.length) { setErr('Attach the document first — a PDF or a photo of it.'); return; }
    setBusy(true); setErr(''); setDone(null); setProgress(0);
    try {
      const fd = new FormData();
      files.forEach(f => fd.append('files', f));
      Object.entries(form).forEach(([k, v]) => { if (v !== '') fd.append(k, v); });
      const r = await apiUpload('/ap-drop', fd, 'POST', setProgress);
      setDone(r.drops || []);
      setFiles([]); setForm({ vendor_name: '', po_or_co_ref: '', amount: '', due_date: '', notes: '' });
      refresh(); onDropped();
    } catch (ex) { setErr(ex.message); }
    finally { setBusy(false); }
  };

  return (
    <div className="space-y-4">
      {!storageOn && (
        <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-sm text-amber-800">File storage is not configured on this server, so nothing can be dropped yet. Forward the document to {meta?.inbox_email} instead.</div>
      )}
      <form onSubmit={submit} className="bg-white rounded-xl border border-gray-200 p-4 space-y-4">
        <div
          data-ap-dropzone
          onDragOver={e => { e.preventDefault(); setOver(true); }}
          onDragLeave={() => setOver(false)}
          onDrop={e => { e.preventDefault(); setOver(false); add(e.dataTransfer.files); }}
          onClick={() => inputRef.current?.click()}
          className={`rounded-xl border-2 border-dashed p-8 text-center cursor-pointer transition-colors ${over ? 'border-powder-500 bg-powder-50' : 'border-gray-300 hover:border-powder-400 bg-gray-50'}`}>
          <Upload size={28} className="mx-auto text-powder-600 mb-2" />
          <div className="font-medium text-gray-900">Drop a finance PDF here, or tap to choose</div>
          <div className="text-sm text-gray-500 mt-1">Vendor invoice, credit memo, remittance, a customer or M4 invoice pack, a bill somebody emailed you. Up to 10 files, 25 MB each.</div>
          <input ref={inputRef} data-ap-file type="file" multiple accept="application/pdf,image/*" className="hidden"
            onChange={e => { add(e.target.files); e.target.value = ''; }} />
        </div>
        {/* A paper invoice on the desk is photographed, not scanned. Two inputs,
            because a phone has two ways to attach a picture (the PhotoPicker
            rule): the camera opens directly, or the photo taken a minute ago is
            chosen from the roll. The photo goes through the same reader as a
            PDF — when the AI reader is on it is read like a scan; when it is
            off the row still files and the office types the details. */}
        <div className="flex flex-wrap items-center gap-2">
          <PhotoPicker name="ap-drop" accept="image/*,application/pdf" onChange={e => { add(e.target.files); e.target.value = ''; }}
            takeLabel="Take a photo of the invoice" chooseLabel="Choose a photo or file" />
          <span className="text-[11px] text-gray-500">A photo of a paper invoice works — hold the phone flat, get the whole page in.</span>
        </div>
        {files.length > 0 && (
          <ul className="space-y-1">
            {files.map((f, i) => (
              <li key={`${f.name}-${i}`} className="flex items-center gap-2 text-sm">
                <FileText size={14} className="text-gray-400 shrink-0" />
                <span className="truncate flex-1">{f.name}</span>
                <span className="text-gray-400 text-xs">{(f.size / 1024).toFixed(0)} KB</span>
                <button type="button" onClick={() => setFiles(fs => fs.filter((_, j) => j !== i))} className="text-gray-400 hover:text-red-600"><X size={14} /></button>
              </li>
            ))}
          </ul>
        )}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <Field label="Vendor (if you know it)"><input value={form.vendor_name} onChange={e => setForm({ ...form, vendor_name: e.target.value })} className={INPUT} placeholder="Read off the document if left blank" /></Field>
          <Field label="PO # / CO #"><input value={form.po_or_co_ref} onChange={e => setForm({ ...form, po_or_co_ref: e.target.value })} className={INPUT} /></Field>
          <Field label="Amount"><input value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} className={INPUT} inputMode="decimal" placeholder="$" /></Field>
          <Field label="Due date"><input type="date" value={form.due_date} onChange={e => setForm({ ...form, due_date: e.target.value })} className={INPUT} /></Field>
        </div>
        <Field label="Notes for the office"><textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} rows={2} className={INPUT} placeholder="Who sent it, what it is for, anything they should know" /></Field>
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-xs text-gray-500">Submitted by <strong>{user?.name}</strong></span>
          {busy && <span className="text-xs text-gray-500">Uploading… {progress}%</span>}
          {err && <span className="text-sm text-red-600">{err}</span>}
          <button type="submit" disabled={busy || !storageOn} data-ap-submit
            className="ml-auto px-4 py-2 rounded-lg bg-powder-600 text-white text-sm font-medium disabled:opacity-50">
            {busy ? 'Dropping…' : `Drop ${files.length > 1 ? `${files.length} files` : 'it'}`}
          </button>
        </div>
        {done && done.length > 0 && (
          <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-sm text-emerald-800" data-ap-done>
            {done.length === 1 ? 'Dropped. ' : `${done.length} dropped. `}
            {done.map(d => <span key={d.id} className="mr-3">{d.filename} — {PARSE_LABEL[d.parse_status] || d.parse_status}{d.vendor_name ? `, ${d.vendor_name}` : ''}{d.amount != null ? `, ${money(d.amount, d.currency)}` : ''}{d.status === 'duplicate_suspect' ? ' · looks like a duplicate' : ''}</span>)}
            The office has it in the queue.
          </div>
        )}
      </form>

      <div className="bg-white rounded-xl border border-gray-200">
        <div className="px-4 py-3 border-b border-gray-100 text-sm font-medium text-gray-700">Recent drops</div>
        {!recent?.length ? (
          <div className="p-6 text-sm text-gray-500 text-center">Nothing dropped yet. Got an invoice? Drop it above or forward it to {meta?.inbox_email || 'ap@powder-ops.com'}.</div>
        ) : <DropTable rows={recent} onOpen={onOpen} compact={compact} canWork={!!meta?.can_work} />}
      </div>
    </div>
  );
}

// ── Queue ────────────────────────────────────────────────────────────────────

function Queue({ meta, canWork, onOpen, bump, compact }) {
  const [f, setF] = useState({ status: 'outstanding', vendor: '', submitter: '', from: '', to: '', overdue: false, needs_info: false, q: '' });
  const qs = useMemo(() => {
    const p = new URLSearchParams();
    Object.entries(f).forEach(([k, v]) => { if (v !== '' && v !== false) p.set(k, v === true ? '1' : v); });
    return p.toString();
  }, [f]);
  const { data, loading, refresh } = useApiGet(`/ap-drop?${qs}`, [qs, bump]);
  const rows = data || [];
  const view = useCappedList(rows);
  const sel = 'px-2 py-1.5 border border-gray-300 rounded-lg text-sm bg-white';
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <select value={f.status} onChange={e => setF({ ...f, status: e.target.value })} className={sel} data-ap-status-filter>
          <option value="outstanding">Outstanding</option>
          <option value="all">Everything</option>
          {(meta?.statuses || []).map(s => <option key={s} value={s}>{STATUS_LABEL[s] || s}{meta?.counts?.[s] ? ` (${meta.counts[s]})` : ''}</option>)}
        </select>
        {canWork && (
          <select value={f.vendor} onChange={e => setF({ ...f, vendor: e.target.value })} className={sel}>
            <option value="">Any vendor</option>
            {(meta?.vendors || []).map(v => <option key={v} value={v}>{v}</option>)}
          </select>
        )}
        {canWork && (
          <select value={f.submitter} onChange={e => setF({ ...f, submitter: e.target.value })} className={sel}>
            <option value="">Anyone</option>
            {(meta?.submitters || []).map(v => <option key={v} value={v}>{v}</option>)}
          </select>
        )}
        <input type="date" value={f.from} onChange={e => setF({ ...f, from: e.target.value })} className={sel} title="Dropped from" />
        <input type="date" value={f.to} onChange={e => setF({ ...f, to: e.target.value })} className={sel} title="Dropped to" />
        <label className="flex items-center gap-1.5 text-sm text-gray-700"><input type="checkbox" checked={f.overdue} onChange={e => setF({ ...f, overdue: e.target.checked })} /> Overdue only</label>
        <label className="flex items-center gap-1.5 text-sm text-gray-700"><input type="checkbox" checked={f.needs_info} onChange={e => setF({ ...f, needs_info: e.target.checked })} /> Needs info only</label>
        <div className="relative flex-1 min-w-[180px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input value={f.q} onChange={e => setF({ ...f, q: e.target.value })} placeholder="Vendor, invoice #, PO, words inside the PDF…" className="w-full pl-9 pr-3 py-1.5 border border-gray-300 rounded-lg text-sm" />
        </div>
        <button type="button" onClick={refresh} className="p-2 text-gray-500 hover:text-gray-900" title="Refresh"><RefreshCw size={14} /></button>
      </div>
      <div className="bg-white rounded-xl border border-gray-200">
        {loading && !data ? <div className="p-6 text-sm text-gray-500">Loading…</div>
          : !rows.length ? (
            <div className="p-8 text-center text-sm text-gray-500" data-ap-empty>
              <Mail size={22} className="mx-auto text-gray-300 mb-2" />
              {f.status === 'outstanding' && !f.q && !f.vendor ? 'Nothing outstanding. ' : 'Nothing matches those filters. '}
              Got an invoice? Drop it here or forward it to {meta?.inbox_email || 'ap@powder-ops.com'}.
            </div>
          ) : <DropTable rows={view.items} onOpen={onOpen} compact={compact} canWork={canWork} />}
        <ShowMore view={view} noun="drops" />
      </div>
    </div>
  );
}

function DropTable({ rows, onOpen, compact, canWork }) {
  if (compact) {
    return (
      <ul className="divide-y divide-gray-100" data-ap-cards>
        {rows.map(r => (
          <li key={r.id} onClick={() => onOpen(r.id)} className="p-3 cursor-pointer hover:bg-gray-50">
            <div className="flex items-center gap-2">
              <span className="font-medium text-gray-900 truncate flex-1">{r.vendor_name || <span className="text-gray-400">Vendor not read</span>}</span>
              <StatusChip status={r.status} />
            </div>
            <div className="text-sm text-gray-600 flex flex-wrap gap-x-3 mt-1">
              <span>{r.invoice_number || '—'}</span><span>{money(r.amount, r.currency)}</span>
              <span className={r.overdue ? 'text-red-600 font-medium' : ''}>due {formatDate(r.due_date)}</span>
              <span>{r.age_days}d</span>
            </div>
            <div className="text-xs text-gray-500 mt-1 truncate">{r.filename} · {r.submitter}{r.status_reason ? ` · ${r.status_reason}` : ''}</div>
          </li>
        ))}
      </ul>
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm" data-ap-table>
        <thead className="text-left text-xs uppercase tracking-wide text-gray-500 border-b border-gray-100">
          <tr>
            <th className="px-3 py-2">Dropped</th><th className="px-3 py-2">Submitter</th><th className="px-3 py-2">Vendor</th>
            <th className="px-3 py-2">Invoice #</th><th className="px-3 py-2 text-right">Amount</th><th className="px-3 py-2">Due</th>
            <th className="px-3 py-2 text-right">Age</th><th className="px-3 py-2">Status</th><th className="px-3 py-2">Source</th>
            <th className="px-3 py-2">PO / CO</th><th className="px-3 py-2">Blocker / reason</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {rows.map(r => (
            <tr key={r.id} onClick={() => onOpen(r.id)} className="cursor-pointer hover:bg-gray-50" data-ap-row={r.id}>
              <td className="px-3 py-2 whitespace-nowrap text-gray-600">{formatDateTime(r.created_at)}</td>
              <td className="px-3 py-2 whitespace-nowrap">{r.submitter}</td>
              <td className="px-3 py-2">{r.vendor_name || <span className="text-gray-400 italic">not read</span>}</td>
              <td className="px-3 py-2 whitespace-nowrap">{r.invoice_number || '—'}</td>
              <td className="px-3 py-2 text-right whitespace-nowrap tabular-nums">{money(r.amount, r.currency)}</td>
              <td className={`px-3 py-2 whitespace-nowrap ${r.overdue ? 'text-red-600 font-medium' : ''}`}>{formatDate(r.due_date)}{r.overdue ? ' ⚠' : ''}</td>
              <td className="px-3 py-2 text-right tabular-nums">{r.age_days}d</td>
              <td className="px-3 py-2"><StatusChip status={r.status} /></td>
              <td className="px-3 py-2 text-gray-500">{r.source}</td>
              <td className="px-3 py-2"><TextCell value={r.po_or_co_ref || ''} width={140} lines={1} /></td>
              <td className="px-3 py-2"><TextCell value={r.status_reason || ''} width={220} lines={2} /></td>
            </tr>
          ))}
        </tbody>
      </table>
      {!canWork && <div className="px-3 py-2 text-xs text-gray-400">Showing what you dropped. The office sees the whole queue.</div>}
    </div>
  );
}

// ── Drawer ───────────────────────────────────────────────────────────────────

const FIELD_DEFS = [
  ['vendor_name', 'Vendor', 'vendor'], ['invoice_number', 'Invoice #', 'invoice_number'], ['invoice_date', 'Invoice date', 'invoice_date', 'date'],
  ['due_date', 'Due date', 'due_date', 'date'], ['amount', 'Amount', 'total', 'amount'], ['currency', 'Currency', null],
  ['po_or_co_ref', 'PO / CO', 'order_refs'], ['bill_to', 'Bill to', 'bill_to'],
];

function DropDrawer({ id, canWork, onClose, onChanged, compact }) {
  const { data: d, refresh, loading } = useApiGet(`/ap-drop/${id}`, [id]);
  const [preview, setPreview] = useState(false);
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && !preview) onClose(); };
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey);
  }, [onClose, preview]);

  return (
    <div className="fixed inset-0 z-[60] flex" onClick={onClose}>
      <div className="flex-1 bg-black/30" />
      <div onClick={e => e.stopPropagation()} data-ap-drawer
        className={`bg-white h-full overflow-y-auto shadow-2xl ${compact ? 'w-full' : 'w-[min(720px,92vw)]'}`}>
        <div className="sticky top-0 bg-white border-b border-gray-200 px-4 py-3 flex items-center gap-2 z-10">
          <FileText size={16} className="text-powder-600 shrink-0" />
          <div className="min-w-0 flex-1">
            <div className="font-medium text-gray-900 truncate">{d?.filename || 'Loading…'}</div>
            {d && <div className="text-xs text-gray-500">Dropped {formatDateTime(d.created_at)} by {d.submitter} · {d.source} · {PARSE_LABEL[d.parse_status] || d.parse_status}</div>}
          </div>
          {d && <StatusChip status={d.status} />}
          <button type="button" onClick={onClose} className="p-1.5 text-gray-400 hover:text-gray-900" aria-label="Close"><X size={18} /></button>
        </div>
        {loading && !d ? <div className="p-6 text-sm text-gray-500">Loading…</div> : d && (
          // Keyed on the record's version: a save or a status move reloads it
          // and the editable state starts fresh from what the server now says.
          <DrawerBody key={`${d.updated_at}|${d.status}|${(d.events || []).length}`} d={d} canWork={canWork} compact={compact}
            refresh={refresh} onChanged={onChanged} onPreview={() => setPreview(true)} />
        )}
      </div>
      {preview && d?.file_url && <FilePreview items={{ url: d.file_url, name: d.filename }} onClose={() => setPreview(false)} />}
    </div>
  );
}

function DrawerBody({ d, canWork, compact, refresh, onChanged, onPreview }) {
  const id = d.id;
  const [edit, setEdit] = useState(null);
  const [status, setStatus] = useState(d.status);
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true); setErr('');
    try { await apiPut(`/ap-drop/${id}`, edit); setEdit(null); refresh(); onChanged(); } catch (ex) { setErr(ex.message); } finally { setBusy(false); }
  };
  const move = async () => {
    setBusy(true); setErr('');
    try { await apiPost(`/ap-drop/${id}/status`, { status, reason }); setReason(''); refresh(); onChanged(); } catch (ex) { setErr(ex.message); } finally { setBusy(false); }
  };
  const addNote = async () => {
    if (!note.trim()) return;
    setBusy(true); setErr('');
    try { await apiPost(`/ap-drop/${id}/notes`, { text: note }); setNote(''); refresh(); } catch (ex) { setErr(ex.message); } finally { setBusy(false); }
  };
  const reparse = async () => {
    setBusy(true); setErr('');
    try { await apiFetch(`/ap-drop/${id}/reparse`, { method: 'POST' }); refresh(); onChanged(); } catch (ex) { setErr(ex.message); } finally { setBusy(false); }
  };

  const isPdf = PDF_RE.test(d.filename || '');
  const isImg = IMG_RE.test(d.filename || '');
  const evidence = d?.parsed?.evidence || {};
  const needsReason = ['needs_info', 'not_finance', 'duplicate_suspect'].includes(status);

  return (
          <div className="p-4 space-y-5">
            {d.duplicate_of && (
              <div className="p-3 rounded-lg bg-orange-50 border border-orange-200 text-sm text-orange-900 flex items-start gap-2" data-ap-dup>
                <Copy size={16} className="shrink-0 mt-0.5" />
                <div>Same file as a drop from {formatDateTime(d.duplicate_of.created_at)} by {d.duplicate_of.submitter} (now <StatusChip status={d.duplicate_of.status} />). If it is the same bill, close this one as a duplicate; if not, move it on.</div>
              </div>
            )}

            {/* The document. A phone cannot pinch an embedded PDF, so on the
                compact layout it opens in the phone's own viewer instead. */}
            <div className="rounded-lg border border-gray-200 overflow-hidden bg-gray-50">
              {d.file_url ? (
                compact || (!isPdf && !isImg) ? (
                  <a href={d.file_url} target="_blank" rel="noreferrer" className="flex items-center gap-2 p-4 text-sm text-powder-700"><ExternalLink size={16} /> Open the document</a>
                ) : isPdf ? (
                  <iframe title="Document" src={pdfViewerUrl(d.file_url)} className="w-full h-[420px] bg-white" />
                ) : (
                  <img src={d.file_url} alt={d.filename} className="w-full max-h-[420px] object-contain bg-white cursor-zoom-in" onClick={onPreview} />
                )
              ) : <div className="p-4 text-sm text-gray-500">The file is stored but cannot be previewed right now.</div>}
              {d.file_url && !compact && (
                <div className="px-3 py-2 border-t border-gray-200 flex gap-3 text-xs">
                  <button type="button" onClick={onPreview} className="text-powder-700">Full screen</button>
                  <a href={d.file_url} target="_blank" rel="noreferrer" className="text-powder-700">Open in a new tab</a>
                </div>
              )}
            </div>

            {/* What was read, beside the line it was read from. */}
            <section>
              <div className="flex items-center gap-2 mb-2">
                <h3 className="text-sm font-semibold text-gray-800">What was read off the document</h3>
                {d.parse_status === 'failed' && <span className="text-xs text-red-600 flex items-center gap-1"><AlertTriangle size={12} /> nothing readable — a scan with no text layer, most likely</span>}
                {canWork && <button type="button" onClick={reparse} disabled={busy} className="ml-auto text-xs text-powder-700 flex items-center gap-1"><RefreshCw size={12} /> Re-read (fills blanks only)</button>}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {FIELD_DEFS.map(([key, label, evKey, kind]) => {
                  const ev = evKey ? evidence[evKey] : null;
                  const evText = Array.isArray(ev) ? ev.join(' · ') : ev;
                  const val = edit ? edit[key] : d[key];
                  return (
                    <div key={key}>
                      <div className="text-xs text-gray-500 mb-0.5">{label}</div>
                      {edit ? (
                        <input type={kind === 'date' ? 'date' : 'text'} value={val ?? ''} inputMode={kind === 'amount' ? 'decimal' : undefined}
                          onChange={e => setEdit({ ...edit, [key]: e.target.value })} className={INPUT} data-ap-field={key} />
                      ) : (
                        <div className="text-sm text-gray-900" data-ap-value={key}>{kind === 'amount' ? money(d.amount, d.currency) : kind === 'date' ? formatDate(d[key]) : (d[key] || <span className="text-gray-400">—</span>)}</div>
                      )}
                      {evText && <div className="text-[11px] text-gray-400 truncate" title={evText}>from: “{evText}”</div>}
                    </div>
                  );
                })}
                <div className="sm:col-span-2">
                  <div className="text-xs text-gray-500 mb-0.5">Notes</div>
                  {edit ? <textarea value={edit.notes ?? ''} onChange={e => setEdit({ ...edit, notes: e.target.value })} rows={2} className={INPUT} />
                    : <div className="text-sm text-gray-900 whitespace-pre-line">{d.notes || <span className="text-gray-400">—</span>}</div>}
                </div>
                {canWork && (['qbo_bill_id', 'payment_run_id', 'external_ref']).map(k => (
                  <div key={k}>
                    <div className="text-xs text-gray-500 mb-0.5">{k === 'qbo_bill_id' ? 'QuickBooks bill id' : k === 'payment_run_id' ? 'Payment run' : 'External ref'}</div>
                    {edit ? <input value={edit[k] ?? ''} onChange={e => setEdit({ ...edit, [k]: e.target.value })} className={INPUT} />
                      : <div className="text-sm text-gray-900">{d[k] || <span className="text-gray-400">—</span>}</div>}
                  </div>
                ))}
              </div>
              {canWork && (
                <div className="mt-3 flex gap-2">
                  {edit ? (
                    <>
                      <button type="button" onClick={save} disabled={busy} className="px-3 py-1.5 rounded-lg bg-powder-600 text-white text-sm" data-ap-save>Save fields</button>
                      <button type="button" onClick={() => setEdit(null)} className="px-3 py-1.5 rounded-lg border border-gray-300 text-sm">Cancel</button>
                    </>
                  ) : (
                    <button type="button" data-ap-edit onClick={() => setEdit(Object.fromEntries([...FIELD_DEFS.map(f => f[0]), 'notes', 'qbo_bill_id', 'payment_run_id', 'external_ref'].map(k => [k, d[k] ?? ''])))}
                      className="px-3 py-1.5 rounded-lg border border-gray-300 text-sm">Correct the fields</button>
                  )}
                </div>
              )}
            </section>

            {/* Status. The office only. */}
            {canWork && (
              <section className="p-3 rounded-lg bg-gray-50 border border-gray-200">
                <h3 className="text-sm font-semibold text-gray-800 mb-2">Status</h3>
                <div className="flex flex-wrap gap-2 items-center">
                  <select value={status} onChange={e => setStatus(e.target.value)} className="px-2 py-1.5 border border-gray-300 rounded-lg text-sm bg-white" data-ap-status>
                    {Object.keys(STATUS_LABEL).map(s => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
                  </select>
                  <input value={reason} onChange={e => setReason(e.target.value)} placeholder={needsReason ? 'Why — required, shows on the queue' : 'Reason (optional)'}
                    className="flex-1 min-w-[200px] px-2 py-1.5 border border-gray-300 rounded-lg text-sm" data-ap-reason />
                  <button type="button" onClick={move} disabled={busy || (status === d.status && !reason)} className="px-3 py-1.5 rounded-lg bg-powder-600 text-white text-sm disabled:opacity-50" data-ap-move>Apply</button>
                </div>
                {d.status_reason && <div className="text-xs text-gray-600 mt-2">Current reason: {d.status_reason}</div>}
                <div className="text-[11px] text-gray-400 mt-2">new → triaged → matched → in QuickBooks → in payment run → paid / closed. Nothing here creates a QuickBooks bill or pays anyone — the Controller does that outside ReadyDoc and links the bill id back.</div>
              </section>
            )}

            {/* Activity. */}
            <section>
              <h3 className="text-sm font-semibold text-gray-800 mb-2">Activity</h3>
              <ol className="space-y-1.5 text-sm" data-ap-activity>
                {(d.events || []).map(e => (
                  <li key={e.id} className="flex gap-2">
                    <span className="text-xs text-gray-400 whitespace-nowrap w-32 shrink-0">{formatDateTime(e.at)}</span>
                    <span className="text-gray-800"><strong>{e.by_name}</strong> {describeEvent(e)}</span>
                  </li>
                ))}
              </ol>
              <div className="flex gap-2 mt-3">
                <input value={note} onChange={e => setNote(e.target.value)} placeholder="Add a note" className="flex-1 px-2 py-1.5 border border-gray-300 rounded-lg text-sm" data-ap-note
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addNote(); } }} />
                <button type="button" onClick={addNote} disabled={busy || !note.trim()} className="px-3 py-1.5 rounded-lg border border-gray-300 text-sm disabled:opacity-50">Add</button>
              </div>
            </section>
            {err && <div className="text-sm text-red-600">{err}</div>}
          </div>
  );
}

function describeEvent(e) {
  const dt = e.detail || {};
  switch (e.kind) {
    case 'uploaded': return `dropped ${dt.filename || 'the file'}${dt.duplicate_of ? ' (same file as an earlier drop)' : ''}`;
    case 'parsed': return dt.status === 'failed' ? `— nothing could be read (${dt.reason || 'no text'})` : `— reader ${dt.status === 'ok' ? 'read' : 'partly read'} it: ${(dt.fields_read || []).join(', ') || 'nothing'}`;
    case 'fields_edited': return `corrected ${Object.entries(dt).map(([k, v]) => `${k.replace(/_/g, ' ')} (${v.from ?? '—'} → ${v.to ?? '—'})`).join(', ')}`;
    case 'status_changed': return `moved it ${STATUS_LABEL[dt.from] || dt.from} → ${STATUS_LABEL[dt.to] || dt.to}${dt.reason ? `: ${dt.reason}` : ''}`;
    case 'note': return `noted: ${dt.text}`;
    case 'duplicate_dropped': return 'dropped the same file again (linked)';
    default: return e.kind;
  }
}

const INPUT = 'w-full px-3 py-2 border border-gray-300 rounded-lg text-sm';
const Field = ({ label, children }) => (<label className="block"><span className="block text-xs text-gray-500 mb-1">{label}</span>{children}</label>);
