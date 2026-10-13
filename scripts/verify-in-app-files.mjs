// verify:inappfiles — a stored PDF opens INSIDE ReadyDoc, not in a browser tab (D-168).
//
// The in-app viewer existed and five screens used it; about twenty others opened
// the same files with window.open(url, '_blank') or a plain <a target="_blank">,
// so whether a PDF opened in the app depended on the screen. What this proves:
//   1. A screen that fetches a signed url and opens it (People → a résumé) shows
//      the in-app viewer, framing the signed url with the viewer hints, and NO
//      new tab opens.
//   2. An ordinary <a target="_blank"> to a PDF on this site opens in the app too
//      — caught once, app-wide, so a screen does not have to remember.
//   3. The way out still works: Ctrl-click opens a tab; a link to somebody
//      else's site, or to a file that is not a PDF or an image, still opens a tab.
//   4. On a phone the PDF is handed to the phone's own viewer (a card with Open),
//      never a frame a phone cannot pinch.
//
// Caller sets PORT + DBPATH + the R2_* stand-in env. Needs a fresh database.
const PORT = process.env.PORT || 5095;
const B = `http://localhost:${PORT}/api`;
const J = async r => { try { return await r.json(); } catch { return null; } };
let pass = 0, fail = 0;
const t = (n, c, d = '') => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (d ? ' — ' + d : '')); } };
let tok = null;
const req = (p, o = {}) => fetch(B + p, { ...o, headers: { 'Content-Type': 'application/json', ...(tok ? { Authorization: `Bearer ${tok}` } : {}), ...(o.headers || {}) } });

const { default: Database } = await import('better-sqlite3');
{
  const db = new Database(process.env.DBPATH || process.env.DB_PATH);
  db.prepare(`INSERT OR REPLACE INTO users (id,name,username,role,department,is_active,setup_code,setup_code_expires_at)
    VALUES ('if-admin','Files Admin','Files Admin','admin','office',1,'SC-IF',datetime('now','+7 day'))`).run();
  db.close();
}
await req('/users/set-password', { method: 'POST', body: JSON.stringify({ user_id: 'if-admin', password: 'FilesPW2026!', setup_code: 'SC-IF' }) });
tok = (await J(await req('/users/login', { method: 'POST', body: JSON.stringify({ name: 'Files Admin', password: 'FilesPW2026!' }) })))?.token;
t('the office signed in', !!tok);

const cand = await J(await req('/candidates', { method: 'POST', body: JSON.stringify({ name: 'Viewer Testperson' }) }));
const fd = new FormData();
fd.append('files', new Blob(['%PDF-1.4\n% resume\n'], { type: 'application/pdf' }), 'Viewer Resume.pdf');
const up = await J(await fetch(`${B}/candidates/${cand.id}/files`, { method: 'POST', headers: { Authorization: `Bearer ${tok}` }, body: fd }));
t('a PDF is on file against the person', up?.files?.length === 1, JSON.stringify(up));

const { chromium } = await import('playwright-core');
const URL = `http://localhost:${PORT}`;
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });

async function session(viewport) {
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage();
  page.on('pageerror', e => { console.log('  [pageerror]', e.message); fail++; });
  const popups = [];
  ctx.on('page', p => { if (p !== page) popups.push(p.url()); });
  await page.goto(`${URL}/manifest.webmanifest`);
  await page.evaluate(([tk, u]) => { localStorage.setItem('auth_token', tk); localStorage.setItem('auth_user', JSON.stringify(u)); },
    [tok, { id: 'if-admin', name: 'Files Admin', role: 'admin', department: 'office' }]);
  await page.goto(`${URL}/?tab=candidates`);
  return { ctx, page, popups };
}
const settle = (page) => page.waitForTimeout(700);

