import { useMemo, useRef, useState } from 'react';
import { useApiGet, apiPost, apiPut, apiUpload } from '../../hooks/useApi';
import { useModuleTabs } from '../../lib/useModuleTabs';
import ModuleTabs from '../common/ModuleTabs.jsx';
import PhotoPicker from '../common/PhotoPicker.jsx';
import { printableImage } from '../../lib/printableImage';
import { formatDateTime } from '../../lib/datetime';
import { openFile } from '../../lib/openFile';
import { Camera, Inbox, Upload, FileText, X, Search, CheckCircle2, AlertTriangle, Library } from 'lucide-react';

// COC Drop (D-398) — the dock photographs a supplier's paper COC / COA, or
// chooses its PDF, and it waits here until Quality or Purchasing match it to
// its PO and file it into the supplier library. Mobile first: one column, big
// buttons. A dropper sees the drop form and their own drops; the queue's
// status and File controls are only drawn for someone who may use them.

const STATUS = {
  new: { label: 'New', tone: 'bg-sky-100 text-sky-800' },
  matched: { label: 'Matched', tone: 'bg-indigo-100 text-indigo-800' },
  mismatch: { label: 'Mismatch', tone: 'bg-amber-100 text-amber-900' },
  filed: { label: 'Filed', tone: 'bg-emerald-100 text-emerald-800' },
};
const INPUT = 'w-full px-3 py-2.5 border border-gray-300 rounded-lg text-base sm:text-sm bg-white';
const Chip = ({ s }) => <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${STATUS[s]?.tone || 'bg-gray-100 text-gray-700'}`}>{STATUS[s]?.label || s}</span>;
const Field = ({ label, children }) => (
  <label className="block"><span className="block text-xs font-medium text-gray-600 mb-1">{label}</span>{children}</label>
);

export default function CocDropPanel({ user }) {
  const { data: meta, refresh: refreshMeta } = useApiGet('/coc-drop/meta');
  if (!meta) return <div className="p-6 text-sm text-gray-500">Loading…</div>;
  return <CocDropBody user={user} meta={meta} refreshMeta={refreshMeta} />;
}

function CocDropBody({ user, meta, refreshMeta }) {
  const canWork = !!meta.can_work;
  const waiting = (meta.counts?.new || 0) + (meta.counts?.matched || 0) + (meta.counts?.mismatch || 0);
  const tabs = useMemo(() => [
    { id: 'drop', label: 'Drop a COC', icon: Camera },
    { id: 'queue', label: canWork ? 'Queue' : 'My drops', icon: Inbox, badge: canWork ? waiting : undefined, badgeTone: canWork && waiting ? 'alert' : undefined },
  ], [canWork, waiting]);
  // Quality and Purchasing land on the queue; the dock on the drop form.
  const { tab, setTab } = useModuleTabs({ id: 'coc-drop', tabs, user, initial: canWork ? 'queue' : 'drop' });
  const [openId, setOpenId] = useState(null);
  const [bump, setBump] = useState(0);
  const changed = () => { setBump(b => b + 1); refreshMeta(); };
  return (
    <div className="space-y-4 max-w-4xl">
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <h2 className="text-xl font-semibold text-gray-900 flex items-center gap-2"><Camera size={20} className="text-powder-600" /> COC Drop</h2>
          <p className="text-sm text-gray-500">Photograph a supplier’s COC or COA at the dock. No scanning, no email — Procurement matches it to the PO and files it.</p>
        </div>
        <ModuleTabs tabs={tabs} value={tab} onChange={setTab} className="sm:ml-auto" hideWhenSingle={false} />
      </div>
      {tab === 'drop' && <DropForm meta={meta} user={user} onDropped={changed} onOpen={setOpenId} bump={bump} />}
      {tab === 'queue' && <Queue meta={meta} canWork={canWork} onOpen={setOpenId} bump={bump} />}
      {openId && <Drawer id={openId} meta={meta} onClose={() => setOpenId(null)} onChanged={changed} />}
    </div>
  );
}

// ── Drop ─────────────────────────────────────────────────────────────────────

function DropForm({ meta, user, onDropped, onOpen, bump }) {
  const blank = { po_number: '', supplier_id: '', supplier_name: '', notes: '', kind: 'coc' };
  const [files, setFiles] = useState([]);
  const [form, setForm] = useState(blank);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [err, setErr] = useState('');
  const [done, setDone] = useState(null);
  const [over, setOver] = useState(false);
  const inputRef = useRef(null);
  const { data: recent, refresh } = useApiGet('/coc-drop/recent', [bump]);
  const storageOn = meta.storage_enabled;

  // Copy the FileList NOW (the AP Drop lesson): by the time a state updater
  // runs, the input has been reset and the list is empty.
  const add = (list) => { const picked = Array.from(list || []); setFiles(f => [...f, ...picked].slice(0, 10)); };
  const submit = async (e) => {
    e.preventDefault();
    if (!files.length) { setErr('Take a photo of the COC first, or choose its PDF.'); return; }
    setBusy(true); setErr(''); setDone(null); setProgress(0);
    try {
      const fd = new FormData();
      // A phone photo is redrawn upright as a JPEG, which the library PDF can draw.
      for (const f of files) fd.append('files', /^image\//.test(f.type) ? await printableImage(f) : f);
      Object.entries(form).forEach(([k, v]) => { if (v !== '') fd.append(k, v); });
      const r = await apiUpload('/coc-drop', fd, 'POST', setProgress);
      setDone(r.drop);
      setFiles([]); setForm(blank);
      refresh(); onDropped();
    } catch (ex) { setErr(ex.message); }
    finally { setBusy(false); }
  };

  return (
    <div className="space-y-4">
      {!storageOn && <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-sm text-amber-800">File storage is not configured on this server, so nothing can be dropped yet.</div>}
      <form onSubmit={submit} className="bg-white rounded-xl border border-gray-200 p-4 space-y-4">
        <PhotoPicker name="coc-drop" accept="image/*,application/pdf" onChange={e => { add(e.target.files); e.target.value = ''; }}
          takeLabel="Take a photo of the COC" chooseLabel="Choose a photo or PDF" className="[&_label]:px-4 [&_label]:py-3 [&_label]:text-sm" />
        <div data-coc-dropzone
          onDragOver={e => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
          onDrop={e => { e.preventDefault(); setOver(false); add(e.dataTransfer.files); }}
          onClick={() => inputRef.current?.click()}
          className={`rounded-xl border-2 border-dashed p-5 text-center cursor-pointer ${over ? 'border-powder-500 bg-powder-50' : 'border-gray-300 bg-gray-50'}`}>
          <Upload size={22} className="mx-auto text-powder-600 mb-1" />
          <div className="text-sm text-gray-700">Hold the phone flat, get the whole page in. Several photos become one document.</div>
          <input ref={inputRef} type="file" multiple accept="application/pdf,image/*" className="hidden" data-coc-input
            onChange={e => { add(e.target.files); e.target.value = ''; }} />
        </div>
        {files.length > 0 && (
          <ul className="space-y-1" data-coc-pages>
            {files.map((f, i) => (
              <li key={`${f.name}-${i}`} className="flex items-center gap-2 text-sm">
                <span className="text-xs text-gray-400 w-12 shrink-0">Page {i + 1}</span>
                <FileText size={14} className="text-gray-400 shrink-0" />
                <span className="truncate flex-1">{f.name}</span>
                <button type="button" aria-label="Remove" onClick={() => setFiles(fs => fs.filter((_, j) => j !== i))} className="p-2 text-gray-400 hover:text-red-600"><X size={16} /></button>
              </li>
            ))}
          </ul>
        )}
        <Field label="PO number (if you know it)">
          <input value={form.po_number} onChange={e => setForm({ ...form, po_number: e.target.value })} className={INPUT} list="coc-recent-pos" id="coc-po" autoComplete="off" />
          {meta.recent_pos?.length > 0 && <datalist id="coc-recent-pos">{meta.recent_pos.map(p => <option key={p} value={p} />)}</datalist>}
        </Field>
        <Field label="Supplier (if you know it)">
          <select value={form.supplier_id} onChange={e => setForm({ ...form, supplier_id: e.target.value })} className={INPUT} id="coc-supplier">
            <option value="">Not sure / not on the list</option>
            {(meta.suppliers || []).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </Field>
        {!form.supplier_id && (
          <Field label="Supplier name, if it is not on the list">
            <input value={form.supplier_name} onChange={e => setForm({ ...form, supplier_name: e.target.value })} className={INPUT} id="coc-supplier-name" />
          </Field>
        )}
        <Field label="Note">
          <textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} rows={2} className={INPUT} id="coc-notes" placeholder="Anything Procurement should know" />
        </Field>
        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          <span className="text-xs text-gray-500">Dropped by <strong>{user?.name}</strong>{busy ? ` · uploading ${progress}%` : ''}</span>
          {err && <span className="text-sm text-red-600">{err}</span>}
          <button type="submit" disabled={busy || !storageOn} data-coc-submit
            className="sm:ml-auto w-full sm:w-auto px-5 py-3 rounded-lg bg-powder-600 text-white text-base font-semibold disabled:opacity-50">
            {busy ? 'Dropping…' : files.length > 1 ? `Drop ${files.length} pages` : 'Drop it'}
          </button>
        </div>
        {done && (
          <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-sm text-emerald-800 flex gap-2" data-coc-done>
            <CheckCircle2 size={18} className="shrink-0" />
            <span>Dropped. Procurement will match it to the PO. You do not need to scan or email it.{done.status_reason ? ` (${done.status_reason})` : ''}</span>
          </div>
        )}
      </form>
      <div className="bg-white rounded-xl border border-gray-200">
        <div className="px-4 py-3 border-b border-gray-100 text-sm font-medium text-gray-700">Your recent drops</div>
        {!recent?.length
          ? <div className="p-6 text-sm text-gray-500 text-center">Nothing dropped yet.</div>
          : <Rows rows={recent} onOpen={onOpen} />}
      </div>
    </div>
  );
}

function Rows({ rows, onOpen }) {
  return (
    <ul className="divide-y divide-gray-100">
      {rows.map(r => (
        <li key={r.id}>
          <button type="button" onClick={() => onOpen(r.id)} data-coc-row={r.id} className="w-full text-left px-4 py-3 hover:bg-gray-50 flex items-start gap-3">
            <div className="flex-1 min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium text-gray-900">{r.po_number ? `PO ${r.po_number}` : 'No PO yet'}</span>
                <span className="text-xs uppercase text-gray-400">{r.kind}</span>
                <Chip s={r.status} />
              </div>
              <div className="text-xs text-gray-500 mt-0.5 truncate">
                {r.supplier?.name || r.supplier_name || 'Supplier not set'} · {r.pages} page{r.pages === 1 ? '' : 's'} · {r.submitter} · {formatDateTime(r.created_at)}
                {r.status_reason ? ` · ${r.status_reason}` : ''}
              </div>
            </div>
          </button>
        </li>
      ))}
    </ul>
  );
}

// ── Queue ────────────────────────────────────────────────────────────────────

function Queue({ meta, canWork, onOpen, bump }) {
  const [f, setF] = useState({ status: 'open', q: '' });
  const qs = new URLSearchParams({ status: f.status, ...(f.q.trim() ? { q: f.q.trim() } : {}) }).toString();
  const { data: rows, loading } = useApiGet(`/coc-drop?${qs}`, [bump]);
  const chips = [['open', 'Not filed'], ['new', 'New'], ['matched', 'Matched'], ['mismatch', 'Mismatch'], ['filed', 'Filed'], ['all', 'All']];
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5" data-coc-status-filter>
        {chips.map(([v, l]) => (
          <button key={v} type="button" onClick={() => setF({ ...f, status: v })}
            className={`px-3 py-1.5 rounded-full text-sm ${f.status === v ? 'bg-powder-600 text-white' : 'bg-white border border-gray-300 text-gray-700'}`}>
            {l}{v !== 'open' && v !== 'all' && meta.counts?.[v] ? ` · ${meta.counts[v]}` : ''}
          </button>
        ))}
      </div>
      <label className="flex items-center gap-2 px-3 py-2 border border-gray-300 rounded-lg bg-white">
        <Search size={16} className="text-gray-400" />
        <input value={f.q} onChange={e => setF({ ...f, q: e.target.value })} placeholder="PO, supplier, note…" className="flex-1 outline-none text-sm" id="coc-search" />
      </label>
      <div className="bg-white rounded-xl border border-gray-200">
        {loading && !rows ? <div className="p-6 text-sm text-gray-500">Loading…</div>
          : !rows?.length ? <div className="p-6 text-sm text-gray-500 text-center">{canWork ? 'Nothing waiting.' : 'You have not dropped anything here.'}</div>
            : <Rows rows={rows} onOpen={onOpen} />}
      </div>
    </div>
  );
}

// ── One drop ────────────────────────────────────────────────────────────────

function Drawer({ id, meta, onClose, onChanged }) {
  const { data: d, refresh } = useApiGet(`/coc-drop/${id}`, [id]);
  const [edit, setEdit] = useState(null);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [reason, setReason] = useState('');
  const work = !!d?.can_work;
  const fields = [['po_number', 'PO number'], ['part_number', 'Part number'], ['lot_number', 'Lot number'], ['qty_note', 'Quantity'], ['mismatch_note', 'Mismatch note']];
  const run = async (fn, ok) => {
    setBusy(true); setMsg('');
    try { const r = await fn(); setMsg(ok(r)); refresh(); onChanged(); }
    catch (e) { setMsg(e.message); }
    finally { setBusy(false); }
  };
  const supplierChosen = !!(d?.supplier_id || (edit?.supplier_name ?? d?.supplier_name));

  return (
    <div className="fixed inset-0 z-40 bg-black/40 flex justify-end" onClick={onClose}>
      <div onClick={e => e.stopPropagation()} data-coc-drawer className="bg-white w-full sm:max-w-lg h-full overflow-y-auto p-4 space-y-4">
        <div className="flex items-start gap-2">
          <div className="flex-1">
            <h3 className="text-lg font-semibold text-gray-900">{d?.po_number ? `PO ${d.po_number}` : 'COC drop'}</h3>
            {d && <div className="text-xs text-gray-500">Dropped {formatDateTime(d.created_at)} by {d.submitter} · <Chip s={d.status} /></div>}
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="p-2 text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>
        {!d ? <div className="text-sm text-gray-500">Loading…</div> : (
          <>
            {d.status_reason && <div className="p-2 rounded bg-amber-50 border border-amber-200 text-sm text-amber-900 flex gap-2"><AlertTriangle size={16} className="shrink-0" />{d.status_reason}</div>}
            <div className="grid grid-cols-2 gap-2" data-coc-pages-preview>
              {d.page_files.map((p, i) => (
                <button key={p.id} type="button" onClick={() => p.url && openFile({ url: p.url, name: p.filename })}
                  className="border border-gray-200 rounded-lg overflow-hidden text-left">
                  {/^image\//.test(p.content_type || '') && p.url
                    ? <img src={p.url} alt={`Page ${i + 1}`} className="w-full h-32 object-cover bg-gray-50" />
                    : <div className="h-32 flex items-center justify-center bg-gray-50"><FileText size={28} className="text-gray-400" /></div>}
                  <div className="px-2 py-1 text-xs text-gray-600 truncate">Page {i + 1} · {p.filename}</div>
                </button>
              ))}
            </div>

            <div className="space-y-3">
              <Field label="Supplier">
                {work ? (
                  <select value={(edit?.supplier_id ?? d.supplier_id) || ''} onChange={e => setEdit({ ...(edit || {}), supplier_id: e.target.value || null })} className={INPUT} id="coc-edit-supplier">
                    <option value="">Not chosen</option>
                    {(meta.suppliers || []).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                ) : <div className="text-sm">{d.supplier?.name || d.supplier_name || '—'}</div>}
              </Field>
              {work && !(edit?.supplier_id ?? d.supplier_id) && (
                <Field label="…or its name, if it is not on the list (added as not qualified)">
                  <input value={edit?.supplier_name ?? d.supplier_name ?? ''} onChange={e => setEdit({ ...(edit || {}), supplier_name: e.target.value })} className={INPUT} id="coc-edit-supplier-name" />
                </Field>
              )}
              {work && (
                <Field label="Kind">
                  <select value={edit?.kind ?? d.kind} onChange={e => setEdit({ ...(edit || {}), kind: e.target.value })} className={INPUT} id="coc-edit-kind">
                    <option value="coc">COC — certificate of compliance / conformance</option>
                    <option value="coa">COA — certificate of analysis</option>
                  </select>
                </Field>
              )}
              {fields.map(([k, l]) => (
                <Field key={k} label={l}>
                  {work && d.status !== 'filed'
                    ? <input value={edit?.[k] ?? d[k] ?? ''} onChange={e => setEdit({ ...(edit || {}), [k]: e.target.value })} className={INPUT} data-coc-field={k} id={`coc-edit-${k}`} />
                    : <div className="text-sm text-gray-900">{d[k] || <span className="text-gray-400">—</span>}</div>}
                </Field>
              ))}
              {work && d.status !== 'filed' && edit && (
                <button type="button" disabled={busy} data-coc-save onClick={() => run(() => apiPut(`/coc-drop/${id}`, edit), () => { setEdit(null); return 'Saved.'; })}
                  className="px-4 py-2.5 rounded-lg bg-powder-600 text-white text-sm font-medium">Save</button>
              )}
            </div>

            {work && d.status !== 'filed' && (
              <div className="space-y-2 border-t border-gray-100 pt-3" data-coc-status>
                <div className="text-xs font-medium text-gray-600">Status</div>
                <div className="flex flex-wrap gap-2">
                  {['new', 'matched'].map(s => (
                    <button key={s} type="button" disabled={busy || d.status === s} onClick={() => run(() => apiPost(`/coc-drop/${id}/status`, { status: s }), () => `Now ${STATUS[s].label}.`)}
                      className="px-3 py-2 rounded-lg border border-gray-300 text-sm disabled:opacity-50" data-coc-set={s}>{STATUS[s].label}</button>
                  ))}
                </div>
                <div className="flex gap-2">
                  <input value={reason} onChange={e => setReason(e.target.value)} placeholder="What does not match?" className={INPUT} id="coc-mismatch-reason" />
                  <button type="button" disabled={busy || reason.trim().length < 3} data-coc-set="mismatch"
                    onClick={() => run(() => apiPost(`/coc-drop/${id}/status`, { status: 'mismatch', reason }), () => { setReason(''); return 'Marked mismatch.'; })}
                    className="px-3 py-2 rounded-lg bg-amber-500 text-white text-sm shrink-0 disabled:opacity-50">Mismatch</button>
                </div>
                <button type="button" disabled={busy || !supplierChosen || !!edit} data-coc-file
                  onClick={() => run(() => apiPost(`/coc-drop/${id}/file`, {}), (r) => `Filed into ${r.drop?.supplier?.name || 'the supplier'}’s library${r.supplier_created ? ' (added as not qualified)' : ''}.${r.receiving_alert?.posted ? ' The dock was told.' : ''}`)}
                  className="w-full px-4 py-3 rounded-lg bg-emerald-600 text-white text-sm font-semibold flex items-center justify-center gap-2 disabled:opacity-50">
                  <Library size={16} /> File into library
                </button>
                {!supplierChosen && <div className="text-xs text-gray-500">Choose the supplier, or type its name, to file.</div>}
                {edit && <div className="text-xs text-gray-500">Save your changes first.</div>}
              </div>
            )}
            {d.status === 'filed' && d.library?.length > 0 && (
              <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-sm text-emerald-900">
                In the library: {d.library.map(l => l.filename).join(', ')}
              </div>
            )}
            {msg && <div className="text-sm text-gray-700" data-coc-msg>{msg}</div>}

            <div className="space-y-2 border-t border-gray-100 pt-3">
              <div className="text-xs font-medium text-gray-600">Activity</div>
              <ul className="space-y-1 text-xs text-gray-600">
                {d.events.map(e => (
                  <li key={e.id}>{formatDateTime(e.at)} · {e.by_name} · {e.kind.replace(/_/g, ' ')}{e.detail?.text ? `: ${e.detail.text}` : e.detail?.reason ? `: ${e.detail.reason}` : ''}</li>
                ))}
              </ul>
              <div className="flex gap-2">
                <input value={note} onChange={e => setNote(e.target.value)} placeholder="Add a note" className={INPUT} data-coc-note id="coc-note" />
                <button type="button" disabled={busy || !note.trim()} onClick={() => run(() => apiPost(`/coc-drop/${id}/notes`, { text: note }), () => { setNote(''); return 'Noted.'; })}
                  className="px-3 py-2 rounded-lg border border-gray-300 text-sm shrink-0">Add</button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
