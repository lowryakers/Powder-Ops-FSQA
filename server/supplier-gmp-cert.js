// Reads the third-party GMP certificate state off the records (D-337). The rule
// is shared/supplier-gmp-cert.js; this gathers the rows it needs and holds the
// gate on "approved".
//
// THE GATE IS THE D-063 / D-202 SHAPE. `app_settings.supplier_gmp_gate`: off /
// warn (default) / on. Warn approves and STAMPS the gap on the qualification;
// on refuses "approved" while the certificate is missing, undated or expired.
// An admin turns it on; a deploy never does.
import { gmpCertStatus, gmpCertRequired, gmpCertCandidate, AUDIT_CERT_KINDS, GMP_CERT_STATUS_TEXT } from '../shared/supplier-gmp-cert.js';
import { plantDateOf } from './plant-clock.js';

export const GMP_GATE_MODES = ['off', 'warn', 'on'];

export function gmpGateMode(db) {
  try {
    const v = db.prepare("SELECT value FROM app_settings WHERE key = 'supplier_gmp_gate'").get()?.value;
    return GMP_GATE_MODES.includes(v) ? v : 'warn';
  } catch { return 'warn'; }
}

const FILE_COLS = `id, supplier_id, kind, expires_on, filename, created_at,
      CASE WHEN storage_key IS NOT NULL THEN 1 ELSE 0 END AS stored`;

function certsBySupplier(db) {
  const map = new Map();
  for (const f of db.prepare(`SELECT ${FILE_COLS} FROM supplier_files WHERE kind IN (?, ?)`).all(...AUDIT_CERT_KINDS)) {
    if (!map.has(f.supplier_id)) map.set(f.supplier_id, []);
    map.get(f.supplier_id).push(f);
  }
  return map;
}

/** Attach `gmp_cert` to each supplier row. */
export function withGmpCert(db, suppliers, today = plantDateOf()) {
  const certs = certsBySupplier(db);
  return suppliers.map(s => ({ ...s, gmp_cert: gmpCertStatus(s, certs.get(s.id) || [], today) }));
}

/** One supplier's state, plus the general certificates on file that may be the GMP one. */
export function gmpCertFor(db, supplier, today = plantDateOf()) {
  const files = db.prepare(`SELECT ${FILE_COLS} FROM supplier_files WHERE supplier_id = ? AND kind IN (?, ?, 'certificate')`)
    .all(supplier.id, ...AUDIT_CERT_KINDS);
  const state = gmpCertStatus(supplier, files, today);
  return { ...state, candidates: state.status === 'current' || state.status === 'due_soon' ? [] : files.filter(gmpCertCandidate) };
}

/** What stands between this supplier and "approved" on the certificate — [] when nothing. */
export function gmpGaps(db, supplier, today = plantDateOf()) {
  if (!gmpCertRequired(supplier)) return [];
  const g = gmpCertFor(db, supplier, today);
  if (!g.gap) return [];
  const reason = g.status === 'expired'
    ? `Third-party GMP / GFSI certificate expired ${g.renews_on}`
    : g.status === 'no_renewal_date'
      ? 'Third-party GMP / GFSI certificate on file with no expiry date recorded'
      : GMP_CERT_STATUS_TEXT.missing;
  return [{ state: g.status, file_id: g.file?.id || null, reason }];
}

/** Suppliers that owe a certificate and have no current one — the bell and the register read this. */
export function openGmpCertGaps(db, today = plantDateOf()) {
  const suppliers = db.prepare('SELECT id, name, vendor_type, actively_using FROM suppliers WHERE actively_using = 1').all();
  return withGmpCert(db, suppliers, today).filter(s => s.gmp_cert.gap);
}
