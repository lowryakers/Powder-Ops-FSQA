// /api/plant-calendar — the paid holidays and what they do to the production
// week (D-175). Reads are open to every signed-in employee: a holiday is
// plant-wide news and the Operator View shows it to everybody. Corrections are
// admin only, need a reason, and are audited. Mounted WITHOUT requireModuleWrite
// (the /api/forms arrangement) — the router decides per route.
import { Router } from 'express';
import { getDb, logAudit } from '../db.js';
import { yearCalendar, weekFor, upcoming, setOverride, clearOverride } from '../plant-calendar.js';
import { HOLIDAY_RULES, HOLIDAY_HOURS, isDate } from '../../shared/plant-holidays.js';
import { plantDateOf } from '../plant-clock.js';

const router = Router();
const isAdmin = u => u?.role === 'admin';

router.get('/', (req, res) => {
  const db = getDb();
  const year = Number(req.query.year) || Number(plantDateOf().slice(0, 4));
  res.json({ year, holidays: yearCalendar(db, year), rules: HOLIDAY_RULES, holiday_hours: HOLIDAY_HOURS, can_edit: isAdmin(req.user) });
});

router.get('/upcoming', (req, res) => {
  const days = Math.min(Math.max(Number(req.query.days) || 60, 1), 400);
  const today = isDate(req.query.today) ? req.query.today : plantDateOf();
  res.json({ today, weeks: upcoming(getDb(), { today, days }) });
});

router.get('/week', (req, res) => {
  if (!isDate(req.query.week_start)) return res.status(400).json({ error: 'week_start (YYYY-MM-DD) is required' });
  res.json(weekFor(getDb(), req.query.week_start));
});

router.put('/:key/:year', (req, res) => {
  if (!isAdmin(req.user)) return res.status(403).json({ error: 'Only an admin can change a holiday.' });
  const db = getDb();
  const year = Number(req.params.year);
  const { observed_on, cancelled, shift_week, reason } = req.body || {};
  const r = setOverride(db, { key: req.params.key, year, observed_on, cancelled: !!cancelled, shift_week, reason, by: req.user.name });
  if (r.error) return res.status(400).json({ error: r.error });
  logAudit(req.user, 'plant_holiday_changed', 'plant_holiday', `${req.params.key}:${year}`, { reason: r.after.reason }, r.before, r.after, `${req.params.key} ${year}`);
  res.json({ holidays: yearCalendar(db, year) });
});

router.delete('/:key/:year', (req, res) => {
  if (!isAdmin(req.user)) return res.status(403).json({ error: 'Only an admin can change a holiday.' });
  const db = getDb();
  const year = Number(req.params.year);
  const r = clearOverride(db, req.params.key, year);
  if (r.before) logAudit(req.user, 'plant_holiday_reset', 'plant_holiday', `${req.params.key}:${year}`, {}, r.before, null, `${req.params.key} ${year}`);
  res.json({ holidays: yearCalendar(db, year) });
});

export default router;
