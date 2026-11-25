// THE RECORD INTERFACE (single-spine move 02, D-207).
//
// "A record interface before a record table" (architecture.md § 02): the tables
// stay where they are, and every record module says the same five things about
// its records — how one is FILED, SIGNED, how a signature is REVOKED, how they
// are RETRIEVED, and how one is DESCRIBED in a common shape. That buys one
// retrieval surface and honest counts without a migration, and is what makes a
// shared table optional later rather than urgent.
//
// THE ADAPTERS CALL THE MODULE'S OWN FUNCTIONS. Nothing here writes a record
// column. `sign` is verifySanitationRecord / verifyScaleCheck — the functions
// the module routes and QA Review already call — so a signature made through
// the interface is byte-for-byte the module's. A second writer is the defect
// this project keeps unpicking.
//
// THE PASSWORD IS THE CALLER'S. `sign` assumes the route in front of it has
// already run gateSignature; the interface is a service, not a door.
//
// Adopted so far: sanitation records, scale verifications, every QMS form
// (deviations, non-conformances, on-hold, the sign-out logs, DCRs, flavour
// approvals, organoleptic tests — one `qms` type, narrowed by `qms_type`), and
// the six check records (D-369, server/check-record-types.js). A new type is
// one entry in RECORD_TYPES that implements all five, or declares `signs: false`
// (no signature exists) and/or `filedBy: ['task']` (filed only by completing its
// task); the shape check in verify:recordinterface refuses anything else.
import { createSanitationRecord, verifySanitationRecord, revokeSanitationVerification } from './api/sanitation.js';
import { recordScaleVerification, verifyScaleCheck, revokeScaleVerification } from './api/scale-verification.js';
import { getScaleForm } from './scale-forms.js';
import { createQmsRecord, signQmsApproval, revokeQmsApproval } from './api/qms.js';
import { fileProductionEntry, signOffProductionEntry, revokeProductionSignoff } from './api/production.js';
import { QMS_TYPES, getType } from './qms-config.js';
import { formLabel } from '../shared/form-registry.js';
import { moduleLevel } from './module-access.js';
import { CHECK_RECORD_TYPES } from './check-record-types.js';
import { isLookup, requestedCap, rowLimit } from './record-cap.js';
import { RECEIVING_TYPE, INCOMING_SAMPLING_TYPE, CALIBRATION_TYPE, TRAINING_TYPE, DISPOSAL_TYPE, COA_TYPE } from './module-record-types.js';

export const INTERFACE = ['file', 'sign', 'revoke', 'retrieve', 'describe'];
export { MAX_ROWS } from './record-cap.js';
// Filters beyond from / to / person / signed / place / form, which a type
// declares in `filters` when it understands them (D-370). A machine
// (`equipment`, an equipment id) joined them in D-375: only a record that names
// a machine can be found by one, and the lookup screen names every type that
// cannot take a filter rather than reading its silence as "nothing here".
export const EXTRA_FILTERS = ['lot', 'equipment', 'mo', 'team', 'site'];
export const FILTER_WORDS = { lot: 'a lot', equipment: 'a machine', mo: 'an MO', team: 'a team', site: 'an EMP site' };

const sqlDate = (d) => /^\d{4}-\d{2}-\d{2}$/.test(String(d || '')) ? String(d) : null;

// Shared WHERE for the common filters. `person` matches who did the work or who
// signed it — "everything Zuleika touched" means both.
function commonWhere(cols, q) {
  const where = []; const params = [];
  const from = sqlDate(q.from); const to = sqlDate(q.to);
  if (from) { where.push(`substr(${cols.at}, 1, 10) >= ?`); params.push(from); }
  if (to) { where.push(`substr(${cols.at}, 1, 10) <= ?`); params.push(to); }
  if (q.person) {
    where.push(`(lower(${cols.by}) = lower(?) OR lower(COALESCE(${cols.signedBy}, '')) = lower(?))`);
    params.push(String(q.person).trim(), String(q.person).trim());
  }
  if (q.signed === 'yes') where.push(`${cols.signedBy} IS NOT NULL`);
  if (q.signed === 'no') where.push(`${cols.signedBy} IS NULL`);
  return { where, params };
}

