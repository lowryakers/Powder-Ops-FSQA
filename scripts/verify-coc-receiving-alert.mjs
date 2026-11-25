// D-392 (A-20261125-002 / -003): a delivery's COC / COA filed with its PO makes
// ReadyBot post ONE alert in the receiving channel an admin chose.
//
// What this proves:
//   - only an admin sets the channel; a supervisor and a token get 403; a DM, a
//     client channel and an archived channel are refused;
//   - with no channel set, the COC is still filed and nothing is posted;
//   - a bot token files a COC with its PO: ReadyBot posts in that channel, naming
//     the supplier, PO, parts, lot, quantity and the Supplier Docs link;
//   - two files in one upload are ONE message;
//   - a mismatch note turns the header into "CHECK MISMATCH" and says what;
//   - notify_receiving=false, a COC with no PO, and a spec with a PO post nothing;
//   - the channel archived later: the filing succeeds, nothing posted;
//   - Settings shows the picker; the alert's link opens that supplier.
// Caller sets PORT + DBPATH on a FRESH database, with the S3 stand-in.
import { chromium } from 'playwright-core';

const PORT = process.env.PORT || 5250;
const URL = `http://localhost:${PORT}`;
let pass = 0, fail = 0;
const t = (n, c, d = '') => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (d ? ' — ' + d : '')); } };

const { default: Database } = await import('better-sqlite3');
const db = new Database(process.env.DBPATH);
db.pragma('busy_timeout = 10000');
const mkUser = (id, name, role, dept, ma) => db.prepare(`INSERT OR REPLACE INTO users (id, name, username, role, department, is_active, module_access, setup_code, setup_code_expires_at)
  VALUES (?, ?, ?, ?, ?, 1, ?, ?, datetime('now','+7 day'))`).run(id, name, name, role, dept, ma, `SC-${id}`);
mkUser('ra-a', 'Alert Admin', 'admin', 'admin', null);
mkUser('ra-s', 'Alert Supervisor', 'supervisor', 'warehouse', JSON.stringify({ 'receiving-log': 'edit', suppliers: 'edit' }));
mkUser('ra-bot', '*Procurement Bot', 'operator', 'purchasing', JSON.stringify({ suppliers: 'edit', 'receiving-log': 'view' }));
db.prepare("INSERT OR REPLACE INTO suppliers (id, name, vendor_type, actively_using) VALUES ('ra-berlin', 'Berlin Packaging', 'packaging', 1)").run();
const ch = (id, kind, name, archived = 0) => db.prepare('INSERT OR REPLACE INTO chat_channels (id, kind, name, archived) VALUES (?,?,?,?)').run(id, kind, name, archived);
ch('ra-rs', 'public', 'receiving--shipping');
ch('ra-client', 'private', 'client--m4');
ch('ra-old', 'public', 'old-dock', 1);
ch('ra-dm', 'dm', null);

