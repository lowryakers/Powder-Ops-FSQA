// The third-party GMP certificate a supplier owes (D-337). PURE — the server
// decides with it, the screen draws what the server says.
//
// Asked for by Quality (Carol): every raw-material and packaging supplier we buy
// from holds a CURRENT certificate from a third-party GMP audit. Only a GMP
// certificate counts — a GFSI certificate (SQF, BRCGS, FSSC 22000) on its own
// does not, on Quality's instruction.
//
// WHO OWES ONE IS THE SUPPLIER'S TYPE, never a guess from its name: a raw
// material (`ingredient`) or `packaging` supplier, while we actively buy from
// it. The register's type list is closed (shared/supplier-fields.js); a few
// imported spellings of the same two types are read the same way, so an
// imported "Raw Material" is not quietly dropped off the list.
//
// It is the letter-of-guarantee shape (D-289): a file kind filed WITH its
// expiry date, and missing / no expiry / expired are gaps.
import { renewableDocStatus, DUE_SOON_DAYS } from './supplier-guarantee.js';

export const GMP_CERT_KIND = 'gmp_certificate';
export const GMP_CERT_LABEL = 'Third-party GMP certificate';
export { DUE_SOON_DAYS };

const OWING_TYPES = new Set(['ingredient', 'ingredients', 'raw material', 'raw materials', 'packaging']);
const typeKey = (t) => String(t || '').trim().toLowerCase().replace(/[\s_-]+/g, ' ');

/** Does this supplier owe a third-party GMP certificate? Only while we actively buy from it. */
export function gmpCertRequired(s) {
  if (!s || !Number(s.actively_using)) return false;
  return OWING_TYPES.has(typeKey(s.vendor_type));
}

/** The certificate's state on `today` (YYYY-MM-DD); see renewableDocStatus. */
export function gmpCertStatus(s, files = [], today) {
  return renewableDocStatus(gmpCertRequired(s), files, GMP_CERT_KIND, today);
}

/**
 * A certificate already on file that MAY be the GMP certificate — catalogued as
 * a general certificate (the archive walk files "NSF GMP Exp 2026.pdf" that
 * way) with GMP in its name. It is OFFERED to a person, never counted by itself:
 * a filename is a guess, and a person says which file is the certificate.
 */
export function gmpCertCandidate(f) {
  return !!f && f.kind === 'certificate' && /\bc?gmp\b/i.test(String(f.filename || ''));
}

export const GMP_CERT_STATUS_TEXT = {
  not_required: 'Not required',
  missing: 'No third-party GMP certificate on file',
  no_renewal_date: 'On file, no expiry date recorded',
  expired: 'Expired',
  due_soon: 'Expires soon',
  current: 'Current',
};
