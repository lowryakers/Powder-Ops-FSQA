import { useState } from 'react';
import { apiFetch } from '../../hooks/useApi';
import { Search, ExternalLink, Loader2 } from 'lucide-react';

// "Where is this name used?" (D-326). Type a chemical, a machine, a person's
// title — anything that changed — and see every document, recurring task,
// register entry and built-in definition that still says it, with who changes
// each one. READ-ONLY: the server only searches.
export default function NameUsageSearch() {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');

  const run = async (e) => {
    e?.preventDefault();
    setBusy(true); setError('');
    try { setResult(await apiFetch(`/doc-review/name-usage?q=${encodeURIComponent(q)}`)); }
    catch (err) { setError(err.message); }
    setBusy(false);
  };
  const go = (to) => window.dispatchEvent(new CustomEvent('app-navigate', { detail: to }));
  const found = (result?.sections || []).filter((s) => s.count > 0);
  const missing = (result?.sections || []).filter((s) => s.count === 0);

  return (
    <div className="border border-gray-200 rounded-lg bg-white" data-name-usage>
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} data-name-usage-toggle
        className="w-full flex items-center gap-2 px-4 py-3 text-left text-sm font-semibold text-gray-800 hover:bg-gray-50 rounded-lg">
        <Search size={15} className="text-powder-600" /> Where is a name used?
        <span className="font-normal text-gray-500">Find every document, task and list that still says it.</span>
      </button>
      {open && (
        <div className="px-4 pb-4 space-y-3">
          <form onSubmit={run} className="flex flex-wrap gap-2">
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. Sani-512" data-name-usage-input
              className="flex-1 min-w-[12rem] border border-gray-300 rounded-lg px-3 py-2 text-sm" />
            <button type="submit" disabled={busy || q.trim().length < 3} data-name-usage-search
              className="px-3 py-2 rounded-lg bg-powder-600 text-white text-sm font-medium disabled:opacity-50 inline-flex items-center gap-1.5">
              {busy ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />} Search
            </button>
          </form>
          <p className="text-[11px] text-gray-500">Capitals, spaces and hyphens are ignored, so &ldquo;Sani 512&rdquo; also finds &ldquo;Sani-512&rdquo;. This only searches; it changes nothing.</p>
          {error && <p className="text-sm text-red-700">{error}</p>}
          {result?.error && <p className="text-sm text-amber-800">{result.error}</p>}
          {result && !result.error && (
            <div className="space-y-3" data-name-usage-result data-total={result.total}>
              <p className="text-sm text-gray-700">
                <strong>{result.total}</strong> place{result.total === 1 ? '' : 's'} still say &ldquo;{result.term}&rdquo;.
              </p>
              {found.map((s) => (
                <section key={s.key} className="border border-gray-200 rounded-lg" data-name-usage-section={s.key} data-count={s.count}>
                  <header className="flex flex-wrap items-start justify-between gap-2 px-3 py-2 bg-gray-50 rounded-t-lg">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-gray-900">{s.label} <span className="font-normal text-gray-500">· {s.count}</span></p>
                      <p className="text-xs text-gray-600"><strong>{s.who}:</strong> {s.how}</p>
                    </div>
                    {s.open && (
                      <button type="button" onClick={() => go(s.open)} className="shrink-0 inline-flex items-center gap-1 text-xs text-powder-700 hover:underline">
                        Open <ExternalLink size={12} />
                      </button>
                    )}
                  </header>
                  <ul className="divide-y divide-gray-100">
                    {s.rows.map((r) => (
                      <li key={`${s.key}-${r.id}`} className={`px-3 py-2 text-sm ${r.inactive ? 'text-gray-400' : 'text-gray-800'}`}>
                        <span className="font-medium">{r.name}</span>
                        {r.detail && <span className="text-xs text-gray-500"> · {r.detail}</span>}
                        {r.hit && <span className="block text-xs text-gray-500">in the {r.hit.field}: &ldquo;{r.hit.snippet}&rdquo;</span>}
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
              {missing.length > 0 && (
                <p className="text-xs text-gray-500">Not found in: {missing.map((s) => s.label).join(' · ')}.</p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
