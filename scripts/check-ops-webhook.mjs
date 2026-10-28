#!/usr/bin/env node
// check:opswebhook — server/ops-webhook.js on a scratch database with a fake
// fetch and a fake clock (D-251). Every URL and key here is obviously fake;
// nothing leaves the process.
import { spawnSync } from 'child_process';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const t = (n, ok, d = '') => { if (ok) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n}${d ? ' — ' + d : ''}`); } };
const tmp = mkdtempSync(path.join(tmpdir(), 'ops-webhook-'));
process.on('exit', () => { try { rmSync(tmp, { recursive: true, force: true }); } catch { /* best effort */ } });

const dbPath = path.join(tmp, 'app.db');
const boot = spawnSync(process.execPath, ['-e', "import('./server/db.js').then(m => { m.getDb(); process.exit(0); })"],
  { cwd: root, env: { ...process.env, DB_PATH: dbPath, NODE_ENV: 'test' }, encoding: 'utf8' });
if (boot.status !== 0) { console.error(boot.stderr); process.exit(1); }
process.env.READYDOC_ORIGIN = 'https://app.powder-ops.com';
const W = await import('../server/ops-webhook.js');
const db = new Database(dbPath);

const P_URL = 'https://fake-hooks.invalid/automations/webhook/procROUTINE123456', P_KEY = 'crsr_fakeProcurementKey000';
const C_URL = 'https://fake-hooks.invalid/automations/webhook/ctrlROUTINE654321', C_KEY = 'crsr_fakeControllerKey000';
const env = {};
let clock = 1_800_000_000_000;
let calls = [];
let responder = () => ({ status: 200, body: JSON.stringify({ success: true, runUuid: 'r' }) });
const logs = [];
const log = { log: (m) => logs.push(m), warn: (m) => logs.push(m), error: (m) => logs.push(m) };
const fakeFetch = async (url, opts) => {
  calls.push({ url, opts, body: JSON.parse(opts.body) });
  const r = responder(url, opts);
  if (r instanceof Error) throw r;
  return { status: r.status, text: async () => r.body };
};
const init = () => W.initOpsWebhook(db, { fetch: fakeFetch, now: () => clock, log, env, random: () => 0.5, loop: false });
const setEnv = (o) => { for (const k of Object.keys(env)) delete env[k]; Object.assign(env, o); };
const settle = async () => { await new Promise(r => setImmediate(r)); await W.pumpOpsWebhook(); };
const reset = () => { db.prepare('DELETE FROM ops_webhook_log').run(); calls = []; responder = () => ({ status: 200, body: JSON.stringify({ success: true }) }); };

const person = { id: 'u-marnee', name: 'Marnee Dortch' };
const procBot = { id: 'u-proc', name: '*Procurement Bot' };
const ctrlBot = { id: 'u-ctrl', name: '*Controller Bot' };
const tokenHolder = { id: 'u-tok', name: 'Plain Name Bot' };
const now = (() => { const ins = db.prepare('INSERT OR REPLACE INTO users (id, name, username, role, department, is_active) VALUES (?, ?, ?, ?, ?, 1)');
  for (const u of [person, procBot, ctrlBot, tokenHolder]) ins.run(u.id, u.name, u.name, 'operator', 'office');
  db.prepare("INSERT INTO api_tokens (id, user_id, label, token_prefix, token_hash) VALUES ('tk1','u-tok','x','rdk_','h1')").run();
  return null; })();
void now;
const ops = { id: 'ch-ops', name: 'ops-requests', kind: 'private' };
const opsTest = { id: 'ch-test', name: 'ops-requests-test', kind: 'private' };
const general = { id: 'ch-gen', name: 'general', kind: 'public' };
const dm = { id: 'ch-dm', name: 'ops-requests', kind: 'dm' };
let n = 0;
const msg = (body, parent = null) => ({ id: `m-${++n}`, body, parent_id: parent, created_at: '2026-10-27 21:15:03.120' });
const post = async (channel, author, body, { parent = null, viaToken = false, attachments = 0 } = {}) => {
  const m = msg(body, parent);
  const r = W.enqueueOpsWebhook({ channel, message: m, author, viaToken, attachmentCount: attachments });
  await settle();
  return { m, r };
};

console.log('── off unless the flag and a URL + key are set');
setEnv({}); init();
await post(ops, person, 'Where is PO00613?');
t('flag unset: no call', calls.length === 0);
setEnv({ OPS_WEBHOOK_ENABLED: '1' }); init();
await post(ops, person, 'Where is PO00613?');
t('flag on, nothing configured: no call', calls.length === 0);
setEnv({ OPS_WEBHOOK_URL: P_URL, OPS_WEBHOOK_KEY: P_KEY }); init();
await post(ops, person, 'Where is PO00613?');
t('URL + key set but flag off: no call', calls.length === 0);
t('the startup line names the targets and never a URL or key', logs.some(l => /procurement off \(flag off\)/.test(l)) && !logs.join('\n').includes(P_KEY) && !logs.join('\n').includes(P_URL));

console.log('── procurement: a person, in the two channels');
setEnv({ OPS_WEBHOOK_ENABLED: '1', OPS_WEBHOOK_URL: P_URL, OPS_WEBHOOK_KEY: P_KEY }); init(); reset();
const top = await post(ops, person, 'Where is PO00613?');
t('one POST for a top-level post', calls.length === 1 && calls[0].url === P_URL, String(calls.length));
const c0 = calls[0];
t('headers: JSON, the procurement key, the dedupe id', c0?.opts.headers['Content-Type'] === 'application/json'
  && c0.opts.headers.Authorization === `Bearer ${P_KEY}` && c0.opts.headers['X-Powder-Ops-Dedupe'] === `ch-ops:${top.m.id}:procurement`);
t('no signature header without a signing secret', !('X-Powder-Ops-Signature' in (c0?.opts.headers || {})));
const b = c0?.body || {};
t('payload: event, version, target, thread = own id, top-level', b.event === 'ops_request.message' && b.version === 1 && b.target === 'procurement'
  && b.thread_id === top.m.id && b.is_top_level === true && b.channel?.name === 'ops-requests', JSON.stringify(b));
t('payload: author, text, ISO timestamp ending in Z, link', b.author?.name === 'Marnee Dortch' && b.text === 'Where is PO00613?' && b.text_truncated === false
  && b.timestamp === '2026-10-27T21:15:03.120Z' && b.link === `https://app.powder-ops.com/?c=ch-ops&m=${top.m.id}`, JSON.stringify(b));
