// Self-serve structure: managed dropdown lists + user-added fields.
//
// The point of this module is that adding a field to a log, or an option to a
// dropdown, is a few clicks in the app instead of a code change, a migration
// and a deploy. Two rules keep that safe for records an auditor will read:
//
//   * Nothing is deleted. Fields and options RETIRE (is_active = 0): they stop
//     appearing on new entries but still render on the ones already filed. A
//     deleted field would silently strip meaning from historical records.
//   * Keys and values are immutable. A field's `key` and an option's `value`
//     are assigned once; only labels change. Stored data therefore always
//     resolves, even after somebody renames "Break Room" to "Breakroom".
//
// Values live in a `custom_data` JSON column on the host table, keyed by field
// key — the same shape as production_entries.structured_data, which this
// generalizes.

import { randomUUID as uuid } from 'crypto';

export const FIELD_TYPES = new Set(['text', 'number', 'select', 'checkbox', 'textarea', 'date']);

export const parseJson = (raw, fallback) => {
  try { return raw ? JSON.parse(raw) : fallback; } catch { return fallback; }
};

// Derive a stable key from a label ("Vendor Lot #" → "vendor_lot"). Only used
// when a field is created; never recomputed, or old data would orphan.
export function deriveKey(label, i = 0) {
  const base = String(label || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
  return base || `field_${i + 1}`;
}

/* ── Managed lists ───────────────────────────────────────────────────────── */

// Options for a list, active-only by default. `meta` is parsed so callers that
// store structured data on an option (zone item inventories) get it back.
export function listOptions(db, listKey, { includeRetired = false } = {}) {
  const rows = db.prepare(
    `SELECT * FROM app_list_options WHERE list_key = ?${includeRetired ? '' : ' AND is_active = 1'}
     ORDER BY sort_order, label`
  ).all(listKey);
  return rows.map(r => ({
    id: r.id, value: r.value, label: r.label, sort_order: r.sort_order,
    is_active: !!r.is_active, meta: parseJson(r.meta, null),
  }));
}

// Get-or-create a list, then ensure each seed option exists. Seeding never
// overwrites a label the team has since edited, and never revives a retired
// option — the app proposes defaults, people own them from then on.
export function ensureList(db, { key, label, description = null, isSystem = true, options = [] }) {
  db.prepare(`INSERT INTO app_lists (key, label, description, is_system, updated_by)
              VALUES (?, ?, ?, ?, 'system')
              ON CONFLICT(key) DO UPDATE SET
                label = COALESCE(app_lists.label, excluded.label),
                is_system = excluded.is_system`)
    .run(key, label, description, isSystem ? 1 : 0);

  const insert = db.prepare(`INSERT OR IGNORE INTO app_list_options (id, list_key, value, label, sort_order, meta)
                             VALUES (?, ?, ?, ?, ?, ?)`);
  let added = 0;
  options.forEach((o, i) => {
    const value = typeof o === 'string' ? o : o.value;
    const optLabel = typeof o === 'string' ? o : (o.label || o.value);
    const meta = typeof o === 'string' ? null : (o.meta ? JSON.stringify(o.meta) : null);
    const info = insert.run(uuid(), key, value, optLabel, i, meta);
    if (info.changes) added++;
  });
  return added;
}

/* ── Custom field definitions ────────────────────────────────────────────── */

// Field definitions for a scope, with select options already resolved from
// whichever source the field uses (a shared managed list, or inline options).
export function fieldDefs(db, scope, { includeRetired = false } = {}) {
  const rows = db.prepare(
    `SELECT * FROM custom_field_defs WHERE scope = ?${includeRetired ? '' : ' AND is_active = 1'}
     ORDER BY sort_order, label`
  ).all(scope);
  return rows.map(r => ({
    id: r.id, scope: r.scope, key: r.key, label: r.label, type: r.type,
    options_list_key: r.options_list_key,
    options: r.type === 'select'
      ? (r.options_list_key
          ? listOptions(db, r.options_list_key).map(o => ({ value: o.value, label: o.label }))
          : parseJson(r.options, []).map(o => (typeof o === 'string' ? { value: o, label: o } : o)))
      : undefined,
    required: !!r.required,
    help_text: r.help_text,
    sort_order: r.sort_order,
    is_active: !!r.is_active,
  }));
}

// Normalize an incoming field definition from the editor. `existingKey` is
// passed on update so the key survives a label edit untouched.
export function normalizeFieldDef(raw, i = 0, existingKey = null) {
  const label = String(raw?.label || '').trim() || `Field ${i + 1}`;
  const type = FIELD_TYPES.has(raw?.type) ? raw.type : 'text';
  const inline = Array.isArray(raw?.options)
    ? raw.options.map(o => (typeof o === 'string' ? o : o?.value)).map(v => String(v ?? '').trim()).filter(Boolean)
    : [];
  return {
    key: existingKey || String(raw?.key || '').trim() || deriveKey(label, i),
    label,
    type,
    options_list_key: type === 'select' ? (String(raw?.options_list_key || '').trim() || null) : null,
    options: type === 'select' && !raw?.options_list_key && inline.length ? JSON.stringify(inline) : null,
    required: raw?.required ? 1 : 0,
    help_text: String(raw?.help_text || '').trim() || null,
    sort_order: Number.isFinite(Number(raw?.sort_order)) ? Number(raw.sort_order) : i,
  };
}

/* ── Values ──────────────────────────────────────────────────────────────── */

const isBlank = (v) => v === '' || v === null || v === undefined;

// Coerce and validate submitted values against the scope's ACTIVE fields.
// Returns { data, errors }. Unknown keys are dropped so a stale client can't
// write junk; retired fields are not accepted for new input (see mergeCustomData
// for how their existing values survive an edit).
export function coerceCustomData(db, scope, raw) {
  const errors = [];
  if (raw === undefined || raw === null || raw === '') return { data: null, errors };
  // A multipart body (a claim with a photo attached) can only carry strings, so
  // the answers arrive as JSON text. Read it here, once, rather than in every
  // caller that takes a file — the reimbursement form refused every claim with
  // "custom_data must be an object" because nobody did.
  if (typeof raw === 'string') {
    try { raw = JSON.parse(raw); } catch { return { data: null, errors: ['custom_data must be an object'] }; }
    if (raw === null) return { data: null, errors };
  }
  if (typeof raw !== 'object' || Array.isArray(raw)) return { data: null, errors: ['custom_data must be an object'] };

  const defs = fieldDefs(db, scope);
  const data = {};
  for (const def of defs) {
    const v = raw[def.key];
    if (isBlank(v) || (def.type === 'checkbox' && v === false)) {
      if (def.required && def.type !== 'checkbox') errors.push(`${def.label} is required.`);
      if (def.type === 'checkbox' && v === false) data[def.key] = false;
      continue;
    }
    switch (def.type) {
      case 'number': {
        const n = Number(v);
        if (!Number.isFinite(n)) { errors.push(`${def.label} must be a number.`); break; }
        data[def.key] = n;
        break;
      }
      case 'checkbox':
        data[def.key] = !!v;
        break;
      case 'select': {
        const allowed = (def.options || []).map(o => o.value);
        // An option retired after this record was drafted shouldn't block the
        // save; only a value that never existed is rejected.
        if (allowed.length && !allowed.includes(String(v))) {
          const everExisted = def.options_list_key
            ? listOptions(db, def.options_list_key, { includeRetired: true }).some(o => o.value === String(v))
            : false;
          if (!everExisted) { errors.push(`${def.label}: "${v}" is not one of the choices.`); break; }
        }
        data[def.key] = String(v);
        break;
      }
      case 'date':
        data[def.key] = String(v).slice(0, 10);
        break;
      default:
        data[def.key] = String(v);
    }
  }
  return { data: Object.keys(data).length ? data : null, errors };
}

// Merge an edit over what's already stored. Keys the active field set no longer
// defines (retired fields) are carried forward untouched — editing a record must
// never quietly drop the parts of it that are no longer being collected.
export function mergeCustomData(existingRaw, incoming) {
  const existing = typeof existingRaw === 'string' ? parseJson(existingRaw, {}) : (existingRaw || {});
  if (!incoming) return Object.keys(existing).length ? existing : null;
  const merged = { ...existing, ...incoming };
  return Object.keys(merged).length ? merged : null;
}

// Render helper shared by exports/PDFs: label/value pairs in field order, with
// any orphaned keys (retired or since-removed fields) appended so nothing on a
// filed record is invisible.
export function describeCustomData(db, scope, raw) {
  const data = typeof raw === 'string' ? parseJson(raw, null) : raw;
  if (!data || typeof data !== 'object') return [];
  const defs = fieldDefs(db, scope, { includeRetired: true });
  const known = new Set(defs.map(d => d.key));
  const fmt = (def, v) => {
    if (def.type === 'checkbox') return v ? 'Yes' : 'No';
    if (def.type === 'select') {
      const hit = (def.options || []).find(o => o.value === String(v));
      return hit ? hit.label : String(v);
    }
    return String(v);
  };
  const out = defs
    .filter(d => !isBlank(data[d.key]))
    .map(d => ({ key: d.key, label: d.label, value: fmt(d, data[d.key]), retired: !d.is_active }));
  for (const k of Object.keys(data)) {
    if (known.has(k) || isBlank(data[k])) continue;
    out.push({ key: k, label: k.replace(/_/g, ' '), value: String(data[k]), retired: true });
  }
  return out;
}
