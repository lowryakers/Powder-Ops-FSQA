import { Router } from 'express';
import { v4 as uuid } from 'uuid';
import { getDb, logAudit } from '../db.js';
import { normalizeName } from '../pay-seed.js';

// Pay tracking.
//
// Two audiences with deliberately different views:
//
//  * Admins get the roster — real hourly rates, annual cost, rate history,
//    and the review clock. Nothing here is visible to anyone else.
//  * Anyone granted the module gets the evaluation tool, which shows the
//    rubric and the increase band a score lands in. It never shows, and never
//    asks for, anyone's actual rate — so a supervisor can run an evaluation
//    without company pay data being on their screen.
//
// The evaluation itself is never stored. Scores and notes live in the browser
// for the length of the conversation and are gone when the form closes. The
// only thing that persists is `last_reviewed_at`, so "who is due" keeps
// working without leaving a rating on anybody's file.

const router = Router();
const MODULE_ID = 'pay-tracking';

const isAdmin = (u) => u?.role === 'admin';
// The rubric and its bands are not pay data, so module access is enough.
function mayEvaluate(user) {
  if (isAdmin(user)) return true;
  const ma = user?.module_access;
  if (!ma) return false;
  return Array.isArray(ma) ? ma.includes(MODULE_ID) : !!ma[MODULE_ID];
}
function requireAdmin(req, res) {
  if (isAdmin(req.user)) return true;
  res.status(403).json({ error: 'Pay information is restricted to administrators.' });
  return false;
}
function requireEvaluator(req, res) {
  if (mayEvaluate(req.user)) return true;
  res.status(403).json({ error: 'You do not have access to Pay Tracking.' });
  return false;
}

const HOURS_PER_YEAR = 2080;
const today = () => new Date().toISOString().slice(0, 10);
const daysSince = (d) => {
  if (!d) return null;
  const t = Date.parse(`${String(d).slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(t)) return null;
  return Math.floor((Date.parse(`${today()}T00:00:00Z`) - t) / 86400000);
};

// The review clock. A year is the point at which someone is overdue for at
// least a conversation; 300 days gives enough warning to schedule it. The
// clock runs from whichever happened later — the last raise or the last
// review — so evaluating someone and holding them flat still resets it.
const DUE_DAYS = 365;
const SOON_DAYS = 300;
function reviewState(row) {
  const marks = [row.last_increase_at, row.last_reviewed_at].filter(Boolean).sort();
  const last = marks.length ? marks[marks.length - 1] : row.hire_date;
  const days = daysSince(last);
  if (days === null) return { since: null, days: null, status: 'unknown' };
  return { since: last, days, status: days >= DUE_DAYS ? 'due' : days >= SOON_DAYS ? 'soon' : 'ok' };
}

const decorate = (row) => ({
  ...row,
  annual: row.pay_rate != null ? row.pay_rate * HOURS_PER_YEAR : null,
  review: reviewState(row),
});

// ── Roster (admin only) ──────────────────────────────────────────────────────

router.get('/employees', (req, res) => {
  if (!requireAdmin(req, res)) return;
  const db = getDb();
  const rows = db.prepare('SELECT * FROM pay_employees ORDER BY active DESC, team, name').all();
  res.json(rows.map(decorate));
});

router.get('/employees/:id', (req, res) => {
  if (!requireAdmin(req, res)) return;
  const db = getDb();
  const row = db.prepare('SELECT * FROM pay_employees WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not on the roster' });
  const history = db.prepare('SELECT * FROM pay_rate_history WHERE employee_id = ? ORDER BY effective_at DESC, created_at DESC').all(row.id);
  res.json({ ...decorate(row), history });
});

const EDITABLE = ['name', 'team', 'is_supervisor', 'hire_date', 'pto_plan', 'active', 'notes', 'user_id'];

router.post('/employees', (req, res) => {
  if (!requireAdmin(req, res)) return;
  const db = getDb();
  const name = String(req.body?.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Name is required' });
  if (db.prepare('SELECT 1 FROM pay_employees WHERE name = ?').get(name)) {
    return res.status(409).json({ error: `${name} is already on the roster.` });
  }
  const id = uuid();
  db.prepare(`INSERT INTO pay_employees (id, user_id, name, team, is_supervisor, pay_rate, hire_date, pto_plan)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
    id, req.body?.user_id || null, name, req.body?.team || null,
    req.body?.is_supervisor ? 1 : 0,
    req.body?.pay_rate != null && req.body.pay_rate !== '' ? Number(req.body.pay_rate) : null,
    req.body?.hire_date || null, req.body?.pto_plan || null);
  const created = db.prepare('SELECT * FROM pay_employees WHERE id = ?').get(id);
  logAudit(req.user, 'create', 'pay_employee', id, { name }, null, created, name);
  res.status(201).json(decorate(created));
});

