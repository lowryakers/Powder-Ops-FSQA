// Issuing and locking a Certificate of Analysis (D-223, D-224).
//
// Three rules, one owner each:
//  · A certificate number comes from a counter, inside the transaction that
//    issues the certificate, and nowhere else. Opening the PDF used to hand out
//    a number (MAX + 1) to any request, signed or not; seven unsigned requests
//    hold one that way.
//  · A request is signed only when it is a pass, every required test has a
//    result, and no result failed or was left undecided.
//  · What was signed is frozen: a canonical JSON snapshot and its SHA-256. After
//    signing, results, files, the lot's identity and the certificate fields are
//    closed until an admin un-signs with a reason.
import { createHash } from 'crypto';
import { specIndex } from './coa-grade.js';

export const CERT_START = 160000;

/** The next certificate number. Call INSIDE the issuing transaction. Never reuses a number, voided ones included. */
export function allocateCertNumber(db) {
  const counter = db.prepare("SELECT value FROM coa_counters WHERE name = 'certificate'").get()?.value ?? CERT_START;
  const highest = db.prepare(`SELECT MAX(CAST(certificate_number AS INTEGER)) n FROM coa_requests
    WHERE certificate_number GLOB '[0-9]*'`).get()?.n ?? CERT_START;
  const next = Math.max(counter, highest) + 1;
  db.prepare(`INSERT INTO coa_counters (name, value) VALUES ('certificate', ?)
    ON CONFLICT(name) DO UPDATE SET value = excluded.value`).run(next);
  return String(next);
}

/** JSON with every object's keys sorted, so the same content always hashes the same. */
export function canonicalJson(v) {
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(',')}]`;
  if (v && typeof v === 'object') {
    return `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${canonicalJson(v[k])}`).join(',')}}`;
  }
  return JSON.stringify(v ?? null);
}
export const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

// What the certificate states about the lot. Status is in it: a signed pass.
const IDENTITY = ['item_number', 'item_description', 'lot_number', 'product_code', 'manufacturer_lot', 'vendor_lot',
  'product_expiration', 'supplier', 'origin', 'received_date', 'date_of_results', 'lab_id', 'lab_name', 'status'];
// Closed once signed (with the results and the files).
export const LOCKED_FIELDS = [...IDENTITY, 'tests_requested', 'certificate_number', 'date_of_issuance'];

/** The content a signature covers, built the same way at signing and on every check after. */
export function snapshotFor(db, request, { certificate_number, date_of_issuance }) {
  const specs = db.prepare('SELECT * FROM coa_specifications WHERE item_number = ? AND is_active = 1').all(request.item_number);
  const byId = Object.fromEntries(specs.map(s => [s.id, s]));
  const index = specIndex(specs);
  const results = db.prepare('SELECT * FROM coa_test_results WHERE request_id = ? ORDER BY test_type, id').all(request.id)
    .map(t => {
      const spec = byId[t.specification_id] || index.find(t.test_type);
      return {
        id: t.id, test_type: t.test_type, result_value: t.result_value, unit: t.unit || spec?.unit || null,
        // The lab's own method wins over the spec's; mdl joins the snapshot
        // from D-231 on, so certificates signed earlier keep the shape they had.
        pass_fail: t.pass_fail, method: t.method || spec?.method || t.notes || null, mdl: t.mdl ?? null,
        specification_id: spec?.id || null, specification: spec?.specification || null,
        min_value: spec?.min_value ?? null, max_value: spec?.max_value ?? null,
      };
    });
  const files = db.prepare('SELECT id, filename, original_name, sha256 FROM coa_files WHERE request_id = ? ORDER BY id').all(request.id);
  return {
    request: Object.fromEntries(IDENTITY.map(k => [k, request[k] ?? null])),
    certificate_number, date_of_issuance, results, files,
  };
}

