// Test plans and the COA product list (D-244, COA Phase 2 task A). Lives at the
// top of the Specifications tab.
//
// A test plan is the list of tests a family of products gets and the limit for
// each. It is a draft until Quality approves it with a password; an approved
// plan is never edited, only replaced by its next version. Applying a plan to
// products writes their specifications — after a preview that names every
// test it would add, change or retire, and every CONFLICT with a limit already
// on file, which is skipped and never forced.
import { useState } from 'react';
import { useApiGet, apiPost, apiPut } from '../../hooks/useApi';
import { withSignature } from '../../lib/signature';

const COMPARE = [
  ['', 'Choose…'], ['<', 'below (<)'], ['<=', 'at or below (≤)'], ['>', 'above (>)'], ['>=', 'at or above (≥)'], ['range', 'a range'], ['absent', 'absent'],
];
const STATUS_STYLE = { draft: 'bg-amber-50 text-amber-800', approved: 'bg-green-50 text-green-800', retired: 'bg-gray-100 text-gray-500' };

function PlanEditor({ plan, onSaved, onClose }) {
  const [tests, setTests] = useState(() => plan.tests.map(t => ({ ...t, min_value: t.min_value ?? '', max_value: t.max_value ?? '' })));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (i, k, v) => setTests(ts => ts.map((t, j) => (j === i ? { ...t, [k]: v } : t)));
  const save = async () => {
    setBusy(true); setError('');
    try { await apiPut(`/coa/plans/${plan.id}`, { tests }); onSaved(); }
    catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };
  return (
    <div data-plan-editor className="border border-gray-200 rounded-lg p-3 mt-2 space-y-2">
      <div className="overflow-x-auto">
        <table className="text-xs w-full min-w-[720px]">
          <thead><tr className="text-left text-gray-500">
            <th className="py-1 pr-2">Test</th><th className="pr-2">Judged</th><th className="pr-2">Limit</th><th className="pr-2">Unit</th><th className="pr-2">Method</th><th className="pr-2">Wording</th><th />
          </tr></thead>
          <tbody>
            {tests.map((t, i) => (
              <tr key={i} className="align-top">
                <td className="py-1 pr-2"><input value={t.test_type} onChange={e => set(i, 'test_type', e.target.value)} className="w-40 px-1.5 py-1 border border-gray-300 rounded" /></td>
                <td className="pr-2">
                  <select value={t.evaluation === 'report_only' ? 'report_only' : (t.comparator || '')}
                    onChange={e => {
                      const v = e.target.value;
                      setTests(ts => ts.map((x, j) => (j !== i ? x : v === 'report_only' ? { ...x, evaluation: 'report_only' } : { ...x, evaluation: 'limit', comparator: v || null })));
                    }}
                    className="px-1.5 py-1 border border-gray-300 rounded">
                    {COMPARE.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                    <option value="report_only">reported, not judged</option>
                  </select>
                </td>
                <td className="pr-2 whitespace-nowrap">
                  {t.evaluation !== 'report_only' && ['>', '>=', 'range'].includes(t.comparator) && (
                    <input value={t.min_value} onChange={e => set(i, 'min_value', e.target.value)} placeholder="min" className="w-16 px-1.5 py-1 border border-gray-300 rounded mr-1" />)}
                  {t.evaluation !== 'report_only' && ['<', '<=', 'range'].includes(t.comparator) && (
                    <input value={t.max_value} onChange={e => set(i, 'max_value', e.target.value)} placeholder="max" className="w-16 px-1.5 py-1 border border-gray-300 rounded" />)}
                  {t.evaluation === 'report_only' && (
                    <label className="inline-flex items-center gap-1 text-[11px] text-gray-600" title="A reported-only test is hidden on the public certificate unless this is ticked.">
                      <input type="checkbox" checked={!!t.public} onChange={e => set(i, 'public', e.target.checked)} data-plan-test-public /> show publicly
                    </label>)}
                </td>
                <td className="pr-2"><input value={t.unit || ''} onChange={e => set(i, 'unit', e.target.value)} className="w-20 px-1.5 py-1 border border-gray-300 rounded" /></td>
                <td className="pr-2"><input value={t.method || ''} onChange={e => set(i, 'method', e.target.value)} className="w-28 px-1.5 py-1 border border-gray-300 rounded" /></td>
                <td className="pr-2"><input value={t.specification || ''} onChange={e => set(i, 'specification', e.target.value)} placeholder="printed on the certificate" className="w-44 px-1.5 py-1 border border-gray-300 rounded" /></td>
                <td><button onClick={() => setTests(ts => ts.filter((_, j) => j !== i))} className="text-red-600 hover:underline">Remove</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
      <div className="flex gap-2">
        <button onClick={() => setTests(ts => [...ts, { test_type: '', evaluation: 'limit', comparator: null, min_value: '', max_value: '', unit: '', method: '', specification: '', required: 1 }])}
          className="text-xs text-powder-600 hover:text-powder-700">+ Add a test</button>
        <div className="flex-1" />
        <button onClick={onClose} className="text-xs text-gray-500">Cancel</button>
        <button onClick={save} disabled={busy} className="px-3 py-1 bg-powder-600 text-white text-xs rounded-lg disabled:opacity-50">{busy ? 'Saving…' : 'Save draft'}</button>
      </div>
    </div>
  );
}

function ApplyPanel({ plan, products, onDone, onClose }) {
  const eligible = products.map(p => p.item_number);
  const [picked, setPicked] = useState(() => new Set(products.filter(p => p.plan_name === plan.name).map(p => p.item_number)));
  const [preview, setPreview] = useState(null);
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const toggle = (it) => setPicked(s => { const n = new Set(s); if (n.has(it)) n.delete(it); else n.add(it); setPreview(null); return n; });
  const doPreview = async () => {
    setBusy(true); setError('');
    try { setPreview(await apiPost(`/coa/plans/${plan.id}/apply`, { item_numbers: [...picked] })); }
    catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };
  const doApply = async () => {
    setBusy(true); setError('');
    try {
      const out = await withSignature((extra) => apiPost(`/coa/plans/${plan.id}/apply`, { item_numbers: [...picked], mode: 'apply', reason, ...extra }),
        { title: `Apply ${plan.name} v${plan.version}`, detail: `Writes the specifications for ${picked.size} product${picked.size === 1 ? '' : 's'}.` });
      onDone(out);
    } catch (e) { if (!e?.cancelled) setError(e.message); }
    finally { setBusy(false); }
  };
  return (
    <div data-plan-apply className="border border-gray-200 rounded-lg p-3 mt-2 space-y-2">
      <p className="text-xs font-medium text-gray-800">Apply to which products?</p>
      {!eligible.length && <p className="text-xs text-gray-500">No products on the list yet — add them below first.</p>}
      <div className="flex flex-wrap gap-1.5 max-h-40 overflow-y-auto">
        {products.map(p => (
          <label key={p.item_number} className={`text-[11px] px-2 py-1 rounded border cursor-pointer ${picked.has(p.item_number) ? 'border-powder-400 bg-powder-50' : 'border-gray-200'}`}>
            <input type="checkbox" className="mr-1 align-middle" checked={picked.has(p.item_number)} onChange={() => toggle(p.item_number)} />
            {p.item_number}{p.display_name ? ` · ${p.display_name}` : ''}
          </label>
        ))}
      </div>
      <div className="flex gap-2">
        <button onClick={doPreview} disabled={busy || !picked.size} className="px-3 py-1 text-xs rounded-lg border border-gray-300 disabled:opacity-50">Preview</button>
        <div className="flex-1" />
        <button onClick={onClose} className="text-xs text-gray-500">Close</button>
      </div>
      {preview && (
        <div data-apply-preview className="space-y-1.5">
          {preview.products.map(p => (
            <div key={p.item_number} data-apply-status={p.status} className={`rounded border px-2 py-1.5 text-[11px] ${p.status === 'CONFLICT' ? 'border-red-200 bg-red-50' : p.status === 'ok' ? 'border-gray-200' : 'border-amber-200 bg-amber-50'}`}>
              <span className="font-semibold">{p.item_number}</span>{p.display_name ? ` · ${p.display_name}` : ''} — {p.status === 'ok' ? 'will be updated' : p.status === 'CONFLICT' ? 'CONFLICT: skipped' : p.note}
              {p.status !== 'NOT_A_PRODUCT' && (
                <span className="block text-gray-600">
                  {p.add?.length ? `adds ${p.add.join(', ')}. ` : ''}{p.change?.length ? `changes ${p.change.join(', ')}. ` : ''}
                  {p.retire?.length ? `retires ${p.retire.join(', ')}. ` : ''}{p.kept?.length ? `${p.kept.length} unchanged. ` : ''}
                  {p.drafts_to_supersede ? `${p.drafts_to_supersede} draft spec${p.drafts_to_supersede === 1 ? '' : 's'} set aside. ` : ''}
                  {p.open_requests ? `${p.open_requests} open request${p.open_requests === 1 ? '' : 's'} will grade against the new limits.` : ''}
                </span>
              )}
              {p.conflicts?.map((c, i) => <span key={i} className="block text-red-700">{c}</span>)}
            </div>
          ))}
          {preview.plan.status !== 'approved'
            ? <p className="text-xs text-amber-800">This version is a draft. Approve it before applying.</p>
            : (
              <div className="flex gap-2 items-center">
                <input value={reason} onChange={e => setReason(e.target.value)} placeholder="Why this plan is being applied" className="flex-1 px-2 py-1 border border-gray-300 rounded text-xs" />
                <button onClick={doApply} disabled={busy || reason.trim().length < 3} className="px-3 py-1 bg-powder-600 text-white text-xs rounded-lg disabled:opacity-50">Apply (asks for your password)</button>
              </div>
            )}
        </div>
      )}
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}

const aliasList = (p) => { try { return JSON.parse(p.aliases || '[]'); } catch { return []; } };

function ProductRow({ p, brands, canEdit, onSaved }) {
  const [form, setForm] = useState(null);
  const [error, setError] = useState('');
  const save = async () => {
    setError('');
    try { await apiPut(`/coa/products/${encodeURIComponent(p.item_number)}`, form); setForm(null); onSaved(); }
    catch (e) { setError(e.message); }
  };
  if (!form) {
    return (
      <tr className="border-t border-gray-100" data-coa-product={p.item_number}>
        <td className="py-1.5 pr-2 font-medium">{p.item_number}</td>
        <td className="pr-2">{p.display_name || <span className="text-gray-400">—</span>}
          {aliasList(p).length > 0 && <span className="block text-[11px] text-gray-500" data-coa-aliases>also: {aliasList(p).join('; ')}</span>}</td>
        <td className="pr-2">{p.brand_owner || '—'}</td>
        <td className="pr-2 font-mono text-[11px]">{p.slug || <span className="text-gray-400">—</span>}</td>
        <td className="pr-2">{p.gf_claim ? 'Gluten-free claim' : '—'}</td>
        <td className="pr-2">{p.plan_name ? `${p.plan_name} v${p.plan_version}` : <span className="text-gray-400">none</span>}</td>
        <td>{canEdit && <button onClick={() => setForm({ display_name: p.display_name || '', slug: p.slug || '', brand_owner: p.brand_owner || '', gf_claim: !!p.gf_claim, product_id: p.product_id || '', aliases: aliasList(p).join('; ') })} className="text-powder-600 hover:underline">Edit</button>}</td>
      </tr>
    );
  }
  const f = (k, v) => setForm(x => ({ ...x, [k]: v }));
  return (
    <tr className="border-t border-gray-100 bg-powder-50/40">
      <td className="py-1.5 pr-2 font-medium">{p.item_number}</td>
      <td className="pr-2"><input value={form.display_name} onChange={e => f('display_name', e.target.value)} className="w-40 px-1.5 py-1 border border-gray-300 rounded" />
        <input value={form.aliases} onChange={e => f('aliases', e.target.value)} placeholder="other names on production entries, separated by ;" data-coa-alias-input
          title="Exact names a production entry uses for this product. Matched exactly (case aside), never as part of a longer name."
          className="mt-1 block w-40 px-1.5 py-1 border border-gray-300 rounded text-[11px]" /></td>
      <td className="pr-2">
        <select value={form.brand_owner} onChange={e => f('brand_owner', e.target.value)} className="px-1.5 py-1 border border-gray-300 rounded">
          <option value="">unassigned</option>{brands.map(b => <option key={b} value={b}>{b}</option>)}
        </select>
      </td>
      <td className="pr-2"><input value={form.slug} onChange={e => f('slug', e.target.value)} placeholder="pancake-mix" className="w-36 px-1.5 py-1 border border-gray-300 rounded font-mono" /></td>
      <td className="pr-2"><label><input type="checkbox" checked={form.gf_claim} onChange={e => f('gf_claim', e.target.checked)} className="mr-1" />GF claim</label></td>
      <td className="pr-2"><input value={form.product_id} onChange={e => f('product_id', e.target.value)} placeholder="catalog SKU" className="w-28 px-1.5 py-1 border border-gray-300 rounded" /></td>
      <td className="whitespace-nowrap">
        <button onClick={save} className="text-powder-600 hover:underline mr-2">Save</button>
        <button onClick={() => setForm(null)} className="text-gray-500">Cancel</button>
        {error && <span className="block text-red-600">{error}</span>}
      </td>
    </tr>
  );
}

export default function CoaTestPlans({ canEdit }) {
  const { data, refresh } = useApiGet('/coa/plans');
  const { data: brandRows } = useApiGet('/coa/brands');
  const brands = (brandRows || []).map(b => b.name);
  const { data: prod, refresh: refreshProducts } = useApiGet('/coa/products');
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [applying, setApplying] = useState(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [addItem, setAddItem] = useState('');
  const plans = data?.plans || [];
  const products = prod?.products || [];
  const reload = () => { refresh(); refreshProducts(); };

  const act = async (fn) => { setError(''); setMessage(''); try { await fn(); reload(); } catch (e) { if (!e?.cancelled) setError(e.message); } };
  const approve = (p) => act(() => withSignature((extra) => apiPost(`/coa/plans/${p.id}/approve`, extra), { title: `Approve ${p.name} v${p.version}` }));
  const newVersion = (p) => act(async () => { const d = await apiPost(`/coa/plans/${p.id}/new-version`, {}); setEditing(d.id); });
  const addProduct = () => act(async () => { await apiPut(`/coa/products/${encodeURIComponent(addItem)}`, {}); setAddItem(''); });

  return (
    <section data-test-plans className="bg-white rounded-xl border border-gray-200">
      <button onClick={() => setOpen(o => !o)} className="w-full flex items-center justify-between px-4 py-3 text-left">
        <span>
          <span className="text-sm font-semibold text-gray-900">Test plans and COA products</span>
          <span className="block text-xs text-gray-500">
            {plans.filter(p => p.status === 'approved').length} approved · {plans.filter(p => p.status === 'draft').length} draft · {products.length} product{products.length === 1 ? '' : 's'} on the list
          </span>
        </span>
        <span className="text-xs text-powder-600">{open ? 'Hide' : 'Show'}</span>
      </button>
      {open && (
        <div className="px-4 pb-4 space-y-4">
          <p className="text-xs text-gray-600">
            A plan lists the tests a product gets and the limit for each. It is a draft until Quality approves it with a password, and an
            approved plan is never edited — make the next version. Applying writes the products' specifications after a preview; a test that
            already has a different limit on file is a CONFLICT and is skipped, never overwritten.
          </p>
          {message && <p className="text-xs text-green-700">{message}</p>}
          {error && <p className="text-xs text-red-600">{error}</p>}
          <div className="space-y-2">
            {plans.map(p => (
              <div key={p.id} data-plan={p.name} data-plan-status={p.status} className="rounded-lg border border-gray-200 px-3 py-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium text-gray-900">{p.name}</span>
                  <span className="text-xs text-gray-500">v{p.version}</span>
                  <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${STATUS_STYLE[p.status]}`}>{p.status}</span>
                  <span className="text-xs text-gray-500">{p.tests.length} tests · {p.products} product{p.products === 1 ? '' : 's'}</span>
                  {p.approved_by && <span className="text-xs text-gray-500">approved by {p.approved_by}</span>}
                  <div className="flex-1" />
                  {canEdit && p.status === 'draft' && <button onClick={() => setEditing(editing === p.id ? null : p.id)} className="text-xs text-powder-600 hover:underline">Edit</button>}
                  {canEdit && p.status === 'draft' && <button onClick={() => approve(p)} disabled={p.missing.length > 0} title={p.missing.join(' ')} className="text-xs px-2 py-0.5 rounded bg-powder-600 text-white disabled:opacity-40">Approve</button>}
                  {canEdit && p.status === 'approved' && <button onClick={() => newVersion(p)} className="text-xs text-powder-600 hover:underline">New version</button>}
                  {canEdit && p.status === 'approved' && <button onClick={() => setApplying(applying === p.id ? null : p.id)} className="text-xs px-2 py-0.5 rounded border border-gray-300">Apply to products</button>}
                </div>
                <ul className="mt-1 text-[11px] text-gray-600 flex flex-wrap gap-x-3">
                  {p.tests.map(t => (
                    <li key={t.id}>{t.test_type}{t.evaluation === 'report_only' ? ' (reported)' : t.specification ? `: ${t.specification}` : t.comparator ? `: ${t.comparator} ${t.max_value ?? t.min_value ?? ''} ${t.unit || ''}` : ': no limit yet'}</li>
                  ))}
                </ul>
                {p.status === 'draft' && p.missing.length > 0 && <p className="mt-1 text-[11px] text-amber-800">Before it can be approved: {p.missing.join(' ')}</p>}
                {editing === p.id && <PlanEditor plan={p} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload(); }} />}
                {applying === p.id && (
                  <ApplyPanel plan={p} products={products} onClose={() => setApplying(null)}
                    onDone={(out) => { setApplying(null); setMessage(`Applied to ${out.applied} product${out.applied === 1 ? '' : 's'}${out.skipped?.length ? `; ${out.skipped.length} skipped` : ''}.`); reload(); }} />
                )}
              </div>
            ))}
          </div>

          <div>
            <p className="text-xs font-semibold text-gray-800 mb-1">COA products</p>
            <div className="overflow-x-auto">
              <table className="text-xs w-full min-w-[720px]">
                <thead><tr className="text-left text-gray-500"><th className="py-1 pr-2">Item</th><th className="pr-2">Name</th><th className="pr-2">Brand</th><th className="pr-2">Web slug</th><th className="pr-2">Claim</th><th className="pr-2">Plan</th><th /></tr></thead>
                <tbody>
                  {products.map(p => <ProductRow key={p.item_number} p={p} brands={brands} canEdit={canEdit} onSaved={reload} />)}
                </tbody>
              </table>
            </div>
            {canEdit && (prod?.candidates?.length || 0) > 0 && (
              <div className="flex gap-2 mt-2">
                <select data-add-coa-product value={addItem} onChange={e => setAddItem(e.target.value)} className="flex-1 px-2 py-1 border border-gray-300 rounded text-xs">
                  <option value="">Add a product from the lab requests…</option>
                  {prod.candidates.map(c => <option key={c.item_number} value={c.item_number}>{c.item_number} · {c.item_description}{c.brand_owner && c.brand_owner !== 'unassigned' ? ` (${c.brand_owner})` : ''}</option>)}
                </select>
                <button onClick={addProduct} disabled={!addItem} className="px-3 py-1 text-xs rounded-lg border border-gray-300 disabled:opacity-50">Add</button>
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
