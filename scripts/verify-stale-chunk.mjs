// verify:stalechunk — D-153, live on a fresh database + a real browser.
//
// "It loops on a 'ReadyDoc was updated, reload' screen, and reloading brings the
// same screen back" — on /install. Two faults made it permanent: the server
// answered a MISSING build file with the app shell (200, text/html), and the
// service worker stored any 200 under /assets and served it cache-first. One
// chunk requested across a deploy cut-over was then HTML under a .js name on
// that phone for good, and Reload asked the same worker for the same copy.
// This asserts the server 404s, the worker throws away and refuses to store a
// page as a build file, and the boundary's Reload clears the shell caches.
//
// Caller sets PORT (the server is already up). Needs a built client.
// The control is `main`: the missing file is 200 HTML, a poisoned chunk loops.
import { chromium } from 'playwright-core';

const PORT = Number(process.env.PORT || 5070);
const URL = `http://localhost:${PORT}`;
let pass = 0, fail = 0;
const t = (n, ok, d = '') => { if (ok) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n}${d ? ' — ' + d : ''}`); } };

console.log('── the server ──');
const miss = await fetch(`${URL}/assets/InstallPage-NOSUCHHASH.js`);
t('a build file that does not exist is a 404', miss.status === 404, `${miss.status} ${miss.headers.get('content-type')}`);
t('…and is never the app shell', !/text\/html/.test(miss.headers.get('content-type') || ''), miss.headers.get('content-type'));
const shell = await fetch(`${URL}/install`);
t('a page route still gets the app', shell.status === 200 && /text\/html/.test(shell.headers.get('content-type') || ''));
const sw = await (await fetch(`${URL}/sw.js`)).text();
t('the service worker carries a new cache version, so old caches are dropped', !/CACHE_VERSION = 'v8'/.test(sw), sw.match(/CACHE_VERSION = '[^']+'/)?.[0]);

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const RENDERED = 'Get ReadyDoc on your phone';
try {
  console.log('\n── a chunk already poisoned in the worker cache ──');
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  await page.goto(`${URL}/install`);
  await page.getByText(RENDERED).waitFor({ timeout: 15000 });
  await page.evaluate(() => navigator.serviceWorker.ready);
  if (!(await page.evaluate(() => !!navigator.serviceWorker.controller))) { await page.reload(); await page.getByText(RENDERED).waitFor(); }
  t('the page is controlled by the service worker', await page.evaluate(() => !!navigator.serviceWorker.controller));
  const chunk = await page.evaluate(() => performance.getEntriesByType('resource').map(e => e.name).find(n => /\/assets\/InstallPage-[^/]+\.js$/.test(n)));
  t('the install page loads its own chunk', !!chunk, String(chunk));
  // The state a phone was left in: the shell stored under the chunk's name.
  const poisoned = await page.evaluate(async (u) => {
    const name = (await caches.keys()).find(k => k.startsWith('powder-shell'));
    const c = await caches.open(name);
    await c.put(u, new Response('<!doctype html><html><body>app shell</body></html>', { headers: { 'Content-Type': 'text/html; charset=utf-8' } }));
    return name;
  }, chunk);
  t('the chunk is poisoned in the live cache', !!poisoned, String(poisoned));
  await page.reload();
  let ok = false;
  try { await page.getByText(RENDERED).waitFor({ timeout: 10000 }); ok = true; } catch { /* stuck */ }
  const body = (await page.locator('body').innerText()).slice(0, 80).replace(/\n/g, ' | ');
  t('reloading renders the install page, not "ReadyDoc was updated"', ok && !/was updated/.test(body), body);
  const nowCached = await page.evaluate(async ({ u, name }) => {
    const r = await (await caches.open(name)).match(u);
    return r ? r.headers.get('Content-Type') : null;
  }, { u: chunk, name: poisoned });
  t('the worker threw the page away and holds the real file (or nothing)', !nowCached || /javascript/.test(nowCached), String(nowCached));
  await ctx.close();

  console.log('\n── the boundary\'s Reload clears the shell caches ──');
  const ctx2 = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  const p2 = await ctx2.newPage();
  await p2.route(/\/assets\/InstallPage-[^/]+\.js$/, r => r.abort());
  await p2.goto(`${URL}/install`);
  let shown = false;
  try { await p2.getByText('ReadyDoc was updated').waitFor({ timeout: 10000 }); shown = true; } catch { /* no boundary */ }
  t('a chunk that will not load shows the update screen', shown);
  await p2.evaluate(async () => {
    await (await caches.open('powder-shell-stale')).put('/assets/x.js', new Response('x'));
    await (await caches.open('pending-nav')).put('/__pending_nav', new Response('{}'));
  });
  await p2.unroute(/\/assets\/InstallPage-[^/]+\.js$/);
  const btn = p2.locator('[data-reload-fresh]');
  t('the Reload button is the fresh reload', await btn.count() === 1);
  if (await btn.count()) {
    await Promise.all([p2.waitForNavigation(), btn.click()]);
    let back = false;
    try { await p2.getByText(RENDERED).waitFor({ timeout: 10000 }); back = true; } catch { /* still stuck */ }
    t('after Reload the page renders', back);
    const keys = await p2.evaluate(() => caches.keys());
    t('the shell caches were deleted', !keys.some(k => k.startsWith('powder-shell')), JSON.stringify(keys));
    t('the pending-notification cache was kept', keys.includes('pending-nav'), JSON.stringify(keys));
  }
  await ctx2.close();
} finally { await browser.close(); }

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
