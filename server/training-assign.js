// Assigning a training course — the step that was missing.
//
// Courses existed and completions were filed after the fact by whoever ran
// the session, but there was no way to HAND a course to somebody: no due
// date, nothing on their screen, nothing to chase. Daniela asked for "the
// training test" for five new employees and the honest answer was that she
// would have to sit each of them at a screen she had access to.
//
// AN ASSIGNMENT IS A WORK ORDER, and that is the whole design. It needs no
// table of its own:
//   - the ask IS the task (the meeting_actions rule — an action item is a
//     work order, not a second to-do list that disagrees with Task Center);
//   - it reaches the person for free, because a task assigned to somebody
//     shows on their Operator View whatever department it came from;
//   - completing it files the training record, through the check-record
//     interface (D-060), so a course cannot read "done" with nothing on the
//     training log behind it;
//   - the RECURRING obligation already exists as
//     `training_records.next_due_date`, which is what stability pulls needed
//     a table for. Nothing here has to remember when Forklift expires.
//
// So: one column (`work_orders.training_course_id`) joining three mechanisms
// that already work.

import { v4 as uuid } from 'uuid';

/** Default lead time when the caller names no due date. */
const DEFAULT_DUE_DAYS = 14;

const dayStr = (d) => new Date(d).toISOString().slice(0, 10);
const plusDays = (from, days) => dayStr(Date.parse(from) + days * 86400000);

/** The open assignment for this course and person, if there is one. */
function openAssignment(db, courseId, person) {
  return db.prepare(`SELECT id, due_date FROM work_orders
    WHERE training_course_id = ? AND status IN ('open','in_progress','overdue','missed')
      AND (assigned_to_id = ? OR LOWER(assigned_to) = LOWER(?))
    LIMIT 1`).get(courseId, person.user_id || null, person.name || '');
}

/** Their current completion of this course, if it is still in date. */
function currentCompletion(db, courseId, person, today) {
  const r = db.prepare(`SELECT id, completion_date, next_due_date FROM training_records
    WHERE course_id = ? AND superseded = 0 AND status = 'completed'
      AND (employee_user_id = ? OR LOWER(employee_name) = LOWER(?))
    ORDER BY completion_date DESC LIMIT 1`).get(courseId, person.user_id || null, person.name || '');
  if (!r) return null;
  // No cadence means it never expires — a one-time course stays current.
  if (r.next_due_date && r.next_due_date <= today) return null;
  return r;
}

/**
 * Assign a course to people. One work order each.
 *
 * `skipCurrent` is the difference between the two callers, and it is
 * deliberate: an automatic pass (a new hire's required set, a renewal coming
 * due) must not hand somebody a course they are already current on, while
 * Daniela assigning it by hand may well be re-training them on purpose and
 * must not be second-guessed. An already-OPEN assignment is skipped either
 * way — a second identical card is noise, and noise is what people learn to
 * dismiss.
 *
 * Nothing here invents a person: a name with no account is assigned by name
 * (the record then files under that name), but a caller asking for an
 * account that does not exist gets it back in `skipped`, never a guess.
 *
 * @returns {{created: Array, skipped: Array}}
 */
