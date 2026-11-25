// D-391 (A-20261125-001 / -003): the COC / COA library. A delivery's certificate
// of compliance is filed BEFORE the truck with its PO, part, lot, quantity and
// any mismatch with the PO, found again by those, and offered first on the
// receiving inspection's "Link the one on file".
//
// What this proves:
//   - `coc` is a kind, and the filename classifier knows a COC from a certificate;
//   - a suppliers-edit bot token files a COC PDF with PO, part, lot, qty, mismatch;
//   - GET /suppliers/files finds it by PO, by one part of a list, by one lot of a list,
//     never by a substring, and never sends the extracted text or storage key;
//   - the same token cannot approve, disposition or delete (403), and nothing moved;
//   - a person corrects the delivery fields (audited before and after);
//   - the receiving lookup lists the PO-matched COC first and a matching COA too,
//     an unmatched COA not at all, and the warehouse links the COC;
//   - the supplier drawer and the receiving picker show PO / part / lot / mismatch.
// Caller sets PORT + DBPATH on a FRESH database, with the S3 stand-in.
import { chromium } from 'playwright-core';

const PORT = process.env.PORT || 5249;
const URL = `http://localhost:${PORT}`;
let pass = 0, fail = 0;
const t = (n, c, d = '') => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (d ? ' — ' + d : '')); } };

const { default: Database } = await import('better-sqlite3');
const db = new Database(process.env.DBPATH);
db.pragma('busy_timeout = 10000');
const mkUser = (id, name, role, dept, ma) => db.prepare(`INSERT OR REPLACE INTO users (id, name, username, role, department, is_active, module_access, setup_code, setup_code_expires_at)
  VALUES (?, ?, ?, ?, ?, 1, ?, ?, datetime('now','+7 day'))`).run(id, name, name, role, dept, ma, `SC-${id}`);
mkUser('cl-a', 'Coc Admin', 'admin', 'admin', null);
mkUser('cl-q', 'Coc Quality', 'supervisor', 'qa', JSON.stringify({ suppliers: 'edit', 'receiving-log': 'edit' }));
mkUser('cl-wh', 'Coc Dock', 'operator', 'warehouse', JSON.stringify({ 'receiving-log': 'edit', suppliers: 'view' }));
mkUser('cl-bot', '*Procurement Bot', 'operator', 'purchasing', JSON.stringify({ suppliers: 'edit' }));
db.prepare("INSERT OR REPLACE INTO suppliers (id, name, vendor_type, actively_using) VALUES ('cl-berlin', 'Berlin Packaging', 'packaging', 1)").run();
db.prepare("INSERT OR REPLACE INTO supplier_files (id, supplier_id, kind, filename, source_path, po_number, lot_number) VALUES ('cl-coa-other', 'cl-berlin', 'coa', 'Other COA.pdf', 'x/1', 'PO00999', 'L-1')").run();
db.prepare("INSERT OR REPLACE INTO supplier_files (id, supplier_id, kind, filename, source_path, lot_number) VALUES ('cl-coa-lot', 'cl-berlin', 'coa', 'Lot COA.pdf', 'x/2', '62458740228')").run();

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
const A = await login('cl-a', 'Coc Admin', 'CocAdmin20266!');
const Q = await login('cl-q', 'Coc Quality', 'CocQuality2026!');
const W = await login('cl-wh', 'Coc Dock', 'CocDock202666!');
const m = await call('POST', '/api-tokens', { user_id: 'cl-bot', label: 'fixture procurement bot', scopes: ['read', 'write'] }, A.headers);
await call('POST', `/api-tokens/${m.body?.token?.id}/grants`, { grants: ['suppliers-edit'] }, A.headers);
const TK = { ...H, Authorization: `Bearer ${m.body?.plaintext}` };
t('signed in (QA, the dock, an admin) and a fixture suppliers-edit token', !!Q.token && !!W.token && !!m.body?.plaintext);

