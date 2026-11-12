// Supplier cleanup, step 2 (A-20261111-004, D-347): the rows Lowry has approved,
// applied from ONE sheet. Admin-run, never at boot, never by a route.
//
//   DB_PATH=/data/readydoc.db node scripts/supplier-step2.mjs --list            # read-only worklist
//   DB_PATH=/data/readydoc.db node scripts/supplier-step2.mjs <plan.csv|xlsx>   # dry run
//   DB_PATH=/data/readydoc.db node scripts/supplier-step2.mjs <plan.csv|xlsx> --apply
//
// The sheet has an `action` column. One row, one act:
//
//   action   | columns it reads
//   ---------+--------------------------------------------------------------------
//   type     | supplier, vendor_type                       (plan C1)
//   part     | supplier, material, system, part_number, create   (part numbers; A8)
//   relabel  | file_id, from_kind, kind, expires_on        (kind corrections; "count as GMP")
//   expiry   | file_id, expires_on, from_expires_on
//   lot      | file_id, lot_number
//
// `supplier` is the id or the exact name; `material` is the material id or its
// exact description on that supplier. Contact names have their own script
// (supplier-contacts-repair.mjs). Drive-only files are uploaded in the app.
//
// RULES — the no-delete hold (R-0564) and "do not invent data":
//   - A BLANK IS FILLED; A VALUE ALREADY SET IS NEVER OVERWRITTEN. A row that
//     disagrees with what is there is reported, not applied.
//   - A CORRECTION NEEDS ITS EVIDENCE. A relabel names the kind the file has
//     NOW (`from_kind`); an expiry that moves names the date it has now
//     (`from_expires_on`). If either no longer matches, nothing is written.
//   - A GMP certificate and a letter of guarantee carry a date or are not set.
//   - Nothing is deleted. A material is created only where the row says
//     `create = yes`, and never twice.
//   - THE GATES ARE NOT TOUCHED. The script never writes app_settings and
//     refuses to finish an apply if either gate mode moved while it ran.
//   - The dry run writes nothing. --apply backs the database up first, writes
//     in ONE transaction, one audit row per change with before and after.
//   - Idempotent: a second --apply finds nothing to do.
import { existsSync, mkdirSync, readFileSync } from 'fs';
import path from 'path';
import crypto from 'crypto';
import { pathToFileURL } from 'url';
import { VENDOR_TYPES } from '../shared/supplier-fields.js';
import { FILE_KIND_VALUES, DATED_KINDS, SOURCE_SYSTEMS } from '../shared/supplier-documents.js';

const ACTOR = { name: 'supplier-step2 (Lowry-approved plan, D-347)' };
const TYPES = new Map(VENDOR_TYPES.flatMap(t => [[t.value, t.value], [t.label.toLowerCase(), t.value]]));
const GATE_KEYS = ['supplier_gmp_gate', 'supplier_banned_gate'];
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const YES = /^(y|yes|true|1|x|create)$/i;

const cellOf = (row, ...keys) => {
  for (const k of keys) {
    const hit = Object.keys(row).find(x => x.trim().toLowerCase().replace(/\s+/g, '_') === k);
    if (hit && String(row[hit] ?? '').trim()) return String(row[hit]).trim();
  }
  return '';
};
const dateOf = (v) => { const d = String(v || '').trim().slice(0, 10); return DATE.test(d) ? d : null; };

export function gateModes(db) {
  return Object.fromEntries(GATE_KEYS.map(k => [k, (() => {
    try { return db.prepare('SELECT value FROM app_settings WHERE key = ?').get(k)?.value ?? null; } catch { return null; }
  })()]));
}

