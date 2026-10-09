#!/usr/bin/env node
// check:apitokens — the bot API token door (D-161, D-164), pure + live.
//
// PURE: SCOPES is read + write and holds nothing forbidden; write-drafts maps
// to write; every route the server mounts that NAMES an approval is refused to
// a token; every DELETE, every delete-named write and every user / token admin
// route is in TOKEN_DENY (read from the source, so a route added tomorrow is
// checked tomorrow); every non-GET route lands in exactly one bucket — denied
// by category, on WRITE_AREAS, public, or default-denied — and no WRITE_AREAS
// entry is dead or overlaps a deny entry.
// LIVE (its own server on a fresh database, an S3 stand-in for the uploads):
// hash-only storage, a pass/fail pair per write area (the token for an account
// with edit succeeds; the token for an account without it fails on the
// account's own access, NOT on token_scope), read tokens refused everywhere,
// each deny category refused with the record unchanged while a session for the
// same account still reaches the handler, the approve guard against every
// approve route, the bulk rate bucket, revoke / expiry / inactive / promoted,
// X-View-As ignored, an audit row per call, the rate limit, and the
// write-drafts → write migration across two reboots.
import { spawn } from 'child_process';
import { mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import Database from 'better-sqlite3';
import { SCOPES, FORBIDDEN_SCOPES, normalizeScopes, rateKindOf } from '../server/api-tokens.js';
import { approveRouteFor, APPROVE_SEGMENTS, tokenDenyFor, DELETE_SEGMENTS } from '../server/middleware/no-token-approve.js';
import { WRITE_AREAS, writeAreaFor } from '../server/bot-api.js';
import { isPublicPath } from '../server/middleware/auth.js';
import { scanRoutes, concretePath, namesApproval } from './lib/route-scan.mjs';

let pass = 0, fail = 0;
const t = (n, ok, d = '') => { if (ok) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n}${d ? ' — ' + d : ''}`); } };
const fakeReq = (method, apiPath, body = {}) => ({ method, path: apiPath.replace(/^\/api/, ''), body, headers: {} });

console.log('\n── scopes ──');
t('SCOPES is exactly read + write', JSON.stringify(SCOPES) === JSON.stringify(['read', 'write']), JSON.stringify(SCOPES));
const mustForbid = ['approve', 'admin', 'sign', 'release', 'write-drafts', 'delete', 'settle', 'verify', 'token-admin', 'user-admin'];
t('FORBIDDEN_SCOPES names approve/admin/sign/release/write-drafts/delete/settle/verify/token-admin/user-admin', mustForbid.every(x => FORBIDDEN_SCOPES.includes(x)), FORBIDDEN_SCOPES.join(','));
t('no forbidden scope is in SCOPES', !SCOPES.some(s => FORBIDDEN_SCOPES.includes(s)));
for (const bad of ['approve', 'admin', 'delete', 'settle', 'verify', 'token-admin']) {
  let threw = false; try { normalizeScopes(['read', bad]); } catch { threw = true; }
  t(`normalizeScopes refuses "${bad}"`, threw);
}
t('read is always on', JSON.stringify(normalizeScopes([])) === '["read"]');
t('legacy "write-drafts" input maps to write', JSON.stringify(normalizeScopes(['write-drafts'])) === '["read","write"]');

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

console.log('\n── every delete / user-admin / token-admin route is denied (read from the source) ──');
const reachable = routes.filter(r => !isPublicPath(fakeReq(r.method, r.path)));
const deleteRoutes = reachable.filter(r => r.method === 'DELETE');
const delNamed = reachable.filter(r => r.method !== 'DELETE' && r.path.split('/').some(seg => DELETE_SEGMENTS.includes(seg.toLowerCase())));
const adminRoutes = reachable.filter(r => /^\/api\/(users|kiosk-tokens|api-tokens)(\/|$)/.test(r.path));
const deniedAs = (r, cat) => tokenDenyFor(fakeReq(r.method, concretePath(r.path)))?.category === cat;
const missDel = deleteRoutes.filter(r => !deniedAs(r, 'delete'));
t(`all ${deleteRoutes.length} DELETE routes are in TOKEN_DENY (delete)`, deleteRoutes.length > 50 && missDel.length === 0, missDel.map(r => `${r.file}:${r.method} ${r.path}`).join('; '));
const missNamed = delNamed.filter(r => !deniedAs(r, 'delete'));
t(`all ${delNamed.length} delete-named writes (void, archive, revoke, bulk-delete…) are in TOKEN_DENY (delete)`, delNamed.length > 10 && missNamed.length === 0, missNamed.map(r => `${r.file}:${r.method} ${r.path}`).join('; '));
const missAdmin = adminRoutes.filter(r => !tokenDenyFor(fakeReq(r.method, concretePath(r.path))));
t(`all ${adminRoutes.length} user / kiosk-key / token admin writes are in TOKEN_DENY`, adminRoutes.length > 10 && missAdmin.length === 0, missAdmin.map(r => `${r.file}:${r.method} ${r.path}`).join('; '));
t('GET /api/api-tokens and GET /api/kiosk-tokens are denied too (token_admin)',
  tokenDenyFor(fakeReq('GET', '/api/api-tokens'))?.category === 'token_admin' && tokenDenyFor(fakeReq('GET', '/api/kiosk-tokens'))?.category === 'token_admin');
t('GET /api/users (a read) is not denied', !tokenDenyFor(fakeReq('GET', '/api/users')));
const AMBIG = [
  ['POST', '/api/products/x/confirm/shopify', {}, 'decision'],
  ['POST', '/api/ap-drop/x/status', { status: 'paid' }, 'decision'],
  ['POST', '/api/ap-drop/x/status', { status: 'in_qbo' }, 'decision'],
  ['POST', '/api/ap-drop/x/status', { status: 'not_finance' }, 'decision'],
  ['POST', '/api/artwork/checks/x/dismiss', {}, 'decision'],
  ['POST', '/api/artwork/versions/x/status', { status: 'rejected' }, 'decision'],
  ['POST', '/api/partners/documents/x/void', {}, 'delete'],
  ['POST', '/api/partners/documents/x/dispute', {}, 'delete'],
  ['POST', '/api/qms/deviation/bulk-delete', {}, 'delete'],
  ['POST', '/api/cleanup/close', {}, 'decision'],
  ['POST', '/api/onboarding/x/end-access', {}, 'user_admin'],
  ['POST', '/api/partners/x/portal-tokens', {}, 'token_admin'],
];
const ambigMiss = AMBIG.filter(([m, p, b, c]) => tokenDenyFor(fakeReq(m, p, b))?.category !== c);
t(`the ${AMBIG.length} explicit decisions (confirm step, AP status, checks dismiss, void, cleanup…) deny as decided`, ambigMiss.length === 0, ambigMiss.map(x => `${x[0]} ${x[1]}`).join('; '));
t('an AP Drop triage move (needs_info) and an artwork move to in_review are NOT denied',
  !tokenDenyFor(fakeReq('POST', '/api/ap-drop/x/status', { status: 'needs_info' })) && !tokenDenyFor(fakeReq('POST', '/api/artwork/versions/x/status', { status: 'in_review' })));

console.log('\n── completeness: every non-GET route is in exactly one bucket ──');
// Default-deny (D-164): a route that is neither denied by category, nor on
// WRITE_AREAS, nor public is REFUSED to a token (not_open_to_tokens). The
// buckets must not overlap — a WRITE_AREAS route that is also a deny match
// would be an allow-list entry that can never work, or a deny rule that
// quietly is not one.
const okBody = (r) => /\/status$/.test(r.path) ? { status: r.path.includes('artwork') ? 'in_review' : 'needs_info' } : {};
const buckets = { denied: 0, write_areas: 0, public: 0, default_denied: 0 };
const overlap = [];
for (const r of routes) {
  const req = fakeReq(r.method, concretePath(r.path), okBody(r));
  const isPub = isPublicPath(fakeReq(r.method, r.path));
  const isDenied = !!(approveRouteFor(req) || tokenDenyFor(req));
  const inAreas = !!writeAreaFor(req);
  const n = [isPub, isDenied, inAreas].filter(Boolean).length;
  if (isPub) buckets.public++; else if (isDenied) buckets.denied++; else if (inAreas) buckets.write_areas++; else buckets.default_denied++;
  if (n > 1 && !(isPub && !inAreas)) overlap.push(`${r.file}:${r.method} ${r.path}`);
}
console.log(`    ${routes.length} non-GET routes: ${buckets.denied} denied by category · ${buckets.write_areas} on WRITE_AREAS · ${buckets.public} public · ${buckets.default_denied} default-denied`);
t('every non-GET route lands in exactly one bucket (no WRITE_AREAS route is also denied or public)', overlap.length === 0, overlap.join('; '));
t('the buckets add up to the route count', Object.values(buckets).reduce((a, b) => a + b, 0) === routes.length);
const dynamic = { 'PUT /^\\/procurement\\/parts\\/[^/]+$/': /updateRoute\('\/parts\/:id'/.test(readFileSync('server/api/procurement.js', 'utf8')) };
const dead = WRITE_AREAS.filter(a => {
  const k = `${a.method} ${a.re}`;
  if (k in dynamic) return !dynamic[k];
  return !routes.some(r => r.method === a.method && a.re.test(concretePath(r.path).replace(/^\/api/, '')));
});
t(`no WRITE_AREAS entry is dead — each of ${WRITE_AREAS.length} names a route the server mounts`, dead.length === 0, dead.map(a => a.label).join('; '));
t('WRITE_AREAS covers the seven areas', ['products', 'artwork', 'supply-orders', 'ap-drop', 'partner-recon', 'nfp-draft', 'messages'].every(x => WRITE_AREAS.some(a => a.area === x)));
const bulk = ['/api/products/bulk-edit', '/api/products/import/commit', '/api/procurement/scenarios/x/apply'].map(p => rateKindOf(fakeReq('POST', p)))
  .concat(rateKindOf(fakeReq('PUT', '/api/procurement/pos/bulk')));
t('the bulk writes draw on their own rate bucket', bulk.every(k => k === 'bulk') && rateKindOf(fakeReq('PUT', '/api/procurement/pos/x')) === 'write', bulk.join(','));

// ── live ──────────────────────────────────────────────────────────────────────
const PORT = Number(process.env.APITOKEN_CHECK_PORT || 5081);
const URL = `http://127.0.0.1:${PORT}`;
const dir = mkdtempSync(join(tmpdir(), 'readydoc-apitok-'));
const DBP = join(dir, 'apitok.db');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
// An S3 stand-in so the two uploading write areas (artwork files, AP Drop)
// run their real path.
const S3_PORT = Number(process.env.APITOKEN_S3_PORT || 5089);
const s3 = spawn(process.execPath, ['scripts/s3-stand-in.mjs'], { env: { ...process.env, PORT: String(S3_PORT) }, stdio: 'ignore' });
const SERVER_ENV = {
  ...process.env, PORT: String(PORT), DB_PATH: DBP, NODE_ENV: 'test', API_TOKEN_RPM: '60', API_TOKEN_WRITE_RPM: '400', API_TOKEN_BULK_RPM: '3',
  R2_ENDPOINT: `http://127.0.0.1:${S3_PORT}`, R2_ACCOUNT_ID: 'x', R2_ACCESS_KEY_ID: 'x', R2_SECRET_ACCESS_KEY: 'x', R2_BUCKET: 'test',
};
let server = null;
let bootLog = '';
const boot = async () => {
  bootLog = '';
  server = spawn(process.execPath, ['server.js'], { env: SERVER_ENV, stdio: ['ignore', 'pipe', 'pipe'] });
  server.stdout.on('data', d => { bootLog += d; }); server.stderr.on('data', d => { bootLog += d; });
  for (let i = 0; i < 180; i++) { try { if ((await fetch(`${URL}/api/health`)).ok) return true; } catch { /* not yet */ } await sleep(500); }
  return false;
};
const stop = async () => { if (!server) return; const s = server; server = null; await new Promise(r => { s.once('exit', r); s.kill('SIGTERM'); setTimeout(() => { try { s.kill('SIGKILL'); } catch { /* gone */ } }, 5000); }); };
const done = (code) => { try { server?.kill('SIGKILL'); } catch { /* gone */ } try { s3.kill('SIGKILL'); } catch { /* gone */ } try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ } process.exit(code); };
if (!await boot()) { console.log(bootLog.split('\n').slice(-30).join('\n')); t('the server came up', false); done(1); }

