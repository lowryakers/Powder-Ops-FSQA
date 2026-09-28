import { useState } from 'react';
import { apiPost, apiUpload } from '../../hooks/useApi';
import { Upload, X, CheckCircle2, AlertTriangle, Loader2, FileCheck2 } from 'lucide-react';

// Filing the signed, scanned originals against the documents they belong to.
//
// The revision upload takes the Word original and moves the revision, the
// effective date and the body. This takes the SIGNED SCAN and files it as the
// evidence — one pass over a hundred of them instead of one document at a time.
//
// THE PLAN COSTS NOTHING. Only the filenames are sent to work out what would
// happen; the files themselves move only after that has been read and
// confirmed. A hundred scans is hundreds of megabytes and nobody should move
// them to find out that half are misnamed.

// Uploads go up in small batches so the progress bar means something and no
// single request carries the whole job.
const CHUNK = 8;

function Row({ item }) {
  if (item.state === 'unmatched') {
    return (
      <li data-signed-row data-signed-state="unmatched" className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2">
        <p className="text-sm font-medium text-rose-900 flex items-center gap-1.5">
          <AlertTriangle size={14} /> {item.filename}
        </p>
        <p className="text-xs text-rose-700 mt-0.5">
          {item.reason} Rename the file with its document number and run this again, or attach it on the
          document itself.
        </p>
      </li>
    );
  }
  const muted = item.state === 'already_attached';
  return (
    <li data-signed-row data-signed-state={item.state} className={`rounded-lg border px-3 py-2 ${muted ? 'border-gray-200 bg-gray-50' : 'border-gray-200 bg-white'}`}>
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span className={`text-sm font-semibold ${muted ? 'text-gray-500' : 'text-gray-900'}`}>
          {item.doc_number ? `${item.doc_number} — ` : ''}{item.title}
        </span>
        {item.revision && <span className="text-[11px] text-gray-500">signed copy of V{item.revision}</span>}
        {!item.replaces_none && !muted && (
          <span className="text-[11px] text-amber-700">adds to a signed copy already on file</span>
        )}
        <span className="ml-auto font-mono text-[11px] text-gray-400 truncate max-w-[16rem]">{item.filename}</span>
      </div>
      <p className="text-[11px] text-gray-500 mt-0.5">
        {muted ? item.reason : `matched on ${item.matched_on}`}
      </p>
    </li>
  );
}

