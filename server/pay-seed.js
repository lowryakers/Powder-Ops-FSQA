import { v4 as uuid } from 'uuid';
import { PAY_ROSTER } from './pay-seed-data.js';

// One-time import of the Pay Tracking workbook. Idempotent: it only ever fills
// an empty roster, so a redeploy never overwrites rates that have since been
// maintained in ReadyDoc.
//
// Roster rows are linked to Settings users by name where one matches. An
// unmatched row is left unlinked rather than guessed at — Settings is the
// source of truth for who works here, and the Roster tab shows the mismatches
// so they can be reconciled deliberately.
export function seedPayTracking(db) {
  try {
    const have = db.prepare('SELECT COUNT(*) c FROM pay_employees').get().c;
    if (have === 0) {
      const users = db.prepare('SELECT id, name FROM users WHERE is_active = 1').all();
      const byName = new Map(users.map(u => [norm(u.name), u.id]));
      const ins = db.prepare(`INSERT INTO pay_employees
        (id, user_id, name, team, is_supervisor, pay_rate, hire_date, last_increase_at, pto_plan)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
      let linked = 0;
      db.transaction(() => {
        for (const p of PAY_ROSTER) {
          const userId = byName.get(norm(p.name)) || null;
          if (userId) linked++;
          ins.run(uuid(), userId, p.name, p.team, p.is_supervisor, p.pay_rate,
            p.hire_date, p.last_increase_at, p.pto_plan);
        }
      })();
      console.log(`[seed] Pay roster: ${PAY_ROSTER.length} people (${linked} matched to a Settings user)`);
    }
  } catch (e) {
    console.warn('[seed] pay tracking seed skipped:', e.message);
  }
}

// Names are compared loosely enough to survive spacing and accents but not so
// loosely that two different people collide.
const norm = (s) => String(s || '')
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toLowerCase().replace(/\s+/g, ' ').trim();

export { norm as normalizeName };