const db = new Database(DBP);
const mk = (id, name, role, dept, ma) => db.prepare(`INSERT OR REPLACE INTO users (id,name,username,role,department,is_active,setup_code,setup_code_expires_at,module_access)
  VALUES (?,?,?,?,?,1,?,datetime('now','+7 day'),?)`).run(id, name, name, role, dept, `SC-${id}`, ma ? JSON.stringify(ma) : null);
mk('tk-admin', 'Token Admin', 'admin', 'office', null);
mk('tk-bot', 'Proof Bot', 'supervisor', 'qa', { products: 'edit', artwork: 'edit', coa: 'edit', meetings: 'edit' });
mk('tk-other', 'Other Person', 'operator', 'warehouse', { products: 'view' });
mk('tk-boss', 'Second Admin', 'admin', 'office', null);
// The two accounts each write-area pair runs as: A holds edit on every area and
// is an office supervisor (the catalogue, artwork, the AP queue and partner
// terms are all supervisor/office rules); B is a floor operator with view only.
const AREAS_EDIT = { products: 'edit', artwork: 'edit', procurement: 'edit', 'partner-reconciliation': 'edit', 'ap-drop': 'edit' };
const AREAS_VIEW = { products: 'view', artwork: 'view', procurement: 'view', 'partner-reconciliation': 'view', 'ap-drop': 'view' };
mk('wa', 'Writer A', 'supervisor', 'office', AREAS_EDIT);
mk('wb', 'Writer B', 'operator', 'warehouse', AREAS_VIEW);
mk('wx', 'Guest Writer', 'operator', 'office', null);
db.prepare("UPDATE users SET is_external = 1, external_org = 'M4 Dynamic' WHERE id = 'wx'").run();
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
const sessA = await signIn('Writer A', 'wa');
t('admin and the bot accounts have sessions', !!admin && !!botSession && !!sessA);

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
t('a token asked for as the legacy "write-drafts" is minted as write', r.status === 201 && JSON.stringify(r.body?.token?.scopes) === '["read","write"]', JSON.stringify(r.body?.token?.scopes));
r = await call('POST', '/api-tokens', { user_id: 'tk-bot', label: 'Deleter bot', scopes: ['read', 'delete'] }, admin);
t('a "delete" scope is refused at the API', r.status === 400, JSON.stringify(r.body));
const mint = async (uid, label, scopes) => (await call('POST', '/api-tokens', { user_id: uid, label, scopes }, admin)).body?.plaintext;
const tokA = await mint('wa', 'Writer A bot', ['read', 'write']);
const tokB = await mint('wb', 'Writer B bot', ['read', 'write']);
const tokAread = await mint('wa', 'Writer A reader', ['read']);
const tokX = await mint('wx', 'Guest bot', ['read', 'write']);
t('write tokens for A, B and a guest, and a read token for A', [tokA, tokB, tokAread, tokX].every(Boolean));
const row = db.prepare('SELECT * FROM api_tokens WHERE id = ?').get(readId);
t('the row stores the hash and the 8-character prefix, never the token', row && row.token_prefix === readTok.slice(0, 8) && row.token_hash.length === 64 && row.token_hash !== readTok);
db.pragma('wal_checkpoint(FULL)');
const raw = readFileSync(DBP).toString('latin1');
t('the clear text appears nowhere in the database file', !raw.includes(readTok) && !raw.includes(draftTok));
r = await call('GET', '/api-tokens', null, admin);
t('the list carries no hash and names the account', r.status === 200 && r.body.tokens.every(x => !('token_hash' in x)) && r.body.tokens.some(x => x.user_name === 'Proof Bot'));
r = await call('GET', '/api-tokens', null, botSession);
t('a non-admin session cannot reach token management', r.status === 403);

