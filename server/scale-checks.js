/**
 * WHICH DAILY SCALE CHECKS HAVE BEEN RUN TODAY, AND WHICH HAVE NOT.
 *
 * Scale Verification (Forms 417-01 … 417-05) was a sidebar shortcut under
 * Quick Forms and nothing else: not a task, so never on the Operator View; and
 * nothing anywhere reported a check that simply was not done. The bell, the
 * Flash Report and QA Review all read `scale_verifications` AFTER the fact — a
 * failed reading, one waiting on QA's counter-signature. "Not checked today"
 * existed on one QA screen. Filling went eighteen days.
 *
 * The only thing putting a scale check on an operator's phone was the Daily
 * Scale PM work order — the duplicate recording path D-011 exists to retire.
 * Retiring it first would have removed the last prompt the floor had, which
 * is why this ships before that does.
 *
 * ONE DERIVATION, THREE READERS: the Calibration tab's status cards, the
 * Operator View's due strip and the compliance bell all call these. The
 * status used to be inline in the route with `date('now')` — UTC — so the
 * cards flipped to "Not checked today" at 6pm Mountain. See plant-clock.js.
 *
 * Nothing here writes. A scale check is filed through
 * `recordScaleVerification` and nowhere else; the card disappears because the
 * record exists — the record IS the completion, the `closeRecleanTasksFor`
 * rule.
 */
import { SCALE_FORMS } from './scale-forms.js';
import { plantDateOf, plantHour, plantWeekday } from './plant-clock.js';
import { holidayOn } from './plant-calendar.js';

/**
 * A form's `area` is the plant's word on the paper; a task group is what
 * routes work to a screen. Explicit, and asserted to cover every form, rather
 * than lower-casing the area and hoping.
 */
export const TEAM_OF_AREA = Object.freeze({
  Batching: 'batching',
  Filling: 'filling',
  Kitting: 'kitting',
});

/**
 * THE PLANT'S NUMBER, not a rule from a standard: the checks are run "before
 * production starts" (the tab's own words), so a bell line at 00:01 saying
 * five checks are not run would be noise. From this hour the silence is a
 * gap worth telling QA about. The Operator View strip is not gated — it is a
 * prompt to do the work, and a prompt at 5am is exactly when it is wanted.
 */
export const SCALE_CHECK_GRACE_HOUR = 9;

/**
 * WHICH TEAMS ARE OPERATING TODAY (D-181). SOP 417's own note says the check is
 * performed "daily when operating in a production room", and the cards asked
 * every team every weekday — so a Friday with no Kitting, or a week Batching was
 * not running, read as missed checks, and a list that is wrong about who was
 * here is one QA stops reading.
 *
 * A team owes its check when ANY of three things says it is here today:
 *   1. the production schedule has a production cell for it today (a cleaning-
 *      only cell is not a run — the missed-report rule);
 *   2. a production run was started for it today (D-146);
 *   3. it filed a production entry for today.
 * The last two catch a run nobody put on the schedule: the team is on the floor,
 * so the scale is in use. Nothing here is stored; it is read on every ask.
 *
 * A DAY WITH NOTHING ON THE SCHEDULE ASKS NOBODY, and says so in words
 * (`schedule_blank`) rather than looking like a quiet day — the schedule is
 * what this follows, so an empty one is a gap somebody can see.
 */
const TEAM_ALIASES = { 'stick pack': 'filling', sticks: 'filling', 'hand fill': 'filling', hand_fill: 'filling' };
export function teamKey(team, room = '') {
  const t = String(team || '').trim().toLowerCase();
  if (t) return TEAM_ALIASES[t] || t;
  return /^batching/i.test(String(room || '')) ? 'batching' : null;
}

export function teamsOperating(db, date) {
  const out = new Map();
  const add = (team, why, room) => {
    const k = teamKey(team, room);
    if (k && !out.has(k)) out.set(k, why);
  };
  let scheduledRows = 0;
  try {
    const rows = db.prepare(`SELECT team, room FROM production_schedule
      WHERE room_type = 'production' AND date(week_start, '+' || day_of_week || ' days') = ?`).all(date);
    scheduledRows = rows.length;
    for (const r of rows) add(r.team, 'schedule', r.room);
  } catch { /* table absent on a partial database */ }
  try {
    for (const r of db.prepare(`SELECT team, room, started_at FROM production_runs
      WHERE started_at >= datetime(?, '-1 day') AND started_at < datetime(?, '+2 day')`).all(date, date)) {
      if (plantDateOf(r.started_at) === date) add(r.team, 'run', r.room);
    }
  } catch { /* table absent */ }
  try {
    for (const r of db.prepare('SELECT team, room FROM production_entries WHERE date = ?').all(date)) add(r.team, 'entry', r.room);
  } catch { /* table absent */ }
  return { teams: out, schedule_blank: scheduledRows === 0 };
}

const shape = (r) => r && ({ ...r, readings: safeParse(r.readings) });
function safeParse(s) { try { return JSON.parse(s || '[]'); } catch { return []; } }

/**
 * One row per form: today's check (plant day) and the latest ever.
 * `today` is null when nothing has been filed for the form since the plant's
 * midnight; `latest` is null when nothing has ever been filed.
 */
export function scaleCheckStatus(db, { now = new Date() } = {}) {
  const today = plantDateOf(now);
  // The last few days, not `date('now')`: the plant day and the UTC day
  // overlap differently every evening, so the decision is made in JS against
  // the plant's calendar.
  const recent = db.prepare(`SELECT * FROM scale_verifications
    WHERE performed_at >= datetime('now', '-3 days') ORDER BY performed_at DESC`).all();
  const latestStmt = db.prepare(`SELECT * FROM scale_verifications WHERE form_code = ?
    ORDER BY performed_at DESC LIMIT 1`);
  // A PAID HOLIDAY OWES NO DAILY CHECK (D-176) — the plant is closed. The
  // status still reports what was filed; only "due" stands down.
  const holiday = holidayOn(db, today);
  const { teams, schedule_blank } = teamsOperating(db, today);
  return {
    date: today,
    holiday: holiday ? { name: holiday.name, name_es: holiday.name_es } : null,
    schedule_blank,
    forms: SCALE_FORMS.map(f => {
      const todayRow = recent.find(r => r.form_code === f.code && plantDateOf(r.performed_at) === today) || null;
      const latest = latestStmt.get(f.code) || null;
      const team = TEAM_OF_AREA[f.area] || null;
      // A form with no team mapping is always asked — never silently dropped.
      const operating = team ? teams.get(team) || null : 'unmapped';
      return {
        code: f.code, title: f.title, short: f.short, area: f.area,
        team,
        today: shape(todayRow), latest: shape(latest),
        operating,
        due: !holiday && !todayRow && !!operating,
      };
    }),
  };
}

/**
 * The forms with no check filed today, optionally for one team. `group`
 * null means everyone's — the admin browsing "All Teams".
 */
export function scaleChecksDue(db, { group = null, now = new Date() } = {}) {
  const status = scaleCheckStatus(db, { now });
  if (status.holiday) return [];
  // Due = not filed today AND the team is operating today (D-181).
  return status.forms
    .filter(f => f.due)
    .filter(f => !group || f.team === group);
}

/** Whether the bell should say so yet: a weekday, past the grace hour. */
export function scaleChecksOverdueNow(now = new Date(), db = null) {
  if (db && holidayOn(db, plantDateOf(now))) return false;
  return plantWeekday(now) && plantHour(now) >= SCALE_CHECK_GRACE_HOUR;
}
