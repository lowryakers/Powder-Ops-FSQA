#!/usr/bin/env node
// Link existing COA results to the specification on file (COA Phase 2 task A5,
// D-245). A one-off, admin-run script: not a migration, not run at boot, not an
// API route. Nobody but an admin runs --apply.
//
//   DB_PATH=… node scripts/coa-link-results-to-specs.mjs                         # dry run
//   DB_PATH=… node scripts/coa-link-results-to-specs.mjs --apply                 # link the safe ones
//   DB_PATH=… node scripts/coa-link-results-to-specs.mjs --apply --file-items    # …and queue the rest for Quality
//
// RULES, each of them load-bearing:
//   - ONLY results with no specification, on an UNSIGNED request. A signed
//     request is never touched: its results are closed, and it stays "no spec
//     on file".
//   - A result is LINKED only when exactly one active specification matches its
//     test name AND grading the stored value against that specification gives
//     the SAME verdict that is stored. Only `specification_id` is written —
//     never the value, the verdict or anything else.
//   - Everything else (the verdicts disagree, or no single spec matches) is
//     REPORTED in a CSV beside the backup, and with --file-items filed as one QA
//     Review item per request (kind SPEC_LINK_REVIEW). Nothing is decided for
//     Quality.
//   - THE DRY RUN WRITES NOTHING TO THE DATABASE. --apply re-checks every row,
//     takes a consistent copy of the database first, then writes in ONE
//     transaction with one audit row per linked result. A second --apply finds
//     nothing left to link and writes nothing.
//
// Exit codes: 0 done · 1 refused or rolled back · 3 finished with rows to review.
import { existsSync, writeFileSync, mkdirSync } from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';
import { v4 as uuid } from 'uuid';
import { specIndex, gradeResult } from '../server/coa-grade.js';

export const DECISION = 'D-245';
export const ACTOR = { name: 'Result-to-spec link (D-245)', role: 'admin' };
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');

/** Decide every unlinked result on an unsigned request. Pure over the database: reads only. */
export function evaluate(db) {
  const rows = db.prepare(`SELECT t.*, r.item_number, r.lot_number, r.item_description FROM coa_test_results t
    JOIN coa_requests r ON r.id = t.request_id
    WHERE t.specification_id IS NULL AND r.qa_signed_at IS NULL ORDER BY r.item_number, t.request_id, t.test_type`).all();
  const specsByItem = new Map();
  const specsFor = (item) => {
    if (!specsByItem.has(item)) specsByItem.set(item, db.prepare('SELECT * FROM coa_specifications WHERE item_number = ? AND is_active = 1').all(item));
    return specsByItem.get(item);
  };
  return rows.map(t => {
    const specs = specsFor(t.item_number);
    const base = { result_id: t.id, request_id: t.request_id, item_number: t.item_number, lot_number: t.lot_number, test_type: t.test_type,
      result_value: t.result_value, stored: t.pass_fail || null };
    if (!specs.length) return { ...base, decision: 'NO_SPEC', note: 'No active specification on file for this item.' };
    const spec = specIndex(specs).find(t.test_type);
    if (!spec) return { ...base, decision: 'NO_SPEC', note: 'No active specification for this test.' };
    // Exactly one: another active spec whose name reads the same is a second claimant.
    const rivals = specs.filter(s => s.id !== spec.id && (norm(s.test_type) === norm(spec.test_type) || specIndex([s]).find(t.test_type)));
    if (rivals.length) return { ...base, decision: 'REVIEW', spec_id: spec.id, note: `More than one specification matches (${[spec, ...rivals].map(s => s.test_type).join(', ')}).` };
    const graded = gradeResult(t.result_value, spec, null, { unit: t.unit || spec.unit || null }).pass_fail || null;
    if (graded !== base.stored) {
      return { ...base, decision: 'REVIEW', spec_id: spec.id, graded,
        note: `The stored verdict is ${base.stored || 'blank'}, but the specification on file (${spec.specification || spec.test_type}) gives ${graded || 'no verdict'}.` };
    }
    return { ...base, decision: 'LINK', spec_id: spec.id, graded };
  });
}

export function counts(plan) {
  const c = { LINK: 0, REVIEW: 0, NO_SPEC: 0 };
  for (const p of plan) c[p.decision] += 1;
  return c;
}

const csvCell = (v) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
export function reviewCsv(plan) {
  const lines = ['request_id,item_number,lot_number,result_id,test_type,result_value,stored_verdict,spec_verdict,note'];
  for (const p of plan.filter(x => x.decision === 'REVIEW')) {
    lines.push([p.request_id, p.item_number, p.lot_number, p.result_id, p.test_type, p.result_value, p.stored, p.graded, p.note].map(csvCell).join(','));
  }
  return lines.join('\n') + '\n';
}

