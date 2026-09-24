#!/usr/bin/env node
/**
 * Brand colours: the validator, and the one correction.
 *
 * Pure — no server, no database, no network.
 *
 * THE ASSERTION THAT MATTERS is C-20: the validator's verdict on all 312
 * seeded slots must equal the audit's own TRUE/FALSE, every one. Validity is
 * re-derived on every write now, so a rule that disagreed with the audit by
 * even one row would silently reclassify somebody else's transcription the
 * first time anybody saved that product.
 *
 * THE CONTROL: drop the `^pms\s` requirement from `pmsCode` and C-20 fails —
 * the six rows the audit marked invalid because they say PNS or CMYK start
 * reading as usable Pantone references.
 */
import fs from 'fs';
import { hexDigits, hexValid, pmsCode, pmsValid, colorIssues, isBlankSlot } from '../shared/product-colors.js';
import { COLOR_CORRECTIONS, rebaseColorBasis } from '../server/product-color-repair.js';

let pass = 0; const fails = [];
const ok = (name, cond) => { if (cond) pass++; else fails.push(name); };
const eq = (name, a, b) => ok(`${name} (got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)})`, a === b);

// ── The hex value ───────────────────────────────────────────────────────────
eq('C-01 a plain six-digit hex reads', hexDigits('EE7623'), 'EE7623');
eq('C-02 the HEX prefix the catalogue writes is read, not rewritten', hexDigits('HEX EE7623'), 'EE7623');
eq('C-03 so is the HX spelling two rows use', hexDigits('HX FF9015'), 'FF9015');
eq('C-04 and a leading #', hexDigits('#EE7623'), 'EE7623');
ok('C-05 five digits is not a colour', !hexValid('HEX F43BF'));
ok('C-06 seven digits is not a colour', !hexValid('HEX E613B24'));
ok('C-07 "4E2CID" has an I in it and is not hex', !hexValid('HEX 4E2CID'));
ok('C-08 a blank is not a colour', !hexValid('') && !hexValid(null) && !hexValid(undefined));

// ── The Pantone reference ───────────────────────────────────────────────────
eq('C-09 a numbered Pantone reads', pmsCode('PMS 158 C'), '158 C');
eq('C-10 an uncoated one reads', pmsCode('PMS 9224 U'), '9224 U');
eq('C-11 so does a named one', pmsCode('PMS Black C'), 'Black C');
eq('C-12 and one with no suffix', pmsCode('PMS 4625'), '4625');
ok('C-13 "PMS --" is a slot nobody filled in, not an ink', !pmsValid('PMS --'));
ok('C-14 "PNS 9160 C" is a typo, not a Pantone', !pmsValid('PNS 9160 C'));
// A process build is not a spot ink. Letting it through would put a value on
// the master feed that the proofing service then tries to match a PDF
// separation NAME against, which no file can ever satisfy.
ok('C-15 "CMYK 3 1 17 0" is a process build, not a spot colour', !pmsValid('CMYK 3 1 17 0'));
ok('C-16 N/A and TBD are placeholders', !pmsValid('PMS N/A') && !pmsValid('PMS TBD'));

// ── What the person typing is told ──────────────────────────────────────────
eq('C-17 a good pair says nothing', colorIssues({ pms: 'PMS 158 C', hex: 'HEX EE7623' }).length, 0);
eq('C-18 an empty row says nothing — it is a line nobody filled in', colorIssues({ pms: '', hex: '' }).length, 0);
ok('C-18b and is recognised as blank', isBlankSlot({ pms: '', hex: '  ' }) && !isBlankSlot({ pms: 'PMS 158 C' }));
eq('C-19 a bad pair names both problems', colorIssues({ pms: 'PNS 9160 C', hex: 'HEX F43BF' }).length, 2);

// ── Agreement with the audit, on every seeded slot ──────────────────────────
const text = fs.readFileSync(new URL('../server/seed-data/sku_colors.csv', import.meta.url), 'utf8')
  .replace(/\r/g, '').trim().split('\n');