const describeSanitation = (r) => ({
  type: 'sanitation',
  id: r.id,
  form: formLabel({ sanitationArea: r.area }),
  title: r.area,
  place: r.area,
  equipment_id: r.equipment_id || null,
  performed_by: r.performed_by,
  performed_at: r.performed_at,
  result: r.result,
  signed_by: r.verified_by || null,
  signed_at: r.verified_at || null,
  group: r.record_group || null,
  link: { tab: r.record_group === 'qa' ? 'qa-inspections' : 'sanitation', id: r.id },
});

const describeScale = (r) => {
  const form = getScaleForm(r.form_code);
  return {
    type: 'scale',
    id: r.id,
    form: form ? `FORM ${form.code}${form.revision ? ` ${form.revision}` : ''}` : r.form_code,
    title: r.form_title,
    place: r.room || null,
    equipment_id: r.instrument_id || null,
    performed_by: r.performed_by,
    performed_at: r.performed_at,
    result: r.result,
    signed_by: r.verified_by || null,
    signed_at: r.verified_at || null,
    group: null,
    link: { tab: 'calibration', view: 'scale', id: r.id },
  };
};

// ── QMS records ─────────────────────────────────────────────────────────────
// One table holds every QMS form (`qms_records.record_type`), and a record can
// carry several approvals (`approvals` JSON, keyed by role). So the described
// row names every signature, and `signed_by` is the latest of them.
const parseJson = (raw, fb) => { try { return raw ? JSON.parse(raw) : fb; } catch { return fb; } };
const qmsSignatures = (cfg, row) => {
  const a = parseJson(row.approvals, {});
  return (cfg?.approvals || []).filter(x => a[x.key]).map(x => ({
    role: x.key, label: x.label, name: a[x.key].name, at: a[x.key].signed_at,
  })).sort((p, q) => String(p.at).localeCompare(String(q.at)));
};
const qmsModuleIds = [...new Set(Object.values(QMS_TYPES).map(c => c.moduleId).filter(Boolean))];
const qmsReadable = (user) => Object.values(QMS_TYPES).filter(c => moduleLevel(user, c.moduleId)).map(c => c.key);

const describeQms = (r) => {
  const cfg = getType(r.record_type);
  const data = parseJson(r.data, {});
  const sigs = qmsSignatures(cfg, r);
  const last = sigs[sigs.length - 1] || null;
  const what = cfg?.primaryField ? data[cfg.primaryField] : null;
  return {
    type: 'qms',
    id: r.id,
    form: cfg?.formCode || r.record_type,
    title: `${cfg?.singular || r.record_type} ${r.record_number || ''}`.trim() + (what ? ` — ${what}` : ''),
    lots: [...new Set([data.lot_number, data.lot].map(v => String(v || '').trim()).filter(Boolean))],
    place: null,
    equipment_id: null,
    performed_by: r.created_by,
    performed_at: r.record_date || r.created_at,
    result: r.status || null,
    signed_by: last?.name || null,
    signed_at: last?.at || null,
    signatures: sigs,
    approvals_pending: (cfg?.approvals || []).filter(x => !sigs.some(s => s.role === x.key)).map(x => x.key),
    group: r.record_type,
    link: { tab: cfg?.moduleId || null, id: r.id },
  };
};

// Which role an act is about. A form with ONE approval needs no name; a form
// with several must be told, or the interface would be guessing which
// signature somebody meant.
function qmsRole(cfg, row, role, { signing }) {
  if (role) return role;
  if (signing) return (cfg.approvals || []).length === 1 ? cfg.approvals[0].key : null;
  const signed = Object.keys(parseJson(row.approvals, {}));
  return signed.length === 1 ? signed[0] : null;
}

