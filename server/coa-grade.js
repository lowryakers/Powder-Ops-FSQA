// Grading a lab result against the plant's specification.
//
// The first version parsed the result with `parseFloat` and compared it to
// min/max. That answers a minority of a real CoA: microbiological results are
// written "<10", "Not Detected", "ND", "Absent in 25g", "Negative", and
// `parseFloat("<10")` is NaN — so every micro test on a report came back with
// no verdict at all, and a result nobody graded sits on the record looking
// exactly like one that passed.
//
// Pure and exported on its own so the PREVIEW and the WRITE grade identically.
// A preview computed differently from the commit is a preview that lies, and
// this one is shown to somebody deciding whether to accept a lab result.
//
// THE HARD RULE HERE: there are three outcomes, not two. `pass`, `fail`, and
// **null — could not be decided**. Null is the honest answer for a result whose
// relationship to the limit the app cannot establish, and it must never be
// quietly rendered as either of the others. `reason` says which case it is so
// the row can explain itself instead of showing an empty cell.

const NEGATIVE_WORDS = /\b(not\s*detected|non[\s-]?detect(?:ed)?|nd|absent|negative|none\s*detected|no\s*growth|<\s*1\s*(cfu|est)?)\b/i;
const ND_ABBREV = /^n\.?\s?d\.?$/i;
const POSITIVE_WORDS = /\b(detected|present|positive|growth)\b/i;
const PASS_WORDS = /\b(pass(?:ed)?|complies|comply|conforms?|conforming|acceptable|satisfactory)\b/i;
// Checked BEFORE the pass words, so "does not comply" / "non conform" can
// never read as a pass (D-222).
const FAIL_WORDS = /\b(fail(?:ed)?|does\s*not\s*(?:comply|conform|meet)|not\s*compliant|non[\s-]?(?:conform|compli)\w*|out\s*of\s*spec\w*|unacceptable)\b/i;

/**
 * A number as printed. A comma is a thousands separator ONLY in the
 * 1,300 / 6,564.814 shape; anything else with a comma ("0,5", "12,5") is a
 * European decimal or a typo, and reading "0,5" as 5 is a tenfold error on a
 * heavy metal. Those are refused, not guessed (D-222).
 *
 * Scientific notation is read IN FULL (D-227): 1.3e3, 1.3E+03, 1.3x10^3,
 * 1.3×10^3 and 1.3×10³ are all 1300. The first cut read "1.3e3" as 1.3 with a
 * unit of "e3" and passed it against ≤10,000 whatever the exponent said — so
 * 1.3e5 passed too. A number is never read from only the front of a token.
 */
const SUPERSCRIPT = { '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4', '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9', '⁻': '-', '⁺': '+' };
// The mantissa, then an optional exponent written any of the ways a lab prints one.
const NUM_TOKEN = String.raw`[\d.,]+(?:\s*[eE]\s*[+-]?\d+|\s*[x×X*]\s*10\s*(?:\^\s*[+-]?\d+|[⁺⁻]?[⁰¹²³⁴⁵⁶⁷⁸⁹]+))?`;
// What a unit may start with — never a stray exponent ("e3", "x10").
const UNIT_TOKEN = String.raw`[a-zA-Z%µμ/][\w%µμ/ ]*`;
const LOOKS_LIKE_EXPONENT = /^(?:[eE]\s*[+-]?\d|[eE]$|[xX×]\s*10\b)/;

function readNumber(tok) {
  const t = String(tok).replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻]/g, c => SUPERSCRIPT[c]);
  const m = t.match(/^([\d.,]+)(?:\s*[eE]\s*([+-]?\d+)|\s*[x×X*]\s*10\s*\^?\s*([+-]?\d+))?$/);
  if (!m) return { value: NaN };
  const mant = m[1];
  const exp = m[2] ?? m[3];
  let value;
  if (mant.includes(',')) {
    if (!/^[1-9]\d{0,2}(,\d{3})+(\.\d+)?$/.test(mant)) return { ambiguous: true };
    value = Number(mant.replace(/,/g, ''));
  } else {
    if (!/^(\d+(\.\d+)?|\.\d+)$/.test(mant)) return { value: NaN };
    value = Number(mant);
  }
  if (exp != null) value = Number((value * 10 ** Number(exp)).toPrecision(12));
  return { value };
}

