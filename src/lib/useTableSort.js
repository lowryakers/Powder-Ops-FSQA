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

const isBlank = (v) => v === null || v === undefined || v === '';

/**
 * Blanks, decided OUTSIDE the direction multiplier.
 *
 * This used to live in compareBy, whose result the caller multiplies by ±1 —
 * so "blank sorts last" became "blank sorts FIRST" the moment you clicked a
 * header twice, and every screen on this hook had an empty column pushing the
 * rows people came to read off the bottom. An empty cell is missing data, not
 * a low value, and it is missing data in both directions.
 *
 * Returns null when neither value is blank, meaning "ask the comparator".
 */
function blankOrder(va, vb) {
  const a = isBlank(va), b = isBlank(vb);
  if (a && b) return 0;
  if (a) return 1;
  if (b) return -1;
  return null;
}

function compareBy(type, a, b, key, sortValue) {
  // SORT BY WHAT IS ON SCREEN. A cell often renders something other than its
  // raw column — a room token shown as "Room 7", a status code shown as a
  // chip, a name assembled from two fields. Ordering by the stored value there
  // makes clicking the header look like it scrambled the list, so a column can
  // say how it wants to be compared.
  const va = sortValue ? sortValue(a) : a?.[key];
  const vb = sortValue ? sortValue(b) : b?.[key];

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
    const val = (r) => (col?.sortValue ? col.sortValue(r) : r?.[sortCol]);
    return [...rows].sort((a, b) => {
      // Blanks first, and NOT multiplied by dir — see blankOrder.
      const blank = blankOrder(val(a), val(b));
      if (blank !== null) return blank;
      return compareBy(col?.type, a, b, sortCol, col?.sortValue) * dir;
    });
  }, [rows, columns, sortCol, sortDir]);

  return { sorted, sortCol, sortDir, toggleSort };
}
