// FORM 602-01 V2: the organoleptic test is a check against a written
// specification, attribute by attribute, pass or fail.
//
// ONE DEFINITION, BOTH SIDES. The server refuses to text an approval whose
// tasting has not been recorded, the log decides which button to offer on the
// same fact, the PDF prints the result, and the disposal draft is raised from
// it — so if these were copies they would drift, and the drift would look like
// the app refusing an action it had just offered.
//
// V2 (the plant's own form): APPEARANCE · ODOR · TASTE · COLOR · TEXTURE, each
// with the product's SPECIFICATION beside it, a RESULT (what was seen) and
// P / F. There is no 1–5 anywhere on the form, so there is none here.
//
// V1 records (appearance · texture · aroma · flavor · overall, scored 1–5) are
// on file and stay readable: `aroma` and `flavor` are RETIRED keys, never
// reused for `odor` and `taste`, because relabelling history as answers to a
// question nobody asked is the one thing a form change must never do.

export const SENSORY_ATTRIBUTES = [
  { key: 'appearance', label: 'Appearance' },
  { key: 'odor', label: 'Odor' },
  { key: 'taste', label: 'Taste' },
  { key: 'color', label: 'Color' },
  { key: 'texture', label: 'Texture' },
];
export const SENSORY_KEYS = SENSORY_ATTRIBUTES.map(a => a.key);
export const SENSORY_LABELS = SENSORY_ATTRIBUTES.map(a => [a.key, a.label]);
// The RESULT column — what the evaluator actually saw, in their words.
export const sensoryNoteKey = (k) => `${k}_result`;
export const SENSORY_RESULTS = ['pass', 'fail'];
export const RESULT_LABELS = { pass: 'Matches spec', fail: 'Does not match' };

// V1, kept for reading filed records only.
export const LEGACY_SENSORY_KEYS = ['appearance', 'texture', 'aroma', 'flavor', 'overall'];
export const LEGACY_SENSORY_LABELS = [
  ['appearance', 'Appearance'], ['texture', 'Texture'], ['aroma', 'Aroma'], ['flavor', 'Flavor'], ['overall', 'Overall'],
];
export const SENSORY_SCORES = ['1', '2', '3', '4', '5'];
const LEGACY_THRESHOLD = 3;

const isResult = (v) => SENSORY_RESULTS.includes(String(v ?? '').trim().toLowerCase());
const isScore = (v) => SENSORY_SCORES.includes(String(v ?? '').trim());

// Which form a record was filed on — decided from its VALUES, because the two
// shapes share the keys `appearance` and `texture`.
export function sensoryShape(rec) {
  if (!rec) return null;
  if (SENSORY_KEYS.some(k => isResult(rec[k]))) return 'v2';
  if (LEGACY_SENSORY_KEYS.some(k => isScore(rec[k]))) return 'v1';
  return null;
}

// A form definition is V2 when it carries the sensory field type. The served
// definition is what controlled.js has APPROVED, so every reader keys off
// this rather than off the code's version — on a database where Document
// Control has not yet approved V2 the app stays coherent on V1.
export const formIsV2 = (fields) => Array.isArray(fields) && fields.some(f => f && f.type === 'sensory');

/**
 * Has the evaluation actually been done? ALL FIVE OR NONE OF IT COUNTS — a
 * record with three answers is a half-finished tasting, and treating it as
 * complete would let a batch go out for approval on an evaluation nobody
 * finished, then file it in the Organoleptic log as though it were whole.
 */
export function sensoryComplete(rec) {
  const shape = sensoryShape(rec);
  if (shape === 'v2') return SENSORY_KEYS.every(k => isResult(rec[k]));
  if (shape === 'v1') return LEGACY_SENSORY_KEYS.every(k => isScore(rec[k]));
  return false;
}

/**
 * 'pass' | 'fail' | null. V2: any attribute that does not match fails the
 * test; a pass needs all five. V1: the old rule — any attribute below 3
 * fails; null when nothing was rated.
 */
export function sensoryResult(rec) {
  const shape = sensoryShape(rec);
  if (shape === 'v2') {
    if (SENSORY_KEYS.some(k => String(rec[k] ?? '').trim().toLowerCase() === 'fail')) return 'fail';
    return sensoryComplete(rec) ? 'pass' : null;
  }
  if (shape === 'v1') {
    const vals = LEGACY_SENSORY_KEYS.map(k => parseInt(rec[k], 10)).filter(n => !Number.isNaN(n));
    if (!vals.length) return null;
    return vals.some(n => n < LEGACY_THRESHOLD) ? 'fail' : 'pass';
  }
  return null;
}

// The product name as a key: what QA writes on the form, folded so that
// "Whey Blueberry Muffin", "whey blueberry muffin " and "WHEY  Blueberry
// Muffin" are one product with one specification.
export const productKey = (name) => String(name || '').trim().toLowerCase().replace(/\s+/g, ' ');
