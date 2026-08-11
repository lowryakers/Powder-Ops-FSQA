import { useState, useMemo } from 'react';
import { useApiGet, apiFetch } from '../../hooks/useApi';
import { useAuth } from '../../hooks/useAuth';
import { useTableSort } from '../../lib/useTableSort';
import SortHeader from '../common/SortHeader';
import ModuleTabs from '../common/ModuleTabs.jsx';
import ProductDataHealth from './ProductDataHealth.jsx';
import NfpBoard, { NfpForSku } from './NfpPanel.jsx';
import {
  Package, Search, X, AlertTriangle, CheckCircle2, Circle, Pencil, ChevronRight, Stethoscope,
  FileText,
} from 'lucide-react';

/**
 * The master list.
 *
 * One screen, one question: what do we sell and what is true about it. The
 * readiness column is the part that earns its keep — it answers "what is still
 * missing on this product" without anyone keeping a side checklist, which is
 * how a GS1 number or an NFP approval used to get missed until artwork was
 * already at the printer.
 */

// Columns as data, so the header and `useTableSort` cannot disagree.
const COLUMNS = [
  { key: 'sku', label: 'SKU' },
  { key: 'flavor', label: 'Product' },
  { key: 'gtin', label: 'GTIN' },
  { key: 'category', label: 'Category' },
  { key: 'pack', label: 'Pack' },
  { key: 'status', label: 'Status' },
  { key: 'readiness_done', label: 'Ready', type: 'number', align: 'right' },
  { width: '2rem' },
];

const PACK_LABEL = {
  PLG: 'Pouch — large', PSM: 'Pouch — small', STK: 'Stick', BOX: 'Carton', CUP: 'Cup',
};

const STATUS_STYLE = {
  active: 'bg-green-100 text-green-800',
  in_development: 'bg-blue-100 text-blue-800',
  concept: 'bg-gray-100 text-gray-700',
  on_hold: 'bg-amber-100 text-amber-800',
  discontinued: 'bg-red-100 text-red-800',
};
const pretty = (s) => (s || '').replace(/_/g, ' ');

function ReadyBar({ readiness }) {
  if (!readiness) return null;
  const { done, total } = readiness;
  const complete = done === total;
  return (
    <span className="inline-flex items-center gap-1.5" title={readiness.missing.join(', ') || 'Nothing outstanding'}>
      <span className={`text-xs font-medium tabular-nums ${complete ? 'text-green-700' : 'text-gray-600'}`}>
        {done}/{total}
      </span>
      <span className="w-12 h-1.5 rounded-full bg-gray-200 overflow-hidden">
        <span
          className={`block h-full ${complete ? 'bg-green-500' : done / total > 0.6 ? 'bg-amber-400' : 'bg-red-400'}`}
          style={{ width: `${(done / total) * 100}%` }}
        />
      </span>
    </span>
  );
}

