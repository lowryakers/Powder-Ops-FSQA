// The spec sheet's gaps, named (D-128, server/product-completeness.js).
//
// One row per SKU, one chip per requirement group, and the exact fields each
// group is missing. NO PERCENTAGE ANYWHERE: a score invites "we're at 94%, ship
// it"; a list of named gaps goes to zero. The roll-up counts SKUs and gaps.
// Blocked is its own state — a decision somebody owns — and stale is a flag
// beside it. The CSV is built from the payload on the screen, never a second
// endpoint, so the file cannot disagree with the page.
import { useMemo, useState } from 'react';
import { useApiGet, apiFetch } from '../../hooks/useApi';
import { CheckCircle2, XCircle, Ban, AlertTriangle, Download, ChevronDown, ChevronRight, Search } from 'lucide-react';

const STATE_STYLE = {
  complete: 'bg-green-50 text-green-800 border-green-200',
  incomplete: 'bg-amber-50 text-amber-900 border-amber-200',
  blocked: 'bg-gray-100 text-gray-700 border-gray-300',
};
const STATE_LABEL = { complete: 'Complete', incomplete: 'Incomplete', blocked: 'Blocked' };

const csvCell = (v) => {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

function exportCsv(rows) {
  const lines = [['SKU', 'Product', 'Line', 'Gaps', 'Missing fields'].join(',')];
  for (const r of rows) {
    if (r.state !== 'incomplete') continue;
    lines.push([r.sku, r.product, r.line, r.gaps, r.missing.join(', ')].map(csvCell).join(','));
  }
  const blob = new Blob([lines.join('\n') + '\n'], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `spec-sheet-gaps-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function GroupChip({ g, res }) {
  const ok = res.state === 'complete';
  return (
    <span data-group={g.key} data-group-state={res.state}
      title={ok ? `${g.label}: complete` : `${g.label}: ${res.missing.join(', ')}`}
      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[11px] ${ok
        ? 'bg-green-50 text-green-800 border-green-200' : 'bg-amber-50 text-amber-900 border-amber-200'}`}>
      {ok ? <CheckCircle2 size={11} /> : <XCircle size={11} />}
      {g.label}{!ok && ` · ${res.missing.length}`}
    </span>
  );
}

function BlockForm({ sku, onDone }) {
  const [reason, setReason] = useState('');
  const [owner, setOwner] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true); setError('');
    try {
      await apiFetch(`/products/${encodeURIComponent(sku)}/completeness-block`, { method: 'POST', body: { reason, owner } });
      onDone();
    } catch (e) { setError(e.message); }
    setBusy(false);
  };
  return (
    <div className="flex flex-wrap items-end gap-2" data-block-form>
      <label className="block flex-1 min-w-[12rem]">
        <span className="text-[11px] text-gray-500">Why it cannot be completed yet</span>
        <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="formula not final"
          className="w-full border border-gray-300 rounded px-2 py-1 text-xs" data-block-reason />
      </label>
      <label className="block w-40">
        <span className="text-[11px] text-gray-500">Who owns unblocking it</span>
        <input value={owner} onChange={(e) => setOwner(e.target.value)} placeholder="Danny"
          className="w-full border border-gray-300 rounded px-2 py-1 text-xs" data-block-owner />
      </label>
      <button type="button" onClick={save} disabled={busy} data-block-save
        className="px-2.5 py-1 rounded bg-gray-700 text-white text-xs font-medium disabled:opacity-50">
        {busy ? 'Saving…' : 'Mark blocked'}
      </button>
      {error && <p className="w-full text-xs text-red-700">{error}</p>}
    </div>
  );
}

function Row({ r, groups, canEdit, onChanged, onOpenSku }) {
  const [open, setOpen] = useState(false);
  const [blocking, setBlocking] = useState(false);
  const unblock = async () => {
    await apiFetch(`/products/${encodeURIComponent(r.sku)}/completeness-block`, { method: 'DELETE' });
    onChanged();
  };
  return (
    <div data-completeness-row={r.sku} data-state={r.state} className="border-b border-gray-100 last:border-0">
      <button type="button" onClick={() => setOpen(!open)} className="w-full text-left px-3 py-2 hover:bg-gray-50">
        <div className="flex items-start gap-2">
          {open ? <ChevronDown size={14} className="mt-0.5 text-gray-400 shrink-0" /> : <ChevronRight size={14} className="mt-0.5 text-gray-400 shrink-0" />}
          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
              <span className="font-mono text-xs text-gray-900">{r.sku}</span>
              <span className="text-sm text-gray-800 truncate">{r.product}</span>
              <span className={`text-[11px] px-1.5 py-0.5 rounded border ${STATE_STYLE[r.state]}`}>
                {STATE_LABEL[r.state]}{r.state === 'incomplete' && ` · ${r.gaps} gap${r.gaps === 1 ? '' : 's'}`}
              </span>
              {r.stale.length > 0 && (
                <span data-stale className="text-[11px] px-1.5 py-0.5 rounded border bg-red-50 text-red-800 border-red-200 inline-flex items-center gap-1">
                  <AlertTriangle size={11} /> Stale
                </span>
              )}
            </div>
            <div className="flex flex-wrap gap-1">
              {groups.map((g) => <GroupChip key={g.key} g={g} res={r.groups[g.key]} />)}
            </div>
            {r.block && (
              <p className="text-[11px] text-gray-600" data-block-line>
                <Ban size={11} className="inline mr-1" />Blocked — {r.block.reason} · owner {r.block.owner}
                {r.block.by && ` · set by ${r.block.by}`}
              </p>
            )}
          </div>
        </div>
      </button>
      {open && (
        <div className="px-3 pb-3 pl-8 space-y-2 text-xs">
          {r.stale.length > 0 && (
            <ul className="text-red-800 bg-red-50 border border-red-200 rounded px-2 py-1 list-disc pl-5">
              {r.stale.map((s) => <li key={s}>{s}</li>)}
            </ul>
          )}
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1.5">
            {groups.map((g) => {
              const res = r.groups[g.key];
              return (
                <div key={g.key} data-group-detail={g.key}>
                  <dt className="font-medium text-gray-700">{g.label}</dt>
                  <dd className={res.missing.length ? 'text-amber-900' : 'text-green-700'}>
                    {res.missing.length ? (
                      <ul className="list-disc pl-4" data-missing={g.key}>{res.missing.map((m) => <li key={m}>{m}</li>)}</ul>
                    ) : 'Complete'}
                    {res.na.length > 0 && (
                      <span className="block text-gray-500">Not applicable: {res.na.join(', ')}</span>
                    )}
                  </dd>
                </div>
              );
            })}
          </dl>
          <div className="flex flex-wrap items-center gap-2 pt-1">
            {onOpenSku && (
              <button type="button" data-open-sku onClick={() => onOpenSku(r.sku)} className="text-powder-700 hover:underline">Open the product</button>
            )}
            {canEdit && (r.block ? (
              <button type="button" onClick={unblock} data-unblock className="text-gray-600 hover:underline">Unblock</button>
            ) : !blocking && (
              <button type="button" onClick={() => setBlocking(true)} data-block className="text-gray-600 hover:underline">Mark blocked…</button>
            ))}
          </div>
          {blocking && !r.block && <BlockForm sku={r.sku} onDone={() => { setBlocking(false); onChanged(); }} />}
        </div>
      )}
    </div>
  );
}

