import { ChevronUp, ChevronDown, ChevronsUpDown } from 'lucide-react';

/**
 * A sortable column header cell, paired with `useTableSort`.
 *
 * Shows a faint two-way chevron on hover for columns that CAN sort but
 * currently aren't — a header that only reveals it's clickable after you've
 * clicked it is why people don't discover sorting at all.
 *
 * A column with no `key` renders as a plain header: chevron and action columns
 * are not sortable and shouldn't pretend to be.
 */
export default function SortHeader({ col, sortCol, sortDir, onSort, className = '' }) {
  const align = col.align === 'right' ? 'text-right' : col.align === 'center' ? 'text-center' : 'text-left';
  const base = `${align} px-3 py-2.5 font-medium text-gray-600 ${className}`;
  // No key = not sortable, but it may still be a real column. A chevron or
  // actions cell has no label and renders empty; a column like "Details" —
  // which holds a JSON blob nobody would order by — keeps its heading and
  // simply isn't clickable. Dropping the label here left unsortable columns
  // with blank headings.
  if (!col.key) {
    return (
      <th className={base} style={col.width ? { width: col.width } : undefined}>
        {col.label || null}
      </th>
    );
  }

  const active = sortCol === col.key;
  return (
    <th className={base} style={col.width ? { width: col.width } : undefined}
      aria-sort={active ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <button type="button" onClick={() => onSort(col.key)}
        className={`group inline-flex items-center gap-1 hover:text-gray-900 ${active ? 'text-gray-900' : ''}
          ${col.align === 'right' ? 'flex-row-reverse' : ''}`}
        title={`Sort by ${col.label}`}>
        <span className="whitespace-nowrap">{col.label}</span>
        {active
          ? (sortDir === 'asc'
            ? <ChevronUp size={13} className="text-powder-600 shrink-0" />
            : <ChevronDown size={13} className="text-powder-600 shrink-0" />)
          : <ChevronsUpDown size={13} className="shrink-0 text-gray-300 opacity-0 group-hover:opacity-100 transition-opacity" />}
      </button>
    </th>
  );
}
