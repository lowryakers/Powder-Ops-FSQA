import { ChevronRight, ChevronDown } from 'lucide-react';

// The read-only detail panel that drops out of an expanded log row.
// State lives in lib/useRowExpand.js — see that file for the full pattern.

/** The disclosure arrow. Goes in the first cell of an expandable row. */
export function ExpandCell({ open }) {
  return open
    ? <ChevronDown size={14} className="text-blue-600" />
    : <ChevronRight size={14} className="text-gray-300" />;
}

/** Full-width detail panel under a row. colSpan must cover every column. */
export function DetailRow({ colSpan, children, className = '' }) {
  return (
    <tr className={`bg-blue-50/60 ${className}`}>
      <td colSpan={colSpan} className="px-4 py-3 border-b-2 border-blue-100">
        {children}
      </td>
    </tr>
  );
}

/**
 * Label/value pairs, laid out. Empty values are dropped so a record doesn't
 * show a wall of blanks; `wide` gives a field the whole width (notes, reasons);
 * `always: true` keeps a field visible even when it's empty.
 */
export function DetailFields({ fields, children, className = '' }) {
  const shown = (fields || []).filter(f => f
    && (f.always || (f.value !== null && f.value !== undefined && f.value !== '' && f.value !== false)));

  if (shown.length === 0 && !children) {
    return <div className={`text-sm text-gray-500 italic ${className}`}>Nothing more on this record.</div>;
  }
  return (
    <div className={className}>
      {shown.length > 0 && (
        <dl className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-x-6 gap-y-2.5">
          {shown.map((f, i) => (
            <div key={f.label || i} className={f.wide ? 'col-span-2 md:col-span-3 lg:col-span-4' : ''}>
              <dt className="text-[10px] uppercase tracking-wider font-semibold text-gray-500">{f.label}</dt>
              <dd className="text-sm text-gray-900 mt-0.5 break-words whitespace-pre-wrap">
                {f.value === '' || f.value == null ? '—' : f.value}
              </dd>
            </div>
          ))}
        </dl>
      )}
      {children && <div className={shown.length > 0 ? 'mt-3' : ''}>{children}</div>}
    </div>
  );
}
