// THE RUN NAMES ITS APPROVED MMR (D-133, CAR 4990683-7).
//
// The master manufacturing record is Keychain's (D-130); what ReadyDoc holds is
// the REFERENCE to the approved one — identifier and revision — on the
// scheduled assignment and on the filed run. This module is the gate that
// decides whether a run may be scheduled or filed without one, the D-063
// release-gate shape: `app_settings.mmr_gate` = off / warn (default) / on.
//
//   off   nothing is asked; the reference is stored if given.
//   warn  the run files, and the entry is STAMPED with the mode (`mmr_gate_mode`),
//         so "every run filed without a reference" is a query, not a memory.
//   on    a run with no reference is REFUSED at the schedule cell and at the
//         EOD line, naming the MO.
//
// Warn first: 118 products, a Keychain go-live with no date, and a plant that
// has to keep running while the references are gathered. The visit's report
// is `mmrCoverage()` — runs since a date, named and unnamed — read off
// production_entries, which is the record.
//
// WHAT IS A RUN. A schedule cell or an EOD line that names an MO or a product.
// A cleaning-only shift, or a cell that only sets a team, names nothing to
// have a master record for, and the gate does not ask.
//
// THE EDIT PATH REFUSES ONLY THE REMOVAL of a reference. An entry filed under
// warn with none, and mode since turned on, must still take an ordinary
// correction (a typo in the notes) — refusing it would make the gate a reason
// not to correct records. The ATP escalation's file-path/edit-path split.

export const MMR_GATE_MODES = ['off', 'warn', 'on'];
export const MMR_GATE_KEY = 'mmr_gate';
const MAX_REF = 80;

export function mmrGateMode(db) {
  try {
    const v = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(MMR_GATE_KEY)?.value;
    return MMR_GATE_MODES.includes(v) ? v : 'warn';
  } catch { return 'warn'; }
}

/** The reference as stored: trimmed, single-spaced, bounded; '' when nothing was given. */
export const mmrRef = (v) => String(v ?? '').trim().replace(/\s+/g, ' ').slice(0, MAX_REF);

/** Does this cell / line name a run at all? */
export const namesRun = (x) => !!(String(x?.mo_number || '').trim() || String(x?.product_name || '').trim());

/**
 * The verdict for a set of runs about to be written. `runs` is a list of
 * `{ mo_number, product_name, mmr_ref }`; returns `{ mode, ok, missing }` where
 * `missing` names the runs with no reference (empty when the gate is
 * satisfied or not asked). `refusal` is the 400 body when `ok` is false.
 */
export function mmrGateCheck(db, runs) {
  const mode = mmrGateMode(db);
  const missing = (runs || []).filter(r => namesRun(r) && !mmrRef(r.mmr_ref)).map(r => String(r.mo_number || r.product_name).trim());
  const ok = mode !== 'on' || missing.length === 0;
  return {
    mode, ok, missing,
    refusal: ok ? null : {
      error: `The approved MMR reference is required before a run is scheduled or filed (${missing.length === 1 ? 'MO ' + missing[0] : missing.length + ' runs: ' + missing.join(', ')}). Enter the Keychain MMR identifier and revision.`,
      code: 'MMR_REQUIRED', missing, mode,
    },
  };
}

/**
 * The report for the visit: every run filed since `since`, how many name an
 * MMR, how many do not, and the unnamed ones by date and MO. A multi-MO
 * entry counts one run per MO line. Every figure is `.length` of the rows
 * under it.
 */
export function mmrCoverage(db, { since = '2026-10-14', limit = 200 } = {}) {
  const rows = db.prepare(`SELECT id, date, team, room, mo_number, product_name, mmr_ref, mmr_gate_mode, mo_lines, submitted_by
    FROM production_entries WHERE date >= ? ORDER BY date DESC, created_at DESC`).all(since);
  const runs = [];
  for (const e of rows) {
    const lines = (() => { try { return e.mo_lines ? JSON.parse(e.mo_lines) : null; } catch { return null; } })();
    if (Array.isArray(lines) && lines.length) {
      for (const l of lines) {
        if (!namesRun(l)) continue;
        runs.push({ entry_id: e.id, date: e.date, team: e.team, mo_number: l.mo_number || null, product_name: l.product_name || null, mmr_ref: mmrRef(l.mmr_ref) || null, gate_mode: e.mmr_gate_mode || null, submitted_by: e.submitted_by });
      }
    } else if (namesRun(e)) {
      runs.push({ entry_id: e.id, date: e.date, team: e.team, mo_number: e.mo_number || null, product_name: e.product_name || null, mmr_ref: mmrRef(e.mmr_ref) || null, gate_mode: e.mmr_gate_mode || null, submitted_by: e.submitted_by });
    }
  }
  const named = runs.filter(r => r.mmr_ref);
  const unnamed = runs.filter(r => !r.mmr_ref);
  return {
    since, mode: mmrGateMode(db), modes: MMR_GATE_MODES,
    runs_total: runs.length, runs_named: named.length, runs_unnamed: unnamed.length,
    unnamed: unnamed.slice(0, limit),
  };
}
