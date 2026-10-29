// Executed, not asserted: proof of a Certificate of Compliance on a receipt
// (D-275). QA's list of part numbers, a receiving line for one of them making
// the CoC required, sign-off refused until it has proof, both kinds of proof
// (attached through the S3 stand-in, linked from Supplier Qualification), the
// expired-certificate refusal, removal with a reason, the signed-off lock, the
// bell line, and the screens in a real browser. Needs a built client.
import { chromium } from 'playwright-core';
const PORT = process.env.PORT || 5163;
const URL = `http://localhost:${PORT}`;
const B = `${URL}/api`;
const J = async (r) => { try { return await r.json(); } catch { return null; } };
let token = null;
const req = (p, o = {}) => fetch(B + p, { ...o, headers: {
  'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(o.headers || {}) } });
const up = (p, fd) => fetch(B + p, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: fd });

let pass = 0, fail = 0;
const t = (n, c, d = '') => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (d ? ' — ' + d : '')); } };

const { default: Database } = await import('better-sqlite3');
{
  const db = new Database(process.env.DBPATH);
  const mk = (id, name, role, dept, access) => db.prepare(`INSERT OR REPLACE INTO users
    (id,name,username,role,department,is_active,setup_code,setup_code_expires_at,module_access)
    VALUES (?,?,?,?,?,1,'SEED-CODE',datetime('now','+7 day'),?)`).run(id, name, name, role, dept, access);
  mk('coc-wh', 'Dock Receiver', 'operator', 'warehouse', '{"receiving-log":"edit"}');
  mk('coc-qa', 'Adam Coc', 'supervisor', 'qa', '{"receiving-log":"edit"}');
  // Two certificates on file in Supplier Qualification: one current, one lapsed.
  db.prepare(`INSERT OR IGNORE INTO suppliers (id, name) VALUES ('sup-film', 'Film Co')`).run();
  db.prepare(`INSERT OR IGNORE INTO supplier_files (id, supplier_id, kind, expires_on, filename) VALUES
    ('sf-current', 'sup-film', 'certificate', '2099-12-31', 'Film Co CoC 2026.pdf'),
    ('sf-expired', 'sup-film', 'certificate', '2020-01-31', 'Film Co CoC 2019.pdf')`).run();
  db.close();
}
const login = async (id, name, password) => {
  await req('/users/set-password', { method: 'POST', body: JSON.stringify({ user_id: id, password, setup_code: 'SEED-CODE' }) });
  return (await J(await req('/users/login', { method: 'POST', body: JSON.stringify({ name, password }) })))?.token;
};
const qaTok = await login('coc-qa', 'Adam Coc', 'AdamSecret2026');
const whTok = await login('coc-wh', 'Dock Receiver', 'DockSecret2026');
t('QA and the receiver signed in', !!qaTok && !!whTok);

console.log('\n── QA keeps the list ──');
token = whTok;
const deniedAdd = await req('/receiving/coc-items', { method: 'POST', body: JSON.stringify({ part_number: 'PK-POUCH-LG', category: 'packaging' }) });
t('the warehouse cannot add to the list', deniedAdd.status === 403, `${deniedAdd.status}`);
const readList = await J(await req('/receiving/coc-items'));
t('…but can read it, and is told it cannot edit', Array.isArray(readList?.items) && readList.can_edit === false);
token = qaTok;
const badCat = await req('/receiving/coc-items', { method: 'POST', body: JSON.stringify({ part_number: 'X-1', category: 'films' }) });
t('an unknown category is refused', badCat.status === 400);
const pouch = await J(await req('/receiving/coc-items', { method: 'POST', body: JSON.stringify({ part_number: 'PK-POUCH-LG', part_description: 'Large pouch', category: 'packaging' }) }));
const gloves = await J(await req('/receiving/coc-items', { method: 'POST', body: JSON.stringify({ part_number: 'GLV-NITRILE-M', category: 'gloves' }) }));
t('QA lists a pouch and a glove', pouch?.part_number === 'PK-POUCH-LG' && gloves?.category === 'gloves');
await req(`/receiving/coc-items/${gloves.id}`, { method: 'DELETE' });
const afterRetire = await J(await req('/receiving/coc-items'));
const gRow = afterRetire.items.find(i => i.part_number === 'GLV-NITRILE-M');
t('removing retires the row, never deletes it', gRow && gRow.is_active === false);
const revived = await J(await req('/receiving/coc-items', { method: 'POST', body: JSON.stringify({ part_number: ' glv-nitrile-m ', category: 'gloves' }) }));
t('adding it back revives the same row (case and spaces ignored)', revived?.id === gloves.id && revived.is_active === true);

console.log('\n── a receipt with a listed part ──');
token = whTok;
const form = await J(await req('/receiving/checklist/form'));
const cl = await J(await req('/receiving/checklist', { method: 'POST', body: JSON.stringify({ inspection_date: new Date().toISOString().slice(0, 10), vendor: 'Film Co' }) }));
const NO = cl.inspection_no;
t('an inspection is started', /^A-100-\d{4}$/.test(NO || ''), NO);
let state = await J(await req(`/receiving/checklist/${NO}`));
t('with no lines, nothing is owed', state.coc.required.length === 0 && state.coc.missing === 0);
const line = (part, extra = {}) => req('/receiving', { method: 'POST', body: JSON.stringify({
  inspection_no: NO, part_number: part, part_description: 'thing', quantity_received: 10, uom: 'EA',
  date_received: new Date().toISOString().slice(0, 10), ...extra }) });
