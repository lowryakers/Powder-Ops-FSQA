// Executed, not asserted: the supplier Edit details box and contacts (D-295).
// Purchasing corrects In use / Type / website / address / notes; Type is a
// closed list (it decides who owes a letter of guarantee) and an imported value
// outside it survives an unrelated edit; turning In use off needs a reason, is
// audited with it, and takes the supplier off the letter-of-guarantee list;
// status cannot be set here; contacts are added, corrected (one main) and
// removed, audited; a viewer is refused every write; the admin's "Remove —
// filed by mistake" now carries its reason (apiDelete used to drop the body);
// and the screen in a real browser at 1280 and 390. Needs a built client.
import { chromium } from 'playwright-core';
const PORT = process.env.PORT || 5173;
const URL = `http://localhost:${PORT}`;
const B = `${URL}/api`;
const J = async (r) => { try { return await r.json(); } catch { return null; } };
let token = null;
const req = (p, o = {}) => fetch(B + p, { ...o, headers: {
  'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(o.headers || {}) } });
let pass = 0, fail = 0;
const t = (n, c, d = '') => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (d ? ' — ' + d : '')); } };

const { default: Database } = await import('better-sqlite3');
{
  const db = new Database(process.env.DBPATH);
  const mk = (id, name, role, dept, access) => db.prepare(`INSERT OR REPLACE INTO users
    (id,name,username,role,department,is_active,setup_code,setup_code_expires_at,module_access)
    VALUES (?,?,?,?,?,1,'SEED-CODE',datetime('now','+7 day'),?)`).run(id, name, name, role, dept, access);
  mk('se-pur', 'Pia Purchasing', 'operator', 'purchasing', '{"suppliers":"edit"}');
  mk('se-op', 'Vic Viewer', 'operator', 'warehouse', '{"suppliers":"view"}');
  mk('se-adm', 'Ada Admin', 'admin', 'admin', null);
  const s = db.prepare('INSERT OR REPLACE INTO suppliers (id, name, vendor_type, actively_using) VALUES (?,?,?,?)');
  s.run('se-film', 'Edit Film Co', 'packaging', 1);
  s.run('se-odd', 'Odd Type Co', 'Raw Materials', 1);     // imported value outside the list
  s.run('se-dupe', 'Edit Film Company', null, 0);          // the duplicate an admin removes
  db.close();
}
const login = async (id, name, password) => {
  await req('/users/set-password', { method: 'POST', body: JSON.stringify({ user_id: id, password, setup_code: 'SEED-CODE' }) });
  return (await J(await req('/users/login', { method: 'POST', body: JSON.stringify({ name, password }) })))?.token;
};
const purTok = await login('se-pur', 'Pia Purchasing', 'PiaSecret2026');
const opTok = await login('se-op', 'Vic Viewer', 'VicSecret2026');
const admTok = await login('se-adm', 'Ada Admin', 'AdaSecret2026');
t('Purchasing, a viewer and an admin signed in', !!purTok && !!opTok && !!admTok);
const put = (p, b) => req(p, { method: 'PUT', body: JSON.stringify(b) });
const get = async (id) => { token = purTok; return J(await req(`/suppliers/${id}`)); };

console.log('\n── details ──');
token = opTok;
t('a viewer cannot edit', (await put('/suppliers/se-film', { website: 'x' })).status === 403);
token = purTok;
let r = await put('/suppliers/se-film', { website: 'https://film.example', address: '1 Main St, Ogden UT', notes: 'Quotes via Mike.' });
let d = await get('se-film');
t('Purchasing saves website, address and notes', r.status === 200 && d.supplier.website === 'https://film.example'
  && d.supplier.address === '1 Main St, Ogden UT' && d.supplier.notes === 'Quotes via Mike.');
