import { useState } from 'react';
import { useApiGet, apiPost, apiPut, apiFetch } from '../../hooks/useApi';
import { GitBranch, CheckCircle2, X, Edit2, Trash2, AlertTriangle } from 'lucide-react';
import { withSignature } from '../../lib/signature';
import { formatDate, formatDateTime } from '../../lib/datetime.js';
import DocumentBodyEditor from './DocumentBodyEditor.jsx';

/**
 * A controlled document's revisions (D-277).
 *
 * The document is the APPROVED revision in force. A change to its text or
 * number is a draft revision here: edited without touching what is in force,
 * approved with a password, and given a new number. Approving keeps the old
 * revision as history and signals the Quality bot. The courses built on the
 * document are listed with the revision each teaches, so "needs update" is
 * visible where the revision is approved.
 */
export default function DocumentRevisions({ doc, canEdit, onChanged }) {
  const { data, refresh } = useApiGet(`/documents/${doc.id}/revisions`, [doc.id]);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [label, setLabel] = useState(null); // null = the suggestion; a person may type another (D-280)
  if (!data) return null;
  const { draft, revisions, courses, in_force: inForce, suggested_revision: suggested, can_approve: canApprove } = data;
  const history = revisions.filter(r => r.status !== 'draft');

  const run = async (fn) => {
    setBusy(true); setError('');
    try { await fn(); refresh(); onChanged?.(); }
    catch (e) { if (!e.cancelled) setError(e.message); }
    finally { setBusy(false); }
  };
  const startLabel = (label ?? suggested ?? '').trim();
  const start = () => run(async () => { await apiPost(`/documents/${doc.id}/revisions`, { revision: startLabel }); setLabel(null); });
  const approve = () => run(() => withSignature(
    (extra) => apiPost(`/documents/${doc.id}/revisions/${draft.id}/approve`, extra),
    { title: `Approve revision ${draft.revision}`, detail: `${doc.doc_number || ''} ${doc.title}`.trim() }));
  const discard = () => {
    const reason = window.prompt('Why is this draft revision being discarded?');
    if (reason == null) return;
    run(() => apiFetch(`/documents/${doc.id}/revisions/${draft.id}`, { method: 'DELETE', body: { reason } }));
  };

  return (
    <div className="px-5 py-3 border-t border-gray-100 space-y-2" data-doc-revisions>
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <p className="text-xs font-semibold text-gray-700 flex items-center gap-1.5">
          <GitBranch size={13} /> Revisions
          <span className="font-normal text-gray-500">· in force: rev {inForce.revision}{inForce.approved ? '' : ' (not approved yet)'}</span>
        </p>
        {canEdit && inForce.approved && !draft && doc.status !== 'archived' && (
          <div className="flex items-center gap-1.5">
            <label htmlFor={`rev-label-${doc.id}`} className="text-xs text-gray-600">New revision</label>
            <input id={`rev-label-${doc.id}`} value={label ?? suggested ?? ''} onChange={e => setLabel(e.target.value)}
              data-rev-label maxLength={20} title={`Suggested: ${suggested}. Type another label if this revision needs one.`}
              className="w-16 px-2 py-1 text-xs border border-gray-300 rounded-md" />
            <button type="button" onClick={start} disabled={busy || !startLabel} data-rev-start
              className="px-2.5 py-1 text-xs font-semibold rounded-md bg-powder-600 text-white hover:bg-powder-700 disabled:opacity-50">
              Start revision {startLabel}
            </button>
          </div>
        )}
      </div>

      {draft && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 space-y-1.5" data-rev-draft={draft.revision}>
          <p className="text-sm font-semibold text-amber-900">
            Draft revision {draft.revision}
            <span className="font-normal text-amber-800"> — not in force. Rev {inForce.revision} stays approved until this is approved.</span>
          </p>
          {draft.change_summary && <p className="text-xs text-amber-900">What changed: {draft.change_summary}</p>}
          <p className="text-[11px] text-amber-800">Started by {draft.created_by || '—'} · {formatDate(draft.created_at)}</p>
          <div className="flex flex-wrap gap-1.5 pt-0.5">
            {canEdit && (
              <button type="button" onClick={() => setEditing(true)} data-rev-edit
                className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded-md border border-amber-400 bg-white text-amber-900">
                <Edit2 size={12} /> Edit draft
              </button>
            )}
            {canApprove && (
              <button type="button" onClick={approve} disabled={busy} data-rev-approve
                className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded-md bg-green-600 text-white hover:bg-green-700 disabled:opacity-50">
                <CheckCircle2 size={12} /> Approve revision {draft.revision}
              </button>
            )}
            {canEdit && (
              <button type="button" onClick={discard} disabled={busy} data-rev-discard
                className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded-md text-red-700 hover:bg-red-50">
                <Trash2 size={12} /> Discard draft
              </button>
            )}
          </div>
        </div>
      )}

      {courses.length > 0 && (
        <div className="text-xs space-y-1" data-rev-courses>
          <p className="text-gray-600">Courses built on this document:</p>
          {courses.map(c => (
            <p key={c.id} className="flex items-center gap-1.5 flex-wrap" data-rev-course={c.code || c.title}>
              <span className="text-gray-800">{c.code ? `${c.code} — ` : ''}{c.title}</span>
              <span className="text-gray-500">built on rev {c.built_on_revision || 'not recorded'}</span>
              {c.needs_update && (
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-orange-100 text-orange-800 font-semibold">
                  <AlertTriangle size={10} /> Needs update
                </span>
              )}
            </p>
          ))}
        </div>
      )}

      {history.length > 0 && (
        <ul className="text-xs divide-y divide-gray-50" data-rev-history>
          {history.map(r => (
            <li key={r.id} className="py-1 flex items-center justify-between gap-2">
              <span className="text-gray-700">
                Rev {r.revision} · {r.status === 'approved' ? 'in force' : 'superseded'}
                {r.source === 'baseline' ? ' · recorded when revision control started' : ''}
                {r.change_summary && r.source !== 'baseline' ? ` · ${r.change_summary}` : ''}
              </span>
              <span className="text-gray-500 shrink-0 text-right" data-rev-signature={r.approval_state || ''}>
                {r.approved_by || '—'}{r.approved_at ? ` · ${formatDateTime(r.approved_at)}` : ''}{r.approved_meaning ? ` · ${r.approved_meaning}` : ''}
                {r.approval_state === 'signed' && <span className="ml-1 text-green-700">· signed</span>}
                {r.approval_state === 'changed' && <span className="ml-1 text-red-700 font-semibold">· changed since signed</span>}
              </span>
            </li>
          ))}
        </ul>
      )}
      {error && <p className="text-xs text-red-700" data-rev-error>{error}</p>}
      {editing && draft && (
        <DraftEditor doc={doc} draft={draft} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); refresh(); }} />
      )}
    </div>
  );
}

