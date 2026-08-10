import { Router } from 'express';
import { v4 as uuid } from 'uuid';
import PDFDocument from 'pdfkit';
import { readFileSync, existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getDb, logAudit } from '../db.js';
import { normalizeName } from '../pay-seed.js';
import { postMessageAs, botDm } from './comms.js';
import { pushToUser } from '../push.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOGO_PATH = path.join(__dirname, '..', 'assets', 'powder-ops-logo.jpg');

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
// Evaluations are STORED as pay_reviews (a deliberate change from the first
// design, which kept them ephemeral): the plant's real flow is two reviews per
// operator — the supervisor's and Adam's — combined, and Adam alone for
// supervisors, with the admin reading the scores and notes BEFORE deciding an
// increase. That requires the review to exist somewhere the admin can read it.
// A reviewer sees only their own submitted reviews; admins see all of them;
// no review ever carries pay data.

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

// Once a roster row is linked to a person, THE LINK IS THE IDENTITY and the
// stored name is just a label. Renaming someone in Settings used to leave the
// roster showing the old name forever: sync only ever matched by name, and it
// deliberately skips already-linked rows, so there was no path back.
//
// So a linked row reports the person's current name, and says so when the two
// have drifted — the old value stays visible rather than silently vanishing,
// because it's what the historical rate rows were filed under.
function withLinkedNames(db, rows) {
  const ids = [...new Set(rows.map(r => r.user_id).filter(Boolean))];
  if (!ids.length) return rows;
  const users = new Map();
  try {
    const q = db.prepare(`SELECT id, name, department FROM users WHERE id IN (${ids.map(() => '?').join(',')})`);
    for (const u of q.all(...ids)) users.set(u.id, u);
  } catch { return rows; }
  return rows.map(r => {
    const u = r.user_id && users.get(r.user_id);
    if (!u) return { ...r, linked: !!r.user_id };
    return {
      ...r,
      name: u.name,
      linked: true,
      renamed_from: u.name !== r.name ? r.name : null,
      user_department: u.department,
    };
  });
}

// ── Roster (admin only) ──────────────────────────────────────────────────────

router.get('/employees', (req, res) => {
  if (!requireAdmin(req, res)) return;
  const db = getDb();
  const rows = withLinkedNames(db, db.prepare('SELECT * FROM pay_employees ORDER BY active DESC, team, name').all());
  res.json(rows.map(decorate));
});

router.get('/employees/:id', (req, res) => {
  if (!requireAdmin(req, res)) return;
  const db = getDb();
  const raw = db.prepare('SELECT * FROM pay_employees WHERE id = ?').get(req.params.id);
  if (!raw) return res.status(404).json({ error: 'Not on the roster' });
  const [row] = withLinkedNames(db, [raw]);
  const history = db.prepare('SELECT * FROM pay_rate_history WHERE employee_id = ? ORDER BY effective_at DESC, created_at DESC').all(row.id);
  const reviews = db.prepare('SELECT * FROM pay_reviews WHERE employee_id = ? ORDER BY created_at DESC LIMIT 50').all(row.id)
    .map(r => ({ ...r, scores: JSON.parse(r.scores || '{}') }));
  res.json({ ...decorate(row), history, reviews });
});

// last_reviewed_at / last_increase_at are here so a mistaken review (a test
// entry, the wrong person) can be CORRECTED by an admin — the PUT is audited
// with before/after, so the fix leaves a trail rather than rewriting history
// silently.
const EDITABLE = ['name', 'team', 'is_supervisor', 'hire_date', 'pto_plan', 'active', 'notes', 'user_id', 'last_reviewed_at', 'last_increase_at'];

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
    // Applying the increase is the decision the open reviews were waiting on —
    // they close automatically, stamped with what was decided.
    db.prepare(`UPDATE pay_reviews SET status = 'resolved', resolved_by = ?, resolved_at = datetime('now'),
      resolution = ? WHERE employee_id = ? AND status = 'open'`)
      .run(req.user.name, `Increase applied: $${newRate.toFixed(2)} effective ${effective}`, existing.id);
  })();

  const updated = db.prepare('SELECT * FROM pay_employees WHERE id = ?').get(existing.id);
  logAudit(req.user, 'update', 'pay_employee', existing.id,
    { pay_rate: { from: existing.pay_rate, to: newRate }, effective_at: effective },
    existing, updated, existing.name);
  res.json(decorate(updated));
});

