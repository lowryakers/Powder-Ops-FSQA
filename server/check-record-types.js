// The check records on the record interface (single-spine move 02, D-369).
//
// Six kinds, six tables, ONE writer each — and none of them is new:
//   emp                     emp_samples              task completion (fileCheckRecord) · fileEmpSampleByHand
//   gmp_walk                gmp_walkthroughs         task completion only
//   banned_list_review      banned_list_reviews      task completion only
//   culture_check           culture_checks           task completion · fileCultureCheck (the page)
//   management_review       management_reviews       task completion · fileReviewByHand (fileAnnualReview)
//   food_defense_challenge  food_defense_challenges  task completion · fileReviewByHand (fileAnnualReview)
//
// NO CHECK RECORD CARRIES A SIGNATURE, so none of these types implements
// `sign` or `revoke` — the documented subset (`signs: false`). Inventing an
// approval here would be a second one. EMP's "resulted by" is the laboratory's
// result being entered, not a signature, and is described as such.
//
// A kind filed only by completing its task (the GMP walk, the list review) has
// no `file` either: the task is the door, and a second door would let the
// record exist with no task behind it. `filedBy` says where each comes from.
import { rowLimit } from './record-cap.js';
import { moduleLevel } from './module-access.js';
import { fileEmpSampleByHand, fileReviewByHand, canAct } from './api/check-records.js';
import { fileCultureCheck, canReviewCulture, canFileCultureCheck } from './culture.js';
import { EMP_ZONES } from '../shared/check-forms.js';

const sqlDate = (d) => /^\d{4}-\d{2}-\d{2}$/.test(String(d || '')) ? String(d) : null;
const parse = (s, fb) => { try { return s ? JSON.parse(s) : fb; } catch { return fb; } };
const CHECK_MODULES = ['quality-schedules', 'pm', 'coa', 'sanitation', 'calibration'];
const readsChecks = (u) => CHECK_MODULES.some(m => moduleLevel(u, m));

/**
 * One factory, the kinds differ only in table and columns. `at` is the day the
 * check was DONE, `by` who did it, `place` the column a "where" filter reads.
 */
function checkType({ type, label, table, at, by, place = null, filedBy, file = null, describe, modules = CHECK_MODULES, canReadAny = readsChecks, filters = [] }) {
  return {
    type, label, modules, filedBy, signs: false, canReadAny, filters,
    ...(file ? { file } : {}),
    get: (db, id) => db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id) || null,
    canRead: (user) => !!canReadAny(user),
    retrieve(db, q = {}, user = null) {
      if (user && !canReadAny(user)) return [];
      // Nothing here is signed, and no check record names a machine.
      if (q.signed === 'yes' || q.equipment) return [];
      if (q.place && !place) return [];
      const where = []; const params = [];
      const from = sqlDate(q.from); const to = sqlDate(q.to);
      if (from) { where.push(`substr(${at}, 1, 10) >= ?`); params.push(from); }
      if (to) { where.push(`substr(${at}, 1, 10) <= ?`); params.push(to); }
      if (q.person) { where.push(`lower(${by}) = lower(?)`); params.push(String(q.person).trim()); }
      if (q.place) { where.push(`lower(${place}) = lower(?)`); params.push(String(q.place).trim()); }
      if (q.site && type === 'emp') { where.push('lower(site) = lower(?)'); params.push(String(q.site).trim()); }
      const sql = `SELECT * FROM ${table} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY ${at} DESC, created_at DESC LIMIT ?`;
      return db.prepare(sql).all(...params, rowLimit(q));
    },
    describe: (r) => ({
      type, id: r.id, equipment_id: null, signed_by: null, signed_at: null, signatures: [],
      lot: null, site: null, revision: null, group: null,
      ...describe(r),
    }),
  };
}

// The three by-hand doors return { status, error } or { status, id, ... }.
const byHand = (fn) => (db, user, input = {}) => {
  const out = fn(db, user, input);
  return out.error ? out : { ...out, id: out.id };
};