console.log('\n── reads, and the read-only scope ──');
r = await call('GET', '/products', null, readTok);
t('a read token GETs /api/products as its account', r.status === 200, String(r.status));
r = await call('POST', '/products', { sku: 'WHY-PLG-ZZZ' }, readTok);
t('the same token POSTing /api/products → 403 token_scope "read-only"', r.status === 403 && r.body?.error === 'token_scope' && /read-only/.test(r.body?.message || ''), JSON.stringify(r.body));
r = await call('POST', '/products/x/rename', { new_sku: 'WHY-PLG-YYY' }, draftTok);
t('a write token on a route not on WRITE_AREAS (SKU rename) → 403 token_denied not_open_to_tokens', r.status === 403 && r.body?.error === 'token_denied' && r.body?.category === 'not_open_to_tokens', JSON.stringify(r.body));

// ── fixtures for the write areas ──
const pdf = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');
const multipart = async (path, fields, auth) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  fd.append('files', new Blob([pdf], { type: 'application/pdf' }), 'fixture.pdf');
  const res = await fetch(`${URL}/api${path}`, { method: 'POST', headers: { Authorization: `Bearer ${auth}` }, body: fd });
  let j = null; try { j = await res.json(); } catch { /* empty */ }
  return { status: res.status, body: j };
};
const artV = (await call('POST', '/artwork', { sku, component: 'pouch', version_label: 'TOK-V1' }, sessA)).body;
const artId = artV?.id || db.prepare('SELECT id FROM artwork_versions WHERE sku = ? ORDER BY created_at DESC LIMIT 1').get(sku)?.id;
let partner = db.prepare('SELECT id FROM partner_accounts WHERE is_active = 1 LIMIT 1').get();
if (!partner) { db.prepare("INSERT INTO partner_accounts (id, name, code, terms_days, is_active) VALUES ('tk-p', 'Fixture Partner', 'FP', 30, 1)").run(); partner = { id: 'tk-p' }; }
const channel = db.prepare("SELECT id FROM chat_channels WHERE kind = 'public' AND archived = 0 ORDER BY is_default DESC LIMIT 1").get();
db.prepare('INSERT OR IGNORE INTO chat_channel_members (id, channel_id, user_id) VALUES (?, ?, ?)').run('tk-mem-a', channel.id, 'wa');
db.prepare('DELETE FROM chat_channel_members WHERE channel_id = ? AND user_id = ?').run(channel.id, 'wb');
t('fixtures: an artwork version, a partner, a channel A is in and B is not', !!artId && !!partner?.id && !!channel?.id);

