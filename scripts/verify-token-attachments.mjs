#!/usr/bin/env node
// verify:tokenattach — a `write` bot token attaches files to chat (D-166).
//
// Live against a fresh server with the S3 stand-in (verify-all sets PORT,
// DBPATH, R2_* and API_TOKEN_WRITE_RPM). Asserts: a member's write token
// uploads a PDF and links it to its own message (download_url, owned by the
// bot); a read token is refused and stores nothing; a channel the account is
// not in is 404; a DM the bot is in works; every type off the allowlist is 415
// (.exe .html .svg .zip, a video, a .pdf whose body is HTML, a .png declared as
// text) and a refused batch stores nothing; oversize is the same 413 a person
// gets; each upload is audited with via_token; uploads spend the WRITE bucket
// (429); the person-only routes stay refused; a person's own upload of an .svg
// still works.
//
// Control: take the attachments entry off WRITE_AREAS — the state the plant
// was in — and the first upload is 403 not_open_to_tokens.
import Database from 'better-sqlite3';

const PORT = process.env.PORT || 5093;
const BASE = `http://localhost:${PORT}`;
const WRITE_RPM = Number(process.env.API_TOKEN_WRITE_RPM || 20);
let pass = 0, fail = 0;
const t = (n, ok, d = '') => { if (ok) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n}${d ? ' — ' + d : ''}`); } };

const db = new Database(process.env.DBPATH || process.env.DB_PATH);
const mk = (id, name, role, dept, ma) => db.prepare(`INSERT OR REPLACE INTO users (id,name,username,role,department,is_active,setup_code,setup_code_expires_at,module_access)
  VALUES (?,?,?,?,?,1,?,datetime('now','+7 day'),?)`).run(id, name, name, role, dept, `SC-${id}`, ma ? JSON.stringify(ma) : null);
mk('ta-admin', 'Attach Admin', 'admin', 'office', null);
mk('ta-bot', 'Attach Bot', 'operator', 'office', { products: 'view' });
mk('ta-person', 'Attach Person', 'operator', 'office', { products: 'view' });
mk('ta-promo', 'Promo Bot', 'operator', 'office', { products: 'view' });
const chan = (id, kind, name, members, dmKey = null) => {
  db.prepare('INSERT OR REPLACE INTO chat_channels (id, kind, name, dm_key, created_by) VALUES (?,?,?,?,?)').run(id, kind, name, dmKey, 'ta-admin');
  for (const u of members) db.prepare('INSERT OR IGNORE INTO chat_channel_members (id, channel_id, user_id) VALUES (?,?,?)').run(`${id}-${u}`, id, u);
};
chan('ta-po', 'public', 'new_purchase-order-test', ['ta-bot', 'ta-person', 'ta-promo']);
chan('ta-closed', 'private', 'not-for-the-bot', ['ta-person', 'ta-admin']);
chan('ta-dm', 'dm', null, ['ta-bot', 'ta-person'], ['ta-bot', 'ta-person'].sort().join(':'));

const json = async (method, path, body, auth) => {
  const r = await fetch(`${BASE}/api${path}`, { method, headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: `Bearer ${auth}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let j = null; try { j = await r.json(); } catch { /* empty */ }
  return { status: r.status, body: j };
};
const upload = async (channelId, files, auth) => {
  const fd = new FormData();
  for (const f of files) fd.append('files', new Blob([f.bytes], { type: f.type }), f.name);
  const r = await fetch(`${BASE}/api/comms/channels/${channelId}/attachments`, { method: 'POST', headers: { Authorization: `Bearer ${auth}` }, body: fd });
  let j = null; try { j = await r.json(); } catch { /* empty */ }
  return { status: r.status, body: j };
};
const signIn = async (name, id) => {
  await json('POST', '/users/login', { name });
  await json('POST', '/users/set-password', { user_id: id, password: 'AttachCheck!!1', setup_code: `SC-${id}` });
  return (await json('POST', '/users/login', { name, password: 'AttachCheck!!1' })).body?.token;
};
const stored = () => db.prepare("SELECT COUNT(*) n FROM chat_attachments WHERE user_id = 'ta-bot'").get().n;

const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');
const PNG = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.alloc(32, 1)]);
const JPG = Buffer.concat([Buffer.from('ffd8ffe0', 'hex'), Buffer.alloc(32, 2)]);
const ZIP = Buffer.concat([Buffer.from('504b0304', 'hex'), Buffer.alloc(32, 3)]);
const CSV = Buffer.from('part,qty\nWPI-80,40\n');
const HTML = Buffer.from('<!doctype html><script>alert(1)</script>');
const XLSX_T = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const DOCX_T = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