function DraftEditor({ doc, draft, onClose, onSaved }) {
  const [form, setForm] = useState({
    revision: draft.revision || '', change_summary: draft.change_summary || '', effective_date: draft.effective_date || '',
    description: draft.description || '', description_es: draft.description_es || '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const save = async (e) => {
    e.preventDefault();
    setSaving(true); setError('');
    try { await apiPut(`/documents/${doc.id}/revisions/${draft.id}`, form); onSaved(); }
    catch (err) { setError(err.message); }
    finally { setSaving(false); }
  };
  const cls = 'w-full px-3 py-2 border border-gray-300 rounded-lg text-sm';
  return (
    <div className="fixed inset-0 bg-black/30 z-[60] flex items-start justify-center p-4 overflow-y-auto" onClick={onClose}>
      <form onClick={e => e.stopPropagation()} onSubmit={save} data-rev-editor
        className="bg-white rounded-xl shadow-xl w-full max-w-3xl my-6 p-5 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-gray-900">Draft revision — {doc.doc_number || doc.title}</h3>
          <button type="button" onClick={onClose} className="p-1 hover:bg-gray-100 rounded-lg"><X size={18} className="text-gray-500" /></button>
        </div>
        <p className="text-xs text-gray-600">
          Changes here stay in the draft. Revision {doc.revision} remains in force until the draft is approved.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <label className="block">
            <span className="block text-xs font-medium text-gray-700 mb-1">New revision #</span>
            <input value={form.revision} onChange={e => set('revision', e.target.value)} required className={cls} data-rev-number />
          </label>
          <label className="block">
            <span className="block text-xs font-medium text-gray-700 mb-1">Effective date</span>
            <input type="date" value={form.effective_date || ''} onChange={e => set('effective_date', e.target.value)} className={cls} />
          </label>
          <label className="block sm:col-span-1">
            <span className="block text-xs font-medium text-gray-700 mb-1">What changed</span>
            <input value={form.change_summary} onChange={e => set('change_summary', e.target.value)} className={cls}
              placeholder="e.g. Cleaning frequency moved to daily" data-rev-summary />
          </label>
        </div>
        <div>
          <span className="block text-xs font-medium text-gray-700 mb-1">Text</span>
          <DocumentBodyEditor value={form.description} onChange={(v) => set('description', v)} />
        </div>
        <label className="block">
          <span className="block text-xs font-medium text-gray-700 mb-1">Spanish version</span>
          <textarea value={form.description_es} onChange={e => set('description_es', e.target.value)} rows={5} lang="es"
            className={`${cls} font-mono`} />
        </label>
        {error && <p className="text-sm text-red-700">{error}</p>}
        <div className="flex gap-2">
          <button type="submit" disabled={saving} data-rev-save
            className="flex-1 px-4 py-2 bg-powder-600 text-white text-sm font-medium rounded-lg disabled:opacity-50">
            {saving ? 'Saving…' : 'Save draft'}
          </button>
          <button type="button" onClick={onClose} className="px-4 py-2 bg-gray-100 text-gray-700 text-sm font-medium rounded-lg">Cancel</button>
        </div>
      </form>
    </div>
  );
}
