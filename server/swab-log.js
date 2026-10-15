// THE SWAB LOG: QA'S SWABS AS THEY ARE TAKEN, FILED AS RECORDS LATER (D-186).
//
// Diana swabs several rooms in one round and writes the results down as she
// goes — on a Google Sheet, because the Sanitation form is one record per room
// visit and asks for the record's facts before the swab table. Her ask: "add
// results quickly in one place, reconcile later when things slow, and have them
// all logged at one time… as close to her spreadsheet view as we can".
//
// So this is My Day for swabs (the production day log's shape):
//   * one line per swab — time, room, surface, swab #, ATP, allergen tick, lot —
//     SAVED THE MOMENT IT IS ENTERED, server-side, so a phone that dies or a tab
//     that closes loses nothing;
//   * the lines stay editable until filed — an allergen kit read twenty minutes
//     later is entered then;
//   * "File" groups the person's unfiled lines into room VISITS (same day, same
//     room, swabs within 90 minutes, a new visit after a failing swab — the
//     sheet import's rule, D-182) and files each visit as a Sanitation record
//     THROUGH THE RECORD'S OWN WRITER (`createSanitationRecord`). Grading against
//     PC #1, the two-fail escalation, closing re-clean tasks and the run prompt
//     all happen exactly as they do for the form. Nothing here grades anything.
//
// The time is the plant's wall clock as typed (swabs are logged late as a matter
// of course) and becomes the record's performed_at. A visit filed more than a day
// after it happened carries the reason the form would ask for, written for her.
// A line missing a room, or with nothing measured on it, is not filed and says
// why; the rest are filed.
import { Router } from 'express';
import { v4 as uuid } from 'uuid';
import { getDb, logAudit } from './db.js';
import { gradeAtp } from './atp-limits.js';
import { plantDateOf, plantWallClock } from './plant-clock.js';
import { plantLocalToUtc, VISIT_GAP_MINUTES } from './swab-sheet-seed.js';
import { canonicalArea } from './sanitation-areas.js';
import { createSanitationRecord } from './api/sanitation.js';
import { personMatch } from './person-links.js';

export { VISIT_GAP_MINUTES };
const FIELDS = ['swabbed_on', 'swabbed_time', 'room', 'surface', 'swab_no', 'atp_reading', 'allergen_swab', 'allergen_result', 'allergen_lot', 'note'];

const text = (v, max = 120) => { const s = String(v ?? '').trim(); return s ? s.slice(0, max) : null; };
const minutes = (t) => { const [h, m] = String(t).split(':').map(Number); return h * 60 + m; };

/** Normalise one line's fields. Returns { row, error }; absent keys are left out. */
export function normalizeLine(body = {}, { partial = false } = {}) {
  const row = {};
  const has = (k) => Object.prototype.hasOwnProperty.call(body, k);
  if (!partial || has('swabbed_on')) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(body.swabbed_on || ''))) return { error: 'The date could not be read.' };
    row.swabbed_on = body.swabbed_on;
  }
  if (!partial || has('swabbed_time')) {
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(body.swabbed_time || ''))) return { error: 'The time could not be read (use HH:MM).' };
    row.swabbed_time = body.swabbed_time;
  }
  if (has('room')) row.room = text(body.room) ? (canonicalArea(body.room) || text(body.room)) : null;
  if (has('surface')) row.surface = text(body.surface);
  if (has('swab_no')) row.swab_no = text(body.swab_no, 40);
  if (has('atp_reading')) {
    const raw = body.atp_reading;
    if (raw === '' || raw == null) row.atp_reading = null;
    else {
      const n = Number(raw);
      if (!Number.isFinite(n) || n < 0) return { error: `"${raw}" is not an ATP reading.` };
      row.atp_reading = n;
    }
  }
  if (has('allergen_swab')) row.allergen_swab = body.allergen_swab ? 1 : 0;
  if (has('allergen_result')) {
    const r = text(body.allergen_result, 10);
    if (r && !['pass', 'fail'].includes(r)) return { error: `"${r}" is not an allergen result (pass or fail).` };
    row.allergen_result = r;
    if (r) row.allergen_swab = 1;
  }
  if (has('allergen_lot')) row.allergen_lot = text(body.allergen_lot, 40);
  if (has('note')) row.note = text(body.note, 300);
  if (row.allergen_swab === 0) { row.allergen_result = null; }
  return { row };
}

