#!/usr/bin/env node
// verify:opsthreadasks — a bot's approval ask in #ops-requests, and the approver's
// reply that answers it (D-336).
//
// Live against a fresh server (verify-all sets PORT and DBPATH). The approver is a
// FIXTURE user id written into app_settings — never a real person's id or name.
// Covers the pack's twenty cases: the happy path and its phrase variants; a name
// spoof; a bot (and a token on the approver's own account) saying "approve"; staff;
// a reaction; the wrong thread; excluded categories; an unknown category; an edit
// and a delete voiding; rejected phrases; a second approve; two asks in a thread; a
// top-level approve; the wrong channel, a DM, a look-alike channel; a person posting
// an ask; the read route's membership rule; no write route; approver unset; and the
// ordinary message path unchanged.
//
// Control: `main` before D-336 — approval_ask is ignored, nothing is recorded, and
// GET …/ask-status is a 404 for everything.
import Database from 'better-sqlite3';
import { normalizePhrase, isApprovalPhrase } from '../shared/ops-asks.js';

const PORT = process.env.PORT || 5210;
const BASE = `http://localhost:${PORT}`;
let pass = 0, fail = 0;
const t = (n, ok, d = '') => { if (ok) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n}${d ? ' — ' + d : ''}`); } };

console.log('── the phrase rule (pure) ──');
for (const p of ['approve', 'approved', 'yes approve', 'Approved.', 'APPROVED', 'yes, approve!', 'YES, APPROVE!', '  Approve  '])
  t(`"${p}" is an approval`, isApprovalPhrase(p), normalizePhrase(p));
for (const p of ["don't approve", 'do not approve', 'not approved', 'please approve', 'i approve', 'approved this', 'ok', 'yes', '', '✅', 'approve approve'])
  t(`"${p}" is not`, !isApprovalPhrase(p), normalizePhrase(p));

const db = new Database(process.env.DBPATH || process.env.DB_PATH);
const mk = (id, name, role, dept) => db.prepare(`INSERT OR REPLACE INTO users (id,name,username,role,department,is_active,setup_code,setup_code_expires_at,module_access)
  VALUES (?,?,?,?,?,1,?,datetime('now','+7 day'),?)`).run(id, name, name, role, dept, `SC-${id}`, JSON.stringify({ products: 'view' }));
mk('ot-admin', 'Asks Admin', 'admin', 'office');
mk('ot-bot', 'Asks Bot', 'operator', 'office');
mk('ot-bot2', 'Other Asks Bot', 'operator', 'office');
mk('ot-out', 'Outside Bot', 'operator', 'office');
mk('ot-appr', 'Approver Fixture', 'operator', 'office');
mk('ot-adam', 'Staff Fixture', 'supervisor', 'office');
mk('ot-spoof', 'Spoof Fixture', 'operator', 'office');
const chan = (id, kind, name, members) => {
  db.prepare('INSERT OR REPLACE INTO chat_channels (id, kind, name, created_by) VALUES (?,?,?,?)').run(id, kind, name, 'ot-admin');
  for (const u of members) db.prepare('INSERT OR IGNORE INTO chat_channel_members (id, channel_id, user_id) VALUES (?,?,?)').run(`${id}-${u}`, id, u);
};
const all = ['ot-admin', 'ot-bot', 'ot-bot2', 'ot-appr', 'ot-adam', 'ot-spoof'];
const opsId = db.prepare("SELECT id FROM chat_channels WHERE name = 'ops-requests'").get()?.id || 'ot-ops';
chan(opsId, 'public', 'ops-requests', all);
const testId = db.prepare("SELECT id FROM chat_channels WHERE name = 'ops-requests-test'").get()?.id || 'ot-ops-test';
chan(testId, 'public', 'ops-requests-test', all);
chan('ot-gen', 'public', 'asks-general', all);
chan('ot-look', 'public', 'ops-requests-old', all);
chan('ot-dm', 'dm', null, ['ot-bot', 'ot-appr']);

const json = async (method, path, body, auth) => {
  const r = await fetch(`${BASE}/api${path}`, { method, headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: `Bearer ${auth}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let j = null; try { j = await r.json(); } catch { /* empty */ }
  return { status: r.status, body: j };
};
const signIn = async (name, id) => {
  await json('POST', '/users/set-password', { user_id: id, password: 'AsksCheck!!12', setup_code: `SC-${id}` });
  return (await json('POST', '/users/login', { name, password: 'AsksCheck!!12' })).body?.token;
};
const admin = await signIn('Asks Admin', 'ot-admin');
const appr = await signIn('Approver Fixture', 'ot-appr');
const adam = await signIn('Staff Fixture', 'ot-adam');
const spoof = await signIn('Spoof Fixture', 'ot-spoof');
t('sessions for admin, approver, staff and spoof', !!admin && !!appr && !!adam && !!spoof);
const mint = async (uid, label) => (await json('POST', '/api-tokens', { user_id: uid, label, scopes: ['read', 'write'] }, admin)).body?.plaintext;
const bot = await mint('ot-bot', 'asks bot');
const bot2 = await mint('ot-bot2', 'other bot');
const outTok = await mint('ot-out', 'outside bot');
const apprTok = await mint('ot-appr', 'approver own token');
t('tokens minted (bot, second bot, an outsider, the approver\'s own)', !!bot && !!bot2 && !!outTok && !!apprTok);

