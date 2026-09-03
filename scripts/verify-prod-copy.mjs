#!/usr/bin/env node
/**
 * Boot the CURRENT code against a COPY of the production database.
 *
 * `check:fresh-boot` proves a brand-new database comes up. It cannot prove the
 * other half: that a database carrying four years of history and every earlier
 * migration survives THIS release's migrations with nothing lost. Railway's
 * volume is exactly that database, and the first time the new code meets it is
 * the deploy — unless it meets a copy first, here.
 *
 *   node scripts/verify-prod-copy.mjs /path/to/compliance-YYYY-MM-DD.db
 *
 * Get the copy with `npm run backup` on the Railway service (it writes
 * data/backups/compliance-<stamp>.db and, with R2 configured, uploads the same
 * file to backups/ in the bucket). The Settings → Data & backup zip is CSVs and
 * will NOT do — the point is to run the real migrations on the real schema.
 *
 * THE ORIGINAL FILE IS NEVER OPENED FOR WRITING. It is copied (with any -wal /
 * -shm sidecars) into a temp dir and the copy is what boots, twice — the second
 * boot is the redeploy case, and a migration that is not re-runnable only shows
 * up there.
 *
 * What is asserted, in order:
 *   - both boots reach /api/health with no FATAL / SqliteError in the log;
 *   - NO TABLE LOST A ROW (a migration must never delete);
 *   - the three schema changes this release carries actually landed:
 *     equipment.loto_required has no NULLs, product_sensory_specs and
 *     artwork_snapshots exist, products.fill_weight_g exists;
 *   - the two V2 QMS forms are PARKED, not applied: controlled_definitions
 *     reads `pending` for organoleptic and flavor_approval, the approved
 *     snapshot still says V1 (aroma/flavor/overall) and the pending one says V2
 *     (odor/taste/color) — the controlled-change gate, working on real data;
 *   - nobody's password hash was touched;
 *   - the second boot seeded nothing again.
 * Tables that GREW are listed, not failed: seeders legitimately insert missing
 * rows (the 602-01 register row, new courses). Read that list — a log table
 * growing on a populated database is a seeder that is not idempotent.
 */

import { spawn } from 'child_process';
import { mkdtempSync, rmSync, copyFileSync, existsSync, statSync } from 'fs';
import { tmpdir } from 'os';
import { join, basename } from 'path';
import Database from 'better-sqlite3';

const src = process.argv[2] || process.env.PROD_DB;
if (!src || !existsSync(src)) {
  console.error('usage: node scripts/verify-prod-copy.mjs /path/to/production-copy.db');
  process.exit(2);
}

const PORT = Number(process.env.BOOT_CHECK_PORT || 4597);
const dir = mkdtempSync(join(tmpdir(), 'readydoc-prodcopy-'));
const dbPath = join(dir, 'copy.db');

let failures = 0;
const fail = (msg) => { failures++; console.error(`  ✗ ${msg}`); };
const pass = (msg) => console.log(`  ✓ ${msg}`);
const note = (msg) => console.log(`  · ${msg}`);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Copy the file and its WAL sidecars. A snapshot from `npm run backup` has none;
// a raw `cp` of a live database does, and dropping them loses the last writes.
copyFileSync(src, dbPath);
for (const ext of ['-wal', '-shm']) if (existsSync(src + ext)) copyFileSync(src + ext, dbPath + ext);
note(`copied ${basename(src)} (${(statSync(src).size / 1024 / 1024).toFixed(1)} MB) → ${dir}`);

// Compliance logs that must not gain a row from a boot. audit_log is the trail
// of the boot itself and is expected to grow; qms_records is checked below with
// the Document Change Requests a parked change legitimately raises taken out.
const LOG_TABLES = /^(production_entries|sanitation_records|work_orders|receiving_log|training_records|coa_requests|disposals|scale_verifications|retention_samples)$/;

