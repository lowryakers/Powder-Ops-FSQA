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
import { readyDocOrigin } from '../links.js';

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
    const q = db.prepare(`SELECT id, name, department, role FROM users WHERE id IN (${ids.map(() => '?').join(',')})`);
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
      // THE TEAM FOLLOWS SETTINGS TOO, for exactly the reasons the name and the
      // supervisor flag do. Settings is where somebody moving from Kitting to
      // Filling is recorded; a stored team on this row is a copy that goes
      // stale the moment they move, and then the roster and the app disagree
      // about which team a person is on. `team_was` keeps the imported value
      // visible where it differed, the same way `renamed_from` does, so an
      // apparent change is explained rather than just appearing.
      team: u.department || r.team,
      team_was: u.department && r.team && u.department !== r.team ? r.team : null,
      // Same reasoning as the name: SETTINGS is where a promotion or a step
      // down is recorded, so a linked row's supervisor flag follows the
      // account's role. The imported column was left saying "supervisor" for
      // someone who had since been changed in Settings, and the review rules
      // read that flag — so the roster and the app disagreed about who needs
      // Adam to review them.
      is_supervisor: SUPERVISOR_ROLES.includes(u.role) ? 1 : 0,
    };
  });
}

// Who counts as a supervisor for the review rules. An admin is included: you
// would not ask an operator to evaluate one either.
const SUPERVISOR_ROLES = ['supervisor', 'admin'];

/** The authority on "is this person a supervisor" — the account, then the row. */
// Rows that carry an employee's facts under `employee_name` / `is_supervisor`
// (assignments, reviews, the nudge): the LINKED account's current name and
// role, never the stored column — the same rule the roster follows.
function withEmployeeFacts(db, rows) {
  const named = withLinkedNames(db, rows.map(r => ({ ...r, name: r.employee_name })));
  return named.map(r => ({ ...r, employee_name: r.name, is_supervisor: isSupervisorRow(db, r) ? 1 : 0 }));
}

function isSupervisorRow(db, row) {
  if (row?.user_id) {
    const u = db.prepare('SELECT role FROM users WHERE id = ?').get(row.user_id);
    if (u) return SUPERVISOR_ROLES.includes(u.role);
  }
  return !!row?.is_supervisor;
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
const EDITABLE = ['name', 'team', 'is_supervisor', 'hire_date', 'pto_plan', 'active', 'notes', 'user_id',
  'last_reviewed_at', 'last_increase_at', 'worker_type', 'contractor_company', 'ends_on'];

// Fields a LINKED row does not own: Settings does. Writing them here would put
// a value on the roster that the next read overrides anyway, which reads as the
// save having silently failed. `team` joined `name` and `is_supervisor` here
// when the team was made to follow the account's department.
const SETTINGS_OWNED = ['name', 'team', 'is_supervisor'];

export const WORKER_TYPES = ['employee', 'contractor'];

/**
 * What a review is FOR.
 *
 * A 30-day check on a new starter and the annual review are the same act with
 * very different stakes, and a queue that calls them both "a review due" tells
 * the office nothing about which one cannot wait. `days` is measured from the
 * hire date; `null` is the annual review, which is driven by the clock in
 * `payActions` rather than by a start date.
 *
 * These are RAISED ONE AT A TIME, deliberately. Nothing generates a 30-day
 * review automatically: the plant hires rarely, some starters are seasonal, and
 * a queue that fills itself with checks nobody asked for is one people learn to
 * dismiss — the same reasoning that keeps a single stray ATP reading from
 * raising a re-clean.
 */
export const OCCASIONS = {
  '30_day': { label: '30-day review', days: 30 },
  '90_day': { label: '90-day review', days: 90 },
};
export const occasionLabel = (o) => OCCASIONS[o]?.label || 'Review';

/** The date a starter's 30- or 90-day check falls due. Null without a hire date. */
export function occasionDue(hireDate, occasion) {
  const spec = OCCASIONS[occasion];
  if (!spec || !hireDate) return null;
  const d = new Date(`${String(hireDate).slice(0, 10)}T00:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  d.setDate(d.getDate() + spec.days);
  return d.toISOString().slice(0, 10);
}

router.post('/employees', (req, res) => {
  if (!requireAdmin(req, res)) return;
  const db = getDb();
  const name = String(req.body?.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Name is required' });
  if (db.prepare('SELECT 1 FROM pay_employees WHERE name = ?').get(name)) {
    return res.status(409).json({ error: `${name} is already on the roster.` });
  }
  const workerType = WORKER_TYPES.includes(req.body?.worker_type) ? req.body.worker_type : 'employee';
  const id = uuid();
  db.prepare(`INSERT INTO pay_employees (id, user_id, name, team, is_supervisor, pay_rate, hire_date, pto_plan,
    worker_type, contractor_company, ends_on)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    id, req.body?.user_id || null, name, req.body?.team || null,
    req.body?.is_supervisor ? 1 : 0,
    req.body?.pay_rate != null && req.body.pay_rate !== '' ? Number(req.body.pay_rate) : null,
    req.body?.hire_date || null, req.body?.pto_plan || null,
    workerType, req.body?.contractor_company || null, req.body?.ends_on || null);
  const created = db.prepare('SELECT * FROM pay_employees WHERE id = ?').get(id);
  logAudit(req.user, 'create', 'pay_employee', id, { name }, null, created, name);
  res.status(201).json(decorate(created));
});

