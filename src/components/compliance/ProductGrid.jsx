// The catalogue as a grid you work in (D-131).
//
// One row per SKU, columns in four collapsible groups — Identity · Formula ·
// Packaging · Channels — plus the completeness state on the right. Click a
// cell to edit it in place: Enter saves and moves down, Tab saves and moves
// right, Esc cancels. Shift-click a second cell in the same column to select
// a run of rows and fill the top value down. The SKU cell opens the drawer.
//
// THREE RULES THAT ARE NOT DECORATION:
//  - VALIDATION IS THE SERVER'S and a refusal stays IN THE CELL, red, with the
//    expected format, until the value is fixed or the edit is cancelled. The
//    hint under the box comes from the same `FIELD_RULES` the server reads, so
//    the grid never promises a save the server refuses.
//  - NOT APPLICABLE IS A CONTROL, never a value. A cell in that state shows a
//    grey NA chip with who said so; the editor offers "Mark NA" / "Clear NA"
//    for the fields that may carry one, and typing "NA" into a box is refused
//    on Data health rather than treated as an answer.
//  - THE PACKAGING COLUMNS ARE DERIVED AND SAY WHERE FROM. Material, print,
//    trim and wind direction are the packaging spec's (`packaging_specs` via
//    `spec_id`); the tooltip names the column. They are not typed here.
//
// The CSV export is built from the rows and columns on the screen — the same
// filter, the same order — never a second endpoint. The import shows its diff
// before anything is committed and is refused whole while any cell is invalid.
import { useMemo, useRef, useState } from 'react';
import { apiFetch, apiPut } from '../../hooks/useApi';
import { useTableSort } from '../../lib/useTableSort';
import SortHeader from '../common/SortHeader';
import { FIELD_RULES, NA_FIELDS, fieldState, PACKAGING_DERIVED, isRollFed } from '../../../shared/product-fields.js';
import { ChevronDown, ChevronRight, Download, Upload, X, AlertTriangle } from 'lucide-react';

const PACK_LABEL = {
  PLG: 'Pouch — large', PSM: 'Pouch — small', STK: 'Stick', BOX: 'Carton', CUP: 'Cup', BTL: 'Bottle',
};
const STATUSES = ['active', 'in_development', 'concept', 'on_hold', 'discontinued'];
const pretty = (s) => (s || '').replace(/_/g, ' ');

const joinSlots = (colors, k) => (colors || []).filter((c) => c[k]).map((c) => c[k]).join(' | ');
const splitSlots = (v) => String(v || '').split('|').map((x) => x.trim()).filter(Boolean);

/**
 * The columns, grouped. `edit` names how a cell is edited: `text`, `select`
 * (with `options`), `colors` (pipe-delimited slots written through the
 * colours route) — absent means read-only. `get` reads the display value;
 * `source` is what the tooltip says a derived column comes from.
 */
