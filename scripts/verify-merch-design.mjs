// verify:merchdesign — D-323, live on a fresh database (+ a browser at 1280).
//
// A merch style for a DESIGN that names no flavor: the "Protein" hoodie. It
// takes its own two- or three-letter code, which can never be a flavor register
// code (active, retired or legacy), and the register can never issue a code a
// design already carries. Flavor styles work exactly as before.
//
// Caller sets PORT + DBPATH. Needs a built client. The control is `main` before
// this change: a style with no flavor is refused as FLAVOR_NOT_REGISTERED.
import Database from 'better-sqlite3';
import { chromium } from 'playwright-core';

const PORT = process.env.PORT || 5205;
const URL = process.env.APP || `http://localhost:${PORT}`;
const DBP = process.env.DBPATH;
let pass = 0, fail = 0;
const t = (n, ok, d = '') => { if (ok) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n}${d ? ' — ' + d : ''}`); } };
const q = (sql, ...a) => { const d = new Database(DBP, { readonly: true }); try { return d.prepare(sql).all(...a); } finally { d.close(); } };

{
  const db = new Database(DBP);
  db.prepare(`INSERT OR REPLACE INTO users (id,name,username,role,department,is_active,setup_code,setup_code_expires_at)
    VALUES ('md-admin','Mo Design','Mo Design','admin','office',1,'SC-md',datetime('now','+7 day'))`).run();
  db.close();
}
const call = async (m, p, b, tok) => {
  const r = await fetch(`${URL}/api${p}`, { method: m, headers: { 'Content-Type': 'application/json', ...(tok ? { Authorization: `Bearer ${tok}` } : {}) }, body: b ? JSON.stringify(b) : undefined });
  let json = null; try { json = await r.json(); } catch { /* not json */ }
  return { status: r.status, json };
};
await call('POST', '/users/set-password', { user_id: 'md-admin', password: 'Design2026!!', setup_code: 'SC-md' });
const login = (await call('POST', '/users/login', { name: 'Mo Design', password: 'Design2026!!' })).json;
const A = login?.token;
t('signed in', !!A);

await call('POST', '/products/merch/colors', { code: 'BLK', name: 'Black' }, A);

console.log('\n── a design style names no flavor ──');
const CODE = ['PRT', 'PRO', 'PTN', 'PRX'].find((c) => !q('SELECT 1 FROM flavor_codes WHERE code = ?', c).length);
let r = await call('POST', '/products/merch/styles', { garment: 'H', style_kind: 'design', design_code: CODE }, A);
t('a design with no name is refused', r.status === 400 && r.json?.field === 'design_name', `${r.status}`);
const regCode = q('SELECT code, flavor FROM flavor_codes WHERE is_active = 1 LIMIT 1')[0];
r = await call('POST', '/products/merch/styles', { garment: 'H', style_kind: 'design', design_name: 'Protein', design_code: regCode.code }, A);
t(`a code a flavor already uses (${regCode.code}) is refused, naming the flavor`, r.status === 400 && r.json?.code === 'DESIGN_CODE' && r.json.error.includes(regCode.flavor), `${r.status} ${r.json?.error}`);
const legacy = q("SELECT flavor, legacy_codes FROM flavor_codes WHERE legacy_codes IS NOT NULL AND legacy_codes != ''")
  .flatMap((x) => { try { return JSON.parse(x.legacy_codes).map((c) => ({ c: String(c).toUpperCase(), flavor: x.flavor })); } catch { return []; } })
  .find((x) => /^[A-Z]{2,3}$/.test(x.c) && !q('SELECT 1 FROM flavor_codes WHERE code = ?', x.c).length);
if (legacy) {
  r = await call('POST', '/products/merch/styles', { garment: 'H', style_kind: 'design', design_name: 'Protein', design_code: legacy.c }, A);
  t(`an older flavor code still on film (${legacy.c}) is refused`, r.status === 400 && r.json?.code === 'DESIGN_CODE', `${r.status} ${r.json?.error}`);
}
r = await call('POST', '/products/merch/styles', { garment: 'H', style_kind: 'design', design_name: 'Protein', design_code: 'P' }, A);
t('a one-letter code is refused', r.status === 400 && r.json?.code === 'DESIGN_CODE');
r = await call('POST', '/products/merch/styles', { garment: 'H', style_kind: 'design', design_name: 'Protein', design_code: CODE.toLowerCase() }, A);
const st = r.json;
t(`MCH-H${CODE} "ProDough Protein Hoodie" is created with no flavor`, r.status === 201 && st?.style_code === `MCH-H${CODE}` && st?.style_kind === 'design' && st?.design_name === 'Protein' && st?.flavor === '' && st?.name === 'ProDough Protein Hoodie', `${r.status} ${JSON.stringify(st)}`);
t('…and the flavor register is untouched', !q('SELECT 1 FROM flavor_codes WHERE code = ?', CODE).length);
r = await call('POST', '/products/merch/styles', { garment: 'H', style_kind: 'design', design_name: 'Other', design_code: CODE }, A);
t('the same garment + code twice is refused', r.status === 409);
r = await call('POST', '/products/merch/styles', { garment: 'T', style_kind: 'design', design_name: 'Protein', design_code: CODE }, A);
t(`the same design on a tee is its own style (MCH-T${CODE})`, r.status === 201 && r.json?.style_code === `MCH-T${CODE}`);

console.log('\n── its variants ──');
r = await call('POST', `/products/merch/styles/MCH-H${CODE}/variants`, { colors: ['BLK'], sizes: ['S', 'M'] }, A);
t('variants are built with no flavor check', r.status === 201 && r.json?.created?.length === 2 && r.json.created.includes(`MCH-H${CODE}-BLK-S`), JSON.stringify(r.json));
const v = q('SELECT flavor, base_flavor, product_type, family, status, gtin FROM products WHERE sku = ?', `MCH-H${CODE}-BLK-S`)[0];
t('a variant reads "Protein Hoodie - Black / S", a Draft merch row with no GTIN', v?.flavor === 'Protein Hoodie - Black / S' && v.base_flavor === 'Protein' && v.product_type === 'merch' && v.status === 'Draft' && !v.gtin, JSON.stringify(v));
r = await call('PUT', `/products/merch/styles/MCH-H${CODE}`, { design_name: 'Strength' }, A);
t('the design name is the style\'s identity — not edited', r.status === 400);
r = await call('PUT', `/products/merch/styles/MCH-H${CODE}`, { supplier: 'Blank Co', decorator: 'Embroidery Co' }, A);
t('supplier and decorator are edited as on any style', r.status === 200 && r.json?.supplier === 'Blank Co');

console.log('\n── the flavor register will not issue a design\'s code ──');
r = await call('POST', '/products/flavor-codes', { flavor: 'Brand New Flavor', code: CODE }, A);
t(`issuing ${CODE} to a flavor is refused, naming the design`, r.status === 409 && /Protein/.test(r.json?.error || ''), `${r.status} ${r.json?.error}`);

console.log('\n── flavor styles are unchanged ──');
r = await call('POST', '/products/merch/styles', { garment: 'H', flavor: 'Birthday Cake' }, A);
t('a flavor style is still made from the register (MCH-HBDC)', r.status === 201 && r.json?.style_code === 'MCH-HBDC' && r.json?.style_kind === 'flavor' && r.json?.flavor === 'Birthday Cake');
r = await call('GET', '/products/merch', null, A);
const listed = (r.json?.styles || []).find((s) => s.style_code === `MCH-H${CODE}`);
t('the merch list labels the design style "Protein"', listed?.label === 'Protein' && listed?.style_kind === 'design');

console.log('\n── the screen ──');
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on('pageerror', (e) => { console.log('  [pageerror]', e.message); fail++; });
  await page.goto(`${URL}/manifest.webmanifest`);
  await page.evaluate(([tok, u]) => { localStorage.setItem('auth_token', tok); localStorage.setItem('auth_user', JSON.stringify(u)); }, [A, login.user]);
  await page.goto(`${URL}/?tab=products&type=merch`);
  const ok = await page.waitForSelector(`[data-merch-style="MCH-H${CODE}"]`, { timeout: 20000 }).then(() => true).catch(() => false);
  t('the design style shows on the Merch tab', ok);
  if (ok) t('…labelled "Protein (design)"', /Protein \(design\)/.test(await page.locator(`[data-merch-style="MCH-H${CODE}"]`).first().innerText()));
  await page.getByRole('button', { name: /New style/ }).first().click();
  await page.locator('[data-style-kind="design"]').check();
  t('choosing "A design" swaps the flavor list for a name and a code', await page.locator('[data-design-name]').count() === 1 && await page.locator('[data-design-code]').count() === 1);
  t('…and Create waits for both', await page.locator('[data-merch-create-style]').isDisabled());
  await page.locator('[data-design-name]').fill('Lift');
  await page.locator('[data-design-code]').fill('lft');
  await page.locator('[data-merch-create-style]').click();
  await page.waitForTimeout(1500);
  t('creating it from the screen makes MCH-HLFT', q("SELECT style_kind, design_name FROM merch_styles WHERE style_code = 'MCH-HLFT'")[0]?.design_name === 'Lift');
} finally { await browser.close(); }

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
