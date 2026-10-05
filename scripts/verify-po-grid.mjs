// verify:pogrid — D-143 (scroll box: D-149), live on a fresh database and a real browser at 1280.
//
// Jake (2 Oct) on Procurement → Purchase Orders: mass edit, a search bar that
// takes several keywords, scrollbars that stay on screen, and every field
// editable — board status included. The grid is the shared office DataGrid,
// so the search and the scroll box are asserted on it.
//
// Caller sets PORT + DBPATH + DB_PATH (the server is already up). Needs a
// built client. The control is `main`: board status is read-only, the mass
// edit takes four fields, "acme q4" finds nothing.
import Database from 'better-sqlite3';
import { chromium } from 'playwright-core';

const PORT = Number(process.env.PORT || 5057);
const URL = `http://localhost:${PORT}`;
const B = `${URL}/api`;
const DBP = process.env.DBPATH;
let pass = 0, fail = 0;
const t = (n, ok, d = '') => { if (ok) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n}${d ? ' — ' + d : ''}`); } };
const J = async (r) => { try { return await r.json(); } catch { return null; } };

const db = new Database(DBP);
db.prepare(`INSERT OR REPLACE INTO users (id,name,username,role,department,is_active,setup_code,setup_code_expires_at,module_access)
  VALUES ('po-jake','Jake Grid','Jake Grid','supervisor','office',1,'SC-po-jake',datetime('now','+7 day'),?)`).run(JSON.stringify({ procurement: 'edit' }));
db.close();
const c = (m, p, b, tk) => fetch(B + p, { method: m, headers: { 'Content-Type': 'application/json', ...(tk ? { Authorization: `Bearer ${tk}` } : {}) }, body: b ? JSON.stringify(b) : undefined });
await c('POST', '/users/login', { name: 'Jake Grid' });
await c('POST', '/users/set-password', { user_id: 'po-jake', password: 'Passw0rd!!', setup_code: 'SC-po-jake' });
const me = await J(await c('POST', '/users/login', { name: 'Jake Grid', password: 'Passw0rd!!' }));
const A = (m, p, b) => c(m, p, b, me?.token);
t('Jake signs in with the Procurement edit grant', !!me?.token);

console.log('\n── every field is editable, through one coercion ──');
const mk = async (o) => J(await A('POST', '/procurement/pos', { status: 'open', qty: 10, unit_price: 2, ...o }));
const p1 = await mk({ vendor: 'Acme Films', part_no: 'WIDGET-1', description: 'Stick film', expected_date: '2026-11-03', po_number: 'PO-GRID-1' });
const p2 = await mk({ vendor: 'Acme Films', part_no: 'WIDGET-2', description: 'Pouch film', expected_date: '2026-11-04', po_number: 'PO-GRID-2' });
const p3 = await mk({ vendor: 'Beta Boxes', part_no: 'BOX-9', description: 'Shipper', expected_date: '2026-11-05', po_number: 'PO-GRID-3' });
for (let i = 0; i < 70; i++) await mk({ vendor: `Filler Vendor ${i}`, part_no: `FILL-${i}`, description: 'Padding row so the grid scrolls', notes: 'x'.repeat(40) });
t('three POs and seventy more are filed', !!p1?.id && !!p2?.id && !!p3?.id);
let r = await J(await A('PUT', `/procurement/pos/${p1.id}`, { source_status: 'Working on it' }));
t('board status is editable on one PO', r?.source_status === 'Working on it', JSON.stringify(r?.source_status));
let res = await A('PUT', `/procurement/pos/${p1.id}`, { status: 'recieved' });
t('an unknown status is REFUSED by name, not dropped silently', res.status === 400 && /Status must be one of/.test((await J(res))?.error || ''));
res = await A('PUT', `/procurement/pos/${p1.id}`, { vendor: '  ' });
t('a blank vendor is refused', res.status === 400);

console.log('\n── mass edit: any field on a selection ──');
r = await J(await A('PUT', '/procurement/pos/bulk', { ids: [p1.id, p2.id], patch: { customer: 'M4 Dynamic', lead_time_days: '21', source_status: 'Stuck', notes: 'Chase Friday' } }));
t('four fields set on two POs in one act', r?.updated === 2, JSON.stringify(r));
const rows = await J(await A('GET', '/procurement/pos'));
const byId = Object.fromEntries((rows || []).map((x) => [x.id, x]));
t('both carry every value', [p1, p2].every((p) => byId[p.id]?.customer === 'M4 Dynamic' && byId[p.id]?.lead_time_days === 21
  && byId[p.id]?.source_status === 'Stuck' && byId[p.id]?.notes === 'Chase Friday'));
t('the unselected PO is untouched', byId[p3.id]?.customer == null && byId[p3.id]?.source_status == null);
res = await A('PUT', '/procurement/pos/bulk', { ids: [p1.id, p2.id], patch: { status: 'shipped', quarter: 'next year' } });
t('a refused value refuses the whole batch, before anything is written', res.status === 400
  && (await J(await A('GET', '/procurement/pos'))).find((x) => x.id === p1.id)?.status === 'open');
res = await A('PUT', '/procurement/pos/bulk', { ids: [p1.id], patch: { created_by: 'me' } });
t('a field that is not a PO field is refused by name', res.status === 400 && /not a purchase-order field/.test((await J(res))?.error || ''));
await A('PUT', '/procurement/pos/bulk', { ids: [p3.id], patch: { status: 'received' } });
t('marking received in bulk fills the received date, as one edit does', !!(await J(await A('GET', '/procurement/pos'))).find((x) => x.id === p3.id)?.received_date);

console.log('\n── in the browser: Procurement → Purchase Orders ──');
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.goto(`${URL}/manifest.webmanifest`);
  await page.evaluate(([tk, u]) => { localStorage.setItem('auth_token', tk); localStorage.setItem('auth_user', JSON.stringify(u)); }, [me.token, me.user]);
  await page.goto(`${URL}/?tab=procurement`);
  const search = page.locator('[data-grid-search]').first();
  await search.waitFor({ timeout: 15000 });
  const countText = async () => (await page.locator('text=/\\d[\\d,]* of [\\d,]+/').first().innerText());
  await search.fill('acme widget-2');
  await page.waitForTimeout(200);
  t('two words narrow the list to the row carrying both', /^1 of /.test(await countText()), await countText());
  await search.fill('"pouch film" acme');
  await page.waitForTimeout(200);
  t('a quoted phrase is matched whole', /^1 of /.test(await countText()), await countText());
  await search.fill('acme nothing-like-this');
  await page.waitForTimeout(200);
  t('a word no row carries empties the list (every word must match)', /^0 of /.test(await countText()), await countText());
  await search.fill('');
  await page.waitForTimeout(200);

  const box = page.locator('[data-grid-scroll]').first();
  // D-149: with the page NOT scrolled — the D-143 version of this check scrolled
  // the page down to the grid first, which is how it passed while Jake could
  // not see a scrollbar.
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(300);
  const geo = await box.evaluate((el) => ({ bottom: el.getBoundingClientRect().bottom, vh: window.innerHeight, pageY: window.scrollY,
    scrolls: el.scrollHeight > el.clientHeight, wide: el.scrollWidth > el.clientWidth }));
  t('the table scrolls inside a box that ends on screen with the page at the top — its horizontal scrollbar is in view, not under the last row',
    geo.scrolls && geo.pageY === 0 && geo.bottom <= geo.vh + 1, JSON.stringify(geo));
  const pinned = await box.evaluate((el) => { el.scrollTop = 600; const h = el.querySelector('thead'); return Math.abs(h.getBoundingClientRect().top - el.getBoundingClientRect().top); });
  t('the header row stays pinned while the rows scroll', pinned <= 2, String(pinned));
  await box.evaluate((el) => { el.scrollTop = 0; });

  await search.fill('PO-GRID-2');
  await page.waitForTimeout(200);
  const rowEl = page.locator('[data-grid-scroll] tbody tr').first();
  const boardCell = rowEl.locator('td').filter({ hasText: 'Stuck' }).first();
  await boardCell.dblclick();
  await page.locator('[data-cell-input="source_status"]:visible').fill('Delivered to dock');
  await page.locator('[data-cell-input="source_status"]:visible').press('Enter');
  await page.waitForTimeout(500);
  t('board status edits in the grid', (await J(await A('GET', '/procurement/pos'))).find((x) => x.id === p2.id)?.source_status === 'Delivered to dock');
  const statusCell = rowEl.locator('td').filter({ hasText: /^open$/ }).first();
  await statusCell.dblclick();
  const sel = page.locator('[data-cell-select="status"]:visible');
  t('status edits as a list of the real statuses, not a text box', await sel.count() === 1);
  await sel.selectOption('confirmed');
  await page.waitForTimeout(500);
  t('picking one saves it', (await J(await A('GET', '/procurement/pos'))).find((x) => x.id === p2.id)?.status === 'confirmed');

  await search.fill('acme');
  await page.waitForTimeout(200);
  await page.locator('[data-grid-scroll] thead input[type=checkbox]').check();
  await page.locator('[data-bulk-field-key]').selectOption('bol');
  await page.locator('[data-bulk-field-value]').fill('BOL-7781');
  await page.locator('[data-bulk-field-apply]').click();
  await page.waitForTimeout(600);
  const after = await J(await A('GET', '/procurement/pos'));
  t('Set a field → BOL → Apply sets it on every selected row, and only those', [p1, p2].every((p) => after.find((x) => x.id === p.id)?.bol === 'BOL-7781')
    && after.find((x) => x.id === p3.id)?.bol == null);
} catch (e) { t('the Purchase Orders grid rendered', false, e.message); }
finally { await browser.close(); }

console.log(`\n${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