function snapshot(path) {
  const db = new Database(path, { readonly: true, fileMustExist: true });
  try {
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().map(r => r.name);
    const counts = {};
    for (const t of tables) { try { counts[t] = db.prepare(`SELECT COUNT(*) c FROM "${t}"`).get().c; } catch { counts[t] = null; } }
    const cols = (t) => { try { return db.prepare(`PRAGMA table_info("${t}")`).all().map(c => c.name); } catch { return []; } };
    const one = (sql) => { try { return db.prepare(sql).get(); } catch { return null; } };
    const all = (sql) => { try { return db.prepare(sql).all(); } catch { return []; } };
    return {
      tables, counts,
      lotoNull: one('SELECT COUNT(*) c FROM equipment WHERE loto_required IS NULL')?.c,
      fillWeight: cols('products').includes('fill_weight_g'),
      pwHashes: Object.fromEntries(all('SELECT id, password_hash FROM users').map(r => [r.id, r.password_hash || ''])),
      qmsNonDcr: one("SELECT COUNT(*) c FROM qms_records WHERE record_type != 'document_change_request'")?.c,
      dcrs: one("SELECT COUNT(*) c FROM qms_records WHERE record_type = 'document_change_request'")?.c,
      botMessages: one("SELECT COUNT(*) c FROM chat_messages m JOIN users u ON u.id = m.user_id WHERE u.name = 'ReadyBot'")?.c,
      forms: Object.fromEntries(all("SELECT key, status, version, approved_snapshot, pending_snapshot FROM controlled_definitions WHERE key IN ('organoleptic','flavor_approval')").map(r => [r.key, r])),
    };
  } finally { db.close(); }
}

async function waitForHealth(timeoutMs = 120_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try { const r = await fetch(`http://127.0.0.1:${PORT}/api/health`); if (r.ok) return true; } catch { /* not up */ }
    await sleep(500);
  }
  return false;
}

