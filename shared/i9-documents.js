// Form I-9, Lists of Acceptable Documents — TRANSCRIBED, never typed.
//
// The office was typing the document title and the issuing authority into free
// text boxes, which is how an I-9 ends up reading "DL" under List A, or a
// Social Security card recorded with an expiry it does not have. The list is
// federal and fixed: the employee presents ONE List A document, or one from
// List B plus one from List C, and the acceptable documents are enumerated on
// the form itself. So they are enumerated here, and the form offers them.
//
// Same doctrine as `preventive-controls.js` and `scale-forms.js`: this is a
// controlled document's own content, so it is not editable in the app. A new
// I-9 edition is a Document Control change — move I9_EDITION with it, because
// a filed Section 2 says which edition's list it was completed against, the
// way every checklist stamps its revision.
//
// WHAT IS NOT ENFORCED, DELIBERATELY: a title typed by hand is still accepted.
// The lists below are a faithful transcription, not a proof of completeness,
// and refusing a document an employee has legitimately presented would stop
// the office completing a form the law requires within three business days.
// An off-list title is NAMED on the record instead (`off_list`) — the gap is
// visible rather than blocked, and rather than hidden.

export const I9_EDITION = '08/01/2023';

/** The issuing authority is the state — offer the list rather than a text box. */
export const STATE_ISSUERS = 'states';

export const US_STATES = [
  'Alabama', 'Alaska', 'Arizona', 'Arkansas', 'California', 'Colorado', 'Connecticut', 'Delaware',
  'District of Columbia', 'Florida', 'Georgia', 'Hawaii', 'Idaho', 'Illinois', 'Indiana', 'Iowa',
  'Kansas', 'Kentucky', 'Louisiana', 'Maine', 'Maryland', 'Massachusetts', 'Michigan', 'Minnesota',
  'Mississippi', 'Missouri', 'Montana', 'Nebraska', 'Nevada', 'New Hampshire', 'New Jersey',
  'New Mexico', 'New York', 'North Carolina', 'North Dakota', 'Ohio', 'Oklahoma', 'Oregon',
  'Pennsylvania', 'Rhode Island', 'South Carolina', 'South Dakota', 'Tennessee', 'Texas', 'Utah',
  'Vermont', 'Virginia', 'Washington', 'West Virginia', 'Wisconsin', 'Wyoming',
  'American Samoa', 'Guam', 'Northern Mariana Islands', 'Puerto Rico', 'U.S. Virgin Islands',
];

// `authorities`: the issuing authorities this document can have.
//   - one entry  → the form already knows it; it is selected for you.
//   - several    → a short list to pick from.
//   - STATE_ISSUERS → the states list above.
//   - []         → it genuinely varies (a school, a tribe, a foreign country),
//                  so it stays a text box. A dropdown of guesses would be worse
//                  than a box: it would invite picking the nearest wrong one.
export const I9_LISTS = {
  A: [
    { title: 'U.S. Passport or U.S. Passport Card', authorities: ['U.S. Department of State'] },
    { title: 'Permanent Resident Card or Alien Registration Receipt Card (Form I-551)', authorities: ['U.S. Citizenship and Immigration Services'] },
    { title: 'Foreign passport that contains a temporary I-551 stamp or temporary I-551 printed notation on a machine-readable immigrant visa', authorities: [] },
    { title: 'Employment Authorization Document that contains a photograph (Form I-766)', authorities: ['U.S. Citizenship and Immigration Services'] },
    { title: 'Foreign passport with Form I-94 or I-94A endorsing nonimmigrant status (employer-specific work authorization)', authorities: [] },
    { title: 'Passport from the Federated States of Micronesia or the Republic of the Marshall Islands with Form I-94 or I-94A', authorities: ['Federated States of Micronesia', 'Republic of the Marshall Islands'] },
  ],
  B: [
    { title: "Driver's license or ID card issued by a State or outlying possession of the United States", authorities: STATE_ISSUERS },
    { title: 'ID card issued by federal, state or local government agencies or entities', authorities: [] },
    { title: 'School ID card with a photograph', authorities: [] },
    { title: "Voter's registration card", authorities: STATE_ISSUERS },
    { title: 'U.S. Military card or draft record', authorities: ['U.S. Department of Defense', 'Selective Service System'] },
    { title: "Military dependent's ID card", authorities: ['U.S. Department of Defense'] },
    { title: 'U.S. Coast Guard Merchant Mariner Card', authorities: ['U.S. Coast Guard'] },
    { title: 'Native American tribal document', authorities: [] },
    { title: "Driver's license issued by a Canadian government authority", authorities: [] },
    // The form's own exception, kept as its own entries so the record says
    // which one was examined rather than "a school record".
    { title: 'School record or report card (under age 18)', authorities: [], minor: true },
    { title: 'Clinic, doctor, or hospital record (under age 18)', authorities: [], minor: true },
    { title: 'Day-care or nursery school record (under age 18)', authorities: [], minor: true },
  ],
  C: [
    { title: 'Social Security Account Number card (without employment restrictions)', authorities: ['Social Security Administration'] },
    { title: 'Certification of report of birth issued by the Department of State (Form DS-1350, FS-545 or FS-240)', authorities: ['U.S. Department of State'] },
    { title: 'Original or certified copy of a birth certificate bearing an official seal', authorities: STATE_ISSUERS },
    { title: 'Native American tribal document', authorities: [] },
    { title: 'U.S. Citizen ID Card (Form I-197)', authorities: ['U.S. Citizenship and Immigration Services'] },
    { title: 'Identification Card for Use of Resident Citizen in the United States (Form I-179)', authorities: ['U.S. Citizenship and Immigration Services'] },
    { title: 'Employment authorization document issued by the Department of Homeland Security', authorities: ['U.S. Department of Homeland Security'] },
  ],
};

/** The documents acceptable under one list. */
export function i9Documents(list) {
  return I9_LISTS[String(list || '').toUpperCase()] || [];
}

/** The transcribed entry for a title, or null when it was typed by hand. */
export function i9Document(list, title) {
  const want = String(title || '').trim().toLowerCase();
  if (!want) return null;
  return i9Documents(list).find(d => d.title.toLowerCase() === want) || null;
}

/**
 * What to offer for the issuing authority.
 *
 * `free` means a text box: the authority is a school, a tribe or a foreign
 * country, and nothing here can enumerate those. An unknown title is free
 * too — the office is already off the list at that point and boxing them in
 * would only make it worse.
 */
export function i9Authorities(list, title) {
  const doc = i9Document(list, title);
  if (!doc) return { options: [], free: true };
  if (doc.authorities === STATE_ISSUERS) return { options: US_STATES, free: false };
  if (!doc.authorities.length) return { options: [], free: true };
  return { options: doc.authorities, free: false };
}

/** Is this title one the form actually lists under that letter? */
export function i9KnownTitle(list, title) {
  return !!i9Document(list, title);
}
