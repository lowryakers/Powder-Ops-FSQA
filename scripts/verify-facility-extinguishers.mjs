// verify:extinguishers — D-152, pure + live on a fresh database + a real browser.
//
// "Have a guy inspecting our fire extinguishers right now and thought it'd be
// convenient to be able to share locations within that facility map. Just a
// simple way to export/copy then paste." The map drew eight orange marks and
// said nothing about them: no number, no words, nothing to paste. This asserts
// the list is derived from the drawing, numbered the same as the marks, copies
// as plain text, follows a room renamed in the app, and that the picture saves.
//
// Caller sets PORT + DBPATH (the server is already up). Needs a built client.
// The control is `main`: no list, no numbers, no copy.
import Database from 'better-sqlite3';
import { chromium } from 'playwright-core';

const PORT = Number(process.env.PORT || 5068);
const URL = `http://localhost:${PORT}`;
const B = `${URL}/api`;
let pass = 0, fail = 0;
const t = (n, ok, d = '') => { if (ok) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n}${d ? ' — ' + d : ''}`); } };
const J = async (r) => { try { return await r.json(); } catch { return null; } };

console.log('── the list is derived from the drawing ──');
const lib = await import('../src/lib/fixtureLocations.js').catch(() => null);
const { ROOMS, FIXTURES, PLAN } = await import('../src/data/facilityMap.js');
t('the location module exists', !!lib);
let list = [];
if (lib) {
  list = lib.fixtureLocations('extinguisher', { rooms: ROOMS, fixtures: FIXTURES, plan: PLAN });
  t('one entry per extinguisher on the drawing, numbered 1…n in drawing order',
    list.length === FIXTURES.filter(f => f.type === 'extinguisher').length && list.every((l, i) => l.n === i + 1), JSON.stringify(list.map(l => l.n)));
  t('every entry names a place in words', list.every(l => l.text && l.area), JSON.stringify(list.map(l => l.text)));
  t('a mark inside a space reads "in <space>"', list[1].text.startsWith('in Break Room'), list[1].text);
  t('a mark on open floor near a space reads "beside", not "in"', list[2].text.startsWith('beside Room 3'), list[2].text);
  t('a mark far from any space says "nearest", never "beside"', list[7].relation === 'nearest', list[7].text);
  t('every line also says where in the building it is', list[0].area === 'north-west corner' && list[7].area === 'north-east corner', `${list[0].area} / ${list[7].area}`);
  const renamed = lib.fixtureLocations('extinguisher', { rooms: ROOMS, fixtures: FIXTURES, plan: PLAN, nameOf: r => r.id === 'break-room' ? 'Lunch Room' : r.label });
  t('a room renamed in the app renames the line', renamed[1].text.startsWith('in Lunch Room'), renamed[1].text);
  const text = lib.locationsText('Fire extinguisher', list);
  t('the copied text is a count line, one numbered line each, and the caveat',
    text.split('\n').length === list.length + 2 && /^Fire extinguisher locations — 8/.test(text) && /\n1\. In Sinks/.test(text) && /approximate/.test(text), text);
}

const db = new Database(process.env.DBPATH);
db.prepare(`INSERT OR REPLACE INTO users (id,name,username,role,department,is_active,setup_code,setup_code_expires_at)
  VALUES ('fx-admin','Extinguisher Admin','Extinguisher Admin','admin','admin',1,'SC-fx',datetime('now','+7 day'))`).run();
db.close();
const c = (m, p, b, tk) => fetch(B + p, { method: m, headers: { 'Content-Type': 'application/json', ...(tk ? { Authorization: `Bearer ${tk}` } : {}) }, body: b ? JSON.stringify(b) : undefined });
await c('POST', '/users/set-password', { user_id: 'fx-admin', password: 'Passw0rd!!', setup_code: 'SC-fx' });
const me = await J(await c('POST', '/users/login', { name: 'Extinguisher Admin', password: 'Passw0rd!!' }));
t('an admin signs in', !!me?.token);

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
try {
  for (const [vw, vh] of [[1280, 800], [390, 844]]) {
    console.log(`\n── browser ${vw}×${vh} ──`);
    const ctx = await browser.newContext({ viewport: { width: vw, height: vh }, permissions: ['clipboard-read', 'clipboard-write'], acceptDownloads: true });
    const page = await ctx.newPage();
    await page.goto(`${URL}/manifest.webmanifest`);
    await page.evaluate(([tk, u]) => { localStorage.setItem('auth_token', tk); localStorage.setItem('auth_user', JSON.stringify(u)); }, [me.token, me.user]);
    await page.goto(`${URL}/?tab=facility-map`);
    await page.getByRole('button', { name: 'Sinks & extinguishers' }).click();
    const box = page.locator('[data-extinguisher-list]');
    try { await box.waitFor({ timeout: 10000 }); } catch { t('turning on the layer shows the extinguisher list', false, 'no [data-extinguisher-list]'); await ctx.close(); continue; }
    t('turning on the layer shows the extinguisher list', true);
    t('the list has one row per extinguisher', await page.locator('[data-extinguisher]').count() === 8);
    t('each extinguisher on the map carries its number', await page.locator('svg [data-fixture-number]').count() === 8);
    t('row 6 and mark 6 are the same extinguisher',
      (await page.locator('[data-extinguisher="6"]').innerText()).includes('Shipping & Receiving'));
    await page.locator('[data-copy-extinguishers] button').click();
    await page.waitForTimeout(300);
    const clip = await page.evaluate(() => navigator.clipboard.readText());
    t('Copy list puts the plain-text list on the clipboard', lib && clip === lib.locationsText('Fire extinguisher', list), clip.slice(0, 120));
    await page.locator('[data-copy-extinguisher-link]').click();
    await page.waitForTimeout(300);
    const link = await page.evaluate(() => navigator.clipboard.readText());
    t('Copy link copies the map opened on the extinguishers', link === `${URL}/?tab=facility-map&layer=extinguishers`, link);
    const dl = page.waitForEvent('download', { timeout: 10000 }).catch(() => null);
    await page.locator('[data-save-map-image]').click();
    const d = await dl;
    let size = 0;
    if (d) { const p = await d.path(); size = p ? (await import('node:fs')).statSync(p).size : 0; }
    t('Save map image downloads a PNG of the map', d && d.suggestedFilename() === 'fire-extinguishers.png' && size > 20000, `${d?.suggestedFilename()} ${size} bytes`);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    t('nothing pans the page sideways', !overflow);

    await page.goto(`${URL}/?tab=facility-map&layer=extinguishers`);
    try { await box.waitFor({ timeout: 10000 }); t('the copied link opens straight onto the list', true); }
    catch { t('the copied link opens straight onto the list', false); }
    await ctx.close();
  }

  console.log('\n── a room renamed in the app ──');
  const r = await c('PUT', '/facility/rooms/break-room', { label: 'Lunch Room' }, me.token);
  t('the break room is renamed through the map', r.ok, String(r.status));
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  await page.goto(`${URL}/manifest.webmanifest`);
  await page.evaluate(([tk, u]) => { localStorage.setItem('auth_token', tk); localStorage.setItem('auth_user', JSON.stringify(u)); }, [me.token, me.user]);
  await page.goto(`${URL}/?tab=facility-map&layer=extinguishers`);
  await page.locator('[data-extinguisher="2"]').waitFor({ timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(800);
  const row2 = await page.locator('[data-extinguisher="2"]').innerText().catch(() => '');
  t('the list says the new name', row2.includes('Lunch Room'), row2);
  await ctx.close();
} finally { await browser.close(); }

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
