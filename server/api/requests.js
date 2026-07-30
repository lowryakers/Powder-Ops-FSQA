// ReadyDoc feedback — "this is broken" / "can we add X" from the people using
// the app.
//
// The design constraint is that submitting has to be frictionless: one box, one
// button. Every extra required field is a reason not to bother, and a request
// nobody files is a problem nobody hears about. Triage is where the structure
// lives — an open checklist that gets ticked off.
//
// Deliberately not Task Center: app feedback isn't plant work, and mixing it in
// would dilute the operational task list people work from every day.

import { Router } from 'express';
import { randomUUID as uuid } from 'crypto';
import { getDb, logAudit } from '../db.js';

const router = Router();

// Anyone who can see the app can report a problem with it — narrowing this
// would just mean the reports arrive as hallway conversation instead.
// Admins triage.
const canTriage = (u) => u?.role === 'admin';

router.get('/', (req, res) => {
  const db = getDb();
  const status = req.query.status === 'done' ? 'done' : req.query.status === 'all' ? null : 'open';
  const mine = req.query.mine === '1';
  let sql = 'SELECT * FROM app_requests WHERE 1=1';
  const params = [];
  if (status) { sql += ' AND status = ?'; params.push(status); }
  // A non-admin only sees their own — this is a suggestion box, not a forum.
  if (mine || !canTriage(req.user)) { sql += ' AND submitted_by_id = ?'; params.push(req.user?.id); }
  sql += " ORDER BY CASE status WHEN 'open' THEN 0 ELSE 1 END, created_at DESC LIMIT 300";
  res.json(db.prepare(sql).all(...params));
});

// Counts for the badge — open items only.
router.get('/count', (req, res) => {
  const db = getDb();
  if (!canTriage(req.user)) {
    const n = db.prepare("SELECT COUNT(*) n FROM app_requests WHERE status = 'open' AND submitted_by_id = ?").get(req.user?.id).n;
    return res.json({ open: n });
  }
  res.json({ open: db.prepare("SELECT COUNT(*) n FROM app_requests WHERE status = 'open'").get().n });
});

router.post('/', (req, res) => {
  const body = String(req.body?.body || '').trim();
  if (!body) return res.status(400).json({ error: 'Type what you need and submit.' });
  const db = getDb();
  const id = uuid();
  db.prepare(`INSERT INTO app_requests (id, body, area, submitted_by, submitted_by_id)
              VALUES (?, ?, ?, ?, ?)`)
    .run(id, body.slice(0, 4000), String(req.body?.area || '').trim() || null,
      req.user?.name || null, req.user?.id || null);
  logAudit(req.user, 'create', 'app_request', id, { area: req.body?.area }, null, null, body.slice(0, 80));
  res.status(201).json(db.prepare('SELECT * FROM app_requests WHERE id = ?').get(id));
});

// Tick it off (or put it back).
router.put('/:id', (req, res) => {
  if (!canTriage(req.user)) return res.status(403).json({ error: 'Only an admin can update requests.' });
  const db = getDb();
  const existing = db.prepare('SELECT * FROM app_requests WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Request not found' });
  const done = req.body?.status === 'done';
  db.prepare(`UPDATE app_requests SET status = ?, done_by = ?, done_at = ?, note = COALESCE(?, note) WHERE id = ?`)
    .run(done ? 'done' : 'open', done ? (req.user?.name || null) : null,
      done ? new Date().toISOString() : null,
      req.body?.note !== undefined ? String(req.body.note).slice(0, 2000) : null, req.params.id);
  res.json(db.prepare('SELECT * FROM app_requests WHERE id = ?').get(req.params.id));
});

router.delete('/:id', (req, res) => {
  if (!canTriage(req.user)) return res.status(403).json({ error: 'Only an admin can delete requests.' });
  const db = getDb();
  const existing = db.prepare('SELECT * FROM app_requests WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Request not found' });
  db.prepare('DELETE FROM app_requests WHERE id = ?').run(req.params.id);
  logAudit(req.user, 'delete', 'app_request', req.params.id, null, existing, null, (existing.body || '').slice(0, 80));
  res.json({ ok: true });
});

export default router;
