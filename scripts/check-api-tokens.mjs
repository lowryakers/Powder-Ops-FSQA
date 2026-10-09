#!/usr/bin/env node
// check:apitokens — the bot API token door (D-161), pure + live.
//
// PURE: the scope allow-list holds no approve/admin scope; every route the
// server mounts that NAMES an approval is refused to a token (read from the
// source, so a route added tomorrow is checked tomorrow); the routes named in
// the pack are each covered.
// LIVE (its own server on a fresh database): hash-only storage, scopes,
// default-deny writes, the approve guard against every approve route with a
// token AND a session, revoke / expiry / inactive / promoted-to-admin, X-View-As
// ignored, an audit row per call, and the rate limit.
import { spawn } from 'child_process';
import { mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import Database from 'better-sqlite3';
import { SCOPES, FORBIDDEN_SCOPES, normalizeScopes } from '../server/api-tokens.js';
import { approveRouteFor, APPROVE_SEGMENTS } from '../server/middleware/no-token-approve.js';
import { isPublicPath } from '../server/middleware/auth.js';
import { scanRoutes, concretePath, namesApproval } from './lib/route-scan.mjs';

let pass = 0, fail = 0;
const t = (n, ok, d = '') => { if (ok) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n}${d ? ' — ' + d : ''}`); } };
const fakeReq = (method, apiPath, body = {}) => ({ method, path: apiPath.replace(/^\/api/, ''), body, headers: {} });

console.log('\n── scopes ──');
t('SCOPES is exactly read + write-drafts', JSON.stringify(SCOPES) === JSON.stringify(['read', 'write-drafts']), JSON.stringify(SCOPES));
t('no forbidden scope (approve/admin/sign/release/write) is in SCOPES', !SCOPES.some(s => FORBIDDEN_SCOPES.includes(s)));
for (const bad of ['approve', 'admin']) {
  let threw = false; try { normalizeScopes(['read', bad]); } catch { threw = true; }
  t(`normalizeScopes refuses "${bad}"`, threw);
}
t('read is always on', JSON.stringify(normalizeScopes([])) === '["read"]');

console.log('\n── every approve-named route is guarded (read from the source) ──');
const routes = scanRoutes();
t('the route scan found the server\'s routes', routes.length > 300, String(routes.length));
const approveNamed = routes.filter(r => namesApproval(r.path) && !isPublicPath(fakeReq(r.method, r.path)));
const uncovered = approveNamed.filter(r => !approveRouteFor(fakeReq(r.method, concretePath(r.path), { status: 'approved' })));
t(`all ${approveNamed.length} approve-named, token-reachable routes are in APPROVE_ROUTES`, uncovered.length === 0,
  uncovered.map(r => `${r.method} ${r.path} (${r.file})`).join('; '));

// The routes the pack named, including the ones whose path does not say so.
const PACK = [
  ['POST', '/api/nfp/x/decide'], ['POST', '/api/nfp/x/send'], ['POST', '/api/nfp/batch/send'],
  ['POST', '/api/nfp', { source: 'paper', approved_by: 'X', approved_at: '2026-01-01' }],
  ['POST', '/api/artwork/versions/x/status', { status: 'approved' }],
  ['POST', '/api/artwork/versions/x/status', { status: 'print_ready' }],
  ['POST', '/api/qa-review/sign'], ['POST', '/api/documents/x/sign'], ['POST', '/api/employee-documents/x/sign'],
  ['POST', '/api/coa/specifications/drafts/approve'], ['PUT', '/api/coa/release-gate'], ['POST', '/api/coa/requests/x/sign'],
  ['POST', '/api/qms/sensory-specs/x/approve'], ['POST', '/api/qms/deviation/x/approve'], ['POST', '/api/qms/deviation/bulk-approve'],
  ['POST', '/api/meetings/x/approve'], ['PUT', '/api/hygienic-design/x/approve'], ['PUT', '/api/loto/executions/x/release'],
  ['POST', '/api/mock-recalls/x/approve'], ['POST', '/api/change-register/x/approve'], ['POST', '/api/controlled/x/approve'],
  ['POST', '/api/disposals/x/approve'], ['POST', '/api/reimbursements/x/approve'], ['POST', '/api/log-builder/drafts/x/approve'],
  ['POST', '/api/production/schedule/x/flavor-approve'], ['POST', '/api/users/me/signature'],
  ['POST', '/api/qms/flavor_approval/x/send'], ['POST', '/api/qms/flavor_approval/x/sensory'],
];
const packMissing = PACK.filter(([m, p, b]) => !approveRouteFor(fakeReq(m, p, b || {})));
t(`all ${PACK.length} routes named in the pack are guarded`, packMissing.length === 0, packMissing.map(x => x.join(' ')).join('; '));
t('a draft artwork status move is NOT an approval', !approveRouteFor(fakeReq('POST', '/api/artwork/versions/x/status', { status: 'in_review' })));
t('an ordinary NFP draft create is NOT an approval', !approveRouteFor(fakeReq('POST', '/api/nfp', { sku: 'X', version: 'V1' })));
t('a visitor sign-out is NOT an approval', !approveRouteFor(fakeReq('POST', '/api/visitors/visits/x/sign-out')));
t('GET is never an approval', !approveRouteFor(fakeReq('GET', '/api/qms/deviation/x/approve')));
t('the segment list names approve, sign, verify and release', ['approve', 'sign', 'verify', 'release'].every(s => APPROVE_SEGMENTS.includes(s)));

// ── live ──────────────────────────────────────────────────────────────────────
const PORT = Number(process.env.APITOKEN_CHECK_PORT || 5081);
const URL = `http://127.0.0.1:${PORT}`;
const dir = mkdtempSync(join(tmpdir(), 'readydoc-apitok-'));
const DBP = join(dir, 'apitok.db');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const server = spawn(process.execPath, ['server.js'], {
  env: { ...process.env, PORT: String(PORT), DB_PATH: DBP, NODE_ENV: 'test', API_TOKEN_RPM: '60', API_TOKEN_WRITE_RPM: '400' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let bootLog = '';
server.stdout.on('data', d => { bootLog += d; }); server.stderr.on('data', d => { bootLog += d; });
const done = (code) => { try { server.kill('SIGKILL'); } catch { /* gone */ } try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ } process.exit(code); };
let up = false;
for (let i = 0; i < 180 && !up; i++) { try { up = (await fetch(`${URL}/api/health`)).ok; } catch { /* not yet */ } if (!up) await sleep(500); }
if (!up) { console.log(bootLog.split('\n').slice(-30).join('\n')); t('the server came up', false); done(1); }

const db = new Database(DBP);
const mk = (id, name, role, dept, ma) => db.prepare(`INSERT OR REPLACE INTO users (id,name,username,role,department,is_active,setup_code,setup_code_expires_at,module_access)
  VALUES (?,?,?,?,?,1,?,datetime('now','+7 day'),?)`).run(id, name, name, role, dept, `SC-${id}`, ma ? JSON.stringify(ma) : null);
mk('tk-admin', 'Token Admin', 'admin', 'office', null);
mk('tk-bot', 'Proof Bot', 'supervisor', 'qa', { products: 'edit', artwork: 'edit', coa: 'edit', meetings: 'edit' });
mk('tk-other', 'Other Person', 'operator', 'warehouse', { products: 'view' });
mk('tk-boss', 'Second Admin', 'admin', 'office', null);
const sku = db.prepare('SELECT sku FROM products ORDER BY sku LIMIT 1').get()?.sku;

const call = async (method, path, body, auth, headers = {}) => {
  const r = await fetch(`${URL}/api${path}`, { method, headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: `Bearer ${auth}` } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
  let j = null; try { j = await r.json(); } catch { /* empty */ }
  return { status: r.status, body: j, headers: r.headers };
};
const signIn = async (name, id) => {
  await call('POST', '/users/login', { name });
  await call('POST', '/users/set-password', { user_id: id, password: 'Tok3nCheck!!', setup_code: `SC-${id}` });
  return (await call('POST', '/users/login', { name, password: 'Tok3nCheck!!' })).body?.token;
};
const admin = await signIn('Token Admin', 'tk-admin');
const botSession = await signIn('Proof Bot', 'tk-bot');
t('admin and the bot account have sessions', !!admin && !!botSession);

console.log('\n── minting ──');
let r = await call('POST', '/api-tokens', { user_id: 'tk-boss', label: 'Bad idea', scopes: ['read'] }, admin);
t('a token for an ADMIN account is refused, in words', r.status === 400 && /admin/i.test(r.body?.error || ''), JSON.stringify(r.body));
r = await call('POST', '/api-tokens', { user_id: 'tk-bot', label: 'Approver bot', scopes: ['read', 'approve'] }, admin);
t('an "approve" scope is refused at the API', r.status === 400, JSON.stringify(r.body));
r = await call('POST', '/api-tokens', { user_id: 'tk-bot', label: 'Reader bot', scopes: ['read'] }, admin);
const readTok = r.body?.plaintext, readId = r.body?.token?.id;
t('a read token is minted and its clear text returned once', r.status === 201 && /^rdk_[A-Za-z0-9_-]{43}$/.test(readTok || ''), JSON.stringify(r.body).slice(0, 160));
r = await call('POST', '/api-tokens', { user_id: 'tk-bot', label: 'Draft bot', scopes: ['read', 'write-drafts'] }, admin);
const draftTok = r.body?.plaintext, draftId = r.body?.token?.id;
t('a write-drafts token is minted', r.status === 201 && JSON.stringify(r.body?.token?.scopes) === '["read","write-drafts"]');
const row = db.prepare('SELECT * FROM api_tokens WHERE id = ?').get(readId);
t('the row stores the hash and the 8-character prefix, never the token', row && row.token_prefix === readTok.slice(0, 8) && row.token_hash.length === 64 && row.token_hash !== readTok);
db.pragma('wal_checkpoint(FULL)');
const raw = readFileSync(DBP).toString('latin1');
t('the clear text appears nowhere in the database file', !raw.includes(readTok) && !raw.includes(draftTok));
r = await call('GET', '/api-tokens', null, admin);
t('the list carries no hash and names the account', r.status === 200 && r.body.tokens.every(x => !('token_hash' in x)) && r.body.tokens.some(x => x.user_name === 'Proof Bot'));
r = await call('GET', '/api-tokens', null, botSession);
t('a non-admin session cannot reach token management', r.status === 403);

console.log('\n── reads and default-deny writes ──');
r = await call('GET', '/products', null, readTok);
t('a read token GETs /api/products as its account', r.status === 200, String(r.status));
r = await call('POST', '/products', { sku: 'WHY-PLG-ZZZ' }, readTok);
t('the same token POSTing /api/products → 403 token_scope', r.status === 403 && r.body?.error === 'token_scope', JSON.stringify(r.body));
r = await call('POST', '/products', { sku: 'WHY-PLG-ZZZ' }, draftTok);
t('a write-drafts token is refused there too (not on the allow-list)', r.status === 403 && r.body?.error === 'token_scope');
r = await call('POST', '/nfp', { sku, version: 'BOT-V1' }, readTok);
t('a read token cannot file a draft panel', r.status === 403 && r.body?.error === 'token_scope');
r = await call('POST', '/nfp', { sku, version: 'BOT-V1' }, draftTok);
const nfpId = r.body?.id;
t('a write-drafts token files a DRAFT panel', r.status === 201 && r.body?.status === 'draft', JSON.stringify(r.body).slice(0, 160));
r = await call('PUT', `/nfp/${nfpId}`, { change_summary: 'bot draft' }, draftTok);
t('…and edits it while it is a draft', r.status === 200, JSON.stringify(r.body).slice(0, 120));
db.prepare("UPDATE nfp_versions SET status = 'sent' WHERE id = ?").run(nfpId);
r = await call('PUT', `/nfp/${nfpId}`, { change_summary: 'after send' }, draftTok);
t('…but not once it has left draft (token_scope)', r.status === 403 && r.body?.error === 'token_scope');
r = await call('POST', '/nfp', { sku, version: 'BOT-PAPER', source: 'paper', approved_by: 'Bot', approved_at: '2026-01-01' }, draftTok);
t('a "paper" panel (filed APPROVED) is refused as an approval', r.status === 403 && r.body?.error === 'approve_requires_human_session', JSON.stringify(r.body));
const created = db.prepare("SELECT details FROM audit_log WHERE entity_type = 'nfp' AND entity_id = ?").get(nfpId);
t('the handler\'s own audit entry names the token', /"via_token":\{"id":"[^"]+","prefix":"rdk_/.test(created?.details || ''), created?.details);

console.log('\n── the approve guard, every route, token vs session ──');
const live = [
  ...approveNamed.map(x => [x.method, x.path.replace(/^\/api/, '')]),
  ...PACK.map(([m, p, b]) => [m, p.replace(/^\/api/, ''), b]),
];
const seen = new Set();
let tokenBlocked = 0, sessionThrough = 0, total = 0;
const leaks = [], sessionBlocked = [];
for (const [m, p, b] of live) {
  const path = concretePath(p);
  const key = `${m} ${path} ${JSON.stringify(b || {})}`;
  if (seen.has(key)) continue; seen.add(key); total++;
  const body = b || { status: 'approved' };
  const viaTok = await call(m, path, body, draftTok);
  if (viaTok.status === 403 && viaTok.body?.error === 'approve_requires_human_session') tokenBlocked++; else leaks.push(`${m} ${path} → ${viaTok.status}`);
  const viaSess = await call(m, path, body, botSession);
  if (viaSess.body?.error !== 'approve_requires_human_session') sessionThrough++; else sessionBlocked.push(`${m} ${path}`);
}
t(`every one of ${total} approve routes refuses a token with approve_requires_human_session`, tokenBlocked === total, leaks.join('; '));
t('…and a SESSION for the same account is never refused by the guard', sessionThrough === total, sessionBlocked.join('; '));
const blocked = db.prepare("SELECT COUNT(*) c FROM audit_log WHERE action LIKE '%approve_blocked%' OR action = 'api_token_approve_blocked'").get().c;
t('each refusal is in the audit log', blocked >= total, `${blocked} of ${total}`);

console.log('\n── identity, audit, lifecycle ──');
r = await call('GET', '/users/me', null, readTok, { 'X-View-As': 'tk-other' });
t('X-View-As is ignored for a token (still the bot\'s own account)', r.status === 200 && (r.body?.id === 'tk-bot' || r.body?.user?.id === 'tk-bot'), JSON.stringify(r.body).slice(0, 120));
await sleep(200);
const calls = db.prepare("SELECT details, actor FROM audit_log WHERE action = 'api_token_call' AND entity_id = ?").all(readId);
t('one audit row per token call (4 calls → 4 rows) as the account, naming the token', calls.length === 4 && calls.every(c => c.actor === 'Proof Bot' && /"tokenId":/.test(c.details)), `${calls.length} rows`);
t('last_used_at is stamped', !!db.prepare('SELECT last_used_at FROM api_tokens WHERE id = ?').get(readId)?.last_used_at);
r = await call('POST', `/api-tokens/${draftId}/revoke`, {}, admin);
t('revoke', r.status === 200 && r.body?.state === 'revoked');
r = await call('GET', '/products', null, draftTok);
t('a revoked token gets 401', r.status === 401);
r = await call('POST', '/api-tokens', { user_id: 'tk-bot', label: 'Short lived', scopes: ['read'] }, admin);
const expTok = r.body?.plaintext;
db.prepare("UPDATE api_tokens SET expires_at = '2020-01-01T00:00:00.000Z' WHERE id = ?").run(r.body?.token?.id);
t('an expired token gets 401', (await call('GET', '/products', null, expTok)).status === 401);
r = await call('POST', '/api-tokens', { user_id: 'tk-other', label: 'Other reader', scopes: ['read'] }, admin);
const otherTok = r.body?.plaintext;
t('a token for another account works before…', (await call('GET', '/users/me', null, otherTok)).status === 200);
db.prepare("UPDATE users SET role = 'admin' WHERE id = 'tk-other'").run();
t('…and is refused once that account is promoted to admin', (await call('GET', '/users/me', null, otherTok)).status === 401);
db.prepare("UPDATE users SET role = 'operator', is_active = 0 WHERE id = 'tk-other'").run();
t('…and while the account is deactivated', (await call('GET', '/users/me', null, otherTok)).status === 401);
t('a made-up rdk_ token gets 401', (await call('GET', '/products', null, 'rdk_' + 'A'.repeat(43))).status === 401);

console.log('\n── rate limit ──');
r = await call('POST', '/api-tokens', { user_id: 'tk-bot', label: 'Busy bot', scopes: ['read'] }, admin);
const busyTok = r.body?.plaintext;
let got429 = null;
for (let i = 0; i < 70 && !got429; i++) {
  const x = await call('GET', '/users/me', null, busyTok);
  if (x.status === 429) got429 = x;
}
t('past API_TOKEN_RPM a token gets 429 with Retry-After', !!got429 && Number(got429.headers.get('retry-after')) > 0 && got429.body?.error === 'rate_limited');
t('another token is not affected', (await call('GET', '/users/me', null, readTok)).status === 200);

db.close();
console.log(`\n${pass} PASS / ${fail} FAIL`);
done(fail ? 1 : 0);