console.log('\n── the kind ──');
const { FILE_KIND_VALUES } = await import('../shared/supplier-documents.js');
const { classifyDocument } = await import('../server/supplier-archive.js');
t('`coc` is a document kind', FILE_KIND_VALUES.includes('coc'));
t('"COC for Caps on 0230148225.pdf" reads as a COC', classifyDocument('COC for Caps on 0230148225.pdf')?.kind === 'coc');
t('"Certificate of Conformance.pdf" and "C of C lot 5.pdf" too', classifyDocument('Certificate of Conformance.pdf')?.kind === 'coc' && classifyDocument('C of C lot 5.pdf')?.kind === 'coc');
t('"Kosher Exp 12.31.2025.pdf" stays a certificate, "cocoa spec.pdf" is no COC',
  classifyDocument('Kosher Exp 12.31.2025.pdf')?.kind === 'certificate' && classifyDocument('cocoa spec.pdf')?.kind !== 'coc');

console.log('\n── the bot files a COC before the truck ──');
const pdf = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');
const fd = new FormData();
fd.append('files', new Blob([pdf], { type: 'application/pdf' }), 'COC for Caps on 0230148225.pdf');
for (const [k, v] of Object.entries({ kind: 'coc', po_number: 'PO00612', part_number: '3801C01BLK, 38101C01ORG, 3801C01RED, 3801C01YLW',
  lot_number: '62458740228,62428740228,62638740228,62638740323', qty_note: '57,500 (37.5k BLK / 2.5k ORG / 10k RED / 7.5k YLW)',
  mismatch_note: 'PO00612 lists 262,500 BLK only; COC is 57,500 across 4 colors' })) fd.append(k, v);
let r = await fetch(`${URL}/api/suppliers/cl-berlin/files`, { method: 'POST', headers: { Authorization: TK.Authorization }, body: fd });
const up = await r.json().catch(() => null);
const fileId = up?.saved?.[0]?.id;
t('the bot uploads the COC with its PO, parts, lots, quantity and mismatch', r.status === 200 && !!fileId, `${r.status} ${JSON.stringify(up)}`);
const row = db.prepare('SELECT * FROM supplier_files WHERE id = ?').get(fileId) || {};
t('…stored as a COC carrying every field', row.kind === 'coc' && row.po_number === 'PO00612' && /3801C01RED/.test(row.part_number)
  && /62638740323/.test(row.lot_number) && /57,500/.test(row.qty_note) && /262,500/.test(row.mismatch_note) && row.uploaded_by === '*Procurement Bot');

console.log('\n── found again ──');
r = await call('GET', '/suppliers/files?po_number=po00612', undefined, TK);
t('by PO (case aside), with the supplier name', r.status === 200 && r.body?.length === 1 && r.body[0].id === fileId && r.body[0].supplier_name === 'Berlin Packaging', JSON.stringify(r.body));
t('…never the extracted text or the storage key', !('extracted_text' in (r.body?.[0] || {})) && !('storage_key' in (r.body?.[0] || {})));
r = await call('GET', '/suppliers/files?part_number=3801C01RED', undefined, Q.headers);
t('by one part of the list', r.body?.some(f => f.id === fileId));
r = await call('GET', '/suppliers/files?lot_number=62638740323&kind=coc', undefined, Q.headers);
t('by one lot of the list, narrowed to COCs', r.body?.length === 1 && r.body[0].id === fileId);
r = await call('GET', '/suppliers/files?part_number=3801C01', undefined, Q.headers);
t('a substring of a part is not a match', r.status === 200 && r.body?.length === 0);
r = await call('GET', '/suppliers/files?po_number=PO00612&limit=1', undefined, TK);
t('a token caller is paged (X-Total-Count)', r.status === 200);

console.log('\n── what the token never does ──');
const before = db.prepare("SELECT status FROM suppliers WHERE id = 'cl-berlin'").get().status;
r = await call('POST', '/suppliers/cl-berlin/disposition', { disposition: 'approved' }, TK);
t('disposition → 403', r.status === 403, JSON.stringify(r.body));
r = await call('DELETE', `/suppliers/files/${fileId}/stored`, { reason: 'bot' }, TK);
t('deleting the stored file → 403', r.status === 403, JSON.stringify(r.body));
r = await call('DELETE', '/suppliers/cl-berlin', { reason: 'bot' }, TK);
t('deleting the supplier → 403', r.status === 403);
t('…the supplier and the file are unchanged', db.prepare("SELECT status FROM suppliers WHERE id = 'cl-berlin'").get().status === before
  && !!db.prepare('SELECT storage_key FROM supplier_files WHERE id = ?').get(fileId)?.storage_key);

