import { useMemo, useState } from 'react';
import { apiPost } from '../../hooks/useApi';
import { withSignature } from '../../lib/signature';
import { Upload, CheckSquare, Square, AlertTriangle } from 'lucide-react';

// Brand review (D-238): a reviewed CSV of `request_id,brand_owner` proposals,
// previewed by the server, ticked by a person, applied with the password.
// Only `unassigned` requests move; a new brand is created closed to publishing.
// Extra columns (confidence, evidence, item, lot…) are shown and never sent.

// A small RFC-4180 reader: quoted fields, doubled quotes, CRLF.
function parseCsv(text) {
  const rows = [];
  let row = [], field = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') q = false;
      else field += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some(v => v.trim() !== '')) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some(v => v.trim() !== '')) rows.push(row);
  if (!rows.length) return { header: [], records: [] };
  const header = rows[0].map(h => h.trim().toLowerCase());
  return { header, records: rows.slice(1).map(r => Object.fromEntries(header.map((h, i) => [h, (r[i] ?? '').trim()]))) };
}

export default function BrandReview({ onApplied }) {
  const [csv, setCsv] = useState(null);       // { header, records, name }
  const [plan, setPlan] = useState(null);
  const [createMissing, setCreateMissing] = useState(false);
  const [picked, setPicked] = useState(() => new Set());
  const [brandFilter, setBrandFilter] = useState('');
  const [confFilter, setConfFilter] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  const extraCols = useMemo(() => (csv?.header || []).filter(h => !['request_id', 'brand_owner'].includes(h)), [csv]);
  const byRequest = useMemo(() => new Map((csv?.records || []).map(r => [r.request_id, r])), [csv]);

  const preview = async (records, create) => {
    setBusy(true); setMsg(null);
    try {
      const res = await apiPost('/coa/requests/brand-owner/bulk', {
        mode: 'preview', create_missing_brands: create,
        rows: records.map(r => ({ request_id: r.request_id, brand_owner: r.brand_owner, confidence: r.confidence || null })),
      });
      setPlan(res.plan);
      setPicked(new Set(res.plan.changes.map(c => c.request_id)));
    } catch (e) { setMsg({ bad: true, text: e.message }); }
    finally { setBusy(false); }
  };

  const onFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const parsed = parseCsv(await file.text());
    if (!parsed.header.includes('request_id') || !parsed.header.includes('brand_owner')) {
      setMsg({ bad: true, text: 'The file needs a request_id column and a brand_owner column.' }); return;
    }
    setCsv({ ...parsed, name: file.name });
    preview(parsed.records, createMissing);
  };

  const shown = useMemo(() => (plan?.changes || []).filter(c =>
    (!brandFilter || c.to === brandFilter) && (!confFilter || String(c.confidence ?? '') === confFilter)), [plan, brandFilter, confFilter]);
  const allShownPicked = shown.length > 0 && shown.every(c => picked.has(c.request_id));
  const toggleAll = () => setPicked(prev => {
    const n = new Set(prev);
    if (allShownPicked) shown.forEach(c => n.delete(c.request_id)); else shown.forEach(c => n.add(c.request_id));
    return n;
  });
  const toggle = (id) => setPicked(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const apply = async () => {
    const rows = (plan?.changes || []).filter(c => picked.has(c.request_id))
      .map(c => ({ request_id: c.request_id, brand_owner: c.to, confidence: c.confidence }));
    if (!rows.length) return;
    const reason = prompt(`Why are these ${rows.length} brand assignments being applied? (e.g. "Reviewed Grok Bot proposals, 27 Oct")`);
    if (!reason || reason.trim().length < 3) return;
    setBusy(true); setMsg(null);
    try {
      const res = await withSignature((extra) => apiPost('/coa/requests/brand-owner/bulk',
        { mode: 'apply', rows, reason: reason.trim(), create_missing_brands: createMissing, ...extra }),
      { title: `Assign ${rows.length} brand${rows.length === 1 ? '' : 's'}`, detail: csv?.name });
      setMsg({ bad: false, text: `Assigned ${res.changes} request${res.changes === 1 ? '' : 's'}.${res.brands_created?.length ? ` New brands (closed to publishing): ${res.brands_created.join(', ')}.` : ''}` });
      onApplied?.();
      await preview(csv.records, createMissing);
    } catch (e) { if (!e?.cancelled) setMsg({ bad: true, text: e.message }); }
    finally { setBusy(false); }
  };

  const brands = Object.keys(plan?.by_brand || {}).sort();
  const confidences = Object.keys(plan?.by_confidence || {}).sort();

  return (
    <div className="space-y-3" data-brand-review>
      <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-2">
        <h3 className="font-semibold text-gray-900">Brand review</h3>
        <p className="text-sm text-gray-600">
          Upload a CSV with <code className="text-xs bg-gray-100 px-1 rounded">request_id,brand_owner</code>. Only requests still
          <span className="font-medium"> unassigned</span> are changed; anything not in the file stays unassigned. A new brand is added
          closed to publishing. Nothing is applied until you tick rows and confirm with your password.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <label className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-powder-600 text-white text-sm font-medium rounded-lg cursor-pointer hover:bg-powder-700">
            <Upload size={14} /> Choose CSV
            <input type="file" accept=".csv,text/csv" onChange={onFile} className="hidden" data-brand-csv />
          </label>
          <label className="inline-flex items-center gap-1.5 text-sm text-gray-700">
            <input type="checkbox" checked={createMissing} disabled={busy}
              onChange={e => { setCreateMissing(e.target.checked); if (csv) preview(csv.records, e.target.checked); }} />
            Add brands that are not on the list yet
          </label>
          {csv && <span className="text-xs text-gray-500">{csv.name} · {csv.records.length} rows</span>}
        </div>
      </div>

      {msg && <div className={`text-sm rounded-lg px-3 py-2 border ${msg.bad ? 'bg-red-50 border-red-200 text-red-800' : 'bg-green-50 border-green-200 text-green-800'}`}>{msg.text}</div>}

      {plan && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden" data-brand-plan>
          <div className="px-3 py-2 border-b border-gray-100 bg-gray-50 flex flex-wrap items-center gap-3 text-xs text-gray-600">
            <span data-brand-counts><span className="font-semibold text-gray-900">{plan.changes.length}</span> to assign · {plan.no_ops.length} no change · {plan.errors.length} can't be applied</span>
            {plan.brands_to_create.length > 0 && <span className="text-amber-700">Would add: {plan.brands_to_create.join(', ')}</span>}
            <select value={brandFilter} onChange={e => setBrandFilter(e.target.value)} className="ml-auto px-2 py-1 border border-gray-200 rounded-lg bg-white">
              <option value="">All brands</option>
              {brands.map(b => <option key={b} value={b}>{b} ({plan.by_brand[b]})</option>)}
            </select>
            {confidences.length > 0 && (
              <select value={confFilter} onChange={e => setConfFilter(e.target.value)} className="px-2 py-1 border border-gray-200 rounded-lg bg-white">
                <option value="">Any confidence</option>
                {confidences.map(c => <option key={c} value={c}>{c} ({plan.by_confidence[c]})</option>)}
              </select>
            )}
            <button onClick={apply} disabled={busy || !picked.size} data-brand-apply
              className="px-3 py-1.5 bg-powder-600 text-white font-semibold rounded-lg disabled:opacity-50">
              Apply selected ({[...picked].filter(id => plan.changes.some(c => c.request_id === id)).length})
            </button>
          </div>
          <div className="overflow-x-auto max-h-[60vh]">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 sticky top-0">
                <tr>
                  <th className="px-3 py-2 w-8"><button onClick={toggleAll} className="text-gray-400">{allShownPicked ? <CheckSquare size={15} /> : <Square size={15} />}</button></th>
                  <th className="text-left px-3 py-2 text-xs font-medium text-gray-500">Item</th>
                  <th className="text-left px-3 py-2 text-xs font-medium text-gray-500">Lot</th>
                  <th className="text-left px-3 py-2 text-xs font-medium text-gray-500">Brand</th>
                  {extraCols.map(h => <th key={h} className="text-left px-3 py-2 text-xs font-medium text-gray-500">{h}</th>)}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {shown.map(c => (
                  <tr key={c.request_id} data-brand-row={c.request_id}>
                    <td className="px-3 py-1.5"><button onClick={() => toggle(c.request_id)} className="text-gray-400">{picked.has(c.request_id) ? <CheckSquare size={15} className="text-powder-600" /> : <Square size={15} />}</button></td>
                    <td className="px-3 py-1.5">{c.item_number} <span className="text-gray-500">{c.item_description}</span></td>
                    <td className="px-3 py-1.5 whitespace-nowrap">{c.lot_number}</td>
                    <td className="px-3 py-1.5 whitespace-nowrap font-medium">{c.to}</td>
                    {extraCols.map(h => <td key={h} className="px-3 py-1.5 text-xs text-gray-500 max-w-[16rem] truncate" title={byRequest.get(c.request_id)?.[h]}>{byRequest.get(c.request_id)?.[h]}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {plan.errors.length > 0 && (
            <div className="px-3 py-2 border-t border-gray-100 text-xs text-red-700" data-brand-errors>
              <p className="font-semibold flex items-center gap-1"><AlertTriangle size={13} /> {plan.errors.length} row{plan.errors.length === 1 ? '' : 's'} can't be applied</p>
              <ul className="list-disc list-inside">{plan.errors.slice(0, 20).map(e => <li key={`${e.row}-${e.request_id}`}>Row {e.row}: {e.error}</li>)}</ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
