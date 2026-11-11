// Executed, not asserted: ingredients, part numbers, document links and the
// audited kind/expiry/lot edit (A-20261111-004 PR A, D-338). Run through the S3
// stand-in. Nothing here deletes, and the checks that matter most are negatives:
// the file's id, bytes and stored name do not move on a re-label; a material
// from another supplier is refused and nothing is stored; there is no
// DELETE /materials route.
import { chromium } from 'playwright-core';
const PORT = process.env.PORT || 5212;
const URL = `http://localhost:${PORT}`;
const B = `${URL}/api`;
const J = async (r) => { try { return await r.json(); } catch { return null; } };
let token = null;
const req = (p, o = {}) => fetch(B + p, { ...o, headers: {
  'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(o.headers || {}) } });
const put = (p, body) => req(p, { method: 'PUT', body: JSON.stringify(body) });
const post = (p, body) => req(p, { method: 'POST', body: JSON.stringify(body) });
const up = (p, fd) => fetch(B + p, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: fd });
let pass = 0, fail = 0;
const t = (n, c, d = '') => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (d ? ' — ' + d : '')); } };
const pdf = (name) => new File([Buffer.from('%PDF-1.4\n% fixture\n')], name, { type: 'application/pdf' });

const { default: Database } = await import('better-sqlite3');
const peek = (fn) => { const db = new Database(process.env.DBPATH, { readonly: true }); try { return fn(db); } finally { db.close(); } };
{
  const db = new Database(process.env.DBPATH);
  const mk = (id, name, role, dept, access) => db.prepare(`INSERT OR REPLACE INTO users
    (id,name,username,role,department,is_active,setup_code,setup_code_expires_at,module_access)
    VALUES (?,?,?,?,?,1,'SEED-CODE',datetime('now','+7 day'),?)`).run(id, name, name, role, dept, access);
  mk('sm-pur', 'Pat Material', 'operator', 'purchasing', '{"suppliers":"edit"}');
  mk('sm-op', 'Otto Material', 'operator', 'warehouse', '{"suppliers":"view"}');
  const s = db.prepare('INSERT OR REPLACE INTO suppliers (id, name, vendor_type, actively_using) VALUES (?,?,?,?)');
  s.run('sm-m4', 'M4 Shaped Co', 'ingredient', 1);
  s.run('sm-other', 'Other Supplier Co', 'ingredient', 1);
  const f = db.prepare('INSERT OR REPLACE INTO supplier_files (id, supplier_id, kind, expires_on, filename, source_path, storage_key, size) VALUES (?,?,?,?,?,?,?,?)');
  // An M4-shaped record: the signed questionnaire, filed as unknown.
  f.run('sm-q', 'sm-m4', 'unknown', null, 'M4 Dynamic Signed VQ 2026.pdf', 'x/q', 'suppliers/sm-m4/fixture-q.pdf', 10);
  f.run('sm-coa', 'sm-m4', 'coa', null, 'COA Whey 2026.pdf', 'x/coa', 'suppliers/sm-m4/fixture-coa.pdf', 10);
  f.run('sm-letter', 'sm-m4', 'letter_of_guarantee', '2027-01-31', 'Letter of Guarantee.pdf', 'x/l', null, null);
  f.run('sm-cert', 'sm-m4', 'certificate', null, 'NSF GMP.pdf', 'x/c', null, null);
  f.run('sm-gone', 'sm-m4', 'specification', null, 'Missing Spec.pdf', 'x/gone', null, null);
  db.close();
}
const login = async (id, name, password) => {
  await req('/users/set-password', { method: 'POST', body: JSON.stringify({ user_id: id, password, setup_code: 'SEED-CODE' }) });
  return (await J(await req('/users/login', { method: 'POST', body: JSON.stringify({ name, password }) })))?.token;
};
const purTok = await login('sm-pur', 'Pat Material', 'PatSecret2026');
const opTok = await login('sm-op', 'Otto Material', 'OttoSecret2026');
t('Purchasing and a viewer signed in', !!purTok && !!opTok);
token = purTok;