const H = { 'Content-Type': 'application/json' };
const call = async (method, p, body, headers = H) => {
  const r = await fetch(`${URL}/api${p}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  let j = null; try { j = await r.json(); } catch { /* no body */ }
  return { status: r.status, body: j };
};
const login = async (id, name, pw) => {
  await call('POST', '/users/set-password', { user_id: id, password: pw, setup_code: `SC-${id}` });
  const r = await call('POST', '/users/login', { name, password: pw });
  return { headers: { ...H, Authorization: `Bearer ${r.body?.token}` }, token: r.body?.token, user: r.body?.user };
};
const A = await login('ra-a', 'Alert Admin', 'AlertAdmin2026!');
const S = await login('ra-s', 'Alert Supervisor', 'AlertSup20266!');
const m = await call('POST', '/api-tokens', { user_id: 'ra-bot', label: 'fixture procurement bot', scopes: ['read', 'write'] }, A.headers);
await call('POST', `/api-tokens/${m.body?.token?.id}/grants`, { grants: ['suppliers-edit'] }, A.headers);
const BOT = `Bearer ${m.body?.plaintext}`;
t('signed in (an admin, a supervisor) and a fixture suppliers-edit token', !!A.token && !!S.token && !!m.body?.plaintext);

const posts = () => db.prepare(`SELECT m.body, m.channel_id FROM chat_messages m JOIN users u ON u.id = m.user_id
  WHERE u.name = 'ReadyBot' AND m.channel_id = 'ra-rs' ORDER BY m.created_at, m.rowid`).all();
const upload = async (fields, names = ['COC for Caps on 0230148225.pdf']) => {
  const fd = new FormData();
  for (const n of names) fd.append('files', new Blob([Buffer.from('%PDF-1.4\n%%EOF\n')], { type: 'application/pdf' }), n);
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  const r = await fetch(`${URL}/api/suppliers/ra-berlin/files`, { method: 'POST', headers: { Authorization: BOT }, body: fd });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const COC = { kind: 'coc', po_number: 'PO00612', part_number: '3801C01BLK', lot_number: '62458740228', qty_note: '37,500' };

console.log('\n── no channel set ──');
let r = await upload(COC);
t('the COC is filed', r.status === 200 && r.body?.saved?.length === 1, JSON.stringify(r.body));
t('…nothing posted, and the response says why', r.body?.receiving_alert?.posted === false && r.body.receiving_alert.reason === 'no_channel_set' && posts().length === 0);

console.log('\n── who sets the channel ──');
r = await call('PUT', '/receiving/alert-channel', { channel_id: 'ra-rs' }, S.headers);
t('a supervisor cannot (403)', r.status === 403);
r = await call('PUT', '/receiving/alert-channel', { channel_id: 'ra-rs' }, { ...H, Authorization: BOT });
t('a token cannot (403)', r.status === 403, `${r.status}`);
for (const [id, what] of [['ra-dm', 'a DM'], ['ra-client', 'a client channel'], ['ra-old', 'an archived channel'], ['nope', 'a channel that does not exist']]) {
  r = await call('PUT', '/receiving/alert-channel', { channel_id: id }, A.headers);
  t(`${what} is refused (400)`, r.status === 400, `${r.status}`);
}
r = await call('GET', '/receiving/alert-channel', undefined, A.headers);
t('the admin is offered #receiving--shipping and not the DM, client or archived channel',
  r.body?.options?.some(c => c.id === 'ra-rs') && !r.body.options.some(c => ['ra-dm', 'ra-client', 'ra-old'].includes(c.id)));
r = await call('PUT', '/receiving/alert-channel', { channel_id: 'ra-rs' }, A.headers);
t('the admin sets #receiving--shipping', r.status === 200 && r.body?.channel_name === 'receiving--shipping', JSON.stringify(r.body));
t('…audited', !!db.prepare("SELECT 1 FROM audit_log WHERE entity_id = 'receiving_alert_channel_id'").get());

console.log('\n── the alert ──');
r = await upload(COC, ['COC for Caps on 0230148225.pdf', 'COC page 2.pdf']);
let p = posts();
t('two files in one upload → ONE ReadyBot message in the channel', r.body?.receiving_alert?.posted === true && p.length === 1, `${r.status} ${JSON.stringify(r.body?.receiving_alert)} posts=${p.length}`);
const body = p[0]?.body || '';
t('…naming the supplier, PO, part, lot and quantity, OK to receive',
  /📄 \*Berlin Packaging · PO00612 — Certificate of compliance on file, OK to receive\*/.test(body) && /Part: 3801C01BLK · Lot: 62458740228 · Qty: 37,500/.test(body), body);
t('…both file names and the Supplier Docs link', /COC page 2\.pdf/.test(body) && /\[Open in Supplier Docs\]\(.*\/\?tab=suppliers&supplier=ra-berlin\)/.test(body));
r = await upload({ ...COC, part_number: '3801C01BLK,38101C01ORG', qty_note: '57,500', mismatch_note: 'PO00612 lists 262,500 BLK only; COC is 57,500 across 4 colors' });
const mis = posts().at(-1)?.body || '';
t('a mismatch note → "CHECK MISMATCH" and says what', posts().length === 2 && /^⚠️ \*Berlin Packaging · PO00612 — Certificate of compliance on file \(CHECK MISMATCH\)\*/.test(mis) && /Mismatch: PO00612 lists 262,500/.test(mis), mis);
r = await upload({ kind: 'coa', po_number: 'PO00700', lot_number: 'L-9' }, ['COA lot L-9.pdf']);
t('a COA with a PO alerts too', r.body?.receiving_alert?.posted === true && /Certificate of analysis on file/.test(posts().at(-1)?.body || ''));

r = await upload(COC, ['COC.pdf']);
const again = await upload({ ...COC, po_number: 'PO00613' }, ['COC.pdf']);
t('the same file name filed twice (a new delivery) is two filings, not a 400', r.status === 200 && again.status === 200
  && db.prepare("SELECT COUNT(*) n FROM supplier_files WHERE supplier_id = 'ra-berlin' AND filename = 'COC.pdf'").get().n === 2, `${again.status} ${JSON.stringify(again.body)}`);

console.log('\n── what does not alert ──');
let n = posts().length;
r = await upload({ ...COC, notify_receiving: 'false' });
t('notify_receiving=false: filed, nothing posted', r.status === 200 && r.body?.receiving_alert?.posted === false && posts().length === n);
r = await upload({ kind: 'coc', lot_number: 'L-1' });
t('a COC with no PO: filed, nothing posted', r.status === 200 && posts().length === n && r.body?.receiving_alert?.reason === 'no_po');
r = await upload({ kind: 'specification', po_number: 'PO00612' }, ['Cap spec.pdf']);
t('a specification with a PO: filed, nothing posted', r.status === 200 && posts().length === n);
db.prepare("UPDATE chat_channels SET archived = 1 WHERE id = 'ra-rs'").run();
r = await upload(COC);
t('the channel archived later: the COC is still filed, nothing posted', r.status === 200 && r.body?.saved?.length === 1
  && r.body?.receiving_alert?.reason === 'channel_archived' && posts().length === n);
db.prepare("UPDATE chat_channels SET archived = 0 WHERE id = 'ra-rs'").run();
const { readFileSync } = await import('fs');
const sup = readFileSync(new globalThis.URL('../server/api/suppliers.js', import.meta.url), 'utf8');
const archiveRoute = sup.slice(sup.indexOf("router.post('/files/archive/commit'"), sup.indexOf("router.post('/:id/files'"));
t('the archive import does not call the alert', archiveRoute.length > 0 && !/notifyReceivingDocument/.test(archiveRoute));
t('no channel id is written in code', !/8bc3c713/.test(readFileSync(new globalThis.URL('../server/coc-receiving-alert.js', import.meta.url), 'utf8')));

console.log('\n── on the screens ──');
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on('pageerror', (e) => { console.log('  [pageerror]', e.message); fail++; });
  await page.goto(`${URL}/manifest.webmanifest`);
  await page.evaluate(([tk, u]) => { localStorage.setItem('auth_token', tk); localStorage.setItem('auth_user', JSON.stringify(u)); }, [A.token, A.user]);
  await page.goto(`${URL}/?tab=settings&section=readybot`);
  const sel = page.locator('[data-receiving-alert-select]');
  await sel.waitFor({ timeout: 20000 });
  t('Settings → ReadyBot messages shows the channel, set to #receiving--shipping', await sel.inputValue() === 'ra-rs');
  await page.goto(`${URL}/?tab=suppliers&supplier=ra-berlin`);
  await page.locator('[data-file-delivery]:visible').first().waitFor({ timeout: 20000 });
  t('the alert\'s link opens Berlin Packaging with its documents', await page.locator('[data-file-delivery]:visible').count() >= 1);
} catch (e) { t('the screens rendered', false, e.message); }
finally { await browser.close(); }

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
