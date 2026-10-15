// DIANA'S SWAB TRACEABILITY SHEET, FILED AS THE RECORDS IT ALWAYS SHOULD HAVE BEEN (D-182).
//
// From 1 to 15 October 2026 QA's ATP and allergen swabs were kept in a Google
// Sheet ("Swab Tracebility"), because the Sanitation record could hold one ATP
// reading and a room visit swabs three or four surfaces. The work was done;
// the record was elsewhere. These are those 39 swabs, TRANSCRIBED verbatim from
// the sheet as Daniela forwarded it — not derived, not tidied:
//   date, time, swab #, RESULTS (the ATP reading, RLU), ALLERGEN (what was in
//   the product), ATP ticked, ALLERGEN ticked, # ALLERGEN (the kit lot), AREA
//   (the surface), ROOM.
// The sheet's own spellings stay in `room_as_written` / `surface` so the record
// can be checked against it line by line.
//
// HOW THE ROWS BECOME RECORDS: one record per room VISIT — same day, same room,
// swabs within 90 minutes of each other — and a new visit after a failing swab,
// because a fail is followed by a re-clean and a second swab (D-036) and the
// two must not read as one clean. Each record is marked ENTERED LATE with the
// reason, at the time of its first swab. Nothing is escalated: the re-clean on
// 7 Oct already happened (swab 676, 5 RLU, seven minutes later).
//
// WHAT THE SHEET DOES NOT SAY, AND IS LEFT BLANK RATHER THAN GUESSED:
//   * an allergen swab's RESULT — the sheet records that one was taken and its
//     kit lot, never pass or fail;
//   * the ROOM for the mixer swabs written "MIXER 1/2" or left blank — the
//     blender is equipment, so they file under Production with the sheet's
//     wording kept;
//   * row 21's surface is cut off in the copy received ("Bowls that were
//     introduced to roo…") and is kept as received.
// Rows 19–20 have the ATP box unticked but carry a reading; the reading is kept
// and the record says the box was not ticked.
//
// RUNS ONCE, ON A DATABASE THAT EXISTED BEFORE THIS RELEASE. A fresh database
// (a new install, every verify) has no business holding these October records,
// so it is detected — no controlled definition has been recorded yet, which is
// the last thing every earlier boot did — and marked skipped. Guarded in
// app_settings either way, so a record somebody corrects is never re-filed.
import crypto from 'crypto';
import { PLANT_TZ } from './plant-clock.js';
import { canonicalArea } from './sanitation-areas.js';
import { recordGroupFor } from './qa-records.js';
import { gradeSwabs, mirrorGrade, writeSwabs } from './sanitation-swabs.js';
import { applyGrade, gradeAtp } from './atp-limits.js';
import { logAudit } from './db.js';

export const SWAB_SHEET_FLAG = 'swab_sheet_imported_v1';
export const SWAB_SHEET_FILER = 'Diana Carolina';
export const SWAB_SHEET_REASON = 'Transcribed from QA\'s "Swab Tracebility" Google Sheet on 15 Oct 2026 — the Sanitation '
  + 'record held one ATP reading, so swabs were kept on the sheet until the swab table existed (D-182).';