export default function ProductCompleteness({ canEdit, onOpenSku }) {
  const { data, loading, refresh } = useApiGet('/products/completeness');
  const [state, setState] = useState('incomplete');
  const [line, setLine] = useState('');
  const [q, setQ] = useState('');

  const rows = useMemo(() => {
    const all = data?.rows || [];
    const needle = q.trim().toLowerCase();
    return all.filter((r) => (state === 'all' || (state === 'stale' ? r.stale.length > 0 : r.state === state))
      && (!line || r.line === line)
      && (!needle || r.sku.toLowerCase().includes(needle) || (r.product || '').toLowerCase().includes(needle)
        || r.missing.some((m) => m.toLowerCase().includes(needle))));
  }, [data, state, line, q]);

  if (loading) return <p className="text-sm text-gray-500">Loading…</p>;
  if (!data) return null;
  const c = data.counts;

  return (
    <div className="space-y-4" data-completeness>
      <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-2">
        <p className="text-sm text-gray-700">
          What the spec sheet is still missing, by field. <strong>Not a score</strong> — a list that goes to zero.
        </p>
        <div className="flex flex-wrap gap-2 text-xs" data-completeness-counts>
          {[['incomplete', `${c.incomplete} incomplete · ${c.gaps} named gaps`], ['blocked', `${c.blocked} blocked`],
            ['stale', `${c.stale} stale`], ['complete', `${c.complete} complete`], ['all', `${c.skus} SKUs`]].map(([k, label]) => (
            <button key={k} type="button" onClick={() => setState(k)} data-filter={k}
              className={`px-2.5 py-1 rounded-full border ${state === k ? 'bg-powder-600 text-white border-powder-600' : 'bg-white text-gray-700 border-gray-300'}`}>
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
        <table className="w-full text-xs min-w-[520px]" data-line-rollup>
          <thead>
            <tr className="text-left text-gray-500 border-b border-gray-100">
              <th className="px-3 py-2 font-medium">Line</th>
              <th className="px-2 py-2 font-medium text-right">SKUs</th>
              <th className="px-2 py-2 font-medium text-right">Incomplete</th>
              <th className="px-2 py-2 font-medium text-right">Named gaps</th>
              <th className="px-2 py-2 font-medium text-right">Blocked</th>
              <th className="px-2 py-2 font-medium text-right">Stale</th>
            </tr>
          </thead>
          <tbody>
            {data.lines.map((l) => (
              <tr key={l.line} data-line-row={l.line} onClick={() => setLine(line === l.line ? '' : l.line)}
                className={`border-b border-gray-50 cursor-pointer hover:bg-gray-50 ${line === l.line ? 'bg-powder-50' : ''}`}>
                <td className="px-3 py-1.5 text-gray-900">{l.line}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{l.skus}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{l.incomplete}</td>
                <td className="px-2 py-1.5 text-right tabular-nums font-medium">{l.gaps}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{l.blocked || ''}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{l.stale || ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[12rem]">
          <Search size={14} className="absolute left-2.5 top-2 text-gray-400" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="SKU, product or a missing field"
            className="w-full pl-8 pr-2 py-1.5 border border-gray-300 rounded-lg text-sm" />
        </div>
        {line && (
          <button type="button" onClick={() => setLine('')} className="text-xs text-powder-700 hover:underline">
            {line} × clear
          </button>
        )}
        <button type="button" onClick={() => exportCsv(data.rows)} data-export
          className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-gray-300 rounded-lg text-xs font-medium hover:bg-gray-50">
          <Download size={13} /> Export gaps (CSV)
        </button>
      </div>

      <div className="bg-white rounded-xl border border-gray-200">
        {rows.length ? rows.map((r) => (
          <Row key={r.sku} r={r} groups={data.groups} canEdit={canEdit} onChanged={refresh} onOpenSku={onOpenSku} />
        )) : (
          <p className="p-4 text-sm text-gray-500">Nothing in this view.</p>
        )}
      </div>
    </div>
  );
}
