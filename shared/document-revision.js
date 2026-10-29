// What a document revision number is, and the next one (D-277). PURE: the server
// decides with it and the editor suggests with it, so the two cannot disagree.
//
// The registry holds revisions written every way the paper ever did: "V4",
// "4", "Rev 4", "1.0", "4.1". Two spellings of one number are ONE revision
// ("V4" and "4"), so a draft cannot be approved under a number already used
// just by writing it differently.

/** The number a revision string names, for comparison: "Rev. V04" → "4", "1.0" → "1.0". */
export function revisionKey(rev) {
  const s = String(rev ?? '').trim().toLowerCase()
    .replace(/^(revision|rev\.?|version|ver\.?)\s*/, '')
    .replace(/^v\s*/, '')
    .replace(/^0+(?=\d)/, '');
  return s;
}

export const sameRevision = (a, b) => !!revisionKey(a) && revisionKey(a) === revisionKey(b);

/**
 * The revision after `rev`, written the way `rev` is written: "V4" → "V5",
 * "4" → "5", "1.0" → "2.0", "4.1" → "5.0", "Rev 3" → "Rev 4". A revision with no
 * number in it (blank, "Draft") becomes "1". A new APPROVED revision always
 * moves the whole number; a person may type something else on the draft.
 */
export function nextRevision(rev) {
  const s = String(rev ?? '').trim();
  const m = s.match(/^(.*?)(\d+)(?:\.(\d+))?\s*$/);
  if (!m) return '1';
  const [, prefix, major, minor] = m;
  const next = String(Number(major) + 1);
  return `${prefix}${next}${minor !== undefined ? '.0' : ''}`;
}

/**
 * A document is APPROVED (in force) while `active`, and still in force while
 * `under_review` (its periodic review is open; the approved text still applies).
 */
export const isApprovedStatus = (status) => status === 'active' || status === 'under_review';
