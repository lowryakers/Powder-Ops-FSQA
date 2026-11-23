// The remaining module records on the record interface (single-spine move 02,
// pack P3): each an adapter over the module's own writer — nothing here writes
// a record column. D-371: the receiving checklist and calibration records.
//
//   receiving    receiving_checklists   saveReceivingChecklist · signReceivingChecklist · revokeReceivingSignoff
//   calibration  calibration_records    fileCalibrationRecord (no signature on the record itself; the
//                                       product decision it may owe is signed separately — described here)
import { moduleLevel } from './module-access.js';
import { saveReceivingChecklist, signReceivingChecklist, revokeReceivingSignoff, canLog as canLogReceiving } from './api/receiving.js';
import { fileCalibrationRecord } from './api/calibration.js';

const MAX_ROWS = 500;
const sqlDate = (d) => /^\d{4}-\d{2}-\d{2}$/.test(String(d || '')) ? String(d) : null;
const cap = (q) => Math.min(Number(q.limit) || MAX_ROWS, MAX_ROWS);
const jsonOf = (s, fb) => { try { return s ? JSON.parse(s) : fb; } catch { return fb; } };

/** from / to / person / signed against one date, one doer and one signer column. */
function common(q, { at, by, signedBy }) {
  const where = []; const params = [];
  const from = sqlDate(q.from); const to = sqlDate(q.to);
  if (from) { where.push(`substr(${at}, 1, 10) >= ?`); params.push(from); }
  if (to) { where.push(`substr(${at}, 1, 10) <= ?`); params.push(to); }
  if (q.person) {
    where.push(`(lower(${by}) = lower(?)${signedBy ? ` OR lower(COALESCE(${signedBy}, '')) = lower(?)` : ''})`);
    params.push(String(q.person).trim(), ...(signedBy ? [String(q.person).trim()] : []));
  }
  if (q.signed === 'yes') where.push(signedBy ? `${signedBy} IS NOT NULL` : '0');
  if (q.signed === 'no' && signedBy) where.push(`${signedBy} IS NULL`);
  return { where, params };
}

// ── Receiving inspections (FORM 204-01) ─────────────────────────────────────
// One checklist per INSPECTION (its number), several receiving_log lines under
// it. The lots a delivery brought in are the vendor lot on the checklist and on
// every line, so "everything about lot L" finds the truck it arrived on.
const receivingLots = (db, no) => {
  try { return db.prepare('SELECT DISTINCT vendor_lot FROM receiving_log WHERE inspection_no = ? AND vendor_lot IS NOT NULL').all(no).map(r => r.vendor_lot); }
  catch { return []; }
};

const withLots = (db, r) => (r ? { ...r, _line_lots: receivingLots(db, r.inspection_no) } : null);