function Detail({ sku, canEdit, onClose, onSaved }) {
  const { data, refresh } = useApiGet(`/products/${encodeURIComponent(sku)}`);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const p = data;
  const startEdit = () => {
    setForm({
      gtin: p.gtin || '', flavor: p.flavor || '', base_flavor: p.base_flavor || '',
      status: p.status || 'active', eyemark_color: p.eyemark_color || '',
      shopify_sku: p.shopify_sku || '', mrp_formula_id: p.mrp_formula_id || '',
      // nfp_version / nfp_approved_at are deliberately absent. They are the
      // artwork print gate, and they are written by approving a panel — see the
      // Nutrition panel section below. The server refuses them on PUT.
      artwork_status: p.artwork_status || '', drive_url: p.drive_url || '', notes: p.notes || '',
    });
    setEditing(true);
  };
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const save = async () => {
    setSaving(true); setError('');
    try {
      await apiFetch(`/products/${encodeURIComponent(sku)}`, { method: 'PUT', body: JSON.stringify(form) });
      setEditing(false); refresh(); onSaved?.();
    } catch (e) { setError(e.message); }
    setSaving(false);
  };

  return (
    <div className="fixed inset-0 bg-black/30 z-50 flex justify-end" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()}
        className="bg-white w-full max-w-xl h-full overflow-y-auto p-5 space-y-4 shadow-xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-wide text-gray-500">
              {p ? `${p.category} · ${PACK_LABEL[p.pack] || p.pack}` : ''}
            </p>
            <h3 className="text-lg font-bold text-gray-900">{p?.flavor || sku}</h3>
            <code className="text-sm text-gray-600">{sku}</code>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700"><X size={20} /></button>
        </div>

        {!p ? <p className="text-sm text-gray-500">Loading…</p> : (
          <>
            {p.readiness.missing.length > 0 && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                <p className="text-sm font-semibold text-amber-900 flex items-center gap-1.5">
                  <AlertTriangle size={15} /> {p.readiness.missing.length} still outstanding
                </p>
                <ul className="mt-2 space-y-1">
                  {p.readiness.steps.map((s) => (
                    <li key={s.key} className="text-sm flex items-center gap-2">
                      {s.done
                        ? <CheckCircle2 size={14} className="text-green-600 shrink-0" />
                        : <Circle size={14} className="text-gray-300 shrink-0" />}
                      <span className={s.done ? 'text-gray-500 line-through' : 'text-gray-900'}>{s.label}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {!p.gtin_valid && p.gtin && (
              <p className="text-sm text-red-800 bg-red-50 border border-red-200 rounded-lg p-3">
                <strong>{p.gtin}</strong> fails its GS1 check digit. Do not send this to a printer.
              </p>
            )}

            {editing ? (
              <div className="space-y-3">
                {error && <p className="text-sm text-red-700 bg-red-50 rounded p-2">{error}</p>}
                {[
                  ['flavor', 'Product name'], ['base_flavor', 'Base flavour'], ['gtin', 'GTIN'],
                  ['eyemark_color', 'Eyemark colour'], ['shopify_sku', 'Shopify SKU'],
                  ['mrp_formula_id', 'MRP formula'], ['drive_url', 'Drive link'],
                ].map(([k, label]) => (
                  <label key={k} className="block">
                    <span className="text-xs font-medium text-gray-600">{label}</span>
                    <input value={form[k]} onChange={set(k)}
                      className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
                  </label>
                ))}
                <label className="block">
                  <span className="text-xs font-medium text-gray-600">Status</span>
                  <select value={form.status} onChange={set('status')}
                    className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm">
                    {Object.keys(STATUS_STYLE).map((s) => <option key={s} value={s}>{pretty(s)}</option>)}
                  </select>
                </label>
                <label className="block">
                  <span className="text-xs font-medium text-gray-600">Artwork status</span>
                  <select value={form.artwork_status} onChange={set('artwork_status')}
                    className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm">
                    <option value="">Not set</option>
                    {['draft', 'in_review', 'approved', 'print_ready', 'superseded'].map((s) =>
                      <option key={s} value={s}>{pretty(s)}</option>)}
                  </select>
                </label>
                <label className="block">
                  <span className="text-xs font-medium text-gray-600">Notes</span>
                  <textarea value={form.notes} onChange={set('notes')} rows={3}
                    className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
                </label>
                <div className="flex gap-2">
                  <button onClick={save} disabled={saving}
                    className="px-3 py-2 bg-powder-600 text-white rounded-lg text-sm font-medium disabled:opacity-50">
                    {saving ? 'Saving…' : 'Save'}
                  </button>
                  <button onClick={() => setEditing(false)}
                    className="px-3 py-2 border border-gray-300 rounded-lg text-sm">Cancel</button>
                </div>
              </div>
            ) : (
              <>
                <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                  {[
                    ['GTIN', p.gtin], ['Legacy SKU', p.legacy_sku], ['Base flavour', p.base_flavor],
                    ['Status', pretty(p.status)], ['Protein', p.protein_type],
                    ['Pack count', p.pack_count], ['Spec', p.spec_name], ['Material', p.material_structure],
                    ['Zipper', p.zipper], ['Print', p.print_process],
                    ['Trim', p.trim_length_mm ? `${p.trim_length_mm} × ${p.trim_width_mm} mm` : null],
                    ['Eyemark', p.eyemark_color], ['Shopify SKU', p.shopify_sku],
                    ['MRP formula', p.mrp_formula_id],
                    ['NFP version', p.nfp_version && `${p.nfp_version}${p.nfp_approved_at ? ` — approved ${p.nfp_approved_at}` : ' — not approved'}`],
                    ['Artwork', pretty(p.artwork_status)],
                  ].filter(([, v]) => v !== null && v !== undefined && v !== '').map(([label, v]) => (
                    <div key={label}>
                      <dt className="text-xs text-gray-500">{label}</dt>
                      <dd className="text-gray-900 break-words">{v}</dd>
                    </div>
                  ))}
                </dl>

                {p.colors?.length > 0 && (
                  <div>
                    <p className="text-xs font-medium text-gray-600 mb-1">Brand colours</p>
                    <div className="flex flex-wrap gap-2">
                      {p.colors.map((c) => (
                        <span key={c.id} className="inline-flex items-center gap-1.5 text-xs border border-gray-200 rounded px-2 py-1">
                          <span className="w-3.5 h-3.5 rounded-sm border border-gray-300"
                            style={{ background: c.hex_valid ? `#${(c.hex || '').replace(/^(HEX|HX)\s+/, '')}` : 'transparent' }} />
                          <span>{c.pms || '—'}</span>
                          <span className={c.hex_valid ? 'text-gray-400' : 'text-red-600'}>{c.hex || '—'}</span>
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* The panel workflow lives here, beside the product, because
                    that is where someone already is when they need it. The
                    refresh carries back up so the readiness bar moves the
                    moment a panel is approved. */}
                <div className="pt-2 border-t border-gray-100">
                  <NfpForSku sku={sku} formulaRev={p.formula_rev} canEdit={canEdit}
                    onChanged={() => { refresh(); onSaved?.(); }} />
                </div>

                {p.siblings?.length > 0 && (
                  <div>
                    <p className="text-xs font-medium text-gray-600 mb-1">
                      Same flavour, other SKUs — a change here probably touches these
                    </p>
                    <ul className="space-y-1">
                      {p.siblings.map((s) => (
                        <li key={s.sku} className="text-sm text-gray-700">
                          <code className="text-gray-900">{s.sku}</code> — {s.flavor}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {canEdit && (
                  <button onClick={startEdit}
                    className="inline-flex items-center gap-1.5 px-3 py-2 border border-gray-300 rounded-lg text-sm font-medium hover:bg-gray-50">
                    <Pencil size={14} /> Edit
                  </button>
                )}
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default function ProductsPanel() {
  const { user } = useAuth();
  const { data, refresh } = useApiGet('/products');
  // Fetched HERE rather than inside the panel below so the tab can carry the
  // count — the number shrinking is the point of the punch list, and a number
  // you have to open a tab to see does not do that job.
  const { data: health } = useApiGet('/products/data-health');
  // Same reason as `health`: fetched here so the tab badge and the board it
  // opens are the same number, not two queries that can drift.
  const { data: nfp, refresh: refreshNfp } = useApiGet('/nfp');
  const [q, setQ] = useState('');
  const [category, setCategory] = useState('');
  const [pack, setPack] = useState('');
  const [onlyIncomplete, setOnlyIncomplete] = useState(false);
  const [open, setOpen] = useState(null);
  const [view, setView] = useState('list');

  const canEdit = ['admin', 'supervisor'].includes(user?.role)
    || ['qa', 'quality'].includes((user?.department || '').toLowerCase());

  const products = useMemo(() => (data?.products || []).map((p) => ({
    ...p, readiness_done: p.readiness?.done ?? 0,
  })), [data]);

  const categories = useMemo(
    () => [...new Set(products.map((p) => p.category))].sort(), [products]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return products.filter((p) => {
      if (category && p.category !== category) return false;
      if (pack && p.pack !== pack) return false;
      if (onlyIncomplete && p.readiness?.missing?.length === 0) return false;
      if (!needle) return true;
      return [p.sku, p.legacy_sku, p.gtin, p.flavor, p.base_flavor, p.shopify_sku]
        .some((v) => (v || '').toLowerCase().includes(needle));
    });
  }, [products, q, category, pack, onlyIncomplete]);

  const { sorted, sortCol, sortDir, toggleSort } = useTableSort(filtered, COLUMNS, 'sku', 'asc');

  // Panels somebody still has to act on — drafts, links out, and ones sent back.
  const awaitingNfp = (nfp?.versions || [])
    .filter((v) => ['draft', 'sent', 'rejected'].includes(v.status)).length;

  const badGtin = products.filter((p) => p.gtin && !p.gtin_valid).length;
  const incomplete = products.filter((p) => p.readiness?.missing?.length > 0).length;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">
          <Package size={20} className="text-powder-600" /> Products
        </h2>
        <p className="text-sm text-gray-500 max-w-2xl">
          The master list — every finished good, its codes, and the film it prints on.
          This is what the artwork proofer checks against.
        </p>
      </div>

      <ModuleTabs value={view} onChange={setView} tabs={[
        { id: 'list', label: 'Catalogue', icon: Package, badge: products.length },
        // Panels waiting on somebody. Counted here rather than left to be found
        // in a product drawer, because "who still owes us an approval" is the
        // question that holds artwork up.
        { id: 'nfp', label: 'Nutrition panels', icon: FileText,
          badge: awaitingNfp || undefined, badgeTone: awaitingNfp ? 'alert' : undefined },
        // The punch list lives beside the catalogue rather than in a document,
        // so it is counted live and shrinks as the data is fixed.
        { id: 'health', label: 'Data health', icon: Stethoscope,
          badge: health?.affected || undefined, badgeTone: health?.affected ? 'alert' : undefined },
      ]} />

      {view === 'nfp' && <NfpBoard data={nfp} onOpenSku={(s) => { setView('list'); setOpen(s); }} />}
      {view === 'health' && <ProductDataHealth data={health} />}

      {view === 'list' && (<>
      {badGtin > 0 && (
        <p className="text-sm text-red-800 bg-red-50 border border-red-200 rounded-lg p-3 flex items-start gap-2">
          <AlertTriangle size={15} className="mt-0.5 shrink-0" />
          <span><strong>{badGtin}</strong> GTIN{badGtin === 1 ? '' : 's'} fail the GS1 check digit.</span>
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[14rem]">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input value={q} onChange={(e) => setQ(e.target.value)}
            placeholder="Search SKU, flavour, GTIN, Shopify SKU"
            className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-lg text-sm" />
        </div>
        <select value={category} onChange={(e) => setCategory(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm">
          <option value="">All categories</option>
          {categories.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select value={pack} onChange={(e) => setPack(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm">
          <option value="">All packs</option>
          {Object.entries(PACK_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <button onClick={() => setOnlyIncomplete((v) => !v)}
          className={`px-3 py-2 rounded-lg text-sm font-medium border ${onlyIncomplete
            ? 'bg-amber-100 border-amber-300 text-amber-900'
            : 'border-gray-300 text-gray-700 hover:bg-gray-50'}`}>
          Not ready <span className="tabular-nums">{incomplete}</span>
        </button>
      </div>

      <p className="text-xs text-gray-500">
        {sorted.length} of {products.length}
      </p>

      <div className="overflow-x-auto border border-gray-200 rounded-lg">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              {COLUMNS.map((c, i) => (
                <SortHeader key={c.key || `c${i}`} col={c} sortCol={sortCol} sortDir={sortDir} onSort={toggleSort} />
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {sorted.map((p) => (
              <tr key={p.sku} onClick={() => setOpen(p.sku)}
                className="hover:bg-gray-50 cursor-pointer">
                <td className="px-3 py-2"><code className="text-gray-900">{p.sku}</code></td>
                <td className="px-3 py-2 text-gray-700">{p.flavor}</td>
                <td className="px-3 py-2">
                  <span className={p.gtin && !p.gtin_valid ? 'text-red-600 font-medium' : 'text-gray-600'}>
                    {p.gtin || '—'}
                  </span>
                </td>
                <td className="px-3 py-2 text-gray-600">{p.category}</td>
                <td className="px-3 py-2 text-gray-600">{PACK_LABEL[p.pack] || p.pack}</td>
                <td className="px-3 py-2">
                  <span className={`text-xs px-2 py-0.5 rounded-full ${STATUS_STYLE[p.status] || 'bg-gray-100 text-gray-700'}`}>
                    {pretty(p.status)}
                  </span>
                </td>
                <td className="px-3 py-2 text-right"><ReadyBar readiness={p.readiness} /></td>
                <td className="px-3 py-2 text-gray-300"><ChevronRight size={15} /></td>
              </tr>
            ))}
            {sorted.length === 0 && (
              <tr><td colSpan={COLUMNS.length} className="px-3 py-8 text-center text-sm text-gray-500">
                Nothing matches. Loosen a filter.
              </td></tr>
            )}
          </tbody>
        </table>
      </div>

      </>)}

      {open && <Detail sku={open} canEdit={canEdit} onClose={() => setOpen(null)}
        onSaved={() => { refresh(); refreshNfp(); }} />}
    </div>
  );
}
