import { useState, useMemo, useRef, useEffect, Fragment } from 'react';
import { useApiGet, apiPost, apiPut, apiFetch } from '../../hooks/useApi';
import { useAuth } from '../../hooks/useAuth';
import { canEditModule } from '../../utils/permissions';
import FileUpload from '../FileUpload';
import { Plus, Search, Edit2, Trash2, Download, Upload, X, Check, Paperclip, FileText, ChevronUp, ChevronDown, AlertTriangle, CheckSquare, Square, Eye, QrCode, ListChecks } from 'lucide-react';
import KioskQrModal from '../kiosk/KioskQrModal';

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

// Status-tracked types (e.g. On Hold) show a coloured status pill instead.
const STATUS_TONE = {
  amber: 'bg-amber-100 text-amber-700', green: 'bg-green-100 text-green-700',
  red: 'bg-red-100 text-red-700', blue: 'bg-blue-100 text-blue-700', gray: 'bg-gray-100 text-gray-600',
};
function statusDef(cfg, val) { return (cfg.statuses || []).find(s => s.value === val); }
function isOpen(cfg, rec) {
  if (cfg.statuses?.length) { const d = statusDef(cfg, rec.status); return d ? !d.done : true; }
  return !approvalState(cfg, rec).done;
}
function StatusBadge({ cfg, rec }) {
  const d = statusDef(cfg, rec.status) || { label: rec.status || '—', tone: 'gray' };
  return <span className={`px-2 py-0.5 rounded-full text-xs inline-flex items-center gap-1 whitespace-nowrap ${STATUS_TONE[d.tone] || STATUS_TONE.gray}`}>{d.label}</span>;
}

