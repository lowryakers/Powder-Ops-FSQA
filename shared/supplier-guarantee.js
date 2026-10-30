// The packaging / food-contact letter of guarantee (D-289). PURE — the server
// decides with it, the screen draws what the server says.
//
// A supplier of food-contact packaging gives a written guarantee that what it
// sells us complies with 21 CFR 174–178 (food-contact substances). It is a
// document with a RENEWAL DATE, kept against the supplier. Who owes one is the
// supplier's type (packaging) or a person's tick ("supplies food-contact
// material"), never a guess from the name.

export const GUARANTEE_KIND = 'letter_of_guarantee';
export const GUARANTEE_LABEL = 'Letter of guarantee';
export const DUE_SOON_DAYS = 30;

/** Does this supplier owe a letter of guarantee? Only while we actively buy from it. */
export function guaranteeRequired(s) {
  if (!s || !s.actively_using) return false;
  return String(s.vendor_type || '').trim().toLowerCase() === 'packaging' || Number(s.food_contact) === 1;
}

const addDays = (iso, n) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/**
 * The state of a supplier's letter of guarantee on `today` (YYYY-MM-DD).
 * `files` are its supplier_files rows of the guarantee kind (removed ones left out).
 *   not_required · missing · no_renewal_date · expired · due_soon · current
 * The letter that counts is the one renewing LAST; a letter with no renewal date
 * counts only when there is no dated one, because a gap is not a pass.
 * `gap` is true for missing / no_renewal_date / expired. due_soon is a warning, not a gap.
 */
export function guaranteeStatus(s, files = [], today) {
  const required = guaranteeRequired(s);
  const letters = files.filter(f => f && f.kind === GUARANTEE_KIND);
  const dated = letters.filter(f => f.expires_on).sort((a, b) => String(b.expires_on).localeCompare(String(a.expires_on)));
  const file = dated[0] || letters[0] || null;
  let status;
  if (!file) status = 'missing';
  else if (!file.expires_on) status = 'no_renewal_date';
  else if (file.expires_on < today) status = 'expired';
  else if (file.expires_on <= addDays(today, DUE_SOON_DAYS)) status = 'due_soon';
  else status = 'current';
  if (!required) {
    return { required: false, status: file ? status : 'not_required', gap: false, file, renews_on: file?.expires_on || null };
  }
  return { required: true, status, gap: ['missing', 'no_renewal_date', 'expired'].includes(status), file, renews_on: file?.expires_on || null };
}

export const GUARANTEE_STATUS_TEXT = {
  not_required: 'Not required',
  missing: 'No letter of guarantee on file',
  no_renewal_date: 'On file, no renewal date recorded',
  expired: 'Expired',
  due_soon: 'Renews soon',
  current: 'Current',
};
