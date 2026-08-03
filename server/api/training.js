import { Router } from 'express';
import { createReadStream } from 'fs';
import { v4 as uuid } from 'uuid';
import { getDb, logAudit } from '../db.js';
import { aiEnabled, generateTestQuestions } from '../ai.js';
import { storageEnabled, putStream, presignGet, deleteObject } from '../storage.js';
import { mediaUpload, rejectOversize, cleanupTemp, uploadErrorMessage, isVideo } from '../media.js';
import multer from 'multer';
import { parseTrainingLog } from '../training-log.js';

const router = Router();

// ── helpers ───────────────────────────────────────────────────────────────
function parseJson(raw, fallback) { if (!raw) return fallback; try { return JSON.parse(raw); } catch { return fallback; } }

const addMonths = (isoDate, months) => {
  if (!isoDate || !months) return null;
  const d = new Date(isoDate + (isoDate.length <= 10 ? 'T00:00:00' : ''));
  if (Number.isNaN(d.getTime())) return null;
  d.setMonth(d.getMonth() + months);
  return d.toISOString().slice(0, 10);
};

// Compute a completion's retraining due date from the course cadence.
function dueDateFor(db, courseId, completionDate) {
  if (!courseId || !completionDate) return null;
  const c = db.prepare('SELECT retrain_months FROM training_courses WHERE id = ?').get(courseId);
  if (!c || !c.retrain_months) return null;
  return addMonths(completionDate, c.retrain_months);
}

// A course applies to a user when its role/dept lists are empty (all staff) or
// the user's role/department is listed — unless an explicit exempt override exists.
function courseAppliesToUser(course, user) {
  const roles = parseJson(course.required_roles, []);
  const depts = parseJson(course.required_departments, []);
  if (roles.length === 0 && depts.length === 0) return true;
  return roles.includes(user.role) || depts.includes(user.department);
}

// ── COURSES ─────────────────────────────────────────────────────────────────
router.get('/courses', (req, res) => {
  const db = getDb();
  const rows = db.prepare(`
    SELECT c.*, sd.title AS sop_title, sd.doc_number AS sop_number, sd.revision AS sop_revision,
      sd.training_revision AS sop_training_revision,
      (SELECT COUNT(*) FROM training_tests t WHERE t.course_id = c.id AND t.is_current = 1) AS has_current_test,
      (SELECT t.sop_revision FROM training_tests t WHERE t.course_id = c.id AND t.is_current = 1) AS test_sop_revision
    FROM training_courses c
    LEFT JOIN sop_documents sd ON c.sop_id = sd.id
    ORDER BY c.active DESC, c.category, c.title
  `).all();
  res.json(rows.map(r => ({
    ...r,
    required_roles: parseJson(r.required_roles, []),
    required_departments: parseJson(r.required_departments, []),
    // The current test was written against an older document revision.
    sop_test_stale: !!(r.sop_id && r.has_current_test && r.sop_training_revision && r.test_sop_revision && r.test_sop_revision !== r.sop_training_revision),
  })));
});

