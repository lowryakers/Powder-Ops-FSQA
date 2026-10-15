// The plant calendar on the server: the rules in shared/plant-holidays.js plus
// the plant's per-year corrections, and the ONE announcement each holiday week
// gets (D-175).
import {
  holidayInstances, holidaysBetween, weekCalendar, weekStartOf, addDays,
  noticeDateFor, weekSummaryLines, shortDate, RULE_BY_KEY, isDate,
} from '../shared/plant-holidays.js';
import { plantDateOf, plantWallClock } from './plant-clock.js';

export function loadOverrides(db) {
  try { return db.prepare('SELECT * FROM plant_holiday_overrides').all(); } catch { return []; }
}

// THE ONE ANSWER TO "IS THE PLANT CLOSED ON THIS DAY?" (D-176). Every reader
// that must stand down on a paid holiday — the task generator, the scale-check
// strip, ReadyBot's reminders, the missed-report chase — asks this, never the
// rules directly, so a correction in Settings moves all of them at once.
// Cached per database for a minute; a correction clears the cache.
let closedCache = null;
function closedDates(db) {
  const now = Date.now();
  if (closedCache && closedCache.db === db && now - closedCache.at < 60000) return closedCache.map;
  const ov = loadOverrides(db);
  const y = new Date().getUTCFullYear();
  const map = new Map(holidayInstances(y - 2, y + 3, ov).filter(h => !h.cancelled).map(h => [h.date, h]));
  closedCache = { db, at: now, map };
  return map;
}
export function clearClosedCache() { closedCache = null; }

/** The paid holiday observed on a 'YYYY-MM-DD' date, or null. */
export function holidayOn(db, dateStr) {
  if (!db || !isDate(String(dateStr || '').slice(0, 10))) return null;
  try { return closedDates(db).get(String(dateStr).slice(0, 10)) || null; } catch { return null; }
}

/** A weekend or a paid holiday — a day nothing is owed. */
export function isClosedDay(db, dateStr) {
  const d = String(dateStr || '').slice(0, 10);
  if (!isDate(d)) return false;
  const w = new Date(d + 'T00:00:00Z').getUTCDay();
  return w === 0 || w === 6 || !!holidayOn(db, d);
}

/** The first day on or after `dateStr` the plant is open. */
export function nextWorkday(db, dateStr) {
  let d = String(dateStr).slice(0, 10);
  for (let i = 0; i < 14 && isClosedDay(db, d); i++) d = addDays(d, 1);
  return d;
}

export function yearCalendar(db, year) {
  return holidayInstances(year, year, loadOverrides(db));
}

export function weekFor(db, weekStart) {
  return weekCalendar(weekStart, loadOverrides(db));
}

/**
 * The weeks with a holiday in the next `days` days, each with its summary —
 * what the "Coming up" strip and the Operator View render. A week already
 * under way still shows until it ends.
 */
export function upcoming(db, { today = plantDateOf(), days = 60 } = {}) {
  const ov = loadOverrides(db);
  const hols = holidaysBetween(weekStartOf(today), addDays(today, days), ov)
    .filter(h => addDays(h.week_start, 4) >= today);
  const weeks = [...new Set(hols.map(h => h.week_start))].sort();
  return weeks.map(ws => {
    const w = weekCalendar(ws, ov);
    return {
      ...w,
      summary: weekSummaryLines(w),
      summary_es: weekSummaryLines(w, 'es'),
      notice_on: noticeDateFor(ws),
      this_week: ws === weekStartOf(today),
    };
  });
}