console.log('\n── ingredients and part numbers ──');
let r = await post('/suppliers/sm-m4/materials', { item_description: 'Whey Protein Isolate', part_number: '201069', part_source_system: 'mrpeasy' });
let body = await J(r);
const matId = body?.material?.id;
t('an ingredient is created with an MRPEasy part number (201)', r.status === 201 && body.material.current_part_number === '201069');
r = await post('/suppliers/sm-m4/materials', { item_description: 'Cocoa', part_number: 'C-1' });
body = await J(r);
t('a part number with no system takes the plant default (mrpeasy)', r.status === 201 && body.material.parts[0]?.system === 'mrpeasy');
const cocoaId = body?.material?.id;
r = await put(`/suppliers/materials/${matId}`, { parts: [{ system: 'keychain', part_number: 'KC-9001' }] });
body = await J(r);
t('a Keychain number sits beside the MRPEasy one on the same ingredient',
  r.ok && body.material.parts.length === 2 && body.material.parts.some(p => p.system === 'mrpeasy' && p.part_number === '201069')
  && body.material.parts.some(p => p.system === 'keychain' && p.part_number === 'KC-9001'));
r = await put(`/suppliers/materials/${matId}`, { current_part_system: 'keychain' });
t('switching the number in use is a pointer, not a rename', (await J(r))?.material?.current_part_number === 'KC-9001');
await put(`/suppliers/materials/${matId}`, { current_part_system: '' });
r = await post('/suppliers/sm-m4/materials', { item_description: 'X', part_number: '1', part_source_system: 'sap' });
t('an unknown part-number system is refused', r.status === 400);
r = await post('/suppliers/sm-m4/materials', { item_description: '   ' });
t('an ingredient with no description is refused', r.status === 400);
const det = await J(await req('/suppliers/sm-m4'));
t('GET /:id returns the ingredients with their parts, the systems and the default',
  det.materials.some(m => m.id === matId && m.parts.length === 2) && det.part_systems.length === 4 && det.default_part_system === 'mrpeasy');

console.log('\n── linking a document to an ingredient on upload ──');
const other = await J(await post('/suppliers/sm-other/materials', { item_description: 'Other ingredient' }));
const before = peek(db => db.prepare('SELECT COUNT(*) n FROM supplier_files').get().n);
let fd = new FormData(); fd.append('files', pdf('Whey Spec 2026.pdf')); fd.append('material_id', other.material.id);
r = await up('/suppliers/sm-m4/files', fd);
t('an ingredient that belongs to another supplier is refused, nothing stored',
  r.status === 400 && (await J(r))?.code === 'MATERIAL_NOT_THIS_SUPPLIER'
  && peek(db => db.prepare('SELECT COUNT(*) n FROM supplier_files').get().n) === before);
fd = new FormData(); fd.append('files', pdf('Whey Spec 2026.pdf')); fd.append('material_id', matId); fd.append('kind', 'specification');
r = await up('/suppliers/sm-m4/files', fd);
const specId = (await J(r))?.saved?.[0]?.id;
let files = (await J(await req('/suppliers/sm-m4'))).files;
const spec = files.find(f => f.id === specId);
t('a document filed with an ingredient comes back with its id and part number',
  r.ok && spec?.material_id === matId && spec.material_part_number === '201069' && /Whey Protein Isolate/.test(spec.material_label));
fd = new FormData(); fd.append('files', pdf('Natural Flavor Statement.pdf')); fd.append('kind', 'natural_flavor'); fd.append('lot_number', 'L-7731');
r = await up('/suppliers/sm-m4/files', fd);
t('a new kind (natural_flavor) and a lot number are taken on upload', r.ok);
const nfId = (await J(r))?.saved?.[0]?.id;
const nf = peek(db => db.prepare('SELECT kind, lot_number FROM supplier_files WHERE filename = ?').get('Natural Flavor Statement.pdf'));
t('…stored as natural_flavor with lot L-7731', nf?.kind === 'natural_flavor' && nf.lot_number === 'L-7731', JSON.stringify(nf));
fd = new FormData(); fd.append('files', pdf('Odd.pdf')); fd.append('kind', 'made_up');
t('an unknown kind on upload is refused', (await up('/suppliers/sm-m4/files', fd)).status === 400);
fd = new FormData(); fd.append('files', pdf('GMP.pdf')); fd.append('kind', 'gmp_certificate');
t('a GMP certificate filed with no expiry is still EXPIRY_REQUIRED', (await J(await up('/suppliers/sm-m4/files', fd)))?.code === 'EXPIRY_REQUIRED');
fd = new FormData(); fd.append('files', pdf('Letter.pdf')); fd.append('kind', 'letter_of_guarantee');
t('a letter of guarantee filed with no date is still RENEWAL_REQUIRED', (await J(await up('/suppliers/sm-m4/files', fd)))?.code === 'RENEWAL_REQUIRED');

