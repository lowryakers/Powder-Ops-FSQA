// Document Control Review Center API — read the outstanding piles, clear the
// ones that can honestly be cleared from a list.
//
// Same shape as `api/qa-review.js`, and the same rule: this router adds no
// document logic of its own. Marking a document reviewed calls documents.js's
// `recomputeDocumentReview`, so one place computes the next review date and
// there's one audit shape for it.

import { Router } from 'express';
import { getDb, logAudit } from '../db.js';
import { SOURCES, getSource, safeCount, safePending, isDocController } from '../doc-review.js';
import { docConsistencyReview } from '../doc-consistency.js';
import { nameUsage } from '../name-usage.js';
import { planRename, applyRename } from '../name-rename.js';
import { schedulesForDocument, linkSchedule, unlinkSchedule, findSchedules } from '../schedule-documents.js';

const router = Router();

// The consistency review: where the registry disagrees with itself —
// duplicate numbers, one title on two documents, references to documents
// that don't exist, orphaned WIs, empty shells. A report, never a repair:
// Daniela's starting point for bringing the digital copies up to date.
router.get('/consistency', (req, res) => {
  if (!isDocController(req.user)) {
    return res.status(403).json({ error: 'Document Control review is for Document Control, QA supervisors and admins.' });
  }
  res.json(docConsistencyReview(getDb()));
});

// Where a name is used (D-326): every document, task, register entry and
// built-in definition that carries a term, and who changes each. READ-ONLY.
// D-328: the recurring tasks that follow a document. Linked from the document
// (Document Control works there); a newer approved revision lists them on the
// "Recurring tasks to check" pile above.
router.get('/document-tasks/:docId', (req, res) => {
  if (!isDocController(req.user)) return res.status(403).json({ error: 'Document Control review is for Document Control, QA supervisors and admins.' });
  res.json(schedulesForDocument(getDb(), req.params.docId));
});
router.get('/schedules', (req, res) => {
  if (!isDocController(req.user)) return res.status(403).json({ error: 'Document Control review is for Document Control, QA supervisors and admins.' });
  res.json(findSchedules(getDb(), req.query.q));
});
router.post('/document-tasks/:docId', (req, res) => {
  if (!isDocController(req.user)) return res.status(403).json({ error: 'Document Control review is for Document Control, QA supervisors and admins.' });
  const db = getDb();
  const out = linkSchedule(db, req.body?.schedule_id, req.params.docId);
  if (out.error) return res.status(out.status || 400).json({ error: out.error });
  logAudit(req.user, 'update', 'pm_schedule', req.body.schedule_id, { follows_document: req.params.docId, previous: out.previous });
  res.json(schedulesForDocument(db, req.params.docId));
});
router.delete('/document-tasks/:docId/:scheduleId', (req, res) => {
  if (!isDocController(req.user)) return res.status(403).json({ error: 'Document Control review is for Document Control, QA supervisors and admins.' });
  const db = getDb();
  const out = unlinkSchedule(db, req.params.scheduleId, req.params.docId);
  if (out.error) return res.status(out.status || 400).json({ error: out.error });
  logAudit(req.user, 'update', 'pm_schedule', req.params.scheduleId, { unfollows_document: req.params.docId });
  res.json(schedulesForDocument(db, req.params.docId));
});