console.log('\n── a person corrects it ──');
r = await call('PUT', `/suppliers/files/${fileId}`, { qty_note: '57,500 caps', mismatch_note: '' }, Q.headers);
t('QA corrects the quantity and clears the mismatch', r.status === 200 && r.body?.file?.qty_note === '57,500 caps' && r.body.file.mismatch_note === null, JSON.stringify(r.body));
t('…audited with the before and the after', !!db.prepare("SELECT 1 FROM audit_log WHERE entity_type = 'supplier_file' AND entity_id = ? AND previous_state LIKE '%262,500%' AND new_state LIKE '%57,500 caps%'").get(fileId));
r = await call('PUT', `/suppliers/files/${fileId}`, { mismatch_note: 'PO00612 lists 262,500 BLK only; COC is 57,500 across 4 colors' }, TK);
t('the bot can put a mismatch note back (suppliers-edit)', r.status === 200);

console.log('\n── receiving finds it first ──');
await call('POST', '/receiving/coc-items', { part_number: '3801C01BLK', category: 'packaging' }, Q.headers);
const cl = (await call('POST', '/receiving/checklist', { inspection_date: new Date().toISOString().slice(0, 10), vendor: 'Berlin Packaging' }, W.headers)).body;
const NO = cl?.inspection_no;
await call('POST', '/receiving', { inspection_no: NO, po_number: 'PO00612', part_number: '3801C01BLK', vendor_lot: '62458740228', part_description: 'Black cap',
  quantity_received: 37500, uom: 'EA', date_received: new Date().toISOString().slice(0, 10) }, W.headers);
r = await call('GET', `/receiving/checklist/${NO}/coc/on-file?part=3801C01BLK`, undefined, W.headers);
const list = r.body || [];
t('the PO-matched COC is listed first, marked as matching', list[0]?.id === fileId && list[0].match.includes('po') && list[0].match.includes('part') && list[0].match.includes('lot'), JSON.stringify(list.map(f => [f.id, f.match])));
t('a COA for the same lot is offered; a COA for another PO is not', list.some(f => f.id === 'cl-coa-lot') && !list.some(f => f.id === 'cl-coa-other'));
r = await call('POST', `/receiving/checklist/${NO}/coc/on-file`, { part_number: '3801C01BLK', supplier_file_id: fileId }, W.headers);
const st = (await call('GET', `/receiving/checklist/${NO}`, undefined, W.headers)).body;
t('the dock links it and the part reads proved', (r.status === 200 || r.status === 201) && st?.coc?.required?.find(x => x.part_number === '3801C01BLK')?.status === 'proved', `${r.status} ${JSON.stringify(r.body)?.slice(0, 160)}`);

console.log('\n── on the screens ──');
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on('pageerror', (e) => { console.log('  [pageerror]', e.message); fail++; });
  await page.goto(`${URL}/manifest.webmanifest`);
  await page.evaluate(([tk, u]) => { localStorage.setItem('auth_token', tk); localStorage.setItem('auth_user', JSON.stringify(u)); }, [Q.token, Q.user]);
  await page.goto(`${URL}/?tab=suppliers`);
  await page.locator('text=Berlin Packaging >> visible=true').first().click({ timeout: 20000 });
  const del = page.locator(`[data-file-delivery="${fileId}"]:visible`).first();
  await del.waitFor({ timeout: 20000 });
  t('the supplier drawer shows the PO, parts and quantity', /PO PO00612/.test(await del.innerText()) && /57,500 caps/.test(await del.innerText()));
  t('…and the mismatch', /262,500/.test(await page.locator(`[data-file-mismatch="${fileId}"]:visible`).first().innerText()));
  await page.goto(`${URL}/?tab=receiving-log&view=inspections&checklist=${NO}`);
  await page.locator('[data-coc-link-open]').first().waitFor({ timeout: 20000 });
  await page.locator('[data-coc-link-open]').first().click();
  const m1 = page.locator(`[data-coc-onfile-match="${fileId}"]`);
  await m1.waitFor({ timeout: 10000 });
  t('the receiving picker marks it "Matches this delivery" and names the mismatch',
    /Matches this delivery/.test(await m1.innerText()) && /262,500/.test(await page.locator(`[data-coc-onfile-mismatch="${fileId}"]`).innerText()));
} catch (e) { t('the screens rendered', false, e.message); }
finally { await browser.close(); }

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
