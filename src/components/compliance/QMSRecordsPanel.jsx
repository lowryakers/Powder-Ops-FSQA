import { useState, useMemo } from 'react';
import { useApiGet, apiPost, apiPut, apiFetch } from '../../hooks/useApi';
import { useAuth } from '../../hooks/useAuth';
import { canEditModule } from '../../utils/permissions';
import FileUpload from '../FileUpload';
import { Plus, Search, Edit2, Trash2, Download, Upload, X, Check, Paperclip, FileText, ChevronUp, ChevronDown, AlertTriangle, CheckSquare, Square } from 'lucide-react';

// Mirror of server canSignApproval — admin always; else role/department match.
function canSign(user, appr) {
  if (!user || !appr || appr.external) return false;
  if (user.role === 'admin') return true;
  if (Array.isArray(appr.roles) && appr.roles.includes(user.role)) return true;
  if (Array.isArray(appr.departments) && appr.departments.includes(user.department)) return true;
  return false;
}

function requiredPending(cfg, rec) {
  if (rec.paper_record) return [];
  return cfg.approvals.filter(a => a.required && !rec.approvals?.[a.key]);
}
function approvalState(cfg, rec) {
  if (rec.paper_record) return { paper: true, done: true, pending: [] };
  const pending = requiredPending(cfg, rec);
  return { paper: false, done: pending.length === 0, pending };
}

function ApprovalBadge({ cfg, rec }) {
  const { paper, done, pending } = approvalState(cfg, rec);
  if (paper) return <span className="px-2 py-0.5 rounded-full text-xs bg-gray-100 text-gray-600 inline-flex items-center gap-1 whitespace-nowrap"><FileText size={11} /> On paper</span>;
  if (done) return <span className="px-2 py-0.5 rounded-full text-xs bg-green-100 text-green-700 inline-flex items-center gap-1 whitespace-nowrap"><Check size={11} /> Approved</span>;
  return <span className="px-2 py-0.5 rounded-full text-xs bg-amber-100 text-amber-700 inline-flex items-center gap-1 whitespace-nowrap"><AlertTriangle size={11} /> {pending.map(a => a.label).join(' + ')} needed</span>;
}

function fieldLabel(cfg, key) {
  if (key === 'record_number') return `${cfg.short} #`;
  if (key === 'record_date') return cfg.dateLabel || 'Date';
  if (key === 'approvals') return 'Approvals';
  const f = cfg.fields.find(x => x.key === key);
  return f ? f.label : key;
}
function displayValue(cfg, rec, key) {
  if (key === 'record_number') return rec.record_number || '—';
  if (key === 'record_date') return rec.record_date || '—';
  const f = cfg.fields.find(x => x.key === key);
  let v = rec[key];
  if (v === undefined || v === null || v === '') return '—';
  if (f?.type === 'checkbox') return v ? 'Yes' : 'No';
  if (Array.isArray(v)) return v.length ? v.join(', ') : '—';
  return String(v);
}