/** Why a line cannot be filed yet, or null. */
export function notReady(e) {
  if (!e.room) return 'No room picked';
  if (e.atp_reading == null && !e.allergen_swab) return 'Nothing measured — no ATP reading and no allergen swab';
  return null;
}

/**
 * The lines grouped into room visits. PURE. Same day + same room, each swab
 * within VISIT_GAP_MINUTES of the previous one, and a failing ATP swab closes
 * the visit (what follows it is the re-clean and its second swab).
 */
export function planVisits(entries) {
  const sorted = [...entries].sort((a, b) =>
    `${a.swabbed_on} ${a.swabbed_time}`.localeCompare(`${b.swabbed_on} ${b.swabbed_time}`) || String(a.created_at || '').localeCompare(String(b.created_at || '')));
  const visits = [];
  const open = new Map();
  for (const e of sorted) {
    const key = `${e.swabbed_on}|${e.room}`;
    const cur = open.get(key);
    if (cur && !cur.closed && minutes(e.swabbed_time) - cur.last <= VISIT_GAP_MINUTES) {
      cur.entries.push(e); cur.last = minutes(e.swabbed_time);
    } else {
      const v = { date: e.swabbed_on, time: e.swabbed_time, room: e.room, entries: [e], last: minutes(e.swabbed_time), closed: false };
      visits.push(v); open.set(key, v);
    }
    const g = gradeAtp(e.atp_reading);
    if (g && !g.pass) open.get(key).closed = true;
  }
  return visits.map(({ last: _l, closed: _c, ...v }) => v);
}

const shape = (r) => {
  const g = gradeAtp(r.atp_reading);
  return { ...r, allergen_swab: !!r.allergen_swab, grade: g ? { pass: g.pass, limit: g.limit } : null, not_ready: notReady(r) };
};

function mine(db, user) {
  const m = personMatch('person_id', 'person', user);
  return db.prepare(`SELECT * FROM swab_log_entries WHERE record_id IS NULL AND filed_at IS NULL AND ${m.sql}
    ORDER BY swabbed_on, swabbed_time, created_at`).all(...m.params);
}

function own(db, user, id) {
  const e = db.prepare('SELECT * FROM swab_log_entries WHERE id = ?').get(id);
  if (!e) return { status: 404, error: 'That swab is not on the log.' };
  if (e.person_id !== user?.id && e.person !== user?.name) return { status: 404, error: 'That swab is not on the log.' };
  if (e.filed_at) return { status: 409, error: 'That swab has been filed; correct it on its Sanitation record.' };
  return { e };
}

/** File the person's ready lines. Returns what was filed and what was left. */
export function fileSwabLog(db, user, { now = new Date() } = {}) {
  const lines = mine(db, user);
  const ready = lines.filter((e) => !notReady(e));
  const left = lines.filter((e) => notReady(e)).map((e) => ({ id: e.id, swab_no: e.swab_no, why: notReady(e) }));
  const visits = planVisits(ready);
  const today = plantDateOf(now);
  const filed = [];
  const refused = [];
  for (const v of visits) {
    const performedAt = plantLocalToUtc(v.date, v.time);
    const daysBack = (now.getTime() - Date.parse(performedAt.replace(' ', 'T') + 'Z')) / 86400000;
    const input = {
      area: v.room, type: 'pre_op', performed_by: user.name, result: 'pass', performed_at: performedAt,
      notes: `Filed from the swab log — ${v.entries.length} swab${v.entries.length === 1 ? '' : 's'} from ${v.time}.`,
      late_entry_reason: daysBack > 1 ? `Swabbed ${v.date} ${v.time}; written on the swab log at the time and filed ${today}.` : undefined,
      swabs: v.entries.map((e) => ({
        swab_no: e.swab_no, surface: e.surface, atp_reading: e.atp_reading, allergen_swab: !!e.allergen_swab,
        allergen_result: e.allergen_result, allergen_lot: e.allergen_lot,
        note: [`swabbed ${e.swabbed_time}`, e.note].filter(Boolean).join('; '),
      })),
    };
    const out = createSanitationRecord(db, user, input);
    if (out.status !== 201) { refused.push({ room: v.room, date: v.date, time: v.time, error: out.error }); continue; }
    const stamp = db.prepare(`UPDATE swab_log_entries SET record_id = ?, filed_at = datetime('now'), filed_by = ?, updated_at = datetime('now')
      WHERE id = ?`);
    for (const e of v.entries) stamp.run(out.body.id, user.name, e.id);
    filed.push({ record_id: out.body.id, room: v.room, date: v.date, time: v.time, swabs: v.entries.length,
      result: out.body.result, atp_stage: out.body.atp_stage || null, atp_message: out.body.atp_message || null });
  }
  return { filed, left, refused };
}

