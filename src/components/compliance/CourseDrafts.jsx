import { useState } from 'react';
import { useApiGet, apiFetch } from '../../hooks/useApi';
import { FileEdit, Bot, CheckCircle2, AlertTriangle, Video, FileText, X, Trash2 } from 'lucide-react';
import { withSignature } from '../../lib/signature';
import { formatDateTime } from '../../lib/datetime.js';
import { openFile } from '../../lib/openFile.js';

/**
 * Course drafts staged by the Quality bot (D-278). A draft is never training:
 * nobody is assigned it and it counts for nothing. Two people publish it, each
 * with their password — Document Control confirms it matches the document, a
 * QA supervisor approves the food safety content. The second signature
 * publishes. The server decides who may sign; this renders what it is told.
 */
export default function CourseDrafts({ onPublished }) {
  const [status, setStatus] = useState('draft');
  const [openId, setOpenId] = useState(null);
  const { data: rows, refresh } = useApiGet(`/training/drafts?status=${status}`, [status]);

  return (
    <div className="space-y-3" data-course-drafts>
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <p className="text-sm text-gray-600 max-w-2xl">
          New versions of courses staged by the Quality bot. A draft is never shown to trainees and never counts.
          Publishing takes two signatures: Document Control (matches the document) and a QA supervisor (food safety content).
        </p>
        <select value={status} onChange={e => setStatus(e.target.value)} data-drafts-status
          className="px-2 py-1.5 border border-gray-300 rounded-lg text-sm">
          <option value="draft">Open drafts</option>
          <option value="published">Published</option>
          <option value="discarded">Discarded</option>
          <option value="all">All</option>
        </select>
      </div>
      {!rows ? <p className="text-sm text-gray-500">Loading…</p> : rows.length === 0 ? (
        <p className="text-sm text-gray-500 bg-white border border-gray-200 rounded-lg px-4 py-6 text-center">No {status === 'all' ? '' : status} course drafts.</p>
      ) : (
        <ul className="bg-white border border-gray-200 rounded-lg divide-y divide-gray-100">
          {rows.map(d => (
            <li key={d.id}>
              <button type="button" onClick={() => setOpenId(d.id)} data-draft-row={d.title}
                className="w-full text-left px-4 py-3 hover:bg-gray-50 flex items-start justify-between gap-3">
                <span className="min-w-0">
                  <span className="block font-medium text-gray-900">{d.code ? `${d.code} — ` : ''}{d.title}
                    {!d.course_id && <span className="ml-2 text-[11px] font-semibold text-powder-700 bg-powder-50 px-1.5 py-0.5 rounded">New course</span>}
                  </span>
                  <span className="block text-xs text-gray-500 mt-0.5">
                    {d.document ? `${d.document.doc_number || d.document.title} rev ${d.built_from_revision || '—'}` : 'No document linked'}
                    {' · '}staged by {d.staged_by || '—'}{d.staged_via_token ? ' (bot)' : ''} · {formatDateTime(d.created_at)}
                  </span>
                  {d.document_moved && (
                    <span className="inline-flex items-center gap-1 mt-1 text-[11px] font-medium text-orange-800 bg-orange-100 px-2 py-0.5 rounded-full">
                      <AlertTriangle size={11} /> Document now at rev {d.document.revision_in_force}
                    </span>
                  )}
                </span>
                <span className="shrink-0 text-right text-[11px] space-y-0.5">
                  <SignChip label="Document" by={d.doc_confirmed_by} />
                  <SignChip label="Food safety" by={d.fs_approved_by} />
                  {d.status !== 'draft' && <span className="block font-semibold text-gray-600 capitalize">{d.status}</span>}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {openId && <DraftDetail id={openId} onClose={() => { setOpenId(null); refresh(); }} onPublished={onPublished} />}
    </div>
  );
}

function SignChip({ label, by }) {
  return by
    ? <span className="block text-green-700"><CheckCircle2 size={11} className="inline -mt-0.5" /> {label}: {by}</span>
    : <span className="block text-gray-400">{label}: waiting</span>;
}

const FIELD_LABEL = { code: 'Code', title: 'Title', category: 'Category', description: 'Description', retrain_months: 'Retrain (months)', passing_score: 'Pass mark', sop_id: 'Document' };

function DraftDetail({ id, onClose, onPublished }) {
  const { data: d, refresh } = useApiGet(`/training/drafts/${id}`, [id]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const sign = (role, title) => run(async () => {
    const out = await withSignature((extra) => apiFetch(`/training/drafts/${id}/sign/${role}`, { method: 'POST', body: extra }),
      { title, detail: d.title });
    if (out?.published) {
      const r = out.published.retraining;
      setNotice(`Published to the live course.${r ? ` Retraining for rev ${r.revision} assigned to ${r.assigned}.` : ''}`);
      onPublished?.();
    }
  });
  const unsign = (role) => run(async () => {
    const reason = window.prompt('Why is this signature being taken back?');
    if (reason == null) return;
    await apiFetch(`/training/drafts/${id}/sign/${role}`, { method: 'DELETE', body: { reason } });
  });
  const discard = () => run(async () => {
    const reason = window.prompt('Why is this draft being discarded?');
    if (reason == null) return;
    await apiFetch(`/training/drafts/${id}/discard`, { method: 'POST', body: { reason } });
  });
  async function run(fn) {
    setBusy(true); setError('');
    try { await fn(); refresh(); }
    catch (e) { if (!e.cancelled) setError(e.message); }
    finally { setBusy(false); }
  }

  return (
    <div className="fixed inset-0 bg-black/30 z-[60] flex items-start justify-center p-4 overflow-y-auto" onClick={onClose}>
      <div onClick={e => e.stopPropagation()} className="bg-white rounded-xl shadow-xl w-full max-w-3xl my-6" data-draft-detail>
        <div className="flex items-start justify-between gap-2 px-5 py-4 border-b border-gray-100">
          <div className="min-w-0">
            <p className="text-xs text-gray-500 flex items-center gap-1"><FileEdit size={12} /> Course draft{d?.status !== 'draft' && d ? ` · ${d.status}` : ''}</p>
            <h3 className="font-semibold text-gray-900">{d ? `${d.code ? `${d.code} — ` : ''}${d.title}` : 'Loading…'}</h3>
          </div>
          <button type="button" onClick={onClose} className="p-1 hover:bg-gray-100 rounded-lg"><X size={18} className="text-gray-500" /></button>
        </div>
        {d && (
          <div className="px-5 py-4 space-y-4 text-sm">
            <dl className="grid grid-cols-1 sm:grid-cols-3 gap-3" data-draft-facts>
              <Fact label="Built from">
                {d.document ? <>{d.document.doc_number || d.document.title} · rev {d.built_from_revision || '—'}</> : 'No document linked'}
                {d.document_moved && <span className="block text-orange-700 text-xs mt-0.5" data-draft-moved>Document is now at rev {d.document.revision_in_force}. Publishing is refused; stage a new draft.</span>}
              </Fact>
              <Fact label="Live course">{d.course ? `${d.course.code ? `${d.course.code} — ` : ''}${d.course.title}` : 'New course'}</Fact>
              <Fact label="Staged by">
                <span className="inline-flex items-center gap-1" data-draft-staged>{d.staged_via_token && <Bot size={13} className="text-gray-500" />}{d.staged_by || '—'}{d.staged_via_token ? ' (bot token)' : ''}</span>
                <span className="block text-xs text-gray-500">{formatDateTime(d.created_at)}{d.updated_at ? ` · edited ${formatDateTime(d.updated_at)}` : ''}</span>
              </Fact>
            </dl>
            {d.change_note && <p className="text-gray-700"><span className="font-medium">What changed:</span> {d.change_note}</p>}

            <section data-draft-diff>
              <h4 className="font-semibold text-gray-800 mb-1">What publishing changes{d.diff.new_course ? ' (a new course)' : ''}</h4>
              {d.diff.fields.length === 0 && !d.diff.quiz.changed && !d.diff.files.added.length && !d.diff.files.removed.length
                ? <p className="text-gray-500">Nothing differs from the live course.</p> : (
                <ul className="space-y-1">
                  {d.diff.fields.map(f => (
                    <li key={f.field} data-diff-field={f.field}>
                      <span className="font-medium">{FIELD_LABEL[f.field] || f.field}:</span>{' '}
                      {f.field === 'description'
                        ? <span className="text-gray-600">text changed ({String(f.live || '').length} → {String(f.draft || '').length} characters)</span>
                        : <><span className="line-through text-gray-400">{f.live ?? '—'}</span> → <span className="text-gray-900">{f.draft ?? '—'}</span></>}
                    </li>
                  ))}
                  {d.diff.quiz.kept ? <li className="text-gray-500">Quiz: the live quiz is kept.</li> : (
                    <li data-diff-quiz>
                      <span className="font-medium">Quiz:</span> {d.diff.quiz.live_count} → {d.diff.quiz.draft_count} questions
                      {d.diff.quiz.live_version ? ` (replaces version ${d.diff.quiz.live_version})` : ''}
                      {d.diff.quiz.spanish_missing > 0 && <span className="text-amber-700"> · {d.diff.quiz.spanish_missing} without Spanish</span>}
                      <ul className="ml-4 mt-0.5 text-xs text-gray-600">
                        {d.diff.quiz.rows.map(r => <li key={r.position}>Q{r.position} {r.change}: {r.draft || r.live}</li>)}
                      </ul>
                    </li>
                  )}
                  {d.diff.files.added.length > 0 && <li><span className="font-medium">Files added:</span> {d.diff.files.added.join(', ')}</li>}
                  {d.diff.files.removed.length > 0 && <li><span className="font-medium">Files taken away:</span> {d.diff.files.removed.join(', ')}</li>}
                </ul>
              )}
            </section>

            {d.description && (
              <section>
                <h4 className="font-semibold text-gray-800 mb-1">Course content</h4>
                <p className="whitespace-pre-line text-gray-700 max-h-60 overflow-y-auto border border-gray-100 rounded-lg p-3">{d.description}</p>
              </section>
            )}

            {d.materials.length > 0 && (
              <section>
                <h4 className="font-semibold text-gray-800 mb-1">Files on this draft</h4>
                <ul className="space-y-2">
                  {d.materials.map(m => (
                    <li key={m.id} data-draft-file={m.filename}>
                      {m.is_video && m.url
                        ? <video src={m.url} controls preload="metadata" className="w-full max-h-72 rounded-lg bg-black" />
                        : null}
                      <button type="button" disabled={!m.url} onClick={() => openFile({ url: m.url, name: m.filename })}
                        className="inline-flex items-center gap-1 text-powder-700 hover:underline disabled:text-gray-400">
                        {m.is_video ? <Video size={13} /> : <FileText size={13} />} {m.filename}
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {d.questions && (
              <section>
                <h4 className="font-semibold text-gray-800 mb-1">Quiz (English / Spanish)</h4>
                <ol className="space-y-2 list-decimal ml-5">
                  {d.questions.map((q, i) => (
                    <li key={i} data-draft-question={i + 1}>
                      <p className="text-gray-900">{q.prompt}</p>
                      <p className="text-gray-500 italic" lang="es">{q.prompt_es || 'No Spanish yet'}</p>
                      {q.options?.length > 0 && (
                        <ul className="text-xs text-gray-600 mt-0.5">
                          {q.options.map((o, j) => (
                            <li key={j} className={String(q.correct_answer) === String(j + 1) || q.correct_answer === o ? 'text-green-700 font-medium' : ''}>
                              {j + 1}. {o}{q.options_es?.[j] ? ` / ${q.options_es[j]}` : ''}
                            </li>
                          ))}
                        </ul>
                      )}
                      {!q.options?.length && <p className="text-xs text-green-700">Answer: {q.correct_answer}</p>}
                    </li>
                  ))}
                </ol>
              </section>
            )}

            <section className="border-t border-gray-100 pt-3 space-y-2" data-draft-signatures>
              <h4 className="font-semibold text-gray-800">Signatures</h4>
              {[['document', 'Matches the document', 'Document Control'], ['food_safety', 'Food safety content approved', 'QA supervisor']].map(([role, label, who]) => {
                const s = d.signatures[role];
                return (
                  <div key={role} className="flex items-center justify-between gap-2 flex-wrap" data-draft-sign={role}>
                    <span>
                      <span className="font-medium">{label}</span> <span className="text-gray-500">— {who}</span>
                      {s && <span className="block text-xs text-green-700">Signed by {s.by} · {formatDateTime(s.at)}</span>}
                    </span>
                    {d.status === 'draft' && !s && d.can_sign[role] && (
                      <button type="button" disabled={busy} onClick={() => sign(role, label)} data-draft-sign-btn={role}
                        className="px-3 py-1.5 text-xs font-semibold rounded-md bg-green-600 text-white hover:bg-green-700 disabled:opacity-50">
                        Sign: {label}
                      </button>
                    )}
                    {d.status === 'draft' && s && (
                      <button type="button" disabled={busy} onClick={() => unsign(role)} className="text-xs text-gray-600 hover:underline">Take back</button>
                    )}
                    {d.status === 'draft' && !s && !d.can_sign[role] && <span className="text-xs text-gray-400">Waiting</span>}
                  </div>
                );
              })}
              <p className="text-xs text-gray-500">The second signature publishes it. Any edit to the draft clears both signatures.</p>
            </section>

            {notice && <p className="text-sm text-green-800 bg-green-50 border border-green-200 rounded-lg px-3 py-2" data-draft-notice>{notice}</p>}
            {d.status === 'discarded' && <p className="text-sm text-gray-600">Discarded by {d.discarded_by}: {d.discard_reason}</p>}
            {error && <p className="text-sm text-red-700" data-draft-error>{error}</p>}
            {d.status === 'draft' && (
              <button type="button" onClick={discard} disabled={busy} data-draft-discard
                className="inline-flex items-center gap-1 text-xs font-semibold text-red-700 hover:bg-red-50 px-2 py-1 rounded-md">
                <Trash2 size={12} /> Discard draft
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function Fact({ label, children }) {
  return (
    <div>
      <dt className="text-xs text-gray-500">{label}</dt>
      <dd className="text-gray-900">{children}</dd>
    </div>
  );
}