// [sheet row, date, time, swab #, RLU, allergen in product, ATP ticked, allergen ticked, kit lot, surface, room as written]
export const SWAB_SHEET_ROWS = [
  [2, '2026-10-01', '07:57', '653', 0, 'No Allergen', 1, 1, '9626', 'UTENSILS', '3'],
  [3, '2026-10-01', '08:00', '654', 0, 'No Allergen', 1, 0, null, 'SIFTER', '3'],
  [4, '2026-10-01', '08:02', '655', 0, 'No Allergen', 1, 0, null, 'TABLE', '3'],
  [5, '2026-10-01', '08:04', '656', 0, 'No Allergen', 1, 1, '9626', 'TABLE', '4'],
  [6, '2026-10-01', '08:08', '657', 0, 'No Allergen', 1, 0, null, 'TABLE', 'BAT 2'],
  [7, '2026-10-01', '08:09', '658', 5, 'No Allergen', 1, 1, '9626', 'SCISSOR', '3'],
  [8, '2026-10-01', '08:39', '659', 0, 'No Allergen', 1, 0, null, 'SCISSOR', 'Bat 2'],
  [9, '2026-10-05', '07:17', '660', 0, 'No Allergen', 1, 0, null, 'TABLE', '3'],
  [10, '2026-10-05', '07:20', '661', 1, 'No Allergen', 1, 0, null, 'TABLE', 'Bat 2 (1)'],
  [11, '2026-10-05', '07:24', '662', 0, 'No Allergen', 1, 0, null, 'UTENSILS', 'Bat 2 (1)'],
  [12, '2026-10-05', '07:28', '663', 2, 'No Allergen', 1, 0, null, 'MIXER 2', ''],
  [13, '2026-10-05', '08:53', '664', 1, 'No Allergen', 1, 0, null, 'SIFTER', 'Bat 1'],
  [14, '2026-10-05', '13:43', '665', 12, 'No Allergen', 1, 0, null, 'SIFTER', 'Bat 2'],
  [15, '2026-10-05', '13:48', '666', 3, 'No Allergen', 1, 0, null, 'TABLE', 'Bat 2'],
  [16, '2026-10-06', '07:57', '667', 3, 'Milk', 1, 0, null, 'TABLE', '6'],
  [17, '2026-10-06', '07:59', '668', 0, 'Milk', 1, 0, null, 'UTENSILS', '6'],
  [18, '2026-10-06', '08:37', '669', 0, 'No Allergen', 1, 0, null, 'UTENSILS', 'BAT 2'],
  [19, '2026-10-06', '12:48', '670', 0, 'No Allergen', 0, 0, null, 'SMALL SIFTER', '3'],
  [20, '2026-10-06', '13:04', '671', 2, 'Milk', 0, 0, null, 'SMALL SIFTER', '6'],
  [21, '2026-10-06', '13:17', '672', 0, 'Milk', 1, 0, null, 'Bowls that were introduced to roo…', '6'],
  [22, '2026-10-06', '16:00', '673', 0, 'Milk', 1, 0, null, 'SMALL SIFTER', '6'],
  [23, '2026-10-07', '10:16', '674', 0, 'Milk', 1, 0, null, 'UTENSILS', '6'],
  [24, '2026-10-07', '11:28', '675', 39, 'No Allergen', 1, 1, '9626', 'SIFTER', '3'],
  [25, '2026-10-07', '11:35', '676', 5, 'No Allergen', 1, 1, '9626', 'SIFTER', '3'],
  [26, '2026-10-07', '11:48', '677', 3, 'Milk', 1, 0, null, 'UTENSILS', '6'],
  [27, '2026-10-08', '10:59', '678', 1, 'Wheat (Gluten)', 1, 1, '9626', 'TABLE/TENT', 'QA'],
  [28, '2026-10-13', '07:52', '679', 2, 'No Allergen', 1, 1, '9626', 'MACHINE #132', '4'],
  [29, '2026-10-13', '07:53', '680', 0, 'No Allergen', 1, 0, null, 'TABLE & UTENSILS', '4'],
  [30, '2026-10-13', '11:38', '681', 2, 'Milk', 1, 1, '9626', 'TABLES', 'KITTING'],
  [31, '2026-10-13', '11:39', '682', 0, 'No Allergen', 1, 0, null, 'MIXER 1', 'MIXER 1'],
  [32, '2026-10-13', '12:07', '683', 6, 'Milk', 1, 0, null, 'MIXER 2', 'MIXER 2'],
  [33, '2026-10-14', '07:21', '684', 3, 'No Allergen', 1, 0, null, 'SIFTER & UTENSIL', 'Bat 2'],
  [34, '2026-10-14', '07:23', '685', 1, 'No Allergen', 1, 0, null, 'TABLE', 'Bat 2'],
  [35, '2026-10-14', '15:39', '686', 4, 'No Allergen', 1, 0, null, 'SIFTER & UTENSIL', 'Bat 2'],
  [36, '2026-10-14', '15:41', '687', 4, 'No Allergen', 1, 0, null, 'TABLE', 'Bat 2'],
  [37, '2026-10-14', '15:43', '688', 2, 'No Allergen', 1, 0, null, 'MIXER 1', 'MIXER 1'],
  [38, '2026-10-15', '09:26', '689', 0, 'No Allergen', 1, 0, null, 'SIFTER & UTENSIL', 'Bat 2'],
  [39, '2026-10-15', '09:27', '690', 1, 'No Allergen', 1, 0, null, 'TABLE', 'Bat 2'],
  [40, '2026-10-15', '09:28', '691', 0, 'Milk', 1, 1, '9626', 'MIXER 2', ''],
];

