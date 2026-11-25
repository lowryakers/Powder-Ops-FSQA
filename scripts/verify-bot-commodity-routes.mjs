// D-400: commodity bot work opens with Edit on the bot account's module.
//
// Lowry, 25 Nov: creating an unqualified supplier, filing a COC / COA and moving a
// queue's status are bot work. Setting the bot's account to Edit in Settings → Users
// should take effect without a second, hidden token grant — and the refusal should
// never say "not open to bot tokens" for a route that is.
//
// What this proves (live server, fresh database, the S3 stand-in):
//   1. grants [] + Suppliers Edit: add a supplier (unqualified, source bot; near-match 409),
//      file a supplier document; Suppliers → View closes it at once (403 missing_grant).
//   2. grants [] + COC Drop + Suppliers Edit: drop, match, mismatch, file into the library.
//   3. grants [] + COA Edit: file an unsigned lab request, attach its PDF; never a status;
//      a signed request is refused; signing is refused.
//   4. neither grant nor Edit: 403 missing_grant naming the grant and the module Edit;
//      a route not open to tokens still says not_open_to_tokens.
//   5. person-only stays person-only: disposition, banned-check, COA sign, plan apply,
//      receiving sign-off, and every DELETE on suppliers / coc-drop / coa.
//   6. audit: each bot write has its handler row carrying via_token and an api_token_call
//      row; an audit row cannot be deleted.
// Caller sets PORT + DBPATH on a FRESH database, with the S3 stand-in.
import { PDFDocument } from 'pdf-lib';

const PORT = process.env.PORT || 5257;
const URL = `http://localhost:${PORT}`;
let pass = 0, fail = 0;
const t = (n, c, d = '') => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (d ? ' — ' + d : '')); } };

const { default: Database } = await import('better-sqlite3');
const db = new Database(process.env.DBPATH);
db.pragma('busy_timeout = 10000');
const mkUser = (id, name, role, dept, ma) => db.prepare(`INSERT OR REPLACE INTO users (id, name, username, role, department, is_active, module_access, setup_code, setup_code_expires_at)
  VALUES (?, ?, ?, ?, ?, 1, ?, ?, datetime('now','+7 day'))`).run(id, name, name, role, dept, ma, `SC-${id}`);
const setAccess = (id, ma) => db.prepare('UPDATE users SET module_access = ? WHERE id = ?').run(JSON.stringify(ma), id);
mkUser('bc-a', 'Commodity Admin', 'admin', 'admin', null);
mkUser('bc-bot', '*Procurement Bot', 'operator', 'purchasing', JSON.stringify({ suppliers: 'edit', 'coc-drop': 'edit', coa: 'edit', 'ap-drop': 'edit', 'receiving-log': 'view' }));
mkUser('bc-bot2', '*Read Bot', 'operator', 'purchasing', JSON.stringify({ suppliers: 'view', 'coc-drop': 'view', coa: 'view' }));
db.prepare("INSERT OR REPLACE INTO suppliers (id, name, vendor_type, actively_using) VALUES ('bc-berlin', 'Berlin Packaging', 'packaging', 1)").run();

