// Starter COA specifications, seeded as DRAFTS.
//
// The Specifications tab starts empty, so an uploaded lab result has nothing to
// grade itself against — the test that has no spec is the one that quietly
// passes. This gives QA a head start: for every item the plant has actually
// sent to a lab, the standard panel is filed as a draft to review.
//
// Two rules decide what goes in, and they are the whole design:
//
//   1. A DRAFT CAN NEVER GRADE A RESULT. Drafts are `is_active = 0`, and every
//      grading path already reads `is_active = 1` — so this is a property of
//      the existing code, not a promise made here. `approval_status = 'draft'`
//      is what tells a draft apart from a spec somebody retired.
//
//   2. A NUMBER IS ONLY SEEDED WHERE A PUBLISHED STANDARD GIVES ONE THAT DOES
//      NOT DEPEND ON THE ITEM. Gluten-free is 20 ppm because FDA says so.
//      USP <2021> gives microbial counts for oral products containing raw
//      material of natural origin. Heavy metals do NOT get a number: USP
//      <2232> sets a limit per DAILY DOSE, and turning that into a per-gram
//      limit needs this item's serving size — so the requirement is written
//      out and the number is left for QA to fill in. Seeding a plausible ppm
//      figure that someone rubber-stamps is worse than seeding none: it would
//      grade real product against a number nobody chose.
//
// Everything item-specific (potency, minerals, moisture targets, probiotic
// counts) is deliberately absent. A specification for those is a decision
// about the product, and this file has no business guessing it.

import { randomUUID as uuid } from 'crypto';

const USP2021 = 'USP <2021> — oral products containing raw material of natural origin';

export const GENERIC_SPECS = [
  // ── Microbiological ──────────────────────────────────────────────────────
  {
    test_type: 'Total Aerobic Microbial Count (USP)',
    unit: 'cfu/g',
    max_value: 10000,
    specification: '≤ 10,000 cfu/g',
    method: USP2021,
  },
  {
    test_type: 'Rapid Yeast and Mold',
    unit: 'cfu/g',
    max_value: 1000,
    specification: '≤ 1,000 cfu/g',
    method: USP2021,
  },
  {
    test_type: 'Total Coliforms (BAM) (MOD)',
    unit: 'cfu/g',
    max_value: 10,
    specification: '≤ 10 cfu/g',
    method: 'FDA BAM (modified)',
  },
  // Pathogens are a presence/absence result, not a count — no numeric limit to
  // set, and the requirement is the same for every product.
  {
    test_type: 'E. Coli BAM (MOD)',
    specification: 'Negative in 10 g',
    method: 'FDA BAM (modified)',
  },
  {
    test_type: 'Salmonella',
    specification: 'Negative in 25 g',
    method: 'FDA BAM',
  },
  {
    test_type: 'Staphylococcus aureus <2022>',
    specification: 'Absent in 10 g',
    method: 'USP <2022>',
  },

  // ── Heavy metals ─────────────────────────────────────────────────────────
  // No numbers on purpose — see rule 2 above.
  ...['Arsenic', 'Cadmium', 'Mercury', 'Lead'].map(metal => ({
    test_type: metal,
    unit: 'ppm',
    specification: `Per USP <2232> daily-dose limit (As 15, Cd 5, Pb 5, Hg 15 µg/day). Enter the per-gram limit for this item's serving size before approving.`,
    method: 'ICP-MS',
    needs_limit: true,
  })),

  // ── Composition & identity ───────────────────────────────────────────────
  {
    test_type: 'Gluten',
    unit: 'ppm',
    max_value: 20,
    specification: '< 20 ppm (FDA "gluten-free" labelling threshold)',
    method: 'R5 ELISA (AOAC 2012.01)',
  },
  {
    test_type: 'FTIR ID',
    specification: 'Conforms to reference standard',
    method: 'FTIR',
  },
  {
    test_type: 'Allergens',
    specification: 'Not detected for allergens not declared on the label',
    method: 'ELISA',
  },
];

// Items the plant has actually sent to a lab. Seeding against those rather
// than inventing a template item means an approved draft is immediately the
// spec a real result grades against.
function itemsNeedingSpecs(db, limit) {
  return db.prepare(`
    SELECT r.item_number, MAX(r.item_description) AS item_description, COUNT(*) AS requests
    FROM coa_requests r
    WHERE r.item_number IS NOT NULL AND TRIM(r.item_number) != ''
    GROUP BY r.item_number
    ORDER BY requests DESC
    LIMIT ?`).all(limit);
}

// Idempotent on (item_number, test_type) across EVERY status — a draft QA
// discarded must stay discarded, and one they approved and later retired must
// not come back on the next deploy. The row surviving is what makes that work,
// which is why discard never deletes.
// `limit` is the number of ITEMS, most-tested first — 754 items × 13 tests is
// a review queue nobody opens twice. The 50 items the lab sees most are where
// auto-grading actually pays, and because this is idempotent, raising the
// number later only files what's still missing.
export function seedGenericSpecifications(db, { limit = 50 } = {}) {
  let items;
  try { items = itemsNeedingSpecs(db, limit); } catch { return 0; }
  if (!items.length) return 0;

  const exists = db.prepare('SELECT 1 FROM coa_specifications WHERE item_number = ? AND test_type = ? LIMIT 1');
  const ins = db.prepare(`INSERT INTO coa_specifications
    (id, item_number, item_description, test_type, specification, unit, min_value, max_value, method,
     is_active, approval_status, source, created_by)
    VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, 0, 'draft', 'seed:generic', 'system')`);

  let added = 0;
  const tx = db.transaction(() => {
    for (const item of items) {
      for (const s of GENERIC_SPECS) {
        if (exists.get(item.item_number, s.test_type)) continue;
        ins.run(uuid(), item.item_number, item.item_description || item.item_number, s.test_type,
          s.specification || null, s.unit || null, s.max_value ?? null, s.method || null);
        added++;
      }
    }
  });
  tx();
  if (added > 0) console.log(`[seed] Filed ${added} draft COA specification(s) across ${items.length} item(s) for QA review`);
  return added;
}
