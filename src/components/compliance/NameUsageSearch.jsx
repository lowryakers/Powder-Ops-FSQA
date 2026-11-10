import { useState } from 'react';
import { apiFetch, apiPost } from '../../hooks/useApi';
import { Search, ExternalLink, Loader2, Replace } from 'lucide-react';

// "Where is this name used?" (D-326). Type a chemical, a machine, a person's
// title — anything that changed — and see every document, recurring task,
// register entry and built-in definition that still says it, with who changes
// each one. READ-ONLY: the server only searches.
// D-328: rename it in the plain places in one act — recurring tasks and their
// open cards, quality schedules, the chemical list and the sign-out catalogue.
// Documents, forms and courses change by their own revision; the dilution checks
// in Controlled Changes. Preview first; the apply writes exactly what was shown.
function RenameBox({ from, onDone }) {
  const [to, setTo] = useState('');
  const [reason, setReason] = useState('');
  const [plan, setPlan] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(null);
  const call = async (preview) => {
    setBusy(true); setError('');
    try {
      const r = await apiPost('/doc-review/name-usage/rename', { from, to, reason, preview });
      if (preview) setPlan(r); else { setDone(r); setPlan(null); onDone?.(); }
    } catch (e) { setError(e.message); }
    setBusy(false);
  };
  if (done) return <p className="text-sm text-emerald-700" data-rename-done={done.renamed}>Renamed in {done.renamed} place{done.renamed === 1 ? '' : 's'}.</p>;
  return (
    <div className="border border-powder-200 bg-powder-50/40 rounded-lg p-3 space-y-2" data-rename-box>
      <p className="text-sm font-semibold text-gray-800 flex items-center gap-1.5"><Replace size={14} /> Rename &ldquo;{from}&rdquo; everywhere it can be</p>
      <p className="text-[11px] text-gray-500">Changes recurring tasks and the cards already open, quality schedules, the chemical list and the sign-out catalogue.
        Filed records are never changed. Documents, forms and courses change through their own revision; the dilution checks in Controlled Changes.</p>
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="text-xs text-gray-600">New name
          <input value={to} onChange={e => { setTo(e.target.value); setPlan(null); }} data-rename-to
            className="mt-0.5 w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm" />
        </label>
        <label className="text-xs text-gray-600">Why (for example, the DCR number)
          <input value={reason} onChange={e => setReason(e.target.value)} data-rename-reason
            className="mt-0.5 w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm" />
        </label>
      </div>
      {error && <p className="text-xs text-red-700">{error}</p>}
      {!plan ? (
        <button type="button" disabled={busy || !to.trim()} onClick={() => call(true)} data-rename-preview
          className="px-3 py-1.5 bg-white border border-gray-300 rounded-lg text-xs font-medium disabled:opacity-50">Preview the changes</button>
      ) : (
        <div className="space-y-2" data-rename-plan={plan.total}>
          <p className="text-xs text-gray-700"><strong>{plan.total}</strong> place{plan.total === 1 ? '' : 's'} would change.
            {plan.kept?.dilution_checks ? ` ${plan.kept.dilution_checks} dilution check(s) are left for Controlled Changes.` : ''}</p>
          <ul className="max-h-64 overflow-y-auto divide-y divide-gray-100 bg-white rounded-lg border border-gray-200 text-xs">
            {plan.rows.map(r => (
              <li key={`${r.target}-${r.id}`} className="px-2 py-1.5">
                <span className="text-gray-500">{r.label}:</span> <span className="font-medium">{r.name}</span>
                {r.changes.filter(c => c.field !== 'procedure_steps').map(c => (
                  <span key={c.field} className="block text-gray-500">{c.field}: <span className="line-through">{c.from}</span> → <span className="text-gray-800">{c.to}</span></span>
                ))}
                {r.changes.some(c => c.field === 'procedure_steps') && <span className="block text-gray-500">steps updated</span>}
              </li>
            ))}
          </ul>
          <div className="flex gap-2">
            <button type="button" disabled={busy || !plan.total || reason.trim().length < 3} onClick={() => call(false)} data-rename-apply
              className="px-3 py-1.5 bg-powder-600 text-white rounded-lg text-xs font-medium disabled:opacity-50">Rename {plan.total} place{plan.total === 1 ? '' : 's'}</button>
            <button type="button" onClick={() => setPlan(null)} className="px-3 py-1.5 bg-gray-100 rounded-lg text-xs">Back</button>
          </div>
          {reason.trim().length < 3 && <p className="text-[11px] text-amber-700">Say why before renaming.</p>}
        </div>
      )}
    </div>
  );
}

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
              {result.total > 0 && <RenameBox key={result.term} from={result.term} onDone={() => run()} />}
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