console.log('\n── a pass/fail pair per write area (A has edit; B has view) ──');
const pair = (name, a, b, bOk = (x) => x.status === 403 || x.status === 404) => {
  t(`${name}: A's write token succeeds`, a.status >= 200 && a.status < 300, `${a.status} ${JSON.stringify(a.body).slice(0, 140)}`);
  t(`${name}: B's write token fails on B's own access — not token_scope / token_denied`, bOk(b) && !['token_scope', 'token_denied', 'approve_requires_human_session'].includes(b.body?.error), `${b.status} ${JSON.stringify(b.body).slice(0, 140)}`);
};
const readOnly = (name, x) => t(`${name}: a read token → 403 token_scope`, x.status === 403 && x.body?.error === 'token_scope', `${x.status} ${x.body?.error}`);

let a = await call('PUT', `/products/${encodeURIComponent(sku)}`, { notes: 'set by a write token' }, tokA);
let b = await call('PUT', `/products/${encodeURIComponent(sku)}`, { notes: 'B tries' }, tokB);
pair('products PUT /api/products/:sku', a, b);
t('…and the product carries A\'s edit, not B\'s', db.prepare('SELECT notes FROM products WHERE sku = ?').get(sku)?.notes === 'set by a write token');
readOnly('products', await call('PUT', `/products/${encodeURIComponent(sku)}`, { notes: 'x' }, tokAread));

