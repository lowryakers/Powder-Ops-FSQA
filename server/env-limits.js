// Environmental limits for the daily Temp & Humidity check (Form 110-04).
//
// Humidity is the one that matters here. The controlled procedure says it must
// stay **below 40%**, and the alert deliberately fires a point EARLIER, at 39,
// so someone is told while there is still room to act rather than after the
// limit has already been breached. That gap is the whole point — an alert that
// only fires on a failure is a report, not a warning.
//
// Temperature alerts at the limit itself: the procedure says below 78°F, so 78
// is already out.
//
// These are acceptance criteria, not settings, and they are not editable in
// the app for the same reason `scale-forms.js` tolerances are not — changing
// what counts as acceptable is a document change, not a preference. If they
// should be gated by Document Control the way scale tolerances are, add them
// to the registry in controlled.js.
export const ENV_LIMITS = {
  humidity: {
    label: 'Humidity',
    unit: '%',
    // Alert at or above this. Procedure limit is 40; 39 buys a day's warning.
    alertAtOrAbove: 39,
    procedureLimit: 40,
    note: 'Procedure requires humidity below 40%.',
  },
  temperature: {
    label: 'Temperature',
    unit: '°F',
    alertAtOrAbove: 78,
    procedureLimit: 78,
    note: 'Procedure requires temperature below 78°F.',
  },
};

const num = (v) => {
  if (v === null || v === undefined || v === '') return null;
  // Readings arrive as text from a phone keypad — "41", "41.2", "41 %", "78F".
  const n = parseFloat(String(v).replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) ? n : null;
};

/**
 * Which readings are out of range. Returns [] when everything is fine or the
 * reading is missing/unparseable — a blank reading is a gap in the record, not
 * an excursion, and raising an alarm on it would train people to ignore alarms.
 */
export function environmentalBreaches(readings) {
  const out = [];
  for (const [key, limit] of Object.entries(ENV_LIMITS)) {
    const value = num(readings?.[key]);
    if (value === null) continue;
    if (value >= limit.alertAtOrAbove) {
      out.push({
        key,
        value,
        label: limit.label,
        unit: limit.unit,
        limit: limit.procedureLimit,
        note: limit.note,
        // Past the procedure limit, not merely approaching it.
        exceeded: value >= limit.procedureLimit,
      });
    }
  }
  return out;
}

/** Does this work order look like the daily environmental check? */
export const isEnvironmentalCheck = (title) =>
  /temp\s*(&|and|\/)?\s*humidity|humidity/i.test(String(title || ''));
