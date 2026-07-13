import { useState, Fragment } from 'react';
import { useApiGet, apiPost, apiPut, apiFetch, apiUpload } from '../../hooks/useApi';
import { useAuth } from '../../hooks/useAuth';
import { canEditModule } from '../../utils/permissions';
import { Plus, Search, Edit2, Download, History, X, Eye, Archive, ChevronUp, ChevronDown, FileText, Upload } from 'lucide-react';

const DOC_TYPE_OPTIONS = [
  { value: 'sop', label: 'SOP' },
  { value: 'work_instruction', label: 'Work Instruction' },
  { value: 'job_description', label: 'Job Description' },
  { value: 'policy', label: 'Policy' },
  { value: 'form', label: 'Form' },
];

const CATEGORIES = ['production', 'quality', 'sanitation', 'maintenance', 'safety', 'haccp', 'training', 'admin', 'other'];
const STATUSES = [
  { value: 'draft', label: 'Draft', color: 'bg-gray-100 text-gray-700' },
  { value: 'under_review', label: 'In Review', color: 'bg-amber-100 text-amber-700' },
  { value: 'active', label: 'Approved / Effective', color: 'bg-green-100 text-green-700' },
  { value: 'superseded', label: 'Superseded', color: 'bg-orange-100 text-orange-700' },
  { value: 'archived', label: 'Archived', color: 'bg-gray-100 text-gray-500' },
];
const STATUS_MAP = Object.fromEntries(STATUSES.map(s => [s.value, s]));

function StatusBadge({ status }) {
  const s = STATUS_MAP[status] || STATUSES[0];
  return <span className={`px-2 py-0.5 rounded-full text-xs font-medium whitespace-nowrap ${s.color}`}>{s.label}</span>;
}

const cap = (s) => (s || '').charAt(0).toUpperCase() + (s || '').slice(1);

function SortHeader({ label, field, sortField, sortOrder, onSort, className = '' }) {
  return (
    <th onClick={() => onSort(field)} className={`text-left px-3 py-2.5 text-xs font-medium text-gray-500 cursor-pointer select-none hover:text-gray-900 ${className}`}>
      <span className="inline-flex items-center gap-1">{label}{sortField === field && (sortOrder === 'asc' ? <ChevronUp size={12} /> : <ChevronDown size={12} />)}</span>
    </th>
  );
}

/* ───────── Minimal, safe Markdown renderer (React nodes, no innerHTML) ───────── */
function renderInline(text, kp) {
  const nodes = [];
  let rest = text;
  let k = 0;
  const pattern = /(\*\*(.+?)\*\*|`(.+?)`|\*(.+?)\*|\[(.+?)\]\((https?:\/\/[^\s)]+)\))/;
  while (rest) {
    const m = rest.match(pattern);
    if (!m) { nodes.push(rest); break; }
    if (m.index > 0) nodes.push(rest.slice(0, m.index));
    const tok = m[0];
    if (tok.startsWith('**')) nodes.push(<strong key={`${kp}-${k++}`}>{m[2]}</strong>);
    else if (tok.startsWith('`')) nodes.push(<code key={`${kp}-${k++}`} className="bg-gray-100 px-1 rounded text-[0.9em]">{m[3]}</code>);
    else if (tok.startsWith('*')) nodes.push(<em key={`${kp}-${k++}`}>{m[4]}</em>);
    else nodes.push(<a key={`${kp}-${k++}`} href={m[6]} target="_blank" rel="noopener noreferrer" className="text-blue-600 underline">{m[5]}</a>);
    rest = rest.slice(m.index + tok.length);
  }
  return nodes;
}

