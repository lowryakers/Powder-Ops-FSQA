import { randomUUID } from 'crypto';

// Marnee's Monday contacts board, transcribed.
//
// Seven people, exactly as the board held them on 25 August 2026. Seeded rather
// than left for somebody to re-type, for the same reason the evacuation drills
// and the certifications are seeded: the records exist, they are the plant's
// own, and asking somebody to key them in again is how a module arrives empty
// and stays empty.
//
// VERBATIM, including what looks like a typo. "Nutriient" and "Nutrisoft" are
// what the board says; correcting them here would make the app disagree with
// the source it was copied from, and Marnee is the one who knows which is
// right. Same rule the internal-audit checklist follows.
//
// The dates come from the board's Excel serials (46087, 46091, 46094) resolved
// to real dates. A blank stays blank — "not interviewed yet" and "interviewed,
// date unknown" are different claims and the board only supports the first.
//
// INSERT-ONLY, AND IT SKIPS ENTIRELY ONCE THE TABLE HAS ANY ROW. A redeploy
// must never resurrect somebody Marnee deleted, or overwrite a note she
// corrected by hand — this list is edited constantly and the seed is only ever
// the starting point.
export const SEED_CANDIDATES = [
  {
    name: 'Vanessa', title: 'Cleaning', company: null,
    areas: ['cleaning', 'Maintenance'], phone: '3858663869', email: null,
    referred_by: 'Romina', interviewed_on: null,
    notes: 'Reference from Romina',
  },
  {
    name: 'Vanessa Cevallos', title: 'Kitting', company: 'Nutricost',
    areas: ['Kitting'], phone: '8018009571', email: null,
    referred_by: null, interviewed_on: null,
    notes: 'Experience at Nutricost',
  },
  {
    name: 'Anna Navarro', title: null, company: null,
    areas: ['Other'], phone: '3852689478', email: null,
    referred_by: null, interviewed_on: null,
    notes: 'Experience: Stick pack, liquid bottles, pick and pack, gas station manager and scheduling. '
      + '*Stopped by Powder Ops to see if we were hiring 5/19/2026',
  },
  {
    name: 'Josue Servin', title: 'Warehouse Lead', company: 'Nutriient',
    areas: ['Warehouse'], phone: '13854553558', email: 'josuaabraser003@gmail.com',
    referred_by: null, interviewed_on: '2026-03-10',
    notes: null,
  },
  {
    name: 'Fernanda Barrientos', title: 'QC Tech', company: 'Nutrisoft',
    areas: ['QA'], phone: '18018335033', email: null,
    referred_by: 'Isabella', interviewed_on: '2026-03-06',
    notes: "Isabella's daughter",
  },
  {
    name: 'Ashley Gerez', title: null, company: 'Unemployed',
    areas: ['QA'], phone: '13852867706', email: null,
    referred_by: 'Sandra', interviewed_on: '2026-03-06',
    notes: "Sandra's daughter",
  },
  {
    name: 'Lorena', title: 'QA', company: 'PRCE',
    areas: ['Stickpack'], phone: '8017879041', email: null,
    referred_by: 'Reina', interviewed_on: '2026-03-13',
    notes: "Reina's previous coworker",
  },
];

export function seedCandidates(db) {
  const { c } = db.prepare('SELECT COUNT(*) c FROM candidates').get();
  if (c > 0) return 0;

  const ins = db.prepare(`INSERT INTO candidates
    (id, name, title, company, areas, phone, email, referred_by, interviewed_on,
     status, notes, source, external_id, created_by, updated_by)
    VALUES (@id, @name, @title, @company, @areas, @phone, @email, @referred_by, @interviewed_on,
     'prospect', @notes, 'monday', @external_id, 'system', 'system')`);

  let n = 0;
  db.transaction(() => {
    for (const p of SEED_CANDIDATES) {
      ins.run({
        ...p,
        id: randomUUID(),
        areas: JSON.stringify(p.areas || []),
        // Name + phone, the same identity the importer uses — so re-importing
        // the board later updates these rows instead of doubling them. There
        // are two people called Vanessa, which is why the name alone is not it.
        external_id: `monday:${p.name}|${String(p.phone || '').replace(/\D/g, '').slice(-10)}`,
      });
      n += 1;
    }
  })();
  console.log(`[seed] Filed ${n} candidate(s) from the contacts board`);
  return n;
}