/** The sheet's room as the Sanitation log names it; null = not recorded (filed under Production). */
export function sheetArea(room) {
  const r = String(room || '').trim();
  if (!r || /^mixer/i.test(r)) return null;
  const bat = r.match(/^bat\s*(\d)/i);
  if (bat) return `Batching ${bat[1]}`;
  if (/^kitting$/i.test(r)) return '15';
  return canonicalArea(r);
}

/** A plant wall-clock time as the UTC stamp SQLite stores. */
export function plantLocalToUtc(date, time) {
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  const fmt = new Intl.DateTimeFormat('en-US', { timeZone: PLANT_TZ, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  const p = Object.fromEntries(fmt.formatToParts(new Date(guess)).map((x) => [x.type, x.value]));
  const wall = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute);
  return new Date(guess + (guess - wall)).toISOString().slice(0, 19).replace('T', ' ');
}

// One room visit: swabs within this many minutes of the last (the swab log uses it too, D-186).
export const VISIT_GAP_MINUTES = 90;

const minutes = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };

/** The sheet's rows grouped into room visits. PURE. */
export function planSwabSheet(rows = SWAB_SHEET_ROWS) {
  const visits = [];
  const open = new Map();
  for (const row of rows) {
    const [line, date, time, swabNo, rlu, present, atpTicked, allergenTicked, lot, surface, room] = row;
    const area = sheetArea(room);
    const key = `${date}|${area || `Production:${room || 'blank'}`}`;
    const cur = open.get(key);
    const failed = cur && cur.swabs.some((s) => s.atp_reading != null && s._failed);
    const swab = {
      swab_no: swabNo, surface, atp_reading: rlu, allergen_swab: !!allergenTicked, allergen_result: null,
      allergen_lot: lot, allergen_present: present,
      note: [!atpTicked && 'ATP box not ticked on the sheet; reading kept',
        `sheet row ${line}${room && area == null ? `, room written "${room}"` : !room ? ', no room written' : ''}`]
        .filter(Boolean).join('; '),
    };
    if (cur && !failed && minutes(time) - cur.last <= VISIT_GAP_MINUTES) {
      cur.swabs.push(swab); cur.last = minutes(time);
    } else {
      const v = { date, time, area: area || 'Production', room_as_written: room, swabs: [swab], last: minutes(time) };
      visits.push(v); open.set(key, v);
    }
    // A failing swab closes the visit: what follows it is the re-clean.
    const g = gradeAtp(rlu);
    swab._failed = !!g && !g.pass;
  }
  return visits.map(({ last: _last, ...v }) => ({ ...v, swabs: v.swabs.map(({ _failed, ...s }) => s) }));
}