/** Read-only worklist: what step 2 still has to answer. */
export function worklist(db) {
  return {
    typeless_active: db.prepare(`SELECT id, name FROM suppliers WHERE actively_using = 1
      AND (vendor_type IS NULL OR trim(vendor_type) = '') ORDER BY name`).all(),
    materials_without_part: db.prepare(`SELECT m.id, s.name AS supplier, m.item_description FROM supplier_materials m
      JOIN suppliers s ON s.id = m.supplier_id
      WHERE m.is_active = 1 AND NOT EXISTS (SELECT 1 FROM supplier_material_parts p WHERE p.material_id = m.id
        AND p.part_number IS NOT NULL AND trim(p.part_number) != '') ORDER BY s.name, m.item_description`).all(),
    unknown_kind_files: db.prepare(`SELECT f.id, s.name AS supplier, f.filename, f.kind FROM supplier_files f
      JOIN suppliers s ON s.id = f.supplier_id WHERE f.kind IN ('unknown', 'other') ORDER BY s.name, f.filename`).all(),
    dated_kind_without_date: db.prepare(`SELECT f.id, s.name AS supplier, f.filename, f.kind FROM supplier_files f
      JOIN suppliers s ON s.id = f.supplier_id WHERE f.kind IN (${DATED_KINDS.map(() => '?').join(',')})
      AND (f.expires_on IS NULL OR f.expires_on = '') ORDER BY s.name`).all(...DATED_KINDS),
  };
}

