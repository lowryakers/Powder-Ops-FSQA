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
import { hexDigits, hexValid, pmsCode, pmsValid, colorIssues, isBlankSlot,
  channelDelta, conflictSeverity, INFO_TOLERANCE, COLOR_PAIR_DECISIONS } from '../shared/product-colors.js';
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

// ── The corrections ─────────────────────────────────────────────────────────
const find = (sku, slot) => COLOR_CORRECTIONS.find((c) => c.sku === sku && c.slot === slot);
const pumpkin = find('PPM-PS', 2);
ok('C-21 the pancake Pumpkin Spice correction is recorded', !!pumpkin);
eq('C-22 it moves PMS 285 C to PMS 7580 C', `${pumpkin?.from.pms} → ${pumpkin?.to.pms}`, 'PMS 285 C → PMS 7580 C');
// The hex is not changed and is what proves which of the two was wrong.
eq('C-23 the hex it is matched against is the one on the row', pumpkin?.from.hex, 'HEX C25131');
eq('C-23b and is carried through unchanged', pumpkin?.to.hex, 'HEX C25131');
ok('C-24 and every correction says why, in words',
  COLOR_CORRECTIONS.every((c) => (c.reason || '').length > 40));
// The CSV is corrected too, or a fresh database would come up wrong again —
// the repair reaches the volume, the CSV reaches a new deployment.
const slotOf = (sku, slot) => slots.find((r) => r.sku === sku && r.slot === String(slot));
const ppmPs2 = slotOf('PPM-PS', 2);
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

/* ── The other direction: the NAME is right and the HEX is borrowed ──────────
 *
 * Three more corrections, resolved against the artwork PDFs. In the first two
 * the Pantone is correct and the hex beside it belongs to a different ink —
 * the opposite of the Pumpkin Spice case, which is the whole reason a
 * correction has to say which of the two it is moving.
 */
for (const [sku, slot] of [['PP-PC-11', 3], ['PSP-PC', 3]]) {
  const fix = find(sku, slot);
  eq(`C-35 ${sku} slot ${slot}: 9201 C keeps its name`, `${fix?.from.pms}|${fix?.to.pms}`, 'PMS 9201 C|PMS 9201 C');
  eq(`C-36 ${sku} slot ${slot}: and the HEX moves 502C1E → F4E1CB`,
    `${fix?.from.hex}|${fix?.to.hex}`, 'HEX 502C1E|HEX F4E1CB');
  eq(`C-37 ${sku} slot ${slot}: the CSV says so too`, slotOf(sku, slot)?.hex, 'HEX F4E1CB');
}
for (const [sku, slot] of [['PP-IM-07', 2], ['PSP-IM', 2]]) {
  const fix = find(sku, slot);
  eq(`C-38 ${sku} slot ${slot}: 728 C keeps its name`, `${fix?.from.pms}|${fix?.to.pms}`, 'PMS 728 C|PMS 728 C');
  eq(`C-39 ${sku} slot ${slot}: and the HEX moves 9FD560 → C49873`,
    `${fix?.from.hex}|${fix?.to.hex}`, 'HEX 9FD560|HEX C49873');
  eq(`C-40 ${sku} slot ${slot}: the CSV says so too`, slotOf(sku, slot)?.hex, 'HEX C49873');
}

// The Toffee Cream beef rows carry BOTH inks with the correct hex already, and
// are what the sweep was disagreeing with. Untouched, and asserted untouched.
for (const sku of ['42224277749842', 'HBF-DDL']) {
  ok(`C-41 ${sku} is not in the correction list at all`,
    !COLOR_CORRECTIONS.some((c) => c.sku === sku));
}
eq('C-42 and its 9201 C row still reads F4E1CB', slotOf('42224277749842', 3)?.hex, 'HEX F4E1CB');
eq('C-43 and its 728 C row still reads C49873', slotOf('HBF-DDL', 1)?.hex, 'HEX C49873');

/* ── PNS → PMS: the one correction that moves VALIDITY ──────────────────────
 *
 * `PNS 9160 C` is the only one of the four shapes the validator refuses that
 * names a real ink. Correcting the spelling moves `pms_valid` from 0 to 1,
 * which is why validity is re-derived on write rather than carried in the
 * correction — and why the CSV's flag has to move with it, or C-20 fails.
 */