console.log('\n── the audited kind / expiry / ingredient / lot edit ──');
let reg = await J(await req('/suppliers'));
t('the M4-shaped supplier reads "no questionnaire" while its signed one is filed as unknown',
  reg.suppliers.find(s => s.id === 'sm-m4')?.no_questionnaire === true);
const q0 = peek(db => db.prepare('SELECT id, storage_key, filename FROM supplier_files WHERE id = ?').get('sm-q'));
r = await put('/suppliers/files/sm-q', { kind: 'questionnaire' });
const q1 = peek(db => db.prepare('SELECT id, storage_key, filename, kind FROM supplier_files WHERE id = ?').get('sm-q'));
t('re-labelling it as a questionnaire succeeds', r.ok && q1.kind === 'questionnaire');
t('the file id, storage key and name do not move', q1.id === q0.id && q1.storage_key === q0.storage_key && q1.filename === q0.filename);
reg = await J(await req('/suppliers'));
t('…and "no questionnaire" clears', reg.suppliers.find(s => s.id === 'sm-m4')?.no_questionnaire === false);
const a = peek(db => db.prepare("SELECT action, previous_state, new_state, actor FROM audit_log WHERE entity_id = 'sm-q' ORDER BY rowid DESC LIMIT 1").get());
t('the audit row has the before and the after', /relabel/.test(a?.action || '') && JSON.parse(a.previous_state).kind === 'unknown'
  && JSON.parse(a.new_state).kind === 'questionnaire' && a.actor === 'Pat Material', JSON.stringify(a));
await put('/suppliers/files/sm-q', { kind: 'unknown' });
reg = await J(await req('/suppliers'));
t('re-labelling it away again sets "no questionnaire" back', reg.suppliers.find(s => s.id === 'sm-m4')?.no_questionnaire === true);
r = await put('/suppliers/files/sm-coa', { lot_number: '24-0117', material_id: matId });
files = (await J(await req('/suppliers/sm-m4'))).files;
t('a COA takes a lot number and an ingredient', r.ok && files.find(f => f.id === 'sm-coa')?.lot_number === '24-0117'
  && files.find(f => f.id === 'sm-coa')?.material_id === matId);
t('an expiry can be set and cleared on an ordinary document',
  (await put('/suppliers/files/sm-coa', { expires_on: '2027-03-01' })).ok
  && (await put('/suppliers/files/sm-coa', { expires_on: '' })).ok
  && peek(db => db.prepare("SELECT expires_on FROM supplier_files WHERE id = 'sm-coa'").get().expires_on) === null);
t('clearing the date on a letter of guarantee is RENEWAL_REQUIRED', (await J(await put('/suppliers/files/sm-letter', { expires_on: '' })))?.code === 'RENEWAL_REQUIRED');
t('re-labelling an undated certificate as the GMP certificate needs its expiry',
  (await J(await put('/suppliers/files/sm-cert', { kind: 'gmp_certificate' })))?.code === 'EXPIRY_REQUIRED'
  && (await put('/suppliers/files/sm-cert', { kind: 'gmp_certificate', expires_on: '2027-06-30' })).ok);
t('an unknown kind or a bad date is refused', (await put('/suppliers/files/sm-coa', { kind: 'nope' })).status === 400
  && (await put('/suppliers/files/sm-coa', { expires_on: '31/12/2026' })).status === 400);
t('an ingredient from another supplier is refused on the edit', (await put('/suppliers/files/sm-coa', { material_id: other.material.id })).status === 400);
token = opTok;
t('a viewer cannot edit a document or an ingredient', (await put('/suppliers/files/sm-coa', { lot_number: 'x' })).status === 403
  && (await post('/suppliers/sm-m4/materials', { item_description: 'Nope' })).status === 403);
token = purTok;

