// ONE LIMIT BOX, READ ON THE SERVER (D-310). PURE: text in, min/max out.
//
// The specification form had three boxes — a free-text "Specification", a Min
// and a Max — and they could say three different things. 13 active specs on
// item 201177 carry text only, which grades nothing. One box now, in the words
// QA already writes: "NMT 1.0", "< 1.0", "<= 10,000", "NLT 95", "absent",
// "range 10-20". It is read into min/max here, the meaning is echoed back, and
// text that cannot be read is REFUSED rather than stored as words that grade
// nothing. The grader compares inclusively (a result equal to a maximum
// passes), so "< 1.0" is graded as "at most 1.0" and the echo says so.
//
// Existing text-only active specs are LISTED (textOnlySpecs), never edited.

const NUM = String.raw`[-+]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?`;
const num = (s) => Number(String(s).replace(/,/g, ''));
const TAIL = String.raw`(?:\s*[a-zA-Zµ%/°][\w%/°µ.\s]*)?`; // a unit after the number is allowed and ignored (the unit has its own box)

const fmt = (n) => (Number.isInteger(n) ? n.toLocaleString('en-US') : String(n));

const RULES = [
  { re: new RegExp(String.raw`^(?:absent|negative|not\s*detected|none\s*detected|nd)\b.*$`, 'i'),
    build: (_m, raw) => ({ min_value: null, max_value: null, text: raw.trim().replace(/^./, c => c.toUpperCase()),
      meaning: 'Must be absent / not detected. A "not detected" result passes; a "detected" one fails.' }) },
  { re: new RegExp(String.raw`^(?:range\s+|between\s+)?(${NUM})\s*(?:-|–|—|to|and)\s*(${NUM})${TAIL}$`, 'i'),
    build: (m) => {
      const a = num(m[1]); const b = num(m[2]);
      if (!(a < b)) return { error: `A range runs from the lower number to the higher one ("${m[1]}" to "${m[2]}" does not).` };
      return { min_value: a, max_value: b, text: `${fmt(a)} – ${fmt(b)}`, meaning: `Between ${fmt(a)} and ${fmt(b)}, both included.` };
    } },
  { re: new RegExp(String.raw`^(?:nmt|not\s+more\s+than|max(?:imum)?|≤|<=|=<)\s*:?\s*(${NUM})${TAIL}$`, 'i'),
    build: (m) => ({ min_value: null, max_value: num(m[1]), text: `NMT ${fmt(num(m[1]))}`, meaning: `At most ${fmt(num(m[1]))}. A result of exactly ${fmt(num(m[1]))} passes.` }) },
  { re: new RegExp(String.raw`^(?:<|less\s+than|under)\s*(${NUM})${TAIL}$`, 'i'),
    build: (m) => ({ min_value: null, max_value: num(m[1]), text: `< ${fmt(num(m[1]))}`,
      meaning: `Under ${fmt(num(m[1]))}. Graded as at most ${fmt(num(m[1]))}: a result of exactly ${fmt(num(m[1]))} passes.` }) },
  { re: new RegExp(String.raw`^(?:nlt|not\s+less\s+than|min(?:imum)?|≥|>=|=>)\s*:?\s*(${NUM})${TAIL}$`, 'i'),
    build: (m) => ({ min_value: num(m[1]), max_value: null, text: `NLT ${fmt(num(m[1]))}`, meaning: `At least ${fmt(num(m[1]))}. A result of exactly ${fmt(num(m[1]))} passes.` }) },
  { re: new RegExp(String.raw`^(?:>|more\s+than|over|greater\s+than)\s*(${NUM})${TAIL}$`, 'i'),
    build: (m) => ({ min_value: num(m[1]), max_value: null, text: `> ${fmt(num(m[1]))}`,
      meaning: `Over ${fmt(num(m[1]))}. Graded as at least ${fmt(num(m[1]))}: a result of exactly ${fmt(num(m[1]))} passes.` }) },
];

/**
 * Read a limit written the way QA writes it. Returns
 * { ok: true, min_value, max_value, text, meaning } or { ok: false, error }.
 */
export function parseLimit(input) {
  const raw = String(input ?? '').replace(/\s+/g, ' ').trim();
  if (!raw) return { ok: false, error: 'Write the limit, for example "NMT 1.0", "< 10,000", "NLT 95", "absent" or "range 10-20".' };
  for (const r of RULES) {
    const m = raw.match(r.re);
    if (!m) continue;
    const out = r.build(m, raw);
    if (out.error) return { ok: false, error: out.error };
    return { ok: true, ...out };
  }
  return { ok: false, error: `"${raw}" cannot be read as a limit. Write it as "NMT 1.0", "< 1.0", "<= 10,000", "NLT 95", "absent" or "range 10-20".` };
}

/** Active specifications that carry words and no number, so grade nothing numeric. Listed, never edited. */
export function textOnlySpecs(db) {
  return db.prepare(`SELECT id, item_number, item_description, test_type, specification, unit FROM coa_specifications
    WHERE is_active = 1 AND min_value IS NULL AND max_value IS NULL AND specification IS NOT NULL AND TRIM(specification) != ''
    ORDER BY item_number, test_type`).all()
    .filter(s => !/^(absent|negative|not\s*detected|none\s*detected|nd)\b/i.test(s.specification.trim()));
}
