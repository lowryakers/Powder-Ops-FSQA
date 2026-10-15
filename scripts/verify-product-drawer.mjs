// verify:productdrawer — the product drawer reads as one page, each fact once (D-178).
//
// The drawer printed the nine stage gates with two lines of explanation each,
// then the whole readiness checklist in an amber block, then every step AGAIN
// inside its section. This checks the simplified shape in a real browser:
//
//   1. The nine gates are a bar; their explanations wait behind one toggle.
//   2. Each readiness step is on the page exactly once, in its own section.
//   3. "N still outstanding" is one row of chips, and a chip opens its section.
//   4. A section with nothing outstanding starts folded, saying what is in it.
//   5. Ticking a step (Shopify) still works, from the section that owns it.
//   6. A done step carries no reason text; an open one does.
//   7. At 390px nothing pans sideways.
//
// THE CONTROL is the drawer before D-178: the gate list is open, every step is
// printed twice, and nothing folds. Caller sets PORT + DBPATH; needs a built client.
import { chromium } from 'playwright-core';
const PORT = process.env.PORT || 5104;
const URL = `http://localhost:${PORT}`;
const SHOTS = process.env.SHOTS || '';
let pass = 0, fail = 0;
const t = (n, c, d = '') => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (d ? ' — ' + d : '')); } };
const { default: Database } = await import('better-sqlite3');
const SKU = 'PPM-PS';
{
  const db = new Database(process.env.DBPATH);
  db.prepare(`INSERT OR REPLACE INTO users (id,name,username,role,department,is_active,module_access,setup_code,setup_code_expires_at)
    VALUES ('drw-ui','Drawer Admin','Drawer Admin','admin','office',1,NULL,'SC-DRW',datetime('now','+7 day'))`).run();
  db.close();
}
const H = { 'Content-Type': 'application/json' };
const post = (p, b) => fetch(`${URL}/api${p}`, { method: 'POST', headers: H, body: JSON.stringify(b) });
await post('/users/login', { name: 'Drawer Admin' });
await post('/users/set-password', { user_id: 'drw-ui', password: 'Drawer2026!', setup_code: 'SC-DRW' });
const auth = await (await post('/users/login', { name: 'Drawer Admin', password: 'Drawer2026!' })).json();
t('signed in', !!auth?.token);
const prod = await (await fetch(`${URL}/api/products/${SKU}`, { headers: { Authorization: `Bearer ${auth.token}` } })).json();
const steps = prod?.readiness?.steps || [];
const openSteps = steps.filter((s) => s.state !== 'done');
t('the product has readiness steps, some open and some done', openSteps.length > 0 && openSteps.length < steps.length,
  steps.map((s) => `${s.key}:${s.state}`).join(' '));

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
page.on('pageerror', (e) => { console.log('  [pageerror]', e.message); fail++; });
await page.goto(`${URL}/manifest.webmanifest`);
await page.evaluate(([tok, u]) => { localStorage.setItem('auth_token', tok); localStorage.setItem('auth_user', JSON.stringify(u)); }, [auth.token, auth.user]);

async function openDrawer(pg) {
  await pg.goto(`${URL}/?tab=products`);
  await pg.locator(`[data-grid-row="${SKU}"] [data-open-row], [data-record-cards] :text("${SKU}")`).locator('visible=true').first().click({ timeout: 20000 });
  await pg.locator('[data-product-drawer] [data-section="channels"]').waitFor({ timeout: 15000 });
}
await openDrawer(page);
const D = page.locator('[data-product-drawer]');
if (SHOTS) await D.screenshot({ path: `${SHOTS}/drawer-1280.png` });

console.log('\n── the stage is a bar ──');
t('nine gate segments', await D.locator('[data-stage-gate]').count() === 9);
t('THE GATE EXPLANATIONS ARE FOLDED until asked for', await D.locator('[data-stage-flow]').count() === 0);
t('…the next gate is one line', /^Next:/.test((await D.locator('[data-stage-next]').innerText()).trim()));
await D.locator('[data-stage-flow-toggle]').click();
t('"How the flow works" opens the nine with their reasons', await D.locator('[data-stage-flow] li').count() === 9);
await D.locator('[data-stage-flow-toggle]').click();

console.log('\n── each step once ──');
for (const s of steps) {
  const n = await D.locator(`[data-step-line="${s.key}"]`).count();
  if (n !== 1) t(`${s.key} is on the page once`, false, `${n} times`);
}
t('EVERY READINESS STEP IS ON THE PAGE EXACTLY ONCE', (await Promise.all(steps.map((s) => D.locator(`[data-step-line="${s.key}"]`).count()))).every((n) => n === 1));
t('no separate checklist block repeats them', !/signed off against has changed since/.test(await D.innerText()));

console.log('\n── one row of what is outstanding ──');
const chips = D.locator('[data-attention]');
t(`"${openSteps.length} still outstanding", one chip each`, await chips.count() === openSteps.length
  && new RegExp(`${openSteps.length} still outstanding`).test(await D.locator('[data-needs-attention]').innerText()));

