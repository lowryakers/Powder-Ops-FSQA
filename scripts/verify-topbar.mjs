// verify:topbar — D-253, live and in a real browser. Marnee resized ReadyDoc with
// Messages docked and the top bar's pieces ran into each other: the bar used WINDOW
// breakpoints, so a 600px module column in a wide window still asked for the full
// search box, the Split Screen label and the account name. The bar now sizes each
// piece off its own width (`@container`). Asserted at every width that matters,
// docked and not: the bar stays one row, nothing overlaps, nothing runs past its
// right edge, the page never pans sideways, and the long name only shows when it
// fits. The docked Messages panel's own top bar is checked the same way inside its
// iframe at the narrowest and widest dock.
//
// Caller sets PORT + DBPATH (the server is already up). Needs a built client.
// The control is `main` before D-253: at 1440 with a 760px dock the account name
// and the full search box are both on screen and the bar's controls overlap.
import Database from 'better-sqlite3';
import { chromium } from 'playwright-core';

const PORT = Number(process.env.PORT || 5146);
const URL = `http://localhost:${PORT}`;
const B = `${URL}/api`;
let pass = 0, fail = 0;
const t = (n, ok, d = '') => { if (ok) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n}${d ? ' — ' + d : ''}`); } };
const J = async (r) => { try { return await r.json(); } catch { return null; } };

const NAME = 'Marnee Dortch-Valenzuela';
const db = new Database(process.env.DBPATH);
db.prepare(`INSERT OR REPLACE INTO users (id,name,username,role,department,is_active,setup_code,setup_code_expires_at)
  VALUES ('tb-admin',?,'tb-admin','admin','office',1,'SC-tb',datetime('now','+7 day'))`).run(NAME);
db.close();
const c = (m, p, b, tk) => fetch(B + p, { method: m, headers: { 'Content-Type': 'application/json', ...(tk ? { Authorization: `Bearer ${tk}` } : {}) }, body: b ? JSON.stringify(b) : undefined });
await c('POST', '/users/set-password', { user_id: 'tb-admin', password: 'Passw0rd!!', setup_code: 'SC-tb' });
const me = await J(await c('POST', '/users/login', { name: 'tb-admin', password: 'Passw0rd!!' }));
t('an admin with a long name signs in', !!me?.token);

// Measures one bar: its height, whether any visible control overlaps the next or
// runs past the bar, and what is showing.
const measure = (sel) => (selector) => {
  const bar = document.querySelector(selector);
  if (!bar) return null;
  const row = bar.querySelector(':scope > div') || bar;
  const rb = bar.getBoundingClientRect();
  const visible = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.display !== 'none' && cs.visibility !== 'hidden'; };
  // Leaf-ish controls: buttons, inputs, headings, the search box.
  const items = [...row.querySelectorAll('button, input, h1, kbd, [data-topbar-name]')].filter(visible)
    .filter(el => !el.closest('[role="dialog"], .fixed'))
    .map(el => ({ el, r: el.getBoundingClientRect() }));
  // Only compare siblings that are not nested in one another.
  const tops = items.filter(a => !items.some(b => b !== a && b.el.contains(a.el)));
  let overlaps = [];
  for (let i = 0; i < tops.length; i++) for (let j = i + 1; j < tops.length; j++) {
    const a = tops[i].r, b = tops[j].r;
    const w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
    const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
    if (w > 1 && h > 1) overlaps.push(`${tops[i].el.tagName}${tops[i].el.textContent.trim().slice(0, 15)}×${tops[j].el.tagName}${tops[j].el.textContent.trim().slice(0, 15)}`);
  }
  const past = tops.filter(x => x.r.right > rb.right + 1 || x.r.left < rb.left - 1).map(x => x.el.tagName + x.el.textContent.trim().slice(0, 15));
  const title = row.querySelector('h1');
  const lineH = title ? parseFloat(getComputedStyle(title).lineHeight) || 20 : 20;
  const name = row.querySelector('[data-topbar-name]');
  return {
    height: Math.round(rb.height), overlaps, past,
    titleOneLine: title ? title.getBoundingClientRect().height <= lineH + 2 : true,
    nameShown: !!name && visible(name),
    nameOneLine: !name || !visible(name) || name.getBoundingClientRect().height <= 24,
    fullSearch: !!row.querySelector('[data-topbar-search="full"]') && visible(row.querySelector('[data-topbar-search="full"]')),
    splitLabel: [...row.querySelectorAll('[data-topbar-split] span')].some(visible),
    pagePans: document.documentElement.scrollWidth > window.innerWidth + 1,
    // What sticks out, for the failure message: elements past the window's right
    // edge that are not inside a deliberate horizontal scroller.
    wide: document.documentElement.scrollWidth > window.innerWidth + 1
      ? [...document.querySelectorAll('body *')].filter(el => {
          const r = el.getBoundingClientRect();
          if (r.right <= window.innerWidth + 1 || r.width === 0) return false;
          for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) { const o = getComputedStyle(p).overflowX; if (o === "auto" || o === "scroll") return false; }
          return true;
        }).slice(-4).map(el => `${el.tagName}.${String(el.className).slice(0, 60)} r=${Math.round(el.getBoundingClientRect().right)}`).join(' | ')
      : `scrollWidth ${document.documentElement.scrollWidth}`,
  };
};

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const CASES = [
  // [window width, dock width or 0, expect name, expect full search]
  [1600, 0, true, true],
  [1440, 760, false, false],
  [1600, 420, false, true],   // 1440 docked sits on the edge once the scrollbar gutter is reserved (D-255)
  [1280, 760, false, false],
  [1280, 420, false, false],
  [1100, 420, false, false],
  [1024, 0, false, true],
  [900, 0, false, false],
  [768, 0, false, false],
];
try {
  for (const [vw, dock, wantName, wantSearch] of CASES) {
    const label = `${vw}px${dock ? `, Messages docked at ${dock}px` : ''}`;
    console.log(`\n── ${label} ──`);
    const ctx = await browser.newContext({ viewport: { width: vw, height: 800 } });
    const page = await ctx.newPage();
    await page.goto(`${URL}/manifest.webmanifest`);
    await page.evaluate(([tk, u, d]) => {
      localStorage.setItem('auth_token', tk); localStorage.setItem('auth_user', JSON.stringify(u));
      localStorage.setItem('dock_chat', d ? '1' : '0'); if (d) localStorage.setItem('dock_chat_w', String(d));
    }, [me.token, me.user, dock]);
    await page.goto(`${URL}/?tab=settings`);
    await page.locator('[data-topbar]').waitFor({ timeout: 15000 });
    await page.waitForTimeout(600);
    const m = await page.evaluate(measure(), '[data-topbar]');
    t(`${label}: the bar is one row`, m.height <= 60 && m.titleOneLine, `height ${m.height}`);
    t(`${label}: no control overlaps another`, m.overlaps.length === 0, m.overlaps.join(', '));
    t(`${label}: nothing runs past the bar`, m.past.length === 0, m.past.join(', '));
    t(`${label}: the page does not pan sideways`, !m.pagePans, m.wide);
    t(`${label}: the name ${wantName ? 'shows on one line' : 'is left to the avatar'}`, m.nameShown === wantName && m.nameOneLine);
    t(`${label}: search is the ${wantSearch ? 'full box' : 'icon'}`, m.fullSearch === wantSearch);
    if (dock) {
      const room = Math.max(320, Math.min(760, vw - 240 - 560));
      const shown = await page.evaluate(() => Math.round(document.querySelector('[data-dock-panel]').getBoundingClientRect().width));
      t(`${label}: the dock is drawn at ${Math.min(dock, room)}px, leaving the module its room`, Math.abs(shown - Math.min(dock, room)) <= 1, `drawn ${shown}`);
      const frame = page.frameLocator('iframe[title="Messages"]');
      await frame.locator('[data-comms-topbar]').waitFor({ timeout: 15000 });
      await page.waitForTimeout(400);
      const f = page.frames().find(fr => fr.url().endsWith('/chat'));
      const cm = await f.evaluate(measure(), '[data-comms-topbar]');
      t(`${label}: the docked Messages bar has no overlap and nothing past its edge`, cm.overlaps.length === 0 && cm.past.length === 0 && !cm.pagePans,
        `${cm.overlaps.join(', ')} | ${cm.past.join(', ')}`);
    }
    if (vw === 1600) {
      const btn = page.locator('[data-topbar] button[data-tip="Settings"]');
      const before = await btn.evaluate(el => getComputedStyle(el, '::after').content);
      await btn.hover(); await page.waitForTimeout(200);
      const after = await btn.evaluate(el => getComputedStyle(el, '::after').content);
      t('a tooltip has no box until hovered, and shows its words on hover', (before === 'none' || before === 'normal') && after === '"Settings"', `${before} → ${after}`);
    }
    await ctx.close();
  }
} finally { await browser.close(); }
console.log(`\n${pass}/${pass + fail} assertions passed`);
process.exit(fail ? 1 : 0);
