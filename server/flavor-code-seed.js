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
  // TWO BEEF CODES WERE DERIVED FROM SKUs MINTED UNDER SUPERSEDED NAMES. The
  // derivation was faithful to the SKU and wrong about the product: HBF-CHU was
  // issued when Cinnamon Sugar was going to be called Churro, and HBF-DDL when
  // Toffee Cream was going to be Dulce de Leche. The legacy SKUs keep those
  // codes — they are on film — and the new standard uses the current names.
  {
    flavor: 'Cinnamon Sugar', code: 'CSG', legacy: ['CHU'],
    note: 'CHU was Churro, the name this flavour was going to have when HBF-CHU was '
      + 'issued. CSG fits the cinnamon family (CS Swirl, CSP Spice, CRL Roll).',
  },
  {
    flavor: 'Toffee Cream', code: 'TFC', legacy: ['DDL'],
    note: 'DDL was Dulce de Leche, the name this flavour was going to have when '
      + 'HBF-DDL was issued. TC was unavailable — it is Toasted Coconut.',
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

  const byFlavor = db.prepare('SELECT * FROM flavor_codes WHERE flavor = ?');
  const byCode = db.prepare('SELECT * FROM flavor_codes WHERE code = ?');
  const insDecided = db.prepare(`INSERT INTO flavor_codes (id, flavor, code, source, legacy_codes, note, created_by)
    VALUES (?, ?, ?, 'decided', ?, ?, 'seed')`);
  const updDecided = db.prepare(`UPDATE flavor_codes
    SET code = ?, source = 'decided', legacy_codes = ?, note = ? WHERE id = ?`);
  let decided = 0, corrected = 0;
  db.transaction(() => {
    for (const d of DECIDED) {
      const existing = byFlavor.get(d.flavor);
      if (!existing) {
        // A different flavour already holds this code — refuse rather than
        // collide. Nothing is issued twice, ever.
        if (byCode.get(d.code)) {
          console.warn(`[seed] Flavour codes: "${d.code}" for ${d.flavor} is held by ${byCode.get(d.code).flavor} — skipped`);
          continue;
        }
        insDecided.run(uuid(), d.flavor, d.code, JSON.stringify(d.legacy), d.note);
        decided++;
        continue;
      }
      if (existing.code === d.code) continue; // already as decided

      // CORRECTING A DERIVATION IS NOT CHANGING AN ISSUED CODE, and the
      // difference is `source`. A DERIVED row was read off a legacy SKU by this
      // seeder — and a SKU minted under a name the flavour no longer has gives a
      // faithful reading of the wrong thing (HBF-CHU was Churro before the
      // flavour became Cinnamon Sugar). Nothing is printed in the new format
      // yet, so no such code is in circulation.
      //
      // A row a PERSON decided or added is never touched here; it is reported
      // and left alone. That is what keeps the append-only guarantee real —
      // this is the register still being established, not a rename.
      if (existing.source !== 'derived') {
        console.warn(`[seed] Flavour codes: ${d.flavor} is ${existing.code} by decision, not ${d.code} — left alone`);
        continue;
      }
      const clash = byCode.get(d.code);
      if (clash && clash.flavor !== d.flavor) {
        console.warn(`[seed] Flavour codes: cannot move ${d.flavor} to "${d.code}" — held by ${clash.flavor}`);
        continue;
      }
      // The superseded code travels with the row, so a legacy SKU still resolves.
      const legacy = [...new Set([...(d.legacy || []), existing.code,
        ...(JSON.parse(existing.legacy_codes || '[]') || [])])].filter(c => c !== d.code);
      updDecided.run(d.code, JSON.stringify(legacy), d.note, existing.id);
      corrected++;
    }
  })();
  if (decided) console.log(`[seed] Flavour codes: filed ${decided} decided collision-break(s)`);
  if (corrected) console.log(`[seed] Flavour codes: corrected ${corrected} derived code(s) read from a superseded flavour name`);

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
