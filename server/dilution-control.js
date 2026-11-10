// FORM 106-01's dilutions are a CONTROLLED DEFINITION, and approving one moves
// the tasks (D-327).
//
// Maria asked for Sani-512 to be renamed "J-512 TM/MC Sanitizer" everywhere.
// Daniela's DCR reaches the SOPs and WIs; it did NOT reach the four daily
// dilution tasks, because their chemical names, ranges and targets lived in
// `shared/dilution-forms.js` and the tasks were matched to them by exact TITLE —
// so renaming the chemical would have stopped the check grading at all, and the
// seeder would have raised a second schedule beside the old one.
//
// Now:
//   - the list is registered with `controlled.js` (key `dilution:FORM 106-01`):
//     a change in code is PARKED until Document Control approves it, and the
//     app goes on serving the approved list — the ATP / env / EMP arrangement;
//   - a schedule is identified by `pm_schedules.dilution_key`, never its title;
//   - approving (and every boot) runs `syncDilutionTasks`, which rewrites each
//     UNTOUCHED schedule — and its open cards — to the definition in force. A
//     schedule somebody edited by hand is REPORTED and left alone: whose words
//     win there is a person's call, not a deploy's.
//   - the screens read `GET /api/dilution-forms` and the `dilution_form` stamped
//     on each task, never the bundle's copy.
//
// "Untouched" is measured against what this sync last wrote, kept in
// `app_settings.dilution_tasks_applied` — not against the code, which is exactly
// what has just changed.

import {
  DILUTIONS, DILUTION_SOURCE, dilutionRevision, dilutionScheduleText, dilutionCardDescription, formFromTitle,
} from '../shared/dilution-forms.js';

const SETTING = 'dilution_tasks_applied';
const OPEN = "('open','in_progress','overdue','missed')";
const FIELDS = ['chemical', 'registry_name', 'min', 'max', 'unit', 'method', 'target'];

const pick = (d) => Object.fromEntries(FIELDS.map(f => [f, d[f] ?? null]));

/** The list IN FORCE, for the screens and the API. */
export function dilutionFormsInForce() {
  return {
    code: DILUTION_SOURCE.code,
    revision: DILUTION_SOURCE.revision,
    form_revision: dilutionRevision(),
    dilutions: DILUTIONS.map(d => ({ key: d.key, ...pick(d), former: [...(d.former || [])] })),
  };
}

/** The `controlled.js` entry. `afterApply` runs when Document Control approves. */
export function dilutionControlledEntry() {
  return {
    scope: 'acceptance',
    key: `dilution:${DILUTION_SOURCE.code}`,
    label: `Chemical dilution checks (${DILUTION_SOURCE.code})`,
    current: () => ({
      revision: DILUTION_SOURCE.revision,
      // `key` per entry, so the review panel diffs chemical by chemical.
      items: DILUTIONS.map(d => ({ key: d.key, ...pick(d) })),
    }),
    apply: (snap) => {
      if (snap?.revision) DILUTION_SOURCE.revision = snap.revision;
      for (const s of snap?.items || []) {
        const d = DILUTIONS.find(x => x.key === s.key);
        if (!d) continue;
        // A renamed chemical keeps answering to its old name, so a card raised
        // before the approval still grades, and the log still ties up.
        if (s.chemical && s.chemical !== d.chemical) d.former = [...new Set([...(d.former || []), d.chemical])];
        for (const f of FIELDS) {
          if (f === 'min' || f === 'max') { if (s[f] === null || typeof s[f] === 'number') d[f] = s[f] ?? undefined; }
          else if (s[f] !== undefined) d[f] = s[f];
        }
      }
    },
    afterApply: (db) => syncDilutionTasks(db),
  };
}

