// A select must be able to offer what the record already holds.
//
// Managed lists serve ACTIVE options only, and a `<select>` whose value is not
// among its options silently falls back to the first one — so opening a
// record filed under a since-retired option (or, for sanitation areas, one
// `canonicalArea` deliberately left as filed) to correct an unrelated field
// re-assigned that value on save. The retired-rooms trap, on every managed
// list at once. `withCurrent` appends the stored value when the list no
// longer offers it, labelled so nobody picks it for a new record by mistake.
//
// Options may be `{ value, label }` objects or bare strings; the result is
// always objects, so a caller renders `o.value` / `o.label`.
export function withCurrent(options, value, fallbackLabel) {
  const list = (options || []).map(o => (o && typeof o === 'object')
    ? { ...o, value: o.value ?? '', label: o.label ?? o.value ?? '' }
    : { value: o, label: String(o ?? '') });
  const v = value == null ? '' : String(value);
  if (v === '' || list.some(o => String(o.value) === v)) return list;
  return [...list, { value: v, label: `${fallbackLabel || v} (no longer offered)`, retired: true }];
}
