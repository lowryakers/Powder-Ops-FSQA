#!/usr/bin/env node
// Remove the OBVIOUS duplicate COA records found by the 27 Oct 2026 review
// (decision A-20261027-003, D-241). A one-off, admin-run script: not a
// migration, not run at boot, not an API route.
//
//   DB_PATH=… node scripts/coa-remove-obvious-duplicates.mjs                    # dry run
//   DB_PATH=… node scripts/coa-remove-obvious-duplicates.mjs --apply            # after a dry run
//   options: --csv <path> (default scripts/data/coa-obvious-duplicates-2026-10-27.csv)
//            --preserve-links (default OFF — Lowry's call, never the script's)
//
// RULES, each of them load-bearing:
//   - ONLY THE IDS IN THE LIST. Nothing is ever selected by a query. A `request`
//     row deletes one coa_requests row (and its child rows, which must be empty);
//     a `file` row deletes one extra coa_files row.
//   - EVERY ROW IS RE-CHECKED AT RUN TIME and skipped, never deleted, unless every
//     condition still holds: it matches the list, is not signed, is empty, has not
//     changed since the review, nothing points at it, Phase 1 has not queued it,
//     and its keeper still exists, matches it and holds what the review saw.
//     A SIGNED REQUEST IS NEVER DELETED.
//   - A file copy goes only when the kept copy is on the same request, both are on
//     disk, and the two have the same size, SHA-256 and original name. The disk
//     file is removed only if no other row still uses it.
//   - THE DRY RUN WRITES NOTHING TO THE DATABASE. It writes one file: its own
//     report, `<db dir>/backups/coa-dup-removal-dryrun-<stamp>.json`, because
//     --apply refuses unless a dry run from the last 24 hours exists and every
//     row's decision is still the same.
//   - --apply takes a consistent copy of the database and exports every row and
//     PDF it will remove BEFORE writing anything; if either fails, nothing is
//     deleted. All deletes are ONE transaction; the disk files go after commit.
//   - One audit row per deleted row, none for a skipped one. A second --apply
//     finds the rows gone and deletes nothing.
//
// Exit codes: 0 done · 1 refused or rolled back · 3 finished with skips to read.
import { createHash } from 'crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, copyFileSync, unlinkSync, statSync } from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DECISION = 'A-20261027-003';
export const DEFAULT_CSV = path.join(ROOT, 'scripts', 'data', 'coa-obvious-duplicates-2026-10-27.csv');
export const ACTOR = { name: 'Duplicate clean-up (A-20261027-003)', role: 'admin' };

// Phase 1 (D-236) already queues these 21 empty CTLA-upload duplicates for
// Maria. This script never deletes them, whatever the database says.
export const QUEUED_IN_PHASE1 = new Set([
  'e2fad74c-6e40-4151-a901-e33e945eefa1', '1fe1a66e-1842-45a4-8a84-9d457656f7d4', '905b6c57-91d6-4426-b1cb-66214ef218fe',
  'dd2c4954-59e5-48b2-bc9f-d640d1c4840d', 'a64d2c5d-1ab3-414c-95f9-44f9f6db885d', 'acc418c8-11a7-402f-9978-3958d9c061c1',
  'a267a57b-bd4e-4b8c-ba0a-978aed531967', '2f394608-47c9-42fe-9c07-889563e7b2bc', '9199cb9e-c4d3-46e1-9f69-1fe059ef19e1',
  '758b6e7a-173a-4f12-8033-3a6ec57cce4e', '33a45d7e-b696-40d3-add6-c895da51cea6', '4bac29ba-b140-47cd-bc26-e0ba79d38648',
  'b4eb206f-5c44-4c57-ab44-be243b715802', '5b079308-198b-495a-b591-f103b05b6994', '0fb77227-3303-444f-ad05-3574c3189eb7',
  'f406434a-7071-4b79-87a1-e233f3139fe3', '58f1d24a-8753-4d6f-b44a-65c4a8506f12', 'df7e8907-128a-4e3a-9af3-caa6d6365d3e',
  'fed02911-ffd7-4b2a-84f4-c2bd520491da', 'c7a13cb6-769d-4815-b305-a533f08945f9', '06365b91-836f-49b6-903b-dde980e63f33',
]);