for (const [sku, slot] of [['PP-IM-07', 3], ['PSP-IM', 3]]) {
  const fix = find(sku, slot);
  eq(`C-44 ${sku} slot ${slot}: PNS 9160 C → PMS 9160 C`,
    `${fix?.from.pms} → ${fix?.to.pms}`, 'PNS 9160 C → PMS 9160 C');
  eq(`C-45 ${sku} slot ${slot}: the hex is carried unchanged`,
    `${fix?.from.hex}|${fix?.to.hex}`, 'HEX EDEDB2|HEX EDEDB2');
  ok(`C-46 ${sku} slot ${slot}: THE VALUE WAS UNUSABLE AND IS NOW AN INK`,
    !pmsValid(fix?.from.pms) && pmsValid(fix?.to.pms));
  eq(`C-47 ${sku} slot ${slot}: and the CSV's pms_valid moved with it`,
    `${slotOf(sku, slot)?.pms}|${slotOf(sku, slot)?.pms_valid}`, 'PMS 9160 C|TRUE');
}
ok('C-48 no PNS value is left anywhere in the catalogue',
  !slots.some((r) => /^pns\b/i.test(r.pms || '')));

/* ── The sweep, and the two disagreements somebody checked ──────────────────
 *
 * Both real conflicts are gone once the corrections land. What is left is two
 * pairs a person resolved against the artwork, and the point of the severity
 * split is that they stay on the list while no longer reading as work.
 */
const byPms = new Map();
for (const r of slots) {
  if (!pmsValid(r.pms) || !hexValid(r.hex)) continue;
  if (!byPms.has(r.pms)) byPms.set(r.pms, []);
  byPms.get(r.pms).push(r);
}
const pairs = [];
for (const [pms, list] of byPms) {
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const v = conflictSeverity(pms, list[i].hex, list[j].hex);
      if (v.delta > 16) pairs.push({ pms, ...v });
    }
  }
}
eq('C-49 NOT ONE DISAGREEMENT IS LEFT UNANSWERED after the corrections',
  pairs.filter((p) => p.severity === 'warn').length, 0);
ok('C-50 the two that remain are 123 C and 375 C, both reported as info',
  pairs.length > 0 && [...new Set(pairs.map((p) => p.pms))].sort().join(', ') === 'PMS 123 C, PMS 375 C',
  JSON.stringify([...new Set(pairs.map((p) => p.pms))]));

eq('C-51 PMS 123 C differs by 17 and drops on the TOLERANCE alone',
  channelDelta('HEX FFC62D', 'HEX FFC43E'), 17);
ok('C-52 which is under the plant\'s 25', 17 <= INFO_TOLERANCE);
ok('C-53 and it needs no recorded decision',
  conflictSeverity('PMS 123 C', 'HEX FFC62D', 'HEX FFC43E').decision === null);

// THE ONE THAT PROVES THE TOLERANCE IS NOT ENOUGH ON ITS OWN.
eq('C-54 PMS 375 C differs by 36 — ABOVE the tolerance', channelDelta('HEX 91D500', 'HEX 95D324'), 36);
eq('C-55 so it drops to info only because a person CHECKED IT',
  conflictSeverity('PMS 375 C', 'HEX 91D500', 'HEX 95D324').severity, 'info');
ok('C-56 and the decision carries who checked it and why',
  !!conflictSeverity('PMS 375 C', 'HEX 91D500', 'HEX 95D324').decision?.decided_by
  && (conflictSeverity('PMS 375 C', 'HEX 91D500', 'HEX 95D324').decision?.reason || '').length > 40);
ok('C-57 A DECISION IS PAIR-SPECIFIC — the same Pantone against a THIRD colour still warns',
  conflictSeverity('PMS 375 C', 'HEX 91D500', 'HEX FF0000').severity === 'warn');
ok('C-58 and every recorded decision names the two hexes it settles',
  COLOR_PAIR_DECISIONS.every((d) => d.hexes.length === 2 && d.decided_by && d.decided_at));
ok('C-59 a pair over the tolerance with no decision is WARN',
  conflictSeverity('PMS 9201 C', 'HEX 502C1E', 'HEX F4E1CB').severity === 'warn');
ok('C-60 and an unreadable hex never quietly reads as agreement',
  conflictSeverity('PMS 158 C', 'HEX F43BF', 'HEX EE7623').severity === 'warn');

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
