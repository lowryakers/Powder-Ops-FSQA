// Merch in Products (D-302): styles with their variants, the colour register,
// and a variant's GS1 number. Rendered by ProductsPanel when the Merch chip is
// on, and (MerchVariantBlock) inside the ordinary product drawer.
//
// Nothing here decides a rule. The server builds every SKU, refuses a flavour
// that is not in the register and refuses a GTIN while the colour is still
// being confirmed; this screen shows the same refusal (shared/merch.js) so a
// button is never offered that the server would refuse.
import { useMemo, useState } from 'react';
import { ChevronRight, ChevronDown, Plus, CheckCircle2, AlertTriangle, Shirt } from 'lucide-react';
import { useApiGet, apiFetch } from '../../hooks/useApi';
import { gtinAssignRefusal, MERCH_STEPS, merchStepsOf } from '../../../shared/merch.js';

const chip = (on) => `px-2 py-0.5 rounded-full text-[11px] font-medium ${on ? 'bg-amber-100 text-amber-900' : 'bg-green-100 text-green-800'}`;

function ColorChip({ color }) {
  if (!color) return <span className="text-xs text-gray-400">no color</span>;
  return (
    <span className="inline-flex items-center gap-1.5 text-sm">
      {color.hex && <span className="h-3 w-3 rounded-full border border-gray-300" style={{ background: color.hex }} aria-hidden="true" />}
      <span>{color.name || color.code}</span>
      <code className="text-[11px] text-gray-500">{color.code}</code>
      {color.confirming && <span className={chip(true)} data-color-confirming>Confirming</span>}
    </span>
  );
}

function NewStyleForm({ onDone }) {
  const { data: fc } = useApiGet('/products/flavor-codes');
  const [form, setForm] = useState({ garment: 'H', flavor: '', name: '' });
  const [error, setError] = useState('');
  const flavors = (fc?.codes || []).filter((c) => c.is_active).sort((a, b) => a.flavor.localeCompare(b.flavor));
  const save = async () => {
    setError('');
    try { await apiFetch('/products/merch/styles', { method: 'POST', body: form }); onDone(); } catch (e) { setError(e.message); }
  };
  return (
    <div className="border border-gray-200 rounded-lg p-3 space-y-2 bg-gray-50" data-merch-new-style>
      <div className="grid gap-2 sm:grid-cols-3">
        <label className="text-xs text-gray-600">Garment
          <select value={form.garment} onChange={(e) => setForm({ ...form, garment: e.target.value })} className="mt-1 w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm">
            <option value="H">Hoodie (H)</option><option value="T">Tee (T)</option><option value="C">Cap (C)</option>
          </select>
        </label>
        <label className="text-xs text-gray-600">Flavor (from the flavor register)
          <select value={form.flavor} onChange={(e) => setForm({ ...form, flavor: e.target.value })} className="mt-1 w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm">
            <option value="">Choose…</option>
            {flavors.map((f) => <option key={f.code} value={f.flavor}>{f.flavor} ({f.code})</option>)}
          </select>
        </label>
        <label className="text-xs text-gray-600">Name
          <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="ProDough … Hoodie" className="mt-1 w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm" />
        </label>
      </div>
      <p className="text-[11px] text-gray-500">The style code is the garment letter plus the flavor&apos;s register code. A flavor with no code is issued on the Flavor codes tab first.</p>
      {error && <p className="text-xs text-red-700">{error}</p>}
      <button type="button" onClick={save} disabled={!form.flavor} className="px-3 py-1.5 bg-powder-600 text-white rounded-lg text-sm disabled:opacity-50">Create style</button>
    </div>
  );
}