const GROUPS = [
  { key: 'identity', label: 'Identity', columns: [
    { key: 'sku', label: 'SKU', door: true },
    { key: 'flavor', label: 'Product name', edit: 'text' },
    { key: 'base_flavor', label: 'Base flavour', edit: 'text' },
    { key: 'category', label: 'Line', edit: 'text' },
    { key: 'pack', label: 'Pack', edit: 'select', options: Object.keys(PACK_LABEL), render: (v) => PACK_LABEL[v] || v },
    { key: 'gtin', label: 'GTIN', edit: 'text' },
    { key: 'legacy_sku', label: 'Legacy SKU', edit: 'text' },
  ] },
  { key: 'formula', label: 'Formula link', columns: [
    { key: 'mrp_formula_id', label: 'Formula ref', edit: 'text' },
    { key: 'formula_rev', label: 'Formula version', edit: 'text' },
    { key: 'fill_weight_g', label: 'Fill weight (g)', edit: 'text', type: 'number' },
  ] },
  { key: 'packaging', label: 'Packaging spec', columns: [
    { key: 'spec_id', label: 'Spec', source: 'products.spec_id — the pointer; the spec sheet is edited on Specifications' },
    ...PACKAGING_DERIVED.filter(([k]) => ['material_structure', 'print_process', 'trim_length_mm', 'trim_width_mm', 'wind_direction'].includes(k))
      .map(([k, label, source]) => ({ key: k, label, source: `${source} via products.spec_id` })),
    { key: 'eyemark_color', label: 'Eye mark', edit: 'text' },
    { key: 'dieline_required', label: 'Die line', edit: 'select', options: ['1', '0'], render: (v) => (v === null || v === undefined ? '' : v ? 'yes' : 'no'), get: (p) => (p.dieline_required ? '1' : '0') },
    { key: 'pms', label: 'PMS spot colours', edit: 'colors', get: (p) => joinSlots(p.colors, 'pms') },
    { key: 'hex', label: 'Hex spot colours', edit: 'colors', get: (p) => joinSlots(p.colors, 'hex') },
  ] },
  { key: 'channels', label: 'Channels', columns: [
    { key: 'status', label: 'Status', edit: 'select', options: STATUSES, render: pretty },
    { key: 'shopify_sku', label: 'Shopify SKU', edit: 'text' },
    { key: 'shopify_listed_at', label: 'Shopify', get: (p) => stepReason(p, 'shopify') },
    { key: 'shiphero_synced_at', label: 'ShipHero', get: (p) => stepReason(p, 'shiphero') },
    { key: 'amazon_channel', label: 'Amazon', edit: 'select', options: ['', 'listed', 'not_sold'], render: (v) => (v === 'listed' ? 'listed' : v === 'not_sold' ? 'not sold' : '') },
    { key: 'amazon_sku', label: 'Amazon SKU', edit: 'text' },
    { key: 'amazon_asin', label: 'ASIN', edit: 'text' },
  ] },
];
const ALL_COLUMNS = GROUPS.flatMap((g) => g.columns);
const EDITABLE = ALL_COLUMNS.filter((c) => c.edit).map((c) => c.key);

function stepReason(p, key) {
  const s = (p.readiness?.steps || []).find((x) => x.key === key);
  if (!s) return '';
  return s.state === 'done' ? '✓' : s.state === 'stale' ? 'stale' : '—';
}

const rawOf = (p, col) => (col.get ? col.get(p) : p[col.key]);
const shown = (p, col) => {
  const v = rawOf(p, col);
  if (v === null || v === undefined || v === '') return '';
  return col.render ? col.render(v) : String(v);
};