/** The number in a result, whether it was written as a bound ("<10", "≥5"), and any unit printed beside it. */
export function parseResult(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return { kind: 'empty' };

  // A bound: "<10", "< 10 cfu/g", "≤10", ">300", "≥ 5", "<1.0x10^1".
  const bound = s.match(new RegExp(`^([<>]=?|[≤≥])\\s*(${NUM_TOKEN})\\s*(${UNIT_TOKEN})?$`));
  // A plain number, possibly with a unit stuck to it ("35 cfu/g", "1.3E+03 cfu/g").
  const plain = bound ? null : s.match(new RegExp(`^(${NUM_TOKEN})\\s*(${UNIT_TOKEN})?$`));
  const hit = bound || plain;
  if (hit) {
    const numTok = bound ? bound[2] : plain[1];
    const unit = (bound ? bound[3] : plain[2])?.trim() || null;
    // A "unit" that is really the tail of the number means the number was not
    // read in full. Refuse rather than grade the front of it.
    if (unit && LOOKS_LIKE_EXPONENT.test(unit)) return { kind: 'unreadable_number' };
    const n = readNumber(numTok);
    if (n.ambiguous) return { kind: 'ambiguous_decimal' };
    if (Number.isFinite(n.value)) {
      if (bound) {
        const op = bound[1];
        return { kind: 'bound', value: n.value, below: op === '<' || op === '<=' || op === '≤', unit };
      }
      return { kind: 'number', value: n.value, unit };
    }
    if (/^[\d.,]/.test(s)) return { kind: 'unreadable_number' };
  }
  // Starts like a number but the regexes could not take all of it ("1.3e", "2..5").
  if (/^([<>]=?|[≤≥])?\s*\d/.test(s) && /\d\s*[eE×xX^]|\.\./.test(s)) return { kind: 'unreadable_number' };

  if (FAIL_WORDS.test(s)) return { kind: 'stated_fail' };
  if (ND_ABBREV.test(s) || NEGATIVE_WORDS.test(s)) return { kind: 'negative' };
  if (POSITIVE_WORDS.test(s)) return { kind: 'positive' };
  if (PASS_WORDS.test(s)) return { kind: 'stated_pass' };
  return { kind: 'unparsed' };
}

/**
 * Units, so "2 ppm" is never compared with a limit of "500 ppb" as if they were
 * the same number (D-222). Each family converts to one base; two units in
 * different families, or an unknown unit that is not literally the same as the
 * spec's, is a MISMATCH and the result is not graded.
 */
const UNIT_FAMILIES = {
  mass: { ppm: 1, 'mg/kg': 1, 'ug/g': 1, ppb: 0.001, 'ug/kg': 0.001, 'ng/g': 0.001, ppt: 1e-6, 'ng/kg': 1e-6, 'mg/g': 1000, '%': 10000, 'g/100g': 10000, 'mg/100g': 10 },
  count_g: { 'cfu/g': 1 },
  count_ml: { 'cfu/ml': 1 },
  mpn_g: { 'mpn/g': 1 },
};
export function normalizeUnit(u) {
  const s = String(u ?? '').trim().toLowerCase()
    .replace(/[µμ]/g, 'u').replace(/mcg/g, 'ug').replace(/\s*per\s*/g, '/').replace(/\s+/g, '');
  if (!s) return null;
  if (s === '%w/w' || s === 'percent') return '%';
  return s;
}
export function unitFactor(u) {
  const n = normalizeUnit(u);
  if (!n) return null;
  for (const [family, units] of Object.entries(UNIT_FAMILIES)) if (units[n] != null) return { family, factor: units[n], unit: n };
  return { family: null, factor: null, unit: n };
}
/** How to express a value in `resultUnit` in the spec's unit: `{ scale }`, or `{ mismatch }`. The grader refuses a missing unit before asking (D-229). */
export function unitScale(resultUnit, specUnit) {
  const r = unitFactor(resultUnit); const sp = unitFactor(specUnit);
  if (!r || !sp) return { scale: 1 };
  if (r.unit === sp.unit) return { scale: 1 };
  if (r.family && r.family === sp.family) return { scale: r.factor / sp.factor };
  return { mismatch: `${resultUnit} cannot be compared with ${specUnit}` };
}

/** Does the spec's own wording ask for absence? ("Negative", "Absent in 25g") */
function specWantsAbsence(spec) {
  const text = `${spec?.specification || ''} ${spec?.unit || ''}`;
  return NEGATIVE_WORDS.test(text);
}

