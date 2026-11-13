// The answer a clean owes about its chemical (D-349): { ids, other, none }.
export const chemicalAnswered = (v) => !!(v && (v.none || (v.ids && v.ids.length) || String(v.other || '').trim()));

/** What the completion body carries. */
export const chemicalPayload = (v) => ({ ids: v?.ids || [], other: String(v?.other || '').trim(), none: !!v?.none });
