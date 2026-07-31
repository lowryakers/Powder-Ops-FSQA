/**
 * Hours as people say them (39:56) over hours as a database stores them (39.93).
 *
 * Everything downstream — weekly targets, overtime, the paid-non-working
 * balance, the period totals — is arithmetic on decimal hours, and payroll
 * exports decimal too. So decimal stays the stored unit and this is purely the
 * layer people type and read through. Converting the column would mean
 * rewriting every sum for no gain.
 *
 * Entry stays forgiving: "39:56", "39.93", "39" and "8:5" all land somewhere
 * sensible. Someone who has typed decimals for two years shouldn't have to stop.
 */

// "39:56" | "39.93" | "39" → 39.9333…  (null/blank → 0)
export function parseHours(input) {
  const s = String(input ?? '').trim();
  if (!s) return 0;

  const colon = s.indexOf(':');
  if (colon === -1) return Math.max(0, Number(s) || 0);

  const h = Number(s.slice(0, colon).trim()) || 0;
  // "8:5" means eight hours five minutes, not eight and a half — pad it the way
  // a clock would rather than reading 5 as 50.
  const rawMin = s.slice(colon + 1).trim();
  const m = Number(rawMin) || 0;
  if (h < 0 || m < 0) return 0;
  // Four places is enough to survive the round trip: 1 minute is 0.0167h, so
  // formatHours() always recovers the same minute.
  return Math.round((Math.abs(h) + Math.min(m, 59) / 60) * 10000) / 10000;
}

// 39.9333… → "39:56". Zero renders as an em dash unless `zero` says otherwise.
export function formatHours(value, { zero = '—' } = {}) {
  const n = Number(value);
  if (!n || Number.isNaN(n)) return zero;
  const total = Math.round(n * 60);          // to whole minutes first…
  const h = Math.floor(total / 60);
  const m = total % 60;                       // …so 7.999 shows 8:00, not 7:60
  return `${h}:${String(m).padStart(2, '0')}`;
}

// What goes in the text box: same as formatHours but blank when there's nothing,
// so an untouched week reads as empty rather than "0:00".
export function hoursInputValue(value) {
  return formatHours(value, { zero: '' });
}
