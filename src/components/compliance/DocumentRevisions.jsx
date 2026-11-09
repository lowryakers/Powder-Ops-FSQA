import { useState } from 'react';
import { useApiGet, apiPost, apiPut, apiFetch, apiUpload } from '../../hooks/useApi';
import { GitBranch, CheckCircle2, X, Edit2, Trash2, AlertTriangle, Paperclip, FileText } from 'lucide-react';
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
  const { draft, revisions, courses, in_force: inForce, suggested_revision: suggested, can_approve: canApprove,
    can_qa_review: canQaReview, owner, first_review: firstReview } = data;
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
  // QA's review comes before the approval (D-319): a QA supervisor's password.
  const qaReview = () => run(() => withSignature(
    (extra) => apiPost(`/documents/${doc.id}/revisions/${draft.id}/qa-signoff`, extra),
    { title: `QA review of revision ${draft.revision}`, detail: `${doc.doc_number || ''} ${doc.title}`.trim() }));
  const withdrawQa = () => {
    const reason = window.prompt('Why is the QA review being withdrawn?');
    if (reason == null) return;
    run(() => apiFetch(`/documents/${doc.id}/revisions/${draft.id}/qa-signoff`, { method: 'DELETE', body: { reason } }));
  };
  const qaSigned = draft?.qa_review_state === 'signed';
  // A NEW document's first approval waits for QA's review too (D-321).
  const firstSigned = firstReview?.qa_review_state === 'signed';
  const firstQa = () => run(() => withSignature(
    (extra) => apiPost(`/documents/${doc.id}/qa-signoff`, extra),
    { title: `QA review of ${doc.doc_number || doc.title}`, detail: `Revision ${doc.revision}` }));
  const firstWithdraw = () => {
    const reason = window.prompt('Why is the QA review being withdrawn?');
    if (reason == null) return;
    run(() => apiFetch(`/documents/${doc.id}/qa-signoff`, { method: 'DELETE', body: { reason } }));
  };
  const firstApprove = () => run(() => withSignature(
    (extra) => apiPut(`/documents/${doc.id}`, { status: 'active', ...extra }),
    { title: `Approve ${doc.doc_number || doc.title}`, detail: `Revision ${doc.revision} — your password is your signature` }));
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

      {firstReview && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 space-y-1.5" data-first-approval>
          <p className="text-sm font-semibold text-amber-900">
            Not approved yet
            <span className="font-normal text-amber-800"> — QA reviews this document, then it is approved.</span>
          </p>
          <QaReviewLine draft={firstReview} owner={owner} noun="document" />
          <div className="flex flex-wrap gap-1.5 pt-0.5">
            {canQaReview && !firstSigned && firstReview.has_text && (
              <button type="button" onClick={firstQa} disabled={busy} data-first-qa-review
                className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded-md bg-teal-600 text-white hover:bg-teal-700 disabled:opacity-50">
                <CheckCircle2 size={12} /> QA review
              </button>
            )}
            {firstReview.qa_reviewed_at && (canQaReview || canApprove) && (
              <button type="button" onClick={firstWithdraw} disabled={busy} data-first-qa-withdraw
                className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded-md text-teal-800 hover:bg-teal-50">
                Withdraw QA review
              </button>
            )}
            {canApprove && (
              <button type="button" onClick={firstApprove} disabled={busy || !firstSigned} data-first-approve
                title={firstSigned ? '' : 'QA reviews the document first.'}
                className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded-md bg-green-600 text-white hover:bg-green-700 disabled:opacity-50">
                <CheckCircle2 size={12} /> Approve revision {doc.revision}
              </button>
            )}
          </div>
          {!firstReview.has_text && <p className="text-xs text-amber-900">Add the document's text before QA can review it.</p>}
        </div>
      )}

      {draft && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 space-y-1.5" data-rev-draft={draft.revision}>
          <p className="text-sm font-semibold text-amber-900">
            Draft revision {draft.revision}
            <span className="font-normal text-amber-800"> — not in force. Rev {inForce.revision} stays approved until this is approved.</span>
          </p>
          {draft.change_summary && <p className="text-xs text-amber-900">What changed: {draft.change_summary}</p>}
          {draft.doc_number && draft.doc_number !== doc.doc_number && (
            <p className="text-xs text-amber-900" data-rev-number-change>
              Document number changes on approval: <span className="font-mono">{doc.doc_number || '(none)'}</span> → <span className="font-mono font-semibold">{draft.doc_number}</span>
            </p>
          )}
          <p className="text-[11px] text-amber-800">Started by {draft.created_by || '—'} · {formatDate(draft.created_at)}{draft.effective_date ? ` · effective ${draft.effective_date}` : ''}</p>
          <QaReviewLine draft={draft} owner={owner} />
          <DraftFiles doc={doc} draft={draft} canEdit={canEdit} />
          <div className="flex flex-wrap gap-1.5 pt-0.5">
            {canEdit && (
              <button type="button" onClick={() => setEditing(true)} data-rev-edit
                className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded-md border border-amber-400 bg-white text-amber-900">
                <Edit2 size={12} /> Edit draft
              </button>
            )}
            {canQaReview && !qaSigned && (
              <button type="button" onClick={qaReview} disabled={busy} data-rev-qa-review
                className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded-md bg-teal-600 text-white hover:bg-teal-700 disabled:opacity-50">
                <CheckCircle2 size={12} /> QA review
              </button>
            )}
            {draft.qa_reviewed_at && (canQaReview || canApprove) && (
              <button type="button" onClick={withdrawQa} disabled={busy} data-rev-qa-withdraw
                className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded-md text-teal-800 hover:bg-teal-50">
                Withdraw QA review
              </button>
            )}
            {canApprove && (
              <button type="button" onClick={approve} disabled={busy || !qaSigned} data-rev-approve
                title={qaSigned ? '' : 'QA reviews the draft first.'}
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
                {r.qa_reviewed_by && <span data-rev-qa-history>QA: {r.qa_reviewed_by} · {formatDateTime(r.qa_reviewed_at)} · </span>}
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
    doc_number: draft.doc_number || doc.doc_number || '',
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
        <label className="block">
          <span className="block text-xs font-medium text-gray-700 mb-1">Document number</span>
          <input value={form.doc_number} onChange={e => set('doc_number', e.target.value)} className={`${cls} sm:max-w-xs font-mono`} data-rev-docnumber />
          <span className="block text-[11px] text-gray-500 mt-0.5">
            Change this only when the new revision is issued under a new number. The document keeps {doc.doc_number || 'its number'} until the draft is approved.
          </span>
        </label>
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

/**
 * The files filed against this draft (D-304) — the signed scan of the new
 * revision, usually. They wait here, not in the document's Attachments, and
 * become the document's when the draft is approved.
 */
function DraftFiles({ doc, draft, canEdit }) {
  const { data: files, refresh } = useApiGet(`/documents/${doc.id}/attachments`, [doc.id, draft.id]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const mine = (files || []).filter(f => f.state === 'draft' && f.revision_id === draft.id);
  const signed = mine.some(f => f.kind === 'signed_original');
  const upload = async (list) => {
    const picked = Array.from(list || []);
    if (!picked.length) return;
    setBusy(true); setError('');
    try {
      const fd = new FormData();
      picked.forEach(f => fd.append('files', f));
      fd.append('kind', 'signed_original');
      fd.append('revision_id', draft.id);
      await apiUpload(`/documents/${doc.id}/attachments`, fd);
      refresh();
    } catch (e) { setError(e.message || 'Upload failed.'); }
    finally { setBusy(false); }
  };
  return (
    <div className="text-xs space-y-1" data-rev-draft-files>
      <p className={signed ? 'text-amber-900' : 'text-amber-800'} data-rev-signed={signed ? 'yes' : 'no'}>
        {signed ? 'Signed PDF attached to this draft:' : 'No signed PDF attached to this draft yet.'}
      </p>
      {mine.map(f => (
        <p key={f.id} className="flex items-center gap-1.5 pl-1" data-rev-draft-file={f.filename}>
          <FileText size={12} className="text-amber-700 shrink-0" />
          {f.url ? <a href={f.url} target="_blank" rel="noreferrer" className="text-amber-900 hover:underline truncate">{f.filename}</a>
            : <span className="text-amber-900 truncate">{f.filename}</span>}
          <span className="text-amber-700 shrink-0">{f.uploaded_by} · {formatDate(f.created_at)}</span>
        </p>
      ))}
      {canEdit && (
        <label className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-amber-400 bg-white text-amber-900 font-semibold cursor-pointer">
          <Paperclip size={12} /> {busy ? 'Uploading…' : 'Attach signed PDF to this draft'}
          <input type="file" accept="application/pdf,.pdf" multiple className="hidden" disabled={busy} data-rev-draft-upload
            onChange={e => { upload(e.target.files); e.target.value = ''; }} />
        </label>
      )}
      {error && <p className="text-red-700">{error}</p>}
    </div>
  );
}

/**
 * The three verifications on a draft (D-319): who owns it, QA's review, and the
 * approval still to come. QA's line says plainly whether it is done, missing,
 * or was taken off by an edit made after it.
 */
function QaReviewLine({ draft, owner, noun = 'draft' }) {
  const state = draft.qa_review_state;
  return (
    <div className="text-xs space-y-0.5" data-rev-qa-state={state || 'none'}>
      <p className="text-amber-900">Owner: {owner || 'not set'}</p>
      {state === 'signed' ? (
        <p className="text-teal-800 font-semibold">
          QA review: {draft.qa_reviewed_by} · {formatDateTime(draft.qa_reviewed_at)} · {draft.qa_review_meaning}
        </p>
      ) : state === 'changed' ? (
        <p className="text-red-700 font-semibold">QA review: the {noun} changed after {draft.qa_reviewed_by} reviewed it — QA reviews it again.</p>
      ) : (
        <p className="text-amber-900 font-semibold">QA review: not yet — a QA supervisor reviews the {noun} before it can be approved.</p>
      )}
    </div>
  );
}
