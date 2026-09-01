import { useState } from 'react';
import { useApiGet, apiUpload, apiFetch, apiPut, apiDelete } from '../../hooks/useApi';
import { FolderOpen, Upload, AlertTriangle, ExternalLink, Trash2, Clock, X, Settings2 } from 'lucide-react';

/**
 * The shelf — the reference documents this work runs on.
 *
 * DELIBERATELY NOT CONTROLLED DOCUMENTS. An SOP has a revision, an approval and
 * a Document Change Request; a brand guide is a reference asset, and putting
 * Document Control in front of replacing one is how people stop putting it here
 * and go back to a Drive folder. Same line the Policies module draws.
 *
 * A SLOT IS "WHAT WE SHOULD HAVE", A DOCUMENT IS "WHAT WE HAVE". Keeping them
 * apart is what lets the shelf say a monthly Shopify export is two months old —
 * a folder of files can only ever say what is in it.
 */
const STATE = {
  missing: { tone: 'border-amber-200 bg-amber-50', chip: 'bg-amber-100 text-amber-800', label: 'Nothing on file' },
  due: { tone: 'border-amber-300 bg-amber-50', chip: 'bg-amber-100 text-amber-900', label: 'Out of date' },
  current: { tone: 'border-gray-200 bg-white', chip: 'bg-green-100 text-green-700', label: 'On file' },
};

function cadenceWords(days) {
  if (!days) return 'Kept until replaced';
  if (days <= 8) return 'Weekly';
  if (days <= 32) return 'Monthly';
  if (days <= 95) return 'Quarterly';
  if (days <= 190) return 'Every six months';
  return 'Annually';
}

function UploadForm({ slot, onDone, onCancel }) {
  const [file, setFile] = useState(null);
  const [form, setForm] = useState({ title: '', effective_date: new Date().toISOString().slice(0, 10), link_url: '', notes: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      const fd = new FormData();
      if (file) fd.append('files', file);
      for (const [k, v] of Object.entries(form)) if (v) fd.append(k, v);
      await apiUpload(`/products/shelf/${slot.key}`, fd);
      onDone();
    } catch (e2) { setError(e2.message); }
    setBusy(false);
  };

  return (
    <form onSubmit={submit} className="mt-2 space-y-2 border-t border-gray-200 pt-2">
      <input type="file" onChange={(e) => setFile(e.target.files?.[0] || null)}
        className="block w-full text-xs text-gray-600 file:mr-2 file:px-2 file:py-1 file:rounded-lg file:border-0 file:bg-powder-50 file:text-powder-700 file:text-xs" />
      <div className="grid grid-cols-2 gap-2">
        <label className="block">
          <span className="text-[11px] font-medium text-gray-600">Title</span>
          <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })}
            placeholder={slot.label}
            className="mt-0.5 w-full border border-gray-300 rounded-lg px-2 py-1.5 text-xs" />
        </label>
        <label className="block">
          {/* Dated from the DOCUMENT, not the upload — an export pulled on the
              1st and filed on the 4th is a 1st export, and dating it from the
              upload quietly buys three days that do not exist. */}
          <span className="text-[11px] font-medium text-gray-600">Document date</span>
          <input type="date" value={form.effective_date} onChange={(e) => setForm({ ...form, effective_date: e.target.value })}
            className="mt-0.5 w-full border border-gray-300 rounded-lg px-2 py-1.5 text-xs" />
        </label>
      </div>
      <label className="block">
        <span className="text-[11px] font-medium text-gray-600">…or a link, if it lives somewhere else</span>
        <input value={form.link_url} onChange={(e) => setForm({ ...form, link_url: e.target.value })}
          placeholder="https://…"
          className="mt-0.5 w-full border border-gray-300 rounded-lg px-2 py-1.5 text-xs" />
      </label>
      <label className="block">
        <span className="text-[11px] font-medium text-gray-600">Notes</span>
        <input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })}
          className="mt-0.5 w-full border border-gray-300 rounded-lg px-2 py-1.5 text-xs" />
      </label>
      {error && <p className="text-xs text-red-700">{error}</p>}
      <div className="flex gap-2">
        <button type="submit" disabled={busy}
          className="px-3 py-1.5 bg-powder-600 text-white rounded-lg text-xs font-medium hover:bg-powder-700 disabled:opacity-50">
          {busy ? 'Filing…' : 'File it'}
        </button>
        <button type="button" onClick={onCancel} className="px-3 py-1.5 bg-gray-100 text-gray-700 rounded-lg text-xs">Cancel</button>
      </div>
    </form>
  );
}