/** Link the LINK rows and (optionally) file the REVIEW items. One transaction; re-checks each row. */
export function applyPlan(db, { logAudit, fileItems = false }) {
  const plan = evaluate(db);   // decided again at write time, never trusted from a report
  const out = { linked: 0, items: 0, plan };
  db.transaction(() => {
    const link = db.prepare('UPDATE coa_test_results SET specification_id = ? WHERE id = ? AND specification_id IS NULL');
    for (const p of plan.filter(x => x.decision === 'LINK')) {
      if (!link.run(p.spec_id, p.result_id).changes) continue;
      out.linked += 1;
      logAudit?.(ACTOR, 'update', 'coa_test_result', p.result_id, { decision: DECISION, rule: 'link to the matching specification', specification_id: p.spec_id, verdict: p.stored },
        { specification_id: null }, { specification_id: p.spec_id }, `${p.item_number} · ${p.test_type}`);
    }
    if (!fileItems) return;
    const byRequest = new Map();
    for (const p of plan.filter(x => x.decision === 'REVIEW')) {
      if (!byRequest.has(p.request_id)) byRequest.set(p.request_id, []);
      byRequest.get(p.request_id).push(p);
    }
    const ins = db.prepare(`INSERT OR IGNORE INTO coa_review_items (id, item_key, kind, request_id, title, recommended_action, reason, evidence, steps, decision_ref)
      VALUES (?, ?, 'SPEC_LINK_REVIEW', ?, ?, ?, ?, ?, ?, ?)`);
    for (const [requestId, rows] of byRequest) {
      const first = rows[0];
      const key = `spec-link:${requestId}`;
      const r = ins.run(uuid(), key, requestId,
        [first.item_number, first.lot_number ? `lot ${first.lot_number}` : null, 'results that do not match the specification'].filter(Boolean).join(' · '),
        `These results do not match the specification on file: ${rows.map(x => x.test_type).join(', ')}. Open each result and save it — if you keep a verdict the limit does not give, say why.`,
        rows.map(x => `${x.test_type}: ${x.note}`).join(' '),
        JSON.stringify([{ kind: 'request', request_id: requestId, label: 'Open the request' }]),
        JSON.stringify({ steps: ['link'], result_ids: rows.map(x => x.result_id) }), DECISION);
      if (r.changes) {
        out.items += 1;
        logAudit?.(ACTOR, 'create', 'coa_review_item', key, { kind: 'SPEC_LINK_REVIEW', request_id: requestId, results: rows.map(x => x.result_id) });
      }
    }
  })();
  return out;
}

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const fileItems = args.includes('--file-items');
  const unknown = args.filter(a => !['--apply', '--file-items'].includes(a));
  if (unknown.length) { console.error(`Unknown argument(s): ${unknown.join(' ')}. Use --apply and --file-items.`); process.exit(1); }
  if (fileItems && !apply) { console.error('--file-items only works with --apply.'); process.exit(1); }
  const dbPath = process.env.DB_PATH;
  if (!dbPath) { console.error('DB_PATH is not set.'); process.exit(1); }
  if (!existsSync(dbPath)) { console.error(`No database at ${dbPath}.`); process.exit(1); }
  const backupDir = path.join(path.dirname(path.resolve(dbPath)), 'backups');
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const { default: Database } = await import('better-sqlite3');

  const ro = new Database(dbPath, { readonly: true, fileMustExist: true });
  const plan = evaluate(ro);
  const c = counts(plan);
  console.log(`Unlinked results on unsigned requests: ${plan.length}`);
  console.log(`  ${c.LINK} can be linked safely (one specification matches and gives the same verdict)`);
  console.log(`  ${c.REVIEW} need Quality to look (the verdicts disagree, or more than one specification matches)`);
  console.log(`  ${c.NO_SPEC} have no specification to link to (left alone)`);
  mkdirSync(backupDir, { recursive: true });
  const csvPath = path.join(backupDir, `coa-spec-link-review-${stamp}.csv`);
  writeFileSync(csvPath, reviewCsv(plan));
  console.log(`Rows for Quality to look at: ${csvPath}`);

  if (!apply) {
    ro.close();
    console.log('\nDRY RUN — nothing written to the database. Run again with --apply to link the safe ones' + (c.REVIEW ? ', and add --file-items to queue the rest in QA Review.' : '.'));
    process.exit(c.REVIEW ? 3 : 0);
  }
  if (!c.LINK && !(fileItems && c.REVIEW)) { ro.close(); console.log('\nNothing to write. No backup taken.'); process.exit(c.REVIEW ? 3 : 0); }

  const backupPath = path.join(backupDir, `pre-coa-spec-link-${stamp}.db`);
  try { await ro.backup(backupPath); }
  catch (e) { ro.close(); console.error(`REFUSED — the backup failed, nothing written: ${e.message}`); process.exit(1); }
  ro.close();
  console.log(`\nBackup: ${backupPath}`);

  const { getDb, logAudit } = await import('../server/db.js');
  let out;
  try { out = applyPlan(getDb(), { logAudit, fileItems }); }
  catch (e) { console.error(`ROLLED BACK — nothing written: ${e.message}. The backup is still at ${backupPath}.`); process.exit(1); }
  const reportPath = path.join(backupDir, `coa-spec-link-report-${stamp}.json`);
  writeFileSync(reportPath, JSON.stringify({ at: new Date().toISOString(), decision: DECISION, backup: backupPath, counts: c, linked: out.linked, items_filed: out.items }, null, 2));
  console.log(`APPLIED: ${out.linked} result(s) linked; ${out.items} QA Review item(s) filed.\nReport: ${reportPath}\nKeep the backup for 30 days.`);
  process.exit(c.REVIEW ? 3 : 0);
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) main();
