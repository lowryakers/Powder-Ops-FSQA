import { useState, useMemo, useEffect } from 'react';
import { useApiGet, apiPost, apiUpload, apiDelete } from '../../hooks/useApi';
import { downloadFile } from '../../lib/downloadFile.js';
import { onDataChanged } from '../../lib/dataChanged';
import { formatDate, formatDateTime } from '../../lib/datetime.js';
import { SignDocumentModal } from '../common/DocumentsToSign.jsx';
import { Send, Upload, FileSignature, Download, Bell, XCircle, Eye, Users, ChevronDown, ChevronUp, Trash2 } from 'lucide-react';

/**
 * Employee documents — the office side. A template is the PDF kept to send
 * again (the blank W-4); a request is one document sent to one person; the
 * signed copy is filed against that person and never rewritten.
 *
 * Every figure here is `.length` of the rows the endpoint returned. The server
 * decides who may see this (office / HR / admin holding the Onboarding
 * module) and answers 403 to anyone else; the tab shows that answer rather
 * than a blank pane.
 */
const STATUS = {
  pending: ['Waiting', 'bg-amber-100 text-amber-900'],
  signed: ['Signed', 'bg-green-100 text-green-800'],
  declined: ['Declined', 'bg-red-100 text-red-800'],
  cancelled: ['Withdrawn', 'bg-gray-100 text-gray-500'],
};
const input = 'w-full px-2.5 py-2 border border-gray-300 rounded-lg text-sm';

