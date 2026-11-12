#!/usr/bin/env node
// One-time GS1 inner/case backfill (R-0645 PR C). An admin-run script — not a
// route, not run at boot. Lowry runs it after merge against the database he
// chooses, with the GS1 Data Hub "Export All Products" file.
//
//   DB_PATH=… node scripts/gs1-backfill.mjs <export.xlsx>            # dry run (default)
//   DB_PATH=… node scripts/gs1-backfill.mjs <export.xlsx> --apply    # write
//
// COPY, NEVER COMPUTE. Every code written is a code that appears in the export,
// passes its GS1 check digit and shares the unit's twelve middle digits. Nothing
// here builds a check digit, flips an indicator, or derives an inner or case
// from the unit. Historical indicators (case at 2 or 3) are copied as they are.
//
// RULES (the pack's match rules):
//   1. A product matches the GS1 Each row whose GTIN-14 is its UPC-12 padded
//      with zeros — the same number.
//   2. Inner = an In Use "Inner Pack" row, indicator 3, same middle twelve.
//      More than one ⇒ reported, nothing written. Indicator-0 "inner" bundles
//      are not inners.
//   3. Case = In Use only (never PreMarket/Draft/Archived). Among several:
//      the pack's usual shipper (stick ⇒ indicator 1, everything else ⇒ 2); one
//      left ⇒ written, otherwise reported. CASE_CHOICE names the two the plant
//      already chose (CPK-PSM-PS, DNT-BOX-CPB).
//   4. The two typo codes from the old sheet are never written, whatever the
//      file says.
//   5. In Use Each codes with no ReadyDoc product are REPORTED. Nothing creates
//      a product.
//   6. A unit GTIN is never written. An inner/case already on the row that
//      DIFFERS is a conflict, left alone; one that matches is a no-op.
//   7. --apply backs the database up first, writes in one transaction, stamps
//      readiness, audits each product (`gs1_backfill`), and records the export
//      in gs1_export_rows for the GS1-check preset. A second --apply is a no-op.
//
// Exit codes: 0 done · 1 refused or rolled back · 3 finished with conflicts to read.
import { existsSync, mkdirSync, readFileSync } from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';
import { readTable } from '../server/tabular.js';
import { gtinValid } from '../shared/gtin.js';
import { unitGtin14, sameItem } from '../shared/level-gtin.js';

export const ACTOR = { name: 'GS1 inner/case backfill (R-0645)', role: 'admin' };
export const ACTION = 'gs1_backfill';
/** Strings on the old distributor sheet that were never GS1 codes. Never written. */
export const TYPO_CODES = new Set(['108500467261222', '10850030869622']);
/** Cases the plant already chose among several In Use codes. Written only if the code is in the export. */
export const CASE_CHOICE = { 'CPK-PSM-PS': '10850046726122', 'DNT-BOX-CPB': '10850030869828' };