const asks = () => db.prepare('SELECT COUNT(*) c FROM chat_approval_asks').get().c;
const recs = () => db.prepare('SELECT COUNT(*) c FROM chat_approval_recognitions').get().c;
const post = (ch, body, auth, extra = {}) => json('POST', `/comms/channels/${ch}/messages`, { body, ...extra }, auth);
const status = async (id, auth = bot) => (await json('GET', `/comms/messages/${id}/ask-status`, null, auth)).body;
const askOf = async (askMsgId) => (await status(askMsgId)).asks?.find(a => a.message_id === askMsgId);
const newAsk = async (cat = 'code', ch = opsId, parent) => {
  const r = await post(ch, `Can I ship the ${cat} change?`, bot, { approval_ask: { category: cat }, ...(parent ? { parent_id: parent } : {}) });
  return r;
};

console.log('\n── 18. no approver configured ──');
let a = await newAsk('code');
const askNoAppr = a.body?.id;
t('a bot posts an ask → 201 with the server\'s ask id', a.status === 201 && !!a.body?.approval_ask?.ask_id && a.body.approval_ask.category === 'code' && a.body.approval_ask.excluded === false, `${a.status} ${JSON.stringify(a.body?.approval_ask || a.body)}`);
let r = await post(opsId, 'approve', appr, { parent_id: askNoAppr });
let s = await status(askNoAppr);
t('with no approver set, "approve" records nothing', r.status === 201 && recs() === 0 && s?.approver_configured === false);
t('…and the status says why', s?.asks?.[0]?.status === 'open' && s.asks[0].approved === false && s.asks[0].reason === 'approver_not_configured', JSON.stringify(s?.asks?.[0]));
db.prepare("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('ops_thread_approver_user_id', 'ot-appr')").run();

