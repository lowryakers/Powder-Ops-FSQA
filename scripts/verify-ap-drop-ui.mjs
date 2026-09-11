// AP Drop in a real browser: the office lands on Outstanding, an operator on
// the drop zone; a file goes through the picker, shows up as dropped, opens
// in the drawer, and a status move with a reason lands. Caller sets PORT +
// DBPATH + the R2 stand-in; needs a built client.
import { chromium } from 'playwright-core';
import { writeFileSync } from 'fs';
const PORT = process.env.PORT || 4991;
const URL = `http://localhost:${PORT}`;
let pass = 0, fail = 0;
const t = (n, c, d = '') => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (d ? ' — ' + d : '')); } };
const { default: Database } = await import('better-sqlite3');
const { default: PDFDocument } = await import('pdfkit');
{ const db = new Database(process.env.DBPATH);
  for (const [id, name, role, dept, code, ma] of [
    ['ui-office', 'Office Lead', 'supervisor', 'office', 'SC-UO', { sanitation: 'view' }],
    ['ui-op', 'Floor Hand', 'operator', 'production', 'SC-UP', { sanitation: 'view' }],
  ]) db.prepare(`INSERT OR REPLACE INTO users (id,name,username,role,department,is_active,setup_code,setup_code_expires_at,module_access)
    VALUES (?,?,?,?,?,1,?,datetime('now','+7 day'),?)`).run(id, name, name, role, dept, code, JSON.stringify(ma));
  db.close(); }
const H = { 'Content-Type': 'application/json' };
const post = (p, b) => fetch(`${URL}/api${p}`, { method: 'POST', headers: H, body: JSON.stringify(b) });
const signIn = async (name, id, code) => {
  await post('/users/login', { name });
  await post('/users/set-password', { user_id: id, password: 'Drop2026!!', setup_code: code });
  return (await post('/users/login', { name, password: 'Drop2026!!' })).json();
};
const office = await signIn('Office Lead', 'ui-office', 'SC-UO');
const op = await signIn('Floor Hand', 'ui-op', 'SC-UP');
t('signed in', !!office?.token && !!op?.token);
const pdfPath = '/tmp/ap-drop-ui.pdf';
await new Promise(res => { const doc = new PDFDocument(); const c = []; doc.on('data', x => c.push(x)); doc.on('end', () => { writeFileSync(pdfPath, Buffer.concat(c)); res(); });
  ['Blue Sky Labels Inc', 'INVOICE', 'Invoice No: BSL-771', 'Invoice Date: 09/02/2026', 'Due Date: 10/02/2026', 'PO # 5120', 'Amount Due $1,240.00'].forEach(l => doc.text(l)); doc.end(); });

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const asUser = async (auth, width = 1280) => {
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  page.on('pageerror', e => { console.log('  [pageerror]', e.message); fail++; });
  page.on('console', m => { if (m.type() === 'error') console.log('  [console]', m.text().slice(0, 300)); });
  await page.goto(`${URL}/manifest.webmanifest`);
  await page.evaluate(([tok, u]) => { localStorage.setItem('auth_token', tok); localStorage.setItem('auth_user', JSON.stringify(u)); }, [auth.token, auth.user]);
  await page.goto(`${URL}/?tab=ap-drop`);
  return page;
};

