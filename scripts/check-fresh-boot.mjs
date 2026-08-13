#!/usr/bin/env node
/**
 * Boot a BRAND NEW database, then boot the same one again.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 * Railway's persistent volume masks a whole class of fatal bug. `addColumnIfMissing`
 * runs ALTER TABLE, which throws if the table does not exist yet — and
 * `PRAGMA table_info` on a missing table returns empty, so the "is it missing?"
 * check passes and the ALTER blows up. `CREATE INDEX` has the same trap and is
 * easier to miss, because an index sitting in the first schema block can name a
 * table created four hundred lines further down. None of it ever fires in
 * production, because the table is already there from an earlier deploy. It
 * fires on a NEW deploy and on a disaster-recovery restore, which are the two
 * moments you least want to find out.
 *
 * This has already bitten three times: the chat_push_subscriptions diagnostic
 * columns, idx_sanitation_group_date, and idx_production_entries_room. Each was
 * caught by hand. This is the same check, run every time.
 *
 * ── The SECOND boot is not redundant ────────────────────────────────────────
 * A redeploy re-runs every migration and every seeder against a database that
 * already has data. A seeder that is not idempotent, or a migration that is not
 * re-runnable, only shows up on the second boot — and by then it is in
 * production. It also proves the backfills that must run twice (the QA
 * inspection re-tag, the org-chart link) do not throw when there is nothing
 * left to do.
 *
 * Both boots must reach "running on port", write no FATAL, and answer a real
 * request. A server that starts and then serves 500s is not a server that
 * started.
 */

import { spawn } from 'child_process';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const PORT = Number(process.env.BOOT_CHECK_PORT || 4599);
const dir = mkdtempSync(join(tmpdir(), 'readydoc-boot-'));
const dbPath = join(dir, 'fresh.db');
const logPath = join(dir, 'boot.log');

let failures = 0;
const fail = (msg) => { failures++; console.error(`  ✗ ${msg}`); };
const pass = (msg) => console.log(`  ✓ ${msg}`);

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function waitForHealth(timeoutMs = 90_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/api/health`);
      if (r.ok) return true;
    } catch { /* not up yet */ }
    await sleep(500);
  }
  return false;
}

async function boot(label, { expectSeeds }) {
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
    try { child.kill('SIGKILL'); } catch { /* already gone */ }
    return { log };
  }
  pass(`${label}: booted and answering`);

  // A FATAL that the process survived is still a broken deploy — half the
  // schema may be missing while the health check happily returns 200.
  if (/FATAL|SqliteError|no such table|no such column|duplicate column/i.test(log)) {
    const lines = log.split('\n').filter(l => /FATAL|SqliteError|no such table|no such column|duplicate column/i.test(l));
    fail(`${label}: schema errors in the boot log:\n      ${lines.slice(0, 8).join('\n      ')}`);
  } else {
    pass(`${label}: no schema errors in the boot log`);
  }

  if (expectSeeds && !/\[seed\]/.test(log)) {
    fail(`${label}: a fresh database ran no seeders at all`);
  }

  // Every endpoint the login screen and the shell need before anyone can do
  // anything. A 500 here is a table that did not get created.
  for (const path of ['/api/health', '/api/users/lookup']) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}${path}`);
      if (r.status >= 500) fail(`${label}: GET ${path} → ${r.status}`);
      else pass(`${label}: GET ${path} → ${r.status}`);
    } catch (e) {
      fail(`${label}: GET ${path} threw — ${e.message}`);
    }
  }

  child.kill('SIGTERM');
  await sleep(1200);
  try { child.kill('SIGKILL'); } catch { /* already gone */ }
  return { log };
}

try {
  const first = await boot('Fresh database', { expectSeeds: true });
  if (!existsSync(dbPath)) fail('no database file was created');

  const second = await boot('Second boot (the redeploy case)', { expectSeeds: false });

  // A seeder that re-files its rows on every boot is how a plant ends up with
  // its historical log doubled. The seeders announce what they insert, so a
  // second boot announcing the same inserts is the signal.
  const reseeded = (second.log.match(/\[seed\] (Imported|Seeded|Created|Filed) [^\n]*/g) || [])
    .filter(line => first.log.includes(line));
  if (reseeded.length) {
    fail(`the second boot re-ran ${reseeded.length} seed step(s):\n      ${reseeded.slice(0, 6).join('\n      ')}`);
  } else {
    pass('the second boot seeded nothing again');
  }
} finally {
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
}

if (failures) {
  console.error(`\n${failures} boot check failure(s).`);
  process.exit(1);
}
console.log('\nFresh-database boot is clean.');
