// What an MO carries for allergen control on the schedule (D-296).
//
// THE FACT BELONGS TO THE MO, NOT TO A SCHEDULE CELL. One MO is blended in
// Batching, filled in Filling and kitted in Kitting, often on different days,
// and every one of those cells must say the same thing about it. So the answer
// is stored once per MO (`schedule_mo_allergens`, keyed on `moKey`) and every
// cell, the team messages and the end-of-day form READ it. Copying it onto
// each cell is how the Filling card ends up saying "no allergen" about an MO
// Batching marked as milk.
//
// PURE — imported by the server and the browser.

// The major food allergens named in US law (FALCPA 2004 + the FASTER Act 2021,
// 21 U.S.C. 321(qq)). The Pre-Op form's short list (Milk, Nuts, Wheat…) is a
// swab record and stays as it is; this is what an MO can CONTAIN.
export const MAJOR_ALLERGENS = [
  'Milk', 'Egg', 'Fish', 'Crustacean shellfish', 'Tree nuts', 'Peanuts', 'Wheat', 'Soy', 'Sesame',
];

// The teams whose step can call for a disposable gown.
export const GOWN_TEAMS = ['Batching', 'Filling', 'Kitting'];

// The MO, compared as a number: "MO #MO76790", "mo76790" and "76790" are one MO.
// The same rule as normalizeMo in api/production.js (which re-exports this).
export const moKey = (v) => String(v ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/^(MO)+/, '');

function pick(list, allowed, label) {
  if (list == null) return { value: [] };
  if (!Array.isArray(list)) return { error: `${label} must be a list.` };
  const out = [];
  for (const raw of list) {
    const hit = allowed.find(a => a.toLowerCase() === String(raw ?? '').trim().toLowerCase());
    if (!hit) return { error: `"${raw}" is not on the ${label.toLowerCase()} list (${allowed.join(', ')}).` };
    if (!out.includes(hit)) out.push(hit);
  }
  // Kept in the list's own order so two people ticking the same boxes store the same answer.
  return { value: allowed.filter(a => out.includes(a)) };
}

/** Validate { allergens, gown_teams } → { value } or { error }. */
export function cleanMoAllergens(body = {}) {
  const a = pick(body.allergens, MAJOR_ALLERGENS, 'Allergen');
  if (a.error) return a;
  const g = pick(body.gown_teams, GOWN_TEAMS, 'Team');
  if (g.error) return g;
  return { value: { allergens: a.value, gown_teams: g.value } };
}

/** Does this MO record say anything at all? */
export const hasFlags = (rec) => !!rec && ((rec.allergens?.length || 0) + (rec.gown_teams?.length || 0)) > 0;

/**
 * What ONE step (a team's cell) is told about its MO. null when the MO carries
 * nothing — a card that printed "Allergen: none" on every run would be wallpaper.
 */
export function stepFlags(rec, team) {
  if (!hasFlags(rec)) return null;
  return {
    allergens: rec.allergens || [],
    gown: (rec.gown_teams || []).includes(team),
  };
}

/** The line every screen and message prints, so they cannot word it differently. */
export function stepLine(rec, team) {
  const f = stepFlags(rec, team);
  if (!f) return '';
  return `Allergen: ${f.allergens.length ? f.allergens.join(', ') : 'none'} · Disposable gown: ${f.gown ? 'YES' : 'NO'}`;
}

/** The editor's state from a stored record (null = nothing recorded). */
export const allergenFormFrom = (rec) => ({
  allergenOn: !!rec?.allergens?.length, allergens: rec?.allergens || [],
  gownOn: !!rec?.gown_teams?.length, gown_teams: rec?.gown_teams || [],
});
