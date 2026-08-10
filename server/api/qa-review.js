// QA Review Center API — read the outstanding piles, sign them off.
//
// Every write here delegates to the owning module's own sign function (see
// server/qa-review.js). This router adds no signature logic of its own; if it
// ever needs to, that logic belongs in the module instead.

import { Router } from 'express';
import { getDb } from '../db.js';
import { SOURCES, getSource, safeCount, safePending, isQaReviewer } from '../qa-review.js';

const router = Router();

// Reaching the queue is exactly `isQaReviewer` — the same rule the sidebar
// applies, so the door and the nav entry can't disagree.
//
// This used to be broader ("anyone with edit on a source module may READ the
// queue"), which was breadth nothing could use: the module only appears for a
// QA reviewer, so the extra permission covered a screen those people never
// see, while giving the API and the sidebar two different answers to one
// question. Signing a single module's records is still separately allowed by
// edit on that module — from that module's own screen, where the record is.
const canSeeReview = isQaReviewer;

// GET / — counts for every source, plus the pending rows for the ones the
// caller asked for. Counts are cheap and always returned so the tab bar can
// show what's behind the tab you're not on.
router.get('/', (req, res) => {
  if (!canSeeReview(req.user)) return res.status(403).json({ error: 'QA Review is for QA, admins, and anyone granted it in Settings.' });
  const db = getDb();
  const only = req.query.source ? String(req.query.source) : null;
  // Bounded like every other list endpoint — the badge carries the true total.
  const limit = Math.min(Number(req.query.limit) || 200, 500);

  const sources = SOURCES.map(s => {
    const count = safeCount(s, db);
    const include = !only || only === s.key;
    return {
      key: s.key,
      label: s.label,
      form: s.form,
      module: s.module,
      noun: s.noun,
      plural: s.plural,
      count,
      can_sign: !!s.canSign(req.user),
      items: include ? safePending(s, db, limit) : null,
    };
  });

  res.json({ sources, total: sources.reduce((n, s) => n + s.count, 0) });
});

// POST /sign — one or many records from a single source.
//
// Batched because the whole point of the screen is working a pile, but each
// record is signed individually through its module and each gets its own audit
// entry. A failure on one row does not roll back the rest: those signatures are
// real and already logged, so the honest answer is a per-row result.
router.post('/sign', (req, res) => {
  const db = getDb();
  const source = getSource(req.body?.source);
  if (!source) return res.status(400).json({ error: 'Unknown review source.' });
  if (!source.canSign(req.user)) {
    return res.status(403).json({ error: `You do not have sign-off rights for ${source.label.toLowerCase()}.` });
  }

  const ids = Array.isArray(req.body?.ids) ? req.body.ids.filter(Boolean) : [];
  if (!ids.length) return res.status(400).json({ error: 'Nothing selected.' });

  const signed = [];
  const failed = [];
  for (const id of ids) {
    let result;
    try { result = source.sign(db, req.user, id); }
    catch (e) { result = { error: e.message || 'Could not sign this record.' }; }
    if (result?.error) failed.push({ id, error: result.error });
    else signed.push(id);
  }

  res.json({ signed, failed, remaining: safeCount(source, db) });
});

export default router;