token = purTok;
r = await put('/suppliers/se-film', { vendor_type: 'pkg' });
t('a type outside the list is refused by name', r.status === 400 && /Unknown type/.test((await J(r))?.error || ''));
r = await put('/suppliers/se-odd', { vendor_type: 'Raw Materials', notes: 'checked' });
t('an imported type outside the list survives an unrelated edit', r.status === 200 && (await get('se-odd')).supplier.vendor_type === 'Raw Materials');
token = purTok;
r = await put('/suppliers/se-odd', { vendor_type: 'ingredient' });
t('…and can be moved onto the list', r.status === 200 && (await get('se-odd')).supplier.vendor_type === 'ingredient');
token = purTok;
t('status cannot be set here', (await put('/suppliers/se-film', { status: 'approved' })).status === 400);

console.log('\n── no longer used ──');
d = await get('se-film');
t('before: a packaging supplier in use owes a letter', d.guarantee?.required === true);
token = purTok;
r = await put('/suppliers/se-film', { actively_using: false });
t('turning In use off without a reason is refused', r.status === 400 && /REASON_REQUIRED/.test((await J(r))?.error || ''));
r = await put('/suppliers/se-film', { actively_using: false, reason: 'Switched to Pouch Co in March 2026' });
d = await get('se-film');
t('with a reason it saves, and the letter is no longer owed', r.status === 200 && !d.supplier.actively_using && d.guarantee?.required === false);
{
  const db = new Database(process.env.DBPATH, { readonly: true });
  const a = db.prepare(`SELECT details FROM audit_log WHERE entity_type = 'supplier' AND entity_id = 'se-film'
    ORDER BY rowid DESC LIMIT 1`).get();
  db.close();
  t('the audit entry carries the reason', /Switched to Pouch Co/.test(a?.details || ''), a?.details);
}
token = purTok;
t('turning it back on needs no reason', (await put('/suppliers/se-film', { actively_using: true })).status === 200);

console.log('\n── contacts ──');
token = opTok;
t('a viewer cannot add a contact', (await req('/suppliers/se-film/contacts', { method: 'POST', body: JSON.stringify({ email: 'q@film.example' }) })).status === 403);
token = purTok;
r = await req('/suppliers/se-film/contacts', { method: 'POST', body: JSON.stringify({}) });
t('an empty contact is refused', r.status === 400);
r = await req('/suppliers/se-film/contacts', { method: 'POST', body: JSON.stringify({ email: 'not-an-email' }) });
t('a bad email is refused by name', r.status === 400 && /not an email/.test((await J(r))?.error || ''));
r = await req('/suppliers/se-film/contacts', { method: 'POST', body: JSON.stringify({ name: 'Rae Quality', email: 'rae@film.example', role: 'quality', is_primary: true }) });
const c1 = (await J(r))?.id;
r = await req('/suppliers/se-film/contacts', { method: 'POST', body: JSON.stringify({ name: 'Sam Orders', email: 'sam@film.example', role: 'orders' }) });
const c2 = (await J(r))?.id;
d = await get('se-film');
t('two contacts added, quality one is main', !!c1 && !!c2 && d.contacts.length === 2 && d.contacts.find(c => c.id === c1)?.is_primary === 1);
token = purTok;
r = await put(`/suppliers/contacts/${c2}`, { is_primary: true, phone: '801-555-0100' });
d = await get('se-film');
t('marking another as main moves it, and the correction keeps the other fields', r.status === 200
  && d.contacts.find(c => c.id === c2)?.is_primary === 1 && d.contacts.find(c => c.id === c1)?.is_primary === 0
  && d.contacts.find(c => c.id === c2)?.email === 'sam@film.example' && d.contacts.find(c => c.id === c2)?.phone === '801-555-0100');
token = purTok;
t('an unknown role is refused', (await put(`/suppliers/contacts/${c2}`, { role: 'boss' })).status === 400);
token = opTok;
t('a viewer cannot remove a contact', (await req(`/suppliers/contacts/${c2}`, { method: 'DELETE' })).status === 403);
token = purTok;
r = await req(`/suppliers/contacts/${c2}`, { method: 'DELETE' });
d = await get('se-film');
t('Purchasing removes a contact', r.status === 200 && d.contacts.length === 1);

