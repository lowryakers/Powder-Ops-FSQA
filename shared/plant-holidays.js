// The plant's paid holidays, and what they do to a production week (D-175).
//
// PURE — dates in, dates out, imported by the server and the browser so the
// schedule grid, the "coming up" strip, the Notify message and the announcement
// cannot disagree about which day is closed.
//
// THE RULES ARE THE RECORD, NOT A LIST OF DATES. Nobody types Thanksgiving in
// every January: each holiday is a rule (a fixed date, or "the fourth Thursday
// of November") and a year's dates are derived. A single year is corrected by
// an override on the server (`plant_holiday_overrides`), never by editing here.
//
// The plant's own decisions, recorded 14 October 2026:
//   - Seven paid holidays: New Year's Day, Independence Day, Thanksgiving, the
//     Friday after Thanksgiving, Christmas Eve, Christmas Day, New Year's Eve.
//   - Memorial Day and Labor Day are paid too, and the production week shifts
//     to Tuesday–Friday. ANY paid holiday observed on a Monday does the same by
//     default (Christmas Day 2028, New Year's Day 2029) — an admin can turn the
//     shift off for one year.
//   - A holiday on a Saturday or Sunday is observed on the FRIDAY before (not
//     the federal Sunday→Monday rule — a Monday off costs this plant a
//     production day). If that Friday is already a holiday it steps back again.
//   - A paid holiday counts as 8 hours (HOLIDAY_HOURS — read by Hours later).
//   - Friday holidays still show: the non-production teams work Fridays.
//   - One announcement, on the Monday of the week before.

export const HOLIDAY_HOURS = 8;

// Production runs Monday–Thursday; Friday is a production day only in a shift
// week. day_of_week is the schedule's own index (0 Monday … 4 Friday).
export const PRODUCTION_DAYS = [0, 1, 2, 3];

export const HOLIDAY_RULES = [
  { key: 'new_years_day', name: "New Year's Day", es: 'Año Nuevo', month: 1, day: 1 },
  { key: 'memorial_day', name: 'Memorial Day', es: 'Día de los Caídos', month: 5, weekday: 1, nth: -1 },
  { key: 'independence_day', name: 'Independence Day', es: 'Día de la Independencia', month: 7, day: 4 },
  { key: 'labor_day', name: 'Labor Day', es: 'Día del Trabajo', month: 9, weekday: 1, nth: 1 },
  { key: 'thanksgiving', name: 'Thanksgiving Day', es: 'Día de Acción de Gracias', month: 11, weekday: 4, nth: 4 },
  { key: 'day_after_thanksgiving', name: 'Friday after Thanksgiving', es: 'Viernes después de Acción de Gracias', after: 'thanksgiving', offset: 1 },
  { key: 'christmas_eve', name: 'Christmas Eve', es: 'Nochebuena', month: 12, day: 24 },
  { key: 'christmas_day', name: 'Christmas Day', es: 'Navidad', month: 12, day: 25 },
  { key: 'new_years_eve', name: "New Year's Eve", es: 'Fin de Año', month: 12, day: 31 },
];
// [eve, day, years between them] — New Year's Eve 2027 pairs with New Year's Day 2028.
const ORDERED_PAIRS = [['christmas_eve', 'christmas_day', 0], ['new_years_eve', 'new_years_day', 1]];
export const RULE_BY_KEY =Object.fromEntries(HOLIDAY_RULES.map(r => [r.key, r]));

// ── date arithmetic on 'YYYY-MM-DD', in UTC so no timezone moves a day ──────
const pad = n => String(n).padStart(2, '0');
export const ymd = d => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
export const toDate = s => { const [y, m, d] = String(s).split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)); };
export const addDays = (s, n) => { const d = toDate(s); d.setUTCDate(d.getUTCDate() + n); return ymd(d); };
// 0 Sunday … 6 Saturday
export const weekdayOf = s => toDate(s).getUTCDay();
export const isDate = s => /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')) && ymd(toDate(s)) === s;
// The Monday of the week a date is in (the schedule's week_start).
export const weekStartOf = s => addDays(s, -((weekdayOf(s) + 6) % 7));
// The schedule's 0–4 index for a weekday date, null at the weekend.
export const scheduleDayOf = s => { const w = weekdayOf(s); return w >= 1 && w <= 5 ? w - 1 : null; };