// D-328: rename it everywhere it can be renamed, in one act. `preview: true`
// writes nothing; the apply re-plans on the server, so it writes what was shown.
router.post('/name-usage/rename', (req, res) => {
  if (!isDocController(req.user)) return res.status(403).json({ error: 'Document Control review is for Document Control, QA supervisors and admins.' });
  const db = getDb();
  const plan = planRename(db, req.body?.from, req.body?.to);
  if (plan.error) return res.status(400).json({ error: plan.error });
  const summary = { from: plan.from, to: plan.to, total: plan.rows.length, by_target: plan.by_target, kept: plan.kept,
    rows: plan.rows.map(r => ({ target: r.target, label: r.label, id: r.id, name: r.name,
      changes: Object.entries(r.fields).map(([f, v]) => ({ field: f, from: v.from, to: v.to })) })) };
  if (req.body?.preview) return res.json({ ...summary, preview: true });
  const reason = String(req.body?.reason || '').trim();
  if (reason.length < 3) return res.status(400).json({ error: 'Say why (for example, the DCR number).', code: 'REASON_REQUIRED' });
  if (!plan.rows.length) return res.status(400).json({ error: 'Nothing to rename.', code: 'NOTHING_TO_RENAME' });
  const n = applyRename(db, plan, { actor: req.user, reason, logAudit });
  logAudit(req.user, 'update', 'name_rename', null, { from: plan.from, to: plan.to, reason, rows: n, by_target: plan.by_target }, null, null, `${plan.from} → ${plan.to}`);
  res.json({ ...summary, renamed: n });
});

router.get('/name-usage', (req, res) => {
  if (!isDocController(req.user)) {
    return res.status(403).json({ error: 'Document Control review is for Document Control, QA supervisors and admins.' });
  }
  res.json(nameUsage(getDb(), req.query.q));
});

// GET / — counts for every source, plus the rows for the one being looked at.
// Counts are cheap and always returned so the tab bar can show what's behind
// the tab you're not on.
router.get('/', (req, res) => {
  if (!isDocController(req.user)) {
    return res.status(403).json({ error: 'Document Control review is for Document Control, QA supervisors and admins.' });
  }
  const db = getDb();
  const only = req.query.source ? String(req.query.source) : null;
  const limit = Math.min(Number(req.query.limit) || 200, 500);

  const sources = SOURCES.map(s => {
    const count = safeCount(s, db);
    const include = !only || only === s.key;
    return {
      key: s.key,
      label: s.label,
      form: s.form || null,
      module: s.module,
      // The tab inside that module where the pile is worked, when it has one.
      view: s.view || null,
      noun: s.noun,
      plural: s.plural,
      help: s.help || null,
      // Only a source with an `act` can be worked from the list. The client
      // renders checkboxes for those and a "open it where it's decided" link
      // for the rest — a button that can't finish the job is worse than none.
      action: s.action || null,
      count,
      can_act: !!s.canAct(req.user),
      items: include ? safePending(s, db, limit) : null,
    };
  });

  res.json({ sources, total: sources.reduce((n, s) => n + s.count, 0) });
});

// POST /act — one or many records from a single source that HAS an action.
//
// Batched because the point of the screen is working a pile, but each record is
// handled individually and audited individually: a bulk action has to leave the
// trail a manual one would. A failure on one row doesn't roll back the rest —
// those are real and already logged.
router.post('/act', (req, res) => {
  const db = getDb();
  const source = getSource(req.body?.source);
  if (!source) return res.status(400).json({ error: 'Unknown review source.' });
  if (!source.act) return res.status(400).json({ error: `${source.label} is worked on the record, not from this list.` });
  if (!source.canAct(req.user)) {
    return res.status(403).json({ error: `You do not have Document Control rights for ${source.label.toLowerCase()}.` });
  }

  const ids = Array.isArray(req.body?.ids) ? req.body.ids.filter(Boolean) : [];
  if (!ids.length) return res.status(400).json({ error: 'Nothing selected.' });

  const done = [];
  const failed = [];
  for (const id of ids) {
    let result;
    try { result = source.act(db, req.user, id); }
    catch (e) { result = { error: e.message || 'Could not complete this one.' }; }
    if (result?.error) { failed.push({ id, error: result.error }); continue; }
    done.push(id);
    logAudit(req.user, 'update', source.entity || 'document', id, { doc_review: source.key, action: source.action?.done || 'actioned' });
  }

  res.json({ done, failed, remaining: safeCount(source, db) });
});

export default router;
