// The ATP limit, shown as it is typed.
//
// PC #1's critical limit is enforced by the server — an over-limit reading is
// stored as a failure whatever the filer chose. THIS COMPONENT DOES NOT ENFORCE
// ANYTHING; it tells somebody what is about to happen while they can still act
// on it, which is the difference between a refusal that explains itself and
// one that just says no.
//
// THE NUMBER IS READ FROM THE SERVER (D-180), never written here. It used to be
// a constant, which was harmless while the limit never moved; the limit moving
// from 35 to 30 is parked until Document Control approves it, so a constant
// would have told the floor 30 while every reading was graded against 35.
// `GET /api/atp-limit` answers with the limit IN FORCE. Fetched once per page.
import { useEffect, useState } from 'react';
import { apiFetch } from '../../hooks/useApi';

let cached = null;
let pending = null;
function loadLimit() {
  if (cached) return Promise.resolve(cached);
  if (!pending) {
    pending = apiFetch('/atp-limit')
      .then((r) => { cached = r; return r; })
      .catch(() => { pending = null; return null; });
  }
  return pending;
}

/** The ATP limit in force, or null until it has loaded. */
function useAtpLimit() {
  const [limit, setLimit] = useState(cached);
  useEffect(() => {
    if (limit) return undefined;
    let live = true;
    loadLimit().then((r) => { if (live && r) setLimit(r); });
    return () => { live = false; };
  }, [limit]);
  return limit;
}

export default function AtpLimitHint({ value, lang = 'en' }) {
  const limit = useAtpLimit();
  const n = value === '' || value === null || value === undefined ? null : Number(value);
  if (n === null || !Number.isFinite(n) || !limit) return null;
  const LIMIT = limit.max;
  const over = n > LIMIT;
  const src = `${limit.document} ${limit.revision}, ${limit.control}`;

  const t = lang === 'es'
    ? {
      ok: `Dentro del límite (≤ ${LIMIT} RLU)`,
      over: `Sobre el límite de ${LIMIT} RLU`,
      why: 'Se guardará como FALLA. Vuelva a limpiar y tome otra muestra — una sola lectura alta puede ser la muestra, no la línea.',
      src: src.replace('Protocol', 'Protocolo'),
    }
    : {
      ok: `Within limit (≤ ${LIMIT} RLU)`,
      over: `Over the ${LIMIT} RLU limit`,
      why: 'This will be stored as a FAIL. Re-clean and swab again — a single high reading can be the swab rather than the line.',
      src,
    };

  return (
    <div className={`mt-1.5 rounded-md border px-2.5 py-1.5 text-xs ${over
      ? 'border-red-300 bg-red-50 text-red-800'
      : 'border-green-300 bg-green-50 text-green-800'}`}>
      <div className="font-semibold">{over ? t.over : t.ok}</div>
      {over && <div className="mt-0.5 text-red-700">{t.why}</div>}
      <div className={`mt-0.5 ${over ? 'text-red-600' : 'text-green-700'} opacity-80`}>{t.src}</div>
    </div>
  );
}
