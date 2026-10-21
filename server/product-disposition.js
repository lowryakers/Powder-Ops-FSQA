// Product disposition after an out-of-calibration finding (SQF 11.2.3.4, D-154).
//
// The rule (when one is owed, the answers, what makes an answer complete) is
// shared/product-disposition.js. This file is the ONE writer: the calibration
// record, the kiosk scale check and the in-app scale check all stamp through
// stampOnFile(), and the decision is recorded through recordDisposition()
// whichever screen it came from.
//
// FILING IS NEVER REFUSED for want of a disposition. The calibration happened;
// refusing the record would lose the evidence that the device was off. A
// record that owes a decision files as 'pending', the bell names it to QA, and
// it stays open until somebody says what happened to the product.

import { getDb, logAudit } from './db.js';
import { INCIDENT_KINDS } from '../shared/scale-incident.js';
import {
  DISPOSITIONS, dispositionRequired, dispositionState, checkDisposition, dispositionLabel,
} from '../shared/product-disposition.js';

const INCIDENT_LABEL = Object.fromEntries(Object.entries(INCIDENT_KINDS).map(([k, v]) => [k, v.toLowerCase()]));

export const SOURCES = {
  calibration: { table: 'calibration_records', kind: 'calibration', dateCol: 'calibrated_at', entity: 'calibration_record' },
  scale: { table: 'scale_verifications', kind: 'scale', dateCol: 'performed_at', entity: 'scale_verification' },
  // A scale reported dropped or damaged (D-194). Same decision, same writer.
  incident: { table: 'instrument_incidents', kind: 'incident', dateCol: 'occurred_at', entity: 'instrument_incident' },
};

// The columns one decision writes, on every source table.
const DECISION_COLS = `disposition = ?, disposition_notes = ?, disposition_ref = ?, disposition_lots = ?,
  disposition_quantity = ?, disposition_evaluation = ?, disposition_by = ?, disposition_at = datetime('now')`;
const decisionVals = (body, by) => [
  body.disposition, String(body.notes).trim(), String(body.ref || '').trim() || null,
  String(body.lots || '').trim() || null, String(body.quantity || '').trim() || null,
  String(body.evaluation || '').trim() || null, by,
];

// Deciding what happened to product is QA's call. Deliberately NOT the
// Calibration edit grant: that grant exists so somebody can record a
// calibration, and the person who calibrates is not the one who decides
// whether product is held (the canSetLabTests rule). Caught by the verify.
export const canDecide = (u) => u?.role === 'admin' || u?.role === 'supervisor'
  || ['qa', 'quality'].includes((u?.department || '').toLowerCase());

/** The last good check before this record — where the window of doubt opens. */
export function affectedSinceFor(db, source, row) {
  try {
    if (source === 'calibration') {
      return db.prepare(`SELECT MAX(calibrated_at) d FROM calibration_records
        WHERE instrument_id = ? AND id != ? AND calibrated_at < ? AND result IN ('pass','adjusted_pass')`)
        .get(row.instrument_id, row.id, row.calibrated_at)?.d || null;
    }
    if (source === 'incident') {
      // The last documented acceptable accuracy check before the incident:
      // a passing (or adjusted-to-pass) calibration of this instrument, or a
      // passing daily check linked to it — whichever is later.
      if (!row.instrument_id) return null;
      const cal = db.prepare(`SELECT MAX(calibrated_at) d FROM calibration_records
        WHERE instrument_id = ? AND calibrated_at < ? AND result IN ('pass','adjusted_pass')`)
        .get(row.instrument_id, row.occurred_at)?.d || null;
      const ver = db.prepare(`SELECT MAX(performed_at) d FROM scale_verifications
        WHERE instrument_id = ? AND performed_at < ? AND result = 'pass'`)
        .get(row.instrument_id, row.occurred_at)?.d || null;
      return [cal, ver].filter(Boolean).sort().pop() || null;
    }
    return db.prepare(`SELECT MAX(performed_at) d FROM scale_verifications
      WHERE form_code = ? AND id != ? AND performed_at < ? AND result = 'pass'`)
      .get(row.form_code, row.id, row.performed_at)?.d || null;
  } catch { return null; }
}

/** Add the derived state and label to a row read from either table. */
export function withDisposition(source, row) {
  if (!row) return row;
  const kind = SOURCES[source].kind;
  const history = (() => { try { return JSON.parse(row.disposition_history || '[]'); } catch { return []; } })();
  return {
    ...row,
    disposition_state: dispositionState(kind, row),
    disposition_label: dispositionLabel(row.disposition),
    disposition_history: history.map(h => ({ ...h, label: dispositionLabel(h.disposition) })),
  };
}

/** Validate a disposition offered at filing time. [] when absent or fine. */
export function filingErrors(body) {
  if (!body?.disposition) return [];
  return checkDisposition(body);
}

/**
 * Called right after a record is inserted. Freezes the window and, when a
 * decision is owed, stores the one offered or 'pending'.
 */
export function stampOnFile(db, source, id, body, actor) {
  const src = SOURCES[source];
  const row = db.prepare(`SELECT * FROM ${src.table} WHERE id = ?`).get(id);
  if (!row || !dispositionRequired(src.kind, row.result)) return row;
  const since = affectedSinceFor(db, source, row);
  if (body?.disposition && checkDisposition(body).length === 0) {
    db.prepare(`UPDATE ${src.table} SET ${DECISION_COLS}, affected_since = ? WHERE id = ?`)
      .run(...decisionVals(body, actor?.name || String(actor || '') || null), since, id);
  } else {
    db.prepare(`UPDATE ${src.table} SET disposition = 'pending', affected_since = ? WHERE id = ?`).run(since, id);
  }
  return db.prepare(`SELECT * FROM ${src.table} WHERE id = ?`).get(id);
}

