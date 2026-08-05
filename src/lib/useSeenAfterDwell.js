import { useEffect, useRef } from 'react';

/**
 * Fire once when the user has genuinely *looked at* an element.
 *
 * The Threads inbox used to have exactly one way to clear an unread thread:
 * press "Mark read". So the honest case — you scrolled to it, read the three
 * replies, decided it needed nothing from you, and moved on — left it counted
 * as unread forever, and the badge stopped meaning anything.
 *
 * "Looked at" is deliberately stricter than "was rendered":
 *
 *   · Enough of the element is ON SCREEN (`threshold`), not merely mounted.
 *     A card two screens down the list has not been read.
 *   · The TAB IS VISIBLE. Leaving the app open on another monitor while you
 *     go to a meeting must not mark your morning's threads read.
 *   · It stayed that way CONTINUOUSLY for `ms`. Flicking past something at
 *     scroll speed is not reading it, and the timer restarts on every exit
 *     rather than accumulating — half a second here and half a second there
 *     is still not having read it.
 *
 * Fires at most once per mount. The caller decides what "seen" means; this
 * only decides when.
 */
export function useSeenAfterDwell(ref, { ms = 2500, enabled = true, threshold = 0.4, onSeen } = {}) {
  // Held in refs so a re-render (a reply typed into the card, a reaction) can
  // never restart the timer or fire twice.
  const firedRef = useRef(false);
  const timerRef = useRef(null);
  // Synced in an effect rather than during render — a ref written while
  // rendering is a side effect, and the timer only fires seconds later, well
  // after this has run.
  const seenRef = useRef(onSeen);
  useEffect(() => { seenRef.current = onSeen; });

  useEffect(() => {
    const el = ref?.current;
    if (!enabled || !el || firedRef.current) return;
    if (typeof IntersectionObserver === 'undefined') return;

    let onScreen = false;
    const stop = () => { clearTimeout(timerRef.current); timerRef.current = null; };
    const start = () => {
      if (timerRef.current || firedRef.current) return;
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        if (firedRef.current) return;
        firedRef.current = true;
        seenRef.current?.();
      }, ms);
    };
    const evaluate = () => {
      if (onScreen && document.visibilityState === 'visible') start();
      else stop();
    };

    const io = new IntersectionObserver(([entry]) => {
      onScreen = entry.isIntersecting && entry.intersectionRatio >= threshold;
      evaluate();
    }, { threshold: [0, threshold, 1] });
    io.observe(el);
    document.addEventListener('visibilitychange', evaluate);

    return () => { stop(); io.disconnect(); document.removeEventListener('visibilitychange', evaluate); };
  }, [ref, enabled, ms, threshold]);
}
