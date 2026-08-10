// Recurring in-process jobs (single Railway instance — no external cron).
// An hourly tick runs each job at most once per due period, tracked in
// app_settings so restarts never double-run or skip.
//
//  - Friday: full data backup ZIP → R2 (backups/...), keep the last 8,
//    announce in #document_control.
//  - Monday: expiry digest → #quality (certifications expiring ≤30 days or
//    expired; calibration instruments due ≤30 days or overdue).
//  - Daily: Critical Tracking red alert → #quality when the set of RED
//    program areas changes (new red, or back to clear). Same computation as
//    the dashboard; no repeat pings while the same areas stay red.
//  - Every third day: ReadyBot DMs the admins when a ReadyDoc request has been
//    sitting untriaged. Requests live in an admin-only Settings pane nobody
//    has a reason to open, which is exactly how somebody's suggestion quietly
//    dies and they stop filing them.

import { readyDocOrigin } from './links.js';

export function startScheduledJobs(db, deps) {
  const tick = () => {
    try { runDue(db, deps); } catch (e) { console.warn('[jobs] tick failed:', e.message); }
  };
  setTimeout(tick, 30 * 1000); // shortly after boot (catches a missed Friday)
  setInterval(tick, 60 * 60 * 1000).unref();
}

const isoWeek = (d = new Date()) => {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
  const y = t.getUTCFullYear();
  const w = Math.ceil((((t - Date.UTC(y, 0, 1)) / 86400000) + 1) / 7);
  return `${y}-W${String(w).padStart(2, '0')}`;
};

function getFlag(db, key) { return db.prepare("SELECT value FROM app_settings WHERE key = ?").get(key)?.value || null; }
function setFlag(db, key, value) {
  db.prepare("INSERT OR REPLACE INTO app_settings (key, value, updated_at) VALUES (?, ?, datetime('now'))").run(key, value);
}

