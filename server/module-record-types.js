// The remaining module records on the record interface (single-spine move 02,
// pack P3): each an adapter over the module's own writer — nothing here writes
// a record column. D-371: the receiving checklist and calibration records.
//
//   receiving    receiving_checklists   saveReceivingChecklist · signReceivingChecklist · revokeReceivingSignoff
//   calibration  calibration_records    fileCalibrationRecord (no signature on the record itself; the
//                                       product decision it may owe is signed separately — described here)
// D-372: training records, disposals, and COA requests (read side only — see COA_TYPE).
//   training     training_records       fileTrainingRecord (insertCompletion) · withdrawCompetence
//   disposal     disposals              fileDisposal · signDisposal · revokeDisposalApproval
import { rowLimit } from './record-cap.js';
import { moduleLevel } from './module-access.js';
import { saveReceivingChecklist, signReceivingChecklist, revokeReceivingSignoff, canLog as canLogReceiving } from './api/receiving.js';
import { fileCalibrationRecord } from './api/calibration.js';
import { fileTrainingRecord, withdrawCompetence } from './api/training.js';
import { fileDisposal, signDisposal, revokeDisposalApproval } from './api/disposals.js';
import { fileSampling, signSampling, revokeSampling, canFileSampling } from './incoming-sampling.js';

const sqlDate = (d) => /^\d{4}-\d{2}-\d{2}$/.test(String(d || '')) ? String(d) : null;
const cap = rowLimit;
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