t('marked sent', db.prepare('SELECT status FROM ops_webhook_log').get()?.status === 'sent');
reset();
const reply = await post(ops, person, 'Any update?', { parent: top.m.id });
t('a thread reply: thread = parent, not top-level, one POST', calls.length === 1 && calls[0].body.thread_id === top.m.id && calls[0].body.is_top_level === false);
reset(); await post(opsTest, person, '[TEST] Where is PO00619?');
t('#ops-requests-test fires too', calls.length === 1 && calls[0].body.channel.name === 'ops-requests-test');
reset(); await post(general, person, 'Where is PO00613?'); await post(dm, person, 'Where is PO00613?');
await post({ id: 'ch-x', name: 'ops-requests-2', kind: 'private' }, person, 'hi');
await post({ ...ops, archived: 1 }, person, 'hi');
t('#general, a DM, a look-alike name and an archived channel: no call', calls.length === 0, String(calls.length));
reset(); await post(ops, person, '', { attachments: 1 });
t('an attachment with no text still fires', calls.length === 1 && calls[0].body.attachment_count === 1);
reset(); await post(ops, person, '   ');
t('an empty message does not fire', calls.length === 0);
reset(); setEnv({ ...env, OPS_WEBHOOK_CHANNELS: 'general' }); init(); await post(general, person, 'x');
t('OPS_WEBHOOK_CHANNELS is ignored: the list is in code', calls.length === 0 && W.OPS_CHANNELS.length === 2);

