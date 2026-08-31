// File the flavour codes the plant is already printing, and open the bottle
// packaging spec.
//
// The codes are DERIVED from the live product rows by `flavor-codes.js` rather
// than typed here: every one of them is already on film somewhere, and a list
// re-keyed by hand is a list with a typo in it. Where the derivation cannot
// decide — two flavours whose only abbreviation is the same — NOTHING IS FILED
// for either, and the pair is reported so a person can break the tie. Inventing
// an abbreviation that then gets printed is the one outcome worth avoiding.
//
// Insert-only and keyed per flavour, the seedControlledForms shape: a code
// somebody corrected by hand, or a decision they made about a collision, must
// survive every redeploy.

import { randomUUID as uuid } from 'crypto';
import { resolveFlavorCodes } from './flavor-codes.js';

/** The bottling line's spec. */
const BOTTLE_SPEC = {
  spec_id: 'SPEC-BOTTLE',
  name: 'Protein Bottle',
  format: 'Bottle',
  // EVERY FILM FIELD IS DELIBERATELY NULL. A bottle has no trim, no gusset, no
  // wind direction and no front-panel dimension; leaving them empty is the
  // record saying "this does not apply", and filling them with zeros would make
  // the spec sheet read as though somebody measured a bottle in millimetres of
  // film. The vendor, cost and closure are unknown until it is quoted — named
  // in `notes` rather than guessed.
  material_structure: null,
  zipper: null,
  print_process: null,
  trim_length_mm: null,
  trim_width_mm: null,
  gusset_mm: null,
  front_panel_mm: null,
  wind_direction: null,
  core_in: null,
  // A bottle label is die-cut, so this stays true until the vendor says
  // otherwise — the artwork-proofing service reads it.
  dieline_required: 1,
  vendor: null,
  last_unit_cost: null,
  vendor_spec_string: null,
  notes: 'Bottling line — opened before the vendor is chosen. Fill in bottle size, '
    + 'closure, label stock, vendor and unit cost when it is quoted. A SECOND BOTTLE SIZE '
    + 'GETS ITS OWN SPEC (SPEC-BOTTLE-SM and so on): one spec is one component, one price '
    + 'tier and one purchase order, which is why the pouches are already split large/small.',
};

/**
 * The collisions the plant broke, recorded verbatim with the reason.
 *
 * These are DECISIONS, not derivations — three codes each meant two flavours
 * and no amount of reading the existing SKUs could say which one moves. Filed
 * here so they survive a fresh database, and insert-only like everything else,
 * so a later correction by hand is never overwritten.
 *
 * Filing these also settles the OTHER side of each pair: once Café Mocha is
 * CFM, Chocolate Mousse is the only claimant left on CM and the derivation
 * picks it up on its own. That is why this runs before the derived pass.
 */
const DECIDED = [
  {
    flavor: 'Salted Caramel', code: 'SLC', legacy: ['SCR', 'SC'],
    note: 'Chosen over SCR because SC stays with Sugar Cookie, and SC/SCR differ by '
      + 'one character and sort adjacent — a misread waiting to happen on a PO line.',
  },
  {
    flavor: 'Vanilla Cream', code: 'VCR', legacy: ['VC'],
    note: 'VC stays with Vanilla Cone, which has more SKUs and sits in a protein line. '
      + 'VNL is Frosted Vanilla and VB is Vanilla Bean, so VCR was free.',
  },
  {
    flavor: 'Café Mocha', code: 'CFM', legacy: ['CM'],
    note: 'CM stays with Chocolate Mousse — whey is the larger line and CM reads with '
      + 'the rest of the chocolate family (CH, CPB, CCC, DCH).',
  },
  // The CS pair, which only became visible once the oatmeal cups' trailing
  // serials were stripped and POC-CS3 could be read as CS.
  {
    flavor: 'Cinnamon Swirl', code: 'CS', legacy: [],
    note: 'Keeps CS. Cinnamon Spice moves to CSP.',
  },
  {
    flavor: 'Cinnamon Spice', code: 'CSP', legacy: ['CS'],
    note: 'Moved off CS, which Cinnamon Swirl keeps — it has more SKUs (pancake and cupcake).',
  },
  {
    // `PCCM-V-04` carried a one-letter code, which the SKU format does not
    // accept: 26 combinations is not an abbreviation space.
    flavor: 'Vanilla', code: 'VAN', legacy: ['V'],
    note: 'V was a single letter, which the SKU format refuses. VB, VC, VCR and VNL '
      + 'are all taken by other vanillas, so VAN.',
  },
  {
    // Daily Recharge's rows carried the PRODUCT NAME in the flavour field
    // ("Daily Recharge", "Daily Recharge 20ct"). Its actual flavour is Tropical
    // Paradise, which is what the artwork says.
    flavor: 'Tropical Paradise', code: 'TRP', legacy: [],
    note: 'Daily Recharge\'s flavour. The rows previously carried the product name '
      + 'in the flavour field, which is why it had no code.',
  },
];