function nthWeekday(year, month, weekday, nth) {
  if (nth > 0) {
    const first = new Date(Date.UTC(year, month - 1, 1));
    const shift = (weekday - first.getUTCDay() + 7) % 7;
    return ymd(new Date(Date.UTC(year, month - 1, 1 + shift + (nth - 1) * 7)));
  }
  const last = new Date(Date.UTC(year, month, 0));
  const back = (last.getUTCDay() - weekday + 7) % 7;
  return ymd(new Date(Date.UTC(year, month - 1, last.getUTCDate() - back)));
}

function naturalDate(rule, year) {
  if (rule.after) return addDays(naturalDate(RULE_BY_KEY[rule.after], year), rule.offset);
  if (rule.weekday != null) return nthWeekday(year, rule.month, rule.weekday, rule.nth);
  return `${year}-${pad(rule.month)}-${pad(rule.day)}`;
}

/**
 * Every holiday instance whose rule-year is in [fromYear, toYear], with the date
 * it is OBSERVED on. A weekday holiday keeps its date; a weekend one steps back
 * to the nearest earlier weekday no other holiday holds — latest natural date
 * first, so Christmas takes the Friday before Christmas Eve does. The step-back
 * can cross a year (New Year's Day 2028 is a Saturday → Thursday 30 Dec 2027),
 * which is why a year's neighbours are always computed with it.
 *
 * `overrides` is a list of { holiday_key, year, observed_on?, cancelled?, shift_week? }.
 */