const csvCell = (v) => {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
function download(name, text) {
  const blob = new Blob([text], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

const STATE_STYLE = {
  complete: 'bg-green-50 text-green-800 border-green-200',
  incomplete: 'bg-amber-50 text-amber-900 border-amber-200',
  blocked: 'bg-gray-100 text-gray-700 border-gray-300',
};

/** Whether a derived packaging column applies to this row's pack format. */
const applies = (p, key) => !(['wind_direction', 'eyemark_color'].includes(key) && p.spec_format && !isRollFed(p.spec_format));

function ImportModal({ onClose, onDone }) {
  const [csv, setCsv] = useState('');
  const [plan, setPlan] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [applied, setApplied] = useState(null);

  const pick = (e) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    const r = new FileReader();
    r.onload = () => setCsv(String(r.result || ''));
    r.readAsText(f);
  };
  const preview = async () => {
    setBusy(true); setError(''); setPlan(null);
    try { setPlan(await apiFetch('/products/import/preview', { method: 'POST', body: { csv } })); } catch (e) { setError(e.message); }
    setBusy(false);
  };
  const commit = async () => {
    setBusy(true); setError('');
    try {
      const r = await apiFetch('/products/import/commit', { method: 'POST', body: { csv } });
      setApplied(r.applied); onDone?.();
    } catch (e) { setError(e.message); }
    setBusy(false);
  };
  const c = plan?.counts;
  return (
    <div className="fixed inset-0 bg-black/30 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} data-import-modal
        className="bg-white rounded-xl shadow-xl w-full max-w-3xl max-h-[92vh] overflow-y-auto p-5 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-bold text-gray-900">Import a CSV</h3>
            <p className="text-sm text-gray-600">Rows are matched on <code>sku</code>. The file may carry the grid&apos;s columns or master.csv&apos;s names. You see every change before anything is written.</p>
          </div>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-700"><X size={20} /></button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="inline-flex items-center gap-1.5 px-3 py-2 border border-gray-300 rounded-lg text-sm cursor-pointer hover:bg-gray-50">
            <Upload size={14} /> Choose file
            <input type="file" accept=".csv,text/csv" className="hidden" onChange={pick} data-import-file />
          </label>
          <textarea value={csv} onChange={(e) => setCsv(e.target.value)} rows={3} data-import-text
            placeholder="…or paste CSV here: sku,formula ref,formula version"
            className="flex-1 min-w-[16rem] border border-gray-300 rounded-lg px-3 py-2 text-xs font-mono" />
          <button type="button" onClick={preview} disabled={busy || !csv.trim()} data-import-preview
            className="px-3 py-2 rounded-lg bg-gray-800 text-white text-sm font-medium disabled:opacity-50">Preview changes</button>
        </div>
        {error && <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded p-2" data-import-error>{error}</p>}
        {applied !== null && (
          <p className="text-sm text-green-800 bg-green-50 border border-green-200 rounded p-2" data-import-applied>
            Applied to {applied} SKU{applied === 1 ? '' : 's'}.
          </p>
        )}
        {plan && (
          <div className="space-y-2" data-import-plan>
            <div className="flex flex-wrap gap-2 text-xs">
              <span className="px-2 py-1 rounded-full border border-gray-300">{c.rows_in_file} rows in the file</span>
              <span className="px-2 py-1 rounded-full border border-gray-300" data-import-changes>{c.changes} change{c.changes === 1 ? '' : 's'} on {c.skus_changing} SKU{c.skus_changing === 1 ? '' : 's'}</span>
              {c.errors > 0 && <span className="px-2 py-1 rounded-full border border-red-300 bg-red-50 text-red-800" data-import-errors>{c.errors} refused</span>}
              {c.unknown_skus > 0 && <span className="px-2 py-1 rounded-full border border-amber-300 bg-amber-50 text-amber-900" title={plan.unknown_skus.join(', ')}>{c.unknown_skus} SKU{c.unknown_skus === 1 ? '' : 's'} not in the catalogue</span>}
              {plan.unknown_columns.length > 0 && <span className="px-2 py-1 rounded-full border border-gray-300 text-gray-600" title={plan.unknown_columns.join(', ')}>{plan.unknown_columns.length} column{plan.unknown_columns.length === 1 ? '' : 's'} ignored</span>}
            </div>
            {plan.rows.length === 0 ? <p className="text-sm text-gray-600">Nothing in the file differs from the catalogue.</p> : (
              <div className="overflow-x-auto border border-gray-200 rounded-lg">
                <table className="min-w-full text-xs">
                  <thead className="bg-gray-50 border-b border-gray-200">
                    <tr><th className="text-left px-2 py-1.5">SKU</th><th className="text-left px-2 py-1.5">Field</th><th className="text-left px-2 py-1.5">From</th><th className="text-left px-2 py-1.5">To</th></tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {plan.rows.flatMap((r) => (r.error
                      ? [<tr key={r.sku} data-import-row={r.sku}><td className="px-2 py-1 font-mono">{r.sku}</td><td colSpan={3} className="px-2 py-1 text-red-700">{r.error}</td></tr>]
                      : r.changes.map((ch, i) => (
                        <tr key={`${r.sku}-${ch.field}-${i}`} data-import-row={r.sku} data-import-field={ch.field} data-import-cell-error={ch.error ? '1' : undefined}
                          className={ch.error ? 'bg-red-50' : ''}>
                          <td className="px-2 py-1 font-mono">{r.sku}</td>
                          <td className="px-2 py-1">{ALL_COLUMNS.find((x) => x.key === ch.field)?.label || ch.field}</td>
                          <td className="px-2 py-1 text-gray-500">{ch.from || <em className="text-gray-400">empty</em>}</td>
                          <td className="px-2 py-1">{ch.error ? <span className="text-red-700">{ch.to} — {ch.error}</span> : (ch.to || <em className="text-gray-400">cleared</em>)}</td>
                        </tr>
                      ))))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="flex items-center gap-2">
              <button type="button" onClick={commit} disabled={busy || c.errors > 0 || c.changes === 0 || applied !== null} data-import-commit
                className="px-3 py-2 rounded-lg bg-powder-600 text-white text-sm font-medium disabled:opacity-50">
                Commit {c.changes} change{c.changes === 1 ? '' : 's'}
              </button>
              {c.errors > 0 && <span className="text-xs text-red-700">Fix the refused cells in the file first — nothing is written while any stand.</span>}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function ProductGrid({ products, completeness, canEdit, onOpenSku, onChanged }) {
  const [filter, setFilter] = useState('all');
  const [collapsed, setCollapsed] = useState(() => new Set());
  const [editing, setEditing] = useState(null); // { sku, field }
  const [draft, setDraft] = useState('');
  const [cellError, setCellError] = useState(null); // { sku, field, message }
  const [sel, setSel] = useState(null); // { field, skus: [], anchor }
  const [busy, setBusy] = useState(false);
  const [importing, setImporting] = useState(false);
  const inputRef = useRef(null);

  const compBySku = useMemo(() => new Map((completeness?.rows || []).map((r) => [r.sku, r])), [completeness]);

  // The chips count what is on THIS screen under the other filters, so a
  // number and the rows under it cannot disagree.
  const counts = useMemo(() => {
    const c = { all: products.length, incomplete: 0, blocked: 0, stale: 0, complete: 0 };
    for (const p of products) {
      const r = compBySku.get(p.sku);
      if (!r) continue;
      c[r.state] += 1;
      if (r.stale?.length) c.stale += 1;
    }
    return c;
  }, [products, compBySku]);

  const visible = useMemo(() => products.filter((p) => {
    if (filter === 'all') return true;
    const r = compBySku.get(p.sku);
    if (!r) return false;
    return filter === 'stale' ? r.stale?.length > 0 : r.state === filter;
  }), [products, filter, compBySku]);

  const sortCols = useMemo(() => ALL_COLUMNS.map((c) => ({ key: c.key, label: c.label, type: c.type, sortValue: (p) => rawOf(p, c) })), []);
  const { sorted, sortCol, sortDir, toggleSort } = useTableSort(visible, sortCols, 'sku', 'asc');
  const order = useMemo(() => sorted.map((p) => p.sku), [sorted]);

  const groupsShown = GROUPS.map((g) => ({ ...g, open: !collapsed.has(g.key) }));
  const toggleGroup = (key) => setCollapsed((s) => { const n = new Set(s); if (n.has(key)) n.delete(key); else n.add(key); return n; });

  const colOf = (field) => ALL_COLUMNS.find((c) => c.key === field);

  const startEdit = async (p, col, e) => {
    if (!canEdit || !col.edit) return;
    if (e?.shiftKey && sel && sel.field === col.key) {
      // Extend the selection from the anchor to this row, in screen order.
      const a = order.indexOf(sel.anchor); const b = order.indexOf(p.sku);
      const [lo, hi] = a < b ? [a, b] : [b, a];
      setSel({ field: col.key, skus: order.slice(lo, hi + 1), anchor: sel.anchor });
      e.preventDefault();
      return;
    }
    // Clicking a second cell commits the first. The td's mousedown is
    // prevented (below) so the open input does NOT blur first — a blur-commit
    // re-rendering under the click swallowed the click entirely, and a
    // shift-click could never extend a selection. A refused value keeps its
    // cell open and the click goes nowhere.
    if (editing && (editing.sku !== p.sku || editing.field !== col.key)) {
      const ok = await commit();
      if (!ok) return;
    }
    setEditing({ sku: p.sku, field: col.key });
    const v = rawOf(p, col);
    setDraft(v === null || v === undefined ? '' : String(v));
    setCellError(null);
    setSel({ field: col.key, skus: [p.sku], anchor: p.sku });
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const cancel = () => { setEditing(null); setCellError(null); };

  /** Save the draft. Resolves true when saved (or unchanged), false when refused — the cell stays open. */
  const commit = async () => {
    if (!editing) return true;
    const p = products.find((x) => x.sku === editing.sku);
    const col = colOf(editing.field);
    const current = rawOf(p, col);
    const cur = current === null || current === undefined ? '' : String(current);
    if (draft === cur) { setEditing(null); return true; }
    setBusy(true); setCellError(null);
    try {
      if (col.edit === 'colors') {
        const pms = editing.field === 'pms' ? splitSlots(draft) : (p.colors || []).map((c) => c.pms);
        const hex = editing.field === 'hex' ? splitSlots(draft) : (p.colors || []).map((c) => c.hex);
        const n = Math.max(pms.length, hex.length);
        await apiPut(`/products/${encodeURIComponent(p.sku)}/colors`, { colors: Array.from({ length: n }, (_, i) => ({ pms: pms[i] || '', hex: hex[i] || '' })) });
      } else {
        await apiPut(`/products/${encodeURIComponent(p.sku)}`, { [editing.field]: draft });
      }
      setEditing(null); onChanged?.();
      setBusy(false);
      return true;
    } catch (e) {
      // REFUSED, AND IT STAYS IN THE CELL: the value was not saved, and the
      // message names the format the server expects.
      setCellError({ sku: editing.sku, field: editing.field, message: e.message });
      setBusy(false);
      return false;
    }
  };

  const move = (dRow, dCol) => {
    if (!editing) return;
    const r = order.indexOf(editing.sku);
    let nextSku = editing.sku; let nextField = editing.field;
    if (dRow) nextSku = order[Math.min(order.length - 1, Math.max(0, r + dRow))];
    if (dCol) {
      const cols = EDITABLE.filter((k) => groupsShown.find((g) => g.columns.some((c) => c.key === k))?.open);
      const i = cols.indexOf(editing.field);
      nextField = cols[Math.min(cols.length - 1, Math.max(0, i + dCol))];
    }
    const p = products.find((x) => x.sku === nextSku);
    if (p) startEdit(p, colOf(nextField));
  };

  const onKey = async (e) => {
    if (e.key === 'Escape') { e.preventDefault(); cancel(); return; }
    if (e.key === 'Enter') { e.preventDefault(); if (await commit()) move(1, 0); return; }
    if (e.key === 'Tab') { e.preventDefault(); if (await commit()) move(0, e.shiftKey ? -1 : 1); }
  };

  const setNa = async (sku, field, on) => {
    setBusy(true); setCellError(null);
    try {
      await apiFetch(`/products/${encodeURIComponent(sku)}/na`, { method: 'POST', body: { field, on } });
      setEditing(null); onChanged?.();
    } catch (e) { setCellError({ sku, field, message: e.message }); }
    setBusy(false);
  };

  const fillDown = async () => {
    if (!sel || sel.skus.length < 2) return;
    const top = products.find((x) => x.sku === sel.anchor);
    const col = colOf(sel.field);
    const value = rawOf(top, col);
    setBusy(true); setCellError(null);
    try {
      await apiFetch('/products/bulk-edit', { method: 'POST', body: { skus: sel.skus.filter((s) => s !== sel.anchor), field: sel.field, value: value ?? '' } });
      setSel(null); onChanged?.();
    } catch (e) { setCellError({ sku: sel.anchor, field: sel.field, message: e.message }); }
    setBusy(false);
  };

  const exportCsv = () => {
    const cols = groupsShown.flatMap((g) => (g.open ? g.columns : []));
    const lines = [cols.map((c) => c.label).join(',')];
    for (const p of sorted) lines.push(cols.map((c) => csvCell(c.key === 'sku' ? p.sku : shown(p, c))).join(','));
    download(`products-${filter}-${new Date().toISOString().slice(0, 10)}.csv`, lines.join('\n') + '\n');
  };

  const fillable = sel && sel.skus.length > 1 && !['gtin', 'legacy_sku', 'shopify_sku', 'amazon_sku', 'amazon_asin', 'pms', 'hex'].includes(sel.field);

  return (
    <div className="space-y-3" data-product-grid>
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1.5 text-xs" data-grid-filters>
          {[['all', 'All'], ['incomplete', 'Incomplete'], ['blocked', 'Blocked'], ['stale', 'Stale'], ['complete', 'Complete']].map(([k, label]) => (
            <button key={k} type="button" onClick={() => setFilter(k)} data-grid-filter={k} data-count={counts[k]}
              className={`px-2.5 py-1 rounded-full border ${filter === k ? 'bg-powder-600 text-white border-powder-600' : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'}`}>
              {label} <span className="tabular-nums opacity-80">{counts[k]}</span>
            </button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-2">
          <button type="button" onClick={exportCsv} data-export-grid
            className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-gray-300 rounded-lg text-xs font-medium hover:bg-gray-50">
            <Download size={13} /> Export {sorted.length} rows
          </button>
          {canEdit && (
            <button type="button" onClick={() => setImporting(true)} data-import
              className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-gray-300 rounded-lg text-xs font-medium hover:bg-gray-50">
              <Upload size={13} /> Import CSV
            </button>
          )}
        </div>
      </div>

      {fillable && (
        <div className="flex flex-wrap items-center gap-2 text-xs bg-powder-50 border border-powder-200 rounded-lg px-3 py-2" data-fill-down>
          <span>
            <strong>{sel.skus.length} rows</strong> selected in <strong>{colOf(sel.field).label}</strong> — fill the rest with{' '}
            <code>{shown(products.find((x) => x.sku === sel.anchor), colOf(sel.field)) || 'empty'}</code> from {sel.anchor}
          </span>
          <button type="button" onClick={fillDown} disabled={busy} data-fill-down-apply
            className="px-2.5 py-1 rounded bg-powder-600 text-white font-medium disabled:opacity-50">Fill down</button>
          <button type="button" onClick={() => setSel(null)} className="text-gray-600 hover:underline">Clear</button>
        </div>
      )}
      {canEdit && !fillable && (
        <p className="text-[11px] text-gray-500">Click a cell to edit · Enter saves and moves down · Tab saves and moves right · Esc cancels · Shift-click another row in the same column to fill down.</p>
      )}

      <div className="overflow-x-auto border border-gray-200 rounded-lg">
        <table className="min-w-full text-xs">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              {groupsShown.map((g) => (
                <th key={g.key} colSpan={g.open ? g.columns.length : 1} className="text-left px-2 py-1.5 border-r border-gray-200 last:border-r-0">
                  <button type="button" onClick={() => toggleGroup(g.key)} data-group-toggle={g.key} data-group-open={g.open ? '1' : '0'}
                    className="inline-flex items-center gap-1 font-semibold text-gray-700 hover:text-gray-900">
                    {g.open ? <ChevronDown size={12} /> : <ChevronRight size={12} />} {g.label}
                    {!g.open && <span className="font-normal text-gray-400">· {g.columns.length}</span>}
                  </button>
                </th>
              ))}
              <th className="text-left px-2 py-1.5 font-semibold text-gray-700">Completeness</th>
            </tr>
            <tr>
              {groupsShown.map((g) => (g.open
                ? g.columns.map((c) => (
                  <SortHeader key={c.key} col={{ ...c, label: c.label }} sortCol={sortCol} sortDir={sortDir} onSort={toggleSort}
                    className={`text-[11px] whitespace-nowrap ${c.source ? 'text-gray-400' : ''}`} />
                ))
                : <th key={g.key} className="px-2 py-1 text-[11px] text-gray-400">…</th>))}
              <th className="px-2 py-1 text-[11px] font-medium text-gray-600">state · gaps · NA</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {sorted.map((p) => {
              const comp = compBySku.get(p.sku);
              return (
                <tr key={p.sku} data-grid-row={p.sku} className="hover:bg-gray-50/60">
                  {groupsShown.map((g) => (g.open ? g.columns.map((c) => {
                    const isEditing = editing && editing.sku === p.sku && editing.field === c.key;
                    const err = cellError && cellError.sku === p.sku && cellError.field === c.key ? cellError.message : null;
                    const selected = sel && sel.field === c.key && sel.skus.includes(p.sku);
                    const st = c.edit && c.edit !== 'colors' ? fieldState(p, c.key) : 'value';
                    const na = st === 'na' ? p.na?.[c.key] : null;
                    const notApplicable = !applies(p, c.key) && !shown(p, c);
                    if (c.door) {
                      return (
                        <td key={c.key} className="px-2 py-1 whitespace-nowrap sticky left-0 bg-white">
                          <button type="button" onClick={() => onOpenSku?.(p.sku)} className="hover:underline" data-open-row>
                            <code className="text-gray-900">{p.sku}</code>
                          </button>
                        </td>
                      );
                    }
                    if (isEditing) {
                      const rule = FIELD_RULES[c.key];
                      return (
                        <td key={c.key} className="px-1 py-0.5 align-top bg-powder-50" data-cell={c.key} data-editing>
                          <div className="min-w-[9rem]">
                            {c.edit === 'select' ? (
                              <select ref={inputRef} value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={onKey} onBlur={() => { if (!busy) commit(); }}
                                data-cell-input className="w-full border border-powder-400 rounded px-1.5 py-1 text-xs bg-white">
                                {c.options.map((o) => <option key={o} value={o}>{c.render ? c.render(c.key === 'dieline_required' ? Number(o) : o) || '—' : o || '—'}</option>)}
                              </select>
                            ) : (
                              <input ref={inputRef} value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={onKey}
                                onBlur={(e) => { if (!busy && !e.relatedTarget?.closest?.('[data-cell-controls]')) commit(); }}
                                data-cell-input placeholder={rule ? rule.expected.split(',')[0] : ''}
                                className={`w-full border rounded px-1.5 py-1 text-xs bg-white ${err ? 'border-red-500' : 'border-powder-400'}`} />
                            )}
                            {err && <p className="mt-0.5 text-[11px] leading-snug text-red-700" data-cell-error>{err}</p>}
                            {!err && rule && <p className="mt-0.5 text-[10px] leading-snug text-gray-500">{rule.expected}</p>}
                            <div className="mt-0.5 flex gap-2" data-cell-controls>
                              {NA_FIELDS.includes(c.key) && (st === 'na'
                                ? <button type="button" tabIndex={-1} onMouseDown={(e) => e.preventDefault()} onClick={() => setNa(p.sku, c.key, false)} data-na-clear className="text-[10px] text-gray-600 hover:underline">Clear NA</button>
                                : <button type="button" tabIndex={-1} onMouseDown={(e) => e.preventDefault()} onClick={() => setNa(p.sku, c.key, true)} data-na-set className="text-[10px] text-gray-600 hover:underline">Mark NA</button>)}
                              <button type="button" tabIndex={-1} onMouseDown={(e) => e.preventDefault()} onClick={cancel} className="text-[10px] text-gray-500 hover:underline">Cancel</button>
                            </div>
                          </div>
                        </td>
                      );
                    }
                    const value = shown(p, c);
                    return (
                      <td key={c.key} data-cell={c.key} data-state={st}
                        title={c.source ? `Derived: ${c.source}` : na ? `Not applicable — ${na.by || 'unknown'}${na.at ? `, ${String(na.at).slice(0, 10)}` : ''}` : undefined}
                        onMouseDown={(e) => { if (canEdit && c.edit && editing) e.preventDefault(); }}
                        onClick={(e) => startEdit(p, c, e)}
                        className={`px-2 py-1 whitespace-nowrap max-w-[16rem] truncate ${c.edit && canEdit ? 'cursor-text' : ''} ${selected ? 'bg-powder-100' : ''} ${c.source ? 'text-gray-500 italic' : 'text-gray-800'}`}>
                        {st === 'na' ? <span className="inline-block px-1.5 rounded bg-gray-100 text-gray-500 border border-gray-200" data-na>NA</span>
                          : notApplicable ? <span className="text-gray-300" title="Does not apply to this pack format">n/a by format</span>
                            : value !== '' ? value : <span className="text-gray-300">—</span>}
                        {err && <span className="block text-[10px] text-red-700 whitespace-normal" data-cell-error>{err}</span>}
                      </td>
                    );
                  }) : <td key={g.key} className="px-2 py-1 text-gray-300">…</td>))}
                  <td className="px-2 py-1 whitespace-nowrap" data-cell="completeness">
                    {comp ? (
                      <span className="inline-flex items-center gap-1.5">
                        <span className={`px-1.5 py-0.5 rounded border ${STATE_STYLE[comp.state]}`} data-comp-state={comp.state}>{comp.state}</span>
                        <span className="tabular-nums text-amber-900" title="fields empty" data-comp-gaps>{comp.gaps} gap{comp.gaps === 1 ? '' : 's'}</span>
                        <span className="tabular-nums text-gray-500" title="fields answered not applicable" data-comp-na>{comp.na_count} NA</span>
                        {comp.stale?.length > 0 && <AlertTriangle size={12} className="text-red-600" title={comp.stale.join('; ')} />}
                      </span>
                    ) : <span className="text-gray-300">—</span>}
                  </td>
                </tr>
              );
            })}
            {sorted.length === 0 && (
              <tr><td colSpan={ALL_COLUMNS.length + 1} className="px-3 py-8 text-center text-sm text-gray-500">Nothing matches. Loosen a filter.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {importing && <ImportModal onClose={() => setImporting(false)} onDone={onChanged} />}
    </div>
  );
}
