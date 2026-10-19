// The ProDough stick supplements' flavour codes (R-0313, 19 Oct 2026).
//
// NEW flavours with no SKU on film yet, so these are choices a person made, not
// derivations — `source = 'new'`. Filed ONCE per database
// (`app_settings.flavor_codes_r0313_v1`) and insert-only per row: a flavour
// already on the register, or a code already meaning something, is skipped and
// named in the boot log, never overwritten. A code is printed on film, so a
// clash is a question for a person, not something to resolve here.
// "Tropical" is its own flavour; Tropical Paradise keeps TRP.
import { randomUUID as uuid } from 'crypto';

export const R0313_NOTE = 'ProDough stick supplements, R-0313, 2026-10-19';
export const R0313_FLAVORS = [
  { flavor: 'Rocket Pop', code: 'RKP' },
  { flavor: 'Coconut Lime', code: 'CNL' },
  { flavor: 'Cucumber Lime', code: 'CUL' },
  { flavor: 'Watermelon Hibiscus', code: 'WMH' },
  { flavor: 'Pineapple Orange', code: 'PNO' },
  { flavor: 'Blue Raspberry', code: 'BRZ' },
  { flavor: 'Watermelon', code: 'WML' },
  { flavor: 'Tropical', code: 'TPC' },
];
const FLAG = 'flavor_codes_r0313_v1';

export function seedR0313FlavorCodes(db) {
  if (db.prepare('SELECT 1 FROM app_settings WHERE key = ?').get(FLAG)) return { skipped: 'already run' };
  const byFlavor = db.prepare('SELECT code FROM flavor_codes WHERE flavor = ? COLLATE NOCASE');
  const byCode = db.prepare('SELECT flavor FROM flavor_codes WHERE code = ?');
  const ins = db.prepare(`INSERT INTO flavor_codes (id, flavor, code, source, legacy_codes, note, created_by)
    VALUES (?, ?, ?, 'new', NULL, ?, 'seed')`);
  const added = [], skipped = [];
  db.transaction(() => {
    for (const f of R0313_FLAVORS) {
      const hasFlavor = byFlavor.get(f.flavor);
      if (hasFlavor) { skipped.push(`${f.flavor} (already on the register as ${hasFlavor.code})`); continue; }
      const hasCode = byCode.get(f.code);
      if (hasCode) { skipped.push(`${f.flavor} (${f.code} already means ${hasCode.flavor})`); continue; }
      ins.run(uuid(), f.flavor, f.code, R0313_NOTE);
      added.push(`${f.flavor}=${f.code}`);
    }
    db.prepare('INSERT INTO app_settings (key, value) VALUES (?, ?)').run(FLAG, JSON.stringify({ at: new Date().toISOString(), added, skipped }));
  })();
  if (added.length) console.log(`[seed] Flavour codes (R-0313): filed ${added.length} — ${added.join(', ')}`);
  if (skipped.length) console.warn(`[seed] Flavour codes (R-0313): skipped ${skipped.length} — ${skipped.join('; ')}`);
  return { added, skipped };
}