/**
 * Two Daily Recharge rows named the PRODUCT in their flavour field.
 *
 * `base_flavor` is what the flavour register joins on, so "Daily Recharge 20ct"
 * being in it meant the product's real flavour — Tropical Paradise, as printed
 * on both the stick and the pouch — had no code and neither row could resolve.
 *
 * Idempotent and targeted: it matches only the exact wrong values, so a row
 * somebody has since corrected by hand is left alone, and re-running changes
 * nothing. The DISPLAY name in `flavor` is untouched — that is what the
 * catalogue shows and it reads correctly already.
 */
const BASE_FLAVOR_FIXES = [
  { sku: 'DR-20', from: 'Daily Recharge 20ct', to: 'Tropical Paradise' },
  { sku: 'DR-SP', from: 'Daily Recharge', to: 'Tropical Paradise' },
];

export function repairBaseFlavors(db) {
  const upd = db.prepare('UPDATE products SET base_flavor = ? WHERE sku = ? AND base_flavor = ?');
  let fixed = 0;
  for (const f of BASE_FLAVOR_FIXES) fixed += upd.run(f.to, f.sku, f.from).changes;
  if (fixed) console.log(`[seed] Products: corrected ${fixed} base_flavor value(s) that held a product name`);
  return fixed;
}

export function seedFlavorCodes(db) {
  const rows = db.prepare(
    'SELECT sku, flavor, base_flavor FROM products'
  ).all();
  if (!rows.length) return { skipped: 'no products yet' };

  const seen = db.prepare('SELECT 1 FROM flavor_codes WHERE flavor = ? OR code = ?');
  const insDecided = db.prepare(`INSERT INTO flavor_codes (id, flavor, code, source, legacy_codes, note, created_by)
    VALUES (?, ?, ?, 'decided', ?, ?, 'seed')`);
  let decided = 0;
  db.transaction(() => {
    for (const d of DECIDED) {
      if (seen.get(d.flavor, d.code)) continue;
      insDecided.run(uuid(), d.flavor, d.code, JSON.stringify(d.legacy), d.note);
      decided++;
    }
  })();
  if (decided) console.log(`[seed] Flavour codes: filed ${decided} decided collision-break(s)`);

  // The codes now on file are fed back in, so the flavours those decisions
  // freed (Chocolate Mousse on CM, Vanilla Cone on VC) resolve by themselves.
  const issued = Object.fromEntries(
    db.prepare('SELECT flavor, code FROM flavor_codes WHERE is_active = 1').all().map(r => [r.flavor, r.code]));
  const { resolved, needs_decision } = resolveFlavorCodes(rows, { issued });
  const has = db.prepare('SELECT 1 FROM flavor_codes WHERE flavor = ? OR code = ?');
  const ins = db.prepare(`INSERT INTO flavor_codes (id, flavor, code, source, legacy_codes, note, created_by)
    VALUES (?, ?, ?, 'derived', ?, ?, 'seed')`);

  let added = 0;
  const tx = db.transaction(() => {
    for (const r of resolved) {
      // Per flavour AND per code, so a hand-made decision that already took a
      // code cannot be collided with by a later seed run.
      if (has.get(r.flavor, r.code)) continue;
      const superseded = r.from.filter(c => c !== r.code);
      ins.run(uuid(), r.flavor, r.code,
        superseded.length ? JSON.stringify(superseded) : null,
        `Read from the SKUs already in use — ${r.reason}.`);
      added++;
    }
  });
  tx();

  if (added) console.log(`[seed] Flavour codes: filed ${added}`);
  if (needs_decision.length) {
    // Said out loud at boot rather than left in a table nobody opens: these are
    // the flavours whose bottle SKUs cannot be minted yet.
    console.log(`[seed] Flavour codes: ${needs_decision.length} need a human decision — `
      + needs_decision.map(d => d.flavor).join(', '));
  }
  return { added, needs_decision };
}

export function seedBottleSpec(db) {
  const exists = db.prepare('SELECT 1 FROM packaging_specs WHERE spec_id = ?').get(BOTTLE_SPEC.spec_id);
  if (exists) return { skipped: true };
  const cols = Object.keys(BOTTLE_SPEC);
  db.prepare(`INSERT INTO packaging_specs (${cols.join(', ')}) VALUES (${cols.map(c => `@${c}`).join(', ')})`)
    .run(BOTTLE_SPEC);
  console.log('[seed] Packaging spec: opened SPEC-BOTTLE for the bottling line');
  return { added: 1 };
}
