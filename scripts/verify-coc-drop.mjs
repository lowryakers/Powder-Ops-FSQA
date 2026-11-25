// D-398: COC Drop — the dock photographs a COC / COA; the queue matches and files it.
//
// What this proves (live server, fresh database, the S3 stand-in):
//   - a warehouse operator drops one photo, and a three-page set as ONE drop;
//   - typed PO / supplier / note are stored as typed;
//   - the operator sees only their own drops; another's is 404; PUT/status/file are 403;
//   - Quality and a suppliers-edit token see the whole queue, set the match fields,
//     and a PO moves new → matched; a mismatch note moves it to mismatch;
//   - mismatch without a reason is 400; filed without a library file is 400;
//   - a coc-drop-only token works the queue but may not file (403);
//   - filing: pages become ONE PDF in supplier_files with the D-391 fields, the
//     drop is filed, receiving_alert comes back, and filing twice adds nothing;
//   - a new supplier name is added UNQUALIFIED (source bot); a near-name is 409, no duplicate;
//   - a token is refused the receiving sign-off; DELETE is 403 and nothing is gone;
//   - the same pages dropped again are kept as a second drop;
//   - audit: one coc_drop.created per drop, status rows, no audit row edited;
//   - a token's list has no storage_key.
// Caller sets PORT + DBPATH on a FRESH database, with the S3 stand-in.
import { PDFDocument } from 'pdf-lib';

const PORT = process.env.PORT || 5256;
const URL = `http://localhost:${PORT}`;
let pass = 0, fail = 0;
const t = (n, c, d = '') => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (d ? ' — ' + d : '')); } };

const { default: Database } = await import('better-sqlite3');
const db = new Database(process.env.DBPATH);
db.pragma('busy_timeout = 10000');
const mkUser = (id, name, role, dept, ma) => db.prepare(`INSERT OR REPLACE INTO users (id, name, username, role, department, is_active, module_access, setup_code, setup_code_expires_at)
  VALUES (?, ?, ?, ?, ?, 1, ?, ?, datetime('now','+7 day'))`).run(id, name, name, role, dept, ma, `SC-${id}`);
mkUser('cd-a', 'Drop Admin', 'admin', 'admin', null);
mkUser('cd-op', 'Dock Juan', 'operator', 'warehouse', JSON.stringify({ 'receiving-log': 'view' }));
mkUser('cd-op2', 'Dock Jorge', 'operator', 'warehouse', JSON.stringify({ 'receiving-log': 'view' }));
mkUser('cd-qa', 'Quality Maria', 'supervisor', 'qa', JSON.stringify({ suppliers: 'edit', 'receiving-log': 'edit' }));
mkUser('cd-bot', '*Procurement Bot', 'operator', 'purchasing', JSON.stringify({ suppliers: 'edit', 'receiving-log': 'view' }));
mkUser('cd-bot2', '*Drop Only Bot', 'operator', 'purchasing', JSON.stringify({ suppliers: 'view', 'receiving-log': 'view' }));
db.prepare("INSERT OR REPLACE INTO suppliers (id, name, vendor_type, actively_using) VALUES ('cd-berlin', 'Berlin Packaging', 'packaging', 1)").run();

