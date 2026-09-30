import { useState, useMemo } from 'react';
import { RecordCard, RecordCards } from '../common/RecordCards.jsx';
import { useApiGet, apiFetch, apiUpload, apiDelete } from '../../hooks/useApi';
import { useAuth } from '../../hooks/useAuth';
import { useTableSort } from '../../lib/useTableSort';
import ModuleTabs from '../common/ModuleTabs.jsx';
import ProductDataHealth from './ProductDataHealth.jsx';
import FlavorCodesPanel, { DraftRealign } from './FlavorCodesPanel.jsx';
import ProductBarcodes from './ProductBarcodes.jsx';
import ProductShelf from './ProductShelf.jsx';
import ProductCompleteness from './ProductCompleteness.jsx';
import ProductGrid from './ProductGrid.jsx';
import { getParam } from '../../lib/deepLink.js';
import NfpBoard, { NfpForSku } from './NfpPanel.jsx';
import { hexDigits, pmsValid, hexValid, colorIssues, isBlankSlot } from '../../../shared/product-colors.js';
import { FIELD_RULES, NA_FIELDS, fieldState, PACKAGING_DERIVED, isRollFed } from '../../../shared/product-fields.js';
import {
  Package, Search, X, AlertTriangle, CheckCircle2, Circle, Pencil, Stethoscope, Tag,
  Barcode, Upload, ExternalLink, RefreshCw, FolderOpen,
  FileText, Plus, Trash2, Palette,
  ListChecks,
} from 'lucide-react';

/**
 * Brand colours, and the one place they can be corrected.
 *
 * These were loaded once from the audited colour list and there has never been
 * a way to change one — so a Pantone reference transcribed wrongly stayed
 * wrong, and went out on `master.csv` to the proofing service, which matches a
 * PDF's separation NAMES against it. That is a pack checked against the wrong
 * ink with nothing on any screen saying so.
 *
 * Nothing refreshes this table, so an edit made here is not at risk of being
 * overwritten: the seeder that filled it skips entirely once the catalogue has
 * rows, and no other writer exists.
 *
 * The validity shown as you type comes from the SAME function the server
 * stores `pms_valid` / `hex_valid` with (`shared/product-colors.js`), so the
 * swatch cannot promise a save the server would refuse.
 */
function ColorEditor({ sku, colors, canEdit, onSaved }) {
  const [editing, setEditing] = useState(false);
  const [rows, setRows] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const open = () => {
    setRows((colors || []).map((c) => ({ pms: c.pms || '', hex: c.hex || '' })));
    setError('');
    setEditing(true);
  };
  const set = (i, k) => (e) =>
    setRows((p) => p.map((r, j) => (j === i ? { ...r, [k]: e.target.value } : r)));

  const filled = rows.filter((r) => !isBlankSlot(r));
  const problems = filled.flatMap((r, i) => colorIssues(r).map((m) => `Color ${i + 1}: ${m}`));

  const save = async () => {
    setBusy(true); setError('');
    try {
      await apiFetch(`/products/${encodeURIComponent(sku)}/colors`, {
        method: 'PUT', body: { colors: filled },
      });
      setEditing(false);
      onSaved?.();
    } catch (e) { setError(e.message); }
    setBusy(false);
  };

  // The swatch is drawn only from a hex the validator accepts. A box painted
  // from an unusable value renders black, which reads as a colour somebody
  // chose rather than as a value nothing can use.
  const Swatch = ({ hex }) => (
    <span className="w-3.5 h-3.5 rounded-sm border border-gray-300 shrink-0"
      style={{ background: hexValid(hex) ? `#${hexDigits(hex)}` : 'transparent' }} />
  );

  if (!editing) {
    return (
      <div data-colors-block>
        <div className="flex items-center justify-between gap-2 mb-1">
          <p className="text-xs font-medium text-gray-600">Brand colors</p>
          {canEdit && (
            <button type="button" data-edit-colors onClick={open}
              className="inline-flex items-center gap-1 text-xs text-powder-700 hover:underline">
              <Pencil size={11} /> Correct
            </button>
          )}
        </div>
        {colors?.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {colors.map((c) => (
              <span key={c.id} data-color-slot={c.slot}
                className="inline-flex items-center gap-1.5 text-xs border border-gray-200 rounded px-2 py-1">
                <Swatch hex={c.hex} />
                <span className={c.pms_valid ? '' : 'text-red-600'}>{c.pms || '—'}</span>
                <span className={c.hex_valid ? 'text-gray-400' : 'text-red-600'}>{c.hex || '—'}</span>
              </span>
            ))}
          </div>
        ) : (
          <p className="text-xs text-gray-500">None recorded.</p>
        )}
      </div>
    );
  }

  return (
    <div data-colors-block className="rounded-lg border border-powder-200 bg-powder-50/40 p-2.5 space-y-2">
      <p className="text-xs font-medium text-gray-700 flex items-center gap-1.5">
        <Palette size={13} className="text-powder-600" /> Brand colors
      </p>
      <p className="text-[11px] text-gray-600">
        These go out on the master list the artwork proofer checks every pack against, and it matches the
        Pantone name against the file&rsquo;s own separations. Correcting one here is permanent — nothing
        re-imports this list.
      </p>
      {rows.map((r, i) => (
        <div key={i} className="flex items-center gap-1.5">
          <Swatch hex={r.hex} />
          <input type="text" data-color-pms={i} value={r.pms} onChange={set(i, 'pms')}
            placeholder="PMS 158 C"
            className={`flex-1 min-w-0 border rounded px-2 py-1 text-xs ${r.pms && !pmsValid(r.pms) ? 'border-red-400 bg-red-50' : 'border-gray-300'}`} />
          <input type="text" data-color-hex={i} value={r.hex} onChange={set(i, 'hex')}
            placeholder="HEX EE7623"
            className={`w-32 border rounded px-2 py-1 text-xs ${r.hex && !hexValid(r.hex) ? 'border-red-400 bg-red-50' : 'border-gray-300'}`} />
          <button type="button" data-remove-color={i} onClick={() => setRows((p) => p.filter((_, j) => j !== i))}
            className="text-gray-400 hover:text-red-600 shrink-0" title="Remove this color">
            <Trash2 size={13} />
          </button>
        </div>
      ))}
      <button type="button" data-add-color onClick={() => setRows((p) => [...p, { pms: '', hex: '' }])}
        className="inline-flex items-center gap-1 text-xs text-powder-700 hover:underline">
        <Plus size={12} /> Add a color
      </button>

      {problems.length > 0 && (
        <ul data-color-problems className="text-xs text-red-700 space-y-0.5 list-disc pl-4">
          {problems.map((m) => <li key={m}>{m}</li>)}
        </ul>
      )}
      {error && <p className="text-xs text-red-700 bg-red-50 rounded p-2">{error}</p>}

      <div className="flex gap-2">
        <button type="button" data-save-colors onClick={save} disabled={busy || problems.length > 0}
          className="px-3 py-1.5 bg-powder-600 text-white rounded-lg text-xs font-medium disabled:opacity-50">
          {busy ? 'Saving…' : 'Save colors'}
        </button>
        <button type="button" onClick={() => setEditing(false)}
          className="px-3 py-1.5 border border-gray-300 rounded-lg text-xs">Cancel</button>
      </div>
      <p className="text-[11px] text-gray-500">
        Saving re-dates the brand-colors step, so the artwork step goes back on the punch list —
        a pack released against a different ink is a pack worth looking at again.
      </p>
    </div>
  );
}

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
  // What this SKU would be under the new standard — NOT IN USE, and the header
  // says so. Derived on read from the flavour register, so it moves as
  // collisions are broken rather than needing a refresh.
  { key: 'preferred_sku', label: 'New standard (not in use)' },
  { key: 'flavor', label: 'Product' },
  { key: 'gtin', label: 'GTIN' },
  { key: 'category', label: 'Category' },
  { key: 'pack', label: 'Pack' },
  { key: 'status', label: 'Status' },
  { key: 'readiness_done', label: 'Ready', type: 'number', align: 'right' },
  { width: '2rem' },
];

