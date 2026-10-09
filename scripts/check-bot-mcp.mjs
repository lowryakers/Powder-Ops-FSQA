#!/usr/bin/env node
// check:botmcp — the MCP wrapper and the post-deploy smoke test (D-163).
//
// PURE: the package's own unit tests (mocked fetch); its tools name exactly the
// routes in server/bot-api.js BOT_ROUTES, once each; no tool name suggests an
// approval-class act; the README and the docs checklist exist and say how.
// LIVE (its own server on a fresh database): scripts/smoke-bot-api.mjs passes
// end to end, and when it fails half way it still revokes its token.
// STDIO (when the package's SDK is installed — CI installs it): the real MCP
// server starts, lists the tools, answers whoami, and maps a scope refusal to a
// clear error; with no config it exits 1 and says what to set.
import { spawn, spawnSync } from 'child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import { pathToFileURL } from 'url';
import Database from 'better-sqlite3';
import { BOT_ROUTES } from '../server/bot-api.js';
import { ROUTES, canonicalPath, FORBIDDEN_TOOL_NAME } from '../packages/readydoc-mcp/src/routes.mjs';

let pass = 0, fail = 0;
const t = (n, ok, d = '') => { if (ok) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n}${d ? ' — ' + d : ''}`); } };
const PKG = resolve('packages/readydoc-mcp');

console.log('\n── the package ──');
const unit = spawnSync(process.execPath, ['--test', 'test/tools.test.mjs'], { cwd: PKG, encoding: 'utf8' });
const unitPass = unit.stdout.match(/^# pass (\d+)/m)?.[1], unitFail = unit.stdout.match(/^# fail (\d+)/m)?.[1];
t(`unit tests against a mocked fetch (${unitPass} pass)`, unit.status === 0 && unitFail === '0', unit.stdout.split('\n').filter(l => /not ok/.test(l)).join('; ').slice(0, 300));

const key = (m, p) => `${m} ${canonicalPath(p)}`;
const server = BOT_ROUTES.map(r => key(r.method, r.path));
const tools = ROUTES.map(r => key(r.method, r.path));
t(`one tool for each of the ${server.length} BOT_ROUTES`, server.every(k => tools.filter(x => x === k).length === 1), server.filter(k => !tools.includes(k)).join('; '));
t('no tool for a route BOT_ROUTES does not list', tools.every(k => server.includes(k)), tools.filter(k => !server.includes(k)).join('; '));
t('no tool name suggests approve / decide / release / sign / send', ROUTES.every(r => !FORBIDDEN_TOOL_NAME.test(r.tool)), ROUTES.filter(r => FORBIDDEN_TOOL_NAME.test(r.tool)).map(r => r.tool).join(', '));
const writes = BOT_ROUTES.filter(r => r.method !== 'GET').map(r => key(r.method, r.path));
t('every writing tool is a route the server lists as write-drafts', ROUTES.filter(r => r.method !== 'GET').every(r => writes.includes(key(r.method, r.path))));
const pkg = JSON.parse(readFileSync(join(PKG, 'package.json'), 'utf8'));
t('the package depends only on the MCP SDK', Object.keys(pkg.dependencies || {}).join() === '@modelcontextprotocol/sdk');
const srcText = ['bin.mjs', 'src/client.mjs', 'src/routes.mjs'].map(f => readFileSync(join(PKG, f), 'utf8')).join('\n');
t('…and imports nothing from the server', !/from\s+['"][./]*\.\.\/(server|shared)/.test(srcText));
const readme = existsSync(join(PKG, 'README.md')) ? readFileSync(join(PKG, 'README.md'), 'utf8') : '';
t('README names the env, the install and a client config', /READYDOC_URL/.test(readme) && /READYDOC_TOKEN/.test(readme) && /"mcpServers"/.test(readme));
const docs = readFileSync('docs/bot-api.md', 'utf8');
t('docs/bot-api.md carries the post-deploy checklist', /## After a deploy/.test(docs) && /smoke-bot-api\.mjs/.test(docs) && /readydoc-mcp/.test(docs));

// ── live ──────────────────────────────────────────────────────────────────────
const PORT = Number(process.env.BOTMCP_CHECK_PORT || 5085);
const BASE = `http://127.0.0.1:${PORT}`;
const dir = mkdtempSync(join(tmpdir(), 'readydoc-botmcp-'));
const DBP = join(dir, 'botmcp.db');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const srv = spawn(process.execPath, ['server.js'], { env: { ...process.env, PORT: String(PORT), DB_PATH: DBP, NODE_ENV: 'test' }, stdio: ['ignore', 'pipe', 'pipe'] });
let bootLog = ''; srv.stdout.on('data', d => { bootLog += d; }); srv.stderr.on('data', d => { bootLog += d; });
const done = (code) => { try { srv.kill('SIGKILL'); } catch { /* gone */ } try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ } process.exit(code); };
let up = false;
for (let i = 0; i < 180 && !up; i++) { try { up = (await fetch(`${BASE}/api/health`)).ok; } catch { /* not yet */ } if (!up) await sleep(500); }
if (!up) { console.log(bootLog.split('\n').slice(-30).join('\n')); t('the server came up', false); done(1); }