a = await multipart(`/artwork/versions/${artId}/files`, { kind: 'preview' }, tokA);
b = await multipart(`/artwork/versions/${artId}/files`, { kind: 'preview' }, tokB);
pair('artwork POST /api/artwork/versions/:id/files', a, b);
readOnly('artwork files', await call('POST', `/artwork/versions/${artId}/files`, {}, tokAread));

a = await call('POST', '/procurement/pos', { vendor: 'Token Vendor', qty: 4, description: 'by a write token' }, tokA);
b = await call('POST', '/procurement/pos', { vendor: 'Token Vendor B' }, tokB);
pair('supply orders POST /api/procurement/pos', a, b);
const poId = a.body?.id;
a = await call('PUT', `/procurement/pos/${poId}`, { notes: 'edited by a write token' }, tokA);
b = await call('PUT', `/procurement/pos/${poId}`, { notes: 'B edits' }, tokB);
pair('supply orders PUT /api/procurement/pos/:id', a, b);
readOnly('supply orders', await call('POST', '/procurement/pos', { vendor: 'x' }, tokAread));

a = await multipart('/ap-drop', { vendor_name: 'Acme Fixture', notes: 'dropped by a write token' }, tokA);
const dropId = Array.isArray(a.body) ? a.body[0]?.id : (a.body?.drops?.[0]?.id || a.body?.id);
b = await multipart('/ap-drop', { vendor_name: 'Acme Fixture' }, tokX);
pair('AP Drop POST /api/ap-drop (B = a guest client: the intake is open to every employee, never a client)', a, b, (x) => x.status === 404);
a = await call('POST', `/ap-drop/${dropId}/notes`, { text: 'note from a write token' }, tokA);
b = await call('POST', `/ap-drop/${dropId}/notes`, { text: 'B notes' }, tokB);
pair("AP Drop POST /api/ap-drop/:id/notes (B cannot see A's drop)", a, b);
readOnly('AP Drop', await call('POST', `/ap-drop/${dropId}/notes`, { text: 'x' }, tokAread));
a = await call('POST', `/ap-drop/${dropId}/status`, { status: 'needs_info', reason: 'which PO?' }, tokA);
t('AP Drop: a triage move (needs_info) goes through for A', a.status === 200 && a.body?.status === 'needs_info', `${a.status} ${JSON.stringify(a.body).slice(0, 120)}`);