const H = { 'Content-Type': 'application/json' };
const call = async (method, p, body, headers = H) => {
  const r = await fetch(`${URL}/api${p}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  let j = null; try { j = await r.json(); } catch { /* no body */ }
  return { status: r.status, body: j };
};
const login = async (id, name, pw) => {
  await call('POST', '/users/set-password', { user_id: id, password: pw, setup_code: `SC-${id}` });
  const r = await call('POST', '/users/login', { name, password: pw });
  return { ...H, Authorization: `Bearer ${r.body?.token}` };
};
const A = await login('bc-a', 'Commodity Admin', 'CommAdmin2026!');
const mint = async (user) => {
  const m = await call('POST', '/api-tokens', { user_id: user, label: `fixture ${user}`, scopes: ['read', 'write'] }, A);
  return { id: m.body?.token?.id, auth: `Bearer ${m.body?.plaintext}`, grants: m.body?.token?.grants };
};
const BOT = await mint('bc-bot');
const BOT2 = await mint('bc-bot2');
const B = { ...H, Authorization: BOT.auth };
const B2 = { ...H, Authorization: BOT2.auth };
t('two write tokens with NO grants', !!BOT.id && !!BOT2.id && (BOT.grants || []).length === 0);

const pdf = async () => { const d = await PDFDocument.create(); d.addPage([200, 200]); return Buffer.from(await d.save()); };
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const upload = async (auth, path, field, files, fields = {}) => {
  const fd = new FormData();
  for (const [name, buf, type] of files) fd.append(field, new Blob([buf], { type }), name);
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  const r = await fetch(`${URL}/api${path}`, { method: 'POST', headers: { Authorization: auth }, body: fd });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const tokenCalls = (path) => db.prepare(`SELECT COUNT(*) n FROM audit_log WHERE action IN ('api_token_call') AND details LIKE ?`).get(`%${path}%`).n;
const viaToken = (entityType, id) => db.prepare(`SELECT COUNT(*) n FROM audit_log WHERE entity_type = ? AND entity_id = ? AND details LIKE '%via_token%'`).get(entityType, id).n;

console.log('\n── 1. Suppliers Edit, no grant ──');
let r = await call('POST', '/suppliers', { name: 'Glacier Labs', vendor_type: 'ingredient' }, B);
const glacier = r.body?.id;
const g = glacier ? db.prepare('SELECT status, source FROM suppliers WHERE id = ?').get(glacier) : null;
t('POST /api/suppliers: 201, unqualified, source bot', r.status === 201 && g?.status === 'unqualified' && g?.source === 'bot', JSON.stringify(r.body));
r = await call('POST', '/suppliers', { name: 'Berlin Packaging LLC', vendor_type: 'packaging' }, B);
t('…a near-name is still 409 SUPPLIER_NEAR_MATCH', r.status === 409 && r.body?.code === 'SUPPLIER_NEAR_MATCH');
r = await upload(BOT.auth, '/suppliers/bc-berlin/files', 'files', [['COC.pdf', await pdf(), 'application/pdf']], { kind: 'coc', po_number: 'PO00612' });
t('POST /api/suppliers/:id/files files a COC', r.status === 200 && r.body?.saved?.length === 1, JSON.stringify(r.body));
r = await call('PUT', '/suppliers/bc-berlin', { website: 'berlinpackaging.com' }, B);
t('PUT /api/suppliers/:id (details)', r.status === 200, JSON.stringify(r.body));
r = await call('GET', '/suppliers', undefined, B);
t('GET /api/suppliers says can_create', r.body?.can_create === true);
setAccess('bc-bot', { suppliers: 'view', 'coc-drop': 'edit', coa: 'edit', 'ap-drop': 'edit' });
r = await call('POST', '/suppliers', { name: 'Arctic Labs', vendor_type: 'ingredient' }, B);
t('Suppliers set to View in Settings: the next write is 403 at once', r.status === 403 && r.body?.category === 'missing_grant', JSON.stringify(r.body));
t('…can_create reads false', (await call('GET', '/suppliers', undefined, B)).body?.can_create === false);
setAccess('bc-bot', { suppliers: 'edit', 'coc-drop': 'edit', coa: 'edit', 'ap-drop': 'edit' });
t('…and Edit again opens it', (await call('POST', '/suppliers', { name: 'Arctic Labs', vendor_type: 'ingredient' }, B)).status === 201);

console.log('\n── 2. COC Drop + Suppliers Edit, no grant ──');
r = await upload(BOT.auth, '/coc-drop', 'files', [['p1.png', PNG, 'image/png']], { po_number: 'PO00900', supplier_id: 'bc-berlin' });
const drop = r.body?.drop;
t('POST /api/coc-drop: 201, one drop', r.status === 201 && ['new', 'matched'].includes(drop?.status), JSON.stringify(r.body));
t('…meta says can_work', (await call('GET', '/coc-drop/meta', undefined, B)).body?.can_work === true);
r = await call('POST', `/coc-drop/${drop.id}/status`, { status: 'matched' }, B);
t('status → matched', r.status === 200 && r.body.status === 'matched');
r = await call('POST', `/coc-drop/${drop.id}/status`, { status: 'mismatch', reason: 'Lot differs from the pallet' }, B);
t('status → mismatch, with a reason', r.status === 200 && r.body.status === 'mismatch');
r = await call('POST', `/coc-drop/${drop.id}/file`, {}, B);
t('file into the library (Suppliers Edit stands in for suppliers-edit)', r.status === 200 && r.body.drop?.status === 'filed'
  && !!db.prepare("SELECT 1 FROM supplier_files WHERE id = ?").get(r.body.drop.supplier_file_ids[0]), JSON.stringify(r.body));
setAccess('bc-bot', { suppliers: 'view', 'coc-drop': 'edit', coa: 'edit' });
const drop2 = (await upload(BOT.auth, '/coc-drop', 'files', [['p2.png', Buffer.concat([PNG, Buffer.from([3])]), 'image/png']], { supplier_id: 'bc-berlin' })).body?.drop;
t('with COC Drop Edit only, the queue still works', (await call('PUT', `/coc-drop/${drop2.id}`, { po_number: 'PO00901' }, B)).body?.status === 'matched');
r = await call('POST', `/coc-drop/${drop2.id}/file`, {}, B);
t('…but filing into the library needs Suppliers Edit (403)', r.status === 403);
setAccess('bc-bot', { suppliers: 'edit', 'coc-drop': 'edit', coa: 'edit', 'ap-drop': 'edit' });

console.log('\n── 3. COA Edit, no grant ──');
r = await call('POST', '/coa/requests', { item_number: 'RM-100', item_description: 'Whey isolate', lot_number: 'L-555', tests_requested: 'HM & Micro', supplier: 'Glacier Labs' }, B);
const coaReq = r.body;
t('POST /api/coa/requests: 201, unsigned', r.status === 201 && !coaReq?.qa_signed_at && ['pending', 'sent'].includes(coaReq?.status), JSON.stringify(r.body));
r = await call('POST', '/coa/requests', { item_number: 'RM-101', item_description: 'X', lot_number: 'L-1', tests_requested: 'Micro', status: 'pass' }, B);
t('…with a status: 403, and the reason says status is a person\'s', r.status === 403 && /status/i.test(r.body?.reason || ''), JSON.stringify(r.body));
r = await call('PUT', `/coa/requests/${coaReq.id}`, { notes: 'Arrived on pallet 2' }, B);
t('PUT /api/coa/requests/:id (an unsigned request\'s facts)', r.status === 200 && r.body?.notes === 'Arrived on pallet 2', JSON.stringify(r.body));
r = await call('PUT', `/coa/requests/${coaReq.id}`, { status: 'pass' }, B);
t('…its status: 403', r.status === 403);
r = await upload(BOT.auth, `/coa/requests/${coaReq.id}/files`, 'file', [['lab.pdf', await pdf(), 'application/pdf']], { file_type: 'lab_results' });
t('POST /api/coa/requests/:id/files attaches the lab PDF', r.status === 201, JSON.stringify(r.body));
r = await upload(BOT.auth, '/coa/parse-coa', 'file', [['coa.pdf', await pdf(), 'application/pdf']]);
t('POST /api/coa/parse-coa is open to the token (not refused)', r.status !== 403 && r.status < 500, `${r.status} ${JSON.stringify(r.body).slice(0, 120)}`);
db.prepare("UPDATE coa_requests SET qa_signed_at = datetime('now'), qa_signed_by = 'Quality Person' WHERE id = ?").run(coaReq.id);
r = await call('PUT', `/coa/requests/${coaReq.id}`, { notes: 'changed after signing' }, B);
t('a SIGNED request: PUT is 403, naming why', r.status === 403 && /signed/i.test(r.body?.reason || ''), JSON.stringify(r.body));
r = await upload(BOT.auth, `/coa/requests/${coaReq.id}/files`, 'file', [['lab2.pdf', await pdf(), 'application/pdf']], { file_type: 'other' });
t('…and attaching to it is 403', r.status === 403);

console.log('\n── 4. neither grant nor Edit ──');
r = await call('POST', '/suppliers', { name: 'Nope Co', vendor_type: 'ingredient' }, B2);
t('403 missing_grant, never not_open_to_tokens', r.status === 403 && r.body?.error === 'token_denied' && r.body?.category === 'missing_grant', JSON.stringify(r.body));
t('…the reason names the grant and the Settings Edit', /suppliers-edit/.test(r.body?.reason || '') && /Edit on Suppliers/.test(r.body?.reason || '') && /Settings → Users/.test(r.body?.reason || ''));
r = await call('POST', '/coa/requests', { item_number: 'X', item_description: 'X', lot_number: 'X', tests_requested: 'X' }, B2);
t('COA intake without either: 403 missing_grant naming coa-prep or COA Edit', r.status === 403 && r.body?.category === 'missing_grant' && /coa-prep/.test(r.body?.reason || '') && /COA/.test(r.body?.reason || ''));
r = await call('POST', '/qms/deviation', { title: 'x' }, B);
t('a route not open to tokens still says not_open_to_tokens', r.status === 403 && r.body?.category === 'not_open_to_tokens', JSON.stringify(r.body));

console.log('\n── 5. person-only stays person-only ──');
for (const [m, p, body] of [
  ['POST', '/suppliers/bc-berlin/disposition', { disposition: 'approved' }],
  ['POST', '/suppliers/bc-berlin/materials/x/banned-check', { result: 'not_listed' }],
  ['POST', `/coa/requests/${coaReq.id}/sign`, {}],
  ['POST', '/coa/plans/x/apply', {}],
  ['POST', '/receiving/checklist/A-100-0001/review', {}],
  ['PUT', '/suppliers/banned-gate', { mode: 'off' }],
  ['PUT', '/coa/release-gate', { mode: 'off' }],
  ['DELETE', '/suppliers/bc-berlin', undefined],
  ['DELETE', `/coc-drop/${drop.id}`, undefined],
  ['DELETE', `/coa/requests/${coaReq.id}`, undefined],
]) {
  r = await call(m, p, body, B);
  t(`${m} ${p.replace(/[0-9a-f-]{36}/g, ':id')}: 403`, r.status === 403, `${r.status} ${JSON.stringify(r.body)}`);
}
t('…the supplier, the drop and the request are all still there', !!db.prepare("SELECT 1 FROM suppliers WHERE id = 'bc-berlin'").get()
  && !!db.prepare('SELECT 1 FROM coc_drops WHERE id = ?').get(drop.id) && !!db.prepare('SELECT 1 FROM coa_requests WHERE id = ?').get(coaReq.id));
t('…and no supplier was qualified by a token', db.prepare("SELECT COUNT(*) n FROM suppliers WHERE status = 'approved'").get().n === 0);

console.log('\n── AP Drop status, module Edit, for comparison ──');
const ap = (await upload(BOT.auth, '/ap-drop', 'files', [['inv.pdf', await pdf(), 'application/pdf']])).body?.drops?.[0];
r = await call('POST', `/ap-drop/${ap?.id}/status`, { status: 'triaged' }, B);
t('ap-drop status moves with AP Drop Edit and no grant (unchanged)', r.status === 200 && r.body?.status === 'triaged', JSON.stringify(r.body));

console.log('\n── 6. audit ──');
t('the supplier the bot added has its own audit row with via_token', viaToken('supplier', glacier) >= 1);
t('the COC drop has its own audit row with via_token', viaToken('coc_drop', drop.id) >= 1);
t('the COA request has its own audit row with via_token', viaToken('coa_request', coaReq.id) >= 1);
t('every bot write also has an api_token_call row', tokenCalls('/api/suppliers') >= 3 && tokenCalls('/api/coc-drop') >= 3 && tokenCalls('/api/coa/requests') >= 2);
t('refusals are logged as api_token_write_blocked with category missing_grant',
  db.prepare("SELECT COUNT(*) n FROM audit_log WHERE action = 'api_token_write_blocked' AND details LIKE '%missing_grant%'").get().n >= 2);
let refused = false; try { db.prepare("DELETE FROM audit_log WHERE action = 'api_token_call'").run(); } catch { refused = true; }
t('an audit row cannot be deleted', refused);

console.log(`\n${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