// ── Stored reviews ───────────────────────────────────────────────────────────
//
// Who may review a SUPERVISOR: only Adam, plus admins. Matching Adam by name
// follows the env-limits precedent (the named escalation there), and admins
// are the fallback so a rename or absence never blocks a review cycle.
function canReviewSupervisors(user) {
  return isAdmin(user) || /^adam\b/i.test(String(user?.name || ''));
}

// ── Assignments: who owes a review, and by when ──────────────────────────────
//
// A review cycle used to depend on somebody remembering to ask a supervisor in
// person. An assignment is the ask, on the record: it shows in that reviewer's
// own Pay Tracking view, and completing the evaluation closes it.
router.get('/assignments', (req, res) => {
  if (!requireEvaluator(req, res)) return;
  const db = getDb();
  const mine = !isAdmin(req.user) || req.query.mine === 'true';
  const status = ['open', 'completed', 'all'].includes(req.query.status) ? req.query.status : 'open';
  let sql = `SELECT a.*, e.name AS employee_name, e.team, e.is_supervisor, u.name AS reviewer_name
    FROM pay_review_assignments a
    JOIN pay_employees e ON e.id = a.employee_id
    LEFT JOIN users u ON u.id = a.reviewer_id WHERE 1=1`;
  const params = [];
  if (status !== 'all') { sql += ' AND a.status = ?'; params.push(status); }
  if (mine) { sql += ' AND a.reviewer_id = ?'; params.push(req.user.id); }
  sql += ' ORDER BY (a.due_date IS NULL), a.due_date, a.created_at DESC LIMIT 200';
  const rows = db.prepare(sql).all(...params).map(r => ({ ...r, overdue: !!(r.status === 'open' && r.due_date && r.due_date < today()) }));
  res.json(rows);
});

// Assigning is an admin act — it's a decision about who evaluates whom, and it
// carries the supervisor-review rule with it: only Adam (or an admin) can be
// asked to review a supervisor, the same rule the submit endpoint enforces.
router.post('/assignments', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  const db = getDb();
  const emp = db.prepare('SELECT * FROM pay_employees WHERE id = ?').get(req.body?.employee_id);
  if (!emp) return res.status(404).json({ error: 'Not on the roster' });
  const reviewer = db.prepare('SELECT id, name FROM users WHERE id = ? AND is_active = 1').get(req.body?.reviewer_id);
  if (!reviewer) return res.status(400).json({ error: 'Pick a reviewer.' });
  if (emp.user_id && emp.user_id === reviewer.id) {
    return res.status(400).json({ error: 'Someone cannot evaluate themselves.' });
  }
  if (emp.is_supervisor && !canReviewSupervisors(reviewer)) {
    return res.status(400).json({ error: `${emp.name} is a supervisor — supervisor reviews are done by Adam or an admin.` });
  }
  const open = db.prepare("SELECT 1 FROM pay_review_assignments WHERE employee_id = ? AND reviewer_id = ? AND status = 'open'").get(emp.id, reviewer.id);
  if (open) return res.status(409).json({ error: `${reviewer.name} already has an open review for ${emp.name}.` });

  const id = uuid();
  db.prepare(`INSERT INTO pay_review_assignments (id, employee_id, reviewer_id, due_date, note, assigned_by)
    VALUES (?, ?, ?, ?, ?, ?)`).run(id, emp.id, reviewer.id,
    String(req.body?.due_date || '').slice(0, 10) || null,
    String(req.body?.note || '').trim().slice(0, 500) || null, req.user.name);
  logAudit(req.user, 'create', 'pay_review_assignment', id, { employee: emp.name, reviewer: reviewer.name }, null, null, emp.name);

  // Tell them. An assignment nobody is told about is the same as not asking.
  // Best-effort — a comms failure must never fail the assignment itself.
  const due = req.body?.due_date ? ` It's due ${String(req.body.due_date).slice(0, 10)}.` : '';
  const body = `📋 *Pay evaluation assigned* — please complete a review for *${emp.name}*.${due}\nOpen ReadyDoc → Pay Tracking → Evaluation. Your scores and notes go to the admin, who decides any increase.`;
  try {
    const { bot, dm } = botDm(db, reviewer.id);
    if (dm) await postMessageAs(db, dm, bot, body);
  } catch (e) { console.warn('[pay] assignment DM failed:', e.message); }
  pushToUser(reviewer.id, {
    title: 'Pay evaluation assigned', body: `Review ${emp.name}${due}`,
    tag: `pay-review-${id}`, renotify: true,
  }).catch(() => {});

  res.status(201).json(db.prepare('SELECT * FROM pay_review_assignments WHERE id = ?').get(id));
});