export function ColorRegister({ colors, canEdit, onChanged }) {
  const [form, setForm] = useState({ code: '', name: '', hex: '' });
  const [error, setError] = useState('');
  const add = async () => {
    setError('');
    try { await apiFetch('/products/merch/colors', { method: 'POST', body: form }); setForm({ code: '', name: '', hex: '' }); onChanged(); } catch (e) { setError(e.message); }
  };
  const confirm = async (code) => {
    setError('');
    try { await apiFetch(`/products/merch/colors/${code}/confirm`, { method: 'POST', body: {} }); onChanged(); } catch (e) { setError(e.message); }
  };
  return (
    <section className="border border-gray-200 rounded-lg p-3 space-y-2" data-merch-colors>
      <h3 className="text-sm font-semibold text-gray-900">Color register</h3>
      <p className="text-xs text-gray-500">A color starts as confirming. No GTIN is assigned to a variant until its color is confirmed.</p>
      <ul className="divide-y divide-gray-100">
        {colors.map((c) => (
          <li key={c.code} className="flex flex-wrap items-center gap-2 py-1.5" data-color={c.code}>
            <ColorChip color={c} />
            {!c.confirming && <span className="text-[11px] text-gray-500">confirmed by {c.confirmed_by}</span>}
            {c.confirming && canEdit && (
              <button type="button" onClick={() => confirm(c.code)} data-color-confirm={c.code} className="ml-auto text-xs px-2 py-1 border border-gray-300 rounded-lg hover:bg-gray-50">Confirm color</button>
            )}
          </li>
        ))}
        {!colors.length && <li className="py-1.5 text-xs text-gray-500">No colors yet.</li>}
      </ul>
      {canEdit && (
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-xs text-gray-600">Code<input value={form.code} maxLength={3} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} className="mt-1 block w-16 border border-gray-300 rounded-lg px-2 py-1 text-sm" /></label>
          <label className="text-xs text-gray-600">Name<input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="mt-1 block w-32 border border-gray-300 rounded-lg px-2 py-1 text-sm" /></label>
          <label className="text-xs text-gray-600">Hex<input value={form.hex} onChange={(e) => setForm({ ...form, hex: e.target.value })} placeholder="#1F4E9D" className="mt-1 block w-24 border border-gray-300 rounded-lg px-2 py-1 text-sm" /></label>
          <button type="button" onClick={add} className="px-2.5 py-1.5 border border-gray-300 rounded-lg text-xs hover:bg-gray-50">Add color</button>
        </div>
      )}
      {error && <p className="text-xs text-red-700">{error}</p>}
    </section>
  );
}

const STYLE_EDIT = [
  ['supplier', 'Supplier'], ['blank_brand', 'Blank brand'], ['blank_style', 'Blank style #'],
  ['decorator', 'Decorator'], ['decoration_method', 'Decoration method'], ['fabric', 'Fabric'],
  ['weight_gsm', 'Weight (GSM)'], ['fit', 'Fit'], ['care', 'Care'], ['country_of_origin', 'Country of origin'],
  ['unit_cost', 'Unit cost'], ['msrp', 'MSRP'], ['moq', 'MOQ'], ['lead_time_days', 'Lead time (days)'],
  ['shipping_weight_g', 'Shipping weight (g)'], ['notes', 'Notes'],
];

function StyleEditor({ style, onDone }) {
  const [form, setForm] = useState(() => Object.fromEntries([['name', style.name], ...STYLE_EDIT.map(([k]) => [k, style[k] ?? ''])]));
  const [error, setError] = useState('');
  const save = async () => {
    setError('');
    try { await apiFetch(`/products/merch/styles/${style.style_code}`, { method: 'PUT', body: form }); onDone(); } catch (e) { setError(e.message); }
  };
  return (
    <div className="border border-gray-200 rounded-lg p-3 space-y-2 bg-gray-50" data-merch-style-editor>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {[['name', 'Name'], ...STYLE_EDIT].map(([k, label]) => (
          <label key={k} className="text-xs text-gray-600">{label}
            <input value={form[k] ?? ''} onChange={(e) => setForm({ ...form, [k]: e.target.value })} className="mt-1 w-full border border-gray-300 rounded-lg px-2 py-1 text-sm" />
          </label>
        ))}
      </div>
      <p className="text-[11px] text-gray-500">Edited once here; every variant of the style reads it.</p>
      {error && <p className="text-xs text-red-700">{error}</p>}
      <button type="button" onClick={save} className="px-3 py-1.5 bg-powder-600 text-white rounded-lg text-sm">Save style</button>
    </div>
  );
}

