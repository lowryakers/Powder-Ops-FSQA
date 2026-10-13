#!/usr/bin/env node
// verify:tokenreact — a `write` bot token adds and takes back its OWN emoji
// reactions, in channels its account is a member of, and nothing more (D-170).
//
// Live against a fresh server (verify-all sets PORT and DBPATH). Asserts: a
// member's write token adds ✅ to a person's message (200, the reaction is the
// bot account's, adding it twice changes nothing); the same token on a message
// in a channel it is NOT in is 404 and writes nothing; a read-only token is
// refused; taking back its ✅ removes its own reaction and leaves the person's
// ✅ on the same message alone; taking one back in a channel it is not in is
// 404 and the reaction there stays; deleting the message and editing somebody
// else's message stay refused and the message is unchanged; each call is in
// the audit log as api_token_call.
//
// Control: take the two reaction entries off WRITE_AREAS (and the DELETE
// exemption) — the state before D-170 — and the first add is 403
// not_open_to_tokens.
import Database from 'better-sqlite3';

const PORT = process.env.PORT || 5097;
const BASE = `http://localhost:${PORT}`;
let pass = 0, fail = 0;
const t = (n, ok, d = '') => { if (ok) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n}${d ? ' — ' + d : ''}`); } };

const db = new Database(process.env.DBPATH || process.env.DB_PATH);
const mk = (id, name, role, dept, ma) => db.prepare(`INSERT OR REPLACE INTO users (id,name,username,role,department,is_active,setup_code,setup_code_expires_at,module_access)
  VALUES (?,?,?,?,?,1,?,datetime('now','+7 day'),?)`).run(id, name, name, role, dept, `SC-${id}`, ma ? JSON.stringify(ma) : null);
mk('tr-admin', 'React Admin', 'admin', 'office', null);
mk('tr-bot', 'React Bot', 'operator', 'office', { products: 'view' });
mk('tr-person', 'React Person', 'operator', 'office', { products: 'view' });
const chan = (id, kind, name, members) => {
  db.prepare('INSERT OR REPLACE INTO chat_channels (id, kind, name, created_by) VALUES (?,?,?,?)').run(id, kind, name, 'tr-admin');
  for (const u of members) db.prepare('INSERT OR IGNORE INTO chat_channel_members (id, channel_id, user_id) VALUES (?,?,?)').run(`${id}-${u}`, id, u);
};
chan('tr-in', 'public', 'react-bot-is-here', ['tr-bot', 'tr-person']);
chan('tr-out', 'public', 'react-bot-is-not-here', ['tr-person', 'tr-admin']);

const json = async (method, path, body, auth) => {
  const r = await fetch(`${BASE}/api${path}`, { method, headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: `Bearer ${auth}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let j = null; try { j = await r.json(); } catch { /* empty */ }
  return { status: r.status, body: j };
};
const signIn = async (name, id) => {
  await json('POST', '/users/login', { name });
  await json('POST', '/users/set-password', { user_id: id, password: 'ReactCheck!!1', setup_code: `SC-${id}` });
  return (await json('POST', '/users/login', { name, password: 'ReactCheck!!1' })).body?.token;
};
const CHECK = '✅';
const ENC = encodeURIComponent(CHECK);
const reactionsOn = (msgId) => db.prepare('SELECT user_id, emoji FROM chat_reactions WHERE message_id = ? ORDER BY user_id').all(msgId);
const botHas = (msgId) => reactionsOn(msgId).some(r => r.user_id === 'tr-bot' && r.emoji === CHECK);

const admin = await signIn('React Admin', 'tr-admin');
const person = await signIn('React Person', 'tr-person');
t('admin and person sessions', !!admin && !!person);
const mint = async (uid, label, scopes) => (await json('POST', '/api-tokens', { user_id: uid, label, scopes }, admin)).body?.plaintext;
const tokW = await mint('tr-bot', 'react writer', ['read', 'write']);
const tokR = await mint('tr-bot', 'react reader', ['read']);
t('write and read tokens minted for the bot account', !!tokW && !!tokR);

let r = await json('POST', '/comms/channels/tr-in/messages', { body: 'Pallet 12 is staged.' }, person);
const inMsg = r.body?.id;
r = await json('POST', '/comms/channels/tr-out/messages', { body: 'Not for the bot.' }, person);
const outMsg = r.body?.id;
t('a person posted a message in each channel', !!inMsg && !!outMsg);

