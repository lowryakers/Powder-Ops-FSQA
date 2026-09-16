// The Cleanup Review pile, on somebody's ReadyBot instead of nobody's screen.
//
// Cleanup Review has existed since before go-live and does the right thing:
// stale open tasks close as CANCELLED with a reason, unsigned production entries
// are WAIVED and never signed, recurring schedules are untouched, and an admin
// picks every row by hand. What it never had was a voice. On 14 September the
// pile was 116 open tasks and PMs due before that day — many of them dated
// 24 August — and nobody was being asked about any of it.
//
// So this is a DIGEST AND NOTHING ELSE. It closes nothing, waives nothing and
// dismisses nothing; it counts what is sitting there and says so. Every rule in
// Cleanup Review about who may close and with what reason is untouched, because
// a pile cleared by a scheduled job is indistinguishable from a pile that was
// never there — which is precisely the gap an auditor asks about.
//
// THE COUNTS COME FROM `cleanup.js` ITSELF, never from a second query written
// here. A digest that disagrees with the screen it links to is worse than no
// digest: whoever opens it cannot tell which number is wrong.
import { counts as cleanupCounts } from './cleanup.js';
import { postMessageAs, botDm } from './api/comms.js';
import { pushToUser } from './push.js';
import { readyDocOrigin } from './links.js';

// Send when the pile is merely there; send weekly when it is big enough that
// biweekly would let it grow faster than it is worked. 116 clears this by a
// wide margin; the number is the plant's to move.
export const CLEANUP_BUSY_THRESHOLD = 25;