// ── Production entries (D-370) ──────────────────────────────────────────────
// One end-of-day entry is one shift; a Batching shift carries several MOs in
// `mo_lines` (line 0 mirrored into the scalar columns). The described row names
// EVERY lot and MO on it, so "everything about lot L" finds the second MO of a
// shift as readily as the first.
const prodLines = (r) => parseJson(r.mo_lines, []);
const describeProduction = (r) => {
  const lines = prodLines(r);
  const lots = [...new Set([r.lot_number, ...lines.map(l => l.lot_number)].filter(Boolean))];
  const mos = [...new Set([r.mo_number, ...lines.map(l => l.mo_number)].filter(Boolean))];
  const products = [...new Set([r.product_name, ...lines.map(l => l.product_name)].filter(Boolean))];
  const what = products.length ? products.join(', ') : 'Cleaning only';
  return {
    type: 'production',
    id: r.id,
    form: `Production Log · ${r.team} EOD`,
    title: `${r.team} — ${what}${mos.length ? ` (${mos.join(', ')})` : ''}`,
    place: r.room || null,
    team: r.team,
    equipment_id: null,
    performed_by: r.submitted_by,
    performed_at: r.date,
    shift: r.start_time || r.end_time ? `${r.start_time || '?'}–${r.end_time || '?'}` : null,
    result: r.qa_waived_at ? 'waived' : r.qa_signoff_by ? (r.qa_action_required ? 'signed, correction asked' : 'signed') : 'pending QA',
    quantity: r.quantity_completed,
    lot: lots[0] || null, lots,
    mo: mos[0] || null, mos,
    products,
    signed_by: r.qa_signoff_by || null,
    signed_at: r.qa_signoff_at || null,
    signatures: r.qa_signoff_by ? [{ role: 'qa', label: 'QA sign-off', name: r.qa_signoff_by, at: r.qa_signoff_at }] : [],
    group: r.team,
    link: { tab: 'production-log', id: r.id },
  };
};
const jsonHas = (col, key) => `EXISTS (SELECT 1 FROM json_each(COALESCE(${col}, '[]')) WHERE lower(json_extract(value, '$.${key}')) = lower(?))`;

