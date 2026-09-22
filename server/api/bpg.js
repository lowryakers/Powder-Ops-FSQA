// The brittle plastic & glass zone register: every zone's inventory, whether
// its inspection is actually reaching anybody, and one door to correct it.
//
// MOUNTED WITHOUT `requireModuleWrite`, DELIBERATELY — the AP Drop / QMS filing
// arrangement, and for the same kind of reason. The inventories behind FORM
// 431-01 are Document Control's to maintain, and Document Control holds no
// `pm` grant, so mounting this under the PM guard would 403 the one department
// the screen exists for. A router that skips the mount guard owes its own rule
// per route, and these are:
//
//   GET   — any account with modules assigned. The zone list is plant
//           reference material: no personal data, no money, no signatures.
//           A nothing-assigned account is still refused, or "no modules"
//           would answer reads anyway, which is the gap that rule closed.
//   PUT   — canEditZoneItems: admin, Document Control, or a QA supervisor.
//
// An external (client) account never reaches any of it — the auth middleware
// refuses everything outside EXTERNAL_ALLOWED as a 404 before this file runs.

import { Router } from 'express';
import { getDb } from '../db.js';
import { bpgZones, canEditZoneItems, writeScheduleItems, isBpgSchedule, zoneDrift, bpgDiagram } from '../bpg-zones.js';

const router = Router();

// Mirrors requireModuleWrite's GET rule for the one account it refuses: a NULL
// module map means no modules, and a read that answered anyway would be the
// same two-mechanisms gap wearing different clothes.
function assigned(user) {
  return !!user && (user.role === 'admin' || user.role === 'auditor' || user.module_access != null);
}

router.get('/zones', (req, res) => {
  if (!assigned(req.user)) {
    return res.status(403).json({ error: 'No modules have been assigned to this account yet. An admin assigns them in Settings.' });
  }
  const db = getDb();
  const zones = bpgZones(db);
  // WHEN DOES THE DRAWING NEED RE-ISSUING is the question underneath "can the
  // diagram update itself". It cannot — FORM 431-01 is a controlled document
  // with a revision history — but where the plant's own counts have moved away
  // from it is exactly the trigger for a change request, and until now that
  // comparison only ever reached a deploy log.
  const { drifted, untranscribed } = zoneDrift(db);
  res.json({
    zones,
    diagram: bpgDiagram(db),
    drift: drifted,
    untranscribed,
    can_edit: canEditZoneItems(req.user),
    // Counted from the rows returned, never a second query — a figure that can
    // disagree with the list under it is the defect this codebase keeps
    // unpicking.
    total: zones.length,
    inspectable: zones.filter(z => z.inspectable).length,
    not_inspectable: zones.filter(z => !z.inspectable).length,
    no_items: zones.filter(z => z.item_count === 0).length,
  });
});

router.put('/zones/:scheduleId/items', (req, res) => {
  if (!canEditZoneItems(req.user)) {
    return res.status(403).json({ error: 'Changing what an inspection covers is for Quality and Document Control. Report a miscount to them and it will be corrected here.' });
  }
  const db = getDb();
  const sched = db.prepare('SELECT id, title FROM pm_schedules WHERE id = ?').get(req.params.scheduleId);
  if (!sched) return res.status(404).json({ error: 'Zone not found' });
  // This door is for BP&G zones only. A maintenance schedule's steps are a
  // different thing with different owners, and they are edited where they live.
  if (!isBpgSchedule(sched.title)) {
    return res.status(400).json({ error: 'That schedule is not a brittle plastic & glass zone.' });
  }
  const out = writeScheduleItems(db, sched.id, req.body?.items, req.user, { note: req.body?.note || null });
  if (out.status !== 200) return res.status(out.status).json({ error: out.error });
  res.json({ items: out.items, cards_updated: out.cards_updated });
});

export default router;