const admin = await signIn('Attach Admin', 'ta-admin');
const person = await signIn('Attach Person', 'ta-person');
t('admin and person sessions', !!admin && !!person);
const mint = async (uid, label, scopes) => (await json('POST', '/api-tokens', { user_id: uid, label, scopes }, admin)).body?.plaintext;
const tokW = await mint('ta-bot', 'attach writer', ['read', 'write']);
const tokR = await mint('ta-bot', 'attach reader', ['read']);
const tokRate = await mint('ta-bot', 'attach rate', ['read', 'write']);
const tokPromo = await mint('ta-promo', 'attach promo', ['read', 'write']);
// The forbidden-route checks get their own token: the rate limit runs before
// the deny guard, so they must not share a bucket with the uploads above.
const tokF = await mint('ta-bot', 'attach forbidden', ['read', 'write']);
t('write, read, rate, promo and forbidden-check tokens minted', [tokW, tokR, tokRate, tokPromo, tokF].every(Boolean));

console.log('\n── a member uploads and posts ──');
let r = await upload('ta-po', [{ name: 'PO-4471.pdf', type: 'application/pdf', bytes: PDF }], tokW);
t('a write token in a channel it is in uploads a PDF → 201', r.status === 201 && r.body?.[0]?.id, `${r.status} ${JSON.stringify(r.body)}`);
const pdfId = r.body?.[0]?.id;
t('…the row belongs to the bot account and is not yet on a message',
  db.prepare('SELECT user_id, message_id FROM chat_attachments WHERE id = ?').get(pdfId)?.user_id === 'ta-bot'
  && db.prepare('SELECT message_id FROM chat_attachments WHERE id = ?').get(pdfId)?.message_id === null);
r = await json('POST', '/comms/channels/ta-po/messages', { body: 'PO 4471 attached.', attachment_ids: [pdfId] }, tokW);
t('posting with attachment_ids → 201', r.status === 201, `${r.status} ${JSON.stringify(r.body).slice(0, 200)}`);
const att = r.body?.attachments?.[0];
t('…the message carries the attachment with download_url', att?.id === pdfId && att?.download_url === `/api/comms/attachments/${pdfId}/download`, JSON.stringify(att));
t('…and the message is the bot account\'s', r.body?.user_id === 'ta-bot');
const msgId = r.body?.id;
r = await json('GET', '/comms/channels/ta-po/messages', null, tokW);
t('reading the channel back shows the attachment on that message',
  r.status === 200 && (Array.isArray(r.body) ? r.body : r.body?.messages || []).some(m => m.id === msgId && m.attachments?.some(a => a.id === pdfId)));
r = await upload('ta-po', [{ name: 'x.png', type: 'image/png', bytes: PNG }], tokW);
const pngId = r.body?.[0]?.id;
r = await json('POST', '/comms/channels/ta-po/messages', { attachment_ids: [pngId] }, tokW);
t('a message with only an attachment and no body posts', r.status === 201 && r.body?.attachments?.length === 1, `${r.status}`);
r = await upload('ta-po', [{ name: 'mine.pdf', type: 'application/pdf', bytes: PDF }], person);
const personAtt = r.body?.[0]?.id;
r = await json('POST', '/comms/channels/ta-po/messages', { body: 'stealing a file', attachment_ids: [personAtt] }, tokW);
t("a token cannot link somebody else's upload", r.status === 201 && (r.body?.attachments || []).length === 0
  && db.prepare('SELECT message_id FROM chat_attachments WHERE id = ?').get(personAtt)?.message_id === null);

console.log('\n── every allowed type ──');
for (const [name, type, bytes] of [['a.jpg', 'image/jpeg', JPG], ['a.jpeg', 'image/jpeg', JPG], ['a.csv', 'text/csv', CSV], ['b.csv', 'application/vnd.ms-excel', CSV],
  ['c.csv', 'text/plain', CSV], ['a.xlsx', XLSX_T, ZIP], ['a.docx', DOCX_T, ZIP], ['UPPER.PDF', 'application/pdf', PDF]]) {
  r = await upload('ta-po', [{ name, type, bytes }], tokW);
  t(`${name} (${type}) → 201`, r.status === 201, `${r.status} ${JSON.stringify(r.body)}`);
}