/** Every plan row with what it would do. Reads only. */
export function plan(db, rows) {
  const supplierBy = (ref) => db.prepare('SELECT id, name, vendor_type FROM suppliers WHERE id = ?').get(ref)
    || db.prepare('SELECT id, name, vendor_type FROM suppliers WHERE name = ? COLLATE NOCASE').get(ref);
  const fileBy = (id) => db.prepare('SELECT id, supplier_id, kind, expires_on, lot_number, filename FROM supplier_files WHERE id = ?').get(id);
  const materialBy = (supplierId, ref) => db.prepare('SELECT * FROM supplier_materials WHERE id = ? AND supplier_id = ?').get(ref, supplierId)
    || db.prepare('SELECT * FROM supplier_materials WHERE supplier_id = ? AND item_description = ? COLLATE NOCASE AND is_active = 1').get(supplierId, ref);
  const partOf = (materialId, system) => db.prepare('SELECT * FROM supplier_material_parts WHERE material_id = ? AND system = ?').get(materialId, system);
  const planned = { types: new Map(), creates: new Set(), parts: new Set(), files: new Map() };

  return rows.map((row, i) => {
    const action = cellOf(row, 'action').toLowerCase();
    const out = { line: i + 2, action, decision: 'SKIP', notes: [] };
    const skip = (why) => { out.notes.push(why); return out; };

    if (action === 'type') {
      const ref = cellOf(row, 'supplier', 'supplier_id', 'supplier_name');
      const s = ref && supplierBy(ref);
      if (!s) return skip(ref ? `no supplier "${ref}"` : 'needs a supplier');
      out.supplier_id = s.id; out.label = s.name;
      const raw = cellOf(row, 'vendor_type', 'type');
      const t = TYPES.get(raw.toLowerCase());
      if (!t) return skip(`unknown vendor type "${raw}" (one of ${VENDOR_TYPES.map(x => x.value).join(', ')})`);
      if (planned.types.has(s.id) && planned.types.get(s.id) !== t) return skip(`another row types this supplier ${planned.types.get(s.id)}`);
      if (s.vendor_type) {
        out.decision = 'NOTHING';
        if (s.vendor_type !== t) out.notes.push(`already "${s.vendor_type}", left alone`);
        return out;
      }
      planned.types.set(s.id, t);
      out.decision = 'TYPE'; out.before = { vendor_type: null }; out.after = { vendor_type: t };
      return out;
    }

    if (action === 'part') {
      const ref = cellOf(row, 'supplier', 'supplier_id', 'supplier_name');
      const s = ref && supplierBy(ref);
      if (!s) return skip(ref ? `no supplier "${ref}"` : 'needs a supplier');
      out.supplier_id = s.id;
      const mRef = cellOf(row, 'material', 'material_id', 'item_description', 'ingredient');
      if (!mRef) return skip('needs a material');
      const system = (cellOf(row, 'system', 'part_source_system') || 'mrpeasy').toLowerCase();
      if (!SOURCE_SYSTEMS.includes(system)) return skip(`unknown system "${system}" (one of ${SOURCE_SYSTEMS.join(', ')})`);
      const part = cellOf(row, 'part_number', 'part').slice(0, 60);
      if (!part) return skip('needs a part number');
      out.label = `${s.name} — ${mRef}`; out.system = system; out.part_number = part;
      const m = materialBy(s.id, mRef);
      if (!m) {
        if (!YES.test(cellOf(row, 'create'))) return skip('no such material on this supplier (put create = yes to add it)');
        const key = `${s.id}|${mRef.toLowerCase()}`;
        if (planned.creates.has(key)) return skip('another row already creates this material');
        planned.creates.add(key); planned.parts.add(`${key}|${system}`);
        out.decision = 'CREATE'; out.item_description = mRef.slice(0, 300);
        return out;
      }
      out.material_id = m.id;
      const pk = `${m.id}|${system}`;
      if (planned.parts.has(pk)) return skip('another row already sets this part number');
      const have = partOf(m.id, system);
      if (have?.part_number) {
        out.decision = 'NOTHING';
        if (have.part_number !== part) out.notes.push(`${system} part number already "${have.part_number}", left alone`);
        return out;
      }
      planned.parts.add(pk);
      out.decision = 'PART'; out.part_row = have?.id || null;
      return out;
    }

    if (['relabel', 'expiry', 'lot'].includes(action)) {
      const id = cellOf(row, 'file_id', 'file');
      const f = id && fileBy(id);
      if (!f) return skip(id ? `no file "${id}"` : 'needs a file_id');
      if (planned.files.has(f.id)) return skip(`another row already changes this file (line ${planned.files.get(f.id)})`);
      out.file_id = f.id; out.supplier_id = f.supplier_id; out.label = f.filename;
      const patch = {};
      if (action === 'relabel') {
        const from = cellOf(row, 'from_kind');
        const to = cellOf(row, 'kind', 'to_kind');
        if (!FILE_KIND_VALUES.includes(to)) return skip(`unknown kind "${to}"`);
        if (!from) return skip('a relabel names the kind the file has now (from_kind)');
        if (f.kind === to) { out.decision = 'NOTHING'; return out; }
        if (f.kind !== from) return skip(`the file is "${f.kind}" now, not "${from}" — left alone`);
        patch.kind = to;
        const given = cellOf(row, 'expires_on', 'expiry');
        if (given && !dateOf(given)) return skip(`"${given}" is not a date (YYYY-MM-DD)`);
        if (given && f.expires_on && f.expires_on !== dateOf(given)) return skip(`the file already carries ${f.expires_on}; change it with an expiry row`);
        if (given && !f.expires_on) patch.expires_on = dateOf(given);
        if (DATED_KINDS.includes(to) && !(patch.expires_on || f.expires_on)) return skip(`a ${to.replace(/_/g, ' ')} needs its date (expires_on)`);
      }
      if (action === 'expiry') {
        const d = dateOf(cellOf(row, 'expires_on', 'expiry'));
        if (!d) return skip('needs expires_on as YYYY-MM-DD');
        if (f.expires_on === d) { out.decision = 'NOTHING'; return out; }
        if (f.expires_on) {
          const from = dateOf(cellOf(row, 'from_expires_on'));
          if (from !== f.expires_on) return skip(`the file already carries ${f.expires_on}; a change names it in from_expires_on`);
        }
        patch.expires_on = d;
      }
      if (action === 'lot') {
        const lot = cellOf(row, 'lot_number', 'lot').slice(0, 80);
        if (!lot) return skip('needs a lot_number');
        if (f.lot_number) {
          out.decision = 'NOTHING';
          if (f.lot_number !== lot) out.notes.push(`lot already "${f.lot_number}", left alone`);
          return out;
        }
        patch.lot_number = lot;
      }
      planned.files.set(f.id, out.line);
      out.decision = 'FILE';
      out.before = Object.fromEntries(Object.keys(patch).map(k => [k, f[k] ?? null]));
      out.after = patch;
      return out;
    }

    return skip(action ? `unknown action "${action}" (type, part, relabel, expiry, lot)` : 'needs an action');
  });
}

