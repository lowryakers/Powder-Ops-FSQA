// The server half of the check-record interface (D-060; the spec is
// shared/check-forms.js).
//
// `checkFormFor(db, wo)` says what a task's completion must carry, and
// `fileCheckRecord(db, ...)` files the record that completion is evidence
// for — inside the completion's own transaction, the fileQaInspectionRecord
// rule: the task and the record are one event. Adding a program is one kind
// in the shared spec and one branch here; pm.js does not change.

import { v4 as uuid } from 'uuid';
import { plantDateOf } from './plant-clock.js';
import {
  checkKindFor, empZoneFor, EMP_ZONES, GMP_WALK_ITEMS, GMP_WALK_REVISION, BANNED_LISTS,
  MANAGEMENT_REVIEW_ITEMS, MANAGEMENT_REVIEW_REVISION, MANAGEMENT_REVIEW_CLAUSE,
  FOOD_DEFENSE_ITEMS, FOOD_DEFENSE_METHODS, FOOD_DEFENSE_SOP,
  missingForCheck, normalizeCheck,
} from '../shared/check-forms.js';
import { EMP_SECTIONS, EMP_FORM_CODE, EMP_REVISION } from './emp-site-list.js';
import { raiseCapa } from './capa-raise.js';
import { insertCompletion } from './training-records.js';
import { nextFutureDue } from './api/quality-schedules.js';
import { logAudit } from './db.js';

export { missingForCheck, normalizeCheck };

function scheduleFor(db, wo) {
  if (!wo?.quality_schedule_id) return null;
  try { return db.prepare('SELECT id, title, module_id FROM quality_schedules WHERE id = ?').get(wo.quality_schedule_id) || null; }
  catch { return null; }
}

/** The form's own site list for a zone, plus sites already sampled there. */
function empSitesFor(db, zone) {
  const sec = EMP_SECTIONS.find(s => s.key === zone);
  const fromForm = sec?.sites ? [...sec.sites] : [];
  const seen = (() => {
    try { return db.prepare('SELECT DISTINCT site FROM emp_samples WHERE zone = ? ORDER BY site').all(zone).map(r => r.site); }
    catch { return []; }
  })();
  const out = [];
  const have = new Set();
  for (const s of [...fromForm, ...seen]) { const k = s.toLowerCase(); if (!have.has(k)) { have.add(k); out.push(s); } }
  return out;
}

/**
 * What this work order's completion must carry, or null when it is an
 * ordinary task. Cheap enough to run per row on a task list: one schedule
 * lookup, and only for tasks that came from a quality schedule.
 */
export function checkFormFor(db, wo) {
  if (wo?.training_course_id) {
    const c = (() => {
      try { return db.prepare('SELECT id, code, title, has_test, passing_score, retrain_months, sop_id FROM training_courses WHERE id = ?').get(wo.training_course_id); }
      catch { return null; }
    })();
    if (!c) return null;
    return {
      kind: 'training', course_id: c.id, code: c.code, title: c.title,
      has_test: !!c.has_test, passing_score: c.passing_score ?? 80,
      retrain_months: c.retrain_months || null, sop_id: c.sop_id || null,
    };
  }
  if (wo?.stability_pull_id) {
    const p = (() => { try { return db.prepare('SELECT p.pull_month, p.due_date, s.title, s.condition, s.tests, s.retention_sample_id, s.lot_number FROM stability_pulls p JOIN stability_studies s ON s.id = p.study_id WHERE p.id = ?').get(wo.stability_pull_id); } catch { return null; } })();
    if (!p) return null;
    return { kind: 'stability_pull', study: p.title, pull_month: p.pull_month, due_date: p.due_date, condition: p.condition, tests: p.tests, lot_number: p.lot_number, retention_sample_id: p.retention_sample_id };
  }
  const sched = scheduleFor(db, wo);
  if (!sched) return null;
  const kind = checkKindFor(sched);
  if (!kind) return null;
  if (kind === 'emp') {
    const zone = empZoneFor(sched.title);
    return {
      kind, zone, zone_label: EMP_ZONES[zone]?.label || zone, tests: EMP_ZONES[zone]?.tests || [],
      sites: empSitesFor(db, zone), form_code: EMP_FORM_CODE, form_revision: EMP_REVISION,
    };
  }
  if (kind === 'gmp_walk') return { kind, items: GMP_WALK_ITEMS, revision: GMP_WALK_REVISION, draft: true };
  if (kind === 'banned_list_review') return { kind, lists: BANNED_LISTS };
  if (kind === 'management_review') {
    return { kind, items: MANAGEMENT_REVIEW_ITEMS, revision: MANAGEMENT_REVIEW_REVISION, clause: MANAGEMENT_REVIEW_CLAUSE, draft: true };
  }
  if (kind === 'food_defense_challenge') {
    // Not draft: SOP 434 V3 is a controlled procedure and the record says
    // which revision it was run against. The REPORT it feeds (SOP 434 § 6.0)
    // still has no form number — that is the DCR, not this.
    return { kind, items: FOOD_DEFENSE_ITEMS, methods: FOOD_DEFENSE_METHODS, sop_revision: FOOD_DEFENSE_SOP };
  }
  return null;
}