console.log('── bots never wake procurement (no loops)');
reset();
await post(ops, procBot, 'PO00613 shipped 10/20.', { parent: top.m.id });
await post(ops, ctrlBot, 'Paid 10/21.', { parent: top.m.id });
await post(ops, tokenHolder, 'hello');
await post(ops, person, 'via token', { viaToken: true });
await post(ops, { id: 'rb', name: 'ReadyBot' }, 'nudge');
t('a *-named bot, a token holder, a token post and ReadyBot: no call', calls.length === 0, String(calls.length));

console.log('── the Test Runner (D-252)');
db.prepare("INSERT OR REPLACE INTO users (id, name, username, role, department, is_active) VALUES ('u-runner','Test Runner','Test Runner','operator','office',1)").run();
db.prepare("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('test_runner_user_id', 'u-runner')").run();
const runner = { id: 'u-runner', name: 'Test Runner' };
const impostor = { id: 'u-impostor', name: 'Test Runner' };
reset();
await post(opsTest, runner, '[TEST] Where is PO00613?', { viaToken: true });
t('its token post in #ops-requests-test wakes Procurement', calls.length === 1 && calls[0].body.target === 'procurement' && calls[0].body.author.name === 'Test Runner');
reset();
await post(ops, runner, 'Where is PO00613?', { viaToken: true });
await post(general, runner, 'x', { viaToken: true });
await post(opsTest, impostor, '[TEST] x', { viaToken: true });
t('in #ops-requests or anywhere else it fires nothing, and the name alone is not the account', calls.length === 0, String(calls.length));
setEnv({ OPS_WEBHOOK_URL: P_URL, OPS_WEBHOOK_KEY: P_KEY }); init(); reset();
await post(opsTest, runner, '[TEST] x', { viaToken: true });
t('with the flag off it fires nothing', calls.length === 0);
setEnv({ OPS_WEBHOOK_ENABLED: '1', OPS_WEBHOOK_URL: P_URL, OPS_WEBHOOK_KEY: P_KEY }); init(); reset();

console.log('── controller: only *Procurement Bot replying "→ Controller"');
setEnv({ OPS_WEBHOOK_ENABLED: '1', OPS_WEBHOOK_URL: P_URL, OPS_WEBHOOK_KEY: P_KEY }); init(); reset();
await post(ops, procBot, '→ Controller Paid?: Stauber invoice 4471', { parent: top.m.id });
t('controller URL unset: no call at all', calls.length === 0);
setEnv({ ...env, OPS_WEBHOOK_CONTROLLER_URL: C_URL, OPS_WEBHOOK_CONTROLLER_KEY: C_KEY }); init(); reset();
const h = await post(ops, procBot, '  → Controller Paid?: Stauber invoice 4471', { parent: top.m.id });
t('one POST to the controller URL with the controller key', calls.length === 1 && calls[0].url === C_URL && calls[0].opts.headers.Authorization === `Bearer ${C_KEY}`);
t('target controller, dedupe names it, no procurement call', calls[0]?.body.target === 'controller' && calls[0]?.body.dedupe_id === `ch-ops:${h.m.id}:controller`
  && !calls.some(c => c.url === P_URL));
reset();
await post(ops, person, '→ Controller Paid?: x', { parent: top.m.id }); // fires PROCUREMENT (a person), never controller
const personCalls = calls.map(c => c.body.target);
calls = [];
await post(ops, ctrlBot, '→ Controller Paid?: x', { parent: top.m.id });
await post(ops, procBot, '→ Forecast PO', { parent: top.m.id });
await post(ops, procBot, '→ Controller Paid?: x');
await post(ops, procBot, 'Handing off → Controller Paid?: x', { parent: top.m.id });
await post(ops, procBot, '->Controller Paid?', { parent: top.m.id });
t('a person typing it wakes procurement, not controller', personCalls.length === 1 && personCalls[0] === 'procurement');
t('look-alikes never wake controller', calls.length === 0, JSON.stringify(calls.map(c => c.body.text)));