export default function SignedCopyBulkModal({ onClose, onDone }) {
  const [files, setFiles] = useState([]);
  const [plan, setPlan] = useState(null);
  const [busy, setBusy] = useState(false);
  const [pct, setPct] = useState(0);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');

  const choose = async (e) => {
    // Read the FileList BEFORE anything clears the input — the picker empties it
    // and a deferred read finds nothing.
    const list = [...(e.target.files || [])];
    e.target.value = '';
    if (!list.length) return;
    setBusy(true); setError(''); setResult(null);
    try {
      const p = await apiPost('/documents/attachments/plan', { filenames: list.map(f => f.name) });
      setFiles(list);
      setPlan(p);
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  };

  const commit = async () => {
    const keep = new Set(plan.items.filter(i => i.state === 'match').map(i => i.filename));
    const send = files.filter(f => keep.has(f.name.trim()));
    if (!send.length) return;
    setBusy(true); setError(''); setPct(0);
    const attached = [];
    // THE FILES THAT MATCHED NOTHING ARE CARRIED INTO THE RESULT. They are
    // deliberately never uploaded, so the server never sees them and cannot
    // report them — and the result screen read "1 filed" with no mention of the
    // scan that belongs to nothing. A file silently dropped between the plan
    // and the result is one nobody goes back for. Found in the browser check.
    const skipped = plan.items
      .filter(i => i.state !== 'match')
      .map(i => ({ filename: i.filename, reason: i.reason }));
    let missing = null;
    try {
      for (let i = 0; i < send.length; i += CHUNK) {
        const batch = send.slice(i, i + CHUNK);
        const fd = new FormData();
        for (const f of batch) fd.append('files', f);
        const out = await apiUpload('/documents/attachments/bulk', fd, 'POST',
          (p) => setPct(Math.round(((i + (p / 100) * batch.length) / send.length) * 100)));
        attached.push(...(out.attached || []));
        skipped.push(...(out.skipped || []));
        missing = out.documents_without_signed_copy ?? missing;
        setPct(Math.round(((i + batch.length) / send.length) * 100));
      }
      setResult({ attached, skipped, documents_without_signed_copy: missing });
      setPlan(null); setFiles([]);
      onDone?.();
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/30 z-50 flex items-start justify-center p-4 overflow-y-auto" onClick={onClose}>
      <div data-signed-modal onClick={e => e.stopPropagation()} className="bg-white rounded-xl shadow-xl w-full max-w-3xl my-8">
        <div className="flex items-start justify-between gap-3 p-5 border-b border-gray-100">
          <div>
            <h3 className="font-semibold text-gray-900">Attach the signed copies</h3>
            <p className="text-xs text-gray-500 mt-0.5 max-w-xl">
              Each scan is matched to its document by the number in the filename and filed as the signed
              original. Nothing is uploaded until you have read what it matched — and nothing is attached
              to a document the filename does not name.
            </p>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded-lg"><X size={18} className="text-gray-500" /></button>
        </div>

        <div className="p-5 space-y-3">
          {error && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg p-3">{error}</p>}

          {!plan && !result && (
            <label className="flex flex-col items-center gap-2 border-2 border-dashed border-gray-300 rounded-xl py-10 cursor-pointer hover:bg-gray-50">
              <Upload size={22} className="text-gray-400" />
              <span className="text-sm text-gray-600 font-medium">{busy ? 'Matching…' : 'Choose the signed scans'}</span>
              <span className="text-xs text-gray-400">Named with their document numbers · nothing is uploaded yet</span>
              <input data-signed-input type="file" multiple accept=".pdf,.png,.jpg,.jpeg,.tif,.tiff" className="hidden" onChange={choose} disabled={busy} />
            </label>
          )}

          {plan && (
            <>
              <p className="text-xs text-gray-600">
                <span className="font-semibold">{plan.will_attach}</span> will be attached
                {plan.already_attached > 0 && <> · <span className="font-semibold">{plan.already_attached}</span> already on file</>}
                {plan.unmatched > 0 && <> · <span className="font-semibold text-rose-700">{plan.unmatched}</span> matched no document</>}
              </p>
              <ul className="space-y-1.5 max-h-[50vh] overflow-y-auto">
                {plan.items.map((it, i) => <Row key={i} item={it} />)}
              </ul>
              {busy && (
                <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                  <div className="h-full bg-powder-600 transition-all" style={{ width: `${pct}%` }} />
                </div>
              )}
              <div className="flex items-center gap-2">
                <button data-signed-commit onClick={commit} disabled={busy || plan.will_attach === 0}
                  className="px-4 py-2 bg-powder-600 text-white text-sm font-medium rounded-lg hover:bg-powder-700 disabled:opacity-50 flex items-center gap-1.5">
                  {busy ? <Loader2 size={14} className="animate-spin" /> : <FileCheck2 size={14} />}
                  Attach {plan.will_attach} signed cop{plan.will_attach === 1 ? 'y' : 'ies'}
                </button>
                <button onClick={() => { setPlan(null); setFiles([]); }} disabled={busy}
                  className="text-xs text-gray-500 hover:underline">Choose different files</button>
              </div>
              <p className="text-[11px] text-gray-500">
                Removing a signed original afterwards takes an admin, so the match is worth reading.
              </p>
            </>
          )}

          {result && (
            <>
              <p className="text-sm text-green-800 bg-green-50 border border-green-200 rounded-lg px-3 py-2 flex items-center gap-1.5">
                <CheckCircle2 size={15} /> <span data-signed-done>{result.attached.length}</span> signed cop{result.attached.length === 1 ? 'y' : 'ies'} filed.
              </p>
              {result.skipped.length > 0 && (
                <ul className="space-y-1">
                  {result.skipped.map((s, i) => (
                    <li key={i} className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded px-2 py-1.5">
                      <span className="font-medium">{s.filename}</span> — {s.reason}
                    </li>
                  ))}
                </ul>
              )}
              {result.documents_without_signed_copy != null && (
                <p className="text-xs text-gray-600">
                  {result.documents_without_signed_copy === 0
                    ? 'Every document in the registry now has a signed copy on file.'
                    : `${result.documents_without_signed_copy} document${result.documents_without_signed_copy === 1 ? '' : 's'} in the registry still have no signed copy on file.`}
                </p>
              )}
              <button onClick={() => setResult(null)} className="text-xs text-powder-600 hover:underline">Attach another batch</button>
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
