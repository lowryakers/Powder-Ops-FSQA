// The temperature and humidity rule, ONE definition for both sides (D-201).
//
// The server grades the filed record with it; the Operator View runs the same
// function to say PASS / FAIL as the numbers are typed. The screen used to keep
// its own copy — humidity "<= 40" passed and temperature was never looked at —
// while the procedure says BELOW 40% and below 78°F, so a reading of exactly 40
// read PASS on the phone. PURE: the limits come in as an argument, because the
// numbers in force are owned by Document Control (`controlled.js`), not here.

/** A reading as typed on a phone keypad — "41", "41.2", "41 %", "78F". */
export function readingNum(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = parseFloat(String(v).replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) ? n : null;
}

/**
 * `limits` is `{ humidity: { procedureLimit, unit, label }, temperature: {…} }`.
 * A blank reading is a gap, never a failure. At or above the limit is out:
 * the procedure says "below".
 */
export function envVerdict(limits, readings) {
  const results = [];
  for (const key of ['temperature', 'humidity']) {
    const limit = limits?.[key];
    const value = readingNum(readings?.[key]);
    if (!limit || value === null) continue;
    results.push({ key, value, label: limit.label, unit: limit.unit, limit: limit.procedureLimit,
      out: value >= limit.procedureLimit });
  }
  if (!results.length) return null;
  return { results, fail: results.some(r => r.out) };
}
