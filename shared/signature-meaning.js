// WHAT A SIGNATURE MEANS, IN WORDS (D-293, 21 CFR 11.50).
//
// A printed signature carries the signer's name, when they signed, and what
// the signature means. The meaning is fixed by the KIND of act, never typed, so
// the same act prints the same words on every record and every printout.
export const SIGNATURE_MEANINGS = {
  qa_verification: 'Reviewed and verified by QA',
  qa_signoff: 'Reviewed and accepted by QA',
  scale_verification: 'Reviewed the daily scale check and accepted the readings',
  coa_certify: 'Certified the results are true and accurate for this lot',
  qms_approval: (label) => `Approved as ${label}`,
};

/** The meaning for an act; a QMS approval names its role. */
export function signatureMeaning(kind, label) {
  const m = SIGNATURE_MEANINGS[kind];
  if (typeof m === 'function') return m(label || 'approver');
  return m || 'Signed';
}