const head = text[0].split(',');
const slots = text.slice(1).map((l) => {
  const cells = l.split(',');
  return Object.fromEntries(head.map((h, i) => [h, cells[i]]));
});
const disagree = slots.filter((r) =>
  pmsValid(r.pms) !== (r.pms_valid === 'TRUE') || hexValid(r.hex) !== (r.hex_valid === 'TRUE'));
ok(`C-20 THE VALIDATOR AGREES WITH THE AUDIT ON ALL ${slots.length} SEEDED SLOTS`
  + (disagree.length ? ` — ${disagree.length} disagree, first: ${JSON.stringify(disagree[0])}` : ''),
  slots.length > 300 && disagree.length === 0);

// ── The correction ──────────────────────────────────────────────────────────
const pumpkin = COLOR_CORRECTIONS.find((c) => c.sku === 'PPM-PS' && c.slot === 2);
ok('C-21 the pancake Pumpkin Spice correction is recorded', !!pumpkin);
eq('C-22 it moves PMS 285 C to PMS 7580 C', `${pumpkin?.from_pms} → ${pumpkin?.to_pms}`, 'PMS 285 C → PMS 7580 C');
// The hex is not changed and is what proves which of the two was wrong.
eq('C-23 the hex it is matched against is the one on the row', pumpkin?.hex, 'HEX C25131');
ok('C-24 and the reason says why, in words', (pumpkin?.reason || '').length > 40);
// The CSV is corrected too, or a fresh database would come up wrong again —
// the repair reaches the volume, the CSV reaches a new deployment.
const ppmPs2 = slots.find((r) => r.sku === 'PPM-PS' && r.slot === '2');
eq('C-25 THE SOURCE CSV IS CORRECTED, so a fresh database is right as well', ppmPs2?.pms, 'PMS 7580 C');
eq('C-26 and its hex is untouched', ppmPs2?.hex, 'HEX C25131');

// Every OTHER row carrying 285 is a genuine PANTONE 285 C — a blue — and is
// left exactly as it is. This is the check the correction was asked to make.
const two85 = slots.filter((r) => /\b285\b/.test(r.pms || ''));
eq('C-27 exactly two rows still carry PMS 285 C', two85.length, 2);
ok('C-28 BOTH ARE BLUE (0071CE) and are correct — nothing else was touched',
  two85.every((r) => hexDigits(r.hex) === '0071CE'),
  JSON.stringify(two85.map((r) => `${r.sku} ${r.hex}`)));
ok('C-29 and neither is the pancake', two85.every((r) => r.sku !== 'PPM-PS'));

// ── Rebasing the readiness fact ─────────────────────────────────────────────
// The ink never moved — only ReadyDoc's transcription of its name — so the
// artwork step must NOT read "the brand colours moved" after the correction.
const basis = JSON.stringify({
  artwork: { at: '2026-01-01T00:00:00Z', by: 'QA', deps: { colors: 'A:1,B:2' } },
  colors: { at: '2026-01-01T00:00:00Z', by: 'QA', deps: { colors: 'A:1,B:2' } },
});
const moved = rebaseColorBasis(basis, 'A:1,B:2', 'A:1,C:2');
ok('C-30 the stored basis moves with the correction', !!moved);
eq('C-31 on every step that depended on the colours',
  JSON.parse(moved).artwork.deps.colors, 'A:1,C:2');
eq('C-32 and the signature on the step is untouched',
  JSON.parse(moved).artwork.by, 'QA');
ok('C-33 a basis recorded against something ELSE is left alone',
  rebaseColorBasis(basis, 'X:9', 'Y:9') === null);
ok('C-34 and so is an unparseable one', rebaseColorBasis('not json', 'a', 'b') === null);

console.log(`\n${pass} passed, ${fails.length} failed`);
for (const f of fails) console.log('  ✗ ' + f);
process.exit(fails.length ? 1 : 0);