// Everything except the rate, which has its own endpoint so that a pay change
// can never happen without leaving a history row behind.
router.put('/employees/:id', (req, res) => {
  if (!requireAdmin(req, res)) return;
  if (req.body?.worker_type !== undefined && !WORKER_TYPES.includes(req.body.worker_type)) {
    return res.status(400).json({ error: 'Worker type must be employee or contractor.' });
  }
  const db = getDb();
  const existing = db.prepare('SELECT * FROM pay_employees WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Not on the roster' });
  // 400 rather than dropping it silently — the NFP_OWNED rule. A client that
  // sends a team for a linked row would otherwise look like it saved and then
  // show the account's department back on the next read, which reads as the
  // save having failed for no reason anybody can see.
  if (existing.user_id) {
    const owned = SETTINGS_OWNED.filter(f => req.body[f] !== undefined);
    if (owned.length) {
      return res.status(400).json({
        error: `${owned.join(', ')} ${owned.length === 1 ? 'is' : 'are'} set in Settings for someone with a ReadyDoc account — this roster follows it.`,
        settings_owned: owned,
      });
    }
  }
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
// Who may be asked to review. Only supervisors and admins ever evaluate
// anyone — an operator never reviews a colleague — and ReadyBot is not a
// person. Offering the whole roster made both mistakes possible in one click.
router.get('/reviewers', (req, res) => {
  if (!requireAdmin(req, res)) return;
  const db = getDb();
  res.json(db.prepare(`SELECT id, name, role, department FROM users
    WHERE is_active = 1 AND role IN ('supervisor', 'admin') AND name != 'ReadyBot'
    ORDER BY name`).all());
});

router.get('/assignments', (req, res) => {
  if (!requireEvaluator(req, res)) return;
  const db = getDb();
  const mine = !isAdmin(req.user) || req.query.mine === 'true';
  const status = ['open', 'completed', 'all'].includes(req.query.status) ? req.query.status : 'open';
  let sql = `SELECT a.*, e.name AS employee_name, e.user_id, e.team, e.is_supervisor, u.name AS reviewer_name
    FROM pay_review_assignments a
    JOIN pay_employees e ON e.id = a.employee_id
    LEFT JOIN users u ON u.id = a.reviewer_id WHERE 1=1`;
  const params = [];
  if (status !== 'all') { sql += ' AND a.status = ?'; params.push(status); }
  if (mine) { sql += ' AND a.reviewer_id = ?'; params.push(req.user.id); }
  sql += ' ORDER BY (a.due_date IS NULL), a.due_date, a.created_at DESC LIMIT 200';
  const rows = withEmployeeFacts(db, db.prepare(sql).all(...params)).map(r => ({ ...r, overdue: !!(r.status === 'open' && r.due_date && r.due_date < today()) }));
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
  const reviewer = db.prepare('SELECT id, name, role FROM users WHERE id = ? AND is_active = 1').get(req.body?.reviewer_id);
  if (!reviewer) return res.status(400).json({ error: 'Pick a reviewer.' });
  // Enforced here too, not just in the picker: an operator never evaluates a
  // colleague, and ReadyBot is not a person.
  if (!['supervisor', 'admin'].includes(reviewer.role) || reviewer.name === 'ReadyBot') {
    return res.status(400).json({ error: 'Only supervisors and admins can be asked to review someone.' });
  }
  if (emp.user_id && emp.user_id === reviewer.id) {
    return res.status(400).json({ error: 'Someone cannot evaluate themselves.' });
  }
  if (isSupervisorRow(db, emp) && !canReviewSupervisors(reviewer)) {
    return res.status(400).json({ error: `${emp.name} is a supervisor — supervisor reviews are done by Adam or an admin.` });
  }
  // Scoped to the OCCASION. A 30-day check and a 90-day check on the same
  // starter are two different asks and both can legitimately be open at once;
  // only a second copy of the SAME ask is a duplicate.
  const occ = OCCASIONS[req.body?.occasion] ? req.body.occasion : null;
  const open = db.prepare(`SELECT 1 FROM pay_review_assignments
    WHERE employee_id = ? AND reviewer_id = ? AND status = 'open'
      AND COALESCE(occasion, '') = COALESCE(?, '')`).get(emp.id, reviewer.id, occ);
  if (open) {
    return res.status(409).json({ error: occ
      ? `${reviewer.name} already has an open ${occasionLabel(occ).toLowerCase()} for ${emp.name}.`
      : `${reviewer.name} already has an open review for ${emp.name}.` });
  }

  const occasion = occ;
  // A 30/90-day check knows its own due date — it is the hire date plus the
  // days — so the caller does not have to work it out and cannot get it wrong.
  // An explicit date still wins, because a starter who was away for a fortnight
  // is a real reason to move it.
  const due = String(req.body?.due_date || '').slice(0, 10) || occasionDue(emp.hire_date, occasion) || null;
  if (occasion && !due) {
    return res.status(409).json({ error: `${emp.name} has no hire date on the roster, so a ${occasionLabel(occasion).toLowerCase()} has no date to fall due. Add the hire date first, or set a date by hand.` });
  }
  const id = uuid();
  db.prepare(`INSERT INTO pay_review_assignments (id, employee_id, reviewer_id, due_date, note, assigned_by, occasion)
    VALUES (?, ?, ?, ?, ?, ?, ?)`).run(id, emp.id, reviewer.id, due,
    String(req.body?.note || '').trim().slice(0, 500) || null, req.user.name, occasion);
  logAudit(req.user, 'create', 'pay_review_assignment', id, { employee: emp.name, reviewer: reviewer.name, occasion: occasion || 'annual' }, null, null, emp.name);

  // Tell them. An assignment nobody is told about is the same as not asking.
  // Best-effort — a comms failure must never fail the assignment itself.
  const dueTxt = due ? ` It's due ${due}.` : '';
  const what = occasion ? `${occasionLabel(occasion)}` : 'Pay evaluation';
  const body = `📋 *${what} assigned* — please complete a review for *${emp.name}*.${dueTxt}\nOpen ReadyDoc → Pay Tracking → Evaluation. Your scores and notes go to the admin, who decides any increase.`;
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
  if (isSupervisorRow(db, emp) && !canReviewSupervisors(req.user)) {
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
  let sql = `SELECT r.*, e.name AS employee_name, e.user_id, e.team, e.is_supervisor
    FROM pay_reviews r JOIN pay_employees e ON e.id = r.employee_id WHERE 1=1`;
  const params = [];
  if (status !== 'all') { sql += ' AND r.status = ?'; params.push(status); }
  if (!isAdmin(req.user)) { sql += ' AND (r.reviewer_id = ? OR r.reviewer_name = ?)'; params.push(req.user.id, req.user.name); }
  sql += ' ORDER BY r.created_at DESC LIMIT 200';
  res.json(withEmployeeFacts(db, db.prepare(sql).all(...params)).map(r => ({ ...r, scores: JSON.parse(r.scores || '{}') })));
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
  // Through withLinkedNames so the supervisor flag (and the name) come from the
  // linked account rather than whatever the import wrote months ago.
  // Contractors are paid, not reviewed — they have no review cycle, so they are
  // not offered as somebody to evaluate.
  let rows = withLinkedNames(db, db.prepare(
    "SELECT * FROM pay_employees WHERE active = 1 AND COALESCE(worker_type, 'employee') <> 'contractor' ORDER BY team, name").all());
  // Supervisors are reviewed only by Adam (or an admin) — everyone else's
  // picker simply doesn't offer them, and the submit endpoint enforces the
  // same rule so the filter can't be worked around.
  if (!canReviewSupervisors(req.user)) rows = rows.filter(r => !r.is_supervisor);
  res.json(rows.map(r => ({
    id: r.id, name: r.name, team: r.team, is_supervisor: !!r.is_supervisor,
    review: reviewState(r),
  })));
});

// ── Who's due, told to someone ───────────────────────────────────────────────
//
// Two different facts, and they go to different people:
//
//  · A REVIEWER is nudged about the evaluation they were asked to do, once it
//    is close or past its date. That's their own work.
//  · The OFFICE (admins + the office department — Marnee and the owner) gets
//    the picture: reviews nobody has done yet, and people whose review clock
//    has run out and who have no evaluation assigned at all. The second half
//    is the one that actually starts a cycle — an overdue clock with nobody
//    asked to review is invisible until somebody thinks to look.
//
// Best-effort throughout: a comms failure must never throw out of the job.
const DUE_SOON_DAYS = 3;

async function dm(db, userId, body, push) {
  try {
    const { bot, dm: channel } = botDm(db, userId);
    if (channel) await postMessageAs(db, channel, bot, body);
  } catch (e) { console.warn('[pay] nudge DM failed:', e.message); }
  if (push) pushToUser(userId, push).catch(() => {});
}

/**
 * Everything waiting on the OFFICE — derived on every read, never stored.
 *
 * Three kinds, and each stays on the list until the act that clears it has
 * actually happened; there is no dismiss, because "I saw it" is not an action
 * and a review that was seen and forgotten is exactly what this exists to stop:
 *
 *   decide — an evaluation has been submitted and nobody has decided. Clears
 *            when a rate is applied (which resolves the open reviews) or the
 *            reviews are closed as held flat with a reason.
 *   assign — the review clock has run out and nobody has been asked to review
 *            them. Clears when an assignment is made, a review is submitted, a
 *            rate is applied, or the person is marked reviewed.
 *   chase  — an assignment is past its date and the reviewer has not delivered.
 *            Clears when the review is submitted or the assignment is cancelled.
 *
 * ONE OWNER: the endpoint, the ReadyBot reminder and the bell badge all read
 * this, so they cannot disagree about what is outstanding.
 */
export function payActions(db) {
  const now = today();
  const items = [];
  // Same exclusion as the evaluatee picker: a contractor never falls due for a
  // review, so they can never become an item on the office's queue.
  const roster = (() => { try { return withLinkedNames(db, db.prepare(
    "SELECT * FROM pay_employees WHERE active = 1 AND COALESCE(worker_type, 'employee') <> 'contractor'").all()); } catch { return []; } })();
  const byId = new Map(roster.map(r => [r.id, r]));

  // decide — open reviews, grouped per employee
  const openReviews = (() => {
    try {
      return db.prepare(`SELECT employee_id, COUNT(*) AS n, MIN(review_date) AS oldest, MAX(review_date) AS newest,
          ROUND(AVG(total), 1) AS avg_total, GROUP_CONCAT(reviewer_name, ' · ') AS reviewers
        FROM pay_reviews WHERE status = 'open' GROUP BY employee_id`).all();
    } catch { return []; }
  })();
  const decided = new Set();
  for (const r of openReviews) {
    const e = byId.get(r.employee_id); if (!e) continue;
    decided.add(e.id);
    items.push({ kind: 'decide', employee_id: e.id, employee_name: e.name, team: e.team,
      reviews: r.n, oldest: r.oldest, newest: r.newest, avg_total: r.avg_total, reviewers: r.reviewers,
      waiting_days: daysSince(r.oldest) });
  }

  // chase — open assignments past their date
  const open = (() => {
    try {
      return withEmployeeFacts(db, db.prepare(`SELECT a.id, a.due_date, a.reviewer_id, a.employee_id, a.occasion,
          e.name AS employee_name, e.user_id, e.is_supervisor, e.team, u.name AS reviewer_name
        FROM pay_review_assignments a JOIN pay_employees e ON e.id = a.employee_id LEFT JOIN users u ON u.id = a.reviewer_id
        WHERE a.status = 'open' ORDER BY a.due_date`).all());
    } catch { return []; }
  })();
  const assigned = new Set(open.map(a => a.employee_id));
  for (const a of open) {
    if (!a.due_date || a.due_date >= now) continue;
    items.push({ kind: 'chase', employee_id: a.employee_id, employee_name: a.employee_name, team: a.team,
      occasion: a.occasion || null, occasion_label: a.occasion ? occasionLabel(a.occasion) : null,
      assignment_id: a.id, reviewer_id: a.reviewer_id, reviewer_name: a.reviewer_name, due_date: a.due_date,
      overdue_days: daysSince(a.due_date) });
  }

  // assign — clock run out, nobody asked, nothing submitted
  for (const e of roster) {
    const st = reviewState(e);
    if (st.status !== 'due' || assigned.has(e.id) || decided.has(e.id)) continue;
    items.push({ kind: 'assign', employee_id: e.id, employee_name: e.name, team: e.team, since: st.since, days: st.days,
      is_supervisor: isSupervisorRow(db, e) ? 1 : 0 });
  }

  const order = { decide: 0, chase: 1, assign: 2 };
  items.sort((a, b) => order[a.kind] - order[b.kind] || (b.waiting_days ?? b.overdue_days ?? b.days ?? 0) - (a.waiting_days ?? a.overdue_days ?? a.days ?? 0));
  const counts = { decide: 0, chase: 0, assign: 0 };
  for (const i of items) counts[i.kind]++;
  return { items, counts: { ...counts, total: items.length }, as_of: now };
}

/**
 * Who is reminded about the office list. `pay_action_recipients` in
 * app_settings (a JSON array of user ids) when the plant has chosen; otherwise
 * active admins plus the office / HR / admin departments — never nobody, since
 * a reminder configured to reach no one is indistinguishable from a broken job.
 */
export function payActionRecipients(db) {
  let ids = null;
  try { ids = JSON.parse(db.prepare("SELECT value FROM app_settings WHERE key = 'pay_action_recipients'").get()?.value || 'null'); } catch { ids = null; }
  const all = db.prepare("SELECT id, name, role, department FROM users WHERE is_active = 1 AND name != 'ReadyBot'").all();
  if (Array.isArray(ids) && ids.length) {
    const chosen = all.filter(u => ids.includes(u.id));
    if (chosen.length) return { users: chosen, source: 'setting' };
  }
  return { users: all.filter(u => u.role === 'admin' || ['office', 'hr', 'admin'].includes(String(u.department || '').toLowerCase())), source: 'default' };
}

router.get('/actions', (req, res) => {
  if (!requireAdmin(req, res)) return;
  const db = getDb();
  const { users, source } = payActionRecipients(db);
  res.json({ ...payActions(db), recipients: users.map(u => ({ id: u.id, name: u.name })), recipients_source: source });
});

router.put('/action-recipients', (req, res) => {
  if (!requireAdmin(req, res)) return;
  const db = getDb();
  const ids = Array.isArray(req.body?.user_ids) ? req.body.user_ids.map(String) : [];
  db.prepare("INSERT OR REPLACE INTO app_settings (key, value, updated_at) VALUES ('pay_action_recipients', ?, datetime('now'))").run(JSON.stringify(ids));
  logAudit(req.user, 'update', 'pay_action_recipients', 'pay_action_recipients', { user_ids: ids }, null, null, 'Pay reminders');
  const { users, source } = payActionRecipients(db);
  res.json({ recipients: users.map(u => ({ id: u.id, name: u.name })), recipients_source: source });
});

export async function payReviewNudges(db) {
  const sent = { reviewers: 0, office: 0 };
  const now = today();
  const soon = new Date(Date.now() + DUE_SOON_DAYS * 86400000).toISOString().slice(0, 10);

  // 1) Each reviewer's own outstanding asks.
  let open;
  try {
    open = withEmployeeFacts(db, db.prepare(`SELECT a.id, a.due_date, a.reviewer_id, e.name AS employee_name, e.user_id, e.is_supervisor
      FROM pay_review_assignments a JOIN pay_employees e ON e.id = a.employee_id
      WHERE a.status = 'open' AND a.due_date IS NOT NULL AND a.due_date <= ?
      ORDER BY a.due_date`).all(soon));
  } catch { open = []; }

  const byReviewer = new Map();
  for (const a of open) {
    if (!byReviewer.has(a.reviewer_id)) byReviewer.set(a.reviewer_id, []);
    byReviewer.get(a.reviewer_id).push(a);
  }
  for (const [reviewerId, list] of byReviewer) {
    const lines = list.map(a => `• *${a.employee_name}* — ${a.due_date < now ? `overdue since ${a.due_date}` : `due ${a.due_date}`}`);
    await dm(db, reviewerId,
      `📋 *Pay evaluation${list.length === 1 ? '' : 's'} waiting on you*\n${lines.join('\n')}\nOpen ReadyDoc → Pay Tracking → Evaluation.`,
      { title: `${list.length} pay evaluation${list.length === 1 ? '' : 's'} waiting`, body: list.map(a => a.employee_name).join(', '), tag: 'pay-reviews-due', renotify: true });
    sent.reviewers++;
  }

  // 2) The office picture — the SAME list the screen and the bell show, and it
  //    keeps coming every third day until each item has been acted on. A
  //    submitted evaluation waiting on a decision used to be missing from this
  //    message entirely, which is how one could be seen once and forgotten.
  const { items, counts } = payActions(db);
  if (!items.length) return sent;

  const parts = [`💵 *Pay reviews — ${counts.total} thing${counts.total === 1 ? '' : 's'} waiting on you*`];
  const decide = items.filter(i => i.kind === 'decide');
  const chase = items.filter(i => i.kind === 'chase');
  const assign = items.filter(i => i.kind === 'assign');
  if (decide.length) {
    parts.push(`*${decide.length} evaluation${decide.length === 1 ? '' : 's'} submitted, awaiting your decision (apply an increase or hold flat):*`);
    parts.push(...decide.slice(0, 8).map(i => `• ${i.employee_name} — ${i.reviews} review${i.reviews === 1 ? '' : 's'} in, waiting ${i.waiting_days} day${i.waiting_days === 1 ? '' : 's'}`));
    if (decide.length > 8) parts.push(`  …and ${decide.length - 8} more`);
  }
  if (chase.length) {
    parts.push(`*${chase.length} evaluation${chase.length === 1 ? '' : 's'} past the date the reviewer was given:*`);
    parts.push(...chase.slice(0, 8).map(i => `• ${i.employee_name} — ${i.reviewer_name || 'reviewer'} was due ${i.due_date}`));
    if (chase.length > 8) parts.push(`  …and ${chase.length - 8} more`);
  }
  if (assign.length) {
    parts.push(`*${assign.length} due for review with nobody assigned:*`);
    parts.push(...assign.slice(0, 8).map(i => `• ${i.employee_name} — ${i.days} days since the last raise or review`));
    if (assign.length > 8) parts.push(`  …and ${assign.length - 8} more`);
  }
  parts.push(`These stay on the list until you act on them: ${readyDocOrigin()}/?tab=pay-tracking`);
  const body = parts.join('\n');

  const { users: office } = payActionRecipients(db);
  for (const u of office) {
    await dm(db, u.id, body, {
      title: `Pay reviews: ${counts.total} waiting on you`,
      body: `${counts.decide} to decide · ${counts.chase} overdue · ${counts.assign} unassigned`,
      tag: 'pay-reviews-office', renotify: true, url: '/?tab=pay-tracking',
    });
    sent.office++;
  }
  return sent;
}

export default router;