export function assignTraining(db, {
  course_id, people = [], due_date = null, assigned_by = 'ReadyDoc',
  source = 'manual', reason = null, skipCurrent = false, today = dayStr(new Date()),
} = {}) {
  const course = db.prepare('SELECT id, code, title, has_test, retrain_months, sop_id FROM training_courses WHERE id = ? AND active = 1').get(course_id);
  if (!course) return { created: [], skipped: [], error: 'Course not found or retired.' };

  const due = /^\d{4}-\d{2}-\d{2}$/.test(String(due_date || '')) ? due_date : plusDays(today, DEFAULT_DUE_DAYS);
  const ins = db.prepare(`INSERT INTO work_orders
    (id, equipment_id, title, description, priority, due_date, procedure_steps, task_group,
     status, training_course_id, assigned_to, assigned_to_id)
    VALUES (?, NULL, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?)`);

  const created = [];
  const skipped = [];
  db.transaction(() => {
    for (const raw of people) {
      const person = {
        user_id: raw?.user_id || raw?.id || null,
        name: String(raw?.name || '').trim(),
      };
      // The account is the identity; resolve the name from it so the task and
      // the record it files read the way every other record does (D-074).
      if (person.user_id) {
        const u = db.prepare('SELECT id, name, department FROM users WHERE id = ? AND is_active = 1').get(person.user_id);
        if (!u) { skipped.push({ ...person, why: 'no such active account' }); continue; }
        person.name = u.name; person.department = u.department;
      }
      if (!person.name) { skipped.push({ ...person, why: 'no name' }); continue; }

      const open = openAssignment(db, course.id, person);
      if (open) { skipped.push({ ...person, why: 'already assigned', work_order_id: open.id, due_date: open.due_date }); continue; }

      if (skipCurrent) {
        const cur = currentCompletion(db, course.id, person, today);
        if (cur) { skipped.push({ ...person, why: 'already current', completion_date: cur.completion_date, next_due_date: cur.next_due_date }); continue; }
      }

      const id = uuid();
      const steps = [
        course.has_test ? 'Work through the course material' : 'Complete the training with whoever is delivering it',
        course.has_test ? 'Take the test and record the result' : 'Record who delivered it',
      ];
      ins.run(id,
        `Training: ${course.code ? `${course.code} — ` : ''}${course.title}`,
        `${course.title}${course.code ? ` (${course.code})` : ''} assigned to ${person.name}${reason ? ` — ${reason}` : ''}.`
          + ` Due ${due}.${course.has_test ? ' This course carries a test; completing this task records the result.' : ''}`
          + ' Completing this task files the training record.',
        'normal', due, JSON.stringify(steps),
        // task_group stays NULL: this is one person's course, not a team's
        // queue. A task assigned to somebody reaches their Operator View
        // whatever department it came from, and giving it a team would put
        // one person's certification on everybody's list.
        null,
        course.id, person.name, person.user_id || null);
      created.push({ work_order_id: id, name: person.name, user_id: person.user_id || null, due_date: due });
    }
  })();

  return { created, skipped, course: { id: course.id, code: course.code, title: course.title }, source, assigned_by };
}

/**
 * Does a course apply to this person, and WHY?
 *
 * Moved here from api/training.js when new hires started being assigned
 * automatically, so the compliance matrix and the assignment agree by
 * construction: if the matrix says somebody owes a course, that is the course
 * they are handed, and a second rule here would let the two disagree about
 * who needs what. Everything that answers "who needs this" goes through here
 * — the matrix, the per-person view, the new-hire pass, the assign modal.
 *
 * THREE AUDIENCES AND A NAMED EXCEPTION, because they answer different
 * questions and none of them can be expressed as another:
 *   role         — every supervisor
 *   department   — everyone in QA
 *   position     — whoever holds this job. A JOB DESCRIPTION is a controlled
 *                  document people are trained on, and it applies to the
 *                  holder of one org-chart position and to nobody else. Keyed
 *                  on the POSITION, not the person, so it follows whoever
 *                  holds the job instead of being re-keyed when somebody moves.
 *   named        — `training_requirements`, one person, required or exempt.
 *
 * An empty role AND department AND position list means everyone — which is not
 * an oversight in this catalogue but the honest answer for GMP, allergen
 * awareness, personal hygiene and the new-hire orientation.
 *
 * A NAMED EXEMPTION BEATS EVERYTHING and a named requirement beats an empty
 * match: an exemption is a decision somebody took about one person, and a rule
 * written afterwards must not quietly undo it.
 */
export function parseList(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  try { const v = JSON.parse(raw); return Array.isArray(v) ? v : []; } catch { return []; }
}

// Everything the rule needs that is not on the course or the user row, read
// ONCE. The matrix asks this question ~450 times; a positions lookup per call
// would be a query per cell.
export function audienceContext(db) {
  const positionsByUser = new Map();
  try {
    for (const p of db.prepare("SELECT id, user_id FROM org_positions WHERE user_id IS NOT NULL").all()) {
      if (!positionsByUser.has(p.user_id)) positionsByUser.set(p.user_id, new Set());
      positionsByUser.get(p.user_id).add(p.id);
    }
  } catch { /* org chart not present */ }
  const overrides = new Map();
  try {
    for (const o of db.prepare('SELECT course_id, user_id, rule FROM training_requirements').all()) {
      overrides.set(`${o.course_id}:${o.user_id}`, o.rule);
    }
  } catch { /* table absent */ }
  return { positionsByUser, overrides };
}