const l1 = await line('pk-pouch-lg', { vendor_lot: 'L-77' });
const l2 = await line('RM-WHEY');
const l3 = await line('');
t('three lines filed (one listed, one not, one with no part #)', [l1, l2, l3].every(r => r.status === 201), [l1.status, l2.status, l3.status].join(','));
state = await J(await req(`/receiving/checklist/${NO}`));
const reqPouch = state.coc.required.find(r => r.part_number === 'PK-POUCH-LG');
t('the listed part is required and missing', state.coc.required.length === 1 && reqPouch?.status === 'missing' && state.coc.missing === 1);
t('the line with no part # is named as unchecked', state.coc.unchecked_lines === 1);
const list1 = await J(await req('/receiving/checklists'));
t('the Inspections list carries the gap', list1.find(r => r.inspection_no === NO)?.coc_missing === 1);

// Answer everything the way that sends no escalation.
const items = form.sections.flatMap(s => s.items);
const answers = Object.fromEntries(items.map(i => [i.key, i.notify ? (i.notify.answer === 'yes' ? 'no' : 'yes') : 'yes']));
await req('/receiving/checklist', { method: 'POST', body: JSON.stringify({ inspection_no: NO, answers }) });
const r1 = await req(`/receiving/checklist/${NO}/review`, { method: 'POST', body: '{}' });
const r1b = await J(r1);
t('sign-off is refused while the CoC is missing', r1.status === 400 && r1b?.code === 'COC_REQUIRED', `${r1.status} ${JSON.stringify(r1b).slice(0, 160)}`);
t('…and the refusal names the part', /PK-POUCH-LG/.test(r1b?.error || ''));

console.log('\n── QA\'s bell ──');
token = qaTok;
const bell = await J(await req('/compliance/notifications'));
t('QA is shown the receipt waiting on a CoC', (bell?.items || []).some(i => i.id === 'coc-missing' && i.count >= 1), JSON.stringify((bell?.items || []).map(i => i.id)));
token = whTok;

console.log('\n── proof on file ──');
const onFile = await J(await req(`/receiving/checklist/${NO}/coc/on-file?q=Film`));
t('on-file certificates are offered, the lapsed one marked', onFile?.length === 2 && onFile.find(f => f.id === 'sf-expired')?.current === false && onFile.find(f => f.id === 'sf-current')?.current === true);
const exp = await req(`/receiving/checklist/${NO}/coc/on-file`, { method: 'POST', body: JSON.stringify({ part_number: 'PK-POUCH-LG', supplier_file_id: 'sf-expired' }) });
t('an expired certificate is refused', exp.status === 400 && /expired/.test((await J(exp))?.error || ''));
const unlisted = await req(`/receiving/checklist/${NO}/coc/on-file`, { method: 'POST', body: JSON.stringify({ part_number: 'RM-WHEY', supplier_file_id: 'sf-current' }) });
t('a part not on QA\'s list is refused', unlisted.status === 400);
const linked = await J(await req(`/receiving/checklist/${NO}/coc/on-file`, { method: 'POST', body: JSON.stringify({ part_number: 'PK-POUCH-LG', supplier_file_id: 'sf-current' }) }));
t('the current certificate proves it', linked?.missing === 0 && linked.required[0].status === 'proved' && linked.required[0].proofs[0].source === 'on_file');

console.log('\n── removal ──');
const proofId = linked.required[0].proofs[0].id;
const noReason = await req(`/receiving/coc-proofs/${proofId}`, { method: 'DELETE', body: JSON.stringify({ reason: '' }) });
t('removing needs a reason', noReason.status === 400);
const removed = await J(await req(`/receiving/coc-proofs/${proofId}`, { method: 'DELETE', body: JSON.stringify({ reason: 'wrong supplier' }) }));
t('removed with a reason, the part is missing again', removed?.missing === 1);
{
  const db = new Database(process.env.DBPATH, { readonly: true });
  const row = db.prepare('SELECT removed_at, removed_reason, removed_by FROM receiving_coc_proofs WHERE id = ?').get(proofId);
  t('the removed certificate stays on the record with who and why', !!row?.removed_at && row.removed_reason === 'wrong supplier' && row.removed_by === 'Dock Receiver');
  db.close();
}