console.log('\n── 1. the approver approves ──');
a = await newAsk('code');
const ask1 = a.body?.id;
r = await post(opsId, 'approve', appr, { parent_id: ask1 });
let st = await askOf(ask1);
t('THE APPROVER\'S SESSION REPLY "approve" IS RECOGNIZED', r.status === 201 && st?.status === 'recognized' && st.approved === true, JSON.stringify(st));
t('…with the reply id, the reply text and the approver\'s id', st?.reply_message_id === r.body?.id && st.reply_text === 'approve' && st.recognized_by === 'ot-appr');
t('…and an audit row', !!db.prepare("SELECT 1 FROM audit_log WHERE action LIKE '%ops_thread_approval_recognized%' AND details LIKE ?").get(`%${r.body?.id}%`));
for (const phrase of ['approved', 'yes, approve', 'YES, APPROVE!', 'Approved.']) {
  const x = (await newAsk('process')).body?.id;
  await post(opsId, phrase, appr, { parent_id: x });
  const y = await askOf(x);
  t(`"${phrase}" is recognized`, y?.approved === true && y.reply_text === phrase, JSON.stringify(y));
}
const top = (await post(testId, 'Thinking about the new label printer.', adam)).body?.id;
a = await newAsk('ops', testId, top);
t('an ask posted as a thread reply in #ops-requests-test takes the thread\'s id', a.status === 201 && a.body?.approval_ask?.thread_id === top, JSON.stringify(a.body?.approval_ask));
await post(testId, 'approve', appr, { parent_id: top });
t('…and the approver\'s reply in that thread recognizes it', (await askOf(a.body.id))?.approved === true);
const th = await json('GET', `/comms/messages/${top}/thread`, null, bot);
t('the thread read shows the ask and its state', th.status === 200 && th.body?.asks?.length === 1 && th.body.asks[0].approved === true);
t('…and the ask message itself carries approval_ask', th.body?.replies?.find(m => m.id === a.body.id)?.approval_ask?.approved === true);

console.log('\n── 2–5. names, bots and staff do not approve ──');
const open = async () => (await newAsk('code')).body?.id;
let x = await open();
db.prepare("UPDATE users SET name = 'Approver Fixture' WHERE id = 'ot-spoof'").run();
await post(opsId, 'approve', spoof, { parent_id: x });
t('2. a person RENAMED to the approver\'s name is not recognized', (await askOf(x))?.status === 'open');
await post(opsId, 'approve', bot, { parent_id: x });
t('3. the asking bot replying "approve" is not recognized', (await askOf(x))?.status === 'open');
db.prepare("UPDATE users SET name = 'Approver Fixture' WHERE id = 'ot-bot2'").run();
await post(opsId, 'approve', bot2, { parent_id: x });
t('3. another bot renamed to the approver\'s name is not recognized', (await askOf(x))?.status === 'open');
r = await post(opsId, 'approve', apprTok, { parent_id: x });
t('4. a TOKEN ON THE APPROVER\'S OWN ACCOUNT is not recognized', r.status === 201 && (await askOf(x))?.status === 'open');
t('…and that message is stamped posted_via token', db.prepare('SELECT posted_via FROM chat_messages WHERE id = ?').get(r.body?.id)?.posted_via === 'token');
await post(opsId, 'approve', adam, { parent_id: x });
t('5. staff replying "approve" is not recognized', (await askOf(x))?.status === 'open' && recs() === 6, `recognitions ${recs()}`);

console.log('\n── 6–7. reactions and the wrong thread ──');
r = await json('POST', `/comms/messages/${x}/reactions`, { emoji: '✅' }, appr);
t('6. the approver\'s ✅ on the ask is a reaction and nothing more', r.status === 200 && (await askOf(x))?.status === 'open');
const other = (await post(opsId, 'Unrelated question', adam)).body?.id;
await post(opsId, 'approve', appr, { parent_id: other });
t('7. "approve" in a DIFFERENT thread leaves the ask open', (await askOf(x))?.status === 'open');
t('…and records nothing for that other thread', (await status(other))?.asks?.length === 0);

console.log('\n── 8–9. excluded and unknown categories ──');
for (const cat of ['money', 'payment', 'qbo', 'bill_pay', 'outside_party']) {
  a = await newAsk(cat);
  await post(opsId, 'approve', appr, { parent_id: a.body?.id });
  const y = await askOf(a.body?.id);
  t(`8. ${cat}: asked, never recognized; status says excluded`, a.status === 201 && y?.excluded === true && y.approved === false && y.status === 'open' && y.reason === 'excluded_category', JSON.stringify(y));
}
const before = asks();
r = await post(opsId, 'Pay the vendor?', bot, { approval_ask: { category: 'money', excluded: false } });
t('8. a bot sending excluded:false is refused (the server decides)', r.status === 400 && r.body?.error === 'approval_ask_excluded_is_server_side' && asks() === before);
r = await post(opsId, 'Typo?', bot, { approval_ask: { category: 'cod' } });
t('9. an unknown category → 400, no ask, no message', r.status === 400 && r.body?.error === 'approval_ask_category' && asks() === before);

