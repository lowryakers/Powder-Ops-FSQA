// Who is holding a knife — derived from the LOG, mirrored onto the master list.
//
// There are two records and they are both real:
//
//   Form 440-01 `knife_accountability`  the master list — one row per tool that
//                                        exists, with its condition and whether
//                                        it has been decommissioned.
//   Form 440-02 `knife_sign_out`        the accountability log — one record per
//                                        transaction, opened on check-out and
//                                        closed on check-in.
//
// The bug this file fixes: the kiosk decided "is this knife out?" from
// `knife_accountability.status`, which ONLY the kiosk ever wrote. A return
// recorded in the app closed the log record and left the master row saying
// `issued` forever — so the kiosk showed a knife as checked out while the log
// showed it back in, and an operator standing at the scanner could not sign out
// a knife that was physically on the rack.
//
// The rule, the same one this codebase applies everywhere else two mechanisms
// have drifted: ONE of them is the authority and the other is derived.
//
//   · The LOG is the authority. It is the controlled record of the transaction,
//     it is what QA counter-signs, and it is what an auditor asks for.
//   · `knife_accountability.status` / `issued_to` are a MIRROR, written only by
//     `syncKnifeStatus` here. Nothing else may write them, and nothing may read
//     them to decide whether a knife is out.
//
// `decommissioned` is the exception and stays master-held: that is a fact about
// the knife itself, not about any transaction, and no sign-out can undo it.

/** The tool id a record refers to — master rows fall back to their number. */
export function toolIdOf(row, data) {
  return String(data?.tool_id || row?.record_number || '').trim();
}

function parse(json) {
  try { return JSON.parse(json || '{}'); } catch { return {}; }
}

/**
 * Every knife currently signed out, as toolId → { employee_name, since, record_id }.
 *
 * One query rather than one per tool: the kiosk catalogue renders the whole
 * list, and a query per knife is how a 300-tool list becomes slow.
 *
 * A knife with more than one open sign-out is a data error rather than an
 * impossibility (two people can file at once), and the MOST RECENT open record
 * wins — that is who actually has it. Closing the older one is a decision for
 * QA, not something to silently do here.
 */
export function openSignOuts(db) {
  const held = new Map();
  let rows;
  try {
    rows = db.prepare(
      `SELECT id, record_number, record_date, data, created_at FROM qms_records
       WHERE record_type = 'knife_sign_out' AND status = 'out'
       ORDER BY COALESCE(created_at, record_date)`).all();
  } catch { return held; }
  for (const r of rows) {
    const d = parse(r.data);
    const toolId = String(d.tool_id || '').trim();
    if (!toolId) continue;
    held.set(toolId, {
      record_id: r.id,
      record_number: r.record_number,
      employee_name: d.employee_name || '',
      since: r.record_date || null,
      time_out: d.time_out || null,
    });
  }
  return held;
}

/**
 * Re-derive the master row's status from the log and write the mirror.
 *
 * Returns the derived state so a caller can answer the kiosk in the same
 * breath. Decommissioned tools are left completely alone.
 */
export function syncKnifeStatus(db, toolId) {
  const id = String(toolId || '').trim();
  if (!id) return null;

  let masters;
  try {
    masters = db.prepare(
      "SELECT id, record_number, status, data FROM qms_records WHERE record_type = 'knife_accountability'").all();
  } catch { return null; }

  const master = masters.find(m => toolIdOf(m, parse(m.data)) === id);
  const held = openSignOuts(db).get(id) || null;
  const state = { tool_id: id, issued: !!held, issued_to: held?.employee_name || '', holder: held };

  if (!master) return state;
  if (master.status === 'decommissioned') return { ...state, decommissioned: true };

  const data = parse(master.data);
  const wantStatus = held ? 'issued' : 'available';
  const wantIssuedTo = held ? (held.employee_name || '') : '';
  if (master.status === wantStatus && (data.issued_to || '') === wantIssuedTo) return state;

  data.issued_to = wantIssuedTo;
  db.prepare("UPDATE qms_records SET status = ?, data = ?, updated_at = datetime('now') WHERE id = ?")
    .run(wantStatus, JSON.stringify(data), master.id);
  return state;
}

/**
 * Bring every master row back in step with the log.
 *
 * Runs as a one-time repair for rows that drifted while the kiosk was the only
 * writer, and is safe to run again: it only touches rows whose stored status
 * disagrees with the log, and never touches a decommissioned tool. Returns the
 * rows it changed so the caller can log what it corrected rather than claiming
 * a silent fix.
 */
export function syncAllKnifeStatuses(db) {
  let masters;
  try {
    masters = db.prepare(
      "SELECT id, record_number, status, data FROM qms_records WHERE record_type = 'knife_accountability'").all();
  } catch { return []; }

  const held = openSignOuts(db);
  const update = db.prepare("UPDATE qms_records SET status = ?, data = ?, updated_at = datetime('now') WHERE id = ?");
  const changed = [];

  const tx = db.transaction(() => {
    for (const m of masters) {
      if (m.status === 'decommissioned') continue;
      const data = parse(m.data);
      const id = toolIdOf(m, data);
      if (!id) continue;
      const holder = held.get(id) || null;
      const wantStatus = holder ? 'issued' : 'available';
      const wantIssuedTo = holder ? (holder.employee_name || '') : '';
      if (m.status === wantStatus && (data.issued_to || '') === wantIssuedTo) continue;
      changed.push({ tool_id: id, from: m.status, to: wantStatus, issued_to: wantIssuedTo });
      data.issued_to = wantIssuedTo;
      update.run(wantStatus, JSON.stringify(data), m.id);
    }
  });
  tx();
  return changed;
}
