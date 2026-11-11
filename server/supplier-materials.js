// Ingredients a supplier sells us, with their part numbers (A-20261111-004, D-338).
//
// A material is the unit of qualification (SOP 404 § III.A). Its part numbers
// live in supplier_material_parts, ONE ROW PER SYSTEM, so MRPEasy and Keychain
// numbers sit side by side during dual entry and a recipe line joins on
// (system, part_number). Nothing here deletes: a material is retired with
// is_active = 0, and a part-number row is updated in place.

import { randomUUID as uuid } from 'crypto';
import { logAudit } from './db.js';
import { SOURCE_SYSTEMS, DEFAULT_PART_SYSTEM, SOURCE_SYSTEM_LABEL, cleanMaterial } from '../shared/supplier-documents.js';

export const DEFAULT_PART_SYSTEM_KEY = 'supplier_materials.default_part_system';

/** The system a part number belongs to when nobody says. One app_settings key. */
export function defaultPartSystem(db) {
  try {
    const v = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(DEFAULT_PART_SYSTEM_KEY)?.value;
    if (v && SOURCE_SYSTEMS.includes(String(v).toLowerCase())) return String(v).toLowerCase();
  } catch { /* table missing on a very old database */ }
  return DEFAULT_PART_SYSTEM;
}

function partsOf(db, ids) {
  if (!ids.length) return new Map();
  const rows = db.prepare(`SELECT material_id, system, part_number, updated_at FROM supplier_material_parts
    WHERE material_id IN (${ids.map(() => '?').join(',')}) ORDER BY system`).all(...ids);
  const m = new Map();
  for (const r of rows) {
    if (!m.has(r.material_id)) m.set(r.material_id, []);
    m.get(r.material_id).push({ system: r.system, part_number: r.part_number, updated_at: r.updated_at });
  }
  return m;
}

/** A material as the screen and the API read it: parts, the current one, a label. */
export function shapeMaterials(db, rows) {
  const fallback = defaultPartSystem(db);
  const parts = partsOf(db, rows.map(r => r.id));
  return rows.map(r => {
    const ps = parts.get(r.id) || [];
    const system = r.current_part_system || fallback;
    const current = ps.find(p => p.system === system && p.part_number) || null;
    return {
      ...r,
      is_active: !!r.is_active,
      parts: ps,
      current_system: system,
      current_part_number: current?.part_number || null,
      label: materialLabel(r, current),
    };
  });
}

export function materialLabel(m, current) {
  const num = current?.part_number || m.item_number;
  return num ? `${m.item_description} (${num})` : m.item_description;
}

export function materialsFor(db, supplierId) {
  return shapeMaterials(db, db.prepare(`SELECT * FROM supplier_materials WHERE supplier_id = ?
    ORDER BY is_active DESC, item_description COLLATE NOCASE`).all(supplierId));
}

export function materialById(db, id) {
  const r = db.prepare('SELECT * FROM supplier_materials WHERE id = ?').get(id);
  return r ? shapeMaterials(db, [r])[0] : null;
}

/** id → label for the materials a set of file rows points at. */
export function materialLabels(db, ids) {
  const uniq = [...new Set(ids.filter(Boolean))];
  if (!uniq.length) return new Map();
  const rows = db.prepare(`SELECT * FROM supplier_materials WHERE id IN (${uniq.map(() => '?').join(',')})`).all(...uniq);
  return new Map(shapeMaterials(db, rows).map(m => [m.id, m]));
}

function writeParts(db, materialId, parts) {
  const up = db.prepare(`INSERT INTO supplier_material_parts (id, material_id, system, part_number)
    VALUES (?,?,?,?) ON CONFLICT(material_id, system)
    DO UPDATE SET part_number = excluded.part_number, updated_at = datetime('now')`);
  for (const p of parts) up.run(uuid(), materialId, p.system, p.part_number);
}

export class MaterialError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export function createMaterial(db, supplier, body, user) {
  const c = cleanMaterial(body, { defaultSystem: defaultPartSystem(db) });
  if (c.error) throw new MaterialError(400, c.error);
  const id = uuid();
  db.transaction(() => {
    db.prepare(`INSERT INTO supplier_materials (id, supplier_id, item_number, item_description, manufacturer_name,
      risk_notes, is_active, current_part_system) VALUES (?,?,?,?,?,?,?,?)`).run(
      id, supplier.id, c.data.item_number ?? null, c.data.item_description, c.data.manufacturer_name ?? null,
      c.data.risk_notes ?? null, c.data.is_active ?? 1, c.data.current_part_system ?? null);
    writeParts(db, id, c.parts);
  })();
  const after = materialById(db, id);
  logAudit(user, 'supplier_material_created', 'supplier_material', id,
    { supplier_id: supplier.id, parts: c.parts }, null, after, `${supplier.name} — ${after.label}`);
  return after;
}

export function updateMaterial(db, id, body, user) {
  const before = materialById(db, id);
  if (!before) throw new MaterialError(404, 'No such ingredient');
  const c = cleanMaterial(body, { partial: true, defaultSystem: defaultPartSystem(db) });
  if (c.error) throw new MaterialError(400, c.error);
  const cols = Object.keys(c.data);
  db.transaction(() => {
    if (cols.length) {
      db.prepare(`UPDATE supplier_materials SET ${cols.map(k => `${k} = ?`).join(', ')}, updated_at = datetime('now')
        WHERE id = ?`).run(...cols.map(k => c.data[k]), id);
    }
    writeParts(db, id, c.parts);
  })();
  const after = materialById(db, id);
  const action = 'is_active' in c.data && c.data.is_active !== (before.is_active ? 1 : 0)
    ? (c.data.is_active ? 'supplier_material_reactivated' : 'supplier_material_retired')
    : 'supplier_material_updated';
  logAudit(user, action, 'supplier_material', id, { supplier_id: before.supplier_id, fields: cols, parts: c.parts },
    before, after, after.label);
  return after;
}

export { SOURCE_SYSTEMS, SOURCE_SYSTEM_LABEL };
