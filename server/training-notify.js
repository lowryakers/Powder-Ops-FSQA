// Telling somebody they have been assigned a course.
//
// THE ASSIGNMENT WAS SILENT. Daniela assigned training and reported that none
// of it appeared for the employees. Every part of the mechanism was working —
// the work order is written, it is on the assignee's own `/pm/operator-tasks`,
// completing it files the record — and the assignment still reached nobody,
// for three reasons that compound:
//
//   1. AN ACCOUNT WITH NO MODULES gets a 403 from every guarded mount (a NULL
//      map is an empty account) and sees the welcome screen. The task exists
//      and there is no screen in the app that will show it to them.
//   2. AN ACCOUNT WITH MODULES BUT NEITHER the Operator View nor the Task
//      Center holds no screen that asks for work orders. The API answers; the
//      person has nowhere to ask from.
//   3. EVEN WITH THE SCREEN, the default due date is fourteen days out, so the
//      card lands in "Upcoming" — which collapses itself once the day's work
//      runs past five tasks. Present, and behind a closed header.
//
// So this is the re-clean badge again, in its fourth place: an ask that lives
// only on a screen reaches whoever opens that screen, which is not reliably
// the person who has to act. The answer is the one D-083 and D-077 already
// use — TELL THE PERSON — and it is the only channel that clears all three,
// because Messages is not behind the module guard and is the one thing every
// account has.
//
// Nothing here widens access. It does not grant a module, it does not move a
// due date, and it does not make a course completable from a DM.

import { botDm, postMessageAs } from './api/comms.js';
import { pushToUser } from './push.js';
import { readyDocOrigin } from './links.js';
import { taskListReach } from './module-access.js';

/** Outstanding, in the one vocabulary the rest of the app uses. */
const LIVE = "('open','in_progress','overdue','missed')";

/**
 * What this person will actually be able to do about it.
 *
 * Reported at assign time rather than discovered a fortnight later, because
 * "assigned to 5 people" with three of them holding no task list is a screen
 * stating something that is not true. It names the tick in Settings; it never
 * applies it — who gets which module is the office's decision, and quietly
 * granting the Operator View to satisfy a training assignment would be this
 * codebase's own two-mechanisms defect in a new place.
 */
export function assignmentReach(db, userId) {
  if (!userId) return { code: 'by_name', label: 'assigned by name — no account to reach' };
  const u = db.prepare('SELECT id, role, module_access FROM users WHERE id = ?').get(userId);
  return taskListReach(u);
}

const courseLabel = (c) => `${c.code ? `${c.code} — ` : ''}${c.title}`;

/**
 * One message per PERSON, however many courses landed at once.
 *
 * A new hire owes four or five courses the moment their account exists; five
 * DMs in the same second is the noise people learn to dismiss, and dismissing
 * this one is exactly what must not happen.
 */
export async function tellAssignee(db, { user_id, items = [], assigned_by = 'the office', reason = null, reminder = false } = {}) {
  if (!user_id || !items.length) return false;
  const origin = readyDocOrigin();
  const link = `${origin}/?tab=operator`;
  const lines = items.map(i => `• *${courseLabel(i.course)}*${i.due_date ? ` — due ${i.due_date}` : ''}`).join('\n');
  const one = items.length === 1;
  const head = reminder
    ? `⏰ Still outstanding: ${one ? 'a training course assigned to you' : `${items.length} training courses assigned to you`}.`
    : `📚 *${assigned_by}* has assigned you ${one ? 'a training course' : `${items.length} training courses`}${reason ? ` — ${reason}` : ''}:`;
  const body = `${head}\n${lines}\n\n`
    // "Operator View" is what the sidebar calls it; the floor phone's own
    // layout heads the same screen "My Tasks". Naming both is how somebody
    // finds it on whichever they are looking at.
    + `Open [Operator View](${link}) — "My Tasks" on a phone — and look under *Upcoming* if it is not due yet.`
    + ' Completing the task is what files your training record.';
  try {
    const { bot, dm } = botDm(db, user_id);
    await postMessageAs(db, dm, bot, body);
    pushToUser(user_id, {
      title: reminder ? 'Training still outstanding' : 'Training assigned to you',
      body: one ? courseLabel(items[0].course) : `${items.length} courses`,
      tag: `training-assigned-${user_id}`,
      url: '/?tab=operator',
    }).catch(() => {});
    return true;
  } catch { return false; }
}

/**
 * Every other day, chase what nobody has done.
 *
 * THE CLOCK IS PER ASSIGNMENT, NOT GLOBAL — `work_orders.last_nudge_at`. One
 * shared flag is what made every QA correction in the plant share one timer
 * (D-083); a course assigned this morning must not be considered chased
 * because a different one was chased yesterday.
 *
 * Only assignments that have sat two days or more: nobody is chased the
 * morning after being asked. Quiet by itself once the pile is cleared, because
 * the query finds nothing to say.
 */
export async function trainingNudges(db) {
  const rows = db.prepare(`SELECT wo.id, wo.due_date, wo.assigned_to_id,
      c.code, c.title
    FROM work_orders wo
    JOIN training_courses c ON c.id = wo.training_course_id
    JOIN users u ON u.id = wo.assigned_to_id
    WHERE wo.training_course_id IS NOT NULL
      AND wo.status IN ${LIVE}
      AND wo.assigned_to_id IS NOT NULL
      AND u.is_active = 1 AND COALESCE(u.is_external, 0) = 0 AND u.role != 'auditor'
      AND wo.created_at <= datetime('now', '-2 days')
      AND (wo.last_nudge_at IS NULL OR wo.last_nudge_at <= datetime('now', '-2 days'))
    ORDER BY wo.due_date`).all();

  const byPerson = new Map();
  for (const r of rows) {
    if (!byPerson.has(r.assigned_to_id)) byPerson.set(r.assigned_to_id, []);
    byPerson.get(r.assigned_to_id).push(r);
  }
  const stamp = db.prepare("UPDATE work_orders SET last_nudge_at = datetime('now') WHERE id = ?");
  let sent = 0;
  for (const [userId, list] of byPerson) {
    const ok = await tellAssignee(db, {
      user_id: userId, reminder: true,
      items: list.map(r => ({ course: { code: r.code, title: r.title }, due_date: r.due_date })),
    });
    // Stamped only on a message that went, or an outage would silence the
    // chase for two days and nothing would say so.
    if (ok) { for (const r of list) stamp.run(r.id); sent += 1; }
  }
  return { sent, people: byPerson.size };
}
