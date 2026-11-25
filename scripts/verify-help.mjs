// D-397: one Help page — what's new, how-tos, why the app does that.
//
// What this proves, in a real browser:
//   - Help is in the sidebar for an employee and opens on What's new + guides;
//   - a person sees only the guides for screens they can open (an admin sees the
//     Settings guides, a supervisor does not; the floor sees floor guides);
//   - search narrows to the matching guides; ?view=<guide> opens one guide;
//   - Español shows the plant's Spanish on a floor guide;
//   - "Open it" goes to the screen;
//   - the ⓘ beside a page title lists that screen's guides and opens one;
//   - the search box (⌘K) finds a guide by its question;
//   - an Operator-View-only account keeps the floor layout and opens Help from its header.
// Caller sets PORT + DBPATH on a FRESH database.
import { chromium } from 'playwright-core';
import { WHATS_NEW } from '../src/data/help.js';

const PORT = process.env.PORT || 5255;
const URL = `http://localhost:${PORT}`;
let pass = 0, fail = 0;
const t = (n, c, d = '') => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (d ? ' — ' + d : '')); } };

const { default: Database } = await import('better-sqlite3');
const db = new Database(process.env.DBPATH);
db.pragma('busy_timeout = 10000');
const mkUser = (id, name, role, dept, ma) => db.prepare(`INSERT OR REPLACE INTO users (id, name, username, role, department, is_active, module_access, setup_code, setup_code_expires_at)
  VALUES (?, ?, ?, ?, ?, 1, ?, ?, datetime('now','+7 day'))`).run(id, name, name, role, dept, ma, `SC-${id}`);
mkUser('hp-a', 'Help Admin', 'admin', 'admin', null);
mkUser('hp-s', 'Help Supervisor', 'supervisor', 'qa', JSON.stringify({ pm: 'edit', calibration: 'edit' }));
mkUser('hp-o', 'Help Operator', 'operator', 'cleaning', JSON.stringify({ operator: 'view' }));