// Why this person owes this course — 'exempt' | 'named' | 'role' |
// 'department' | 'position' | 'everyone' | null. The reason is what makes the
// per-person screen answerable: "why am I being asked to do this" has an
// answer on the record rather than in somebody's head.
export function appliesReason(course, user, ctx = null) {
  const override = ctx?.overrides?.get(`${course.id}:${user.id}`);
  if (override === 'exempt') return 'exempt';
  if (override === 'required') return 'named';
  const roles = parseList(course.required_roles);
  const depts = parseList(course.required_departments);
  const positions = parseList(course.required_positions);
  if (roles.length === 0 && depts.length === 0 && positions.length === 0) return 'everyone';
  if (roles.includes(user.role)) return 'role';
  if (depts.includes(user.department)) return 'department';
  const held = ctx?.positionsByUser?.get(user.id);
  if (held && positions.some(id => held.has(id))) return 'position';
  return null;
}

export function courseAppliesToUser(course, user, ctx = null) {
  const why = appliesReason(course, user, ctx);
  return why !== null && why !== 'exempt';
}

/** A new starter gets longer than the ordinary two weeks — see below. */
const NEW_HIRE_DUE_DAYS = 30;

/**
 * Everything a new starter owes, raised the moment their account exists.
 *
 * THIS IS THE GAP THE OFFICE KEPT FALLING INTO. Daniela had to remember which
 * courses a new employee needed and ask for them one message at a time; Juan
 * had to come and ask for forklift training for a warehouse hire. Neither is
 * a failure of attention — nothing in the app ever said what a new person
 * owed, so remembering it was the only mechanism there was.
 *
 * WHICH COURSES IS NOT DECIDED HERE. It is read off each course's own
 * required roles and departments, which the plant already curates on the
 * course record and which the compliance matrix already reads. A list in this
 * file would be a second answer to "who needs what" and would start
 * disagreeing with the matrix the first time somebody edited a course.
 *
 * Thirty days, not the usual fourteen: a new starter is learning the job
 * itself in their first fortnight, and a pile of training that is overdue
 * before they have found the break room teaches them that overdue is normal.
 *
 * NEVER FAILS THE THING THAT CALLED IT. Completing an onboarding is the
 * record; this is a convenience on top of it, the same standing the pay
 * roster seed has.
 */
export function assignNewHireTraining(db, { user, assigned_by = 'ReadyDoc', reason = 'New hire', today = dayStr(new Date()) } = {}) {
  if (!user?.id) return { created: [], skipped: [], courses: 0 };
  const due = plusDays(today, NEW_HIRE_DUE_DAYS);
  // SELECT *, not a hand-listed projection: the rule reads required_positions
  // too now, and a projection narrower than the code that reads it is a column
  // silently arriving undefined — the guard that broke in D-097.
  const courses = (() => {
    try { return db.prepare('SELECT * FROM training_courses WHERE active = 1 ORDER BY code, title').all(); }
    catch { return []; }
  })();
  const ctx = audienceContext(db);

  const created = [];
  const skipped = [];
  for (const c of courses) {
    if (!courseAppliesToUser(c, user, ctx)) continue;
    const out = assignTraining(db, {
      course_id: c.id, people: [{ user_id: user.id }], due_date: due,
      assigned_by, source: 'onboarding', reason,
      // An automatic pass must never hand somebody a course they are already
      // current on — that is the difference between this and Daniela
      // assigning by hand, where a re-train may well be the point.
      skipCurrent: true, today,
    });
    for (const x of out.created) created.push({ ...x, course: c.code || c.title });
    for (const x of out.skipped) skipped.push({ ...x, course: c.code || c.title });
  }
  return { created, skipped, courses: created.length, due_date: due };
}
