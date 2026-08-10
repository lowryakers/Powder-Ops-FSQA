import { useState, useMemo, useRef } from 'react';
import { useApiGet, apiPost, apiPut, apiFetch, apiUpload } from '../../hooks/useApi';
import { useAuth } from '../../hooks/useAuth';
import RichText from '../common/RichText.jsx';
import FormatBar from '../common/FormatBar.jsx';
import {
  BookText, Plus, Search, Upload, Eye, EyeOff, X, Sparkles, FileText,
  Trash2, Archive, CheckCircle, AlertTriangle, Pencil,
} from 'lucide-react';
import { formatDate } from '../../lib/datetime.js';

/**
 * Company policies — the handbook, not the controlled-document registry.
 *
 * Two things drive the UI: a policy is only visible to staff when it is
 * PUBLISHED *and* ticked visible, and the search covers the text inside an
 * uploaded document, not just the title. Everyone with the module gets a clean
 * read-only handbook; the office gets the editor.
 */
const STATUS_TONE = {
  draft: 'bg-amber-100 text-amber-800',
  published: 'bg-green-100 text-green-800',
  retired: 'bg-gray-100 text-gray-500',
};

function PolicyEditor({ policy, onClose, onSaved, aiOn }) {
  const isNew = !policy?.id;
  const [form, setForm] = useState({
    title: policy?.title || '', code: policy?.code || '', category: policy?.category || '',
    summary: policy?.summary || '', body: policy?.body || '', version: policy?.version || '',
    effective_date: policy?.effective_date || '', review_date: policy?.review_date || '',
    owner: policy?.owner || '', visible_to_staff: !!policy?.visible_to_staff,
  });
  const [busy, setBusy] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const [notes, setNotes] = useState('');
  const [showDraft, setShowDraft] = useState(false);
  const [error, setError] = useState('');
  const [file, setFile] = useState(null);
  const [progress, setProgress] = useState(0);
  const bodyRef = useRef(null);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const save = async () => {
    if (!form.title.trim()) { setError('A title is required.'); return; }
    setBusy(true); setError('');
    try {
      const saved = isNew ? await apiPost('/policies', form) : await apiPut(`/policies/${policy.id}`, form);
      if (file) {
        const fd = new FormData();
        fd.append('file', file);
        await apiUpload(`/policies/${saved.id}/file`, fd, 'POST', setProgress);
      }
      onSaved?.(); onClose();
    } catch (e) { setError(e.message); setBusy(false); }
  };

  const draft = async () => {
    if (!form.title.trim()) { setError('Give it a title first — that is what the draft is written against.'); return; }
    setDrafting(true); setError('');
    try {
      const r = await apiPost('/policies/draft', { title: form.title, category: form.category, notes });
      set('body', r.body);
      setShowDraft(false);
    } catch (e) { setError(e.message); }
    finally { setDrafting(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-[70] flex items-start justify-center p-4 overflow-y-auto" onClick={onClose}>
      <div onClick={e => e.stopPropagation()} className="bg-white rounded-xl shadow-xl w-full max-w-3xl my-6 p-4 space-y-3">
        <div className="flex items-start justify-between gap-2">
          <h3 className="font-semibold text-gray-900">{isNew ? 'New policy' : `Edit — ${policy.title}`}</h3>
          <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <div className="sm:col-span-2">
            <label className="block text-xs font-medium text-gray-700 mb-1">Title *</label>
            <input value={form.title} onChange={e => set('title', e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" placeholder="e.g. Paid Time Off" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Reference #</label>
            <input value={form.code} onChange={e => set('code', e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" placeholder="optional" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Category</label>
            <input value={form.category} onChange={e => set('category', e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" placeholder="e.g. HR" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Version</label>
            <input value={form.version} onChange={e => set('version', e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Owner</label>
            <input value={form.owner} onChange={e => set('owner', e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Effective date</label>
            <input type="date" value={form.effective_date} onChange={e => set('effective_date', e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Next review</label>
            <input type="date" value={form.review_date} onChange={e => set('review_date', e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Summary (one line)</label>
          <input value={form.summary} onChange={e => set('summary', e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
        </div>

        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="block text-xs font-medium text-gray-700">Policy text</label>
            {aiOn && (
              <button type="button" onClick={() => setShowDraft(s => !s)}
                className="inline-flex items-center gap-1 text-xs font-medium text-violet-700 hover:text-violet-800">
                <Sparkles size={12} /> Draft with AI
              </button>
            )}
          </div>
          {showDraft && (
            <div className="mb-2 rounded-lg border border-violet-200 bg-violet-50 p-2.5 space-y-2">
              <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3}
                placeholder="What should it cover? Any rules you already know — accrual, notice, who approves…"
                className="w-full px-2 py-1.5 border border-violet-200 rounded-lg text-sm bg-white" />
              <div className="flex items-center gap-2 flex-wrap">
                <button type="button" onClick={draft} disabled={drafting}
                  className="px-3 py-1.5 rounded-lg bg-violet-600 text-white text-xs font-semibold hover:bg-violet-700 disabled:opacity-50">
                  {drafting ? 'Drafting…' : form.body ? 'Replace the text below' : 'Write a draft'}
                </button>
                <span className="text-[11px] text-violet-800">
                  A starting point to edit — it never invents our numbers, it leaves [PLACEHOLDERS] for you to fill in.
                </span>
              </div>
            </div>
          )}
          <FormatBar getEl={() => bodyRef.current} value={form.body} onChange={v => set('body', v)} />
          <textarea ref={bodyRef} value={form.body} onChange={e => set('body', e.target.value)} rows={10}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm font-mono leading-relaxed"
            placeholder="Write the policy, or attach the document below — either is enough to publish." />
        </div>

        <div className="rounded-lg border border-gray-200 p-2.5 space-y-1.5">
          <label className="block text-xs font-medium text-gray-700">Attach the document (PDF or Word)</label>
          <input type="file" accept=".pdf,.doc,.docx,image/*" onChange={e => setFile(e.target.files?.[0] || null)}
            className="block w-full text-sm" />
          <p className="text-[11px] text-gray-500">
            From Google Docs: File → Download → PDF, then attach it here. The text inside is pulled out so a
            search finds a phrase printed in the document, not just the title.
            {policy?.filename ? ` Currently attached: ${policy.filename}.` : ''}
          </p>
          {progress > 0 && progress < 100 && <p className="text-[11px] text-gray-500">Uploading {progress}%…</p>}
        </div>

        <label className="flex items-start gap-2 rounded-lg border border-gray-200 p-2.5 cursor-pointer">
          <input type="checkbox" checked={form.visible_to_staff} onChange={e => set('visible_to_staff', e.target.checked)} className="mt-0.5 rounded border-gray-300" />
          <span className="text-sm text-gray-800">
            Employees can read this
            <span className="block text-[11px] text-gray-500">
              Staff only ever see policies that are both published and ticked here. Leave it off for
              management-only policies.
            </span>
          </span>
        </label>

        {error && <p className="text-xs text-red-600">{error}</p>}
        <div className="flex gap-2">
          <button onClick={save} disabled={busy}
            className="px-4 py-2 bg-powder-600 text-white text-sm font-semibold rounded-lg hover:bg-powder-700 disabled:opacity-50">
            {busy ? 'Saving…' : isNew ? 'Create policy' : 'Save changes'}
          </button>
          <button onClick={onClose} className="px-4 py-2 bg-gray-100 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-200">Cancel</button>
          {isNew && <span className="text-[11px] text-gray-500 self-center">It starts as a draft — publish it when it&apos;s ready.</span>}
        </div>
      </div>
    </div>
  );
}

// Import the policies you already have as files. Titles come from filenames,
// which is a guess — so the first step writes nothing and you confirm the
// titles. Everything lands as a draft that staff cannot see.
function PolicyImportModal({ onClose, onDone }) {
  const [files, setFiles] = useState([]);
  const [step, setStep] = useState('pick');
  const [rows, setRows] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const [progress, setProgress] = useState(0);

  const analyze = async () => {
    setBusy(true); setError('');
    try {
      const fd = new FormData();
      for (const f of files) fd.append('files', f);
      const a = await apiUpload('/policies/import/analyze', fd);
      setRows(a.files.map(f => ({ ...f, include: !f.exists, category: '' })));
      setStep('confirm');
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };

  const commit = async () => {
    setBusy(true); setError('');
    try {
      const fd = new FormData();
      for (const f of files) fd.append('files', f);
      fd.append('meta', JSON.stringify(Object.fromEntries(
        rows.map(r => [r.filename, { title: r.title, category: r.category, version: r.version, include: r.include }]))));
      setResult(await apiUpload('/policies/import', fd, 'POST', setProgress));
      setStep('done');
      onDone?.();
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };

  const chosen = rows.filter(r => r.include).length;
  const setRow = (i, patch) => setRows(rs => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  return (
    <div className="fixed inset-0 bg-black/40 z-[70] flex items-start justify-center p-4 overflow-y-auto" onClick={onClose}>
      <div onClick={e => e.stopPropagation()} className="bg-white rounded-xl shadow-xl w-full max-w-3xl my-6 p-4 space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h3 className="font-semibold text-gray-900">Import policies you already have</h3>
            <p className="text-xs text-gray-500">Pick the files; each becomes a policy with the document attached and its text searchable.</p>
          </div>
          <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>

        {step === 'pick' && (
          <div className="space-y-2">
            <input type="file" multiple accept=".pdf,.doc,.docx,.txt,.md,image/*"
              onChange={e => setFiles([...(e.target.files || [])])}
              className="block w-full text-sm border border-gray-300 rounded-lg p-2" />
            <p className="text-[11px] text-gray-500">
              From Google Drive you can select several files and download them, or export each doc as PDF.
              Up to 40 at a time. Nothing is created until you confirm the titles on the next screen.
            </p>
            {error && <p className="text-xs text-red-600">{error}</p>}
            <button onClick={analyze} disabled={!files.length || busy}
              className="px-4 py-2 bg-powder-600 text-white text-sm font-semibold rounded-lg hover:bg-powder-700 disabled:opacity-50">
              {busy ? 'Reading…' : `Read ${files.length || ''} file${files.length === 1 ? '' : 's'}`}
            </button>
          </div>
        )}

        {step === 'confirm' && (
          <div className="space-y-2">
            <p className="text-xs text-gray-600">
              Titles are taken from the filenames — correct any that read badly. They import as
              <strong> drafts</strong>, invisible to staff until you publish them.
            </p>
            <div className="border border-gray-200 rounded-lg divide-y divide-gray-100 max-h-80 overflow-y-auto">
              {rows.map((r, i) => (
                <div key={r.filename} className="p-2 space-y-1">
                  <div className="flex items-center gap-2">
                    <input type="checkbox" checked={r.include} onChange={e => setRow(i, { include: e.target.checked })}
                      className="rounded border-gray-300 shrink-0" />
                    <input value={r.title} onChange={e => setRow(i, { title: e.target.value })}
                      className="flex-1 px-2 py-1 border border-gray-300 rounded text-sm" />
                    <input value={r.category} onChange={e => setRow(i, { category: e.target.value })}
                      placeholder="Category" className="w-28 px-2 py-1 border border-gray-300 rounded text-sm shrink-0" />
                  </div>
                  <p className="text-[11px] text-gray-400 pl-6 truncate">
                    {r.filename}{r.version ? ` · v${r.version}` : ''}
                    {r.exists && <span className="text-amber-700"> · a policy with this title already exists</span>}
                  </p>
                </div>
              ))}
            </div>
            {error && <p className="text-xs text-red-600">{error}</p>}
            {progress > 0 && progress < 100 && <p className="text-[11px] text-gray-500">Uploading {progress}%…</p>}
            <div className="flex items-center gap-2">
              <button onClick={commit} disabled={busy || !chosen}
                className="px-4 py-2 bg-powder-600 text-white text-sm font-semibold rounded-lg hover:bg-powder-700 disabled:opacity-50">
                {busy ? 'Importing…' : `Import ${chosen} polic${chosen === 1 ? 'y' : 'ies'}`}
              </button>
              <button onClick={() => setStep('pick')} className="px-3 py-2 text-sm text-gray-600 rounded-lg hover:bg-gray-100">Back</button>
            </div>
          </div>
        )}

        {step === 'done' && result && (
          <div className="space-y-2">
            <p className="text-sm font-semibold text-green-700">{result.created} polic{result.created === 1 ? 'y' : 'ies'} created as drafts.</p>
            <ul className="text-xs text-gray-600 space-y-0.5">
              {result.skipped > 0 && <li>{result.skipped} left out.</li>}
              {result.failed > 0 && <li>{result.failed} failed: {result.problems.map(p => `${p.filename} (${p.reason})`).join('; ')}</li>}
              <li>Open each one to review it, tick &ldquo;employees can read this&rdquo; where it applies, and publish.</li>
            </ul>
            <button onClick={onClose} className="px-4 py-2 bg-powder-600 text-white text-sm font-medium rounded-lg hover:bg-powder-700">Done</button>
          </div>
        )}
      </div>
    </div>
  );
}

function PolicyView({ id, onClose, canManage, onChanged, onEdit }) {
  const { data: p, refresh } = useApiGet(`/policies/${id}`, [id]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (!p) return null;

  const act = async (fn) => {
    setBusy(true); setError('');
    try { await fn(); refresh(); onChanged?.(); }
    catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-[70] flex items-start justify-center p-4 overflow-y-auto" onClick={onClose}>
      <div onClick={e => e.stopPropagation()} className="bg-white rounded-xl shadow-xl w-full max-w-3xl my-6">
        <div className="flex items-start justify-between gap-2 p-4 border-b border-gray-100 sticky top-0 bg-white rounded-t-xl">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="font-semibold text-gray-900">{p.title}</h3>
              <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${STATUS_TONE[p.status]}`}>{p.status}</span>
              {p.visible_to_staff ? (
                <span className="inline-flex items-center gap-1 text-[11px] text-green-700"><Eye size={11} /> employees can read</span>
              ) : (
                <span className="inline-flex items-center gap-1 text-[11px] text-gray-400"><EyeOff size={11} /> management only</span>
              )}
            </div>
            <p className="text-[11px] text-gray-500 mt-0.5">
              {[p.code, p.category, p.version ? `v${p.version}` : null,
                p.effective_date ? `effective ${formatDate(p.effective_date)}` : null,
                p.owner].filter(Boolean).join(' · ')}
            </p>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {canManage && <button onClick={() => onEdit(p)} className="p-1.5 text-gray-400 hover:text-powder-600" title="Edit"><Pencil size={16} /></button>}
            <button onClick={onClose} className="p-1.5 text-gray-400 hover:text-gray-600"><X size={18} /></button>
          </div>
        </div>

        <div className="p-4 space-y-3">
          {p.summary && <p className="text-sm text-gray-600 italic">{p.summary}</p>}
          {p.file_url && (
            <a href={p.file_url} target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-200 hover:bg-gray-50 text-sm">
              <FileText size={15} className="text-powder-600" />
              <span className="text-gray-800">{p.filename}</span>
              {!p.searchable && <span className="text-[10px] text-amber-700">text not readable</span>}
            </a>
          )}
          {p.body ? (
            <div className="text-sm text-gray-800 leading-relaxed"><RichText text={p.body} /></div>
          ) : !p.file_url ? (
            <p className="text-sm text-gray-400">Nothing written yet.</p>
          ) : null}

          {error && <p className="text-xs text-red-600">{error}</p>}
          {canManage && (
            <div className="flex gap-2 flex-wrap pt-2 border-t border-gray-100">
              {p.status !== 'published' && (
                <button onClick={() => act(() => apiPost(`/policies/${p.id}/publish`, {}))} disabled={busy}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-green-600 text-white text-xs font-semibold hover:bg-green-700 disabled:opacity-50">
                  <CheckCircle size={13} /> Publish
                </button>
              )}
              {p.status === 'published' && (
                <button onClick={() => act(() => apiPost(`/policies/${p.id}/retire`, {}))} disabled={busy}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-gray-300 text-xs font-medium text-gray-700 hover:bg-gray-50">
                  <Archive size={13} /> Retire
                </button>
              )}
              {p.status === 'draft' && (
                <button onClick={async () => {
                  if (!window.confirm('Delete this draft?')) return;
                  await act(() => apiFetch(`/policies/${p.id}`, { method: 'DELETE' }));
                  onClose();
                }} disabled={busy}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs text-gray-400 hover:text-red-600 ml-auto">
                  <Trash2 size={13} /> Delete draft
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function PoliciesPanel() {
  const { user } = useAuth();
  const canManage = user?.role === 'admin'
    || ['office', 'admin', 'hr'].includes(String(user?.department || '').toLowerCase())
    || (user?.module_access && !Array.isArray(user.module_access) && user.module_access.policies === 'edit');

  const [q, setQ] = useState('');
  const [category, setCategory] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const query = useMemo(() => {
    const p = new URLSearchParams();
    if (q.trim().length >= 2) p.set('q', q.trim());
    if (category) p.set('category', category);
    if (statusFilter) p.set('status', statusFilter);
    return p.toString();
  }, [q, category, statusFilter]);
  const { data: list, refresh } = useApiGet(`/policies${query ? `?${query}` : ''}`, [query]);
  const { data: cats } = useApiGet('/policies/categories');
  const { data: status } = useApiGet('/comms/status');
  const aiOn = !!status?.translate; // same Anthropic key that gates the rest of the AI features

  const [editing, setEditing] = useState(null);
  const [viewing, setViewing] = useState(null);
  const [importing, setImporting] = useState(false);

  const rows = list || [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <BookText size={22} className="text-powder-600" />
          <h2 className="text-xl font-bold text-gray-900">Policies</h2>
        </div>
        {canManage && (
          <div className="flex items-center gap-2 flex-wrap">
            <button onClick={() => setImporting(true)}
              className="flex items-center gap-1.5 px-3 py-2 bg-gray-100 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-200">
              <Upload size={15} /> Import files
            </button>
            <button onClick={() => setEditing({})}
              className="flex items-center gap-1.5 px-4 py-2 bg-powder-600 text-white text-sm font-medium rounded-lg hover:bg-powder-700">
              <Plus size={16} /> New policy
            </button>
          </div>
        )}
      </div>

      {!canManage && (
        <p className="text-sm text-gray-500">The company policies that apply to everyone. Search finds words inside the documents too.</p>
      )}

      <div className="flex gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[220px]">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input value={q} onChange={e => setQ(e.target.value)}
            placeholder="Search policies — including the text inside the documents…"
            className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-lg text-sm" />
        </div>
        {(cats || []).length > 0 && (
          <select value={category} onChange={e => setCategory(e.target.value)}
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm">
            <option value="">All categories</option>
            {cats.map(c => <option key={c.category} value={c.category}>{c.category} ({c.c})</option>)}
          </select>
        )}
        {canManage && (
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm">
            <option value="">All statuses</option>
            <option value="published">Published</option>
            <option value="draft">Draft</option>
            <option value="retired">Retired</option>
          </select>
        )}
      </div>

      {rows.length === 0 ? (
        <div className="text-center py-14 text-gray-400">
          <BookText size={36} className="mx-auto mb-2 text-gray-300" />
          <p className="text-sm">{q ? `Nothing matches "${q}".` : 'No policies yet.'}</p>
          {canManage && !q && <p className="text-xs mt-1">Add one, or attach a document you already have.</p>}
        </div>
      ) : (
        <div className="space-y-2">
          {rows.map(p => (
            <button key={p.id} onClick={() => setViewing(p.id)}
              className="w-full text-left bg-white rounded-xl border border-gray-200 p-3 hover:border-powder-300 hover:shadow-sm transition-all">
              <div className="flex items-start gap-2 flex-wrap">
                <span className="font-medium text-gray-900">{p.title}</span>
                {p.code && <span className="text-[11px] text-gray-400">{p.code}</span>}
                {canManage && <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${STATUS_TONE[p.status]}`}>{p.status}</span>}
                {canManage && (p.visible_to_staff
                  ? <span className="inline-flex items-center gap-1 text-[11px] text-green-700"><Eye size={11} /> staff</span>
                  : <span className="inline-flex items-center gap-1 text-[11px] text-gray-400"><EyeOff size={11} /> management</span>)}
                {p.has_file && (
                  <span className="inline-flex items-center gap-1 text-[11px] text-gray-500 ml-auto">
                    <FileText size={11} /> {p.searchable ? 'document searchable' : 'document attached'}
                  </span>
                )}
              </div>
              {p.summary && <p className="text-xs text-gray-600 mt-0.5">{p.summary}</p>}
              {p.snippet && <p className="text-[11px] text-gray-500 mt-1 italic">…{p.snippet}</p>}
              <p className="text-[11px] text-gray-400 mt-1">
                {[p.category, p.version ? `v${p.version}` : null,
                  p.effective_date ? `effective ${formatDate(p.effective_date)}` : null].filter(Boolean).join(' · ')}
              </p>
            </button>
          ))}
        </div>
      )}

      {canManage && rows.some(p => p.status === 'published' && !p.visible_to_staff) && (
        <p className="text-[11px] text-gray-400 flex items-start gap-1">
          <AlertTriangle size={12} className="mt-0.5 shrink-0" />
          Published policies that aren&apos;t ticked &ldquo;employees can read&rdquo; are visible to the office only.
        </p>
      )}

      {viewing && (
        <PolicyView id={viewing} canManage={canManage}
          onClose={() => setViewing(null)} onChanged={refresh}
          onEdit={(p) => { setViewing(null); setEditing(p); }} />
      )}
      {editing && (
        <PolicyEditor policy={editing} aiOn={aiOn}
          onClose={() => setEditing(null)} onSaved={refresh} />
      )}
      {importing && (
        <PolicyImportModal onClose={() => setImporting(false)} onDone={refresh} />
      )}
    </div>
  );
}
