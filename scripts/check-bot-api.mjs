#!/usr/bin/env node
// check:botapi — the bots' REST surface (D-162), pure + live.
//
// PURE: docs/bot-api.md documents exactly BOT_ROUTES (both ways), and every
// route in BOT_ROUTES exists in the server's source.
// LIVE (its own server on a fresh database): every documented GET answers 200 to
// a read token; nothing a token is sent carries a forbidden key (a hash, a
// secret, a storage key, extracted text) though a session still gets the screen's
// shape; token callers are paged (X-Total-Count, cap 200) and sessions are not
// unless they ask; an NFP filed with a token is a draft whatever the body says;
// a message posted with a token is the bot account's, inside its own channels,
// and never @everyone; /api/bot/whoami says who the token is.
//
// BOT_API_CAPTURE=1 prints a trimmed example of each GET, for the docs.
import { spawn } from 'child_process';
import { mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import Database from 'better-sqlite3';
import { BOT_ROUTES, PAGE_MAX, isForbiddenKey, writeAreaFor } from '../server/bot-api.js';
import { scanRoutes, concretePath } from './lib/route-scan.mjs';

let pass = 0, fail = 0;
const t = (n, ok, d = '') => { if (ok) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n}${d ? ' — ' + d : ''}`); } };
const key = (m, p) => `${m} ${p}`;

console.log('\n── docs/bot-api.md ↔ BOT_ROUTES ──');
const doc = readFileSync('docs/bot-api.md', 'utf8');
const documented = new Set([...doc.matchAll(/^###\s+`(GET|POST|PUT|PATCH|DELETE)\s+(\/api\/[^`\s]+)`/gm)].map(m => key(m[1], m[2])));
const listed = new Set(BOT_ROUTES.map(r => key(r.method, r.path)));
const undocumented = [...listed].filter(k => !documented.has(k));
const unlisted = [...documented].filter(k => !listed.has(k));
t(`every one of ${listed.size} BOT_ROUTES is documented`, undocumented.length === 0, undocumented.join('; '));
t('nothing is documented that BOT_ROUTES does not list', unlisted.length === 0, unlisted.join('; '));
for (const section of ['401', 'token_scope', 'token_denied', 'approve_requires_human_session', '404', '429', 'X-Total-Count', 'module_access', '## Never via token', '## What `write` may write']) {
  t(`the docs explain ${section}`, doc.includes(section));
}
const scanned = new Set(scanRoutes(process.cwd(), { includeGet: true }).map(r => key(r.method, r.path.replace(/\/$/, '') || r.path)));
const missingInCode = BOT_ROUTES.filter(r => !scanned.has(key(r.method, r.path)));
t('every BOT_ROUTES entry exists in the server source', missingInCode.length === 0, missingInCode.map(r => key(r.method, r.path)).join('; '));
const writeRoutes = BOT_ROUTES.filter(r => r.method !== 'GET');
t('every writing BOT_ROUTES entry has scope write and is on WRITE_AREAS',
  writeRoutes.length >= 10 && writeRoutes.every(r => r.scope === 'write' && writeAreaFor({ method: r.method, path: r.path.replace(/^\/api/, '').replace(/:([A-Za-z_]+)/g, 'x0') })),
  writeRoutes.filter(r => !writeAreaFor({ method: r.method, path: r.path.replace(/^\/api/, '').replace(/:([A-Za-z_]+)/g, 'x0') })).map(r => key(r.method, r.path)).join('; '));
t('no BOT_ROUTES entry still says write-drafts', !BOT_ROUTES.some(r => r.scope === 'write-drafts'));

