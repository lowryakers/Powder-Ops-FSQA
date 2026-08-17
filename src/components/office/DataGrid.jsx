import { useState, useMemo, Fragment } from 'react';
import { Search, ArrowUpDown, ArrowUp, ArrowDown, X } from 'lucide-react';
import { useRowExpand, stopRowClick } from '../../lib/useRowExpand';
import { ExpandCell, DetailRow, DetailFields } from '../common/RowDetail';
import TextCell from '../common/TextCell.jsx';

// A plain, fast table for the office data sheets: click a header to sort,
// type to search everything, and pick values from any column marked filterable.
// Cells can render themselves and can be edited in place when the column says
// so — that's what makes these feel like the spreadsheets they replace.
//
// columns: [{ key, label, width, align, type: 'text'|'number'|'money'|'date',
//             filter: true, edit: true, render: (row) => node }]
export default function DataGrid({
  columns, rows, loading, empty = 'Nothing here yet.',
  onEdit, canEdit = false, searchPlaceholder = 'Search…', toolbar, rowClass,
  initialSort, detail, expandable = true,
  // Bulk selection, owned HERE so "select all" can only ever mean the rows
  // currently visible through the grid's own search and filters — a row
  // hidden by a filter must never be changed by something you can't see.
  selectable = false, selected = null, onToggleRow, onToggleAll,
}) {
  const [q, setQ] = useState('');
  const [sort, setSort] = useState(initialSort || null);   // { key, dir }
  const [filters, setFilters] = useState({});
  const [editing, setEditing] = useState(null);            // { id, key }
  const [draft, setDraft] = useState('');
  const expand = useRowExpand();

  const filterable = columns.filter(c => c.filter);
  const options = useMemo(() => {
    const out = {};
    for (const c of filterable) {
      out[c.key] = [...new Set((rows || []).map(r => r[c.key]).filter(v => v !== null && v !== undefined && v !== ''))]
        .sort((a, b) => String(a).localeCompare(String(b))).slice(0, 200);
    }
    return out;
  }, [rows, filterable]);

  const view = useMemo(() => {
    let list = rows || [];
    for (const [key, val] of Object.entries(filters)) {
      if (val) list = list.filter(r => String(r[key] ?? '') === val);
    }
    const needle = q.toLowerCase().trim();
    if (needle) {
      list = list.filter(r => columns.some(c => String(r[c.key] ?? '').toLowerCase().includes(needle)));
    }
    if (sort) {
      const col = columns.find(c => c.key === sort.key);
      const dir = sort.dir === 'asc' ? 1 : -1;
      const numeric = col?.type === 'number' || col?.type === 'money';
      list = [...list].sort((a, b) => {
        const av = a[sort.key], bv = b[sort.key];
        if (numeric) return ((Number(av) || 0) - (Number(bv) || 0)) * dir;
        return String(av ?? '').localeCompare(String(bv ?? '')) * dir;
      });
    }
    return list;
  }, [rows, filters, q, sort, columns]);

  const toggleSort = (key) => setSort(s => (s?.key === key
    ? (s.dir === 'asc' ? { key, dir: 'desc' } : null)
    : { key, dir: 'asc' }));

  const startEdit = (row, col) => {
    if (!canEdit || !col.edit) return;
    setEditing({ id: row.id, key: col.key });
    setDraft(row[col.key] ?? '');
  };
  const commit = async (row, col) => {
    setEditing(null);
    const value = col.type === 'number' || col.type === 'money' ? Number(draft) || 0 : draft;
    if (String(row[col.key] ?? '') === String(value)) return;
    await onEdit?.(row, col.key, value);
  };

  const fmt = (row, col) => {
    if (col.render) return col.render(row);
    const v = row[col.key];
    if (v === null || v === undefined || v === '') return <span className="text-gray-300">—</span>;
    if (col.type === 'money') return `$${Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    if (col.type === 'number') return Number(v).toLocaleString('en-US', { maximumFractionDigits: 4 });
    return String(v);
  };

  const activeFilters = Object.entries(filters).filter(([, v]) => v);
  const span = columns.length + (expandable ? 1 : 0) + (selectable ? 1 : 0);
  const allVisibleSelected = selectable && view.length > 0 && view.every(r => selected?.has(r.id));

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-full sm:min-w-[220px]">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder={searchPlaceholder}
            className="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-lg text-sm bg-white" />
        </div>
        {filterable.map(c => (
          <select key={c.key} value={filters[c.key] || ''} onChange={e => setFilters(f => ({ ...f, [c.key]: e.target.value }))}
            className="px-2.5 py-2 border border-gray-200 rounded-lg text-xs bg-white text-gray-600 max-w-[180px]">
            <option value="">{c.label}: all</option>
            {(options[c.key] || []).map(v => <option key={v} value={v}>{String(v)}</option>)}
          </select>
        ))}
        {activeFilters.length > 0 && (
          <button onClick={() => setFilters({})} className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700">
            <X size={12} /> Clear filters
          </button>
        )}
        {toolbar}
        <span className="text-xs text-gray-400 ml-auto">{view.length.toLocaleString()} of {(rows || []).length.toLocaleString()}</span>
      </div>

      {/* Desktop: the full table */}
      <div className="hidden md:block bg-white rounded-xl border border-gray-200 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 sticky top-0 z-10">
            <tr>
              {selectable && (
                <th className="w-8 px-2 py-2">
                  <input type="checkbox" checked={allVisibleSelected}
                    onChange={() => onToggleAll?.(view.map(r => r.id), !allVisibleSelected)} />
                </th>
              )}
              {expandable && <th className="w-8 px-2 py-2" />}
              {columns.map(c => (
                <th key={c.key} onClick={() => toggleSort(c.key)}
                  className={`px-3 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wide cursor-pointer select-none whitespace-nowrap ${c.align === 'right' ? 'text-right' : 'text-left'}`}
                  style={c.width ? { width: c.width } : undefined}>
                  <span className="inline-flex items-center gap-1">
                    {c.label}
                    {sort?.key === c.key
                      ? (sort.dir === 'asc' ? <ArrowUp size={11} /> : <ArrowDown size={11} />)
                      : <ArrowUpDown size={11} className="text-gray-300" />}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={span} className="px-4 py-8 text-center text-gray-400">Loading…</td></tr>}
            {!loading && view.length === 0 && <tr><td colSpan={span} className="px-4 py-8 text-center text-gray-400">{empty}</td></tr>}
            {!loading && view.map(row => (
              <Fragment key={row.id}>
              <tr {...(expandable
                ? expand.rowProps(row.id, `border-t border-gray-100 ${rowClass?.(row) || ''}`)
                : { className: `border-t border-gray-100 hover:bg-gray-50 ${rowClass?.(row) || ''}` })}>
                {selectable && (
                  <td className="px-2 py-1.5" onClick={stopRowClick}>
                    <input type="checkbox" checked={!!selected?.has(row.id)} onChange={() => onToggleRow?.(row.id)} />
                  </td>
                )}
                {expandable && <td className="px-2 py-1.5"><ExpandCell open={expand.isExpanded(row.id)} /></td>}
                {columns.map(c => {
                  const isEditing = editing && editing.id === row.id && editing.key === c.key;
                  return (
                    <td key={c.key}
                      onDoubleClick={() => startEdit(row, c)}
                      onClick={canEdit && c.edit ? stopRowClick : undefined}
                      className={`px-3 py-1.5 ${c.align === 'right' ? 'text-right' : ''} ${canEdit && c.edit ? 'cursor-text' : ''}`}>
                      {isEditing ? (
                        <input autoFocus value={draft} onChange={e => setDraft(e.target.value)}
                          onBlur={() => commit(row, c)}
                          onKeyDown={e => { if (e.key === 'Enter') commit(row, c); if (e.key === 'Escape') setEditing(null); }}
                          type={c.type === 'number' || c.type === 'money' ? 'number' : 'text'} step="any"
                          className={`w-full px-1 py-0.5 border border-powder-400 rounded text-sm ${c.align === 'right' ? 'text-right' : ''}`} />
                      ) : (
                        // A grid column can hold a note somebody typed a
                        // paragraph into. Clamped so one long value cannot
                        // restructure every row; a column that returns its own
                        // markup (a chip, a link) is left alone.
                        (() => {
                          const v = fmt(row, c);
                          return typeof v === 'string' || typeof v === 'number'
                            ? <TextCell value={v} width={c.width || '20rem'} className={c.align === 'right' ? 'ml-auto' : ''} />
                            : v;
                        })()
                      )}
                    </td>
                  );
                })}
              </tr>
              {expandable && expand.isExpanded(row.id) && (
                <DetailRow colSpan={span}>
                  <DetailFields fields={columns.filter(c => c.label).map(c => ({ label: c.label, value: fmt(row, c) }))}>
                    {detail?.(row)}
                  </DetailFields>
                </DetailRow>
              )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
      {/* Mobile: one card per row. The first column is the heading, the second
          the subheading, and the rest are label/value pairs — tapping an
          editable value opens the same inline input the table uses. */}
      <div className="md:hidden space-y-2">
        {loading && <p className="text-center py-8 text-gray-400 text-sm">Loading…</p>}
        {!loading && view.length === 0 && <p className="text-center py-8 text-gray-400 text-sm">{empty}</p>}
        {!loading && view.map(row => {
          const [head, sub, ...rest] = columns.filter(c => c.label);
          return (
            <div key={row.id} className={`bg-white rounded-xl border border-gray-200 p-3 ${rowClass?.(row) || ''}`}>
              <div className="font-medium text-gray-900 break-words flex items-start gap-2">
                {selectable && <input type="checkbox" className="mt-1 shrink-0" checked={!!selected?.has(row.id)} onChange={() => onToggleRow?.(row.id)} />}
                <span className="min-w-0">{fmt(row, head)}</span>
              </div>
              {sub && <div className="text-xs text-gray-500 break-words">{fmt(row, sub)}</div>}
              <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1">
                {rest.map(c => {
                  const isEditing = editing && editing.id === row.id && editing.key === c.key;
                  return (
                    <div key={c.key} className="min-w-0">
                      <dt className="text-[10px] font-medium text-gray-400 uppercase tracking-wide">{c.label}</dt>
                      <dd className="text-sm text-gray-800 break-words" onClick={() => startEdit(row, c)}>
                        {isEditing ? (
                          <input autoFocus value={draft} onChange={e => setDraft(e.target.value)}
                            onBlur={() => commit(row, c)}
                            onKeyDown={e => { if (e.key === 'Enter') commit(row, c); if (e.key === 'Escape') setEditing(null); }}
                            type={c.type === 'number' || c.type === 'money' ? 'number' : 'text'} step="any"
                            className="w-full px-1 py-0.5 border border-powder-400 rounded text-sm" />
                        ) : fmt(row, c)}
                      </dd>
                    </div>
                  );
                })}
              </dl>
            </div>
          );
        })}
      </div>

      {canEdit && <p className="hidden md:block text-[11px] text-gray-400">Double-click a highlighted cell to edit it.</p>}
      {canEdit && <p className="md:hidden text-[11px] text-gray-400">Tap a value to edit it.</p>}
    </div>
  );
}
