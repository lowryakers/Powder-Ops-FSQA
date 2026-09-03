// The attachment viewer, in a real browser: it lives on document.body, zooms
// the way a phone's photo app does, copies the IMAGE to the clipboard, and
// closes on a swipe down. Caller sets PORT + DBPATH and points R2_* at the S3
// stand-in (scripts/s3-stand-in.mjs) so a real PNG can be uploaded.
import { chromium } from 'playwright-core';

const PORT = process.env.PORT || 4931;
const URL = `http://localhost:${PORT}`;
let pass = 0, fail = 0;
const t = (n, c, d = '') => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (d ? ' — ' + d : '')); } };

const { default: Database } = await import('better-sqlite3');
{ const db = new Database(process.env.DBPATH);
  db.prepare(`INSERT OR REPLACE INTO users (id, name, username, role, department, is_active, setup_code, setup_code_expires_at)
    VALUES ('iv-a','Viewer Admin','Viewer Admin','admin','qa',1,'SC-IV', datetime('now','+7 day'))`).run();
  db.close(); }
const H = { 'Content-Type': 'application/json' };
const post = (p, body, headers = H) => fetch(`${URL}/api${p}`, { method: 'POST', headers, body: JSON.stringify(body) });
await post('/users/login', { name: 'Viewer Admin' });
await post('/users/set-password', { user_id: 'iv-a', password: 'Viewer2026!', setup_code: 'SC-IV' });
const auth = await (await post('/users/login', { name: 'Viewer Admin', password: 'Viewer2026!' })).json();
const A = { ...H, Authorization: `Bearer ${auth.token}` };
t('signed in', !!auth?.token);

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });

// A real PNG: the browser draws one for us.
const scratch = await browser.newPage({ viewport: { width: 640, height: 400 } });
await scratch.setContent('<div style="width:640px;height:400px;background:linear-gradient(135deg,#0ea5e9,#f59e0b);font:48px sans-serif;color:#fff;display:flex;align-items:center;justify-content:center">Screenshot 1</div>');
const png = await scratch.screenshot({ type: 'png' });
await scratch.close();

let cs = await (await fetch(`${URL}/api/comms/channels`, { headers: A })).json();
let list = cs.channels || cs;
if (!Array.isArray(list) || !list.length) {
  await post('/comms/channels', { name: 'general', kind: 'public' }, A);
  cs = await (await fetch(`${URL}/api/comms/channels`, { headers: A })).json(); list = cs.channels || cs;
}
const ch = list[0];
const fd = new FormData();
fd.append('files', new Blob([png], { type: 'image/png' }), 'line-3-screenshot.png');
const up = await (await fetch(`${URL}/api/comms/channels/${ch.id}/attachments`, { method: 'POST', headers: { Authorization: `Bearer ${auth.token}` }, body: fd })).json();
const ids = (up.attachments || up || []).map(x => x.id).filter(Boolean);
t('a PNG was uploaded through the real attachment path', ids.length === 1, JSON.stringify(up).slice(0, 160));
const msg = await (await post(`/comms/channels/${ch.id}/messages`, { body: `viewer target ${Date.now()}`, attachment_ids: ids }, A)).json();
t('posted with the image attached', msg?.attachments?.length === 1, JSON.stringify(msg).slice(0, 160));
// A one-page PDF too: on a phone it must be handed to the phone's own viewer.
const pdfBytes = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\nxref\n0 4\n0000000000 65535 f \n0000000009 00000 n \n0000000052 00000 n \n0000000101 00000 n \ntrailer<</Size 4/Root 1 0 R>>\nstartxref\n160\n%%EOF');
const fdp = new FormData();
fdp.append('files', new Blob([pdfBytes], { type: 'application/pdf' }), 'FORM-431-01.pdf');
const upp = await (await fetch(`${URL}/api/comms/channels/${ch.id}/attachments`, { method: 'POST', headers: { Authorization: `Bearer ${auth.token}` }, body: fdp })).json();
const pdfIds = (upp.attachments || upp || []).map(x => x.id).filter(Boolean);
await post(`/comms/channels/${ch.id}/messages`, { body: `pdf target ${Date.now()}`, attachment_ids: pdfIds }, A);

const thumb = (page) => page.locator('img[alt="line-3-screenshot.png"]').last();
async function signedIn(ctx) {
  const page = await ctx.newPage();
  page.on('pageerror', e => console.log('  [pageerror]', e.message));
  await page.goto(`${URL}/manifest.webmanifest`);
  await page.evaluate(([tok, u]) => { localStorage.setItem('auth_token', tok); localStorage.setItem('auth_user', JSON.stringify(u)); }, [auth.token, auth.user]);
  await page.goto(`${URL}/chat`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4000);
  // The compact layout lands on the channel LIST and picks nothing; open the
  // channel the way a person would.
  if (await thumb(page).count() === 0) {
    const row = page.getByText(ch.name, { exact: true }).first();
    if (await row.count()) { await row.click(); await page.waitForTimeout(3000); }
  }
  return page;
}
const viewer = (page) => page.locator('body > [data-attachment-viewer]');
const stageImg = (page) => viewer(page).locator('img').first();
const scaleOf = async (page) => page.evaluate(() => {
  const img = document.querySelector('[data-attachment-viewer] img');
  const m = /scale\(([\d.]+)\)/.exec(img?.style.transform || '');
  return m ? Number(m[1]) : 1;
});

