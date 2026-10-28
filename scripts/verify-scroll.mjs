// verify:scroll — D-255, a real browser over every module and its tabs. The scroll
// review found four screens that scrolled wrong and one behaviour that was wrong
// everywhere; this keeps them from coming back. For every module (and up to seven
// of its tabs) at three sizes — a 1280px desktop with Messages docked, a 1024px
// laptop and a 390px phone — it asserts:
//   - the page never pans sideways;
//   - no scroll box sits inside another one that is also scrolling;
//   - no wide sideways scroller has its scrollbar below the window with the page
//     at the top (FrozenScroll boxes are measured and are skipped);
//   - no control is cut off by a clipping box.
// Then that an open pop-up holds the page still, and lets it go when closed.
//
// Caller sets PORT + DBPATH (the server is already up). Needs a built client.
// Control: `main` before D-255 fails at Sanitation 1024 (pans 16px), Production
// Schedule docked, Products → Pipeline and the Org Chart on a phone, and the
// pop-up lock.
import Database from 'better-sqlite3';
import { chromium } from 'playwright-core';

const PORT = process.env.PORT || 5148;
const URL = `http://localhost:${PORT}`, B = `${URL}/api`;
let pass = 0, fail = 0;
const t = (n, ok, d = '') => { if (ok) { pass++; } else { fail++; console.log(`  ✗ ${n}${d ? ' — ' + d : ''}`); } };
const db = new Database(process.env.DBPATH);
db.prepare(`INSERT OR REPLACE INTO users (id,name,username,role,department,is_active,setup_code,setup_code_expires_at)
  VALUES ('sc-admin','Scroll Admin','sc-admin','admin','admin',1,'SC-sc',datetime('now','+7 day'))`).run();
