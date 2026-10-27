#!/usr/bin/env node
// Copy the Drive links from the COA requests the 27 Oct clean-up removed onto
// the requests that were kept (D-250). A one-off, admin-run script: not a
// migration, not run at boot, not an API route.
//
//   DB_PATH=… node scripts/coa-copy-drive-links.mjs            # dry run
//   DB_PATH=… node scripts/coa-copy-drive-links.mjs --apply    # write
//
// WHERE THE LINKS COME FROM: the audit log. Every request the clean-up removed
// (decision A-20261027-003, `coa-remove-obvious-duplicates.mjs --apply`) has a
// `delete` audit row whose details carry `keeper_id` and, when the removed row
// held one, `lab_report_link`. That is what was actually removed, on this
// database — not the review's list, which may name rows that were skipped.
//
// RULES:
//   - A link is added as ONE LINE AT THE END OF THE KEPT REQUEST'S NOTES, the
//     same line `--preserve-links` would have written. Nothing else is changed.
//   - Never twice: a kept request whose notes already hold the link is left alone,
//     so a second --apply writes nothing.
//   - A SIGNED kept request is not changed. It is listed with its link, so the
//     link is not lost — it stays in the audit row either way.
//   - A kept request that no longer exists is listed and skipped.
//   - The dry run writes nothing at all. --apply backs the database up first,
//     writes in ONE transaction, and adds one audit row per request changed.
//
// Exit codes: 0 done · 1 refused or rolled back · 3 finished with skips to read.
import { existsSync, mkdirSync } from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';

export const DECISION = 'A-20261027-003';
export const ACTOR = { name: 'Duplicate clean-up (A-20261027-003)', role: 'admin' };

const isSigned = (r) => !!(r.qa_signed_at || r.qa_signed_by || r.certificate_number);
const parse = (s) => { try { return JSON.parse(s || '{}') || {}; } catch { return {}; } };

/** The links the clean-up removed, one entry per removed request that held one. */
export function removedLinks(db) {
  const rows = db.prepare(`SELECT entity_id, details FROM audit_log
    WHERE entity_type = 'coa_request' AND action = 'delete' AND details LIKE ? ORDER BY id`).all(`%${DECISION}%`);
  const out = [];
  for (const r of rows) {
    const d = parse(r.details);
    if (d.decision !== DECISION || !d.lab_report_link || !d.keeper_id) continue;
    out.push({ removed_id: r.entity_id, keeper_id: d.keeper_id, link: d.lab_report_link });
  }
  return out;
}

/** What --apply would do with each link: ADD, or SKIP with a reason. */
export function plan(db) {
  const seen = new Set();
  return removedLinks(db).map((l) => {
    const k = db.prepare('SELECT id, item_number, lot_number, notes, qa_signed_at, qa_signed_by, certificate_number FROM coa_requests WHERE id = ?').get(l.keeper_id);
    const key = `${l.keeper_id}|${l.link}`;
    let decision = 'ADD', reason = null;
    if (!k) { decision = 'SKIP'; reason = 'the kept request no longer exists'; }
    else if (String(k.notes || '').includes(l.link) || seen.has(key)) { decision = 'SKIP'; reason = 'already in its notes'; }
    else if (isSigned(k)) { decision = 'SKIP'; reason = 'signed — not changed'; }
    seen.add(key);
    return { ...l, item: k?.item_number || '', lot: k?.lot_number || '', decision, reason,
      line: `Lab report link (from removed duplicate row ${String(l.removed_id).slice(0, 8)}): ${l.link}` };
  });
}

/** Add the ADD lines in ONE transaction, with one audit row per request changed. */
export function applyPlan(db, logAudit) {
  let written = 0;
  db.transaction(() => {
    for (const p of plan(db)) {
      if (p.decision !== 'ADD') continue;
      const before = db.prepare('SELECT notes FROM coa_requests WHERE id = ?').get(p.keeper_id).notes;
      const after = before ? `${before}\n${p.line}` : p.line;
      db.prepare("UPDATE coa_requests SET notes = ?, updated_at = datetime('now') WHERE id = ?").run(after, p.keeper_id);
      logAudit(ACTOR, 'update', 'coa_request', p.keeper_id,
        { decision: DECISION, rule: 'copy link after removal (D-250)', removed_id: p.removed_id, lab_report_link: p.link },
        { notes: before }, { notes: after });
      written++;
    }
  })();
  return written;
}

function print(rows) {
  console.log('kept id8  item       lot              decision');
  for (const p of rows) {
    console.log(`${String(p.keeper_id).slice(0, 8)}  ${String(p.item).slice(0, 10).padEnd(10)} ${String(p.lot).slice(0, 16).padEnd(16)} ${p.decision}${p.reason ? ` — ${p.reason}` : ''}`);
    if (p.decision === 'SKIP' && p.reason.startsWith('signed')) console.log(`          link: ${p.link}`);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const unknown = args.filter(a => a !== '--apply');
  if (unknown.length) { console.error(`Unknown argument(s): ${unknown.join(' ')}. Use --apply, or nothing for a dry run.`); process.exit(1); }
  const apply = args.includes('--apply');
  const dbPath = process.env.DB_PATH;
  if (!dbPath) { console.error('DB_PATH is not set.'); process.exit(1); }
  if (!existsSync(dbPath)) { console.error(`No database at ${dbPath}.`); process.exit(1); }
  const { default: Database } = await import('better-sqlite3');

  const ro = new Database(dbPath, { readonly: true, fileMustExist: true });
  const rows = plan(ro);
  const add = rows.filter(p => p.decision === 'ADD').length;
  const skip = rows.length - add;
  print(rows);
  console.log(`\nLinks found in the audit log: ${rows.length} · to add: ${add} · skipped: ${skip}`);

  if (!apply) {
    ro.close();
    console.log('\nDRY RUN — nothing written. Run again with --apply to add the links.');
    process.exit(skip ? 3 : 0);
  }
  if (!add) { ro.close(); console.log('\nNothing to add. No backup taken and nothing written.'); process.exit(skip ? 3 : 0); }

  const backupDir = path.join(path.dirname(path.resolve(dbPath)), 'backups');
  const backupPath = path.join(backupDir, `pre-coa-copy-links-${new Date().toISOString().replace(/[:.]/g, '-')}.db`);
  try { mkdirSync(backupDir, { recursive: true }); await ro.backup(backupPath); }
  catch (e) { ro.close(); console.error(`REFUSED — the backup failed, nothing written: ${e.message}`); process.exit(1); }
  ro.close();
  console.log(`\nBackup: ${backupPath}`);

  const { getDb, logAudit } = await import('../server/db.js');
  let written;
  try { written = applyPlan(getDb(), logAudit); }
  catch (e) { console.error(`ROLLED BACK — nothing written: ${e.message}. The backup is at ${backupPath}.`); process.exit(1); }
  console.log(`APPLIED: ${written} link(s) added to kept requests' notes.`);
  process.exit(skip ? 3 : 0);
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) main();
