// Getting an escalation from the receiving dock to the person named on the form.
//
// FORM 204-01 says "notify Maria and Adam", "notify Adam or QA", "inform
// purchasing". On paper that means the receiver walks off the dock to find
// somebody. Here it is a button, and pressing it does two things that the walk
// never did: it reaches them wherever they are, and it leaves a record that it
// happened at 09:14.
//
// Targets are resolved by NAME with a DEPARTMENT FALLBACK — the env-limits
// precedent. Naming Adam is what the form says; falling back to QA is what
// stops a rename, a holiday or a leaver silencing an escalation about
// contaminated product.
import { botDm, postMessageAs } from './api/comms.js';
import { pushToUser } from './push.js';
import { readyDocOrigin } from './links.js';
import { NOTIFY_TARGETS } from './receiving-checklist.js';

/**
 * Who this escalation actually reaches, as real accounts.
 *
 * Never returns the caller: telling somebody what they just typed is noise, and
 * on a small team the receiver is sometimes also in QA.
 */
// `targets` defaults to FORM 204-01's map; the shipping inspection passes its
// own, which reuses the same QA people under a different subject line.
export function resolveTarget(db, targetKey, excludeUserId = null, targets = NOTIFY_TARGETS) {
  const t = targets[targetKey];
  if (!t) return [];
  const found = new Map();
  for (const name of t.names) {
    const rows = db.prepare(
      "SELECT id, name FROM users WHERE is_active = 1 AND name LIKE ? AND name != 'ReadyBot'"
    ).all(`${name}%`);
    for (const r of rows) found.set(r.id, r);
  }
  // The fallback runs when NOBODY named could be found — not per name, or a
  // rename would quietly widen an escalation to the whole department.
  if (found.size === 0 && t.fallbackDepartments.length) {
    const marks = t.fallbackDepartments.map(() => '?').join(',');
    const rows = db.prepare(
      `SELECT id, name FROM users WHERE is_active = 1 AND name != 'ReadyBot'
       AND (department IN (${marks}) OR role = 'admin')
       ORDER BY CASE WHEN role = 'admin' THEN 1 ELSE 0 END LIMIT 5`
    ).all(...t.fallbackDepartments);
    for (const r of rows) found.set(r.id, r);
  }
  if (excludeUserId) found.delete(excludeUserId);
  return [...found.values()];
}

/**
 * Send one escalation. Best-effort per recipient: a dead push subscription on
 * one phone must not stop the DM reaching the other person.
 *
 * Returns who it actually reached, which is what gets written onto the record —
 * "notified QA" with nobody behind it would be worse than no record at all.
 */
export async function sendEscalation(db, { item, target, inspectionNo, detail, from, path, origin, icon = '📦', targets = NOTIFY_TARGETS, tagPrefix = 'receiving' }) {
  const people = resolveTarget(db, target, from?.id, targets);
  if (!people.length) return { sent: [], reason: 'nobody to notify' };
  const t = targets[target];
  // WHERE THE ALERT CAME FROM IS PART OF IT. Most escalations here are a person
  // pressing a button on FORM 204-01, and saying so tells the reader somebody
  // is standing at the dock. The lab-sample alert is raised by the arrival
  // itself against QA's standing list — nobody decided anything — and printing
  // the checklist sentence on it would name a person who never acted.
  const raisedBy = origin
    || `Raised by ${from?.name || 'Receiving'} on the Receiving Inspection Checklist.`;
  // `path` deep-links to the thing the recipient must ACT on — the draft film
  // inspection, or the checklist itself. A link that lands on a module's front
  // page hands the reader a search job; the alert already knows the record.
  const appPath = path || '/?tab=receiving-log';
  const link = `${readyDocOrigin()}${appPath}`;
  const sent = [];
  for (const p of people) {
    try {
      const { bot, dm } = botDm(db, p.id);
      // Bot bold is *text*, not **text** — the chat renderer isn't markdown.
      await postMessageAs(db, dm, bot,
        `${icon} *${t.subject}*\nInspection *${inspectionNo}* — ${item}\n`
        + `${detail ? `${detail}\n` : ''}`
        + `${raisedBy}\n`
        + `Open it: ${link}`);
      pushToUser(p.id, {
        title: t.subject,
        body: `${inspectionNo}: ${item}`.slice(0, 120),
        tag: `${tagPrefix}-${inspectionNo}-${target}`, renotify: true, url: appPath,
      }).catch(() => {});
      sent.push(p.name);
    } catch { /* one failure must not lose the others */ }
  }
  return { sent };
}