export function seedSwabSheet(db) {
  const flag = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(SWAB_SHEET_FLAG);
  if (flag) return { skipped: flag.value };
  const mark = (v) => db.prepare(`INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`).run(SWAB_SHEET_FLAG, v);
  const existing = (() => { try { return db.prepare('SELECT COUNT(*) c FROM controlled_definitions').get().c; } catch { return 0; } })();
  if (!existing) { mark('skipped_fresh_database'); return { skipped: 'fresh' }; }

  const visits = planSwabSheet();
  let records = 0, swabs = 0;
  db.transaction(() => {
    for (const v of visits) {
      const graded = gradeSwabs(v.swabs);
      const grade = mirrorGrade(graded);
      const result = applyGrade('pass', grade).result;
      const id = crypto.randomUUID();
      const notes = `From the swab sheet${v.room_as_written && v.area === 'Production' ? ` — room written "${v.room_as_written}"` : ''}`
        + `${!v.room_as_written ? ' — no room written on the sheet' : ''}. Allergen swab results were not recorded on the sheet.`;
      db.prepare(`INSERT INTO sanitation_records (id, area, type, performed_by, result, atp_reading, atp_limit, notes,
          record_group, performed_at, entered_at, entered_late, late_entry_reason)
        VALUES (?, ?, 'pre_op', ?, ?, ?, ?, ?, ?, ?, datetime('now'), 1, ?)`)
        .run(id, v.area, SWAB_SHEET_FILER, result, grade ? grade.value : null, grade ? grade.limit : null, notes,
          recordGroupFor(v.area), plantLocalToUtc(v.date, v.time), SWAB_SHEET_REASON);
      writeSwabs(db, id, graded);
      records++; swabs += graded.length;
    }
    mark(`imported ${records} records, ${swabs} swabs`);
  })();
  try {
    logAudit('system', 'import', 'sanitation_record', 'swab-sheet',
      { source: 'Swab Tracebility sheet', records, swabs, decision: 'D-182' }, null, null, 'Swab sheet import');
  } catch { /* the flag records it either way */ }
  return { records, swabs };
}

/**
 * THE IMPORT GRADED AGAINST THE WRONG LIMIT, AND THIS PUTS IT RIGHT (D-182, found live).
 *
 * The import runs among the boot seeds, and `controlled.js` applies the APPROVED
 * limit only at the end of boot — so on a database where the move to 30 RLU was
 * still parked, the sheet's swabs were stamped "graded against 30" while the app
 * was grading against the approved 35. No verdict changed (no reading on the
 * sheet falls between 30 and 35), but a stamped limit is a statement about the
 * record. Run once, AFTER the controlled sync: every imported swab is re-graded
 * against the limit in force, and its record's mirror and result follow.
 */
export const SWAB_SHEET_RESTAMP_FLAG = 'swab_sheet_limit_restamped_v1';
export function restampSwabSheet(db) {
  const imported = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(SWAB_SHEET_FLAG)?.value || '';
  if (!imported.startsWith('imported')) return { skipped: 'nothing imported' };
  if (db.prepare('SELECT 1 FROM app_settings WHERE key = ?').get(SWAB_SHEET_RESTAMP_FLAG)) return { skipped: 'done' };
  let changed = 0;
  db.transaction(() => {
    const recs = db.prepare('SELECT * FROM sanitation_records WHERE late_entry_reason = ?').all(SWAB_SHEET_REASON);
    for (const r of recs) {
      const rows = db.prepare('SELECT * FROM sanitation_swabs WHERE record_id = ? ORDER BY line').all(r.id);
      const graded = gradeSwabs(rows.map((x) => ({ ...x, allergen_swab: !!x.allergen_swab })));
      graded.forEach((g, i) => {
        if (g.atp_limit !== rows[i].atp_limit || g.atp_pass !== rows[i].atp_pass) {
          db.prepare('UPDATE sanitation_swabs SET atp_limit = ?, atp_pass = ? WHERE id = ?').run(g.atp_limit, g.atp_pass, rows[i].id);
          changed++;
        }
      });
      const grade = mirrorGrade(graded);
      db.prepare('UPDATE sanitation_records SET atp_reading = ?, atp_limit = ?, result = ? WHERE id = ?')
        .run(grade ? grade.value : null, grade ? grade.limit : null, applyGrade('pass', grade).result, r.id);
    }
    db.prepare(`INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`)
      .run(SWAB_SHEET_RESTAMP_FLAG, `re-graded ${recs.length} records, ${changed} swabs changed`);
  })();
  if (changed) {
    try { logAudit('system', 'update', 'sanitation_record', 'swab-sheet', { restamped_swabs: changed, decision: 'D-182' }, null, null, 'Swab sheet limit'); } catch { /* flag records it */ }
  }
  return { changed };
}
