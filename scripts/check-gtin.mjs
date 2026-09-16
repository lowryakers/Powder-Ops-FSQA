#!/usr/bin/env node
/**
 * One GS1 number, one spelling.
 *
 * Pure: the normaliser, the check digit, the readiness fact, the prefix count
 * and the one-off repair — no server, no network. Run with `npm run check`.
 *
 * THE CONTROL that matters: make `normalizeGtin` return its input unchanged
 * and this fails on the padded cases, the repair, the staleness comparison and
 * the capacity count — which is the whole bug, in four places at once.
 */
import Database from 'better-sqlite3';
import { normalizeGtin, sameGtin, isPaddedGtin, gtinValid, checkDigit } from '../shared/gtin.js';
import { FACTS } from '../shared/product-readiness.js';
import { rebaseGtinBasis } from '../server/gtin-repair.js';

let pass = 0; const fails = [];
const ok = (name, cond) => { if (cond) pass++; else fails.push(name); };
const eq = (name, a, b) => ok(`${name} (got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)})`, a === b);

// ── The number, and its spellings ───────────────────────────────────────────
const UPC = '850079939226';           // a real bottle draft
const PADDED14 = `00${UPC}`;          // its GTIN-14 form, same check digit
const PADDED13 = `0${UPC}`;           // its EAN-13 form, same check digit

eq('G-01 a 14-digit zero-padded UPC-A un-pads', normalizeGtin(PADDED14), UPC);
eq('G-02 a 13-digit zero-padded UPC-A un-pads', normalizeGtin(PADDED13), UPC);
eq('G-03 a bare UPC-A is untouched', normalizeGtin(UPC), UPC);
// A UPC-A that genuinely starts with 0 keeps it — stripping would leave 11
// digits, which is not a GTIN at all.
eq('G-04 a 12-digit UPC-A beginning 0 keeps its zero', normalizeGtin('012345678905'), '012345678905');
// The indicator digit is what makes a GTIN-14 a DIFFERENT number: a case, not
// the consumer unit. Never touched.
eq('G-05 a real GTIN-14 (indicator 1) is untouched', normalizeGtin('10850079939223'), '10850079939223');
eq('G-06 a GTIN-8 is untouched', normalizeGtin('96385074'), '96385074');
eq('G-07 blank stays blank', normalizeGtin(null), '');
eq('G-08 a non-numeric value is returned as given', normalizeGtin('85007-99392'), '85007-99392');
ok('G-09 normalising is idempotent', normalizeGtin(normalizeGtin(PADDED14)) === UPC);
ok('G-10 the padded form is reported as padded', isPaddedGtin(PADDED14) && !isPaddedGtin(UPC));

// This is WHY nothing ever objected: both spellings check out.
ok('G-11 the padded form passes its check digit, exactly as the bare one does',
  gtinValid(PADDED14) && gtinValid(UPC));
eq('G-12 the check digit is the GS1 mod-10', checkDigit('85007993922'), 6);
ok('G-13 a wrong check digit is still refused', !gtinValid('850079939227'));

// ── Cross-checked against two MIT-licensed third-party validators ──────────
//
// enorganic/gtin (MIT) — https://github.com/enorganic/gtin — bundles its own
// documented (body, check-digit) pairs in tests/test_gtin.py. Reused here
// VERBATIM, so `checkDigit` is being checked against an independent
// implementation's fixtures, not just its own. All ten already agreed before
// this file was touched, which is worth having on record.
//
// ericblade/barcode-validator (MIT) —
// https://github.com/ericblade/barcode-validator — a Node/JS validator for
// ISBN10/13, UPC and GTIN. It ships no bundled test fixtures of its own (its
// package.json's `test` script is a stub), so nothing from it is reused as a
// vector; it stays cited as the library ReadyDoc's own gtin.js would be
// weighed against if this were ever pulled in as a dependency instead of kept
// in-house (see docs/github-reuse-scan-powder-ops-2026-09.md).
//
// NEITHER LIBRARY IMPLEMENTS D-090's NORMALIZATION, and that is not a gap —
// it is a different job. enorganic's own `GTIN` class does the OPPOSITE
// operation to `normalizeGtin`: given a short body it PADS UP to the nearest
// standard length and appends a fresh check digit (its own tests show
// `GTIN(raw="01234567890")` — 11 digits — becoming "012345678905", a 12-digit
// number with a NEW check digit computed for it). `normalizeGtin` never
// invents a check digit and never pads; it only ever strips padding that is
// ALREADY there on a number whose check digit already checks out, and only
// down to 12 digits, never past a real GTIN-14 indicator (1–8). A generic
// validator has no opinion on which of two equally-valid spellings should be
// the one ReadyDoc stores — that opinion is D-090, and it is not for sale
// from a third-party checksum library. Nothing here changes `normalizeGtin`.
const THIRD_PARTY_CHECK_DIGIT_VECTORS = [
  // [body, expected check digit] — from enorganic/gtin tests/test_gtin.py
  ['890123456789', 0], ['10101', 1], ['567898901234', 2], ['82957399425', 3],
  ['5936663101', 4], ['15059928976', 5], ['901234567890', 6], ['36013101', 7],
  ['123456789012', 8], ['208957399425', 9],
];
for (const [body, want] of THIRD_PARTY_CHECK_DIGIT_VECTORS) {
  eq(`G-13a enorganic/gtin vector: checkDigit('${body}') === ${want}`, checkDigit(body), want);
}
// The same source's full-number pair (body + its correct check digit, and the
// same body with the check digit changed) — a known-good/known-bad GTIN-14
// pair rather than a bare check-digit arithmetic check.
ok("G-13b enorganic/gtin's own valid GTIN-14 passes gtinValid", gtinValid('02345678901289'));
ok("G-13c the same number with only its check digit changed is refused", !gtinValid('02345678901281'));

