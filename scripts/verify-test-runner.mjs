#!/usr/bin/env node
// verify:testrunner — the Test Runner account (D-252), live: a real server with
// OPS_WEBHOOK_* pointed at a fake hook this script runs on localhost. Every URL and
// key is fake, and the token is minted on this scratch database only.
//
// Asserts: the account is seeded as an operator with no password, no modules and no
// approving role, and is not auto-joined to #general; its token posts in
// #ops-requests-test (201) and that post wakes Procurement as a person's would,
// replies too; it can read its channel and a thread there; it is 403
// `test_runner_scope` posting in #ops-requests or #general, reacting, editing,
// reading another channel, reading a module, approving a QMS record and signing in
// QA Review; promoting it to supervisor opens nothing; another bot's post in the
// test channel still wakes nothing.
//
// Control: remove `app.use('/api', testRunnerGuard(getDb))` from server.js — the
// post in #general is no longer 403 and the scope assertions fail.
import http from 'http';
import Database from 'better-sqlite3';

const PORT = process.env.PORT || 5144;
const HOOK_PORT = Number(process.env.OPS_HOOK_PORT || 5145);
const BASE = `http://localhost:${PORT}`;
let pass = 0, fail = 0;
const t = (n, ok, d = '') => { if (ok) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n}${d ? ' — ' + d : ''}`); } };

const received = [];
const hook = http.createServer((req, res) => {
  let body = '';
  req.on('data', c => { body += c; });
  req.on('end', () => {
    received.push({ path: req.url, body: JSON.parse(body || '{}') });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, runUuid: 'fake-run' }));
  });
});
await new Promise(r => hook.listen(HOOK_PORT, '127.0.0.1', r));
const wait = async (n, ms = 4000) => { const end = Date.now() + ms; while (received.length < n && Date.now() < end) await new Promise(r => setTimeout(r, 50)); };
const quiet = () => new Promise(r => setTimeout(r, 700));

const db = new Database(process.env.DBPATH || process.env.DB_PATH);
const json = async (method, path, body, auth) => {
  const r = await fetch(`${BASE}/api${path}`, { method, headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: `Bearer ${auth}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  let j = null; try { j = JSON.parse(text); } catch { /* empty */ }
  return { status: r.status, body: j, text };
};

console.log('── the account ──');
const runnerId = db.prepare("SELECT value FROM app_settings WHERE key = 'test_runner_user_id'").get()?.value;
const runner = runnerId && db.prepare('SELECT * FROM users WHERE id = ?').get(runnerId);
t('the boot seeded a "Test Runner" account and recorded its id', !!runner && runner.name === 'Test Runner');
t('…an operator in the office, never admin or supervisor', runner?.role === 'operator' && runner?.department === 'office');
t('…with no password and no modules', !runner?.password_hash && (runner?.module_access === '{}' || runner?.module_access == null));
const general = db.prepare("SELECT id FROM chat_channels WHERE name = 'general'").get();
t('…and NOT auto-joined to #general', !db.prepare('SELECT 1 FROM chat_channel_members WHERE channel_id = ? AND user_id = ?').get(general?.id, runnerId));

const mk = (id, name, role, ma) => db.prepare(`INSERT OR REPLACE INTO users (id,name,username,role,department,is_active,setup_code,setup_code_expires_at,module_access)
  VALUES (?,?,?,?,'office',1,?,datetime('now','+7 day'),?)`).run(id, name, name, role, `SC-${id}`, ma ? JSON.stringify(ma) : null);
mk('tr-admin', 'Runner Admin', 'admin', null);
mk('tr-proc', '*Procurement Bot', 'operator', { products: 'view' });
mk('tr-qa', 'Runner QA', 'supervisor', null);
const chan = (id, name, members) => {
  db.prepare('INSERT OR REPLACE INTO chat_channels (id, kind, name, created_by) VALUES (?,?,?,?)').run(id, 'private', name, 'tr-admin');
  for (const u of members) db.prepare('INSERT OR IGNORE INTO chat_channel_members (id, channel_id, user_id) VALUES (?,?,?)').run(`${id}-${u}`, id, u);
};
// What the boot seed does once the channel exists; the channel is created after boot here.
chan('tr-test', 'ops-requests-test', ['tr-admin', 'tr-proc', runnerId]);
chan('tr-ops', 'ops-requests', ['tr-admin', 'tr-proc', runnerId]);
db.prepare("INSERT OR IGNORE INTO chat_channel_members (id, channel_id, user_id) VALUES ('tr-gen-r', ?, ?)").run(general.id, runnerId);

