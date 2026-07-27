import { useState, useEffect, useCallback, useMemo } from 'react';
import { apiPost } from '../hooks/useApi';

// Whole-page EN/ES: give it every string the page shows — labels AND the rows'
// own free text — and it hands back tr(), which returns Spanish while the
// toggle is on and the original the rest of the time.
//
// Translation goes through /ai/translate-content, which is cached server-side
// and returns the originals unchanged when AI isn't configured, so a page using
// this never breaks — it just stays in English.
const LANG_KEY = 'ui_lang';
// Joins the pending strings into one dependency key; a control character can't
// appear in the strings themselves, so multi-word phrases survive the split.
const SEP = '\u001f';

export function usePageTranslation(strings) {
  const [lang, setLangState] = useState(() => {
    try { return localStorage.getItem(LANG_KEY) === 'es' ? 'es' : 'en'; } catch { return 'en'; }
  });
  const [map, setMap] = useState({});
  const [loading, setLoading] = useState(false);

  const setLang = useCallback((next) => {
    setLangState(next);
    try { localStorage.setItem(LANG_KEY, next); } catch { /* private mode */ }
  }, []);

  const wanted = useMemo(() => {
    const seen = new Set();
    return (strings || [])
      .filter(s => typeof s === 'string' && s.trim())
      .filter(s => (seen.has(s) ? false : (seen.add(s), true)));
  }, [strings]);

  // Only ask for strings we don't already have, so paging through a log doesn't
  // re-translate the header row every time.
  const missingKey = useMemo(
    () => (lang === 'es' ? wanted.filter(s => map[s] === undefined).join(SEP) : ''),
    [lang, wanted, map],
  );

  useEffect(() => {
    if (lang !== 'es' || !missingKey) return undefined;
    const texts = missingKey.split(SEP).slice(0, 200);
    let cancelled = false;
    setLoading(true);
    apiPost('/ai/translate-content', { texts, lang: 'es' })
      .then(({ translations }) => {
        if (cancelled) return;
        setMap(prev => {
          const next = { ...prev };
          texts.forEach((t, i) => { next[t] = translations[i] ?? t; });
          return next;
        });
      })
      .catch(() => { /* stay in English */ })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [lang, missingKey]);

  const tr = useCallback((s) => {
    if (lang !== 'es' || typeof s !== 'string') return s;
    return map[s] ?? s;
  }, [lang, map]);

  return { lang, setLang, tr, translating: loading };
}