a = await call('POST', `/partners/${partner.id}/documents`, { doc_type: 'invoice', direction: 'receivable', amount: 125, doc_number: 'TOK-1', description: 'filed by a write token' }, tokA);
b = await call('POST', `/partners/${partner.id}/documents`, { doc_type: 'invoice', amount: 1 }, tokB);
pair('partner recon POST /api/partners/:id/documents', a, b);
const docId = Array.isArray(a.body) ? a.body[0]?.id : a.body?.id;
t('…and it lands as a draft', db.prepare('SELECT status FROM partner_documents WHERE id = ?').get(docId)?.status === 'draft');
a = await call('PUT', `/partners/documents/${docId}`, { description: 'edited while draft' }, tokA);
t('partner recon: A edits the document while it is a draft', a.status === 200, `${a.status} ${JSON.stringify(a.body).slice(0, 120)}`);
readOnly('partner recon', await call('POST', `/partners/${partner.id}/documents`, { amount: 1 }, tokAread));

a = await call('POST', '/nfp', { sku, version: 'TOK-V1', status: 'approved' }, tokA);
b = await call('POST', '/nfp', { sku, version: 'TOK-V1B' }, tokB);
pair('NFP POST /api/nfp', a, b);
const nfpId = a.body?.id;
t("NFP: a token's panel is a DRAFT even when the body says approved", a.body?.status === 'draft' && db.prepare('SELECT status FROM nfp_versions WHERE id = ?').get(nfpId)?.status === 'draft');
r = await call('PUT', `/nfp/${nfpId}`, { change_summary: 'bot draft' }, tokA);
t('NFP: …edited while it is a draft', r.status === 200, JSON.stringify(r.body).slice(0, 120));
db.prepare("UPDATE nfp_versions SET status = 'sent' WHERE id = ?").run(nfpId);
r = await call('PUT', `/nfp/${nfpId}`, { change_summary: 'after send' }, tokA);
t('NFP: …but not once it has left draft (403 token_denied)', r.status === 403 && r.body?.error === 'token_denied', JSON.stringify(r.body));
readOnly('NFP', await call('POST', '/nfp', { sku, version: 'TOK-RO' }, tokAread));
r = await call('POST', '/nfp', { sku, version: 'BOT-PAPER', source: 'paper', approved_by: 'Bot', approved_at: '2026-01-01' }, tokA);
t('NFP: a "paper" panel (filed APPROVED) is refused as an approval', r.status === 403 && r.body?.error === 'approve_requires_human_session', JSON.stringify(r.body));
const created = db.prepare("SELECT details FROM audit_log WHERE entity_type = 'nfp' AND entity_id = ?").get(nfpId);
t('the handler\'s own audit entry names the token', /"via_token":\{"id":"[^"]+","prefix":"rdk_/.test(created?.details || ''), created?.details);

a = await call('POST', `/comms/channels/${channel.id}/messages`, { body: 'Posted by a write token.' }, tokA);
b = await call('POST', `/comms/channels/${channel.id}/messages`, { body: 'B is not a member.' }, tokB);
pair('messages POST /api/comms/channels/:id/messages (B is not a member)', a, b, (x) => x.status === 404);
readOnly('messages', await call('POST', `/comms/channels/${channel.id}/messages`, { body: 'x' }, tokAread));

