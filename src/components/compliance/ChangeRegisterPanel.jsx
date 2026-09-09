// The change register (CAR 4990683-4): every kind of change 21 CFR 111.130(e)
// names, requested → assessed → approved by Quality (a signature) →
// implemented → closed by Quality after the effectiveness check. Parked
// controlled definitions and the software releases the app has booted sit on
// the same screen, because they are changes too. Every count is the length of
// the rows behind it.
import { useState } from 'react';
import { useApiGet, apiPost, apiPut } from '../../hooks/useApi';
import { withSignature } from '../../lib/signature.js';
import { formatDate, formatDateTime } from '../../lib/datetime.js';
import { ShieldCheck, Plus, Check, X, AlertTriangle, GitCommit, Clock } from 'lucide-react';

const KIND_LABEL = { equipment: 'Equipment', process: 'Process', software: 'Software', utility: 'Utility', facility: 'Physical plant', document: 'Controlled document', other: 'Other' };
const STATUS = {
  draft: { label: 'Draft', cls: 'bg-slate-100 text-slate-600' },
  submitted: { label: 'Awaiting Quality approval', cls: 'bg-amber-50 text-amber-800' },
  approved: { label: 'Approved · to implement', cls: 'bg-blue-50 text-blue-700' },
  rejected: { label: 'Rejected', cls: 'bg-red-50 text-red-800' },
  implemented: { label: 'Implemented · awaiting close', cls: 'bg-violet-50 text-violet-700' },
  closed: { label: 'Closed', cls: 'bg-green-50 text-green-700' },
  withdrawn: { label: 'Withdrawn', cls: 'bg-slate-100 text-slate-500' },
};
const Chip = ({ s }) => { const m = STATUS[s] || STATUS.draft; return <span data-cr-status={s} className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${m.cls}`}>{m.label}</span>; };

export default function ChangeRegisterPanel() {
  const { data, refresh } = useApiGet('/change-register');
  const [adding, setAdding] = useState(false);
  const [filter, setFilter] = useState('open');
  const [open, setOpen] = useState(null);
  const c = data?.counts || {};
  const reqs = (data?.requests || []).filter(r => filter === 'all' ? true : filter === 'open' ? !['closed', 'rejected', 'withdrawn'].includes(r.status) : r.status === filter);
  return (
    <div className="space-y-4 max-w-6xl" data-change-register>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="font-semibold text-gray-900 flex items-center gap-2"><ShieldCheck size={16} /> Change Register</h3>
          <p className="text-xs text-gray-500 mt-0.5 max-w-2xl">
            Every change to equipment, a process, software, a utility or the building: raised by anyone, assessed for impact,
            <b> approved by Quality before it is made</b>, then closed by Quality once it has been checked. A change cannot be
            marked implemented before approval, or closed without it. Parked form changes and the software releases the app has run are listed below.
          </p>
        </div>
        <button onClick={() => setAdding(a => !a)} data-cr-new className="flex items-center gap-1.5 px-3 py-2 bg-powder-600 text-white text-sm font-medium rounded-lg hover:bg-powder-700"><Plus size={16} /> Raise a change</button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <Stat n={c.awaiting_approval} label="awaiting Quality approval" tone={c.awaiting_approval ? 'amber' : ''} attr="data-cr-awaiting" onClick={() => setFilter('submitted')} />
        <Stat n={c.approved_open} label="approved, to implement" onClick={() => setFilter('approved')} />
        <Stat n={c.awaiting_close} label="implemented, awaiting close" tone={c.awaiting_close ? 'violet' : ''} onClick={() => setFilter('implemented')} />
        <Stat n={c.parked_definitions} label="form changes parked for Document Control" tone={c.parked_definitions ? 'amber' : ''} />
        <Stat n={c.releases_uncontrolled} label={`software releases with no change request (of ${c.releases ?? 0})`} tone={c.releases_uncontrolled ? 'red' : ''} attr="data-cr-uncontrolled" />
      </div>

      {adding && <NewChangeForm kinds={data?.kinds || []} onDone={() => { setAdding(false); refresh(); }} onCancel={() => setAdding(false)} />}

      <div className="flex flex-wrap gap-1 text-xs">
        {[['open', 'Open'], ['submitted', 'Awaiting approval'], ['approved', 'Approved'], ['implemented', 'Awaiting close'], ['closed', 'Closed'], ['all', 'All']].map(([k, l]) => (
          <button key={k} onClick={() => setFilter(k)} className={`px-2.5 py-1 rounded-full border ${filter === k ? 'bg-powder-600 text-white border-powder-600' : 'bg-white border-gray-300 text-gray-700'}`}>{l}</button>
        ))}
      </div>

      {reqs.length === 0 ? <p className="text-sm text-gray-400 border border-dashed border-gray-200 rounded-xl p-6 text-center">No change requests{filter !== 'all' ? ' in this view' : ' yet'}.</p> : (
        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
          <table className="min-w-full text-xs">
            <thead className="bg-gray-50 text-gray-500"><tr><th className="text-left px-3 py-2">#</th><th className="text-left px-3 py-2">Kind</th><th className="text-left px-3 py-2">Change</th><th className="text-left px-3 py-2">Raised</th><th className="text-left px-3 py-2">Risk</th><th className="text-left px-3 py-2">Status</th><th className="text-left px-3 py-2">Quality</th></tr></thead>
            <tbody className="divide-y divide-gray-100">
              {reqs.map(r => (
                <tr key={r.id} data-cr-row={r.number} onClick={() => setOpen(open === r.id ? null : r.id)} className="cursor-pointer hover:bg-gray-50">
                  <td className="px-3 py-2 font-mono">{r.number}</td>
                  <td className="px-3 py-2">{KIND_LABEL[r.kind] || r.kind}</td>
                  <td className="px-3 py-2 font-medium max-w-md">{r.title}</td>
                  <td className="px-3 py-2 whitespace-nowrap text-gray-500">{formatDate(r.requested_on)} · {r.requested_by}</td>
                  <td className="px-3 py-2">{r.risk || '—'}</td>
                  <td className="px-3 py-2"><Chip s={r.status} /></td>
                  <td className="px-3 py-2 text-gray-500 whitespace-nowrap">{r.approved_by ? `approved ${r.approved_by} ${formatDate(r.approved_at)}` : ''}{r.closed_by ? ` · closed ${r.closed_by}` : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {open && reqs.find(r => r.id === open) && <ChangeDetail r={reqs.find(r => r.id === open)} isQuality={!!data?.is_quality} onChanged={refresh} onClose={() => setOpen(null)} />}

      {data?.parked?.length > 0 && (
        <section className="rounded-xl border border-amber-200 bg-amber-50/40 p-3" data-cr-parked={data.parked.length}>
          <h4 className="text-xs font-semibold uppercase tracking-wide text-amber-800 flex items-center gap-1"><Clock size={13} /> Form and limit changes parked for Document Control · {data.parked.length}</h4>
          <ul className="mt-1 text-xs text-gray-700">
            {data.parked.map(p => <li key={p.id}>{p.label} <span className="text-gray-400">· deployed {p.pending_seen_at?.slice(0, 10)} · {p.changes.length} change(s) · decided in Controlled Changes</span></li>)}
          </ul>
        </section>
      )}

      <section className="rounded-xl border border-gray-200 p-3" data-cr-releases={data?.releases?.length ?? 0}>
        <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500 flex items-center gap-1"><GitCommit size={13} /> Software releases the app has run</h4>
        {data?.releases?.length ? (
          <ul className="mt-1 divide-y divide-gray-100 text-xs">
            {data.releases.map(r => (
              <li key={r.id} className="py-1 flex flex-wrap gap-2 items-center" data-release={r.sha.slice(0, 8)}>
                <span className="font-mono">{r.sha.slice(0, 8)}</span>
                <span className="text-gray-500">first ran {formatDateTime(r.first_booted_at)}{r.environment ? ` · ${r.environment}` : ''}</span>
                {r.change_number ? <span className="text-green-700">{r.change_number}</span> : <span className="text-red-700 font-semibold">no change request</span>}
              </li>
            ))}
          </ul>
        ) : <p className="text-xs text-gray-400 mt-1">No release recorded yet — a release is recorded the first time a deployed commit boots.</p>}
      </section>
    </div>
  );
}

function Stat({ n, label, tone, attr, onClick }) {
  const cls = tone === 'red' ? 'border-red-200 bg-red-50/40 text-red-800' : tone === 'amber' ? 'border-amber-200 bg-amber-50/40 text-amber-800' : tone === 'violet' ? 'border-violet-200 bg-violet-50/40 text-violet-800' : 'border-gray-200 bg-white text-gray-900';
  const Tag = onClick ? 'button' : 'div';
  return <Tag onClick={onClick} className={`text-left border rounded-xl p-3 ${cls}`} {...(attr ? { [attr]: n ?? 0 } : {})}><p className="text-lg font-bold">{n ?? 0}</p><p className="text-xs opacity-80">{label}</p></Tag>;
}

const Field = ({ label, children }) => <label className="block text-xs text-gray-600">{label}{children}</label>;
const inputCls = 'w-full px-2 py-1.5 border border-gray-300 rounded-lg text-sm';

function NewChangeForm({ kinds, onDone, onCancel }) {
  const [f, setF] = useState({ kind: 'process', title: '', description: '', reason: '', owner: '', impact_product_safety: '', impact_quality: '', impact_validation: '', documents_affected: '', training_affected: '', risk: '' });
  const [err, setErr] = useState('');
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const submit = async (e) => {
    e.preventDefault(); setErr('');
    try { await apiPost('/change-register', f); onDone(); } catch (x) { setErr(x.message); }
  };
  return (
    <form onSubmit={submit} className="rounded-xl border border-powder-200 bg-powder-50/40 p-3 grid gap-2 sm:grid-cols-2" data-cr-form>
      <Field label="Kind of change *"><select value={f.kind} onChange={set('kind')} className={inputCls} data-cr-kind>{kinds.map(k => <option key={k} value={k}>{KIND_LABEL[k] || k}</option>)}</select></Field>
      <Field label="Title *"><input required value={f.title} onChange={set('title')} className={inputCls} data-cr-title /></Field>
      <Field label="What is changing"><textarea rows={2} value={f.description} onChange={set('description')} className={inputCls} /></Field>
      <Field label="Why"><textarea rows={2} value={f.reason} onChange={set('reason')} className={inputCls} /></Field>
      <p className="sm:col-span-2 text-xs font-semibold text-gray-700 mt-1">Impact assessment — every line is required before the change can go to Quality (write "none" where there is none)</p>
      <Field label="Product safety"><input value={f.impact_product_safety} onChange={set('impact_product_safety')} className={inputCls} data-cr-impact-safety /></Field>
      <Field label="Quality"><input value={f.impact_quality} onChange={set('impact_quality')} className={inputCls} data-cr-impact-quality /></Field>
      <Field label="Validation / qualification"><input value={f.impact_validation} onChange={set('impact_validation')} className={inputCls} data-cr-impact-validation /></Field>
      <Field label="Documents affected"><input value={f.documents_affected} onChange={set('documents_affected')} className={inputCls} data-cr-docs /></Field>
      <Field label="Training affected"><input value={f.training_affected} onChange={set('training_affected')} className={inputCls} data-cr-training /></Field>
      <Field label="Risk"><select value={f.risk} onChange={set('risk')} className={inputCls} data-cr-risk><option value="">—</option><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></select></Field>
      <Field label="Owner (who makes the change)"><input value={f.owner} onChange={set('owner')} className={inputCls} /></Field>
      {err && <p className="sm:col-span-2 text-xs text-red-700">{err}</p>}
      <div className="sm:col-span-2 flex gap-2">
        <button type="submit" className="px-3 py-1.5 bg-powder-600 text-white rounded-lg text-xs font-medium" data-cr-save>Save as draft</button>
        <button type="button" onClick={onCancel} className="px-3 py-1.5 bg-gray-100 rounded-lg text-xs">Cancel</button>
      </div>
    </form>
  );
}

function ChangeDetail({ r, isQuality, onChanged, onClose }) {
  const [err, setErr] = useState('');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const run = async (fn) => {
    setBusy(true); setErr('');
    try { await fn(); setText(''); onChanged(); }
    catch (e) { if (!e?.cancelled) setErr(e.message); }
    finally { setBusy(false); }
  };
  const submit = () => run(() => apiPost(`/change-register/${r.id}/submit`, {}));
  const approve = () => run(() => withSignature((extra) => apiPost(`/change-register/${r.id}/approve`, { note: text, ...extra }), { title: `Approve ${r.number}`, detail: r.title }));
  const reject = () => run(() => apiPost(`/change-register/${r.id}/reject`, { reason: text }));
  const implement = () => run(() => apiPost(`/change-register/${r.id}/implement`, { implementation_notes: text }));
  const close = () => run(() => withSignature((extra) => apiPost(`/change-register/${r.id}/close`, { effectiveness_check: text, ...extra }), { title: `Close ${r.number}`, detail: 'The effectiveness check is recorded with your signature.' }));
  const withdraw = () => run(() => apiPost(`/change-register/${r.id}/withdraw`, { reason: text }));
  const saveAssessment = () => run(() => apiPut(`/change-register/${r.id}`, edit));
  const [edit, setEdit] = useState({ impact_product_safety: r.impact_product_safety || '', impact_quality: r.impact_quality || '', impact_validation: r.impact_validation || '', documents_affected: r.documents_affected || '', training_affected: r.training_affected || '', risk: r.risk || '' });
  const missing = r.assessment_missing || [];
  return (
    <section className="rounded-xl border border-gray-300 bg-white p-4 space-y-3" data-cr-detail={r.number}>
      <div className="flex items-start justify-between gap-2">
        <div><p className="font-mono text-xs text-gray-500">{r.number} · {KIND_LABEL[r.kind] || r.kind}</p><h4 className="font-semibold text-gray-900">{r.title}</h4><Chip s={r.status} /></div>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-700"><X size={16} /></button>
      </div>
      {r.description && <p className="text-sm text-gray-700 whitespace-pre-line">{r.description}</p>}
      {r.reason && <p className="text-xs text-gray-600"><b>Why:</b> {r.reason}</p>}
      <dl className="grid sm:grid-cols-2 gap-x-6 gap-y-1 text-xs">
        {[['Product safety', 'impact_product_safety'], ['Quality', 'impact_quality'], ['Validation', 'impact_validation'], ['Documents affected', 'documents_affected'], ['Training affected', 'training_affected']].map(([l, k]) => (
          <div key={k}><dt className="text-gray-500">{l}</dt><dd>{r.can_edit ? <input value={edit[k]} onChange={e => setEdit({ ...edit, [k]: e.target.value })} className={inputCls} data-cr-edit={k} /> : (r[k] || <span className="text-amber-700">not assessed</span>)}</dd></div>
        ))}
        <div><dt className="text-gray-500">Risk</dt><dd>{r.can_edit ? <select value={edit.risk} onChange={e => setEdit({ ...edit, risk: e.target.value })} className={inputCls} data-cr-edit="risk"><option value="">—</option><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></select> : (r.risk || '—')}</dd></div>
      </dl>
      {r.can_edit && <button onClick={saveAssessment} disabled={busy} className="px-3 py-1.5 bg-gray-800 text-white rounded-lg text-xs" data-cr-save-assessment>Save assessment</button>}
      {r.status === 'draft' && missing.length > 0 && <p className="text-xs text-amber-800" data-cr-missing={missing.length}>Before it can go to Quality: {missing.map(m => m.label).join('; ')}</p>}
      <ul className="text-xs text-gray-600 space-y-0.5">
        {r.submitted_at && <li>Submitted {formatDateTime(r.submitted_at)}</li>}
        {r.approved_at && <li className="text-green-700"><Check size={11} className="inline" /> Approved by {r.approved_by} {formatDateTime(r.approved_at)} (signed){r.approval_note ? ` — ${r.approval_note}` : ''}</li>}
        {r.rejected_at && <li className="text-red-700">Rejected by {r.rejected_by} — {r.rejected_reason}</li>}
        {r.implemented_on && <li>Implemented {formatDate(r.implemented_on)} by {r.implemented_by}: {r.implementation_notes}</li>}
        {r.closed_at && <li className="text-green-700">Closed by {r.closed_by} {formatDateTime(r.closed_at)} (signed) — effectiveness: {r.effectiveness_check}</li>}
      </ul>
      {err && <p className="text-xs text-red-700 flex items-center gap-1"><AlertTriangle size={12} /> {err}</p>}
      {(r.status === 'draft' || r.status === 'submitted' || r.status === 'approved' || r.status === 'implemented') && (
        <div className="space-y-2">
          <textarea value={text} onChange={e => setText(e.target.value)} rows={2} className={inputCls} data-cr-text
            placeholder={r.status === 'submitted' ? 'Approval note, or the reason for rejecting' : r.status === 'approved' ? 'What was done to implement it' : r.status === 'implemented' ? 'Effectiveness check — what was verified after the change' : 'Reason (for withdrawing)'} />
          <div className="flex flex-wrap gap-2">
            {r.status === 'draft' && r.can_edit && <button onClick={submit} disabled={busy || missing.length > 0} className="px-3 py-1.5 bg-powder-600 text-white rounded-lg text-xs font-medium disabled:opacity-50" data-cr-submit>Send to Quality</button>}
            {r.status === 'submitted' && isQuality && <button onClick={approve} disabled={busy} className="px-3 py-1.5 bg-green-700 text-white rounded-lg text-xs font-medium" data-cr-approve>Approve (sign)</button>}
            {r.status === 'submitted' && isQuality && <button onClick={reject} disabled={busy || !text.trim()} className="px-3 py-1.5 bg-red-700 text-white rounded-lg text-xs font-medium disabled:opacity-50" data-cr-reject>Reject</button>}
            {r.status === 'approved' && <button onClick={implement} disabled={busy || !text.trim()} className="px-3 py-1.5 bg-powder-600 text-white rounded-lg text-xs font-medium disabled:opacity-50" data-cr-implement>Mark implemented</button>}
            {r.status === 'implemented' && isQuality && <button onClick={close} disabled={busy || text.trim().length < 5} className="px-3 py-1.5 bg-green-700 text-white rounded-lg text-xs font-medium disabled:opacity-50" data-cr-close>Close (sign)</button>}
            {['draft', 'submitted'].includes(r.status) && r.can_edit && <button onClick={withdraw} disabled={busy || !text.trim()} className="px-3 py-1.5 bg-gray-100 text-gray-700 rounded-lg text-xs disabled:opacity-50">Withdraw</button>}
          </div>
        </div>
      )}
    </section>
  );
}
