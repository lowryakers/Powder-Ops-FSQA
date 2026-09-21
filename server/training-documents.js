// The controlled documents people are trained on, and which of them nothing
// trains on yet.
//
// A course has carried `sop_id` since the training module was built, and on
// this database NOT ONE OF THE TWENTY COURSES USES IT — including the seven
// whose code IS a work-instruction number. So "retrain everyone when WI007
// changes" was wired, tested and pointing at nothing: `retrain_on_doc_change`
// needs the link, and the link was never made. The courses and the register
// were two lists that never met.
//
// Two jobs here, and they are deliberately separate:
//   linkCoursesToDocuments — a one-time, evidence-based backfill for the case
//     where the course code IS the document number. Mechanical, reported,
//     never overwriting a link somebody set.
//   documentCoverage — every active SOP, Work Instruction and Job Description
//     with the course that trains on it, or nothing. That list is the punch
//     list; it is not a thing the app should fill in by itself.

import { parseList } from './training-assign.js';

// Document kinds people are TRAINED on. A form is filled in, not taught, and
// a reference (the SQF code, an NSF guideline) is somebody else's document.
export const TRAINABLE_TYPES = ['sop', 'work_instruction', 'job_description', 'policy'];

export const TYPE_LABEL = {
  sop: 'SOP',
  work_instruction: 'Work Instruction',
  job_description: 'Job Description',
  policy: 'Policy',
};