console.log('\n── every deny category, A\'s write token vs A\'s session ──');
const denied = (x, cat) => x.status === 403 && x.body?.error === 'token_denied' && x.body?.category === cat;
const notGuard = (x) => !['token_denied', 'approve_requires_human_session', 'token_scope'].includes(x.body?.error);
// delete: a real PO, refused, still there; the session reaches the handler.
const po2 = (await call('POST', '/procurement/pos', { vendor: 'Delete Me' }, sessA)).body?.id;
r = await call('DELETE', `/procurement/pos/${po2}`, null, tokA);
t('delete: DELETE /api/procurement/pos/:id → 403 token_denied (delete)', denied(r, 'delete'), JSON.stringify(r.body));
t('…and the PO is still there', !!db.prepare('SELECT 1 FROM purchase_orders WHERE id = ?').get(po2));
// void: the document stays a draft.
r = await call('POST', `/partners/documents/${docId}/void`, { reason: 'bot tries' }, tokA);
t('delete: POST /api/partners/documents/:docId/void → 403 token_denied (delete)', denied(r, 'delete'), JSON.stringify(r.body));
t('…and the document is unchanged', db.prepare('SELECT status FROM partner_documents WHERE id = ?').get(docId)?.status === 'draft');
r = await call('POST', '/qms/deviation/bulk-delete', { ids: ['x'] }, tokA);
t('delete: POST /api/qms/:type/bulk-delete → 403 token_denied (delete)', denied(r, 'delete'), JSON.stringify(r.body));
// user admin: A's own module access and role, unchanged.
const before = db.prepare("SELECT role, module_access FROM users WHERE id = 'wa'").get();
r = await call('PUT', '/users/wa', { role: 'admin', module_access: { settings: 'edit' } }, tokA);
t('user_admin: PUT /api/users/:id (role, module access) → 403 token_denied (user_admin)', denied(r, 'user_admin'), JSON.stringify(r.body));
const after = db.prepare("SELECT role, module_access FROM users WHERE id = 'wa'").get();
t('…and the account is unchanged', after.role === before.role && after.module_access === before.module_access);
r = await call('POST', '/users/me/password', { current: 'x', password: 'y' }, tokA);
t('user_admin: POST /api/users/me/password → 403 token_denied', denied(r, 'user_admin'), JSON.stringify(r.body));
// token admin, both methods.
const tokRows = db.prepare('SELECT COUNT(*) n FROM api_tokens').get().n;
r = await call('GET', '/api-tokens', null, tokA);
t('token_admin: GET /api/api-tokens → 403 token_denied (token_admin)', denied(r, 'token_admin'), JSON.stringify(r.body));
r = await call('POST', '/api-tokens', { user_id: 'wa', label: 'self-minted', scopes: ['read'] }, tokA);
t('token_admin: POST /api/api-tokens → 403 token_denied (token_admin)', denied(r, 'token_admin'), JSON.stringify(r.body));
t('…and no token was minted', db.prepare('SELECT COUNT(*) n FROM api_tokens').get().n === tokRows);
r = await call('GET', '/kiosk-tokens', null, tokA);
t('token_admin: GET /api/kiosk-tokens → 403 token_denied', denied(r, 'token_admin'), JSON.stringify(r.body));
// decisions.
r = await call('POST', `/products/${encodeURIComponent(sku)}/confirm/shopify`, {}, tokA);
t('decision: POST /api/products/:sku/confirm/:step → 403 token_denied (decision)', denied(r, 'decision'), JSON.stringify(r.body));
r = await call('POST', `/ap-drop/${dropId}/status`, { status: 'paid' }, tokA);
t('decision: AP Drop to paid → 403 token_denied (decision)', denied(r, 'decision'), JSON.stringify(r.body));
t('…and the drop is unchanged', db.prepare('SELECT status FROM ap_drops WHERE id = ?').get(dropId)?.status === 'needs_info');
r = await call('POST', '/artwork/checks/x/dismiss', { reason: 'bot' }, tokA);
t('decision: POST /api/artwork/checks/:id/dismiss → 403 token_denied (decision)', denied(r, 'decision'), JSON.stringify(r.body));
// approve class, one each.
for (const [m, p, label] of [
  ['POST', '/qms/deviation/x/approve', 'approve'], ['POST', '/documents/x/sign', 'sign'], ['PUT', '/sanitation/x/verify', 'verify'],
  ['PUT', '/loto/executions/x/release', 'release'], ['POST', `/partners/${partner.id}/settle`, 'settle'],
]) {
  r = await call(m, p, {}, tokA);
  t(`${label}: ${m} /api${p} → 403 approve_requires_human_session`, r.status === 403 && r.body?.error === 'approve_requires_human_session', JSON.stringify(r.body));
}
// A session for the same account is never stopped by the token guards.
const sessionRuns = [
  await call('DELETE', `/procurement/pos/${po2}`, null, sessA),
  await call('POST', `/partners/documents/${docId}/void`, { reason: 'session void' }, sessA),
  await call('POST', `/ap-drop/${dropId}/status`, { status: 'triaged' }, sessA),
  await call('POST', `/partners/${partner.id}/settle`, {}, sessA),
];
t("A's SESSION reaches the handler on the same routes (never a token refusal)", sessionRuns.every(notGuard), sessionRuns.map(x => `${x.status} ${x.body?.error || ''}`).join(' | '));
t('…the session DELETE really deleted the PO (the handler ran)', !db.prepare('SELECT 1 FROM purchase_orders WHERE id = ?').get(po2));
await sleep(150);
const wb = db.prepare("SELECT details FROM audit_log WHERE action = 'api_token_write_blocked'").all().map(x => JSON.parse(x.details).category);
t('each token_denied refusal is audited as api_token_write_blocked with its category', ['delete', 'user_admin', 'token_admin', 'decision', 'not_open_to_tokens'].every(c => wb.includes(c)), [...new Set(wb)].join(','));

