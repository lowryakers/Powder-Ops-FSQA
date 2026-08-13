#!/usr/bin/env node
/**
 * GET every list endpoint the app opens on, as an admin, and fail on any 5xx.
 *
 * ── Why ─────────────────────────────────────────────────────────────────────
 * The Calibration → Instruments tab came up empty and read exactly like data
 * loss. Nothing had been deleted: `GET /calibration/instruments` was throwing a
 * ReferenceError because a helper had been extracted into its own module and
 * the import was never added. The build could not catch it — server code is not
 * bundled — and the screen has no way to tell "the query returned nothing" from
 * "the request failed", so it renders the same either way.
 *
 * That is the failure this exists to catch: a module that LOOKS like it lost
 * its records. It is deliberately not an assertion about CONTENT — a fresh
 * database legitimately has empty lists — only that every one of these answers
 * without erroring. An empty 200 is fine; a 500 is a screen somebody is about
 * to report as missing data.
 *
 * Add a path here when you add a list endpoint. A 404 fails too: a path that
 * does not resolve is a client calling something that no longer exists.
 */

import { spawn } from 'child_process';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import crypto from 'crypto';
import Database from 'better-sqlite3';

const PORT = Number(process.env.ENDPOINT_CHECK_PORT || 4601);
const BASE = `http://127.0.0.1:${PORT}/api`;
const dir = mkdtempSync(join(tmpdir(), 'readydoc-endpoints-'));
const dbPath = join(dir, 'check.db');

// Every screen's first request. Grouped the way the nav is, so a gap is
// obvious when a module is added.
const PATHS = [
  // shell + compliance
  '/health', '/users/lookup', '/users', '/compliance/notifications', '/compliance/critical',
  '/audit', '/audit/facets',
  // quality
  '/qms/deviation', '/qms/non_conformance', '/qms/on_hold', '/qms/flavor_approval',
  '/qa-review', '/sanitation', '/sanitation/reclean-status', '/disposals', '/complaints',
  '/haccp', '/hygienic-design', '/internal-audits', '/mock-recalls', '/meetings',
  '/retention', '/retention/boxes', '/facility/map-status', '/quality-schedules',
  '/chemicals', '/checklists/templates',
  '/safety/forms', '/safety/evacuations', '/safety/first-aid', '/quality-schedules/emp-site-list',
  // calibration — the one that started this
  '/calibration/instruments', '/calibration/records', '/calibration/stats',
  '/scale-verification/forms', '/scale-verification',
  // maintenance + equipment
  '/pm/schedules', '/pm/work-orders', '/pm/metrics', '/pm/operator-tasks',
  '/pm/by-frequency', '/pm/clearance-pending', '/pm/completed-history',
  '/equipment', '/equipment/readiness', '/loto', '/loto/uncovered-equipment',
  // production
  '/production/entries', '/production/eod-templates', '/production/entries/qa-actions',
  '/coa/requests', '/coa/specifications',
  // warehouse
  '/receiving', '/receiving/stats', '/receiving/checklists', '/receiving/next-inspection-no',
  '/receiving/checklist/form', '/film-inspection', '/film-inspection/form',
  // documents + training
  '/documents', '/doc-review', '/controlled', '/training/courses', '/training', '/training/matrix', '/training/due',
  '/certifications', '/policies', '/org', '/org/people',
  // office
  '/office/time', '/office/supply/orders', '/finance/ap', '/finance/ar',
  '/partners/documents', '/banking/accounts', '/banking/transactions',
  '/reimbursements', '/pay/employees', '/pay/reviewers', '/newsletter/issues',
  '/products', '/artwork', '/nfp/versions', '/procurement',
  // comms + structure
  '/comms/channels', '/comms/threads/unread', '/comms/activity/unread',
  '/structure/lists', '/imports/targets', '/integrations',
];

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Refuse to run against somebody else's server. Otherwise a leftover process
// answers /health from a database this script never seeded, and the failure
// reads as "no such table: users" — which looks like a schema bug and is not.
try {
  await fetch(`${BASE}/health`, { signal: AbortSignal.timeout(1500) });
  console.error(`Port ${PORT} is already serving. Stop it, or set ENDPOINT_CHECK_PORT.`);
  process.exit(1);
} catch { /* nothing there, which is what we want */ }

let child;
try {
  child = spawn(process.execPath, ['server.js'], {
    env: { ...process.env, PORT: String(PORT), DB_PATH: dbPath, NODE_ENV: 'test' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const out = [];
  child.stdout.on('data', d => out.push(d.toString()));
  child.stderr.on('data', d => out.push(d.toString()));

  let up = false;
  for (let i = 0; i < 180 && !up; i++) {
    try { up = (await fetch(`${BASE}/health`)).ok; } catch { /* not up yet */ }
    if (!up) await sleep(500);
  }
  if (!up) {
    console.error('server never came up:\n' + out.join('').split('\n').slice(-30).join('\n'));
    process.exit(1);
  }

  // Give the seeded Admin a password so this can sign in like a person does.
  const db = new Database(dbPath);
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = `${salt}:${crypto.scryptSync('endpoint-check-pw', salt, 64).toString('hex')}`;
  const admin = db.prepare("SELECT name FROM users WHERE role = 'admin' LIMIT 1").get();
  if (!admin) { console.error('no admin account in a seeded database'); process.exit(1); }
  db.prepare("UPDATE users SET password_hash = ?, password_changed_at = datetime('now') WHERE name = ?")
    .run(hash, admin.name);
  db.close();

  const login = await (await fetch(`${BASE}/users/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: admin.name, password: 'endpoint-check-pw' }),
  })).json();
  if (!login.token) { console.error('could not sign in: ' + JSON.stringify(login)); process.exit(1); }

  const bad = [];
  for (const p of PATHS) {
    let status = 0, detail = '';
    try {
      const r = await fetch(BASE + p, { headers: { Authorization: `Bearer ${login.token}` } });
      status = r.status;
      if (status >= 400) detail = (await r.text()).slice(0, 200);
    } catch (e) {
      detail = e.message;
    }
    // 503 is a feature that is switched off (no R2, no AI key), which is the
    // documented graceful-degradation answer and not a fault.
    if (status === 200 || status === 503) continue;
    bad.push(`${p} → ${status || 'threw'} ${detail}`);
  }

  if (bad.length) {
    console.error(`\n${bad.length} endpoint(s) a screen opens on are failing:`);
    for (const b of bad) console.error('  ✗ ' + b);
    process.exit(1);
  }
  console.log(`All ${PATHS.length} list endpoints answered.`);
} finally {
  try { child?.kill('SIGTERM'); } catch { /* already gone */ }
  await sleep(800);
  try { child?.kill('SIGKILL'); } catch { /* already gone */ }
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
}