const router = Router();

router.get('/', (req, res) => {
  const db = getDb();
  const lines = mine(db, req.user).map(shape);
  const m = personMatch('l.person_id', 'l.person', req.user);
  const recent = db.prepare(`SELECT l.record_id, MIN(l.swabbed_on) swabbed_on, MIN(l.swabbed_time) swabbed_time,
      COUNT(*) swabs, r.area, r.result FROM swab_log_entries l JOIN sanitation_records r ON r.id = l.record_id
    WHERE l.filed_at >= datetime('now', '-7 days') AND ${m.sql}
    GROUP BY l.record_id ORDER BY MAX(l.filed_at) DESC LIMIT 20`).all(...m.params);
  const wall = plantWallClock();
  const pad = (n) => String(n).padStart(2, '0');
  res.json({
    entries: lines,
    visits: planVisits(lines.filter((e) => !e.not_ready)).map((v) => ({ room: v.room, date: v.date, time: v.time, swabs: v.entries.length })),
    recent,
    now: { date: plantDateOf(), time: `${pad(wall.getHours())}:${pad(wall.getMinutes())}` },
  });
});

router.post('/', (req, res) => {
  const db = getDb();
  const { row, error } = normalizeLine(req.body);
  if (error) return res.status(400).json({ error });
  const id = uuid();
  const cols = ['id', 'person_id', 'person', ...Object.keys(row)];
  db.prepare(`INSERT INTO swab_log_entries (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`)
    .run(id, req.user?.id || null, req.user?.name || 'unknown', ...Object.values(row));
  res.status(201).json(shape(db.prepare('SELECT * FROM swab_log_entries WHERE id = ?').get(id)));
});

router.put('/:id', (req, res) => {
  const db = getDb();
  const o = own(db, req.user, req.params.id);
  if (o.error) return res.status(o.status).json({ error: o.error });
  const body = Object.fromEntries(Object.entries(req.body || {}).filter(([k]) => FIELDS.includes(k)));
  const { row, error } = normalizeLine(body, { partial: true });
  if (error) return res.status(400).json({ error });
  if (Object.keys(row).length) {
    db.prepare(`UPDATE swab_log_entries SET ${Object.keys(row).map((k) => `${k} = ?`).join(', ')}, updated_at = datetime('now') WHERE id = ?`)
      .run(...Object.values(row), o.e.id);
  }
  res.json(shape(db.prepare('SELECT * FROM swab_log_entries WHERE id = ?').get(o.e.id)));
});

router.delete('/:id', (req, res) => {
  const db = getDb();
  const o = own(db, req.user, req.params.id);
  if (o.error) return res.status(o.status).json({ error: o.error });
  db.prepare('DELETE FROM swab_log_entries WHERE id = ?').run(o.e.id);
  res.json({ ok: true });
});

router.post('/file', (req, res) => {
  const db = getDb();
  const out = fileSwabLog(db, req.user);
  if (out.filed.length) {
    logAudit(req.user, 'create', 'swab_log', 'file',
      { records: out.filed.length, swabs: out.filed.reduce((n, f) => n + f.swabs, 0), left: out.left.length, refused: out.refused.length },
      null, null, 'Swab log filed');
  }
  res.json(out);
});

export default router;
