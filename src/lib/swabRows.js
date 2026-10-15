// A Sanitation record's swab rows, between the form and the request (D-182).

export const blankSwab = () => ({
  swab_no: '', surface: '', atp_reading: '', allergen_swab: false, allergen_result: '', allergen_lot: '',
});

/** For the request body: blanks as null, numbers as numbers. */
export function swabsForSave(rows) {
  return (rows || []).map((r) => ({
    swab_no: String(r.swab_no ?? '').trim() || null,
    surface: String(r.surface ?? '').trim() || null,
    atp_reading: r.atp_reading === '' || r.atp_reading == null ? null : Number(r.atp_reading),
    allergen_swab: !!r.allergen_swab,
    allergen_result: r.allergen_swab ? (r.allergen_result || null) : null,
    allergen_lot: r.allergen_swab ? (String(r.allergen_lot ?? '').trim() || null) : null,
    allergen_present: r.allergen_present || null,
    note: r.note || null,
  }));
}

/** For the form to open with: stored rows as editable strings. */
export function swabsForEdit(rows) {
  return (rows || []).map((r) => ({
    ...blankSwab(), ...r,
    swab_no: r.swab_no ?? '', surface: r.surface ?? '',
    atp_reading: r.atp_reading == null ? '' : String(r.atp_reading),
    allergen_swab: !!r.allergen_swab, allergen_result: r.allergen_result || '', allergen_lot: r.allergen_lot ?? '',
  }));
}

