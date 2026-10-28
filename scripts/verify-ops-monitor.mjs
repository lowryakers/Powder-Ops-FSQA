#!/usr/bin/env node
// verify:opsmonitor — the bots' outside monitor (D-259), live. This script boots
// its OWN server on a scratch database (it needs fresh, fake VAPID keys at boot):
// OPS_MONITOR_ENABLED=1, the webhook pointed at a local fake hook that answers
// 500, thresholds of 15 s (webhook) and 60 s (silence), a 1-second tick and a
// fixed working-hours wall clock (both test-only overrides, honoured only under
// NODE_ENV=test), one account with email lowry@powder-ops.com and one fake push
// subscription pointing at an unreachable https://push.invalid/ endpoint.
//
// Asserts: a person's post in #ops-requests-test is 201; after the threshold
// #alerts exists, is private, has exactly the one member and holds exactly one
// alert by ReadyBot; the push was attempted and recorded as failed; with the hook
// answering 200 the next post brings exactly one recovery and no second alert; a
// quiet minute raises the silence alert once and a bot post through its token
// recovers it; ReadyBot posted nowhere else; the status route is 200 for an
// admin session, 403 for a bot token and a non-admin, 401 with nothing, and names
// no URL, key, id or email.
//
// Control: remove the startOpsMonitor call from server.js — #alerts never appears
// and the first monitor assertion fails.
import http from 'http';
import { spawn, spawnSync } from 'child_process';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { createECDH, createHash, randomBytes } from 'crypto';
import Database from 'better-sqlite3';
import webpush from 'web-push';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.OPS_MON_PORT || 5152);
const HOOK_PORT = Number(process.env.OPS_MON_HOOK_PORT || 5153);
const BASE = `http://localhost:${PORT}`;
let pass = 0, fail = 0;
const t = (n, ok, d = '') => { if (ok) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n}${d ? ' — ' + d : ''}`); } };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const tmp = mkdtempSync(path.join(tmpdir(), 'ops-monitor-verify-'));
let server = null;
const done = (code) => { try { server?.kill('SIGKILL'); } catch { /* gone */ } try { hook.close(); } catch { /* gone */ } try { rmSync(tmp, { recursive: true, force: true }); } catch { /* best effort */ } process.exit(code); };

// ── the fake hook ──
let hookStatus = 500;
const hook = http.createServer((req, res) => {
  req.on('data', () => {});
  req.on('end', () => { res.writeHead(hookStatus, { 'Content-Type': 'application/json' }); res.end(hookStatus === 200 ? '{"success":true}' : '{"error":"fake failure"}'); });
});
await new Promise(r => hook.listen(HOOK_PORT, '127.0.0.1', r));

// ── the scratch database, seeded before the server starts ──
const dbPath = path.join(tmp, 'app.db');
const boot = spawnSync(process.execPath, ['-e', "import('./server/db.js').then(m => { m.getDb(); process.exit(0); })"],
  { cwd: root, env: { ...process.env, DB_PATH: dbPath, NODE_ENV: 'test' }, encoding: 'utf8' });
if (boot.status !== 0) { console.error(boot.stderr); done(1); }
const db = new Database(dbPath);
const mk = (id, name, role, email = null) => db.prepare(`INSERT OR REPLACE INTO users (id,name,username,role,department,is_active,setup_code,setup_code_expires_at,module_access,email)
  VALUES (?,?,?,?,'office',1,?,datetime('now','+7 day'),?,?)`).run(id, name, name, role, `SC-${id}`, role === 'admin' ? null : '{"products":"view"}', email);
mk('om-lowry', 'Monitor Owner', 'admin', 'lowry@powder-ops.com');
mk('om-person', 'Monitor Person', 'operator');
mk('om-bot', '*Procurement Bot', 'operator');
db.prepare("INSERT INTO chat_channels (id, kind, name, created_by) VALUES ('om-ops', 'private', 'ops-requests-test', 'om-lowry')").run();
for (const u of ['om-lowry', 'om-person', 'om-bot']) db.prepare('INSERT INTO chat_channel_members (id, channel_id, user_id) VALUES (?,?,?)').run(`om-ops-${u}`, 'om-ops', u);
const BOT_TOKEN = `rdk_${randomBytes(32).toString('base64url')}`;
db.prepare(`INSERT INTO api_tokens (id, user_id, label, token_prefix, token_hash, scopes, last_used_at)
  VALUES ('om-tok', 'om-bot', 'procurement bot (test)', ?, ?, '["read","write"]', datetime('now'))`).run(BOT_TOKEN.slice(0, 8), createHash('sha256').update(BOT_TOKEN).digest('hex'));
const ecdh = createECDH('prime256v1'); ecdh.generateKeys();
db.prepare("INSERT INTO chat_push_subscriptions (id, user_id, endpoint, p256dh, auth) VALUES ('om-sub', 'om-lowry', 'https://push.invalid/fake/om', ?, ?)")
  .run(ecdh.getPublicKey().toString('base64url'), randomBytes(16).toString('base64url'));
const seededAt = Date.now();

// ── the server ──
const vapid = webpush.generateVAPIDKeys();
const P_URL = `http://127.0.0.1:${HOOK_PORT}/automations/webhook/procROUTINE9`, P_KEY = 'crsr_fakeMonitorProc';
server = spawn(process.execPath, ['server.js'], { cwd: root, stdio: 'ignore', env: { ...process.env,
  DB_PATH: dbPath, PORT: String(PORT), NODE_ENV: 'test', APP_BASE_URL: BASE,
  VAPID_PUBLIC_KEY: vapid.publicKey, VAPID_PRIVATE_KEY: vapid.privateKey, VAPID_SUBJECT: 'mailto:test@example.invalid',
  OPS_WEBHOOK_ENABLED: '1', OPS_WEBHOOK_URL: P_URL, OPS_WEBHOOK_KEY: P_KEY,
  OPS_MONITOR_ENABLED: '1', OPS_MONITOR_WEBHOOK_MINUTES: '0.25', OPS_MONITOR_SILENCE_MINUTES: '1',
  OPS_MONITOR_TICK_MS: '1000', OPS_MONITOR_TEST_WALL: 'Wed 10:00' } });