const signIn = async (name, id) => {
  await json('POST', '/users/login', { name });
  await json('POST', '/users/set-password', { user_id: id, password: 'RunnerCheck!!1', setup_code: `SC-${id}` });
  return (await json('POST', '/users/login', { name, password: 'RunnerCheck!!1' })).body?.token;
};
const admin = await signIn('Runner Admin', 'tr-admin');
const mint = async (uid, label) => (await json('POST', '/api-tokens', { user_id: uid, label, scopes: ['read', 'write'] }, admin)).body?.plaintext;
const tok = await mint(runnerId, 'Test Runner (scratch)');
const procTok = await mint('tr-proc', 'procurement (scratch)');
t('a scratch token for the Test Runner, and one for another bot', !!tok && !!procTok);

console.log('\n── it posts in #ops-requests-test, and that wakes Procurement ──');
let r = await json('POST', '/comms/channels/tr-test/messages', { body: "[TEST] What's the status on the Berlin bottle PO?" }, tok);
const top = r.body?.id;
t('POST in #ops-requests-test → 201', r.status === 201, `${r.status} ${r.text.slice(0, 160)}`);
await wait(1);
t('…and the webhook fires for Procurement, as for a person', received.length === 1 && received[0].body.target === 'procurement'
  && received[0].body.author?.name === 'Test Runner' && received[0].body.channel?.name === 'ops-requests-test', JSON.stringify(received[0]?.body || {}));
r = await json('POST', '/comms/channels/tr-test/messages', { body: 'Any update?', parent_id: top }, tok);
await wait(2);
t('a reply in its own thread fires too, thread = the parent', r.status === 201 && received[1]?.body.thread_id === top && received[1]?.body.is_top_level === false);
t('it can read its channel', (await json('GET', '/comms/channels/tr-test/messages', null, tok)).status === 200);
t('…and a thread in it', (await json('GET', `/comms/messages/${top}/thread`, null, tok)).status === 200);
t('…and whoami', (await json('GET', '/bot/whoami', null, tok)).status === 200);

console.log('\n── everything else is 403 ──');
const scoped = (res) => res.status === 403 && res.body?.error === 'test_runner_scope';
const before = received.length;
r = await json('POST', '/comms/channels/tr-ops/messages', { body: 'Where is PO00613?' }, tok);
t('posting in #ops-requests → 403', scoped(r), `${r.status} ${r.text.slice(0, 120)}`);
r = await json('POST', `/comms/channels/${general.id}/messages`, { body: 'hello' }, tok);
t('posting in #general → 403', scoped(r), `${r.status}`);
t('reacting in its own channel → 403', scoped(await json('POST', `/comms/messages/${top}/reactions`, { emoji: '👍' }, tok)));
{ const e = await json('PUT', `/comms/messages/${top}`, { body: 'edited' }, tok); t('editing its own message → 403', e.status === 403, `${e.status} ${e.text.slice(0, 160)}`); }
t('reading another channel → 403', scoped(await json('GET', '/comms/channels/tr-ops/messages', null, tok)));
t('reading a module → 403', scoped(await json('GET', '/production/entries', null, tok)));
t('approving a QMS record → 403', (await json('POST', '/qms/deviation/nope/approve', { role: 'qa' }, tok)).status === 403);
t('signing in QA Review → 403', (await json('POST', '/qa-review/sign', { source: 'production', ids: ['x'] }, tok)).status === 403);
db.prepare("UPDATE users SET role = 'supervisor' WHERE id = ?").run(runnerId);
r = await json('POST', `/comms/channels/${general.id}/messages`, { body: 'promoted' }, tok);
t('promoted to supervisor, it is still 403 outside its channel', scoped(r), `${r.status}`);
db.prepare("UPDATE users SET role = 'operator' WHERE id = ?").run(runnerId);
await quiet();
t('none of those woke anything', received.length === before);

console.log('\n── other bots still never fire ──');
r = await json('POST', '/comms/channels/tr-test/messages', { body: 'PO00613 shipped 10/20.' }, procTok);
t('another bot posting in #ops-requests-test is allowed', r.status === 201, `${r.status}`);
await quiet();
t('…and wakes nothing', received.length === before);

hook.close();
console.log(`\n${pass}/${pass + fail} assertions passed`);
process.exit(fail ? 1 : 0);
