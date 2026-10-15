// verify:trainingpinned — D-185. Assigned training is at the top of the
// Operator View, open, whatever else is on the list.
//
// "Training not showing up for Jorge Tamez — it was assigned to him." The task
// was on his list: due fourteen days out it sat under "Later", which collapses
// once the day's work runs past five tasks, and a frequency filter hid it
// outright (training has no frequency). It is its own section now, first and
// always open.
//
// Caller sets PORT + DBPATH. Needs a built client. The control is the code
// before this change: the training card is not on screen.
import Database from 'better-sqlite3';
import { randomUUID as uuid } from 'crypto';
import { chromium } from 'playwright-core';

const URL = `http://localhost:${process.env.PORT || 5111}`;
let pass = 0, fail = 0;
const t = (n, ok, d = '') => { if (ok) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n}${d ? ' — ' + d : ''}`); } };
const day = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };

const db = new Database(process.env.DBPATH);
db.prepare(`INSERT OR REPLACE INTO users (id,name,username,role,department,is_active,setup_code,setup_code_expires_at,module_access)
  VALUES ('tp-op','Jorge Pinned','Jorge Pinned','operator','warehouse',1,'SC-tp-op',datetime('now','+7 day'),?)`).run(JSON.stringify({ operator: 'view' }));
const course = db.prepare('SELECT id, code, title FROM training_courses WHERE active = 1 ORDER BY code LIMIT 1').get();
const ins = db.prepare(`INSERT INTO work_orders (id, title, priority, due_date, status, task_group, assigned_to, assigned_to_id, training_course_id)
  VALUES (?, ?, 'normal', ?, 'open', ?, ?, ?, ?)`);
// A full day of warehouse work, so "Later" collapses.
for (let i = 0; i < 7; i++) ins.run(uuid(), `Warehouse walk ${i + 1}`, day(0), 'warehouse', null, null, null);
const trainId = uuid();
ins.run(trainId, `Training: ${course.code} — ${course.title}`, day(14), null, 'Jorge Pinned', 'tp-op', course.id);
db.close();

const H = { 'Content-Type': 'application/json' };
const post = (p, b) => fetch(`${URL}/api${p}`, { method: 'POST', headers: H, body: JSON.stringify(b) });
await post('/users/login', { name: 'Jorge Pinned' });
await post('/users/set-password', { user_id: 'tp-op', password: 'Pinned2026!!', setup_code: 'SC-tp-op' });
const auth = await (await post('/users/login', { name: 'Jorge Pinned', password: 'Pinned2026!!' })).json();
t('signed in', !!auth?.token);

const api = await (await fetch(`${URL}/api/pm/operator-tasks?group=warehouse`, { headers: { Authorization: `Bearer ${auth.token}` } })).json();
t('the server returns his training task (it always did)', Array.isArray(api) && api.some((r) => r.id === trainId));

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
for (const width of [390, 1280]) {
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  page.on('pageerror', (e) => { console.log('  [pageerror]', e.message); fail++; });
  await page.goto(`${URL}/manifest.webmanifest`);
  await page.evaluate(([tok, u]) => { localStorage.setItem('auth_token', tok); localStorage.setItem('auth_user', JSON.stringify(u)); }, [auth.token, auth.user]);
  await page.goto(`${URL}/`);
  try { await page.waitForSelector('[data-task-card]', { timeout: 20000 }); } catch { /* reported below */ }
  t(`${width}px: the training card is on screen without opening anything`, await page.isVisible(`[data-task-card="${trainId}"]`));
  t(`${width}px: it is in "Your training", above the day's work`, await page.evaluate((id) => {
    const sec = document.querySelector('[data-training-section]');
    const first = document.querySelector('[data-task-card]');
    return !!sec && !!sec.querySelector(`[data-task-card="${id}"]`) && first?.getAttribute('data-task-card') === id;
  }, trainId));
  t(`${width}px: it is not counted twice under the date buckets`, (await page.$$(`[data-task-card="${trainId}"]`)).length === 1);
  await page.close();
}
await browser.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
