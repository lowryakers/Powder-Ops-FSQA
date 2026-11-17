// verify:peopleonboard — People → a DRAFT onboarding (D-354). Caller sets PORT + DBPATH.
// Control: main before this — a draft POST still mints a link, and People has no button.
import Database from 'better-sqlite3';
import { chromium } from 'playwright-core';

const PORT = Number(process.env.PORT || 5224);
const DBP = process.env.DBPATH || process.env.DB_PATH;
const URL = `http://localhost:${PORT}`;
const PW = 'PeopleOnb2026!!';
let pass = 0, fail = 0;
const t = (n, ok, d = '') => { if (ok) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.log(`  ✗ ${n}${d ? ' — ' + d : ''}`); } };
const q = (sql, ...a) => { const d = new Database(DBP, { readonly: true }); try { return d.prepare(sql).all(...a); } finally { d.close(); } };

const db = new Database(DBP);
db.prepare(`INSERT OR REPLACE INTO users (id,name,username,role,department,is_active,setup_code,setup_code_expires_at,module_access)
  VALUES ('po-office','Marta Office','Marta Office','supervisor','office',1,'SC-po',datetime('now','+7 day'),?)`).run(JSON.stringify({ candidates: 'edit', onboarding: 'edit' }));
db.prepare(`INSERT OR REPLACE INTO users (id,name,username,role,department,is_active,setup_code,setup_code_expires_at,module_access)
  VALUES ('po-hr2','Hana Noonb','Hana Noonb','supervisor','office',1,'SC-po2',datetime('now','+7 day'),?)`).run(JSON.stringify({ candidates: 'edit' }));
const cand = (id, name) => db.prepare(`INSERT OR REPLACE INTO candidates (id, name, phone, email, status, areas, tags) VALUES (?, ?, '8015550101', 'x@example.com', 'keep_warm', '[]', '[]')`).run(id, name);
cand('po-c1', 'Rosa Maria Linares'); cand('po-c2', 'Pedro Vega'); cand('po-c3', 'Lena Ortiz');
db.close();

const call = async (m, p, b, tok) => {
  const r = await fetch(`${URL}/api${p}`, { method: m, headers: { 'Content-Type': 'application/json', ...(tok && { Authorization: `Bearer ${tok}` }) }, body: b ? JSON.stringify(b) : undefined });
  let json = null; try { json = await r.json(); } catch { /* not json */ }
  return { status: r.status, json };
};
const login = async (id, name, code) => {
  await call('POST', '/users/set-password', { user_id: id, password: PW, setup_code: code });
  return (await call('POST', '/users/login', { name, password: PW })).json?.token;
};
const tok = await login('po-office', 'Marta Office', 'SC-po');
const tok2 = await login('po-hr2', 'Hana Noonb', 'SC-po2');
t('the office signs in', !!tok && !!tok2);

let r = await call('POST', '/onboarding', { draft: true, candidate_id: 'po-c2', first_name: 'Pedro', last_name: 'Vega', worker_type: 'contractor' }, tok);
t('a draft onboarding from People files', r.status === 201, `${r.status} ${JSON.stringify(r.json)}`);
t('…WITH NO LINK — nothing is sent yet', !r.json?.link && r.json?.is_draft === true && r.json?.candidate_id === 'po-c2');
t('…as a 1099 contractor', r.json?.is_contractor === true);
const draftId = r.json?.id;
r = await call('POST', '/onboarding', { draft: true, candidate_id: 'po-c2', first_name: 'Pedro', last_name: 'Vega' }, tok);
t('a second onboarding for the same person is refused while one is open', r.status === 409);
r = await call('POST', '/onboarding', { draft: true, candidate_id: 'po-c2', first_name: 'P', last_name: 'V' }, tok2);
t('someone without the Onboarding grant cannot start one', r.status === 403);
r = await call('POST', `/onboarding/${draftId}/reissue`, {}, tok);
t('Send link gives the link', r.status === 200 && /\/welcome\//.test(r.json?.link || ''));
r = await call('GET', '/onboarding', null, tok);
t('…and it is no longer a draft', (r.json?.records || []).find(x => x.id === draftId)?.is_draft === false);
r = await call('POST', '/onboarding', { first_name: 'Walk', last_name: 'In' }, tok);
t('an ordinary start still mints its link at once', r.status === 201 && /\/welcome\//.test(r.json?.link || '') && r.json?.is_draft === false);

console.log('\n── on the screen ──');
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ viewport: { width: 390, height: 860 } });
page.on('pageerror', e => { console.log('  [pageerror]', e.message); fail++; });
const me = (await call('GET', '/users/me', null, tok)).json;
await page.goto(`${URL}/manifest.webmanifest`);
await page.evaluate(([k, u]) => { localStorage.setItem('auth_token', k); localStorage.setItem('auth_user', JSON.stringify(u)); }, [tok, me]);
await page.goto(`${URL}/?tab=candidates`);
await page.waitForTimeout(3000);
t('People offers Start onboarding by edit and delete', await page.locator('[data-candidate-onboard="po-c1"]').count() === 1);
await page.locator('[data-candidate-onboard="po-c1"]').click();
await page.waitForTimeout(500);
t('…asking W-2 or 1099 and whether to keep them on People', await page.locator('[data-start-onboarding] [data-worker-type]').count() === 1 && await page.locator('[data-keep]').count() === 2);
const names = await page.locator('[data-start-onboarding] input').evaluateAll(els => els.slice(0, 2).map(e => e.value));
t('…with the name split into first and last', names[0] === 'Rosa' && names[1] === 'Maria Linares', JSON.stringify(names));
await page.locator('[data-start-onboarding-go]').click();
await page.waitForTimeout(1500);
const row = q("SELECT * FROM onboarding_records WHERE candidate_id = 'po-c1'")[0];
t('A DRAFT LINE IS IN ONBOARDING', !!row && !row.token_hash && !row.invited_at && row.phone === '8015550101');
t('…and Rosa is marked Hired on People', q("SELECT status FROM candidates WHERE id = 'po-c1'")[0]?.status === 'hired');
t('…the screen says where it went', await page.locator('[data-onboard-notice]').count() === 1);
await page.locator('[data-candidate-onboard="po-c3"]').click();
await page.waitForTimeout(400);
await page.locator('[data-keep="remove"]').check();
await page.locator('[data-start-onboarding-go]').click();
await page.waitForTimeout(1500);
t('"Remove from People" removes them, the draft stays', q("SELECT COUNT(*) n FROM candidates WHERE id = 'po-c3'")[0].n === 0
  && q("SELECT COUNT(*) n FROM onboarding_records WHERE candidate_id = 'po-c3'")[0].n === 1);
await page.goto(`${URL}/?tab=onboarding`);
await page.waitForTimeout(2500);
t('Onboarding lists the draft', await page.locator('[data-onboarding-draft]').count() >= 2);
t('nothing pans sideways on a phone', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
await browser.close();

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
