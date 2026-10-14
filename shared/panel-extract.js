// Read a Nutrition Facts panel out of the text of its file (D-174).
//
// PURE — text in, values out, each with the line it was read from. The server
// hands it the PDF's text layer (or a vision transcription of an image) and
// writes what comes back onto a DRAFT as source "extracted from file"; the
// browser never runs this. Nothing here guesses: a line that does not match
// is not a value, and a value with no evidence line is never returned.
//
// The shape of a printed panel is fixed by 21 CFR 101.9, which is what makes
// this tractable: a nutrient name, an amount with its unit, and sometimes a
// % Daily Value, in a known order. The text layer of a designer's PDF usually
// keeps those three on one line; a vision transcription usually does too. A
// panel laid out so that the amount lands on the next line is read by looking
// one line ahead, and no further.

import { parseServingSize } from './panel-reconcile.js';

/** nutrient field → the printed names it goes by, the unit, and its %DV field. */
const NUTRIENTS = [
  { field: 'total_fat', names: ['total fat'], unit: 'g', dv: 'total_fat_dv' },
  { field: 'saturated_fat', names: ['saturated fat', 'sat. fat', 'sat fat'], unit: 'g', dv: 'saturated_fat_dv' },
  { field: 'trans_fat', names: ['trans fat'], unit: 'g' },
  { field: 'cholesterol', names: ['cholesterol'], unit: 'mg', dv: 'cholesterol_dv' },
  { field: 'sodium', names: ['sodium'], unit: 'mg', dv: 'sodium_dv' },
  { field: 'total_carbohydrate', names: ['total carbohydrate', 'total carb', 'total carbs'], unit: 'g', dv: 'total_carbohydrate_dv' },
  { field: 'dietary_fiber', names: ['dietary fiber', 'dietary fibre', 'fiber', 'fibre'], unit: 'g', dv: 'dietary_fiber_dv' },
  { field: 'total_sugars', names: ['total sugars', 'total sugar', 'sugars'], unit: 'g' },
  { field: 'added_sugars', names: ['added sugars', 'added sugar'], unit: 'g', dv: 'added_sugars_dv', includes: true },
  { field: 'protein', names: ['protein'], unit: 'g' },
  { field: 'vitamin_d', names: ['vitamin d', 'vit. d', 'vit d'], unit: 'mcg', dv: 'vitamin_d_dv' },
  { field: 'calcium', names: ['calcium'], unit: 'mg', dv: 'calcium_dv' },
  { field: 'iron', names: ['iron'], unit: 'mg', dv: 'iron_dv' },
  { field: 'potassium', names: ['potassium'], unit: 'mg', dv: 'potassium_dv' },
];

/** An amount as the panel prints it: "1.5g", "<1 g", "45mg", "0 mcg". Keeps "<1" as written. */
const AMOUNT = String.raw`(<\s*\d+(?:\.\d+)?|\d+(?:\.\d+)?)\s*(g|mg|mcg|µg)\b`;
const PCT = String.raw`(\d+(?:\.\d+)?)\s*%`;

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const num = (s) => (/^</.test(s) ? s.replace(/\s+/g, '') : Number(s));

/** The lines of the text, trimmed, blank lines dropped, pdfjs table pipes removed. */
export function panelLines(text) {
  return String(text || '')
    .replace(/\r/g, '')
    .split('\n')
    .map((l) => l.replace(/^\s*\|?\s*|\s*\|?\s*$/g, '').replace(/\s*\|\s*/g, '  ').replace(/\s{2,}/g, ' ').trim())
    .filter((l) => l && !/^-+( -+)*$/.test(l));
}

/**
 * Read a panel. Returns `{ values, evidence, unread, found }`:
 *  - `values`: bot-field names (the `PANEL_VALUE_FIELDS` keys, plus the `_dv`
 *    percentages under their stored names) → the value as printed;
 *  - `evidence`: field → the line it was read from;
 *  - `unread`: the nutrient fields no line matched;
 *  - `found`: whether this looks like a panel at all (calories or a serving line).
 */