console.log('\n── the browser ──');
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
for (const width of [1280, 390]) {
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  page.on('pageerror', e => { console.log('  [pageerror]', e.message); fail++; });
  token = purTok;
  const me = await J(await req('/users/me'));
  await page.goto(`${URL}/manifest.webmanifest`);
  await page.evaluate(([tok, usr]) => { localStorage.setItem('auth_token', tok); localStorage.setItem('auth_user', JSON.stringify(usr)); }, [purTok, me]);
  await page.goto(`${URL}/?tab=suppliers`);
  await page.waitForTimeout(3000);
  await page.getByPlaceholder('Search suppliers, including former names…').fill('Edit Film Co');
  await page.waitForTimeout(800);
  await page.getByText('Edit Film Co', { exact: true }).locator('visible=true').first().click();
  await page.waitForTimeout(1500);
  if (width === 1280) {
    t('the supplier offers Edit details and Add contact', await page.locator('[data-supplier-edit]:visible').count() === 1
      && await page.locator('[data-contact-add]:visible').count() === 1);
    await page.locator('[data-supplier-edit]:visible').click();
    await page.locator('[data-supplier-inuse]:visible').uncheck();
    t('unticking In use asks why, and Save waits for it', await page.locator('[data-supplier-reason]:visible').count() === 1
      && await page.locator('[data-supplier-save]:visible').isDisabled());
    await page.locator('[data-supplier-reason]:visible').fill('Testing the box');
    await page.locator('[data-supplier-type]:visible').selectOption('supplies');
    await page.locator('[data-supplier-save]:visible').click();
    await page.waitForTimeout(1200);
    const after = await get('se-film');
    t('Save writes the type and In use', after.supplier.vendor_type === 'supplies' && !after.supplier.actively_using);
    await page.locator('[data-contact-add]:visible').click();
    await page.locator('[data-contact-email]:visible').fill('new@film.example');
    await page.locator('[data-contact-role]:visible').selectOption('quality');
    await page.locator('[data-contact-save]:visible').click();
    await page.waitForTimeout(1200);
    t('a contact added on screen appears with its role', await page.locator('[data-contact-row]:visible', { hasText: 'new@film.example' }).count() === 1
      && await page.locator('[data-contact-row]:visible', { hasText: 'Quality / food safety' }).count() >= 1);
  } else {
    await page.locator('[data-supplier-edit]:visible').first().click();
    await page.waitForTimeout(300);
    t('on a phone the edit form fits with nothing sideways', await page.locator('[data-supplier-edit-form]:visible').count() === 1
      && await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  }
  await page.close();
}
await browser.close();

console.log('\n── an admin removes a duplicate (the reason now arrives) ──');
const browser2 = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
{
  const page = await browser2.newPage({ viewport: { width: 1280, height: 900 } });
  token = admTok;
  const me = await J(await req('/users/me'));
  await page.goto(`${URL}/manifest.webmanifest`);
  await page.evaluate(([tok, usr]) => { localStorage.setItem('auth_token', tok); localStorage.setItem('auth_user', JSON.stringify(usr)); }, [admTok, me]);
  await page.goto(`${URL}/?tab=suppliers`);
  await page.waitForTimeout(3000);
  await page.getByPlaceholder('Search suppliers, including former names…').fill('Edit Film Company');
  await page.waitForTimeout(800);
  await page.getByText('Edit Film Company', { exact: true }).locator('visible=true').first().click();
  await page.waitForTimeout(1500);
  page.on('dialog', d => d.type() === 'prompt' ? d.accept('Duplicate of Edit Film Co') : d.accept());
  await page.getByText('Remove — filed by mistake').locator('visible=true').first().click();
  await page.waitForTimeout(1500);
  token = admTok;
  t('the duplicate is gone (the reason reached the server)', (await req('/suppliers/se-dupe')).status === 404);
  await page.close();
}
await browser2.close();

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