function History({ slotKey, canEdit, onChanged }) {
  const { data, refresh } = useApiGet(`/products/shelf/${slotKey}/documents`, [slotKey]);
  const docs = data?.documents || [];

  const open = async (d) => {
    if (d.link_url && !d.has_file) { window.open(d.link_url, '_blank', 'noopener'); return; }
    const r = await apiFetch(`/products/shelf/documents/${d.id}/file`);
    window.open(r.url, '_blank', 'noopener');
  };
  const remove = async (d) => {
    if (!window.confirm(`Remove "${d.title}"?`)) return;
    await apiDelete(`/products/shelf/documents/${d.id}`);
    refresh(); onChanged?.();
  };

  if (!docs.length) return <p className="mt-2 text-xs text-gray-400">Nothing filed yet.</p>;
  return (
    <ul className="mt-2 space-y-1 border-t border-gray-200 pt-2">
      {docs.map((d) => (
        <li key={d.id} className="flex items-center gap-2 text-xs">
          <button type="button" onClick={() => open(d)}
            className="text-powder-700 hover:underline text-left truncate flex items-center gap-1">
            {d.title}{(d.link_url && !d.has_file) && <ExternalLink size={10} />}
          </button>
          <span className="text-gray-400 shrink-0">{d.effective_date || (d.created_at || '').slice(0, 10)}</span>
          <span className="text-gray-400 truncate">{d.uploaded_by}</span>
          {/* A file whose text could not be read is still a file — say which,
              rather than letting somebody assume a search covered it. */}
          {d.has_file && d.searchable === false && (
            <span className="text-gray-400 shrink-0" title="No text could be read out of this file, so a search will not find what is inside it.">no text</span>
          )}
          {canEdit && (
            <button type="button" onClick={() => remove(d)} className="ml-auto p-1 text-gray-300 hover:text-red-500 shrink-0">
              <Trash2 size={12} />
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}

function CadenceEditor({ slot, onDone }) {
  const [days, setDays] = useState(slot.cadence_days ?? '');
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try { await apiPut(`/products/shelf/${slot.key}`, { cadence_days: days === '' ? null : Number(days) }); onDone(); }
    finally { setBusy(false); }
  };
  return (
    <div className="mt-2 border-t border-gray-200 pt-2 flex items-end gap-2">
      <label className="block">
        <span className="text-[11px] font-medium text-gray-600">A fresh copy is due every…</span>
        <div className="flex items-center gap-1.5 mt-0.5">
          <input type="number" min="1" value={days} onChange={(e) => setDays(e.target.value)} placeholder="—"
            className="w-20 border border-gray-300 rounded-lg px-2 py-1.5 text-xs" />
          <span className="text-xs text-gray-500">days · blank means keep until replaced</span>
        </div>
      </label>
      <button type="button" onClick={save} disabled={busy}
        className="px-3 py-1.5 bg-powder-600 text-white rounded-lg text-xs font-medium disabled:opacity-50">Save</button>
      <button type="button" onClick={onDone} className="px-3 py-1.5 bg-gray-100 text-gray-700 rounded-lg text-xs">Cancel</button>
    </div>
  );
}

export default function ProductShelf({ canEdit }) {
  const { data, refresh } = useApiGet('/products/shelf');
  const [openSlot, setOpenSlot] = useState(null);
  const [uploading, setUploading] = useState(null);
  const [editing, setEditing] = useState(null);

  if (!data) return <p className="text-sm text-gray-500">Loading…</p>;
  const slots = data.slots || [];
  const owed = slots.filter((s) => s.state !== 'current');

  return (
    <div className="space-y-3">
      <p className="text-sm text-gray-500 max-w-2xl">
        The reference documents this work runs on — what a proof is checked against, what a retailer asks
        for, and the exports the catalogue is reconciled against. Not controlled documents: replacing one
        of these should not need a Document Change Request.
      </p>

      {owed.length > 0 && (
        <p className="text-sm text-amber-900 bg-amber-50 border border-amber-200 rounded-lg p-3 flex items-start gap-2">
          <AlertTriangle size={15} className="mt-0.5 shrink-0 text-amber-600" />
          <span>
            {/* Two different problems, named separately: one is a chase and the
                other is a refresh, and they reach different people. */}
            {data.missing.length > 0 && <><strong>{data.missing.length} never filed</strong> — {data.missing.join(', ')}. </>}
            {data.due.length > 0 && <><strong>{data.due.length} out of date</strong> — {data.due.join(', ')}.</>}
          </span>
        </p>
      )}

      <div className="space-y-2">
        {slots.map((s) => {
          const st = STATE[s.state];
          const isOpen = openSlot === s.key;
          return (
            <div key={s.key} className={`rounded-xl border p-3 ${st.tone}`}>
              <div className="flex items-start gap-2 flex-wrap">
                <FolderOpen size={16} className="text-powder-600 mt-0.5 shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h4 className="text-sm font-semibold text-gray-900">{s.label}</h4>
                    <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-semibold ${st.chip}`}>{st.label}</span>
                    <span className="text-[11px] text-gray-500 inline-flex items-center gap-1">
                      <Clock size={11} /> {cadenceWords(s.cadence_days)}
                    </span>
                  </div>
                  <p className="text-xs text-gray-600 mt-0.5">{s.description}</p>
                  {s.latest ? (
                    <p className="text-[11px] text-gray-500 mt-1">
                      Latest: <span className="text-gray-700">{s.latest.title}</span>
                      {s.latest.effective_date ? ` · ${s.latest.effective_date}` : ''}
                      {s.days_old != null ? ` · ${s.days_old} day${s.days_old === 1 ? '' : 's'} old` : ''}
                      {s.count > 1 ? ` · ${s.count} on file` : ''}
                    </p>
                  ) : <p className="text-[11px] text-amber-800 mt-1">Nothing filed.</p>}
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <button type="button" onClick={() => setOpenSlot(isOpen ? null : s.key)}
                    className="px-2 py-1 text-xs text-gray-600 hover:bg-white rounded-lg">
                    {isOpen ? 'Hide' : `History${s.count ? ` (${s.count})` : ''}`}
                  </button>
                  {canEdit && (
                    <>
                      <button type="button" onClick={() => { setUploading(uploading === s.key ? null : s.key); setEditing(null); }}
                        className="inline-flex items-center gap-1 px-2 py-1 bg-powder-600 text-white rounded-lg text-xs font-medium hover:bg-powder-700">
                        {uploading === s.key ? <X size={12} /> : <Upload size={12} />} {uploading === s.key ? 'Cancel' : 'File'}
                      </button>
                      <button type="button" onClick={() => { setEditing(editing === s.key ? null : s.key); setUploading(null); }}
                        className="p-1.5 text-gray-400 hover:text-powder-600" data-tip="How often this is due">
                        <Settings2 size={13} />
                      </button>
                    </>
                  )}
                </div>
              </div>
              {uploading === s.key && (
                <UploadForm slot={s} onCancel={() => setUploading(null)}
                  onDone={() => { setUploading(null); refresh(); }} />
              )}
              {editing === s.key && <CadenceEditor slot={s} onDone={() => { setEditing(null); refresh(); }} />}
              {isOpen && <History slotKey={s.key} canEdit={canEdit} onChanged={refresh} />}
            </div>
          );
        })}
      </div>
    </div>
  );
}
