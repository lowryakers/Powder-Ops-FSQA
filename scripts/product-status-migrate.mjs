#!/usr/bin/env node
// Move stored product statuses onto the five slugs (R-0645, D-342).
// An admin-run script: not a migration, not run at boot, not an API route.
//
//   DB_PATH=… node scripts/product-status-migrate.mjs           # dry run (default)
//   DB_PATH=… node scripts/product-status-migrate.mjs --apply   # write
//   DB_PATH=… node scripts/product-status-migrate.mjs --undo    # put back what --apply moved
//
// RULES:
//   - Only `products.status` moves, and only through LEGACY_STATUS
//     (Draft → draft, in_development / concept → ready, on_hold → hold, …).
//     A value the map does not know is LISTED and left alone.
//   - Nothing else on the row is touched — never a GTIN, never readiness.
//   - Won't launch (`not_launching`) is untouched; its `not_launching_from`
//     is moved too, so "Bring it back" lands on a slug.
//   - The dry run writes nothing. --apply and --undo back the database up
//     first, write in ONE transaction, and add one audit row per product.
//   - --undo restores only rows still holding the value --apply wrote, so it
//     never overwrites a status somebody has set since.
//
// Exit codes: 0 done · 1 refused or rolled back · 3 finished with skips to read.
import { existsSync, mkdirSync } from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';
import { LEGACY_STATUS, PRODUCT_STATUSES } from '../shared/product-status.js';

export const ACTOR = { name: 'Product status migration (R-0645)', role: 'admin' };
export const ACTION = 'product_status_migrated';
export const UNDO_ACTION = 'product_status_migration_undone';

const slugOf = (s) => (s == null ? null : LEGACY_STATUS[String(s).trim()] ?? null);

/** What --apply would do per product: MOVE, or SKIP with a reason. Products already on a slug are not listed. */
export function plan(db) {
  const out = [];
  for (const r of db.prepare('SELECT sku, status, not_launching_from FROM products ORDER BY sku').all()) {
    const statusOk = PRODUCT_STATUSES.includes(r.status);
    const fromOk = r.not_launching_from == null || PRODUCT_STATUSES.includes(r.not_launching_from);
    if (statusOk && fromOk) continue;
    const to = statusOk ? r.status : slugOf(r.status);
    const fromTo = fromOk ? r.not_launching_from : slugOf(r.not_launching_from);
    if (!to || (r.not_launching_from != null && !fromTo)) {
      out.push({ sku: r.sku, from: r.status, to: null, decision: 'SKIP', reason: `"${!to ? r.status : r.not_launching_from}" is not a status this script knows — set it by hand` });
      continue;
    }
    out.push({ sku: r.sku, from: r.status, to, nl_from: r.not_launching_from, nl_to: fromTo, decision: 'MOVE' });
  }
  return out;
}

export function applyPlan(db, logAudit) {
  let n = 0;
  db.transaction(() => {
    for (const p of plan(db)) {
      if (p.decision !== 'MOVE') continue;
      db.prepare('UPDATE products SET status = ?, not_launching_from = ? WHERE sku = ?').run(p.to, p.nl_to ?? null, p.sku);
      logAudit(ACTOR, ACTION, 'product', p.sku, { rule: 'R-0645 status slugs' },
        { status: p.from, not_launching_from: p.nl_from ?? null }, { status: p.to, not_launching_from: p.nl_to ?? null }, `${p.sku} — ${p.from} → ${p.to}`);
      n++;
    }
  })();
  return n;
}

