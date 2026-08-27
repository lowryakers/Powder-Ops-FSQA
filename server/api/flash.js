// The Flash Report: who gets it, and the door to read it on demand.
//
// The report itself is built by `server/flash-report.js`, which is pure. This
// is only delivery and permission — so the numbers can be checked without any
// of it, and changing who receives one cannot change what it says.

import { Router } from 'express';
import { getDb, logAudit } from '../db.js';
import { buildReport, renderReport } from '../flash-report.js';
import { botDm, postMessageAs } from './comms.js';
import { pushToUser } from '../push.js';
import { readyDocOrigin } from '../links.js';

const router = Router();

// Admins only. This is the whole plant's numbers on one screen — output,
// backlogs, what QA is sitting on — and it is deliberately not a module grant:
// there is nothing here for an operator to act on, which is the entire point
// of the report.
const mayRead = (u) => u?.role === 'admin';

/**
 * Who receives a scheduled report.
 *
 * `flash_report_recipients` in app_settings, a JSON array of user ids, so
 * adding somebody is a settings change and not a deploy. UNSET falls back to
 * active admins rather than to nobody — a report configured but never
 * delivered is indistinguishable from a broken job.
 */
export function flashRecipients(db) {
  // Not initialised: every path below assigns it, and the initial null was
  // never read. (Pre-existing lint error on main, fixed here in passing.)
  let ids;
  try {
    ids = JSON.parse(db.prepare("SELECT value FROM app_settings WHERE key = 'flash_report_recipients'").get()?.value || 'null');
  } catch { ids = null; }
  if (Array.isArray(ids) && ids.length) {
    const ph = ids.map(() => '?').join(',');
    return db.prepare(`SELECT id, name FROM users WHERE id IN (${ph}) AND is_active = 1`).all(...ids);
  }
  return db.prepare("SELECT id, name FROM users WHERE role = 'admin' AND is_active = 1 AND name != 'ReadyBot'").all();
}

/**
 * Build once, send to everyone. The report is the same for every recipient —
 * rebuilding it per person would let two people receive different numbers for
 * the same morning, which is the disagreement this codebase keeps fixing.
 *
 * Best-effort per recipient: a comms failure for one person must not stop the
 * other three getting theirs, and must never throw out of the job.
 */
export async function sendFlashReport(db, period = 'daily', now = new Date()) {
  const report = buildReport(db, { period, now });
  const text = renderReport(report, { base: readyDocOrigin() });
  const people = flashRecipients(db);
  let sent = 0;
  for (const p of people) {
    try {
      const { bot, dm } = botDm(db, p.id);
      if (dm) { await postMessageAs(db, dm, bot, text); sent++; }
    } catch (e) { console.warn(`[flash] DM to ${p.name} failed:`, e.message); }
    // The push carries the headline only. A phone notification is a nudge to
    // open it, not the report.
    pushToUser(p.id, {
      title: `${period === 'daily' ? 'Daily' : period === 'weekly' ? 'Weekly' : 'Monthly'} flash`,
      body: report.exceptions.length
        ? `${report.exceptions.length} thing${report.exceptions.length === 1 ? '' : 's'} out of pattern`
        : 'Nothing unusual',
      tag: `flash-${period}`, renotify: true,
    }).catch(() => {});
  }
  return { sent, recipients: people.length, exceptions: report.exceptions.length };
}

/**
 * Read it now rather than waiting for the morning — which is also how it gets
 * tuned. `?period=daily|weekly|monthly`.
 */
router.get('/', (req, res) => {
  if (!mayRead(req.user)) return res.status(403).json({ error: 'Insufficient permissions' });
  const period = ['daily', 'weekly', 'monthly'].includes(req.query.period) ? req.query.period : 'daily';
  const report = buildReport(getDb(), { period });
  res.json({ ...report, text: renderReport(report, { base: readyDocOrigin() }) });
});

// Send this period's report immediately, to the configured recipients. Audited,
// because it puts a message in other people's DMs.
router.post('/send', async (req, res) => {
  if (!mayRead(req.user)) return res.status(403).json({ error: 'Insufficient permissions' });
  const period = ['daily', 'weekly', 'monthly'].includes(req.body?.period) ? req.body.period : 'daily';
  const r = await sendFlashReport(getDb(), period);
  logAudit(req.user, 'update', 'flash_report', null, { action: 'sent_now', period, ...r });
  res.json(r);
});

router.get('/recipients', (req, res) => {
  if (!mayRead(req.user)) return res.status(403).json({ error: 'Insufficient permissions' });
  res.json({ recipients: flashRecipients(getDb()) });
});

router.put('/recipients', (req, res) => {
  if (!mayRead(req.user)) return res.status(403).json({ error: 'Insufficient permissions' });
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(String).filter(Boolean) : [];
  getDb().prepare("INSERT OR REPLACE INTO app_settings (key, value, updated_at) VALUES ('flash_report_recipients', ?, datetime('now'))")
    .run(JSON.stringify(ids));
  logAudit(req.user, 'update', 'flash_report', null, { action: 'set_recipients', count: ids.length });
  res.json({ recipients: flashRecipients(getDb()) });
});

export default router;
