// The three standing lists Marnee named, filed once.
//
// NAMED AND EMPTY, deliberately. The names are hers — "Monthly break room
// snacks and supplies", "Monthly cleaning supplies", "Monthly production
// supplies" — and so is the cadence; WHAT IS ON EACH ONE IS NOT SOMETHING
// ANYONE OUTSIDE THE OFFICE KNOWS, and a seeded guess at the break room's
// dozen items would be a list she has to correct before she can trust it. The
// screen says "nothing on this list yet" and no cycle opens until something is
// (see cyclesDue), so an empty list asks nobody anything.
//
// INSERT-ONLY AND KEYED ON THE NAME, like every seeder here: a cadence she
// changed, a list she renamed or retired is a decision, and a redeploy must
// never undo it.

import { v4 as uuid } from 'uuid';

const LISTS = [
  { name: 'Monthly break room snacks and supplies', tags: ['Break room'] },
  { name: 'Monthly cleaning supplies', tags: ['Cleaning'] },
  { name: 'Monthly production supplies', tags: ['Warehouse/Production'] },
];

export function seedSupplyLists(db) {
  let added = 0;
  try {
    const has = db.prepare('SELECT id FROM supply_lists WHERE LOWER(name) = LOWER(?)');
    const ins = db.prepare(`INSERT INTO supply_lists (id, name, cadence, day, tags, active, notes, created_by)
      VALUES (?, ?, 'monthly', 1, ?, 1, ?, 'system')`);
    for (const l of LISTS) {
      if (has.get(l.name)) continue;
      ins.run(uuid(), l.name, JSON.stringify(l.tags),
        'Add what this list covers. Nothing is asked about until it has at least one item.');
      added += 1;
    }
    if (added) console.log(`[seed] Seeded ${added} standing supply list(s)`);
  } catch (e) {
    console.warn('[seed] standing supply lists unavailable:', e.message);
  }
  return added;
}