router.post('/courses', (req, res) => {
  const db = getDb();
  const { code, title, category, description, sop_id, retrain_months, required_roles, required_departments, has_test, passing_score, active, retrain_on_doc_change } = req.body;
  if (!title) return res.status(400).json({ error: 'title is required' });
  const id = uuid();
  db.prepare(`INSERT INTO training_courses
    (id, code, title, category, description, sop_id, retrain_months, required_roles, required_departments, has_test, passing_score, active, retrain_on_doc_change)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    id, code || null, title, category || 'GMP', description || null, sop_id || null,
    retrain_months || null, JSON.stringify(required_roles || []), JSON.stringify(required_departments || []),
    has_test ? 1 : 0, passing_score ?? 80, active === undefined ? 1 : (active ? 1 : 0),
    retrain_on_doc_change === undefined ? 1 : (retrain_on_doc_change ? 1 : 0));
  logAudit(req.user, 'training_course_created', 'training_course', id, { title }, null, null, title);
  res.status(201).json(db.prepare('SELECT * FROM training_courses WHERE id = ?').get(id));
});

router.put('/courses/:id', (req, res) => {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM training_courses WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Not found' });
  const b = req.body;
  db.prepare(`UPDATE training_courses SET code=?, title=?, category=?, description=?, sop_id=?, retrain_months=?,
    required_roles=?, required_departments=?, has_test=?, passing_score=?, active=?, retrain_on_doc_change=?, updated_at=datetime('now') WHERE id=?`).run(
    b.code ?? existing.code, b.title || existing.title, b.category || existing.category, b.description ?? existing.description,
    b.sop_id !== undefined ? (b.sop_id || null) : existing.sop_id, b.retrain_months !== undefined ? (b.retrain_months || null) : existing.retrain_months,
    b.required_roles !== undefined ? JSON.stringify(b.required_roles) : existing.required_roles,
    b.required_departments !== undefined ? JSON.stringify(b.required_departments) : existing.required_departments,
    b.has_test !== undefined ? (b.has_test ? 1 : 0) : existing.has_test,
    b.passing_score ?? existing.passing_score,
    b.active !== undefined ? (b.active ? 1 : 0) : existing.active,
    b.retrain_on_doc_change !== undefined ? (b.retrain_on_doc_change ? 1 : 0) : existing.retrain_on_doc_change, req.params.id);
  logAudit(req.user, 'training_course_updated', 'training_course', req.params.id, { title: b.title || existing.title }, null, null, b.title || existing.title);
  res.json(db.prepare('SELECT * FROM training_courses WHERE id = ?').get(req.params.id));
});

// ── COMPLETIONS (training_records) ───────────────────────────────────────────
router.get('/', (req, res) => {
  const db = getDb();
  const { employee, status, course_id, sop_id } = req.query;
  let sql = `SELECT tr.*, c.title AS course_title, c.code AS course_code, sd.title AS sop_title
    FROM training_records tr
    LEFT JOIN training_courses c ON tr.course_id = c.id
    LEFT JOIN sop_documents sd ON tr.sop_id = sd.id WHERE 1=1`;
  const params = [];
  if (employee) { sql += ' AND tr.employee_name LIKE ?'; params.push(`%${employee}%`); }
  if (status) { sql += ' AND tr.status = ?'; params.push(status); }
  if (course_id) { sql += ' AND tr.course_id = ?'; params.push(course_id); }
  if (sop_id) { sql += ' AND tr.sop_id = ?'; params.push(sop_id); }
  sql += ' ORDER BY tr.training_date DESC';
  res.json(db.prepare(sql).all(...params));
});

// Mark any earlier completions of the same course by the same person superseded,
// so the matrix reflects the most recent completion per person+course.
function supersedeOlder(db, employeeName, courseId, keepId) {
  if (!courseId) return;
  db.prepare(`UPDATE training_records SET superseded = 1
    WHERE id != ? AND course_id = ? AND LOWER(employee_name) = LOWER(?)`).run(keepId, courseId, employeeName);
}

// The revision of a course's linked document that current training must reflect.
function courseTrainingRevision(db, courseId) {
  if (!courseId) return null;
  const c = db.prepare('SELECT sop_id FROM training_courses WHERE id = ?').get(courseId);
  if (!c?.sop_id) return null;
  const d = db.prepare('SELECT training_revision, revision FROM sop_documents WHERE id = ?').get(c.sop_id);
  return d?.training_revision || d?.revision || null;
}

function insertCompletion(db, body) {
  const id = uuid();
  const completion = body.completion_date || (body.status === 'completed' ? (body.training_date || new Date().toISOString().slice(0, 10)) : null);
  const next_due = dueDateFor(db, body.course_id, completion);
  // Stamp the document revision this completion was trained against.
  const sopRevision = body.sop_revision || courseTrainingRevision(db, body.course_id);
  db.prepare(`INSERT INTO training_records
    (id, employee_name, employee_id, employee_user_id, training_topic, course_id, sop_id, trainer, method,
     training_date, completion_date, status, passed, score, next_due_date, certificate_url, document_url, gdrive_url, test_attempt_id, notes, sop_revision)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    id, body.employee_name, body.employee_id || null, body.employee_user_id || null,
    body.training_topic || body.course_title || '', body.course_id || null, body.sop_id || null,
    body.trainer || null, body.method || null,
    body.training_date || new Date().toISOString().slice(0, 10), completion,
    body.status || (completion ? 'completed' : 'scheduled'),
    body.passed === undefined ? null : (body.passed ? 1 : 0), body.score ?? null, next_due,
    body.certificate_url || null, body.document_url || null, body.gdrive_url || null, body.test_attempt_id || null, body.notes || null, sopRevision);
  if (body.status === 'completed' || completion) supersedeOlder(db, body.employee_name, body.course_id, id);
  return db.prepare('SELECT * FROM training_records WHERE id = ?').get(id);
}

router.post('/', (req, res) => {
  const db = getDb();
  if (!req.body.employee_name || (!req.body.training_topic && !req.body.course_id)) {
    return res.status(400).json({ error: 'employee_name and a course (or topic) are required' });
  }
  const rec = insertCompletion(db, req.body);
  logAudit(req.user, 'training_created', 'training', rec.id, { employee_name: rec.employee_name, course_id: rec.course_id }, null, null, rec.employee_name);
  res.status(201).json(rec);
});

// Record a small-group training + test in one shot: one completion per attendee.
router.post('/bulk-complete', (req, res) => {
  const db = getDb();
  const { course_id, training_date, completion_date, trainer, method, attendees } = req.body;
  if (!course_id || !Array.isArray(attendees) || attendees.length === 0) {
    return res.status(400).json({ error: 'course_id and at least one attendee are required' });
  }
  const course = db.prepare('SELECT title, passing_score FROM training_courses WHERE id = ?').get(course_id);
  if (!course) return res.status(404).json({ error: 'Course not found' });
  const pass = course.passing_score ?? 80;
  const completion = completion_date || training_date || new Date().toISOString().slice(0, 10);

  let created = 0;
  const tx = db.transaction(() => {
    for (const a of attendees) {
      const name = (a.employee_name || '').trim();
      if (!name) continue;
      const score = a.score === '' || a.score === undefined || a.score === null ? null : Number(a.score);
      insertCompletion(db, {
        employee_name: name, employee_user_id: a.employee_user_id || null,
        course_id, course_title: course.title, status: 'completed',
        method: method || 'in_person', trainer: trainer || null,
        training_date: training_date || completion, completion_date: completion,
        score, passed: score == null ? true : score >= pass,
      });
      created++;
    }
  });
  tx();
  logAudit(req.user, 'training_group_completed', 'training', null, { course_id, count: created }, null, null, course.title);
  res.json({ created });
});

router.put('/:id', (req, res) => {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM training_records WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Not found' });
  const b = req.body;
  const course_id = b.course_id !== undefined ? b.course_id : existing.course_id;
  const completion = b.completion_date !== undefined ? b.completion_date : existing.completion_date;
  const next_due = dueDateFor(db, course_id, completion) ?? existing.next_due_date;
  db.prepare(`UPDATE training_records SET employee_name=?, employee_id=?, employee_user_id=?, training_topic=?, course_id=?, sop_id=?,
    trainer=?, method=?, training_date=?, completion_date=?, status=?, passed=?, score=?, next_due_date=?,
    certificate_url=?, document_url=?, gdrive_url=?, notes=?, updated_at=datetime('now') WHERE id=?`).run(
    b.employee_name || existing.employee_name, b.employee_id ?? existing.employee_id, b.employee_user_id ?? existing.employee_user_id,
    b.training_topic ?? existing.training_topic, course_id, b.sop_id ?? existing.sop_id,
    b.trainer ?? existing.trainer, b.method ?? existing.method,
    b.training_date || existing.training_date, completion, b.status || existing.status,
    b.passed !== undefined ? (b.passed ? 1 : 0) : existing.passed, b.score ?? existing.score, next_due,
    b.certificate_url ?? existing.certificate_url, b.document_url ?? existing.document_url,
    b.gdrive_url ?? existing.gdrive_url, b.notes ?? existing.notes, req.params.id);
  if ((b.status || existing.status) === 'completed') supersedeOlder(db, b.employee_name || existing.employee_name, course_id, req.params.id);
  logAudit(req.user, 'training_updated', 'training', req.params.id, { employee_name: b.employee_name || existing.employee_name }, null, null, b.employee_name || existing.employee_name);
  res.json(db.prepare('SELECT * FROM training_records WHERE id = ?').get(req.params.id));
});

// ── REQUIREMENT MATRIX ───────────────────────────────────────────────────────
// For each active employee × applicable course: current completion + due state.
router.get('/matrix', (_req, res) => {
  const db = getDb();
  const users = db.prepare("SELECT id, name, role, department FROM users WHERE is_active = 1 ORDER BY name").all();
  const courses = db.prepare('SELECT * FROM training_courses WHERE active = 1 ORDER BY category, title').all();
  const overrides = db.prepare('SELECT * FROM training_requirements').all();
  const records = db.prepare(`SELECT * FROM training_records WHERE superseded = 0 AND status = 'completed'`).all();
  const today = new Date().toISOString().slice(0, 10);
  const soon = addMonths(today, 1);

  // Current training-revision for each course's linked document.
  const docRev = {};
  for (const d of db.prepare('SELECT id, training_revision, revision FROM sop_documents').all()) docRev[d.id] = d.training_revision || d.revision || null;

  const ovBy = (courseId, userId) => overrides.find(o => o.course_id === courseId && o.user_id === userId);
  const cell = (user, course) => {
    const ov = ovBy(course.id, user.id);
    if (ov?.rule === 'exempt') return { state: 'exempt' };
    const required = ov?.rule === 'required' || courseAppliesToUser(course, user);
    if (!required) return null;
    const rec = records.find(r =>
      r.course_id === course.id &&
      (r.employee_user_id === user.id || r.employee_name?.toLowerCase() === user.name.toLowerCase()));
    if (!rec) return { state: 'missing' };
    // The linked document changed materially since this person trained.
    const needRev = course.sop_id ? docRev[course.sop_id] : null;
    const docOutdated = course.retrain_on_doc_change && course.sop_id && rec.sop_revision && needRev && rec.sop_revision !== needRev;
    let state = 'current';
    if (rec.next_due_date && rec.next_due_date < today) state = 'overdue';
    else if (docOutdated) state = 'outdated';
    else if (rec.next_due_date && rec.next_due_date <= soon) state = 'due_soon';
    return { state, completion_date: rec.completion_date, next_due_date: rec.next_due_date, record_id: rec.id, score: rec.score, passed: rec.passed, sop_revision: rec.sop_revision, current_revision: needRev };
  };

  const matrix = {};
  const counts = { missing: 0, overdue: 0, due_soon: 0, current: 0, outdated: 0 };
  for (const u of users) {
    matrix[u.id] = { user: { id: u.id, name: u.name, role: u.role, department: u.department }, cells: {} };
    for (const c of courses) {
      const res2 = cell(u, c);
      matrix[u.id].cells[c.id] = res2;
      if (res2 && counts[res2.state] !== undefined) counts[res2.state]++;
    }
  }
  res.json({
    courses: courses.map(c => ({ id: c.id, code: c.code, title: c.title, category: c.category, retrain_months: c.retrain_months })),
    users: users.map(u => ({ id: u.id, name: u.name, role: u.role, department: u.department })),
    matrix, counts,
  });
});

// Flat list of due/overdue retraining, for the reminders view + dashboard.
router.get('/due', (_req, res) => {
  const db = getDb();
  const today = new Date().toISOString().slice(0, 10);
  const soon = addMonths(today, 1);
  const rows = db.prepare(`
    SELECT tr.id, tr.employee_name, tr.next_due_date, tr.completion_date, c.title AS course_title, c.code AS course_code
    FROM training_records tr JOIN training_courses c ON tr.course_id = c.id
    WHERE tr.superseded = 0 AND tr.status = 'completed' AND tr.next_due_date IS NOT NULL AND tr.next_due_date <= ?
    ORDER BY tr.next_due_date ASC`).all(soon);
  res.json(rows.map(r => ({ ...r, overdue: r.next_due_date < today })));
});

// ── DOCUMENT LINKAGE ──────────────────────────────────────────────────────────
// "What changed since you last trained." Release-notes feed for a course's linked
// document — versions newer than `since` (a revision), or the trainee's last
// completion via `record_id`. Marks minor edits so the UI can de-emphasize them.
router.get('/courses/:id/changes', (req, res) => {
  const db = getDb();
  const course = db.prepare('SELECT * FROM training_courses WHERE id = ?').get(req.params.id);
  if (!course) return res.status(404).json({ error: 'Course not found' });
  if (!course.sop_id) return res.json({ changes: [], current_revision: null });

  const doc = db.prepare('SELECT training_revision, revision, title, doc_number FROM sop_documents WHERE id = ?').get(course.sop_id);
  const current = doc?.training_revision || doc?.revision || null;

  let since = req.query.since || null;
  if (!since && req.query.record_id) {
    const rec = db.prepare('SELECT sop_revision FROM training_records WHERE id = ?').get(req.query.record_id);
    since = rec?.sop_revision || null;
  }

  const versions = db.prepare('SELECT revision, change_summary, changed_by, created_at, minor FROM sop_versions WHERE sop_id = ? ORDER BY created_at ASC').all(course.sop_id);
  let list = versions;
  if (since) {
    let sinceAt = null;
    for (const v of versions) if (v.revision === since) sinceAt = v.created_at;
    list = sinceAt ? versions.filter(v => v.created_at > sinceAt) : versions;
  }
  const changes = list.slice().reverse().map(v => ({ revision: v.revision, summary: v.change_summary, by: v.changed_by, at: v.created_at, minor: !!v.minor }));
  res.json({
    document: { title: doc?.title, doc_number: doc?.doc_number },
    current_revision: current, since,
    up_to_date: since ? since === current : null,
    changes,
  });
});

// Reverse link: which trainings depend on a document (for the Document Registry,
// so an author knows a material edit will trigger retraining).
router.get('/by-document/:sopId', (req, res) => {
  const db = getDb();
  const courses = db.prepare('SELECT id, code, title, retrain_on_doc_change FROM training_courses WHERE sop_id = ? AND active = 1 ORDER BY title').all(req.params.sopId);
  const completions = db.prepare(`SELECT COUNT(DISTINCT tr.id) c FROM training_records tr JOIN training_courses c ON tr.course_id = c.id
    WHERE c.sop_id = ? AND c.retrain_on_doc_change = 1 AND tr.superseded = 0 AND tr.status = 'completed'`).get(req.params.sopId).c;
  res.json({ courses, count: courses.length, completions });
});

// ── TESTS ────────────────────────────────────────────────────────────────────
// Current test + questions for a course (correct answers withheld unless authoring).
router.get('/courses/:id/test', (req, res) => {
  const db = getDb();
  const test = db.prepare('SELECT * FROM training_tests WHERE course_id = ? AND is_current = 1').get(req.params.id);
  if (!test) return res.status(404).json({ error: 'No test for this course' });
  const authoring = req.query.authoring === '1' && (req.user?.role === 'admin' || req.user?.role === 'supervisor');
  const questions = db.prepare('SELECT * FROM training_questions WHERE test_id = ? ORDER BY position').all(test.id).map(q => ({
    id: q.id, position: q.position, type: q.type, prompt: q.prompt, points: q.points,
    options: parseJson(q.options, []),
    prompt_es: q.prompt_es || '', options_es: parseJson(q.options_es, []),
    ...(authoring ? { correct_answer: q.correct_answer } : {}),
  }));
  res.json({ ...test, questions });
});

// Author / replace a course's test as a new current version (keeps old attempts valid).
router.put('/courses/:id/test', (req, res) => {
  if (req.user?.role !== 'admin' && req.user?.role !== 'supervisor') return res.status(403).json({ error: 'Insufficient permissions' });
  const db = getDb();
  const course = db.prepare('SELECT * FROM training_courses WHERE id = ?').get(req.params.id);
  if (!course) return res.status(404).json({ error: 'Course not found' });
  const { title, passing_score, questions } = req.body;
  if (!Array.isArray(questions) || questions.length === 0) return res.status(400).json({ error: 'At least one question is required' });

  const prev = db.prepare('SELECT MAX(version) v FROM training_tests WHERE course_id = ?').get(req.params.id);
  const version = (prev?.v || 0) + 1;
  const testId = uuid();
  const sopRevision = courseTrainingRevision(db, req.params.id);
  const tx = db.transaction(() => {
    db.prepare('UPDATE training_tests SET is_current = 0 WHERE course_id = ?').run(req.params.id);
    db.prepare('INSERT INTO training_tests (id, course_id, version, title, passing_score, is_current, sop_revision) VALUES (?, ?, ?, ?, ?, 1, ?)')
      .run(testId, req.params.id, version, title || `${course.title} Test`, passing_score ?? course.passing_score, sopRevision);
    const insQ = db.prepare('INSERT INTO training_questions (id, test_id, position, type, prompt, prompt_es, options, options_es, correct_answer, points) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
    questions.forEach((q, i) => insQ.run(uuid(), testId, i, q.type || 'multiple_choice', q.prompt, q.prompt_es || null, JSON.stringify(q.options || []), JSON.stringify(q.options_es || []), String(q.correct_answer ?? ''), q.points ?? 1));
    db.prepare("UPDATE training_courses SET has_test = 1, updated_at = datetime('now') WHERE id = ?").run(req.params.id);
  });
  tx();
  logAudit(req.user, 'training_test_updated', 'training_course', req.params.id, { version }, null, null, course.title);
  res.json({ id: testId, version });
});

// AI-draft quiz questions for a course (admin/supervisor). Returns unsaved
// questions for the author to review/edit before publishing via PUT .../test.
router.post('/courses/:id/test/generate', async (req, res) => {
  if (req.user?.role !== 'admin' && req.user?.role !== 'supervisor') return res.status(403).json({ error: 'Insufficient permissions' });
  if (!aiEnabled()) return res.status(503).json({ error: 'AI features are not configured on this server.' });
  const db = getDb();
  const course = db.prepare('SELECT * FROM training_courses WHERE id = ?').get(req.params.id);
  if (!course) return res.status(404).json({ error: 'Course not found' });

  let sopText = '';
  if (course.sop_id) {
    const doc = db.prepare('SELECT description FROM sop_documents WHERE id = ?').get(course.sop_id);
    sopText = doc?.description || '';
  }
  try {
    const questions = await generateTestQuestions({ title: course.title, description: course.description, sopText, count: req.body?.count });
    if (!questions.length) return res.status(502).json({ error: 'The model did not return any usable questions. Try again.' });
    logAudit(req.user, 'training_test_generated', 'training_course', req.params.id, { count: questions.length, model: 'ai' }, null, null, course.title);
    res.json({ questions });
  } catch (e) {
    res.status(502).json({ error: e.message || 'AI generation failed' });
  }
});

// Submit a test attempt: auto-grade, and on pass record a completion.
router.post('/courses/:id/test/attempt', (req, res) => {
  const db = getDb();
  const course = db.prepare('SELECT * FROM training_courses WHERE id = ?').get(req.params.id);
  if (!course) return res.status(404).json({ error: 'Course not found' });
  const test = db.prepare('SELECT * FROM training_tests WHERE course_id = ? AND is_current = 1').get(req.params.id);
  if (!test) return res.status(404).json({ error: 'No test for this course' });
  const { employee_name, employee_user_id, answers } = req.body;
  if (!employee_name || !answers) return res.status(400).json({ error: 'employee_name and answers are required' });

  const questions = db.prepare('SELECT * FROM training_questions WHERE test_id = ?').all(test.id);
  let earned = 0, total = 0;
  for (const q of questions) {
    total += q.points;
    const given = answers[q.id];
    if (given === undefined || given === null) continue;
    const correct = String(q.correct_answer ?? '').trim().toLowerCase();
    if (q.type === 'short_answer') {
      // Keyword match: correct if the expected answer appears in the response.
      if (correct && String(given).trim().toLowerCase().includes(correct)) earned += q.points;
    } else if (String(given).trim().toLowerCase() === correct) {
      earned += q.points;
    }
  }
  const score = total ? Math.round((earned / total) * 100) : 0;
  const passed = score >= (test.passing_score ?? 80);

  const attemptId = uuid();
  db.prepare('INSERT INTO training_test_attempts (id, test_id, course_id, employee_name, employee_user_id, answers, score, passed) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(attemptId, test.id, req.params.id, employee_name, employee_user_id || null, JSON.stringify(answers), score, passed ? 1 : 0);

  let record = null;
  if (passed) {
    record = insertCompletion(db, {
      employee_name, employee_user_id, course_id: req.params.id, course_title: course.title,
      method: 'online_test', status: 'completed', passed: true, score,
      completion_date: new Date().toISOString().slice(0, 10), test_attempt_id: attemptId,
    });
    db.prepare('UPDATE training_test_attempts SET record_id = ? WHERE id = ?').run(record.id, attemptId);
  }
  logAudit(employee_name, 'training_test_attempt', 'training_course', req.params.id, { score, passed, via: req.user ? 'app' : 'kiosk' }, null, null, course.title);
  res.status(201).json({ attempt_id: attemptId, score, passed, passing_score: test.passing_score, record_id: record?.id || null });
});

// ── IMPORT (ELT) ─────────────────────────────────────────────────────────────
// Minimal RFC-4180 CSV parser (quoted fields, embedded commas/newlines).
function parseCsvRows(text) {
  const rows = []; let row = [], field = '', inQ = false;
  const s = String(text).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inQ) { if (ch === '"') { if (s[i + 1] === '"') { field += '"'; i++; } else inQ = false; } else field += ch; }
    else if (ch === '"') inQ = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else field += ch;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows.filter(r => r.some(c => c.trim()));
}

// Bulk-create completion records from a simple CSV. Flexible header matching so
// exported rosters from Drive load without hand-editing. Unmatched course names
// are kept as free-text topics (still importable), and can be linked later.
router.post('/import', (req, res) => {
  const db = getDb();
  const { csv } = req.body;
  if (!csv) return res.status(400).json({ error: 'csv is required' });
  const rows = parseCsvRows(csv);
  if (rows.length < 2) return res.status(400).json({ error: 'CSV has no data rows' });

  const norm = (s) => String(s || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
  const header = rows[0].map(norm);
  const col = (...names) => { for (const n of names) { const i = header.indexOf(norm(n)); if (i >= 0) return i; } return -1; };
  const idx = {
    employee: col('employee', 'employeename', 'name'),
    course: col('course', 'coursetitle', 'training', 'trainingtopic', 'topic'),
    date: col('date', 'completiondate', 'trainingdate', 'datecompleted'),
    trainer: col('trainer', 'instructor'),
    score: col('score', 'grade'),
    notes: col('notes', 'comments'),
  };
  if (idx.employee < 0) return res.status(400).json({ error: 'Could not find an Employee column' });

  const courses = db.prepare('SELECT id, title, code FROM training_courses').all();
  const matchCourse = (name) => {
    const n = norm(name);
    if (!n) return null;
    return courses.find(c => norm(c.title) === n || norm(c.code) === n)
        || courses.find(c => norm(c.title).includes(n) || n.includes(norm(c.title)))
        || null;
  };

  let imported = 0, linked = 0;
  const tx = db.transaction(() => {
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      const employee = (r[idx.employee] || '').trim();
      if (!employee) continue;
      const courseName = idx.course >= 0 ? (r[idx.course] || '').trim() : '';
      const matched = matchCourse(courseName);
      if (matched) linked++;
      const date = idx.date >= 0 ? (r[idx.date] || '').trim() : '';
      insertCompletion(db, {
        employee_name: employee,
        course_id: matched?.id || null,
        training_topic: courseName || matched?.title || 'Imported training',
        training_date: date || undefined,
        completion_date: date || undefined,
        status: 'completed', passed: true,
        method: 'external',
        trainer: idx.trainer >= 0 ? (r[idx.trainer] || '').trim() || null : null,
        score: idx.score >= 0 && r[idx.score] ? parseFloat(r[idx.score]) : null,
        notes: idx.notes >= 0 ? (r[idx.notes] || '').trim() || null : null,
      });
      imported++;
    }
  });
  tx();
  logAudit(req.user, 'training_imported', 'training', null, { imported, linked }, null, null);
  res.json({ imported, linked, unlinked: imported - linked });
});

// ── COURSE MATERIAL (videos, handouts) ───────────────────────────────────────
// Stored in R2, not on the data volume, and served through short-lived signed
// URLs issued only to an authenticated caller — same shape as chat attachments.
// Degrades like every other storage feature: with R2 unconfigured the list is
// empty and uploads answer 503 instead of failing halfway.
const materialUpload = mediaUpload({ files: 5 }).array('files', 5);
const uploadMaterials = (req, res, next) => materialUpload(req, res, (err) => {
  if (err) return res.status(413).json({ error: uploadErrorMessage(err) });
  next();
});

// ── Training Log import ─────────────────────────────────────────────────────
//
// The plant's Training Log spreadsheet is three and a half years of who did
// which training and when — a matrix, one sheet per period. Importing it is
// how the completion history gets in; the scanned paper tests are then
// EVIDENCE attached to records that already exist, rather than a few hundred
// files nobody can match to a course.
//
// Four steps on purpose, like every other importer here: analyze (read the
// file, propose a mapping), preview (dry run, nothing written), commit (one
// transaction). Nothing is written until someone has seen the numbers.
//
// The one human step that matters is the COURSE MAPPING. The log's headers
// drifted over three years — "Food Defense", "Food Defense (WI)", "Food
// Defense SOP" are one training — and only a person can say so. That's ~30
// decisions instead of 3,639.

const logUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });
const normName = (s) => String(s || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

// A person's name is written two ways in the log — "Vera, Yetzon" on one sheet
// and "Yetzon Vera" on the next — and the roster spells accents the log drops.
// Keying on the string as written left 92 of 94 people unmatched, and an
// unlinked completion doesn't answer "is this operator current", which is the
// whole reason to import three years of history.
//
// So a person's key is their name's WORDS, accent-folded and sorted. Sorting
// makes it order-independent, which beats deciding which side of a comma is
// the surname — a call that "Lopez Fernande, Estefany Maria" would get wrong.
function personKey(name) {
  return String(name || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\(.*?\)/g, ' ')          // "Vergara, Kimberly (?)" — the log author's own uncertainty
    .replace(/[^a-z0-9]+/g, ' ')
    .trim().split(' ').filter(Boolean).sort().join(' ');
}

// What goes on the record when there's no account to take the name from.
// One comma is "Surname, First" and reads better flipped; anything else is
// left as written rather than guessed at.
function displayName(name) {
  const s = String(name || '').replace(/\(.*?\)/g, ' ').replace(/\s+/g, ' ').trim().replace(/,+$/, '').trim();
  const parts = s.split(',').map(p => p.trim()).filter(Boolean);
  return parts.length === 2 ? `${parts[1]} ${parts[0]}` : s;
}

// Columns that record housekeeping rather than a training.
const ADMIN_COLUMNS = /^(training tests|training sign sheet|video links what was watched)$/i;

// Suggest a course for a log heading: exact title/code first, then the
// best-scoring word overlap, so "Sanitation SOP 108 (WI)" finds "Sanitation &
// SSOP". Only ever a suggestion — the reviewer confirms every one.
//
// Two things this has to get right, both learned from the real log:
//
//  1. **Short headings must still match.** Filtering words to length > 3 left
//     "GMP" with nothing to match on, so the one heading whose course is named
//     after it suggested nothing at all.
//  2. **Operating a machine and cleaning it are different trainings.** "Mixer"
//     overlaps "Cleaning the Hexagon Tumbler Mixer" and "Hexagon Tumbler Mixer
//     Operation" equally on words alone, and first-match-wins picked the
//     cleaning one. Someone accepting that suggestion would file 256 people as
//     trained to clean a machine they were trained to run.
const mentionsCleaning = (s) => /\bclean/.test(s);

// Plant vocabulary a general word match can't reach. Every heading and SOP here
// writes "cGMP"; the course is named "GMP". Keep this table tiny — it is local
// knowledge, not a second mapping system, and the mapping step is where real
// judgement belongs.
const SYNONYMS = { cgmp: 'gmp' };

function suggestCourse(heading, courses) {
  const h = normName(heading);
  if (!h) return null;
  const exact = courses.find(c => normName(c.title) === h || normName(c.code) === h);
  if (exact) return exact.id;

  const words = h.split(' ').filter(Boolean);
  let best = null, bestScore = 0;
  for (const c of courses) {
    const title = normName(c.title);
    // Whole words, never substrings. "Sanitation & SSOP" *contains* the letters
    // "sop", so every heading ending in "SOP 401" scored against Sanitation and
    // won on nothing but that accident.
    const vocab = new Set([...title.split(' '), ...normName(c.code).split(' ')]);
    let score = 0;
    for (const w of words) {
      if (w.length < 3) continue;              // "wi", "of" — noise, not evidence
      if (vocab.has(w) || vocab.has(SYNONYMS[w])) score += w.length >= 4 ? 2 : 1;
    }
    if (!score) continue;
    if (mentionsCleaning(title) !== mentionsCleaning(h)) score -= 3;
    if (score > bestScore) { bestScore = score; best = c; }
  }
  return bestScore > 0 ? best.id : null;
}

function analyzeBuffer(db, buffer) {
  const parsed = parseTrainingLog(buffer);
  // ORDER BY so a tie between two equally-plausible courses resolves the same
  // way every run — a suggestion that changes between two previews of the same
  // file is worse than one that is merely debatable.
  const courses = db.prepare('SELECT id, title, code FROM training_courses ORDER BY code, title').all();
  const users = db.prepare("SELECT id, name FROM users WHERE is_active = 1 AND name != 'ReadyBot'").all();
  const userByName = new Map(users.map(u => [personKey(u.name), u]));

  const byCourse = new Map();
  for (const r of parsed.rows) {
    if (!byCourse.has(r.course)) byCourse.set(r.course, 0);
    byCourse.set(r.course, byCourse.get(r.course) + 1);
  }
  const headings = [...byCourse.entries()].sort((a, b) => b[1] - a[1]).map(([heading, count]) => ({
    heading,
    count,
    admin: ADMIN_COLUMNS.test(heading),
    suggested_course_id: ADMIN_COLUMNS.test(heading) ? null : suggestCourse(heading, courses),
  }));

  // Collapse the log's two spellings of one person into one row — showing
  // "Vera, Yetzon" and "Yetzon Vera" as two unmatched people is how a reviewer
  // concludes the import is broken when it isn't.
  const byPerson = new Map();
  for (const r of parsed.rows) {
    const key = personKey(r.employee);
    if (!key) continue;
    const u = userByName.get(key);
    const row = byPerson.get(key)
      || { name: u ? u.name : displayName(r.employee), user_id: u ? u.id : null, matched: !!u, as_written: new Set() };
    row.as_written.add(r.employee);
    byPerson.set(key, row);
  }
  const people = [...byPerson.values()]
    .map(p => ({ ...p, as_written: [...p.as_written].sort() }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return {
    sheets: parsed.sheets,
    total: parsed.rows.length,
    undated: parsed.rows.filter(r => !r.dated).length,
    links: parsed.links.length,
    headings,
    people,
    courses: courses.map(c => ({ id: c.id, title: c.title, code: c.code })),
  };
}

router.post('/import-log/analyze', logUpload.single('file'), (req, res) => {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Importing the training log is admin-only.' });
  if (!req.file) return res.status(400).json({ error: 'Attach the Training Log spreadsheet (.xlsx).' });
  try {
    res.json(analyzeBuffer(getDb(), req.file.buffer));
  } catch (e) {
    res.status(400).json({ error: `Could not read that spreadsheet: ${e.message}` });
  }
});

// Decide what each parsed row becomes, given the caller's mapping. Shared by
// preview and commit so a dry run and the real thing can never disagree.
function planRows(db, buffer, mapping, opts) {
  const parsed = parseTrainingLog(buffer);
  const courses = new Map(db.prepare('SELECT id, title, code FROM training_courses').all().map(c => [c.id, c]));
  const users = db.prepare("SELECT id, name FROM users WHERE is_active = 1 AND name != 'ReadyBot'").all();
  const userByName = new Map(users.map(u => [personKey(u.name), u]));
  // Already-imported rows, so re-running is safe. A completion is identified by
  // person + topic + date: the same training on the same day is the same event.
  // The person half uses personKey, so a sheet that writes "Vera, Yetzon" and
  // one that writes "Yetzon Vera" don't file the same training twice.
  const existing = new Set(db.prepare(
    'SELECT employee_name, training_topic, training_date FROM training_records').all()
    .map(r => `${personKey(r.employee_name)}|${normName(r.training_topic)}|${r.training_date}`));

  const plan = { create: [], skip_ignored: 0, skip_unmapped: 0, skip_existing: 0, skip_repeat: 0, skip_no_person: 0, skip_no_date: 0, undated_sheets: new Set(), unmatched_people: new Set() };
  const seen = new Set();
  for (const r of parsed.rows) {
    const courseId = mapping[r.course];
    if (courseId === 'ignore' || ADMIN_COLUMNS.test(r.course)) { plan.skip_ignored++; continue; }
    if (!courseId || !courses.has(courseId)) { plan.skip_unmapped++; continue; }
    const u = userByName.get(personKey(r.employee));
    // A departed employee is not a reason to invent an account. The completion
    // is still real history, so it's kept under the name as recorded unless the
    // caller asks to skip people who aren't in Settings.
    if (!u && opts.skipUnknownPeople) { plan.skip_no_person++; plan.unmatched_people.add(displayName(r.employee)); continue; }
    if (!u) plan.unmatched_people.add(displayName(r.employee));
    // No date on the cell AND none derivable from the sheet's period. A
    // training record without a date is not a record, and guessing one is
    // worse than saying so — the log has a tab typo'd "20204", and inventing
    // 2020 for it would put a wrong date on someone's compliance history.
    if (!r.date) { plan.skip_no_date++; plan.undated_sheets.add(r.source); continue; }
    const course = courses.get(courseId);
    const key = `${personKey(r.employee)}|${normName(course.title)}|${r.date}`;
    // Two different reasons to skip, and they must not be reported as one:
    // "already in ReadyDoc" means a previous import, "repeated in the file"
    // means the same training on the same day appears on two sheets. Calling
    // the second one "already imported" on an empty database is how an
    // importer loses someone's trust on the preview screen.
    if (existing.has(key)) { plan.skip_existing++; continue; }
    if (seen.has(key)) { plan.skip_repeat++; continue; }
    seen.add(key);
    plan.create.push({
      // The account's name when there is one, so the imported record reads the
      // same as every other record in ReadyDoc — the log's own spelling is a
      // spreadsheet artefact, not the person's name.
      employee_name: u ? u.name : displayName(r.employee),
      employee_id: u ? u.id : null,
      training_topic: course.title,
      trainer: r.trainer,
      training_date: r.date,
      approximate: !r.dated,
      source: r.source,
    });
  }
  plan.unmatched_people = [...plan.unmatched_people].sort();
  plan.undated_sheets = [...plan.undated_sheets].sort();
  return plan;
}

router.post('/import-log/preview', logUpload.single('file'), (req, res) => {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Importing the training log is admin-only.' });
  if (!req.file) return res.status(400).json({ error: 'Attach the Training Log spreadsheet (.xlsx).' });
  const mapping = parseJson(req.body?.mapping, {}) || {};
  const skipUnknownPeople = String(req.body?.skip_unknown_people) === 'true';
  try {
    const plan = planRows(getDb(), req.file.buffer, mapping, { skipUnknownPeople });
    res.json({
      will_create: plan.create.length,
      skipped: {
        ignored: plan.skip_ignored, unmapped: plan.skip_unmapped,
        already_in_readydoc: plan.skip_existing, repeated_in_file: plan.skip_repeat,
        no_person: plan.skip_no_person, no_date: plan.skip_no_date,
      },
      undated_sheets: plan.undated_sheets,
      approximate_dates: plan.create.filter(r => r.approximate).length,
      unmatched_people: plan.unmatched_people,
      sample: plan.create.slice(0, 15),
    });
  } catch (e) {
    res.status(400).json({ error: `Could not read that spreadsheet: ${e.message}` });
  }
});

router.post('/import-log/commit', logUpload.single('file'), (req, res) => {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Importing the training log is admin-only.' });
  if (!req.file) return res.status(400).json({ error: 'Attach the Training Log spreadsheet (.xlsx).' });
  const mapping = parseJson(req.body?.mapping, {}) || {};
  const skipUnknownPeople = String(req.body?.skip_unknown_people) === 'true';
  const db = getDb();
  let plan;
  try { plan = planRows(db, req.file.buffer, mapping, { skipUnknownPeople }); }
  catch (e) { return res.status(400).json({ error: `Could not read that spreadsheet: ${e.message}` }); }

  const ins = db.prepare(`INSERT INTO training_records
    (id, employee_name, employee_id, training_topic, trainer, training_date, completion_date, status, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'completed', ?)`);
  db.transaction(() => {
    for (const r of plan.create) {
      // Say when the date came from the sheet's period rather than the cell.
      // An approximate date that looks exact is worse than one that admits it.
      const note = [`Imported from the Training Log (${r.source})`,
        r.approximate ? 'date approximate — taken from the sheet period' : null]
        .filter(Boolean).join(' · ');
      ins.run(uuid(), r.employee_name, r.employee_id, r.training_topic, r.trainer, r.training_date, r.training_date, note);
    }
  })();
  logAudit(req.user, 'create', 'training_record', null,
    { imported: plan.create.length, source: 'training_log', file: req.file.originalname }, null, null, 'Training Log import');
  res.status(201).json({
    created: plan.create.length,
    skipped: { ignored: plan.skip_ignored, unmapped: plan.skip_unmapped, already_in_readydoc: plan.skip_existing, repeated_in_file: plan.skip_repeat, no_person: plan.skip_no_person, no_date: plan.skip_no_date },
    undated_sheets: plan.undated_sheets,
    unmatched_people: plan.unmatched_people,
  });
});

router.get('/courses/:id/materials', async (req, res) => {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM training_materials WHERE course_id = ? ORDER BY created_at').all(req.params.id);
  res.json(await Promise.all(rows.map(async m => ({
    id: m.id, title: m.title, filename: m.filename, content_type: m.content_type, size: m.size,
    uploaded_by: m.uploaded_by, created_at: m.created_at,
    is_video: isVideo(m.content_type, m.filename),
    url: await presignGet(m.storage_key, m.filename),
  }))));
});

router.post('/courses/:id/materials', uploadMaterials, async (req, res) => {
  const files = req.files || [];
  try {
    if (!storageEnabled()) return res.status(503).json({ error: 'File storage is not configured on this server.' });
    const db = getDb();
    const course = db.prepare('SELECT id, title FROM training_courses WHERE id = ?').get(req.params.id);
    if (!course) return res.status(404).json({ error: 'Course not found' });
    if (!files.length) return res.status(400).json({ error: 'No files uploaded' });
    const tooBig = rejectOversize(files);
    if (tooBig) return res.status(413).json({ error: tooBig });
    const out = [];
    for (const f of files) {
      const id = uuid();
      const safe = (f.originalname || 'file').replace(/[^\w.-]+/g, '_').slice(0, 120);
      const key = `training/${course.id}/${id}-${safe}`;
      await putStream(key, createReadStream(f.path), f.mimetype);
      db.prepare(`INSERT INTO training_materials (id, course_id, title, filename, content_type, size, storage_key, uploaded_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
        id, course.id, (req.body?.title || '').slice(0, 200) || null, (f.originalname || 'file').slice(0, 255),
        f.mimetype || null, f.size || null, key, req.user?.name || null);
      out.push({ id, filename: f.originalname, content_type: f.mimetype, size: f.size, is_video: isVideo(f.mimetype, f.originalname) });
    }
    logAudit(req.user, 'training_material_added', 'training_course', course.id,
      { files: out.map(o => o.filename) }, null, null, course.title);
    res.status(201).json(out);
  } finally {
    cleanupTemp(files);
  }
});

router.delete('/materials/:id', (req, res) => {
  const db = getDb();
  const m = db.prepare('SELECT * FROM training_materials WHERE id = ?').get(req.params.id);
  if (!m) return res.status(404).json({ error: 'Not found' });
  db.prepare('DELETE FROM training_materials WHERE id = ?').run(m.id);
  deleteObject(m.storage_key); // best effort; the row is already gone
  logAudit(req.user, 'training_material_deleted', 'training_course', m.course_id,
    { filename: m.filename }, null, null, m.filename);
  res.json({ ok: true });
});

// ── ATTACH scanned forms ──────────────────────────────────────────────────────
// List completion records missing evidence, to match uploaded scanned tests to.
router.get('/unattached', (_req, res) => {
  const db = getDb();
  const rows = db.prepare(`SELECT tr.id, tr.employee_name, tr.completion_date, tr.training_topic, c.title AS course_title, c.code AS course_code
    FROM training_records tr LEFT JOIN training_courses c ON tr.course_id = c.id
    WHERE (tr.document_url IS NULL OR tr.document_url = '') ORDER BY tr.employee_name, tr.completion_date DESC`).all();
  res.json(rows);
});

router.post('/:id/attach', (req, res) => {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM training_records WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Not found' });
  if (!req.body.document_url) return res.status(400).json({ error: 'document_url is required' });
  db.prepare("UPDATE training_records SET document_url = ?, updated_at = datetime('now') WHERE id = ?").run(req.body.document_url, req.params.id);
  logAudit(req.user, 'training_form_attached', 'training', req.params.id, { document_url: req.body.document_url }, null, null, existing.employee_name);
  res.json(db.prepare('SELECT * FROM training_records WHERE id = ?').get(req.params.id));
});

router.get('/:id', (req, res) => {
  const db = getDb();
  const rec = db.prepare(`SELECT tr.*, c.title AS course_title, c.code AS course_code, sd.title AS sop_title
    FROM training_records tr LEFT JOIN training_courses c ON tr.course_id = c.id
    LEFT JOIN sop_documents sd ON tr.sop_id = sd.id WHERE tr.id = ?`).get(req.params.id);
  if (!rec) return res.status(404).json({ error: 'Not found' });
  res.json(rec);
});

export default router;
