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

const router = Router();

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
    logAudit(req.user, 'update', 'document', id, { doc_review: source.key, action: source.action?.done || 'actioned' });
  }

  res.json({ done, failed, remaining: safeCount(source, db) });
});

export default router;
