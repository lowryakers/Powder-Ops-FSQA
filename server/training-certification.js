// "Is this person certified to drive the forklift?" — DERIVED on every read,
// never stored.
//
// THIS IS THE WHOLE POINT OF THE PRACTICAL EVALUATION. 29 CFR 1910.178(l)(6)
// says the employer shall certify that each operator has been trained AND
// evaluated, and names the four facts the certification must carry: the
// operator's name, the date of the training, the date of the evaluation, and
// who performed the training or the evaluation. So certification is not a
// fifth record somebody files — it is what those two records already say,
// read together, and a stored "certified" flag would go stale the day either
// half expired. Same doctrine as product readiness, the mock-recall verdict
// and the starter checks: computed from the records, so it cannot disagree
// with them.
//
// THE CLOCK RUNS FROM THE EVALUATION. 1910.178(l)(4)(iii) requires the
// operator's PERFORMANCE to be evaluated at least once every three years —
// the written half is not what the three years attaches to. Both dates are
// reported and the EARLIER expiry governs, because being current needs both.

import { evaluationFor } from './practical-evaluations.js';
import { addMonths } from './training-records.js';

const today = () => new Date().toISOString().slice(0, 10);

/**
 * Match a person the way every other name-keyed read here does: on the account
 * where there is one, on the name otherwise (D-074's `personMatch` rule). A
 * certification found under one spelling and missed under the other is how
 * somebody ends up re-taking a test they passed last year.
 */
function personClause(alias, userId) {
  return userId
    ? `(${alias}.employee_user_id = ? OR LOWER(${alias}.employee_name) = LOWER(?))`
    : `LOWER(${alias}.employee_name) = LOWER(?)`;
}
const personArgs = (userId, name) => (userId ? [userId, name] : [name]);

/**
 * What a course and a person add up to.
 *
 * Returns null for a course with no practical evaluation defined — most
 * courses are a completion and nothing more, and reporting them as
 * "uncertified" would be a warning about work nobody owes.
 */
export function certificationFor(db, course, { employee_name, employee_user_id = null }) {
  const form = evaluationFor(course?.code);
  if (!form) return null;
  const name = String(employee_name || '').trim();
  if (!name) return null;

  const trained = db.prepare(`SELECT * FROM training_records
    WHERE course_id = ? AND COALESCE(superseded, 0) = 0
      AND status = 'completed' AND COALESCE(passed, 1) = 1
      AND ${personClause('training_records', employee_user_id)}
    ORDER BY COALESCE(completion_date, training_date) DESC LIMIT 1`)
    .get(course.id, ...personArgs(employee_user_id, name)) || null;

  // Only a SIGNED evaluation counts. An unsigned one is somebody part-way
  // through filling a form in, and certifying off it would be certifying off
  // a draft — the same line the NFP link and the internal audit both draw.
  const evaluated = (() => {
    try {
      return db.prepare(`SELECT * FROM training_practical_evaluations
        WHERE course_id = ? AND result = 'pass' AND signed_at IS NOT NULL
          AND ${personClause('training_practical_evaluations', employee_user_id)}
        ORDER BY evaluated_on DESC LIMIT 1`)
        .get(course.id, ...personArgs(employee_user_id, name)) || null;
    } catch { return null; }
  })();

  const trainedOn = trained ? (trained.completion_date || trained.training_date) : null;
  const evaluatedOn = evaluated?.evaluated_on || null;
  const months = course.retrain_months || null;

  // Each half expires on its own clock; being current needs both, so the
  // earlier date is the one that matters.
  const trainingExpires = trained?.next_due_date || (months && trainedOn ? addMonths(trainedOn, months) : null);
  const evaluationExpires = months && evaluatedOn ? addMonths(evaluatedOn, months) : null;
  const expires = [trainingExpires, evaluationExpires].filter(Boolean).sort()[0] || null;

  const now = today();
  const gaps = [];
  if (!trained) gaps.push('No passed written test on file');
  else if (trainingExpires && trainingExpires < now) gaps.push(`The written test expired ${trainingExpires}`);
  if (!evaluated) gaps.push('No signed practical evaluation on file');
  else if (evaluationExpires && evaluationExpires < now) gaps.push(`The practical evaluation expired ${evaluationExpires}`);

  return {
    course_id: course.id, course_code: course.code, course_title: course.title,
    employee_name: name, employee_user_id: employee_user_id || null,
    certified: gaps.length === 0,
    // Somebody is certified from the moment the SECOND half lands, not the
    // first — which is exactly the thing the old one-part course could not say.
    certified_on: gaps.length === 0 ? [trainedOn, evaluatedOn].filter(Boolean).sort().slice(-1)[0] : null,
    expires_on: gaps.length === 0 ? expires : null,
    expiring_soon: gaps.length === 0 && expires ? expires <= addMonths(now, 2) : false,
    // The four facts 1910.178(l)(6) names, resolved here so the certificate,
    // the screen and the API cannot each work them out differently.
    trained_on: trainedOn,
    trained_by: trained?.trainer || (trained?.method === 'online_test' ? 'ReadyDoc online test' : null) || null,
    training_score: trained?.score ?? null,
    evaluated_on: evaluatedOn,
    evaluated_by: evaluated?.evaluator_name || null,
    truck_type: evaluated?.truck_type || null,
    evaluation_id: evaluated?.id || null,
    evaluation_revision: evaluated?.form_revision || null,
    not_evaluated: (() => { try { return JSON.parse(evaluated?.not_evaluated || '[]'); } catch { return []; } })(),
    gaps,
  };
}

/**
 * Everyone this course has any record for, certified or not.
 *
 * THE UNCERTIFIED ROWS ARE THE POINT. A list of the certified answers "who may
 * drive", and only the full list answers "who has done half of it" — which on
 * the day this shipped is every operator who has ever passed the written quiz,
 * because the evaluation had nowhere to go. That is the finding, not noise:
 * each one names the paper evaluation somebody has to file.
 */
export function certificationRoster(db, course) {
  if (!evaluationFor(course?.code)) return [];
  const people = new Map();
  const add = (name, userId) => {
    if (!name) return;
    const key = String(name).toLowerCase();
    const prev = people.get(key);
    if (!prev || (!prev.employee_user_id && userId)) people.set(key, { employee_name: name, employee_user_id: userId || prev?.employee_user_id || null });
  };
  for (const r of db.prepare(`SELECT employee_name, employee_user_id FROM training_records WHERE course_id = ?`).all(course.id)) {
    add(r.employee_name, r.employee_user_id);
  }
  try {
    for (const r of db.prepare(`SELECT employee_name, employee_user_id FROM training_practical_evaluations WHERE course_id = ?`).all(course.id)) {
      add(r.employee_name, r.employee_user_id);
    }
  } catch { /* table may not exist on an older database */ }
  return [...people.values()]
    .map(p => certificationFor(db, course, p))
    .filter(Boolean)
    .sort((a, b) => Number(b.certified) - Number(a.certified) || a.employee_name.localeCompare(b.employee_name));
}