let up = false;
for (let i = 0; i < 90 && !up; i++) { try { up = (await fetch(`${BASE}/api/users/lookup?q=zz`)).status < 500; } catch { await sleep(1000); } }
if (!up) { console.log('  ✗ server did not come up'); done(1); }

const json = async (method, p, body, auth) => {
  const r = await fetch(`${BASE}/api${p}`, { method, headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: `Bearer ${auth}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  let j = null; try { j = JSON.parse(text); } catch { /* empty */ }
  return { status: r.status, body: j, text };
};
const signIn = async (name, id) => {
  await json('POST', '/users/login', { name });
  await json('POST', '/users/set-password', { user_id: id, password: 'MonitorCheck!!1', setup_code: `SC-${id}` });
  return (await json('POST', '/users/login', { name, password: 'MonitorCheck!!1' })).body?.token;
};
const owner = await signIn('Monitor Owner', 'om-lowry');
const person = await signIn('Monitor Person', 'om-person');
t('sessions for the owner and a person', !!owner && !!person);

const alertsCh = () => db.prepare("SELECT * FROM chat_channels WHERE name = 'alerts'").all();
const botId = () => db.prepare("SELECT id FROM users WHERE name = 'ReadyBot'").get()?.id;
const alertPosts = () => { const c = alertsCh()[0]; return c ? db.prepare('SELECT * FROM chat_messages WHERE channel_id = ? ORDER BY created_at').all(c.id) : []; };
const until = async (fn, ms) => { const end = Date.now() + ms; while (Date.now() < end) { if (fn()) return true; await sleep(250); } return !!fn(); };
const incident = (key) => db.prepare('SELECT * FROM ops_monitor_incidents WHERE incident_key = ? ORDER BY id').all(key);

console.log('\n── webhook errors ──');
let r = await json('POST', '/comms/channels/om-ops/messages', { body: '[TEST] Where is PO00613?' }, person);
t('a person\'s post in #ops-requests-test returns 201', r.status === 201, String(r.status));
await until(() => alertPosts().some(p => /webhook deliveries to procurement/.test(p.body)), 45000);
const ch = alertsCh();
t('#alerts exists, is private, and has exactly the one member', ch.length === 1 && ch[0].kind === 'private'
  && JSON.stringify(db.prepare('SELECT user_id FROM chat_channel_members WHERE channel_id = ?').all(ch[0]?.id).map(m => m.user_id)) === '["om-lowry"]', JSON.stringify(ch));
let hookAlerts = alertPosts().filter(p => /webhook deliveries to procurement/.test(p.body));
t('it holds exactly one webhook alert, posted by ReadyBot', hookAlerts.length === 1 && hookAlerts[0].user_id === botId(), String(hookAlerts.length));
await until(() => incident('webhook:procurement')[0]?.alert_push, 5000);
t('the push was attempted (the subscription records the failure)', !!db.prepare("SELECT last_error_at FROM chat_push_subscriptions WHERE id = 'om-sub'").get()?.last_error_at);
t('…and the incident records alert_push = failed', incident('webhook:procurement')[0]?.alert_push === 'failed', incident('webhook:procurement')[0]?.alert_push);
hookStatus = 200;
r = await json('POST', '/comms/channels/om-ops/messages', { body: '[TEST] Any update?' }, person);
await until(() => alertPosts().some(p => /deliveries to procurement are going through again/.test(p.body)), 20000);
await sleep(3000);
t('the hook answering again brings exactly one recovery post', alertPosts().filter(p => /deliveries to procurement are going through again/.test(p.body)).length === 1);
t('…and no second alert', alertPosts().filter(p => /webhook deliveries to procurement have failed/.test(p.body)).length === 1);

console.log('\n── bot silence ──');
const quietFor = Date.now() - seededAt;
await until(() => alertPosts().some(p => /no bot has been seen/.test(p.body)), Math.max(5000, 90000 - quietFor));
await sleep(3000);
t('a quiet minute in working hours raises the silence alert once', alertPosts().filter(p => /no bot has been seen/.test(p.body)).length === 1);
r = await json('POST', '/comms/channels/om-ops/messages', { body: 'Checked: PO00613 shipped.' }, BOT_TOKEN);
t('the bot posts through its token (201)', r.status === 201, `${r.status} ${r.text.slice(0, 100)}`);
await until(() => alertPosts().some(p => /a bot was seen again/.test(p.body)), 15000);
await sleep(2500);
t('…which sends exactly one recovery', alertPosts().filter(p => /a bot was seen again/.test(p.body)).length === 1);
t('no alert or recovery was posted in any other channel', db.prepare("SELECT COUNT(*) n FROM chat_messages m JOIN chat_channels c ON c.id = m.channel_id WHERE m.user_id = ? AND (c.name IS NULL OR c.name != 'alerts') AND (m.body LIKE 'Bots alert%' OR m.body LIKE 'Bots recovered%' OR m.body LIKE 'Bots update%')").get(botId()).n === 0);

console.log('\n── the status route ──');
r = await json('GET', '/admin/ops-monitor/status', null, owner);
t('admin session: 200, enabled', r.status === 200 && r.body?.enabled === true && r.body?.recipient === 'resolved' && r.body?.alerts_channel === 'ok', r.text.slice(0, 200));
t('…push_ready shows VAPID set and a phone subscribed', r.body?.push_ready?.vapid_configured === true && r.body?.push_ready?.phone_subscribed === true);
t('…names no URL, key, account id or email', !r.text.includes(P_URL) && !r.text.includes(P_KEY) && !r.text.includes('procROUTINE9') && !r.text.includes('om-lowry') && !/powder-ops\.com/i.test(r.text));
t('…lists both incidents as recovered', ['webhook:procurement', 'bot-silence'].every(k => r.body?.recent?.some(i => i.incident === k && i.recovered_at && i.alert_posted && i.recovery_posted)));
t('bot token: 403', (await json('GET', '/admin/ops-monitor/status', null, BOT_TOKEN)).status === 403);
t('a person: 403', (await json('GET', '/admin/ops-monitor/status', null, person)).status === 403);
t('nothing: 401', (await json('GET', '/admin/ops-monitor/status')).status === 401);
t('there is no route that changes it', (await json('POST', '/admin/ops-monitor/status', {}, owner)).status >= 400);

console.log(`\n${pass} passed, ${fail} failed`);
done(fail ? 1 : 0);
