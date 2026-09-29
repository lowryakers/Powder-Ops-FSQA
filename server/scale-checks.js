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
  return {
    date: today,
    forms: SCALE_FORMS.map(f => {
      const todayRow = recent.find(r => r.form_code === f.code && plantDateOf(r.performed_at) === today) || null;
      const latest = latestStmt.get(f.code) || null;
      return {
        code: f.code, title: f.title, short: f.short, area: f.area,
        team: TEAM_OF_AREA[f.area] || null,
        today: shape(todayRow), latest: shape(latest),
      };
    }),
  };
}

/**
 * The forms with no check filed today, optionally for one team. `group`
 * null means everyone's — the admin browsing "All Teams".
 */
export function scaleChecksDue(db, { group = null, now = new Date() } = {}) {
  return scaleCheckStatus(db, { now }).forms
    .filter(f => !f.today)
    .filter(f => !group || f.team === group);
}

/** Whether the bell should say so yet: a weekday, past the grace hour. */
export function scaleChecksOverdueNow(now = new Date()) {
  return plantWeekday(now) && plantHour(now) >= SCALE_CHECK_GRACE_HOUR;
}
