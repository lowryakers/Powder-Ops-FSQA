// THE FORMS MASTER INDEX, served — plus an honest account of what it covers.
//
// Read-only, and there is no write path at all. The registry ships in
// `shared/form-registry.js` because a form number is a Document Control fact,
// and one editable in the app would be a second register competing with the
// controlled one. Changing a number is a Document Change Request; this endpoint
// only reports.
//
// The coverage half is the part with teeth. A registry that only lists forms
// answers "what forms exist", which Document Control already knows from their
// spreadsheet. What nobody could answer was the inverse — WHICH LIVE TASKS AND
// RECORDS CARRY NO FORM NUMBER — and that is precisely what an auditor finds by
// pointing at a screen. So the coverage report walks the real schedules and
// record areas and names the ones that map to nothing, rather than leaving the
// gap to be discovered during the audit.

import { Router } from 'express';
import { getDb } from '../db.js';
import { FORM_REGISTRY, formFor } from '../../shared/form-registry.js';
import { SCALE_FORMS } from '../scale-forms.js';
import { getType, QMS_TYPES } from '../qms-config.js';

const router = Router();

/**
 * The registry, with the scale forms' revisions filled in from scale-forms.js.
 *
 * Those five entries deliberately carry no `revision` of their own: the
 * tolerances they are graded against live in scale-forms.js under Document
 * Control's change gate, and a second copy here is how the registry starts
 * quoting a revision the grader has moved past.
 */
function registryWithRevisions() {
  return FORM_REGISTRY.map(f => {
    if (!f.match?.scaleForm) return f;
    const sf = SCALE_FORMS.find(s => s.code === f.match.scaleForm);
    return sf ? { ...f, revision: sf.revision } : f;
  });
}

/**
 * Where the registry and `qms-config.js` disagree about a number.
 *
 * The QMS record types have carried their own `formCode` since long before
 * this registry existed, and that value is gated by controlled.js — changing
 * it is a controlled change, not an edit. So neither side is silently
 * rewritten to match the other. The disagreement is REPORTED, because two
 * places naming the same form differently is exactly what an auditor will
 * catch, and Document Control is the only party who can say which is right.
 */
function qmsDisagreements() {
  const out = [];
  const norm = s => String(s || '').toUpperCase().replace(/[\s-]/g, '');
  for (const type of Object.keys(QMS_TYPES)) {
    const cfg = getType(type);
    if (!cfg?.formCode) continue;
    const entry = formFor({ qmsType: type });
    if (!entry) continue;
    if (norm(entry.code) !== norm(cfg.formCode)) {
      out.push({ record_type: type, label: cfg.label, in_app: cfg.formCode, in_registry: entry.code });
    }
  }
  return out;
}

/**
 * Live work that maps to no form number.
 *
 * Bounded by construction — it groups, so it returns one row per distinct
 * schedule title or record area, not one per record.
 */
function coverage(db) {
  const unmapped = { schedules: [], record_areas: [] };
  const mapped = { schedules: 0, record_areas: 0 };

  // Only the groups that came off paper forms. Maintenance PMs are equipment
  // servicing, not a controlled form, and listing 3,000 of them as "missing a
  // form number" would bury the handful that genuinely are missing one.
  const scheds = db.prepare(`
    SELECT title, task_group, COUNT(*) n FROM pm_schedules
    WHERE task_group IN ('qa','cleaning') AND is_active = 1
    GROUP BY title, task_group ORDER BY title
  `).all();
  for (const s of scheds) {
    if (formFor({ taskTitle: s.title })) mapped.schedules += 1;
    else unmapped.schedules.push({ title: s.title, task_group: s.task_group, count: s.n });
  }

  const areas = db.prepare(`
    SELECT area, record_group, COUNT(*) n FROM sanitation_records
    GROUP BY area, record_group ORDER BY n DESC
  `).all();
  for (const a of areas) {
    if (formFor({ sanitationArea: a.area })) mapped.record_areas += 1;
    else unmapped.record_areas.push({ area: a.area, record_group: a.record_group, count: a.n });
  }

  return { mapped, unmapped };
}

// GET /api/forms — the registry, the coverage report and any disagreement.
router.get('/', (req, res) => {
  try {
    const forms = registryWithRevisions();
    res.json({
      forms,
      counts: forms.reduce((acc, f) => ({ ...acc, [f.where]: (acc[f.where] || 0) + 1 }), {}),
      ...coverage(getDb()),
      disagreements: qmsDisagreements(),
    });
  } catch (e) {
    // A registry that 500s takes a Document Control screen down two weeks
    // before an audit. The list itself never depends on the database, so it is
    // still served when the coverage query is what failed.
    console.error('[forms] coverage failed:', e.message);
    res.json({
      forms: registryWithRevisions(),
      counts: {},
      mapped: null,
      unmapped: { schedules: [], record_areas: [] },
      disagreements: [],
      coverage_error: e.message,
    });
  }
});

export default router;
