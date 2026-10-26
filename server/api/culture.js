// /api/culture — the food safety culture program (D-211).
//
// MOUNTED WITHOUT requireModuleWrite, deliberately (the AP Drop / QMS-filing
// arrangement): raising a concern is open to every person who works here,
// whatever modules they hold — a door that needs a grant is one the floor never
// finds. Everything else decides per route: reading all concerns, answering
// them and reading the month is for reviewers (`canReviewCulture`); filing the
// monthly check is for supervisors and admins. A guest account never reaches
// this router (EXTERNAL_ALLOWED) and is refused here as well.

import { Router } from 'express';
import { getDb } from '../db.js';
import {
  canReviewCulture, canFileCultureCheck, anonymousAllowed, setAnonymousAllowed,
  raiseConcern, respondConcern, fileCultureCheck, cultureSummary, concernView, CONCERN_STATUSES,
  cultureSchedules,
} from '../culture.js';
import { cultureCheckForm, CONCERN_CATEGORIES, CULTURE_DEPARTMENTS, cultureDepartmentLabel } from '../../shared/check-forms.js';
import { TASK_GROUPS } from '../../shared/task-groups.js';

const router = Router();

router.use((req, res, next) => {
  if (!req.user || req.user.is_external) return res.status(404).json({ error: 'Not found' });
  next();
});

const reviewerOnly = (req, res) => {
  if (canReviewCulture(req.user)) return true;
  res.status(403).json({ error: 'Only QA, Document Control, supervisors and admins read the concern log.' });
  return false;
};

// What the screens need to draw themselves — and what this person may do.
router.get('/meta', (req, res) => {
  res.json({
    categories: CONCERN_CATEGORIES,
    // The plant's own names first ("Sanitation", "Production"), then every
    // other team a concern can be about.
    departments: [
      ...CULTURE_DEPARTMENTS.map(d => ({ value: d.value, label: d.label })),
      ...TASK_GROUPS.filter(g => !cultureDepartmentLabel(g.value)),
    ],
    check_departments: CULTURE_DEPARTMENTS.map(d => ({ value: d.value, label: d.label })),
    check_schedules: canReviewCulture(req.user) ? cultureSchedules(getDb()) : [],
    anonymous_allowed: anonymousAllowed(getDb()),
    can_review: canReviewCulture(req.user),
    can_file_check: canFileCultureCheck(req.user),
    can_set_anonymous: req.user.role === 'admin',
    check_form: cultureCheckForm(null),
  });
});

router.post('/concerns', (req, res) => {
  const r = raiseConcern(getDb(), req.user, req.body || {});
  if (r.error) return res.status(r.status).json({ error: r.error });
  res.status(201).json({ id: r.id, anonymous: r.anonymous });
});

// A reviewer reads every concern; anybody else reads the ones they raised
// with their name on (an anonymous one cannot be found again, by design).
router.get('/concerns', (req, res) => {
  const db = getDb();
  const where = []; const params = [];
  if (!canReviewCulture(req.user)) { where.push('raised_by_id = ?'); params.push(req.user.id); }
  if (CONCERN_STATUSES.includes(req.query.status)) { where.push('status = ?'); params.push(req.query.status); }
  if (req.query.status === 'not_closed') where.push("status != 'closed'");
  if (/^\d{4}-\d{2}$/.test(String(req.query.month || ''))) { where.push('raised_on LIKE ?'); params.push(`${req.query.month}%`); }
  const rows = db.prepare(`SELECT * FROM culture_concerns ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY (status = 'closed'), raised_on DESC, created_at DESC LIMIT 500`).all(...params);
  res.json(rows.map(r => concernView(r, req.user)));
});

router.post('/concerns/:id/respond', (req, res) => {
  if (!reviewerOnly(req, res)) return;
  const r = respondConcern(getDb(), req.user, req.params.id, req.body || {});
  if (r.error) return res.status(r.status).json({ error: r.error });
  res.json(concernView(r.concern, req.user));
});

router.get('/summary', (req, res) => {
  if (!reviewerOnly(req, res)) return;
  res.json(cultureSummary(getDb(), req.query.month));
});

router.get('/checks', (req, res) => {
  if (!reviewerOnly(req, res)) return;
  const db = getDb();
  const m = /^\d{4}-\d{2}$/.test(String(req.query.month || '')) ? req.query.month : null;
  const rows = db.prepare(`SELECT * FROM culture_checks ${m ? 'WHERE checked_on LIKE ?' : ''} ORDER BY checked_on DESC, created_at DESC LIMIT 300`)
    .all(...(m ? [`${m}%`] : []));
  res.json(rows.map(r => ({ ...r, items: (() => { try { return JSON.parse(r.items); } catch { return []; } })() })));
});

router.post('/checks', (req, res) => {
  if (!canFileCultureCheck(req.user)) return res.status(403).json({ error: 'The monthly culture check is filed by a supervisor.' });
  const db = getDb();
  let out;
  db.transaction(() => { out = fileCultureCheck(db, req.user, req.body || {}, { source: 'page' }); })();
  if (out.error) return res.status(out.status).json({ error: out.error, missing: out.missing || [] });
  res.status(201).json(out);
});

router.put('/settings', (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Only an admin changes this.' });
  if (typeof req.body?.anonymous_allowed !== 'boolean') return res.status(400).json({ error: 'anonymous_allowed must be true or false.' });
  res.json({ anonymous_allowed: setAnonymousAllowed(getDb(), req.body.anonymous_allowed, req.user) });
});

export default router;