function limitText(spec) {
  if (spec?.specification) return String(spec.specification);
  if (spec?.min_value != null && spec?.max_value != null) return `${spec.min_value} – ${spec.max_value}`;
  if (spec?.max_value != null) return `≤ ${spec.max_value}`;
  if (spec?.min_value != null) return `≥ ${spec.min_value}`;
  return 'no limit recorded';
}

/**
 * Grade one result.
 *
 * @param resultValue  what the lab reported, as written
 * @param spec         the ACTIVE coa_specifications row, or null
 * @param stated       a pass/fail the report itself printed, if any
 * @returns { pass_fail: 'pass'|'fail'|null, graded_by, reason }
 */
export function gradeResult(resultValue, spec, stated = null, opts = {}) {
  const verdict = gradeAgainstSpec(resultValue, spec, opts);
  // A verdict the report printed. It may FAIL a result, never rescue one: a
  // "pass" on the lab's paper against a limit our specification fails is a
  // fail (D-222). Where the specification cannot decide, the stated verdict
  // stands — the caller only passes one printed beside a real limit.
  if (stated === 'fail') return { pass_fail: 'fail', graded_by: 'report', reason: 'The lab report states this result failed.' };
  if (stated === 'pass') {
    if (verdict.pass_fail === 'fail') return { ...verdict, reason: `${verdict.reason} (The report printed a pass; the specification decides.)` };
    if (verdict.pass_fail === 'pass') return verdict;
    return { pass_fail: 'pass', graded_by: 'report', reason: 'The lab report states this result.' };
  }
  return verdict;
}