const readApplied = (db) => {
  try { return JSON.parse(db.prepare('SELECT value FROM app_settings WHERE key = ?').get(SETTING)?.value || '{}'); }
  catch { return {}; }
};
const writeApplied = (db, v) => db.prepare(`INSERT INTO app_settings (key, value) VALUES (?, ?)
  ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(SETTING, JSON.stringify(v));

const norm = (steps) => { try { return JSON.stringify(JSON.parse(steps || '[]')); } catch { return String(steps || ''); } };
const same = (row, text) => row.title === text.title && (row.description || '') === text.description
  && norm(row.procedure_steps) === JSON.stringify(text.steps);

/**
 * Bring every dilution schedule, and its open cards, to the definition in force.
 * Idempotent. Returns { schedules, cards, hand_edited: [{id, title, key}] }.
 */
export function syncDilutionTasks(db, { audit } = {}) {
  const out = { schedules: 0, cards: 0, hand_edited: [] };
  const hasCol = db.prepare("SELECT 1 FROM pragma_table_info('pm_schedules') WHERE name = 'dilution_key'").get();
  if (!hasCol) return out;

  // A schedule seeded before the key existed is adopted by its title (current or former).
  for (const r of db.prepare("SELECT id, title FROM pm_schedules WHERE dilution_key IS NULL AND title LIKE 'Chemical Dilution — %'").all()) {
    const f = formFromTitle(r.title);
    if (f) db.prepare('UPDATE pm_schedules SET dilution_key = ? WHERE id = ?').run(f.key, r.id);
  }

  const applied = readApplied(db);
  const next = { ...applied };
  const scheds = db.prepare('SELECT id, title, description, procedure_steps, dilution_key FROM pm_schedules WHERE dilution_key IS NOT NULL').all();
  const updSched = db.prepare(`UPDATE pm_schedules SET title = ?, description = ?, procedure_steps = ?, updated_at = datetime('now') WHERE id = ?`);
  const updCards = db.prepare(`UPDATE work_orders SET title = ?, description = ?, procedure_steps = ?, updated_at = datetime('now')
    WHERE pm_schedule_id = ? AND status IN ${OPEN} AND title = ?`);

  db.transaction(() => {
    for (const s of scheds) {
      const form = DILUTIONS.find(d => d.key === s.dilution_key);
      if (!form) continue;
      const want = dilutionScheduleText(form);
      const last = applied[s.id];
      if (same(s, want)) { next[s.id] = want; continue; }
      // Untouched = still exactly what this sync last wrote. With no record,
      // nothing is known about who wrote it, so it is not touched.
      if (!last || !same(s, last)) { out.hand_edited.push({ id: s.id, title: s.title, key: s.dilution_key }); continue; }
      updSched.run(want.title, want.description, JSON.stringify(want.steps), s.id);
      out.schedules++;
      out.cards += updCards.run(want.title, dilutionCardDescription(form), JSON.stringify(want.steps), s.id, s.title).changes;
      next[s.id] = want;
      audit?.(s, last, want);
    }
    writeApplied(db, next);
  })();
  return out;
}

/** Stamp the dilution in force on each task row that is one (by schedule key, then title). */
export function attachDilutionForms(db, rows) {
  const keys = new Map();
  const keyOf = (id) => {
    if (!id) return null;
    if (!keys.has(id)) {
      let k = null;
      try { k = db.prepare('SELECT dilution_key FROM pm_schedules WHERE id = ?').get(id)?.dilution_key || null; } catch { /* column absent */ }
      keys.set(id, k);
    }
    return keys.get(id);
  };
  return rows.map(r => {
    const k = keyOf(r.pm_schedule_id);
    const form = (k && DILUTIONS.find(d => d.key === k)) || formFromTitle(r.title);
    return form ? { ...r, dilution_form: { key: form.key, ...pick(form) } } : r;
  });
}

/** The dilution a work order checks — the server's grading reads this. */
export function dilutionForWorkOrder(db, wo) {
  const [r] = attachDilutionForms(db, [wo]);
  return r.dilution_form ? DILUTIONS.find(d => d.key === r.dilution_form.key) : null;
}
