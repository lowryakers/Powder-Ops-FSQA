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
];

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