const norm = (h) => String(h || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
/** A GS1 cell as a GTIN-14 string, or '' — a number cell loses its leading zeros, so pad them back. */
export function gtin14Of(raw) {
  let s = String(raw ?? '').trim();
  if (!s) return '';
  if (/e\+?\d+$/i.test(s) && Number.isFinite(Number(s))) s = Number(s).toFixed(0);
  s = s.replace(/[\s-]/g, '');
  if (!/^\d{1,14}$/.test(s)) return s; // reported as not a GTIN
  return s.padStart(14, '0');
}
const levelOf = (v) => (/each/i.test(v) ? 'each' : /inner/i.test(v) ? 'inner' : /case/i.test(v) ? 'case' : (String(v || '').trim().toLowerCase() || 'unknown'));
const inUse = (s) => /in\s*use/i.test(String(s || ''));

/** Read the export: `{ rows: [{ gtin, level, level_label, status, description }], columns, missing }`. */
export function readGs1(buffer, filename) {
  const { headers, rows } = readTable(buffer, filename);
  const find = (pred) => headers.find((h) => pred(norm(h)));
  const col = {
    gtin: find((h) => h === 'gtin' || h === 'gtin 14' || h === 'gtin14'),
    gtin12: find((h) => h === 'gtin 12' || h === 'gtin12' || h === 'upc'),
    level: find((h) => h.includes('packaging level') || h === 'level' || h === 'package level'),
    status: find((h) => h === 'status label' || h === 'status'),
    description: find((h) => h.includes('description')),
  };
  const missing = ['gtin', 'level', 'status'].filter((k) => !col[k]);
  if (missing.length) return { rows: [], columns: col, missing, headers };
  const out = [];
  for (const r of rows) {
    const g = gtin14Of(r[col.gtin]) || (col.gtin12 ? gtin14Of(r[col.gtin12]) : '');
    if (!g) continue;
    out.push({ gtin: g, level: levelOf(r[col.level]), level_label: String(r[col.level] || '').trim(),
      status: String(r[col.status] || '').trim(), description: col.description ? String(r[col.description] || '').trim() : '' });
  }
  return { rows: out, columns: col, missing: [], headers };
}

const mid12 = (g) => g.slice(1, 13);

/**
 * What --apply would do. Writes nothing.
 * `{ products: [...per product], orphans, counts }` where each product row has
 * `inner` / `case` decisions: write · same · conflict · ambiguous · none.
 */
export function plan(db, gs1Rows) {
  const valid = gs1Rows.filter((r) => /^\d{14}$/.test(r.gtin) && gtinValid(r.gtin) && !TYPO_CODES.has(r.gtin));
  const eachBy = new Map(valid.filter((r) => r.level === 'each').map((r) => [r.gtin, r]));
  const byMid = new Map();
  for (const r of valid) { if (r.level === 'each') continue; const k = mid12(r.gtin); (byMid.get(k) || byMid.set(k, []).get(k)).push(r); }
  const products = db.prepare("SELECT sku, gtin, gtin_inner, gtin_case, pack, product_type FROM products ORDER BY sku").all();
  const taken = new Map();
  for (const p of products) for (const f of ['gtin', 'gtin_inner', 'gtin_case']) if (p[f]) taken.set(f === 'gtin' ? unitGtin14(p[f]) : p[f], p.sku);
  const matchedEach = new Set();
  const out = [];
  for (const p of products) {
    const u = unitGtin14(p.gtin);
    if (!u) { out.push({ sku: p.sku, unit: null, match: 'no_unit_gtin' }); continue; }
    const each = eachBy.get(u);
    if (!each) { out.push({ sku: p.sku, unit: u, match: 'not_in_export' }); continue; }
    matchedEach.add(u);
    const kin = byMid.get(mid12(u)) || [];
    // Inner: In Use, indicator 3, inner level.
    const inners = kin.filter((r) => r.level === 'inner' && inUse(r.status) && r.gtin[0] === '3');
    let innerPick = null; let innerWhy = '';
    if (inners.length === 1) { innerPick = inners[0].gtin; innerWhy = 'the one In Use inner pack'; }
    else if (inners.length > 1) innerWhy = `${inners.length} In Use inner packs: ${inners.map((r) => r.gtin).join(', ')}`;
    // Case: In Use only.
    const cases = kin.filter((r) => r.level === 'case');
    const usable = cases.filter((r) => inUse(r.status));
    let casePick = null; let caseWhy = '';
    const chosen = CASE_CHOICE[p.sku];
    if (chosen && cases.some((r) => r.gtin === chosen)) { casePick = chosen; caseWhy = 'the case code the plant chose for this SKU'; }
    else if (usable.length === 1) { casePick = usable[0].gtin; caseWhy = 'the one In Use case'; }
    else if (usable.length > 1) {
      const want = p.pack === 'STK' ? '1' : '2';
      const pref = usable.filter((r) => r.gtin[0] === want);
      if (pref.length === 1) { casePick = pref[0].gtin; caseWhy = `the In Use case with indicator ${want} (${p.pack === 'STK' ? 'stick' : 'non-stick'} shipper)`; }
      else caseWhy = `${usable.length} In Use cases: ${usable.map((r) => r.gtin).join(', ')}`;
    } else if (cases.length) caseWhy = `GS1 has only ${[...new Set(cases.map((r) => r.status || 'no status'))].join(' / ')} case codes — none In Use`;
    const decide = (field, pick, why) => {
      const cur = p[field] || null;
      if (!pick) return { decision: why ? (why.includes('In Use cases') || why.includes('In Use inner') ? 'ambiguous' : 'none') : 'none', why };
      if (!(gtinValid(pick) && sameItem(pick, p.gtin))) return { decision: 'refused', code: pick, why: 'fails its check digit or is not this unit' };
      if (cur === pick) return { decision: 'same', code: pick, why };
      if (cur) return { decision: 'conflict', code: pick, current: cur, why: `ReadyDoc already holds ${cur}` };
      const other = taken.get(pick);
      if (other && other !== p.sku) return { decision: 'conflict', code: pick, why: `${pick} is already on ${other}` };
      return { decision: 'write', code: pick, why };
    };
    out.push({ sku: p.sku, unit: u, match: 'matched', unit_status: each.status, inner: decide('gtin_inner', innerPick, innerWhy), case: decide('gtin_case', casePick, caseWhy) });
  }
  const orphans = [...eachBy.values()].filter((r) => inUse(r.status) && !matchedEach.has(r.gtin))
    .map((r) => ({ gtin: r.gtin, status: r.status, description: r.description }));
  const notInUseUnmatched = [...eachBy.values()].filter((r) => !inUse(r.status) && !matchedEach.has(r.gtin)).length;
  const typos = gs1Rows.filter((r) => TYPO_CODES.has(r.gtin)).map((r) => r.gtin);
  const tally = (f, d) => out.filter((x) => x[f]?.decision === d).length;
  return {
    products: out, orphans, typos,
    counts: {
      products: out.length, matched: out.filter((x) => x.match === 'matched').length,
      no_unit_gtin: out.filter((x) => x.match === 'no_unit_gtin').length,
      not_in_export: out.filter((x) => x.match === 'not_in_export').length,
      inner_write: tally('inner', 'write'), inner_same: tally('inner', 'same'), inner_conflict: tally('inner', 'conflict'), inner_ambiguous: tally('inner', 'ambiguous'),
      case_write: tally('case', 'write'), case_same: tally('case', 'same'), case_conflict: tally('case', 'conflict'), case_ambiguous: tally('case', 'ambiguous'),
      orphans: orphans.length, other_unmatched_each: notInUseUnmatched,
    },
  };
}

/** Write the plan. Every UPDATE re-checks that the field is still blank. */
export function applyPlan(db, p, gs1Rows, { logAudit, stampReadiness, sourceFile }) {
  let n = 0;
  db.transaction(() => {
    for (const x of p.products) {
      if (x.match !== 'matched') continue;
      const set = {};
      if (x.inner.decision === 'write') set.gtin_inner = x.inner.code;
      if (x.case.decision === 'write') set.gtin_case = x.case.code;
      if (!Object.keys(set).length) continue;
      const before = db.prepare('SELECT * FROM products WHERE sku = ?').get(x.sku);
      const wrote = {};
      if (set.gtin_inner) {
        const r = db.prepare("UPDATE products SET gtin_inner = ?, updated_at = datetime('now') WHERE sku = ? AND (gtin_inner IS NULL OR gtin_inner = '')").run(set.gtin_inner, x.sku);
        if (r.changes) wrote.gtin_inner = set.gtin_inner;
      }
      if (set.gtin_case) {
        const r = db.prepare("UPDATE products SET gtin_case = ?, gtin_case_source = 'gs1_export', updated_at = datetime('now') WHERE sku = ? AND (gtin_case IS NULL OR gtin_case = '')").run(set.gtin_case, x.sku);
        if (r.changes) wrote.gtin_case = set.gtin_case;
      }
      if (!Object.keys(wrote).length) continue;
      stampReadiness?.(db, x.sku, before, Object.keys(wrote), ACTOR.name);
      logAudit(ACTOR, ACTION, 'product', x.sku,
        { source_file: sourceFile, inner_reason: wrote.gtin_inner ? x.inner.why : undefined, case_reason: wrote.gtin_case ? x.case.why : undefined },
        { gtin_inner: before.gtin_inner || null, gtin_case: before.gtin_case || null }, wrote, `${x.sku} — GS1 inner/case from the export`);
      n++;
    }
    const up = db.prepare(`INSERT INTO gs1_export_rows (gtin, level, status, description, source_file, loaded_at)
      VALUES (?, ?, ?, ?, ?, datetime('now')) ON CONFLICT(gtin) DO UPDATE SET level = excluded.level, status = excluded.status,
      description = excluded.description, source_file = excluded.source_file, loaded_at = excluded.loaded_at`);
    for (const r of gs1Rows) if (/^\d{14}$/.test(r.gtin)) up.run(r.gtin, r.level_label || r.level, r.status, r.description, sourceFile);
  })();
  return n;
}

function report(p) {
  const line = (x) => {
    const f = (d, lbl) => (d && d.decision !== 'none' ? `${lbl} ${d.decision}${d.code ? ` ${d.code}` : ''}${d.why ? ` (${d.why})` : ''}` : '');
    return `${String(x.sku).padEnd(16)} ${x.match === 'matched' ? [f(x.inner, 'inner'), f(x.case, 'case')].filter(Boolean).join(' · ') || 'nothing to attach' : x.match.replace(/_/g, ' ')}`;
  };
  for (const x of p.products) if (x.match === 'matched' && (x.inner.decision !== 'none' || x.case.decision !== 'none')) console.log(line(x));
  console.log(`\nMatched ${p.counts.matched} of ${p.counts.products} products to a GS1 Each row (${p.counts.no_unit_gtin} have no unit GTIN, ${p.counts.not_in_export} are not in the export).`);
  console.log(`Inner: ${p.counts.inner_write} to write · ${p.counts.inner_same} already match · ${p.counts.inner_conflict} conflicts · ${p.counts.inner_ambiguous} ambiguous`);
  console.log(`Case:  ${p.counts.case_write} to write · ${p.counts.case_same} already match · ${p.counts.case_conflict} conflicts · ${p.counts.case_ambiguous} ambiguous`);
  if (p.typos.length) console.log(`Typo codes in the file, NOT written: ${p.typos.join(', ')}`);
  console.log(`\nIn Use GS1 Each codes with no ReadyDoc product (reported, nothing created): ${p.orphans.length}`);
  for (const o of p.orphans) console.log(`  ${o.gtin}  ${o.status}  ${o.description}`);
  if (p.counts.other_unmatched_each) console.log(`Other GS1 Each codes not In Use and not in ReadyDoc: ${p.counts.other_unmatched_each}`);
}

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const files = args.filter((a) => !a.startsWith('--'));
  const unknown = args.filter((a) => a.startsWith('--') && !['--apply', '--dry-run'].includes(a));
  if (unknown.length || files.length !== 1) { console.error('Usage: DB_PATH=… node scripts/gs1-backfill.mjs <gs1-export.xlsx> [--apply]'); process.exit(1); }
  const dbPath = process.env.DB_PATH;
  if (!dbPath || !existsSync(dbPath)) { console.error(`No database at ${dbPath || '(DB_PATH not set)'}.`); process.exit(1); }
  if (!existsSync(files[0])) { console.error(`No file at ${files[0]}.`); process.exit(1); }
  const g = readGs1(readFileSync(files[0]), files[0]);
  if (g.missing.length) { console.error(`REFUSED — the export has no ${g.missing.join(', ')} column. Headers read: ${g.headers.join(' | ')}`); process.exit(1); }
  console.log(`Read ${g.rows.length} GS1 rows from ${path.basename(files[0])} (columns: ${Object.entries(g.columns).filter(([, v]) => v).map(([k, v]) => `${k}="${v}"`).join(', ')}).\n`);
  const { default: Database } = await import('better-sqlite3');
  const ro = new Database(dbPath, { readonly: true, fileMustExist: true });
  const p = plan(ro, g.rows);
  report(p);
  const toWrite = p.counts.inner_write + p.counts.case_write;
  const conflicts = p.counts.inner_conflict + p.counts.case_conflict + p.counts.inner_ambiguous + p.counts.case_ambiguous;
  if (!apply) { ro.close(); console.log('\nDRY RUN — nothing written. Run again with --apply to write.'); process.exit(conflicts ? 3 : 0); }
  const backupDir = path.join(path.dirname(path.resolve(dbPath)), 'backups');
  const backupPath = path.join(backupDir, `pre-gs1-backfill-${new Date().toISOString().replace(/[:.]/g, '-')}.db`);
  try { mkdirSync(backupDir, { recursive: true }); await ro.backup(backupPath); }
  catch (e) { ro.close(); console.error(`REFUSED — the backup failed, nothing written: ${e.message}`); process.exit(1); }
  ro.close();
  console.log(`\nBackup: ${backupPath}`);
  const { getDb, logAudit } = await import('../server/db.js');
  const { stampReadiness } = await import('../server/api/products.js');
  try {
    const n = applyPlan(getDb(), p, g.rows, { logAudit, stampReadiness, sourceFile: path.basename(files[0]) });
    console.log(`APPLIED: ${n} product(s) written (${toWrite} code(s) planned); the export is recorded for the GS1-check preset.`);
  } catch (e) { console.error(`ROLLED BACK — nothing written: ${e.message}. The backup is at ${backupPath}.`); process.exit(1); }
  process.exit(conflicts ? 3 : 0);
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) main();
