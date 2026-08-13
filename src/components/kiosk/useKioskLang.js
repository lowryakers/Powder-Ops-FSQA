import { useState, useCallback } from 'react';
import { createTranslator } from '../../i18n/operatorStrings';

/**
 * EN/ES on the public kiosks.
 *
 * These are the big-tap forms on the floor phones and the tablets by the
 * scales — a knife sign-out, a component pull, a scale check. They were
 * English only, which for a large part of this shift means filling in a
 * compliance form they cannot read. The Operator View has had its own strings
 * for a while; the kiosks never got them.
 *
 * THE SAME `op_lang` KEY as the Operator View, deliberately. Somebody who sets
 * Spanish once on the task list should not have to set it again at the scale,
 * and a second key is how one screen ends up in Spanish and the next in
 * English on the same device.
 *
 * `createTranslator` is the Operator View's, not a second one — a kiosk asking
 * for a key nobody added falls back to the English text rather than rendering
 * the key, which is the right failure on a form somebody is standing in front
 * of.
 */
export function useKioskLang() {
  const [lang, setLang] = useState(() => {
    try { return localStorage.getItem('op_lang') || 'en'; } catch { return 'en'; }
  });
  const toggle = useCallback(() => {
    setLang((l) => {
      const next = l === 'en' ? 'es' : 'en';
      try { localStorage.setItem('op_lang', next); } catch { /* private mode */ }
      return next;
    });
  }, []);
  return { lang, toggle, t: createTranslator(lang) };
}