/**
 * Record (or, for an admin, correct) what happened to the product.
 * Returns { error, status } or { record }.
 */
export function recordDisposition(db, source, id, body, user) {
  const src = SOURCES[source];
  if (!src) return { error: 'Unknown record type.', status: 404 };
  if (!canDecide(user)) return { error: 'Recording a product disposition is for QA, supervisors or admins.', status: 403 };
  const row = db.prepare(`SELECT * FROM ${src.table} WHERE id = ?`).get(id);
  if (!row) return { error: 'Record not found.', status: 404 };
  const state = dispositionState(src.kind, row);
  if (state === 'not_required') {
    return { error: 'This check passed, so no product was measured out of tolerance and there is nothing to dispose of.', status: 400 };
  }
  if (state === 'recorded' && user?.role !== 'admin') {
    return { error: `A disposition is already recorded (${dispositionLabel(row.disposition)}, by ${row.disposition_by}). Only an admin can correct it.`, status: 409 };
  }
  // A held finding takes its FINAL answer (released / no effect / rejected);
  // the hold that came before it is kept in the history, not overwritten.
  const errors = checkDisposition(body, { held: state === 'held' });
  if (errors.length) return { error: errors.join(' '), errors, status: 400 };

  const since = row.affected_since || affectedSinceFor(db, source, row);
  const history = (() => { try { return JSON.parse(row.disposition_history || '[]'); } catch { return []; } })();
  if (row.disposition && row.disposition !== 'pending') {
    history.push({
      disposition: row.disposition, notes: row.disposition_notes, ref: row.disposition_ref,
      lots: row.disposition_lots, quantity: row.disposition_quantity, evaluation: row.disposition_evaluation,
      by: row.disposition_by, at: row.disposition_at,
    });
  }
  db.prepare(`UPDATE ${src.table} SET ${DECISION_COLS}, affected_since = ?, disposition_history = ? WHERE id = ?`)
    .run(...decisionVals(body, user?.name || null), since, history.length ? JSON.stringify(history) : null, id);
  const updated = db.prepare(`SELECT * FROM ${src.table} WHERE id = ?`).get(id);
  const action = state === 'recorded' ? 'disposition_corrected' : state === 'held' ? 'hold_released' : 'product_disposition';
  logAudit(user, action, src.entity, id,
    { disposition: body.disposition, ref: updated.disposition_ref, lots: updated.disposition_lots, was: state }, row, updated);
  return { record: withDisposition(source, updated) };
}

/**
 * Everything that owes a decision. `pending` is the queue (filed since the
 * rule); `not_recorded` is the history filed before it, listed apart and never
 * counted on the bell.
 */
export function openDispositions(db = getDb(), { limit = 200 } = {}) {
  const out = { pending: [], held: [], not_recorded: [] };
  const push = (source, r, title, subtitle, date) => {
    const state = dispositionState(SOURCES[source].kind, r);
    if (!['pending', 'held', 'not_recorded'].includes(state)) return;
    out[state].push({
      source, id: r.id, title, subtitle, date, result: r.result,
      affected_since: r.affected_since || null, state,
      disposition_ref: r.disposition_ref || null, disposition_lots: r.disposition_lots || null,
      disposition_by: r.disposition_by || null, disposition_at: r.disposition_at || null,
      occurred_at: r.occurred_at || null,
    });
  };
  try {
    db.prepare(`SELECT cr.*, ci.name instrument_name, ci.asset_number, ci.department
      FROM calibration_records cr JOIN calibration_instruments ci ON ci.id = cr.instrument_id
      WHERE cr.result IN ('fail','adjusted_pass') AND (cr.disposition IS NULL OR cr.disposition IN ('pending','on_hold'))
      ORDER BY cr.calibrated_at DESC LIMIT ?`).all(limit)
      .forEach(r => push('calibration', r, r.instrument_name,
        [r.asset_number ? `#${r.asset_number}` : null, r.department, `calibration ${r.result === 'fail' ? 'failed' : 'adjusted to pass'}`].filter(Boolean).join(' · '),
        r.calibrated_at));
  } catch { /* table optional */ }
  try {
    db.prepare(`SELECT * FROM scale_verifications
      WHERE result = 'fail' AND (disposition IS NULL OR disposition IN ('pending','on_hold'))
      ORDER BY performed_at DESC LIMIT ?`).all(limit)
      .forEach(r => push('scale', r, (r.form_title || '').replace('Scale Verification — ', ''),
        [r.form_code, r.room ? `Room ${r.room}` : null, 'daily check failed'].filter(Boolean).join(' · '),
        r.performed_at));
  } catch { /* table optional */ }
  try {
    db.prepare(`SELECT ii.*, ci.name instrument_name, ci.asset_number FROM instrument_incidents ii
      LEFT JOIN calibration_instruments ci ON ci.id = ii.instrument_id
      WHERE ii.disposition IS NULL OR ii.disposition IN ('pending','on_hold')
      ORDER BY ii.occurred_at DESC LIMIT ?`).all(limit)
      .forEach(r => push('incident', r, r.instrument_name || r.scale_label || 'Scale (not identified)',
        [r.asset_number ? `#${r.asset_number}` : null, r.room ? `Room ${r.room}` : null, `reported ${INCIDENT_LABEL[r.kind] || 'damaged'}`].filter(Boolean).join(' · '),
        r.occurred_at));
  } catch { /* table optional */ }
  const byDate = (a, b) => String(b.date).localeCompare(String(a.date));
  out.pending.sort(byDate);
  out.held.sort(byDate);
  out.not_recorded.sort(byDate);
  return out;
}

export { DISPOSITIONS };
