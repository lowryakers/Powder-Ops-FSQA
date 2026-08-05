import { useState } from 'react';
import { apiUpload, apiPost } from '../../hooks/useApi';
import { Upload, ArrowRight, CheckCircle, AlertTriangle, RotateCcw, FileSpreadsheet } from 'lucide-react';

// Import a log from a spreadsheet — Monday, Airtable, Drive, Slack or desktop,
// they all export CSV/XLSX. Four steps on purpose: nobody should be able to
// bulk-write a compliance log without seeing exactly what will happen first.
//
//   1 pick the file   2 confirm the column mapping
//   3 read the dry run   4 commit
//
// Re-importing the same export is safe: rows match on a natural key and update
// in place rather than duplicating.

const STEPS = ['File', 'Columns', 'Preview', 'Done'];

export default function ImportPanel({ target, targetLabel, fields, onDone }) {
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [analysis, setAnalysis] = useState(null);
  const [mapping, setMapping] = useState({});
  const [preview, setPreview] = useState(null);
  const [result, setResult] = useState(null);

  const reset = () => {
    setStep(0); setAnalysis(null); setMapping({}); setPreview(null); setResult(null); setError(null);
  };

  const onFile = async (file) => {
    if (!file) return;
    setBusy(true); setError(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('target', target);
      const a = await apiUpload('/imports/analyze', fd);
      setAnalysis(a);
      setMapping(a.suggested_mapping || {});
      setStep(1);
    } catch (e) { setError(e.message || 'Could not read that file.'); }
    finally { setBusy(false); }
  };

  const runPreview = async () => {
    setBusy(true); setError(null);
    try {
      setPreview(await apiPost(`/imports/${analysis.batch_id}/preview`, { mapping }));
      setStep(2);
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };

  const commit = async () => {
    setBusy(true); setError(null);
    try {
      setResult(await apiPost(`/imports/${analysis.batch_id}/commit`, { mapping }));
      setStep(3);
      onDone?.();
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };

  const mappedCount = Object.values(mapping).filter(Boolean).length;
  const requiredMissing = (fields || []).filter(f => f.required && !mapping[f.key]);

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-4">
      <div>
        <h3 className="font-semibold text-gray-900 flex items-center gap-2">
          <Upload size={16} /> Import into {targetLabel}
        </h3>
        <p className="text-xs text-gray-500 mt-0.5">
          A CSV or Excel export from Monday, Airtable, Google Drive, Slack or your desktop. Nothing is written
          until you approve the preview, and re-importing the same file updates rows instead of duplicating them.
        </p>
      </div>

      {/* Step rail */}
      <div className="flex items-center gap-2 text-xs">
        {STEPS.map((s, i) => (
          <div key={s} className="flex items-center gap-2">
            <span className={`px-2 py-0.5 rounded-full font-medium ${i === step ? 'bg-powder-100 text-powder-800' : i < step ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-400'}`}>
              {i + 1}. {s}
            </span>
            {i < STEPS.length - 1 && <ArrowRight size={12} className="text-gray-300" />}
          </div>
        ))}
      </div>

      {error && (
        <div className="px-3 py-2 rounded-lg text-sm bg-red-50 text-red-800 flex items-start gap-2">
          <AlertTriangle size={15} className="mt-0.5 shrink-0" /> {error}
        </div>
      )}

      {/* 1 — file */}
      {step === 0 && (
        <label className="block border-2 border-dashed border-gray-300 rounded-xl p-8 text-center cursor-pointer hover:border-powder-400 hover:bg-powder-50/40">
          <FileSpreadsheet size={26} className="mx-auto text-gray-400" />
          <p className="mt-2 text-sm font-medium text-gray-700">Choose a CSV or Excel file</p>
          <p className="text-xs text-gray-500">.csv, .tsv or .xlsx — up to 25 MB</p>
          <input type="file" accept=".csv,.tsv,.xlsx,text/csv" className="hidden"
            onChange={e => onFile(e.target.files?.[0])} disabled={busy} />
          {busy && <p className="mt-2 text-xs text-gray-500">Reading…</p>}
        </label>
      )}

      {/* 2 — mapping */}
      {step === 1 && analysis && (
        <div className="space-y-3">
          <p className="text-sm text-gray-700">
            <span className="font-medium">{analysis.filename}</span> — {analysis.row_count.toLocaleString()} rows,
            {' '}{mappedCount} of {fields.length} fields matched automatically. Change anything that looks wrong.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {(fields || []).map(f => (
              <div key={f.key} className="flex items-center gap-2">
                <label className="w-40 shrink-0 text-xs text-gray-600 truncate">
                  {f.label}{f.required && <span className="text-red-600"> *</span>}
                </label>
                <select value={mapping[f.key] || ''} onChange={e => setMapping(m => ({ ...m, [f.key]: e.target.value }))}
                  className="flex-1 px-2 py-1.5 border border-gray-300 rounded-lg text-sm">
                  <option value="">— skip —</option>
                  {analysis.headers.map(h => <option key={h} value={h}>{h}</option>)}
                </select>
              </div>
            ))}
          </div>
          {requiredMissing.length > 0 && (
            <p className="text-xs text-amber-700">
              Map {requiredMissing.map(f => f.label).join(' and ')} before continuing — rows without them can't be filed.
            </p>
          )}
          <div className="flex justify-between">
            <button type="button" onClick={reset} className="px-3 py-2 text-sm rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50">Start over</button>
            <button type="button" onClick={runPreview} disabled={busy || requiredMissing.length > 0}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
              {busy ? 'Checking…' : 'Preview import'}
            </button>
          </div>
        </div>
      )}

      {/* 3 — dry run */}
      {step === 2 && preview && (
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: 'New records', value: preview.create, tone: 'text-green-700' },
              { label: 'Updated', value: preview.update, tone: 'text-blue-700' },
              { label: 'Skipped', value: preview.skip, tone: 'text-amber-700' },
              // Rows the target deliberately doesn't want — a QuickBooks
              // report's subtotal lines, or the bill payments mixed in with
              // the bills. Shown apart from Skipped, because 734 of those
              // reported as problems is how a good file looks broken.
              ...(preview.filtered ? [{ label: 'Not applicable', value: preview.filtered, tone: 'text-gray-500' }] : []),
            ].map(c => (
              <div key={c.label} className="rounded-lg border border-gray-200 p-3">
                <div className="text-xs text-gray-500">{c.label}</div>
                <div className={`text-2xl font-semibold ${c.tone}`}>{c.value.toLocaleString()}</div>
              </div>
            ))}
          </div>
          <p className="text-xs text-gray-500">Nothing has been written yet.</p>

          {preview.issues?.length > 0 && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
              <p className="text-xs font-semibold text-amber-900">Rows that will be skipped (first {preview.issues.length}):</p>
              <ul className="mt-1 space-y-0.5 max-h-40 overflow-y-auto">
                {preview.issues.map(i => (
                  <li key={i.line} className="text-[11px] text-amber-800">Row {i.line}: {i.errors.join('; ')}</li>
                ))}
              </ul>
            </div>
          )}

          {preview.preview?.length > 0 && (
            <div className="rounded-lg border border-gray-200 overflow-x-auto">
              <table className="min-w-full text-xs">
                <thead className="bg-gray-50">
                  <tr>{Object.keys(preview.preview[0]).slice(0, 7).map(k => (
                    <th key={k} className="px-2 py-1.5 text-left font-medium text-gray-500">{k}</th>
                  ))}</tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {preview.preview.map((r, i) => (
                    <tr key={i}>{Object.keys(preview.preview[0]).slice(0, 7).map(k => (
                      <td key={k} className="px-2 py-1 text-gray-700 truncate max-w-[160px]">{String(r[k] ?? '')}</td>
                    ))}</tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="flex justify-between">
            <button type="button" onClick={() => setStep(1)} className="px-3 py-2 text-sm rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50">Back to columns</button>
            <button type="button" onClick={commit} disabled={busy || (preview.create + preview.update) === 0}
              className="px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 disabled:opacity-50">
              {busy ? 'Importing…' : `Import ${(preview.create + preview.update).toLocaleString()} rows`}
            </button>
          </div>
        </div>
      )}

      {/* 4 — done */}
      {step === 3 && result && (
        <div className="space-y-3">
          <div className="rounded-lg border border-green-200 bg-green-50 p-4 flex items-start gap-3">
            <CheckCircle size={20} className="text-green-600 mt-0.5 shrink-0" />
            <div className="text-sm text-green-900">
              <p className="font-semibold">Import complete.</p>
              <p className="mt-0.5">
                {result.created.toLocaleString()} new, {result.updated.toLocaleString()} updated
                {result.skipped ? `, ${result.skipped.toLocaleString()} skipped` : ''}.
              </p>
            </div>
          </div>
          <button type="button" onClick={reset}
            className="inline-flex items-center gap-1 px-3 py-2 text-sm rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50">
            <RotateCcw size={14} /> Import another file
          </button>
        </div>
      )}
    </div>
  );
}
