// FOOD SAFETY CULTURE (D-211, SQF 2.1.1.2) — the concern log, the supervisor's
// monthly check, and the month's summary the review meeting reads.
//
// ONE WRITER EACH. `raiseConcern` is the only insert into culture_concerns —
// the "raise a concern" door and the concerns written down at a team talk both
// land here, so a concern is one thing whichever way it came in.
// `fileCultureCheck` is the only insert into culture_checks — the page today,
// a monthly quality-schedule task once the plant names the departments.
//
// THE SUMMARY IS DERIVED ON EVERY READ from the rows, never stored: a stored
// monthly figure is wrong the first time somebody answers a concern late.
//
// FEWER CONCERNS IS NOT A STRONGER CULTURE, and the summary is built so it
// cannot be read that way on its own: the reporting rate sits beside what
// supervisors observed and the GMP walk results, month on month, which is the
// "consider them together" SQFI asks for.

import { randomUUID as uuid } from 'crypto';
import { logAudit } from './db.js';
import { plantDateOf } from './plant-clock.js';
import {
  cultureCheckForm, missingForCheck, normalizeCheck, CONCERN_CATEGORY_KEYS, CULTURE_CHECK_REVISION,
} from '../shared/check-forms.js';
import { TASK_GROUP_VALUES } from '../shared/task-groups.js';

export const CONCERN_STATUSES = ['open', 'in_review', 'closed'];
const REVIEW_DEPARTMENTS = ['qa', 'quality', 'document_control'];

/** Who reads every concern, answers them, and reads the summary. */
export function canReviewCulture(u) {
  if (!u || u.is_external) return false;
  return u.role === 'admin' || u.role === 'supervisor'
    || REVIEW_DEPARTMENTS.includes(String(u.department || '').toLowerCase());
}

/** Who files the monthly check: the supervisors, and an admin. */
export const canFileCultureCheck = (u) => !!u && !u.is_external && (u.role === 'supervisor' || u.role === 'admin');

/**
 * Whether a concern may be raised without a name. OFF until the plant decides —
 * a setting, never a deploy, because it is a decision about how people are
 * heard, not a feature.
 */
export function anonymousAllowed(db) {
  try { return db.prepare("SELECT value FROM app_settings WHERE key = 'culture_anonymous_concerns'").get()?.value === 'on'; }
  catch { return false; }
}