/** Attach `check_form` to a list of task rows (one schedule lookup each, cached). */
export function attachCheckForms(db, rows) {
  const cache = new Map();
  return rows.map(r => {
    if (r.training_course_id) {
      const key = `course:${r.training_course_id}`;
      if (!cache.has(key)) cache.set(key, checkFormFor(db, r));
      const f = cache.get(key);
      return f ? { ...r, check_form: f } : r;
    }
    if (r.stability_pull_id) { const f = checkFormFor(db, r); return f ? { ...r, check_form: f } : r; }
    if (!r.quality_schedule_id) return r;
    if (!cache.has(r.quality_schedule_id)) cache.set(r.quality_schedule_id, checkFormFor(db, r));
    const f = cache.get(r.quality_schedule_id);
    return f ? { ...r, check_form: f } : r;
  });
}

/**
 * File the record a completed check is evidence for. Must run inside the
 * completion's transaction. Returns { kind, ids, capas } for the audit line.
 */
export function fileCheckRecord(db, { form, check, wo, by, when, notes }) {
  const c = normalizeCheck(form, check);
  // The plant's day (D-158): `when` is a UTC instant unless it was back-dated
  // to a bare day, and slicing an instant filed every evening check tomorrow.
  const day = /^\d{4}-\d{2}-\d{2}$/.test(String(when || '')) ? when : plantDateOf(when || new Date());
  if (form.kind === 'training') {
    // THE RECORD IS FILED FOR THE PERSON THE TASK WAS ASSIGNED TO, not
    // whoever pressed Complete. A supervisor closing out a task on the floor
    // phone must not end up with the forklift certification against their own
    // name — the assignee is who was trained, and `assigned_to_id` is the
    // identity while the name is a label (D-074).
    const trainee = wo.assigned_to || by;
    const traineeId = wo.assigned_to_id || null;
    // A passed in-app attempt already filed its record when it was graded;
    // naming it here must not file a second one (D-158).
    if (c.test_attempt_id) {
      const at = db.prepare('SELECT record_id, score FROM training_test_attempts WHERE id = ?').get(c.test_attempt_id);
      if (at?.record_id) return { kind: 'training', ids: [at.record_id], course: form.code || form.title, trainee, next_due: null };
      if (at && c.score === null) c.score = at.score;
    }
    const passed = c.score === null ? null : c.score >= (form.passing_score ?? 80);
    const rec = insertCompletion(db, {
      employee_name: trainee, employee_user_id: traineeId,
      course_id: form.course_id, course_title: form.title, sop_id: form.sop_id,
      training_date: day, completion_date: day, status: 'completed',
      score: c.score, passed: passed === null ? undefined : passed,
      test_attempt_id: c.test_attempt_id,
      trainer: c.trainer, method: c.method || (c.test_attempt_id ? 'in-app test' : null),
      notes: notes || null,
    });
    return { kind: 'training', ids: [rec.id], course: form.code || form.title, trainee, next_due: rec.next_due_date };
  }
  if (form.kind === 'stability_pull') {
    db.prepare(`UPDATE stability_pulls SET status = 'pulled', pulled_on = ?, pulled_by = ?, quantity = ?, lab = ?, sent_on = ?, notes = COALESCE(?, notes), updated_at = datetime('now') WHERE id = ? AND status = 'planned'`)
      .run(day, by, c.quantity, c.lab, c.sent_on, notes || null, wo.stability_pull_id);
    return { kind: 'stability_pull', ids: [wo.stability_pull_id] };
  }
  if (form.kind === 'emp') {
    const ins = db.prepare(`INSERT INTO emp_samples (id, work_order_id, quality_schedule_id, zone, site, test, sampled_on, sampled_by, lab, outcome, form_revision, notes, source)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, 'task')`);
    const ids = [];
    for (const site of c.sites) {
      for (const test of form.tests) {
        const id = uuid();
        ins.run(id, wo.id, wo.quality_schedule_id, form.zone, site, test, day, by, c.lab, `${EMP_FORM_CODE} ${EMP_REVISION}`, notes || null);
        ids.push(id);
      }
    }
    return { kind: 'emp', ids, sites: c.sites.length };
  }
  if (form.kind === 'gmp_walk') {
    const id = uuid();
    const items = form.items.map(it => ({ key: it.key, label: it.label, ...c.items[it.key] }));
    const ncs = items.filter(i => i.result === 'nc');
    // A REPEATED problem raises the CAR — the same item not compliant on the
    // previous walk as well. That is the plant's own wording in the CAR
    // response, and it is the two-consecutive-ATP-swabs shape: one walk
    // catching a hairnet is a correction on the spot; two walks running is a
    // control that is not holding.
    const prev = db.prepare('SELECT items FROM gmp_walkthroughs ORDER BY walked_on DESC, created_at DESC LIMIT 1').get();
    const prevNc = new Set();
    if (prev) { try { for (const i of JSON.parse(prev.items)) if (i.result === 'nc') prevNc.add(i.key); } catch { /* unreadable */ } }
    const capas = [];
    for (const nc of ncs) {
      if (!prevNc.has(nc.key)) continue;
      const capa = raiseCapa(db, by, {
        title: `GMP walk-through: ${nc.label.split(' — ')[0]} not compliant on two consecutive walks`,
        description: `Raised from the weekly GMP walk-through (${GMP_WALK_REVISION}) of ${day}, area ${c.area}.\n\nSeen: ${nc.note || 'no note'}.\nThe same item was not compliant on the previous walk.`,
        source_type: 'GMP Walk-through', priority: 'normal', date_issued: day,
        extra: { from_gmp_walk: id, item: nc.key },
      });
      capas.push(capa.id);
      nc.capa_id = capa.id;
    }
    db.prepare(`INSERT INTO gmp_walkthroughs (id, work_order_id, quality_schedule_id, walked_on, walked_by, area, checklist_revision, items, nc_count, capa_ids, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, wo.id, wo.quality_schedule_id, day, by, c.area, GMP_WALK_REVISION, JSON.stringify(items), ncs.length, JSON.stringify(capas), notes || null);
    return { kind: 'gmp_walk', ids: [id], nc_count: ncs.length, capas };
  }
  if (form.kind === 'banned_list_review') {
    const id = uuid();
    db.prepare(`INSERT INTO banned_list_reviews (id, work_order_id, quality_schedule_id, reviewed_on, reviewed_by, editions, changes_found, actions_taken, materials_rechecked, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, wo.id, wo.quality_schedule_id, day, by, JSON.stringify(c.editions), c.changes_found, c.actions_taken, c.materials_rechecked ? 1 : 0, notes || null);
    return { kind: 'banned_list_review', ids: [id] };
  }
  if (form.kind === 'management_review' || form.kind === 'food_defense_challenge') {
    return { ...fileAnnualReview(db, { form, check: c, wo, by, day, notes }), capas: [] };
  }
  return null;
}

/**
 * The two annual reviews. One writer, two doors — the task completion above
 * and the by-hand entry on api/check-records.js both land here, so a review
 * recorded off the paper report is byte for byte one completed in the app
 * apart from `source`. A second copy is how the two start disagreeing about
 * what a review contains.
 */
export function fileAnnualReview(db, { form, check, wo, by, day, notes, source = 'task' }) {
  const id = uuid();
  const woId = wo?.id || null;
  const schedId = wo?.quality_schedule_id || null;
  if (form.kind === 'management_review') {
    const naCount = Object.values(check.items || {}).filter(v => v?.result === 'na').length;
    db.prepare(`INSERT INTO management_reviews
      (id, work_order_id, quality_schedule_id, reviewed_on, reviewed_by, attendees, items, na_count, clause, revision, source, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, woId, schedId, day, by, check.attendees, JSON.stringify(check.items),
        naCount, MANAGEMENT_REVIEW_CLAUSE, MANAGEMENT_REVIEW_REVISION, source, notes || check.notes || null);
    return { kind: 'management_review', ids: [id] };
  }
  db.prepare(`INSERT INTO food_defense_challenges
    (id, work_order_id, quality_schedule_id, performed_on, performed_by, team, items, methods, outcome, findings, corrective_actions, sop_revision, source, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, woId, schedId, day, by, check.team, JSON.stringify(check.items), JSON.stringify(check.methods),
      check.outcome, check.findings, check.corrective_actions, FOOD_DEFENSE_SOP, source, notes || null);
  return { kind: 'food_defense_challenge', ids: [id] };
}

/**
 * A review recorded by hand settles the schedule that was asking for it (D-122).
 *
 * The annual quality schedule and the record were two clocks: the tab derived
 * "due" from the last record while the schedule kept its own `next_due` and
 * its own open task, and filing the March review left the Task Center card
 * open and the next one timed from the seed date. One fact — when the review
 * was last done — with two owners. The record's date is the owner now:
 *   · an open task for that schedule is COMPLETED as of the record's date when
 *     the record is inside the last year (it IS this year's review); a record
 *     older than that leaves the task open, because a review is still owed;
 *   · `next_due` is pulled EARLIER to the first future anniversary of the
 *     record's date, never pushed later — moving it later would hide a review
 *     that is owed;
 *   · the record is linked to the task and the schedule it satisfied.
 * `nextFutureDue` is the generator's own stepper, so the date agrees with what
 * the schedule would have computed itself.
 */
export function settleAnnualSchedule(db, { kind, table, recordId, day, by, user = null }) {
  const out = { schedules: [], closed: [], next_due: null };
  const scheds = (() => {
    try {
      return db.prepare('SELECT id, title, module_id, frequency_type, frequency_value, next_due FROM quality_schedules WHERE is_active = 1').all()
        .filter(s => checkKindFor(s) === kind);
    } catch { return []; }
  })();
  const inWindow = db.prepare("SELECT (date(?) >= date('now', '-365 days')) w").get(day).w === 1;
  for (const s of scheds) {
    out.schedules.push(s.id);
    if (inWindow) {
      const open = db.prepare(`SELECT id, title FROM work_orders WHERE quality_schedule_id = ?
        AND status IN ('open','in_progress','overdue','missed')`).all(s.id);
      for (const w of open) {
        db.prepare(`UPDATE work_orders SET status = 'completed', completed_at = ?, completed_by = ?,
            notes = TRIM(COALESCE(notes, '') || ' ' || ?)
          WHERE id = ?`).run(`${day} 12:00:00`, by, `Recorded from the paper review dated ${day}.`, w.id);
        logAudit(user || 'system', 'complete', 'work_order', w.id,
          { source: 'paper', record: recordId, performed_on: day, completed_by: by }, null, null, w.title);
        out.closed.push(w.id);
      }
    }
    // Linked to the schedule, and to the task it stood in for (the first one).
    db.prepare(`UPDATE ${table} SET quality_schedule_id = COALESCE(quality_schedule_id, ?),
        work_order_id = COALESCE(work_order_id, ?) WHERE id = ?`).run(s.id, out.closed[0] || null, recordId);
    const nd = nextFutureDue(db, day, s.frequency_type, s.frequency_value);
    if (!s.next_due || nd < s.next_due) {
      db.prepare("UPDATE quality_schedules SET next_due = ?, updated_at = datetime('now') WHERE id = ?").run(nd, s.id);
      out.next_due = nd;
    } else out.next_due = s.next_due;
  }
  return out;
}

/**
 * The latest of each, derived on every read — "when was the last one, and is
 * it inside twelve months". A stored `last_done` goes stale the day somebody
 * files one; this cannot.
 */
export function annualReviewStatus(db, table, dateCol) {
  try {
    const row = db.prepare(`SELECT * FROM ${table} ORDER BY ${dateCol} DESC, created_at DESC LIMIT 1`).get();
    if (!row) return { last: null, due: true, days_since: null };
    const days = Math.floor((Date.now() - Date.parse(`${row[dateCol]}T12:00:00Z`)) / 86400000);
    return {
      last: { ...row, items: JSON.parse(row.items || '{}'), methods: row.methods ? JSON.parse(row.methods) : undefined },
      due: days >= 365,
      days_since: days,
    };
  } catch { return { last: null, due: true, days_since: null }; }
}

/** The editions in use: the latest review's. Null until the first review. */
export function currentListEditions(db) {
  try {
    const r = db.prepare('SELECT * FROM banned_list_reviews ORDER BY reviewed_on DESC, created_at DESC LIMIT 1').get();
    return r ? { ...r, editions: JSON.parse(r.editions || '{}') } : null;
  } catch { return null; }
}

/**
 * The reviews recorded by hand BEFORE D-122 never settled their schedule.
 *
 * `settleAnnualSchedule` runs when a review is filed by hand, so one filed the
 * day before it shipped — the 2 March management review — left the annual card
 * open and missed, and `next_due` counting from the task rather than from the
 * review. This applies the same rule, once, to the latest unlinked paper record
 * of each kind. Unlinked is the guard: settling links the record, so a second
 * boot finds nothing to do, and a record filed through its task is already
 * linked and never looked at.
 */
const HAND_FILED = [
  { kind: 'management_review', table: 'management_reviews', dateCol: 'reviewed_on', byCol: 'reviewed_by' },
  { kind: 'food_defense_challenge', table: 'food_defense_challenges', dateCol: 'performed_on', byCol: 'performed_by' },
];

export function settleFiledReviews(db) {
  const out = [];
  for (const h of HAND_FILED) {
    const row = (() => {
      try {
        return db.prepare(`SELECT id, ${h.dateCol} AS day, ${h.byCol} AS who FROM ${h.table}
          WHERE source = 'paper' AND quality_schedule_id IS NULL
          ORDER BY ${h.dateCol} DESC, created_at DESC LIMIT 1`).get();
      } catch { return null; }
    })();
    if (!row) continue;
    // A later review that IS linked already governs the schedule.
    const newer = db.prepare(`SELECT 1 FROM ${h.table} WHERE ${h.dateCol} > ? AND quality_schedule_id IS NOT NULL LIMIT 1`).get(row.day);
    if (newer) continue;
    const settled = settleAnnualSchedule(db, { kind: h.kind, table: h.table, recordId: row.id, day: row.day, by: row.who });
    if (settled.schedules.length) out.push({ kind: h.kind, record: row.id, day: row.day, ...settled });
  }
  return out;
}
