// Every live verify, in one run — each on a fresh database against a real
// server, with the stand-ins it needs. The pure checks are `npm run check`;
// this is the other half of the foundation.
import { spawn } from 'child_process';
import { existsSync, unlinkSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const ROOT = process.cwd();
const TMP = process.env.VERIFY_TMP || tmpdir();
const S3_PORT = 9099;

// [script, port, extra env, needsS3]
const RUNS = [
  ['verify-atp-task-door.mjs', 4951],
  ['verify-qms-signature.mjs', 4952],
  ['verify-qms-module-gate.mjs', 4953],
  ['verify-completion-doors.mjs', 4954],
  ['verify-knife-mirror.mjs', 4955],
  ['verify-production-mirror.mjs', 4956],
  ['verify-document-withdraw.mjs', 4957],
  ['verify-review-cadence.mjs', 4958],
  ['verify-write-doors.mjs', 4959],
  ['verify-sensory-v2.mjs', 4960],
  ['verify-artwork-sync.mjs', 4961, { PRODUCT_MASTER_TOKEN: 'proof-token' }],
  ['verify-nfp-panel.mjs', 5016, { PRODUCT_MASTER_TOKEN: 'proof-token' }],
  ['verify-product-colors.mjs', 5018, { PRODUCT_MASTER_TOKEN: 'proof-token' }],
  ['verify-product-colors-ui.mjs', 5020],
  ['verify-nfp-panel-ui.mjs', 5017, { PRODUCT_MASTER_TOKEN: 'proof-token' }],
  ['verify-supplier-storage.mjs', 4962, {}, true],
  ['verify-signatures.mjs', 4963],
  ['verify-mobile-cards.mjs', 4964],
  ['verify-image-viewer.mjs', 4965, {}, true],
  ['verify-people-files.mjs', 4968, {}, true],
  ['verify-reimbursements.mjs', 4975, {}, true],
  ['verify-preventive-controls.mjs', 4976],
  ['verify-pm-pause.mjs', 4977],
  ['verify-pay-actions.mjs', 4978],
  ['verify-supplier-questionnaire.mjs', 4979, {}, true],
  ['verify-form-renumber.mjs', 4981, {}, false],
  ['verify-check-records.mjs', 4982, {}, false],
  ['verify-stability.mjs', 4983, {}, false],
  ['verify-change-register.mjs', 4984, { GIT_SHA: 'abc123def456' }, false],
  ['verify-spec-gate.mjs', 4985, {}, false],
  ['verify-equipment-qual.mjs', 4986, {}, true],
  ['verify-pay-roster.mjs', 4987, { ONBOARDING_ENC_KEY: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef' }, false],
  ['verify-session-revoke.mjs', 4989, {}, false],
  ['verify-ap-drop.mjs', 4990, {}, true],
  ['verify-ap-drop-ui.mjs', 4991, {}, true],
  ['verify-comms-edit.mjs', 4995, {}, false],
  ['verify-comms-pending-jump.mjs', 4999, {}, false],
  ['verify-training-assign.mjs', 5001, {}, false],
  ['verify-supply-lists.mjs', 5014, {}, false],
  ['verify-starter-review.mjs', 5002, {}, false],
  ['verify-forklift-cert.mjs', 5004, {}, false],
  ['verify-hours-roster.mjs', 5005, {}, false],
  ['verify-hours-rates.mjs', 5006, {}, false],
  ['verify-bpg-items.mjs', 5010, {}, false],
  ['verify-recall-flow.mjs', 5022, {}, false],
  ['verify-training-people.mjs', 5012, {}, false],
  ['verify-qa-correction-notify.mjs', 4997, {}, false],
  ['verify-cleanup-digest.mjs', 4998, {}, false],
  ['verify-eod-chase.mjs', 4996, {}, false],
  ['verify-readybot-audience.mjs', 4994, {}, false],
  ['verify-client-channel.mjs', 4996, {}, true],
  ['verify-client-invite.mjs', 4988, {}, false],
  ['verify-sku-rename.mjs', 4998, {}, false],
  ['verify-schedule-owner.mjs', 4997, {}, false],
  ['verify-employee-docs.mjs', 4993, {}, true],
  ['verify-employee-docs-ui.mjs', 4994, {}, true],
  ['verify-name-keys.mjs', 4992, {}, false],
  ['verify-shipping.mjs', 4969, {}, true],
  ['verify-warehouse-ui.mjs', 4970, {}, true],
  // With the key, so the encrypted path is the one exercised in the full run.
  ['verify-onboarding.mjs', 4971, { ONBOARDING_ENC_KEY: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef' }, true],
  ['verify-onboarding-ui.mjs', 4972, { ONBOARDING_ENC_KEY: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef' }, true],
  ['verify-sensory-ui.mjs', 4966],
  // Two older scripts carry their own port.
  // Chained: one fresh server, three scripts in order. The API script imports
  // the register the two browser scripts then read; each alone is vacuous.
  [['verify-suppliers.mjs', 'verify-suppliers-screen.mjs', 'verify-supplier-queue.mjs'], 4841, { APP: 'http://localhost:4841' }, true],
  ['verify-kiosk-isolation.mjs', 4967, { BASE: 'http://localhost:4967/api' }],
  ['verify-cal-summary.mjs', 4991, {}],
  ['verify-annual-reviews.mjs', 4993, {}],
  ['verify-doc-attach.mjs', 4992, {}, true],
  ['verify-training-media.mjs', 5024, {}, true],
  ['verify-scale-due.mjs', 5026, {}, false],
  ['verify-sanitation-areas.mjs', 4905, {}, false],
  // The sixteen that had been written, passed by hand, and never put here (D-120).
  ['verify-auth.mjs', 5031, { BASE: 'http://localhost:5031/api' }, false],
  ['verify-backdated-recurrence.mjs', 5032, {}, false],
  ['verify-composer-caret.mjs', 5033, {}, false],
  [['verify-doc-worklist.mjs', 'verify-doc-worklist-screen.mjs'], 5034, { APP: 'http://localhost:5034' }, false],
  ['verify-duplicate-readings.mjs', 5035, {}, false],
  ['verify-product-readiness.mjs', 5036, {}, false],
  ['verify-product-tabs.mjs', 5037, {}, false],
  ['verify-reaction-tooltip.mjs', 5038, {}, false],
  ['verify-supply-receiving.mjs', 5040, {}, false],
  [['verify-swab-stock.mjs', 'verify-swab-ui.mjs'], 5041, {}, false],
  ['verify-reachability.mjs', 5042, {}, false],
  ['verify-truck-checklist.mjs', 5043, { APP: 'http://localhost:5043' }],
  ['verify-default-access.mjs', 5044, { APP: 'http://localhost:5044' }],
  ['verify-preop-record.mjs', 5045, { APP: 'http://localhost:5045' }],
  // The proofing service's token, on all five routes it calls (D-126). A base64-shaped secret on purpose.
  ['verify-proof-token.mjs', 5046, { PRODUCT_MASTER_TOKEN: 'pr00f+tok/en=ab' }],
  ['verify-panel-provenance.mjs', 5047, { PRODUCT_MASTER_TOKEN: 'prov-token' }],
];

// VERIFY_ONLY=verify-auth.mjs,verify-swab-stock.mjs runs just the entries that
// name one of those scripts — for checking one change without the whole hour.
const ONLY = (process.env.VERIFY_ONLY || '').split(',').map(s => s.trim()).filter(Boolean);
const SELECTED = ONLY.length
  ? RUNS.filter(([script]) => (Array.isArray(script) ? script : [script]).some(s => ONLY.includes(s)))
  : RUNS;

const wait = (ms) => new Promise(r => setTimeout(r, ms));
async function ready(port) {
  for (let i = 0; i < 90; i++) {
    try { const r = await fetch(`http://localhost:${port}/api/users/lookup?q=zz`); if (r.status < 500) return true; } catch { /* not yet */ }
    await wait(1000);
  }
  return false;
}
function run(cmd, args, env, opts = {}) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd: ROOT, env: { ...process.env, ...env }, stdio: opts.quiet ? 'ignore' : ['ignore', 'pipe', 'pipe'] });
    let out = '';
    if (!opts.quiet) { child.stdout.on('data', d => { out += d; }); child.stderr.on('data', d => { out += d; }); }
    child.on('exit', code => resolve({ code, out }));
    if (opts.handle) opts.handle(child);
  });
}

let s3 = null;
const results = [];
for (const [entry, port, extra = {}, needsS3 = false] of SELECTED) {
  // An entry may be one script or a LIST run in order on the same boot — the
  // API script that files the data, then the browser script that reads it.
  const scripts = Array.isArray(entry) ? entry : [entry];
  const script = scripts.join(' → ');
  const absent = scripts.find(s => !existsSync(join(ROOT, 'scripts', s)));
  if (absent) { results.push([script, `missing ${absent}`]); continue; }
  const db = join(TMP, `verify-all-${port}.db`);
  for (const f of [db, `${db}-wal`, `${db}-shm`]) if (existsSync(f)) unlinkSync(f);
  const env = { DB_PATH: db, DBPATH: db, PORT: String(port), NODE_ENV: 'test', APP_BASE_URL: `http://localhost:${port}`, ...extra };
  if (needsS3) {
    if (!s3) { s3 = spawn('node', ['scripts/s3-stand-in.mjs'], { cwd: ROOT, env: { ...process.env, PORT: String(S3_PORT) }, stdio: 'ignore' }); await wait(800); }
    Object.assign(env, { R2_ENDPOINT: `http://localhost:${S3_PORT}`, R2_ACCOUNT_ID: 'x', R2_ACCESS_KEY_ID: 'x', R2_SECRET_ACCESS_KEY: 'x', R2_BUCKET: 'test' });
  }
  const server = spawn('node', ['server.js'], { cwd: ROOT, env: { ...process.env, ...env }, stdio: 'ignore' });
  const up = await ready(port);
  let line;
  if (!up) line = 'server did not come up';
  else {
    const parts = [];
    for (const s of scripts) {
      const { code, out } = await run('node', [`scripts/${s}`], env);
      const m = /(\d+)\/(\d+) assertions passed|(\d+) passed, (\d+) failed|(\d+) PASS \/ (\d+) FAIL/.exec(out);
      let part = `${code === 0 ? 'ok ' : 'FAIL'} ${m ? m[0] : `exit ${code}`}`;
      if (code !== 0) part += '\n' + out.split('\n').filter(l => /✗|Error|error/.test(l)).slice(0, 8).map(l => '      ' + l).join('\n');
      parts.push(part);
      if (code !== 0) break;   // a chained script reads what the one before it filed
    }
    line = parts.length === 1 ? parts[0]
      : `${parts.every(p => p.startsWith('ok')) ? 'ok ' : 'FAIL'} ${parts.map(p => p.split('\n')[0].replace(/^(ok |FAIL) /, '')).join(' · ')}`
        + parts.filter(p => p.includes('\n')).map(p => '\n' + p.split('\n').slice(1).join('\n')).join('');
  }
  server.kill('SIGTERM');
  await wait(600);
  results.push([script, line]);
  console.log(`${line.startsWith('ok') ? '  ✓' : '  ✗'} ${script.padEnd(40)} ${line}`);
}
if (s3) s3.kill();
const failed = results.filter(([, l]) => !l.startsWith('ok'));
console.log(`\n${results.length - failed.length}/${results.length} verifies green`);
process.exit(failed.length ? 1 : 0);