// ── Incoming sampling (D-394) ───────────────────────────────────────────────
// The step after a signed receiving inspection: a lot sampled per SOP 402 V3
// and released, held or rejected, signed by QA with the password.
export const INCOMING_SAMPLING_TYPE = {
    type: 'incoming_sampling',
    label: 'Incoming sampling (SOP 402, DRAFT-1)',
    modules: ['receiving-log'],
    filters: ['lot'],
    file: (db, user, input) => {
      const out = fileSampling(db, user, input);
      return out.error ? out : { status: out.status, id: out.row.id, row: out.row };
    },
    sign: (db, user, id, opts = {}) => signSampling(db, user, id, opts),
    revoke: (db, user, id, opts = {}) => revokeSampling(db, user, id, opts),
    get: (db, id) => db.prepare('SELECT * FROM incoming_samplings WHERE id = ? OR sampling_no = ?').get(id, id) || null,
    canRead: (user) => !!moduleLevel(user, 'receiving-log'),
    canFile: (user) => canFileSampling(user),
    retrieve(db, q = {}, user = null) {
      if (user && !moduleLevel(user, 'receiving-log')) return [];
      if (q.equipment || q.place) return [];
      const { where, params } = common(q, { at: 'sampled_at', by: 'created_by', signedBy: 'signed_by' });
      if (q.lot) {
        where.push('(lower(vendor_lot) = lower(?) OR lower(COALESCE(internal_lot, \'\')) = lower(?))');
        params.push(String(q.lot).trim(), String(q.lot).trim());
      }
      return db.prepare(`SELECT * FROM incoming_samplings ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
        ORDER BY sampled_at DESC, created_at DESC LIMIT ?`).all(...params, cap(q));
    },
    describe(r) {
      const lots = [...new Set([r.vendor_lot, r.internal_lot].filter(Boolean))];
      return {
        type: 'incoming_sampling', id: r.id,
        form: `Incoming sampling ${r.form_revision || ''}`.trim(), revision: r.form_revision || null,
        title: `Sampling ${r.sampling_no} — ${r.item_name || r.part_number || 'material'}${r.vendor ? ` (${r.vendor})` : ''}`,
        inspection_no: r.inspection_no || null, vendor: r.vendor || null, po_number: r.po_number || null,
        place: null, equipment_id: null,
        performed_by: r.created_by, performed_at: r.sampled_at,
        result: r.signed_at ? (r.disposition || 'signed') : 'open',
        lot: lots[0] || null, lots,
        signed_by: r.signed_by || null, signed_at: r.signed_at || null,
        signatures: r.signed_by ? [{ role: 'sampling', label: r.sign_meaning || 'Sampled and dispositioned by', name: r.signed_by, at: r.signed_at }] : [],
        group: null,
        link: { tab: 'receiving-log', view: 'sampling', id: r.sampling_no },
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
  // A record names its instrument; a machine finds the instruments linked to it.
  filters: ['equipment'],
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
    if (q.equipment) { where.push('(cr.instrument_id = ? OR cr.instrument_id IN (SELECT id FROM calibration_instruments WHERE equipment_id = ?))'); params.push(q.equipment, q.equipment); }
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

// ── Training records (D-372) ────────────────────────────────────────────────
// One record is one person's completion of one course (D-351). Its signature is
// the competence sign-off, signed when the record is filed (or ticked on edit)
// with the trainer's password — there is no separate "sign later" door, so the
// type has no `sign`. Withdrawing it (reason + password) is `revoke`.
// The course's own title, not a copy on the record: a record filed against a
// course carries its id and often no topic text.
const TRAINING_SQL = 'SELECT tr.*, c.title AS course_title, c.code AS course_code, c.equipment_id AS course_equipment_id FROM training_records tr LEFT JOIN training_courses c ON c.id = tr.course_id';

export const TRAINING_TYPE = {
  type: 'training',
  label: 'Training records',
  modules: ['training'],
  // A course can be ABOUT a machine (training_courses.equipment_id): who is
  // trained to run or clean it is part of "everything about machine E".
  filters: ['equipment'],
  absent: { sign: 'The competence sign-off is signed when the record is filed or edited, with the trainer\'s password — there is no separate sign door.' },
  // No password can be asked here, so a ticked competence statement is refused
  // (403) and only a record proved by a passed quiz files through the interface.
  file: (db, user, input) => {
    const out = fileTrainingRecord(db, user, input);
    return out.error ? out : { status: 201, id: out.record.id, row: out.record };
  },
  // `opts.reason` is required; the route in front has run gateSignature.
  revoke: (db, user, id, opts = {}) => withdrawCompetence(db, user, id, opts.reason),
  get: (db, id) => db.prepare(`${TRAINING_SQL} WHERE tr.id = ?`).get(id) || null,
  canRead: (user) => !!moduleLevel(user, 'training'),
  retrieve(db, q = {}, user = null) {
    if (user && !moduleLevel(user, 'training')) return [];
    if (q.place) return [];
    // A person is the trainee, the trainer, or whoever signed the competence.
    const { where, params } = common({ ...q, person: null }, { at: 'COALESCE(tr.completion_date, tr.training_date)', by: 'tr.employee_name', signedBy: 'tr.competence_signed_by' });
    if (q.person) {
      where.push("(lower(tr.employee_name) = lower(?) OR lower(COALESCE(tr.trainer, '')) = lower(?) OR lower(COALESCE(tr.competence_signed_by, '')) = lower(?))");
      params.push(...Array(3).fill(String(q.person).trim()));
    }
    if (q.equipment) { where.push('c.equipment_id = ?'); params.push(q.equipment); }
    return db.prepare(`${TRAINING_SQL} ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY COALESCE(tr.completion_date, tr.training_date) DESC, tr.created_at DESC LIMIT ?`).all(...params, cap(q));
  },
  describe: (r) => ({
    type: 'training', id: r.id,
    form: 'Training record', revision: r.sop_revision || null,
    title: `${r.course_title || r.training_topic || 'Training'} — ${r.employee_name}`,
    course: r.course_code ? `${r.course_code} ${r.course_title}` : (r.course_title || r.training_topic || null),
    course_id: r.course_id || null, trainee: r.employee_name, trainer: r.trainer || null,
    place: null, equipment_id: r.course_equipment_id || null,
    performed_by: r.employee_name, performed_at: r.completion_date || r.training_date,
    result: r.passed === 0 ? 'failed' : r.status,
    score: r.score ?? null, method: r.method || null,
    lot: null,
    signed_by: r.competence_signed_by || null, signed_at: r.competence_signed_at || null,
    signatures: r.competence_signed_by ? [{ role: 'competence', label: r.competence_meaning || 'Trained and competent', name: r.competence_signed_by, at: r.competence_signed_at }] : [],
    group: null,
    link: { tab: 'training', view: 'records', id: r.id },
  }),
};

// ── Disposals ───────────────────────────────────────────────────
// A disposal carries two approvals (Operations Manager, Quality Control) in its
// `approvals` JSON; its lines (disposal_items) carry the item numbers and lots.
const disposalItems = (db, id) => { try { return db.prepare('SELECT item_name, item_number, lot_number FROM disposal_items WHERE disposal_id = ? ORDER BY sort_order, rowid').all(id); } catch { return []; } };
const withItems = (db, r) => (r ? { ...r, _items: disposalItems(db, r.id) } : null);
const DISPOSAL_ROLES = { ops_manager: 'Operations Manager', quality_control: 'Quality Control' };

export const DISPOSAL_TYPE = {
  type: 'disposal',
  label: 'Disposals',
  modules: ['disposals'],
  filters: ['lot'],
  file: (db, user, input) => fileDisposal(db, user, input),
  // `opts.role` names the approval (ops_manager | quality_control).
  sign: (db, user, id, opts = {}) => signDisposal(db, user, id, opts.role),
  revoke: (db, user, id, opts = {}) => revokeDisposalApproval(db, user, id, opts.role),
  get: (db, id) => withItems(db, db.prepare('SELECT * FROM disposals WHERE id = ?').get(id)),
  canRead: (user) => !!moduleLevel(user, 'disposals'),
  retrieve(db, q = {}, user = null) {
    if (user && !moduleLevel(user, 'disposals')) return [];
    if (q.equipment || q.place) return [];
    const at = 'COALESCE(disposal_date, created_at)';
    const where = []; const params = [];
    const from = sqlDate(q.from); const to = sqlDate(q.to);
    if (from) { where.push(`substr(${at}, 1, 10) >= ?`); params.push(from); }
    if (to) { where.push(`substr(${at}, 1, 10) <= ?`); params.push(to); }
    const signedAny = "EXISTS (SELECT 1 FROM json_each(COALESCE(approvals, '{}')))";
    if (q.person) {
      where.push(`(lower(COALESCE(created_by, '')) = lower(?) OR lower(COALESCE(witness, '')) = lower(?) OR EXISTS (SELECT 1 FROM json_each(COALESCE(approvals, '{}')) WHERE lower(json_extract(value, '$.name')) = lower(?)))`);
      params.push(...Array(3).fill(String(q.person).trim()));
    }
    if (q.signed === 'yes') where.push(signedAny);
    if (q.signed === 'no') where.push(`NOT ${signedAny}`);
    if (q.lot) { where.push('EXISTS (SELECT 1 FROM disposal_items i WHERE i.disposal_id = disposals.id AND lower(i.lot_number) = lower(?))'); params.push(String(q.lot).trim()); }
    return db.prepare(`SELECT * FROM disposals ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY ${at} DESC LIMIT ?`)
      .all(...params, cap(q)).map(r => withItems(db, r));
  },
  describe(r) {
    const a = jsonOf(r.approvals, {});
    const sigs = Object.entries(a).filter(([k]) => DISPOSAL_ROLES[k]).map(([k, v]) => ({ role: k, label: DISPOSAL_ROLES[k], name: v.name, at: v.signed_at }))
      .sort((x, y) => String(x.at).localeCompare(String(y.at)));
    const items = r._items || [];
    const lots = [...new Set(items.map(i => i.lot_number).filter(Boolean))];
    const last = sigs[sigs.length - 1] || null;
    return {
      type: 'disposal', id: r.id,
      form: r.document_rev ? `Disposal · ${r.document_rev}` : 'Disposal', revision: r.document_rev || null,
      title: `Disposal ${r.disposal_number || ''}`.trim() + (items[0]?.item_name ? ` — ${items.map(i => i.item_name).filter(Boolean).slice(0, 3).join(', ')}` : ''),
      place: null, equipment_id: null,
      performed_by: r.created_by, performed_at: r.disposal_date || r.created_at,
      result: sigs.length === 2 ? 'approved' : sigs.length ? 'partly approved' : 'awaiting approval',
      items: items.length, lot: lots[0] || null, lots,
      signed_by: last?.name || null, signed_at: last?.at || null, signatures: sigs,
      approvals_pending: Object.keys(DISPOSAL_ROLES).filter(k => !a[k]),
      group: null,
      link: { tab: 'disposals', id: r.id },
    };
  },
};

// ── COA requests and their certificates — READ SIDE ONLY (D-372) ─────────────
// What the plant means by "a COA record" is the lab request, and once signed,
// the Powder Ops certificate on it (certificate_number, signed_snapshot). The
// doors are NOT wrapped here, and that is deliberate: filing a request, signing
// a certificate and un-signing one live in api/coa.js beside the release gate,
// the re-read of every lab report, certificate numbering and the correction
// window (D-221 … D-312). Lifting those out is module work, not an adapter, and
// a second door to a COA signature is the one thing this interface must not add.
export const COA_TYPE = {
  type: 'coa',
  label: 'COA requests and certificates',
  modules: ['coa'],
  filters: ['lot'],
  absent: {
    file: 'A lab request is filed on the COA screen, beside its release gate and receiving link.',
    sign: 'A certificate is signed on the COA screen: the release gate, the lab-report re-read and the certificate number are part of the act.',
    revoke: 'A certificate is un-signed only on the COA screen, by an admin or inside a correction window, with a reason and the password.',
  },
  get: (db, id) => db.prepare('SELECT * FROM coa_requests WHERE id = ?').get(id) || null,
  canRead: (user) => !!moduleLevel(user, 'coa'),
  retrieve(db, q = {}, user = null) {
    if (user && !moduleLevel(user, 'coa')) return [];
    if (q.equipment || q.place) return [];
    const at = 'COALESCE(date_of_issuance, date_of_results, date_sent, created_at)';
    const { where, params } = common(q, { at, by: 'requested_by', signedBy: 'qa_signed_by' });
    if (q.lot) { where.push('(lower(lot_number) = lower(?) OR lower(COALESCE(base_lot, \'\')) = lower(?))'); params.push(String(q.lot).trim(), String(q.lot).trim()); }
    return db.prepare(`SELECT * FROM coa_requests ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY ${at} DESC LIMIT ?`).all(...params, cap(q));
  },
  describe: (r) => ({
    type: 'coa', id: r.id,
    form: r.certificate_number ? `Certificate ${r.certificate_number}` : 'COA request', revision: null,
    title: `${r.item_description} — lot ${r.lot_number}`,
    item_number: r.item_number, lab: r.lab_name || null, tests: r.tests_requested || null,
    place: null, equipment_id: null,
    performed_by: r.requested_by || r.created_by, performed_at: r.date_of_issuance || r.date_of_results || r.date_sent || r.created_at,
    result: r.status,
    certificate_number: r.certificate_number || null,
    lot: r.lot_number, lots: [...new Set([r.lot_number, r.base_lot].filter(Boolean))],
    signed_by: r.qa_signed_by || null, signed_at: r.qa_signed_at || null,
    signatures: r.qa_signed_by ? [{ role: 'qa', label: 'QA signature', name: r.qa_signed_by, at: r.qa_signed_at }] : [],
    group: r.brand_owner || null,
    link: { tab: 'coa', id: r.id },
  }),
};
