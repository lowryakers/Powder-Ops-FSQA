// verify:messagelists — a numbered list with bullets under each number reads
// 1, 2, 3 in Messages (D-268).
//
// Lowry's update to Daniela was "1. Heading / - bullet / - bullet / 2. Heading
// / - bullet …". Each run of bullets started a new list, so every heading after
// it restarted at "1." and the bullets sat at the same level as the numbers.
// Posts that exact shape and reads the rendered message in a real browser.
// Caller sets PORT + DBPATH (the runner boots the server).
// Control: restore the old renderBody — the five headings read 1, 1, 1, 1, 1.
import Database from 'better-sqlite3';
import { chromium } from 'playwright-core';

const PORT = Number(process.env.PORT || 5161);
const URL = `http://localhost:${PORT}`;
const DBP = process.env.DBPATH || process.env.DB_PATH;
let pass = 0, fail = 0;
const t = (n, ok, d = '') => { if (ok) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n}${d ? ' — ' + d : ''}`); } };

const db = new Database(DBP);
const mk = (id, name, role) => db.prepare(`INSERT OR REPLACE INTO users
  (id,name,username,role,department,is_active,setup_code,setup_code_expires_at,module_access)
  VALUES (?,?,?,?, 'office',1,?,datetime('now','+7 day'),?)`).run(id, name, name, role, `SC-${id}`, JSON.stringify({ operator: 'view' }));
mk('ml-a', 'Lowry Lists', 'supervisor');
mk('ml-b', 'Dani Reader', 'operator');

const H = { 'Content-Type': 'application/json' };
const signIn = async (name, id) => {
  const post = (p, b) => fetch(`${URL}/api${p}`, { method: 'POST', headers: H, body: JSON.stringify(b) });
  await post('/users/login', { name });
  await post('/users/set-password', { user_id: id, password: 'Lists2026!!xx', setup_code: `SC-${id}` });
  return (await post('/users/login', { name, password: 'Lists2026!!xx' })).json();
};
const A = await signIn('Lowry Lists', 'ml-a');
const dm = await (await fetch(`${URL}/api/comms/dm/ml-b`, { method: 'POST', headers: { ...H, Authorization: `Bearer ${A.token}` } })).json();

const BODY = [
  'Here are today\'s updates:',
  '1. Crisis Management Drill (new)',
  '- Find it under Safety',
  '- Two people sign it',
  '2. Training records',
  '- Each record now has the method',
  '3. Recording training for a whole group',
  '- Pick the course and tick everyone',
  '4. Training videos',
  '- Videos show on the task',
  '5. Why documents said 1.0',
  '- The import dropped the version',
  '',
  'Plain bullets still work:',
  '- one',
  '- two',
  '',
  '7. a list that starts at seven',
].join('\n');
const r = await fetch(`${URL}/api/comms/channels/${dm.id}/messages`, { method: 'POST', headers: { ...H, Authorization: `Bearer ${A.token}` }, body: JSON.stringify({ body: BODY }) });
t('the message posts', r.status < 300);

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
await page.goto(`${URL}/manifest.webmanifest`);
await page.evaluate(([tok, u, id]) => {
  localStorage.setItem('auth_token', tok); localStorage.setItem('auth_user', JSON.stringify(u));
  localStorage.setItem('comms_last_channel', id); localStorage.setItem('comms_last_view', 'channel');
}, [A.token, A.user, dm.id]);
await page.goto(`${URL}/chat`);
await page.waitForSelector('[data-msg-scroll] >> text=Crisis Management Drill', { timeout: 15000 }).catch(() => {});
const shape = await page.evaluate(() => {
  const msg = [...document.querySelectorAll('[data-msg-scroll] [data-mid]')].find(e => e.textContent.includes('Crisis Management Drill'));
  if (!msg) return null;
  const ols = [...msg.querySelectorAll('ol')];
  const top = ols[0];
  return {
    ols: ols.length,
    headings: top ? [...top.children].map(li => li.firstChild?.textContent?.trim().slice(0, 20)) : [],
    nestedCounts: top ? [...top.children].map(li => li.querySelectorAll(':scope > ul > li').length) : [],
    topLevelUl: [...msg.querySelectorAll('ul:not([data-nested-list])')].map(u => u.children.length),
    lastStart: ols[1]?.getAttribute('start') || null,
  };
});
t('the five headings are ONE numbered list (reads 1–5, not 1, 1, 1, 1, 1)', shape?.headings?.length === 5, JSON.stringify(shape));
t('each heading carries its bullets underneath it', JSON.stringify(shape?.nestedCounts) === '[2,1,1,1,1]', JSON.stringify(shape?.nestedCounts));
t('a plain bullet list after a paragraph is still its own list', JSON.stringify(shape?.topLevelUl) === '[2]', JSON.stringify(shape?.topLevelUl));
t('a numbered list starts at the number typed', shape?.lastStart === '7', String(shape?.lastStart));
await browser.close();

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