/** What --undo would put back: the latest migration row per SKU, if the row still holds what it wrote. */
export function undoPlan(db) {
  const parse = (s) => { try { return JSON.parse(s || 'null'); } catch { return null; } };
  const latest = new Map();
  for (const a of db.prepare('SELECT entity_id, previous_state, new_state, action FROM audit_log WHERE entity_type = ? AND action IN (?, ?) ORDER BY id').all('product', ACTION, UNDO_ACTION)) {
    if (a.action === UNDO_ACTION) latest.delete(a.entity_id); else latest.set(a.entity_id, a);
  }
  const out = [];
  for (const [sku, a] of latest) {
    const prev = parse(a.previous_state) || {}; const next = parse(a.new_state) || {};
    const row = db.prepare('SELECT status, not_launching_from FROM products WHERE sku = ?').get(sku);
    if (!row) { out.push({ sku, decision: 'SKIP', reason: 'the product no longer exists' }); continue; }
    if (row.status !== next.status || (row.not_launching_from ?? null) !== (next.not_launching_from ?? null)) {
      out.push({ sku, from: row.status, to: prev.status, decision: 'SKIP', reason: 'changed since the migration — left as it is' }); continue;
    }
    out.push({ sku, from: row.status, to: prev.status, nl_to: prev.not_launching_from ?? null, nl_from: row.not_launching_from ?? null, decision: 'RESTORE' });
  }
  return out;
}

export function applyUndo(db, logAudit) {
  let n = 0;
  db.transaction(() => {
    for (const p of undoPlan(db)) {
      if (p.decision !== 'RESTORE') continue;
      db.prepare('UPDATE products SET status = ?, not_launching_from = ? WHERE sku = ?').run(p.to, p.nl_to, p.sku);
      logAudit(ACTOR, UNDO_ACTION, 'product', p.sku, { rule: 'R-0645 status slugs — undo' },
        { status: p.from, not_launching_from: p.nl_from }, { status: p.to, not_launching_from: p.nl_to }, `${p.sku} — back to ${p.to}`);
      n++;
    }
  })();
  return n;
}

async function main() {
  const args = process.argv.slice(2);
  const unknown = args.filter((a) => !['--apply', '--undo', '--dry-run'].includes(a));
  if (unknown.length) { console.error(`Unknown argument(s): ${unknown.join(' ')}. Use --apply, --undo, or nothing for a dry run.`); process.exit(1); }
  const apply = args.includes('--apply'); const undo = args.includes('--undo');
  if (apply && undo) { console.error('Pick one of --apply and --undo.'); process.exit(1); }
  const dbPath = process.env.DB_PATH;
  if (!dbPath) { console.error('DB_PATH is not set.'); process.exit(1); }
  if (!existsSync(dbPath)) { console.error(`No database at ${dbPath}.`); process.exit(1); }
  const { default: Database } = await import('better-sqlite3');
  const ro = new Database(dbPath, { readonly: true, fileMustExist: true });
  const rows = undo ? undoPlan(ro) : plan(ro);
  const act = rows.filter((p) => p.decision !== 'SKIP').length; const skip = rows.length - act;
  for (const p of rows) console.log(`${String(p.sku).padEnd(16)} ${String(p.from ?? '').padEnd(16)} → ${String(p.to ?? '').padEnd(14)} ${p.decision}${p.reason ? ` — ${p.reason}` : ''}`);
  console.log(`\n${undo ? 'To restore' : 'To move'}: ${act} · skipped: ${skip}`);
  if (!apply && !undo) { ro.close(); console.log('\nDRY RUN — nothing written. Run again with --apply to write.'); process.exit(skip ? 3 : 0); }
  if (!act) { ro.close(); console.log('\nNothing to do. No backup taken and nothing written.'); process.exit(skip ? 3 : 0); }
  const backupDir = path.join(path.dirname(path.resolve(dbPath)), 'backups');
  const backupPath = path.join(backupDir, `pre-product-status-${undo ? 'undo' : 'migrate'}-${new Date().toISOString().replace(/[:.]/g, '-')}.db`);
  try { mkdirSync(backupDir, { recursive: true }); await ro.backup(backupPath); }
  catch (e) { ro.close(); console.error(`REFUSED — the backup failed, nothing written: ${e.message}`); process.exit(1); }
  ro.close();
  console.log(`\nBackup: ${backupPath}`);
  const { getDb, logAudit } = await import('../server/db.js');
  try { const n = undo ? applyUndo(getDb(), logAudit) : applyPlan(getDb(), logAudit); console.log(`${undo ? 'RESTORED' : 'APPLIED'}: ${n} product(s).`); }
  catch (e) { console.error(`ROLLED BACK — nothing written: ${e.message}. The backup is at ${backupPath}.`); process.exit(1); }
  process.exit(skip ? 3 : 0);
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) main();
