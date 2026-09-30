// Packaging specs: where the film facts are edited (D-135).
//
// `packaging_specs` is the one owner of material, zipper, print, trim, gusset,
// front panel and wind direction; every product on a spec reads them through
// `products.spec_id`, and master.csv hands them to the proofer. The catalogue
// import refuses to write them per product and says "set it on the spec" —
// this is that screen. The grid's Spec cell and the drawer's Spec line both
// land here, on the spec they name.
//
// The rules are `shared/packaging-spec.js`, which the PUT reads too: a blank
// dimension is "unknown / does not apply" and is stored blank, never as 0; the
// spec code is the join key and is never edited. A change reaches every
// product on the spec, and the card says how many (and how many already carry
// released artwork) before the Save button, not after.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useApiGet, apiPost, apiPut } from '../../hooks/useApi';
import { SPEC_FIELDS, SPEC_FORMATS, validateSpecField, masterHeaderFor } from '../../../shared/packaging-spec.js';
import { isRollFed } from '../../../shared/product-fields.js';
import { Layers, Pencil, Plus, X, ChevronDown, ChevronRight, AlertTriangle } from 'lucide-react';

const GROUP_LABEL = { identity: 'Spec', film: 'Film and print — what the proofer reads', purchasing: 'Purchasing' };
const GROUPS = ['identity', 'film', 'purchasing'];

function display(f, v) {
  if (v === null || v === undefined || v === '') return null;
  if (f.kind === 'bool') return v ? 'yes' : 'no';
  if (f.kind === 'mm') return `${v} mm`;
  if (f.kind === 'money') return `$${Number(v)}`;
  return String(v);
}

const toForm = (spec) => Object.fromEntries(SPEC_FIELDS.map((f) => {
  const v = spec?.[f.key];
  if (f.kind === 'bool') return [f.key, v === 0 ? '0' : '1'];
  return [f.key, v === null || v === undefined ? '' : String(v)];
}));

/** Does a film field apply to this format? Wind direction is roll-fed only. */
const appliesTo = (key, format) => !(key === 'wind_direction' && format && !isRollFed(format));

function SpecForm({ spec, isNew, onCancel, onSaved }) {
  const [form, setForm] = useState(() => ({ ...toForm(spec), ...(isNew ? { spec_id: '', format: '' } : {}) }));
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  // The same rule the server applies, as the person types. The server still
  // decides; this only stops a save that is going to be refused.
  const live = useMemo(() => {
    const out = {};
    for (const f of SPEC_FIELDS) {
      const r = validateSpecField(f.key, form[f.key]);
      if (r.error) out[f.key] = r.error;
    }
    return out;
  }, [form]);

  const save = async (e) => {
    e.preventDefault();
    setError(''); setErrors({});
    // Send only what moved. An absent field is left alone on the server; a
    // cleared one is sent blank, which is how a value is removed.
    const body = {};
    const base = toForm(spec);
    for (const f of SPEC_FIELDS) if (isNew || form[f.key] !== base[f.key]) body[f.key] = form[f.key];
    if (isNew) body.spec_id = form.spec_id;
    if (!isNew && !Object.keys(body).length) { onCancel(); return; }
    setBusy(true);
    try {
      const r = isNew ? await apiPost('/products/specs', body) : await apiPut(`/products/specs/${encodeURIComponent(spec.spec_id)}`, body);
      onSaved(r.spec, r.changed);
    } catch (err) {
      setErrors(err.data?.errors || {});
      setError(err.message);
    } finally { setBusy(false); }
  };

  const shownErr = (k) => errors[k] || (form[k] !== toForm(spec)[k] || isNew ? live[k] : null);

  return (
    <form onSubmit={save} className="space-y-4" data-spec-form={isNew ? 'new' : spec.spec_id}>
      {isNew && (
        <label className="block" data-spec-field="spec_id">
          <span className="text-xs font-medium text-gray-600">Spec code</span>
          <input value={form.spec_id} onChange={(e) => setForm((f) => ({ ...f, spec_id: e.target.value.toUpperCase() }))}
            placeholder="SPEC-BOTTLE-SM" className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono" />
          <span className="mt-1 block text-[11px] text-gray-500">SPEC- then letters, digits and hyphens. It cannot be changed afterwards — products and POs resolve through it.</span>
          {errors.spec_id && <span className="mt-1 block text-[11px] text-red-700" data-spec-error="spec_id">{errors.spec_id}</span>}
        </label>
      )}
      {GROUPS.map((g) => (
        <fieldset key={g} className="space-y-3">
          <legend className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">{GROUP_LABEL[g]}</legend>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {SPEC_FIELDS.filter((f) => f.group === g).map((f) => {
              const err = shownErr(f.key);
              const header = masterHeaderFor(f.key);
              const na = !appliesTo(f.key, form.format);
              return (
                <label key={f.key} className={`block ${f.kind === 'long' ? 'sm:col-span-2' : ''}`} data-spec-field={f.key}>
                  <span className="text-xs font-medium text-gray-600">{f.label}{f.required ? ' *' : ''}</span>
                  {f.kind === 'format' ? (
                    <select value={form.format} onChange={set('format')} className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white">
                      <option value="">Choose…</option>
                      {SPEC_FORMATS.map((x) => <option key={x} value={x}>{x}</option>)}
                    </select>
                  ) : f.kind === 'bool' ? (
                    <select value={form[f.key]} onChange={set(f.key)} className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white">
                      <option value="1">yes</option><option value="0">no</option>
                    </select>
                  ) : f.kind === 'long' ? (
                    <textarea value={form[f.key]} onChange={set(f.key)} rows={2}
                      className={`mt-1 w-full border rounded-lg px-3 py-2 text-sm ${err ? 'border-red-500' : 'border-gray-300'}`} />
                  ) : (
                    // type="text" on the numbers too: a number input silently
                    // refuses "76.2 mm" with a tooltip that reads as the app broken.
                    <input value={form[f.key]} onChange={set(f.key)} inputMode={f.kind === 'mm' || f.kind === 'money' ? 'decimal' : undefined}
                      placeholder={na ? 'does not apply to this format' : f.kind === 'mm' ? 'blank if unknown or not applicable' : ''}
                      className={`mt-1 w-full border rounded-lg px-3 py-2 text-sm ${err ? 'border-red-500' : 'border-gray-300'}`} />
                  )}
                  {err ? <span className="mt-1 block text-[11px] text-red-700" data-spec-error={f.key}>{err}</span>
                    : (f.hint || header) && (
                      <span className="mt-1 block text-[11px] text-gray-500">
                        {f.hint}{f.hint && header ? ' ' : ''}{header && <span className="font-mono text-gray-400">→ master.csv “{header}”</span>}
                      </span>
                    )}
                </label>
              );
            })}
          </div>
        </fieldset>
      ))}
      {!isNew && spec.products_using > 0 && (
        <p className="text-[12px] text-amber-900 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2" data-spec-reach>
          This spec is on <strong>{spec.products_using}</strong> product{spec.products_using === 1 ? '' : 's'}
          {spec.print_ready > 0 && <> — <strong>{spec.print_ready}</strong> with released artwork, printed against the spec as it stands</>}.
          A change reaches every one of them, and the proofer on its next run.
        </p>
      )}
      {error && <p className="text-sm text-red-700" data-spec-save-error>{error}</p>}
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={busy} data-spec-save
          className="px-4 py-2 rounded-lg bg-powder-600 text-white text-sm font-medium hover:bg-powder-700 disabled:opacity-50">
          {busy ? 'Saving…' : isNew ? 'Open spec' : 'Save spec'}
        </button>
        <button type="button" onClick={onCancel} className="px-4 py-2 rounded-lg border border-gray-300 text-sm text-gray-700 hover:bg-gray-50">Cancel</button>
      </div>
    </form>
  );
}