console.log('\n── 10, 12, 19. edits, a second approve, deletes ──');
x = await open();
const first = (await post(opsId, 'approve', appr, { parent_id: x })).body?.id;
const second = (await post(opsId, 'Approved.', appr, { parent_id: x })).body?.id;
let y = await askOf(x);
t('12. a second valid approve does not replace the first', y?.reply_message_id === first && db.prepare('SELECT COUNT(*) c FROM chat_approval_recognitions r JOIN chat_approval_asks a ON a.id = r.ask_id WHERE a.message_id = ?').get(x).c === 1);
r = await json('PUT', `/comms/messages/${first}`, { body: 'approve' }, appr);
y = await askOf(x);
t('10. EDITING THE RECOGNIZED REPLY (even to the same word) VOIDS IT', r.status === 200 && y?.status === 'voided' && y.approved === false && y.void_reason === 'edited', JSON.stringify(y));
const fresh = (await post(opsId, 'approve', appr, { parent_id: x })).body?.id;
y = await askOf(x);
t('10. …a fresh, unedited approve recognizes it again', y?.status === 'recognized' && y.reply_message_id === fresh);
t('…the earlier unedited "Approved." did not count retroactively', y?.reply_message_id !== second);
r = await json('DELETE', `/comms/messages/${fresh}`, null, admin);
y = await askOf(x);
t('19. deleting the recognized reply voids it', r.status === 200 && y?.status === 'voided' && y.void_reason === 'deleted' && y.approved === false);
const z = await open();
await post(opsId, 'approve', appr, { parent_id: z });
await json('DELETE', `/comms/messages/${z}`, null, admin);
const zs = (await status(z))?.asks?.[0];
t('19. deleting the ASK closes it: status deleted, not approved', zs?.status === 'deleted' && zs.approved === false, JSON.stringify(zs));
// A drift the hooks did not see is caught on read.
x = await open();
const drift = (await post(opsId, 'approve', appr, { parent_id: x })).body?.id;
db.prepare("UPDATE chat_messages SET edited_at = datetime('now') WHERE id = ?").run(drift);
y = await askOf(x);
t('a reply edited behind the API is voided on the next read', y?.approved === false && y.status === 'voided' && y.void_reason === 'edited');

console.log('\n── 11. phrases that are not an approval ──');
x = await open();
for (const p of ['not approved', "don't approve", 'do not approve', 'please approve', 'I approve', 'ok', 'yes']) await post(opsId, p, appr, { parent_id: x });
t('11. none of seven near-misses recognize the ask', (await askOf(x))?.status === 'open');

console.log('\n── 13–14. two asks in a thread; a top-level approve ──');
const head = (await post(opsId, 'Two questions on the schedule.', adam)).body?.id;
const askA = (await newAsk('process', opsId, head)).body?.id;
const askB = (await newAsk('staffing', opsId, head)).body?.id;
await post(opsId, 'approve', appr, { parent_id: head });
t('13. one approve recognizes only the LATEST ask', (await askOf(askB))?.approved === true && (await askOf(askA))?.status === 'open');
await post(opsId, 'approve', appr, { parent_id: head });
t('13. …and a second approve never reaches back to the earlier one', (await askOf(askA))?.status === 'open');
x = await open();
await post(opsId, 'approve', appr);
t('14. a top-level "approve" recognizes nothing', (await askOf(x))?.status === 'open');