const doneIdentity = ['sku', 'gtin'].every((k) => steps.find((s) => s.key === k)?.state === 'done');
if (doneIdentity) {
  const id = D.locator('[data-section="identity"]');
  t('A SECTION WITH NOTHING OUTSTANDING STARTS FOLDED (Identity)', await id.getAttribute('data-open') === '0');
  t('…and its header still says what is in it (the GTIN)', new RegExp(prod.gtin).test(await id.locator('[data-section-toggle]').innerText()));
  await id.locator('[data-section-toggle]').click();
  t('…one click opens it', await id.getAttribute('data-open') === '1' && await id.locator('[data-step-line="gtin"]').isVisible());
}
const pack = D.locator('[data-section="packaging"]');
if (await pack.getAttribute('data-open') === '0') {
  const key = openSteps.find((s) => ['spec', 'colors', 'artwork'].includes(s.key))?.key;
  if (key) { await D.locator(`[data-attention="${key}"]`).click(); await page.waitForTimeout(300); }
}
const chipKey = openSteps[0].key;
const sectionOf = { sku: 'identity', gtin: 'identity', formula: 'formula', nfp: 'panel', spec: 'packaging', colors: 'packaging', artwork: 'packaging', shopify: 'channels', shiphero: 'channels', amazon: 'channels' }[chipKey];
await D.locator(`[data-section="${sectionOf}"] [data-section-toggle]`).click(); // fold it first
await page.waitForTimeout(200);
if (await D.locator(`[data-section="${sectionOf}"]`).getAttribute('data-open') === '1') await D.locator(`[data-section="${sectionOf}"] [data-section-toggle]`).click();
await D.locator(`[data-attention="${chipKey}"]`).click();
await page.waitForTimeout(500);
t(`A CHIP OPENS THE SECTION THAT HAS IT (${chipKey} → ${sectionOf})`, await D.locator(`[data-section="${sectionOf}"]`).getAttribute('data-open') === '1'
  && await D.locator(`[data-step-line="${chipKey}"]`).isVisible());

console.log('\n── reasons only where something is open ──');
const doneStep = steps.find((s) => s.state === 'done' && s.reason);
if (doneStep) t(`a done step (${doneStep.key}) prints no reason`, await D.locator(`[data-readiness-reason="${doneStep.key}"]`).count() === 0);
const openReason = openSteps.find((s) => s.reason);
if (openReason) t(`an open step (${openReason.key}) says why`, await D.locator(`[data-readiness-reason="${openReason.key}"]`).count() === 1);

console.log('\n── ticking from the section that owns it ──');
const shop = steps.find((s) => s.key === 'shopify');
if (shop && shop.state !== 'done') {
  const ch = D.locator('[data-section="channels"]');
  if (await ch.getAttribute('data-open') === '0') await ch.locator('[data-section-toggle]').click();
  await D.locator('[data-step-tick="shopify"]').click();
  await page.waitForFunction(() => document.querySelector('[data-step-line="shopify"]')?.getAttribute('data-step-state') === 'done', null, { timeout: 8000 }).catch(() => {});
  t('TICKING "Listed in Shopify" IN CHANNELS RECORDS IT', await D.locator('[data-step-line="shopify"]').getAttribute('data-step-state') === 'done');
  t('…its chip leaves the outstanding row', await D.locator('[data-attention="shopify"]').count() === 0);
  t('…and it says who ticked it', /Drawer Admin/.test(await D.locator('[data-step-line="shopify"]').innerText()));
  await D.locator('[data-step-tick="shopify"]').click();
  await page.waitForFunction(() => document.querySelector('[data-step-line="shopify"]')?.getAttribute('data-step-state') !== 'done', null, { timeout: 8000 }).catch(() => {});
  t('…and unticking puts it back', await D.locator('[data-attention="shopify"]').count() === 1);
}

console.log('\n── the header ──');
t('status sits in the header', await D.locator('header [data-drawer-status]').count() === 1);
t('Edit is in the header, reachable without scrolling', await D.locator('header [data-drawer-edit]').isVisible());
await D.evaluate((el) => { el.scrollTop = 1500; });
await page.waitForTimeout(200);
t('…and stays there when the drawer scrolls', await D.locator('header [data-drawer-edit]').isVisible());

console.log('\n── on a phone ──');
const phone = await browser.newPage({ viewport: { width: 390, height: 844 } });
phone.on('pageerror', (e) => { console.log('  [pageerror]', e.message); fail++; });
await phone.goto(`${URL}/manifest.webmanifest`);
await phone.evaluate(([tok, u]) => { localStorage.setItem('auth_token', tok); localStorage.setItem('auth_user', JSON.stringify(u)); }, [auth.token, auth.user]);
await phone.goto(`${URL}/?tab=products&product=${SKU}`);
await phone.waitForTimeout(2500);
if (await phone.locator('[data-product-drawer]').count() === 0) {
  await phone.locator(`:text("${SKU}")`).locator('visible=true').first().click({ timeout: 15000 }).catch(() => {});
}
const opened = await phone.locator('[data-product-drawer] [data-section="channels"]').waitFor({ timeout: 15000 }).then(() => true).catch(() => false);
t('the drawer opens at 390px', opened);
if (SHOTS && opened) await phone.locator('[data-product-drawer]').screenshot({ path: `${SHOTS}/drawer-390.png` });
const over = await phone.locator('[data-product-drawer]').evaluate((el) => el.scrollWidth - el.clientWidth).catch(() => 99);
t('…with nothing panning sideways', over <= 0, `${over}px`);

await browser.close();
console.log(`\n${pass}/${pass + fail} assertions passed`);
process.exit(fail ? 1 : 0);