console.log('\n── the smoke test, against a fresh server ──');
const db = new Database(DBP);
const mk = (id, name, role, dept, ma) => db.prepare(`INSERT OR REPLACE INTO users (id,name,username,role,department,is_active,setup_code,setup_code_expires_at,module_access)
  VALUES (?,?,?,?,?,1,?,datetime('now','+7 day'),?)`).run(id, name, name, role, dept, `SC-${id}`, ma ? JSON.stringify(ma) : null);
mk('bm-admin', 'Smoke Admin', 'admin', 'office', null);
mk('bm-bot', 'Smoke Bot', 'operator', 'office', { products: 'view', artwork: 'view' });
mk('bm-bare', 'Bare Bot', 'operator', 'office', null);
const call = async (method, path, body, auth) => {
  const r = await fetch(`${BASE}${path}`, { method, headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: `Bearer ${auth}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let j = null; try { j = await r.json(); } catch { /* empty */ }
  return { status: r.status, body: j };
};
await call('POST', '/api/users/login', { name: 'Smoke Admin' });
await call('POST', '/api/users/set-password', { user_id: 'bm-admin', password: 'SmokeAdmin!!1', setup_code: 'SC-bm-admin' });
const admin = (await call('POST', '/api/users/login', { name: 'Smoke Admin', password: 'SmokeAdmin!!1' })).body?.token;
t('an admin session', !!admin);

const runSmoke = (bot) => spawnSync(process.execPath, ['scripts/smoke-bot-api.mjs'], {
  env: { ...process.env, READYDOC_URL: BASE, READYDOC_ADMIN_TOKEN: admin, SMOKE_BOT_USER: bot }, encoding: 'utf8', timeout: 60_000,
});
const tokensFor = (uid) => db.prepare('SELECT revoked_at FROM api_tokens WHERE user_id = ?').all(uid);

let s = runSmoke('Smoke Bot');
t('smoke-bot-api.mjs passes end to end (exit 0)', s.status === 0, (s.stdout + s.stderr).split('\n').filter(l => /FAIL|Error/.test(l)).join(' | ').slice(0, 400));
for (const step of ['whoami → 200', 'products → 200', 'decide → 403 approve_requires_human_session', 'artwork approve → 403', 'token revoked', 'revoked token → 401']) {
  t(`…prints PASS for "${step}"`, new RegExp(`PASS .*${step.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '.*')}`).test(s.stdout));
}
t('…and leaves no live token behind', tokensFor('bm-bot').length === 1 && tokensFor('bm-bot').every(r => r.revoked_at));
t('…and wrote no NFP draft and no message', db.prepare('SELECT COUNT(*) n FROM nfp_versions').get().n === 0
  && db.prepare("SELECT COUNT(*) n FROM chat_messages WHERE user_id = 'bm-bot'").get().n === 0);
const blocked = db.prepare("SELECT COUNT(*) n FROM audit_log WHERE action = 'api_token_approve_blocked' AND actor_id = 'bm-bot'").get().n;
t('…and both approve attempts are in the audit log as blocked', blocked === 2, `blocked=${blocked}`);

s = runSmoke('Bare Bot');
t('a bot account with no products module FAILS the smoke test (exit 1)', s.status === 1 && /FAIL\s+GET \/api\/products/.test(s.stdout));
t('…and still revokes its token', tokensFor('bm-bare').length === 1 && tokensFor('bm-bare').every(r => r.revoked_at));
// The connection drops half way: a proxy forwards everything except whoami,
// whose socket it destroys, so fetch THROWS after the token is minted. Only
// the `finally` can revoke it then.
{
  const http = await import('http');
  const proxy = http.createServer((req, res) => {
    if (req.url.startsWith('/api/bot/whoami')) { req.socket.destroy(); return; }
    const up = http.request({ host: '127.0.0.1', port: PORT, path: req.url, method: req.method, headers: req.headers }, (r) => { res.writeHead(r.statusCode, r.headers); r.pipe(res); });
    req.pipe(up);
  });
  await new Promise(r => proxy.listen(0, '127.0.0.1', r));
  const viaProxy = await new Promise((resolveRun) => {
    const child = spawn(process.execPath, ['scripts/smoke-bot-api.mjs'], {
      env: { ...process.env, READYDOC_URL: `http://127.0.0.1:${proxy.address().port}`, READYDOC_ADMIN_TOKEN: admin, SMOKE_BOT_USER: 'Smoke Bot' },
    });
    let out = ''; child.stdout.on('data', d => { out += d; }); child.stderr.on('data', d => { out += d; });
    child.on('exit', (code) => resolveRun({ status: code, stdout: out }));
  });
  proxy.close();
  t('a connection that drops mid-run FAILS the smoke test', viaProxy.status === 1, viaProxy.stdout.slice(-200));
  t('…and the token is revoked in finally', /PASS\s+cleanup: token revoked in finally/.test(viaProxy.stdout)
    && tokensFor('bm-bot').length === 2 && tokensFor('bm-bot').every(r => r.revoked_at));
}
s = runSmoke('Smoke Admin');
t('an admin as the smoke bot is refused, with nothing left live', s.status === 1 && db.prepare("SELECT COUNT(*) n FROM api_tokens WHERE user_id = 'bm-admin' AND revoked_at IS NULL").get().n === 0);
s = spawnSync(process.execPath, ['scripts/smoke-bot-api.mjs'], { env: { ...process.env, READYDOC_URL: '', READYDOC_ADMIN_TOKEN: '', SMOKE_BOT_USER: '' }, encoding: 'utf8' });
t('with no env it stops and names what to set', s.status === 2 && /READYDOC_URL/.test(s.stderr));

