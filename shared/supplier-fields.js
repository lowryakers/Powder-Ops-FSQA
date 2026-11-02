// What a person may set on a supplier from the Edit details box (D-295). PURE,
// imported by the server (which refuses anything else) and the screen (which
// offers exactly these), so the two cannot disagree.
//
// TYPE IS NOT A LABEL: `packaging` decides whether a supplier owes a letter of
// guarantee (shared/supplier-guarantee.js). A value somebody typed by hand —
// "Packaging " or "pkg" — would quietly drop a supplier off that list, which is
// why it is a closed list. A value already on file outside it is kept as it is
// until somebody picks one; it is never rewritten.
export const VENDOR_TYPES = [
  { value: 'ingredient', label: 'Ingredient' },
  { value: 'packaging', label: 'Packaging' },
  { value: 'supplies', label: 'Supplies' },
  { value: 'equipment', label: 'Equipment' },
  { value: 'service', label: 'Service' },
  { value: 'laboratory', label: 'Laboratory' },
];

// A contact's role is what the person told us, never guessed (D-044).
export const CONTACT_ROLES = [
  { value: 'quality', label: 'Quality / food safety' },
  { value: 'orders', label: 'Orders' },
  { value: 'sales', label: 'Sales' },
  { value: 'admin', label: 'Accounts / admin' },
];

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** A contact as stored, or `{ error }`. Blank fields are null. */
export function cleanContact(b = {}) {
  const t = (v, n = 200) => { const s = String(v ?? '').trim(); return s ? s.slice(0, n) : null; };
  const c = { name: t(b.name), email: t(b.email), phone: t(b.phone, 40), role: t(b.role, 20), notes: t(b.notes, 500) };
  if (!c.name && !c.email && !c.phone) return { error: 'A contact needs a name, an email or a phone number.' };
  if (c.email && !EMAIL.test(c.email)) return { error: `"${c.email}" is not an email address.` };
  if (c.role && !CONTACT_ROLES.some(r => r.value === c.role)) return { error: `Unknown role "${c.role}".` };
  c.is_primary = b.is_primary ? 1 : 0;
  return c;
}
