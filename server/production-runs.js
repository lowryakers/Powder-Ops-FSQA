// A production run opens and closes, and its start asks for the Pre-Op (D-146).
//
// OBL-22. Protocol 003 V4, PC #1: "a pre-operational clean at the beginning of
// every run". D-009 found that every generator here is a calendar and three of
// the four preventive controls fire per RUN; D-125 retired the daily Pre-Op
// card (a calendar card sat N/A or missed) and added nothing that knew a run
// had begun. This is that thing, in the Receiving Log's shape: starting a run
// is the act that issues its number, and the run is the PC trigger.
//
// ONE OWNER OF THE CLEAN. Whether a run's Pre-Op is on record is DERIVED from
// `sanitation_records` on every read — a passing pre-op in the run's room since
// the room's previous run — and never stored on the run. When a start finds
// none, it raises ONE cleaning task for that room (reused by a second run
// started before the clean), and filing the Pre-Op by either door closes it:
// completing the task files the record (recordAreaForTask maps the title), and
// a Pre-Op filed on the Sanitation form closes the task (closeRunPromptsFor).
//
// REPORTED, NEVER GATED. A run starts whatever the record says, and closes
// whatever it says; the screen and the run's own line say "no Pre-Op on
// record". Stopping production on a software check is the plant's decision,
// and an app enforcing a rule the plant has not decided is itself a finding.
import { randomUUID as uuid } from 'crypto';
import { isRoomToken, areaLabel } from '../shared/rooms.js';

export const PROMPT_PREFIX = 'Pre-Op clean';
const OUTSTANDING = "('open','in_progress','overdue','missed')";

/** The next run number: RUN-0001, counting from the table alone. */
export function nextRunNo(db) {
  const max = db.prepare("SELECT MAX(CAST(SUBSTR(run_no, 5) AS INTEGER)) n FROM production_runs WHERE run_no LIKE 'RUN-%'").get().n || 0;
  return `RUN-${String(max + 1).padStart(4, '0')}`;
}

/** The title of the Pre-Op prompt for a room. Parenthetical carries no parentheses (recordAreaForTask). */
export const promptTitle = (room, runNo) => `${PROMPT_PREFIX} — ${areaLabel(room)} (run ${runNo} starting)`;

/**
 * The Pre-Op for a run, derived: a PASSING `pre_op` sanitation record in the
 * run's room, performed after the room's previous run ended (or, for the first
 * run on record, within the 24 hours before this one started), up to now or
 * the run's end.
 *   state 'before'  — a clean was on record when the run started (PC met)
 *         'after'   — the clean was filed after the start (late, but there)
 *         'owed'    — none on record
 */
export function preopFor(db, run) {
  // The room's previous run: earlier start, or the same second and inserted
  // first — timestamps here are to the second, and two runs a second apart
  // must still have an order.
  const prev = db.prepare(`SELECT COALESCE(ended_at, started_at) t FROM production_runs
    WHERE room = ? AND id != ? AND (datetime(started_at) < datetime(?)
      OR (datetime(started_at) = datetime(?) AND rowid < (SELECT rowid FROM production_runs WHERE id = ?)))
    ORDER BY datetime(started_at) DESC, rowid DESC LIMIT 1`).get(run.room, run.id, run.started_at, run.started_at, run.id);
  const from = prev?.t || db.prepare("SELECT datetime(?, '-24 hours') t").get(run.started_at).t;
  const until = run.ended_at || db.prepare("SELECT datetime('now') t").get().t;
  // datetime() on both sides: the log holds SQLite's "YYYY-MM-DD HH:MM:SS" and
  // ISO "…T…Z" side by side, and a string compare of the two misorders a day.
  const rec = db.prepare(`SELECT id, performed_at, performed_by, atp_reading, atp_limit, result,
      datetime(COALESCE(performed_at, entered_at)) <= datetime(?) AS before_start
    FROM sanitation_records
    WHERE area = ? AND type = 'pre_op' AND result = 'pass'
      AND datetime(COALESCE(performed_at, entered_at)) > datetime(?) AND datetime(COALESCE(performed_at, entered_at)) <= datetime(?)
    ORDER BY datetime(COALESCE(performed_at, entered_at)) ASC LIMIT 1`).get(run.started_at, run.room, from, until);
  if (!rec) return { state: 'owed', record: null };
  const { before_start: beforeStart, ...record } = rec;
  return { state: beforeStart ? 'before' : 'after', record };
}

function shape(db, run) {
  const pre = preopFor(db, run);
  const prompt = run.prompt_work_order_id
    ? db.prepare('SELECT id, status, due_date FROM work_orders WHERE id = ?').get(run.prompt_work_order_id) || null : null;
  return { ...run, room_label: areaLabel(run.room), preop: pre, prompt };
}

export function listRuns(db, { status, limit = 200 } = {}) {
  const rows = db.prepare(`SELECT * FROM production_runs ${status ? 'WHERE status = ?' : ''}
    ORDER BY CASE status WHEN 'open' THEN 0 ELSE 1 END, started_at DESC LIMIT ?`).all(...(status ? [status, limit] : [limit]));
  return rows.map((r) => shape(db, r));
}