// ── live ──────────────────────────────────────────────────────────────────────
const PORT = Number(process.env.BOTAPI_CHECK_PORT || 5083);
const URL = `http://127.0.0.1:${PORT}`;
const dir = mkdtempSync(join(tmpdir(), 'readydoc-botapi-'));
const DBP = join(dir, 'botapi.db');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const server = spawn(process.execPath, ['server.js'], {
  env: { ...process.env, PORT: String(PORT), DB_PATH: DBP, NODE_ENV: 'test', API_TOKEN_RPM: '600', API_TOKEN_WRITE_RPM: '100' },
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
mk('ba-admin', 'Surface Admin', 'admin', 'office', null);
mk('ba-bot', 'Catalog Bot', 'supervisor', 'qa', { products: 'edit', artwork: 'view', procurement: 'view', 'partner-reconciliation': 'view', 'ap-drop': 'view' });
const call = async (method, path, body, auth) => {
  const r = await fetch(`${URL}${path}`, { method, headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: `Bearer ${auth}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let j = null; try { j = await r.json(); } catch { /* empty */ }
  return { status: r.status, body: j, headers: r.headers };
};
const signIn = async (name, id) => {
  await call('POST', '/api/users/login', { name });
  await call('POST', '/api/users/set-password', { user_id: id, password: 'B0tSurface!!', setup_code: `SC-${id}` });
  return (await call('POST', '/api/users/login', { name, password: 'B0tSurface!!' })).body?.token;
};
const admin = await signIn('Surface Admin', 'ba-admin');
const botSession = await signIn('Catalog Bot', 'ba-bot');
const readTok = (await call('POST', '/api/api-tokens', { user_id: 'ba-bot', label: 'Catalog reader', scopes: ['read'] }, admin)).body?.plaintext;
const draftTok = (await call('POST', '/api/api-tokens', { user_id: 'ba-bot', label: 'Catalog writer', scopes: ['read', 'write'] }, admin)).body?.plaintext;
t('sessions and two tokens', !!admin && !!botSession && !!readTok && !!draftTok);

// Fixtures, through the doors a person would use where one exists.
const sku = db.prepare('SELECT sku FROM products ORDER BY sku LIMIT 1').get()?.sku;
const art = (await call('POST', '/api/artwork', { sku, component: 'pouch', change_summary: 'fixture' }, admin)).body;
let partner = db.prepare('SELECT id FROM partner_accounts WHERE is_active = 1 LIMIT 1').get();
if (!partner) { db.prepare("INSERT INTO partner_accounts (id, name, code, terms_days, is_active) VALUES ('ba-p', 'Fixture Partner', 'FP', 30, 1)").run(); partner = { id: 'ba-p' }; }
const channel = db.prepare("SELECT id FROM chat_channels WHERE kind = 'public' AND archived = 0 ORDER BY is_default DESC LIMIT 1").get();
db.prepare('INSERT OR IGNORE INTO chat_channel_members (id, channel_id, user_id) VALUES (?, ?, ?)').run('ba-mem', channel.id, 'ba-bot');
const otherChannel = 'ba-private';
db.prepare("INSERT OR IGNORE INTO chat_channels (id, name, kind, archived) VALUES (?, 'bot-not-member', 'private', 0)").run(otherChannel);
db.prepare(`INSERT INTO ap_drops (id, created_by_user_id, submitter, filename, storage_key, content_sha256, extracted_text, vendor_name, amount, status)
  VALUES ('ba-drop', 'ba-bot', 'Catalog Bot', 'fixture.pdf', 'ap-drop/secret-key.pdf', 'sha-fixture', 'TEXT INSIDE THE PDF', 'Acme', 12.5, 'new')`).run();
t('fixtures: a product, an artwork version, a partner, a channel the bot is in', !!sku && !!art?.id && !!partner?.id && !!channel?.id);

console.log('\n── posting as the bot ──');
let r = await call('POST', `/api/comms/channels/${channel.id}/messages`, { body: 'Proof run finished for the pouch.' }, draftTok);
const msg = r.body;
t('a write token posts a message (201)', r.status === 201, JSON.stringify(r.body).slice(0, 120));
t('…attributed to the bot account', msg?.user_id === 'ba-bot' && db.prepare('SELECT user_id FROM chat_messages WHERE id = ?').get(msg?.id)?.user_id === 'ba-bot');
r = await call('POST', `/api/comms/channels/${channel.id}/messages`, { body: 'Heads up @everyone' }, draftTok);
t('@everyone from a token → 403 token_scope', r.status === 403 && r.body?.error === 'token_scope');
r = await call('POST', `/api/comms/channels/${channel.id}/messages`, { body: 'Heads up @channel' }, botSession);
t('…while the same account signed in can still use it', r.status === 201);
r = await call('POST', `/api/comms/channels/${otherChannel}/messages`, { body: 'hello' }, draftTok);
t('a channel the bot is not in → 404 (membership holds)', r.status === 404);
r = await call('POST', '/api/comms/channels', { name: 'bot-made', kind: 'public' }, draftTok);
t('a token cannot create a channel (not on WRITE_AREAS)', r.status === 403 && r.body?.error === 'token_denied' && r.body?.category === 'not_open_to_tokens', JSON.stringify(r.body));
r = await call('POST', `/api/comms/channels/${channel.id}/messages`, { body: 'read only' }, readTok);
t('a read token cannot post', r.status === 403 && r.body?.error === 'token_scope');

console.log('\n── NFP via token is always a draft ──');
r = await call('POST', '/api/nfp', { sku, version: 'BOTAPI-V1', status: 'approved' }, draftTok);
t('POST /api/nfp with status "approved" files a DRAFT', r.status === 201 && r.body?.status === 'draft' && !r.body?.approved_at, JSON.stringify(r.body).slice(0, 160));
t('…and nothing on the product moved', !db.prepare('SELECT nfp_approved_at FROM products WHERE sku = ?').get(sku)?.nfp_approved_at);
r = await call('POST', '/api/nfp', { sku, version: 'BOTAPI-PAPER', source: 'paper', approved_by: 'Bot', approved_at: '2026-01-01' }, draftTok);
t('a paper panel from a token is refused', r.status === 403 && r.body?.error === 'approve_requires_human_session');

console.log('\n── every documented GET answers a read token, and leaks nothing ──');
const fill = (p) => p.replace(':sku', encodeURIComponent(sku)).replace('/artwork/versions/:id', `/artwork/versions/${art.id}`)
  .replace('/partners/:id', `/partners/${partner.id}`).replace('/channels/:id', `/channels/${channel.id}`)
  .replace('/messages/:id', `/messages/${msg?.id}`);
const leaks = (v, path = '$', out = []) => {
  if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { if (isForbiddenKey(k)) out.push(`${path}.${k}`); leaks(x, `${path}.${k}`, out); }
  return out;
};
const capture = {};
for (const route of BOT_ROUTES.filter(x => x.method === 'GET')) {
  const path = fill(route.path);
  const res = await call('GET', path, null, readTok);
  const bad = leaks(res.body);
  t(`${route.method} ${route.path} → 200, no forbidden keys`, res.status === 200 && bad.length === 0, `${res.status} ${bad.slice(0, 5).join(', ')} ${JSON.stringify(res.body).slice(0, 100)}`);
  if (route.paged) {
    const total = res.headers.get('x-total-count');
    t(`${route.path} is paged for a token (X-Total-Count, X-Limit ≤ ${PAGE_MAX})`, total !== null && Number(res.headers.get('x-limit')) <= PAGE_MAX, `total=${total}`);
  }
  if (process.env.BOT_API_CAPTURE) capture[route.path] = res.body;
}
r = await call('GET', '/api/ap-drop', null, botSession);
const sessDrop = (r.body || []).find(x => x.id === 'ba-drop');
t('control: a SESSION still gets the screen\'s shape (storage_key present)', !!sessDrop && 'storage_key' in sessDrop, JSON.stringify(sessDrop).slice(0, 120));
r = await call('GET', '/api/ap-drop', null, readTok);
const tokDrop = (r.body || []).find(x => x.id === 'ba-drop');
t('…the token gets the same row with no storage_key and no extracted text', !!tokDrop && !('storage_key' in tokDrop) && !JSON.stringify(r.body).includes('TEXT INSIDE THE PDF'));

console.log('\n── pagination ──');
const all = await call('GET', '/api/products', null, botSession);
t('a session with no limit gets the whole list and no paging headers', all.body?.products?.length > 5 && all.headers.get('x-total-count') === null);
const p1 = await call('GET', '/api/products?limit=5', null, readTok);
const p2 = await call('GET', '/api/products?limit=5&offset=5', null, readTok);
t('limit=5 returns five, offset=5 the next five', p1.body?.products?.length === 5 && p2.body?.products?.length === 5
  && p1.body.products[0].sku !== p2.body.products[0].sku && p2.body.products[0].sku === all.body.products[5].sku);
t('X-Total-Count is the whole list', Number(p1.headers.get('x-total-count')) === all.body.products.length);
const big = await call('GET', '/api/products?limit=5000', null, readTok);
t(`a limit above ${PAGE_MAX} is capped`, Number(big.headers.get('x-limit')) === PAGE_MAX && big.body.products.length <= PAGE_MAX);

console.log('\n── whoami ──');
r = await call('GET', '/api/bot/whoami', null, draftTok);
t('whoami names the account, scopes, prefix, limits', r.status === 200 && r.body?.user?.id === 'ba-bot' && r.body?.auth === 'token'
  && JSON.stringify(r.body.scopes) === '["read","write"]' && r.body.tokenPrefix === draftTok.slice(0, 8)
  && r.body.rate_limits?.read > 0 && 'expires_at' in r.body, JSON.stringify(r.body).slice(0, 200));
t('…and lists the documented routes', r.body?.routes?.length === BOT_ROUTES.length);

if (process.env.BOT_API_CAPTURE) {
  const trim = (v, d = 0) => Array.isArray(v) ? v.slice(0, 1).map(x => trim(x, d + 1))
    : (v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).slice(0, 10).map(([k, x]) => [k, d > 2 ? '…' : trim(x, d + 1)])) : v);
  console.log(JSON.stringify(Object.fromEntries(Object.entries(capture).map(([k, v]) => [k, trim(v)])), null, 1));
}

db.close();
console.log(`\n${pass} PASS / ${fail} FAIL`);
done(fail ? 1 : 0);