// Operator: lands on the drop zone, drops a file through the picker.
let page = await asUser(op);
try { await page.waitForSelector('[data-ap-dropzone]', { timeout: 20000 }); }
catch (e) { await page.screenshot({ path: '/tmp/ap-drop-ui-fail.png', fullPage: true }); console.log('  page text:', (await page.textContent('body')).slice(0, 400)); throw e; }
t('an operator without a finance grant reaches AP Drop and lands on the drop zone', await page.isVisible('[data-ap-dropzone]'));
t('a paper invoice can be photographed: camera input AND choose-from-roll input both exist', !!(await page.$('[data-photo-picker="ap-drop"] [data-photo-take][capture]')) && !!(await page.$('[data-photo-picker="ap-drop"] [data-photo-choose]')));
await page.setInputFiles('[data-ap-file]', pdfPath);
await page.fill('textarea', 'Forwarded from the vendor');
await page.click('[data-ap-submit]');
try { await page.waitForSelector('[data-ap-done]', { timeout: 30000 }); }
catch (e) { await page.screenshot({ path: '/tmp/ap-drop-ui-fail.png', fullPage: true }); console.log('  form text:', (await page.textContent('form')).slice(0, 600)); throw e; }
const done = await page.textContent('[data-ap-done]');
t('the drop confirms what was read', /Blue Sky Labels/.test(done) && /1,240\.00/.test(done), done);
await page.waitForSelector('[data-ap-row]');
t('it appears under Recent drops', (await page.$$('[data-ap-row]')).length === 1);
await page.click('[data-ap-row]');
await page.waitForSelector('[data-ap-drawer]');
t('the drawer opens with the fields read', (await page.textContent('[data-ap-value="invoice_number"]')) === 'BSL-771');
t('an operator sees no status control', !(await page.isVisible('[data-ap-status]')));
t('…and no edit button', !(await page.isVisible('[data-ap-edit]')));
await page.fill('[data-ap-note]', 'Handed to me at the dock');
await page.press('[data-ap-note]', 'Enter');
await page.waitForFunction(() => /Handed to me at the dock/.test(document.querySelector('[data-ap-activity]')?.textContent || ''));
t('a note lands in the activity log', true);
await page.close();

// Office: lands on Outstanding, sees the drop, moves it with a reason.
page = await asUser(office);
await page.waitForSelector('[data-ap-table]', { timeout: 20000 });
t('the office lands on the Outstanding queue', await page.isVisible('[data-ap-table]'));
t('the operator’s drop is on it', (await page.$$('[data-ap-row]')).length === 1 && /Blue Sky Labels/.test(await page.textContent('[data-ap-table]')));
await page.click('[data-ap-row]');
await page.waitForSelector('[data-ap-status]');
await page.selectOption('[data-ap-status]', 'needs_info');
await page.click('[data-ap-move]');
await page.waitForFunction(() => /Say why/.test(document.querySelector('[data-ap-drawer]')?.textContent || ''));
t('needs info without a reason is refused in words', true);
await page.fill('[data-ap-reason]', 'PO 5120 is not in the system');
await page.click('[data-ap-move]');
await page.waitForFunction(() => /Current reason: PO 5120/.test(document.querySelector('[data-ap-drawer]')?.textContent || ''));
t('the reason lands and shows on the drawer', true);
await page.click('[data-ap-edit]');
await page.fill('[data-ap-field="vendor_name"]', 'Blue Sky Labels, Inc.');
await page.click('[data-ap-save]');
await page.waitForFunction(() => document.querySelector('[data-ap-value="vendor_name"]')?.textContent === 'Blue Sky Labels, Inc.');
t('a corrected vendor sticks', true);
await page.keyboard.press('Escape');
await page.waitForFunction(() => !document.querySelector('[data-ap-drawer]'));
await page.waitForFunction(() => /Needs info/.test(document.querySelector('[data-ap-table]')?.textContent || '') && /PO 5120/.test(document.querySelector('[data-ap-table]')?.textContent || ''));
t('the queue row shows the new status and the blocker', true);
await page.selectOption('[data-ap-status-filter]', 'paid');
await page.waitForSelector('[data-ap-empty]');
t('an empty filter reads the empty-state line', /Drop it here or forward it to ap@powder-ops\.com/.test(await page.textContent('[data-ap-empty]')));
const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
t('no horizontal page overflow at 1280', !overflow);
await page.close();

// Phone width: cards, not a table, and the page does not pan.
page = await asUser(office, 360);
await page.waitForSelector('[data-ap-cards]', { timeout: 20000 });
t('at 360px the queue renders as cards', await page.isVisible('[data-ap-cards]'));
t('no horizontal page overflow at 360', !(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)));
await page.close();
await browser.close();
console.log(`\n${pass}/${pass + fail} assertions passed`); process.exit(fail ? 1 : 0);