const H = { 'Content-Type': 'application/json' };
const call = async (method, p, body, headers = H) => {
  const r = await fetch(`${URL}/api${p}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  let j = null; try { j = await r.json(); } catch { /* no body */ }
  return { status: r.status, body: j };
};
const login = async (id, name, pw) => {
  await call('POST', '/users/set-password', { user_id: id, password: pw, setup_code: `SC-${id}` });
  const r = await call('POST', '/users/login', { name, password: pw });
  return { token: r.body?.token, user: r.body?.user };
};
const A = await login('hp-a', 'Help Admin', 'HelpAdmin2026!');
const S = await login('hp-s', 'Help Supervisor', 'HelpSuper2026!');
const O = await login('hp-o', 'Help Operator', 'HelpOper2026!');
t('signed in an admin, a supervisor and a floor account', !!A.token && !!S.token && !!O.token);

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const as = async (who, path, width = 1280) => {
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  await page.goto(`${URL}/manifest.webmanifest`);
  await page.evaluate(([tk, u]) => { localStorage.setItem('auth_token', tk); localStorage.setItem('auth_user', JSON.stringify(u)); }, [who.token, who.user]);
  await page.goto(`${URL}${path}`);
  return page;
};
const has = async (page, sel) => (await page.locator(sel).count()) > 0;

try {
  console.log('\n── an admin ──');
  let page = await as(A, '/?tab=help');
  await page.waitForSelector('[data-help-page]', { timeout: 15000 });
  t('Help is in the sidebar', await has(page, 'nav >> text=Help'));
  t("What's new lists the latest change", await has(page, `[data-help-news-item="${WHATS_NEW[0].d}"]`), WHATS_NEW[0].d);
  t('an admin sees the Settings guides', await has(page, '[data-help-guide="give-module-access"]'));
  t('…and the floor guides', await has(page, '[data-help-guide="complete-a-task"]'));
  t('"Why does the app do that?" is on the page', await has(page, '[data-help-rules]'));

  await page.fill('[data-help-search]', 'password');
  await page.waitForTimeout(150);
  t('search: "password" keeps the password guides', await has(page, '[data-help-guide="reset-a-password"]') && await has(page, '[data-help-guide="password-to-sign"]'));
  t('…and drops the others', !(await has(page, '[data-help-guide="complete-a-task"]')));
  await page.fill('[data-help-search]', '');

  await page.click('[data-help-guide="give-module-access"] button[aria-expanded]');
  t('a guide opens to its numbered steps', (await page.locator('[data-help-guide="give-module-access"] ol li').count()) >= 3);
  await page.click('[data-help-open="give-module-access"]');
  await page.waitForTimeout(800);
  t('"Open it" goes to the screen', !(await has(page, '[data-help-page]')) && (await page.locator('text=Users').count()) > 0);
  await page.close();

  page = await as(A, '/?tab=help&view=reset-a-password');
  await page.waitForSelector('[data-help-page]', { timeout: 15000 });
  t('?view=<guide> opens that guide', (await page.locator('[data-help-guide="reset-a-password"] ol li').count()) >= 3);
  await page.click('[data-help-lang="es"]');
  await page.fill('[data-help-search]', 'tarea teléfono');
  await page.waitForTimeout(150);
  t('Español shows the plant Spanish on a floor guide', await has(page, '[data-help-guide="complete-a-task"] >> text=¿Cómo completo una tarea en mi teléfono?'));
  await page.close();

  console.log('\n── a supervisor ──');
  page = await as(S, '/?tab=pm');
  await page.waitForSelector('[data-page-info]', { timeout: 15000 });
  await page.click('[data-page-info]');
  t('the ⓘ on Task Center lists its guide', await has(page, '[data-page-guide="who-sees-a-task"]'));
  await page.click('[data-page-guide="who-sees-a-task"]');
  await page.waitForSelector('[data-help-page]', { timeout: 10000 });
  t('…and opens it on the Help page', (await page.locator('[data-help-guide="who-sees-a-task"] ol li').count()) >= 3);
  t('a supervisor does not see the admin guides', !(await has(page, '[data-help-guide="give-module-access"]')));
  t('…nor guides for screens they cannot open', !(await has(page, '[data-help-guide="revise-an-sop"]')));
  t('…but sees the Calibration guide they can use', await has(page, '[data-help-guide="correct-scale-room"]'));

  // Close the guide first, so opening it from the search box is what reopens it.
  await page.click('[data-help-guide="who-sees-a-task"] button[aria-expanded]');
  t('…the guide closes again', (await page.locator('[data-help-guide="who-sees-a-task"] ol li').count()) === 0);
  await page.keyboard.press('Control+k');
  await page.waitForTimeout(300);
  await page.keyboard.type('recurring task');
  await page.waitForTimeout(300);
  const hit = page.locator('button:has-text("Who sees a recurring task")');
  t('the search box finds a guide by its question', (await hit.count()) > 0);
  if (await hit.count()) {
    await hit.first().click();
    await page.waitForTimeout(400);
    t('…and choosing it opens that guide', (await page.locator('[data-help-guide="who-sees-a-task"] ol li').count()) >= 3);
  }
  await page.close();

  console.log('\n── an Operator-View-only account ──');
  page = await as(O, '/', 390);
  await page.waitForSelector('[data-floor-help]', { timeout: 15000 });
  t('keeps the floor layout (no sidebar), with a Help button', !(await has(page, 'nav >> text=Dashboard')));
  await page.click('[data-floor-help]');
  await page.waitForSelector('[data-floor-help-panel] [data-help-page]', { timeout: 10000 });
  t('Help opens over the task list', await has(page, '[data-help-guide="complete-a-task"]'));
  t('…without the supervisor or admin guides', !(await has(page, '[data-help-guide="who-sees-a-task"]')) && !(await has(page, '[data-help-guide="give-module-access"]')));
  const sw = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
  t('no sideways scroll at 390px', sw);
  await page.close();
} finally {
  await browser.close();
}

console.log(`\n${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