function gradeAgainstSpec(resultValue, spec, opts = {}) {
  const parsed = parseResult(resultValue);
  if (parsed.kind === 'empty') {
    return { pass_fail: null, graded_by: null, reason: 'No result recorded yet.' };
  }
  if (parsed.kind === 'unreadable_number') {
    return { pass_fail: null, graded_by: null, reason: `"${resultValue}" could not be read in full as a number, so it is not graded. Re-enter it (for example 1300, 1.3e3 or 1.3x10^3).` };
  }
  if (parsed.kind === 'ambiguous_decimal') {
    return { pass_fail: null, graded_by: null, reason: `"${resultValue}" uses a comma where a decimal point or thousands separator is ambiguous. Re-enter it with a decimal point.` };
  }

  // A result that states its own verdict in words, with no spec needed.
  if (parsed.kind === 'stated_pass') return { pass_fail: 'pass', graded_by: 'report', reason: 'The result itself reads as a pass.' };
  if (parsed.kind === 'stated_fail') return { pass_fail: 'fail', graded_by: 'report', reason: 'The result itself reads as a failure.' };

  if (!spec) {
    return {
      pass_fail: null, graded_by: null,
      reason: 'No active specification on file for this test, so there is nothing to grade it against. Add and approve one in the Specifications tab.',
    };
  }

  // Units before numbers: the result's own unit (the row's, else one printed
  // in the value) against the specification's.
  //
  // Two refusals were added in D-229. A value that prints its own unit
  // ("2.5 mg/g") beside a unit column saying something else has two units and
  // neither can be trusted. And a number with no unit against a limit that has
  // one (or the reverse) is not compared raw — "0.5" against "≤ 1 ppm" might be
  // 0.5 ppb or 0.5 %. Qualitative results (Absent, Not Detected) never reach here.
  if (parsed.kind === 'number' || parsed.kind === 'bound') {
    const colUnit = String(opts.unit ?? '').trim() || null;
    if (colUnit && parsed.unit && normalizeUnit(colUnit) !== normalizeUnit(parsed.unit)) {
      return { pass_fail: null, graded_by: null, reason: `Unit mismatch: the value says ${parsed.unit} but the unit column says ${colUnit}. Not graded — correct one of them.` };
    }
    const resultUnit = colUnit || parsed.unit || null;
    const specUnit = String(spec.unit ?? '').trim() || null;
    if (!resultUnit !== !specUnit) {
      return { pass_fail: null, graded_by: null, reason: resultUnit
        ? `Unit not stated: the result is in ${resultUnit} but the specification has no unit. Not graded — add the unit to the specification.`
        : `Unit not stated: the specification is in ${specUnit} but the result has no unit. Not graded — add the unit to the result.` };
    }
    const u = unitScale(resultUnit, specUnit);
    if (u.mismatch) return { pass_fail: null, graded_by: null, reason: `Unit mismatch: ${u.mismatch}. Not graded — check the unit on the result or the specification.` };
    if (u.scale !== 1) parsed.value = Number((parsed.value * u.scale).toPrecision(12));
  }

  const limit = limitText(spec);

  // Qualitative: the spec asks for absence and the result reports absence.
  if (parsed.kind === 'negative') {
    if (specWantsAbsence(spec) || spec.max_value != null) {
      return { pass_fail: 'pass', graded_by: 'specification', reason: `Nothing detected, against ${limit}.` };
    }
    return { pass_fail: null, graded_by: null, reason: `The result is qualitative ("not detected") but the specification is ${limit} — decide this one by hand.` };
  }
  if (parsed.kind === 'positive') {
    if (specWantsAbsence(spec)) {
      return { pass_fail: 'fail', graded_by: 'specification', reason: `Detected, against ${limit}.` };
    }
    return { pass_fail: null, graded_by: null, reason: `The result is qualitative ("detected") but the specification is ${limit} — decide this one by hand.` };
  }

  if (parsed.kind === 'unparsed') {
    return { pass_fail: null, graded_by: null, reason: `This result could not be read as a number or as a detected/not-detected answer. Set the pass/fail by hand.` };
  }

  const { min_value: min, max_value: max } = spec;
  if (min == null && max == null) {
    return { pass_fail: null, graded_by: null, reason: `The specification records no numeric limit (${limit}), so a number cannot be graded against it.` };
  }

  // A BOUND is not a measurement, and this is where a naive compare goes wrong.
  //
  // "<10 cfu/g" means the count was under the method's detection limit of 10.
  // Against a maximum of 10,000 that is comfortably a pass. Against a maximum
  // of 5 it proves NOTHING — the true value could be 2 or 9 — so the honest
  // answer is "undecided", not a fail. Calling it a fail would reject good
  // product; calling it a pass would accept unproven product.
  if (parsed.kind === 'bound') {
    if (parsed.below) {
      if (max != null && parsed.value <= max) {
        return { pass_fail: 'pass', graded_by: 'specification', reason: `Below the detection limit of ${parsed.value}, which is within ${limit}.` };
      }
      if (min != null && max == null) {
        return { pass_fail: null, graded_by: null, reason: `"${resultValue}" is an upper bound and the specification is a minimum (${limit}) — it cannot be decided automatically.` };
      }
      return {
        pass_fail: null, graded_by: null,
        reason: `"${resultValue}" only says the result is under ${parsed.value}, which does not prove it meets ${limit}. Decide this one by hand.`,
      };
    }
    // A lower bound (">300", "≥5") — an estimate above the countable range.
    if (max != null && parsed.value >= max) {
      return { pass_fail: 'fail', graded_by: 'specification', reason: `At least ${parsed.value}, which exceeds ${limit}.` };
    }
    if (min != null && parsed.value >= min && max == null) {
      return { pass_fail: 'pass', graded_by: 'specification', reason: `At least ${parsed.value}, which meets ${limit}.` };
    }
    return { pass_fail: null, graded_by: null, reason: `"${resultValue}" is a lower bound and cannot be placed against ${limit} automatically.` };
  }

  const v = parsed.value;
  if (min != null && max != null) {
    return v >= min && v <= max
      ? { pass_fail: 'pass', graded_by: 'specification', reason: `${v} is within ${limit}.` }
      : { pass_fail: 'fail', graded_by: 'specification', reason: `${v} is outside ${limit}.` };
  }
  if (max != null) {
    return v <= max
      ? { pass_fail: 'pass', graded_by: 'specification', reason: `${v} is within ${limit}.` }
      : { pass_fail: 'fail', graded_by: 'specification', reason: `${v} exceeds ${limit}.` };
  }
  return v >= min
    ? { pass_fail: 'pass', graded_by: 'specification', reason: `${v} meets ${limit}.` }
    : { pass_fail: 'fail', graded_by: 'specification', reason: `${v} is below ${limit}.` };
}

/**
 * Match a reported test name to a specification.
 *
 * Labs and specifications never spell a test the same way — "Total Aerobic
 * Microbial Count (USP)" against "Total Aerobic Plate Count", "E. Coli BAM
 * (MOD)" against "E. coli". An exact match finds almost nothing, so this
 * normalises punctuation, drops the method in brackets, and falls back to a
 * small table of the names this industry genuinely uses interchangeably.
 *
 * It will not guess beyond that: an unmatched test is reported as having no
 * specification, which is a true statement someone can act on.
 */
