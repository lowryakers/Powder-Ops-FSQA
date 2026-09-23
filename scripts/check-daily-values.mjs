#!/usr/bin/env node
/**
 * % Daily Value, recomputed — the arithmetic, on its own.
 *
 * Pure: no server, no database, no network. This is the number the plant will
 * argue with a printer about, so it has to be checkable without standing
 * anything up (partner-recon.js and coa-submission.js draw the same line).
 *
 * THE CONTROL that matters: delete the `micro` branch of `roundDv` — make
 * every nutrient round to the nearest whole percent — and D-06 through D-09
 * fail. That is the trap in this whole feature: Calcium 150 mg computes to
 * 11.5%, which is 10% under the mineral increment rule and 12% under the
 * macronutrient one, so the wrong rule flags almost every correct panel on
 * this line. A warning that fires on good panels is one people learn to
 * dismiss, which costs more than the check is worth.
 */
import { DAILY_VALUES, readAmount, roundDv, computeDv, checkDailyValues } from '../shared/nutrition-dv.js';

let pass = 0; const fails = [];
const ok = (name, cond) => { if (cond) pass++; else fails.push(name); };
const eq = (name, a, b) => ok(`${name} (got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)})`, a === b);

// ── Reading an amount as the panel writes it ────────────────────────────────
eq('D-01 a plain number reads as itself', readAmount(570)?.value, 570);
eq('D-02 a numeric string reads as a number', readAmount('570')?.value, 570);
eq('D-03 "<1" reads as the bound 1', readAmount('<1')?.value, 1);
ok('D-04 and is marked bounded', readAmount('<1')?.bounded === true);
ok('D-05 a blank is NOT zero — it is nothing', readAmount('') === null && readAmount(null) === null);
// A blank read as 0 would make every unfilled row declare itself 0% and the
// declared figure a mismatch: the fabricated-record refusal in a smaller hat.
ok('D-05b and neither is undefined or a word', readAmount(undefined) === null && readAmount('n/a') === null);

// ── The rounding rule, which is where this feature lives or dies ────────────
eq('D-06 a macronutrient rounds to the nearest whole percent', roundDv(11.5, 'macro'), 12);
eq('D-07 a mineral at 11.5% rounds DOWN to 10 (nearest 5), not to 12', roundDv(11.5, 'micro'), 10);
eq('D-08 a mineral at or under 10% rounds to the nearest 2', roundDv(8.6, 'micro'), 8);
eq('D-09 a mineral over 50% rounds to the nearest 10', roundDv(63, 'micro'), 60);
// The band is chosen on the RAW percentage, before any rounding — 10.4% is
// "over 10" and takes the 5% step, not the 2% one.
eq('D-10 the band is decided before rounding, not after', roundDv(10.4, 'micro'), 10);

// ── The three that are in artwork right now ────────────────────────────────
eq('D-11 Sodium 570 mg computes to 25%', computeDv('sodium', 570).pct, 25);
eq('D-12 Saturated Fat 0 g computes to 0%', computeDv('saturated_fat', 0).pct, 0);
// The spec that asked for this said 3%; 1/28 is 3.571%, which rounds to 4.
// Either way the declared 8% is wrong, but the computed figure printed beside
// it has to be the one this code actually derives.
eq('D-13 Dietary Fiber <1 g computes to 4% (1/28 = 3.57%)', computeDv('dietary_fiber', '<1').pct, 4);
eq('D-14 Calcium 150 mg computes to 10%', computeDv('calcium', 150).pct, 10);

// ── The warnings, on a whole panel ─────────────────────────────────────────
const BAD = { saturated_fat_g: 0, saturated_fat_dv: 5, sodium_mg: 570, sodium_dv: 21,
              dietary_fiber_g: '<1', dietary_fiber_dv: 8, calcium_mg: 150, calcium_dv: 10 };
