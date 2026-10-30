import { useState } from 'react';
import { Printer } from 'lucide-react';
import { downloadFile } from '../../lib/downloadFile';

// Print one record from the record interface, every signature with its name,
// time and meaning in words (D-293).
export default function PrintRecordButton({ type, id, className = '' }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const go = async (e) => {
    e?.stopPropagation?.();
    setBusy(true); setErr('');
    try { await downloadFile(`/records/${type}/${id}/pdf`, `record-${type}-${id}.pdf`); }
    catch (x) { setErr(x.message || 'Could not print'); }
    finally { setBusy(false); }
  };
  return (
    <span className={`inline-flex items-center gap-1 ${className}`}>
      <button type="button" onClick={go} disabled={busy} data-print-record={`${type}:${id}`}
        className="inline-flex items-center gap-1 px-2 py-1 text-xs border border-gray-200 rounded-md hover:bg-gray-50 disabled:opacity-50">
        <Printer size={12} /> {busy ? 'Preparing…' : 'Print'}
      </button>
      {err && <span className="text-[11px] text-red-600">{err}</span>}
    </span>
  );
}
