// The ATP limit, shown as it is typed.
//
// PC #1's critical limit is 35 RLU and the server enforces it — an over-limit
// reading is stored as a failure whatever the filer chose. THIS COMPONENT DOES
// NOT ENFORCE ANYTHING; it tells somebody what is about to happen while they
// can still act on it, which is the difference between a refusal that explains
// itself and one that just says no.
//
// The rule lives in `server/atp-limits.js` and is the only place that decides.
// The limit is duplicated here for display alone, and deliberately labelled as
// coming from Protocol 003 so a reader can see where it came from — if the
// document moves and this string does not, the app still grades correctly and
// only the hint is stale.

const LIMIT = 35;

export default function AtpLimitHint({ value, lang = 'en' }) {
  const n = value === '' || value === null || value === undefined ? null : Number(value);
  if (n === null || !Number.isFinite(n)) return null;
  const over = n > LIMIT;

  const t = lang === 'es'
    ? {
      ok: `Dentro del límite (≤ ${LIMIT} RLU)`,
      over: `Sobre el límite de ${LIMIT} RLU`,
      why: 'Se guardará como FALLA. Vuelva a limpiar y tome otra muestra — una sola lectura alta puede ser la muestra, no la línea.',
      src: 'Protocolo 003 V4, PC #1',
    }
    : {
      ok: `Within limit (≤ ${LIMIT} RLU)`,
      over: `Over the ${LIMIT} RLU limit`,
      why: 'This will be stored as a FAIL. Re-clean and swab again — a single high reading can be the swab rather than the line.',
      src: 'Protocol 003 V4, PC #1',
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