// EXACT names only, after normalising and dropping a trailing method word
// (D-222). Substring matching filed "Iron as ferrous fumarate" under Arsenic,
// "Gluten, G12 ELISA" under an R5 spec, "E. coli O157:H7" under generic E. coli
// and "Listeria monocytogenes" under "Listeria spp." — each a different test.
// A name nothing here recognises is unmatched, which is a true statement.
const ALIASES = [
  ['tamc', 'total aerobic microbial', 'total aerobic microbial count', 'total aerobic plate', 'total aerobic plate count', 'total plate', 'total plate count', 'aerobic plate', 'aerobic plate count', 'standard plate', 'standard plate count', 'apc', 'tpc', 'tvc', 'total aerobic', 'total aerobic count'],
  ['tymc', 'yeast and mold', 'yeast and mould', 'yeasts and molds', 'yeasts and moulds', 'rapid yeast and mold', 'total yeast and mold', 'total yeast and mould', 'yeast mold', 'yeast mould', 'y m'],
  ['e coli', 'e coli', 'escherichia coli', 'generic e coli'],
  ['e coli o157', 'e coli o157 h7', 'e coli o157', 'escherichia coli o157 h7', 'escherichia coli o157'],
  ['coliforms', 'total coliforms', 'coliform', 'total coliform', 'coliforms'],
  ['salmonella', 'salmonella', 'salmonella spp', 'salmonella species'],
  ['staphylococcus aureus', 'staphylococcus aureus', 's aureus', 'staph aureus', 'coagulase positive staphylococcus'],
  ['listeria spp', 'listeria', 'listeria spp', 'listeria species'],
  ['listeria monocytogenes', 'listeria monocytogenes', 'l monocytogenes'],
  ['bacillus subtilis', 'bacillus subtilis', 'b subtilis'],
  ['arsenic', 'arsenic', 'as', 'total arsenic', 'arsenic as', 'arsenic total', 'arsenic nmt'],
  ['cadmium', 'cadmium', 'cd', 'cadmium cd', 'cadmium nmt'],
  ['mercury', 'mercury', 'hg', 'mercury hg', 'mercury nmt'],
  ['lead', 'lead', 'pb', 'lead pb', 'lead nmt'],
  ['gluten', 'gluten', 'gluten allergen', 'total gluten'],
  ['gluten r5', 'gluten r5', 'r5 gluten', 'gluten allergen r5'],
  ['gluten g12', 'gluten g12', 'g12 gluten', 'gluten allergen g12'],
  ['gliadin', 'gliadin'],
  ['moisture', 'moisture', 'loss on drying', 'lod'],
];
const METHOD_TAIL = new Set(['bam', 'mod', 'usp', 'aoac', 'fda', 'iso', 'elisa', 'icp', 'ms', 'icpms', 'petrifilm', 'method']);

export function normalizeTestName(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/\((?:usp|bam|mod|aoac|fda|iso)[^)]*\)/g, ' ') // method callouts
    .replace(/<\s*\d+\s*>/g, ' ')                            // USP chapter refs "<2022>"
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\b(test|testing|analysis|count|assay)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripMethod(n) {
  const words = n.split(' ');
  while (words.length > 1 && METHOD_TAIL.has(words[words.length - 1])) words.pop();
  return words.join(' ');
}

const ALIAS_KEY = new Map();
for (const [key, ...names] of ALIASES) {
  for (const a of names) {
    const n = stripMethod(normalizeTestName(a));
    if (n && !ALIAS_KEY.has(n)) ALIAS_KEY.set(n, key);
  }
}

/** The test a name means, or null. Exact match on the normalised name, never a substring. */
export function aliasKey(name) {
  const n = normalizeTestName(name);
  if (!n) return null;
  return ALIAS_KEY.get(n) || ALIAS_KEY.get(stripMethod(n)) || null;
}

/** Build a lookup from the item's specs, keyed every way a report might name them. */
export function specIndex(specs) {
  const byName = new Map();
  const byAlias = new Map();
  for (const s of specs || []) {
    const n = normalizeTestName(s.test_type);
    if (n && !byName.has(n)) byName.set(n, s);
    const a = aliasKey(s.test_type);
    if (a && !byAlias.has(a)) byAlias.set(a, s);
  }
  return {
    find(testName) {
      const n = normalizeTestName(testName);
      if (n && byName.has(n)) return byName.get(n);
      const a = aliasKey(testName);
      if (a && byAlias.has(a)) return byAlias.get(a);
      return null;
    },
  };
}
