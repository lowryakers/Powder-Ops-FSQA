// verify:employees — People, Onboarding, Time Tracking, Pay Tracking and
// Policies are one "Employees" entry with tabs (D-357). Caller sets PORT + DBPATH.
// Control: main before this — the sidebar has no Employees entry.
import Database from 'better-sqlite3';
import { chromium } from 'playwright-core';

const PORT = Number(process.env.PORT || 5227);
const DBP = process.env.DBPATH || process.env.DB_PATH;
const URL = `http://localhost:${PORT}`;
const PW = 'Employees2026!!';
let pass = 0, fail = 0;
const t = (n, ok, d = '') => { if (ok) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n}${d ? ' — ' + d : ''}`); } };

const db = new Database(DBP);
const mk = (id, name, role, dept, ma) => db.prepare(`INSERT OR REPLACE INTO users (id,name,username,role,department,is_active,setup_code,setup_code_expires_at,module_access)
  VALUES (?,?,?,?,?,1,?,datetime('now','+7 day'),?)`).run(id, name, name, role, dept, `SC-${id}`, ma ? JSON.stringify(ma) : null);
mk('eh-admin', 'Ada Admin', 'admin', 'admin', null);
mk('eh-sup', 'Sid Super', 'supervisor', 'filling', { operator: 'view', 'pay-tracking': 'edit' });
mk('eh-op', 'Oli Op', 'operator', 'filling', { operator: 'view' });
db.close();

const call = async (m, p, b, tok) => {
  const r = await fetch(`${URL}/api${p}`, { method: m, headers: { 'Content-Type': 'application/json', ...(tok && { Authorization: `Bearer ${tok}` }) }, body: b ? JSON.stringify(b) : undefined });
  let json = null; try { json = await r.json(); } catch { /* not json */ }
  return { status: r.status, json };
};
const login = async (id, name) => {
  await call('POST', '/users/set-password', { user_id: id, password: PW, setup_code: `SC-${id}` });
  return (await call('POST', '/users/login', { name, password: PW })).json?.token;
};
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const open = async (id, name, path, width = 1280) => {
  const tok = await login(id, name);
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  page.on('pageerror', e => { console.log('  [pageerror]', e.message); fail++; });
  const me = (await call('GET', '/users/me', null, tok)).json;
  await page.goto(`${URL}/manifest.webmanifest`);
  await page.evaluate(([k, u]) => { localStorage.setItem('auth_token', k); localStorage.setItem('auth_user', JSON.stringify(u)); localStorage.removeItem('hub-employees'); localStorage.removeItem('module_tab_hub-employees'); }, [tok, me]);
  await page.goto(`${URL}${path}`);
  await page.waitForTimeout(3000);
  return page;
};
const tabLabels = async (page) => (await page.locator('[data-module-tab], [role="tab"]').allInnerTexts()).map(s => s.trim().replace(/\s+\d+$/, '')).filter(Boolean);

let page = await open('eh-admin', 'Ada Admin', '/?tab=employees');
const side = await page.locator('nav, aside').first().innerText().catch(() => '');
t('the sidebar has Employees', /Employees/.test(side));
t('…and no longer lists Pay Tracking, Onboarding or People on their own', !/\nPay Tracking\n/.test(`\n${side}\n`) && !/\nOnboarding\n/.test(`\n${side}\n`) && !/\nPeople\n/.test(`\n${side}\n`));
const labels = await tabLabels(page);
t('ITS TABS RUN People → Onboarding → Time Tracking → Pay Tracking → Policies', JSON.stringify(labels.filter(l => ['People', 'Onboarding', 'Time Tracking', 'Pay Tracking', 'Policies'].includes(l))) === JSON.stringify(['People', 'Onboarding', 'Time Tracking', 'Pay Tracking', 'Policies']), JSON.stringify(labels));
await page.goto(`${URL}/?tab=onboarding`);
await page.waitForTimeout(2500);
t('an old link to Onboarding lands on its tab', /Start an onboarding|Onboarding/.test(await page.locator('main').innerText()) && (await tabLabels(page)).includes('People'));
await page.goto(`${URL}/?tab=time-tracking`);
await page.waitForTimeout(2500);
t('an old link to Time Tracking still opens it for an admin', (await page.locator('main').innerText()).includes('Time Tracking'));
await page.close();

page = await open('eh-sup', 'Sid Super', '/?tab=pay-tracking');
const supTabs = await tabLabels(page);
t('someone with only Pay Tracking sees Employees with just that tab', supTabs.includes('Pay Tracking') && !supTabs.includes('Onboarding') && !supTabs.includes('Time Tracking') && !supTabs.includes('People'), JSON.stringify(supTabs));
await page.close();

page = await open('eh-op', 'Oli Op', '/');
const opSide = await page.locator('nav, aside').first().innerText().catch(() => '');
t('an operator with none of them has no Employees entry', !/Employees/.test(opSide));
await page.close();

page = await open('eh-admin', 'Ada Admin', '/?tab=employees', 390);
t('on a phone nothing pans sideways', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
await page.close();
await browser.close();

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
