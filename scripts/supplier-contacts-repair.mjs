// Fill supplier contacts' name, role and primary flag from a mapping file Lowry
// has approved (A-20261111-004, D-339). Admin-run, never at boot, never by a
// route. The live register holds 178 contacts with no name, no role and no
// primary; the import used to drop them.
//
//   DB_PATH=/data/readydoc.db node scripts/supplier-contacts-repair.mjs <mapping.csv>           # dry run
//   DB_PATH=/data/readydoc.db node scripts/supplier-contacts-repair.mjs <mapping.csv> --apply   # writes
//
// The mapping is CSV (or XLSX) with columns: supplier (the supplier's id or its
// exact name), email, name, role, primary. A row is matched to ONE contact by
// supplier + email, case aside.
//
// RULES — the no-delete hold (R-0564) and "do not invent data":
//   - It FILLS ONLY EMPTY FIELDS. A name or role somebody already set is never
//     overwritten; the row is reported instead.
//   - It never deletes a contact and never creates one. An address that is not
//     on the supplier is reported.
//   - A blank cell is "no answer", never "clear it". Nothing is guessed: a
//     generic inbox (orders@, help@) stays nameless unless the mapping names it.
//   - Primary is set only where the supplier has no primary yet; one primary per
//     supplier, the API's rule.
//   - The dry run writes nothing. --apply backs the database up first, writes in
//     ONE transaction, and leaves one audit row per contact with before and after.
//   - Idempotent: a second --apply finds nothing to fill.
import { existsSync, mkdirSync, readFileSync } from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';
import { readTable } from '../server/tabular.js';
import { CONTACT_ROLES } from '../shared/supplier-fields.js';

const ACTOR = { name: 'supplier-contacts-repair (Lowry-approved mapping, D-339)' };
const ROLE = new Map(CONTACT_ROLES.flatMap(r => [[r.value, r.value], [r.label.toLowerCase(), r.value]]));
const YES = /^(y|yes|true|1|x|primary)$/i;
const cellOf = (row, ...keys) => {
  for (const k of keys) {
    const hit = Object.keys(row).find(x => x.trim().toLowerCase() === k);
    if (hit && String(row[hit] ?? '').trim()) return String(row[hit]).trim();
  }
  return '';
};

/** Every mapping row with what it would do. Reads only. */
export function plan(db, rows) {
  const byId = db.prepare('SELECT id, name FROM suppliers WHERE id = ?');
  const byName = db.prepare('SELECT id, name FROM suppliers WHERE name = ? COLLATE NOCASE');
  const contact = db.prepare('SELECT * FROM supplier_contacts WHERE supplier_id = ? AND lower(email) = lower(?)');
  const hasPrimary = db.prepare('SELECT 1 FROM supplier_contacts WHERE supplier_id = ? AND is_primary = 1');
  const primaryClaimed = new Set();
  return rows.map((row, i) => {
    const ref = cellOf(row, 'supplier', 'supplier id', 'supplier_id', 'supplier name');
    const email = cellOf(row, 'email', 'address');
    const out = { line: i + 2, supplier: ref, email, fill: {}, notes: [] };
    if (!ref || !email) { out.decision = 'SKIP'; out.notes.push('needs a supplier and an email'); return out; }
    const s = byId.get(ref) || byName.get(ref);
    if (!s) { out.decision = 'SKIP'; out.notes.push('no such supplier'); return out; }
    out.supplier_id = s.id; out.supplier = s.name;
    const c = contact.get(s.id, email);
    if (!c) { out.decision = 'SKIP'; out.notes.push('that address is not one of this supplier\'s contacts (nothing is created)'); return out; }
    out.contact_id = c.id; out.before = { name: c.name, role: c.role, is_primary: c.is_primary };
    const name = cellOf(row, 'name', 'contact name');
    const roleRaw = cellOf(row, 'role', 'contact role');
    const primary = cellOf(row, 'primary', 'is_primary', 'primary contact');
    if (name) { if (c.name) { if (c.name !== name) out.notes.push(`name already "${c.name}", left alone`); } else out.fill.name = name.slice(0, 200); }
    if (roleRaw) {
      const role = ROLE.get(roleRaw.toLowerCase());
      if (!role) out.notes.push(`unknown role "${roleRaw}", not set`);
      else if (c.role) { if (c.role !== role) out.notes.push(`role already "${c.role}", left alone`); }
      else out.fill.role = role;
    }
    if (primary && YES.test(primary) && !c.is_primary) {
      if (hasPrimary.get(s.id) || primaryClaimed.has(s.id)) out.notes.push('supplier already has a primary contact, left alone');
      else { out.fill.is_primary = 1; primaryClaimed.add(s.id); }
    }
    out.decision = Object.keys(out.fill).length ? 'FILL' : 'NOTHING';
    return out;
  });
}