// ── Two spellings are one number ────────────────────────────────────────────
ok('G-14 the same number written two ways compares equal', sameGtin(PADDED14, UPC));
ok('G-15 two different numbers do not', !sameGtin(UPC, '850079939219'));
// A blank is a gap, never an agreement — an image with no number recorded must
// keep reading as stale rather than as matching.
ok('G-16 a blank never matches', !sameGtin('', '') && !sameGtin(UPC, null));

// ── The readiness fact is the number, not how it was typed ──────────────────
eq('G-17 the GTIN fact is normalised',
  FACTS.gtin({ gtin: PADDED14 }), FACTS.gtin({ gtin: UPC }));

// ── The stored basis is re-spelt with the column ────────────────────────────
const basis = JSON.stringify({
  artwork: { at: '2026-01-01', by: 'Maria', deps: { gtin: PADDED14, sku: 'BEF-BTL-CSG' } },
  shopify: { at: '2026-01-01', by: 'Maria', deps: { gtin: UPC, sku: 'BEF-BTL-CSG' } },
});
const rebased = JSON.parse(rebaseGtinBasis(basis) || '{"artwork":{"deps":{}},"shopify":{"deps":{}}}');
eq('G-18 a padded basis is re-spelt', rebased.artwork.deps.gtin, UPC);
eq('G-19 the rest of the basis is untouched', rebased.artwork.deps.sku, 'BEF-BTL-CSG');
eq('G-20 a basis that needs nothing reports nothing',
  rebaseGtinBasis(JSON.stringify({ shopify: { deps: { gtin: UPC } } })), null);
eq('G-21 unreadable basis is left alone', rebaseGtinBasis('{not json'), null);

// ── The repair, on a real table ─────────────────────────────────────────────
const db = new Database(':memory:');
db.exec(`CREATE TABLE products (
  sku TEXT PRIMARY KEY, gtin TEXT UNIQUE, gtin_valid INTEGER NOT NULL DEFAULT 0,
  barcode_gtin TEXT, readiness_basis TEXT, updated_at TEXT);
  CREATE TABLE audit_log (id INTEGER PRIMARY KEY AUTOINCREMENT, actor TEXT, action TEXT,
  entity_type TEXT, entity_id TEXT, details TEXT, created_at TEXT DEFAULT (datetime('now')));`);
const ins = db.prepare('INSERT INTO products (sku, gtin, gtin_valid, barcode_gtin, readiness_basis) VALUES (?,?,?,?,?)');
ins.run('BEF-BTL-CSG', PADDED14, 1, PADDED14, basis);
ins.run('BEF-BTL-TFC', '00850079939233', 1, null, null);
ins.run('WHY-PLG-BLM', '850046726019', 1, '850046726019', null);   // already right
ins.run('BEF-BTL-VNL', null, 0, null, null);                        // a draft with no number

const { repairPaddedGtins } = await import('../server/gtin-repair.js');
const first = repairPaddedGtins(db);
eq('G-22 both padded rows were un-padded', first.fixed.length, 2);
const csg = db.prepare("SELECT * FROM products WHERE sku = 'BEF-BTL-CSG'").get();
eq('G-23 the catalogue now holds the UPC-A', csg.gtin, UPC);
eq('G-24 the barcode image is recorded against the same spelling', csg.barcode_gtin, UPC);
eq('G-25 the check digit still holds', csg.gtin_valid, 1);
eq('G-26 the readiness basis moved with it',
  JSON.parse(csg.readiness_basis).artwork.deps.gtin, UPC);
eq('G-27 a row that was already right is untouched',
  db.prepare("SELECT gtin FROM products WHERE sku = 'WHY-PLG-BLM'").get().gtin, '850046726019');
eq('G-28 a product with no number is left alone',
  db.prepare("SELECT gtin FROM products WHERE sku = 'BEF-BTL-VNL'").get().gtin, null);
// The step was signed off against this number and the number has not changed,
// so nothing may read stale afterwards.
eq('G-29 the basis and the column agree afterwards',
  FACTS.gtin(csg), JSON.parse(csg.readiness_basis).artwork.deps.gtin);

// Idempotent by construction: a normalised number normalises to itself.
eq('G-30 a second run changes nothing', repairPaddedGtins(db).fixed.length, 0);

// A collision is a person's decision, never a seeder's.
db.prepare('UPDATE products SET gtin = ? WHERE sku = ?').run('00850046726019', 'BEF-BTL-VNL');
const clash = repairPaddedGtins(db);
eq('G-31 a row whose bare form is on another SKU is skipped', clash.fixed.length, 0);
eq('G-32 …and is reported by name', (clash.skipped[0] || {}).sku, 'BEF-BTL-VNL');
eq('G-33 …and keeps exactly what it had',
  db.prepare("SELECT gtin FROM products WHERE sku = 'BEF-BTL-VNL'").get().gtin, '00850046726019');

// ── GS1 capacity counts the number, not the spelling ────────────────────────
const { gtinPrefixes } = await import('../server/product-shelf.js');
db.prepare('UPDATE products SET gtin = ? WHERE sku = ?').run('00850046726026', 'BEF-BTL-VNL');
const prefixes = gtinPrefixes(db);
const p850046726 = prefixes.find((p) => p.prefix === '850046726') || { used: 0, capacity: 0 };
eq('G-34 a padded number is counted against its prefix', p850046726.used, 2);
eq('G-35 …and against the same capacity as any other', p850046726.capacity, 100);

console.log(`${pass} passed, ${fails.length} failed`);
for (const f of fails) console.log('  FAIL', f);
process.exit(fails.length ? 1 : 0);
