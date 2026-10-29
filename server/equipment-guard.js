// Taking equipment out of service must not silently stop QA's checks (D-260).
//
// On 27 October three Temp/Humidity monitors were set out of service while the
// Equipment list was being tidied. An out-of-service machine raises no new card and
// (since D-218) has its open cards closed, so QA's daily Temp & Humidity checks
// simply vanished from the Operator View, and the first anyone knew was QA asking
// where their task had gone. The change was reasonable for a machine and wrong
// for a monitoring point: those are QA's measuring points.
//
// So a status change away from active on equipment that carries a QA check is
// REFUSED until the person confirms it, and the refusal names every check that
// would stop. Confirming is allowed (a monitor really can be taken down), and then
// QA is TOLD, because the people who lose the task are never the people on the
// Equipment screen. Nothing here pauses or deletes anything by itself.
import { TASK_TITLE_SQL } from './qa-records.js';
import { resolve, byDept } from './readybot-recipients.js';
import { readyDocOrigin } from './links.js';

export const STOP_SETTING = 'equipment_qa_stop_recipients';

/**
 * The active QA checks raised on these pieces of equipment that would stop if
 * they left service: QA's inspection titles (Temp & Humidity, BP&G, Light
 * Inspection) or anything on QA's list. Only equipment that is active now counts.
 */
export function qaChecksStoppedBy(db, ids) {
  const list = [...new Set((ids || []).filter(Boolean))];
  if (!list.length) return [];
  const qm = list.map(() => '?').join(',');
  const titleSql = TASK_TITLE_SQL.replace(/\btitle\b/g, 'ps.title');
  return db.prepare(`SELECT ps.id AS schedule_id, ps.title, ps.frequency_type, ps.task_group,
      e.id AS equipment_id, e.name AS equipment, e.asset_id
    FROM pm_schedules ps JOIN equipment e ON e.id = ps.equipment_id
    WHERE ps.is_active = 1 AND COALESCE(e.status, 'active') = 'active' AND e.id IN (${qm})
      AND (ps.task_group = 'qa' OR ${titleSql})
    ORDER BY e.name, ps.title`).all(...list);
}

/** The 409 body: what would stop, in words a person can act on. */
export function stopRefusal(checks, status) {
  const names = [...new Set(checks.map(c => c.equipment))];
  return {
    error: `Setting ${names.join(', ')} to "${status}" stops ${checks.length} QA check${checks.length === 1 ? '' : 's'}: `
      + `${checks.map(c => c.title).join('; ')}. No new task is raised and the open ones are closed. `
      + 'Confirm only if this equipment is really out of use; QA will be told.',
    code: 'stops_qa_checks',
    status,
    checks: checks.map(c => ({ equipment: c.equipment, asset_id: c.asset_id, title: c.title, frequency: c.frequency_type })),
  };
}

export function qaStopRecipients(db) {
  return resolve(db, STOP_SETTING, () => byDept(db, ['qa', 'quality'], ['supervisor']));
}

/** Tell QA, once per change. Never throws; one failed recipient does not lose the others. */
export async function tellQaChecksStopped(db, { checks, status, by }, deps) {
  if (!checks?.length) return 0;
  const { botDm, postMessageAs, pushToUser } = deps;
  const body = `⚠️ *QA checks stopped* — ${by || 'Someone'} set equipment to "${status}"\n`
    + `${checks.map(c => `• ${c.title} (${c.equipment}${c.asset_id ? ` #${c.asset_id}` : ''})`).join('\n')}\n`
    + 'These checks raise no task while the equipment is out of service. If that is wrong, set it back to active in Equipment.\n'
    + `[Open Equipment](${readyDocOrigin()}/?tab=equipment)`;
  let sent = 0;
  for (const u of qaStopRecipients(db).users) {
    try {
      const { bot, dm } = botDm(db, u.id);
      await postMessageAs(db, dm, bot, body);
      pushToUser?.(u.id, { title: 'QA checks stopped', body: `${checks.length} check${checks.length === 1 ? '' : 's'} stopped: equipment set to ${status}`, tag: 'qa-checks-stopped', url: '/?tab=equipment' })?.catch?.(() => {});
      sent++;
    } catch { /* next person */ }
  }
  return sent;
}