/** Today, as the cutoff the screen defaults to. */
export const todayStr = (now = new Date()) =>
  `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

/**
 * Who hears about the pile.
 *
 * Stored like the Flash Report's list so it is a settings change rather than a
 * deploy. Unset does NOT mean nobody — a digest configured and never delivered
 * is indistinguishable from a broken job — it means the people who would be
 * asked anyway: every active admin, the QA leadership, and Adam, who owns
 * whether a recurring PM should still be generating at all.
 *
 * Adam is matched BY NAME with a department fallback, the `env-limits`
 * precedent: a rename or an absence must not silence the digest, and there is
 * no second list of email addresses to go stale.
 */
export function cleanupDigestRecipients(db) {
  const chosen = (() => {
    try { return JSON.parse(db.prepare("SELECT value FROM app_settings WHERE key = 'cleanup_review_recipients'").get()?.value || 'null'); }
    catch { return null; }
  })();
  if (Array.isArray(chosen) && chosen.length) {
    const ph = chosen.map(() => '?').join(',');
    return db.prepare(`SELECT id, name FROM users WHERE id IN (${ph}) AND is_active = 1`).all(...chosen);
  }
  return db.prepare(`SELECT id, name FROM users
    WHERE is_active = 1 AND name != 'ReadyBot' AND role != 'auditor'
      AND (role = 'admin'
           OR (role = 'supervisor' AND LOWER(COALESCE(department,'')) = 'qa')
           OR LOWER(name) LIKE 'adam %' OR LOWER(name) = 'adam')
    ORDER BY name`).all();
}

// Which cadence a recurring task came off. Read from the SCHEDULE's own
// `frequency_type`, not guessed from the title — the English in a title is what
// somebody typed, and "Daily PM Checklist — Production (Cleaning)" has already
// caught this codebase out once.
const BUCKETS = [
  { key: 'daily', label: 'Daily PM', match: ['daily'] },
  { key: 'weekly', label: 'Weekly PM', match: ['weekly'] },
  { key: 'periodic', label: 'Monthly and longer', match: ['monthly', 'quarterly', 'semi_annual', 'annual'] },
  // A task with no schedule behind it: raised from a chat message, a one-off,
  // a re-clean. Nothing regenerates these, so they are a different kind of
  // backlog from a cadence that is still producing.
  { key: 'one_off', label: 'One-off (no schedule)', match: [] },
];

/**
 * What is sitting in Cleanup Review right now. Pure read — writes nothing.
 */
export function cleanupDigest(db, cutoff = todayStr()) {
  const piles = cleanupCounts(db, cutoff);
  const tasks = piles.find(p => p.key === 'work-orders')?.count || 0;
  const qa = piles.find(p => p.key === 'production-qa')?.count || 0;

  const byFreq = db.prepare(`
    SELECT COALESCE(s.frequency_type, '') AS freq, COUNT(*) AS c
    FROM work_orders wo LEFT JOIN pm_schedules s ON s.id = wo.pm_schedule_id
    WHERE wo.status IN ('open','in_progress','overdue','missed') AND wo.due_date < ?
    GROUP BY 1`).all(cutoff);

  const buckets = BUCKETS.map(b => ({
    key: b.key,
    label: b.label,
    count: byFreq.filter(r => (b.match.length ? b.match.includes(r.freq) : !r.freq))
      .reduce((n, r) => n + r.c, 0),
  }));

  const oldest = db.prepare(`SELECT MIN(due_date) d FROM work_orders
    WHERE status IN ('open','in_progress','overdue','missed') AND due_date < ?`).get(cutoff)?.d || null;

  return { cutoff, tasks, qa, total: tasks + qa, buckets, oldest };
}

/**
 * The message. Counts and one link — never 116 titles, which on a phone is a
 * wall somebody scrolls past and on any screen is the list Cleanup Review
 * already renders properly.
 */
export function renderCleanupDigest(d, { base = '' } = {}) {
  const lines = [`⏰ *Still waiting* — 🧹 *Cleanup Review — ${d.tasks} open task${d.tasks === 1 ? '' : 's'} and PM${d.tasks === 1 ? '' : 's'} due before today*`];
  const named = d.buckets.filter(b => b.count > 0);
  if (named.length) lines.push(named.map(b => `${b.label}: ${b.count}`).join(' · '));
  if (d.oldest) lines.push(`Oldest due ${d.oldest}.`);
  if (d.qa) lines.push(`Also ${d.qa} production entr${d.qa === 1 ? 'y' : 'ies'} still waiting on a QA signature.`);
  // The reason a Daily or Weekly bucket stays large is usually not junk — it is
  // a schedule still generating work nobody is doing, which is a different fix
  // from cancelling the rows. Say so rather than making them find it out twice.
  const recurring = d.buckets.filter(b => ['daily', 'weekly'].includes(b.key)).reduce((n, b) => n + b.count, 0);
  if (recurring >= 10) {
    lines.push(`\n${recurring} of these come off Daily or Weekly schedules. If those are still generating work nobody does, the schedule is the fix — cancelling the rows only clears today's.`);
  }
  lines.push('\n*Nothing here is closed automatically.* Open Cleanup Review, pick the rows and give a reason; recurring schedules are not touched either way.');
  lines.push(`[Open Cleanup Review](${base}/?tab=settings&section=cleanup)`);
  return lines.join('\n');
}

/**
 * Send it. Best-effort per recipient — one person's dead push subscription must
 * not cost the other four their digest — and never throws out of the job.
 */
export async function sendCleanupDigest(db, now = new Date()) {
  const d = cleanupDigest(db, todayStr(now));
  // A quiet plant produces no message at all. A digest that arrives saying zero
  // is one people learn to delete unread, and then they delete the one that matters.
  if (!d.total) return { sent: 0, ...d };

  const text = renderCleanupDigest(d, { base: readyDocOrigin() });
  const people = cleanupDigestRecipients(db);
  let sent = 0;
  for (const u of people) {
    try {
      const { bot, dm } = botDm(db, u.id);
      await postMessageAs(db, dm, bot, text);
      pushToUser(u.id, {
        title: 'Cleanup Review',
        body: `${d.tasks} open tasks and PMs due before today${d.oldest ? `, oldest ${d.oldest}` : ''}`,
        tag: 'cleanup-digest', renotify: false, url: '/?tab=settings&section=cleanup',
      }).catch(() => {});
      sent++;
    } catch { /* one bad DM must not stop the rest */ }
  }
  return { sent, recipients: people.length, ...d };
}

// Deliberately a DM and never a channel post: a backlog is one person's job to
// work, and a channel post makes it everybody's to feel vaguely bad about. Same
// reasoning as the Flash Report.