console.log('── delivery');
setEnv({ OPS_WEBHOOK_ENABLED: 'true', OPS_WEBHOOK_URL: P_URL, OPS_WEBHOOK_KEY: P_KEY, OPS_WEBHOOK_SIGNING_SECRET: 'fake-signing-secret' }); init(); reset();
const s1 = await post(ops, person, 'signed');
const sig = calls[0]?.opts.headers['X-Powder-Ops-Signature'];
const crypto = await import('crypto');
t('with a signing secret: sha256 HMAC of the raw body', sig === 'sha256=' + crypto.createHmac('sha256', 'fake-signing-secret').update(calls[0].opts.body).digest('hex'));
await W.pumpOpsWebhook();
W.enqueueOpsWebhook({ channel: ops, message: s1.m, author: person }); await settle();
t('a sent row is never sent again (same dedupe id)', calls.length === 1);

const failCase = async (label, r) => {
  reset(); responder = () => r;
  await post(ops, person, label);
  const times = [];
  for (let i = 0; i < 8; i++) {
    const row = db.prepare('SELECT * FROM ops_webhook_log').get();
    if (row.status !== 'pending') break;
    times.push(row.next_attempt_at - clock);
    clock = row.next_attempt_at; await W.pumpOpsWebhook();
  }
  return { row: db.prepare('SELECT * FROM ops_webhook_log').get(), times };
};
let fc = await failCase('200 no success', { status: 200, body: JSON.stringify({ ok: true }) });
t('200 without success:true is a failure and retried', fc.row.status === 'failed' && fc.row.attempts === 6 && calls.length === 6, `${fc.row.status} ${fc.row.attempts}`);
t('backoff about 2s, 10s, 30s, 2m, 10m', JSON.stringify(fc.times) === JSON.stringify([2000, 10000, 30000, 120000, 600000]), JSON.stringify(fc.times));
for (const [label, r] of [['500', { status: 500, body: 'oops' }], ['401', { status: 401, body: JSON.stringify({ success: false, error: 'Unauthorized' }) }],
  ['400 disabled', { status: 400, body: JSON.stringify({ success: false, error: 'Automation is disabled' }) }],
  ['network', new Error('ECONNRESET')], ['timeout', Object.assign(new Error('aborted'), { name: 'AbortError' })]]) {
  fc = await failCase(label, r);
  t(`${label}: retried on the schedule, then failed`, fc.row.status === 'failed' && fc.row.attempts === 6, `${fc.row.status} ${fc.row.attempts} ${fc.row.last_error}`);
}
t('a 401 / disabled is logged at error level with the reason', logs.some(l => /HTTP 401/.test(l)) && logs.some(l => /Automation is disabled/.test(l)));
t('a timeout reads as a timeout', /timeout after 8s/.test(db.prepare('SELECT last_error FROM ops_webhook_log').get().last_error));

console.log('── restart');
reset(); responder = () => new Error('down');
await post(ops, person, 'restart me');
db.prepare("UPDATE ops_webhook_log SET status = 'sending', next_attempt_at = ?").run(clock);
db.prepare(`INSERT INTO ops_webhook_log (dedupe_id, target, payload, status, attempts, next_attempt_at, created_at) VALUES ('x:y:procurement','procurement','{}','sent',1,?,?)`).run(clock, clock);
responder = () => ({ status: 200, body: JSON.stringify({ success: true }) }); calls = [];
init(); await W.pumpOpsWebhook();
t('a row caught mid-send resumes once; a sent row is not resent', calls.length === 1 && calls[0].body.text === 'restart me'
  && db.prepare("SELECT COUNT(*) AS n FROM ops_webhook_log WHERE status = 'sent'").get().n === 2);

