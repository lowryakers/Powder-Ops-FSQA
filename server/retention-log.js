// Reading the plant's Retention Sample log — one file per box.
//
// The sheet is NOT a table. It is a paper form: a box header carrying the
// destruction date, then three sections (BLEND / IM / FINISH GOOD, plus raw
// materials in the later boxes) each announced by a bare word in the item
// column, with runs of blank rows left as writing space between them. So this
// is a section walker, the same shape as training-log.js, rather than anything
// `readTable` can hand back.
//
// What the log actually writes, and what each has to become:
//
//   Retention   "5 (2 LAB, 3 RETAIN)" · "2 (Retains)" · "1 RETAIN" · "90g"
//               · "1 SAMPLES" · "2 beg" · "(1 RETAIN)"
//   Batches     "1 and 2" · "1&2" · "1,2,3,4" · "1 BEG, 1 MIDDLE, 1 END" · "0"
//   Collected   "MS 01/15/2026" · "01/12/2025 JG" · "DML 02/13/2026" · "MS 5.1.26"
//
// **The lab and retain counts are kept apart, always.** The paper writes one
// cell, but a lab sample leaves the building and comes back as a result while a
// retain stays in the box until it is destroyed — a single total cannot answer
// "did the lab samples actually go out", which is most of why the log exists.
//
// **Nothing is invented.** A row with no item name is writing space, not a
// record. A count that cannot be read is reported as unparsed rather than
// guessed at, because a retention log that quietly rounds is worse than one
// with a gap somebody can see.

import { parseDelimited } from './tabular.js';

/* ── Sections ─────────────────────────────────────────────────────────────── */

// The bare words the log uses to open a section, mapped onto the stages the
// module already stores. "IM" is the plant's word for intermediate.
const SECTIONS = [
  { match: /^blends?$/i, stage: 'blend' },
  { match: /^i\.?m\.?$/i, stage: 'intermediate' },
  { match: /^intermediates?$/i, stage: 'intermediate' },
  { match: /^finish(ed)?\s*goods?$/i, stage: 'finished_good' },
  // RAW MATERIALS, RAW MATERIAL, RAW INGREDIENTS, INGREDIENTS, MATERIALS, RM.
  //
  // The first cut spelled this `(raw\s*materials?|rm|ingredients?)`, which
  // looks like it covers the ground and does not: "RAW INGREDIENTS" — the
  // plant's own wording — matches none of those three alternatives, because
  // `raw` was welded to `materials` and `ingredients` had no `raw` in front of
  // it. Every raw-material row in boxes 16-19 therefore inherited whatever
  // section came before it, silently. `raw` is an optional prefix now.
  { match: /^(raw\s*)?(materials?|ingredients?)$/i, stage: 'raw_material' },
  { match: /^r\.?m\.?$/i, stage: 'raw_material' },
];

const stageFor = (cell) => SECTIONS.find(s => s.match.test(String(cell || '').trim()))?.stage || null;

// A row that reads like a section banner but matches nothing above. Reported
// rather than ignored: a heading this parser doesn't know silently reassigns
// every row beneath it, which is exactly how the raw materials went missing
// without the preview saying a word.
const looksLikeHeading = (text) => {
  const s = clean(text);
  return !!s && s.length <= 40 && /^[A-Za-z][A-Za-z .&/-]*$/.test(s) && s.split(' ').length <= 4;
};

/* ── Cells ────────────────────────────────────────────────────────────────── */

const clean = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();