// What each skip means, in words, for the table and the report.
export const SKIP_REASONS = {
  ALREADY_GONE: 'Already removed (nothing to do).',
  QUEUED_IN_PHASE1: 'Already queued for Maria in QA Review (Phase 1).',
  MISMATCH: 'The record no longer matches the list (item, lot, source or status).',
  SIGNED: 'It is signed. A signed record is never deleted.',
  HAS_FILE: 'It has a file attached.',
  HAS_RESULTS: 'It has test results.',
  CHANGED: 'It has been edited since the review.',
  RETEST_TARGET: 'Another request is a re-test of it.',
  LINKED: 'A retention sample or stability pull points at it.',
  IN_QA_REVIEW: 'An open QA Review item points at it.',
  KEEPER_MISSING: 'The record it duplicates no longer exists.',
  KEEPER_IN_DELETE_SET: 'The record it duplicates is itself on the delete list.',
  KEEPER_MISMATCH: 'The record it duplicates has a different item or lot.',
  KEEPER_HOLDS_LESS: 'The record it duplicates has fewer files or results than the review saw.',
  KEEPER_FAILED: 'The record it duplicates is marked failed or re-test.',
  FILE_MISSING_ON_DISK: 'One of the two PDFs is not on disk.',
  FILE_DIFFERENT: 'The two PDFs are not identical (size, SHA-256 or name).',
  KEEPER_NOT_NEWEST: 'The copy kept is not the newest.',
};

// ── the list ──────────────────────────────────────────────────────────────
function parseCsv(text) {
  const rows = []; let row = [], f = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"' && text[i + 1] === '"') { f += '"'; i++; } else if (c === '"') q = false; else f += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(f); f = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(f); f = ''; if (row.some(v => v !== '')) rows.push(row); row = []; }
    else f += c;
  }
  row.push(f); if (row.some(v => v !== '')) rows.push(row);
  const [head, ...rest] = rows;
  return rest.map(r => Object.fromEntries(head.map((h, i) => [h.trim(), (r[i] ?? '').trim()])));
}

export function loadList(csvPath = DEFAULT_CSV) {
  const text = readFileSync(csvPath, 'utf8');
  const rows = parseCsv(text);
  for (const r of rows) {
    if (!['request', 'file'].includes(r.kind)) throw new Error(`Unknown row kind "${r.kind}" in ${csvPath}.`);
    if (!r.delete_id || !r.keep_id) throw new Error(`A row in ${csvPath} has no delete_id or keep_id.`);
  }
  return { rows, sha256: createHash('sha256').update(text).digest('hex') };
}