/** Write the plan in ONE transaction, one audit row per change. Returns counts. */
export function applyPlan(db, logAudit, rows) {
  const gatesBefore = JSON.stringify(gateModes(db));
  const counts = { types: 0, materials: 0, parts: 0, files: 0 };
  db.transaction(() => {
    for (const p of plan(db, rows)) {
      if (p.decision === 'TYPE') {
        const r = db.prepare("UPDATE suppliers SET vendor_type = ?, updated_at = datetime('now') WHERE id = ? AND (vendor_type IS NULL OR trim(vendor_type) = '')")
          .run(p.after.vendor_type, p.supplier_id);
        if (r.changes) { logAudit(ACTOR, 'supplier_type_set', 'supplier', p.supplier_id, { plan_line: p.line }, p.before, p.after, p.label); counts.types++; }
      } else if (p.decision === 'CREATE') {
        const id = crypto.randomUUID();
        db.prepare(`INSERT INTO supplier_materials (id, supplier_id, item_description, is_active, current_part_system) VALUES (?,?,?,1,?)`)
          .run(id, p.supplier_id, p.item_description, p.system);
        db.prepare('INSERT INTO supplier_material_parts (id, material_id, system, part_number) VALUES (?,?,?,?)')
          .run(crypto.randomUUID(), id, p.system, p.part_number);
        logAudit(ACTOR, 'supplier_material_created', 'supplier_material', id,
          { supplier_id: p.supplier_id, plan_line: p.line, parts: [{ system: p.system, part_number: p.part_number }] }, null,
          { item_description: p.item_description, system: p.system, part_number: p.part_number }, p.label);
        counts.materials++; counts.parts++;
      } else if (p.decision === 'PART') {
        const r = p.part_row
          ? db.prepare("UPDATE supplier_material_parts SET part_number = ?, updated_at = datetime('now') WHERE id = ? AND (part_number IS NULL OR trim(part_number) = '')")
            .run(p.part_number, p.part_row)
          : db.prepare('INSERT OR IGNORE INTO supplier_material_parts (id, material_id, system, part_number) VALUES (?,?,?,?)')
            .run(crypto.randomUUID(), p.material_id, p.system, p.part_number);
        if (r.changes) {
          logAudit(ACTOR, 'supplier_material_updated', 'supplier_material', p.material_id,
            { supplier_id: p.supplier_id, plan_line: p.line, parts: [{ system: p.system, part_number: p.part_number }] },
            { [p.system]: null }, { [p.system]: p.part_number }, p.label);
          counts.parts++;
        }
      } else if (p.decision === 'FILE') {
        const cols = Object.keys(p.after);
        // Guarded in SQL too: the file must still hold what the plan read.
        const where = cols.map(k => `${k} IS ?`).join(' AND ');
        const r = db.prepare(`UPDATE supplier_files SET ${cols.map(k => `${k} = ?`).join(', ')} WHERE id = ? AND ${where}`)
          .run(...cols.map(k => p.after[k]), p.file_id, ...cols.map(k => p.before[k]));
        if (r.changes) {
          logAudit(ACTOR, cols.includes('kind') ? 'supplier_file_relabelled' : 'supplier_file_updated', 'supplier_file', p.file_id,
            { supplier_id: p.supplier_id, fields: cols, plan_line: p.line }, p.before, p.after, p.label);
          counts.files++;
        }
      }
    }
    if (JSON.stringify(gateModes(db)) !== gatesBefore) throw new Error('a gate mode changed while the plan ran');
  })();
  return counts;
}

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const list = args.includes('--list');
  const files = args.filter(a => !a.startsWith('--'));
  const dbPath = process.env.DB_PATH;
  if (!dbPath || !existsSync(dbPath)) { console.error('DB_PATH must name an existing database.'); process.exit(1); }
  const { default: Database } = await import('better-sqlite3');
  const ro = new Database(dbPath, { readonly: true, fileMustExist: true });

  if (list) {
    const w = worklist(ro);
    console.log(`Typeless suppliers in use (${w.typeless_active.length}):`);
    for (const s of w.typeless_active) console.log(`  type,${s.id},  ${s.name}`);
    console.log(`\nActive materials with no part number (${w.materials_without_part.length}):`);
    for (const m of w.materials_without_part) console.log(`  ${m.supplier} — ${m.item_description}  [${m.id}]`);
    console.log(`\nFiles filed as unknown/other (${w.unknown_kind_files.length}):`);
    for (const f of w.unknown_kind_files) console.log(`  ${f.supplier} — ${f.filename}  [${f.id}] ${f.kind}`);
    console.log(`\nGMP certificates / letters with no date (${w.dated_kind_without_date.length}):`);
    for (const f of w.dated_kind_without_date) console.log(`  ${f.supplier} — ${f.filename}  [${f.id}] ${f.kind}`);
    console.log(`\nGate modes (left as they are): ${JSON.stringify(gateModes(ro))}`);
    ro.close(); process.exit(0);
  }
  if (files.length !== 1) { console.error('Usage: node scripts/supplier-step2.mjs <plan.csv|xlsx> [--apply]   or   --list'); process.exit(1); }

  const { readTable } = await import('../server/tabular.js');
  const rows = readTable(readFileSync(files[0]), files[0]).rows || [];
  const p = plan(ro, rows);
  for (const r of p) {
    const what = r.decision === 'TYPE' ? `→ ${r.after.vendor_type}`
      : r.decision === 'CREATE' ? `create material, ${r.system} ${r.part_number}`
      : r.decision === 'PART' ? `${r.system} part ${r.part_number}`
      : r.decision === 'FILE' ? JSON.stringify(r.after) : '';
    console.log(`line ${r.line}  ${r.action.padEnd(7)} ${r.decision.padEnd(7)} ${String(r.label || '').slice(0, 40).padEnd(40)} ${what}`
      + (r.notes.length ? `  — ${r.notes.join('; ')}` : ''));
  }
  const n = (d) => p.filter(r => r.decision === d).length;
  const todo = n('TYPE') + n('CREATE') + n('PART') + n('FILE');
  console.log(`\nPlan rows: ${p.length} · types: ${n('TYPE')} · new materials: ${n('CREATE')} · part numbers: ${n('PART')} · file corrections: ${n('FILE')} · nothing to do: ${n('NOTHING')} · skipped: ${n('SKIP')}`);
  console.log(`Gate modes (not touched): ${JSON.stringify(gateModes(ro))}`);
  if (!apply) { ro.close(); console.log('\nDRY RUN — nothing written. Run again with --apply to write.'); process.exit(0); }
  if (!todo) { ro.close(); console.log('\nNothing to do. No backup taken and nothing written.'); process.exit(0); }
  const backupDir = path.join(path.dirname(path.resolve(dbPath)), 'backups');
  const backupPath = path.join(backupDir, `pre-supplier-step2-${new Date().toISOString().replace(/[:.]/g, '-')}.db`);
  try { mkdirSync(backupDir, { recursive: true }); await ro.backup(backupPath); }
  catch (e) { ro.close(); console.error(`REFUSED — the backup failed, nothing written: ${e.message}`); process.exit(1); }
  ro.close();
  console.log(`\nBackup: ${backupPath}`);
  const { getDb, logAudit } = await import('../server/db.js');
  try { console.log(`APPLIED: ${JSON.stringify(applyPlan(getDb(), logAudit, rows))}`); }
  catch (e) { console.error(`ROLLED BACK — nothing written: ${e.message}. The backup is at ${backupPath}.`); process.exit(1); }
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) main();
