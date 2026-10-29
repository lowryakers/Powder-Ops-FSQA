#!/usr/bin/env node
// check:opsmonitor — server/ops-monitor.js (D-259) on a scratch database with a
// fake clock and a fake push. Every URL, key and endpoint is obviously fake;
// the one real push attempt goes to https://push.invalid/ and cannot leave.
import { spawnSync, execSync } from 'child_process';
import { mkdtempSync, rmSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { createECDH, randomBytes } from 'crypto';
import webpush from 'web-push';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const t = (n, ok, d = '') => { if (ok) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n}${d ? ' — ' + d : ''}`); } };
const tmp = mkdtempSync(path.join(tmpdir(), 'ops-monitor-'));
process.on('exit', () => { try { rmSync(tmp, { recursive: true, force: true }); } catch { /* best effort */ } });

const dbPath = path.join(tmp, 'app.db');
const boot = spawnSync(process.execPath, ['-e', "import('./server/db.js').then(m => { m.getDb(); process.exit(0); })"],
  { cwd: root, env: { ...process.env, DB_PATH: dbPath, NODE_ENV: 'test' }, encoding: 'utf8' });
if (boot.status !== 0) { console.error(boot.stderr); process.exit(1); }
// Fake, offline VAPID keys, set BEFORE push.js is imported (it reads them at import).
const vapid = webpush.generateVAPIDKeys();
Object.assign(process.env, { DB_PATH: dbPath, NODE_ENV: 'test', VAPID_PUBLIC_KEY: vapid.publicKey, VAPID_PRIVATE_KEY: vapid.privateKey,
  VAPID_SUBJECT: 'mailto:test@example.invalid', READYDOC_ORIGIN: 'https://app.powder-ops.com' });
const { getDb } = await import('../server/db.js');
const M = await import('../server/ops-monitor.js');
const { pushToUser: realPush } = await import('../server/push.js');
const { getBotUser } = await import('../server/api/comms.js');
const { ensureOpsWebhookSchema } = await import('../server/ops-webhook.js');
const db = getDb();
ensureOpsWebhookSchema(db);

const P_URL = 'https://fake-hooks.invalid/automations/webhook/procROUTINE123456', P_KEY = 'crsr_fakeProcurementKey000';
const C_URL = 'https://fake-hooks.invalid/automations/webhook/ctrlROUTINE654321', C_KEY = 'crsr_fakeControllerKey000';
const SECRETS = [P_URL, P_KEY, C_URL, C_KEY, 'procROUTINE123456', 'ctrlROUTINE654321'];

// ── people ──
const mkUser = (id, name, role, email = null, active = 1) => db.prepare(`INSERT OR REPLACE INTO users (id, name, username, role, department, is_active, email)
  VALUES (?, ?, ?, ?, 'office', ?, ?)`).run(id, name, name, role, active, email);
mkUser('u-lowry', 'Lowry Akers', 'admin', 'Lowry@Powder-Ops.com');
mkUser('u-admin2', 'Other Admin', 'admin', 'other@powder-ops.com');
mkUser('u-person', 'Floor Person', 'operator');
mkUser('u-bot', '*Procurement Bot', 'operator');
mkUser('u-bot2', '*Controller Bot', 'operator');
mkUser('u-runner', 'Test Runner', 'operator');
db.prepare("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('test_runner_user_id', 'u-runner')").run();
const readyBot = getBotUser(db);
const LOWRY = 'u-lowry';

// ── a fake subscription (the endpoint can never resolve) ──
const ecdh = createECDH('prime256v1'); ecdh.generateKeys();
const addSub = (userId, tag) => db.prepare('INSERT OR REPLACE INTO chat_push_subscriptions (id, user_id, endpoint, p256dh, auth) VALUES (?, ?, ?, ?, ?)')
  .run(`sub-${tag}`, userId, `https://push.invalid/fake/${tag}`, ecdh.getPublicKey().toString('base64url'), randomBytes(16).toString('base64url'));
addSub(LOWRY, 'lowry');

// ── fakes ──
let clock = 0;
const logs = [];
const log = { log: (m) => logs.push(String(m)), warn: (m) => logs.push(String(m)), error: (m) => logs.push(String(m)) };
let pushCalls = [];
const everyPushUser = new Set();
let pushOn = true;
let pushMode = 'ok';
const fakePush = async (userId, payload) => {
  pushCalls.push({ userId, payload }); everyPushUser.add(userId);
  if (pushMode === 'ok') db.prepare("UPDATE chat_push_subscriptions SET last_success_at = datetime('now'), last_error_at = NULL WHERE user_id = ?").run(userId);
  else db.prepare("UPDATE chat_push_subscriptions SET last_error = 'network: fake', last_error_at = datetime('now') WHERE user_id = ?").run(userId);
};
const env = {};
const setEnv = (o) => { for (const k of Object.keys(env)) delete env[k]; Object.assign(env, o); };
const ON = { OPS_MONITOR_ENABLED: '1', OPS_WEBHOOK_ENABLED: '1', OPS_WEBHOOK_URL: P_URL, OPS_WEBHOOK_KEY: P_KEY,
  OPS_WEBHOOK_CONTROLLER_URL: C_URL, OPS_WEBHOOK_CONTROLLER_KEY: C_KEY, NODE_ENV: 'test' };
const start = (extra = {}) => M.startOpsMonitor(db, { env, now: () => clock, log, pushToUser: fakePush, pushEnabled: () => pushOn, loop: false, ...extra });
const tickAt = async (ms) => { clock = ms; return M.tickOpsMonitor(); };

const MDT = (d, hm) => Date.parse(`${d}T${hm}:00-06:00`);
const MST = (d, hm) => Date.parse(`${d}T${hm}:00-07:00`);
const sqlT = (ms) => new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
const alertsChannels = () => db.prepare("SELECT * FROM chat_channels WHERE LOWER(name) = 'alerts'").all();
const alertsCh = () => db.prepare("SELECT * FROM chat_channels WHERE name = 'alerts' AND kind = 'private' AND (archived IS NULL OR archived = 0)").get();
const posts = () => { const c = alertsCh(); return c ? db.prepare('SELECT * FROM chat_messages WHERE channel_id = ? ORDER BY created_at').all(c.id) : []; };
const incidents = (key) => db.prepare('SELECT * FROM ops_monitor_incidents WHERE incident_key = ? ORDER BY id').all(key);
const resetIncidents = () => { db.prepare('DELETE FROM ops_monitor_incidents').run(); };
const resetHooks = () => { db.prepare('DELETE FROM ops_webhook_log').run(); };
let rowN = 0;
const hookRow = (target, status, firstMs, lastMs, { attempts = 2, error = 'HTTP 500 · server error', http = 500 } = {}) =>
  db.prepare(`INSERT INTO ops_webhook_log (dedupe_id, target, status, attempts, last_http_status, last_error, first_attempt_at, last_attempt_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(`d-${++rowN}`, target, status, attempts, status === 'sent' ? 200 : http,
    status === 'sent' ? null : error, new Date(firstMs).toISOString(), new Date(lastMs).toISOString(), firstMs);

// ════════════════════════════════════════════════════════════════════════════
console.log('── 1. flag off');
setEnv({ OPS_WEBHOOK_ENABLED: '1', OPS_WEBHOOK_URL: P_URL, OPS_WEBHOOK_KEY: P_KEY });
const st0 = M.startOpsMonitor(db, { env, now: () => clock, log, pushToUser: fakePush, pushEnabled: () => pushOn });
t('no timer is started', st0.timer === null);
t('ticking does nothing', (await tickAt(MDT('2026-10-28', '10:00'))) === null);
t('no incident table is created', !db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'ops_monitor_incidents'").get());
t('no #alerts channel is created', alertsChannels().length === 0);
t('nothing is pushed', pushCalls.length === 0);
t('the status says disabled, and only that', JSON.stringify(M.opsMonitorStatus(db, env)) === JSON.stringify({ enabled: false, window: 'Mon–Fri 7:00 AM–5:00 PM MT', silence_minutes: 120, webhook_minutes: 15 }));
const cfgProd = M.monitorConfig({ OPS_MONITOR_TICK_MS: '1000', OPS_MONITOR_TEST_WALL: 'Wed 10:00' });
t('the test-only overrides are ignored outside NODE_ENV=test', cfgProd.tickMs === 60000 && cfgProd.testWall === null);

console.log('── 2. (a) webhook: 15 minutes straight, one alert, one recovery');
setEnv(ON); start();
t('turning it on creates #alerts once: private, one member, the recipient as owner', (() => {
  const c = alertsChannels(); if (c.length !== 1 || c[0].kind !== 'private') return false;
  const m = db.prepare('SELECT user_id, role FROM chat_channel_members WHERE channel_id = ?').all(c[0].id);
  return m.length === 1 && m[0].user_id === LOWRY && m[0].role === 'owner';
})());
start();
t('starting again creates no second channel', alertsChannels().length === 1);
const W0 = MDT('2026-10-28', '10:00');
let r = await tickAt(W0);
t('no live tokens: silence reports no_bots', r.find(e => e.key === 'bot-silence').reason === 'no_bots');
hookRow('procurement', 'pending', W0, W0 + 13 * 60000, { error: `POST ${P_URL} with ${P_KEY} → HTTP 500` });
await tickAt(W0 + 14 * 60000);
t('14 minutes of errors: no alert', posts().length === 0 && pushCalls.length === 0 && incidents('webhook:procurement').length === 0);
await tickAt(W0 + 15 * 60000);
let inc = incidents('webhook:procurement');
t('15 minutes: one incident, one post, one push', inc.length === 1 && posts().length === 1 && pushCalls.length === 1, `${inc.length} ${posts().length} ${pushCalls.length}`);
const firstPost = posts()[0];
t('the post is by ReadyBot', firstPost?.user_id === readyBot.id);
t('the post has no @ and names the target and what to check', !firstPost.body.includes('@') && /procurement/.test(firstPost.body) && /ops-monitor\/status/.test(firstPost.body) && /\bMT\b/.test(firstPost.body));
const ch = alertsCh();
const p0 = pushCalls[0];
t('the push: recipient only, channel tag, deep link, short body', p0.userId === LOWRY && p0.payload.tag === `channel-${ch.id}` && p0.payload.url === `/?c=${ch.id}&m=${firstPost.id}`
  && p0.payload.body.length <= 120 && p0.payload.renotify === true && p0.payload.title === 'ReadyDoc alert: bots', JSON.stringify(p0.payload));
t('the incident records the post and the push as sent', inc[0].alert_message_id === firstPost.id && inc[0].alert_push === 'sent' && !!inc[0].alert_at);
await tickAt(W0 + 16 * 60000);
await tickAt(W0 + 30 * 60000);
t('later ticks send nothing more', posts().length === 1 && pushCalls.length === 1);
hookRow('procurement', 'sent', W0 + 31 * 60000, W0 + 31 * 60000);
await tickAt(W0 + 32 * 60000);
inc = incidents('webhook:procurement');
t('a delivery after the errors closes it with ONE recovery', inc[0].recovered_at && posts().length === 2 && pushCalls.length === 2 && /recovered/i.test(posts()[1].body), posts().map(p => p.body.slice(0, 30)).join(' | '));
t('the recovery says it is seen on the next delivery', /next successful delivery/.test(posts()[1].body) && pushCalls[1].payload.title === 'ReadyDoc: bots recovered');
await tickAt(W0 + 40 * 60000);
t('nothing after the recovery', posts().length === 2);
hookRow('procurement', 'failed', W0 + 50 * 60000, W0 + 62 * 60000);
await tickAt(W0 + 64 * 60000);
t('a new failure, 14 minutes in: nothing', incidents('webhook:procurement').length === 1);
await tickAt(W0 + 65 * 60000);
t('a later failure is a NEW incident with its own alert', incidents('webhook:procurement').length === 2 && posts().length === 3);
hookRow('procurement', 'sent', W0 + 66 * 60000, W0 + 66 * 60000);
await tickAt(W0 + 67 * 60000);
t('…and its own recovery', posts().length === 4 && incidents('webhook:procurement')[1].recovered_at);

console.log('── 3. (a) what is not "straight", and what is not watched');
resetHooks(); resetIncidents(); pushCalls = [];
const W1 = MDT('2026-10-28', '11:00');
hookRow('procurement', 'failed', W1, W1 + 4 * 60000);
hookRow('procurement', 'sent', W1 + 5 * 60000, W1 + 5 * 60000);
hookRow('procurement', 'pending', W1 + 6 * 60000, W1 + 14 * 60000);
await tickAt(W1 + 16 * 60000);
t('a success in the middle: the errors are not straight, no incident', incidents('webhook:procurement').length === 0);
resetHooks();
hookRow('procurement', 'rate_limited', W1, W1 + 30 * 60000);
await tickAt(W1 + 40 * 60000);
t('rate_limited rows are not errors', incidents('webhook:procurement').length === 0);
resetHooks();
setEnv({ ...ON, OPS_WEBHOOK_CONTROLLER_URL: '' });
hookRow('controller', 'failed', W1, W1 + 30 * 60000);
r = await tickAt(W1 + 40 * 60000);
t('a target with no URL is never evaluated', incidents('webhook:controller').length === 0 && r.find(e => e.key === 'webhook:controller').state === 'not_evaluated');
setEnv({ ...ON, OPS_WEBHOOK_ENABLED: '' });
hookRow('procurement', 'failed', W1, W1 + 30 * 60000);
await tickAt(W1 + 41 * 60000);
t('with the webhook flag off, nothing is evaluated', incidents('webhook:procurement').length === 0 && incidents('webhook:controller').length === 0);
setEnv(ON); resetHooks(); pushCalls = [];
hookRow('procurement', 'failed', W1, W1 + 20 * 60000);
hookRow('controller', 'failed', W1, W1 + 20 * 60000);
await tickAt(W1 + 20 * 60000);
t('procurement and controller are separate incidents, one alert each', incidents('webhook:procurement').length === 1 && incidents('webhook:controller').length === 1 && pushCalls.length === 2);
hookRow('procurement', 'sent', W1 + 21 * 60000, W1 + 21 * 60000);
await tickAt(W1 + 22 * 60000);
t('procurement recovering leaves controller open', incidents('webhook:procurement')[0].recovered_at && !incidents('webhook:controller')[0].recovered_at && pushCalls.length === 3);

console.log('── 4. a restart resends nothing');
start();
await tickAt(W1 + 30 * 60000);
t('after a restart, the open controller incident is not alerted again', pushCalls.length === 3);
hookRow('controller', 'sent', W1 + 31 * 60000, W1 + 31 * 60000);
await tickAt(W1 + 32 * 60000);
start();
await tickAt(W1 + 33 * 60000);
t('one recovery after the restart, none repeated after another', pushCalls.length === 4);
const switchedOff = async () => {
  resetHooks(); resetIncidents(); pushCalls = [];
  hookRow('controller', 'failed', W1, W1 + 20 * 60000);
  await tickAt(W1 + 20 * 60000);
  setEnv({ ...ON, OPS_WEBHOOK_CONTROLLER_KEY: '' });
  await tickAt(W1 + 21 * 60000);
  setEnv(ON);
  return pushCalls;
};
const so = await switchedOff();
t('switching a target off clears it, and says so rather than "recovered"', so.length === 2 && /switched off/.test(so[1].payload.body) && /switched off/.test(posts().at(-1).body));

console.log('── 5. (b) bot silence with the 120-minute default');
resetHooks(); resetIncidents(); pushCalls = [];
db.prepare("INSERT OR REPLACE INTO api_tokens (id, user_id, label, token_prefix, token_hash) VALUES ('tk-bot', 'u-bot', 'procurement (test)', 'rdk_', 'h-bot')").run();
const seen = (ms) => db.prepare('UPDATE api_tokens SET last_used_at = ? WHERE id = ?').run(ms === null ? null : sqlT(ms), 'tk-bot');
const clearBotPosts = () => db.prepare("DELETE FROM chat_messages WHERE user_id IN ('u-bot','u-bot2','u-person','u-runner') OR (user_id = ? AND channel_id = 'ch-ops')").run(readyBot.id);
const fresh = () => { resetIncidents(); pushCalls = []; seen(null); clearBotPosts(); };
const D = '2026-10-28';
fresh(); seen(MDT(D, '07:00'));
await tickAt(MDT(D, '08:59'));
t('8:59 with a bot last seen at 7:00: no alert', incidents('bot-silence').length === 0);
await tickAt(MDT(D, '09:00'));
t('9:00: one alert', incidents('bot-silence').length === 1 && pushCalls.length === 1 && /No bot seen for 2 h 00 min/.test(pushCalls[0].payload.body), pushCalls[0]?.payload.body);
await tickAt(MDT(D, '09:01'));
t('9:01: nothing more', pushCalls.length === 1);
seen(MDT(D, '09:30'));
await tickAt(MDT(D, '09:30'));
t('a token use at 9:30: one recovery', pushCalls.length === 2 && incidents('bot-silence')[0].recovered_at && /seen again/.test(pushCalls[1].payload.body));

// Run a day minute by minute, with sightings as given; returns the incident/recovery times.
const day = async (mk, d, sightings, from = '07:00', to = '17:00') => {
  fresh();
  const times = sightings.map(hm => mk(d, hm)).sort((a, b) => a - b);
  const out = { opened: [], recovered: [] };
  for (let ms = mk(d, from); ms <= mk(d, to); ms += 60000) {
    const last = times.filter(x => x <= ms).at(-1);
    seen(last ?? null);
    const before = incidents('bot-silence').map(i => `${i.id}:${!!i.recovered_at}`).join();
    await tickAt(ms);
    for (const i of incidents('bot-silence')) {
      if (!before.includes(`${i.id}:`)) out.opened.push(ms);
      if (i.recovered_at && !before.includes(`${i.id}:true`)) out.recovered.push(ms);
    }
  }
  return out;
};
const hm = (ms) => new Intl.DateTimeFormat('en-US', { timeZone: 'America/Denver', hour: 'numeric', minute: '2-digit' }).format(new Date(ms));
let o = await day(MDT, D, ['07:12', '08:55', '10:20', '11:49', '13:25', '14:50', '16:20']);
t('Procurement\'s 90-minute checks, seen late: no incident all day', o.opened.length === 0, o.opened.map(hm).join());
o = await day(MDT, D, ['08:37', '10:32'], '07:00', '10:40');
t('the longest normal gap (8:37 → 10:32, 115 min): no incident', o.opened.length === 0, o.opened.map(hm).join());
o = await day(MDT, D, ['07:12', '08:55', '10:20', '13:25', '14:50', '16:20']);
t('the 11:49 sighting missing: one incident at 12:20', o.opened.length === 1 && o.opened[0] === MDT(D, '12:20'), o.opened.map(hm).join());
t('…and the 1:25 sighting sends one recovery', o.recovered.length === 1 && o.recovered[0] === MDT(D, '13:25'), o.recovered.map(hm).join());
o = await day(MDT, D, ['10:00'], '10:00', '11:59');
t('a gap of 119 minutes: no incident', o.opened.length === 0);
o = await day(MDT, D, ['10:00'], '10:00', '12:00');
t('120 minutes: one', o.opened.length === 1 && o.opened[0] === MDT(D, '12:00'));
o = await day(MDT, D, [], '07:00', '09:30');
t('a day with only the P0 sweep (nothing in ReadyDoc): incident at 9:00, as expected', o.opened.length === 1 && o.opened[0] === MDT(D, '09:00'));

console.log('── 6. (b) the window, in MDT and MST');
fresh(); seen(MDT('2026-10-30', '15:00'));
for (const [d, h] of [['2026-10-31', '10:00'], ['2026-10-31', '15:00'], ['2026-11-01', '12:00']]) await tickAt(MDT(d, h));
t('Saturday and Sunday never alert', incidents('bot-silence').length === 0);
fresh(); seen(MDT(D, '01:00'));
await tickAt(MDT(D, '06:59'));
t('6:59 AM does not open one', incidents('bot-silence').length === 0);
fresh(); seen(MDT(D, '07:00'));
await tickAt(MDT(D, '17:01'));
t('5:01 PM does not open one', incidents('bot-silence').length === 0);
fresh(); seen(MDT('2026-10-30', '16:59')); o = { opened: [] };
for (let ms = MST('2026-11-02', '07:00'); ms <= MST('2026-11-02', '09:00'); ms += 60000) {
  await tickAt(ms);
  if (!o.opened.length && incidents('bot-silence').length) o.opened.push(ms);
}
t('a Friday evening silence does not carry into Monday (MST): incident at 9:00, not 7:00', o.opened.length === 1 && o.opened[0] === MST('2026-11-02', '09:00'), o.opened.map(hm).join());
fresh(); seen(MDT(D, '13:00'));
await tickAt(MDT(D, '15:00'));
await tickAt(MDT(D, '17:00'));
await tickAt(MDT(D, '20:00'));
t('an incident open at 5 PM stays open overnight, with one alert', incidents('bot-silence').length === 1 && !incidents('bot-silence')[0].recovered_at && pushCalls.length === 1);
seen(MDT('2026-10-29', '07:10'));
await tickAt(MDT('2026-10-29', '07:10'));
t('…and recovers at the next morning\'s sighting', incidents('bot-silence')[0].recovered_at && pushCalls.length === 2);
fresh(); seen(MST('2026-11-04', '07:00'));
await tickAt(MST('2026-11-04', '08:59'));
const mst1 = incidents('bot-silence').length;
await tickAt(MST('2026-11-04', '09:00'));
t('in MST: 8:59 nothing, 9:00 one', mst1 === 0 && incidents('bot-silence').length === 1);

console.log('── 7. (b) what counts as a bot seen');
fresh();
const NOW = MDT(D, '12:00');
const lastAt = () => M.botSignals(db, NOW).last;
db.prepare("INSERT OR REPLACE INTO chat_channels (id, kind, name, created_by) VALUES ('ch-ops', 'private', 'ops-requests-check', 'u-lowry')").run();
let mN = 0;
const msg = (user, atMs, { parent = null, deleted = false } = {}) => db.prepare('INSERT INTO chat_messages (id, channel_id, user_id, body, parent_id, created_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
  .run(`mm-${++mN}`, 'ch-ops', user, 'x', parent, sqlT(atMs), deleted ? sqlT(atMs) : null);
seen(MDT(D, '08:00'));
t('a live token\'s last use counts', lastAt()?.kind === 'token' && lastAt().at === MDT(D, '08:00'));
msg('u-bot', MDT(D, '09:00'));
t('a bot\'s post counts', lastAt()?.kind === 'post' && lastAt().at === MDT(D, '09:00') && lastAt().name === '*Procurement Bot');
msg('u-bot', MDT(D, '09:30'), { parent: 'mm-1' });
t('a bot\'s thread reply counts', lastAt().at === MDT(D, '09:30'));
msg(readyBot.id, MDT(D, '10:00'));
msg('u-person', MDT(D, '10:05'));
msg('u-runner', MDT(D, '10:10'));
msg('u-bot', MDT(D, '10:15'), { deleted: true });
t('ReadyBot, a person, the Test Runner and a deleted post do not', lastAt().at === MDT(D, '09:30'));
db.prepare("INSERT OR REPLACE INTO api_tokens (id, user_id, label, token_prefix, token_hash, last_used_at, revoked_at) VALUES ('tk-rev', 'u-bot2', 'x', 'rdk_', 'h-rev', ?, ?)").run(sqlT(MDT(D, '11:00')), sqlT(MDT(D, '11:01')));
db.prepare("INSERT OR REPLACE INTO api_tokens (id, user_id, label, token_prefix, token_hash, last_used_at, expires_at) VALUES ('tk-exp', 'u-runner', 'x', 'rdk_', 'h-exp', ?, NULL)").run(sqlT(MDT(D, '11:10')));
db.prepare("INSERT OR REPLACE INTO api_tokens (id, user_id, label, token_prefix, token_hash, last_used_at, expires_at) VALUES ('tk-exp2', 'u-person', 'x', 'rdk_', 'h-exp2', ?, ?)").run(sqlT(MDT(D, '11:20')), sqlT(MDT(D, '11:30')));
t('a revoked token, an expired token and the Test Runner\'s token do not', lastAt().at === MDT(D, '09:30'), String(lastAt()?.at));
db.prepare("DELETE FROM api_tokens WHERE id IN ('tk-rev','tk-exp','tk-exp2')").run();
const alertPost = posts().at(-1);
t('the monitor\'s own #alerts posts (ReadyBot) never count', !!alertPost && alertPost.user_id === readyBot.id && lastAt().at === MDT(D, '09:30'));
db.prepare("UPDATE api_tokens SET revoked_at = datetime('now') WHERE id = 'tk-bot'").run();
t('no live token at all: no_bots, no incident', M.silenceCheck(db, NOW, M.monitorConfig(ON)).reason === 'no_bots');
db.prepare("UPDATE api_tokens SET revoked_at = NULL WHERE id = 'tk-bot'").run();
clearBotPosts();

console.log('── 8. the recipient');
const cfg = (o = {}) => M.monitorConfig({ ...ON, ...o });
t('resolved by email, case-insensitive', M.resolveRecipient(db, cfg()).status === 'resolved' && M.resolveRecipient(db, cfg()).user.id === LOWRY);
db.prepare("UPDATE users SET email = NULL WHERE id = 'u-lowry'").run();
t('no email match: OPS_MONITOR_USER_ID resolves it', M.resolveRecipient(db, cfg({ OPS_MONITOR_USER_ID: 'u-lowry' })).user?.id === LOWRY);
t('no email and no id: not_found', M.resolveRecipient(db, cfg()).status === 'not_found');
db.prepare("UPDATE users SET is_active = 0 WHERE id = 'u-lowry'").run();
t('an inactive account by id: not_found', M.resolveRecipient(db, cfg({ OPS_MONITOR_USER_ID: 'u-lowry' })).status === 'not_found');
db.prepare("UPDATE users SET is_active = 1, email = 'lowry@powder-ops.com' WHERE id = 'u-lowry'").run();
db.prepare("UPDATE users SET is_active = 0 WHERE id = 'u-lowry'").run();
t('an inactive account by email: not_found', M.resolveRecipient(db, cfg()).status === 'not_found');
db.prepare("UPDATE users SET is_active = 1 WHERE id = 'u-lowry'").run();
mkUser('u-dup', 'Twin', 'operator', 'LOWRY@powder-ops.com');
t('two matching accounts: ambiguous', M.resolveRecipient(db, cfg()).status === 'ambiguous');
db.prepare("DELETE FROM users WHERE id = 'u-dup'").run();
db.prepare("UPDATE users SET email = 'Lowry@Powder-Ops.com' WHERE id = 'u-lowry'").run();

console.log('── 9. #alerts: only the recipient, or nothing is posted');
resetHooks(); resetIncidents(); pushCalls = [];
const chId = alertsCh().id;
db.prepare("INSERT INTO chat_channel_members (id, channel_id, user_id, role) VALUES ('mem-extra', ?, 'u-admin2', 'member')").run(chId);
const W2 = MDT('2026-10-28', '13:00');
seen(W2);
hookRow('procurement', 'failed', W2, W2 + 20 * 60000);
let before = posts().length;
await tickAt(W2 + 20 * 60000);
t('a second member: nothing posted, push only (ops-monitor tag, home url)', posts().length === before && pushCalls.length === 1 && pushCalls[0].payload.tag === 'ops-monitor' && pushCalls[0].payload.url === '/');
t('…its members and kind are untouched and no second channel exists', db.prepare('SELECT COUNT(*) n FROM chat_channel_members WHERE channel_id = ?').get(chId).n === 2 && alertsChannels().length === 1 && alertsCh()?.id === chId);
t('…and the status says unsafe', M.opsMonitorStatus(db, env, W2 + 20 * 60000, { pushEnabled: () => true }).alerts_channel === 'unsafe');
t('the push still counts as delivered', incidents('webhook:procurement')[0].alert_push === 'sent' && !!incidents('webhook:procurement')[0].alert_at);
db.prepare("DELETE FROM chat_channel_members WHERE id = 'mem-extra'").run();
hookRow('procurement', 'sent', W2 + 21 * 60000, W2 + 21 * 60000);
await tickAt(W2 + 22 * 60000);
t('the member removed: the recovery posts again', posts().length === before + 1);
// A member added between two alerts is caught before the second post.
resetHooks(); resetIncidents(); pushCalls = []; before = posts().length;
hookRow('procurement', 'failed', W2, W2 + 20 * 60000);
await tickAt(W2 + 20 * 60000);
db.prepare("INSERT INTO chat_channel_members (id, channel_id, user_id, role) VALUES ('mem-extra2', ?, 'u-person', 'member')").run(chId);
hookRow('procurement', 'sent', W2 + 21 * 60000, W2 + 21 * 60000);
await tickAt(W2 + 22 * 60000);
t('a member added after the alert is caught before the recovery post', posts().length === before + 1 && pushCalls.length === 2 && pushCalls[1].payload.tag === 'ops-monitor');
db.prepare("DELETE FROM chat_channel_members WHERE id = 'mem-extra2'").run();
// A public channel named alerts.
db.prepare('UPDATE chat_channels SET archived = 1 WHERE id = ?').run(chId);
db.prepare("INSERT INTO chat_channels (id, kind, name, created_by) VALUES ('ch-pub-alerts', 'public', 'Alerts', 'u-admin2')").run();
db.prepare("INSERT INTO chat_channel_members (id, channel_id, user_id, role) VALUES ('mem-pub', 'ch-pub-alerts', 'u-lowry', 'member')").run();
const ens = M.ensureAlertsChannel(db, { id: LOWRY });
t('a public channel named alerts (after ours was archived) is unsafe and no second is made', ens.status === 'unsafe' && alertsChannels().length === 2);
db.prepare("DELETE FROM chat_channel_members WHERE channel_id = 'ch-pub-alerts'").run();
db.prepare("DELETE FROM chat_channels WHERE id = 'ch-pub-alerts'").run();
db.prepare('UPDATE chat_channels SET archived = 0 WHERE id = ?').run(chId);
t('ours is reused once the clash is gone', M.ensureAlertsChannel(db, { id: LOWRY }).channel?.id === chId);

console.log('── 10. what the push did');
const runAlert = async () => {
  resetHooks(); resetIncidents(); pushCalls = [];
  hookRow('procurement', 'failed', W2, W2 + 20 * 60000);
  await tickAt(W2 + 20 * 60000);
  return incidents('webhook:procurement')[0];
};
pushOn = false; before = posts().length;
inc = await runAlert();
t('push disabled: the post still lands, alert_push = disabled', posts().length === before + 1 && inc.alert_push === 'disabled' && !!inc.alert_at && pushCalls.length === 0);
pushOn = true;
db.prepare("DELETE FROM chat_push_subscriptions WHERE user_id = 'u-lowry'").run();
inc = await runAlert();
t('no subscription: alert_push = none, post delivered', inc.alert_push === 'none' && !!inc.alert_at && pushCalls.length === 0);
t('…and the status says no phone subscribed', M.opsMonitorStatus(db, env, W2, { pushEnabled: () => true }).push_ready.phone_subscribed === false);
addSub(LOWRY, 'lowry');
M.startOpsMonitor(db, { env, now: () => clock, log, pushToUser: realPush, pushEnabled: () => true, loop: false });
before = posts().length;
inc = await runAlert();
t('a real push to an unreachable endpoint: alert_push = failed, the post unaffected', inc.alert_push === 'failed' && posts().length === before + 1 && !!inc.alert_at, inc.alert_push);
t('…the subscription row shows the attempt', !!db.prepare("SELECT last_error_at FROM chat_push_subscriptions WHERE user_id = 'u-lowry'").get()?.last_error_at);
await tickAt(W2 + 30 * 60000);
t('a failed push never repeats the alert', posts().length === before + 1 && incidents('webhook:procurement').length === 1);
start();

console.log('── 11. nothing delivered: unalerted, retried 5-minutely, at most 6 times');
resetHooks(); resetIncidents(); pushCalls = [];
db.prepare("UPDATE users SET email = NULL WHERE id = 'u-lowry'").run();
hookRow('procurement', 'failed', W2, W2 + 20 * 60000);
await tickAt(W2 + 20 * 60000);
inc = incidents('webhook:procurement')[0];
t('no recipient: unalerted, attempt 1, nobody pushed', !inc.alert_at && inc.alert_attempts === 1 && pushCalls.length === 0 && /not_found/.test(inc.last_alert_error));
t('…the status marks it unalerted and says not_found', (() => { const s = M.opsMonitorStatus(db, env, W2 + 20 * 60000, { pushEnabled: () => true }); return s.recipient === 'not_found' && s.open[0]?.unalerted === true; })());
await tickAt(W2 + 21 * 60000);
t('no retry inside 5 minutes', incidents('webhook:procurement')[0].alert_attempts === 1);
for (let k = 1; k <= 8; k++) await tickAt(W2 + (20 + 5 * k) * 60000);
t('retried at most 6 times, then left visible', incidents('webhook:procurement')[0].alert_attempts === 6 && !incidents('webhook:procurement')[0].recovered_at);
t('one warning per incident about the recipient', logs.filter(l => /no recipient \(not_found\)/.test(l)).length === 1);
db.prepare("UPDATE users SET email = 'Lowry@Powder-Ops.com' WHERE id = 'u-lowry'").run();
before = posts().length;
hookRow('procurement', 'sent', W2 + 70 * 60000, W2 + 70 * 60000);
await tickAt(W2 + 71 * 60000);
t('it clears with NO recovery alert, since no alert was delivered', incidents('webhook:procurement')[0].recovered_at && posts().length === before && pushCalls.length === 0);
// Channel unsafe AND push disabled = nothing delivered.
resetHooks(); resetIncidents(); pushOn = false;
db.prepare("INSERT INTO chat_channel_members (id, channel_id, user_id, role) VALUES ('mem-x3', ?, 'u-admin2', 'member')").run(chId);
hookRow('procurement', 'failed', W2, W2 + 20 * 60000);
await tickAt(W2 + 20 * 60000);
t('channel unsafe and push disabled: unalerted', !incidents('webhook:procurement')[0].alert_at && incidents('webhook:procurement')[0].alert_push === 'disabled');
db.prepare("DELETE FROM chat_channel_members WHERE id = 'mem-x3'").run(); pushOn = true;

console.log('── 12. dedupe');
let threw = false;
try { db.prepare("INSERT INTO ops_monitor_incidents (incident_key, kind, opened_at) VALUES ('webhook:procurement', 'webhook', 'x')").run(); } catch { threw = true; }
t('never two open incidents with one key', threw);

console.log('── 13. scrubbing');
const everything = [logs.join('\n'), posts().map(p => p.body).join('\n'), JSON.stringify(pushCalls),
  JSON.stringify(M.opsMonitorStatus(db, env, W2, { pushEnabled: () => true })), JSON.stringify(db.prepare('SELECT * FROM ops_monitor_incidents').all())].join('\n');
t('no URL or key in any post, push, log, incident or status', !SECRETS.some(s => everything.includes(s)), SECRETS.find(s => everything.includes(s)));
t('the first alert quoted the error with the URL and key redacted', /\[redacted\]/.test(firstPost.body));

console.log('── 14. the status route');
const router = (await import('../server/api/ops-monitor-admin.js')).default;
const handle = router.stack.find(l => l.route?.path === '/status').route.stack[0].handle;
const call = (req) => { let out = {}; const res = { status(c) { out.status = c; return this; }, json(b) { out.body = b; out.status = out.status || 200; return this; } }; handle(req, res); return out; };
const prevEnv = { ...process.env };
Object.assign(process.env, ON);
let res = call({ user: { id: LOWRY, role: 'admin' }, auth: { kind: 'session' } });
t('admin session: 200', res.status === 200 && res.body.enabled === true);
const body = JSON.stringify(res.body);
t('…naming no URL, key, account id or email', !SECRETS.some(s => body.includes(s)) && !body.includes(LOWRY) && !/powder-ops\.com/i.test(body) && !body.includes(chId));
t('bot token: 403', call({ user: { id: 'u-bot', role: 'admin', via_token: true }, auth: { kind: 'token' } }).status === 403);
t('no auth: 401', call({}).status === 401);
t('non-admin: 403', call({ user: { id: 'u-person', role: 'operator' }, auth: { kind: 'session' } }).status === 403);
t('the router has exactly one route, a GET', router.stack.filter(l => l.route).length === 1 && router.stack[0].route.methods.get === true);
for (const k of Object.keys(process.env)) if (!(k in prevEnv)) delete process.env[k];
Object.assign(process.env, prevEnv);

console.log('── 15. no email, no new dependency');
const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
let mainPkg = null;
try { mainPkg = JSON.parse(execSync('git show origin/main:package.json', { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })); } catch { /* no origin in this checkout */ }
t('dependencies unchanged from main', !mainPkg || JSON.stringify(pkg.dependencies) === JSON.stringify(mainPkg.dependencies));
const src = ['server/ops-monitor.js', 'server/api/ops-monitor-admin.js'].map(f => readFileSync(path.join(root, f), 'utf8')).join('\n');
t('no mail sender, SMTP or MAIL_ variable, no direct web-push', !/smtp|nodemailer|sendmail|MAIL_|sendgrid|mailgun/i.test(src) && !/from 'web-push'/.test(src));
t('pushToUser was only ever called with the recipient, in every test', everyPushUser.size === 1 && everyPushUser.has(LOWRY));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