console.log('── limits');
reset();
const long = 'x'.repeat(4500);
await post(ops, person, long);
t('text over 4000 is cut, and says so', calls[0]?.body.text.length === 4000 && calls[0]?.body.text_truncated === true);
reset(); responder = () => new Error('down');
let last = null;
for (let i = 0; i < 61; i++) last = W.enqueueOpsWebhook({ channel: ops, message: msg('burst'), author: person });
t('the 61st fire in a minute is rate_limited', last === 'rate_limited'
  && db.prepare("SELECT COUNT(*) AS n FROM ops_webhook_log WHERE status = 'rate_limited'").get().n === 1);
calls = []; await W.pumpOpsWebhook();
t('at most 3 sends in flight', calls.length === 3, String(calls.length));
clock += 61000;
t('a minute later fires again', W.enqueueOpsWebhook({ channel: ops, message: msg('later'), author: person }) === 'procurement');

console.log('── secrets');
const st = JSON.stringify(W.opsWebhookStatus(db, env));
const allLogs = logs.join('\n') + JSON.stringify(db.prepare('SELECT last_error, payload FROM ops_webhook_log').all());
t('the status never holds a URL or key', !st.includes(P_KEY) && !st.includes(C_KEY) && !st.includes(P_URL) && !st.includes('procROUTINE123456'));
t('logs and stored errors never hold a URL or key', ![P_KEY, C_KEY, P_URL, C_URL, 'fake-signing-secret'].some(s => allLogs.includes(s)));
t('scrub removes a key that appears in an error', !W.scrub(`bad ${P_KEY} at ${P_URL}`, env).includes(P_KEY) && !W.scrub(`x crsr_other123`, env).includes('crsr_other'));
t('redactUrl keeps host and last 6', W.redactUrl(P_URL) === 'fake-hooks.invalid/…123456');

console.log('── the Test Runner seed');
const TR = await import('../server/test-runner.js');
const quietLog = { log() {}, warn() {} };
db.prepare("DELETE FROM app_settings WHERE key IN ('test_runner_user_id','test_runner_joined_test_channel')").run();
t('an existing account already named "Test Runner" is not adopted or duplicated', TR.seedTestRunner(db, quietLog) === null
  && db.prepare("SELECT COUNT(*) AS n FROM users WHERE name = 'Test Runner'").get().n === 1);
db.prepare("DELETE FROM users WHERE id = 'u-runner'").run();
const rid = TR.seedTestRunner(db, quietLog);
const ru = db.prepare('SELECT * FROM users WHERE id = ?').get(rid);
t('the seed creates it: operator, office, no password, no modules', ru?.role === 'operator' && ru?.department === 'office' && !ru?.password_hash && ru?.module_access === '{}');
t('a second boot creates nothing', TR.seedTestRunner(db, quietLog) === rid && db.prepare("SELECT COUNT(*) AS n FROM users WHERE name = 'Test Runner'").get().n === 1);
db.prepare("INSERT INTO chat_channels (id, kind, name, created_by) VALUES ('ch-seed-test','private','ops-requests-test','x')").run();
TR.seedTestRunner(db, quietLog);
const member = () => db.prepare("SELECT COUNT(*) AS n FROM chat_channel_members WHERE channel_id = 'ch-seed-test' AND user_id = ?").get(rid).n;
t('once the channel exists it is added to it', member() === 1);
db.prepare("DELETE FROM chat_channel_members WHERE channel_id = 'ch-seed-test' AND user_id = ?").run(rid);
TR.seedTestRunner(db, quietLog);
t('a person removing it from the channel is not undone', member() === 0);
t('its allow list: post and read in its channel, nothing else', TR.testRunnerAllows(db, 'POST', '/comms/channels/ch-seed-test/messages')
  && TR.testRunnerAllows(db, 'GET', '/comms/channels/ch-seed-test/messages') && !TR.testRunnerAllows(db, 'POST', '/comms/channels/ch-ops/messages')
  && !TR.testRunnerAllows(db, 'POST', '/comms/messages/m-1/reactions') && !TR.testRunnerAllows(db, 'POST', '/qms/deviation/x/approve'));

W.stopOpsWebhook();
console.log(`\n${pass}/${pass + fail} checks passed`);
process.exit(fail ? 1 : 0);