const H = { 'Content-Type': 'application/json' };
const call = async (method, p, body, headers = H) => {
  const r = await fetch(`${URL}/api${p}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  let j = null; try { j = await r.json(); } catch { /* no body */ }
  return { status: r.status, body: j };
};
const login = async (id, name, pw) => {
  await call('POST', '/users/set-password', { user_id: id, password: pw, setup_code: `SC-${id}` });
  const r = await call('POST', '/users/login', { name, password: pw });
  return { headers: { ...H, Authorization: `Bearer ${r.body?.token}` }, auth: `Bearer ${r.body?.token}`, token: r.body?.token };
};
const A = await login('cd-a', 'Drop Admin', 'DropAdmin2026!');
const OP = await login('cd-op', 'Dock Juan', 'DockJuan2026!');
const OP2 = await login('cd-op2', 'Dock Jorge', 'DockJorge2026!');
const QA = await login('cd-qa', 'Quality Maria', 'QualMaria2026!');
const mint = async (user, grants) => {
  const m = await call('POST', '/api-tokens', { user_id: user, label: `fixture ${user}`, scopes: ['read', 'write'] }, A.headers);
  await call('POST', `/api-tokens/${m.body?.token?.id}/grants`, { grants }, A.headers);
  return `Bearer ${m.body?.plaintext}`;
};
const BOT = await mint('cd-bot', ['suppliers-edit']);
const BOT2 = await mint('cd-bot2', ['coc-drop']);
const BH = { ...H, Authorization: BOT };
const B2H = { ...H, Authorization: BOT2 };
t('signed in the dock, Quality and an admin; two fixture tokens', !!OP.token && !!QA.token && BOT.length > 20 && BOT2.length > 20);

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const pdfBytes = async (pages = 1) => { const d = await PDFDocument.create(); for (let i = 0; i < pages; i++) d.addPage([200, 200]); return Buffer.from(await d.save()); };
const drop = async (auth, pages, fields = {}) => {
  const fd = new FormData();
  for (const [name, buf, type] of pages) fd.append('files', new Blob([buf], { type }), name);
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  const r = await fetch(`${URL}/api/coc-drop`, { method: 'POST', headers: { Authorization: auth }, body: fd });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const rows = (id) => db.prepare('SELECT COUNT(*) n FROM coc_drop_files WHERE drop_id = ?').get(id).n;

console.log('\n── the dock drops ──');
let r = await drop(OP.auth, [['coc-photo.png', PNG, 'image/png']]);
t('one photo: 201, one drop, status new', r.status === 201 && r.body?.drop?.status === 'new' && rows(r.body.drop.id) === 1, JSON.stringify(r.body));
const single = r.body?.drop;
const three = [['p1.png', PNG, 'image/png'], ['p2.png', Buffer.concat([PNG, Buffer.from([0])]), 'image/png'], ['p3.png', Buffer.concat([PNG, Buffer.from([1])]), 'image/png']];
r = await drop(OP.auth, three, { po_number: 'PO00612', supplier_id: 'cd-berlin', notes: 'Pallet 2 of 3' });
const multi = r.body?.drop;
t('three photos in one request: ONE drop with three pages', r.status === 201 && rows(multi?.id) === 3 && db.prepare('SELECT COUNT(*) n FROM coc_drops').get().n === 2);
t('typed PO, supplier and note are stored as typed', multi?.po_number === 'PO00612' && multi?.supplier_id === 'cd-berlin' && multi?.notes === 'Pallet 2 of 3');
t('…and the pages are in order', JSON.stringify(db.prepare('SELECT filename FROM coc_drop_files WHERE drop_id = ? ORDER BY page_index').all(multi.id).map(x => x.filename)) === '["p1.png","p2.png","p3.png"]');
r = await drop(OP.auth, [['notes.txt', Buffer.from('hello'), 'text/plain']]);
t('a file that is not a photo or a PDF is refused (400)', r.status === 400);
r = await drop(OP.auth, []);
t('nothing attached is 400', r.status === 400);

console.log('\n── who sees what ──');
const other = (await drop(OP2.auth, [['jorge.png', PNG, 'image/png']])).body?.drop;
r = await call('GET', '/coc-drop', undefined, OP.headers);
t("the operator's list is only their own drops", r.status === 200 && r.body.length === 2 && r.body.every(d => d.is_mine));
t("…someone else's drop is 404", (await call('GET', `/coc-drop/${other.id}`, undefined, OP.headers)).status === 404);
t('…their own drop opens, with its pages', (await call('GET', `/coc-drop/${multi.id}`, undefined, OP.headers)).body?.page_files?.length === 3);
t('…PUT is 403', (await call('PUT', `/coc-drop/${multi.id}`, { part_number: 'X' }, OP.headers)).status === 403);
t('…status is 403', (await call('POST', `/coc-drop/${multi.id}/status`, { status: 'matched' }, OP.headers)).status === 403);
t('…file is 403', (await call('POST', `/coc-drop/${multi.id}/file`, {}, OP.headers)).status === 403);
t('…but a note on their own drop is fine (201)', (await call('POST', `/coc-drop/${multi.id}/notes`, { text: 'It was raining' }, OP.headers)).status === 201);
r = await call('GET', '/coc-drop/meta', undefined, OP.headers);
t('meta for the dock: can_work false, the PO typed earlier is offered', r.body?.can_work === false && r.body?.recent_pos?.includes('PO00612'));
r = await call('GET', '/coc-drop', undefined, QA.headers);
t('Quality sees the whole queue', r.body?.length === 3);
r = await call('GET', '/coc-drop', undefined, { Authorization: BOT });
t('a suppliers-edit token sees the whole queue, paged', r.body?.length === 3 && r.body.every(d => !('storage_key' in d) && !('extracted_text' in d)));
r = await call('GET', `/coc-drop/${multi.id}`, undefined, BH);
t("a token's drop detail carries no storage key", r.status === 200 && r.body.page_files.every(p => !('storage_key' in p) && p.url === null));

console.log('\n── the queue matches ──');
r = await call('PUT', `/coc-drop/${single.id}`, { po_number: 'PO00777', part_number: '3801C01BLK', lot_number: '62458740228', qty_note: '37,500' }, BH);
t('a token sets PO, part, lot, quantity; a PO moves new → matched', r.status === 200 && r.body.status === 'matched' && r.body.lot_number === '62458740228', JSON.stringify(r.body));
r = await call('PUT', `/coc-drop/${other.id}`, { mismatch_note: 'Lot on the COC is not the lot on the pallet' }, QA.headers);
t('Quality: a mismatch note moves it to mismatch', r.body?.status === 'mismatch');
t('mismatch with no reason is 400', (await call('POST', `/coc-drop/${multi.id}/status`, { status: 'mismatch' }, QA.headers)).status === 400);
r = await call('POST', `/coc-drop/${multi.id}/status`, { status: 'mismatch', reason: 'Quantity short by one pallet' }, QA.headers);
t('…with a reason it sticks on the row', r.body?.status === 'mismatch' && r.body.status_reason === 'Quantity short by one pallet' && r.body.mismatch_note === 'Quantity short by one pallet');
t('filed by hand, with nothing in the library, is 400', (await call('POST', `/coc-drop/${multi.id}/status`, { status: 'filed' }, QA.headers)).status === 400);
t('an unknown status is 400', (await call('POST', `/coc-drop/${multi.id}/status`, { status: 'received' }, QA.headers)).status === 400);
r = await call('POST', `/coc-drop/${multi.id}/status`, { status: 'matched' }, B2H);
t('a coc-drop-only token works the queue', r.status === 200 && r.body.status === 'matched');
t('…but may not file into the library (403)', (await call('POST', `/coc-drop/${multi.id}/file`, {}, B2H)).status === 403);

console.log('\n── filing into the library ──');
const libBefore = db.prepare('SELECT COUNT(*) n FROM supplier_files').get().n;
r = await call('POST', `/coc-drop/${multi.id}/file`, {}, BH);
const lib = db.prepare("SELECT * FROM supplier_files WHERE supplier_id = 'cd-berlin' ORDER BY created_at DESC").all();
t('three photos file as ONE library document', r.status === 200 && r.body.saved?.length === 1 && r.body.stitched === true && lib.length === 1, JSON.stringify(r.body));
t('…a coc with the PO, as a PDF', lib[0]?.kind === 'coc' && lib[0]?.po_number === 'PO00612' && lib[0]?.content_type === 'application/pdf');
t('…the drop is filed, with its library id and a closed time', r.body.drop?.status === 'filed' && r.body.drop.supplier_file_ids[0] === lib[0]?.id && !!r.body.drop.closed_at);
t('…receiving_alert comes back (no channel set → not posted, says why)', r.body.receiving_alert?.posted === false && !!r.body.receiving_alert?.reason, JSON.stringify(r.body.receiving_alert));
r = await call('POST', `/coc-drop/${multi.id}/file`, {}, BH);
t('filing again is a no-op (no second library file)', r.status === 200 && r.body.already_filed === true && db.prepare('SELECT COUNT(*) n FROM supplier_files').get().n === libBefore + 1);
t('a filed drop cannot be moved back', (await call('POST', `/coc-drop/${multi.id}/status`, { status: 'new' }, QA.headers)).status === 400);

console.log('\n── a supplier not on the list ──');
r = await call('POST', `/coc-drop/${single.id}/file`, {}, BH);
t('no supplier chosen or named: 400 SUPPLIER_REQUIRED', r.status === 400 && r.body?.code === 'SUPPLIER_REQUIRED');
r = await call('POST', `/coc-drop/${single.id}/file`, { supplier_name: 'Berlin Packaging LLC', vendor_type: 'packaging' }, BH);
t('a near-name of a supplier on file: 409 SUPPLIER_NEAR_MATCH, nothing added', r.status === 409 && r.body?.code === 'SUPPLIER_NEAR_MATCH'
  && db.prepare("SELECT COUNT(*) n FROM suppliers WHERE name LIKE 'Berlin%'").get().n === 1);
const coa = (await drop(OP.auth, [['coa.pdf', await pdfBytes(2), 'application/pdf']], { kind: 'coa', supplier_name: 'Glacier Labs' })).body?.drop;
await call('PUT', `/coc-drop/${coa.id}`, { po_number: 'PO00900', lot_number: 'L-77' }, BH);
r = await call('POST', `/coc-drop/${coa.id}/file`, { vendor_type: 'ingredient' }, BH);
const glacier = db.prepare("SELECT * FROM suppliers WHERE name = 'Glacier Labs'").get();
t('a new name is added UNQUALIFIED, by the bot, and the COA filed against it', r.status === 200 && !!glacier && glacier.status === 'unqualified' && glacier.source === 'bot'
  && db.prepare("SELECT kind, lot_number FROM supplier_files WHERE supplier_id = ?").get(glacier.id)?.kind === 'coa', JSON.stringify(r.body));
t('…a single PDF is filed as it is, not re-made', r.body?.stitched === false);
const disp = await call('POST', `/suppliers/${glacier.id}/disposition`, { disposition: 'approved' }, BH);
t('a token cannot qualify that supplier', disp.status === 403);

console.log('\n── never receive, never sign, never delete ──');
r = await call('POST', '/receiving/checklist/A-100-0001/review', {}, BH);
t('a token is refused the receiving sign-off (403)', r.status === 403);
const objBefore = db.prepare('SELECT COUNT(*) n FROM coc_drop_files').get().n;
for (const [who, h] of [['token', BH], ['Quality', QA.headers], ['admin', A.headers]]) {
  r = await call('DELETE', `/coc-drop/${single.id}`, undefined, h);
  t(`DELETE as ${who} is 403`, r.status === 403);
}
t('…the drop and its pages are still there', !!db.prepare('SELECT 1 FROM coc_drops WHERE id = ?').get(single.id) && db.prepare('SELECT COUNT(*) n FROM coc_drop_files').get().n === objBefore);
const stored = db.prepare('SELECT storage_key FROM coc_drop_files WHERE drop_id = ?').get(single.id).storage_key;
r = await call('GET', `/coc-drop/${single.id}`, undefined, QA.headers);
t('…and the stored page still opens', r.status === 200 && !!r.body.page_files[0]?.url && !!stored);
let refused = false; try { db.prepare('DELETE FROM coc_drops WHERE id = ?').run(single.id); } catch { refused = true; }
t('the table itself refuses a DELETE', refused);
r = await drop(OP.auth, [['coc-photo.png', PNG, 'image/png']]);
t('the same page dropped again is a second drop, kept, naming the first', r.status === 201 && r.body.drop.id !== single.id && /earlier/.test(r.body.drop.status_reason || '') && r.body.drop.status === 'new');

console.log('\n── audit ──');
const created = db.prepare("SELECT COUNT(*) n FROM audit_log WHERE entity_type = 'coc_drop' AND details LIKE '%coc_drop.created%'").get().n;
const drops = db.prepare('SELECT COUNT(*) n FROM coc_drops').get().n;
t('one coc_drop.created per drop', created === drops, `${created} vs ${drops}`);
t('status changes and filing are audited', db.prepare("SELECT COUNT(*) n FROM audit_log WHERE entity_type = 'coc_drop' AND action IN ('status','coc_drop_status')").get().n >= 3);
t('the filed event is on the drop', !!db.prepare("SELECT 1 FROM coc_drop_events WHERE drop_id = ? AND kind = 'filed'").get(multi.id));
let editRefused = false; try { db.prepare("UPDATE audit_log SET actor = 'x' WHERE entity_type = 'coc_drop'").run(); } catch { editRefused = true; }
t('audit rows cannot be edited', editRefused);

console.log(`\n${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
