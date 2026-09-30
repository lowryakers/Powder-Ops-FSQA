// Scheduled runs with no end-of-day report, chased on ReadyBot.
//
// On 14 September the Production Log carried a collapsed yellow bar reading
// "44 scheduled production runs have no end-of-day report" — and that bar is
// rendered only for admins and QA, so the supervisors who actually FILE an EOD
// report could not see it even if they opened the screen. The one group that
// can close the gap was the one group never told about it. Same failure as the
// 72-hour re-clean badge the cleaner could not see, and as the QA correction
// that sat on a banner for a fortnight (D-083).
//
// THIS FILES NOTHING AND DISMISSES NOTHING. A missing end-of-day report is a
// missing record; producing one from a schedule row would be inventing a shift
// nobody reported, which is worse than the gap. Dismissal stays what it was — a
// supervisor's review, with a reason, on the record.
import { missedReports } from './api/production.js';
import { postMessageAs, botDm } from './api/comms.js';
import { pushToUser } from './push.js';
import { readyDocOrigin } from './links.js';

// Above this the digest goes daily rather than weekly: a backlog growing faster
// than it is worked needs a different rhythm from one that is merely there.
// 44 clears it.
export const EOD_BUSY_THRESHOLD = 25;

// How old a gap has to be before the digest calls it out separately and makes
// sure Quality and Adam are on the message whatever the recipient list says.
// The plant's number, clamped: under a day chases a shift that may still be
// being written up, and beyond three days it is not a chase.
export const EOD_ESCALATE_DEFAULT = 48;
export function eodEscalateHours(db) {
  const raw = (() => {
    try { return db.prepare("SELECT value FROM app_settings WHERE key = 'eod_missed_escalate_hours'").get()?.value; }
    catch { return null; }
  })();
  const n = Number(raw);
  if (!Number.isFinite(n)) return EOD_ESCALATE_DEFAULT;
  return Math.min(72, Math.max(24, Math.round(n)));
}

const ACTIVE = "is_active = 1 AND name != 'ReadyBot' AND role != 'auditor' AND COALESCE(is_external, 0) = 0";

// A SCHEDULED RUN BELONGS TO A TEAM, AND THE TEAM HAS A SUPERVISOR (D-127).
// The default list asked for supervisors in department `production` — the
// LEGACY value that split into batching / kitting / filling (D-094). Every
// go-forward supervisor carries their TEAM as their department, so the people
// who file these reports were the one group the chase never reached, while QA
// and the admins got a plant-wide count they cannot file. A schedule's team
// names the team; the team's department is the same word (`shared/task-groups`).
// Sticks and Hand Fill merged into Filling (filling-merge.js), so old rows
// still find today's supervisor. Anything else has no owner and is REPORTED.
const TEAM_TO_DEPARTMENT = {
  filling: 'filling', batching: 'batching', kitting: 'kitting',
  sticks: 'filling', 'hand fill': 'filling', hand_fill: 'filling',
};
export const departmentForTeam = (team) => TEAM_TO_DEPARTMENT[String(team ?? '').trim().toLowerCase()] || null;
export const PRODUCTION_DEPARTMENTS = ['filling', 'batching', 'kitting'];

/** The supervisors who own a production team's reports. */
export function teamSupervisors(db, department) {
  if (!department) return [];
  return db.prepare(`SELECT id, name FROM users WHERE ${ACTIVE}
    AND role = 'supervisor' AND LOWER(COALESCE(department,'')) = ? ORDER BY name`).all(department);
}

/**
 * Who is chased.
 *
 * Stored like the Flash Report's list. Unset is not nobody: the production
 * supervisors who file the reports, Adam, and the admins. Adam is matched by
 * NAME with a department fallback (the env-limits precedent) so a rename cannot
 * silence it, and there is no second list of addresses anywhere to go stale.
 */
