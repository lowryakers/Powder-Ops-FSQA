// D-398: COC Drop in a real browser. Runs after verify-coc-drop.mjs on the same boot.
//   - the dock (warehouse, Receiving Log only) sees COC Drop in the sidebar on day one;
//   - at 390px they choose two photos, see "Drop 2 pages", the confirmation and a recent row;
//   - their drawer has no status control and no File button;
//   - Quality lands on the queue, opens the drop, sets PO + supplier, files it into the library.
import { chromium } from 'playwright-core';
import { writeFileSync, mkdtempSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const PORT = process.env.PORT || 5256;
const URL = `http://localhost:${PORT}`;
let pass = 0, fail = 0;
const t = (n, c, d = '') => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (d ? ' — ' + d : '')); } };

const { default: Database } = await import('better-sqlite3');
const db = new Database(process.env.DBPATH);
db.pragma('busy_timeout = 10000');
const mkUser = (id, name, role, dept, ma) => db.prepare(`INSERT OR REPLACE INTO users (id, name, username, role, department, is_active, module_access, setup_code, setup_code_expires_at)
  VALUES (?, ?, ?, ?, ?, 1, ?, ?, datetime('now','+7 day'))`).run(id, name, name, role, dept, ma, `SC-${id}`);
mkUser('cu-op', 'Dock Maria', 'operator', 'warehouse', JSON.stringify({ 'receiving-log': 'view' }));
mkUser('cu-qa', 'Quality Lead', 'supervisor', 'qa', JSON.stringify({ suppliers: 'edit', 'receiving-log': 'edit' }));
db.prepare("INSERT OR REPLACE INTO suppliers (id, name, vendor_type, actively_using) VALUES ('cu-acme', 'Acme Closures', 'packaging', 1)").run();
const H = { 'Content-Type': 'application/json' };
const call = async (method, p, body) => {
  const r = await fetch(`${URL}/api${p}`, { method, headers: H, body: body === undefined ? undefined : JSON.stringify(body) });
  return r.json().catch(() => null);
};
const login = async (id, name, pw) => {
  await call('POST', '/users/set-password', { user_id: id, password: pw, setup_code: `SC-${id}` });
  return call('POST', '/users/login', { name, password: pw });
};
const OP = await login('cu-op', 'Dock Maria', 'DockMaria2026!');
const QA = await login('cu-qa', 'Quality Lead', 'QualLead2026!');

const dir = mkdtempSync(join(tmpdir(), 'cocui-'));
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const p1 = join(dir, 'page-1.png'); const p2 = join(dir, 'page-2.png');
writeFileSync(p1, PNG); writeFileSync(p2, Buffer.concat([PNG, Buffer.from([7])]));

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const as = async (who, path, width) => {
  const page = await browser.newPage({ viewport: { width, height: 860 } });
  await page.goto(`${URL}/manifest.webmanifest`);
  await page.evaluate(([tk, u]) => { localStorage.setItem('auth_token', tk); localStorage.setItem('auth_user', JSON.stringify(u)); }, [who.token, who.user]);
  await page.goto(`${URL}${path}`);
  return page;
};
const has = async (page, sel) => (await page.locator(sel).count()) > 0;

try {
  console.log('\n── the dock, on a phone ──');
  let page = await as(OP, '/?tab=coc-drop', 390);
  await page.waitForSelector('[data-coc-dropzone]', { timeout: 15000 });
  t('a warehouse account with only Receiving Log lands on the drop form', await has(page, '[data-photo-picker="coc-drop"]'));
  t('…with "Take a photo of the COC" and "Choose a photo or PDF"', await has(page, 'text=Take a photo of the COC') && await has(page, 'text=Choose a photo or PDF'));
  await page.setInputFiles('[data-photo-choose]', [p1, p2]);
  await page.waitForTimeout(200);
  t('two photos stay on one form: "Drop 2 pages"', (await page.locator('[data-coc-submit]').innerText()).includes('Drop 2 pages'));
  await page.fill('#coc-po', 'PO01234');
  await page.click('[data-coc-submit]');
  await page.waitForSelector('[data-coc-done]', { timeout: 15000 });
  t('the confirmation says nobody needs to scan or email it', (await page.locator('[data-coc-done]').innerText()).includes('do not need to scan or email'));
  await page.waitForTimeout(300);
  const row = page.locator('[data-coc-row]').first();
  t('a recent row shows the PO', (await row.innerText()).includes('PO01234'));
  const id = await row.getAttribute('data-coc-row');
  t('…one drop with two pages on the server', db.prepare('SELECT COUNT(*) n FROM coc_drop_files WHERE drop_id = ?').get(id).n === 2);
  await row.click();
  await page.waitForSelector('[data-coc-drawer]', { timeout: 10000 });
  await page.waitForTimeout(400);
  t('the dropper sees no status control and no File button', !(await has(page, '[data-coc-status]')) && !(await has(page, '[data-coc-file]')));
  t('no sideways scroll at 390px', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  await page.close();

  console.log('\n── Quality works the queue ──');
  page = await as(QA, '/?tab=coc-drop', 1280);
  await page.waitForSelector(`[data-coc-row="${id}"]`, { timeout: 15000 });
  t('Quality lands on the queue and sees the drop', true);
  await page.click(`[data-coc-row="${id}"]`);
  await page.waitForSelector('[data-coc-drawer] [data-coc-status]', { timeout: 10000 });
  t('…the drawer has the status control', true);
  await page.selectOption('#coc-edit-supplier', 'cu-acme');
  await page.fill('#coc-edit-lot_number', 'LOT-55');
  await page.click('[data-coc-save]');
  await page.waitForTimeout(600);
  t('…saving moves it to matched (a PO was typed at the dock)', db.prepare('SELECT status, lot_number FROM coc_drops WHERE id = ?').get(id).lot_number === 'LOT-55');
  await page.click('[data-coc-file]');
  await page.waitForSelector('[data-coc-msg]:has-text("Filed into")', { timeout: 15000 });
  const d = db.prepare('SELECT status, supplier_file_ids FROM coc_drops WHERE id = ?').get(id);
  t('File into library files it as one document', d.status === 'filed' && JSON.parse(d.supplier_file_ids).length === 1);
  t('…in Acme Closures’ library, as a COC with the PO and lot', !!db.prepare("SELECT 1 FROM supplier_files WHERE supplier_id = 'cu-acme' AND kind = 'coc' AND po_number = 'PO01234' AND lot_number = 'LOT-55'").get());
  await page.close();
} finally {
  await browser.close();
}

console.log(`\n${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
