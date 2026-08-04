// "Is this a phone-sized screen right now?"
//
// The `md` breakpoint is what the markup switches on everywhere, so anything
// that needs to BEHAVE differently on a phone — not just look different — has
// to agree with it. Tracked live via matchMedia so a rotate or a resize is
// picked up rather than being decided once at mount.
//
// One definition on purpose: a second copy of a breakpoint is how a component
// and its own markup start disagreeing about which layout is on screen.

import { useState, useEffect } from 'react';

const QUERY = '(max-width: 767px)';

export function useCompactLayout() {
  const [compact, setCompact] = useState(
    () => (typeof window !== 'undefined' && window.matchMedia?.(QUERY).matches) || false);
  useEffect(() => {
    const mq = window.matchMedia?.(QUERY);
    if (!mq) return;
    const on = () => setCompact(mq.matches);
    mq.addEventListener?.('change', on);
    return () => mq.removeEventListener?.('change', on);
  }, []);
  return compact;
}

export default useCompactLayout;
