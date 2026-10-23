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
// Adopted so far: sanitation records, scale verifications, and every QMS form
// (deviations, non-conformances, on-hold, the sign-out logs, DCRs, flavour
// approvals, organoleptic tests — one `qms` type, narrowed by `qms_type`). A new type is one entry in RECORD_TYPES that implements all five; the
// shape check in verify:recordinterface refuses an entry that does not.
import { createSanitationRecord, verifySanitationRecord, revokeSanitationVerification } from './api/sanitation.js';
import { recordScaleVerification, verifyScaleCheck, revokeScaleVerification } from './api/scale-verification.js';
import { getScaleForm } from './scale-forms.js';
import { createQmsRecord, signQmsApproval, revokeQmsApproval } from './api/qms.js';
import { QMS_TYPES, getType } from './qms-config.js';
import { formLabel } from '../shared/form-registry.js';
import { moduleLevel } from './module-access.js';

export const INTERFACE = ['file', 'sign', 'revoke', 'retrieve', 'describe'];
export const MAX_ROWS = 500;

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

export const RECORD_TYPES = [
  {
    type: 'sanitation',
    label: 'Sanitation & QA inspection records',
    // A record on QA's list is read under QA Inspections, a cleaning record under
    // Sanitation — the same split `recordGroupFor()` makes on write.
    modules: ['sanitation', 'qa-inspections'],
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
      return db.prepare(sql).all(...params, Math.min(Number(q.limit) || MAX_ROWS, MAX_ROWS));
    },
    describe: describeSanitation,
  },
  {
    type: 'scale',
    label: 'Scale verifications (Forms 417-01 … 417-05)',
    modules: ['calibration'],
    // The kiosk files with no session; the interface files as the signed-in person.
    file: (db, user, input) => recordScaleVerification(db, input, { actor: user, source: 'app' }),
    sign: (db, user, id) => verifyScaleCheck(db, user, id),
    revoke: (db, user, id) => revokeScaleVerification(db, user, id),
    get: (db, id) => db.prepare('SELECT * FROM scale_verifications WHERE id = ?').get(id) || null,
    canRead: (user) => !!moduleLevel(user, 'calibration'),
    retrieve(db, q = {}, user = null) {
      if (user && !moduleLevel(user, 'calibration')) return [];
      const { where, params } = commonWhere({ at: 'performed_at', by: 'performed_by', signedBy: 'verified_by' }, q);
      if (q.equipment) { where.push('instrument_id = ?'); params.push(q.equipment); }
      if (q.place) { where.push('lower(room) = lower(?)'); params.push(String(q.place).trim()); }
      const sql = `SELECT * FROM scale_verifications ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
        ORDER BY performed_at DESC LIMIT ?`;
      return db.prepare(sql).all(...params, Math.min(Number(q.limit) || MAX_ROWS, MAX_ROWS));
    },
    describe: describeScale,
  },
  {
    type: 'qms',
    label: 'QMS records (deviations, non-conformances, on hold, sign-outs, DCRs, flavour and organoleptic)',
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
      const sql = `SELECT * FROM qms_records WHERE ${where.join(' AND ')} ORDER BY ${at} DESC LIMIT ?`;
      return db.prepare(sql).all(...params, Math.min(Number(q.limit) || MAX_ROWS, MAX_ROWS));
    },
    describe: describeQms,
  },
];

export const recordType = (type) => RECORD_TYPES.find(t => t.type === type) || null;

/** May this person read records of this type at all? */
export const canReadType = (user, t) => t.modules.some(m => moduleLevel(user, m));

/**
 * One list across every adopted type, newest first, each row described the same
 * way. `form` narrows to records whose form label starts with it ("FORM 417").
 * Bounded: each type returns at most MAX_ROWS, and the merged list is cut to the
 * same, so `truncated` says when there was more.
 */
export function retrieveRecords(db, user, q = {}) {
  const types = (q.type ? String(q.type).split(',') : RECORD_TYPES.map(t => t.type))
    .map(recordType).filter(Boolean).filter(t => canReadType(user, t));
  let rows = [];
  for (const t of types) rows.push(...t.retrieve(db, q, user).map(t.describe));
  if (q.form) {
    const f = String(q.form).trim().toLowerCase();
    rows = rows.filter(r => String(r.form || '').toLowerCase().startsWith(f));
  }
  rows.sort((a, b) => String(b.performed_at).localeCompare(String(a.performed_at)));
  const limit = Math.min(Number(q.limit) || MAX_ROWS, MAX_ROWS);
  return { types: types.map(t => t.type), total: rows.length, truncated: rows.length > limit, records: rows.slice(0, limit) };
}
