import { useState } from 'react';
import { apiUpload, apiPost } from '../../hooks/useApi';
import { Upload, X, CheckCircle2, AlertTriangle, Loader2, FileText } from 'lucide-react';

// Bringing existing controlled documents up to date from the finalised paper.
//
// Document Control's job right now is not creating documents — it is updating
// roughly a hundred of them. So this reads each upload, works out which
// document on file it is, and PROPOSES the changes.
//
// Nothing is applied until it is ticked. A scanner confidently overwriting a
// controlled document is precisely the failure Document Control exists to
// prevent, so the default for every field is "don't change it".

function FileResult({ file, onApplied }) {
  const [picked, setPicked] = useState(() => new Set(file.changes.map(c => c.field)));
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');

  const toggle = (f) => {
    const next = new Set(picked);
    if (next.has(f)) next.delete(f); else next.add(f);
    setPicked(next);
  };

  const apply = async () => {
    setBusy(true); setError('');
    try {
      const fields = {};
      for (const c of file.changes) {
        if (!picked.has(c.field)) continue;
        fields[c.field] = c.field === 'description' ? c.content : c.to;
      }
      await apiPost(`/documents/${file.document.id}/apply-revision`, { fields, filename: file.filename });
      setDone(true);
      onApplied?.();
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };

  if (!file.ok) {
    return (
      <div className="border border-red-200 bg-red-50 rounded-lg p-3">
        <p className="text-sm font-medium text-red-900 flex items-center gap-1.5"><AlertTriangle size={14} /> {file.filename}</p>
        <p className="text-xs text-red-700 mt-0.5">{file.error}</p>
      </div>
    );
  }

  if (!file.document) {
    return (
      <div className="border border-amber-200 bg-amber-50 rounded-lg p-3">
        <p className="text-sm font-medium text-amber-900 flex items-center gap-1.5"><AlertTriangle size={14} /> {file.filename}</p>
        <p className="text-xs text-amber-800 mt-0.5">
          No document on file matches this. Read as
          <span className="font-medium"> {file.extracted.doc_number || 'no document number'} · {file.extracted.title || 'no title'}</span>.
          Add it as a new document from the Import tab, or rename the file to include its document number.
        </p>
      </div>
    );
  }

  return (
    <div className="border border-gray-200 rounded-lg p-3 space-y-2">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-gray-900 truncate">
            {file.document.doc_number ? `${file.document.doc_number} — ` : ''}{file.document.title}
          </p>
          <p className="text-[11px] text-gray-500">
            {file.filename} · matched on {file.matched_on} · currently Rev {file.document.revision || '—'}
          </p>
        </div>
        {done
          ? <span className="text-xs font-medium text-green-700 flex items-center gap-1 shrink-0"><CheckCircle2 size={14} /> Applied</span>
          : file.changes.length > 0 && (
            <button onClick={apply} disabled={busy || picked.size === 0}
              className="px-3 py-1.5 bg-powder-600 text-white text-xs font-medium rounded-lg hover:bg-powder-700 disabled:opacity-50 shrink-0">
              {busy ? <Loader2 size={13} className="animate-spin" /> : `Apply ${picked.size}`}
            </button>
          )}
      </div>

      {file.changes.length === 0 ? (
        <p className="text-xs text-gray-500">Nothing to change — what's on file already matches this upload.</p>
      ) : (
        <ul className="space-y-1.5">
          {file.changes.map(c => (
            <li key={c.field} className="flex items-start gap-2 text-xs">
              <input type="checkbox" checked={picked.has(c.field)} onChange={() => toggle(c.field)} disabled={done} className="mt-0.5" />
              <span className="min-w-0">
                <span className="font-medium text-gray-800">{c.label}</span>
                <span className="block text-gray-500 break-words">
                  <span className="line-through">{c.from || 'empty'}</span>
                  <span className="mx-1">→</span>
                  <span className="text-gray-900 font-medium">{c.to}</span>
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}

export default function RevisionUploadModal({ onClose, onDone }) {
  const [files, setFiles] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const choose = async (e) => {
    const list = [...(e.target.files || [])];
    if (!list.length) return;
    setBusy(true); setError('');
    try {
      const fd = new FormData();
      for (const f of list) fd.append('files', f);
      const out = await apiUpload('/documents/propose-revisions', fd);
      setFiles(out.files || []);
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  };

  const matched = (files || []).filter(f => f.ok && f.document).length;
  const unmatched = (files || []).filter(f => f.ok && !f.document).length;

  return (
    <div className="fixed inset-0 bg-black/30 z-50 flex items-start justify-center p-4 overflow-y-auto" onClick={onClose}>
      <div onClick={e => e.stopPropagation()} className="bg-white rounded-xl shadow-xl w-full max-w-3xl my-8">
        <div className="flex items-start justify-between gap-3 p-5 border-b border-gray-100">
          <div>
            <h3 className="font-semibold text-gray-900">Upload the latest version of documents already on file</h3>
            <p className="text-xs text-gray-500 mt-0.5 max-w-xl">
              Each file is read, matched to the document it belongs to, and the changes are proposed. Nothing is
              applied until you tick it — and the previous revision is kept in the document's history.
            </p>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded-lg"><X size={18} className="text-gray-500" /></button>
        </div>

        <div className="p-5 space-y-3">
          {error && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg p-3">{error}</p>}

          {!files && (
            <label className="flex flex-col items-center gap-2 border-2 border-dashed border-gray-300 rounded-xl py-10 cursor-pointer hover:bg-gray-50">
              <Upload size={22} className="text-gray-400" />
              <span className="text-sm text-gray-600 font-medium">{busy ? 'Reading…' : 'Choose the finalised documents'}</span>
              <span className="text-xs text-gray-400">PDF, Word or Markdown · up to 100 at a time</span>
              <input type="file" multiple accept=".pdf,.docx,.doc,.md,.txt" className="hidden" onChange={choose} disabled={busy} />
            </label>
          )}

          {files && (
            <>
              <p className="text-xs text-gray-600">
                <span className="font-semibold">{matched}</span> matched to a document on file
                {unmatched > 0 && <> · <span className="font-semibold text-amber-700">{unmatched}</span> couldn't be matched</>}
              </p>
              <div className="space-y-2 max-h-[55vh] overflow-y-auto">
                {files.map((f, i) => <FileResult key={i} file={f} onApplied={onDone} />)}
              </div>
              <button onClick={() => setFiles(null)} className="text-xs text-powder-600 hover:underline flex items-center gap-1">
                <FileText size={13} /> Upload another batch
              </button>
            </>
          )}
        </div>

        <div className="flex justify-end p-5 pt-0">
          <button onClick={onClose} className="px-4 py-2 bg-gray-100 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-200">Close</button>
        </div>
      </div>
    </div>
  );
}