console.log('\n── a channel the bot belongs to ──');
r = await json('POST', `/comms/messages/${inMsg}/reactions`, { emoji: CHECK }, tokW);
t('A WRITE TOKEN ADDS ✅ TO A MESSAGE IN A CHANNEL IT BELONGS TO → 200', r.status === 200, `${r.status} ${JSON.stringify(r.body)}`);
t('…the reply shows the reaction, by the bot account', (r.body?.reactions || []).some(x => x.emoji === CHECK && x.users?.includes('tr-bot')), JSON.stringify(r.body?.reactions));
t('…and the stored reaction is the bot account\'s', botHas(inMsg), JSON.stringify(reactionsOn(inMsg)));
r = await json('POST', `/comms/messages/${inMsg}/reactions`, { emoji: CHECK }, tokW);
t('adding the same ✅ again changes nothing (one row)', r.status === 200 && reactionsOn(inMsg).filter(x => x.user_id === 'tr-bot').length === 1);
r = await json('POST', `/comms/messages/${inMsg}/reactions`, {}, tokW);
t('no emoji → 400', r.status === 400, String(r.status));
r = await json('GET', '/comms/channels/tr-in/messages', null, tokW);
const back = (Array.isArray(r.body) ? r.body : r.body?.messages || []).find(m => m.id === inMsg);
t('reading the channel back shows the ✅ on that message', (back?.reactions || []).some(x => x.emoji === CHECK && x.users?.includes('tr-bot')));

console.log('\n── a channel the bot does NOT belong to ──');
r = await json('POST', `/comms/messages/${outMsg}/reactions`, { emoji: CHECK }, tokW);
t('THE SAME TOKEN CANNOT ADD ✅ IN A CHANNEL IT DOES NOT BELONG TO → 404', r.status === 404, `${r.status} ${JSON.stringify(r.body)}`);
t('…and nothing is stored on that message', reactionsOn(outMsg).length === 0, JSON.stringify(reactionsOn(outMsg)));
r = await json('POST', '/comms/messages/no-such-message/reactions', { emoji: CHECK }, tokW);
t('…the same answer as a message that does not exist (404)', r.status === 404);

console.log('\n── scope ──');
r = await json('POST', `/comms/messages/${inMsg}/reactions`, { emoji: '👍' }, tokR);
t('a read-only token cannot react → 403 token_scope', r.status === 403 && r.body?.error === 'token_scope', `${r.status} ${JSON.stringify(r.body)}`);
t('…and stores nothing', !reactionsOn(inMsg).some(x => x.emoji === '👍'));

console.log('\n── taking it back: its own reaction only ──');
r = await json('POST', `/comms/messages/${inMsg}/reactions`, { emoji: CHECK }, person);
t('the person also reacts ✅ on the same message', r.status === 200 && reactionsOn(inMsg).some(x => x.user_id === 'tr-person' && x.emoji === CHECK));
r = await json('DELETE', `/comms/messages/${inMsg}/reactions/${ENC}`, null, tokW);
t('a write token takes back its ✅ → 200', r.status === 200, `${r.status} ${JSON.stringify(r.body)}`);
t('…the bot\'s reaction is gone', !botHas(inMsg));
t('…and the PERSON\'S ✅ on the same message is untouched', reactionsOn(inMsg).some(x => x.user_id === 'tr-person' && x.emoji === CHECK), JSON.stringify(reactionsOn(inMsg)));
r = await json('POST', `/comms/messages/${outMsg}/reactions`, { emoji: CHECK }, person);
r = await json('DELETE', `/comms/messages/${outMsg}/reactions/${ENC}`, null, tokW);
t('taking one back in a channel it does not belong to → 404', r.status === 404, String(r.status));
t('…and the person\'s reaction there stays', reactionsOn(outMsg).some(x => x.user_id === 'tr-person'));

console.log('\n── still person-only ──');
r = await json('DELETE', `/comms/messages/${inMsg}`, null, tokW);
t('deleting a message → 403 token_denied (delete)', r.status === 403 && r.body?.error === 'token_denied' && r.body?.category === 'delete', `${r.status} ${JSON.stringify(r.body)}`);
r = await json('PUT', `/comms/messages/${inMsg}`, { body: 'rewritten by a bot' }, tokW);
t('editing somebody else\'s message → 403 token_denied (not open to tokens)', r.status === 403 && r.body?.error === 'token_denied', `${r.status} ${JSON.stringify(r.body)}`);
const row = db.prepare('SELECT body, deleted_at, edited_at FROM chat_messages WHERE id = ?').get(inMsg);
t('…the message is exactly as the person wrote it', row?.body === 'Pallet 12 is staged.' && !row?.deleted_at && !row?.edited_at, JSON.stringify(row));

console.log('\n── audit ──');
const calls = db.prepare("SELECT details FROM audit_log WHERE action = 'api_token_call'").all().map(x => { try { return JSON.parse(x.details); } catch { return {}; } });
t('the add and the take-back are in the audit log as api_token_call',
  calls.some(c => c.method === 'POST' && c.path === `/api/comms/messages/${inMsg}/reactions` && c.status === 200)
  && calls.some(c => c.method === 'DELETE' && String(c.path).startsWith(`/api/comms/messages/${inMsg}/reactions/`) && c.status === 200));

db.close();
console.log(`\n${pass}/${pass + fail} assertions passed`);
process.exit(fail ? 1 : 0);
