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
