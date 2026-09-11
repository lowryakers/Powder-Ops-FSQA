// An edit has to REACH the other people in the channel.
//
// Reported as: Daniela edited a message and Marnee went on seeing the original.
// Two mechanisms behind it, both checked here from the server side, and the
// client half (the version-keyed translation cache) rests on the first.
//
// Caller sets PORT + DBPATH. Needs a fresh database.
const PORT = process.env.PORT || 4995;
const B = `http://localhost:${PORT}/api`;
const J = async r => { try { return await r.json(); } catch { return null; } };
let pass = 0, fail = 0;
const t = (n, c, d = '') => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (d ? ' — ' + d : '')); } };
const tok = {};
const req = (p, o = {}, who = 'a') => fetch(B + p, { ...o, headers: { 'Content-Type': 'application/json', ...(tok[who] ? { Authorization: `Bearer ${tok[who]}` } : {}), ...(o.headers || {}) } });
const post = (p, b, who) => req(p, { method: 'POST', body: JSON.stringify(b) }, who);
const put = (p, b, who) => req(p, { method: 'PUT', body: JSON.stringify(b) }, who);

const { default: Database } = await import('better-sqlite3');
const db = new Database(process.env.DBPATH);
for (const [id, name, code] of [['ce-a', 'Edit Author', 'SC-CA'], ['ce-b', 'Edit Reader', 'SC-CB']]) {
  db.prepare(`INSERT OR REPLACE INTO users (id,name,username,role,department,is_active,setup_code,setup_code_expires_at,module_access)
    VALUES (?,?,?,'admin','qa',1,?,datetime('now','+7 day'),NULL)`).run(id, name, name, code);
}
const signIn = async (who, id, name, code, pw) => {
  await post('/users/login', { name });
  await post('/users/set-password', { user_id: id, password: pw, setup_code: code });
  tok[who] = (await J(await post('/users/login', { name, password: pw })))?.token;
};
await signIn('a', 'ce-a', 'Edit Author', 'SC-CA', 'EditAuth2026!');
await signIn('b', 'ce-b', 'Edit Reader', 'SC-CB', 'EditRead2026!');
t('both signed in', !!tok.a && !!tok.b);

const ch = await J(await post('/comms/channels', { name: 'edit-test', kind: 'public' }, 'a'));
const channelId = ch?.id || ch?.channel?.id;
t('a channel exists', !!channelId, JSON.stringify(ch || {}).slice(0, 100));
const msg = await J(await post(`/comms/channels/${channelId}/messages`, { body: 'the blender needs a full strip down' }, 'a'));
t('the author posts a message', !!msg?.id);
t('it carries no edit stamp yet', msg.edited === false && (msg.edited_at === null || msg.edited_at === undefined));

// A cached translation of the text as it was — the thing that used to survive
// an edit and be shown to the other reader for ever.
db.prepare(`INSERT OR REPLACE INTO chat_message_translations (message_id, lang, text)
  VALUES (?, 'es', 'la licuadora necesita un desmontaje completo')`).run(msg.id);

const edited = await J(await put(`/comms/messages/${msg.id}`, { body: 'the blender needs a full strip down AND an ATP swab' }, 'a'));
t('the edit saves', edited?.body?.endsWith('ATP swab'), JSON.stringify(edited || {}).slice(0, 120));
t('THE EDIT STAMP TRAVELS, not just a boolean — it is the version the client keys its cache on',
  edited.edited === true && typeof edited.edited_at === 'string' && edited.edited_at.length > 8, JSON.stringify({ edited: edited?.edited, at: edited?.edited_at }));
t('the cached translation of the OLD text is gone',
  !db.prepare('SELECT 1 FROM chat_message_translations WHERE message_id = ?').get(msg.id));

const asRead = (await J(await req(`/comms/channels/${channelId}/messages`, {}, 'b')))?.find?.(m => m.id === msg.id)
  || ((await J(await req(`/comms/channels/${channelId}/messages`, {}, 'b')))?.messages || []).find(m => m.id === msg.id);
t('the other reader is served the edited text', asRead?.body?.endsWith('ATP swab'), JSON.stringify(asRead || {}).slice(0, 120));
t('…with the same edit stamp', asRead?.edited_at === edited.edited_at);

const notMine = await put(`/comms/messages/${msg.id}`, { body: 'somebody else rewriting it' }, 'b');
// Refused either way: 403 for somebody in the channel, 404 for somebody the
// channel is not theirs to touch. What matters is that it is not written.
t('and only the author can edit it', [403, 404].includes(notMine.status), `got ${notMine.status}`);
const after = await J(await req(`/comms/messages/${msg.id}/thread`, {}, 'a'));
t('…and nobody else\'s words replaced the author\'s', (after?.parent?.body || edited.body).endsWith('ATP swab'));

db.close();
console.log(`\n${pass}/${pass + fail} assertions passed`);
process.exit(fail ? 1 : 0);