export const RECORD_TYPES = [
  {
    type: 'sanitation',
    label: 'Sanitation & QA inspection records',
    // A record on QA's list is read under QA Inspections, a cleaning record under
    // Sanitation — the same split `recordGroupFor()` makes on write.
    modules: ['sanitation', 'qa-inspections'],
    filters: ['equipment'],
    file: (db, user, input) => createSanitationRecord(db, user, input),
    sign: (db, user, id) => verifySanitationRecord(db, user, id),
    revoke: (db, user, id) => revokeSanitationVerification(db, user, id),
    get: (db, id) => db.prepare('SELECT * FROM sanitation_records WHERE id = ?').get(id) || null,
    canRead: (user, r) => !!moduleLevel(user, r.record_group === 'qa' ? 'qa-inspections' : 'sanitation'),
    retrieve(db, q = {}, user = null) {
      const { where, params } = commonWhere({ at: 'performed_at', by: 'performed_by', signedBy: 'verified_by' }, q);
      if (q.equipment) { where.push('equipment_id = ?'); params.push(q.equipment); }
      if (q.place) { where.push('lower(area) = lower(?)'); params.push(String(q.place).trim()); }
      if (user) {
        const groups = [];
        if (moduleLevel(user, 'sanitation')) groups.push('sanitation');
        if (moduleLevel(user, 'qa-inspections')) groups.push('qa');
        if (!groups.length) return [];
        where.push(`COALESCE(record_group, 'sanitation') IN (${groups.map(() => '?').join(',')})`);
        params.push(...groups);
      }
      const sql = `SELECT * FROM sanitation_records ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
        ORDER BY performed_at DESC LIMIT ?`;
      return db.prepare(sql).all(...params, rowLimit(q));
    },
    describe: describeSanitation,
  },
  {
    type: 'scale',
    label: 'Scale verifications (Forms 417-01 … 417-05)',
    modules: ['calibration'],
    // A scale check names its instrument; a machine finds the instruments linked to it.
    filters: ['equipment'],
    // The kiosk files with no session; the interface files as the signed-in person.
    file: (db, user, input) => recordScaleVerification(db, input, { actor: user, source: 'app' }),
    sign: (db, user, id) => verifyScaleCheck(db, user, id),
    revoke: (db, user, id) => revokeScaleVerification(db, user, id),
    get: (db, id) => db.prepare('SELECT * FROM scale_verifications WHERE id = ?').get(id) || null,
    canRead: (user) => !!moduleLevel(user, 'calibration'),
    retrieve(db, q = {}, user = null) {
      if (user && !moduleLevel(user, 'calibration')) return [];
      const { where, params } = commonWhere({ at: 'performed_at', by: 'performed_by', signedBy: 'verified_by' }, q);
      if (q.equipment) { where.push('(instrument_id = ? OR instrument_id IN (SELECT id FROM calibration_instruments WHERE equipment_id = ?))'); params.push(q.equipment, q.equipment); }
      if (q.place) { where.push('lower(room) = lower(?)'); params.push(String(q.place).trim()); }
      const sql = `SELECT * FROM scale_verifications ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
        ORDER BY performed_at DESC LIMIT ?`;
      return db.prepare(sql).all(...params, rowLimit(q));
    },
    describe: describeScale,
  },
  {
    type: 'qms',
    label: 'QMS records (deviations, non-conformances, on hold, sign-outs, DCRs, flavour and organoleptic)',
    // Six forms carry a lot (`lot_number` or `lot` in the record's data); a form
    // with neither simply matches no lot.
    filters: ['lot'],
    modules: qmsModuleIds,
    // `input.record_type` names the form. Filing needs the module, the rule the
    // route applies (anyone who can see a deviation may report one).
    file(db, user, input = {}) {
      const cfg = getType(input.record_type);
      if (!cfg) return { error: 'Unknown QMS record type', status: 400 };
      if (user?.role !== 'admin' && !moduleLevel(user, cfg.moduleId)) return { error: 'Not found', status: 404 };
      return createQmsRecord(db, cfg, user, input);
    },
    // opts.role names the approval; opts.record_type, when given, must match —
    // a queue working one form must never sign another form's record.
    sign(db, user, id, opts = {}) {
      const row = db.prepare('SELECT * FROM qms_records WHERE id = ?').get(id);
      if (!row || (opts.record_type && row.record_type !== opts.record_type)) return { error: 'Not found', status: 404 };
      const cfg = getType(row.record_type);
      const role = qmsRole(cfg, row, opts.role, { signing: true });
      if (!role) return { error: 'This form has more than one approval — say which one.', status: 400 };
      return signQmsApproval(db, cfg, id, user, role, { batch: !!opts.batch });
    },
    revoke(db, user, id, opts = {}) {
      const row = db.prepare('SELECT * FROM qms_records WHERE id = ?').get(id);
      if (!row || (opts.record_type && row.record_type !== opts.record_type)) return { error: 'Not found', status: 404 };
      const cfg = getType(row.record_type);
      const role = qmsRole(cfg, row, opts.role, { signing: false });
      if (!role) return { error: 'Say which signature to revoke.', status: 400 };
      return revokeQmsApproval(db, cfg, id, user, role);
    },
    get: (db, id) => db.prepare('SELECT * FROM qms_records WHERE id = ?').get(id) || null,
    canRead: (user, r) => !!moduleLevel(user, getType(r.record_type)?.moduleId),
    retrieve(db, q = {}, user = null) {
      // No QMS record carries a machine or a place column, so a filter on
      // either matches none of them rather than all of them.
      if (q.equipment || q.place) return [];
      let types = user ? qmsReadable(user) : Object.keys(QMS_TYPES);
      if (q.qms_type) {
        const want = new Set(String(q.qms_type).split(','));
        types = types.filter(k => want.has(k));
      }
      if (!types.length) return [];
      const at = 'COALESCE(record_date, created_at)';
      const where = [`record_type IN (${types.map(() => '?').join(',')})`];
      const params = [...types];
      const from = sqlDate(q.from); const to = sqlDate(q.to);
      if (from) { where.push(`substr(${at}, 1, 10) >= ?`); params.push(from); }
      if (to) { where.push(`substr(${at}, 1, 10) <= ?`); params.push(to); }
      const signedAny = "EXISTS (SELECT 1 FROM json_each(COALESCE(approvals, '{}')))";
      if (q.person) {
        where.push(`(lower(created_by) = lower(?) OR EXISTS (SELECT 1 FROM json_each(COALESCE(approvals, '{}')) WHERE lower(json_extract(value, '$.name')) = lower(?)))`);
        params.push(String(q.person).trim(), String(q.person).trim());
      }
      if (q.signed === 'yes') where.push(signedAny);
      if (q.signed === 'no') where.push(`NOT ${signedAny}`);
      if (q.lot) {
        where.push("(lower(trim(COALESCE(json_extract(data, '$.lot_number'), ''))) = lower(?) OR lower(trim(COALESCE(json_extract(data, '$.lot'), ''))) = lower(?))");
        params.push(String(q.lot).trim(), String(q.lot).trim());
      }
      const sql = `SELECT * FROM qms_records WHERE ${where.join(' AND ')} ORDER BY ${at} DESC LIMIT ?`;
      return db.prepare(sql).all(...params, rowLimit(q));
    },
    describe: describeQms,
  },
  {
    type: 'production',
    label: 'Production entries (end-of-day reports)',
    modules: ['production-log'],
    // filters beyond the common ones that this type understands (retrieveRecords
    // leaves out every type that does not — a lot asked of a cleaning record is
    // not a match).
    filters: ['lot', 'mo', 'team'],
    file: (db, user, input) => fileProductionEntry(db, { submitted_by: user?.name, ...input }),
    // The signer is the person; `notes` / `actionRequired` are QA's note and
    // correction flag. The route in front has run gateSignature.
    sign: (db, user, id, opts = {}) => signOffProductionEntry(db, id, { by: user?.name, notes: opts.notes, actionRequired: opts.actionRequired }),
    revoke: (db, user, id) => revokeProductionSignoff(db, user, id),
    get: (db, id) => db.prepare('SELECT * FROM production_entries WHERE id = ?').get(id) || null,
    canRead: (user) => !!moduleLevel(user, 'production-log'),
    retrieve(db, q = {}, user = null) {
      if (user && !moduleLevel(user, 'production-log')) return [];
      if (q.equipment) return [];
      const where = []; const params = [];
      const from = sqlDate(q.from); const to = sqlDate(q.to);
      if (from) { where.push('date >= ?'); params.push(from); }
      if (to) { where.push('date <= ?'); params.push(to); }
      if (q.person) {
        where.push('(lower(submitted_by) = lower(?) OR lower(COALESCE(qa_signoff_by, \'\')) = lower(?))');
        params.push(String(q.person).trim(), String(q.person).trim());
      }
      if (q.signed === 'yes') where.push('qa_signoff_by IS NOT NULL');
      if (q.signed === 'no') where.push('qa_signoff_by IS NULL');
      if (q.place) { where.push(`(lower(room) = lower(?) OR ${jsonHas('mo_lines', 'room')} OR ${jsonHas('cleaning_events', 'room')})`); params.push(...Array(3).fill(String(q.place).trim())); }
      if (q.team) { where.push('lower(team) = lower(?)'); params.push(String(q.team).trim()); }
      if (q.lot) { where.push(`(lower(lot_number) = lower(?) OR ${jsonHas('mo_lines', 'lot_number')})`); params.push(...Array(2).fill(String(q.lot).trim())); }
      if (q.mo) { where.push(`(lower(mo_number) = lower(?) OR ${jsonHas('mo_lines', 'mo_number')})`); params.push(...Array(2).fill(String(q.mo).trim())); }
      const sql = `SELECT * FROM production_entries ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
        ORDER BY date DESC, created_at DESC LIMIT ?`;
      return db.prepare(sql).all(...params, rowLimit(q));
    },
    describe: describeProduction,
  },
  // The check records (D-369): six kinds, each through the writer it already
  // had. They carry no signature, so they declare `signs: false` and leave
  // `sign` / `revoke` out — the documented subset, not a gap.
  ...CHECK_RECORD_TYPES,
  // Receiving inspections and calibration records (D-371, server/module-record-types.js).
  RECEIVING_TYPE,
  // Incoming sampling, the step after receiving — D-394.
  INCOMING_SAMPLING_TYPE,
  CALIBRATION_TYPE,
  // Training records, disposals, and COA (read side only) — D-372.
  TRAINING_TYPE,
  DISPOSAL_TYPE,
  COA_TYPE,
];