const bad = checkDailyValues(BAD);
const by = (n) => bad.find((w) => w.nutrient === n);
eq('D-15 the bad panel raises exactly three', bad.length, 3);
ok('D-16 Saturated Fat 0 g at 5% is one of them', !!by('saturated_fat'));
ok('D-17 and the note says zero cannot be 5% of anything', /zero cannot be/i.test(by('saturated_fat')?.note || ''));
eq('D-18 Sodium 570 mg at 21% reports the computed 25', by('sodium')?.computed_dv, 25);
eq('D-19 Dietary Fiber <1 g at 8% reports the computed 4', by('dietary_fiber')?.computed_dv, 4);
ok('D-20 CALCIUM 150 mg AT 10% RAISES NOTHING — the regression this exists for', !by('calcium'));

// A bounded amount is a CEILING, not an equality: "<1 g" of fibre is somewhere
// below a gram, so anything at or under the bound's %DV is consistent with it
// and only a higher figure is provably wrong.
eq('D-21 "<1" fibre declared at 3% is accepted — under the bound',
  checkDailyValues({ dietary_fiber_g: '<1', dietary_fiber_dv: 3 }).length, 0);
eq('D-22 "<1" fibre declared at 4% is accepted — at the bound',
  checkDailyValues({ dietary_fiber_g: '<1', dietary_fiber_dv: 4 }).length, 0);
eq('D-23 "<1" fibre declared at 5% is refused — above it',
  checkDailyValues({ dietary_fiber_g: '<1', dietary_fiber_dv: 5 }).length, 1);

// An incomplete panel is a gap somebody fills in, not a defect. Flagging every
// blank row would bury the three that are real.
eq('D-24 a nutrient with no declared %DV raises nothing',
  checkDailyValues({ sodium_mg: 570 }).length, 0);
eq('D-25 an empty panel raises nothing', checkDailyValues({}).length, 0);
// But a %DV declared with NO amount is a real defect — the panel is claiming a
// percentage of something it does not say it contains.
eq('D-26 a %DV declared with no amount IS reported',
  checkDailyValues({ sodium_dv: 11 }).length, 1);
eq('D-27 and it reports no computed figure rather than inventing one',
  checkDailyValues({ sodium_dv: 11 })[0].computed_dv, null);

// A good panel must be silent, or nobody reads the warnings on a bad one.
const GOOD = { total_fat_g: 0.5, total_fat_dv: 1, saturated_fat_g: 0, saturated_fat_dv: 0,
               cholesterol_mg: '<5', cholesterol_dv: 1, sodium_mg: 260, sodium_dv: 11,
               total_carbohydrate_g: 4, total_carbohydrate_dv: 1,
               dietary_fiber_g: '<1', dietary_fiber_dv: 2, added_sugars_g: 0, added_sugars_dv: 0,
               vitamin_d_mcg: 0, vitamin_d_dv: 0, calcium_mg: 150, calcium_dv: 10,
               iron_mg: 0.3, iron_dv: 0, potassium_mg: 40, potassium_dv: 0 };
eq('D-28 the contract\'s own example panel raises nothing at all',
  checkDailyValues(GOOD).length, 0);

// The Daily Values are a published regulatory reference, not a setting.
eq('D-29 Sodium DV is 2300 mg', DAILY_VALUES.sodium.dv, 2300);
eq('D-30 Calcium DV is 1300 mg and it is a mineral', `${DAILY_VALUES.calcium.dv}/${DAILY_VALUES.calcium.kind}`, '1300/micro');
eq('D-31 Dietary Fiber DV is 28 g and it is a macronutrient', `${DAILY_VALUES.dietary_fiber.dv}/${DAILY_VALUES.dietary_fiber.kind}`, '28/macro');

console.log(`\n${pass} passed, ${fails.length} failed`);
for (const f of fails) console.log('  ✗ ' + f);
process.exit(fails.length ? 1 : 0);
