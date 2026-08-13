import { useState, useMemo } from 'react';
import { apiUpload } from '../../hooks/useApi';
import { Upload, Check, AlertTriangle, X } from 'lucide-react';

/**
 * Dropping a Drive folder of panels or artwork in at once.
 *
 * The mapping step is the point, not an obstacle. A file matched by its GTIN or
 * its SKU arrives already decided; everything else is offered as a short list
 * to pick from, with the whole catalogue behind it. Nothing is filed on a
 * flavour name that merely resembles a product — "Chocolate Protein Pancake
 * Mix" and "Chocolate Protein Crepe Mix" are two products one word apart, and
 * the panel is what artwork prints from.
 */
export default function ProductFileImport({ target, title, onDone }) {
  const [files, setFiles] = useState([]);
  const [analysis, setAnalysis] = useState(null);
  const [mapping, setMapping] = useState({});
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);

  const reset = () => { setFiles([]); setAnalysis(null); setMapping({}); setResult(null); setError(null); setProgress(0); };

  const analyze = async (picked) => {
    if (!picked.length) return;
    setBusy(true); setError(null); setResult(null);
    try {
      const fd = new FormData();
      for (const f of picked) fd.append('files', f);
      const a = await apiUpload(`/product-files/${target}/analyze`, fd, 'POST', setProgress);
      setFiles(picked);
      setAnalysis(a);
      // Start from what the matcher was sure about. Everything else stays
      // blank until a person chooses, and a blank is a file that won't import.
      setMapping(Object.fromEntries(a.files.filter(f => f.sku).map(f => [f.filename, f.sku])));
    } catch (e) { setError(e.message); }
    finally { setBusy(false); setProgress(0); }
  };

  const commit = async () => {
    setBusy(true); setError(null);
    try {
      const fd = new FormData();
      for (const f of files) fd.append('files', f);
      fd.append('mapping', JSON.stringify(mapping));
      const r = await apiUpload(`/product-files/${target}/commit`, fd, 'POST', setProgress);
      setResult(r);
      setAnalysis(null);
      onDone?.();
    } catch (e) { setError(e.message); }
    finally { setBusy(false); setProgress(0); }
  };

  const ready = useMemo(() => Object.values(mapping).filter(Boolean).length, [mapping]);
  const products = analysis?.products || [];

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h3 className="font-semibold text-gray-900">{title}</h3>
        {(analysis || result) && (
          <button type="button" onClick={reset} className="text-xs text-gray-500 hover:text-gray-700 underline">
            Start over
          </button>
        )}
      </div>

      {!analysis && !result && (
        <>
          <p className="text-xs text-gray-500">
            Pick the whole folder. Files named with a GTIN or a SKU are matched for you; anything else is
            offered as a short list to choose from. Nothing is filed until you press import.
          </p>
          <label className="flex items-center justify-center gap-2 px-4 py-6 rounded-lg border-2 border-dashed border-gray-300 text-sm text-gray-600 cursor-pointer hover:border-powder-400 hover:bg-gray-50">
            <Upload size={16} />
            {busy ? `Reading… ${progress || 0}%` : 'Choose files'}
            <input type="file" multiple accept="application/pdf,image/*" className="hidden" disabled={busy}
              onChange={e => analyze([...e.target.files])} />
          </label>
        </>
      )}

      {error && <p className="text-sm text-red-700 bg-red-50 rounded-lg px-3 py-2">{error}</p>}

      {analysis && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {[
              ['Files', analysis.counts.total, 'text-gray-900'],
              ['Matched for you', analysis.counts.matched, 'text-green-700'],
              ['Need a choice', analysis.counts.needs_pick, 'text-amber-700'],
              ['No match', analysis.counts.unmatched, 'text-gray-500'],
            ].map(([l, v, tone]) => (
              <div key={l} className="rounded-lg border border-gray-200 p-2">
                <div className="text-[11px] text-gray-500">{l}</div>
                <div className={`text-xl font-semibold ${tone}`}>{v}</div>
              </div>
            ))}
          </div>
          {!analysis.storage && (
            <p className="text-xs text-amber-800 bg-amber-50 rounded-lg px-3 py-2">
              File storage isn&rsquo;t configured, so the import will be refused. Set the R2 variables first.
            </p>
          )}

          <div className="rounded-lg border border-gray-200 divide-y divide-gray-100 max-h-[26rem] overflow-y-auto">
            {analysis.files.map(f => {
              const chosen = mapping[f.filename] || '';
              return (
                <div key={f.filename} className="p-2.5 space-y-1.5">
                  <div className="flex items-start justify-between gap-2 flex-wrap">
                    <span className="text-xs font-medium text-gray-900 break-all min-w-0 flex-1">{f.filename}</span>
                    {f.sku
                      ? <span className="shrink-0 inline-flex items-center gap-1 text-[11px] text-green-700"><Check size={12} /> {f.detail}</span>
                      : f.suggestions.length
                        ? <span className="shrink-0 inline-flex items-center gap-1 text-[11px] text-amber-700"><AlertTriangle size={12} /> pick one</span>
                        : <span className="shrink-0 inline-flex items-center gap-1 text-[11px] text-gray-400"><X size={12} /> nothing matched</span>}
                  </div>

                  <div className="flex items-center gap-2 flex-wrap">
                    <select value={chosen} onChange={e => setMapping(m => ({ ...m, [f.filename]: e.target.value }))}
                      className="px-2 py-1 border border-gray-300 rounded-lg text-xs min-w-[16rem]">
                      <option value="">Don&rsquo;t import this file</option>
                      {/* The short list first — these are what the matcher
                          thought, in order — then everything, so a wrong
                          suggestion is never a dead end. */}
                      {f.suggestions.length > 0 && (
                        <optgroup label="Closest matches">
                          {f.suggestions.map(s => (
                            <option key={s.sku} value={s.sku}>{s.sku} — {s.flavor}</option>
                          ))}
                        </optgroup>
                      )}
                      <optgroup label="All products">
                        {products.map(p => <option key={p.sku} value={p.sku}>{p.sku} — {p.flavor}</option>)}
                      </optgroup>
                    </select>
                    {f.version_in_name && <span className="text-[11px] text-gray-500">version {f.version_in_name}</span>}
                    {f.existing && (
                      <span className="text-[11px] text-amber-700">
                        already has {f.existing.count} on file ({f.existing.versions})
                      </span>
                    )}
                  </div>

                  {/* What was read off the panel, beside the line it came from,
                      so the numbers are checkable rather than trusted. */}
                  {(f.read?.serving_size || f.read?.servings_per_container) && (
                    <p className="text-[11px] text-gray-500">
                      Read from the panel:
                      {f.read.serving_size && <> serving size <span className="text-gray-800">{f.read.serving_size}</span></>}
                      {f.read.servings_per_container && <> · <span className="text-gray-800">{f.read.servings_per_container}</span> per container</>}
                      <span className="text-gray-400"> — check these before approving.</span>
                    </p>
                  )}
                  {f.is_pdf === false && <p className="text-[11px] text-gray-400">Not a PDF, so nothing was read from it.</p>}
                </div>
              );
            })}
          </div>

          <div className="flex items-center justify-between gap-2 flex-wrap">
            <p className="text-[11px] text-gray-500">
              {ready} of {analysis.counts.total} will be imported. Files left on &ldquo;don&rsquo;t import&rdquo; are skipped.
            </p>
            <button type="button" onClick={commit} disabled={busy || !ready || !analysis.storage}
              className="px-4 py-2 bg-powder-600 text-white rounded-lg text-sm font-medium hover:bg-powder-700 disabled:opacity-50">
              {busy ? `Importing… ${progress || 0}%` : `Import ${ready} file${ready === 1 ? '' : 's'}`}
            </button>
          </div>
        </>
      )}

      {result && (
        <div className="space-y-2">
          <p className="text-sm font-medium text-green-800 bg-green-50 rounded-lg px-3 py-2">
            {result.counts.created} filed{result.counts.skipped ? `, ${result.counts.skipped} skipped` : ''}.
          </p>
          {result.created.length > 0 && (
            <ul className="text-[11px] text-gray-600 space-y-0.5 max-h-40 overflow-y-auto">
              {result.created.map(c => (
                <li key={c.filename}>{c.sku} {c.version} &larr; {c.filename}</li>
              ))}
            </ul>
          )}
          {result.skipped.length > 0 && (
            <div>
              <p className="text-[11px] font-semibold text-amber-800">Skipped</p>
              <ul className="text-[11px] text-amber-700 space-y-0.5 max-h-32 overflow-y-auto">
                {result.skipped.map(s => <li key={s.filename}>{s.filename} — {s.reason}</li>)}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
