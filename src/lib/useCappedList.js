import { useState, useEffect, useMemo } from 'react';

/**
 * Render the first N of a list, with a button for the rest.
 *
 * The APIs are bounded now, but the client still rendered every row it was
 * given. On a phone the Production Log came out as 18,000 DOM nodes and a
 * 60,000px page — around ninety screens of scrolling that nobody was ever
 * going to reach, all of it laid out and painted before the first row appeared.
 *
 * Deliberately NOT virtualization: a windowed list breaks Ctrl-F, breaks
 * printing, and complicates the expand-a-row detail panels these logs rely on.
 * A cap plus "show more" keeps the DOM honest and every rendered row real.
 *
 * The cap resets whenever the underlying list changes (a new filter, a new
 * search) — otherwise you'd filter down to three rows and still be looking at
 * a stale "showing 100 of 4,000".
 *
 *   const view = useCappedList(filtered);
 *   {view.items.map(...)}
 *   <ShowMore view={view} noun="entries" />
 */
export function useCappedList(items, { initial = 100, step = 200 } = {}) {
  const list = useMemo(() => items || [], [items]);
  const [limit, setLimit] = useState(initial);

  // Reset when the list identity changes (filter/search/refresh).
  useEffect(() => { setLimit(initial); }, [list, initial]);

  const total = list.length;
  const capped = total > limit;
  return {
    items: capped ? list.slice(0, limit) : list,
    total,
    shown: capped ? limit : total,
    hidden: capped ? total - limit : 0,
    capped,
    showMore: () => setLimit(n => n + step),
    showAll: () => setLimit(total),
  };
}