export const RECEIVING_TYPE = {
    type: 'receiving',
    label: 'Receiving inspections (FORM 204-01)',
    modules: ['receiving-log'],
    filters: ['lot'],
    // A new inspection when `inspection_no` is blank, otherwise saving to the open one.
    file: (db, user, input) => {
      const out = saveReceivingChecklist(db, user, input);
      return out.error ? out : { status: out.created ? 201 : 200, id: out.row.id, row: out.row };
    },
    // The record id is the checklist row id; the module keys on the number.
    sign: (db, user, id, opts = {}) => {
      const r = db.prepare('SELECT inspection_no FROM receiving_checklists WHERE id = ?').get(id);
      return r ? signReceivingChecklist(db, user, r.inspection_no, opts) : { status: 404, error: 'Not found' };
    },
    revoke: (db, user, id) => {
      const r = db.prepare('SELECT inspection_no FROM receiving_checklists WHERE id = ?').get(id);
      return r ? revokeReceivingSignoff(db, user, r.inspection_no) : { status: 404, error: 'Not found' };
    },
    get: (db, id) => withLots(db, db.prepare('SELECT * FROM receiving_checklists WHERE id = ? OR inspection_no = ?').get(id, id)),
    canRead: (user) => !!moduleLevel(user, 'receiving-log'),
    canFile: (user) => canLogReceiving(user),
    retrieve(db, q = {}, user = null) {
      if (user && !moduleLevel(user, 'receiving-log')) return [];
      if (q.equipment) return [];
      const { where, params } = common(q, { at: 'inspection_date', by: 'inspector', signedBy: 'reviewed_by' });
      if (q.place) return [];
      if (q.lot) {
        where.push('(lower(vendor_lot) = lower(?) OR EXISTS (SELECT 1 FROM receiving_log l WHERE l.inspection_no = receiving_checklists.inspection_no AND lower(l.vendor_lot) = lower(?)))');
        params.push(String(q.lot).trim(), String(q.lot).trim());
      }
      return db.prepare(`SELECT * FROM receiving_checklists ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
        ORDER BY inspection_date DESC, created_at DESC LIMIT ?`).all(...params, cap(q)).map(r => withLots(db, r));
    },
    describe(r) {
      const lots = [...new Set([r.vendor_lot, ...(r._line_lots || [])].filter(Boolean))];
      const answers = jsonOf(r.answers, {});
      return {
        type: 'receiving', id: r.id,
        form: `FORM 204-01 ${r.checklist_revision || ''}`.trim(), revision: r.checklist_revision || null,
        title: `Receiving inspection ${r.inspection_no}${r.vendor ? ` — ${r.vendor}` : ''}`,
        inspection_no: r.inspection_no, vendor: r.vendor || null, po_number: r.po_number || null,
        place: null, equipment_id: null,
        performed_by: r.inspector, performed_at: r.inspection_date,
        result: r.reviewed_at ? (r.system_status || 'signed off') : `open, ${Object.keys(answers).length} answered`,
        lot: lots[0] || null, lots,
        signed_by: r.reviewed_by || null, signed_at: r.reviewed_at || null,
        signatures: r.reviewed_by ? [{ role: 'reviewed', label: 'Packet reviewed by', name: r.reviewed_by, at: r.reviewed_at }] : [],
        group: null,
        link: { tab: 'receiving-log', id: r.inspection_no },
      };
    },
};

// ── Calibration records ─────────────────────────────────────────────────────
// A technician's calibration of an instrument. The RECORD carries no signature;
// an out-of-calibration finding owes a product decision (D-154), which is signed
// with the password on its own route and described here as `disposition`.
export const CALIBRATION_TYPE = {
  type: 'calibration',
  label: 'Calibration records',
  modules: ['calibration'],
  signs: false,
  file: (db, user, input) => {
    const out = fileCalibrationRecord(db, user, input);
    return out.error ? out : { status: 201, id: out.record.id, row: out.record };
  },
  get: (db, id) => db.prepare('SELECT * FROM calibration_records WHERE id = ?').get(id) || null,
  canRead: (user) => !!moduleLevel(user, 'calibration'),
  retrieve(db, q = {}, user = null) {
    if (user && !moduleLevel(user, 'calibration')) return [];
    if (q.signed === 'yes' || q.place) return [];
    const { where, params } = common(q, { at: 'cr.calibrated_at', by: 'cr.calibrated_by', signedBy: null });
    if (q.equipment) { where.push('cr.instrument_id = ?'); params.push(q.equipment); }
    return db.prepare(`SELECT cr.*, ci.name AS instrument_name, ci.asset_number AS instrument_tag FROM calibration_records cr
      LEFT JOIN calibration_instruments ci ON ci.id = cr.instrument_id
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY cr.calibrated_at DESC LIMIT ?`).all(...params, cap(q));
  },
  describe: (r) => ({
    type: 'calibration', id: r.id,
    form: 'Calibration record', revision: null,
    title: `Calibration — ${r.instrument_name || r.instrument_id}`,
    place: null, equipment_id: r.instrument_id,
    performed_by: r.calibrated_by, performed_at: r.calibrated_at,
    result: r.result,
    certificate_number: r.certificate_number || null, next_due: r.next_due || null,
    disposition: r.disposition || null, disposition_by: r.disposition_by || null, disposition_at: r.disposition_at || null,
    lot: null, signed_by: null, signed_at: null, signatures: [], group: null,
    link: { tab: 'calibration', id: r.id },
  }),
};