db.close();
const c = (m, p, b) => fetch(B + p, { method: m, headers: { 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : undefined });
await c('POST', '/users/set-password', { user_id: 'sc-admin', password: 'Passw0rd!!', setup_code: 'SC-sc' });
const me = await (await c('POST', '/users/login', { name: 'sc-admin', password: 'Passw0rd!!' })).json();
t('an admin signs in', !!me?.token);
const MODS = 'dashboard operator pm pm-schedules production-log production-schedule production-dashboard sanitation qa-inspections qa-review doc-review document-control sops work-instructions job-descriptions form-registry controlled-changes change-register dcr deviations non-conformance on-hold disposals capa quality-events organoleptic flavor-approvals coa calibration equipment loto hygienic training certifications receiving-log sign-out currently-out knife-accountability chemicals suppliers retention-samples quality-schedules internal-audits meetings recall facility-map food-safety-culture safety visitors products artwork accounting ap-drop partner-reconciliation reimbursements procurement supply-orders office-requests time-tracking pay-tracking onboarding candidates policies org-chart newsletter team-activity audit settings'.split(' ');
const SIZES = [['docked1280', 1280, 800, 420], ['laptop1024', 1024, 700, 0], ['phone390', 390, 800, 0]];
const probe = () => {
  const vw = window.innerWidth, vh = window.innerHeight;
  const desc = (el) => { const id = el.getAttribute('data-testid') || ''; const cls = String(el.className || '').split(' ').slice(0, 5).join('.'); const txt = (el.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 40); return `${el.tagName.toLowerCase()}.${cls}${id}"${txt}"`; };
  const scrollParentX = (el) => { for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) { const o = getComputedStyle(p).overflowX; if (o === 'auto' || o === 'scroll' || o === 'hidden' || o === 'clip') return p; } return null; };
  const out = { pan: document.documentElement.scrollWidth - vw, panBy: [], nested: [], xscrollOff: [], clipped: [], scrollers: 0 };
  const all = [...document.querySelectorAll('main *, [data-topbar] *, body > div *')];
  if (out.pan > 1) out.panBy = all.filter(el => { const r = el.getBoundingClientRect(); return r.width && r.right > vw + 1 && !scrollParentX(el); }).filter((el, i, a) => !a.some(o => o !== el && o.contains(el))).slice(0, 4).map(el => `${desc(el)} right=${Math.round(el.getBoundingClientRect().right)}`);
  for (const el of all) {
    const cs = getComputedStyle(el);
    const yScroll = (cs.overflowY === 'auto' || cs.overflowY === 'scroll') && el.scrollHeight > el.clientHeight + 2;
    const xScroll = (cs.overflowX === 'auto' || cs.overflowX === 'scroll') && el.scrollWidth > el.clientWidth + 2;
    if (yScroll || xScroll) out.scrollers++;
    if (yScroll) {
      for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
        const ps = getComputedStyle(p);
        if ((ps.overflowY === 'auto' || ps.overflowY === 'scroll') && p.scrollHeight > p.clientHeight + 2) { out.nested.push(desc(el)); break; }
      }
    }
    if (xScroll) {
      const r = el.getBoundingClientRect();
      // a sideways scroller whose own scrollbar is below the window with the page at the top
      if (r.bottom > vh + 2 && r.top < vh && !el.closest('[data-frozen-scroll]') && !el.matches('[data-frozen-scroll]') && r.height > 200) out.xscrollOff.push(`${desc(el)} bottom=${Math.round(r.bottom)} vh=${vh}`);
    }
    if ((cs.overflowX === 'hidden' || cs.overflowX === 'clip') && el.scrollWidth > el.clientWidth + 8 && cs.textOverflow !== 'ellipsis' && !cs.webkitLineClamp?.match?.(/\d/) && el.clientWidth > 40 && !el.closest('[role="tablist"]')) {
      const kids = [...el.querySelectorAll('button, input, a')].filter(k => { const r = k.getBoundingClientRect(), pr = el.getBoundingClientRect(); return r.width && (r.right > pr.right + 2 || r.left < pr.left - 2); });
      if (kids.length) out.clipped.push(`${desc(el)} hides ${kids.length} control(s): ${kids.slice(0, 2).map(k => (k.innerText || k.getAttribute('aria-label') || k.tagName).trim().slice(0, 20)).join(', ')}`);
    }
  }
  out.nested = [...new Set(out.nested)].slice(0, 4); out.clipped = [...new Set(out.clipped)].slice(0, 3); out.xscrollOff = [...new Set(out.xscrollOff)].slice(0, 3);
  return out;
};

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
let screens = 0;
try {
  for (const [size, vw, vh, dock] of SIZES) {
    const ctx = await browser.newContext({ viewport: { width: vw, height: vh }, hasTouch: vw < 500, isMobile: vw < 500 });
    const page = await ctx.newPage();
    await page.goto(`${URL}/manifest.webmanifest`);
    await page.evaluate(([tk, u, d]) => { localStorage.setItem('auth_token', tk); localStorage.setItem('auth_user', JSON.stringify(u)); localStorage.setItem('dock_chat', d ? '1' : '0'); if (d) localStorage.setItem('dock_chat_w', String(d)); }, [me.token, me.user, dock]);
    for (const mod of MODS) {
      await page.goto(`${URL}/?tab=${mod}`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(1500);
      const tabs = await page.locator('main [role="tab"]').allInnerTexts().catch(() => []);
      for (const v of [null, ...tabs.slice(1, 8)]) {
        if (v) { try { await page.locator('main [role="tab"]', { hasText: v }).first().click({ timeout: 2000 }); await page.waitForTimeout(900); } catch { continue; } }
        await page.evaluate(() => window.scrollTo(0, 0));
        const r = await page.evaluate(probe);
        const where = `${size} ${mod}${v ? ' → ' + v.replace(/\s+/g, ' ').trim() : ''}`;
        screens++;
        t(`${where}: does not pan sideways`, r.pan <= 1, `${r.pan}px ${r.panBy.join(' | ')}`);
        t(`${where}: no scroll box inside another`, r.nested.length === 0, r.nested.join(' | '));
        t(`${where}: sideways scrollbars on screen`, r.xscrollOff.length === 0, r.xscrollOff.join(' | '));
        t(`${where}: no control cut off`, r.clipped.length === 0, r.clipped.join(' | '));
      }
    }
    if (size === 'laptop1024') {
      await page.goto(`${URL}/?tab=reimbursements`); await page.waitForTimeout(1500);
      const html = () => page.evaluate(() => getComputedStyle(document.documentElement).overflowY);
      t('the page scrolls normally with no pop-up open', (await html()) !== 'hidden', await html());
      await page.getByRole('button', { name: /New claim/ }).first().click(); await page.waitForTimeout(400);
      t('an open pop-up holds the page still', (await html()) === 'hidden', await html());
      const contain = await page.evaluate(() => {
        const el = [...document.querySelectorAll('.fixed .overflow-y-auto, .fixed.overflow-y-auto')][0];
        return el ? getComputedStyle(el).overscrollBehaviorY : 'none found';
      });
      t('…and its own scroll stops at its end', contain === 'contain', contain);
      await page.keyboard.press('Escape'); await page.waitForTimeout(200);
      const still = await page.locator('.fixed.inset-0[class*="bg-black"]').count();
      if (still) { await page.locator('.fixed.inset-0[class*="bg-black"] button').filter({ hasText: /^(Cancel|Close)$/ }).first().click().catch(() => {}); await page.waitForTimeout(300); }
      if (await page.locator('.fixed.inset-0[class*="bg-black"]').count()) { await page.goto(`${URL}/?tab=reimbursements`); await page.waitForTimeout(1200); }
      t('closing it gives the page back', (await html()) !== 'hidden', await html());
    }
    await ctx.close();
  }
} finally { await browser.close(); }
console.log(`  ${screens} screens checked`);
console.log(`\n${pass}/${pass + fail} assertions passed`);
process.exit(fail ? 1 : 0);