console.log('\n── a screen that fetches a url, at 1280 ──');
{
  const { ctx, page, popups } = await session({ width: 1280, height: 850 });
  const btn = page.getByRole('button', { name: 'Viewer Resume.pdf' });
  const ok = await btn.waitFor({ timeout: 20000 }).then(() => true).catch(() => false);
  t('People shows the résumé', ok);
  if (ok) {
    await btn.click();
    const shown = await page.locator('[data-file-preview]').waitFor({ timeout: 5000 }).then(() => true).catch(() => false);
    await settle(page);
    t('THE RÉSUMÉ OPENS IN THE APP', shown);
    t('…and no browser tab opened', popups.length === 0, popups.join(', '));
    const src = shown ? await page.locator('[data-file-frame]').getAttribute('src') : '';
    t('the frame holds the signed url', /X-Amz-Signature/.test(src || ''), (src || '').slice(0, 80));
    t('…with the viewer hints (no thumbnail pane, fit width)', /#navpanes=0&pagemode=none&view=FitH$/.test(src || ''));
    t('the viewer names the file', shown && (await page.locator('[data-file-preview]').innerText()).includes('Viewer Resume.pdf'));
    await page.keyboard.press('Escape');
    t('Esc closes it', await page.locator('[data-file-preview]').count() === 0);
  }

  console.log('\n── an ordinary link, caught app-wide ──');
  await page.evaluate(() => {
    const add = (id, href, text) => { const a = document.createElement('a'); a.id = id; a.href = href; a.target = '_blank'; a.textContent = text; a.style.cssText = 'position:fixed;left:8px;z-index:60;background:#fff'; a.style.top = `${8 + document.querySelectorAll('a[id^=t-]').length * 24}px`; document.body.appendChild(a); };
    add('t-form', '/forms/FORM-431-01-V5-Brittle-Plastic-and-Glass-Diagram.pdf', 'diagram');
    add('t-ext', 'https://example.invalid/sds/sheet.pdf', 'vendor sheet');
    add('t-doc', '/forms/policy.docx', 'word file');
  });
  await page.click('#t-form');
  const linkShown = await page.locator('[data-file-preview]').waitFor({ timeout: 5000 }).then(() => true).catch(() => false);
  await settle(page);
  t('A <a target="_blank"> TO A PDF ON THIS SITE OPENS IN THE APP', linkShown);
  t('…named from the address', linkShown && (await page.locator('[data-file-preview]').innerText()).includes('FORM-431-01-V5'));
  t('…and no tab opened', popups.length === 0, popups.join(', '));
  if (linkShown) await page.keyboard.press('Escape');

  await page.click('#t-form', { modifiers: ['Control'] });
  await settle(page);
  t('Ctrl-click still opens a tab, and not the viewer', popups.length === 1 && await page.locator('[data-file-preview]').count() === 0, popups.join(', '));

  await page.click('#t-ext');
  await settle(page);
  t('a PDF on somebody else\'s site still opens a tab — it may refuse a frame', popups.length === 2 && await page.locator('[data-file-preview]').count() === 0);
  await page.click('#t-doc');
  await settle(page);
  t('a Word file still opens a tab — there is nothing to frame', popups.length === 3 && await page.locator('[data-file-preview]').count() === 0);

  // The viewer's own "Open in browser tab" is the deliberate way out.
  await page.click('#t-form');
  const again = await page.locator('[data-file-preview]').waitFor({ timeout: 5000 }).then(() => true).catch(() => false);
  if (again) { await page.locator('[data-file-preview] a[data-new-tab]').first().click(); await settle(page); }
  t('the viewer\'s "Open in browser tab" opens a tab', again && popups.length === 4, popups.join(', '));
  await ctx.close();
}

console.log('\n── on a phone, 390 ──');
{
  const { ctx, page, popups } = await session({ width: 390, height: 800 });
  const btn = page.getByRole('button', { name: 'Viewer Resume.pdf' });
  const ok = await btn.waitFor({ timeout: 20000 }).then(() => true).catch(() => false);
  if (ok) {
    await btn.click();
    const card = await page.locator('[data-file-preview] [data-pdf-card]').waitFor({ timeout: 5000 }).then(() => true).catch(() => false);
    await settle(page);
    t('ON A PHONE THE PDF IS A CARD THAT HANDS IT TO THE PHONE\'S VIEWER', card);
    t('…not a frame a phone cannot pinch', await page.locator('[data-file-frame]').count() === 0);
    t('…and nothing opened until it is tapped', popups.length === 0);
    if (card) {
      await page.locator('[data-pdf-card] a').click();
      await settle(page);
      t('tapping Open hands it over', popups.length === 1 && /X-Amz-Signature/.test(popups[0] || ''));
    }
    const over = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    t('no sideways scroll at 390', !over);
  } else t('People shows the résumé at 390', false);
  await ctx.close();
}

await browser.close();
console.log(`\n${pass}/${pass + fail} assertions passed`);
process.exit(fail ? 1 : 0);
