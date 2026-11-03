// A photo attached to a newsletter card appears in the PDF.
//
// Reported by Marnee: photos on the cards showed in the editor and were missing
// from the preview PDF. Two causes, both checked here:
//   1. the PDF is made from the SAVED issue, and the PDF button did not save
//      first, so a photo just attached was only on the screen;
//   2. the PDF library draws JPEG and PNG only, so a WebP (or HEIC, GIF) was
//      skipped without a word.
// The editor now saves before the PDF and turns any photo into a JPEG before
// uploading; the server refuses a photo the PDF could not draw.
// Caller sets PORT + DBPATH and points R2_* at the S3 stand-in.
import { chromium } from 'playwright-core';

const PORT = process.env.PORT || 4932;
const URL = `http://localhost:${PORT}`;
let pass = 0, fail = 0;
const t = (n, c, d = '') => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (d ? ' — ' + d : '')); } };

const { default: Database } = await import('better-sqlite3');
{ const db = new Database(process.env.DBPATH);
  db.prepare(`INSERT OR REPLACE INTO users (id, name, username, role, department, is_active, setup_code, setup_code_expires_at)
    VALUES ('nl-a','Newsletter Admin','Newsletter Admin','admin','office',1,'SC-NL', datetime('now','+7 day'))`).run();
  db.close(); }
const H = { 'Content-Type': 'application/json' };
const post = (p, body, headers = H) => fetch(`${URL}/api${p}`, { method: 'POST', headers, body: JSON.stringify(body) });
await post('/users/set-password', { user_id: 'nl-a', password: 'Newsletter2026!', setup_code: 'SC-NL' });
const auth = await (await post('/users/login', { name: 'Newsletter Admin', password: 'Newsletter2026!' })).json();
const A = { ...H, Authorization: `Bearer ${auth.token}` };
t('signed in', !!auth?.token);

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });

// Real image bytes, drawn by the browser: a PNG and a WebP of the same picture.
const scratch = await browser.newPage({ viewport: { width: 400, height: 300 } });
await scratch.setContent('<canvas id="c" width="400" height="300"></canvas>');
const { png, webp } = await scratch.evaluate(() => {
  const c = document.getElementById('c'); const g = c.getContext('2d');
  g.fillStyle = '#f59e0b'; g.fillRect(0, 0, 400, 300); g.fillStyle = '#0ea5e9'; g.fillRect(50, 50, 300, 200);
  const b64 = (u) => u.split(',')[1];
  return { png: b64(c.toDataURL('image/png')), webp: b64(c.toDataURL('image/webp', 0.9)) };
});
await scratch.close();
const pngBuf = Buffer.from(png, 'base64'), webpBuf = Buffer.from(webp, 'base64');
t('the test WebP really is a WebP', webpBuf.slice(8, 12).toString() === 'WEBP');

const upload = async (buf, name, type) => {
  const fd = new FormData(); fd.append('files', new Blob([buf], { type }), name);
  const r = await fetch(`${URL}/api/newsletter/images`, { method: 'POST', headers: { Authorization: `Bearer ${auth.token}` }, body: fd });
  return { status: r.status, body: await r.json().catch(() => ({})) };
};
const w = await upload(webpBuf, 'party.webp', 'image/webp');
t('THE SERVER REFUSES A PHOTO THE PDF CANNOT DRAW (415), naming it', w.status === 415 && /party\.webp/.test(w.body.error || ''), JSON.stringify(w));
const p = await upload(pngBuf, 'party.png', 'image/png');
t('a PNG is accepted', p.status === 201 && p.body.images?.length === 1, JSON.stringify(p).slice(0, 160));

// A card, then an issue built from it.
await post('/newsletter/cards', { kind: 'events', title: 'Halloween potluck', body: 'Thanks to everyone who brought food.' }, A);
const issue = await (await post('/newsletter/issues', {}, A)).json();
const section = (issue.sections || []).find(s => s.title === 'Halloween potluck');
t('the issue carries the card', !!section);

// In the browser: attach the WebP to the card, then press PDF WITHOUT saving.
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();
page.on('pageerror', e => console.log('  [pageerror]', e.message));
await page.goto(`${URL}/manifest.webmanifest`);
await page.evaluate(([tok, u]) => { localStorage.setItem('auth_token', tok); localStorage.setItem('auth_user', JSON.stringify(u)); }, [auth.token, auth.user]);
await page.goto(`${URL}/?tab=newsletter`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(3000);
await page.getByRole('button', { name: 'Newsletters', exact: true }).click();
await page.waitForTimeout(800);
await page.getByRole('button', { name: 'Open', exact: true }).first().click();
await page.waitForTimeout(1200);

if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT });
const uploaded = page.waitForResponse(r => r.url().includes('/api/newsletter/images') && r.request().method() === 'POST');
await page.setInputFiles(`#img-${section.id}`, { name: 'party.webp', mimeType: 'image/webp', buffer: webpBuf });
const up = await uploaded;
t('A WEBP CHOSEN IN THE EDITOR UPLOADS (the editor turned it into a JPEG)', up.status() === 201, String(up.status()));
await page.waitForTimeout(800);
t('the photo shows on the card', await page.locator('img[src*="newsletter"]').count() >= 1);

const pdfResp = page.waitForResponse(r => /\/api\/newsletter\/issues\/[^/]+\/pdf/.test(r.url()));
await page.getByRole('button', { name: 'PDF', exact: true }).click();
t('the PDF opened', (await pdfResp).status() === 200);
await page.waitForTimeout(500);
// The same PDF the button just made, read back to count what it draws.
const pdf = Buffer.from(await (await fetch(`${URL}/api/newsletter/issues/${issue.id}/pdf?lang=en`, { headers: A })).arrayBuffer());
const imagesInPdf = (pdf.toString('latin1').match(/\/Subtype\s*\/Image/g) || []).length;
t('PRESSING PDF WITHOUT SAVING STILL PUTS THE PHOTO IN THE PDF', imagesInPdf >= 1, `${imagesInPdf} images in a ${pdf.length}-byte PDF`);

const saved = await (await fetch(`${URL}/api/newsletter/issues/${issue.id}`, { headers: A })).json();
const savedSection = saved.sections.find(s => s.id === section.id);
t('...because PDF saved the issue first', !!savedSection?.image_id);
const db = new Database(process.env.DBPATH, { readonly: true });
const row = db.prepare('SELECT content_type, filename FROM newsletter_images WHERE id = ?').get(savedSection?.image_id || '');
db.close();
t('the stored photo is a JPEG', row?.content_type === 'image/jpeg' && /\.jpg$/.test(row?.filename || ''), JSON.stringify(row));

await browser.close();
console.log(`\n${pass}/${pass + fail} assertions passed`);
process.exit(fail ? 1 : 0);