// A document number written two ways is one number: `WI007`, `WI 007` and
// `WI-007` are the same work instruction. Case and separators are all that is
// normalised — nothing is truncated and no prefix is inferred, because a link
// to the WRONG document would retrain the whole plant on the wrong revision.
export function normalizeDocNumber(v) {
  return String(v || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/**
 * Courses whose CODE is a document NUMBER already in the register, and which
 * therefore could be linked. PLANNED, NEVER APPLIED AT BOOT.
 *
 * A boot pass would be the seeder trap this codebase keeps unpicking: it only
 * looks at courses with no document, so deliberately clearing a wrong link
 * would be undone by the next deploy, and the correction would read as though
 * it never saved. So it is a strip on the coverage screen that names what it
 * would do — preview and commit share this planner, so what is on screen
 * cannot differ from what lands — and it renders nothing once there is
 * nothing left to link.
 *
 * Ambiguity is refused rather than guessed: two documents normalising to one
 * number is reported. A link to the WRONG document would retrain the plant
 * against the wrong revision.
 *
 * IT DOES NOT BACKFILL `training_records.sop_revision`, and must not. That
 * column records which revision a person was actually trained against; filling
 * it in from today's revision would be a fabricated record. Leaving it NULL
 * means linking a document does not retroactively declare anybody outdated —
 * the first-sight rule, same as `controlled.js` and the readiness steps.
 */
export function planCourseLinks(db) {
  const docs = db.prepare('SELECT id, doc_number, title, doc_type, status FROM sop_documents').all();
  const byNumber = new Map();
  for (const d of docs) {
    const key = normalizeDocNumber(d.doc_number);
    if (!key) continue;
    if (!byNumber.has(key)) byNumber.set(key, []);
    byNumber.get(key).push(d);
  }

  const links = [];
  const ambiguous = [];
  const courses = db.prepare("SELECT id, code, title FROM training_courses WHERE sop_id IS NULL AND code IS NOT NULL AND code != '' AND active = 1").all();
  for (const c of courses) {
    const hits = (byNumber.get(normalizeDocNumber(c.code)) || [])
      .filter(d => d.status === 'active' || d.status === 'under_review');
    if (hits.length === 0) continue;
    if (hits.length > 1) { ambiguous.push({ course_id: c.id, code: c.code, documents: hits.map(h => h.doc_number) }); continue; }
    links.push({
      course_id: c.id, code: c.code, course_title: c.title,
      sop_id: hits[0].id, doc_number: hits[0].doc_number, doc_title: hits[0].title,
      doc_type: hits[0].doc_type,
    });
  }
  return { links, ambiguous };
}

export function applyCourseLinks(db, ids = null) {
  const plan = planCourseLinks(db);
  const wanted = ids && ids.length ? plan.links.filter(l => ids.includes(l.course_id)) : plan.links;
  const set = db.prepare("UPDATE training_courses SET sop_id = ?, updated_at = datetime('now') WHERE id = ? AND sop_id IS NULL");
  const tx = db.transaction(() => { for (const l of wanted) set.run(l.sop_id, l.course_id); });
  tx();
  return { linked: wanted, ambiguous: plan.ambiguous };
}

/**
 * Every trainable document, and what trains on it.
 *
 * `suggested_positions` is the audience a JOB DESCRIPTION already has: the
 * org-chart positions that cite it. Nothing is applied from it — a suggestion
 * somebody confirms, because who a job description is for is a decision, and
 * an org chart with a stale link would otherwise assign training on its own.
 */
export function documentCoverage(db) {
  const docs = db.prepare(`
    SELECT id, doc_number, title, doc_type, category, revision, training_revision, status, effective_date
      FROM sop_documents
     WHERE status IN ('active', 'under_review') AND doc_type IN (${TRAINABLE_TYPES.map(() => '?').join(',')})
     ORDER BY doc_type, doc_number
  `).all(...TRAINABLE_TYPES);

  const courses = db.prepare('SELECT id, code, title, sop_id, active, required_roles, required_departments, required_positions FROM training_courses').all();
  const byDoc = new Map();
  for (const c of courses) {
    if (!c.sop_id) continue;
    if (!byDoc.has(c.sop_id)) byDoc.set(c.sop_id, []);
    byDoc.get(c.sop_id).push(c);
  }

  // Which positions cite each job description. `job_description_ids` is the
  // full set and `job_description_id` the mirror of its first entry (the
  // mo_lines rule), so the set is read with the scalar as a fallback for rows
  // written before that column existed.
  const citedBy = new Map();
  try {
    for (const p of db.prepare('SELECT id, title, name, department, user_id, job_description_id, job_description_ids FROM org_positions').all()) {
      const ids = parseList(p.job_description_ids);
      if (!ids.length && p.job_description_id) ids.push(p.job_description_id);
      for (const id of ids) {
        if (!citedBy.has(id)) citedBy.set(id, []);
        citedBy.get(id).push({ id: p.id, title: p.title, name: p.name, department: p.department, user_id: p.user_id });
      }
    }
  } catch { /* org chart not present */ }

  const rows = docs.map(d => {
    const linked = (byDoc.get(d.id) || []);
    const positions = citedBy.get(d.id) || [];
    return {
      ...d,
      type_label: TYPE_LABEL[d.doc_type] || 'Document',
      courses: linked.map(c => ({ id: c.id, code: c.code, title: c.title, active: !!c.active })),
      covered: linked.some(c => c.active),
      // Only a job description carries an audience of its own; for an SOP the
      // audience is a department or a role and is nobody's to guess.
      suggested_positions: d.doc_type === 'job_description' ? positions : [],
      // Named, because a job description citing no position trains nobody and
      // that is a gap in the ORG CHART, not in training.
      unheld: d.doc_type === 'job_description' && positions.length > 0 && positions.every(p => !p.user_id),
    };
  });

  const plan = planCourseLinks(db);

  return {
    documents: rows,
    // Derived on every read, so acting on it clears it. A stored to-do list
    // would go stale the moment somebody linked a course by hand.
    linkable: plan.links,
    ambiguous_links: plan.ambiguous,
    // Counted from the rows returned, never a second query.
    total: rows.length,
    covered: rows.filter(r => r.covered).length,
    uncovered: rows.filter(r => !r.covered).length,
    by_type: TRAINABLE_TYPES.map(t => ({
      doc_type: t, label: TYPE_LABEL[t],
      total: rows.filter(r => r.doc_type === t).length,
      uncovered: rows.filter(r => r.doc_type === t && !r.covered).length,
    })).filter(x => x.total > 0),
  };
}