/** Why this request may not be signed yet — an empty list means it may. */
export function signRefusals(db, request) {
  const out = [];
  if (request.status !== 'pass') out.push(`its status is "${request.status}", and only a pass is certified`);
  const results = db.prepare('SELECT test_type, pass_fail FROM coa_test_results WHERE request_id = ?').all(request.id);
  if (!results.length) out.push('it has no test results');
  const failed = results.filter(r => r.pass_fail === 'fail');
  if (failed.length) out.push(`${failed.length} result${failed.length === 1 ? '' : 's'} failed (${failed.map(r => r.test_type).join(', ')})`);
  // A certificate states that the lot passed. All-N/A says nothing was tested
  // against a limit, which is not a pass (D-228).
  if (results.length && !results.some(r => r.pass_fail === 'pass')) out.push('no result passed — every result is N/A, so there is nothing to certify');
  const open = results.filter(r => !r.pass_fail);
  if (open.length) out.push(`${open.length} result${open.length === 1 ? ' has' : 's have'} no verdict (${open.map(r => r.test_type).join(', ')})`);
  const specs = db.prepare('SELECT test_type FROM coa_specifications WHERE item_number = ? AND is_active = 1').all(request.item_number);
  const reported = specIndex(results.map(r => ({ test_type: r.test_type })));
  const missing = specs.filter(s => !reported.find(s.test_type)).map(s => s.test_type);
  if (missing.length) out.push(`no result for ${missing.join(', ')}, which the item's specification requires`);
  return out;
}

export const isSigned = (r) => !!r?.qa_signed_at;

/**
 * Before D-223, opening an unsigned request's PDF handed it a certificate
 * number. Seven requests on the live database still hold one that was never
 * issued, and signing used to reuse it. This voids those numbers ONCE, on
 * unsigned requests only, with the old value in the audit record. The counter
 * is raised past every voided number first, so none is ever drawn again.
 */
const VOID_MARKER = 'coa_unissued_cert_numbers_voided_v1';
export const UNISSUED_REASON = 'assigned by the unsigned PDF view before D-223; never issued';
export function voidUnissuedCertNumbers(db, logAudit) {
  if (db.prepare('SELECT value FROM app_settings WHERE key = ?').get(VOID_MARKER)) return { voided: [], already: true };
  const rows = db.prepare(`SELECT id, item_description, lot_number, certificate_number, date_of_issuance FROM coa_requests
    WHERE qa_signed_at IS NULL AND certificate_number IS NOT NULL AND TRIM(certificate_number) != ''`).all();
  db.transaction(() => {
    const highest = rows.map(r => Number(r.certificate_number)).filter(Number.isFinite).reduce((a, b) => Math.max(a, b), 0);
    if (highest) {
      db.prepare(`INSERT INTO coa_counters (name, value) VALUES ('certificate', ?)
        ON CONFLICT(name) DO UPDATE SET value = MAX(value, excluded.value)`).run(highest);
    }
    const clear = db.prepare("UPDATE coa_requests SET certificate_number = NULL, date_of_issuance = NULL, updated_at = datetime('now') WHERE id = ? AND qa_signed_at IS NULL");
    for (const r of rows) {
      clear.run(r.id);
      logAudit?.('system', 'void', 'coa_request', r.id,
        { reason: UNISSUED_REASON, voided_certificate_number: r.certificate_number, voided_date_of_issuance: r.date_of_issuance || null },
        { certificate_number: r.certificate_number, date_of_issuance: r.date_of_issuance || null },
        { certificate_number: null, date_of_issuance: null }, `${r.item_description} · Lot ${r.lot_number}`);
    }
    db.prepare('INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)').run(VOID_MARKER, new Date().toISOString());
  })();
  return { voided: rows.map(r => ({ id: r.id, certificate_number: r.certificate_number })) };
}
export const LOCKED_MESSAGE = 'This certificate is signed, so its results, files, lot details and certificate fields are closed. An admin can un-sign it with a reason to correct it.';