function MarkdownView({ text }) {
  if (!text || !text.trim()) return <p className="text-gray-400 text-sm italic">No content yet.</p>;
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const blocks = [];
  let i = 0;
  let key = 0;
  while (i < lines.length) {
    const t = lines[i].trim();
    if (!t) { i++; continue; }
    const h = t.match(/^(#{1,3})\s+(.*)$/);
    if (h) {
      const lvl = h[1].length;
      const cls = lvl === 1 ? 'text-lg font-bold text-gray-900 mt-3 mb-1' : lvl === 2 ? 'text-base font-semibold text-gray-900 mt-2 mb-1' : 'text-sm font-semibold text-gray-800 mt-2 mb-0.5';
      const Tag = `h${lvl + 2}`;
      blocks.push(<Tag key={key++} className={cls}>{renderInline(h[2], 'h' + key)}</Tag>);
      i++; continue;
    }
    if (/^[-*]\s+/.test(t)) {
      const items = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) { items.push(lines[i].trim().replace(/^[-*]\s+/, '')); i++; }
      blocks.push(<ul key={key++} className="list-disc pl-5 space-y-0.5 my-1 text-sm text-gray-700">{items.map((it, j) => <li key={j}>{renderInline(it, `ul${key}${j}`)}</li>)}</ul>);
      continue;
    }
    if (/^\d+\.\s+/.test(t)) {
      const items = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) { items.push(lines[i].trim().replace(/^\d+\.\s+/, '')); i++; }
      blocks.push(<ol key={key++} className="list-decimal pl-5 space-y-0.5 my-1 text-sm text-gray-700">{items.map((it, j) => <li key={j}>{renderInline(it, `ol${key}${j}`)}</li>)}</ol>);
      continue;
    }
    const para = [t];
    i++;
    while (i < lines.length && lines[i].trim() && !/^(#{1,3}\s|[-*]\s|\d+\.\s)/.test(lines[i].trim())) { para.push(lines[i].trim()); i++; }
    blocks.push(<p key={key++} className="text-sm text-gray-700 my-1 leading-relaxed">{renderInline(para.join(' '), 'p' + key)}</p>);
  }
  return <div>{blocks}</div>;
}

async function downloadDocPdf(id, filename) {
  const token = localStorage.getItem('auth_token');
  const res = await fetch(`/api/documents/${id}/pdf`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) return;
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

/* ───────── Editor ───────── */
function DocumentEditor({ docType, typeLabel, initial, onSave, onCancel }) {
  const [form, setForm] = useState(() => ({
    doc_number: initial?.doc_number || '',
    title: initial?.title || '',
    category: initial?.category || 'quality',
    revision: initial?.revision || '1.0',
    status: initial?.status || 'draft',
    owner: initial?.owner || '',
    effective_date: initial?.effective_date || '',
    review_due: initial?.review_due || '',
    content: initial?.description || '',
    _change_summary: '',
  }));
  const [preview, setPreview] = useState(false);
  const [saving, setSaving] = useState(false);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await onSave({ ...form, doc_type: docType });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/30 z-50 flex items-start justify-center p-4 overflow-y-auto" onClick={onCancel}>
      <form onClick={e => e.stopPropagation()} onSubmit={handleSubmit}
        className="bg-white rounded-xl shadow-xl w-full max-w-3xl my-6 p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-gray-900">{initial?.id ? `Edit ${typeLabel}` : `New ${typeLabel}`}</h3>
          <button type="button" onClick={onCancel} className="p-1 hover:bg-gray-100 rounded-lg"><X size={18} className="text-gray-500" /></button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Document #</label>
            <input value={form.doc_number} onChange={e => set('doc_number', e.target.value)} placeholder="e.g. WI-014"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
          </div>
          <div className="sm:col-span-1">
            <label className="block text-xs font-medium text-gray-700 mb-1">Revision</label>
            <input value={form.revision} onChange={e => set('revision', e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
          </div>
          <div className="sm:col-span-2">
            <label className="block text-xs font-medium text-gray-700 mb-1">Title *</label>
            <input required value={form.title} onChange={e => set('title', e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Category *</label>
            <select value={form.category} onChange={e => set('category', e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
              {CATEGORIES.map(c => <option key={c} value={c}>{cap(c)}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Status</label>
            <select value={form.status} onChange={e => set('status', e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
              {STATUSES.filter(s => s.value !== 'archived').map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Owner</label>
            <input value={form.owner} onChange={e => set('owner', e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Effective</label>
              <input type="date" value={form.effective_date || ''} onChange={e => set('effective_date', e.target.value)} className="w-full px-2 py-2 border border-gray-300 rounded-lg text-sm" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Review due</label>
              <input type="date" value={form.review_due || ''} onChange={e => set('review_due', e.target.value)} className="w-full px-2 py-2 border border-gray-300 rounded-lg text-sm" />
            </div>
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="block text-xs font-medium text-gray-700">Content</label>
            <button type="button" onClick={() => setPreview(p => !p)} className="text-xs font-medium text-blue-600 hover:underline flex items-center gap-1">
              <Eye size={12} /> {preview ? 'Edit' : 'Preview'}
            </button>
          </div>
          {preview ? (
            <div className="w-full min-h-[16rem] px-3 py-2 border border-gray-200 rounded-lg bg-gray-50 prose-sm">
              <MarkdownView text={form.content} />
            </div>
          ) : (
            <textarea value={form.content} onChange={e => set('content', e.target.value)} rows={14}
              placeholder={'# Purpose\nDescribe the purpose...\n\n## Procedure\n1. First step\n2. Second step\n\n- Bullet point\n- **Bold** and *italic* supported'}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm font-mono" />
          )}
          <p className="text-[11px] text-gray-400 mt-1">Markdown supported: <code># Heading</code>, <code>## Subheading</code>, <code>- bullet</code>, <code>1. numbered</code>, <code>**bold**</code>, <code>*italic*</code>, <code>[link](https://…)</code></p>
        </div>

        {initial?.id && (
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Change summary (for version history)</label>
            <input value={form._change_summary} onChange={e => set('_change_summary', e.target.value)} placeholder="e.g. Updated cleaning frequency" className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
          </div>
        )}

        <div className="flex items-center gap-2 pt-1">
          <button type="submit" disabled={saving} className="flex-1 px-4 py-2 bg-powder-600 text-white text-sm font-medium rounded-lg hover:bg-powder-700 disabled:opacity-50">
            {saving ? 'Saving…' : 'Save'}
          </button>
          <button type="button" onClick={onCancel} className="px-4 py-2 bg-gray-100 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-200">Cancel</button>
        </div>
      </form>
    </div>
  );
}

/* ───────── Read view ───────── */
function DocumentViewer({ doc, typeLabel, canEdit, onEdit, onArchive, onClose }) {
  const { data: versions } = useApiGet(`/documents/${doc.id}/versions`, [doc.id]);
  const [showVersions, setShowVersions] = useState(false);

  return (
    <div className="fixed inset-0 bg-black/30 z-50 flex items-start justify-center p-4 overflow-y-auto" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl my-6" onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between px-5 py-4 border-b border-gray-200">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              {doc.doc_number && <span className="text-xs font-mono font-bold text-gray-500">{doc.doc_number}</span>}
              <StatusBadge status={doc.status} />
              <span className="text-[11px] text-gray-400">Rev {doc.revision}</span>
            </div>
            <h3 className="font-semibold text-gray-900 mt-1">{doc.title}</h3>
            <p className="text-xs text-gray-500 mt-0.5">
              {cap(doc.category)}{doc.owner ? ` · Owner: ${doc.owner}` : ''}
              {doc.review_due ? ` · Review due ${doc.review_due}` : ''}
              {doc.approved_by ? ` · Approved by ${doc.approved_by}` : ''}
            </p>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded-lg shrink-0"><X size={18} className="text-gray-500" /></button>
        </div>

        <div className="px-5 py-4 max-h-[55vh] overflow-y-auto">
          <MarkdownView text={doc.description} />
        </div>

        <div className="flex items-center gap-2 px-5 py-3 border-t border-gray-200 flex-wrap">
          <button onClick={() => downloadDocPdf(doc.id, `${(doc.doc_number || typeLabel)}_${doc.title}`.replace(/[^a-zA-Z0-9_-]/g, '_') + '.pdf')}
            className="px-3 py-1.5 bg-gray-100 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-200 flex items-center gap-1.5">
            <Download size={14} /> PDF
          </button>
          <button onClick={() => setShowVersions(v => !v)}
            className="px-3 py-1.5 bg-gray-100 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-200 flex items-center gap-1.5">
            <History size={14} /> History ({versions?.length || 0})
          </button>
          <div className="flex-1" />
          {canEdit && (
            <>
              <button onClick={() => onArchive(doc)} className="px-3 py-1.5 text-red-600 text-sm font-medium rounded-lg hover:bg-red-50 flex items-center gap-1.5">
                <Archive size={14} /> Archive
              </button>
              <button onClick={() => onEdit(doc)} className="px-3 py-1.5 bg-powder-600 text-white text-sm font-medium rounded-lg hover:bg-powder-700 flex items-center gap-1.5">
                <Edit2 size={14} /> Edit
              </button>
            </>
          )}
        </div>

        {showVersions && (
          <div className="px-5 py-3 border-t border-gray-100 max-h-48 overflow-y-auto">
            {(versions || []).map(v => (
              <div key={v.id} className="flex items-center justify-between text-xs py-1.5 border-b border-gray-50 last:border-0">
                <span className="text-gray-700">Rev {v.revision} · {v.change_summary}</span>
                <span className="text-gray-400">{v.changed_by} · {new Date(v.created_at).toLocaleDateString()}</span>
              </div>
            ))}
            {(!versions || versions.length === 0) && <p className="text-xs text-gray-400">No version history.</p>}
          </div>
        )}
      </div>
    </div>
  );
}

/* ───────── Bulk import ───────── */
function BulkImportModal({ defaultDocType, onImported, onClose }) {
  const [step, setStep] = useState('select'); // select | extracting | review | saving
  const [rows, setRows] = useState([]);
  const [failed, setFailed] = useState([]);
  const [previewIdx, setPreviewIdx] = useState(null);
  const [error, setError] = useState(null);

  const handleFiles = async (fileList) => {
    const files = Array.from(fileList || []);
    if (files.length === 0) return;
    setStep('extracting');
    setError(null);
    try {
      const fd = new FormData();
      files.forEach(f => fd.append('files', f));
      const res = await apiUpload('/documents/extract', fd);
      const ok = (res.documents || []).filter(d => d.ok).map(d => ({
        include: true,
        doc_type: defaultDocType,
        category: 'quality',
        doc_number: d.doc_number || '',
        title: d.title || d.filename,
        content: d.content || '',
        pages: d.pages,
        filename: d.filename,
      }));
      setRows(ok);
      setFailed((res.documents || []).filter(d => !d.ok));
      setStep('review');
    } catch (err) {
      console.error('Extraction failed:', err);
      setError(err.message || 'Failed to read PDFs.');
      setStep('select');
    }
  };

  const setRow = (i, patch) => setRows(rs => rs.map((r, j) => j === i ? { ...r, ...patch } : r));
  const includedCount = rows.filter(r => r.include).length;

  const handleSave = async () => {
    setStep('saving');
    try {
      const documents = rows.filter(r => r.include && r.title).map(r => ({
        doc_type: r.doc_type, doc_number: r.doc_number, title: r.title,
        category: r.category, content: r.content, source_file: r.filename,
      }));
      const res = await apiPost('/documents/bulk', { documents });
      onImported(res.imported || 0);
    } catch (err) {
      console.error('Bulk save failed:', err);
      setError(err.message || 'Failed to save documents.');
      setStep('review');
    }
  };

  return (
    <div className="fixed inset-0 bg-black/30 z-50 flex items-start justify-center p-4 overflow-y-auto" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-4xl my-6" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200">
          <h3 className="font-semibold text-gray-900">Import documents from PDFs</h3>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded-lg"><X size={18} className="text-gray-500" /></button>
        </div>

        <div className="p-5">
          {error && <p className="text-sm text-red-600 mb-3">{error}</p>}

          {(step === 'select' || step === 'extracting') && (
            <label className={`flex flex-col items-center justify-center gap-2 border-2 border-dashed border-gray-300 rounded-xl py-12 cursor-pointer hover:bg-gray-50 ${step === 'extracting' ? 'opacity-60 pointer-events-none' : ''}`}>
              <Upload size={28} className="text-gray-400" />
              <span className="text-sm text-gray-600 font-medium">{step === 'extracting' ? 'Reading PDFs…' : 'Choose PDF files (you can select many at once)'}</span>
              <span className="text-xs text-gray-400">Text is extracted into editable draft documents — you confirm the details next.</span>
              <input type="file" accept="application/pdf,.pdf" multiple className="hidden"
                onChange={e => handleFiles(e.target.files)} />
            </label>
          )}

          {step === 'review' && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-sm text-gray-600">{includedCount} of {rows.length} document{rows.length === 1 ? '' : 's'} selected to import.</p>
              </div>
              {failed.length > 0 && (
                <p className="text-xs text-amber-600">{failed.length} file(s) couldn't be read and were skipped: {failed.map(f => f.filename).join(', ')}</p>
              )}
              <div className="border border-gray-200 rounded-lg overflow-hidden">
                <div className="overflow-x-auto max-h-[50vh] overflow-y-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 border-b border-gray-200 sticky top-0">
                      <tr>
                        <th className="px-2 py-2 w-8"></th>
                        <th className="text-left px-2 py-2 text-xs font-medium text-gray-500">Type</th>
                        <th className="text-left px-2 py-2 text-xs font-medium text-gray-500 whitespace-nowrap">Doc #</th>
                        <th className="text-left px-2 py-2 text-xs font-medium text-gray-500">Title</th>
                        <th className="text-left px-2 py-2 text-xs font-medium text-gray-500">Category</th>
                        <th className="px-2 py-2 text-xs font-medium text-gray-500 whitespace-nowrap">Pages</th>
                        <th className="px-2 py-2"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {rows.map((r, i) => (
                        <Fragment key={i}>
                          <tr className={r.include ? '' : 'opacity-40'}>
                            <td className="px-2 py-1.5 text-center">
                              <input type="checkbox" checked={r.include} onChange={e => setRow(i, { include: e.target.checked })} className="rounded border-gray-300" />
                            </td>
                            <td className="px-2 py-1.5">
                              <select value={r.doc_type} onChange={e => setRow(i, { doc_type: e.target.value })} className="px-1.5 py-1 border border-gray-200 rounded text-xs">
                                {DOC_TYPE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                              </select>
                            </td>
                            <td className="px-2 py-1.5">
                              <input value={r.doc_number} onChange={e => setRow(i, { doc_number: e.target.value })} className="w-24 px-1.5 py-1 border border-gray-200 rounded text-xs" />
                            </td>
                            <td className="px-2 py-1.5">
                              <input value={r.title} onChange={e => setRow(i, { title: e.target.value })} className="w-full min-w-[180px] px-1.5 py-1 border border-gray-200 rounded text-xs" />
                            </td>
                            <td className="px-2 py-1.5">
                              <select value={r.category} onChange={e => setRow(i, { category: e.target.value })} className="px-1.5 py-1 border border-gray-200 rounded text-xs">
                                {CATEGORIES.map(c => <option key={c} value={c}>{cap(c)}</option>)}
                              </select>
                            </td>
                            <td className="px-2 py-1.5 text-center text-xs text-gray-500">{r.pages}</td>
                            <td className="px-2 py-1.5">
                              <button onClick={() => setPreviewIdx(previewIdx === i ? null : i)} className="text-xs text-blue-600 hover:underline">
                                {previewIdx === i ? 'Hide' : 'Preview'}
                              </button>
                            </td>
                          </tr>
                          {previewIdx === i && (
                            <tr>
                              <td colSpan={7} className="px-3 py-2 bg-gray-50">
                                <textarea value={r.content} onChange={e => setRow(i, { content: e.target.value })} rows={8}
                                  className="w-full px-2 py-1 border border-gray-200 rounded text-xs font-mono" />
                                <p className="text-[10px] text-gray-400 mt-1">Extracted text — clean up here or after import. Original file: {r.filename}</p>
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {step === 'saving' && <div className="text-center py-12 text-gray-500">Saving {includedCount} documents…</div>}
        </div>

        {step === 'review' && (
          <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-gray-200">
            <button onClick={onClose} className="px-4 py-2 bg-gray-100 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-200">Cancel</button>
            <button onClick={handleSave} disabled={includedCount === 0} className="px-4 py-2 bg-powder-600 text-white text-sm font-medium rounded-lg hover:bg-powder-700 disabled:opacity-50">
              Import {includedCount} as drafts
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/* ───────── Registry ───────── */
export default function DocumentRegistry({ docType, moduleId, title, typeLabel }) {
  const { user } = useAuth() || {};
  const canEdit = canEditModule(user, moduleId);
  const [sortField, setSortField] = useState('doc_number');
  const [sortOrder, setSortOrder] = useState('asc');
  const [search, setSearch] = useState('');
  const [catFilter, setCatFilter] = useState('');
  const { data: docs, loading, refresh } = useApiGet(
    `/documents?doc_type=${docType}&sort=${sortField}&order=${sortOrder}${catFilter ? `&category=${catFilter}` : ''}`,
    [docType, sortField, sortOrder, catFilter]
  );
  const [editing, setEditing] = useState(null);
  const [creating, setCreating] = useState(false);
  const [viewing, setViewing] = useState(null);
  const [importing, setImporting] = useState(false);
  const [importMsg, setImportMsg] = useState(null);

  const q = search.toLowerCase().trim();
  const filtered = (docs || []).filter(d => !q || [d.title, d.doc_number, d.owner].some(v => v && v.toLowerCase().includes(q)));

  const handleSort = (field) => {
    if (sortField === field) setSortOrder(o => o === 'asc' ? 'desc' : 'asc');
    else { setSortField(field); setSortOrder('asc'); }
  };

  const handleCreate = async (form) => {
    await apiPost('/documents', form);
    setCreating(false);
    refresh();
  };
  const handleUpdate = async (form) => {
    await apiPut(`/documents/${editing.id}`, form);
    setEditing(null);
    setViewing(null);
    refresh();
  };
  const handleArchive = async (doc) => {
    await apiFetch(`/documents/${doc.id}`, { method: 'DELETE' });
    setViewing(null);
    refresh();
  };

  const sh = { sortField, sortOrder, onSort: handleSort };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="text-xl font-bold text-gray-900">{title}</h2>
          <p className="text-sm text-gray-500">{filtered.length} document{filtered.length === 1 ? '' : 's'}</p>
        </div>
        {canEdit && (
          <div className="flex items-center gap-2">
            <button onClick={() => setImporting(true)} className="flex items-center gap-1.5 px-3 py-2 bg-gray-100 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-200">
              <Upload size={15} /> Import PDFs
            </button>
            <button onClick={() => setCreating(true)} className="flex items-center gap-1.5 px-4 py-2 bg-powder-600 text-white text-sm font-medium rounded-lg hover:bg-powder-700">
              <Plus size={16} /> New {typeLabel}
            </button>
          </div>
        )}
      </div>

      {importMsg && (
        <div className="bg-green-50 border border-green-200 text-green-800 text-sm rounded-lg px-4 py-2">{importMsg}</div>
      )}

      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder={`Search ${typeLabel.toLowerCase()}s…`}
            className="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-powder-500" />
        </div>
        <select value={catFilter} onChange={e => setCatFilter(e.target.value)} className="px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white">
          <option value="">All categories</option>
          {CATEGORIES.map(c => <option key={c} value={c}>{cap(c)}</option>)}
        </select>
      </div>

      {loading ? (
        <div className="text-center py-12 text-gray-500">Loading…</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 text-gray-400">
          <FileText size={36} className="mx-auto mb-2 text-gray-300" />
          <p className="text-sm">No {typeLabel.toLowerCase()}s yet.{canEdit ? ` Click "New ${typeLabel}" to add one.` : ''}</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <SortHeader label="Doc #" field="doc_number" className="whitespace-nowrap" {...sh} />
                  <SortHeader label="Title" field="title" {...sh} />
                  <SortHeader label="Category" field="category" className="whitespace-nowrap" {...sh} />
                  <SortHeader label="Rev" field="revision" className="whitespace-nowrap" {...sh} />
                  <SortHeader label="Status" field="status" className="whitespace-nowrap" {...sh} />
                  <SortHeader label="Owner" field="owner" className="whitespace-nowrap" {...sh} />
                  <SortHeader label="Review Due" field="review_due" className="whitespace-nowrap" {...sh} />
                  <th className="px-3 py-2.5" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filtered.map(d => (
                  <tr key={d.id} onClick={() => setViewing(d)} className="hover:bg-gray-50 cursor-pointer">
                    <td className="px-3 py-2.5 font-mono text-xs font-bold text-gray-700 whitespace-nowrap">{d.doc_number || '—'}</td>
                    <td className="px-3 py-2.5 text-gray-900 font-medium w-full">{d.title}</td>
                    <td className="px-3 py-2.5 text-gray-600 whitespace-nowrap">{cap(d.category)}</td>
                    <td className="px-3 py-2.5 text-gray-600 whitespace-nowrap">{d.revision}</td>
                    <td className="px-3 py-2.5 whitespace-nowrap"><StatusBadge status={d.status} /></td>
                    <td className="px-3 py-2.5 text-gray-600 whitespace-nowrap">{d.owner || '—'}</td>
                    <td className="px-3 py-2.5 text-gray-600 whitespace-nowrap">{d.review_due || '—'}</td>
                    <td className="px-3 py-2.5 whitespace-nowrap text-right" onClick={e => e.stopPropagation()}>
                      <button onClick={() => downloadDocPdf(d.id, `${(d.doc_number || typeLabel)}_${d.title}`.replace(/[^a-zA-Z0-9_-]/g, '_') + '.pdf')}
                        className="p-1 text-gray-400 hover:text-gray-700" title="Download PDF"><Download size={14} /></button>
                      {canEdit && (
                        <button onClick={() => setEditing(d)} className="p-1 text-gray-400 hover:text-powder-600" title="Edit"><Edit2 size={14} /></button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {creating && (
        <DocumentEditor docType={docType} typeLabel={typeLabel} onSave={handleCreate} onCancel={() => setCreating(false)} />
      )}
      {editing && (
        <DocumentEditor docType={docType} typeLabel={typeLabel} initial={editing} onSave={handleUpdate} onCancel={() => setEditing(null)} />
      )}
      {viewing && !editing && (
        <DocumentViewer doc={viewing} typeLabel={typeLabel} canEdit={canEdit}
          onEdit={(d) => { setViewing(null); setEditing(d); }}
          onArchive={handleArchive}
          onClose={() => setViewing(null)} />
      )}
      {importing && (
        <BulkImportModal
          defaultDocType={docType}
          onClose={() => setImporting(false)}
          onImported={(count) => {
            setImporting(false);
            setImportMsg(`Imported ${count} document${count === 1 ? '' : 's'} as drafts. Review and finalize them in the list.`);
            setTimeout(() => setImportMsg(null), 6000);
            refresh();
          }}
        />
      )}
    </div>
  );
}