export const getRun = (db, id) => {
  const r = db.prepare('SELECT * FROM production_runs WHERE id = ?').get(id);
  return r ? shape(db, r) : null;
};

/**
 * Open a run. Refuses a room that is not a production room (a Pre-Op belongs to
 * one) and a second open run in the same room (one room, one run at a time).
 */
export function startRun(db, { room, team, mo_number, product_name, notes, by, byId, logAudit }) {
  const r = String(room || '').trim();
  if (!isRoomToken(r)) return { status: 400, error: 'A run is started in a production or batching room.' };
  const open = db.prepare("SELECT run_no FROM production_runs WHERE room = ? AND status = 'open'").get(r);
  if (open) return { status: 409, error: `${areaLabel(r)} already has an open run (${open.run_no}). Close it before starting the next one.` };
  const id = uuid();
  const runNo = nextRunNo(db);
  let promptId = null;
  db.transaction(() => {
    db.prepare(`INSERT INTO production_runs (id, run_no, room, team, mo_number, product_name, started_by, started_by_id, notes)
      VALUES (?,?,?,?,?,?,?,?,?)`).run(id, runNo, r, team || null, String(mo_number || '').trim() || null,
      String(product_name || '').trim() || null, by || null, byId || null, String(notes || '').trim() || null);
    const run = db.prepare('SELECT * FROM production_runs WHERE id = ?').get(id);
    if (preopFor(db, run).state === 'owed') {
      // One prompt per room: a second run started before the clean shares it.
      const existing = db.prepare(`SELECT id FROM work_orders WHERE title LIKE ? AND status IN ${OUTSTANDING} ORDER BY created_at DESC LIMIT 1`)
        .get(`${PROMPT_PREFIX} — ${areaLabel(r)} (%`);
      promptId = existing?.id || uuid();
      if (!existing) {
        const title = promptTitle(r, runNo);
        db.prepare(`INSERT INTO work_orders (id, pm_schedule_id, equipment_id, title, description, priority, due_date, procedure_steps, task_group, status)
          VALUES (?, NULL, NULL, ?, ?, 'high', date('now'), ?, 'cleaning', 'open')`).run(promptId, title,
          `Run ${runNo} started in ${areaLabel(r)}${mo_number ? ` for MO ${mo_number}` : ''} with no Pre-Op clean on record since the room's last run. `
          + 'Protocol 003 V4 PC #1: a pre-operational clean at the beginning of every run. Completing this task files the Pre-Op record; '
          + 'filing the Pre-Op on the Sanitation form closes it.',
          JSON.stringify(['Pre-operational clean of the room and line', 'ATP swab (record the RLU reading)']));
        logAudit?.(by || 'system', 'auto_generate', 'work_order', promptId, { source: 'production_run_start', run: runNo, room: r }, null, null, title);
      }
      db.prepare('UPDATE production_runs SET prompt_work_order_id = ? WHERE id = ?').run(promptId, id);
    }
    logAudit?.(by || 'system', 'create', 'production_run', id, { run: runNo, room: r, mo_number: mo_number || null, preop_prompt: promptId }, null, null, runNo);
  })();
  return { status: 201, run: getRun(db, id), prompt_raised: !!promptId };
}

export function closeRun(db, id, { by, logAudit } = {}) {
  const run = db.prepare('SELECT * FROM production_runs WHERE id = ?').get(id);
  if (!run) return { status: 404, error: 'Run not found.' };
  if (run.status === 'closed') return { status: 409, error: `${run.run_no} is already closed.` };
  db.prepare("UPDATE production_runs SET status = 'closed', ended_at = datetime('now'), ended_by = ? WHERE id = ?").run(by || null, id);
  const out = getRun(db, id);
  logAudit?.(by || 'system', 'update', 'production_run', id, { closed: true, preop: out.preop.state }, null, null, run.run_no);
  return { status: 200, run: out };
}

/**
 * A passing Pre-Op filed for a room closes the open prompts for it — the clean
 * IS the completion (the closeRecleanTasksFor rule). Called from the Sanitation
 * form's filing path.
 */
export function closeRunPromptsFor(db, area, who, record, logAudit) {
  const open = db.prepare(`SELECT id, title FROM work_orders WHERE title LIKE ? AND status IN ${OUTSTANDING}`)
    .all(`${PROMPT_PREFIX} — ${areaLabel(area)} (%`);
  const upd = db.prepare(`UPDATE work_orders SET status = 'completed', completed_at = datetime('now'), completed_by = ?,
    notes = COALESCE(notes || char(10), '') || ?, updated_at = datetime('now') WHERE id = ?`);
  for (const w of open) {
    upd.run(who || 'ReadyDoc', `Closed by the Pre-Op record filed for ${String(record?.performed_at || '').slice(0, 16)}.`, w.id);
    logAudit?.(who || 'system', 'update', 'work_order', w.id, { closed_by_sanitation_record: record?.id, area }, null, null, w.title);
  }
  return open.length;
}
