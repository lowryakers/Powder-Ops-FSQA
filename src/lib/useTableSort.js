import { useState, useMemo, useCallback } from 'react';

/**
 * Click-a-column-to-sort, in one place.
 *
 * Nine logs had each grown their own copy of this — the same four pieces of
 * state, the same comparator, the same chevron — which is how the Retention
 * log ended up as the one that simply never got it. A tenth copy would have
 * fixed that screen and left the pattern intact.
 *
 * Comparators are chosen by the column's declared `type`, because the naive
 * string compare that most of the copies used sorts 9 after 10 and "2026-01-05"
 * correctly only by accident of ISO formatting:
 *   number — numeric, blanks last rather than as zero, so an empty cell doesn't
 *            claim to be the smallest value
 *   date   — ISO strings compare correctly as text; anything else falls back to
 *            Date parsing rather than sorting alphabetically
 *   text   — locale-aware via Intl.Collator, so accented names file where a
 *            reader expects (SQLite's byte order puts Ángel after Zach)
 *
 * `columns` are the same objects the header already maps over, so a column
 * opts in by having a `key` — one without is a chevron/actions cell and is
 * simply not sortable.
 */
const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });

function compareBy(type, a, b, key) {
  const va = a?.[key], vb = b?.[key];
  const blankA = va === null || va === undefined || va === '';
  const blankB = vb === null || vb === undefined || vb === '';
  // Blanks sort last in either direction — an empty cell is missing data, not
  // a low value, and burying it under the rows people came to read is right.
  if (blankA && blankB) return 0;
  if (blankA) return 1;
  if (blankB) return -1;

  if (type === 'number') return (Number(va) || 0) - (Number(vb) || 0);
  if (type === 'date') {
    const sa = String(va), sb = String(vb);
    if (/^\d{4}-\d{2}-\d{2}/.test(sa) && /^\d{4}-\d{2}-\d{2}/.test(sb)) return sa.localeCompare(sb);
    return (new Date(sa) - new Date(sb)) || collator.compare(sa, sb);
  }
  if (type === 'boolean') return (va ? 1 : 0) - (vb ? 1 : 0);
  return collator.compare(String(va), String(vb));
}

export function useTableSort(rows, columns, initialKey = null, initialDir = 'asc') {
  const [sortCol, setSortCol] = useState(initialKey);
  const [sortDir, setSortDir] = useState(initialDir);

  const toggleSort = useCallback((key) => {
    if (!key) return;
    setSortCol(prev => {
      if (prev === key) { setSortDir(d => (d === 'asc' ? 'desc' : 'asc')); return prev; }
      // A new column starts ascending, so the first click is never a surprise.
      setSortDir('asc');
      return key;
    });
  }, []);

  const sorted = useMemo(() => {
    if (!Array.isArray(rows)) return [];
    if (!sortCol) return rows;
    const col = (columns || []).find(c => c.key === sortCol);
    const dir = sortDir === 'asc' ? 1 : -1;
    // Copy first: sorting the array the caller handed us in place would mutate
    // whatever it came from, including a cached API response.
    return [...rows].sort((a, b) => compareBy(col?.type, a, b, sortCol) * dir);
  }, [rows, columns, sortCol, sortDir]);

  return { sorted, sortCol, sortDir, toggleSort };
}