console.log('\n── proof with the delivery ──');
const fd = new FormData();
fd.append('part_number', 'PK-POUCH-LG');
fd.append('files', new Blob(['%PDF-1.4 coc'], { type: 'application/pdf' }), 'coc-pouch.pdf');
const attached = await J(await up(`/receiving/checklist/${NO}/coc`, fd));
t('the certificate that came with the truck is attached', attached?.missing === 0 && attached.required[0].proofs.some(p => p.source === 'attached' && p.filename === 'coc-pouch.pdf'), JSON.stringify(attached).slice(0, 200));
const att = attached.required[0].proofs.find(p => p.source === 'attached');
{
  const db = new Database(process.env.DBPATH, { readonly: true });
  const row = db.prepare('SELECT sha256, recorded_by FROM receiving_coc_proofs WHERE id = ?').get(att.id);
  t('it is hashed and names who attached it', /^[0-9a-f]{64}$/.test(row?.sha256 || '') && row.recorded_by === 'Dock Receiver');
  db.close();
}
const u = await J(await req(`/receiving/coc-proofs/${att.id}/url`));
t('it opens, and the bytes are the file', typeof u?.url === 'string' && (await (await fetch(u.url)).text()) === '%PDF-1.4 coc');

console.log('\n── the form\'s own CoC line must agree ──');
await req('/receiving/checklist', { method: 'POST', body: JSON.stringify({ inspection_no: NO, answers: { coc_present: 'na' } }) });
const r2 = await req(`/receiving/checklist/${NO}/review`, { method: 'POST', body: '{}' });
t('"Certificate of Conformance" answered N/A is refused when a CoC is on record', r2.status === 400 && (await J(r2))?.code === 'COC_REQUIRED');
await req('/receiving/checklist', { method: 'POST', body: JSON.stringify({ inspection_no: NO, answers: { coc_present: 'yes' } }) });

// The browser checks run before sign-off so the screen still offers the controls.
console.log('\n── the screens ──');
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
page.on('pageerror', e => { console.log('  [pageerror]', e.message); fail++; });
const me = await J(await req('/users/me'));
await page.goto(`${URL}/manifest.webmanifest`);
await page.evaluate(([tok, usr]) => { localStorage.setItem('auth_token', tok); localStorage.setItem('auth_user', JSON.stringify(usr)); }, [whTok, me]);
await page.goto(`${URL}/?tab=receiving-log&view=inspections&checklist=${NO}`);
await page.waitForTimeout(3000);
t('the checklist shows a Certificates of Compliance section', await page.locator('[data-coc-section]').count() === 1);
t('the pouch reads "CoC on record" with its certificate', await page.locator('[data-coc-part="PK-POUCH-LG"][data-coc-status="proved"]').count() === 1
  && await page.locator('[data-coc-proof="attached"]').count() === 1);
t('the line with no part # is named', await page.locator('[data-coc-unchecked]').count() === 1);
await page.locator('[data-coc-link-open]').click();
await page.waitForTimeout(800);
t('"Link the one on file" lists the certificates, the lapsed one disabled',
  await page.locator('[data-coc-onfile-link="sf-current"]').isEnabled() && !(await page.locator('[data-coc-onfile-link="sf-expired"]').isEnabled()));
await page.goto(`${URL}/?tab=receiving-log&view=coc-items`);
await page.waitForTimeout(2500);
t('the CoC Items tab lists QA\'s parts, read-only for the warehouse', await page.locator('[data-coc-item]').count() === 2
  && await page.locator('[data-coc-item-part]').count() === 0);
const phone = await browser.newPage({ viewport: { width: 360, height: 780 } });
await phone.goto(`${URL}/manifest.webmanifest`);
await phone.evaluate(([tok, usr]) => { localStorage.setItem('auth_token', tok); localStorage.setItem('auth_user', JSON.stringify(usr)); }, [whTok, me]);
await phone.goto(`${URL}/?tab=receiving-log&view=inspections&checklist=${NO}`);
await phone.waitForTimeout(3000);
t('on a phone the section renders and nothing sticks out sideways', await phone.locator('[data-coc-section]').count() === 1
  && await phone.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
await browser.close();

console.log('\n── sign-off and the lock ──');
const r3 = await J(await req(`/receiving/checklist/${NO}/review`, { method: 'POST', body: '{}' }));
t('signed off once every listed part has its CoC', !!r3?.reviewed_at, JSON.stringify(r3).slice(0, 200));
const late = await req(`/receiving/checklist/${NO}/coc/on-file`, { method: 'POST', body: JSON.stringify({ part_number: 'PK-POUCH-LG', supplier_file_id: 'sf-current' }) });
t('no certificate can be added to a signed-off inspection', late.status === 409);
const lateDel = await req(`/receiving/coc-proofs/${att.id}`, { method: 'DELETE', body: JSON.stringify({ reason: 'nope nope' }) });
t('nor removed from one', lateDel.status === 409);
{
  const db = new Database(process.env.DBPATH, { readonly: true });
  const a = db.prepare(`SELECT details FROM audit_log WHERE entity_type = 'receiving_checklist' AND details LIKE '%PK-POUCH-LG%' ORDER BY rowid DESC LIMIT 1`).get();
  t('the sign-off audit names the certificate it relied on', !!a && a.details.includes(att.id), a?.details?.slice(0, 160));
  db.close();
}
token = qaTok;
const bell2 = await J(await req('/compliance/notifications'));
t('the bell line clears once signed', !(bell2?.items || []).some(i => i.id === 'coc-missing'));

console.log(`\n${pass}/${pass + fail} assertions passed`);
process.exit(fail ? 1 : 0);
