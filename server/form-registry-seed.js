// The shipped Forms Master Index, planted into `controlled_forms` once.
//
// INSERT-ONLY, KEYED ON THE FORM CODE. A redeploy must never overwrite a
// revision, a title or a `where` that Document Control has corrected by hand —
// that is worse than no seed at all, because the correction would vanish
// silently and the register would quietly go back to whatever shipped. Same
// doctrine as the product seed and `seedWorkInstructionCourses`.
//
// New codes added to shared/form-registry.js in a later release ARE picked up,
// because the check is per code rather than "does the table have any rows".
// That is deliberate: adding a form to the shipped index should reach the
// plant, while editing one they already hold should not.

import { v4 as uuid } from 'uuid';
import { FORM_REGISTRY } from '../shared/form-registry.js';
import { SCALE_FORMS } from './scale-forms.js';

export function seedControlledForms(db) {
  let added = 0;
  try {
    const exists = db.prepare('SELECT 1 FROM controlled_forms WHERE code = ?');
    const insert = db.prepare(`
      INSERT INTO controlled_forms (id, code, revision, title, where_used, note, is_seeded, created_by)
      VALUES (?, ?, ?, ?, ?, ?, 1, 'system')
    `);

    db.transaction(() => {
      for (const f of FORM_REGISTRY) {
        if (exists.get(f.code)) continue;
        // The five scale forms keep their revision in scale-forms.js, which is
        // what a check is actually graded against; seeding a second copy here
        // is how the register starts quoting a revision the grader moved past.
        const sf = f.match?.scaleForm ? SCALE_FORMS.find(s => s.code === f.match.scaleForm) : null;
        insert.run(uuid(), f.code, sf?.revision || f.revision || null, f.title, f.where, f.note || null);
        added += 1;
      }
    })();

    if (added) console.log(`[forms] Seeded ${added} controlled form(s) into the register`);
  } catch (e) {
    console.warn('[forms] form register seed skipped:', e.message);
  }
  return added;
}
