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
import {
  DISPOSITIONS, dispositionRequired, dispositionState, checkDisposition, dispositionLabel,
} from '../shared/product-disposition.js';

export const SOURCES = {
  calibration: { table: 'calibration_records', kind: 'calibration', dateCol: 'calibrated_at', entity: 'calibration_record' },
  scale: { table: 'scale_verifications', kind: 'scale', dateCol: 'performed_at', entity: 'scale_verification' },
};

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
    return db.prepare(`SELECT MAX(performed_at) d FROM scale_verifications
      WHERE form_code = ? AND id != ? AND performed_at < ? AND result = 'pass'`)
      .get(row.form_code, row.id, row.performed_at)?.d || null;
  } catch { return null; }
}

/** Add the derived state and label to a row read from either table. */
export function withDisposition(source, row) {
  if (!row) return row;
  const kind = SOURCES[source].kind;
  return {
    ...row,
    disposition_state: dispositionState(kind, row),
    disposition_label: dispositionLabel(row.disposition),
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
    db.prepare(`UPDATE ${src.table} SET disposition = ?, disposition_notes = ?, disposition_ref = ?,
      disposition_by = ?, disposition_at = datetime('now'), affected_since = ? WHERE id = ?`)
      .run(body.disposition, String(body.notes).trim(), String(body.ref || '').trim() || null,
        actor?.name || String(actor || '') || null, since, id);
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
  const errors = checkDisposition(body);
  if (errors.length) return { error: errors.join(' '), errors, status: 400 };

  const since = row.affected_since || affectedSinceFor(db, source, row);
  db.prepare(`UPDATE ${src.table} SET disposition = ?, disposition_notes = ?, disposition_ref = ?,
    disposition_by = ?, disposition_at = datetime('now'), affected_since = ? WHERE id = ?`)
    .run(body.disposition, String(body.notes).trim(), String(body.ref || '').trim() || null,
      user?.name || null, since, id);
  const updated = db.prepare(`SELECT * FROM ${src.table} WHERE id = ?`).get(id);
  logAudit(user, state === 'recorded' ? 'disposition_corrected' : 'product_disposition', src.entity, id,
    { disposition: body.disposition, ref: updated.disposition_ref, was: state }, row, updated);
  return { record: withDisposition(source, updated) };
}

/**
 * Everything that owes a decision. `pending` is the queue (filed since the
 * rule); `not_recorded` is the history filed before it, listed apart and never
 * counted on the bell.
 */
export function openDispositions(db = getDb(), { limit = 200 } = {}) {
  const out = { pending: [], not_recorded: [] };
  const push = (source, r, title, subtitle, date) => {
    const state = dispositionState(SOURCES[source].kind, r);
    if (state !== 'pending' && state !== 'not_recorded') return;
    out[state].push({
      source, id: r.id, title, subtitle, date, result: r.result,
      affected_since: r.affected_since || null, state,
    });
  };
  try {
    db.prepare(`SELECT cr.*, ci.name instrument_name, ci.asset_number, ci.department
      FROM calibration_records cr JOIN calibration_instruments ci ON ci.id = cr.instrument_id
      WHERE cr.result IN ('fail','adjusted_pass') AND (cr.disposition IS NULL OR cr.disposition = 'pending')
      ORDER BY cr.calibrated_at DESC LIMIT ?`).all(limit)
      .forEach(r => push('calibration', r, r.instrument_name,
        [r.asset_number ? `#${r.asset_number}` : null, r.department, `calibration ${r.result === 'fail' ? 'failed' : 'adjusted to pass'}`].filter(Boolean).join(' · '),
        r.calibrated_at));
  } catch { /* table optional */ }
  try {
    db.prepare(`SELECT * FROM scale_verifications
      WHERE result = 'fail' AND (disposition IS NULL OR disposition = 'pending')
      ORDER BY performed_at DESC LIMIT ?`).all(limit)
      .forEach(r => push('scale', r, (r.form_title || '').replace('Scale Verification — ', ''),
        [r.form_code, r.room ? `Room ${r.room}` : null, 'daily check failed'].filter(Boolean).join(' · '),
        r.performed_at));
  } catch { /* table optional */ }
  const byDate = (a, b) => String(b.date).localeCompare(String(a.date));
  out.pending.sort(byDate);
  out.not_recorded.sort(byDate);
  return out;
}

export { DISPOSITIONS };
