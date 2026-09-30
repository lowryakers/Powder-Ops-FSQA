// A packaging spec's fields, and what each one will accept (D-135).
//
// `packaging_specs` is the ONE owner of the film facts — material, zipper,
// print, trim, gusset, front panel, wind direction — and every product on the
// spec reads them through `products.spec_id`. The catalogue import refuses to
// write them per product (D-133) and says "set it on the spec"; this is the
// definition the spec editor and its PUT both read, so the screen cannot
// promise a save the server refuses.
//
// THREE RULES, NONE OF THEM DECORATION:
//  - BLANK IS NOT ZERO. A dimension left empty is the record saying "unknown"
//    or "does not apply" (SPEC-BOTTLE has no trim and no gusset). A 0 would
//    read as somebody having measured it, so it is REFUSED with that reason.
//  - `spec_id` IS THE JOIN KEY and is never edited. Products, POs and the
//    proofer's feed resolve through it; a different spec is a new spec.
//  - AN ABSENT FIELD IS LEFT ALONE; a blank one CLEARS it (the `body.x ??
//    existing.x` rule), so a screen sending one field cannot blank the rest.

import { MASTER_CSV_SOURCES } from './product-fields.js';

/** The formats a spec may name. `isRollFed` reads the same words. */
export const SPEC_FORMATS = ['Pouch', 'Stick', 'Bottle', 'Box', 'Cup'];

/** A spec code: SPEC- then letters, digits and hyphens (SPEC-POUCH-LG). */
export const SPEC_ID_RE = /^SPEC-[A-Z0-9]+(?:-[A-Z0-9]+)*$/;

// kind: 'text' | 'long' | 'mm' | 'money' | 'bool' | 'format'
export const SPEC_FIELDS = [
  { key: 'name', label: 'Name', kind: 'text', required: true, group: 'identity' },
  { key: 'format', label: 'Format', kind: 'format', required: true, group: 'identity',
    hint: 'Pouch, stick and bottle are roll-fed: wind direction and the eye mark apply only to those.' },
  { key: 'material_structure', label: 'Material', kind: 'long', group: 'film',
    hint: 'The laminate as the vendor states it, outside layer first.' },
  { key: 'zipper', label: 'Zipper', kind: 'text', group: 'film' },
  { key: 'print_process', label: 'Print', kind: 'text', group: 'film', hint: 'e.g. CMYK' },
  { key: 'trim_length_mm', label: 'Trim length (mm)', kind: 'mm', group: 'film' },
  { key: 'trim_width_mm', label: 'Trim width (mm)', kind: 'mm', group: 'film' },
  { key: 'gusset_mm', label: 'Gusset (mm)', kind: 'mm', group: 'film' },
  { key: 'front_panel_mm', label: 'Front panel (mm)', kind: 'mm', group: 'film' },
  { key: 'wind_direction', label: 'Wind direction', kind: 'text', group: 'film',
    hint: 'The printer\'s wind number, as the vendor quotes it.' },
  { key: 'core_in', label: 'Core (in)', kind: 'text', group: 'film' },
  { key: 'dieline_required', label: 'Die line required', kind: 'bool', group: 'film' },
  { key: 'vendor', label: 'Vendor', kind: 'text', group: 'purchasing' },
  { key: 'last_unit_cost', label: 'Last unit cost ($)', kind: 'money', group: 'purchasing' },
  { key: 'vendor_spec_string', label: 'PO footer text', kind: 'long', group: 'purchasing',
    hint: 'Printed on the PO footer exactly as written here.' },
  { key: 'notes', label: 'Notes', kind: 'long', group: 'purchasing' },
];
export const SPEC_FIELD_KEYS = SPEC_FIELDS.map((f) => f.key);

/** The master.csv header a spec column feeds, or null. The proofer reads these. */
export function masterHeaderFor(key) {
  const hit = MASTER_CSV_SOURCES.find(([, src]) => src.startsWith(`packaging_specs.${key} `) || src === `packaging_specs.${key}`);
  return hit ? hit[0] : null;
}

const blank = (v) => v === null || v === undefined || String(v).trim() === '';

/**
 * One field in, `{ value }` or `{ error }` out. `value` is what is stored:
 * NULL for a blank optional field, a number for a dimension or a cost, 0/1
 * for the die line, trimmed text otherwise.
 */
export function validateSpecField(key, raw) {
  const f = SPEC_FIELDS.find((x) => x.key === key);
  if (!f) return { error: `${key} is not a packaging spec field` };
  if (blank(raw)) {
    if (f.required) return { error: `${f.label} is required` };
    if (f.kind === 'bool') return { error: `${f.label} is yes or no` };
    return { value: null };
  }
  const s = String(raw).trim();
  switch (f.kind) {
    case 'mm': {
      const n = Number(s.replace(/\s*mm$/i, ''));
      if (!Number.isFinite(n)) return { error: `${f.label} is a number of millimetres, or blank` };
      if (n === 0) return { error: `${f.label}: leave it blank when it does not apply — 0 reads as measured` };
      if (n < 0) return { error: `${f.label} cannot be negative` };
      return { value: n };
    }
    case 'money': {
      const n = Number(s.replace(/^\$/, ''));
      if (!Number.isFinite(n) || n < 0) return { error: `${f.label} is an amount in dollars, or blank` };
      return { value: n };
    }
    case 'bool': {
      if ([true, 1, '1', 'true', 'yes', 'y'].includes(typeof raw === 'string' ? s.toLowerCase() : raw)) return { value: 1 };
      if ([false, 0, '0', 'false', 'no', 'n'].includes(typeof raw === 'string' ? s.toLowerCase() : raw)) return { value: 0 };
      return { error: `${f.label} is yes or no` };
    }
    case 'format': {
      const hit = SPEC_FORMATS.find((x) => x.toLowerCase() === s.toLowerCase());
      if (!hit) return { error: `${f.label} is one of ${SPEC_FORMATS.join(', ')}` };
      return { value: hit };
    }
    default:
      return { value: s };
  }
}

/**
 * A whole body against an existing row (or null for a new spec). Returns the
 * columns to write and the errors keyed by field. Only fields PRESENT in the
 * body are considered — absent means leave it alone.
 */
export function buildSpecPatch(body, existing) {
  const patch = {};
  const errors = {};
  for (const f of SPEC_FIELDS) {
    const present = Object.prototype.hasOwnProperty.call(body || {}, f.key);
    if (!present) {
      if (!existing && f.required) errors[f.key] = `${f.label} is required`;
      continue;
    }
    const r = validateSpecField(f.key, body[f.key]);
    if (r.error) errors[f.key] = r.error;
    else if (!existing || !same(existing[f.key], r.value)) patch[f.key] = r.value;
  }
  return { patch, errors };
}

function same(a, b) {
  if (blank(a) && blank(b)) return true;
  if (typeof b === 'number') return Number(a) === b;
  return String(a) === String(b);
}