/** Write the FILL rows in ONE transaction, one audit row per contact. */
export function applyPlan(db, logAudit, rows) {
  let written = 0;
  db.transaction(() => {
    for (const p of plan(db, rows)) {
      if (p.decision !== 'FILL') continue;
      const cols = Object.keys(p.fill);
      // Guarded in SQL as well: a field filled since the plan was read stays filled.
      const sets = cols.map(k => k === 'is_primary' ? 'is_primary = 1' : `${k} = COALESCE(${k}, ?)`).join(', ');
      const args = cols.filter(k => k !== 'is_primary').map(k => p.fill[k]);
      db.prepare(`UPDATE supplier_contacts SET ${sets} WHERE id = ?`).run(...args, p.contact_id);
      const after = db.prepare('SELECT name, role, is_primary FROM supplier_contacts WHERE id = ?').get(p.contact_id);
      logAudit(ACTOR, 'supplier_contact_repaired', 'supplier_contact', p.contact_id,
        { supplier_id: p.supplier_id, fields: cols, mapping_line: p.line }, p.before, after, `${p.supplier} — ${p.email}`);
      written++;
    }
  })();
  return written;
}

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const files = args.filter(a => a !== '--apply');
  if (files.length !== 1) { console.error('Usage: node scripts/supplier-contacts-repair.mjs <mapping.csv|xlsx> [--apply]'); process.exit(1); }
  const dbPath = process.env.DB_PATH;
  if (!dbPath || !existsSync(dbPath)) { console.error('DB_PATH must name an existing database.'); process.exit(1); }
  const table = readTable(readFileSync(files[0]), files[0]);
  const rows = table.rows || [];
  const { default: Database } = await import('better-sqlite3');
  const ro = new Database(dbPath, { readonly: true, fileMustExist: true });
  const p = plan(ro, rows);
  for (const r of p) {
    console.log(`line ${r.line}  ${r.decision.padEnd(7)} ${String(r.supplier).slice(0, 28).padEnd(28)} ${r.email}`
      + (Object.keys(r.fill).length ? `  fill ${JSON.stringify(r.fill)}` : '') + (r.notes.length ? `  — ${r.notes.join('; ')}` : ''));
  }
  const fill = p.filter(r => r.decision === 'FILL').length;
  console.log(`\nMapping rows: ${p.length} · to fill: ${fill} · nothing to do: ${p.filter(r => r.decision === 'NOTHING').length} · skipped: ${p.filter(r => r.decision === 'SKIP').length}`);
  if (!apply) { ro.close(); console.log('\nDRY RUN — nothing written. Run again with --apply to fill.'); process.exit(0); }
  if (!fill) { ro.close(); console.log('\nNothing to fill. No backup taken and nothing written.'); process.exit(0); }
  const backupDir = path.join(path.dirname(path.resolve(dbPath)), 'backups');
  const backupPath = path.join(backupDir, `pre-supplier-contacts-${new Date().toISOString().replace(/[:.]/g, '-')}.db`);
  try { mkdirSync(backupDir, { recursive: true }); await ro.backup(backupPath); }
  catch (e) { ro.close(); console.error(`REFUSED — the backup failed, nothing written: ${e.message}`); process.exit(1); }
  ro.close();
  console.log(`\nBackup: ${backupPath}`);
  const { getDb, logAudit } = await import('../server/db.js');
  try { console.log(`APPLIED: ${applyPlan(getDb(), logAudit, rows)} contact(s) filled.`); }
  catch (e) { console.error(`ROLLED BACK — nothing written: ${e.message}. The backup is at ${backupPath}.`); process.exit(1); }
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) main();
