#!/usr/bin/env node
// verify:opswebhook — the #ops-requests wake (D-251), live: a real server with
// OPS_WEBHOOK_* pointed at a fake webhook this script runs on localhost. Every
// URL and key is fake. Asserts: a person's post in #ops-requests returns 201 and
// sends one POST to the procurement hook; a thread reply sends one more; #general
// sends none; an edit, a reaction and a delete send none; a bot token's reply
// sends none, and a `*Procurement Bot` "→ Controller" reply goes to the controller
// hook only; the status endpoint is 200 for an admin session, 403 for a bot
// token, 401 with nothing, and carries no URL or key.
//
// Control: remove the enqueueOpsWebhook call from comms.js — the hook receives
// nothing and the first delivery assertion fails.
import http from 'http';
import Database from 'better-sqlite3';

const PORT = process.env.PORT || 5142;
const HOOK_PORT = Number(process.env.OPS_HOOK_PORT || 5143);
const BASE = `http://localhost:${PORT}`;
let pass = 0, fail = 0;
const t = (n, ok, d = '') => { if (ok) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n}${d ? ' — ' + d : ''}`); } };

const received = [];
const hook = http.createServer((req, res) => {
  let body = '';
  req.on('data', c => { body += c; });
  req.on('end', () => {
    received.push({ path: req.url, auth: req.headers.authorization, body: JSON.parse(body || '{}') });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, runUuid: 'fake-run' }));
  });
});
await new Promise(r => hook.listen(HOOK_PORT, '127.0.0.1', r));
const wait = async (n, ms = 4000) => { const end = Date.now() + ms; while (received.length < n && Date.now() < end) await new Promise(r => setTimeout(r, 50)); };
const quiet = () => new Promise(r => setTimeout(r, 600));

const db = new Database(process.env.DBPATH || process.env.DB_PATH);
const mk = (id, name, role, ma) => db.prepare(`INSERT OR REPLACE INTO users (id,name,username,role,department,is_active,setup_code,setup_code_expires_at,module_access)
  VALUES (?,?,?,?,'office',1,?,datetime('now','+7 day'),?)`).run(id, name, name, role, `SC-${id}`, ma ? JSON.stringify(ma) : null);
mk('ow-admin', 'Hook Admin', 'admin', null);
mk('ow-person', 'Hook Person', 'operator', { products: 'view' });
mk('ow-proc', '*Procurement Bot', 'operator', { products: 'view' });
const chan = (id, name) => {
  db.prepare('INSERT OR REPLACE INTO chat_channels (id, kind, name, created_by) VALUES (?,?,?,?)').run(id, 'private', name, 'ow-admin');
  for (const u of ['ow-admin', 'ow-person', 'ow-proc']) db.prepare('INSERT OR IGNORE INTO chat_channel_members (id, channel_id, user_id) VALUES (?,?,?)').run(`${id}-${u}`, id, u);
};
chan('ow-ops', 'ops-requests');
chan('ow-gen', 'not-ops');

const json = async (method, path, body, auth) => {
  const r = await fetch(`${BASE}/api${path}`, { method, headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: `Bearer ${auth}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  let j = null; try { j = JSON.parse(text); } catch { /* empty */ }
  return { status: r.status, body: j, text };
};
const signIn = async (name, id) => {
  await json('POST', '/users/login', { name });
  await json('POST', '/users/set-password', { user_id: id, password: 'HookCheck!!1', setup_code: `SC-${id}` });
  return (await json('POST', '/users/login', { name, password: 'HookCheck!!1' })).body?.token;
};
const admin = await signIn('Hook Admin', 'ow-admin');
const person = await signIn('Hook Person', 'ow-person');
const tok = (await json('POST', '/api-tokens', { user_id: 'ow-proc', label: 'procurement bot (test)', scopes: ['read', 'write'] }, admin)).body?.plaintext;
t('sessions and a scratch bot token', !!admin && !!person && !!tok);

console.log('\n── a person posts in #ops-requests ──');
let r = await json('POST', '/comms/channels/ow-ops/messages', { body: '[TEST] Where is PO00613?' }, person);
const top = r.body?.id;
t('the post returns 201', r.status === 201, String(r.status));
await wait(1);
t('ONE POST reaches the procurement hook', received.length === 1 && received[0].path.endsWith('/procROUTINE1'), JSON.stringify(received.map(x => x.path)));
t('…with the procurement key and the payload', received[0]?.auth === 'Bearer crsr_fakeProc' && received[0]?.body.target === 'procurement'
  && received[0]?.body.message_id === top && received[0]?.body.is_top_level === true && /Z$/.test(received[0]?.body.timestamp || ''), JSON.stringify(received[0]));
r = await json('POST', '/comms/channels/ow-ops/messages', { body: 'Any update?', parent_id: top }, person);
await wait(2);
t('a person\'s thread reply sends one more, thread = the parent', received.length === 2 && received[1].body.thread_id === top && received[1].body.is_top_level === false);
const reply = r.body?.id;

console.log('\n── what never fires ──');
await json('POST', '/comms/channels/ow-gen/messages', { body: 'Where is PO00613?' }, person);
await json('PUT', `/comms/messages/${reply}`, { body: 'Any update? (edited)' }, person);
await json('POST', `/comms/messages/${top}/reactions`, { emoji: '👍' }, person);
r = await json('POST', '/comms/channels/ow-ops/messages', { body: 'PO00613 shipped 10/20.', parent_id: top }, tok);
t('the bot token could reply in the thread', r.status === 201, `${r.status} ${r.text.slice(0, 120)}`);
await json('DELETE', `/comms/messages/${reply}`, null, admin);
await quiet();
t('another channel, an edit, a reaction, a bot reply and a delete send nothing', received.length === 2, String(received.length));

console.log('\n── the handoff ──');
r = await json('POST', '/comms/channels/ow-ops/messages', { body: '→ Controller Paid?: Stauber invoice 4471', parent_id: top }, tok);
await wait(3);
t('*Procurement Bot\'s "→ Controller" reply goes to the controller hook only, with its key', received.length === 3
  && received[2].path.endsWith('/ctrlROUTINE1') && received[2].auth === 'Bearer crsr_fakeCtrl' && received[2].body.target === 'controller', JSON.stringify(received[2]));

console.log('\n── the status endpoint ──');
r = await json('GET', '/admin/ops-webhook/status', null, admin);
t('an admin session reads it', r.status === 200 && r.body?.targets?.procurement?.enabled === true && r.body?.targets?.controller?.enabled === true, r.text.slice(0, 200));
t('…three sent, none failed', r.body?.recent?.filter(x => x.status === 'sent').length === 3 && r.body?.targets?.procurement?.failed_24h === 0);
t('…no URL, routine id or key in it', !/crsr_|procROUTINE1|ctrlROUTINE1|127\.0\.0\.1/.test(r.text));
t('a bot token is refused', (await json('GET', '/admin/ops-webhook/status', null, tok)).status === 403);
t('no session is 401', (await json('GET', '/admin/ops-webhook/status')).status === 401);
t('a person who is not an admin is refused', (await json('GET', '/admin/ops-webhook/status', null, person)).status === 403);

hook.close();
console.log(`\n${pass}/${pass + fail} assertions passed`);
process.exit(fail ? 1 : 0);