async function runDue(db, deps) {
  const { storageEnabled, putObject, deleteObject, buildBackupZip, getChannelByName, postMessageAs, getBotUser } = deps;
  const now = new Date();
  const week = isoWeek(now);
  const day = now.getDay(); // 0 Sun … 5 Fri

  // Weekly backup: due Friday; a boot on Sat/Sun still catches the missed run.
  if (day >= 5 || day === 0) {
    if (getFlag(db, 'last_auto_backup_week') !== week && storageEnabled()) {
      try {
        const name = `readydoc-backup-${now.toISOString().slice(0, 10)}.zip`;
        const key = `backups/${name}`;
        const buf = buildBackupZip(db, 'scheduled weekly job');
        await putObject(key, buf, 'application/zip');
        let list = [];
        try { list = JSON.parse(getFlag(db, 'auto_backups') || '[]'); } catch { list = []; }
        list.unshift({ key, name, at: now.toISOString(), size: buf.length });
        for (const old of list.slice(8)) deleteObject(old.key); // keep the last 8 weeks
        setFlag(db, 'auto_backups', JSON.stringify(list.slice(0, 8)));
        setFlag(db, 'last_auto_backup_week', week);
        console.log(`[jobs] weekly backup stored: ${key} (${Math.round(buf.length / 1024)} KB)`);
        const channel = getChannelByName(db, 'document_control') || getChannelByName(db, 'general');
        if (channel) {
          await postMessageAs(db, channel, getBotUser(db),
            `📦 Weekly data backup saved (${name}, ${Math.round(buf.length / 1024)} KB). Admins can download it any time from Settings → Data Backup.`);
        }
      } catch (e) { console.warn('[jobs] weekly backup failed:', e.message); }
    }
  }

  // Monday expiry digest (certifications + calibration).
  if (day === 1 && getFlag(db, 'last_expiry_digest_week') !== week) {
    try {
      const soon = (dateStr) => {
        if (!dateStr) return null;
        return Math.floor((new Date(dateStr) - Date.now()) / 86400000);
      };
      const lines = [];
      let certs = [];
      try { certs = db.prepare('SELECT person_name, cert_type, expiry_date FROM certifications WHERE expiry_date IS NOT NULL').all(); } catch { certs = []; }
      for (const c of certs) {
        const d = soon(c.expiry_date);
        if (d != null && d <= 30) lines.push(`• ${c.person_name} — ${c.cert_type}: ${d < 0 ? `EXPIRED ${-d}d ago` : `expires in ${d}d`} (${c.expiry_date})`);
      }
      let instruments = [];
      try { instruments = db.prepare("SELECT name, asset_number, next_due FROM calibration_instruments WHERE next_due IS NOT NULL AND status != 'retired'").all(); } catch { instruments = []; }
      for (const i of instruments) {
        const d = soon(i.next_due);
        if (d != null && d <= 30) lines.push(`• Calibration — ${i.name}${i.asset_number ? ` #${i.asset_number}` : ''}: ${d < 0 ? `OVERDUE ${-d}d` : `due in ${d}d`} (${i.next_due})`);
      }
      if (lines.length) {
        const channel = getChannelByName(db, 'quality') || getChannelByName(db, 'general');
        if (channel) {
          const base = readyDocOrigin();
          await postMessageAs(db, channel, getBotUser(db),
            `📋 Monday expiry check — ${lines.length} item${lines.length === 1 ? '' : 's'} need attention:\n${lines.slice(0, 20).join('\n')}${lines.length > 20 ? `\n…and ${lines.length - 20} more` : ''}\nOpen: ${base}/?tab=certifications · ${base}/?tab=calibration`);
        }
      }
      setFlag(db, 'last_expiry_digest_week', week);
    } catch (e) { console.warn('[jobs] expiry digest failed:', e.message); }
  }

  // Daily critical-programs alert. Runs once per day (first hourly tick),
  // but only posts when the red set actually changed since the last post.
  const todayStr = now.toISOString().slice(0, 10);
  if (deps.computeCritical && getFlag(db, 'last_critical_alert_check') !== todayStr) {
    try {
      const { readiness, categories } = deps.computeCritical(db);
      const redNow = Object.values(categories).filter(c => c.status === 'crit').map(c => c.label).sort();
      let redBefore = [];
      try { redBefore = JSON.parse(getFlag(db, 'critical_alerted_set') || '[]'); } catch { redBefore = []; }
      if (JSON.stringify(redNow) !== JSON.stringify(redBefore)) {
        const channel = getChannelByName(db, 'quality') || getChannelByName(db, 'general');
        if (channel) {
          // Red areas link straight to their owning module so the alert is
          // actionable in one tap; the summary links to Critical Tracking.
          const base = readyDocOrigin();
          const redLines = Object.values(categories).filter(c => c.status === 'crit')
            .map(c => `• ${c.label} (${c.count})${c.module ? ` → ${base}/?tab=${c.module}` : ''}`);
          const msg = redNow.length
            ? `🚨 Critical Tracking alert — ${redNow.length} program area${redNow.length === 1 ? ' is' : 's are'} RED:\n${redLines.join('\n')}\nAudit readiness is at ${readiness.score}%. Full picture: ${base}/?tab=critical-tracking`
            : `✅ Critical Tracking — all previously red program areas are resolved. Audit readiness is at ${readiness.score}%. ${base}/?tab=critical-tracking`;
          await postMessageAs(db, channel, getBotUser(db), msg);
        }
        setFlag(db, 'critical_alerted_set', JSON.stringify(redNow));
      }
      setFlag(db, 'last_critical_alert_check', todayStr);
    } catch (e) { console.warn('[jobs] critical alert failed:', e.message); }
  }

  // Monday PM digest: each team's recurring work for the week, posted into the
  // team's own channel — where people already look — like the schedule publish.
  if (day === 1 && getFlag(db, 'last_pm_digest_week') !== week) {
    try {
      await postPmWeekDigest(db, deps, now);
      setFlag(db, 'last_pm_digest_week', week);
    } catch (e) { console.warn('[jobs] PM digest failed:', e.message); }
  }

  await nudgeStaleRequests(db, deps, now);
}

/* ── Weekly PM digest per team ────────────────────────────────────────────── */

// The Task Center answers "what's open" for whoever opens it; this puts the
// week's recurring work where the team already reads — their channel. A team
// with no channel is skipped silently rather than dumped into #general, where
// another team's maintenance list is noise. Overdue leads, then day by day.
const ymdLocal = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export async function postPmWeekDigest(db, deps, now) {
  const { getChannelByName, postMessageAs, getBotUser } = deps;
  if (!getChannelByName || !postMessageAs || !getBotUser) return;

  const todayStr = ymdLocal(now);
  const weekEnd = new Date(now);
  weekEnd.setDate(weekEnd.getDate() + (7 - now.getDay())); // through Sunday
  const weekEndStr = ymdLocal(weekEnd);

  const rows = db.prepare(`
    SELECT wo.title, wo.due_date, wo.task_group, wo.assigned_to, e.name AS equipment_name
    FROM work_orders wo
    LEFT JOIN equipment e ON wo.equipment_id = e.id
    WHERE wo.status IN ('open', 'in_progress') AND wo.due_date <= ?
    ORDER BY wo.due_date ASC, wo.title
  `).all(weekEndStr);
  if (!rows.length) return;

  const byTeam = new Map();
  for (const r of rows) {
    const team = r.task_group || 'warehouse';
    if (!byTeam.has(team)) byTeam.set(team, []);
    byTeam.get(team).push(r);
  }

  const base = readyDocOrigin();
  const bot = getBotUser(db);
  const fmtDay = (dateStr) => {
    const [y, m, d] = dateStr.split('-').map(Number);
    const dt = new Date(y, m - 1, d);
    return `${['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][dt.getDay()]} ${m}/${d}`;
  };
  const itemLine = (t) => `  • ${t.title}${t.equipment_name && t.equipment_name !== t.title ? ` — ${t.equipment_name}` : ''}${t.assigned_to ? ` (${t.assigned_to})` : ''}`;

  for (const [team, tasks] of byTeam) {
    const channel = getChannelByName(db, team);
    if (!channel) continue;

    const overdue = tasks.filter(t => t.due_date < todayStr);
    const thisWeek = tasks.filter(t => t.due_date >= todayStr);
    const lines = [`🔧 *This week's tasks — ${team.replace(/_/g, ' ')}* (${tasks.length} open)`];
    if (overdue.length) {
      lines.push(`*Overdue (${overdue.length}):*`);
      lines.push(...overdue.slice(0, 5).map(itemLine));
      if (overdue.length > 5) lines.push(`  …and ${overdue.length - 5} more`);
    }
    let currentDay = '';
    let dayCount = 0;
    for (const t of thisWeek) {
      if (t.due_date !== currentDay) {
        currentDay = t.due_date;
        dayCount = 0;
        lines.push(`*${fmtDay(t.due_date)}:*`);
      }
      dayCount++;
      if (dayCount <= 5) lines.push(itemLine(t));
      else if (dayCount === 6) lines.push('  …and more — see your task list');
    }
    lines.push(`Open your list: ${base}/?tab=operator`);
    try {
      await postMessageAs(db, channel, bot, lines.join('\n'));
    } catch (e) { console.warn(`[jobs] PM digest to #${team} failed:`, e.message); }
  }
}

/* ── Untriaged ReadyDoc requests ──────────────────────────────────────────── */

// A request nobody looks at is worse than no request box: the person who filed
// it concludes it goes nowhere and stops telling you things. Triage lives in an
// admin-only Settings pane, which is not a screen anyone opens without a
// reason — so the reason comes and finds them.
//
// Two deliberate limits, both about not becoming noise:
//
//  · GRACE. Nothing is stale for STALE_DAYS. Filing a request and being
//    pinged about it the same afternoon trains people to ignore the ping.
//  · A FLOOR ON THE CADENCE. At most one DM every NUDGE_EVERY_DAYS, however
//    many requests are waiting. A daily reminder about the same three rows is
//    a thing people mute, and a muted reminder is worse than none.
//
// It re-sends while they are still open, on purpose: "I've been meaning to get
// to that" is the state this exists to interrupt.
const STALE_DAYS = 3;
const NUDGE_EVERY_DAYS = 3;

async function nudgeStaleRequests(db, deps, now) {
  const { getBotUser, postMessageAs, botDm, pushToUser } = deps;
  if (!botDm || !postMessageAs || !getBotUser) return;
  try {
    // The queue is read BEFORE the cadence floor is applied, not after. The
    // floor exists to stop repeat nagging about the same rows; it must not
    // also stop an emptied queue from resetting the clock, or the next request
    // to go stale sits out the remainder of a window it had nothing to do with.
    const cutoff = new Date(now.getTime() - STALE_DAYS * 86400000).toISOString().slice(0, 19).replace('T', ' ');
    const stale = db.prepare(`SELECT id, body, area, submitted_by, created_at FROM app_requests
      WHERE status = 'open' AND created_at <= ? ORDER BY created_at ASC LIMIT 50`).all(cutoff);
    if (!stale.length) {
      setFlag(db, 'last_request_nudge_at', '');
      return;
    }

    const last = getFlag(db, 'last_request_nudge_at');
    if (last && (now - new Date(last)) < NUDGE_EVERY_DAYS * 86400000) return;

    // Triage is admin-only, so the admins are who this is for. ReadyBot itself
    // is a user row and must never be DM'd by ReadyBot.
    const admins = db.prepare(`SELECT id, name FROM users
      WHERE role = 'admin' AND is_active = 1 AND name != 'ReadyBot'`).all();
    if (!admins.length) return;

    const oldestDays = Math.floor((now - new Date(stale[0].created_at.replace(' ', 'T') + 'Z')) / 86400000);
    const lines = stale.slice(0, 5).map(r => {
      const body = String(r.body || '').replace(/\s+/g, ' ').slice(0, 110);
      return `• ${body}${body.length >= 110 ? '…' : ''} — ${r.submitted_by || 'someone'}${r.area ? ` (${r.area})` : ''}`;
    });
    const more = stale.length > 5 ? `\n…and ${stale.length - 5} more.` : '';
    // Bot message bold is *text*, not **text** — the chat renderer isn't markdown.
    const msg = `📥 *${stale.length} ReadyDoc request${stale.length === 1 ? '' : 's'} waiting* — the oldest has been open ${oldestDays} day${oldestDays === 1 ? '' : 's'}.\n${lines.join('\n')}${more}\nTriage them: ${readyDocOrigin()}/?tab=settings&section=requests`;

    for (const admin of admins) {
      try {
        const { bot, dm } = botDm(db, admin.id);
        await postMessageAs(db, dm, bot, msg);
        // A DM isn't covered by the grouped channel push, so it is sent directly.
        pushToUser?.(admin.id, {
          title: '📥 ReadyDoc requests waiting',
          body: `${stale.length} open, oldest ${oldestDays} day${oldestDays === 1 ? '' : 's'}`,
          tag: `channel-${dm.id}`, renotify: true, url: '/?tab=settings&section=requests',
        })?.catch?.(() => {});
      } catch (e) { console.warn(`[jobs] request nudge to ${admin.name} failed:`, e.message); }
    }
    setFlag(db, 'last_request_nudge_at', now.toISOString());
  } catch (e) { console.warn('[jobs] request nudge failed:', e.message); }
}