// ── stdio ─────────────────────────────────────────────────────────────────────
console.log('\n── the MCP server over stdio ──');
const sdk = join(PKG, 'node_modules/@modelcontextprotocol/sdk/package.json');
if (!existsSync(sdk)) {
  const required = process.env.BOTMCP_REQUIRE_STDIO === '1';
  t(`SDK not installed (npm ci --prefix packages/readydoc-mcp)${required ? '' : ' — stdio half skipped'}`, !required);
} else {
  const noEnv = spawnSync(process.execPath, [join(PKG, 'bin.mjs')], { env: { PATH: process.env.PATH }, encoding: 'utf8', timeout: 20_000 });
  t('with no READYDOC_URL / READYDOC_TOKEN it exits 1 and says what to set', noEnv.status === 1 && /READYDOC_URL and READYDOC_TOKEN/.test(noEnv.stderr));

  const made = await call('POST', '/api/api-tokens', { user_id: 'bm-bot', label: 'stdio check', scopes: ['read'] }, admin);
  const tok = made.body?.plaintext;
  const { Client } = await import(pathToFileURL(join(PKG, 'node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js')).href);
  const { StdioClientTransport } = await import(pathToFileURL(join(PKG, 'node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js')).href);
  const client = new Client({ name: 'check-botmcp', version: '1.0.0' });
  try {
    await client.connect(new StdioClientTransport({ command: process.execPath, args: [join(PKG, 'bin.mjs')], env: { PATH: process.env.PATH, READYDOC_URL: BASE, READYDOC_TOKEN: tok } }));
    const listed = (await client.listTools()).tools.map(x => x.name);
    t(`lists ${ROUTES.length} tools`, listed.length === ROUTES.length && ROUTES.every(r => listed.includes(r.tool)));
    const who = await client.callTool({ name: 'whoami', arguments: {} });
    const whoBody = JSON.parse(who.content[0].text);
    t('whoami answers as the bot account', !who.isError && whoBody.data?.user?.id === 'bm-bot' && whoBody.data?.auth === 'token');
    const prods = await client.callTool({ name: 'list_products', arguments: { limit: 3 } });
    const pb = JSON.parse(prods.content[0].text);
    t('list_products returns a page of 3 with the total', !prods.isError && pb.data?.products?.length === 3 && pb.page?.total > 3);
    const draft = await client.callTool({ name: 'create_nfp_draft', arguments: { sku: pb.data.products[0].sku, version: 'STDIO-V1' } });
    t('a read token filing a draft gets a clear scope error, not a stack', draft.isError === true && /token may not do that/.test(draft.content[0].text));
    const none = await client.callTool({ name: 'get_product', arguments: { sku: 'NO-SUCH-SKU-XYZ' } });
    t('an unknown SKU reads as not found', none.isError === true && /Not found/.test(none.content[0].text));
  } catch (err) {
    t('the MCP server over stdio', false, err.message);
  } finally {
    try { await client.close(); } catch { /* closed */ }
    if (made.body?.token?.id) await call('POST', `/api/api-tokens/${made.body.token.id}/revoke`, null, admin);
  }
}

console.log(`\n${pass} PASS / ${fail} FAIL`);
done(fail ? 1 : 0);