console.log('\nOn a phone');
const mobile = await browser.newContext({ viewport: { width: 390, height: 800 }, isMobile: true, hasTouch: true, permissions: ['clipboard-read', 'clipboard-write'] });
let page = await signedIn(mobile);
await thumb(page).scrollIntoViewIfNeeded();
t('the thumbnail carries a Copy button', await page.locator('[data-copy-image]').last().isVisible());
await thumb(page).tap();
await page.waitForTimeout(500);
t('THE VIEWER IS A DIRECT CHILD OF BODY, outside the message and the swipe pane', await viewer(page).count() === 1);
t('it names the file', /line-3-screenshot\.png/.test(await viewer(page).innerText()));
t('Copy is the first action', await viewer(page).locator('[data-action="copy"]').isVisible());
t('at fit nothing sits on the picture', await viewer(page).locator('[data-zoom-pill]').count() === 0);

const box = await stageImg(page).boundingBox();
const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
await page.touchscreen.tap(cx, cy); await page.waitForTimeout(80); await page.touchscreen.tap(cx, cy);
await page.waitForTimeout(400);
const s1 = await scaleOf(page);
t('DOUBLE-TAP ZOOMS IN (2.5×)', s1 > 2 && s1 < 3, String(s1));
if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT });
t('and the zoom pill appears, saying how far and how to get back', /2\.5×/.test(await viewer(page).locator('[data-zoom-pill]').innerText().catch(() => '')));
await viewer(page).locator('[data-zoom-pill]').tap();
await page.waitForTimeout(400);
t('tapping the pill returns to fit', (await scaleOf(page)) === 1);

await viewer(page).locator('[data-action="copy"]').tap();
await page.waitForTimeout(1500);
t('Copy says so', /Copied/.test(await viewer(page).innerText()));
const clip = await page.evaluate(async () => {
  try { const items = await navigator.clipboard.read(); return items.flatMap(i => i.types); } catch (e) { return `error: ${e.message}`; }
});
t('THE IMAGE ITSELF IS ON THE CLIPBOARD as image/png', Array.isArray(clip) && clip.includes('image/png'), JSON.stringify(clip));

// Swipe down at fit closes — dispatched as real touch events on the stage.
const closedBySwipe = await page.evaluate(() => new Promise(resolve => {
  const stage = document.querySelector('[data-attachment-viewer] img')?.parentElement;
  if (!stage) return resolve('no stage');
  const mk = (type, y) => new TouchEvent(type, { bubbles: true, cancelable: true,
    touches: type === 'touchend' ? [] : [new Touch({ identifier: 1, target: stage, clientX: 195, clientY: y })],
    changedTouches: [new Touch({ identifier: 1, target: stage, clientX: 195, clientY: y })] });
  stage.dispatchEvent(mk('touchstart', 300));
  let y = 300;
  const step = () => {
    y += 40; stage.dispatchEvent(mk('touchmove', y));
    if (y < 460) return setTimeout(step, 16);
    stage.dispatchEvent(mk('touchend', y));
    setTimeout(() => resolve(!document.querySelector('[data-attachment-viewer]')), 300);
  };
  setTimeout(step, 16);
}));
t('SWIPE DOWN CLOSES THE VIEWER', closedBySwipe === true, String(closedBySwipe));
// The PDF card on a phone.
const pdfBtn = page.getByText('FORM-431-01.pdf', { exact: false }).last();
await pdfBtn.scrollIntoViewIfNeeded();
await pdfBtn.tap();
await page.waitForTimeout(500);
t('A PDF ON A PHONE IS HANDED TO THE PHONE\'S OWN VIEWER, not drawn in a frame that cannot pinch',
  await viewer(page).locator('[data-pdf-card]').count() === 1 && await viewer(page).locator('iframe').count() === 0);
t('...with an Open link that leaves the app for the document', await viewer(page).locator('[data-pdf-card] a[target="_blank"]').count() === 1);
await page.keyboard.press('Escape');
await mobile.close();

console.log('\nOn a desktop');
const desktop = await browser.newContext({ viewport: { width: 1280, height: 900 } });
page = await signedIn(desktop);
await thumb(page).scrollIntoViewIfNeeded();
await thumb(page).click();
await page.waitForTimeout(500);
t('the viewer opens', await viewer(page).count() === 1);
t('zoom controls are offered to a mouse user', await viewer(page).locator('[data-zoom-controls]').isVisible());
await viewer(page).locator('[data-zoom-controls] button[aria-label="Zoom in"]').click();
await page.waitForTimeout(300);
t('zoom in → 125%', /125%/.test(await viewer(page).locator('[data-zoom-controls]').innerText()) && Math.abs((await scaleOf(page)) - 1.25) < 0.01, `${await scaleOf(page)}`);
await page.keyboard.press('0');
await page.waitForTimeout(300);
t('the 0 key returns to fit', (await scaleOf(page)) === 1);
const b2 = await stageImg(page).boundingBox();
await page.mouse.move(b2.x + b2.width / 2, b2.y + b2.height / 2);
await page.mouse.wheel(0, -300);
await page.waitForTimeout(300);
t('the wheel zooms', (await scaleOf(page)) > 1.1, `${await scaleOf(page)}`);
await page.keyboard.press('Escape');
await page.waitForTimeout(300);
t('Escape closes it', await viewer(page).count() === 0);
const pdfRow = page.getByText('FORM-431-01.pdf', { exact: false }).last();
await pdfRow.scrollIntoViewIfNeeded();
await pdfRow.click();
await page.waitForTimeout(500);
t('on a desktop the PDF is embedded full-frame', await viewer(page).locator('iframe').count() === 1);
await page.keyboard.press('Escape');
await desktop.close();
await browser.close();

console.log(`\n${pass}/${pass + fail} assertions passed`);
process.exit(fail ? 1 : 0);
