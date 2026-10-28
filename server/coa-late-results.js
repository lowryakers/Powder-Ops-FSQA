// Lab results that are late (D-258).
//
// A sample at the lab past the date its results were due is easy to lose: the
// bell only says "N lab requests awaiting results", which is every sample out,
// late or not. This names the late ones and tells QA once a day.
//
//  · LATE = status 'sent', no results date, and the expected date (the one
//    typed, else the date sent plus the lab's turnaround days) is before the
//    plant's today. A request with no expected date cannot be late and is
//    COUNTED apart, never guessed at — guessing is how a reminder becomes noise.
//  · The message goes once per open weekday, only when something is late, to
//    the people set in Settings → ReadyBot messages (QA supervisors by default).

import { plantDateOf } from './plant-clock.js';
import { resolve, byDept } from './readybot-recipients.js';
import { readyDocOrigin } from './links.js';

export const LATE_SETTING = 'coa_late_results_recipients';
const LIST_MAX = 10;

const EXPECTED = `COALESCE(NULLIF(expected_results_date, ''),
  CASE WHEN date_sent IS NOT NULL AND date_sent != '' AND tat_days > 0
    THEN date(date_sent, '+' || CAST(tat_days AS INTEGER) || ' days') END)`;

const daysBetween = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);

/** The late samples, oldest first, and how many out have no expected date. */
export function lateLabResults(db, today = plantDateOf(new Date())) {
  const out = `status = 'sent' AND (date_of_results IS NULL OR date_of_results = '')`;
  const rows = db.prepare(`SELECT id, item_number, item_description, lot_number, lab_name, date_sent, ${EXPECTED} AS expected
    FROM coa_requests WHERE ${out} AND ${EXPECTED} < ? ORDER BY expected, created_at`).all(today);
  const late = rows.map(r => ({ ...r, days_late: daysBetween(r.expected.slice(0, 10), today) }));
  const no_date = db.prepare(`SELECT COUNT(*) n FROM coa_requests WHERE ${out} AND ${EXPECTED} IS NULL`).get().n;
  const at_lab = db.prepare(`SELECT COUNT(*) n FROM coa_requests WHERE ${out}`).get().n;
  return { today, late, no_date, at_lab };
}

export function lateResultsRecipients(db) {
  return resolve(db, LATE_SETTING, () => byDept(db, ['qa', 'quality'], ['supervisor']));
}

const line = (r) => `• ${r.item_description || r.item_number || 'Sample'} · lot ${r.lot_number || 'blank'}`
  + `${r.lab_name ? ` · ${r.lab_name}` : ''} · sent ${r.date_sent || '?'}, due ${r.expected.slice(0, 10)}`
  + ` (*${r.days_late} day${r.days_late === 1 ? '' : 's'} late*)`;

/** The day's message, or null when nothing is late. Pure. */
export function lateResultsMessage(report) {
  const { late } = report;
  if (!late.length) return null;
  const more = late.length > LIST_MAX ? `\n…and ${late.length - LIST_MAX} more.` : '';
  return `🧪 *Lab results overdue* — ${late.length} sample${late.length === 1 ? '' : 's'}\n`
    + `${late.slice(0, LIST_MAX).map(line).join('\n')}${more}\n`
    + `Call the lab, or enter the results if they came in.\n`
    + `[Open Lab Requests](${readyDocOrigin()}/?tab=coa)`;
}

/** Send it. Never throws; one failed recipient does not lose the others. */
export async function sendLateResults(db, { botDm, postMessageAs, pushToUser }, now = new Date()) {
  const report = lateLabResults(db, plantDateOf(now));
  const body = lateResultsMessage(report);
  if (!body) return { sent: 0, late: 0 };
  let sent = 0;
  for (const u of lateResultsRecipients(db).users) {
    try {
      const { bot, dm } = botDm(db, u.id);
      await postMessageAs(db, dm, bot, body);
      pushToUser?.(u.id, { title: 'Lab results overdue', body: `${report.late.length} sample${report.late.length === 1 ? '' : 's'} past the due date`, tag: 'coa-late', url: '/?tab=coa' })?.catch?.(() => {});
      sent++;
    } catch { /* next person */ }
  }
  return { sent, late: report.late.length };
}
