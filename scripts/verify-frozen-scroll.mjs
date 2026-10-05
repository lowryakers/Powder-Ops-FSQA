// verify:frozenscroll — D-149, live on a fresh database and a real browser.
//
// "Did we also add that it's frozen in place? I'm not seeing that
// functionality." He wasn't: D-143 capped the grid at 100dvh - 11rem, which
// assumed the table started near the top of the page. It starts 250-300px
// down, so its bottom edge — and the horizontal scrollbar — sat below the fold
// until the PAGE was scrolled to it. This asserts the thing he looked for, on
// the PO grid and on the hand-written logs: with the page NOT scrolled, the
// table's box ends on screen, the rows scroll inside it, and the header row
// stays put while they do.
//
// Caller sets PORT + DBPATH (the server is already up). Needs a built client.
// The control is `main`: there is no [data-frozen-scroll] on any log and the
// PO grid's box runs off the bottom of the window.
import Database from 'better-sqlite3';
import { chromium } from 'playwright-core';

const PORT = Number(process.env.PORT || 5063);
const URL = `http://localhost:${PORT}`;
const B = `${URL}/api`;
let pass = 0, fail = 0;
const t = (n, ok, d = '') => { if (ok) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n}${d ? ' — ' + d : ''}`); } };
const J = async (r) => { try { return await r.json(); } catch { return null; } };

const db = new Database(process.env.DBPATH);
db.prepare(`INSERT OR REPLACE INTO users (id,name,username,role,department,is_active,setup_code,setup_code_expires_at)
  VALUES ('fz-admin','Frozen Admin','Frozen Admin','admin','admin',1,'SC-fz',datetime('now','+7 day'))`).run();
db.close();
const c = (m, p, b, tk) => fetch(B + p, { method: m, headers: { 'Content-Type': 'application/json', ...(tk ? { Authorization: `Bearer ${tk}` } : {}) }, body: b ? JSON.stringify(b) : undefined });
await c('POST', '/users/set-password', { user_id: 'fz-admin', password: 'Passw0rd!!', setup_code: 'SC-fz' });
const me = await J(await c('POST', '/users/login', { name: 'Frozen Admin', password: 'Passw0rd!!' }));
t('an admin signs in', !!me?.token);
const A = (m, p, b) => c(m, p, b, me?.token);
for (let i = 0; i < 60; i++) await A('POST', '/procurement/pos', { status: 'open', vendor: `Frozen Vendor ${i}`, part_no: `FZ-${i}`, qty: 1, unit_price: 1, notes: 'x'.repeat(60) });

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const SCREENS = [
  ['Procurement → Purchase Orders (office DataGrid)', 'procurement'],
  ['Equipment register', 'equipment'],
  ['Sanitation log', 'sanitation'],
  ['QA Inspections log', 'qa-inspections'],
  ['Training compliance matrix', 'training&view=matrix'],
  ['Controlled documents', 'document-control'],
];
try {
  for (const [vw, vh] of [[1280, 800], [1024, 700]]) {
    console.log(`\n── ${vw}×${vh}, page not scrolled ──`);
    const ctx = await browser.newContext({ viewport: { width: vw, height: vh } });
    const page = await ctx.newPage();
    await page.goto(`${URL}/manifest.webmanifest`);
    await page.evaluate(([tk, u]) => { localStorage.setItem('auth_token', tk); localStorage.setItem('auth_user', JSON.stringify(u)); }, [me.token, me.user]);
    for (const [label, tab] of SCREENS) {
      await page.goto(`${URL}/?tab=${tab}`);
      const box = page.locator('[data-frozen-scroll]:visible').first();
      try { await box.waitFor({ timeout: 15000 }); } catch { t(`${label}: the table sits in a frozen box`, false, 'no [data-frozen-scroll] on screen'); continue; }
      await page.waitForTimeout(700);           // let the cards above settle
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.waitForTimeout(150);
      const g = await box.evaluate((el) => {
        const r = el.getBoundingClientRect();
        const b = document.querySelector('[data-frozen-scrollbar]');
        const br = b?.getBoundingClientRect();
        return { top: Math.round(r.top), bottom: Math.round(r.bottom), vh: window.innerHeight, capped: !!el.style.maxHeight,
          scrolls: el.scrollHeight > el.clientHeight, wide: el.scrollWidth > el.clientWidth, pageY: window.scrollY,
          bar: br ? { bottom: Math.round(br.bottom), width: Math.round(br.width), left: Math.round(br.left) } : null,
          boxW: el.clientWidth, boxL: Math.round(r.left + el.clientLeft) };
      });
      const fits = g.bottom <= g.vh;
      const below = g.top >= g.vh - 48;          // nothing of the table on screen yet
      t(`${label}: the box is sized to the window it is in`, g.capped, JSON.stringify(g));
      t(`${label}: with the page at the top, the horizontal scrollbar is on screen — ${fits ? 'the box fits' : below ? 'the table starts below the fold, so no copy yet' : 'a copy is pinned to the bottom of the window'}`,
        g.pageY === 0 && (fits || below ? !g.bar : (!g.wide || (g.bar && g.bar.bottom === g.vh && Math.abs(g.bar.width - g.boxW) <= 1 && Math.abs(g.bar.left - g.boxL) <= 1))),
        JSON.stringify(g));
      if (!fits && !below && g.wide) {
        const synced = await page.evaluate(() => {
          const b = document.querySelector('[data-frozen-scrollbar]');
          b.scrollLeft = 150; b.dispatchEvent(new Event('scroll'));
          const el = [...document.querySelectorAll('[data-frozen-scroll]')].find((x) => x.offsetParent);
          const moved = el.scrollLeft; el.scrollLeft = 0; return moved;
        });
        t(`${label}: dragging the pinned copy scrolls the table`, synced === 150, String(synced));
      }
      // One page scroll to bring the box's top to the top of the window: from
      // there the whole box is on screen and it holds.
      const held = await box.evaluate(async (el) => {
        window.scrollBy(0, el.getBoundingClientRect().top - 8);
        await new Promise((r) => setTimeout(r, 250));
        const r = el.getBoundingClientRect();
        return { top: Math.round(r.top), bottom: Math.round(r.bottom), vh: window.innerHeight, bar: !!document.querySelector('[data-frozen-scrollbar]') };
      });
      t(`${label}: scrolled to, the whole box is on screen and the pinned copy steps aside`, held.bottom <= held.vh && !held.bar, JSON.stringify(held));
      await page.evaluate(() => window.scrollTo(0, 0));
      const pin = await box.evaluate((el) => {
        el.scrollTop = 500;
        const th = el.querySelector(':scope > table > thead th');
        const d = th ? Math.abs(th.getBoundingClientRect().top - el.getBoundingClientRect().top) : 999;
        el.scrollTop = 0; return d;
      });
      t(`${label}: the header row stays pinned while the rows scroll`, pin <= 2, String(pin));
    }
    await ctx.close();
  }
  console.log('\n── a phone keeps the page scroll ──');
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  await page.goto(`${URL}/manifest.webmanifest`);
  await page.evaluate(([tk, u]) => { localStorage.setItem('auth_token', tk); localStorage.setItem('auth_user', JSON.stringify(u)); }, [me.token, me.user]);
  await page.goto(`${URL}/?tab=training&view=matrix`);
  const box = page.locator('[data-frozen-scroll]:visible').first();
  await box.waitFor({ timeout: 15000 });
  await page.setViewportSize({ width: 390, height: 800 });
  await page.waitForTimeout(400);
  const mh = await page.locator('[data-frozen-scroll]').first().evaluate((el) => el.style.maxHeight);
  t('at 390px nothing caps the table — no box to trap a thumb in', mh === '', mh);
  const over = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  t('and the page does not pan sideways', !over);
  await ctx.close();
} catch (e) { t('the logs rendered', false, e.message); }
finally { await browser.close(); }

console.log(`\n${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