export const CHECK_RECORD_TYPES = [
  checkType({
    type: 'emp', label: 'Environmental monitoring samples (FORM 604-01)',
    table: 'emp_samples', at: 'sampled_on', by: 'sampled_by', place: 'zone',
    filedBy: ['task', 'by hand'], filters: ['site'],
    file: byHand((db, user, input) => fileEmpSampleByHand(db, user, input)),
    describe: (r) => ({
      form: r.form_revision || 'FORM 604-01',
      revision: (r.form_revision || '').split(' ').pop() || null,
      title: `${r.test} — ${r.site}`,
      place: EMP_ZONES[r.zone]?.label || r.zone,
      site: r.site,
      performed_by: r.sampled_by, performed_at: r.sampled_on,
      result: r.outcome,
      result_value: r.result_value || null, resulted_by: r.resulted_by || null, resulted_on: r.resulted_on || null,
      capa_id: r.capa_id || null,
      group: r.zone,
      link: { tab: 'quality-schedules', view: 'emp', id: r.id },
    }),
  }),
  checkType({
    type: 'gmp_walk', label: 'GMP walk-throughs',
    table: 'gmp_walkthroughs', at: 'walked_on', by: 'walked_by', place: 'area',
    filedBy: ['task'],
    describe: (r) => ({
      form: `GMP walk-through ${r.checklist_revision || ''}`.trim(), revision: r.checklist_revision || null,
      title: `GMP walk-through — ${r.area || 'area not given'}`,
      place: r.area || null,
      performed_by: r.walked_by, performed_at: r.walked_on,
      result: r.nc_count ? `${r.nc_count} not compliant` : 'compliant',
      capa_ids: parse(r.capa_ids, []),
      link: { tab: 'quality-schedules', view: 'gmp-walks', id: r.id },
    }),
  }),
  checkType({
    type: 'banned_list_review', label: 'Banned / prohibited substance list reviews',
    table: 'banned_list_reviews', at: 'reviewed_on', by: 'reviewed_by',
    filedBy: ['task'],
    describe: (r) => ({
      form: 'Banned-list review', title: 'Banned / prohibited substance list review',
      place: null,
      performed_by: r.reviewed_by, performed_at: r.reviewed_on,
      // `changes_found` is what the reviewer wrote; "none" is an answer, not a change.
      result: /^\s*(none|no|no changes|n\/?a)?\s*\.?\s*$/i.test(r.changes_found || '') ? 'no changes' : `changes: ${r.changes_found}`,
      editions: parse(r.editions, {}),
      link: { tab: 'quality-schedules', view: 'list-reviews', id: r.id },
    }),
  }),
  checkType({
    type: 'culture_check', label: 'Monthly food safety culture checks',
    table: 'culture_checks', at: 'checked_on', by: 'checked_by', place: 'department',
    filedBy: ['task', 'page'],
    // The concern log's readers read the checks (api/culture.js reviewerOnly).
    modules: ['food-safety-culture'], canReadAny: (u) => canReviewCulture(u),
    file(db, user, input = {}) {
      if (!canFileCultureCheck(user)) return { status: 403, error: 'The monthly culture check is filed by a supervisor.' };
      let out;
      db.transaction(() => { out = fileCultureCheck(db, user, input, { source: 'page' }); })();
      return out.error ? out : { ...out, status: 201 };
    },
    describe: (r) => ({
      form: `Culture check ${r.checklist_revision || ''}`.trim(), revision: r.checklist_revision || null,
      title: `Culture check — ${r.department}`,
      place: r.department,
      performed_by: r.checked_by, performed_at: r.checked_on,
      result: r.nc_count ? `${r.nc_count} not compliant` : 'compliant',
      group: r.department,
      link: { tab: 'food-safety-culture', id: r.id },
    }),
  }),
  checkType({
    type: 'management_review', label: 'Management reviews (SQF 2.1.2.1)',
    table: 'management_reviews', at: 'reviewed_on', by: 'reviewed_by',
    filedBy: ['task', 'by hand'],
    file: byHand((db, user, input) => fileReviewByHand(db, user, 'management_review', input)),
    describe: (r) => ({
      form: `${r.clause || 'SQF Code 2.1.2.1'} · ${r.revision || 'DRAFT-1'}`, revision: r.revision || null,
      title: 'Management review', place: null,
      performed_by: r.reviewed_by, performed_at: r.reviewed_on,
      result: r.na_count ? `reviewed, ${r.na_count} not applicable` : 'reviewed',
      source: r.source || null,
      link: { tab: 'quality-schedules', view: 'management-review', id: r.id },
    }),
  }),
  checkType({
    type: 'food_defense_challenge', label: 'Food Defense annual challenges (SOP 434)',
    table: 'food_defense_challenges', at: 'performed_on', by: 'performed_by',
    filedBy: ['task', 'by hand'],
    file: byHand((db, user, input) => fileReviewByHand(db, user, 'food_defense_challenge', input)),
    describe: (r) => ({
      form: r.sop_revision || 'SOP 434', revision: (r.sop_revision || '').split(' ').pop() || null,
      title: 'Food Defense challenge', place: null,
      performed_by: r.performed_by, performed_at: r.performed_on,
      result: r.outcome || null,
      source: r.source || null,
      link: { tab: 'quality-schedules', view: 'food-defense', id: r.id },
    }),
  }),
];

export { canAct as canActOnChecks };
