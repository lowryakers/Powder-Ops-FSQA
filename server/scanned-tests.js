// Reading a folder of scanned training tests.
//
// The plant scans each completed test to Drive one file per person, and the
// FILENAME carries everything the training log needs:
//
//   "Copy of 06-01-2026 (LIGHT METER TEST) Bernardo Encisos.pdf"
//   "Copy of  Jake Waits (Sanitation Test) 02-08-2023.pdf"
//
// — a date, a topic in parentheses, and a person, in either order. So this is
// a filename parser, not a document parser: the scan itself is a photograph of
// handwriting, and nothing reliable can be read out of it. The file is kept as
// the EVIDENCE attached to the record; the filename is what makes the record.
//
// Same doctrine as training-log.js: nothing is invented. A file with no date,
// no topic or no person is REPORTED, not guessed at — a training completion
// filed against the wrong person or an imagined date is worse than a file the
// importer says it couldn't read.

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july',
  'august', 'september', 'october', 'november', 'december'];

const pad = (n) => String(n).padStart(2, '0');
const iso = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
const valid = (y, m, d) => y >= 1990 && y <= 2100 && m >= 1 && m <= 12 && d >= 1 && d <= 31;

/**
 * Pull a date out of the filename and hand back what's left.
 *
 * The plant writes MM-DD-YYYY: "11-13-2025" can only be month-first, and every
 * file in the folder follows it. Where the first number can't be a month
 * (13-11-2025) it is read day-first instead — that's an observation, not a
 * preference, and it is the only case where the order is in doubt.
 */
export function extractDate(text) {
  let s = String(text || '');

  // "August 20, 2025" / "Aug 20 2025"
  const named = s.match(new RegExp(`\\b(${MONTHS.map(m => m.slice(0, 3)).join('|')})[a-z]*\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(\\d{4})\\b`, 'i'));
  if (named) {
    const m = MONTHS.findIndex(x => x.startsWith(named[1].toLowerCase())) + 1;
    const d = +named[2], y = +named[3];
    if (valid(y, m, d)) return { date: iso(y, m, d), rest: s.replace(named[0], ' '), order: 'named' };
  }

  // ISO first — unambiguous, so it must be tried before the numeric forms.
  const isoM = s.match(/\b(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})\b/);
  if (isoM) {
    const [y, m, d] = [+isoM[1], +isoM[2], +isoM[3]];
    if (valid(y, m, d)) return { date: iso(y, m, d), rest: s.replace(isoM[0], ' '), order: 'iso' };
  }

  // MM-DD-YYYY (or a 2-digit year).
  const num = s.match(/\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})\b/);
  if (num) {
    let a = +num[1], b = +num[2];
    let y = +num[3];
    if (y < 100) y += y < 70 ? 2000 : 1900;
    let m = a, d = b, order = 'mdy';
    // Only when the first number cannot be a month is the order in doubt.
    if (a > 12 && b <= 12) { m = b; d = a; order = 'dmy'; }
    if (valid(y, m, d)) return { date: iso(y, m, d), rest: s.replace(num[0], ' '), order };
  }

  return { date: null, rest: s, order: null };
}

// What's left after the date and the topic have been taken out should be a
// person. Drive's "Copy of" prefix, separators and stray punctuation are not.
const NAME_NOISE = /\b(copy of|copy|scan(ned)?|final|signed|test|form|updated?|v\d+)\b/gi;

export function cleanPersonName(text) {
  let s = String(text || '')
    .replace(/\.[a-z0-9]{2,5}$/i, '')
    .replace(NAME_NOISE, ' ')
    .replace(/[_]+/g, ' ')
    .replace(/[-–—]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[\s,.;:&-]+|[\s,.;:&-]+$/g, '')
    .trim();
  // A name is words, not numbers — anything left that is purely numeric is
  // leftover from a date or a form number, never part of who did the training.
  s = s.split(' ').filter(w => w && !/^\d+$/.test(w)).join(' ');
  return s;
}

/**
 * One scanned file → { name, topic, date } plus why it couldn't be read.
 * `problem` is set (and the row is not importable) when a required part is
 * missing; the caller reports those rather than filling them in.
 */
export function parseScanName(filename) {
  const path = String(filename || '');
  const base = path.replace(/^.*[/\\]/, '');
  let s = base.replace(/\.[a-z0-9]{2,5}$/i, '').replace(/\s+/g, ' ').trim();
  s = s.replace(/^(copy of\s+)+/i, '').trim();   // Drive's prefix, sometimes doubled

  // The topic is what's in parentheses — the plant's own labelling.
  const paren = s.match(/\(([^)]*)\)/);
  const topic = paren ? paren[1].replace(/\s+/g, ' ').trim() : null;
  if (paren) s = `${s.slice(0, paren.index)} ${s.slice(paren.index + paren[0].length)}`.replace(/\s+/g, ' ').trim();

  const { date, rest, order } = extractDate(s);
  const name = cleanPersonName(rest);

  let problem = null;
  if (!topic) problem = 'no_topic';          // no "(…)" — a group form, not a person's test
  else if (!name) problem = 'no_person';     // nothing left that could be a name
  else if (!date) problem = 'no_date';       // never invented; see training-log.js
  else if (name.split(' ').length < 2) problem = 'partial_name';

  return { filename: base, name, topic, date, date_order: order, problem };
}

/** Dice bigram similarity — used only to SUGGEST a roster match, never to pick one. */
export function similarity(a, b) {
  const grams = (s) => {
    const t = String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
    const out = new Map();
    for (let i = 0; i < t.length - 1; i++) {
      const g = t.slice(i, i + 2);
      out.set(g, (out.get(g) || 0) + 1);
    }
    return out;
  };
  const A = grams(a), B = grams(b);
  if (!A.size || !B.size) return 0;
  let shared = 0, total = 0;
  for (const [g, n] of A) { shared += Math.min(n, B.get(g) || 0); total += n; }
  for (const n of B.values()) total += n;
  return (2 * shared) / total;
}

/** Files worth reading out of the zip: the scans themselves, nothing else. */
export const SCAN_EXT = /\.(pdf|jpe?g|png|heic|tiff?)$/i;
export const isScanEntry = (name) =>
  SCAN_EXT.test(name) &&
  !/^__MACOSX\//.test(name) &&
  !/(^|\/)\._/.test(name) &&
  !/(^|\/)\.DS_Store$/i.test(name);
