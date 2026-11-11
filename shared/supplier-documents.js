// What a supplier document can be, and what an ingredient (a supplier material)
// carries (A-20261111-004, D-338). PURE — the server refuses anything else, the
// screen offers exactly these, so the two cannot disagree.

// The systems a part number can come from. ONE list for products'
// formula_source_system and for a material's part numbers, so a Keychain
// cutover is a config change plus a data copy, never a schema rewrite.
export const SOURCE_SYSTEMS = ['mrpeasy', 'keychain', 'manual', 'genesis'];
export const SOURCE_SYSTEM_LABEL = { mrpeasy: 'MRPEasy', keychain: 'Keychain', manual: 'Manual', genesis: 'Genesis' };
// The system a part number belongs to when the person does not say. Read from
// app_settings key `supplier_materials.default_part_system`; this is the fallback.
export const DEFAULT_PART_SYSTEM = 'mrpeasy';

// Every kind a supplier file may be filed or re-labelled as. The archive's own
// classifier (server/supplier-archive.js) returns only these.
export const FILE_KINDS = [
  { value: 'questionnaire', label: 'Vendor questionnaire (completed)' },
  { value: 'raw_material_questionnaire', label: 'Raw material questionnaire (completed)' },
  { value: 'questionnaire_blank', label: 'Vendor questionnaire (blank form)' },
  { value: 'raw_material_questionnaire_blank', label: 'Raw material questionnaire (blank form)' },
  { value: 'audit_report', label: 'Audit report' },
  { value: 'gmp_certificate', label: 'Third-party GMP certificate' },
  { value: 'letter_of_guarantee', label: 'Letter of guarantee' },
  { value: 'audit_certificate', label: 'Audit certificate (SQF / BRC / FSSC)' },
  { value: 'certificate', label: 'Certificate (other)' },
  { value: 'registration', label: 'Registration' },
  { value: 'specification', label: 'Specification' },
  { value: 'coa', label: 'Certificate of analysis' },
  { value: 'sds', label: 'Safety data sheet' },
  { value: 'allergen', label: 'Allergen statement' },
  { value: 'natural_flavor', label: 'Natural flavor statement' },
  { value: 'nutritional', label: 'Nutritional information' },
  { value: 'haccp', label: 'HACCP / process flow' },
  { value: 'label', label: 'Label' },
  { value: 'fsvp', label: 'FSVP statement' },
  { value: 'w9', label: 'W-9' },
  { value: 'certificate_of_insurance', label: 'Certificate of insurance' },
  { value: 'statement', label: 'Statement (other)' },
  { value: 'vendor_qms_document', label: "Supplier's own quality document" },
  { value: 'org_chart', label: 'Organization chart' },
  { value: 'mmr_example', label: 'Example master manufacturing record' },
  { value: 'bpr_example', label: 'Example batch production record' },
  { value: 'sop_toc', label: 'SOP table of contents' },
  { value: 'other', label: 'Other' },
  { value: 'unknown', label: 'Not yet identified' },
];
export const FILE_KIND_VALUES = FILE_KINDS.map(k => k.value);
export const FILE_KIND_LABEL = Object.fromEntries(FILE_KINDS.map(k => [k.value, k.label]));

// Kinds that are about the SUPPLIER, not one ingredient: shown as supplier-level
// on a product's rollup.
export const SUPPLIER_LEVEL_KINDS = ['gmp_certificate', 'letter_of_guarantee', 'audit_certificate', 'audit_report',
  'certificate_of_insurance', 'w9', 'registration', 'fsvp', 'questionnaire', 'raw_material_questionnaire'];

// Kinds that must carry an expiry (renewal) date when filed or re-labelled.
export const DATED_KINDS = ['gmp_certificate', 'letter_of_guarantee'];

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const t = (v, n = 300) => { const s = String(v ?? '').trim(); return s ? s.slice(0, n) : null; };

/** A part number as stored, or { error }. */
export function cleanPart(p = {}, defaultSystem = DEFAULT_PART_SYSTEM) {
  const system = String(p.system || p.part_source_system || defaultSystem).trim().toLowerCase();
  if (!SOURCE_SYSTEMS.includes(system)) return { error: `A part number's system is one of ${SOURCE_SYSTEMS.join(', ')}.` };
  const part_number = t(p.part_number, 60);
  return { system, part_number };
}

/**
 * The editable fields of a material from a request body. `partial` (an edit)
 * leaves an absent field alone; a create needs a description.
 */
export function cleanMaterial(b = {}, { partial = false, defaultSystem = DEFAULT_PART_SYSTEM } = {}) {
  const out = {};
  for (const k of ['item_description', 'manufacturer_name', 'item_number', 'risk_notes']) {
    if (k in b) out[k] = t(b[k], k === 'risk_notes' ? 1000 : 300);
  }
  if (!partial && !out.item_description) return { error: 'An ingredient needs a description.' };
  if (partial && 'item_description' in out && !out.item_description) return { error: 'An ingredient needs a description.' };
  if ('is_active' in b) out.is_active = b.is_active ? 1 : 0;
  if ('current_part_system' in b) {
    const s = String(b.current_part_system || '').trim().toLowerCase();
    if (s && !SOURCE_SYSTEMS.includes(s)) return { error: `The current system is one of ${SOURCE_SYSTEMS.join(', ')}.` };
    out.current_part_system = s || null;
  }
  const parts = [];
  const raw = Array.isArray(b.parts) ? b.parts
    : (b.part_number !== undefined ? [{ system: b.part_source_system, part_number: b.part_number }] : []);
  for (const p of raw) {
    const c = cleanPart(p, defaultSystem);
    if (c.error) return c;
    if (parts.some(x => x.system === c.system)) return { error: `Two part numbers for ${SOURCE_SYSTEM_LABEL[c.system]} — one per system.` };
    parts.push(c);
  }
  return { data: out, parts };
}

/**
 * The editable metadata of a filed document. Absent = leave alone; blank = clear.
 * The kind is a closed list; an expiry is a date or nothing.
 */
export function cleanFileMeta(b = {}) {
  const out = {};
  if ('kind' in b) {
    const k = String(b.kind || '').trim();
    if (!FILE_KIND_VALUES.includes(k)) return { error: `Unknown document kind "${k}".` };
    out.kind = k;
  }
  if ('expires_on' in b) {
    const d = String(b.expires_on || '').trim().slice(0, 10);
    if (d && !DATE.test(d)) return { error: 'The expiry date must be a date (YYYY-MM-DD).' };
    out.expires_on = d || null;
  }
  if ('lot_number' in b) out.lot_number = t(b.lot_number, 80);
  if ('material_id' in b) out.material_id = t(b.material_id, 80);
  return { data: out };
}