console.log('\n── the bulk bucket ──');
let bulk429 = null;
for (let i = 0; i < 6 && !bulk429; i++) {
  const x = await call('POST', '/products/bulk-edit', { skus: [sku], field: 'notes', value: `bulk ${i}` }, tokA);
  if (x.status === 429) bulk429 = x;
}
t('past API_TOKEN_BULK_RPM (3 here) a bulk write gets 429 naming bulk writes', !!bulk429 && /bulk writes/.test(bulk429.body?.message || ''), JSON.stringify(bulk429?.body));
r = await call('PUT', `/products/${encodeURIComponent(sku)}`, { notes: 'an ordinary write still works' }, tokA);
t('…while ordinary writes still go through', r.status === 200, String(r.status));

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
t('one audit row per token call (3 calls → 3 rows) as the account, naming the token', calls.length === 3 && calls.every(c => c.actor === 'Proof Bot' && /"tokenId":/.test(c.details)), `${calls.length} rows`);
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

console.log('\n── write-drafts → write migration, across two reboots ──');
db.prepare(`INSERT INTO api_tokens (id, user_id, label, token_prefix, token_hash, scopes, created_by)
  VALUES ('tk-legacy', 'tk-bot', 'Legacy drafts bot', 'rdk_LEGA', ?, '["read","write-drafts"]', 'Token Admin')`).run('0'.repeat(64));
db.close();
await stop();
t('reboot 1', await boot());
const db2 = new Database(DBP);
const legacy = db2.prepare("SELECT scopes FROM api_tokens WHERE id = 'tk-legacy'").get()?.scopes;
t('a stored ["read","write-drafts"] reads ["read","write"] after boot', legacy === '["read","write"]', legacy);
const migRows = () => db2.prepare("SELECT details FROM audit_log WHERE action = 'api_token_scope_migrated' AND entity_id = 'tk-legacy'").all();
t('…and the move is audited as api_token_scope_migrated with the label and prefix', migRows().length === 1 && /rdk_LEGA/.test(migRows()[0].details), JSON.stringify(migRows()));
t('…and the boot log names it', /Legacy drafts bot \(rdk_LEGA\)/.test(bootLog));
db2.close();
await stop();
t('reboot 2', await boot());
const db3 = new Database(DBP);
t('a second boot changes nothing (idempotent: same value, still one audit row)',
  db3.prepare("SELECT scopes FROM api_tokens WHERE id = 'tk-legacy'").get()?.scopes === '["read","write"]'
  && db3.prepare("SELECT COUNT(*) n FROM audit_log WHERE action = 'api_token_scope_migrated' AND entity_id = 'tk-legacy'").get().n === 1);
db3.close();

console.log(`\n${pass} PASS / ${fail} FAIL`);
done(fail ? 1 : 0);
