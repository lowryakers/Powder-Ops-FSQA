// What each person owes, in one walk.
//
// The compliance matrix already answered this for the whole plant as a grid —
// people down the side, courses across the top — and Document Control's ask is
// the same question turned ninety degrees: "show me the assigned trainings for
// ONE person." A grid of twenty courses by forty people is a map; it is not an
// answer about Diana.
//
// THE STATE IS COMPUTED ONCE, HERE, and both views read it. A per-person
// screen built from a second copy of the rule is a screen that disagrees with
// the matrix above it, and whoever is looking cannot tell which is wrong — the
// `activity-metrics.js` rule, and the reason `courseAppliesToUser` was moved
// out of the route in the first place.

import { audienceContext, appliesReason } from './training-assign.js';

const ASSIGNMENT_OPEN = ['open', 'in_progress', 'overdue', 'missed'];

function addMonths(dateStr, months) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setMonth(d.getMonth() + months);
  return d.toISOString().slice(0, 10);
}

// Everything the rule needs, read once. Callers hand this to `cellFor`.
export function trainingSnapshot(db, { today = new Date().toISOString().slice(0, 10) } = {}) {
  const users = db.prepare("SELECT id, name, role, department FROM users WHERE is_active = 1 AND COALESCE(is_external, 0) = 0 ORDER BY name").all();
  const courses = db.prepare('SELECT * FROM training_courses WHERE active = 1 ORDER BY category, title').all();
  const records = db.prepare("SELECT * FROM training_records WHERE superseded = 0 AND status = 'completed'").all();
  const ctx = audienceContext(db);

  // The revision each linked document is currently at for training purposes.
  const docRev = {};
  const docs = {};
  for (const d of db.prepare('SELECT id, doc_number, title, doc_type, revision, training_revision FROM sop_documents').all()) {
    docRev[d.id] = d.training_revision || d.revision || null;
    docs[d.id] = d;
  }

  // The open assignment (a work order) per course per person. An assignment is
  // a different fact from a requirement: the rule says she owes it, the work
  // order says somebody has asked her for it and by when.
  const assignments = new Map();
  for (const wo of db.prepare(`
    SELECT id, training_course_id, assigned_to, assigned_to_id, due_date, status, completed_at
      FROM work_orders WHERE training_course_id IS NOT NULL
  `).all()) {
    const key = `${wo.training_course_id}:${wo.assigned_to_id || (wo.assigned_to || '').toLowerCase()}`;
    const open = ASSIGNMENT_OPEN.includes(wo.status);
    const prev = assignments.get(key);
    // An open one always wins; otherwise the most recent.
    if (!prev || (open && !prev.open) || (open === prev.open && (wo.due_date || '') > (prev.due_date || ''))) {
      assignments.set(key, { ...wo, open, overdue: open && !!wo.due_date && wo.due_date < today });
    }
  }

  return { users, courses, records, ctx, docRev, docs, assignments, today, soon: addMonths(today, 1) };
}

// One person, one course. Returns null when the course does not apply — a
// course somebody does not owe is absent, never a cell reading "n/a", which is
// the difference between a punch list and wallpaper.
export function cellFor(user, course, snap) {
  const why = appliesReason(course, user, snap.ctx);
  if (why === null) return null;
  if (why === 'exempt') return { state: 'exempt', why };

  const rec = snap.records.find(r =>
    r.course_id === course.id &&
    (r.employee_user_id === user.id || r.employee_name?.toLowerCase() === user.name.toLowerCase()));

  const assignment = snap.assignments.get(`${course.id}:${user.id}`)
    || snap.assignments.get(`${course.id}:${(user.name || '').toLowerCase()}`)
    || null;

  if (!rec) {
    return {
      state: 'missing', why,
      assignment: assignment && assignment.open
        ? { id: assignment.id, due_date: assignment.due_date, status: assignment.status, overdue: assignment.overdue }
        : null,
    };
  }

  const needRev = course.sop_id ? snap.docRev[course.sop_id] : null;
  const docOutdated = course.retrain_on_doc_change && course.sop_id && rec.sop_revision && needRev && rec.sop_revision !== needRev;
  let state = 'current';
  if (rec.next_due_date && rec.next_due_date < snap.today) state = 'overdue';
  else if (docOutdated) state = 'outdated';
  else if (rec.next_due_date && rec.next_due_date <= snap.soon) state = 'due_soon';

  return {
    state, why,
    completion_date: rec.completion_date,
    next_due_date: rec.next_due_date,
    record_id: rec.id,
    score: rec.score,
    passed: rec.passed,
    sop_revision: rec.sop_revision,
    current_revision: needRev,
    assignment: assignment && assignment.open
      ? { id: assignment.id, due_date: assignment.due_date, status: assignment.status, overdue: assignment.overdue }
      : null,
  };
}

// The states that mean somebody still owes work. `exempt` and `current` do
// not; `outdated` does, because the document moved under a completion.
export const OUTSTANDING_STATES = ['missing', 'overdue', 'due_soon', 'outdated'];

/** One person's whole training picture. */
export function personTraining(db, userId, opts = {}) {
  const snap = trainingSnapshot(db, opts);
  const user = snap.users.find(u => u.id === userId);
  if (!user) return null;

  const rows = [];
  for (const c of snap.courses) {
    const cell = cellFor(user, c, snap);
    if (!cell) continue;
    rows.push({
      course_id: c.id,
      code: c.code,
      title: c.title,
      category: c.category,
      retrain_months: c.retrain_months,
      // The document it is trained against, named — "which SOP is this?" is
      // the question a training record gets asked in an audit.
      document: c.sop_id && snap.docs[c.sop_id]
        ? { id: c.sop_id, doc_number: snap.docs[c.sop_id].doc_number, title: snap.docs[c.sop_id].title, doc_type: snap.docs[c.sop_id].doc_type, revision: snap.docRev[c.sop_id] }
        : null,
      ...cell,
    });
  }

  const counts = { missing: 0, overdue: 0, due_soon: 0, outdated: 0, current: 0, exempt: 0 };
  for (const r of rows) if (counts[r.state] !== undefined) counts[r.state]++;

  return {
    user,
    rows,
    counts,
    // Counted from the rows returned, never a second query.
    applies: rows.filter(r => r.state !== 'exempt').length,
    outstanding: rows.filter(r => OUTSTANDING_STATES.includes(r.state)).length,
    assigned_open: rows.filter(r => r.assignment).length,
  };
}

/** The roster: one line per person, so somebody can pick who to look at. */
export function trainingRoster(db, opts = {}) {
  const snap = trainingSnapshot(db, opts);
  return snap.users.map(u => {
    const counts = { missing: 0, overdue: 0, due_soon: 0, outdated: 0, current: 0, exempt: 0 };
    let applies = 0, assignedOpen = 0;
    for (const c of snap.courses) {
      const cell = cellFor(u, c, snap);
      if (!cell) continue;
      if (counts[cell.state] !== undefined) counts[cell.state]++;
      if (cell.state !== 'exempt') applies++;
      if (cell.assignment) assignedOpen++;
    }
    return {
      ...u, counts, applies, assigned_open: assignedOpen,
      outstanding: OUTSTANDING_STATES.reduce((n, s) => n + counts[s], 0),
    };
  });
}
