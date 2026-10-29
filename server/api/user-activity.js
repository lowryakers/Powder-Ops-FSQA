// The activity log's doors (D-261). Reading: an admin's own session, or a bot's
// read token whose account was granted "User activity" in Settings. Writing: only
// the screen's batch of page views and file opens — every other row is written
// by the server where the act happened (server/user-activity.js).
import express from 'express';
import { getDb } from '../db.js';
import { sessionUser } from '../middleware/auth.js';
import { pageOf } from '../bot-api.js';
import {
  ACTIONS, MAX_EVENTS, mayReadActivity, listActivity, activityCsv, acceptClientEvents,
} from '../user-activity.js';

const router = express.Router();

const refuse = (res) => res.status(403).json({
  error: 'The activity log is for admins, or a bot whose account was given "User activity" in Settings.',
});

// The screen's page views and file opens, in batches. A session only: a bot's
// token has no screen.
const perMinute = new Map();
router.post('/events', (req, res) => {
  if (req.auth?.kind !== 'session') return res.status(403).json({ error: 'Only a signed-in screen sends these.' });
  const events = Array.isArray(req.body?.events) ? req.body.events : [];
  if (events.length > MAX_EVENTS) return res.status(400).json({ error: `At most ${MAX_EVENTS} events at a time.` });
  const minute = Math.floor(Date.now() / 60000);
  const slot = perMinute.get(req.user.id);
  const used = slot && slot.minute === minute ? slot.n : 0;
  if (used + events.length > 600) return res.status(429).json({ error: 'Too many events this minute.' });
  perMinute.set(req.user.id, { minute, n: used + events.length });
  if (perMinute.size > 2000) perMinute.clear();
  res.json({ accepted: acceptClientEvents(req.user, events) });
});

// The same events as the page closes, by navigator.sendBeacon. Public path:
// the body carries the session token, checked here, and only a live session
// (never a bot token) is accepted. Always 204 — a beacon reads no answer.
router.post('/beacon', express.text({ type: '*/*', limit: '64kb' }), (req, res) => {
  const body = (() => {
    if (req.body && typeof req.body === 'object') return req.body;
    try { return JSON.parse(String(req.body || '{}')); } catch { return {}; }
  })();
  const u = sessionUser(typeof body.token === 'string' ? body.token : null);
  if (u && Array.isArray(body.events)) acceptClientEvents({ id: u.id, name: u.name }, body.events.slice(0, MAX_EVENTS));
  res.status(204).end();
});

router.get('/actions', (req, res) => {
  if (!mayReadActivity(req)) return refuse(res);
  res.json(Object.entries(ACTIONS).map(([key, label]) => ({ key, label })));
});

// Everyone who has an account — active or not — so a filter can name somebody
// who has since left.
router.get('/people', (req, res) => {
  if (!mayReadActivity(req)) return refuse(res);
  res.json(getDb().prepare(`SELECT id, name, is_active FROM users WHERE name != 'ReadyBot' ORDER BY name COLLATE NOCASE`).all());
});

router.get('/export.csv', (req, res) => {
  if (!mayReadActivity(req)) return refuse(res);
  const lines = activityCsv(getDb(), req.query);
  let first;
  try { first = lines.next(); } catch (e) { return res.status(400).json({ error: e.message }); }
  const stamp = new Date().toISOString().slice(0, 10);
  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', `attachment; filename="readydoc-activity-${stamp}.csv"`);
  res.write(first.value);
  for (const line of lines) res.write(line);
  res.end();
});

// Newest first. ?user_id ?from ?to (YYYY-MM-DD, UTC days) ?action ?q ?limit ?offset.
// The body is { rows, total, limit, offset }; the total is also X-Total-Count.
router.get('/', (req, res) => {
  if (!mayReadActivity(req)) return refuse(res);
  const page = pageOf(req) || {};
  try {
    const out = listActivity(getDb(), { ...req.query, limit: req.query.limit ?? page.limit, offset: req.query.offset ?? page.offset });
    res.set('X-Total-Count', String(out.total));
    res.set('X-Limit', String(out.limit));
    res.set('X-Offset', String(out.offset));
    res.json(out);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

export default router;