export function eodMissedRecipients(db) {
  const chosen = (() => {
    try { return JSON.parse(db.prepare("SELECT value FROM app_settings WHERE key = 'eod_missed_recipients'").get()?.value || 'null'); }
    catch { return null; }
  })();
  if (Array.isArray(chosen) && chosen.length) {
    const ph = chosen.map(() => '?').join(',');
    return db.prepare(`SELECT id, name FROM users WHERE id IN (${ph}) AND is_active = 1`).all(...chosen);
  }
  return db.prepare(`SELECT id, name FROM users WHERE ${ACTIVE}
    AND (role = 'admin'
         OR (role = 'supervisor' AND LOWER(COALESCE(department,'')) IN ('production','qa','filling','batching','kitting'))
         OR LOWER(name) LIKE 'adam %' OR LOWER(name) = 'adam')
    ORDER BY name`).all();
}

// The people a gap older than the threshold reaches whatever the list says.
// A narrowed recipient list is a preference; an EOD report three days missing
// is a records gap, and Quality finding out about it late is the failure.
function escalationWatchers(db) {
  return db.prepare(`SELECT id, name FROM users WHERE ${ACTIVE}
    AND (role = 'admin'
         OR (role = 'supervisor' AND LOWER(COALESCE(department,'')) = 'qa')
         OR LOWER(name) LIKE 'adam %' OR LOWER(name) = 'adam')
    ORDER BY name`).all();
}

/**
 * What is outstanding. Reads `missedReports` — the same walk the banner uses, so
 * the digest and the screen it links to cannot report different numbers.
 */
export function eodMissedDigest(db, now = new Date()) {
  const rows = missedReports(db, {});          // active only, dismissed excluded
  const escalateH = eodEscalateHours(db);
  const cutMs = now.getTime() - escalateH * 3600000;
  const overdue = rows.filter(r => new Date(`${r.date}T00:00:00Z`).getTime() < cutMs);

  const tally = (key) => {
    const m = new Map();
    for (const r of rows) {
      const k = r[key] || '—';
      m.set(k, (m.get(k) || 0) + 1);
    }
    return [...m.entries()].map(([k, count]) => ({ [key]: k, count }))
      .sort((a, b) => b.count - a.count);
  };

  // Who owns each team's gaps, and which teams have nobody to tell.
  const byDept = new Map();
  for (const r of rows) {
    const dept = departmentForTeam(r.team);
    const k = dept || `unowned:${r.team || '—'}`;
    if (!byDept.has(k)) byDept.set(k, { department: dept, team: r.team || '—', rows: [] });
    byDept.get(k).rows.push(r);
  }
  const owners = [...byDept.values()].map(g => ({
    ...g, supervisors: g.department ? teamSupervisors(db, g.department) : [],
  }));

  return {
    total: rows.length,
    owners,
    unowned: owners.filter(o => !o.supervisors.length).map(o => ({ team: o.team, count: o.rows.length })),
    oldest: rows.length ? rows.map(r => r.date).sort()[0] : null,
    byTeam: tally('team'),
    byRoom: tally('room'),
    overdue: overdue.length,
    escalate_hours: escalateH,
    // Rows where an entry EXISTS for that day and room under a differently
    // written MO. Not missing work — dirty data, and a different fix.
    possible_typos: rows.filter(r => r.possible_typo).length,
  };
}

/**
 * The message: counts, not 44 lines. The list already renders properly on the
 * screen this links to, and a wall of titles on a phone is a message people
 * scroll past.
 */
export function renderEodDigest(d, { base = '' } = {}) {
  const lines = [`⏰ *Still waiting* — 📋 *${d.total} scheduled run${d.total === 1 ? '' : 's'} with no end-of-day report*`];
  const teams = d.byTeam.filter(x => x.count > 0).map(x => `${x.team}: ${x.count}`).join(' · ');
  if (teams) lines.push(teams);
  const rooms = d.byRoom.slice(0, 6).map(x => `${x.room}: ${x.count}`).join(' · ');
  if (rooms) lines.push(`Rooms — ${rooms}`);
  if (d.oldest) lines.push(`Oldest ${d.oldest}.`);
  if (d.overdue) lines.push(`*${d.overdue} more than ${d.escalate_hours} hours old.*`);
  if (d.possible_typos) {
    lines.push(`${d.possible_typos} of these have an entry filed for the same day and room under a `
      + `differently written MO — those are a typo to correct, not a report to write.`);
  }
  for (const u of d.unowned || []) {
    lines.push(`*${u.team}: ${u.count} with no supervisor to tell* — nobody set as a ${u.team} supervisor in Settings, `
      + 'so these reach only this message.');
  }
  lines.push('\nFile the report from the Production Log, or a supervisor dismisses it with a reason. '
    + 'Nothing here is filed or dismissed automatically.');
  lines.push(`[Open Production Log](${base}/?tab=production-log&missed=1)`);
  return lines.join('\n');
}

