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
  ['verify-supplier-storage.mjs', 4962, {}, true],
  ['verify-signatures.mjs', 4963],
  ['verify-mobile-cards.mjs', 4964],
  ['verify-image-viewer.mjs', 4965, {}, true],
  ['verify-sensory-ui.mjs', 4966],
  // Two older scripts carry their own port.
  ['verify-suppliers.mjs', 4841],
  ['verify-kiosk-isolation.mjs', 4967, { BASE: 'http://localhost:4967/api' }],
];

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
for (const [script, port, extra = {}, needsS3 = false] of RUNS) {
  if (!existsSync(join(ROOT, 'scripts', script))) { results.push([script, 'missing']); continue; }
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
    const { code, out } = await run('node', [`scripts/${script}`], env);
    const m = /(\d+)\/(\d+) assertions passed|(\d+) passed, (\d+) failed|(\d+) PASS \/ (\d+) FAIL/.exec(out);
    line = `${code === 0 ? 'ok ' : 'FAIL'} ${m ? m[0] : `exit ${code}`}`;
    if (code !== 0) line += '\n' + out.split('\n').filter(l => /✗|Error|error/.test(l)).slice(0, 8).map(l => '      ' + l).join('\n');
  }
  server.kill('SIGTERM');
  await wait(600);
  results.push([script, line]);
  console.log(`${line.startsWith('ok') ? '  ✓' : '  ✗'} ${script.padEnd(32)} ${line}`);
}
if (s3) s3.kill();
const failed = results.filter(([, l]) => !l.startsWith('ok'));
console.log(`\n${results.length - failed.length}/${results.length} verifies green`);
process.exit(failed.length ? 1 : 0);