const PACK_LABEL = {
  PLG: 'Pouch — large', PSM: 'Pouch — small', STK: 'Stick', BOX: 'Carton', CUP: 'Cup', BTL: 'Bottle',
};

const STATUS_STYLE = {
  active: 'bg-green-100 text-green-800',
  in_development: 'bg-blue-100 text-blue-800',
  concept: 'bg-gray-100 text-gray-700',
  on_hold: 'bg-amber-100 text-amber-800',
  discontinued: 'bg-red-100 text-red-800',
};
const pretty = (s) => (s || '').replace(/_/g, ' ');

/**
 * What this product still owes — and what stopped being true.
 *
 * THE CHECKLIST IS THE CONTROL, which is the whole simplification. The three
 * steps that record work done elsewhere (a formula approved in the MRP, a
 * listing in Shopify, a sync to ShipHero) are ticked right here. They used to
 * be free-text boxes further down the form holding "Yes" and a number this
 * product's own SKU already carried: slower to fill in, impossible to un-set,
 * and recording neither who said so nor when.
 *
 * THREE STATES, NOT TWO. A step whose inputs have since moved is neither done
 * nor untouched — it is amber, it names what changed, and it does not count
 * towards the total. Correcting a GTIN used to leave eight green ticks over a
 * pack that must not print.
 */
