// A Sanitation record's swabs, read the OLD way (D-182) — shared, because the
// form opening a pre-D-182 record and the server must convert it identically.
// PURE: the record's own reading is swab 1; Form 117.21's lines are the rest.

export const ALLERGEN_RESULTS = ['pass', 'fail'];

/** Saving the corrected record writes these as rows — the same values. */
export function legacySwabs(record, preopForm) {
  const rows = [];
  const atp = preopForm?.atp || [];
  const first = atp[0] || {};
  if (record?.atp_reading != null || first.location || first.swab_no) {
    rows.push({ swab_no: first.swab_no || null, surface: first.location || null, atp_reading: record?.atp_reading ?? null });
  }
  for (const l of atp.slice(1)) {
    if (l?.location || l?.swab_no || (l?.reading != null && l.reading !== '')) {
      rows.push({ swab_no: l.swab_no || null, surface: l.location || null, atp_reading: l.reading === '' ? null : l.reading ?? null });
    }
  }
  for (const l of preopForm?.allergen || []) {
    if (l?.location || l?.swab_no || l?.result) {
      rows.push({ swab_no: l.swab_no || null, surface: l.location || null, atp_reading: null, allergen_swab: true,
        allergen_result: l.result === 'no_pass' ? 'fail' : l.result === 'pass' ? 'pass' : null });
    }
  }
  return rows;
}