function dateVal(s) {
  if (!s) return 0;
  const t = Date.parse(s); if (!Number.isNaN(t)) return t;
  const m = String(s).match(/(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/);
  if (m) return new Date(+(m[3].length === 2 ? '20' + m[3] : m[3]), +m[1] - 1, +m[2]).getTime();
  return 0;
}

function SortTh({ label, field, sortField, sortDir, onSort, align = 'left' }) {
  return (
    <th onClick={() => onSort(field)} className={`px-2 py-2 text-${align} text-xs font-semibold text-gray-600 cursor-pointer select-none hover:text-gray-900 whitespace-nowrap`}>
      <span className={`inline-flex items-center gap-1 ${align === 'center' ? 'justify-center' : ''}`}>{label}{sortField === field && (sortDir === 'asc' ? <ChevronUp size={12} /> : <ChevronDown size={12} />)}</span>
    </th>
  );
}

/* ───────── Field editor ───────── */
function FieldInput({ f, value, onChange }) {
  const base = 'w-full px-3 py-2 border border-gray-300 rounded-lg text-sm';
  if (f.type === 'textarea') return <textarea value={value || ''} onChange={e => onChange(e.target.value)} rows={3} className={base} />;
  if (f.type === 'date') return <input type="date" value={value || ''} onChange={e => onChange(e.target.value)} className={base} />;
  if (f.type === 'number') return <input type="number" value={value ?? ''} onChange={e => onChange(e.target.value)} className={base} />;
  if (f.type === 'checkbox') return <label className="flex items-center gap-2 text-sm text-gray-700"><input type="checkbox" checked={!!value} onChange={e => onChange(e.target.checked)} className="rounded border-gray-300" /> {f.label}</label>;
  if (f.type === 'select') return (
    <select value={value || ''} onChange={e => onChange(e.target.value)} className={base}>
      <option value="">—</option>
      {f.options.map(o => <option key={o} value={o}>{o}</option>)}
    </select>
  );
  if (f.type === 'multiselect') {
    const arr = Array.isArray(value) ? value : [];
    const toggle = (o) => onChange(arr.includes(o) ? arr.filter(x => x !== o) : [...arr, o]);
    return (
      <div className="flex flex-wrap gap-1.5">
        {f.options.map(o => (
          <button type="button" key={o} onClick={() => toggle(o)} className={`px-2 py-1 rounded-lg text-xs border ${arr.includes(o) ? 'bg-powder-600 text-white border-powder-600' : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'}`}>{o}</button>
        ))}
      </div>
    );
  }
  return <input value={value || ''} onChange={e => onChange(e.target.value)} className={base} />;
}

/* ───────── Create / edit form ───────── */
function RecordForm({ cfg, initial, onSave, onCancel }) {
  const [form, setForm] = useState(() => {
    const base = { record_number: initial?.record_number || '', record_date: initial?.record_date || '', notes: initial?.notes || '', paper_record: !!initial?.paper_record, document_url: initial?.document_url || '' };
    for (const f of cfg.fields) base[f.key] = initial?.[f.key] ?? (f.type === 'checkbox' ? false : f.type === 'multiselect' ? [] : '');
    return base;
  });
  const [saving, setSaving] = useState(false);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const docFiles = form.document_url ? [{ url: form.document_url, originalName: 'Attached form' }] : [];
  const submit = async (e) => { e.preventDefault(); setSaving(true); try { await onSave(form); } finally { setSaving(false); } };

  return (
    <div className="fixed inset-0 bg-black/30 z-50 flex items-start justify-center p-4 overflow-y-auto" onClick={onCancel}>
      <form onClick={e => e.stopPropagation()} onSubmit={submit} className="bg-white rounded-xl shadow-xl w-full max-w-3xl my-6 p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-gray-900">{initial?.id ? 'Edit' : 'New'} {cfg.singular} <span className="text-xs font-normal text-gray-400">({cfg.formCode})</span></h3>
          <button type="button" onClick={onCancel} className="p-1 hover:bg-gray-100 rounded-lg"><X size={18} className="text-gray-500" /></button>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">{cfg.short} # <span className="text-gray-400 font-normal">(auto if blank)</span></label>
            <input value={form.record_number} onChange={e => set('record_number', e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">{cfg.dateLabel || 'Date'}</label>
            <input type="date" value={form.record_date || ''} onChange={e => set('record_date', e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
          </div>
        </div>

        <div className="grid sm:grid-cols-2 gap-3">
          {cfg.fields.map(f => (
            <div key={f.key} className={f.type === 'textarea' || f.type === 'multiselect' ? 'sm:col-span-2' : ''}>
              {f.type !== 'checkbox' && <label className="block text-xs font-medium text-gray-700 mb-1">{f.label}</label>}
              <FieldInput f={f} value={form[f.key]} onChange={v => set(f.key, v)} />
            </div>
          ))}
        </div>

        <div className="grid sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Notes</label>
            <input value={form.notes} onChange={e => set('notes', e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Attach original form (optional)</label>
            <FileUpload files={docFiles} maxFiles={1} onChange={(files) => set('document_url', files[0]?.url || '')} />
          </div>
        </div>

        <label className="flex items-start gap-2 text-sm text-gray-700 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
          <input type="checkbox" checked={form.paper_record} onChange={e => set('paper_record', e.target.checked)} className="rounded border-gray-300 mt-0.5" />
          <span>Logged on paper (historical)<span className="block text-[11px] text-gray-400">Signatures live on the original form — attach it above. Not flagged as awaiting in-system approval.</span></span>
        </label>
        <p className="text-[11px] text-gray-400">Approvals are applied from the record's detail view by an authorized user.</p>

        <div className="flex items-center gap-2 pt-1">
          <button type="submit" disabled={saving} className="flex-1 px-4 py-2 bg-powder-600 text-white text-sm font-medium rounded-lg hover:bg-powder-700 disabled:opacity-50">{saving ? 'Saving…' : `Save ${cfg.singular}`}</button>
          <button type="button" onClick={onCancel} className="px-4 py-2 bg-gray-100 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-200">Cancel</button>
        </div>
      </form>
    </div>
  );
}

/* ───────── CSV import ───────── */
function CsvImportModal({ cfg, onImported, onClose }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const handleFile = async (file) => {
    if (!file) return;
    setBusy(true); setError(null);
    try { const csv = await file.text(); onImported(await apiPost(`/qms/${cfg.key}/import`, { csv })); }
    catch (err) { setError(err.message || 'Import failed.'); setBusy(false); }
  };
  return (
    <div className="fixed inset-0 bg-black/30 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-5 space-y-4" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-gray-900">Import {cfg.label} log (CSV)</h3>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded-lg"><X size={18} className="text-gray-500" /></button>
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <p className="text-xs text-gray-500">Imported rows are marked as historical paper records. Column headers are matched to the form fields automatically.</p>
        <label className="flex flex-col items-center justify-center gap-2 border-2 border-dashed border-gray-300 rounded-xl py-10 cursor-pointer hover:bg-gray-50">
          <Upload size={26} className="text-gray-400" />
          <span className="text-sm text-gray-600 font-medium">{busy ? 'Importing…' : 'Choose a .csv file'}</span>
          <input type="file" accept=".csv,text/csv" className="hidden" onChange={e => handleFile(e.target.files?.[0])} />
        </label>
      </div>
    </div>
  );
}

/* ───────── Detail / sign-offs ───────── */
function RecordView({ cfg, rec, user, canEdit, onSign, onRevoke, onEdit, onDelete, onClose }) {
  const [signing, setSigning] = useState(null);
  const doSign = async (key) => { setSigning(key); try { await onSign(rec.id, key); } finally { setSigning(null); } };
  const downloadPdf = async () => {
    const t = localStorage.getItem('auth_token');
    const r = await fetch(`/api/qms/${cfg.key}/${rec.id}/pdf`, { headers: { Authorization: `Bearer ${t}` } });
    if (!r.ok) return;
    const b = await r.blob(); const u = URL.createObjectURL(b);
    const a = document.createElement('a'); a.href = u; a.download = `${cfg.short}_${(rec.record_number || rec.id).toString().replace(/[^a-zA-Z0-9_-]/g, '_')}.pdf`;
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(u);
  };
  return (
    <div className="fixed inset-0 bg-black/30 z-50 flex items-start justify-center p-4 overflow-y-auto" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-3xl my-6" onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between px-5 py-4 border-b border-gray-200">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-semibold text-gray-900">{cfg.singular} {rec.record_number || '—'}</span>
              <ApprovalBadge cfg={cfg} rec={rec} />
            </div>
            <p className="text-xs text-gray-500 mt-0.5">{rec.record_date || ''}</p>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded-lg"><X size={18} className="text-gray-500" /></button>
        </div>

        <div className="px-5 py-4 max-h-[55vh] overflow-y-auto space-y-4">
          <div className="grid sm:grid-cols-2 gap-x-4 gap-y-2">
            {cfg.fields.map(f => {
              const v = displayValue(cfg, rec, f.key);
              if (v === '—') return null;
              return (
                <div key={f.key} className={f.type === 'textarea' ? 'sm:col-span-2' : ''}>
                  <p className="text-[11px] font-medium text-gray-500">{f.label}</p>
                  <p className="text-sm text-gray-800 whitespace-pre-line">{v}</p>
                </div>
              );
            })}
          </div>

          <div className="border border-gray-200 rounded-lg p-3 space-y-2">
            <p className="text-xs font-semibold text-gray-700">Approvals</p>
            {rec.paper_record && (
              <p className="text-[11px] text-gray-500 bg-gray-50 border border-gray-200 rounded px-2 py-1 flex items-center gap-1.5"><FileText size={12} className="text-gray-400" /> Logged on paper — signatures are on file on the original form{rec.document_url ? ' (attached below)' : ''}.</p>
            )}
            {cfg.approvals.map(a => {
              const sig = rec.approvals?.[a.key];
              const mine = sig && sig.user_id === user?.id;
              return (
                <div key={a.key} className="flex items-center justify-between gap-2">
                  <span className="text-xs text-gray-500 w-48 shrink-0">{a.label}{a.required ? ' *' : ''}</span>
                  {sig ? (
                    <div className="flex items-center gap-2 flex-1">
                      <span className="text-xs text-green-700 flex items-center gap-1"><Check size={12} /> {sig.name} · {new Date(sig.signed_at).toLocaleDateString()}</span>
                      {(user?.role === 'admin' || mine) && <button onClick={() => onRevoke(rec.id, a.key)} className="text-[11px] text-gray-400 hover:text-red-500">revoke</button>}
                    </div>
                  ) : a.external ? (
                    <span className="text-xs text-gray-400">Recorded off-system</span>
                  ) : canSign(user, a) ? (
                    <button onClick={() => doSign(a.key)} disabled={signing === a.key} className="px-2.5 py-1 bg-powder-600 text-white text-xs font-medium rounded-lg hover:bg-powder-700 disabled:opacity-50">{signing === a.key ? 'Signing…' : `Sign as ${a.label}`}</button>
                  ) : (
                    <span className="text-xs text-gray-400">Awaiting {a.label}</span>
                  )}
                </div>
              );
            })}
          </div>

          {rec.document_url && <a href={rec.document_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-sm text-powder-600 hover:underline"><Paperclip size={14} /> View attached form</a>}
          {rec.notes && <p className="text-xs text-gray-500">{rec.notes}</p>}
        </div>

        <div className="flex items-center gap-2 px-5 py-3 border-t border-gray-200">
          <button onClick={downloadPdf} className="px-3 py-1.5 bg-gray-100 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-200 flex items-center gap-1.5"><Download size={14} /> PDF</button>
          <div className="flex-1" />
          {canEdit && <button onClick={() => onDelete(rec)} className="px-3 py-1.5 text-red-600 text-sm font-medium rounded-lg hover:bg-red-50 flex items-center gap-1.5"><Trash2 size={14} /> Delete</button>}
          {canEdit && <button onClick={() => onEdit(rec)} className="px-3 py-1.5 bg-powder-600 text-white text-sm font-medium rounded-lg hover:bg-powder-700 flex items-center gap-1.5"><Edit2 size={14} /> Edit</button>}
        </div>
      </div>
    </div>
  );
}

// Normalize a record number to its integer core: "D05" → "5", "023" → "23".
function normNum(rn) { const d = String(rn || '').replace(/\D/g, ''); return d ? String(parseInt(d, 10)) : ''; }
function parseFormNumber(filename) {
  const base = String(filename).replace(/^.*[/\\]/, '').replace(/\.[^.]*$/, '');
  const m = base.match(/(\d+)/);
  return m ? String(parseInt(m[1], 10)) : '';
}
async function uploadFile(file) {
  const fd = new FormData();
  fd.append('files', file);
  const res = await fetch('/api/uploads', { method: 'POST', body: fd });
  if (!res.ok) throw new Error('Upload failed');
  const [u] = await res.json();
  return u?.url;
}

// Bulk-attach completed/scanned forms to existing records, matched by the
// number in each filename. Ambiguous or unmatched files are surfaced for a
// manual pick; nothing is uploaded until the user applies.
function AttachFormsModal({ cfg, records, onDone, onClose }) {
  const [rows, setRows] = useState([]);
  const [applying, setApplying] = useState(false);
  const [result, setResult] = useState(null);

  const candidatesFor = (num) => (records || []).filter(r => normNum(r.record_number) === num);
  const onFiles = (fileList) => {
    const files = Array.from(fileList || []);
    setRows(files.map(file => {
      const num = parseFormNumber(file.name);
      const cands = candidatesFor(num);
      return { file, name: file.name, num, candidates: cands, chosenId: cands.length === 1 ? cands[0].id : '' };
    }));
    setResult(null);
  };
  const setChosen = (i, id) => setRows(rs => rs.map((r, j) => j === i ? { ...r, chosenId: id } : r));

  const apply = async () => {
    setApplying(true);
    let ok = 0, fail = 0;
    for (const r of rows) {
      if (!r.chosenId) continue;
      try { const url = await uploadFile(r.file); await apiPut(`/qms/${cfg.key}/${r.chosenId}`, { document_url: url, paper_record: true }); ok++; }
      catch { fail++; }
    }
    setApplying(false);
    setResult({ ok, fail });
    if (ok) onDone();
  };

  const recLabel = (r) => `${r.record_number} — ${(r.product_description || r.doc_name || '').toString().slice(0, 40)} ${r.record_date ? `(${r.record_date})` : ''}`;
  const readyCount = rows.filter(r => r.chosenId).length;

  return (
    <div className="fixed inset-0 bg-black/30 z-50 flex items-start justify-center p-4 overflow-y-auto" onClick={onClose}>
      <div onClick={e => e.stopPropagation()} className="bg-white rounded-xl shadow-xl w-full max-w-3xl my-6 p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-gray-900">Attach completed forms</h3>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded-lg"><X size={18} className="text-gray-500" /></button>
        </div>
        <p className="text-xs text-gray-500">Drop the scanned/completed PDFs. Each is matched to a record by the number in its filename (e.g. <span className="font-mono">Deviation_031</span> → 31). Confirm or fix any matches, then apply — files upload and attach to their records (marked as paper records).</p>

        <label className="flex flex-col items-center justify-center gap-2 border-2 border-dashed border-gray-300 rounded-xl py-8 cursor-pointer hover:bg-gray-50">
          <Upload size={24} className="text-gray-400" />
          <span className="text-sm text-gray-600 font-medium">Choose completed form files (PDF/images)</span>
          <input type="file" accept=".pdf,image/*" multiple className="hidden" onChange={e => onFiles(e.target.files)} />
        </label>

        {rows.length > 0 && (
          <div className="border border-gray-200 rounded-lg overflow-hidden max-h-[45vh] overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200 sticky top-0"><tr>
                <th className="text-left px-3 py-2 text-xs font-medium text-gray-500">File</th>
                <th className="text-left px-3 py-2 text-xs font-medium text-gray-500 whitespace-nowrap">#</th>
                <th className="text-left px-3 py-2 text-xs font-medium text-gray-500">Attach to record</th>
              </tr></thead>
              <tbody className="divide-y divide-gray-100">
                {rows.map((r, i) => (
                  <tr key={i}>
                    <td className="px-3 py-2 text-gray-700 truncate max-w-[220px]">{r.name}</td>
                    <td className="px-3 py-2 text-gray-500 font-mono">{r.num || '—'}</td>
                    <td className="px-3 py-2">
                      {r.candidates.length === 0 ? (
                        <span className="text-xs text-amber-600">No record #{r.num} found — skipped</span>
                      ) : r.candidates.length === 1 ? (
                        <span className="text-xs text-gray-700">{recLabel(r.candidates[0])}</span>
                      ) : (
                        <select value={r.chosenId} onChange={e => setChosen(i, e.target.value)} className="w-full px-2 py-1 border border-amber-300 rounded text-xs bg-amber-50">
                          <option value="">Pick which #{r.num}…</option>
                          {r.candidates.map(c => <option key={c.id} value={c.id}>{recLabel(c)}</option>)}
                        </select>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {result && <p className="text-sm text-green-700">Attached {result.ok} form{result.ok === 1 ? '' : 's'}{result.fail ? `, ${result.fail} failed` : ''}.</p>}

        <div className="flex items-center gap-2">
          <button disabled={!readyCount || applying} onClick={apply} className="flex-1 px-4 py-2 bg-powder-600 text-white text-sm font-medium rounded-lg hover:bg-powder-700 disabled:opacity-40">{applying ? 'Attaching…' : `Attach ${readyCount} form${readyCount === 1 ? '' : 's'}`}</button>
          <button onClick={onClose} className="px-4 py-2 bg-gray-100 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-200">Close</button>
        </div>
      </div>
    </div>
  );
}

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

/* ───────── Panel ───────── */
export default function QMSRecordsPanel({ recordType, moduleId }) {
  const { user } = useAuth() || {};
  const canEdit = canEditModule(user, moduleId);
  const isAdmin = user?.role === 'admin';
  const { data: config } = useApiGet('/qms/config');
  const cfg = useMemo(() => (config?.types || []).find(t => t.key === recordType), [config, recordType]);
  const { data: records, loading, refresh } = useApiGet(`/qms/${recordType}`, [recordType]);

  const [search, setSearch] = useState('');
  const [approvalFilter, setApprovalFilter] = useState('');
  const [sortField, setSortField] = useState('record_date');
  const [sortDir, setSortDir] = useState('desc');
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState(null);
  const [viewing, setViewing] = useState(null);
  const [importing, setImporting] = useState(false);
  const [attaching, setAttaching] = useState(false);
  const [selected, setSelected] = useState(() => new Set());
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [msg, setMsg] = useState(null);
  const flash = (m) => { setMsg(m); setTimeout(() => setMsg(null), 6000); };

  const filtered = useMemo(() => {
    if (!cfg) return [];
    const q = search.toLowerCase().trim();
    let r = (records || []).filter(rec => {
      if (q) {
        const hay = [rec.record_number, ...cfg.fields.map(f => Array.isArray(rec[f.key]) ? rec[f.key].join(' ') : rec[f.key])].filter(Boolean).join(' ').toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (approvalFilter) {
        const st = approvalState(cfg, rec);
        if (approvalFilter === 'pending' && st.done) return false;
        if (approvalFilter === 'approved' && !st.done) return false;
        if (approvalFilter === 'paper' && !st.paper) return false;
      }
      return true;
    });
    const dir = sortDir === 'asc' ? 1 : -1;
    r = [...r].sort((a, b) => {
      let av, bv;
      if (sortField === 'record_date') { av = dateVal(a.record_date); bv = dateVal(b.record_date); }
      else if (sortField === 'approvals') { av = approvalState(cfg, a).done ? 1 : 0; bv = approvalState(cfg, b).done ? 1 : 0; }
      else { av = (a[sortField] ?? '').toString().toLowerCase(); bv = (b[sortField] ?? '').toString().toLowerCase(); }
      if (av < bv) return -dir; if (av > bv) return dir; return 0;
    });
    return r;
  }, [records, cfg, search, approvalFilter, sortField, sortDir]);

  const pending = useMemo(() => (cfg ? (records || []).filter(r => !approvalState(cfg, r).done).length : 0), [records, cfg]);

  const visibleIds = filtered.map(r => r.id);
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every(id => selected.has(id));
  const toggleOne = (id) => setSelected(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const toggleAll = () => setSelected(prev => { const n = new Set(prev); if (allVisibleSelected) visibleIds.forEach(id => n.delete(id)); else visibleIds.forEach(id => n.add(id)); return n; });
  const clearSelection = () => setSelected(new Set());

  const onSort = (f) => { if (sortField === f) setSortDir(d => d === 'asc' ? 'desc' : 'asc'); else { setSortField(f); setSortDir('asc'); } };
  const sh = { sortField, sortDir, onSort };

  const handleCreate = async (form) => { await apiPost(`/qms/${recordType}`, form); setCreating(false); refresh(); };
  const handleUpdate = async (form) => { const res = await apiPut(`/qms/${recordType}/${editing.id}`, form); setEditing(null); setViewing(res); refresh(); };
  const handleDelete = async (rec) => { if (!window.confirm(`Delete ${rec.record_number || 'this record'}?`)) return; await apiFetch(`/qms/${recordType}/${rec.id}`, { method: 'DELETE' }); setViewing(null); refresh(); };
  const handleSign = async (id, role) => { const res = await apiPost(`/qms/${recordType}/${id}/approve`, { role }); setViewing(res); refresh(); };
  const handleRevoke = async (id, role) => { const res = await apiFetch(`/qms/${recordType}/${id}/approve/${role}`, { method: 'DELETE' }); setViewing(res); refresh(); };
  const handleBulkPaper = async (paper) => { const res = await apiPost(`/qms/${recordType}/bulk-update`, { ids: [...selected], patch: { paper_record: paper } }); clearSelection(); flash(`Marked ${res.updated} as ${paper ? 'logged on paper' : 'requiring approval'}.`); refresh(); };
  const handleBulkDelete = async () => { const res = await apiPost(`/qms/${recordType}/bulk-delete`, { ids: [...selected] }); setConfirmDelete(false); clearSelection(); flash(`Permanently deleted ${res.deleted}.`); refresh(); };

  if (!cfg) return <div className="text-center py-12 text-gray-500">Loading…</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="text-xl font-bold text-gray-900">{cfg.label}</h2>
          <p className="text-sm text-gray-500">{filtered.length} record{filtered.length === 1 ? '' : 's'}</p>
        </div>
        {canEdit && (
          <div className="flex items-center gap-2">
            <button onClick={() => setAttaching(true)} className="flex items-center gap-1.5 px-3 py-2 bg-gray-100 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-200"><Paperclip size={15} /> Attach Forms</button>
            <button onClick={() => setImporting(true)} className="flex items-center gap-1.5 px-3 py-2 bg-gray-100 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-200"><Upload size={15} /> Import Log (CSV)</button>
            <button onClick={() => setCreating(true)} className="flex items-center gap-1.5 px-4 py-2 bg-powder-600 text-white text-sm font-medium rounded-lg hover:bg-powder-700"><Plus size={16} /> New {cfg.singular}</button>
          </div>
        )}
      </div>

      {msg && <div className="bg-green-50 border border-green-200 text-green-800 text-sm rounded-lg px-4 py-2">{msg}</div>}

      {canEdit && selected.size > 0 && (
        <div className="flex items-center gap-2 flex-wrap bg-powder-50 border border-powder-200 rounded-lg px-3 py-2">
          <span className="text-sm font-medium text-powder-800">{selected.size} selected</span>
          <div className="flex-1" />
          <button onClick={() => handleBulkPaper(true)} className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-gray-200 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50"><FileText size={14} /> Mark on paper</button>
          <button onClick={() => handleBulkPaper(false)} className="px-3 py-1.5 bg-white border border-gray-200 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50">Unmark paper</button>
          {isAdmin && <button onClick={() => setConfirmDelete(true)} className="flex items-center gap-1.5 px-3 py-1.5 bg-red-600 text-white text-sm font-medium rounded-lg hover:bg-red-700"><Trash2 size={14} /> Delete permanently</button>}
          <button onClick={clearSelection} className="px-3 py-1.5 text-gray-500 text-sm font-medium rounded-lg hover:bg-gray-100">Clear</button>
        </div>
      )}

      <div className="grid grid-cols-3 gap-3">
        <div className="bg-white rounded-xl border border-gray-200 p-3"><p className="text-2xl font-bold text-gray-900">{records?.length || 0}</p><p className="text-xs text-gray-500">Total records</p></div>
        <div className={`rounded-xl border p-3 ${pending > 0 ? 'border-amber-200 bg-amber-50' : 'border-gray-200 bg-white'}`}><p className={`text-2xl font-bold flex items-center gap-1.5 ${pending > 0 ? 'text-amber-700' : 'text-gray-900'}`}>{pending > 0 && <AlertTriangle size={18} />}{pending}</p><p className="text-xs text-gray-500">Awaiting approval</p></div>
        <div className="bg-white rounded-xl border border-gray-200 p-3"><p className="text-2xl font-bold text-gray-900">{(records || []).filter(r => r.paper_record).length}</p><p className="text-xs text-gray-500">On paper (historical)</p></div>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[220px]">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder={`Search ${cfg.label.toLowerCase()}…`} className="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-powder-500" />
        </div>
        <select value={approvalFilter} onChange={e => setApprovalFilter(e.target.value)} className="px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white">
          <option value="">Approvals: all</option>
          <option value="pending">Awaiting approval</option>
          <option value="approved">Fully approved</option>
          <option value="paper">On paper</option>
        </select>
      </div>

      {loading ? (
        <div className="text-center py-12 text-gray-500">Loading…</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 text-gray-400"><FileText size={36} className="mx-auto mb-2 text-gray-300" /><p className="text-sm">No records found.{canEdit ? ' Create one or import your log.' : ''}</p></div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  {canEdit && (
                    <th className="px-2 py-2 w-8">
                      <button onClick={toggleAll} className="text-gray-400 hover:text-powder-600 align-middle" title={allVisibleSelected ? 'Deselect all' : 'Select all'}>{allVisibleSelected ? <CheckSquare size={16} /> : <Square size={16} />}</button>
                    </th>
                  )}
                  {cfg.logColumns.map(col => <SortTh key={col} label={fieldLabel(cfg, col)} field={col} {...sh} align={col === 'approvals' ? 'center' : 'left'} />)}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 text-sm">
                {filtered.map((rec, i) => (
                  <tr key={rec.id || i} onClick={() => setViewing(rec)} className={`hover:bg-gray-50 cursor-pointer ${selected.has(rec.id) ? 'bg-powder-50' : ''}`}>
                    {canEdit && (
                      <td className="px-2 py-2" onClick={e => e.stopPropagation()}>
                        <button onClick={() => toggleOne(rec.id)} className="text-gray-400 hover:text-powder-600 align-middle" title={selected.has(rec.id) ? 'Deselect' : 'Select'}>{selected.has(rec.id) ? <CheckSquare size={16} className="text-powder-600" /> : <Square size={16} />}</button>
                      </td>
                    )}
                    {cfg.logColumns.map((col, ci) => {
                      if (col === 'approvals') return <td key={col} className="px-2 py-2 text-center"><ApprovalBadge cfg={cfg} rec={rec} /></td>;
                      const primary = ci === 0 || col === cfg.primaryField;
                      return <td key={col} className={`px-2 py-2 ${primary ? 'font-medium text-gray-900' : 'text-gray-600'} ${col === 'record_number' ? 'whitespace-nowrap' : ''}`}>{displayValue(cfg, rec, col)}</td>;
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {creating && <RecordForm cfg={cfg} onSave={handleCreate} onCancel={() => setCreating(false)} />}
      {editing && <RecordForm cfg={cfg} initial={editing} onSave={handleUpdate} onCancel={() => setEditing(null)} />}
      {viewing && !editing && <RecordView cfg={cfg} rec={viewing} user={user} canEdit={canEdit} onSign={handleSign} onRevoke={handleRevoke} onEdit={(r) => setEditing(r)} onDelete={handleDelete} onClose={() => setViewing(null)} />}
      {importing && <CsvImportModal cfg={cfg} onClose={() => setImporting(false)} onImported={(res) => { setImporting(false); flash(`Imported ${res.imported} records.`); refresh(); }} />}
      {attaching && <AttachFormsModal cfg={cfg} records={records} onClose={() => setAttaching(false)} onDone={refresh} />}
      {confirmDelete && <ConfirmDeleteModal count={selected.size} noun="record" onConfirm={handleBulkDelete} onClose={() => setConfirmDelete(false)} />}
    </div>
  );
}