/** A correction to one year of one rule. Reason required; audited by the caller. */
export function setOverride(db, { key, year, observed_on, cancelled, shift_week, reason, by }) {
  if (!RULE_BY_KEY[key]) return { error: `No paid holiday called "${key}".` };
  if (!Number.isInteger(year) || year < 2000 || year > 2100) return { error: 'year must be a year.' };
  if (!reason || String(reason).trim().length < 3) return { error: 'A reason is required (at least 3 characters).' };
  if (observed_on != null && observed_on !== '' && !isDate(observed_on)) return { error: 'observed_on must be YYYY-MM-DD.' };
  if (observed_on && Math.abs(Number(observed_on.slice(0, 4)) - year) > 1) return { error: 'The observed date must be within a year of the holiday.' };
  const shift = shift_week === undefined || shift_week === null ? null : (shift_week ? 1 : 0);
  const before = db.prepare('SELECT * FROM plant_holiday_overrides WHERE holiday_key = ? AND year = ?').get(key, year) || null;
  db.prepare(`INSERT INTO plant_holiday_overrides (holiday_key, year, observed_on, cancelled, shift_week, reason, set_by, set_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
              ON CONFLICT(holiday_key, year) DO UPDATE SET observed_on = excluded.observed_on, cancelled = excluded.cancelled,
                shift_week = excluded.shift_week, reason = excluded.reason, set_by = excluded.set_by, set_at = excluded.set_at`)
    .run(key, year, observed_on || null, cancelled ? 1 : 0, shift, String(reason).trim(), by || null);
  clearClosedCache();
  const after = db.prepare('SELECT * FROM plant_holiday_overrides WHERE holiday_key = ? AND year = ?').get(key, year);
  return { before, after };
}

export function clearOverride(db, key, year) {
  const before = db.prepare('SELECT * FROM plant_holiday_overrides WHERE holiday_key = ? AND year = ?').get(key, year) || null;
  db.prepare('DELETE FROM plant_holiday_overrides WHERE holiday_key = ? AND year = ?').run(key, year);
  clearClosedCache();
  return { before };
}

export function announcementText(week) {
  const names = week.holidays.map(h => h.name).join(' & ');
  return [
    `📅 *Paid holiday — week of ${shortDate(week.week_start)}: ${names}*`,
    '',
    ...weekSummaryLines(week).map(l => `  • ${l}`),
    '',
    `*Día festivo pagado — semana del ${shortDate(week.week_start)}*`,
    ...weekSummaryLines(week, 'es').map(l => `  • ${l}`),
    '',
    'ReadyDoc → Schedule shows every holiday coming up.',
  ].join('\n');
}

/**
 * ONE notice per holiday week, on the Monday of the week before (from 6am plant
 * time). A missed Monday — a deploy, a restart — still goes out on the next tick
 * before the holiday week starts; after that it is late news and is skipped.
 * Posted by ReadyBot in #announcements and pushed to every active employee:
 * holidays are plant-wide, and a channel post alone reaches only whoever opens it.
 */
export async function sendHolidayNotices(db, deps, now = new Date()) {
  const { getChannelByName, postMessageAs, getBotUser, pushToUser } = deps;
  const wall = plantWallClock(now);
  if (wall.getHours() < 6) return { sent: 0 };
  const today = plantDateOf(now);
  const ov = loadOverrides(db);
  const weeks = [...new Set(holidaysBetween(addDays(today, 1), addDays(today, 14), ov).map(h => h.week_start))];
  let sent = 0;
  for (const ws of weeks) {
    if (!(noticeDateFor(ws) <= today && today < ws)) continue;
    if (db.prepare('SELECT 1 FROM plant_holiday_notices WHERE week_start = ?').get(ws)) continue;
    const week = weekCalendar(ws, ov);
    // Claim the week first, so two ticks can never post it twice.
    db.prepare('INSERT INTO plant_holiday_notices (week_start) VALUES (?)').run(ws);
    let messageId = null;
    try {
      const ch = getChannelByName(db, 'announcements');
      if (ch) messageId = (await postMessageAs(db, ch, getBotUser(db), announcementText(week)))?.id || null;
      else console.warn('[holidays] no #announcements channel — the notice is pushed only');
    } catch (e) { console.warn('[holidays] post failed:', e.message); }
    let pushed = 0;
    if (pushToUser) {
      const people = db.prepare(`SELECT id FROM users WHERE is_active = 1 AND COALESCE(is_external, 0) = 0
                                   AND role != 'auditor' AND name != 'ReadyBot'`).all();
      const title = `Paid holiday: ${week.holidays.map(h => h.name).join(' & ')}`;
      const body = weekSummaryLines(week).join(' ');
      for (const p of people) {
        pushToUser(p.id, { title, body, tag: `holiday-${ws}`, url: '/?tab=operator' }).catch(() => {});
        pushed++;
      }
    }
    db.prepare('UPDATE plant_holiday_notices SET message_id = ?, pushed = ? WHERE week_start = ?').run(messageId, pushed, ws);
    sent++;
  }
  return { sent };
}