router.delete('/assignments/:id', (req, res) => {
  if (!requireAdmin(req, res)) return;
  const db = getDb();
  const row = db.prepare('SELECT * FROM pay_review_assignments WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  if (row.status === 'completed') return res.status(400).json({ error: 'That review was completed — it stays as the record that it was done.' });
  db.prepare('DELETE FROM pay_review_assignments WHERE id = ?').run(row.id);
  logAudit(req.user, 'delete', 'pay_review_assignment', row.id, null, row, null, null);
  res.json({ deleted: row.id });
});

// Submit an evaluation. Stores the scores, notes and the band the score landed
// in, and stamps last_reviewed_at — one act, so the clock and the record can't
// disagree. The reviewer's identity comes from the session, never the body.
router.post('/employees/:id/reviews', (req, res) => {
  if (!requireEvaluator(req, res)) return;
  const db = getDb();
  const emp = db.prepare('SELECT * FROM pay_employees WHERE id = ?').get(req.params.id);
  if (!emp) return res.status(404).json({ error: 'Not on the roster' });
  if (emp.is_supervisor && !canReviewSupervisors(req.user)) {
    return res.status(403).json({ error: 'Supervisor reviews are done by Adam (or an admin).' });
  }

  const rawScores = req.body?.scores;
  if (!rawScores || typeof rawScores !== 'object') return res.status(400).json({ error: 'Scores are required.' });
  const scores = {};
  let total = 0;
  for (const [k, v] of Object.entries(rawScores)) {
    const n = Number(v);
    if (![1, 2, 3].includes(n)) return res.status(400).json({ error: `Invalid score for ${k}.` });
    scores[String(k).slice(0, 40)] = n;
    total += n;
  }
  if (!Object.keys(scores).length) return res.status(400).json({ error: 'Scores are required.' });

  const when = String(req.body?.review_date || today()).slice(0, 10);
  const id = uuid();
  db.transaction(() => {
    db.prepare(`INSERT INTO pay_reviews (id, employee_id, reviewer_id, reviewer_name, review_date, scores, total, recommendation, notes, attendance_flag)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      id, emp.id, req.user.id || null, req.user.name, when,
      JSON.stringify(scores), total,
      String(req.body?.recommendation || '').slice(0, 120) || null,
      String(req.body?.notes || '').trim().slice(0, 4000) || null,
      req.body?.attendance_flag ? 1 : 0);
    db.prepare("UPDATE pay_employees SET last_reviewed_at = ?, updated_at = datetime('now') WHERE id = ?").run(when, emp.id);
    // Doing the evaluation is what closes the ask — the assignment is not a
    // separate thing to remember to tick off.
    db.prepare(`UPDATE pay_review_assignments SET status = 'completed', review_id = ?, completed_at = datetime('now')
      WHERE employee_id = ? AND reviewer_id = ? AND status = 'open'`).run(id, emp.id, req.user.id);
  })();
  logAudit(req.user, 'create', 'pay_review', id, { employee: emp.name, total }, null, null, emp.name);
  res.status(201).json({ id, total, review_date: when });
});

// Admins read every review; an evaluator reads only their own. Neither list
// carries pay data — a review is scores and words, and the rate lives on the
// roster the reviewer can't see.
router.get('/reviews', (req, res) => {
  if (!requireEvaluator(req, res)) return;
  const db = getDb();
  const status = ['open', 'resolved', 'dismissed', 'all'].includes(req.query.status) ? req.query.status : 'open';
  let sql = `SELECT r.*, e.name AS employee_name, e.team, e.is_supervisor
    FROM pay_reviews r JOIN pay_employees e ON e.id = r.employee_id WHERE 1=1`;
  const params = [];
  if (status !== 'all') { sql += ' AND r.status = ?'; params.push(status); }
  if (!isAdmin(req.user)) { sql += ' AND (r.reviewer_id = ? OR r.reviewer_name = ?)'; params.push(req.user.id, req.user.name); }
  sql += ' ORDER BY r.created_at DESC LIMIT 200';
  res.json(db.prepare(sql).all(...params).map(r => ({ ...r, scores: JSON.parse(r.scores || '{}') })));
});

// Close reviews without an increase — "held flat, talked it through" is a real
// outcome and needs a reason so the record says why nothing moved.
router.post('/employees/:id/reviews/resolve', (req, res) => {
  if (!requireAdmin(req, res)) return;
  const db = getDb();
  const emp = db.prepare('SELECT * FROM pay_employees WHERE id = ?').get(req.params.id);
  if (!emp) return res.status(404).json({ error: 'Not on the roster' });
  const resolution = String(req.body?.resolution || '').trim();
  if (resolution.length < 3) return res.status(400).json({ error: 'Say why — the reviews close with this as the outcome.' });
  const n = db.prepare(`UPDATE pay_reviews SET status = 'resolved', resolved_by = ?, resolved_at = datetime('now'), resolution = ?
    WHERE employee_id = ? AND status = 'open'`).run(req.user.name, resolution, emp.id).changes;
  logAudit(req.user, 'update', 'pay_review', emp.id, { resolved: n, resolution }, null, null, emp.name);
  res.json({ resolved: n });
});

// The old date-only stamp, kept for compatibility. Deliberately carries no
// score and no notes — just that a review happened, so the clock resets.
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
  // Removing is for rows added by mistake (a sync add under a second spelling).
  // A row with rate history is a pay record — deleting it would take the
  // history with it, so those are deactivated instead, never removed.
  const hasHistory = db.prepare('SELECT 1 FROM pay_rate_history WHERE employee_id = ? LIMIT 1').get(existing.id);
  if (hasHistory) {
    return res.status(400).json({ error: `${existing.name} has rate history — mark them inactive instead of removing them, so the history survives.` });
  }
  db.prepare('DELETE FROM pay_reviews WHERE employee_id = ?').run(existing.id);
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
  // Rows the app cannot resolve on its own. Every one carries the candidate
  // list so the report is something you can ACT on — an unmatched list with no
  // button was the actual complaint, not the matching.
  const candidates = users.map(u => ({ user_id: u.id, name: u.name, department: u.department }));
  const unmatched = roster
    .filter(r => r.active && !r.user_id && !userByName.has(normalizeName(r.name)))
    .map(r => ({ employee_id: r.id, name: r.name }));

  // Already linked, but the person has since been renamed in Settings. Not a
  // problem to fix — the roster follows the link now — but worth showing so a
  // name change doesn't look like a stranger appearing on the payroll.
  const renamed = roster
    .filter(r => r.user_id)
    .map(r => ({ r, u: users.find(x => x.id === r.user_id) }))
    .filter(({ u, r }) => u && normalizeName(u.name) !== normalizeName(r.name))
    .map(({ r, u }) => ({ employee_id: r.id, was: r.name, now: u.name }));

  res.json({ missing, linkable, unmatched, renamed, candidates });
});

// Link one roster row to a person by hand — the action the unmatched list was
// missing. Also adopts the person's name, so the row stops carrying whatever
// spelling it was imported under.
router.post('/employees/:id/link', (req, res) => {
  if (!requireAdmin(req, res)) return;
  const db = getDb();
  const row = db.prepare('SELECT * FROM pay_employees WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not on the roster' });
  const userId = req.body?.user_id || null;
  if (userId) {
    const u = db.prepare('SELECT id, name FROM users WHERE id = ?').get(userId);
    if (!u) return res.status(400).json({ error: 'That person is not in Settings.' });
    db.prepare("UPDATE pay_employees SET user_id = ?, updated_at = datetime('now') WHERE id = ?").run(u.id, row.id);
    logAudit(req.user, 'update', 'pay_employee', row.id, { linked_to: u.name }, row, null, row.name);
  } else {
    // Explicitly unlink — for a roster row that is genuinely not a Settings user.
    db.prepare("UPDATE pay_employees SET user_id = NULL, updated_at = datetime('now') WHERE id = ?").run(row.id);
    logAudit(req.user, 'update', 'pay_employee', row.id, { unlinked: true }, row, null, row.name);
  }
  const [out] = withLinkedNames(db, [db.prepare('SELECT * FROM pay_employees WHERE id = ?').get(row.id)]);
  res.json(decorate(out));
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

// ── The conversation hand-out ────────────────────────────────────────────────
//
// Renders the evaluation to a PDF for the conversation and streams it straight
// back. Nothing is written to the database or to storage — this endpoint has no
// side effects at all, which is the whole point: the sheet exists for the
// meeting, and what happens to it afterwards is a decision made on paper.
//
// It deliberately carries no numeric score and no 1/2/3 ratings. What it shows
// is the descriptor that was picked for each value — which is the actual
// feedback, in the company's own words — plus the notes and the recommendation.
// Someone reading it gets something concrete to talk about rather than a grade.
//
// The rubric text comes from the client because that is where it lives (one
// copy, translated by the page toggle). The sheet is the evaluator's own
// document, not a stored record, so there is nothing here worth validating
// against a server-side duplicate of the same strings.
router.post('/evaluation-pdf', async (req, res) => {
  if (!requireEvaluator(req, res)) return;
  const b = req.body || {};
  const lang = b.lang === 'es' ? 'es' : 'en';
  const lines = Array.isArray(b.lines) ? b.lines.slice(0, 20) : [];
  if (!b.employee_name || !lines.length) {
    return res.status(400).json({ error: 'Nothing to print yet — score the evaluation first.' });
  }

  const t = (en, es) => (lang === 'es' ? es : en);
  // \p{Cc} is the control-character class — stripping them keeps stray
  // newlines and terminal escapes out of the rendered page.
  const clean = (v, max = 400) => String(v ?? '').replace(/\p{Cc}/gu, ' ').slice(0, max);

  try {
    const doc = new PDFDocument({ size: 'LETTER', margins: { top: 54, bottom: 54, left: 54, right: 54 } });
    const chunks = [];
    doc.on('data', c => chunks.push(c));
    const done = new Promise((resolve, reject) => {
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
    });

    if (existsSync(LOGO_PATH)) {
      try { doc.image(readFileSync(LOGO_PATH), 54, 40, { height: 30 }); } catch { /* logo optional */ }
    }
    doc.moveDown(2);
    doc.font('Helvetica-Bold').fontSize(18).fillColor('#26262a')
      .text(t('Pay Increase Evaluation', 'Evaluación de Aumento Salarial'));
    doc.moveDown(0.4);

    const when = String(b.date || new Date().toISOString().slice(0, 10)).slice(0, 10);
    doc.font('Helvetica').fontSize(10).fillColor('#4b4b52');
    doc.text(`${t('Employee', 'Empleado')}: ${clean(b.employee_name, 80)}`);
    if (b.team) doc.text(`${t('Team', 'Equipo')}: ${clean(b.team, 60)}`);
    doc.text(`${t('Supervisor', 'Supervisor')}: ${clean(b.supervisor || req.user.name, 80)}`);
    doc.text(`${t('Date', 'Fecha')}: ${when}`);
    doc.moveTo(54, doc.y + 8).lineTo(558, doc.y + 8).strokeColor('#e5e4df').stroke();
    doc.moveDown(1.2);

    doc.font('Helvetica-Bold').fontSize(11).fillColor('#26262a')
      .text(t('What we talked about', 'De qué hablamos'));
    doc.moveDown(0.4);
    for (const line of lines) {
      if (doc.y > 650) doc.addPage();
      doc.font('Helvetica-Bold').fontSize(9.5).fillColor('#4f6ff5').text(clean(line.title, 120));
      if (line.subtitle) {
        doc.font('Helvetica-Oblique').fontSize(8).fillColor('#8a8a92').text(clean(line.subtitle, 160));
      }
      doc.font('Helvetica').fontSize(9.5).fillColor('#3a3a40')
        .text(clean(line.descriptor, 500), { lineGap: 1.5 });
      doc.moveDown(0.6);
    }

    if (b.notes) {
      if (doc.y > 600) doc.addPage();
      doc.moveDown(0.3);
      doc.font('Helvetica-Bold').fontSize(11).fillColor('#26262a').text(t('Notes', 'Notas'));
      doc.moveDown(0.3);
      doc.font('Helvetica').fontSize(10).fillColor('#3a3a40').text(clean(b.notes, 2000), { lineGap: 2 });
    }

    if (b.recommendation) {
      if (doc.y > 620) doc.addPage();
      doc.moveDown(0.8);
      const boxTop = doc.y;
      doc.roundedRect(54, boxTop, 504, 52, 6).fillAndStroke('#f4f6ff', '#c8d2fb');
      doc.fillColor('#26262a').font('Helvetica-Bold').fontSize(9)
        .text(t('RECOMMENDATION', 'RECOMENDACIÓN'), 68, boxTop + 10, { characterSpacing: 0.6 });
      doc.font('Helvetica-Bold').fontSize(13).fillColor('#26262a')
        .text(clean(b.recommendation, 120), 68, boxTop + 24);
      doc.y = boxTop + 60;
    }

    if (b.attendance_flag) {
      if (doc.y > 660) doc.addPage();
      doc.moveDown(0.4);
      doc.font('Helvetica-Bold').fontSize(9.5).fillColor('#b42318')
        .text(t('A review conversation is required regardless of the rest of this evaluation.',
          'Se requiere una conversación de revisión independientemente del resto de esta evaluación.'),
        { width: 504 });
    }

    doc.font('Helvetica').fontSize(8).fillColor('#9a9aa2')
      .text('Powder Ops · ReadyDoc', 54, 720, { align: 'center', width: 504 });
    doc.end();

    const pdf = await done;
    const safe = clean(b.employee_name, 60).replace(/[^\w -]+/g, '').trim() || 'evaluation';
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${safe} - evaluation ${when}.pdf"`);
    res.send(pdf);
  } catch (e) {
    res.status(500).json({ error: `Could not build the PDF: ${e.message}` });
  }
});

// ── Evaluation support ───────────────────────────────────────────────────────
// The rubric lives on the client (it is static text, and translating it there
// keeps the EN/ES toggle working without a round trip). All this endpoint does
// is give an evaluator the list of people they may evaluate — names only, no
// pay data — so the picker matches the real roster.
router.get('/evaluatees', (req, res) => {
  if (!requireEvaluator(req, res)) return;
  const db = getDb();
  let rows = db.prepare('SELECT id, name, team, is_supervisor, last_reviewed_at, last_increase_at, hire_date FROM pay_employees WHERE active = 1 ORDER BY team, name').all();
  // Supervisors are reviewed only by Adam (or an admin) — everyone else's
  // picker simply doesn't offer them, and the submit endpoint enforces the
  // same rule so the filter can't be worked around.
  if (!canReviewSupervisors(req.user)) rows = rows.filter(r => !r.is_supervisor);
  res.json(rows.map(r => ({
    id: r.id, name: r.name, team: r.team, is_supervisor: !!r.is_supervisor,
    review: reviewState(r),
  })));
});

export default router;
