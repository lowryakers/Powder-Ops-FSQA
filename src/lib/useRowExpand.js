import { useState, useCallback } from 'react';

/**
 * Click a log row, see the whole record.
 *
 * Every log in here holds more than fits in the table — notes, custom fields,
 * who signed it, attachments, why someone amended it. Until now the only way in
 * was the edit pencil on the far right, which is the wrong door for "I just
 * want to look at this one": it opens a form, implies you're about to change a
 * compliance record, and is gated behind edit rights most readers don't have.
 *
 * So the row itself expands. Read-only, available to anyone who can see the
 * log, and the pencil keeps doing exactly what it did.
 *
 * Pair it with <ExpandCell>, <DetailRow> and <DetailFields> from
 * components/common/RowDetail.jsx:
 *
 *   const expand = useRowExpand();
 *   {list.map(r => (
 *     <Fragment key={r.id}>
 *       <tr {...expand.rowProps(r.id)}>
 *         <td><ExpandCell open={expand.isExpanded(r.id)} /></td>
 *         …cells…
 *         <td onClick={stopRowClick}><button onClick={() => setEditing(r)}>…</button></td>
 *       </tr>
 *       {expand.isExpanded(r.id) && <DetailRow colSpan={N}><DetailFields fields={…} /></DetailRow>}
 *     </Fragment>
 *   ))}
 *
 * Render the detail INSIDE the row's Fragment, not in a second pass after the
 * list — a detail panel that turns up at the bottom of a 200-row table reads as
 * a bug (it was one, twice).
 */
export function useRowExpand(initial = null) {
  const [expandedId, setExpandedId] = useState(initial);
  const toggle = useCallback((id) => setExpandedId(cur => (cur === id ? null : id)), []);
  const isExpanded = useCallback((id) => expandedId === id, [expandedId]);
  const collapse = useCallback(() => setExpandedId(null), []);

  // Spread onto the <tr>. Keyboard-reachable, because a row that only answers
  // to a mouse isn't really a control.
  const rowProps = useCallback((id, extraClass = '') => ({
    onClick: () => toggle(id),
    onKeyDown: (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(id); }
    },
    tabIndex: 0,
    role: 'button',
    'aria-expanded': expandedId === id,
    className: `cursor-pointer transition-colors ${expandedId === id ? 'bg-blue-50' : 'hover:bg-gray-50'} ${extraClass}`,
  }), [toggle, expandedId]);

  return { expandedId, setExpandedId, toggle, isExpanded, collapse, rowProps };
}

/** Put this on the <td> (or button) that must not also toggle the row. */
export const stopRowClick = (e) => e.stopPropagation();
