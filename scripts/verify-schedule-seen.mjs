// Executed, not asserted: today's runs on the Operator View and the "I've seen
// this week's schedule" button (D-298). A floor account with only the default
// Operator View reads its team's runs for the plant's today, with the MO's
// allergen / gown line; presses Seen (a write it is allowed and nothing else);
// a second press files nothing; a new publish asks again; the list names who
// has seen it. Then both screens in a real browser. Needs a built client.
import { chromium } from 'playwright-core';
import { plantDateOf } from '../server/plant-clock.js';
const PORT = process.env.PORT || 5175;
const URL = `http://localhost:${PORT}`;
const B = `${URL}/api`;
const J = async (r) => { try { return await r.json(); } catch { return null; } };
let token = null;
const req = (p, o = {}) => fetch(B + p, { ...o, headers: {
  'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(o.headers || {}) } });
const post = (p, b) => req(p, { method: 'POST', body: JSON.stringify(b) });
let pass = 0, fail = 0;
const t = (n, c, d = '') => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (d ? ' — ' + d : '')); } };

const today = plantDateOf();
const d = new Date(`${today}T12:00:00Z`);
const dow = (d.getUTCDay() + 6) % 7;
const WEEK = new Date(d.getTime() - dow * 86400000).toISOString().slice(0, 10);
const weekend = dow > 4;

const { default: Database } = await import('better-sqlite3');
{
  const db = new Database(process.env.DBPATH);
  const mk = (id, name, role, dept, access) => db.prepare(`INSERT OR REPLACE INTO users
    (id,name,username,role,department,is_active,setup_code,setup_code_expires_at,module_access)
    VALUES (?,?,?,?,?,1,'SEED-CODE',datetime('now','+7 day'),?)`).run(id, name, name, role, dept, access);
  mk('ss-op', 'Flo Filler', 'operator', 'filling', null);   // default Operator View only
  mk('ss-adm', 'Ada Admin', 'admin', 'admin', null);
  if (!weekend) {
    const ins = db.prepare(`INSERT INTO production_schedule (id, week_start, day_of_week, room, slot, room_type, team, mo_number, product_name, start_time, notes, created_by)
      VALUES (?, ?, ?, ?, ?, 'production', ?, ?, ?, ?, ?, 'verify')`);
    ins.run('ss-1', WEEK, dow, '6', 0, 'Filling', 'MO77001', 'Buttermilk Pancake', '06:30', 'Change film after lot 2');
    ins.run('ss-2', WEEK, dow, '7', 0, 'Filling', 'MO77002', 'Vanilla Whey', '', null);
    ins.run('ss-3', WEEK, dow, 'Batching 1', 0, 'Batching', 'MO77001', 'Buttermilk Pancake Blend', '05:00', null);
  }
  db.close();
}
const login = async (id, name, password) => {
  await req('/users/set-password', { method: 'POST', body: JSON.stringify({ user_id: id, password, setup_code: 'SEED-CODE' }) });
  return (await J(await req('/users/login', { method: 'POST', body: JSON.stringify({ name, password }) })))?.token;
};
const opTok = await login('ss-op', 'Flo Filler', 'FloSecret2026');
const admTok = await login('ss-adm', 'Ada Admin', 'AdaSecret2026');
t('a floor account and an admin signed in', !!opTok && !!admTok);

console.log('\n── today ──');
token = admTok;
await req('/production/mo-allergens', { method: 'PUT', body: JSON.stringify({ mo_number: 'MO77001', allergens: ['Milk', 'Wheat'], gown_teams: ['Filling'] }) });
token = opTok;
let today1 = await J(await req('/production/schedule/today?team=filling'));
if (weekend) {
  t('a weekend has no runs (and says so)', today1?.weekend === true && today1.runs.length === 0);
} else {
  t("the floor account reads Filling's runs for the plant's today", today1?.team === 'Filling' && today1.runs.length === 2, JSON.stringify(today1));
  const r1 = today1.runs.find(r => r.mo_number === 'MO77001');
  t('each run names its room', r1?.room_label === 'Room 6');
  t('the allergen MO carries its line, gown YES for Filling', r1?.allergen_line === 'Allergen: Milk, Wheat · Disposable gown: YES', r1?.allergen_line);
  t('an MO with nothing recorded carries no line', today1.runs.find(r => r.mo_number === 'MO77002')?.allergen_line === null);
  t('another team\'s run is not on Filling\'s card', !today1.runs.some(r => r.team !== 'Filling'));
}
t('a department that is not a production team gets nothing', (await J(await req('/production/schedule/today?team=qa')))?.team === null);