// "BOX # 15" / "BOX #15" / "Box 17"
export function parseBoxNo(text) {
  const m = String(text || '').match(/box\s*#?\s*(\d{1,4})/i);
  return m ? m[1] : null;
}

// "Destruction Date: 02/2028" — the log writes a month, not a day, because a
// box is destroyed in a month. Stored as the LAST day of it: a box due
// "02/2028" is not overdue on the 1st, and the destroy-before-due guard in
// retention.js reads this date.
export function parseDestruction(text) {
  const s = String(text || '');
  const md = s.match(/(\d{1,2})\s*[/-]\s*(\d{4})/);
  if (md) {
    const mo = Number(md[1]), yr = Number(md[2]);
    if (mo >= 1 && mo <= 12) return new Date(Date.UTC(yr, mo, 0)).toISOString().slice(0, 10);
  }
  return toDate(s);
}

// Dates arrive as 01/15/2026, 1/26/2026, 5.1.26, 01/12/25 — US month-first
// throughout, which is what the plant writes.
export function toDate(text) {
  const s = clean(text);
  if (!s) return null;
  const iso = s.match(/(20\d{2})-(\d{1,2})-(\d{1,2})/);
  if (iso) return `${iso[1]}-${String(iso[2]).padStart(2, '0')}-${String(iso[3]).padStart(2, '0')}`;
  const m = s.match(/(\d{1,2})\s*[/.]\s*(\d{1,2})\s*[/.]\s*(\d{2,4})/);
  if (!m) return null;
  const mo = Number(m[1]), day = Number(m[2]);
  let yr = Number(m[3]);
  if (yr < 100) yr += 2000;
  if (mo < 1 || mo > 12 || day < 1 || day > 31) return null;
  return `${yr}-${String(mo).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

// An expiry column that says only "01/28" or "12/2027" is a month. Same rule as
// the destruction date: the last day of it.
export function toExpiry(text) {
  const s = clean(text);
  if (!s) return null;
  const full = toDate(s);
  if (full) return full;
  const m = s.match(/^(\d{1,2})\s*[/.]\s*(\d{2,4})$/);
  if (!m) return null;
  const mo = Number(m[1]);
  let yr = Number(m[2]);
  if (yr < 100) yr += 2000;
  if (mo < 1 || mo > 12) return null;
  return new Date(Date.UTC(yr, mo, 0)).toISOString().slice(0, 10);
}

// "MS 01/15/2026" / "01/12/2025 JG" / "DML 02/13/2026" — initials on either
// side of the date. Whatever is left after the date is taken out is who
// collected it.
export function parseCollected(text) {
  const s = clean(text);
  if (!s) return { date: null, by: null };
  const date = toDate(s);
  const by = s.replace(/\d{1,2}\s*[/.]\s*\d{1,2}\s*[/.]\s*\d{2,4}/, '').replace(/[^A-Za-z]/g, '').trim();
  return { date, by: by || null };
}

/* ── The retention cell ───────────────────────────────────────────────────── */

// Splits "5 (2 LAB, 3 RETAIN)" into the two counts that matter, and reports
// honestly when it can't.
//
//  · An explicit LAB/RETAIN breakdown wins over the leading total. The log's
//    own arithmetic is wrong in places ("3(2 LAB, 3 RETAIN)"), and the
//    breakdown is what was physically pulled — the total is a sum somebody did
//    in their head. `total_mismatch` records the disagreement rather than
//    silently picking one.
//  · No breakdown means they are all retains: "2 (Retains)", "1 RETAIN", "1".
//  · "90g" is a raw-material retain — the plant keeps 90 g of every material
//    received. One sample, and the size is kept as written.
export function parseRetention(text) {
  const raw = clean(text);
  if (!raw) return { lab: 0, retain: 0, sample_size: null, unparsed: true, note: 'blank' };

  // A weight is a raw-material retain: one sample, that much of it.
  const weight = raw.match(/^(\d+(?:\.\d+)?)\s*(g|gr|grams?|kg|oz|lb)\b/i);
  if (weight) {
    return { lab: 0, retain: 1, sample_size: `${weight[1]}${weight[2].toLowerCase()}`, unparsed: false };
  }

  const lab = raw.match(/(\d+)\s*(?:x\s*)?lab/i);
  const retain = raw.match(/(\d+)\s*(?:x\s*)?retain/i);
  const leading = raw.match(/^\(?\s*(\d+)/);

  if (lab || retain) {
    const l = lab ? Number(lab[1]) : 0;
    const r = retain ? Number(retain[1]) : 0;
    const out = { lab: l, retain: r, sample_size: null, unparsed: false };
    // "(1 RETAIN)" has no leading total and needs no reconciling.
    if (leading && Number(leading[1]) !== l + r && !/^\(/.test(raw)) {
      out.total_mismatch = { stated: Number(leading[1]), counted: l + r };
    }
    return out;
  }

  // "2 (Retains)" · "1 SAMPLES" · "3" — no split, so they are all retains.
  if (/retain|sample/i.test(raw) || /^\d+$/.test(raw)) {
    const n = leading ? Number(leading[1]) : 1;
    return { lab: 0, retain: n, sample_size: null, unparsed: false };
  }

  // "2 beg" and the like: a number and a word nobody defined. Keep the number,
  // keep the words, and say it wasn't fully understood.
  if (leading) return { lab: 0, retain: Number(leading[1]), sample_size: null, unparsed: true, note: raw };
  return { lab: 0, retain: 0, sample_size: null, unparsed: true, note: raw };
}

/* ── Column mapping ───────────────────────────────────────────────────────── */

const HEADER_ALIASES = {
  cx_id: [/^cx\s*id$/i, /^mo\s*#?$/i],
  item_number: [/^item\s*(number|no|#)$/i],
  item_name: [/^item\s*name$/i, /^description$/i],
  lot_number: [/^lot\s*#?$/i, /^lot\s*(number|no)$/i],
  expiration_date: [/^exp\s*date/i, /^expir/i],
  retention: [/^retention$/i, /^retains?$/i],
  location: [/^location$/i],
  batches: [/batches/i, /^#\s*of\s*total/i],
  collected: [/date\s*collected/i, /^collected/i],
  comments: [/^comment/i],
};

// The header row is wherever "Item Name" appears — the box banner sits above it
// and the CX ID column is sometimes blank, so counting rows would be wrong.
function findHeader(rows) {
  for (let i = 0; i < Math.min(rows.length, 30); i++) {
    const cells = rows[i].map(clean);
    if (cells.some(c => /^item\s*name$/i.test(c))) {
      const map = {};
      cells.forEach((cell, idx) => {
        for (const [key, patterns] of Object.entries(HEADER_ALIASES)) {
          if (map[key] === undefined && patterns.some(p => p.test(cell))) map[key] = idx;
        }
      });
      return { index: i, map };
    }
  }
  return null;
}

/* ── The parse ────────────────────────────────────────────────────────────── */

/**
 * Read one box file. Returns the box, its samples, and everything that could
 * not be read — so the preview can show what will be skipped BEFORE anything is
 * written.
 */
export function parseRetentionLog(buffer, filename = '') {
  const text = Buffer.isBuffer(buffer) ? buffer.toString('utf8') : String(buffer);
  const rows = parseDelimited(text);
  const problems = [];

  const header = findHeader(rows);
  if (!header) {
    return { error: 'This doesn\'t look like a Retention Sample log — no "Item Name" column found.' };
  }
  const col = (r, key) => (header.map[key] === undefined ? '' : clean(r[header.map[key]]));

  // The box banner is anywhere above the header row.
  let boxNo = null, destruction = null;
  for (let i = 0; i < header.index; i++) {
    for (const cell of rows[i]) {
      boxNo = boxNo || parseBoxNo(cell);
      if (/destruction/i.test(String(cell))) destruction = destruction || parseDestruction(cell);
    }
  }
  // Fall back to the filename ("…BOX_15.csv") — the banner is occasionally
  // merged away by whatever exported the sheet.
  boxNo = boxNo || parseBoxNo(filename);
  if (!boxNo) return { error: 'Could not find which box this is. The sheet should say "BOX # 15" near the top.' };

  const samples = [];
  let stage = null;
  let sectionless = 0;

  for (let i = header.index + 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r || !r.some(c => clean(c))) continue; // writing space

    // A section header is a bare word on an otherwise empty row. "Otherwise
    // empty" is judged on the columns that make a row a RECORD — a lot number,
    // a retention count, a collected date — rather than on the raw filled-cell
    // count, because the exported sheets carry stray marks beside a banner and
    // one of those used to stop the banner being recognised at all.
    const filled = r.map(clean).filter(Boolean);
    const isRecordRow = !!(col(r, 'lot_number') || col(r, 'retention') || col(r, 'collected'));
    const banner = !isRecordRow && filled.length <= 2 ? (col(r, 'item_name') || filled[0]) : null;
    const asSection = banner ? stageFor(banner) : null;
    if (asSection) { stage = asSection; continue; }

    const itemName = col(r, 'item_name');
    // No name means no jar. The log has plenty of half-filled rows and a
    // retention record invented from one would be worse than the gap.
    if (!itemName) {
      // ...unless it reads like a heading this parser doesn't know. Silently
      // skipping one reassigns every row below it to the wrong stage.
      if (banner && looksLikeHeading(banner)) {
        problems.push({
          row: i + 1, kind: 'unknown_section',
          value: `"${clean(banner)}" looks like a section heading but isn't one this importer knows — rows below it stay in the previous section`,
        });
      }
      continue;
    }
    // Same check for a banner that DOES sit in the item-name column: it would
    // otherwise be filed as a jar called "RAW INGREDIENTS".
    if (banner && !asSection && looksLikeHeading(itemName) && !isRecordRow) {
      problems.push({
        row: i + 1, kind: 'unknown_section',
        value: `"${clean(itemName)}" looks like a section heading but isn't one this importer knows — rows below it stay in the previous section`,
      });
      continue;
    }

    if (!stage) sectionless++;
    const ret = parseRetention(col(r, 'retention'));
    const collected = parseCollected(col(r, 'collected'));
    const lot = col(r, 'lot_number');

    const sample = {
      row: i + 1,
      // Rows above the first section header can't be staged from the sheet.
      // Finished good is the log's own default section and is recorded as an
      // assumption rather than passed off as read.
      stage: stage || 'finished_good',
      stage_assumed: !stage,
      item_number: col(r, 'item_number') || null,
      item_name: itemName,
      lot_number: lot || null,
      mo_number: col(r, 'cx_id') || null,
      expiration_date: toExpiry(col(r, 'expiration_date')),
      retain_count: ret.retain,
      lab_count: ret.lab,
      sample_size: ret.sample_size,
      // Free text on purpose: "1 BEG, 1 MIDDLE, 1 END" is the fact, and
      // normalising it to a number loses what makes a stick-pack retain useful.
      batches: col(r, 'batches') || null,
      collected_date: collected.date,
      collected_by: collected.by,
      comments: col(r, 'comments') || null,
      location: col(r, 'location') || null,
    };

    if (ret.unparsed) {
      problems.push({ row: i + 1, item: itemName, kind: 'retention_unreadable', value: ret.note || col(r, 'retention') });
    }
    if (ret.total_mismatch) {
      problems.push({
        row: i + 1, item: itemName, kind: 'total_mismatch',
        value: `the sheet says ${ret.total_mismatch.stated}, the LAB/RETAIN split adds to ${ret.total_mismatch.counted} — the split is used`,
      });
    }
    if (!lot) problems.push({ row: i + 1, item: itemName, kind: 'no_lot', value: 'no lot number on this row' });
    if (!collected.date) problems.push({ row: i + 1, item: itemName, kind: 'no_collected_date', value: col(r, 'collected') || 'blank' });

    samples.push(sample);
  }

  if (sectionless) {
    problems.push({
      row: header.index + 2, kind: 'no_section',
      value: `${sectionless} row(s) appear before any BLEND / IM / FINISH GOOD heading — filed as finished good`,
    });
  }

  return {
    box: { box_no: boxNo, destruction_date: destruction },
    samples,
    problems,
    counts: {
      samples: samples.length,
      retains: samples.reduce((t, s) => t + s.retain_count, 0),
      lab: samples.reduce((t, s) => t + s.lab_count, 0),
      by_stage: samples.reduce((acc, s) => { acc[s.stage] = (acc[s.stage] || 0) + 1; return acc; }, {}),
    },
  };
}

/**
 * A sample's identity, for idempotency.
 *
 * Box + item + lot + collected date. The same item legitimately appears twice
 * in one box — a second lot, or a later collection of the same lot — so item
 * alone would collapse real jars; and re-importing a corrected file must update
 * rather than double the box.
 */
export function sampleKey(boxNo, s) {
  return [
    boxNo,
    (s.item_number || s.item_name || '').toLowerCase().trim(),
    (s.lot_number || '').toLowerCase().replace(/\s+/g, ''),
    s.collected_date || '',
  ].join('|');
}