function AddVariants({ style, colors, sizes, onDone, colorsWhere = 'in the color register below' }) {
  const [pick, setPick] = useState({ colors: [], sizes: [] });
  const [error, setError] = useState('');
  const flip = (k, v) => setPick((p) => ({ ...p, [k]: p[k].includes(v) ? p[k].filter((x) => x !== v) : [...p[k], v] }));
  const save = async () => {
    setError('');
    try { await apiFetch(`/products/merch/styles/${style.style_code}/variants`, { method: 'POST', body: pick }); onDone(); } catch (e) { setError(e.message); }
  };
  return (
    <div className="border border-gray-200 rounded-lg p-3 space-y-2 bg-gray-50" data-merch-add-variants>
      {!colors.length && (
        <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-2" data-merch-no-colors>
          Add colors {colorsWhere} first. Each variant is one color × one size, so with no colors there is nothing to create.
        </p>
      )}
      <div className="flex flex-wrap gap-3 text-sm">
        {colors.map((c) => <label key={c.code} className="inline-flex items-center gap-1"><input type="checkbox" className="h-4 w-4 shrink-0" checked={pick.colors.includes(c.code)} onChange={() => flip('colors', c.code)} /> {c.name}</label>)}
      </div>
      <div className="flex flex-wrap gap-3 text-sm">
        {sizes.map((s) => <label key={s.code} className="inline-flex items-center gap-1"><input type="checkbox" className="h-4 w-4 shrink-0" checked={pick.sizes.includes(s.code)} onChange={() => flip('sizes', s.code)} /> {s.code}</label>)}
      </div>
      <p className="text-[11px] text-gray-500">Each color × size becomes a Draft variant with its SKU built for it. No GTIN is assigned here.</p>
      {error && <p className="text-xs text-red-700">{error}</p>}
      <button type="button" onClick={save} disabled={!pick.colors.length || !pick.sizes.length} className="px-3 py-1.5 bg-powder-600 text-white rounded-lg text-sm disabled:opacity-50">
        Create {pick.colors.length * pick.sizes.length} variant{pick.colors.length * pick.sizes.length === 1 ? '' : 's'}
      </button>
    </div>
  );
}

