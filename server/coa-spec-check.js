// Specifications that cannot be right (D-225).
//
// The only active specs on the live database were malformed: on item 202532
// the heavy metals carried a MINIMUM (0.001 ppm), so a clean 0.0005 ppm arsenic
// graded FAIL; the pathogens read min -1 / max 10 with no unit; aerobic count
// read min 100 / max 50,000, so a clean 50 cfu/g failed and "<10" passed.
//
// `specProblems` is the rule, pure. `retireMalformedSpecs` applies it ONCE per
// database to the one item the review named, by RETIRING the rows (is_active =
// 0, the same act as the Retire button) — never deleting them and never
// guessing a corrected number. Quality re-enters the limit. Every other item's
// malformed specs are reported at boot, not touched.
import { aliasKey } from './coa-grade.js';

const CONTAMINANT = new Set(['arsenic', 'cadmium', 'mercury', 'lead', 'tamc', 'tymc', 'coliforms', 'e coli', 'e coli o157',
  'salmonella', 'staphylococcus aureus', 'listeria spp', 'listeria monocytogenes', 'gluten', 'gluten r5', 'gluten g12', 'gliadin']);
const MICRO = new Set(['tamc', 'tymc', 'coliforms', 'e coli', 'e coli o157', 'salmonella', 'staphylococcus aureus',
  'listeria spp', 'listeria monocytogenes']);

/** What is wrong with one specification row; empty when nothing provably is. */
export function specProblems(s) {
  const key = aliasKey(s.test_type);
  const out = [];
  const min = s.min_value; const max = s.max_value;
  if (min != null && min < 0) out.push('a negative minimum');
  if (min != null && max != null && min > max) out.push('a minimum above its maximum');
  if (key && CONTAMINANT.has(key) && min != null) out.push('a minimum on a contaminant, so a clean result fails');
  if (key && MICRO.has(key) && (min != null || max != null) && !String(s.unit || '').trim()) out.push('a numeric micro limit with no unit');
  return out;
}

export const REPAIR_ITEM = '202532';
const MARKER = 'coa_spec_202532_retired_v1';

export function retireMalformedSpecs(db, logAudit) {
  const out = { retired: [], reported: [] };
  const active = db.prepare('SELECT * FROM coa_specifications WHERE is_active = 1').all();
  for (const s of active) {
    const problems = specProblems(s);
    if (!problems.length) continue;
    if (s.item_number === REPAIR_ITEM) out.retired.push({ s, problems });
    else out.reported.push({ item_number: s.item_number, test_type: s.test_type, problems });
  }
  const done = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(MARKER);
  if (done) { out.retired = []; return out; }
  if (!db.prepare('SELECT 1 FROM coa_specifications LIMIT 1').get()) return out; // nothing seeded yet; try next boot
  db.transaction(() => {
    const upd = db.prepare("UPDATE coa_specifications SET is_active = 0, updated_at = datetime('now') WHERE id = ?");
    for (const { s, problems } of out.retired) {
      upd.run(s.id);
      logAudit?.('system', 'delete', 'coa_specification', s.id,
        { reason: `Retired by ReadyDoc: ${problems.join('; ')}. Quality re-enters the limit (D-225).`, problems },
        s, { ...s, is_active: 0 }, `${s.item_number} · ${s.test_type}`);
    }
    db.prepare("INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)").run(MARKER, new Date().toISOString());
  })();
  out.retired = out.retired.map(({ s, problems }) => ({ item_number: s.item_number, test_type: s.test_type, problems }));
  return out;
}