function ReadinessChecklist({ readiness, sku, canEdit, onChanged }) {
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const { steps, missing, stale } = readiness;

  const toggle = async (step, on) => {
    setBusy(step.key); setError('');
    try {
      await apiFetch(`/products/${encodeURIComponent(sku)}/confirm/${step.key}`, { method: 'POST', body: { on } });
      onChanged?.();
    } catch (e) { setError(e.message); }
    setBusy('');
  };

  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
      <p className="text-sm font-semibold text-amber-900 flex items-center gap-1.5">
        <AlertTriangle size={15} /> {missing.length} still outstanding
      </p>
      {stale.length > 0 && (
        <p className="mt-1 text-xs text-amber-800">
          {stale.length === 1 ? '1 step needs' : `${stale.length} steps need`} re-checking — something they
          were signed off against has changed since.
        </p>
      )}
      {error && <p className="mt-1 text-xs text-red-700">{error}</p>}
      <ul className="mt-2 space-y-1">
        {steps.map((s) => {
          const stale_ = s.state === 'stale';
          return (
            <li key={s.key} className="text-sm">
              <div className="flex items-start gap-2">
                {/* A tickable step is a real checkbox; everything else is
                    evidence-driven and must never be clickable, or the record
                    would say a panel was approved because somebody ticked it. */}
                {s.tick && canEdit ? (
                  <input type="checkbox" checked={s.state === 'done'} disabled={busy === s.key}
                    onChange={(e) => toggle(s, e.target.checked)}
                    aria-label={s.label}
                    className="mt-0.5 h-3.5 w-3.5 rounded border-gray-300 text-powder-600 shrink-0 cursor-pointer" />
                ) : stale_ ? <RefreshCw size={14} className="text-amber-600 shrink-0 mt-0.5" />
                  : s.state === 'done' ? <CheckCircle2 size={14} className="text-green-600 shrink-0 mt-0.5" />
                    : <Circle size={14} className="text-gray-300 shrink-0 mt-0.5" />}
                <div className="min-w-0">
                  <span className={s.state === 'done' ? 'text-gray-500 line-through'
                    : stale_ ? 'text-amber-900 font-medium' : 'text-gray-900'}>{s.label}</span>
                  {stale_ && (
                    <span className="ml-1.5 text-xs text-amber-800">
                      · {s.changed_labels.join(' and ')} changed{s.tick ? ' — confirm again' : ''}
                    </span>
                  )}
                  {stale_ && s.redo && <div className="text-xs text-amber-700">{s.redo}</div>}
                  {/* EVERY LINE SAYS WHY — the record that makes it done, or what is
                      missing. A tick with no reason is the Artwork status dropdown
                      all over again (D-131). */}
                  {s.reason && <div className="text-[11px] text-gray-500" data-readiness-reason={s.key}>{s.reason}</div>}
                  {s.state === 'done' && s.tick && s.by && (
                    <span className="ml-1.5 text-xs text-gray-400">{s.by}{s.at ? ` · ${s.at.slice(0, 10)}` : ''}</span>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

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

/**
 * The GS1 barcode ARTWORK — the PNG that comes off the GS1 site.
 *
 * The GTIN is the number and the catalogue has always held it; this is the
 * image a designer actually places on a pack, and until now there was nowhere
 * to keep it, so it lived in somebody's downloads folder and was re-fetched
 * every time artwork was revised.
 *
 * THE STALE WARNING IS THE POINT. A barcode image encodes ONE number, so if the
 * GTIN is corrected after the image was uploaded the file on record is wrong —
 * and a wrong barcode reaching print is a relabel. The record remembers which
 * GTIN it was made for and says so rather than serving it as though it still
 * matched.
 */
function BarcodeImage({ sku, gtin, canEdit, has, stale, forGtin, onChanged }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [meta, setMeta] = useState(null);

  const upload = async (e) => {
    const files = [...(e.target.files || [])];
    e.target.value = '';
    if (!files.length) return;
    setBusy(true); setError('');
    try {
      const fd = new FormData();
      fd.append('files', files[0]);
      await apiUpload(`/products/${encodeURIComponent(sku)}/barcode`, fd);
      setMeta(null);
      onChanged?.();
    } catch (err) { setError(err.message); }
    setBusy(false);
  };

  const view = async () => {
    setError('');
    try {
      const r = await apiFetch(`/products/${encodeURIComponent(sku)}/barcode`);
      setMeta(r);
      window.open(r.url, '_blank', 'noopener');
    } catch (err) { setError(err.message); }
  };

  const remove = async () => {
    if (!window.confirm('Remove the barcode image?')) return;
    setBusy(true); setError('');
    try { await apiDelete(`/products/${encodeURIComponent(sku)}/barcode`); setMeta(null); onChanged?.(); }
    catch (err) { setError(err.message); }
    setBusy(false);
  };

  return (
    <div className="pt-2 border-t border-gray-100 space-y-2">
      <h4 className="text-sm font-semibold text-gray-900 flex items-center gap-1.5">
        <Barcode size={15} className="text-powder-600" /> GS1 barcode image
      </h4>

      {!gtin ? (
        <p className="text-xs text-gray-500">
          No GS1 number on this product yet — assign the GTIN before attaching its barcode.
        </p>
      ) : (<>
        {stale && (
          <p className="text-xs text-red-800 bg-red-50 border border-red-200 rounded-lg px-2.5 py-1.5">
            <strong>This image is for a different number.</strong> It was made for {forGtin}, and this
            product is now {gtin}. Do not send it to artwork — upload the barcode for {gtin}.
          </p>
        )}
        <div className="flex flex-wrap items-center gap-2">
          {has && (
            <button type="button" onClick={view}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 border border-gray-300 rounded-lg text-xs font-medium hover:bg-gray-50">
              <ExternalLink size={13} /> View barcode
            </button>
          )}
          {canEdit && (
            <label className="inline-flex items-center gap-1.5 px-2.5 py-1.5 border border-gray-300 rounded-lg text-xs font-medium cursor-pointer hover:bg-gray-50">
              <Upload size={13} /> {busy ? 'Uploading…' : has ? 'Replace' : 'Attach barcode'}
              <input type="file" className="hidden" accept="image/*,application/pdf" onChange={upload} />
            </label>
          )}
          {has && canEdit && (
            <button type="button" onClick={remove} disabled={busy}
              className="text-xs font-medium text-gray-400 hover:text-red-600">Remove</button>
          )}
          {!has && <span className="text-xs text-gray-500">Nothing on file.</span>}
        </div>
        {meta?.uploaded_by && (
          <p className="text-[11px] text-gray-500">
            {meta.filename} — uploaded by {meta.uploaded_by} for {meta.gtin}
          </p>
        )}
      </>)}
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}


/**
 * A field on the drawer's edit form, with its rule beside it and the NA control
 * where the field may carry one. `state` is value / empty / na (shared/product-fields.js).
 */
function Field({ k, label, hint, form, set, p, onNa, type = 'text', children }) {
  const rule = FIELD_RULES[k];
  const st = fieldState(p, k);
  const naable = NA_FIELDS.includes(k);
  return (
    <label className="block" data-field={k} data-field-state={st}>
      <span className="text-xs font-medium text-gray-600 flex items-center gap-2">
        {label}
        {st === 'na' && <span className="px-1.5 rounded bg-gray-100 text-gray-500 border border-gray-200 text-[10px]" data-na>NA — {p.na?.[k]?.by || 'unknown'}</span>}
        {naable && onNa && (st === 'na'
          ? <button type="button" onClick={() => onNa(k, false)} data-na-clear className="text-[10px] text-gray-500 hover:underline">Clear NA</button>
          : <button type="button" onClick={() => onNa(k, true)} data-na-set className="text-[10px] text-gray-500 hover:underline">Mark not applicable</button>)}
      </span>
      {children || (
        <input value={form[k]} onChange={set(k)} type={type} disabled={st === 'na'}
          className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm disabled:bg-gray-50 disabled:text-gray-400" />
      )}
      {(hint || rule) && <span className="mt-1 block text-[11px] leading-snug text-gray-500">{hint || `Format: ${rule.expected}.`}</span>}
    </label>
  );
}

/** A read-only line whose value is derived, saying which column it was read from. */
function Derived({ label, value, source, na }) {
  return (
    <div data-derived={source} className="flex flex-col">
      <dt className="text-xs text-gray-500">{label}</dt>
      <dd className="text-gray-900 break-words">
        {na ? <span className="text-gray-400 italic">{na}</span> : (value ?? '') !== '' ? value : <span className="text-gray-300">—</span>}
        <span className="block text-[10px] text-gray-400 font-mono">{source}</span>
      </dd>
    </div>
  );
}

/** One readiness line with its reason — the record that makes it done, or what is missing. */
function StepLine({ steps, k }) {
  const st = (steps || []).find((x) => x.key === k);
  if (!st) return null;
  return (
    <div data-step-line={k} className="flex items-start gap-1.5 text-sm">
      {st.state === 'done' ? <CheckCircle2 size={14} className="text-green-600 mt-0.5 shrink-0" />
        : st.state === 'stale' ? <RefreshCw size={14} className="text-amber-600 mt-0.5 shrink-0" />
          : <Circle size={14} className="text-gray-300 mt-0.5 shrink-0" />}
      <span><span className="text-gray-900">{st.label}</span>
        {st.reason && <span className="block text-[11px] text-gray-500">{st.reason}</span>}</span>
    </div>
  );
}

const Block = ({ title, note, children, id }) => (
  <section data-block={id} className="border border-gray-200 rounded-lg p-3 space-y-2">
    <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500">{title}</h4>
    {note && <p className="text-[11px] text-gray-500">{note}</p>}
    {children}
  </section>
);

/**
 * The record page: four blocks in a fixed order (D-131).
 *
 *   Identity      — sku, GTIN, product name, base flavour, pack, line, status.
 *                   The pack format decides which packaging fields apply.
 *   Formula link  — formula ref, formula version, fill weight. The formula
 *                   itself lives in Keychain; these are the pointer (D-128).
 *   Packaging     — DERIVED and read-only: the packaging spec's columns, the
 *                   colour slots, each naming the column it came from. The eye
 *                   mark and die line are typed on the product and say so.
 *   Channels      — Shopify, ShipHero, Amazon: the confirmations with a name
 *                   and a date, and the identifiers each channel keys on.
 *
 * THERE IS NO ARTWORK STATUS FIELD. The readiness line derives it from the
 * release on the Artwork board and states the reason.
 */
function Detail({ sku, canEdit, onClose, onSaved }) {
  const { data, refresh } = useApiGet(`/products/${encodeURIComponent(sku)}`);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const p = data;
  const startEdit = () => {
    setForm({
      gtin: p.gtin || '', flavor: p.flavor || '', base_flavor: p.base_flavor || '', category: p.category || '',
      pack: p.pack || 'PLG', status: p.status || 'active', legacy_sku: p.legacy_sku || '',
      eyemark_color: p.eyemark_color || '', dieline_required: p.dieline_required ? '1' : '0',
      drive_url: p.drive_url || '', notes: p.notes || '',
      fill_weight_g: p.fill_weight_g ?? '',
      // The CURRENT formula: what a panel's provenance is checked against (D-128).
      mrp_formula_id: p.mrp_formula_id || '', formula_rev: p.formula_rev || '',
      shopify_sku: p.shopify_sku || '',
      // Blank is a real answer here — "nobody has said yet" — so it is an
      // option in the select rather than an absence.
      amazon_channel: p.amazon_channel || '', amazon_sku: p.amazon_sku || '', amazon_asin: p.amazon_asin || '',
    });
    setEditing(true);
  };
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const save = async () => {
    setSaving(true); setError('');
    try {
      const body = { ...form, dieline_required: form.dieline_required === '1' ? 1 : 0 };
      // A field marked NA is not sent: it is disabled on the form and a blank
      // would read as "clear it", which it is not.
      for (const k of Object.keys(body)) if (fieldState(p, k) === 'na') delete body[k];
      await apiFetch(`/products/${encodeURIComponent(sku)}`, { method: 'PUT', body });
      setEditing(false); refresh(); onSaved?.();
    } catch (e) { setError(e.message); }
    setSaving(false);
  };
  const onNa = async (field, on) => {
    setError('');
    try {
      await apiFetch(`/products/${encodeURIComponent(sku)}/na`, { method: 'POST', body: { field, on } });
      refresh(); onSaved?.();
    } catch (e) { setError(e.message); }
  };

  const rollFed = p ? (p.spec_format ? isRollFed(p.spec_format) : true) : true;
  const naText = p && !rollFed ? `not applicable — a ${String(p.spec_format).toLowerCase()} is not roll-fed film` : null;

  return (
    <div className="fixed inset-0 bg-black/30 z-50 flex justify-end" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()}
        className="bg-white w-full max-w-xl h-full overflow-y-auto p-5 space-y-4 shadow-xl" data-product-drawer>
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
              <ReadinessChecklist readiness={p.readiness} sku={sku} canEdit={canEdit}
                onChanged={() => { refresh(); onSaved?.(); }} />
            )}

            {!p.gtin_valid && p.gtin && (
              <p className="text-sm text-red-800 bg-red-50 border border-red-200 rounded-lg p-3">
                <strong>{p.gtin}</strong> fails its GS1 check digit. Do not send this to a printer.
              </p>
            )}
            {error && <p className="text-sm text-red-700 bg-red-50 rounded p-2" data-drawer-error>{error}</p>}

            {editing ? (
              <div className="space-y-3">
                <Block id="identity" title="Identity">
                  <Field k="flavor" label="Product name" form={form} set={set} p={p} />
                  <Field k="base_flavor" label="Base flavor" form={form} set={set} p={p} hint="What joins a flavor across formats; the flavor register keys on it." />
                  <Field k="gtin" label="GTIN" form={form} set={set} p={p} />
                  <Field k="category" label="Line" form={form} set={set} p={p} hint="The product line, e.g. Whey Protein." />
                  <Field k="pack" label="Pack format" form={form} set={set} p={p} hint="Decides which packaging fields apply: film fed off a roll carries a wind direction and an eye mark; a carton or cup has neither.">
                    <select value={form.pack} onChange={set('pack')} className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm">
                      {Object.entries(PACK_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </select>
                  </Field>
                  <Field k="legacy_sku" label="Legacy SKU" form={form} set={set} p={p} onNa={onNa} hint="Set by a rename, never cleared; a two-year-old PO must still resolve." />
                </Block>
                <Block id="formula" title="Formula link" note="The formula lives in Keychain. These three say which one this product is made to today (D-128).">
                  <Field k="mrp_formula_id" label="Formula ref (current)" form={form} set={set} p={p} />
                  <Field k="formula_rev" label="Formula version (current)" form={form} set={set} p={p} />
                  {/* What the pack actually HOLDS, in grams — the proofer's Net
                      Weight check divides by it. The hint is load-bearing: this
                      is the only input to that check that is not printed on the
                      artwork (D-093). */}
                  <Field k="fill_weight_g" label="Fill weight (g)" form={form} set={set} p={p}
                    hint="From the production formula, confirmed by weighing a sealed bag. Not the net weight printed on the pack — that is what this checks." />
                </Block>
                <Block id="packaging" title="Packaging spec" note="Material, print, trim and wind direction are the packaging spec's and are not typed here. Two facts are the product's own:">
                  <Field k="eyemark_color" label="Eye mark color" form={form} set={set} p={p} onNa={onNa}
                    hint={naText ? `Not applicable by format — ${naText}.` : 'Printed registration mark color, e.g. black.'} />
                  <Field k="dieline_required" label="Die line required" form={form} set={set} p={p}>
                    <select value={form.dieline_required} onChange={set('dieline_required')} className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm">
                      <option value="1">yes</option><option value="0">no</option>
                    </select>
                  </Field>
                </Block>
                <Block id="channels" title="Channels">
                  <Field k="status" label="Status" form={form} set={set} p={p}>
                    <select value={form.status} onChange={set('status')} className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm">
                      {Object.keys(STATUS_STYLE).map((s) => <option key={s} value={s}>{pretty(s)}</option>)}
                    </select>
                  </Field>
                  <Field k="shopify_sku" label="Shopify SKU" form={form} set={set} p={p} onNa={onNa} hint="Only when Shopify calls it something other than this product's SKU." />
                  <div className="border border-gray-200 rounded-lg p-3 space-y-3" data-amazon-edit>
                    <label className="block">
                      <span className="text-xs font-medium text-gray-600">Sold on Amazon?</span>
                      <select value={form.amazon_channel} onChange={set('amazon_channel')}
                        className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" data-amazon-channel>
                        <option value="">Not decided yet</option>
                        <option value="listed">Yes — listed on Amazon</option>
                        <option value="not_sold">No — not sold on Amazon</option>
                      </select>
                    </label>
                    {form.amazon_channel === 'listed' && (
                      <>
                        <Field k="amazon_sku" label="Amazon seller SKU" form={form} set={set} p={p} onNa={onNa} hint="Leave blank if it is the same as this product's SKU.">
                          <input value={form.amazon_sku} onChange={set('amazon_sku')} data-amazon-sku disabled={fieldState(p, 'amazon_sku') === 'na'}
                            className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm disabled:bg-gray-50" />
                        </Field>
                        <Field k="amazon_asin" label="ASIN" form={form} set={set} p={p} onNa={onNa}>
                          <input value={form.amazon_asin} onChange={set('amazon_asin')} data-amazon-asin disabled={fieldState(p, 'amazon_asin') === 'na'}
                            className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm disabled:bg-gray-50" />
                        </Field>
                        <p className="text-[11px] text-gray-500">
                          The listing hangs off the seller SKU, and FBA stock already in a fulfillment center is
                          bound to it — so <strong>Listed on Amazon</strong> goes amber whenever this product&apos;s
                          SKU or GTIN moves.
                        </p>
                      </>
                    )}
                  </div>
                  <Field k="drive_url" label="Drive link" form={form} set={set} p={p} onNa={onNa} />
                  <label className="block">
                    <span className="text-xs font-medium text-gray-600">Notes</span>
                    <textarea value={form.notes} onChange={set('notes')} rows={3}
                      className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
                  </label>
                </Block>
                <div className="flex gap-2">
                  <button onClick={save} disabled={saving} data-drawer-save
                    className="px-3 py-2 bg-powder-600 text-white rounded-lg text-sm font-medium disabled:opacity-50">
                    {saving ? 'Saving…' : 'Save'}
                  </button>
                  <button onClick={() => setEditing(false)}
                    className="px-3 py-2 border border-gray-300 rounded-lg text-sm">Cancel</button>
                </div>
              </div>
            ) : (
              <>
                <Block id="identity" title="Identity">
                  <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                    {[
                      ['SKU', <code key="s">{p.sku}</code>], ['GTIN', p.gtin], ['Product name', p.flavor], ['Base flavor', p.base_flavor],
                      ['Pack format', PACK_LABEL[p.pack] || p.pack], ['Line', p.category], ['Status', pretty(p.status)],
                      ['Legacy SKU', fieldState(p, 'legacy_sku') === 'na' ? 'NA' : p.legacy_sku],
                      ['Protein', fieldState(p, 'protein_type') === 'na' ? 'NA' : p.protein_type],
                      ['Pack count', fieldState(p, 'pack_count') === 'na' ? 'NA' : p.pack_count],
                    ].filter(([, v]) => v !== null && v !== undefined && v !== '').map(([label, v]) => (
                      <div key={label}><dt className="text-xs text-gray-500">{label}</dt><dd className="text-gray-900 break-words">{v}</dd></div>
                    ))}
                  </dl>
                  <StepLine steps={p.readiness?.steps} k="sku" /><StepLine steps={p.readiness?.steps} k="gtin" />
                </Block>
                <Block id="formula" title="Formula link" note="The formula lives in Keychain; this is the pointer the panel's provenance is checked against.">
                  <dl className="grid grid-cols-3 gap-x-4 gap-y-2 text-sm">
                    <div><dt className="text-xs text-gray-500">Formula ref</dt><dd data-value="mrp_formula_id">{p.mrp_formula_id || <span className="text-amber-700 text-xs">empty</span>}</dd></div>
                    <div><dt className="text-xs text-gray-500">Formula version</dt><dd data-value="formula_rev">{p.formula_rev || <span className="text-amber-700 text-xs">empty</span>}</dd></div>
                    <div><dt className="text-xs text-gray-500">Fill weight</dt><dd data-value="fill_weight_g">{p.fill_weight_g ? `${p.fill_weight_g} g` : <span className="text-amber-700 text-xs">empty</span>}</dd></div>
                    {/* Which date the pack may print, and what it rests on —
                        DERIVED from the shelf-life basis in force for this SKU
                        (Retention Samples → Stability), never typed here (D-133). */}
                    <div className="col-span-3">
                      <dt className="text-xs text-gray-500">Date type · shelf-life basis</dt>
                      <dd data-value="shelf_life" data-date-type={p.shelf_life?.date_type} data-basis-recorded={p.shelf_life?.recorded ? '1' : '0'}>
                        {p.shelf_life?.recorded
                          ? <>{p.shelf_life.date_type_label}{p.shelf_life.basis_label ? ` — ${p.shelf_life.basis_label}` : ''}{p.shelf_life.kind_missing ? <span className="text-amber-700 text-xs"> — kind not recorded on the justification</span> : ''}{p.shelf_life.shelf_life_months ? ` · ${p.shelf_life.shelf_life_months} months` : ''}{p.shelf_life.decided_on ? ` · ${p.shelf_life.decided_on}` : ''}</>
                          : <>Best by <span className="text-amber-700 text-xs">— no shelf-life basis recorded; record one under Retention Samples → Stability</span></>}
                        <span className="block text-[10px] text-gray-400 font-mono">derived: stability_justifications.basis_kind</span>
                      </dd>
                    </div>
                  </dl>
                  <StepLine steps={p.readiness?.steps} k="formula" /><StepLine steps={p.readiness?.steps} k="nfp" />
                </Block>
                <Block id="packaging" title="Packaging spec" note={`Derived from ${p.spec_id ? `packaging spec ${p.spec_id}` : 'the packaging spec (none assigned)'} and the color slots; each value names the column it was read from. Nothing here is typed on the product except the eye mark and the die line.`}>
                  <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm" data-packaging-derived>
                    <Derived label="Spec" value={p.spec_id ? `${p.spec_id}${p.spec_name ? ` — ${p.spec_name}` : ''}` : null} source="products.spec_id" />
                    <Derived label="Format" value={p.spec_format} source="packaging_specs.format" />
                    {PACKAGING_DERIVED.map(([k, label, source]) => (
                      <Derived key={k} label={label} value={p[k]} source={source}
                        na={k === 'wind_direction' && !rollFed ? naText : null} />
                    ))}
                    <Derived label="Eye mark color" value={fieldState(p, 'eyemark_color') === 'na' ? 'NA' : p.eyemark_color} source="products.eyemark_color (typed)" na={!rollFed && !p.eyemark_color ? naText : null} />
                    <Derived label="Die line required" value={p.dieline_required ? 'yes' : 'no'} source="products.dieline_required (typed)" />
                    <Derived label="PMS spot colors" value={(p.colors || []).filter((c) => c.pms).map((c) => c.pms).join(' | ')} source="product_colors.pms, slots in order" />
                    <Derived label="Hex spot colors" value={(p.colors || []).filter((c) => c.hex).map((c) => c.hex).join(' | ')} source="product_colors.hex, slots in order" />
                  </dl>
                  <StepLine steps={p.readiness?.steps} k="spec" /><StepLine steps={p.readiness?.steps} k="colors" /><StepLine steps={p.readiness?.steps} k="artwork" />
                  <ColorEditor sku={sku} colors={p.colors} canEdit={canEdit}
                    onSaved={() => { refresh(); onSaved?.(); }} />
                  <BarcodeImage sku={sku} gtin={p.gtin} canEdit={canEdit}
                    has={p.has_barcode_image} stale={p.barcode_stale} forGtin={p.barcode_gtin}
                    onChanged={() => { refresh(); onSaved?.(); }} />
                </Block>
                <Block id="channels" title="Channels">
                  <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                    {[
                      ['Status', pretty(p.status)],
                      // Only worth showing when Shopify calls it something else —
                      // for most of the catalogue it is this product's own SKU.
                      ['Shopify SKU', fieldState(p, 'shopify_sku') === 'na' ? 'NA' : p.shopify_sku && p.shopify_sku !== p.sku ? p.shopify_sku : null],
                      // "Not decided yet" is shown rather than hidden: a blank
                      // here is the fact that nobody has said.
                      ['Amazon', p.amazon_channel === 'listed'
                        ? `Listed${p.amazon_sku && p.amazon_sku !== p.sku ? ` — seller SKU ${p.amazon_sku}` : ''}${p.amazon_asin ? ` · ${p.amazon_asin}` : ''}`
                        : p.amazon_channel === 'not_sold' ? 'Not sold on Amazon' : 'Not decided yet'],
                      ['Drive link', fieldState(p, 'drive_url') === 'na' ? 'NA' : p.drive_url],
                    ].filter(([, v]) => v !== null && v !== undefined && v !== '').map(([label, v]) => (
                      <div key={label}><dt className="text-xs text-gray-500">{label}</dt><dd className="text-gray-900 break-words">{v}</dd></div>
                    ))}
                  </dl>
                  <StepLine steps={p.readiness?.steps} k="shopify" /><StepLine steps={p.readiness?.steps} k="shiphero" /><StepLine steps={p.readiness?.steps} k="amazon" />
                  {p.notes && <p className="text-sm text-gray-700 whitespace-pre-line">{p.notes}</p>}
                </Block>

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
                      Same flavor, other SKUs — a change here probably touches these
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
                  <button onClick={startEdit} data-drawer-edit
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
  // The flavours that still owe a code. Derived server-side from the live
  // catalogue, so it shrinks as decisions are made rather than needing a tick.
  const { data: flavorCodes } = useApiGet('/products/flavor-codes');
  const pendingCodes = flavorCodes?.needs_decision?.length || 0;
  // Fetched here so the tab badge and the board it opens are the same number,
  // the rule the other three tabs already follow.
  const { data: barcodes } = useApiGet('/products/barcodes');
  const barcodeGaps = barcodes ? barcodes.counts.stale + barcodes.counts.bad_gtin : 0;
  const { data: shelf } = useApiGet('/products/shelf');
  const shelfOwed = shelf ? shelf.due.length + shelf.missing.length : 0;
  // The grid's filter chips and completeness column read the same walk the
  // Completeness tab reads (D-128) — one derivation, two screens.
  const { data: completeness, refresh: refreshCompleteness } = useApiGet('/products/completeness');
  const [q, setQ] = useState('');
  const [category, setCategory] = useState('');
  const [pack, setPack] = useState('');
  const [open, setOpen] = useState(null);
  // `?tab=products&view=completeness` opens a tab directly (deepLink.js: a lazy
  // module mounts after App has consumed the query string).
  const [view, setView] = useState(() => getParam('view') || 'list');

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
      if (!needle) return true;
      return [p.sku, p.legacy_sku, p.gtin, p.flavor, p.base_flavor, p.shopify_sku]
        .some((v) => (v || '').toLowerCase().includes(needle));
    });
  }, [products, q, category, pack]);

  const { sorted } = useTableSort(filtered, COLUMNS, 'sku', 'asc');

  // Panels somebody still has to act on — drafts, links out, and ones sent back.
  const awaitingNfp = (nfp?.versions || [])
    .filter((v) => ['draft', 'sent', 'rejected'].includes(v.status)).length;

  const badGtin = products.filter((p) => p.gtin && !p.gtin_valid).length;
  const refreshAll = () => { refresh(); refreshCompleteness(); };

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
        { id: 'list', label: 'Catalog', icon: Package, badge: products.length },
        // Panels waiting on somebody. Counted here rather than left to be found
        // in a product drawer, because "who still owes us an approval" is the
        // question that holds artwork up.
        { id: 'nfp', label: 'Nutrition panels', icon: FileText,
          badge: awaitingNfp || undefined, badgeTone: awaitingNfp ? 'alert' : undefined },
        // The punch list lives beside the catalogue rather than in a document,
        // so it is counted live and shrinks as the data is fixed.
        { id: 'health', label: 'Data health', icon: Stethoscope,
          badge: health?.affected || undefined, badgeTone: health?.affected ? 'alert' : undefined },
        // The register the new SKU standard is built on. Badged with the
        // flavours that still owe a decision, because those are the ones whose
        // SKUs cannot be minted.
        { id: 'flavor-codes', label: 'Flavor codes', icon: Tag,
          badge: pendingCodes || undefined, badgeTone: pendingCodes ? 'alert' : undefined },
        // Badged on what must NOT print — a wrong number or a barcode image
        // encoding one. "No image yet" is a punch list item and lives on the
        // board; putting it in the badge would make the badge permanent.
        { id: 'barcodes', label: 'GTIN barcodes', icon: Barcode,
          badge: barcodeGaps || undefined, badgeTone: barcodeGaps ? 'alert' : undefined },
        { id: 'shelf', label: 'Registry', icon: FolderOpen,
          badge: shelfOwed || undefined, badgeTone: shelfOwed ? 'alert' : undefined },
        // The spec sheet's named gaps, per SKU and by line (D-128). No badge:
        // on a catalogue this young every SKU has gaps, and a permanent red
        // number is the wallpaper the first-sight rule exists to prevent.
        { id: 'completeness', label: 'Completeness', icon: ListChecks },
      ]} />

      {view === 'completeness' && <ProductCompleteness canEdit={canEdit} onOpenSku={(sku) => { setView('list'); setOpen(sku); }} />}

      {view === 'flavor-codes' && <FlavorCodesPanel />}
      {view === 'barcodes' && <ProductBarcodes onOpenSku={(sku) => { setView('list'); setOpen(sku); }} />}
      {view === 'shelf' && <ProductShelf canEdit={canEdit} />}

      {view === 'nfp' && <NfpBoard data={nfp} onOpenSku={(s) => { setView('list'); setOpen(s); }}
        canManage={canEdit} onChanged={refreshNfp} />}
      {view === 'health' && <ProductDataHealth data={health} />}

      {view === 'list' && (<>
      {/* A draft whose SKU disagrees with the New standard column, fixable here.
          The strip renders nothing once every draft matches the register, and
          the same component sits on the Flavor codes tab — a second copy is
          how the two screens would start offering different renames. */}
      <DraftRealign canEdit={canEdit} onDone={refresh} />
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
            placeholder="Search SKU, flavor, GTIN, Shopify SKU"
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
      </div>

      <p className="text-xs text-gray-500 md:hidden">
        {sorted.length} of {products.length}
      </p>

      {/* Below md the catalogue is cards, from the same sorted rows and the
          same row click as the table — one standard for every log. */}
      <RecordCards count={sorted.length} empty="Nothing matches. Loosen a filter.">
        {sorted.map((p) => (
          <RecordCard key={p.sku} onClick={() => setOpen(p.sku)}
            title={<code>{p.sku}</code>} subtitle={p.flavor}
            badge={<span className={`text-xs px-2 py-0.5 rounded-full ${STATUS_STYLE[p.status] || 'bg-gray-100 text-gray-700'}`}>{pretty(p.status)}</span>}
            fields={[
              { label: 'New standard', value: p.preferred_sku
                ? <code className="text-gray-500">{p.preferred_sku}</code>
                : <span className="text-[11px] text-amber-700">{(p.preferred_sku_blocked_by || [])[0] || ''}</span> },
              { label: 'GTIN', value: p.gtin ? <span className={!p.gtin_valid ? 'text-red-600 font-medium' : ''}>{p.gtin}</span> : null },
              { label: 'Category', value: p.category },
              { label: 'Pack', value: PACK_LABEL[p.pack] || p.pack },
              { label: 'Ready', value: <ReadyBar readiness={p.readiness} />, wide: true },
            ]} />
        ))}
      </RecordCards>
      {/* At md and up the catalogue is the GRID — edited in place, filtered
          by completeness state, exported and imported as CSV (D-131). The
          cards above are the same rows for a phone, which cannot edit a
          spreadsheet. */}
      <div className="hidden md:block">
        <ProductGrid products={filtered} completeness={completeness} canEdit={canEdit}
          onOpenSku={setOpen} onChanged={refreshAll} />
      </div>

      </>)}

      {open && <Detail sku={open} canEdit={canEdit} onClose={() => setOpen(null)}
        onSaved={() => { refreshAll(); refreshNfp(); }} />}
    </div>
  );
}