async function boot(label) {
  console.log(`\n── ${label} ─────────────────────────────────────────`);
  const out = [];
  const child = spawn(process.execPath, ['server.js'], {
    env: { ...process.env, PORT: String(PORT), DB_PATH: dbPath, NODE_ENV: 'test' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', d => out.push(d.toString()));
  child.stderr.on('data', d => out.push(d.toString()));
  let exited = null;
  child.on('exit', (code) => { exited = code; });
  const up = await waitForHealth();
  const log = out.join('');
  if (!up) {
    fail(`${label}: server never answered /api/health` + (exited !== null ? ` (exited ${exited})` : ''));
    console.error(log.split('\n').slice(-40).join('\n'));
    try { child.kill('SIGKILL'); } catch { /* gone */ }
    return { log, up: false };
  }
  pass(`${label}: booted and answering`);
  const bad = log.split('\n').filter(l => /FATAL|SqliteError|no such table|no such column|duplicate column/i.test(l));
  if (bad.length) fail(`${label}: schema errors in the boot log:\n      ${bad.slice(0, 8).join('\n      ')}`);
  else pass(`${label}: no schema errors in the boot log`);
  for (const path of ['/api/health', '/api/users/lookup']) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}${path}`);
      if (r.status >= 500) fail(`${label}: GET ${path} → ${r.status}`); else pass(`${label}: GET ${path} → ${r.status}`);
    } catch (e) { fail(`${label}: GET ${path} threw — ${e.message}`); }
  }
  child.kill('SIGTERM');
  await sleep(1500);
  try { child.kill('SIGKILL'); } catch { /* gone */ }
  await sleep(300);
  return { log, up: true };
}

const hasV1 = (snap) => /"key":"(aroma|flavor|overall)"/.test(snap || '');
const hasV2 = (snap) => /"key":"odor"/.test(snap || '') && /"key":"taste"/.test(snap || '');

try {
  const before = snapshot(dbPath);
  note(`before: ${before.tables.length} tables · loto_required NULL on ${before.lotoNull ?? 'n/a'} machines · ` +
       `sensory specs table ${before.tables.includes('product_sensory_specs') ? 'present' : 'absent'} · ` +
       `organoleptic form ${before.forms.organoleptic?.status || 'unrecorded'} v${before.forms.organoleptic?.version ?? '-'}`);

  const first = await boot('Boot 1 (the deploy)');
  if (!first.up) throw new Error('first boot failed');
  const after = snapshot(dbPath);

  // Nothing lost.
  const lost = before.tables.filter(t => after.counts[t] == null || (before.counts[t] != null && after.counts[t] < before.counts[t]));
  if (lost.length) fail(`rows or tables LOST by the migrations: ${lost.map(t => `${t} ${before.counts[t]}→${after.counts[t] ?? 'gone'}`).join(', ')}`);
  else pass(`no table lost a row (${before.tables.length} tables checked)`);
  const grew = before.tables.filter(t => after.counts[t] > before.counts[t]).map(t => `${t} +${after.counts[t] - before.counts[t]}`);
  if (grew.length) note(`grew (seeders): ${grew.join(', ')}`);
  const logGrew = grew.filter(g => LOG_TABLES.test(g.split(' ')[0]));
  if (logGrew.length) fail(`a LOG table grew on a populated database — a seeder re-filing history: ${logGrew.join(', ')}`);
  else pass('no log table grew');
  const added = after.tables.filter(t => !before.tables.includes(t));
  if (added.length) note(`new tables: ${added.join(', ')}`);
  // A parked controlled change raises a DCR and DMs Document Control — those two
  // rows are the gate announcing itself, not history being re-filed.
  const parked = (first.log.match(/\[controlled\] (\d+) definition\(s\) changed/) || [])[1];
  const newDcrs = (after.dcrs ?? 0) - (before.dcrs ?? 0);
  if ((after.qmsNonDcr ?? 0) !== (before.qmsNonDcr ?? 0)) fail(`qms_records (excluding DCRs) changed ${before.qmsNonDcr}→${after.qmsNonDcr}`);
  else pass('no QMS record other than a Document Change Request was filed');
  if (newDcrs) {
    if (parked && Number(parked) === newDcrs) pass(`${newDcrs} DCR(s) raised, one per parked controlled change`);
    else fail(`${newDcrs} DCR(s) raised but the boot log reports ${parked || 0} parked change(s)`);
  }
  const newBot = (after.botMessages ?? 0) - (before.botMessages ?? 0);
  const newChat = (after.counts.chat_messages ?? 0) - (before.counts.chat_messages ?? 0);
  if (newChat === newBot) { if (newChat) note(`${newChat} ReadyBot message(s) posted (Document Control told about the parked changes)`); }
  else fail(`chat_messages grew by ${newChat} but only ${newBot} are ReadyBot's`);

  // This release's schema changes landed.
  if (after.lotoNull === 0) pass('equipment.loto_required has no NULLs after the backfill'); else fail(`equipment.loto_required still NULL on ${after.lotoNull}`);
  for (const t of ['product_sensory_specs', 'artwork_snapshots']) {
    if (after.tables.includes(t)) pass(`${t} exists`); else fail(`${t} missing`);
  }
  if (after.fillWeight) pass('products.fill_weight_g exists'); else fail('products.fill_weight_g missing');

  // The V2 forms are parked, not applied — on a database that approved V1.
  for (const key of ['organoleptic', 'flavor_approval']) {
    const b = before.forms[key], a = after.forms[key];
    if (!b) { note(`${key}: not under control before this boot — recorded as baseline (first-sight rule), nothing to park`); continue; }
    if (b.status === 'pending' && hasV2(b.pending_snapshot)) { note(`${key}: already parked as V2 before this boot`); }
    if (a?.status === 'pending' && hasV2(a.pending_snapshot)) pass(`${key}: V2 is PARKED as pending (Document Control's to approve)`);
    else fail(`${key}: expected status pending with the V2 fields parked, got ${a?.status} (pending has V2: ${hasV2(a?.pending_snapshot)})`);
    if (hasV1(a?.approved_snapshot) && !hasV2(a?.approved_snapshot)) pass(`${key}: the APPROVED snapshot is still V1 — the app keeps serving V1 until approval`);
    else fail(`${key}: the approved snapshot moved without approval`);
    if (a?.version === b.version) pass(`${key}: version unchanged (${b.version})`); else fail(`${key}: version moved ${b.version}→${a?.version}`);
  }

  const touched = Object.keys(before.pwHashes).filter(id => after.pwHashes[id] !== before.pwHashes[id]);
  if (!touched.length) pass(`no password hash was touched (${Object.keys(before.pwHashes).length} accounts)`); else fail(`users.password_hash changed on ${touched.length} account(s)`);

  const second = await boot('Boot 2 (the redeploy)');
  if (second.up) {
    const again = snapshot(dbPath);
    const grew2 = after.tables.filter(t => again.counts[t] > after.counts[t]).map(t => `${t} +${again.counts[t] - after.counts[t]}`);
    if (grew2.length) fail(`the second boot inserted rows again: ${grew2.join(', ')}`); else pass('the second boot inserted nothing');
    const reseeded = (second.log.match(/\[seed\] (Imported|Seeded|Created|Filed) [^\n]*/g) || []).filter(l => first.log.includes(l));
    if (reseeded.length) fail(`the second boot re-announced ${reseeded.length} seed step(s)`); else pass('the second boot announced no repeated seed step');
  }
} catch (e) {
  fail(e.message);
} finally {
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
}

if (failures) { console.error(`\n${failures} production-copy boot failure(s).`); process.exit(1); }
console.log('\nThe current code boots cleanly against this production copy.');