console.log('\n── 15–16. the wrong place, the wrong author ──');
const n = asks();
for (const [ch, label] of [['ot-gen', '#asks-general'], ['ot-dm', 'a DM'], ['ot-look', '#ops-requests-old']]) {
  r = await post(ch, 'Approve?', bot, { approval_ask: { category: 'code' } });
  t(`15. an ask in ${label} → 400 approval_ask_channel`, r.status === 400 && r.body?.error === 'approval_ask_channel');
}
const genMsg = (await post('ot-gen', 'Plain question', bot)).body?.id;
await post('ot-gen', 'approve', appr, { parent_id: genMsg });
t('15. …no ask was made, and "approve" there records nothing', asks() === n && (await status(genMsg))?.asks?.length === 0);
r = await post(opsId, 'Can we?', adam, { approval_ask: { category: 'code' } });
t('16. a person posting approval_ask → 400 approval_ask_bot_only', r.status === 400 && r.body?.error === 'approval_ask_bot_only' && asks() === n);
r = await post(opsId, 'Reply to a reply?', bot, { approval_ask: { category: 'code' }, parent_id: second });
t('an ask whose parent is not a top-level message → 400', r.status === 400 && r.body?.error === 'approval_ask_parent');

console.log('\n── 17. the read route, and no write route ──');
r = await json('GET', `/comms/messages/${askB}/ask-status`, null, bot);
t('17. a member token reads the status → 200 with its shape', r.status === 200 && Array.isArray(r.body?.asks) && ['ask_id', 'thread_id', 'category', 'excluded', 'status', 'approved', 'recognized_by', 'reply_message_id', 'reply_text'].every(k => k in (r.body.asks[0] || {})));
r = await json('GET', `/comms/messages/${askB}/ask-status`, null, outTok);
t('17. a token not in the channel → 404', r.status === 404);
r = await json('POST', `/comms/messages/${askA}/approval`, {}, bot);
t('17. a token POST to an approval path → 403 approve_requires_human_session', r.status === 403 && r.body?.error === 'approve_requires_human_session', `${r.status} ${JSON.stringify(r.body)}`);
r = await json('POST', `/comms/messages/${askA}/ask-status`, {}, bot);
t('17. a token POST to ask-status → refused, no route writes a recognition', r.status === 403 || r.status === 404, `${r.status}`);
r = await json('PUT', '/comms/ops-thread-settings', { approver_user_id: 'ot-bot' }, bot);
t('a token cannot set the approver', r.status === 403 && db.prepare("SELECT value FROM app_settings WHERE key = 'ops_thread_approver_user_id'").get()?.value === 'ot-appr', `${r.status} ${JSON.stringify(r.body)}`);
r = await json('PUT', '/comms/ops-thread-settings', { approver_user_id: 'ot-appr' }, adam);
t('…nor can a non-admin person', r.status === 404);
r = await json('GET', '/comms/ops-thread-settings', null, admin);
t('an admin session reads who it is', r.status === 200 && r.body?.approver_user_id === 'ot-appr' && r.body.source === 'setting');

console.log('\n── 20. the ordinary path is unchanged ──');
r = await post(opsId, 'Pallet 4 is staged.', adam);
t('20. an ordinary message posts with approval_ask null', r.status === 201 && r.body?.approval_ask === null);
t('…stamped posted_via session', db.prepare('SELECT posted_via FROM chat_messages WHERE id = ?').get(r.body?.id)?.posted_via === 'session');
const plain = r.body?.id;
r = await post(opsId, 'Thanks', bot, { parent_id: plain });
t('20. a bot reply in a thread posts as before', r.status === 201 && r.body?.parent_id === plain);
r = await json('PUT', `/comms/messages/${plain}`, { body: 'Pallet 4 is staged at door 2.' }, adam);
t('20. an author edit works as before', r.status === 200 && r.body?.edited === true);
r = await json('POST', `/comms/messages/${plain}/reactions`, { emoji: '👍' }, bot);
t('20. a token reaction works as before', r.status === 200);
r = await json('DELETE', `/comms/messages/${plain}`, null, adam);
t('20. a non-admin still cannot delete', r.status === 403);

db.close();
console.log(`\n${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
