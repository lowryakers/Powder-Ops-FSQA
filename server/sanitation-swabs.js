// EVERY SWAB ON A SANITATION RECORD, ONE ROW EACH (D-182).
//
// A Sanitation record held ONE ATP reading. QA swabs three or four surfaces a
// room on a visit — sifter, table, utensils, the blender — each with its own
// swab number, and an allergen swab with its kit lot. One box could hold one of
// them, so Diana kept a Google Sheet and nothing reached ReadyDoc: no reading on
// file, the swab counts stuck at the opening count, PC #1 graded against nothing.
//
// THE ROWS OWN THE READING. `sanitation_records.atp_reading` stays as a MIRROR —
// the failing reading when a swab failed, otherwise the highest — written in the
// same transaction and nowhere else (the `mo_lines` line-0 rule). Every reader
// that already reads the record's reading (the escalation, the 72-hour rule, the
// list, exports) keeps working and cannot disagree with the rows. Form 117.21's
// two ATP lines and two allergen lines are rows here too, not a second place.
//
// A record filed before this has no rows; its reading is still its own and every
// reader treats it as one swab (`legacySwab`). Nothing is backfilled.
import { gradeAtp } from './atp-limits.js';

export const ALLERGEN_RESULTS = ['pass', 'fail'];

const text = (v, max = 120) => {
  const s = String(v ?? '').trim();
  return s ? s.slice(0, max) : null;
};

/**
 * Normalise what a form posted. Returns `{ rows, errors }`; `rows` is null when
 * nothing was sent (leave what is stored alone), [] when the list was cleared.
 * A row with nothing in it is writing space and is dropped; a reading that is
 * not a number is REFUSED by name rather than dropped — a dropped reading is a
 * swab that was taken and now reads as never taken.
 */
export function normalizeSwabs(raw) {
  if (raw === undefined) return { rows: null, errors: [] };
  let src = raw;
  if (typeof src === 'string') {
    try { src = JSON.parse(src); } catch { return { rows: null, errors: ['The swab list could not be read.'] }; }
  }
  if (src === null) return { rows: [], errors: [] };
  if (!Array.isArray(src)) return { rows: null, errors: ['The swab list must be a list.'] };
  const errors = [];
  const rows = [];
  src.forEach((s, i) => {
    if (!s || typeof s !== 'object') return;
    const n = i + 1;
    const reading = s.atp_reading === '' || s.atp_reading == null ? null : Number(s.atp_reading);
    if (reading !== null && (!Number.isFinite(reading) || reading < 0)) {
      errors.push(`Swab ${n}: "${s.atp_reading}" is not an ATP reading.`);
      return;
    }
    const allergenSwab = !!s.allergen_swab;
    const result = text(s.allergen_result, 10);
    if (result && !ALLERGEN_RESULTS.includes(result)) {
      errors.push(`Swab ${n}: "${result}" is not an allergen result (pass or fail).`);
      return;
    }
    const row = {
      swab_no: text(s.swab_no, 40),
      surface: text(s.surface),
      atp_reading: reading,
      allergen_swab: allergenSwab || !!result,
      allergen_result: result,
      allergen_lot: text(s.allergen_lot, 40),
      allergen_present: text(s.allergen_present, 60),
      note: text(s.note, 300),
    };
    const empty = !row.swab_no && !row.surface && row.atp_reading === null && !row.allergen_swab && !row.note;
    if (!empty) rows.push(row);
  });
  return { rows, errors };
}

/** Each row graded against PC #1; the limit is stamped on the row. */
export function gradeSwabs(rows) {
  return (rows || []).map((r) => {
    const g = gradeAtp(r.atp_reading);
    return { ...r, atp_limit: g ? g.limit : null, atp_pass: g ? (g.pass ? 1 : 0) : null, _grade: g };
  });
}

/**
 * The record's mirror: the failing grade when any swab failed (the worst of
 * them), otherwise the highest reading. Null when no swab carried a reading —
 * a gap, never a pass.
 */
export function mirrorGrade(graded) {
  const grades = graded.map((r) => r._grade).filter(Boolean);
  if (!grades.length) return null;
  const failing = grades.filter((g) => !g.pass);
  const pool = failing.length ? failing : grades;
  return pool.reduce((a, b) => (b.value > a.value ? b : a));
}

/** Allergen swabs read as a fail — each one fails the clean (Form 117.21's rule). */
export const allergenFails = (rows) => (rows || []).filter((r) => r.allergen_result === 'fail');

/** Replace a record's rows. Called inside the record's own write. */
export function writeSwabs(db, recordId, graded) {
  db.prepare('DELETE FROM sanitation_swabs WHERE record_id = ?').run(recordId);
  const ins = db.prepare(`INSERT INTO sanitation_swabs
    (record_id, line, swab_no, surface, atp_reading, atp_limit, atp_pass, allergen_swab, allergen_result, allergen_lot, allergen_present, note)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  graded.forEach((r, i) => ins.run(recordId, i, r.swab_no, r.surface, r.atp_reading, r.atp_limit, r.atp_pass,
    r.allergen_swab ? 1 : 0, r.allergen_result, r.allergen_lot, r.allergen_present, r.note));
}

const SWAB_COLS = 'record_id, line, swab_no, surface, atp_reading, atp_limit, atp_pass, allergen_swab, allergen_result, allergen_lot, allergen_present, note';
const shape = (r) => ({ ...r, allergen_swab: !!r.allergen_swab, atp_pass: r.atp_pass == null ? null : !!r.atp_pass });

/** The rows for many records at once (a list page), keyed by record id. */
export function swabsByRecord(db, ids) {
  const out = new Map();
  const list = [...new Set(ids)].filter(Boolean);
  for (let i = 0; i < list.length; i += 400) {
    const chunk = list.slice(i, i + 400);
    const rows = (() => {
      try {
        return db.prepare(`SELECT ${SWAB_COLS} FROM sanitation_swabs WHERE record_id IN (${chunk.map(() => '?').join(',')})
          ORDER BY record_id, line`).all(...chunk);
      } catch { return []; }
    })();
    for (const r of rows) {
      if (!out.has(r.record_id)) out.set(r.record_id, []);
      out.get(r.record_id).push(shape(r));
    }
  }
  return out;
}

/** Hang `swabs` on each record. A record filed before D-182 gets an empty list. */
export function withSwabs(db, records) {
  const map = swabsByRecord(db, records.map((r) => r.id));
  return records.map((r) => ({ ...r, swabs: map.get(r.id) || [] }));
}

export { legacySwabs } from '../shared/swab-rows.js';
