// THE HOUSE RULE for who may change a FILED record — in one place, because
// modules kept growing their own variants, or none at all: sanitation records
// could not be corrected by ANYONE, admin included (there was simply no
// route), which is how "even Admin cannot edit that" kept coming up one
// module at a time.
//
// The rule, as settled in qms.js and applied everywhere since:
//   - FILING stays open — anyone who does the work records it.
//   - While UNSIGNED: the person who filed it may correct it, and so may the
//     records roles (admin, supervisor, QA/Quality, Document Control).
//   - Any approval SIGNATURE closes the record to everyone but an admin. The
//     way back is REVOKE (the signer or an admin), correct, sign again — all
//     three audited — so the normal case is self-service, not "find an admin".
//   - The SERVER stamps can_edit / edit_block_reason on what it returns and
//     the client renders what it is told. A second copy of this rule on the
//     client is how two screens start disagreeing about who may do what.
//
// qms.js keeps its own identical mayEdit (it predates this file and carries
// per-type signature shapes); fold it in when that file is next touched.

export const isRecordsRole = (u) => u?.role === 'admin' || u?.role === 'supervisor'
  || ['qa', 'quality', 'document_control'].includes((u?.department || '').toLowerCase());

const sameName = (a, b) =>
  !!a && !!b && String(a).trim().toLowerCase() === String(b).trim().toLowerCase();

/**
 * What THIS user may do to THIS record.
 * `filedBy` is the name on the record; `signedBy` the approval signature (null
 * while unsigned); `signedLabel` is the word the module uses ("verified",
 * "signed off") so the refusal reads in the module's own vocabulary.
 */
export function recordEditPolicy(user, { filedBy = null, signedBy = null, signedLabel = 'verified' } = {}) {
  if (!user) return { can_edit: false, edit_block_reason: 'Sign in to correct records.' };
  if (user.role === 'admin') return { can_edit: true, edit_block_reason: null };
  if (signedBy) {
    return {
      can_edit: false,
      edit_block_reason: `This record was ${signedLabel} by ${signedBy}. The signer can revoke that and correct it, or an admin can amend it directly.`,
    };
  }
  if (isRecordsRole(user) || sameName(user.name, filedBy)) return { can_edit: true, edit_block_reason: null };
  return {
    can_edit: false,
    edit_block_reason: 'You can only correct records you filed. Ask QA, a supervisor or an admin to amend it.',
  };
}

/** Revoking a signature is self-service for the signer, plus admins. */
export const mayRevokeSignature = (user, signedBy) =>
  user?.role === 'admin' || sameName(user?.name, signedBy);