/**
 * The TEAM's own list, for its supervisor (D-127). Their runs by name — this is
 * their work, not a plant statistic — capped so a phone can still read it, with
 * the way out named: file it, or dismiss it with a reason if it never ran.
 */
export const TEAM_LIST_CAP = 12;
export function renderTeamDigest(owner, { base = '' } = {}) {
  const rows = [...owner.rows].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const n = rows.length;
  const lines = [`📋 *${owner.team}: ${n} scheduled run${n === 1 ? '' : 's'} with no end-of-day report*`];
  for (const r of rows.slice(0, TEAM_LIST_CAP)) {
    lines.push(`• ${r.date} · Room ${r.room} · ${r.mo_number || 'no MO'}${r.product_name ? ` · ${r.product_name}` : ''}`
      + (r.possible_typo ? ' _(an entry exists under a differently written MO — correct the MO)_' : ''));
  }
  if (n > TEAM_LIST_CAP) lines.push(`…and ${n - TEAM_LIST_CAP} more on the screen.`);
  lines.push('\nFile the report — or, if the run did not happen (moved, cancelled), dismiss it on the '
    + 'Production Log with the reason. Nothing is filed or dismissed automatically.');
  lines.push(`[Open Production Log](${base}/?tab=production-log&missed=1)`);
  return lines.join('\n');
}

/**
 * Send it. Best-effort per recipient; never throws out of the job.
 */
export async function sendEodMissedDigest(db, now = new Date()) {
  const d = eodMissedDigest(db, now);
  if (!d.total) return { sent: 0, ...d };       // a clean week says nothing at all

  const base = readyDocOrigin();
  const text = renderEodDigest(d, { base });

  // ONE MESSAGE PER PERSON. A team's supervisor is told about THEIR team's runs
  // whatever the stored list says — a report somebody owes is their own work,
  // the actor rule (D-079/D-086) — and gets that list rather than the plant
  // count. Everybody else on the list, and the escalation watchers, get the
  // plant summary as before.
  const messages = new Map();       // user id → { user, text, count }
  for (const o of d.owners) {
    if (!o.supervisors.length) continue;
    const t = renderTeamDigest(o, { base });
    for (const u of o.supervisors) {
      const prior = messages.get(u.id);
      messages.set(u.id, prior
        ? { user: u, text: `${prior.text}\n\n${t}`, count: prior.count + o.rows.length }
        : { user: u, text: t, count: o.rows.length });
    }
  }
  const summary = new Map();
  for (const u of eodMissedRecipients(db)) summary.set(u.id, u);
  if (d.overdue) for (const u of escalationWatchers(db)) summary.set(u.id, u);
  for (const u of summary.values()) if (!messages.has(u.id)) messages.set(u.id, { user: u, text, count: d.total });

  let sent = 0;
  for (const { user: u, text: body, count } of messages.values()) {
    try {
      const { bot, dm } = botDm(db, u.id);
      await postMessageAs(db, dm, bot, body);
      pushToUser(u.id, {
        title: 'End-of-day reports missing',
        body: `${count} scheduled run${count === 1 ? '' : 's'}${d.oldest ? `, oldest ${d.oldest}` : ''}`,
        tag: 'eod-missed', renotify: false, url: '/?tab=production-log&missed=1',
      }).catch(() => {});
      sent++;
    } catch { /* one bad DM must not stop the rest */ }
  }
  return {
    sent, recipients: messages.size,
    team_told: [...new Set(d.owners.flatMap(o => o.supervisors.map(u => u.name)))],
    ...d, owners: undefined,
  };
}