// Everything except the rate, which has its own endpoint so that a pay change
// can never happen without leaving a history row behind.
router.put('/employees/:id', (req, res) => {
  if (!requireAdmin(req, res)) return;
  const db = getDb();
  const existing = db.prepare('SELECT * FROM pay_employees WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Not on the roster' });
  const updates = [];
  const values = [];
  for (const f of EDITABLE) {
    if (req.body[f] === undefined) continue;
    updates.push(`${f} = ?`);
    values.push(f === 'is_supervisor' || f === 'active' ? (req.body[f] ? 1 : 0) : (req.body[f] || null));
  }
  if (!updates.length) return res.status(400).json({ error: 'Nothing to update' });
  updates.push("updated_at = datetime('now')");
  values.push(req.params.id);
  db.prepare(`UPDATE pay_employees SET ${updates.join(', ')} WHERE id = ?`).run(...values);
  const updated = db.prepare('SELECT * FROM pay_employees WHERE id = ?').get(req.params.id);
  logAudit(req.user, 'update', 'pay_employee', req.params.id, req.body, existing, updated, existing.name);
  res.json(decorate(updated));
});

// Applying a raise. The rate moves and a history row records what it was, what
// it became, when it took effect and who did it — a pay change is a durable
// fact even though the evaluation behind it deliberately isn't.
router.post('/employees/:id/rate', (req, res) => {
  if (!requireAdmin(req, res)) return;
  const db = getDb();
  const existing = db.prepare('SELECT * FROM pay_employees WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Not on the roster' });

  const newRate = Number(req.body?.new_rate);
  if (!Number.isFinite(newRate) || newRate <= 0) return res.status(400).json({ error: 'Enter a valid new rate.' });
  if (newRate === existing.pay_rate) return res.status(400).json({ error: 'That is already the current rate.' });
  const effective = String(req.body?.effective_at || today()).slice(0, 10);

  db.transaction(() => {
    db.prepare(`INSERT INTO pay_rate_history (id, employee_id, old_rate, new_rate, effective_at, changed_by, note)
      VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
      uuid(), existing.id, existing.pay_rate, newRate, effective, req.user.name,
      String(req.body?.note || '').trim() || null);
    db.prepare(`UPDATE pay_employees SET pay_rate = ?, last_increase_at = ?, last_reviewed_at = ?,
      updated_at = datetime('now') WHERE id = ?`).run(newRate, effective, effective, existing.id);
  })();

  const updated = db.prepare('SELECT * FROM pay_employees WHERE id = ?').get(existing.id);
  logAudit(req.user, 'update', 'pay_employee', existing.id,
    { pay_rate: { from: existing.pay_rate, to: newRate }, effective_at: effective },
    existing, updated, existing.name);
  res.json(decorate(updated));
});

// The only trace an evaluation leaves. Deliberately carries no score and no
// notes — just that a review happened, so the clock resets.
router.post('/employees/:id/reviewed', (req, res) => {
  if (!requireEvaluator(req, res)) return;
  const db = getDb();
  const existing = db.prepare('SELECT * FROM pay_employees WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Not on the roster' });
  const when = String(req.body?.reviewed_at || today()).slice(0, 10);
  db.prepare("UPDATE pay_employees SET last_reviewed_at = ?, updated_at = datetime('now') WHERE id = ?").run(when, existing.id);
  logAudit(req.user, 'update', 'pay_employee', existing.id, { last_reviewed_at: when, note: 'review date only; no score retained' }, existing, null, existing.name);
  res.json({ ok: true, last_reviewed_at: when });
});

router.delete('/employees/:id', (req, res) => {
  if (!requireAdmin(req, res)) return;
  const db = getDb();
  const existing = db.prepare('SELECT * FROM pay_employees WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Not on the roster' });
  db.prepare('DELETE FROM pay_rate_history WHERE employee_id = ?').run(existing.id);
  db.prepare('DELETE FROM pay_employees WHERE id = ?').run(existing.id);
  logAudit(req.user, 'delete', 'pay_employee', existing.id, null, existing, null, existing.name);
  res.json({ deleted: existing.id });
});

// ── Reconcile against Settings ───────────────────────────────────────────────
// Settings is the source of truth for who works here. This reports the drift
// rather than fixing it silently: people in Settings who aren't on the roster,
// roster rows with no matching user, and links it can make automatically.
router.get('/sync', (req, res) => {
  if (!requireAdmin(req, res)) return;
  const db = getDb();
  const users = db.prepare("SELECT id, name, department, role FROM users WHERE is_active = 1 AND name != 'ReadyBot'").all();
  const roster = db.prepare('SELECT * FROM pay_employees').all();
  const rosterByName = new Map(roster.map(r => [normalizeName(r.name), r]));
  const linkedIds = new Set(roster.map(r => r.user_id).filter(Boolean));

  const missing = users
    .filter(u => !linkedIds.has(u.id) && !rosterByName.has(normalizeName(u.name)))
    .map(u => ({ user_id: u.id, name: u.name, department: u.department, role: u.role }));

  const userByName = new Map(users.map(u => [normalizeName(u.name), u]));
  const linkable = roster
    .filter(r => !r.user_id && userByName.has(normalizeName(r.name)))
    .map(r => ({ employee_id: r.id, name: r.name, user_id: userByName.get(normalizeName(r.name)).id }));
  const unmatched = roster
    .filter(r => r.active && !r.user_id && !userByName.has(normalizeName(r.name)))
    .map(r => ({ employee_id: r.id, name: r.name }));

  res.json({ missing, linkable, unmatched });
});

// Apply the reconciliation the report above proposed: link what matches by
// name, and add the named Settings users as new roster rows (no rate — that is
// entered deliberately, never guessed).
router.post('/sync', (req, res) => {
  if (!requireAdmin(req, res)) return;
  const db = getDb();
  const linkIds = Array.isArray(req.body?.link) ? req.body.link : [];
  const addIds = Array.isArray(req.body?.add) ? req.body.add : [];
  let linked = 0;
  let added = 0;

  db.transaction(() => {
    const link = db.prepare("UPDATE pay_employees SET user_id = ?, updated_at = datetime('now') WHERE id = ?");
    for (const { employee_id, user_id } of linkIds) {
      if (!employee_id || !user_id) continue;
      link.run(user_id, employee_id);
      linked++;
    }
    const getUser = db.prepare('SELECT id, name, department FROM users WHERE id = ?');
    const exists = db.prepare('SELECT 1 FROM pay_employees WHERE name = ?');
    const ins = db.prepare('INSERT INTO pay_employees (id, user_id, name, team) VALUES (?, ?, ?, ?)');
    for (const userId of addIds) {
      const u = getUser.get(userId);
      if (!u || exists.get(u.name)) continue;
      ins.run(uuid(), u.id, u.name, u.department || null);
      added++;
    }
  })();

  if (linked || added) logAudit(req.user, 'update', 'pay_employee', 'sync', { linked, added }, null, null, 'Roster sync');
  res.json({ linked, added });
});

// ── Pay ranges ───────────────────────────────────────────────────────────────

router.get('/ranges', (req, res) => {
  if (!requireAdmin(req, res)) return;
  res.json(getDb().prepare('SELECT * FROM pay_ranges ORDER BY position').all());
});

router.put('/ranges/:position', (req, res) => {
  if (!requireAdmin(req, res)) return;
  const db = getDb();
  const num = (v) => (v === '' || v == null ? null : Number(v));
  db.prepare(`INSERT INTO pay_ranges (position, market_min, market_max, ops_min, ops_max)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(position) DO UPDATE SET market_min = excluded.market_min, market_max = excluded.market_max,
      ops_min = excluded.ops_min, ops_max = excluded.ops_max`)
    .run(req.params.position, num(req.body?.market_min), num(req.body?.market_max),
      num(req.body?.ops_min), num(req.body?.ops_max));
  res.json(db.prepare('SELECT * FROM pay_ranges WHERE position = ?').get(req.params.position));
});

// ── Evaluation support ───────────────────────────────────────────────────────
// The rubric lives on the client (it is static text, and translating it there
// keeps the EN/ES toggle working without a round trip). All this endpoint does
// is give an evaluator the list of people they may evaluate — names only, no
// pay data — so the picker matches the real roster.
router.get('/evaluatees', (req, res) => {
  if (!requireEvaluator(req, res)) return;
  const db = getDb();
  const rows = db.prepare('SELECT id, name, team, last_reviewed_at, last_increase_at, hire_date FROM pay_employees WHERE active = 1 ORDER BY team, name').all();
  res.json(rows.map(r => ({
    id: r.id, name: r.name, team: r.team,
    review: reviewState(r),
  })));
});

export default router;