export const recordType = (type) => RECORD_TYPES.find(t => t.type === type) || null;

/** May this person read records of this type at all? */
export const canReadType = (user, t) => (t.canReadAny ? !!t.canReadAny(user) : t.modules.some(m => moduleLevel(user, m)));

/** The verbs a type implements. A missing verb is documented: `signs: false`, `filedBy: ['task']`, or `absent[verb]` with the reason. */
export const verbsOf = (t) => INTERFACE.filter(k => typeof t[k] === 'function');

/**
 * One list across every adopted type, newest first, each row described the same
 * way. `form` narrows to records whose form label starts with it ("FORM 417").
 *
 * A lookup (lot, machine or person asked) returns EVERY matching row. An
 * unfiltered read is bounded at MAX_ROWS per type: each type is asked for one
 * row more than the cap, so a type that hits it is named in `truncated_types`
 * and `truncated` is true (D-373).
 */
export function retrieveRecords(db, user, q = {}) {
  const types = (q.type ? String(q.type).split(',') : RECORD_TYPES.map(t => t.type))
    .map(recordType).filter(Boolean).filter(t => canReadType(user, t));
  // A filter only some types understand (a lot, an MO, a team, an EMP site)
  // leaves out every type that does not — they would otherwise ignore it and
  // answer with everything they hold.
  const asked = EXTRA_FILTERS.filter(f => q[f] != null && String(q[f]).trim() !== '');
  // Every type the person may read that CANNOT take one of the filters asked
  // is named, with the filter, so "nothing found" never stands in for "never
  // looked" (D-375). Types the person may not read are not mentioned at all.
  const notSearched = types
    .map(t => ({ type: t.type, label: t.label, filters: asked.filter(f => !(t.filters || []).includes(f)) }))
    .filter(x => x.filters.length)
    .map(x => ({ ...x, why: `These do not carry ${x.filters.map(f => FILTER_WORDS[f] || f).join(' or ')}:` }));
  const lookup = isLookup(q);
  const cap = requestedCap(q);
  const query = { ...q, _rows: lookup ? -1 : cap + 1 };
  const truncatedTypes = [];
  let rows = [];
  for (const t of types) {
    if (asked.some(f => !(t.filters || []).includes(f))) continue;
    let got = t.retrieve(db, query, user);
    if (!lookup && got.length > cap) { truncatedTypes.push(t.type); got = got.slice(0, cap); }
    rows.push(...got.map(t.describe));
  }
  if (q.form) {
    const f = String(q.form).trim().toLowerCase();
    rows = rows.filter(r => String(r.form || '').toLowerCase().startsWith(f));
  }
  rows.sort((a, b) => String(b.performed_at).localeCompare(String(a.performed_at)));
  const cut = !lookup && rows.length > cap;
  return {
    types: types.map(t => t.type),
    total: rows.length,
    capped: !lookup,
    truncated: cut || truncatedTypes.length > 0,
    truncated_types: truncatedTypes,
    not_searched: notSearched,
    records: lookup ? rows : rows.slice(0, cap),
  };
}
