// The two-letter postal codes a home address can carry, and the ONE reading of
// what somebody typed or a phone's AutoFill put into a state box (D-155).
//
// PURE and in shared/, because both sides need it: the wizard and the office
// form offer the list, and the server normalises whatever arrives, so "Utah",
// "utah", "ut" and "UT" all file as UT. A phone's address AutoFill writes the
// full name into a box that used to allow two characters.
//
// A value that is none of these is KEPT AS TYPED, never refused and never
// guessed into a code: a new hire whose address is abroad or a territory not on
// the list must still be able to finish, and the office reads what they wrote.

export const US_STATES = [
  ['AL', 'Alabama'], ['AK', 'Alaska'], ['AZ', 'Arizona'], ['AR', 'Arkansas'], ['CA', 'California'],
  ['CO', 'Colorado'], ['CT', 'Connecticut'], ['DE', 'Delaware'], ['DC', 'District of Columbia'],
  ['FL', 'Florida'], ['GA', 'Georgia'], ['HI', 'Hawaii'], ['ID', 'Idaho'], ['IL', 'Illinois'],
  ['IN', 'Indiana'], ['IA', 'Iowa'], ['KS', 'Kansas'], ['KY', 'Kentucky'], ['LA', 'Louisiana'],
  ['ME', 'Maine'], ['MD', 'Maryland'], ['MA', 'Massachusetts'], ['MI', 'Michigan'], ['MN', 'Minnesota'],
  ['MS', 'Mississippi'], ['MO', 'Missouri'], ['MT', 'Montana'], ['NE', 'Nebraska'], ['NV', 'Nevada'],
  ['NH', 'New Hampshire'], ['NJ', 'New Jersey'], ['NM', 'New Mexico'], ['NY', 'New York'],
  ['NC', 'North Carolina'], ['ND', 'North Dakota'], ['OH', 'Ohio'], ['OK', 'Oklahoma'], ['OR', 'Oregon'],
  ['PA', 'Pennsylvania'], ['RI', 'Rhode Island'], ['SC', 'South Carolina'], ['SD', 'South Dakota'],
  ['TN', 'Tennessee'], ['TX', 'Texas'], ['UT', 'Utah'], ['VT', 'Vermont'], ['VA', 'Virginia'],
  ['WA', 'Washington'], ['WV', 'West Virginia'], ['WI', 'Wisconsin'], ['WY', 'Wyoming'],
  ['PR', 'Puerto Rico'], ['GU', 'Guam'], ['VI', 'U.S. Virgin Islands'], ['AS', 'American Samoa'],
  ['MP', 'Northern Mariana Islands'],
];

const fold = (s) => String(s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z]/g, '');
const BY_KEY = new Map();
for (const [code, name] of US_STATES) {
  BY_KEY.set(fold(code), code);
  BY_KEY.set(fold(name), code);
}

/** "Utah" / "ut" / " UT " → "UT"; anything unrecognised comes back trimmed, as typed. */
export function normalizeState(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  return BY_KEY.get(fold(raw)) || raw;
}

export const isStateCode = (v) => US_STATES.some(([c]) => c === v);
