import { envVerdict, readingNum } from '../shared/env-grade.js';

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
// what counts as acceptable is a document change, not a preference.
//
// UNDER DOCUMENT CONTROL SINCE D-201 (single-spine move 03). `envControlledEntry`
// registers both limits with `controlled.js`, so a change to a number here is
// PARKED until Document Control approves it and the app goes on checking
// against the approved one — the ATP limit's arrangement exactly. `document` and
// `revision` name the form that carries the check (FORM 110-03 V2 in the
// register); which procedure states 40% and 78°F is Document Control's to
// confirm (docs/v2/queued/dcr-temp-humidity-limits.md).
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

/** The document that owns the two numbers — printed on every graded record. */
export const ENV_SOURCE = { document: 'FORM 110-03', revision: 'V2' };

/** The procedure's wording, built from the number IN FORCE (never stored). */
const limitText = (l) => `below ${l.procedureLimit}${l.unit}`;
const refreshNotes = () => {
  for (const l of Object.values(ENV_LIMITS)) l.note = `Procedure requires ${l.label.toLowerCase()} ${limitText(l)}.`;
};

// Readings arrive as text from a phone keypad — "41", "41.2", "41 %", "78F".
const num = (v) => readingNum(v);

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

/**
 * The record's account of the readings against the limits in force (D-201).
 * The grade can FAIL a record and never PASS one — the ATP rule: an in-range
 * reading leaves the filer's answer alone, an out-of-range one is a failed
 * check. A blank reading is a gap and grades to nothing. `lines` carry the
 * limit and its document, so a record checked against 40% goes on saying 40%
 * after the number moves.
 */
export function gradeEnvironment(readings) {
  const v = envVerdict(ENV_LIMITS, readings);
  if (!v) return null;
  const lines = v.results.map(r =>
    `${r.label} ${r.value}${r.unit} ${r.out ? 'OUT OF RANGE' : 'in range'} (limit below ${r.limit}${r.unit}, ${ENV_SOURCE.document} ${ENV_SOURCE.revision}).`);
  return { checked: v.results.length, outOfRange: v.results.filter(r => r.out).length, fail: v.fail, lines };
}

/** The limits IN FORCE, for the screen that shows PASS / FAIL as a reading is typed. */
export const envLimitsInForce = () => ({
  humidity: { ...ENV_LIMITS.humidity }, temperature: { ...ENV_LIMITS.temperature }, ...ENV_SOURCE,
});

/** The `controlled.js` entry — the limits as Document Control approved them. */
export function envControlledEntry() {
  const pick = (l) => ({ alertAtOrAbove: l.alertAtOrAbove, procedureLimit: l.procedureLimit, unit: l.unit });
  return {
    scope: 'acceptance',
    key: 'env:temp-humidity',
    label: `Temperature and humidity limits (${ENV_SOURCE.document})`,
    current: () => ({
      humidity: pick(ENV_LIMITS.humidity),
      temperature: pick(ENV_LIMITS.temperature),
      document: ENV_SOURCE.document,
      revision: ENV_SOURCE.revision,
    }),
    apply: (snap) => {
      for (const key of ['humidity', 'temperature']) {
        const s = snap?.[key];
        if (!s) continue;
        if (typeof s.alertAtOrAbove === 'number') ENV_LIMITS[key].alertAtOrAbove = s.alertAtOrAbove;
        if (typeof s.procedureLimit === 'number') ENV_LIMITS[key].procedureLimit = s.procedureLimit;
        if (s.unit) ENV_LIMITS[key].unit = s.unit;
      }
      if (snap?.document) ENV_SOURCE.document = snap.document;
      if (snap?.revision) ENV_SOURCE.revision = snap.revision;
      refreshNotes();
    },
  };
}