function Chip({ status }) {
  const [label, cls] = STATUS[status] || [status, 'bg-gray-100 text-gray-700'];
  return <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${cls}`} data-doc-status={status}>{label}</span>;
}

function TemplateUpload({ kinds, onSaved }) {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ title: '', kind: 'w4', instructions: '' });
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const go = async () => {
    if (!file) { setError('Attach the PDF.'); return; }
    setBusy(true); setError('');
    try {
      const fd = new FormData();
      fd.append('file', file); fd.append('title', f.title); fd.append('kind', f.kind); fd.append('instructions', f.instructions);
      const r = await apiUpload('/employee-documents/templates', fd);
      onSaved(r); setOpen(false); setFile(null); setF({ title: '', kind: 'w4', instructions: '' });
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };
  if (!open) {
    return <button type="button" onClick={() => setOpen(true)} className="inline-flex items-center gap-1.5 px-3 py-2 border border-gray-300 rounded-lg text-sm hover:bg-gray-50" data-template-add><Upload size={14} /> Add a template</button>;
  }
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-3" data-template-form>
      <p className="text-sm font-semibold text-gray-900">Keep a PDF to send again</p>
      <p className="text-[11px] text-gray-500">The current IRS W-4 or W-9, a policy to acknowledge. If the PDF has fillable boxes, the employee fills them in on screen and they are locked into the signed copy.</p>
      <div className="grid sm:grid-cols-3 gap-2">
        <input className={input} placeholder="Title (e.g. Form W-4 2026)" value={f.title} onChange={e => setF(v => ({ ...v, title: e.target.value }))} data-template-title />
        <select className={input} value={f.kind} onChange={e => setF(v => ({ ...v, kind: e.target.value }))}>
          {kinds.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
        <input type="file" accept="application/pdf,.pdf" className="text-sm" onChange={e => setFile(e.target.files?.[0] || null)} data-template-file />
      </div>
      <input className={input} placeholder="Instructions shown to the employee (optional)" value={f.instructions} onChange={e => setF(v => ({ ...v, instructions: e.target.value }))} />
      {error && <p className="text-xs text-red-700">{error}</p>}
      <div className="flex gap-2">
        <button type="button" onClick={go} disabled={busy} className="px-3 py-2 bg-powder-600 text-white rounded-lg text-sm font-semibold disabled:opacity-50" data-template-save>{busy ? 'Reading the PDF…' : 'Save template'}</button>
        <button type="button" onClick={() => setOpen(false)} className="px-3 py-2 text-sm text-gray-500">Cancel</button>
      </div>
    </div>
  );
}

function SendForm({ templates, people, kinds, onSent }) {
  const [templateId, setTemplateId] = useState('');
  const [file, setFile] = useState(null);
  const [title, setTitle] = useState('');
  const [kind, setKind] = useState('other');
  const [instructions, setInstructions] = useState('');
  const [due, setDue] = useState('');
  const [ids, setIds] = useState([]);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const live = templates.filter(t => !t.retired_at);
  // Picking a template fills the title, kind and instructions from it; the
  // office can still change them before sending.
  const pickTemplate = (id) => {
    setTemplateId(id);
    const t = live.find(x => x.id === id);
    if (t) { setTitle(t.title); setKind(t.kind); setInstructions(t.instructions || ''); }
  };
  const shown = useMemo(() => {
    const n = q.trim().toLowerCase();
    return people.filter(p => !n || `${p.name} ${p.username || ''} ${p.department || ''}`.toLowerCase().includes(n));
  }, [people, q]);
  const toggle = (id) => setIds(s => s.includes(id) ? s.filter(x => x !== id) : [...s, id]);
  const go = async () => {
    setBusy(true); setError(''); setResult(null);
    try {
      let r;
      if (templateId) {
        r = await apiPost('/employee-documents/send', { template_id: templateId, user_ids: ids, title, kind, instructions, due_date: due });
      } else {
        const fd = new FormData();
        if (file) fd.append('file', file);
        fd.append('user_ids', JSON.stringify(ids)); fd.append('title', title); fd.append('kind', kind); fd.append('instructions', instructions); fd.append('due_date', due);
        r = await apiUpload('/employee-documents/send', fd);
      }
      setResult(r); setIds([]); setFile(null);
      onSent(r);
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-3" data-send-form>
      <p className="text-sm font-semibold text-gray-900 flex items-center gap-1.5"><Send size={15} /> Send a document to sign</p>
      <div className="grid sm:grid-cols-2 gap-2">
        <div>
          <label className="block text-xs text-gray-600 mb-1">Template</label>
          <select className={input} value={templateId} onChange={e => pickTemplate(e.target.value)} data-send-template>
            <option value="">— attach a one-off PDF instead —</option>
            {live.map(t => <option key={t.id} value={t.id}>{t.title}{t.field_count ? ` (${t.field_count} boxes to fill)` : ''}</option>)}
          </select>
        </div>
        {!templateId && (
          <div>
            <label className="block text-xs text-gray-600 mb-1">One-off PDF</label>
            <input type="file" accept="application/pdf,.pdf" className="text-sm" onChange={e => setFile(e.target.files?.[0] || null)} data-send-file />
          </div>
        )}
        <input className={input} placeholder="Title the employee sees" value={title} onChange={e => setTitle(e.target.value)} data-send-title />
        <select className={input} value={kind} onChange={e => setKind(e.target.value)}>
          {kinds.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
        <input className={input} placeholder="Instructions (optional)" value={instructions} onChange={e => setInstructions(e.target.value)} />
        <input type="date" className={input} title="Sign by" value={due} onChange={e => setDue(e.target.value)} data-send-due />
      </div>
      <div>
        <div className="flex items-center justify-between gap-2 mb-1">
          <label className="text-xs text-gray-600 flex items-center gap-1"><Users size={12} /> Who signs it {ids.length > 0 && <span className="font-semibold text-gray-900">· {ids.length} chosen</span>}</label>
          <input className="px-2 py-1 border border-gray-300 rounded-lg text-xs w-44" placeholder="Filter people" value={q} onChange={e => setQ(e.target.value)} />
        </div>
        <div className="max-h-44 overflow-y-auto border border-gray-200 rounded-lg divide-y divide-gray-100" data-send-people>
          {shown.map(p => (
            <label key={p.id} className="flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-gray-50 cursor-pointer">
              <input type="checkbox" checked={ids.includes(p.id)} onChange={() => toggle(p.id)} data-send-person={p.id} />
              <span className="flex-1 truncate text-gray-800">{p.name}</span>
              <span className="text-[10px] text-gray-400 uppercase">{p.department || p.role}</span>
            </label>
          ))}
          {shown.length === 0 && <p className="px-3 py-3 text-xs text-gray-400">Nobody matches.</p>}
        </div>
      </div>
      {error && <p className="text-xs text-red-700" data-send-error>{error}</p>}
      {result && <p className="text-xs text-green-800 bg-green-50 border border-green-200 rounded-lg px-3 py-2" data-send-result>Sent to {result.requests.length} {result.requests.length === 1 ? 'person' : 'people'}; {result.told} told by ReadyBot. It stays under "Documents to sign" on their screen until they sign it.</p>}
      <button type="button" onClick={go} disabled={busy || !ids.length || (!templateId && !file)}
        className="px-4 py-2 bg-powder-600 text-white rounded-lg text-sm font-semibold disabled:opacity-50" data-send-submit>
        {busy ? 'Sending…' : `Send to ${ids.length || '…'}`}
      </button>
    </div>
  );
}

function Row({ r, onChanged, onView }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [cancelReason, setCancelReason] = useState('');
  const [cancelling, setCancelling] = useState(false);
  const act = async (fn) => { setBusy(true); setError(''); try { await fn(); onChanged(); } catch (e) { setError(e.message); } finally { setBusy(false); } };
  return (
    <div className={`bg-white border rounded-xl ${r.overdue ? 'border-red-300' : 'border-gray-200'}`} data-doc-row={r.id}>
      <button type="button" onClick={() => setOpen(v => !v)} className="w-full text-left px-4 py-3 flex items-center gap-3">
        <FileSignature size={16} className={r.status === 'signed' ? 'text-green-600' : 'text-gray-400'} />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-gray-900 truncate">{r.employee_name} <span className="text-gray-400 font-normal">·</span> {r.title}</p>
          <p className="text-[11px] text-gray-500 truncate">
            sent by {r.sent_by} {formatDateTime(r.sent_at)}
            {r.due_date ? ` · ${r.overdue ? 'was due' : 'due'} ${formatDate(r.due_date)}` : ''}
            {r.signed_at ? ` · signed ${formatDateTime(r.signed_at)}` : r.opened_at ? ' · opened' : ' · not opened yet'}
          </p>
        </div>
        <Chip status={r.status} />
        {open ? <ChevronUp size={14} className="text-gray-400" /> : <ChevronDown size={14} className="text-gray-400" />}
      </button>
      {open && (
        <div className="border-t border-gray-100 px-4 py-3 space-y-2 text-sm">
          {r.instructions && <p className="text-gray-700">Instructions: {r.instructions}</p>}
          {r.status === 'signed' && r.signature && (
            <p className="text-gray-700">Signed as <span className="font-medium">{r.signature.name}</span> at {formatDateTime(r.signature.at)} · password confirmed · {r.signature.ip || 'address not recorded'}</p>
          )}
          {r.declined_reason && <p className="text-red-800">Declined: {r.declined_reason}</p>}
          {r.cancelled_reason && <p className="text-gray-600">Withdrawn by {r.cancelled_by}: {r.cancelled_reason}</p>}
          <div className="flex flex-wrap gap-2 items-center">
            <button type="button" onClick={() => onView(r.id)} className="inline-flex items-center gap-1 px-2.5 py-1.5 border border-gray-300 rounded-lg text-xs" data-doc-view><Eye size={12} /> {r.status === 'signed' ? 'View' : 'View as sent'}</button>
            {r.status === 'signed' && (
              <button type="button" onClick={() => act(() => downloadFile(`/employee-documents/${r.id}/signed`, r.signed_filename || 'signed.pdf'))} disabled={busy}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 border border-gray-300 rounded-lg text-xs" data-doc-download><Download size={12} /> Download signed PDF</button>
            )}
            {r.status === 'pending' && (
              <>
                <button type="button" onClick={() => act(() => apiPost(`/employee-documents/${r.id}/remind`, {}))} disabled={busy}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 border border-gray-300 rounded-lg text-xs" data-doc-remind><Bell size={12} /> Remind</button>
                <button type="button" onClick={() => setCancelling(v => !v)} className="inline-flex items-center gap-1 px-2.5 py-1.5 border border-gray-300 rounded-lg text-xs text-gray-600" data-doc-cancel-toggle><XCircle size={12} /> Withdraw</button>
              </>
            )}
            {r.last_nudge_at && r.status === 'pending' && <span className="text-[11px] text-gray-400">reminded {formatDateTime(r.last_nudge_at)}</span>}
          </div>
          {cancelling && (
            <div className="flex gap-2">
              <input className={input} placeholder="Why is it being withdrawn?" value={cancelReason} onChange={e => setCancelReason(e.target.value)} data-doc-cancel-reason />
              <button type="button" onClick={() => act(() => apiPost(`/employee-documents/${r.id}/cancel`, { reason: cancelReason }))} disabled={busy || cancelReason.trim().length < 3}
                className="px-3 py-2 bg-gray-800 text-white rounded-lg text-xs font-semibold disabled:opacity-50 shrink-0" data-doc-cancel>Withdraw</button>
            </div>
          )}
          {error && <p className="text-xs text-red-700">{error}</p>}
        </div>
      )}
    </div>
  );
}

export default function EmployeeDocumentsTab() {
  const { data, error, refresh } = useApiGet('/employee-documents');
  useEffect(() => onDataChanged(refresh), [refresh]);
  const [status, setStatus] = useState('');
  const [person, setPerson] = useState('');
  const [viewing, setViewing] = useState(null);
  const [showTemplates, setShowTemplates] = useState(false);
  const requests = useMemo(() => data?.requests || [], [data]);
  const rows = requests.filter(r => (!status || r.status === status) && (!person || r.user_id === person));
  const counts = data?.counts || {};
  const byPerson = useMemo(() => {
    const m = new Map();
    for (const r of requests) { if (!m.has(r.user_id)) m.set(r.user_id, { name: r.employee_name, n: 0 }); m.get(r.user_id).n++; }
    return [...m.entries()].sort((a, b) => a[1].name.localeCompare(b[1].name));
  }, [requests]);

  if (error) {
    return <p className="text-sm text-gray-600 bg-white border border-gray-200 rounded-xl px-4 py-6">{error}</p>;
  }
  if (!data) return <p className="text-sm text-gray-400">Loading…</p>;
  const templates = data.templates || [];
  return (
    <div className="space-y-4" data-employee-documents>
      <div className="flex flex-wrap gap-2 text-xs">
        {[['pending', 'Waiting'], ['signed', 'Signed'], ['declined', 'Declined'], ['cancelled', 'Withdrawn']].map(([k, l]) => (
          <button key={k} type="button" onClick={() => setStatus(status === k ? '' : k)}
            className={`px-2.5 py-1.5 rounded-lg border ${status === k ? 'border-powder-500 bg-powder-50 text-powder-800' : 'border-gray-200 bg-white text-gray-700'}`} data-doc-filter={k}>
            {l} <span className="font-bold">{counts[k] || 0}</span>
          </button>
        ))}
        {!data.storage_enabled && <span className="text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5">File storage is not configured — nothing can be sent or signed until it is.</span>}
      </div>

      <SendForm templates={templates} people={data.people || []} kinds={data.kinds || []} onSent={refresh} />

      <div className="bg-white border border-gray-200 rounded-xl">
        <button type="button" onClick={() => setShowTemplates(v => !v)} className="w-full px-4 py-3 flex items-center gap-2 text-sm font-semibold text-gray-900">
          Templates <span className="text-gray-400 font-normal">· {templates.filter(t => !t.retired_at).length} kept</span>
          {showTemplates ? <ChevronUp size={14} className="ml-auto text-gray-400" /> : <ChevronDown size={14} className="ml-auto text-gray-400" />}
        </button>
        {showTemplates && (
          <div className="border-t border-gray-100 px-4 py-3 space-y-3" data-templates>
            <TemplateUpload kinds={data.kinds || []} onSaved={refresh} />
            {templates.map(t => (
              <div key={t.id} className={`flex items-center gap-3 text-sm ${t.retired_at ? 'opacity-50' : ''}`} data-template-row={t.id}>
                <FileSignature size={14} className="text-gray-400 shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-gray-900 truncate">{t.title} {t.retired_at && <span className="text-[10px] text-gray-500">(retired)</span>}</p>
                  <p className="text-[11px] text-gray-500 truncate">{t.filename} · {t.field_count ? `${t.field_count} fillable boxes` : 'no fillable boxes — signed as read'} · added by {t.uploaded_by} {formatDate(t.uploaded_at)}</p>
                </div>
                {!t.retired_at && (
                  <button type="button" title="Retire this template" onClick={() => apiDelete(`/employee-documents/templates/${t.id}`).then(refresh)} className="text-gray-400 hover:text-red-600" data-template-retire={t.id}><Trash2 size={14} /></button>
                )}
              </div>
            ))}
            {templates.length === 0 && <p className="text-xs text-gray-400">No templates yet. Add the current W-4 and W-9 once and send them from here.</p>}
          </div>
        )}
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <p className="text-sm font-semibold text-gray-900">Documents</p>
        <select className="px-2 py-1 border border-gray-300 rounded-lg text-xs" value={person} onChange={e => setPerson(e.target.value)} data-doc-person-filter>
          <option value="">Everyone</option>
          {byPerson.map(([id, p]) => <option key={id} value={id}>{p.name} ({p.n})</option>)}
        </select>
        <span className="text-[11px] text-gray-400">{rows.length} shown</span>
      </div>
      <div className="space-y-2">
        {rows.map(r => <Row key={r.id} r={r} onChanged={refresh} onView={setViewing} />)}
        {rows.length === 0 && <p className="text-sm text-gray-400 bg-white border border-gray-200 rounded-xl px-4 py-8 text-center">Nothing here yet.</p>}
      </div>
      <p className="text-[11px] text-gray-400">
        A signed copy is the PDF as sent, with the employee's answers locked into its boxes and a signature record page added — the drawn signature, the typed name, the time, the address and the statement signed under. It is never rewritten; a correction is a new request.
      </p>
      {viewing && <SignDocumentModal id={viewing} onClose={() => setViewing(null)} />}
    </div>
  );
}
