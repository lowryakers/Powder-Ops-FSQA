import { useState } from 'react';
import { useApiGet, apiUpload, apiDelete } from '../../hooks/useApi';
import { FileText, Upload, Trash2, AlertTriangle, Camera, Share2 } from 'lucide-react';
import { formatDateTime } from '../../lib/datetime.js';
import { shareFile, canNativeShare } from '../../lib/shareFile.js';

/**
 * Evidence attached to a quality event.
 *
 * A deviation or non-conformance is half photographs — the damaged pallet, the
 * wrong label, the lab slip, the supplier's email. Those lived in somebody's
 * phone while the record only described them, which is exactly what an auditor
 * asking "show me" cannot be given.
 *
 * Same shape as the equipment manuals: the text is pulled out on upload so a
 * search finds a lot number printed INSIDE the PDF, and the text never leaves
 * the server — only whether reading it worked.
 *
 * Two rules the server enforces and this reflects:
 *   · Attaching follows the same permission as amending. A signed record is
 *     closed; adding evidence afterwards would change what the signature
 *     covered. The panel says so instead of offering a button that 403s.
 *   · A file that won't OCR is still a file. `text_status` is shown rather than
 *     letting someone assume a search covered it.
 */
const isImage = (f) => /^image\//i.test(f.content_type || '');

export default function RecordAttachments({ recordType, recordId, canEdit, blockReason }) {
  const { data, loading, refresh } = useApiGet(`/qms/${recordType}/${recordId}/attachments`, [recordType, recordId]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const files = data || [];

  const upload = async (e) => {
    const list = Array.from(e.target.files || []);
    e.target.value = '';
    if (!list.length) return;
    setBusy(true); setError('');
    try {
      const fd = new FormData();
      for (const f of list) fd.append('files', f);
      await apiUpload(`/qms/${recordType}/${recordId}/attachments`, fd);
      refresh();
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  };

  const remove = async (f) => {
    if (!window.confirm(`Remove ${f.filename} from this record?`)) return;
    setBusy(true); setError('');
    try {
      await apiDelete(`/qms/${recordType}/${recordId}/attachments/${f.id}`);
      refresh();
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  };

  return (
    <div className="border-t border-gray-200 pt-3">
      <div className="flex items-center gap-2 flex-wrap mb-2">
        <h4 className="text-sm font-semibold text-gray-900">Evidence &amp; attachments</h4>
        <span className="text-[11px] text-gray-400">{files.length || 'none'}</span>
        <div className="flex-1" />
        {canEdit && (
          <>
            {/* On a phone this opens the camera, which is where the photo of
                the pallet is actually taken. Kept as a SEPARATE input from the
                file picker — `capture` on the picker forces the camera on iOS
                and blocks choosing a file you already have. */}
            <label className={`inline-flex items-center gap-1 text-xs text-powder-600 hover:text-powder-700 cursor-pointer ${busy ? 'opacity-50 pointer-events-none' : ''}`}>
              <Camera size={13} /> Photo
              <input type="file" className="hidden" accept="image/*" capture="environment" onChange={upload} />
            </label>
            <label className={`inline-flex items-center gap-1 text-xs text-powder-600 hover:text-powder-700 cursor-pointer ${busy ? 'opacity-50 pointer-events-none' : ''}`}>
              <Upload size={13} /> Attach files
              <input type="file" multiple className="hidden" onChange={upload} />
            </label>
          </>
        )}
      </div>

      {!canEdit && blockReason && (
        <p className="text-[11px] text-gray-500 flex items-start gap-1.5 mb-2">
          <AlertTriangle size={12} className="mt-0.5 shrink-0 text-amber-500" />
          <span>{blockReason}</span>
        </p>
      )}
      {error && <p className="text-xs text-red-600 mb-2">{error}</p>}
      {loading && <p className="text-xs text-gray-400">Loading…</p>}

      {files.length === 0 && !loading ? (
        <p className="text-xs text-gray-400">
          Nothing attached. Photos, lab slips, supplier emails and scanned forms belong here — they are what an auditor asks to see.
        </p>
      ) : (
        <div className="space-y-1.5">
          {files.map(f => (
            <div key={f.id} className="flex items-center gap-2 rounded-lg border border-gray-200 px-2.5 py-1.5">
              {isImage(f) && f.url ? (
                <a href={f.url} target="_blank" rel="noopener noreferrer" className="shrink-0">
                  <img src={f.url} alt={f.filename} className="h-10 w-10 rounded object-cover border border-gray-200" />
                </a>
              ) : (
                <FileText size={14} className="text-gray-400 shrink-0" />
              )}
              <div className="min-w-0 flex-1">
                <a href={f.url} target="_blank" rel="noopener noreferrer"
                  className="block text-xs font-medium text-powder-700 hover:underline truncate">{f.filename}</a>
                <p className="text-[11px] text-gray-500">
                  {f.uploaded_by || 'unknown'} · {formatDateTime(f.created_at)}
                  {f.text_status === 'failed' && ' · text could not be read, so a search will not cover it'}
                  {f.text_status === 'empty' && ' · no text in this file (an image), so a search will not cover it'}
                </p>
              </div>
              {canNativeShare() && (
                <button onClick={() => shareFile(f)} className="text-gray-400 hover:text-gray-600" title="Share">
                  <Share2 size={13} />
                </button>
              )}
              {canEdit && (
                <button onClick={() => remove(f)} disabled={busy} className="text-gray-400 hover:text-red-500" title="Remove">
                  <Trash2 size={13} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