console.log('\n── the existing routes still hold ──');
t('the renewal route still sets a letter\'s date', (await put('/suppliers/files/sm-letter/renewal', { expires_on: '2027-02-28' })).ok);
t('the GMP convenience route still refuses a non-certificate', (await put('/suppliers/files/sm-coa/gmp-certificate', { expires_on: '2027-01-01' })).status === 400);

console.log('\n── retire, never delete ──');
r = await put(`/suppliers/materials/${cocoaId}`, { is_active: false });
const checks = (await J(await req('/suppliers/sm-m4'))).material_checks || [];
t('a retired ingredient leaves the banned-list checks', r.ok && !checks.some(m => m.id === cocoaId) && checks.some(m => m.id === matId));
t('…its row is still there', peek(db => db.prepare('SELECT is_active FROM supplier_materials WHERE id = ?').get(cocoaId))?.is_active === 0);
fd = new FormData(); fd.append('files', pdf('Cocoa Spec.pdf')); fd.append('material_id', cocoaId);
t('a new document cannot be linked to a retired ingredient', (await J(await up('/suppliers/sm-m4/files', fd)))?.code === 'MATERIAL_RETIRED');
t('there is no DELETE route for an ingredient', [404, 405].includes((await req(`/suppliers/materials/${cocoaId}`, { method: 'DELETE' })).status)
  && !!peek(db => db.prepare('SELECT id FROM supplier_materials WHERE id = ?').get(cocoaId)));

console.log('\n── storage gaps, by id ──');
const cov = await J(await req('/suppliers/files/coverage'));
t('coverage lists each catalogued file with no bytes, by id', cov.missing.some(m => m.id === 'sm-gone' && m.supplier_name === 'M4 Shaped Co' && m.source_path === 'x/gone'));
t('…and nothing was removed', !!peek(db => db.prepare("SELECT id FROM supplier_files WHERE id = 'sm-gone'").get()));
const exp = await J(await req('/suppliers/documents/expiring?days=400'));
t('the expiring list carries the ingredient field', [...exp.expired, ...exp.expiring].every(f => 'material_label' in f));
void nfId;

console.log('\n── the screen ──');
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
for (const width of [1280, 390]) {
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  page.on('pageerror', e => { console.log('  [pageerror]', e.message); fail++; });
  const me = await J(await req('/users/me'));
  await page.goto(`${URL}/manifest.webmanifest`);
  await page.evaluate(([tok, usr]) => { localStorage.setItem('auth_token', tok); localStorage.setItem('auth_user', JSON.stringify(usr)); }, [purTok, me]);
  await page.goto(`${URL}/?tab=suppliers`);
  await page.waitForTimeout(2500);
  // The desktop table and the phone cards are both in the page; click the one on screen.
  await page.locator('text=M4 Shaped Co >> visible=true').first().click();
  await page.waitForTimeout(1500);
  t(`${width}px: the ingredient shows both part numbers`, await page.locator('[data-ingredient-number="mrpeasy:201069"]:visible').count() >= 1
    && await page.locator('[data-ingredient-number="keychain:KC-9001"]:visible').count() >= 1);
  if (width === 1280) {
    await page.locator('[data-ingredient-add]:visible').first().click();
    await page.locator('[data-ingredient-desc]:visible').fill('Sunflower Lecithin');
    await page.locator('[data-ingredient-part="mrpeasy"]:visible').fill('300555');
    await page.locator('[data-ingredient-save]:visible').click();
    await page.waitForTimeout(1200);
    t('an ingredient added on the screen is saved with its number', await page.locator('[data-ingredient-number="mrpeasy:300555"]:visible').count() >= 1);
    await page.locator('[data-file-edit="sm-q"]:visible').first().click();
    await page.locator('[data-file-meta-kind]:visible').selectOption('questionnaire');
    await page.locator('[data-file-meta-save]:visible').click();
    await page.waitForTimeout(1200);
    t('a document re-labelled on the screen reads as a questionnaire', await page.locator('[data-file-kind="questionnaire"]:visible').count() >= 1
      && peek(db => db.prepare("SELECT kind FROM supplier_files WHERE id = 'sm-q'").get().kind) === 'questionnaire');
  }
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  t(`${width}px: no sideways scroll`, !overflow);
  await page.close();
}
await browser.close();

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