// Pass/fail evaluation for rated types (e.g. Organoleptic): fail if any rated
// attribute is below the threshold; null (unrated) if no ratings were entered.
function passFailResult(cfg, rec) {
  if (!cfg.passFail) return null;
  const vals = cfg.passFail.fields.map(k => parseInt(rec[k], 10)).filter(n => !Number.isNaN(n));
  if (!vals.length) return null;
  return vals.some(n => n < cfg.passFail.threshold) ? 'fail' : 'pass';
}
function ResultBadge({ cfg, rec }) {
  const r = passFailResult(cfg, rec);
  if (!r) return <span className="text-xs text-gray-300">—</span>;
  return r === 'fail'
    ? <span className="px-2 py-0.5 rounded-full text-xs bg-red-100 text-red-700 inline-flex items-center gap-1 whitespace-nowrap"><AlertTriangle size={11} /> Fail</span>
    : <span className="px-2 py-0.5 rounded-full text-xs bg-green-100 text-green-700 inline-flex items-center gap-1 whitespace-nowrap"><Check size={11} /> Pass</span>;
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
  if (key === 'status') return 'Status';
  if (key === 'result') return 'Result';
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
  if (f.type === 'select') {
    // options can be a flat list of strings or grouped [{ group, items }] → optgroups
    const grouped = Array.isArray(f.options) && f.options.some(o => o && typeof o === 'object' && Array.isArray(o.items));
    return (
      <select value={value || ''} onChange={e => onChange(e.target.value)} className={base}>
        <option value="">—</option>
        {grouped
          ? f.options.map(g => (
              <optgroup key={g.group} label={g.group}>
                {g.items.map(o => <option key={o} value={o}>{o}</option>)}
              </optgroup>
            ))
          : f.options.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    );
  }
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

// Multi-pick fed by the same (possibly grouped) options as a select. Each
// picked item carries a qty, and items from the "Chemicals" group require a
// use specification. Value shape: [{ name, qty, use_spec }].
function MultiPickInput({ f, value, onChange, useSpecOptions = [] }) {
  const arr = Array.isArray(value) ? value : [];
  const grouped = Array.isArray(f.options) && f.options.some(o => o && typeof o === 'object' && Array.isArray(o.items));
  const chemicalSet = useMemo(() => {
    if (!grouped) return new Set();
    const g = f.options.find(o => o.group === 'Chemicals');
    return new Set(g ? g.items : []);
  }, [f.options, grouped]);
  const names = arr.map(x => x.name);
  const add = (o) => { if (o && !names.includes(o)) onChange([...arr, { name: o, qty: 1, use_spec: '' }]); };
  const patch = (name, p) => onChange(arr.map(x => x.name === name ? { ...x, ...p } : x));
  const remove = (name) => onChange(arr.filter(x => x.name !== name));
  return (
    <div className="space-y-1.5">
      {arr.map(x => (
        <div key={x.name} className="rounded-lg border border-powder-200 bg-powder-50 px-2.5 py-1.5">
          {/* flex-wrap + min-w: long item names wrap onto their own line on
              phones instead of pushing the qty control off-screen */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="flex-1 min-w-[140px] text-sm text-powder-900 break-words">{x.name}</span>
            <label className="flex items-center gap-1 text-[11px] text-gray-500 shrink-0 ml-auto">
              Qty
              <input type="number" min="1" value={x.qty}
                onChange={e => patch(x.name, { qty: e.target.value })}
                className="w-14 px-1.5 py-1 border border-gray-300 rounded text-sm text-center bg-white" />
            </label>
            <button type="button" onClick={() => remove(x.name)} className="p-0.5 text-powder-400 hover:text-red-500 shrink-0"><X size={13} /></button>
          </div>
          {chemicalSet.has(x.name) && (
            <select value={x.use_spec || ''} onChange={e => patch(x.name, { use_spec: e.target.value })}
              className={`mt-1 w-full px-2 py-1.5 border rounded text-xs bg-white ${x.use_spec ? 'border-gray-300' : 'border-amber-400'}`}>
              <option value="">Use specification (required for chemicals)…</option>
              {useSpecOptions.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          )}
        </div>
      ))}
      <select value="" onChange={e => add(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white">
        <option value="">{arr.length ? 'Add another item…' : 'Select item(s)…'}</option>
        {grouped
          ? f.options.map(g => (
              <optgroup key={g.group} label={g.group}>
                {g.items.filter(o => !names.includes(o)).map(o => <option key={o} value={o}>{o}</option>)}
              </optgroup>
            ))
          : f.options.filter(o => !names.includes(o)).map(o => <option key={o} value={o}>{o}</option>)}
      </select>
      {arr.length > 1 && <p className="text-[11px] text-gray-400">One sign-out record is created per item.</p>}
    </div>
  );
}

/* ───────── Create / edit form ───────── */
function RecordForm({ cfg, initial, onSave, onCancel }) {
  // Sign-outs can check out several items at once — the item field becomes a
  // multi-pick and one record is created per item (create mode only).
  const multiItemKey = cfg.key === 'maintenance_sign_out' && !initial?.id ? 'item_description' : null;
  const [form, setForm] = useState(() => {
    const todayStr = new Date().toISOString().slice(0, 10);
    const base = { record_number: initial?.record_number || '', record_date: initial?.record_date || (initial?.id ? '' : todayStr), notes: initial?.notes || '', paper_record: !!initial?.paper_record, document_url: initial?.document_url || '', status: initial?.status || cfg.defaultStatus || '' };
    for (const f of cfg.fields) base[f.key] = initial?.[f.key] ?? (f.type === 'checkbox' ? false : (f.type === 'multiselect' || f.key === multiItemKey) ? [] : '');
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
          {cfg.statuses?.length > 0 && (
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Status</label>
              <select value={form.status} onChange={e => set('status', e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
                {cfg.statuses.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
            </div>
          )}
        </div>

        <div className="grid sm:grid-cols-2 gap-3">
          {cfg.fields.map(f => {
            // In multi-item create mode, qty and use-spec live on each picked
            // item row instead of as standalone fields.
            if (multiItemKey && (f.key === 'qty' || f.key === 'use_spec')) return null;
            return (
              <div key={f.key} className={f.type === 'textarea' || f.type === 'multiselect' || f.key === multiItemKey ? 'sm:col-span-2' : ''}>
                {f.type !== 'checkbox' && <label className="block text-xs font-medium text-gray-700 mb-1">{f.label}{f.key === multiItemKey ? ' (one or more)' : ''}</label>}
                {f.key === multiItemKey
                  ? <MultiPickInput f={f} value={form[f.key]} onChange={v => set(f.key, v)}
                      useSpecOptions={cfg.fields.find(x => x.key === 'use_spec')?.options || []} />
                  : <FieldInput f={f} value={form[f.key]} onChange={v => set(f.key, v)} />}
              </div>
            );
          })}
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
function RecordView({ cfg, rec, user, canEdit, onSign, onRevoke, onSetStatus, onEdit, onDelete, onClose }) {
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
              {cfg.passFail && passFailResult(cfg, rec) && <ResultBadge cfg={cfg} rec={rec} />}
              {cfg.statuses?.length ? <StatusBadge cfg={cfg} rec={rec} /> : <ApprovalBadge cfg={cfg} rec={rec} />}
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
              const isCapaLink = f.link === 'capa' && /\d/.test(v) && !/^n\/?a$/i.test(v);
              return (
                <div key={f.key} className={f.type === 'textarea' ? 'sm:col-span-2' : ''}>
                  <p className="text-[11px] font-medium text-gray-500">{f.label}</p>
                  {isCapaLink ? (
                    <button onClick={() => { try { localStorage.setItem('capa_focus', v); } catch { /* ignore */ } window.dispatchEvent(new CustomEvent('app-navigate', { detail: { tab: 'capa' } })); }}
                      className="text-sm text-powder-600 hover:underline font-medium">{v} →</button>
                  ) : (
                    <p className="text-sm text-gray-800 whitespace-pre-line">{v}</p>
                  )}
                </div>
              );
            })}
          </div>

          {cfg.statuses?.length > 0 && (
            <div className="border border-gray-200 rounded-lg p-3 space-y-2">
              <div className="flex items-center gap-2"><p className="text-xs font-semibold text-gray-700">Status</p><StatusBadge cfg={cfg} rec={rec} /></div>
              {canEdit && (
                <div className="flex items-center gap-2 flex-wrap">
                  {cfg.statuses.filter(s => s.value !== rec.status).map(s => (
                    <button key={s.value} onClick={() => onSetStatus(rec.id, s.value)} className="px-2.5 py-1 bg-powder-600 text-white text-xs font-medium rounded-lg hover:bg-powder-700">Mark as {s.label}</button>
                  ))}
                </div>
              )}
            </div>
          )}

          {cfg.approvals?.length > 0 && (
          <div className="border border-gray-200 rounded-lg p-3 space-y-2">
            <p className="text-xs font-semibold text-gray-700">Approvals</p>
            {rec.paper_record && (
              <p className="text-[11px] text-gray-500 bg-gray-50 border border-gray-200 rounded px-2 py-1 flex items-center gap-1.5"><FileText size={12} className="text-gray-400" /> Logged on paper — signatures are on file on the original form{rec.document_url ? ' (attached below)' : ''}.</p>
            )}
            {!rec.paper_record && (
              <p className="text-[11px] text-gray-500 bg-amber-50 border border-amber-100 rounded px-2 py-1">By signing, you certify you have reviewed this record and approve it in the stated capacity. Your name, role, and the time are recorded with the signature.</p>
            )}
            {cfg.approvals.map(a => {
              const sig = rec.approvals?.[a.key];
              const mine = sig && sig.user_id === user?.id;
              return (
                <div key={a.key} className="flex items-start justify-between gap-2">
                  <span className="text-xs text-gray-500 w-48 shrink-0">{a.label}{a.required ? ' *' : ''}</span>
                  {sig ? (
                    <div className="flex flex-col gap-0.5 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-green-700 flex items-center gap-1"><Check size={12} /> {sig.name}{sig.role ? ` (${sig.role})` : ''} · {new Date(sig.signed_at).toLocaleString()}</span>
                        {(user?.role === 'admin' || mine) && <button onClick={() => onRevoke(rec.id, a.key)} className="text-[11px] text-gray-400 hover:text-red-500">revoke</button>}
                      </div>
                      {sig.attestation && <span className="text-[10px] text-gray-400 italic">“{sig.attestation}”</span>}
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
          )}

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

// Match on the LAST numeric group so year-prefixed and D-prefixed numbers line
// up: record "25-001" and file "NC_001" → 1; record "D05" and file "05" → 5.
function lastNum(s) { const m = String(s || '').match(/\d+/g); return m ? String(parseInt(m[m.length - 1], 10)) : ''; }
const normNum = lastNum;
const parseFormNumber = lastNum;
async function uploadFile(file) {
  const fd = new FormData();
  fd.append('files', file);
  const res = await fetch('/api/uploads', { method: 'POST', body: fd });
  if (!res.ok) throw new Error('Upload failed');
  const [u] = await res.json();
  return u?.url;
}

// Manage the editable dropdown list for the Maintenance Sign In/Out item field.
// Add/rename/recategorize/remove/reorder tools; saved to the DB and reflected in
// the form. Items carry a category so the dropdown can group them (Tool Box
// Equipment List / Equipment List).
const MAINT_CATEGORIES = ['Tool Box Equipment List', 'Equipment List', 'Calibration Weights'];
function ManageItemsModal({ onDone, onClose }) {
  const [items, setItems] = useState(null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);
  useEffect(() => {
    apiFetch('/qms/maintenance-items')
      // Normalize legacy strings → { name, category }.
      .then(r => setItems((r.items || []).map(it => typeof it === 'string' ? { name: it, category: '' } : { name: it.name || '', category: it.category || '' })))
      .catch(() => setItems([]));
  }, []);
  const set = (i, patch) => setItems(a => a.map((x, j) => j === i ? { ...x, ...patch } : x));
  const remove = (i) => setItems(a => a.filter((_, j) => j !== i));
  const add = (category) => setItems(a => [...a, { name: '', category: category || '' }]);
  const move = (i, d) => setItems(a => {
    const j = i + d; if (j < 0 || j >= a.length) return a;
    const n = [...a]; [n[i], n[j]] = [n[j], n[i]]; return n;
  });
  const save = async () => {
    setSaving(true); setErr(null);
    try {
      const seen = new Set();
      const clean = items
        .map(it => ({ name: it.name.trim(), category: (it.category || '').trim() || null }))
        .filter(it => it.name && !seen.has(it.name) && seen.add(it.name));
      await apiPut('/qms/maintenance-items', { items: clean });
      onDone();
      onClose();
    } catch (e) { setErr(e.message || 'Save failed'); setSaving(false); }
  };
  return (
    <div className="fixed inset-0 bg-black/30 z-50 flex items-start justify-center p-4 overflow-y-auto" onClick={onClose}>
      <div onClick={e => e.stopPropagation()} className="bg-white rounded-xl shadow-xl w-full max-w-xl my-6 p-5 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-gray-900">Manage Item List</h3>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded-lg"><X size={18} className="text-gray-500" /></button>
        </div>
        <p className="text-xs text-gray-500">The dropdown of items for the Sign In-Out form. The category groups them in the dropdown. Chemicals from the approved registry are added automatically and can't be edited here. Changes apply to new sign-outs; existing records keep what was recorded.</p>
        {items === null ? <p className="text-sm text-gray-400 py-4 text-center">Loading…</p> : (
          <div className="space-y-1.5 max-h-[55vh] overflow-y-auto">
            {items.map((it, i) => (
              <div key={i} className="flex items-center gap-1.5">
                <div className="flex flex-col text-gray-300">
                  <button type="button" onClick={() => move(i, -1)} className="hover:text-gray-600 leading-none" title="Move up"><ChevronUp size={13} /></button>
                  <button type="button" onClick={() => move(i, 1)} className="hover:text-gray-600 leading-none" title="Move down"><ChevronDown size={13} /></button>
                </div>
                <span className="text-[11px] text-gray-400 w-5 text-right shrink-0">{i + 1}</span>
                <input value={it.name} onChange={e => set(i, { name: e.target.value })} spellCheck="true" placeholder="Item name"
                  className="flex-1 min-w-0 px-2.5 py-1.5 border border-gray-300 rounded-lg text-sm" />
                <select value={it.category} onChange={e => set(i, { category: e.target.value })}
                  className="shrink-0 w-36 px-2 py-1.5 border border-gray-300 rounded-lg text-xs bg-white">
                  <option value="">No group</option>
                  {MAINT_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                  {it.category && !MAINT_CATEGORIES.includes(it.category) && <option value={it.category}>{it.category}</option>}
                </select>
                <button type="button" onClick={() => remove(i)} className="p-1 text-gray-300 hover:text-red-500 shrink-0"><Trash2 size={14} /></button>
              </div>
            ))}
            <div className="flex flex-wrap gap-2 mt-1">
              {MAINT_CATEGORIES.map(c => (
                <button key={c} type="button" onClick={() => add(c)} className="flex items-center gap-1.5 text-xs text-powder-600 hover:underline"><Plus size={13} /> Add to {c}</button>
              ))}
            </div>
          </div>
        )}
        {err && <p className="text-xs text-red-600">{err}</p>}
        <div className="flex items-center gap-2 pt-1">
          <button onClick={save} disabled={saving || items === null} className="px-4 py-2 bg-powder-600 text-white rounded-lg text-sm font-medium hover:bg-powder-700 disabled:opacity-50">{saving ? 'Saving…' : 'Save list'}</button>
          <button onClick={onClose} className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm hover:bg-gray-200">Cancel</button>
        </div>
      </div>
    </div>
  );
}

// Bulk-attach completed/scanned forms to existing records, matched by the
// number in each filename. Ambiguous or unmatched files are surfaced for a
// manual pick; nothing is uploaded until the user applies.
function AttachFormsModal({ cfg, records, onDone, onClose }) {
  const [rows, setRows] = useState([]);
  const [applying, setApplying] = useState(false);
  const [result, setResult] = useState(null);
  // { idx, url } of the file currently previewed (object URL made on demand).
  const [preview, setPreview] = useState(null);
  const previewRef = useRef(null);
  useEffect(() => { previewRef.current = preview; }, [preview]);
  useEffect(() => () => { if (previewRef.current?.url) URL.revokeObjectURL(previewRef.current.url); }, []);
  const togglePreview = (i, file) => {
    setPreview(prev => {
      if (prev?.url) URL.revokeObjectURL(prev.url);
      return prev?.idx === i ? null : { idx: i, url: URL.createObjectURL(file) };
    });
  };

  const normText = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  // Match a filename to records. Types with attachMatch (no control number on
  // the form, e.g. Organoleptic) match by lot / part / product found in the
  // filename; everything else matches by the number in the filename.
  const matchFor = (filename) => {
    const base = normText(filename.replace(/\.[^.]*$/, ''));
    if (cfg.attachMatch?.length) {
      let detected = '';
      const cands = (records || []).filter(r => cfg.attachMatch.some(k => {
        const v = normText(r[k]);
        if (v.length >= 4 && base.includes(v)) { if (!detected) detected = String(r[k]).trim(); return true; }
        return false;
      }));
      return { candidates: cands, detected: detected || '—' };
    }
    const fnum = parseFormNumber(filename);
    return { candidates: (records || []).filter(r => normNum(r.record_number) === fnum), detected: fnum || '—' };
  };
  const onFiles = (fileList) => {
    const files = Array.from(fileList || []);
    setRows(files.map(file => {
      const { candidates, detected } = matchFor(file.name);
      return { file, name: file.name, num: detected, candidates, chosenId: candidates.length === 1 ? candidates[0].id : '' };
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

  const recLabel = (r) => {
    const main = r[cfg.primaryField] || r.product || r.product_description || r.doc_name || '';
    const extra = [r.lot, r.lot_number, r.part_number].filter(Boolean).join(' · ');
    return `${r.record_number} — ${String(main).slice(0, 36)}${extra ? ` · ${extra}` : ''}${r.record_date ? ` (${r.record_date})` : ''}`;
  };
  const readyCount = rows.filter(r => r.chosenId).length;
  const matchHint = cfg.attachMatch?.length ? 'lot / part / product in the filename' : 'the number in the filename';

  return (
    <div className="fixed inset-0 bg-black/30 z-50 flex items-start justify-center p-4 overflow-y-auto" onClick={onClose}>
      <div onClick={e => e.stopPropagation()} className="bg-white rounded-xl shadow-xl w-full max-w-5xl my-6 p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-gray-900">Attach completed forms</h3>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded-lg"><X size={18} className="text-gray-500" /></button>
        </div>
        <p className="text-xs text-gray-500">Drop the scanned/completed PDFs. Each is matched to a record by {matchHint}. Use <span className="font-medium">Preview</span> to read a form when you need to confirm the right record, then apply — files upload and attach to their records (marked as paper records).</p>

        <label className="flex flex-col items-center justify-center gap-2 border-2 border-dashed border-gray-300 rounded-xl py-8 cursor-pointer hover:bg-gray-50">
          <Upload size={24} className="text-gray-400" />
          <span className="text-sm text-gray-600 font-medium">Choose completed form files (PDF/images)</span>
          <input type="file" accept=".pdf,image/*" multiple className="hidden" onChange={e => onFiles(e.target.files)} />
        </label>

        {rows.length > 0 && (
          <div className="border border-gray-200 rounded-lg overflow-hidden max-h-[55vh] overflow-y-auto">
            <table className="w-full text-sm table-fixed">
              <thead className="bg-gray-50 border-b border-gray-200 sticky top-0"><tr>
                <th className="text-left px-3 py-2 text-xs font-medium text-gray-500 w-[38%]">File</th>
                <th className="text-left px-3 py-2 text-xs font-medium text-gray-500 w-[16%]">Matched on</th>
                <th className="text-left px-3 py-2 text-xs font-medium text-gray-500">Attach to record</th>
              </tr></thead>
              <tbody className="divide-y divide-gray-100">
                {rows.map((r, i) => (
                  <Fragment key={i}>
                  <tr className={preview?.idx === i ? 'bg-gray-50' : ''}>
                    <td className="px-3 py-2 align-top">
                      <div className="text-gray-700 break-words">{r.name}</div>
                      <button onClick={() => togglePreview(i, r.file)} className="mt-1 inline-flex items-center gap-1 text-xs text-powder-600 hover:underline"><Eye size={12} /> {preview?.idx === i ? 'Hide preview' : 'Preview'}</button>
                    </td>
                    <td className="px-3 py-2 align-top text-gray-500 font-mono break-words">{r.num || '—'}</td>
                    <td className="px-3 py-2 align-top">
                      {r.candidates.length === 0 ? (
                        <span className="text-xs text-amber-600">No matching record found — skipped</span>
                      ) : r.candidates.length === 1 ? (
                        <span className="text-xs text-gray-700">{recLabel(r.candidates[0])}</span>
                      ) : (
                        <select value={r.chosenId} onChange={e => setChosen(i, e.target.value)} className="w-full px-2 py-1 border border-amber-300 rounded text-xs bg-amber-50">
                          <option value="">Pick the right record…</option>
                          {r.candidates.map(c => <option key={c.id} value={c.id}>{recLabel(c)}</option>)}
                        </select>
                      )}
                    </td>
                  </tr>
                  {preview?.idx === i && (
                    <tr>
                      <td colSpan={3} className="px-3 pb-3 bg-gray-50">
                        {/\.pdf$/i.test(r.name)
                          ? <iframe src={preview.url} title={r.name} className="w-full h-[460px] border border-gray-200 rounded bg-white" />
                          : <img src={preview.url} alt={r.name} className="max-h-[460px] rounded border border-gray-200 bg-white" />}
                      </td>
                    </tr>
                  )}
                  </Fragment>
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
  const { data: config, refresh: refreshConfig } = useApiGet('/qms/config');
  const cfg = useMemo(() => (config?.types || []).find(t => t.key === recordType), [config, recordType]);
  const { data: records, loading, refresh } = useApiGet(`/qms/${recordType}`, [recordType]);

  const [search, setSearch] = useState('');
  const [approvalFilter, setApprovalFilter] = useState('');
  const [resultFilter, setResultFilter] = useState('');
  const [sortField, setSortField] = useState('record_date');
  const [sortDir, setSortDir] = useState('desc');
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState(null);
  const [viewing, setViewing] = useState(null);
  const [importing, setImporting] = useState(false);
  const [attaching, setAttaching] = useState(false);
  const [managingItems, setManagingItems] = useState(false);
  const [selected, setSelected] = useState(() => new Set());
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [showQr, setShowQr] = useState(false);
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
        if (cfg.statuses?.length) {
          if (approvalFilter === 'pending' && !isOpen(cfg, rec)) return false;
          if (approvalFilter === 'approved' && isOpen(cfg, rec)) return false;
          if (approvalFilter === 'paper' && !rec.paper_record) return false;
          if (cfg.statuses.some(s => s.value === approvalFilter) && rec.status !== approvalFilter) return false;
        } else {
          const st = approvalState(cfg, rec);
          if (approvalFilter === 'pending' && st.done) return false;
          if (approvalFilter === 'approved' && !st.done) return false;
          if (approvalFilter === 'paper' && !st.paper) return false;
        }
      }
      if (resultFilter && cfg.passFail) {
        const res = passFailResult(cfg, rec);
        if (resultFilter === 'unrated' ? res !== null : res !== resultFilter) return false;
      }
      return true;
    });
    const dir = sortDir === 'asc' ? 1 : -1;
    r = [...r].sort((a, b) => {
      let av, bv;
      if (sortField === 'record_date') { av = dateVal(a.record_date); bv = dateVal(b.record_date); }
      else if (sortField === 'approvals') { av = approvalState(cfg, a).done ? 1 : 0; bv = approvalState(cfg, b).done ? 1 : 0; }
      else if (sortField === 'status') { av = isOpen(cfg, a) ? 0 : 1; bv = isOpen(cfg, b) ? 0 : 1; }
      else if (sortField === 'result') { const rank = (r) => passFailResult(cfg, r) === 'fail' ? 0 : passFailResult(cfg, r) === 'pass' ? 2 : 1; av = rank(a); bv = rank(b); }
      else { av = (a[sortField] ?? '').toString().toLowerCase(); bv = (b[sortField] ?? '').toString().toLowerCase(); }
      if (av < bv) return -dir; if (av > bv) return dir; return 0;
    });
    return r;
  }, [records, cfg, search, approvalFilter, resultFilter, sortField, sortDir]);

  const pending = useMemo(() => (cfg ? (records || []).filter(r => isOpen(cfg, r)).length : 0), [records, cfg]);

  const visibleIds = filtered.map(r => r.id);
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every(id => selected.has(id));
  const toggleOne = (id) => setSelected(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const toggleAll = () => setSelected(prev => { const n = new Set(prev); if (allVisibleSelected) visibleIds.forEach(id => n.delete(id)); else visibleIds.forEach(id => n.add(id)); return n; });
  const clearSelection = () => setSelected(new Set());

  const onSort = (f) => { if (sortField === f) setSortDir(d => d === 'asc' ? 'desc' : 'asc'); else { setSortField(f); setSortDir('asc'); } };
  const sh = { sortField, sortDir, onSort };

  const handleCreate = async (form) => {
    // Multi-item sign-out: one record per picked item (numbers auto-assigned).
    // Entries are { name, qty, use_spec } — use_spec only set for chemicals.
    const items = Array.isArray(form.item_description) ? form.item_description : null;
    if (items) {
      if (!items.length) { flash('Pick at least one item.'); return; }
      for (const it of items) {
        await apiPost(`/qms/${recordType}`, {
          ...form,
          item_description: it.name,
          qty: Number(it.qty) > 0 ? Number(it.qty) : 1,
          use_spec: it.use_spec || '',
          record_number: items.length > 1 ? '' : form.record_number,
        });
      }
      if (items.length > 1) flash(`Signed out ${items.length} items.`);
    } else {
      await apiPost(`/qms/${recordType}`, form);
    }
    setCreating(false); refresh();
  };
  const handleUpdate = async (form) => { const res = await apiPut(`/qms/${recordType}/${editing.id}`, form); setEditing(null); setViewing(res); refresh(); };
  const handleDelete = async (rec) => { if (!window.confirm(`Delete ${rec.record_number || 'this record'}?`)) return; await apiFetch(`/qms/${recordType}/${rec.id}`, { method: 'DELETE' }); setViewing(null); refresh(); };
  const handleSign = async (id, role) => { const res = await apiPost(`/qms/${recordType}/${id}/approve`, { role }); setViewing(res); refresh(); };
  const handleSetStatus = async (id, status) => { const res = await apiPut(`/qms/${recordType}/${id}`, { status }); setViewing(res); refresh(); };
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
          <div className="flex items-center gap-2 flex-wrap">
            {cfg.kioskPath && <button onClick={() => setShowQr(true)} className="flex items-center gap-1.5 px-3 py-2 bg-gray-100 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-200"><QrCode size={15} /> Kiosk QR</button>}
            {recordType === 'maintenance_sign_out' && <button onClick={() => setManagingItems(true)} className="flex items-center gap-1.5 px-3 py-2 bg-gray-100 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-200"><ListChecks size={15} /> Manage Items</button>}
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

      {/* Quick glance list: what's out right now — just the item and date.
          Requested specifically for Ricardo's view; hidden for everyone else. */}
      {recordType === 'maintenance_sign_out' && (user?.name || '').toLowerCase().startsWith('ricardo') && (() => {
        const outNow = (records || []).filter(r => r.status === 'out');
        if (!outNow.length) return null;
        return (
          <div className="bg-white rounded-xl border border-amber-200 overflow-hidden">
            <div className="px-4 py-2 bg-amber-50 border-b border-amber-100 text-sm font-semibold text-amber-800">Currently out ({outNow.length})</div>
            <div className="divide-y divide-gray-100 max-h-64 overflow-y-auto">
              {outNow.map(r => (
                <div key={r.id} className="flex items-center justify-between gap-2 px-4 py-1.5 text-sm">
                  <span className="text-gray-800 min-w-0 truncate">{Number(r.qty) > 1 ? `${r.qty}× ` : ''}{r.item_description}</span>
                  <span className="text-gray-400 text-xs shrink-0">{r.record_date}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      <div className="grid grid-cols-3 gap-3">
        <div className="bg-white rounded-xl border border-gray-200 p-3"><p className="text-2xl font-bold text-gray-900">{records?.length || 0}</p><p className="text-xs text-gray-500">Total records</p></div>
        <div className={`rounded-xl border p-3 ${pending > 0 ? 'border-amber-200 bg-amber-50' : 'border-gray-200 bg-white'}`}><p className={`text-2xl font-bold flex items-center gap-1.5 ${pending > 0 ? 'text-amber-700' : 'text-gray-900'}`}>{pending > 0 && <AlertTriangle size={18} />}{pending}</p><p className="text-xs text-gray-500">{cfg.statuses?.length ? `Open (${(cfg.statuses.find(s => !s.done) || {}).label || 'open'})` : 'Awaiting approval'}</p></div>
        <div className="bg-white rounded-xl border border-gray-200 p-3"><p className="text-2xl font-bold text-gray-900">{(records || []).filter(r => r.paper_record).length}</p><p className="text-xs text-gray-500">On paper (historical)</p></div>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[220px]">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder={`Search ${cfg.label.toLowerCase()}…`} className="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-powder-500" />
        </div>
        {cfg.statuses?.length ? (
          <select value={approvalFilter} onChange={e => setApprovalFilter(e.target.value)} className="px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white">
            <option value="">Status: all</option>
            {cfg.statuses.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        ) : (
          <select value={approvalFilter} onChange={e => setApprovalFilter(e.target.value)} className="px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white">
            <option value="">Approvals: all</option>
            <option value="pending">Awaiting approval</option>
            <option value="approved">Fully approved</option>
            <option value="paper">On paper</option>
          </select>
        )}
        {cfg.passFail && (
          <select value={resultFilter} onChange={e => setResultFilter(e.target.value)} className="px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white">
            <option value="">Result: all</option>
            <option value="fail">Failed</option>
            <option value="pass">Passed</option>
            <option value="unrated">Unrated</option>
          </select>
        )}
      </div>

      {loading ? (
        <div className="text-center py-12 text-gray-500">Loading…</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 text-gray-400"><FileText size={36} className="mx-auto mb-2 text-gray-300" /><p className="text-sm">No records found.{canEdit ? ' Create one or import your log.' : ''}</p></div>
      ) : (
        <>
        {/* Mobile: card list (columns come from the record type's config) */}
        <div className="md:hidden space-y-2">
          {(() => {
            const badgeCol = cfg.logColumns.find(c => ['status', 'approvals', 'result'].includes(c));
            const textCols = cfg.logColumns.filter(c => !['status', 'approvals', 'result'].includes(c));
            return filtered.map((rec, i) => {
              const fail = passFailResult(cfg, rec) === 'fail';
              const [c0, c1, ...crest] = textCols;
              return (
                <div key={rec.id || i} onClick={() => setViewing(rec)}
                  className={`bg-white rounded-xl border border-gray-200 border-l-4 ${fail ? 'border-l-red-500' : 'border-l-emerald-500'} p-3 active:bg-gray-50 ${selected.has(rec.id) ? 'ring-2 ring-powder-300' : ''}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-semibold text-gray-900 text-sm leading-snug">{displayValue(cfg, rec, c0)}</div>
                      {c1 && <div className="text-xs text-gray-600 leading-snug">{displayValue(cfg, rec, c1)}</div>}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {badgeCol === 'status' && <StatusBadge cfg={cfg} rec={rec} />}
                      {badgeCol === 'approvals' && <ApprovalBadge cfg={cfg} rec={rec} />}
                      {badgeCol === 'result' && <ResultBadge cfg={cfg} rec={rec} />}
                      {canEdit && (
                        <button onClick={e => { e.stopPropagation(); toggleOne(rec.id); }} className="text-gray-300 hover:text-powder-600" title={selected.has(rec.id) ? 'Deselect' : 'Select'}>
                          {selected.has(rec.id) ? <CheckSquare size={16} className="text-powder-600" /> : <Square size={16} />}
                        </button>
                      )}
                    </div>
                  </div>
                  {crest.length > 0 && (
                    <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-gray-500">
                      {crest.map(col => {
                        const v = displayValue(cfg, rec, col);
                        return v && v !== '—' ? <span key={col}>{fieldLabel(cfg, col)}: <span className="font-medium text-gray-700">{v}</span></span> : null;
                      })}
                    </div>
                  )}
                </div>
              );
            });
          })()}
        </div>
        {/* Desktop: full table */}
        <div className="hidden md:block bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  {canEdit && (
                    <th className="px-2 py-2 w-8">
                      <button onClick={toggleAll} className="text-gray-400 hover:text-powder-600 align-middle" title={allVisibleSelected ? 'Deselect all' : 'Select all'}>{allVisibleSelected ? <CheckSquare size={16} /> : <Square size={16} />}</button>
                    </th>
                  )}
                  {cfg.logColumns.map(col => <SortTh key={col} label={fieldLabel(cfg, col)} field={col} {...sh} align={(col === 'approvals' || col === 'status' || col === 'result') ? 'center' : 'left'} />)}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 text-sm">
                {filtered.map((rec, i) => (
                  <tr key={rec.id || i} onClick={() => setViewing(rec)} className={`hover:bg-gray-50 cursor-pointer ${selected.has(rec.id) ? 'bg-powder-50' : passFailResult(cfg, rec) === 'fail' ? 'bg-red-50' : ''}`}>
                    {canEdit && (
                      <td className="px-2 py-2" onClick={e => e.stopPropagation()}>
                        <button onClick={() => toggleOne(rec.id)} className="text-gray-400 hover:text-powder-600 align-middle" title={selected.has(rec.id) ? 'Deselect' : 'Select'}>{selected.has(rec.id) ? <CheckSquare size={16} className="text-powder-600" /> : <Square size={16} />}</button>
                      </td>
                    )}
                    {cfg.logColumns.map((col, ci) => {
                      if (col === 'approvals') return <td key={col} className="px-2 py-2 text-center"><ApprovalBadge cfg={cfg} rec={rec} /></td>;
                      if (col === 'status') return <td key={col} className="px-2 py-2 text-center"><StatusBadge cfg={cfg} rec={rec} /></td>;
                      if (col === 'result') return <td key={col} className="px-2 py-2 text-center"><ResultBadge cfg={cfg} rec={rec} /></td>;
                      const primary = ci === 0 || col === cfg.primaryField;
                      return <td key={col} className={`px-2 py-2 ${primary ? 'font-medium text-gray-900' : 'text-gray-600'} ${col === 'record_number' ? 'whitespace-nowrap' : ''}`}>{displayValue(cfg, rec, col)}</td>;
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        </>
      )}

      {creating && <RecordForm cfg={cfg} onSave={handleCreate} onCancel={() => setCreating(false)} />}
      {editing && <RecordForm cfg={cfg} initial={editing} onSave={handleUpdate} onCancel={() => setEditing(null)} />}
      {viewing && !editing && <RecordView cfg={cfg} rec={viewing} user={user} canEdit={canEdit} onSign={handleSign} onRevoke={handleRevoke} onSetStatus={handleSetStatus} onEdit={(r) => setEditing(r)} onDelete={handleDelete} onClose={() => setViewing(null)} />}
      {importing && <CsvImportModal cfg={cfg} onClose={() => setImporting(false)} onImported={(res) => { setImporting(false); flash(`Imported ${res.imported} records.`); refresh(); }} />}
      {attaching && <AttachFormsModal cfg={cfg} records={records} onClose={() => setAttaching(false)} onDone={refresh} />}
      {managingItems && <ManageItemsModal onClose={() => setManagingItems(false)} onDone={() => { refreshConfig(); flash('Item list updated.'); }} />}
      {confirmDelete && <ConfirmDeleteModal count={selected.size} noun="record" onConfirm={handleBulkDelete} onClose={() => setConfirmDelete(false)} />}
      {showQr && cfg.kioskPath && <KioskQrModal cfg={cfg} onClose={() => setShowQr(false)} />}
    </div>
  );
}
