// verify:artworkfilm — D-136, live on a fresh database, two reboots, and a real browser.
//
// "Should a changed trim or material on a spec with released artwork mark that
// artwork for another look?" Yes, for the film fields only, with a way to say
// "checked against the spec, still fits". Each heading is one half of that.
//
// Caller sets PORT + DBPATH. Needs a built client. The control is `main` before
// this change: released artwork carries no film baseline, and the first
// assertion after the reboot fails.
import Database from 'better-sqlite3';
import { spawn } from 'child_process';

const PORT = Number(process.env.PORT || 5052);
const BOOT2 = PORT + 100;
const DBP = process.env.DBPATH;
let pass = 0, fail = 0;
const t = (n, ok, d = '') => { if (ok) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n}${d ? ' — ' + d : ''}`); } };
const J = async (r) => { try { return await r.json(); } catch { return null; } };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const db = new Database(DBP);
const mkUser = (id, name, role, dept, modules) => db.prepare(`INSERT OR REPLACE INTO users
  (id,name,username,role,department,is_active,setup_code,setup_code_expires_at,module_access)
  VALUES (?,?,?,?,?,1,?,datetime('now','+7 day'),?)`).run(id, name, name, role, dept, `SC-${id}`, modules ? JSON.stringify(modules) : null);
mkUser('af-adm', 'Fiona Film', 'admin', 'qa', null);
mkUser('af-op', 'Otto Floor', 'operator', 'warehouse', { products: 'edit' });

// ── The plant's state: artwork released before the readiness model recorded any
// film. Two small pouches, released by hand, no basis at all.
const SM = db.prepare("SELECT sku FROM products WHERE spec_id = 'SPEC-POUCH-SM' ORDER BY sku").all().map((r) => r.sku);
const [A, B, C] = SM;
db.prepare("UPDATE products SET artwork_status = 'print_ready', artwork_version = '2', readiness_basis = NULL WHERE sku IN (?, ?)").run(A, B);
const spec0 = db.prepare("SELECT * FROM packaging_specs WHERE spec_id = 'SPEC-POUCH-SM'").get();
db.close();

async function reboot(port) {
  const proc = spawn(process.execPath, ['server.js'], {
    env: { ...process.env, PORT: String(port), DB_PATH: DBP },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  proc.stdout.on('data', (d) => { log += d; });
  proc.stderr.on('data', (d) => { log += d; });
  let ready = false;
  for (let i = 0; i < 90; i++) {
    await wait(1000);
    try { await fetch(`http://localhost:${port}/api/users/lookup?q=zz`); ready = true; break; } catch { /* booting */ }
  }
  return { proc, base: `http://localhost:${port}/api`, url: `http://localhost:${port}`, ready, log: () => log };
}

console.log('\n── the redeploy: released artwork takes the spec as it stands as its baseline ──');
const one = await reboot(BOOT2);
t('the application booted again on the same database', one.ready);
t('the boot log says how many released artworks took a film baseline', /Readiness: \d+ released artwork took its packaging spec/.test(one.log()),
  one.log().split('\n').filter((l) => /Readiness/.test(l)).join(' | '));