function SpecCard({ spec: listed, canEdit, focused, onOpenSku, onSaved }) {
  const [editing, setEditing] = useState(false);
  // What the PUT answered, shown until the list catches up — otherwise the
  // card reads the old values for the moment between Save and the refetch,
  // which looks exactly like the save not having taken.
  const [saved, setSaved] = useState(null);
  const spec = saved && String(saved.updated_at) >= String(listed.updated_at) ? saved : listed;
  const [showProducts, setShowProducts] = useState(false);
  const [note, setNote] = useState('');
  const ref = useRef(null);

  useEffect(() => {
    if (focused && ref.current) ref.current.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }, [focused]);

  return (
    <section ref={ref} data-spec={spec.spec_id} data-spec-focused={focused ? '1' : undefined}
      className={`bg-white border rounded-xl p-4 space-y-3 scroll-mt-4 ${focused ? 'border-powder-500 ring-2 ring-powder-200' : 'border-gray-200'}`}>
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="font-semibold text-gray-900 flex flex-wrap items-baseline gap-x-2">
            <code className="text-powder-800">{spec.spec_id}</code>
            <span className="text-gray-700 font-normal">{spec.name}</span>
          </h3>
          <p className="text-xs text-gray-500 mt-0.5">
            <span className="px-1.5 py-0.5 rounded bg-gray-100 text-gray-700 border border-gray-200 mr-2">{spec.format}</span>
            <button type="button" onClick={() => setShowProducts((s) => !s)} className="hover:underline inline-flex items-center gap-0.5" data-spec-products-toggle>
              {showProducts ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
              {spec.products_using} product{spec.products_using === 1 ? '' : 's'}
            </button>
            {spec.print_ready > 0 && <span className="ml-2">· {spec.print_ready} with released artwork</span>}
            {spec.updated_at && <span className="ml-2 text-gray-400">· updated {String(spec.updated_at).slice(0, 10)}</span>}
          </p>
        </div>
        {canEdit && !editing && (
          <button type="button" onClick={() => { setEditing(true); setNote(''); }} data-spec-edit
            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-gray-300 text-sm text-gray-700 hover:bg-gray-50">
            <Pencil size={13} /> Edit
          </button>
        )}
      </header>

      {showProducts && (
        <ul className="flex flex-wrap gap-1.5" data-spec-products>
          {spec.products.length === 0 && <li className="text-xs text-gray-400">No product is on this spec yet.</li>}
          {spec.products.map((p) => (
            <li key={p.sku}>
              <button type="button" onClick={() => onOpenSku?.(p.sku)} title={p.flavor || ''}
                className="text-[11px] font-mono px-1.5 py-0.5 rounded border border-gray-200 bg-gray-50 hover:bg-powder-50 hover:border-powder-300">
                {p.sku}
              </button>
            </li>
          ))}
        </ul>
      )}

      {note && <p className="text-[12px] text-green-800 bg-green-50 border border-green-200 rounded-lg px-3 py-2" data-spec-saved>{note}</p>}

      {editing ? (
        <SpecForm spec={spec} onCancel={() => setEditing(false)}
          onSaved={(updated, changed) => {
            setEditing(false);
            setSaved(updated);
            setNote(changed?.length
              ? `Saved ${changed.length} field${changed.length === 1 ? '' : 's'} — now read by ${updated.products_using} product${updated.products_using === 1 ? '' : 's'}.`
              : 'Nothing changed.');
            onSaved();
          }} />
      ) : (
        GROUPS.filter((g) => g !== 'identity').map((g) => (
          <dl key={g} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-x-4 gap-y-2 text-sm" data-spec-group={g}>
            {SPEC_FIELDS.filter((f) => f.group === g).map((f) => {
              const v = display(f, spec[f.key]);
              const na = !appliesTo(f.key, spec.format);
              return (
                <div key={f.key} className={f.kind === 'long' ? 'sm:col-span-2' : ''} data-spec-value={f.key}>
                  <dt className="text-xs text-gray-500">{f.label}</dt>
                  <dd className="text-gray-900 break-words">
                    {v ?? (na ? <span className="text-gray-400 italic">n/a by format</span> : <span className="text-gray-300">—</span>)}
                  </dd>
                </div>
              );
            })}
          </dl>
        ))
      )}
    </section>
  );
}

export default function PackagingSpecsPanel({ canEdit, focus, onOpenSku, onChanged }) {
  const { data, error, refresh } = useApiGet('/products/specs');
  const [adding, setAdding] = useState(false);
  const specs = data?.specs || [];
  const missingMaterial = specs.filter((s) => s.products_using > 0 && !s.material_structure);

  return (
    <div className="space-y-4" data-packaging-specs>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="text-sm text-gray-600 max-w-2xl">
          <Layers size={15} className="inline -mt-0.5 mr-1 text-powder-600" />
          One spec is one film, one price tier and one thing the vendor quotes. Every product on a spec reads
          these values, and <code className="text-xs">master.csv</code> hands the film fields to the artwork proofer.
          Leave a dimension blank when it is unknown or does not apply — a 0 would read as measured.
        </p>
        {canEdit && !adding && (
          <button type="button" onClick={() => setAdding(true)} data-spec-new
            className="inline-flex items-center gap-1 px-3 py-2 rounded-lg bg-powder-600 text-white text-sm font-medium hover:bg-powder-700">
            <Plus size={14} /> New spec
          </button>
        )}
      </div>

      {missingMaterial.length > 0 && (
        <p className="text-sm text-amber-900 bg-amber-50 border border-amber-200 rounded-lg p-3 flex items-start gap-2" data-spec-gap>
          <AlertTriangle size={15} className="mt-0.5 shrink-0" />
          <span>
            {missingMaterial.map((s) => s.spec_id).join(', ')} {missingMaterial.length === 1 ? 'has' : 'have'} no material recorded,
            so the “Packaging spec” readiness step is open on every product using {missingMaterial.length === 1 ? 'it' : 'them'}.
          </span>
        </p>
      )}

      {adding && (
        <section className="bg-white border border-powder-300 rounded-xl p-4 space-y-3">
          <header className="flex items-center justify-between">
            <h3 className="font-semibold text-gray-900">New packaging spec</h3>
            <button type="button" onClick={() => setAdding(false)} className="text-gray-400 hover:text-gray-600" aria-label="Close"><X size={16} /></button>
          </header>
          <p className="text-xs text-gray-500">A second size or a new film is its own spec — one spec is one PO.</p>
          <SpecForm spec={{}} isNew onCancel={() => setAdding(false)} onSaved={() => { setAdding(false); refresh(); onChanged?.(); }} />
        </section>
      )}

      {error && <p className="text-sm text-red-700">{error}</p>}
      {!data && !error && <p className="text-sm text-gray-500">Loading…</p>}
      {specs.map((s) => (
        <SpecCard key={s.spec_id} spec={s} canEdit={canEdit} focused={focus === s.spec_id}
          onOpenSku={onOpenSku} onSaved={() => { refresh(); onChanged?.(); }} />
      ))}
    </div>
  );
}
