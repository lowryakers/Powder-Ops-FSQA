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

const NEGATIVE_WORDS = /\b(not\s*detected|non[\s-]?detected|nd|absent|negative|none\s*detected|no\s*growth|<\s*1\s*(cfu|est)?)\b/i;
const POSITIVE_WORDS = /\b(detected|present|positive|growth)\b/i;
const PASS_WORDS = /\b(pass(?:ed)?|complies|comply|conforms?|conforming|acceptable|satisfactory)\b/i;
const FAIL_WORDS = /\b(fail(?:ed)?|does\s*not\s*comply|non[\s-]?conform\w*|out\s*of\s*spec\w*|unacceptable)\b/i;

/** The number in a result, and whether it was written as a bound ("<10", "≥5"). */
export function parseResult(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return { kind: 'empty' };

  // A bound: "<10", "< 10 cfu/g", "≤10", ">300", "≥ 5".
  const bound = s.match(/^([<>]=?|[≤≥])\s*([\d.,]+)/);
  if (bound) {
    const n = Number(String(bound[2]).replace(/,/g, ''));
    if (Number.isFinite(n)) {
      const op = bound[1];
      return { kind: 'bound', value: n, below: op === '<' || op === '<=' || op === '≤' };
    }
  }

  // A plain number, possibly with a unit stuck to it ("35 cfu/g", "0.02 ppm").
  const plain = s.match(/^([\d.,]+)\s*(?:[a-zA-Z%µ/]+)?$/);
  if (plain) {
    const n = Number(String(plain[1]).replace(/,/g, ''));
    if (Number.isFinite(n)) return { kind: 'number', value: n };
  }

  if (NEGATIVE_WORDS.test(s)) return { kind: 'negative' };
  if (POSITIVE_WORDS.test(s)) return { kind: 'positive' };
  if (FAIL_WORDS.test(s)) return { kind: 'stated_fail' };
  if (PASS_WORDS.test(s)) return { kind: 'stated_pass' };
  return { kind: 'unparsed' };
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
export function gradeResult(resultValue, spec, stated = null) {
  // The lab's own verdict wins. It is the accredited party and it applied the
  // method; second-guessing it from a transcribed number would be worse.
  if (stated === 'pass' || stated === 'fail') {
    return { pass_fail: stated, graded_by: 'report', reason: 'The lab report states this result.' };
  }

  const parsed = parseResult(resultValue);
  if (parsed.kind === 'empty') {
    return { pass_fail: null, graded_by: null, reason: 'No result recorded yet.' };
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
const ALIASES = [
  ['tamc', 'total aerobic microbial count', 'total aerobic plate count', 'total plate count', 'aerobic plate count', 'standard plate count', 'apc', 'tpc', 'tvc', 'total aerobic count'],
  ['tymc', 'yeast and mold', 'yeasts and molds', 'rapid yeast and mold', 'total yeast and mold', 'yeast mold', 'y&m'],
  ['e coli', 'escherichia coli', 'e coli bam', 'generic e coli'],
  ['coliforms', 'total coliforms', 'coliform', 'total coliform'],
  ['salmonella', 'salmonella spp'],
  ['staphylococcus aureus', 's aureus', 'staph aureus', 'coagulase positive staphylococcus'],
  ['listeria', 'listeria monocytogenes', 'listeria spp'],
  ['bacillus subtilis', 'b subtilis'],
  ['arsenic', 'as'], ['cadmium', 'cd'], ['mercury', 'hg'], ['lead', 'pb'],
  ['gluten', 'gliadin'],
  ['moisture', 'loss on drying', 'lod'],
];

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

function aliasKey(name) {
  const n = normalizeTestName(name);
  if (!n) return null;
  for (const group of ALIASES) {
    for (const alias of group) {
      const a = normalizeTestName(alias);
      if (!a) continue;
      if (n === a || n.startsWith(`${a} `) || n.endsWith(` ${a}`) || n.includes(` ${a} `)) return group[0];
    }
  }
  return null;
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