console.log('\n── seen ──');
let r = await post('/production/schedule/acknowledge', { week_start: WEEK });
let v = await J(r);
t('the floor account can press Seen', r.status === 200 && !!v?.my_seen_at, `${r.status} ${JSON.stringify(v)}`);
t('…and is named in the list', v?.seen?.some(s => s.name === 'Flo Filler'));
r = await post('/production/schedule/acknowledge', { week_start: WEEK });
v = await J(r);
t('a second press files nothing new', v?.seen?.filter(s => s.name === 'Flo Filler').length === 1);
t('the Seen write did not open the schedule to edits', (await post('/production/schedule', { week_start: WEEK, day_of_week: 0, room: '6', team: 'Filling' })).status === 403);
token = admTok;
for (const name of ['batching', 'filling-team', 'kitting', 'production_schedule']) await post('/comms/channels', { name });
await post('/production/schedule/notify', { kind: 'updated', week_start: WEEK });
token = opTok;
v = await J(await req(`/production/schedule/seen?week_start=${WEEK}`));
t('a new publish asks again', v?.my_seen_at === null && v?.updated_since_seen === true && v?.seen?.length === 0, JSON.stringify(v));
r = await post('/production/schedule/acknowledge', { week_start: WEEK });
v = await J(r);
t('pressing again records the new publish', !!v?.my_seen_at && v.seen.length === 1);
{
  const db = new Database(process.env.DBPATH, { readonly: true });
  const n = db.prepare(`SELECT COUNT(*) n FROM audit_log WHERE entity_type = 'production_schedule' AND action = 'acknowledge' AND entity_id = ?`).get(WEEK).n;
  db.close();
  t('each Seen is audited once per publish (2)', n === 2, String(n));
}

console.log('\n── screens ──');
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
{
  const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  await page.goto(`${URL}/manifest.webmanifest`);
  await page.evaluate(([tok, usr]) => { localStorage.setItem('auth_token', tok); localStorage.setItem('auth_user', JSON.stringify(usr)); },
    [opTok, { id: 'ss-op', name: 'Flo Filler', role: 'operator', department: 'filling' }]);
  await page.goto(`${URL}/?tab=operator`);
  if (!weekend) {
    await page.waitForSelector('[data-today-schedule]', { timeout: 8000 }).catch(() => {});
    t('390px: the Operator View shows "Today — Filling"', (await page.locator('[data-today-schedule]').innerText().catch(() => '')).includes('Today — Filling'));
    t('390px: two runs, one with the allergen line', await page.locator('[data-today-run]').count() === 2 && await page.locator('[data-today-allergen]').count() === 1);
  }
  t('390px: no sideways scroll', !(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)));
}
{
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  await page.goto(`${URL}/manifest.webmanifest`);
  await page.evaluate(([tok, usr]) => { localStorage.setItem('auth_token', tok); localStorage.setItem('auth_user', JSON.stringify(usr)); },
    [admTok, { id: 'ss-adm', name: 'Ada Admin', role: 'admin', department: 'admin' }]);
  await page.goto(`${URL}/?tab=production-schedule`);
  await page.waitForSelector('[data-schedule-seen]', { timeout: 8000 }).catch(() => {});
  t('1280px: the schedule shows the Seen button', await page.locator('[data-seen-button]').count() === 1);
  t('1280px: and "Seen by 1"', (await page.locator('[data-seen-count]').innerText()).startsWith('Seen by 1'));
  await page.locator('[data-seen-button]').click();
  await page.waitForSelector('[data-seen-mine]', { timeout: 5000 }).catch(() => {});
  t('1280px: pressing it says "You saw this week\'s schedule"', await page.locator('[data-seen-mine]').count() === 1);
  t('1280px: now "Seen by 2"', (await page.locator('[data-seen-count]').innerText()).startsWith('Seen by 2'));
  await page.locator('[data-seen-count]').click();
  t('1280px: the names open', (await page.locator('[data-seen-names]').innerText()).includes('Flo Filler'));
}
await browser.close();
console.log(`\n${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