export function holidayInstances(fromYear, toYear, overrides = []) {
  const ov = new Map(overrides.map(o => [`${o.holiday_key}|${o.year}`, o]));
  const all = [];
  for (let y = fromYear - 1; y <= toYear + 1; y++) {
    for (const rule of HOLIDAY_RULES) all.push({ rule, year: y, natural: naturalDate(rule, y) });
  }
  const taken = new Set();
  for (const h of all) {
    const w = weekdayOf(h.natural);
    if (w !== 0 && w !== 6) { h.observed = h.natural; taken.add(h.natural); }
  }
  const weekend = all.filter(h => !h.observed).sort((a, b) => (a.natural < b.natural ? 1 : -1));
  for (const h of weekend) {
    let d = h.natural;
    do { d = addDays(d, -1); } while (weekdayOf(d) === 0 || weekdayOf(d) === 6 || taken.has(d));
    h.observed = d; h.moved = true; taken.add(d);
  }
  // An eve is never observed AFTER its day. Christmas on a Saturday steps back
  // past Christmas Eve's Friday, which would read "Christmas, Thu 23 Dec" a day
  // before "Christmas Eve, Fri 24 Dec"; the two swap dates — the same two days
  // off, labelled the way everybody says them.
  for (const [eve, dayKey, yearGap] of ORDERED_PAIRS) {
    for (const e of all.filter(h => h.rule.key === eve)) {
      const d = all.find(h => h.rule.key === dayKey && h.year === e.year + yearGap);
      if (d && d.observed < e.observed) {
        [d.observed, e.observed] = [e.observed, d.observed];
        d.moved = d.observed !== d.natural; e.moved = e.observed !== e.natural;
      }
    }
  }
  const out = [];
  for (const h of all) {
    if (h.year < fromYear || h.year > toYear) continue;
    const o = ov.get(`${h.rule.key}|${h.year}`) || null;
    if (o?.cancelled) {
      out.push(instance(h, { cancelled: true, override: o }));
      continue;
    }
    const observed = o?.observed_on && isDate(o.observed_on) ? o.observed_on : h.observed;
    out.push(instance({ ...h, observed, moved: observed !== h.natural }, { override: o }));
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

function instance(h, { cancelled = false, override = null }) {
  const date = h.observed;
  const onMonday = weekdayOf(date) === 1;
  // A Monday holiday shifts the week by default; an override says otherwise.
  const shift = cancelled ? false
    : (override && override.shift_week != null ? !!override.shift_week : onMonday);
  return {
    key: h.rule.key,
    year: h.year,
    name: h.rule.name,
    name_es: h.rule.es,
    natural_date: h.natural,
    date,
    moved: !!h.moved && date !== h.natural,
    week_start: weekStartOf(date),
    day_of_week: scheduleDayOf(date),
    production_day: PRODUCTION_DAYS.includes(scheduleDayOf(date)),
    shift_week: shift && onMonday,
    cancelled,
    override: override ? {
      observed_on: override.observed_on || null,
      cancelled: !!override.cancelled,
      shift_week: override.shift_week == null ? null : !!override.shift_week,
      reason: override.reason || null,
      set_by: override.set_by || null,
      set_at: override.set_at || null,
    } : null,
  };
}

/** Observed (not cancelled) holidays falling between two dates inclusive. */
export function holidaysBetween(from, to, overrides = []) {
  const y0 = Number(String(from).slice(0, 4)), y1 = Number(String(to).slice(0, 4));
  // One year either side: an observed date can cross a year (New Year's Day
  // 2028 is observed on Friday 31 December 2027).
  return holidayInstances(y0 - 1, y1 + 1, overrides).filter(h => !h.cancelled && h.date >= from && h.date <= to);
}

/**
 * One schedule week as the grid draws it: per day, its date, the holiday on it
 * and whether it is a production day. A shift week moves production to
 * Tuesday–Friday; a holiday closes its day whatever else is true.
 */
export function weekCalendar(weekStart, overrides = []) {
  const ws = weekStartOf(weekStart);
  const hols = holidaysBetween(ws, addDays(ws, 4), overrides);
  const shift = hols.some(h => h.shift_week);
  const days = [0, 1, 2, 3, 4].map(d => {
    const date = addDays(ws, d);
    const holiday = hols.find(h => h.date === date) || null;
    const usual = PRODUCTION_DAYS.includes(d);
    // Shift week: Monday off (it is the holiday), Friday on.
    const production = !holiday && (shift ? d >= 1 : usual);
    return { day_of_week: d, date, holiday, closed: !!holiday, production, usual_production: usual };
  });
  // What changed from an ordinary week, in words — the strip, the Notify line
  // and the announcement all print this rather than composing their own.
  const lost = days.filter(d => d.usual_production && !d.production).map(d => d.day_of_week);
  const gained = days.filter(d => !d.usual_production && d.production).map(d => d.day_of_week);
  return { week_start: ws, days, holidays: hols, shift_week: shift, lost_days: lost, gained_days: gained, changed: hols.length > 0 };
}

export const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
export const DAY_NAMES_ES = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const shortDate = s => { const d = toDate(s); return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`; };
const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const dayDate = s => `${WEEKDAY_SHORT[weekdayOf(s)]} ${shortDate(s)}`;

const MONTHS_ES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const WEEKDAY_SHORT_ES = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
export const dayDateEs = s => { const d = toDate(s); return `${WEEKDAY_SHORT_ES[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS_ES[d.getUTCMonth()]}`; };

/** One line per holiday, plus the production effect — plain text for chat. */
export function weekSummaryLines(week, lang = 'en') {
  const es = lang === 'es';
  const lines = week.holidays.map(h => es
    ? `${dayDateEs(h.date)} — ${h.name_es}${h.moved ? ` (se observa; cae en ${dayDateEs(h.natural_date)})` : ''} · día festivo pagado, cerrado`
    : `${dayDate(h.date)} — ${h.name}${h.moved ? ` (observed; falls on ${dayDate(h.natural_date)})` : ''} · paid holiday, closed`);
  if (week.shift_week) lines.push(es ? 'Esta semana la producción es de martes a viernes.' : 'Production runs Tuesday–Friday this week.');
  else if (week.lost_days.length) {
    const left = week.days.filter(d => d.production).map(d => (es ? DAY_NAMES_ES : DAY_NAMES)[d.day_of_week]);
    lines.push(left.length
      ? (es ? `Días de producción esta semana: ${left.join(', ')}.` : `Production days this week: ${left.join(', ')}.`)
      : (es ? 'No hay producción esta semana.' : 'No production this week.'));
  }
  return lines;
}

/** The Monday a week's notice goes out: the Monday of the week before. */
export const noticeDateFor = weekStart => addDays(weekStartOf(weekStart), -7);