/** The lot as the review read it: a Drive link typed into the field gives way to the text in brackets after it. */
export function lotText(v) {
  const s = String(v ?? '').trim();
  if (!/https?:\/\//i.test(s)) return s;
  const after = s.slice(s.search(/https?:\/\//i));
  const m = after.match(/\(([^()]*)\)\s*$/) || after.match(/\(([^()]*)\)/);
  return m ? m[1].trim() : s.replace(/https?:\/\/\S+/gi, '').trim();
}
/** The Drive link typed into the lot field, if any. */
export const linkIn = (v) => (String(v ?? '').match(/https?:\/\/[^\s()]+/i) || [null])[0];
const norm = (v) => String(v ?? '').trim().toLowerCase();
const key = (v) => lotText(v).replace(/[^a-z0-9]/gi, '').toLowerCase();
const isSigned = (r) => !!(r.qa_signed_at || r.qa_signed_by || r.certificate_number);
const holds = (h) => { const m = String(h || '').match(/(\d+)f\/(\d+)r/); return m ? { f: Number(m[1]), r: Number(m[2]) } : { f: 0, r: 0 }; };
const tableExists = (db, t) => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(t);
const hasColumn = (db, t, c) => tableExists(db, t) && db.prepare(`PRAGMA table_info(${t})`).all().some(x => x.name === c);
const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');

// ── deciding ──────────────────────────────────────────────────────────────
function evaluateRequest(db, row, deleteSet) {
  const skip = (reason) => ({ decision: reason === 'ALREADY_GONE' ? 'ALREADY_GONE' : 'SKIP', reason });
  const r = db.prepare('SELECT * FROM coa_requests WHERE id = ?').get(row.delete_id);
  if (!r) return skip('ALREADY_GONE');
  if (QUEUED_IN_PHASE1.has(row.delete_id)) return skip('QUEUED_IN_PHASE1');
  if (norm(r.item_number) !== norm(row.item_number) || norm(lotText(r.lot_number)) !== norm(row.lot)
    || norm(r.source) !== norm(row.delete_source) || norm(r.status) !== norm(row.delete_status)) return skip('MISMATCH');
  if (isSigned(r)) return skip('SIGNED');
  if (db.prepare('SELECT COUNT(*) c FROM coa_files WHERE request_id = ?').get(r.id).c) return skip('HAS_FILE');
  if (db.prepare('SELECT COUNT(*) c FROM coa_test_results WHERE request_id = ?').get(r.id).c) return skip('HAS_RESULTS');
  if (String(r.updated_at) !== String(row.delete_updated_at)) return skip('CHANGED');
  if (db.prepare('SELECT 1 FROM coa_requests WHERE retest_of = ?').get(r.id)) return skip('RETEST_TARGET');
  for (const t of ['retention_samples', 'stability_pulls']) {
    if (hasColumn(db, t, 'coa_request_id') && db.prepare(`SELECT 1 FROM ${t} WHERE coa_request_id = ?`).get(r.id)) return skip('LINKED');
  }
  if (tableExists(db, 'coa_review_items')) {
    const items = db.prepare("SELECT kind FROM coa_review_items WHERE status = 'open' AND (request_id = ? OR item_key LIKE '%' || ? || '%')").all(r.id, r.id);
    if (items.some(i => i.kind === 'DELETE_DUPLICATE')) return skip('QUEUED_IN_PHASE1');
    if (items.length) return skip('IN_QA_REVIEW');
  }
  const k = db.prepare('SELECT * FROM coa_requests WHERE id = ?').get(row.keep_id);
  if (!k) return skip('KEEPER_MISSING');
  if (deleteSet.has(k.id)) return skip('KEEPER_IN_DELETE_SET');
  if (key(k.item_number) !== key(r.item_number) || key(k.lot_number) !== key(r.lot_number)) return skip('KEEPER_MISMATCH');
  const want = holds(row.keeper_holds);
  const kf = db.prepare('SELECT COUNT(*) c FROM coa_files WHERE request_id = ?').get(k.id).c;
  const kr = db.prepare('SELECT COUNT(*) c FROM coa_test_results WHERE request_id = ?').get(k.id).c;
  if (kf < want.f || kr < want.r) return skip('KEEPER_HOLDS_LESS');
  if (!want.f && !want.r && ['fail', 're_test'].includes(norm(k.status))) return skip('KEEPER_FAILED');
  return { decision: 'DELETE', reason: row.rule || 'empty twin', old: r, keeper: k };
}

function evaluateFile(db, row, uploadDir) {
  const skip = (reason) => ({ decision: reason === 'ALREADY_GONE' ? 'ALREADY_GONE' : 'SKIP', reason });
  const f = db.prepare('SELECT * FROM coa_files WHERE id = ?').get(row.delete_id);
  if (!f) return skip('ALREADY_GONE');
  if (f.request_id !== row.request_id) return skip('MISMATCH');
  const k = db.prepare('SELECT * FROM coa_files WHERE id = ?').get(row.keep_id);
  if (!k || k.request_id !== f.request_id) return skip('KEEPER_MISSING');
  const fp = path.join(uploadDir, f.filename), kp = path.join(uploadDir, k.filename);
  if (!existsSync(fp) || !existsSync(kp)) return skip('FILE_MISSING_ON_DISK');
  if (statSync(fp).size !== statSync(kp).size || f.original_name !== k.original_name || sha(fp) !== sha(kp)) return skip('FILE_DIFFERENT');
  if (String(k.created_at) < String(f.created_at)) return skip('KEEPER_NOT_NEWEST');
  return { decision: 'DELETE', reason: row.rule || 'identical file copy', old: f, keeper: k, sha256: sha(fp) };
}

/** One decision per list row. Reads only. */
export function evaluate(db, list, { uploadDir }) {
  const deleteSet = new Set(list.filter(r => r.kind === 'request').map(r => r.delete_id));
  return list.map(row => ({ row, ...(row.kind === 'request' ? evaluateRequest(db, row, deleteSet) : evaluateFile(db, row, uploadDir)) }));
}

export function counts(plan) {
  const out = { request: { DELETE: 0, SKIP: 0, ALREADY_GONE: 0, skips: {} }, file: { DELETE: 0, SKIP: 0, ALREADY_GONE: 0, skips: {} } };
  for (const p of plan) {
    const c = out[p.row.kind]; c[p.decision]++;
    if (p.decision === 'SKIP') c.skips[p.reason] = (c.skips[p.reason] || 0) + 1;
  }
  return out;
}

const decisionsOf = (plan) => Object.fromEntries(plan.map(p => [`${p.row.kind}:${p.row.delete_id}`, p.decision === 'DELETE' ? 'DELETE' : `${p.decision}:${p.reason}`]));

/** Which keepers --preserve-links would note, and the text. Never a signed keeper, never twice. */
export function linkNotes(db, plan) {
  const notes = [];
  for (const p of plan) {
    if (p.row.kind !== 'request' || p.decision !== 'DELETE') continue;
    const link = linkIn(p.old.lot_number) || p.row.lab_report_link_in_deleted_row || null;
    if (!link) continue;
    const k = db.prepare('SELECT id, notes, qa_signed_at, qa_signed_by, certificate_number FROM coa_requests WHERE id = ?').get(p.row.keep_id);
    if (!k || isSigned(k) || String(k.notes || '').includes(link) || notes.some(n => n.keeper_id === k.id && n.link === link)) continue;
    notes.push({ keeper_id: k.id, link, line: `Lab report link (from removed duplicate row ${p.row.delete_id.slice(0, 8)}): ${link}` });
  }
  return notes;
}

export function table(plan) {
  const lines = ['kind     id8       lot                  decision'];
  for (const p of plan) {
    const d = p.decision === 'SKIP' ? `SKIP ${p.reason} — ${SKIP_REASONS[p.reason] || ''}` : p.decision;
    lines.push(`${p.row.kind.padEnd(8)} ${p.row.delete_id.slice(0, 8)}  ${String(p.row.lot).slice(0, 20).padEnd(20)} ${d}`);
  }
  return lines.join('\n');
}

// ── writing ───────────────────────────────────────────────────────────────
class Changed extends Error {}

/**
 * Delete what the plan says, in ONE transaction on `db`, after re-deciding every
 * row inside it. Returns { deletedRequests, deletedFiles, notesWritten }.
 * Disk files are not touched here.
 */
export function applyPlan(db, list, expected, { uploadDir, logAudit, preserveLinks = false }) {
  let out;
  db.transaction(() => {
    const plan = evaluate(db, list, { uploadDir });
    const now = decisionsOf(plan);
    for (const [k, v] of Object.entries(expected)) if (now[k] !== v) throw new Changed(`${k}: ${v} → ${now[k]}`);
    const notes = preserveLinks ? linkNotes(db, plan) : [];
    const deletedRequests = [], deletedFiles = [];
    for (const p of plan) {
      if (p.decision !== 'DELETE') continue;
      const label = `${p.row.product || p.old.item_description || p.row.item_number} · Lot ${p.row.lot}`;
      const link = p.row.kind === 'request' ? (linkIn(p.old.lot_number) || p.row.lab_report_link_in_deleted_row || null) : null;
      const details = { decision: DECISION, rule: p.row.rule, keeper_id: p.row.keep_id, reason: p.row.reason, ...(link ? { lab_report_link: link } : {}) };
      if (p.row.kind === 'request') {
        db.prepare('DELETE FROM coa_test_results WHERE request_id = ?').run(p.old.id);
        db.prepare('DELETE FROM coa_files WHERE request_id = ?').run(p.old.id);
        const res = db.prepare('DELETE FROM coa_requests WHERE id = ? AND updated_at = ?').run(p.old.id, p.old.updated_at);
        if (res.changes !== 1) throw new Changed(`request ${p.old.id}`);
        logAudit(ACTOR, 'delete', 'coa_request', p.old.id, details, p.old, null, label);
        deletedRequests.push({ ...p, link });
      } else {
        const res = db.prepare('DELETE FROM coa_files WHERE id = ?').run(p.old.id);
        if (res.changes !== 1) throw new Changed(`file ${p.old.id}`);
        logAudit(ACTOR, 'delete', 'coa_file', p.old.id, details, p.old, null, label);
        deletedFiles.push(p);
      }
    }
    for (const n of notes) {
      const before = db.prepare('SELECT notes FROM coa_requests WHERE id = ?').get(n.keeper_id).notes;
      const after = before ? `${before}\n${n.line}` : n.line;
      db.prepare("UPDATE coa_requests SET notes = ?, updated_at = datetime('now') WHERE id = ?").run(after, n.keeper_id);
      logAudit(ACTOR, 'update', 'coa_request', n.keeper_id, { decision: DECISION, rule: 'preserve link', lab_report_link: n.link }, { notes: before }, { notes: after });
    }
    out = { deletedRequests, deletedFiles, notesWritten: notes.length };
  })();
  return out;
}

/** After commit: remove each deleted file's PDF unless another row still uses it. */
export function unlinkFiles(db, deletedFiles, uploadDir) {
  let removed = 0, kept = 0;
  for (const p of deletedFiles) {
    const inUse = db.prepare('SELECT 1 FROM coa_files WHERE filename = ?').get(p.old.filename);
    const fp = path.join(uploadDir, p.old.filename);
    if (inUse || !existsSync(fp)) { kept++; continue; }
    unlinkSync(fp); removed++;
  }
  return { removed, kept };
}

// ── the backup and the export ─────────────────────────────────────────────
function csvCell(v) { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }

export function exportRemoved(dir, plan, db, uploadDir) {
  mkdirSync(path.join(dir, 'pdfs'), { recursive: true });
  const reqs = plan.filter(p => p.row.kind === 'request' && p.decision === 'DELETE');
  const files = plan.filter(p => p.row.kind === 'file' && p.decision === 'DELETE');
  writeFileSync(path.join(dir, 'coa_requests.json'), JSON.stringify(reqs.map(p => p.old), null, 2));
  writeFileSync(path.join(dir, 'children.json'), JSON.stringify(reqs.map(p => ({
    request_id: p.old.id,
    coa_test_results: db.prepare('SELECT * FROM coa_test_results WHERE request_id = ?').all(p.old.id),
    coa_files: db.prepare('SELECT * FROM coa_files WHERE request_id = ?').all(p.old.id),
  })), null, 2));
  writeFileSync(path.join(dir, 'coa_files.json'), JSON.stringify(files.map(p => p.old), null, 2));
  for (const p of files) {
    const src = path.join(uploadDir, p.old.filename);
    if (existsSync(src)) copyFileSync(src, path.join(dir, 'pdfs', `${p.old.id}-${path.basename(p.old.filename)}`));
  }
  const lines = ['kind,id,lot,test,keeper_id,reason,lab_report_link'];
  for (const p of [...reqs, ...files]) {
    const link = p.row.kind === 'request' ? (linkIn(p.old.lot_number) || p.row.lab_report_link_in_deleted_row || '') : '';
    lines.push([p.row.kind, p.row.delete_id, p.row.lot, p.old.tests_requested || p.old.original_name || '', p.row.keep_id, p.row.reason, link].map(csvCell).join(','));
  }
  writeFileSync(path.join(dir, 'removed.csv'), lines.join('\n') + '\n');
}

export function latestDryRun(backupDir, maxAgeMs = 24 * 3600 * 1000) {
  if (!existsSync(backupDir)) return null;
  const files = readdirSync(backupDir).filter(f => /^coa-dup-removal-dryrun-.*\.json$/.test(f)).sort();
  for (const f of files.reverse()) {
    try {
      const j = JSON.parse(readFileSync(path.join(backupDir, f), 'utf8'));
      if (Date.now() - Date.parse(j.at) <= maxAgeMs) return { file: f, ...j };
    } catch { /* unreadable report: ignore it */ }
  }
  return null;
}

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const preserveLinks = args.includes('--preserve-links');
  const ci = args.indexOf('--csv');
  const csvPath = ci >= 0 ? args[ci + 1] : DEFAULT_CSV;
  const known = new Set(['--apply', '--preserve-links', '--csv', csvPath]);
  const unknown = args.filter(a => !known.has(a));
  if (unknown.length) { console.error(`Unknown argument(s): ${unknown.join(' ')}. Use --apply, --csv <path>, --preserve-links.`); process.exit(1); }
  if (ci >= 0 && !args[ci + 1]) { console.error('--csv needs a path.'); process.exit(1); }

  const dbPath = process.env.DB_PATH;
  if (!dbPath) { console.error('DB_PATH is not set.'); process.exit(1); }
  if (!existsSync(dbPath)) { console.error(`No database at ${dbPath}.`); process.exit(1); }
  const dir = path.dirname(path.resolve(dbPath));
  const backupDir = path.join(dir, 'backups');
  const uploadDir = path.join(dir, 'coa-files');
  let list;
  try { list = loadList(csvPath); } catch (e) { console.error(`Cannot read the list: ${e.message}`); process.exit(1); }
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const { default: Database } = await import('better-sqlite3');

  const ro = new Database(dbPath, { readonly: true, fileMustExist: true });
  const plan = evaluate(ro, list.rows, { uploadDir });
  const c = counts(plan);
  const wouldNote = linkNotes(ro, plan).length;
  console.log(table(plan));
  console.log(`\nRequests: ${c.request.DELETE} to delete · ${c.request.SKIP} skipped · ${c.request.ALREADY_GONE} already gone`);
  console.log(`Files:    ${c.file.DELETE} to delete · ${c.file.SKIP} skipped · ${c.file.ALREADY_GONE} already gone`);
  for (const k of ['request', 'file']) for (const [r, n] of Object.entries(c[k].skips)) console.log(`  ${k} skipped ${r}: ${n} — ${SKIP_REASONS[r]}`);
  console.log(`--preserve-links: ${preserveLinks ? 'ON' : 'OFF'} · ${wouldNote} keeper note(s) ${preserveLinks ? 'will be' : 'would be'} written.`);

  if (!apply) {
    ro.close();
    mkdirSync(backupDir, { recursive: true });
    const reportPath = path.join(backupDir, `coa-dup-removal-dryrun-${stamp}.json`);
    writeFileSync(reportPath, JSON.stringify({ at: new Date().toISOString(), db: path.resolve(dbPath), csv_sha256: list.sha256, counts: c, decisions: decisionsOf(plan) }, null, 2));
    console.log(`\nDRY RUN — nothing written to the database. Report: ${reportPath}`);
    console.log('Run again with --apply within 24 hours to delete the rows marked DELETE.');
    process.exit(c.request.SKIP + c.file.SKIP ? 3 : 0);
  }

  const dry = latestDryRun(backupDir);
  if (!dry) { ro.close(); console.error('REFUSED: no dry-run report from the last 24 hours in ' + backupDir + '. Run without --apply first.'); process.exit(1); }
  if (dry.csv_sha256 !== list.sha256 || dry.db !== path.resolve(dbPath)) { ro.close(); console.error(`REFUSED: the dry run (${dry.file}) was for a different list or database.`); process.exit(1); }
  const now = decisionsOf(plan);
  const moved = Object.keys({ ...now, ...dry.decisions }).filter(k => now[k] !== dry.decisions[k]);
  if (moved.length) { ro.close(); console.error(`REFUSED: ${moved.length} row(s) decide differently than in the dry run (${dry.file}): ${moved.slice(0, 5).join(', ')}. Run the dry run again and read it.`); process.exit(1); }
  if (!c.request.DELETE && !c.file.DELETE) {
    ro.close();
    console.log('\nNothing to delete. No backup taken and nothing written.');
    process.exit(c.request.SKIP + c.file.SKIP ? 3 : 0);
  }

  const backupPath = path.join(backupDir, `pre-coa-dup-removal-${stamp}.db`);
  const exportDir = path.join(backupDir, `coa-dup-removal-${stamp}`);
  try {
    mkdirSync(backupDir, { recursive: true });
    await ro.backup(backupPath);
    exportRemoved(exportDir, plan, ro, uploadDir);
  } catch (e) {
    ro.close();
    console.error(`REFUSED — the backup or the export failed, nothing deleted: ${e.message}`);
    process.exit(1);
  }
  ro.close();
  console.log(`\nBackup: ${backupPath}\nExport: ${exportDir}`);

  // The app's own connection, so the audit rows go through the existing helper
  // and commit (or roll back) with the deletes.
  const { getDb, logAudit } = await import('../server/db.js');
  const db = getDb();
  let result;
  try {
    result = applyPlan(db, list.rows, dry.decisions, { uploadDir, logAudit, preserveLinks });
  } catch (e) {
    console.error(`ROLLED BACK — nothing deleted: ${e instanceof Changed ? `a row changed while the script ran (${e.message})` : e.message}. The backup is still at ${backupPath}.`);
    process.exit(1);
  }
  const disk = unlinkFiles(db, result.deletedFiles, uploadDir);
  const final = { at: new Date().toISOString(), decision: DECISION, backup: backupPath, export: exportDir, counts: c,
    deleted: { requests: result.deletedRequests.length, files: result.deletedFiles.length }, pdfs_removed: disk.removed, pdfs_kept_in_use: disk.kept,
    preserve_links: { enabled: preserveLinks, written: result.notesWritten, would_write: wouldNote } };
  const reportPath = path.join(backupDir, `coa-dup-removal-report-${stamp}.json`);
  writeFileSync(reportPath, JSON.stringify(final, null, 2));
  console.log(`\nAPPLIED: ${result.deletedRequests.length} request(s) and ${result.deletedFiles.length} file copy(ies) deleted; ${disk.removed} PDF(s) removed from disk.`);
  console.log(`Report: ${reportPath}\nKeep the backup folder for 30 days.`);
  process.exit(c.request.SKIP + c.file.SKIP ? 3 : 0);
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) main();