console.log('\n── refusals ──');
let before = stored();
r = await upload('ta-po', [{ name: 'PO.pdf', type: 'application/pdf', bytes: PDF }], tokR);
t('a read-only token → 403 token_scope, nothing stored', r.status === 403 && r.body?.error === 'token_scope' && stored() === before, JSON.stringify(r.body));
r = await upload('ta-closed', [{ name: 'PO.pdf', type: 'application/pdf', bytes: PDF }], tokW);
t('a channel the account is not in → 404, nothing stored', r.status === 404 && stored() === before, `${r.status}`);
r = await json('POST', '/comms/channels/ta-closed/messages', { body: 'not a member' }, tokW);
t('…and posting there → 404', r.status === 404);
r = await upload('ta-dm', [{ name: 'dm.pdf', type: 'application/pdf', bytes: PDF }], tokW);
t('a DM the bot is a participant in works → 201', r.status === 201, `${r.status}`);
r = await json('POST', '/comms/channels/ta-dm/messages', { body: 'In the DM.', attachment_ids: [r.body?.[0]?.id] }, tokW);
t('…and links in that DM', r.status === 201 && r.body?.attachments?.length === 1);
before = stored();
for (const [label, f] of [
  ['an .exe', { name: 'setup.exe', type: 'application/octet-stream', bytes: Buffer.from('MZ\x90\x00') }],
  ['an .html', { name: 'page.html', type: 'text/html', bytes: HTML }],
  ['an .svg', { name: 'logo.svg', type: 'image/svg+xml', bytes: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>') }],
  ['a .zip', { name: 'bundle.zip', type: 'application/zip', bytes: ZIP }],
  ['a video', { name: 'clip.mp4', type: 'video/mp4', bytes: Buffer.alloc(64, 0) }],
  ['a .pdf whose body is HTML', { name: 'fake.pdf', type: 'application/pdf', bytes: HTML }],
  ['a .png declared as text/html', { name: 'x.png', type: 'text/html', bytes: PNG }],
  ['a .docx whose body is not a zip', { name: 'x.docx', type: DOCX_T, bytes: PDF }],
  ['a .csv with binary in it', { name: 'x.csv', type: 'text/csv', bytes: Buffer.from([0x61, 0x00, 0x62]) }],
  ['no extension', { name: 'README', type: 'application/pdf', bytes: PDF }],
]) {
  r = await upload('ta-po', [f], tokW);
  t(`${label} → 415`, r.status === 415 && r.body?.error === 'unsupported_type' && /bot token|not a|declared/.test(r.body?.message || ''), `${r.status} ${JSON.stringify(r.body)}`);
}
r = await upload('ta-po', [{ name: 'good.pdf', type: 'application/pdf', bytes: PDF }, { name: 'bad.html', type: 'text/html', bytes: HTML }], tokW);
t('a batch with one refused file → 415 and stores NOTHING (not even the good one)', r.status === 415 && stored() === before, `${r.status} stored ${stored() - before}`);

const big = Buffer.concat([PDF, Buffer.alloc(25 * 1024 * 1024 + 10, 0x20)]);
r = await upload('ta-po', [{ name: 'huge.pdf', type: 'application/pdf', bytes: big }], tokW);
const rp = await fetch(`${BASE}/api/comms/channels/ta-po/attachments`, { method: 'POST', headers: { Authorization: `Bearer ${person}` }, body: (() => { const fd = new FormData(); fd.append('files', new Blob([big], { type: 'application/pdf' }), 'huge.pdf'); return fd; })() });
const rpBody = await rp.json().catch(() => null);
t('oversize → 413, the same refusal a person gets', r.status === 413 && rp.status === 413 && r.body?.error === rpBody?.error, `${r.status}/${rp.status} ${JSON.stringify(r.body)} vs ${JSON.stringify(rpBody)}`);
t('…and nothing was stored', stored() === before);
const fds = new FormData();
for (let i = 0; i < 11; i++) fds.append('files', new Blob([PDF], { type: 'application/pdf' }), `p${i}.pdf`);
const r11 = await fetch(`${BASE}/api/comms/channels/ta-po/attachments`, { method: 'POST', headers: { Authorization: `Bearer ${tokW}` }, body: fds });
t('eleven files in one request is refused (the 10-file cap holds)', r11.status === 413 && stored() === before, String(r11.status));

console.log('\n── audit ──');
const rows = db.prepare("SELECT details, actor_id FROM audit_log WHERE entity_type = 'chat_attachment' AND entity_id = ?").all(pdfId);
const det = rows[0] ? JSON.parse(rows[0].details) : {};
t('one audit row for the PDF, as the bot account', rows.length === 1 && rows[0].actor_id === 'ta-bot', JSON.stringify(rows));
t('…carrying via_token {id, prefix}', det.via_token?.id && /^rdk_/.test(det.via_token?.prefix || ''), JSON.stringify(det.via_token));
t('…and channel, attachment id, filename, type and size', det.channel_id === 'ta-po' && det.attachment_id === pdfId && det.filename === 'PO-4471.pdf'
  && det.content_type === 'application/pdf' && det.size === PDF.length, JSON.stringify(det));
t("a person's upload writes no such row (unchanged)", db.prepare("SELECT COUNT(*) n FROM audit_log WHERE entity_type = 'chat_attachment' AND entity_id = ?").get(personAtt).n === 0);

console.log('\n── the person path is unchanged ──');
r = await upload('ta-po', [{ name: 'logo.svg', type: 'image/svg+xml', bytes: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>') }], person);
t('a person may still attach an .svg', r.status === 201, `${r.status}`);
r = await upload('ta-closed', [{ name: 'a.txt', type: 'text/plain', bytes: Buffer.from('hi') }], admin);
t('an admin session still reaches a channel it is not in (administration)', r.status === 201, `${r.status}`);

console.log('\n── forbidden routes stay refused ──');
const denied = (x, err = 'token_denied') => x.status === 403 && x.body?.error === err;
r = await json('DELETE', `/comms/messages/${msgId}`, null, tokF);
t('DELETE /api/comms/messages/:id → 403 token_denied (delete)', denied(r) && r.body?.category === 'delete' && db.prepare('SELECT deleted_at FROM chat_messages WHERE id = ?').get(msgId)?.deleted_at == null, JSON.stringify(r.body));
r = await json('DELETE', '/comms/channels/ta-po', null, tokF);
t('DELETE /api/comms/channels/:id → 403 token_denied', denied(r) && db.prepare("SELECT archived FROM chat_channels WHERE id = 'ta-po'").get()?.archived === 0, JSON.stringify(r.body));
r = await json('PUT', `/comms/messages/${msgId}`, { body: 'edited by token' }, tokF);
t('PUT /api/comms/messages/:id (edit) → refused to a token', r.status === 403 && ['token_denied'].includes(r.body?.error), JSON.stringify(r.body));
r = await json('POST', '/comms/channels', { name: 'bot-made', kind: 'public' }, tokF);
t('POST /api/comms/channels (new channel) → 403 token_denied', denied(r), JSON.stringify(r.body));
for (const [m, p, b] of [['POST', '/nfp/x/decide', {}], ['POST', '/documents/x/sign', {}], ['POST', '/qa-review/sign', {}], ['PUT', '/loto/executions/x/release', {}],
  ['POST', '/partners/x/settle', {}], ['POST', '/sanitation/x/verify', {}]]) {
  r = await json(m, p, b, tokF);
  t(`${m} /api${p} → 403 approve_requires_human_session`, denied(r, 'approve_requires_human_session'), JSON.stringify(r.body));
}
r = await json('POST', '/users', { name: 'Bot Made' }, tokF);
t('POST /api/users → 403 token_denied (user_admin)', denied(r) && r.body?.category === 'user_admin', JSON.stringify(r.body));
r = await json('GET', '/api-tokens', null, tokF);
t('GET /api/api-tokens → 403 token_denied (token_admin)', denied(r) && r.body?.category === 'token_admin', JSON.stringify(r.body));

console.log('\n── an admin-role account ──');
db.prepare("UPDATE users SET role = 'admin' WHERE id = 'ta-promo'").run();
r = await upload('ta-closed', [{ name: 'PO.pdf', type: 'application/pdf', bytes: PDF }], tokPromo);
t('promoting the bot account to admin kills its token (401), so admin reach never applies', r.status === 401, `${r.status}`);

console.log('\n── rate limit: uploads spend the WRITE bucket ──');
let hit = 0, n = 0;
for (; n < WRITE_RPM + 3; n++) {
  r = await upload('ta-po', [{ name: `r${n}.pdf`, type: 'application/pdf', bytes: PDF }], tokRate);
  if (r.status === 429) { hit = n; break; }
}
t(`the ${WRITE_RPM + 1}th upload in a minute → 429 (API_TOKEN_WRITE_RPM=${WRITE_RPM})`, r.status === 429 && hit === WRITE_RPM, `${r.status} at ${n}`);
r = await json('GET', '/comms/channels', null, tokRate);
t('…while the read bucket is untouched (a GET still answers 200)', r.status === 200, `${r.status}`);

db.close();
console.log(`\n${pass}/${pass + fail} assertions passed`);
process.exit(fail ? 1 : 0);