export function extractPanel(text) {
  const lines = panelLines(text);
  const values = {};
  const evidence = {};
  const take = (field, value, line) => {
    if (value === null || value === undefined || value === '' || field in values) return;
    values[field] = value; evidence[field] = line;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const next = lines[i + 1] || '';
    const low = line.toLowerCase();

    // Serving size: "Serving size 1 Scoop (35g)" — sometimes the measure on the next line.
    if (/^serving\s+size\b/.test(low)) {
      let rest = line.replace(/^serving\s+size\s*:?\s*/i, '').trim();
      if (!rest && next && !/^servings?\b|^calories\b|^amount\b/i.test(next)) rest = next;
      const parsed = parseServingSize(rest);
      if (parsed.grams) {
        take('serving_household', parsed.household, line);
        take('serving_grams', parsed.grams, line);
        take('serving_size', rest, line);
      } else if (rest) {
        take('serving_size', rest, line);
        if (parsed.household) take('serving_household', parsed.household, line);
      }
      continue;
    }
    // "Servings Per Container 20" / "About 20 servings per container" / "20 servings per container".
    let m = low.match(/servings?\s+per\s+container\s*:?\s*(?:about\s+)?(\d+(?:\.\d+)?)/)
      || low.match(/(?:about\s+)?(\d+(?:\.\d+)?)\s+servings?\s+per\s+container/);
    if (m) { take('servings_per_container', Number(m[1]), line); continue; }
    if (/^servings?\s+per\s+container\s*:?$/.test(low) && /^(?:about\s+)?\d+/.test(next.toLowerCase())) {
      take('servings_per_container', Number(next.match(/\d+(?:\.\d+)?/)[0]), `${line} / ${next}`); continue;
    }
    // Calories: "Calories 130" — or the figure on the next line, as a big-number layout prints it.
    m = low.match(/^calories\s*:?\s*(\d+)\b/);
    if (m) { take('calories', Number(m[1]), line); continue; }
    if (/^calories\s*:?$/.test(low) && /^\d+$/.test(next)) { take('calories', Number(next), `${line} / ${next}`); continue; }

    // Nutrients. "Includes 1g Added Sugars 2%" puts the amount BEFORE the name.
    for (const n of NUTRIENTS) {
      if (n.field in values && (!n.dv || n.dv in values)) continue;
      const name = n.names.map(esc).join('|');
      const after = new RegExp(String.raw`(?:^|\b)(?:${name})\s*:?\s*${AMOUNT}(?:\s*${PCT})?`, 'i');
      const before = n.includes ? new RegExp(String.raw`includes\s+${AMOUNT}\s+(?:${name})(?:\s*${PCT})?`, 'i') : null;
      let mm = line.match(after) || (before && line.match(before));
      let ev = line;
      // "Total Fat" with the figure on the next line, one line only.
      if (!mm && new RegExp(String.raw`^(?:${name})\s*:?$`, 'i').test(line) && new RegExp(String.raw`^${AMOUNT}`, 'i').test(next)) {
        mm = next.match(new RegExp(String.raw`^${AMOUNT}(?:\s*${PCT})?`, 'i')); ev = `${line} / ${next}`;
      }
      if (!mm) continue;
      // "Total Fat" must not be read off "Saturated Fat 1g": the name match is
      // anchored at a word boundary, and "Sugars" must not be read off "Added Sugars".
      if ((n.field === 'total_sugars' && /added/i.test(line)) || (n.field === 'total_fat' && /saturated|trans/i.test(line.slice(0, mm.index)))) continue;
      take(n.field, num(mm[1]), ev);
      if (n.dv && mm[3] !== undefined) take(n.dv, Number(mm[3]), ev);
      break;
    }
  }

  // Ingredients and allergens run to the end of their paragraph.
  const joined = lines.join('\n');
  const ing = joined.match(/ingredients\s*:\s*([\s\S]*?)(?=\n(?:contains|allergen|manufactured|distributed|made in|packed|dist\.|mfd)|\n\n|$)/i);
  if (ing) {
    const v = ing[1].replace(/\s*\n\s*/g, ' ').trim();
    if (v) take('ingredients', v.slice(0, 2000), ing[0].split('\n')[0]);
  }
  // The allergen statement is ONE line ("CONTAINS: MILK."); the line after it
  // is the distributor, not more allergens.
  const alg = lines.find((l) => /^(?:allergen\s+(?:statement|information)\s*:?\s*)?contains\s*:?\s*\S/i.test(l));
  if (alg && alg.length < 300) take('allergen_statement', alg.replace(/^allergen\s+(?:statement|information)\s*:?\s*/i, '').trim(), alg);

  const unread = NUTRIENTS.map((n) => n.field).filter((f) => !(f in values));
  const found = 'calories' in values || 'serving_grams' in values || 'serving_size' in values;
  return { values, evidence, unread, found };
}

/**
 * The fields a file disagrees with the stored panel on. `stored` is the
 * stored panel in bot-field names (valuesOf); `extracted` is extractPanel's
 * `values`. A stored blank is not a mismatch — it is what extraction fills.
 */
export function extractMismatches(stored, extracted) {
  const out = [];
  const norm = (x) => (x === null || x === undefined || x === '' ? null : String(x).trim().toLowerCase().replace(/\s+/g, ' '));
  for (const [field, fileValue] of Object.entries(extracted || {})) {
    if (!(field in (stored || {}))) continue;
    const s = norm(stored[field]);
    const f = norm(fileValue);
    if (s === null || f === null || s === f) continue;
    // The label is generated from its two halves; compare those, not the string.
    if (field === 'serving_size') continue;
    out.push({ field, stored: stored[field], file: fileValue, fingerprint: JSON.stringify([field, s, f]) });
  }
  return out;
}