export default function MerchStyles({ canEdit, needle = '', onOpenSku, onChanged, showColors = true, colorsWhere }) {
  const { data, refresh, loading } = useApiGet('/products/merch');
  const [open, setOpen] = useState(() => new Set());
  const [panel, setPanel] = useState(null); // { kind, code }
  const changed = () => { refresh(); onChanged?.(); setPanel(null); };
  const n = needle.trim().toLowerCase();
  const styles = useMemo(() => (data?.styles || []).map((s) => ({
    ...s, shown: n ? s.variants.filter((v) => [v.sku, v.flavor, v.gtin].some((x) => (x || '').toLowerCase().includes(n))) : s.variants,
  })).filter((s) => !n || s.shown.length || s.style_code.toLowerCase().includes(n) || (s.name || '').toLowerCase().includes(n)), [data, n]);
  const toggle = (code) => setOpen((o) => { const x = new Set(o); if (x.has(code)) x.delete(code); else x.add(code); return x; });
  if (loading && !data) return <p className="text-sm text-gray-500">Loading…</p>;
  const colors = data?.colors || [];
  return (
    <div className="space-y-3" data-merch-styles>
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm text-gray-600 flex-1 min-w-[12rem]">Merch styles and their variants. A variant is a product row; food-only checks (panel, formula, packaging spec) do not apply to it.</p>
        {canEdit && <button type="button" onClick={() => setPanel(panel?.kind === 'new' ? null : { kind: 'new' })} className="inline-flex items-center gap-1 px-3 py-1.5 border border-gray-300 rounded-lg text-xs hover:bg-gray-50"><Plus size={13} /> New style</button>}
      </div>
      {panel?.kind === 'new' && <NewStyleForm onDone={changed} />}
      {!styles.length && <p className="text-sm text-gray-500 border border-dashed border-gray-300 rounded-lg p-4">No merch styles yet.</p>}
      {styles.map((s) => {
        const isOpen = open.has(s.style_code) || !!n;
        return (
          <section key={s.style_code} className="border border-gray-200 rounded-lg" data-merch-style={s.style_code}>
            <button type="button" onClick={() => toggle(s.style_code)} data-merch-toggle={s.style_code} aria-expanded={isOpen}
              className="w-full flex flex-wrap items-center gap-2 px-3 py-2.5 text-left hover:bg-gray-50 rounded-lg">
              {isOpen ? <ChevronDown size={15} className="text-gray-400" /> : <ChevronRight size={15} className="text-gray-400" />}
              <Shirt size={15} className="text-gray-400" />
              <span className="text-sm font-semibold text-gray-900">{s.name}</span>
              <code className="text-xs text-gray-500">{s.style_code}</code>
              <span className="text-xs text-gray-500">{s.flavor} · {s.garment_label}</span>
              <span className="ml-auto flex flex-wrap items-center gap-1.5 text-[11px]">
                <span className="px-2 py-0.5 rounded-full bg-gray-100 text-gray-700 tabular-nums">{s.counts.variants} variants</span>
                <span className="px-2 py-0.5 rounded-full bg-gray-100 text-gray-700 tabular-nums">{s.counts.with_gtin} with GTIN</span>
                {s.counts.confirming > 0 && <span className={chip(true)}>{s.counts.confirming} color{s.counts.confirming === 1 ? '' : 's'} still confirming</span>}
              </span>
            </button>
            {isOpen && (
              <div className="px-3 pb-3 space-y-2">
                <dl className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-1 text-xs">
                  <div><dt className="text-gray-500">Supplier</dt><dd>{s.supplier || <span className="text-amber-700">not recorded</span>}</dd></div>
                  <div><dt className="text-gray-500">Decorator</dt><dd>{s.decorator || <span className="text-amber-700">not recorded</span>}</dd></div>
                  <div><dt className="text-gray-500">Blank</dt><dd>{[s.blank_brand, s.blank_style].filter(Boolean).join(' ') || '—'}</dd></div>
                  <div><dt className="text-gray-500">MSRP</dt><dd>{s.msrp != null ? `$${s.msrp}` : '—'}</dd></div>
                </dl>
                {canEdit && (
                  <div className="flex flex-wrap gap-2">
                    <button type="button" onClick={() => setPanel(panel?.kind === 'edit' && panel.code === s.style_code ? null : { kind: 'edit', code: s.style_code })} className="text-xs px-2 py-1 border border-gray-300 rounded-lg hover:bg-gray-50">Edit style</button>
                    <button type="button" onClick={() => setPanel(panel?.kind === 'variants' && panel.code === s.style_code ? null : { kind: 'variants', code: s.style_code })} className="text-xs px-2 py-1 border border-gray-300 rounded-lg hover:bg-gray-50">Add variants</button>
                  </div>
                )}
                {panel?.kind === 'edit' && panel.code === s.style_code && <StyleEditor style={s} onDone={changed} />}
                {panel?.kind === 'variants' && panel.code === s.style_code && <AddVariants style={s} colors={colors} sizes={data?.sizes || []} onDone={changed} colorsWhere={showColors ? undefined : colorsWhere} />}
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead><tr className="text-left text-xs text-gray-500"><th className="py-1 pr-3">SKU</th><th className="py-1 pr-3">Color</th><th className="py-1 pr-3">Size</th><th className="py-1 pr-3">GTIN</th><th className="py-1 pr-3">Status</th><th className="py-1">Ready</th></tr></thead>
                    <tbody>
                      {s.shown.map((v) => (
                        <tr key={v.sku} onClick={() => onOpenSku(v.sku)} data-merch-variant={v.sku} className="border-t border-gray-100 cursor-pointer hover:bg-gray-50">
                          <td className="py-1.5 pr-3 whitespace-nowrap"><code>{v.sku}</code></td>
                          <td className="py-1.5 pr-3 whitespace-nowrap"><ColorChip color={v.color} /></td>
                          <td className="py-1.5 pr-3">{v.size_code}</td>
                          <td className="py-1.5 pr-3 tabular-nums">{v.gtin || <span className="text-xs text-gray-400">none</span>}</td>
                          <td className="py-1.5 pr-3">{v.status}</td>
                          <td className="py-1.5 tabular-nums text-xs">{v.readiness?.done}/{v.readiness?.total}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </section>
        );
      })}
      {showColors && <ColorRegister colors={colors} canEdit={canEdit} onChanged={changed} />}
    </div>
  );
}

/** The merch block of the product drawer: style, color, size, recolor, GTIN. */
export function MerchVariantBlock({ p, canEdit, onChanged }) {
  const { data } = useApiGet('/products/merch');
  const [prefix, setPrefix] = useState('');
  const [sugg, setSugg] = useState(null);
  const [gtin, setGtin] = useState('');
  const [recolor, setRecolor] = useState('');
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');
  const refusal = gtinAssignRefusal(p, p.color && !p.color.missing ? { code: p.color.code, name: p.color.name, confirming: p.color.confirming } : null);
  const held = (data?.reservations || []).find((r) => r.reserved_for === p.sku);
  const run = async (fn) => { setError(''); setMsg(''); try { await fn(); } catch (e) { setError(e.message); } };
  const suggest = () => run(async () => {
    const r = await apiFetch(`/products/merch/gtin/suggest?prefix=${encodeURIComponent(prefix)}`);
    setSugg(r); setGtin(r.suggestion);
  });
  const reserve = () => run(async () => {
    await apiFetch('/products/merch/gtin/reserve', { method: 'POST', body: { gtin, reserved_for: p.sku } });
    setMsg(`${gtin} is held for ${p.sku}.`); onChanged?.();
  });
  const assign = () => run(async () => {
    const r = await apiFetch(`/products/merch/variants/${encodeURIComponent(p.sku)}/gtin`, { method: 'POST', body: { gtin: gtin || held?.gtin } });
    setMsg(`Assigned ${r.gtin}.${r.prefix_report?.warning ? ` ${r.prefix_report.warning}` : ''}`); onChanged?.();
  });
  const doRecolor = () => run(async () => {
    const r = await apiFetch(`/products/merch/variants/${encodeURIComponent(p.sku)}/recolor`, { method: 'POST', body: { color: recolor } });
    setMsg(`Now ${r.sku}. Reopen it from the list.`); onChanged?.();
  });
  return (
    <div className="space-y-3" data-merch-drawer>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
        <div><dt className="text-xs text-gray-500">Style</dt><dd><code>{p.style_code}</code> — {p.style_name}</dd></div>
        <div><dt className="text-xs text-gray-500">Size</dt><dd>{p.size ? `${p.size.code} (${p.size.label})` : <span className="text-amber-700 text-xs">no size</span>}</dd></div>
        <div className="col-span-2"><dt className="text-xs text-gray-500">Color</dt><dd><ColorChip color={p.color} /></dd></div>
        <div><dt className="text-xs text-gray-500">Supplier</dt><dd>{p.merch_supplier || <span className="text-amber-700 text-xs">not recorded on the style</span>}</dd></div>
        <div><dt className="text-xs text-gray-500">Decorator</dt><dd>{p.merch_decorator || <span className="text-amber-700 text-xs">not recorded on the style</span>}</dd></div>
      </dl>

      <div className="border-t border-gray-100 pt-2 space-y-2" data-merch-gtin>
        <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500">GTIN</h4>
        {p.gtin ? (
          <p className="text-sm inline-flex items-center gap-1.5"><CheckCircle2 size={14} className="text-green-600" /> {p.gtin}</p>
        ) : (
          <>
            {refusal && <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-2 flex gap-1.5" data-gtin-refusal><AlertTriangle size={13} className="mt-0.5 shrink-0" />{refusal}</p>}
            {held && <p className="text-xs text-gray-600">Reserved for this variant: <strong>{held.gtin}</strong>.</p>}
            {canEdit && (
              <div className="flex flex-wrap items-end gap-2">
                <label className="text-xs text-gray-600">Prefix
                  <select value={prefix} onChange={(e) => setPrefix(e.target.value)} className="mt-1 block border border-gray-300 rounded-lg px-2 py-1 text-sm" data-gtin-prefix>
                    <option value="">Choose…</option>
                    {(data?.prefixes || []).map((x) => <option key={x} value={x}>{x}</option>)}
                  </select>
                </label>
                <button type="button" onClick={suggest} disabled={!prefix} data-gtin-suggest className="px-2.5 py-1.5 border border-gray-300 rounded-lg text-xs hover:bg-gray-50 disabled:opacity-50">Suggest next free</button>
                <label className="text-xs text-gray-600">Number
                  <input value={gtin} onChange={(e) => setGtin(e.target.value.replace(/\D/g, ''))} inputMode="numeric" className="mt-1 block w-36 border border-gray-300 rounded-lg px-2 py-1 text-sm tabular-nums" />
                </label>
                <button type="button" onClick={reserve} disabled={!gtin} className="px-2.5 py-1.5 border border-gray-300 rounded-lg text-xs hover:bg-gray-50 disabled:opacity-50">Reserve</button>
                <button type="button" onClick={assign} disabled={!!refusal || !(gtin || held)} data-gtin-assign className="px-2.5 py-1.5 bg-powder-600 text-white rounded-lg text-xs disabled:opacity-50">Assign</button>
              </div>
            )}
            {sugg && <p className="text-xs text-gray-600">Suggested {sugg.suggestion} — {sugg.free} free on {sugg.prefix}. {sugg.note}</p>}
            {sugg?.warning && <p className="text-xs text-amber-800">{sugg.warning}</p>}
            <p className="text-[11px] text-gray-500">A suggestion is only a suggestion. Check the number against the GS1 portal before assigning it; the assignment re-checks that nobody else holds it.</p>
          </>
        )}
      </div>

      {canEdit && !p.gtin && (
        <div className="border-t border-gray-100 pt-2 flex flex-wrap items-end gap-2" data-merch-recolor>
          <label className="text-xs text-gray-600">Change color (rebuilds the SKU)
            <select value={recolor} onChange={(e) => setRecolor(e.target.value)} className="mt-1 block border border-gray-300 rounded-lg px-2 py-1 text-sm">
              <option value="">Choose…</option>
              {(data?.colors || []).filter((c) => c.code !== p.color_code).map((c) => <option key={c.code} value={c.code}>{c.name} ({c.code})</option>)}
            </select>
          </label>
          <button type="button" onClick={doRecolor} disabled={!recolor} className="px-2.5 py-1.5 border border-gray-300 rounded-lg text-xs hover:bg-gray-50 disabled:opacity-50">Recolor</button>
        </div>
      )}
      {msg && <p className="text-xs text-green-800">{msg}</p>}
      {error && <p className="text-xs text-red-700">{error}</p>}
    </div>
  );
}

/** The Colors view of the Merch tab: the register on its own. */
export function MerchColors({ canEdit, onChanged }) {
  const { data, refresh, loading } = useApiGet('/products/merch');
  if (loading && !data) return <p className="text-sm text-gray-500">Loading…</p>;
  const colors = data?.colors || [];
  const used = {};
  for (const s of data?.styles || []) for (const v of s.variants) if (v.color_code) used[v.color_code] = (used[v.color_code] || 0) + 1;
  return (
    <div className="space-y-2" data-merch-colors-view>
      <ColorRegister colors={colors} canEdit={canEdit} onChanged={() => { refresh(); onChanged?.(); }} />
      {colors.length > 0 && (
        <p className="text-xs text-gray-500">
          In use: {colors.map((c) => `${c.name || c.code} on ${used[c.code] || 0} variant${used[c.code] === 1 ? '' : 's'}`).join(' · ')}.
        </p>
      )}
    </div>
  );
}

/**
 * The merch Pipeline: every variant in the column of its first step not yet
 * done (shared/merch.js merchStepsOf). The steps are read off what the server
 * returned; nothing here decides one.
 */
export function MerchPipeline({ onOpenSku }) {
  const { data, loading } = useApiGet('/products/merch');
  const [style, setStyle] = useState('');
  const variants = useMemo(() => (data?.styles || [])
    .filter((s) => !style || s.style_code === style)
    .flatMap((s) => s.variants.map((v) => ({ ...v, style_name: s.name, flow: merchStepsOf(v) }))), [data, style]);
  if (loading && !data) return <p className="text-sm text-gray-500" data-merch-pipeline-loading>Loading…</p>;
  const columns = [...MERCH_STEPS.map((s, i) => ({ n: i, label: s.label, owner: s.owner })), { n: MERCH_STEPS.length, label: 'Every step holds', owner: null }];
  const ready = variants.filter((v) => v.flow.step === MERCH_STEPS.length).length;
  return (
    <div className="space-y-3" data-merch-pipeline>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="px-2.5 py-1 rounded-full border border-amber-300 bg-amber-50 text-amber-900" data-merch-pipeline-open={variants.length - ready}>{variants.length - ready} need work</span>
        <span className="px-2.5 py-1 rounded-full border border-green-300 bg-green-50 text-green-800" data-merch-pipeline-ready={ready}>{ready} with every step holding</span>
        <span className="ml-auto" />
        <select value={style} onChange={(e) => setStyle(e.target.value)} data-merch-pipeline-style className="px-2 py-1 border border-gray-300 rounded-lg bg-white">
          <option value="">All styles</option>
          {(data?.styles || []).map((s) => <option key={s.style_code} value={s.style_code}>{s.name} ({s.style_code})</option>)}
        </select>
      </div>
      <p className="text-xs text-gray-500">A variant sits under the first step it still owes. Food steps (formula, panel, artwork, packaging PO) do not apply to merch.</p>
      {!variants.length && <p className="text-sm text-gray-500 border border-dashed border-gray-300 rounded-lg p-4">No merch variants yet. Create a style and add variants on the Styles view.</p>}
      {variants.length > 0 && (
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
          {columns.map((c) => {
            const items = variants.filter((v) => v.flow.step === c.n);
            return (
              <section key={c.n} data-merch-step={c.n} data-count={items.length} className="rounded-lg border border-gray-200 bg-gray-50/60 min-w-0">
                <header className="px-2.5 py-2 border-b border-gray-200">
                  <p className="text-xs font-semibold text-gray-800">{c.n < MERCH_STEPS.length ? `${c.n + 1}. ` : ''}{c.label}</p>
                  <p className="text-[11px] text-gray-500">{items.length} variant{items.length === 1 ? '' : 's'}{c.owner ? ` · ${c.owner}` : ''}</p>
                </header>
                <ul className="p-1.5 space-y-1.5">
                  {items.map((v) => (
                    <li key={v.sku}>
                      <button type="button" onClick={() => onOpenSku(v.sku)} data-merch-pipeline-variant={v.sku}
                        className="w-full text-left bg-white border border-gray-200 rounded-md px-2 py-1.5 hover:border-powder-400">
                        <code className="text-[11px] block truncate">{v.sku}</code>
                        <span className="text-[11px] text-gray-600 block truncate">{v.color?.name || v.color_code} · {v.size_code}</span>
                        {v.flow.next?.why && <span className="text-[11px] text-amber-800 block">{v.flow.next.why}</span>}
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