export function setAnonymousAllowed(db, on, user) {
  const before = anonymousAllowed(db);
  db.prepare("INSERT INTO app_settings (key, value) VALUES ('culture_anonymous_concerns', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .run(on ? 'on' : 'off');
  logAudit(user, 'update', 'culture_settings', 'culture_anonymous_concerns', { anonymous_allowed: { from: before, to: !!on } });
  return !!on;
}

const cleanDept = (d) => {
  const v = String(d || '').trim().toLowerCase();
  return TASK_GROUP_VALUES.includes(v) ? v : null;
};

/**
 * Raise one concern. `anonymous` is honoured only while the plant allows it,
 * and then no name or id is written — the row cannot be traced back.
 * Returns { id } or { error, status }.
 */
export function raiseConcern(db, user, body = {}, { source = 'direct', checkId = null, day = null } = {}) {
  const description = String(body.description || '').trim().slice(0, 2000);
  if (description.length < 3) return { error: 'Say what the concern is.', status: 400 };
  const category = CONCERN_CATEGORY_KEYS.includes(body.category) ? body.category : null;
  if (!category) return { error: 'Choose what the concern is about.', status: 400 };
  const wantsAnon = !!body.anonymous;
  if (wantsAnon && source === 'direct' && !anonymousAllowed(db)) {
    return { error: 'Concerns cannot be raised without a name yet. Your name will be on it.', status: 400 };
  }
  const anon = wantsAnon && source === 'direct';
  const department = cleanDept(body.department) || cleanDept(user?.department);
  const id = uuid();
  db.prepare(`INSERT INTO culture_concerns (id, raised_on, department, category, description, raised_by_id, raised_by, anonymous, source, culture_check_id)
    VALUES (?,?,?,?,?,?,?,?,?,?)`)
    .run(id, day || plantDateOf(new Date()), department, category, description,
      anon ? null : (user?.id || null), anon ? null : (user?.name || null), anon ? 1 : 0, source, checkId);
  // The audit row of an anonymous concern carries no actor either; a trail that
  // names the person defeats the option.
  logAudit(anon ? 'anonymous' : user, 'create', 'culture_concern', id, { category, department, source, anonymous: anon }, null, null, category);
  return { id, anonymous: anon };
}

/** Answer a concern: a status and words. Closing needs words. */
export function respondConcern(db, user, id, body = {}) {
  const before = db.prepare('SELECT * FROM culture_concerns WHERE id = ?').get(id);
  if (!before) return { error: 'Not found', status: 404 };
  const status = CONCERN_STATUSES.includes(body.status) ? body.status : null;
  if (!status) return { error: 'Choose open, being looked at, or closed.', status: 400 };
  const response = String(body.response || '').trim().slice(0, 4000);
  if (status === 'closed' && response.length < 3) return { error: 'Say what was done before closing it — the person who raised it reads this.', status: 400 };
  db.prepare(`UPDATE culture_concerns SET status = ?, response = COALESCE(?, response), responded_by = ?, responded_at = datetime('now') WHERE id = ?`)
    .run(status, response || null, user?.name || null, id);
  const after = db.prepare('SELECT * FROM culture_concerns WHERE id = ?').get(id);
  logAudit(user, 'update', 'culture_concern', id, { status, response: response || null }, before, after, before.category);
  return { concern: after };
}

/**
 * File one monthly culture check. Validated by the SAME `missingForCheck` the
 * form shows, so the page and a task cannot disagree about what is complete.
 * The concerns written down at the team talk are raised through `raiseConcern`,
 * named for the supervisor who wrote them down (a talk is not anonymous).
 * Must run inside a transaction when called from a task completion.
 */
export function fileCultureCheck(db, user, check = {}, { wo = null, day = null, notes = null, source = 'page' } = {}) {
  const form = cultureCheckForm(cleanDept(check.department));
  const missing = missingForCheck(form, check);
  if (missing.length) return { error: `Still needed: ${missing.map(m => m.label).join('; ')}.`, status: 400, missing };
  const c = normalizeCheck(form, check);
  const department = cleanDept(c.department);
  if (!department) return { error: 'Choose a department from the list.', status: 400 };
  const on = /^\d{4}-\d{2}-\d{2}$/.test(String(day || '')) ? day : plantDateOf(new Date());
  const id = uuid();
  const all = [...form.items, ...form.safety_items];
  const items = all.map(it => ({ key: it.key, label: it.label, ...c.items[it.key] }));
  const nc = items.filter(i => i.result === 'nc').length;
  db.prepare(`INSERT INTO culture_checks (id, work_order_id, quality_schedule_id, department, checked_on, checked_by, checked_by_id,
      checklist_revision, items, nc_count, observation_note, talk_date, talk_attendees, talk_attendee_names, concern_count, notes, source)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(id, wo?.id || null, wo?.quality_schedule_id || null, department, on, user?.name || 'unknown', user?.id || null,
      CULTURE_CHECK_REVISION, JSON.stringify(items), nc, c.observation_note, c.talk_date, c.talk_attendees,
      c.talk_attendee_names, c.concerns.length, notes || null, source);
  const concernIds = [];
  for (const x of c.concerns) {
    const r = raiseConcern(db, user, { ...x, department }, { source: 'team_talk', checkId: id, day: c.talk_date || on });
    if (r.id) concernIds.push(r.id);
  }
  logAudit(user, 'create', 'culture_check', id, { department, nc_count: nc, concerns: concernIds.length, source }, null, null, department);
  return { id, kind: 'culture_check', ids: [id], nc_count: nc, concern_ids: concernIds };
}

/* ── The month ─────────────────────────────────────────────────────────────── */

const monthOf = (m) => (/^\d{4}-\d{2}$/.test(String(m || '')) ? m : plantDateOf(new Date()).slice(0, 7));
function prevMonth(m) {
  const [y, mo] = m.split('-').map(Number);
  const d = new Date(Date.UTC(y, mo - 2, 1));
  return d.toISOString().slice(0, 7);
}
const tally = (rows, key) => rows.reduce((o, r) => { const k = r[key] || 'unspecified'; o[k] = (o[k] || 0) + 1; return o; }, {});
const parse = (s, fb) => { try { return JSON.parse(s); } catch { return fb; } };

function monthFigures(db, m) {
  const like = `${m}%`;
  const concerns = db.prepare('SELECT * FROM culture_concerns WHERE raised_on LIKE ? ORDER BY raised_on').all(like);
  const checks = db.prepare('SELECT * FROM culture_checks WHERE checked_on LIKE ? ORDER BY checked_on').all(like);
  const walks = (() => { try { return db.prepare('SELECT * FROM gmp_walkthroughs WHERE walked_on LIKE ? ORDER BY walked_on').all(like); } catch { return []; } })();
  const itemNc = {};
  for (const w of [...walks, ...checks]) {
    for (const i of parse(w.items, [])) if (i.result === 'nc') itemNc[i.label] = (itemNc[i.label] || 0) + 1;
  }
  const closedInMonth = db.prepare("SELECT COUNT(*) c FROM culture_concerns WHERE status = 'closed' AND responded_at LIKE ?").get(like).c;
  return {
    month: m,
    concerns: {
      raised: concerns.length,
      by_category: tally(concerns, 'category'),
      by_department: tally(concerns, 'department'),
      from_team_talks: concerns.filter(x => x.source === 'team_talk').length,
      raised_directly: concerns.filter(x => x.source === 'direct').length,
      anonymous: concerns.filter(x => x.anonymous).length,
      closed_in_month: closedInMonth,
    },
    checks: {
      filed: checks.length,
      by_department: tally(checks, 'department'),
      not_compliant_items: checks.reduce((t, x) => t + (x.nc_count || 0), 0),
      talk_attendees: checks.reduce((t, x) => t + (x.talk_attendees || 0), 0),
    },
    gmp_walks: {
      filed: walks.length,
      not_compliant_items: walks.reduce((t, x) => t + (x.nc_count || 0), 0),
    },
    observed_not_compliant: Object.entries(itemNc).map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count),
  };
}

/** The month the review meeting reads, beside the month before it. */
export function cultureSummary(db, month) {
  const m = monthOf(month);
  const cur = monthFigures(db, m);
  const prev = monthFigures(db, prevMonth(m));
  const open = db.prepare("SELECT id, raised_on, department, category, status FROM culture_concerns WHERE status != 'closed' ORDER BY raised_on").all();
  return {
    month: m,
    previous_month: prev.month,
    current: cur,
    previous: prev,
    still_open: { count: open.length, oldest: open[0]?.raised_on || null, rows: open.slice(0, 50) },
    checks_filed: db.prepare('SELECT id, department, checked_on, checked_by, nc_count, concern_count, talk_attendees FROM culture_checks WHERE checked_on LIKE ? ORDER BY checked_on').all(`${m}%`),
    reading_note: 'Fewer concerns is not by itself a stronger culture. Read the reporting rate together with what supervisors observed and the GMP walk results.',
  };
}

/** One concern as the person reading it may see it. */
export function concernView(row, viewer) {
  const mine = !!(viewer?.id && row.raised_by_id === viewer.id);
  return {
    id: row.id, raised_on: row.raised_on, department: row.department, category: row.category,
    description: row.description, anonymous: !!row.anonymous, source: row.source,
    raised_by: row.anonymous ? null : row.raised_by,
    status: row.status, response: row.response, responded_at: row.responded_at,
    responded_by: canReviewCulture(viewer) ? row.responded_by : null,
    culture_check_id: row.culture_check_id, is_mine: mine,
  };
}
