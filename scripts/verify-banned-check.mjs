// verify:bannedcheck — D-202 (roadmap C3, CAR 4990682-3 (a)). Every material we
// approve is checked against the banned / prohibited substance lists, and the
// check names the editions it was made against — read from the annual review,
// never typed. "Approved" is gated off / warn / on (the D-063 shape).
//
// Caller sets PORT + DBPATH on a fresh database. Needs a built client. The
// control is `main` before the change: no check route, no gate.
import crypto from 'crypto';
import Database from 'better-sqlite3';
import { chromium } from 'playwright-core';

const PORT = process.env.PORT || 5122;
const URL = `http://localhost:${PORT}`;
let pass = 0, fail = 0;
const t = (n, ok, d = '') => { if (ok) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n}${d ? ' — ' + d : ''}`); } };

const db = new Database(process.env.DBPATH);
const mk = (id, name, role, dept) => db.prepare(`INSERT OR REPLACE INTO users (id, name, username, role, department, is_active, setup_code, setup_code_expires_at, module_access)
  VALUES (?,?,?,?,?,1,?, datetime('now','+7 day'), ?)`).run(id, name, name, role, dept, `SC-${id}`, JSON.stringify({ suppliers: 'edit' }));
mk('bc-maria', 'Bc Maria', 'supervisor', 'qa');
mk('bc-jake', 'Bc Jake', 'supervisor', 'purchasing');
mk('bc-admin', 'Bc Admin', 'admin', 'admin');
db.prepare(`INSERT INTO suppliers (id, name, actively_using) VALUES ('bc-s', 'Bc Ingredients', 1)`).run();
db.prepare(`INSERT INTO suppliers (id, name, actively_using) VALUES ('bc-empty', 'Bc No Materials', 1)`).run();
const mat = (id, desc, maker) => db.prepare(`INSERT INTO supplier_materials (id, supplier_id, item_description, manufacturer_name) VALUES (?, 'bc-s', ?, ?)`).run(id, desc, maker);
mat('bc-m1', 'Potassium citrate', 'Daffodil Pharmachem');
mat('bc-m2', 'Natural flavor', 'Bc Flavor House');

const H = { 'Content-Type': 'application/json' };
const post = (p, b, h = H) => fetch(`${URL}/api${p}`, { method: 'POST', headers: h, body: JSON.stringify(b) });
const put = (p, b, h) => fetch(`${URL}/api${p}`, { method: 'PUT', headers: h, body: JSON.stringify(b) });
const get = async (p, h) => (await fetch(`${URL}/api${p}`, { headers: h })).json();
const signIn = async (name, id) => {
  await post('/users/login', { name });
  await post('/users/set-password', { user_id: id, password: 'BannedCheck2026!', setup_code: `SC-${id}` });
  const a = await (await post('/users/login', { name, password: 'BannedCheck2026!' })).json();
  return { auth: a, h: { ...H, Authorization: `Bearer ${a.token}` } };
};
const M = await signIn('Bc Maria', 'bc-maria');
const J = await signIn('Bc Jake', 'bc-jake');
const AD = await signIn('Bc Admin', 'bc-admin');
t('signed in', !!M.auth.token && !!J.auth.token && !!AD.auth.token);
const RISK = Object.fromEntries((await get('/suppliers', M.h)).risk_criteria.map(c => [c.key, 'low']));
const decide = (sid, disposition, h = M.h) => post(`/suppliers/${sid}/disposition`, { disposition, period_label: '2026', risk_criteria: RISK, notes: disposition === 'approved' ? '' : 'Deficiency noted.' }, h);
const check = (mid, result, notes, h = M.h) => post(`/suppliers/bc-s/materials/${mid}/banned-check`, { result, notes }, h);

console.log('\n── no review, no check ──');
let r = await check('bc-m1', 'not_listed');
t('with no annual banned-list review on file, a check is REFUSED (409)', r.status === 409, String(r.status));
t('…and the refusal says to record the review first', /review/i.test((await r.json()).error || ''));

const review1 = crypto.randomUUID();
db.prepare(`INSERT INTO banned_list_reviews (id, reviewed_on, reviewed_by, editions) VALUES (?, '2026-01-15', 'Bc Maria', ?)`)
  .run(review1, JSON.stringify({ nsf306_annex_c: '2025', nfl_nflpa: '2025', mlb: '2025', wada: '2026' }));

console.log('\n── the check ──');
r = await check('bc-m1', 'not_listed', '', J.h);
t('Purchasing cannot record one — it is Quality\'s check (403)', r.status === 403, String(r.status));
r = await check('bc-m2', 'listed', '');
t('"listed" without a note is refused', r.status === 400);
r = await check('bc-m1', 'not_listed');
const b1 = await r.json();
t('Quality records "not on any list"', r.status === 201, String(r.status));
t('…THE EDITIONS ARE THE REVIEW\'S, frozen on the check', b1.check?.editions?.wada === '2026' && b1.check?.editions?.nsf306_annex_c === '2025' && b1.check?.review_id === review1, JSON.stringify(b1.check?.editions));
r = await check('bc-m1', 'not_listed', '', { ...M.h }); // a second check is a new row, never an edit
t('a second check is a new row', db.prepare("SELECT COUNT(*) c FROM supplier_banned_checks WHERE material_id = 'bc-m1'").get().c === 2);
let d = await get('/suppliers/bc-s', M.h);
t('the supplier reads one material current and one not checked', d.material_checks.find(m => m.id === 'bc-m1')?.banned_state === 'current' && d.material_checks.find(m => m.id === 'bc-m2')?.banned_state === 'none');
t('the gap names the unchecked material', d.banned.gaps.length === 1 && /Natural flavor/.test(d.banned.gaps[0].reason), JSON.stringify(d.banned.gaps));
t('the gate starts in WARN', d.banned.mode === 'warn');

console.log('\n── warn: approves and records the gap ──');
r = await decide('bc-s', 'approved');
const w = await r.json();
t('approval goes through under warn', r.ok, String(r.status));
t('…carrying the gap in its answer', w.banned_gaps?.length === 1 && w.banned_gate_mode === 'warn');
const q = db.prepare("SELECT banned_check_gaps, banned_gate_mode FROM supplier_qualifications WHERE supplier_id = 'bc-s'").get();
t('…and STAMPED on the qualification', JSON.parse(q?.banned_check_gaps || '[]').length === 1 && q.banned_gate_mode === 'warn', JSON.stringify(q));
t('a supplier with no materials is a gap too', (await get('/suppliers/bc-empty', M.h)).banned.gaps[0]?.state === 'no_materials');

console.log('\n── on: refuses "approved" until every material is checked ──');
r = await put('/suppliers/banned-gate', { mode: 'on' }, M.h);
t('only an admin turns the gate', r.status === 403, String(r.status));
r = await put('/suppliers/banned-gate', { mode: 'on' }, AD.h);
t('an admin turns it on', r.ok && (await r.json()).mode === 'on');
r = await decide('bc-s', 'approved');
const refused = await r.json();
t('APPROVAL IS REFUSED with a material unchecked (409)', r.status === 409, String(r.status));
t('…naming the material', /Natural flavor/.test(refused.error || ''), refused.error);
r = await decide('bc-s', 'conditionally_approved');
t('a conditional decision is not gated (it is not a clearance)', r.ok, String(r.status));
r = await check('bc-m2', 'listed', 'WADA S0 — contains a listed stimulant');
t('a material recorded as ON a list', r.status === 201);
r = await decide('bc-s', 'approved');
t('…still blocks approval', r.status === 409 && /ON a banned list/.test((await r.json()).error || ''));
await check('bc-m2', 'not_listed', 'Reformulated — supplier letter on file');
r = await decide('bc-s', 'approved');
t('once every material is checked clear, approval goes through', r.ok, String(r.status));

console.log('\n── a new annual review makes the checks stale ──');
db.prepare(`INSERT INTO banned_list_reviews (id, reviewed_on, reviewed_by, editions) VALUES (?, date('now'), 'Bc Maria', ?)`)
  .run(crypto.randomUUID(), JSON.stringify({ nsf306_annex_c: '2026', nfl_nflpa: '2026', mlb: '2026', wada: '2027' }));
d = await get('/suppliers/bc-s', M.h);
t('every material reads "check again"', d.material_checks.every(m => m.banned_state === 'stale'), d.material_checks.map(m => m.banned_state).join(','));
r = await decide('bc-s', 'approved');
t('…and under "on" the next approval waits for the recheck', r.status === 409);
await put('/suppliers/banned-gate', { mode: 'warn' }, AD.h);
t('audited: the check and the gate change', db.prepare("SELECT COUNT(*) c FROM audit_log WHERE action IN ('supplier_banned_check','supplier_banned_gate_changed')").get().c >= 6);
db.close();

console.log('\n── the screen ──');
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
try {
  for (const [w, h] of [[1280, 900], [390, 844]]) {
    const page = await browser.newPage({ viewport: { width: w, height: h } });
    page.on('pageerror', (e) => { console.log('  [pageerror]', e.message); fail++; });
    await page.goto(`${URL}/manifest.webmanifest`);
    await page.evaluate(([tok, u]) => { localStorage.setItem('auth_token', tok); localStorage.setItem('auth_user', JSON.stringify(u)); }, [M.auth.token, M.auth.user]);
    await page.goto(`${URL}/?tab=suppliers`);
    await page.getByText('Bc Ingredients').locator('visible=true').first().click({ timeout: 20000 }).catch(() => {});
    await page.waitForSelector('[data-material-checks]:visible', { timeout: 10000 }).catch(() => {});
    t(`${w}px: the supplier shows each material with its check`, await page.locator('[data-banned-state]:visible').count() === 2
      && await page.locator(w === 1280 ? '[data-banned-state="stale"]:visible' : '[data-banned-state="current"]:visible').count() >= 1);
    t(`${w}px: it names the review the editions come from`, /annual review of/.test(await page.locator('[data-banned-review]:visible').first().textContent().catch(() => '')));
    if (w === 1280) {
      await page.locator('[data-banned-clear="bc-m1"]:visible').first().click().catch(() => {});
      await page.waitForSelector('[data-material="bc-m1"] [data-banned-state="current"]:visible', { timeout: 8000 }).catch(() => {});
      t('1280px: "Not on any list" records the check and the chip turns green', await page.locator('[data-material="bc-m1"] [data-banned-state="current"]:visible').count() === 1);
      await page.getByRole('button', { name: /Record a disposition/ }).locator('visible=true').first().click().catch(() => {});
      await page.locator('input[name="disposition"][value="approved"]').check({ timeout: 8000 }).catch(() => {});
      await page.waitForSelector('[data-banned-gaps]:visible', { timeout: 8000 }).catch(() => {});
      t('1280px: choosing Approved shows the open gap before the button is pressed', /Natural flavor/.test(await page.locator('[data-banned-gaps]:visible').textContent().catch(() => '')));
    }
    t(`${w}px: no sideways pan`, await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    await page.close();
  }
} finally { await browser.close(); }

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