const B_ = one.base;
const signIn = async (id, name, pw) => {
  const c = (m, p, b) => fetch(B_ + p, { method: m, headers: { 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : undefined });
  await c('POST', '/users/login', { name });
  await c('POST', '/users/set-password', { user_id: id, password: pw, setup_code: `SC-${id}` });
  return (await J(await c('POST', '/users/login', { name, password: pw })))?.token;
};
const tok = await signIn('af-adm', 'Fiona Film', 'FionaFilm2026!!');
const opTok = await signIn('af-op', 'Otto Floor', 'OttoFloor2026!!');
t('signed in (admin, and a floor account holding the products grant)', !!tok && !!opTok);
const call = (m, p, b, k = tok) => fetch(B_ + p, { method: m, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${k}` }, body: b ? JSON.stringify(b) : undefined });
const get = async (p) => J(await call('GET', p));
const art = async (sku) => (await get(`/products/${encodeURIComponent(sku)}`))?.readiness?.steps?.find((s) => s.key === 'artwork');
const basisOf = (sku) => { const d = new Database(DBP); const r = d.prepare('SELECT readiness_basis FROM products WHERE sku = ?').get(sku); d.close(); return JSON.parse(r.readiness_basis || '{}'); };
const spec = async () => (await get('/products/specs'))?.specs?.find((s) => s.spec_id === 'SPEC-POUCH-SM');

t('both released artworks now carry the spec\'s film as their baseline', ['film'].every(() => 'film' in (basisOf(A).artwork?.deps || {}) && 'film' in (basisOf(B).artwork?.deps || {})));
t('…and nothing went amber on the day it ran', (await art(A))?.state === 'done' && (await art(B))?.state === 'done');
t('a product with no released artwork is left alone', !basisOf(C).artwork);
const beforeTwo = JSON.stringify(basisOf(A));
one.proc.kill('SIGKILL');
await wait(500);
const two = await reboot(BOOT2);
t('a second redeploy adopts nothing (idempotent by construction)', two.ready && !/Readiness: \d+ released artwork/.test(two.log()) && JSON.stringify(basisOf(A)) === beforeTwo);

console.log('\n── a real release records the film too ──');
// C walked to an approved panel and released through the Artwork board.
await call('PUT', `/products/${C}`, { mrp_formula_id: 'F-00123', formula_rev: 'v2.0', fill_weight_g: 34.86 });
const PANEL = {
  serving_size_desc: '1 scoop', serving_size_g: 34.86, servings_per_container: 1, calories: 130,
  total_fat_g: 1.5, total_fat_dv: 2, saturated_fat_g: 1, saturated_fat_dv: 5, trans_fat_g: 0,
  cholesterol_mg: 45, cholesterol_dv: 15, sodium_mg: 115, sodium_dv: 5,
  total_carbohydrate_g: 5, total_carbohydrate_dv: 2, dietary_fiber_g: 0, dietary_fiber_dv: 0,
  total_sugars_g: 2, added_sugars_g: 1, added_sugars_dv: 2, protein_g: 24,
  vitamin_d_mcg: 0, vitamin_d_dv: 0, calcium_mg: 130, calcium_dv: 10, iron_mg: 0.3, iron_dv: 0,
  potassium_mg: 160, potassium_dv: 4,
  ingredients: 'Whey protein isolate, natural flavors', allergen_statement: 'Contains milk.',
  net_weight_g: 34.86, net_weight_oz: 1.23,
};
const v = await J(await call('POST', '/nfp', { sku: C, version: 'V3', drive_url: 'https://drive.example/panel', provenance: { formula_ref: 'F-00123', formula_version: 'v2.0', bom_fill_weight_g: 34.86, source_system: 'Genesis R&D' } }));
await call('PUT', `/nfp/${v?.id}/panel`, { panel: PANEL, front_callouts: { protein_g: 24, calories: 130, added_sugar_g: null } });
let r = await call('POST', `/nfp/${v?.id}/decide`, { decision: 'approved' });
t('the panel for the third pouch is approved', r.ok, `${r.status} ${JSON.stringify(await J(r))}`);
const aw = await J(await call('POST', '/artwork', { sku: C, nfp_version: 'V3' }));
await call('POST', `/artwork/versions/${aw?.id}/status`, { status: 'in_review' });
await call('POST', `/artwork/versions/${aw?.id}/status`, { status: 'approved' });
r = await call('POST', `/artwork/versions/${aw?.id}/status`, { status: 'print_ready' });
t('its artwork is released print-ready on the Artwork board', r.ok, `${r.status} ${JSON.stringify(await J(r))}`);
t('…and the release recorded the spec\'s film with everything else', 'film' in (basisOf(C).artwork?.deps || {}));
let p = await get(`/products/${C}`);
t('the third pouch\'s artwork gate is met (released against its panel)', p?.stage?.gates?.find((g) => g.key === 'artwork')?.met === true, JSON.stringify(p?.stage?.gates?.find((g) => g.key === 'artwork')));

console.log('\n── a field that is not printed moves nothing ──');
let j = await J(await call('PUT', '/products/specs/SPEC-POUCH-SM', { vendor: 'PPS (re-quoted)', last_unit_cost: 0.45, notes: 'Re-quoted September' }));
t('vendor, cost and notes saved', j?.changed?.length === 3, JSON.stringify(j?.changed));
t('…and no released artwork is waiting to be checked', j?.spec?.artwork_to_check?.length === 0 && (await art(A)).state === 'done');

console.log('\n── a trim corrected on the spec marks every released artwork on it ──');
j = await J(await call('PUT', '/products/specs/SPEC-POUCH-SM', { trim_length_mm: 230 }));
const toCheck = (j?.spec?.artwork_to_check || []).map((a) => a.sku).sort();
t('the edit answers with the three released artworks now waiting to be checked', JSON.stringify(toCheck) === JSON.stringify([A, B, C].sort()), JSON.stringify(toCheck));
let a = await art(A);
t('the artwork step reads stale, naming the field and both values',
  a?.state === 'stale' && a.film_fields?.[0]?.label === 'trim length' && a.film_fields[0].from === String(spec0.trim_length_mm) && a.film_fields[0].to === '230'
  && /trim length \(228\.6 → 230\)/.test(a.reason), a?.reason);
t('it is not done any more — the Ready count drops', a?.done === false);
t('the release is NOT withdrawn: the artwork is still print-ready', (await get(`/products/${A}`))?.artwork_status === 'print_ready');
p = await get(`/products/${C}`);
const g8 = p?.stage?.gates?.find((g) => g.key === 'artwork');
t('the Pipeline stops meeting the released pouch\'s artwork gate, saying why', g8?.met === false && /released before the packaging spec changed \(trim length 228\.6 → 230\)/.test(g8?.why || ''), JSON.stringify(g8));
const audit = (() => { const d = new Database(DBP); const x = d.prepare("SELECT details FROM audit_log WHERE entity_type = 'packaging_spec' ORDER BY rowid DESC LIMIT 1").get(); d.close(); return x?.details || ''; })();
t('the spec edit\'s audit entry names the artwork it marked', toCheck.every((s) => audit.includes(s)), audit);

console.log('\n── "checked against the spec, still fits" ──');
r = await call('POST', `/products/${A}/artwork/film-check`, { note: 'Dieline already 230' }, opTok);
t('a floor account holding the products grant cannot sign it off (403)', r.status === 403);
r = await call('POST', `/products/${A}/artwork/film-check`, { note: 'ok' });
t('a note under three characters is refused, saying what to write', r.status === 400 && /Say what was checked/.test((await J(r))?.error || ''));
const other = (() => { const d = new Database(DBP); const x = d.prepare("SELECT sku FROM products WHERE spec_id = 'SPEC-STICK-LG' LIMIT 1").get(); d.close(); return x.sku; })();
r = await call('POST', `/products/${other}/artwork/film-check`, { note: 'nothing to check' });
t('a product whose artwork is not waiting is refused (409), not re-stamped', r.status === 409);
r = await call('POST', `/products/${A}/artwork/film-check`, { note: 'Dieline already 230 mm; spec corrected to match' });
j = await J(r);
t('checking it clears the amber on that product', r.ok && (await art(A)).state === 'done', `${r.status} ${JSON.stringify(j)}`);
a = await art(A);
t('…and the step says who checked it, when, and why', a?.film_checked?.by === 'Fiona Film' && /spec corrected to match/.test(a.film_checked.note));
t('…and the fields it was checked for travel with it', a?.film_checked?.fields?.[0]?.key === 'trim_length_mm');
t('it is one product, not the spec: the other two still wait', (await art(B)).state === 'stale' && (await art(C)).state === 'stale');
t('the spec\'s list now names only those two', JSON.stringify((await spec()).artwork_to_check.map((x) => x.sku).sort()) === JSON.stringify([B, C].sort()));
const auditA = (() => { const d = new Database(DBP); const x = d.prepare("SELECT * FROM audit_log WHERE entity_id = ? AND details LIKE '%spec corrected to match%'").get(A); d.close(); return x; })();
t('the check is audited with the note and the fields', !!auditA && /trim_length_mm/.test(auditA.details));

// A second reason on the same step is NOT cleared by this. C was released
// through the Artwork board, so its basis recorded the GTIN (B's adopted
// baseline carries only the film — first sight — and would prove nothing).
(() => { const d = new Database(DBP); d.prepare('UPDATE products SET gtin = ? WHERE sku = ?').run('123456789012', C); d.close(); })();
r = await call('POST', `/products/${C}/artwork/film-check`, { note: 'Trim fine on the dieline' });
a = await art(C);
t('checking the film leaves a GTIN change on the same artwork stale', r.ok && a.state === 'stale' && a.changed.join() === 'gtin', `${a?.state} ${a?.changed}`);

console.log('\n── the next change marks it again ──');
await call('PUT', '/products/specs/SPEC-POUCH-SM', { trim_length_mm: 231 });
a = await art(A);
t('a further trim change re-marks the product that was checked', a.state === 'stale' && a.film_fields[0].from === '230' && a.film_fields[0].to === '231', a.reason);
await call('PUT', '/products/specs/SPEC-POUCH-SM', { front_panel_mm: '190.5 mm' });
a = await art(A);
t('a first value typed into a blank counts too', a.film_fields.some((f) => f.key === 'front_panel_mm' && f.from === '' && f.to === '190.5'), JSON.stringify(a.film_fields));

console.log('\n── in a browser ──');
const { chromium } = await import('playwright-core');
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const authed = async (ctx) => {
  const pg = await ctx.newPage();
  await pg.goto(`${two.url}/manifest.webmanifest`);
  await pg.evaluate(([k]) => { localStorage.setItem('auth_token', k); localStorage.setItem('auth_user', JSON.stringify({ id: 'af-adm', name: 'Fiona Film', role: 'admin' })); }, [tok]);
  return pg;
};
try {
  const page = await authed(await browser.newContext({ viewport: { width: 1280, height: 900 } }));
  await page.goto(`${two.url}/?tab=products&view=specs&spec=SPEC-POUCH-SM`);
  const card = page.locator('[data-spec="SPEC-POUCH-SM"]');
  await card.locator('[data-spec-to-check]').waitFor({ timeout: 15000 });
  t('the spec card names the released artwork waiting to be checked', await card.locator('[data-spec-to-check-sku]').count() === 3);
  t('…and counts it in its header', /3 to check against this spec/.test(await card.locator('[data-spec-to-check-count]').innerText()));
  await card.locator('[data-spec-edit]').click();
  t('the edit form says a film change marks that artwork, before Save', /marks that artwork to be checked against the spec; it stays released/.test(await card.locator('[data-spec-reach]').innerText()));
  await card.locator('button:has-text("Cancel")').click();
  await card.locator(`[data-spec-to-check-sku="${B}"]`).click();
  const box = page.locator(`[data-film-waiting="${B}"]`);
  await box.waitFor({ timeout: 10000 });
  t('clicking a SKU opens its drawer on the artwork, naming each field that moved', await box.locator('[data-film-field]').count() === 2
    && /trim length: 228\.6 → 231/i.test(await box.innerText()), await box.innerText());
  t('…with the gate ringed', await page.locator('[data-gate-focus="artwork"]').count() === 1);
  t('the button waits for a note', await box.locator('[data-film-fits]').isDisabled());
  await box.locator('[data-film-note]').fill('Checked the dieline: trim and front panel match');
  await box.locator('[data-film-fits]').click();
  await page.locator('[data-film-checked]').waitFor({ timeout: 10000 });
  t('checking it replaces the amber box with who checked it and why', await page.locator(`[data-film-waiting="${B}"]`).count() === 0
    && /Fiona Film.*Checked the dieline/.test(await page.locator('[data-film-checked]').innerText()));
  t('…and the database agrees', (await art(B)).state === 'done');

  const phone = await authed(await browser.newContext({ viewport: { width: 390, height: 844 } }));
  await phone.goto(`${two.url}/?tab=products&view=specs&spec=SPEC-POUCH-SM`);
  await phone.locator(`[data-spec="SPEC-POUCH-SM"] [data-spec-to-check-sku="${A}"]`).click({ timeout: 15000 });
  await phone.locator(`[data-film-waiting="${A}"]`).waitFor({ timeout: 10000 });
  const over = await phone.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  t('at 390px the check opens in the drawer with no sideways scroll', over <= 0, `${over}px`);
} finally { await browser.close(); two.proc.kill('SIGKILL'); }

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
