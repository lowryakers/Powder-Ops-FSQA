// The four preventive controls through the live server: seeded at boot,
// reported as document-owned, the limit refused with PC_OWNED, the description
// open, an app-created CCP untouched, and the readiness section saying they
// match. Caller sets PORT + DBPATH.
const PORT = process.env.PORT || 4976; const URL = `http://localhost:${PORT}`;
let pass = 0, fail = 0;
const t = (n, c, d = '') => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (d ? ' — ' + d : '')); } };
const { default: Database } = await import('better-sqlite3');
{ const db = new Database(process.env.DBPATH);
  db.prepare(`INSERT OR REPLACE INTO users (id,name,username,role,department,is_active,setup_code,setup_code_expires_at)
    VALUES ('pc-qa','Quality Lead','Quality Lead','supervisor','qa',1,'SC-PC',datetime('now','+7 day'))`).run();
  db.prepare(`UPDATE users SET module_access = ? WHERE id = 'pc-qa'`).run(JSON.stringify({ equipment: 'edit', 'audit-readiness': 'view' }));
  db.close(); }
const H = { 'Content-Type': 'application/json' };
const call = (m, p, b, tok) => fetch(`${URL}/api${p}`, { method: m, headers: { ...H, ...(tok ? { Authorization: `Bearer ${tok}` } : {}) }, body: b ? JSON.stringify(b) : undefined });
await call('POST', '/users/login', { name: 'Quality Lead' });
await call('POST', '/users/set-password', { user_id: 'pc-qa', password: 'Quality2026!', setup_code: 'SC-PC' });
const auth = await (await call('POST', '/users/login', { name: 'Quality Lead', password: 'Quality2026!' })).json();
t('QA signed in', !!auth?.token);
const tok = auth.token;

const list = await (await call('GET', '/haccp', null, tok)).json();
const owned = list.filter(c => c.document_owned);
t('four preventive controls are in haccp_ccps after boot', owned.length === 4, `${list.length} rows, ${owned.length} owned`);
t('each names Protocol 003 V4 and its closed fields', owned.every(c => c.document === 'Protocol 003 V4' && c.owned_fields.includes('critical_limits') && c.owned_fields.includes('name')));
const pc4 = owned.find(c => /^PC #4/.test(c.name));
t('PC #4 is the X-ray control', !!pc4 && /x-ray/i.test(pc4.monitoring_procedure || ''));
const one = await (await call('GET', `/haccp/${pc4.id}`, null, tok)).json();
t('PC #4 is linked to the seeded X-ray equipment', (one.equipment || []).length >= 1, JSON.stringify(one.equipment));

let r = await call('PUT', `/haccp/${pc4.id}`, { critical_limits: 'Fe 9mm' }, tok);
let body = await r.json();
t('changing a transcribed critical limit is refused with PC_OWNED', r.status === 400 && body.code === 'PC_OWNED' && body.fields?.[0] === 'critical_limits', `${r.status} ${JSON.stringify(body)}`);
t('the refusal says where the change belongs', /Document Change Request/.test(body.error || ''));
r = await call('PUT', `/haccp/${pc4.id}`, { name: 'CCP 4' }, tok);
t('renaming it is refused too (the seeder key)', r.status === 400);
const after = await (await call('GET', `/haccp/${pc4.id}`, null, tok)).json();
t('the stored limit did not move', after.critical_limits === pc4.critical_limits);
r = await call('PUT', `/haccp/${pc4.id}`, { description: 'Records for this control live on paper until Keychain is live.' }, tok);
body = await r.json();
t('the description is open and saves', r.status === 200 && /Keychain/.test(body.description), `${r.status}`);
r = await call('PUT', `/haccp/${pc4.id}`, { critical_limits: pc4.critical_limits, description: 'unchanged limit sent back' }, tok);
t('sending the same limit back with the form is not a change', r.status === 200);

r = await call('POST', '/haccp', { name: 'CCP 9 — Metal detection (test)', critical_limits: 'Fe 1.5mm', monitoring_procedure: 'test pieces', corrective_action: 'hold back' }, tok);
const mine = await r.json();
t('an app-created CCP is not document-owned', r.status === 201 && mine.document_owned === false);
r = await call('PUT', `/haccp/${mine.id}`, { critical_limits: 'Fe 2.0mm', name: 'CCP 9 — Metal detection' }, tok);
t('and is exactly as editable as before', r.status === 200);

const ready = await (await call('GET', '/compliance/readiness-review', null, tok)).json();
const haccp = (ready.sections || ready || []).find?.(s => s.title === 'HACCP' || s.name === 'HACCP') || null;
const text = JSON.stringify(ready);
t('the readiness review says the controls match the document', /match Protocol 003 V4/.test(text), haccp ? JSON.stringify(haccp).slice(0, 200) : text.slice(0, 200));
const crit = await (await call('GET', '/compliance/critical', null, tok)).json();
t('the CCP evidence check runs with rows present and reports them', JSON.stringify(crit).includes('PC #4'));

console.log('\n── in the browser: Manage CCPs ──');
{
  const { chromium } = await import('playwright-core');
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on('pageerror', e => { console.log('  [pageerror]', e.message); fail++; });
  await page.goto(`${URL}/manifest.webmanifest`);
  await page.evaluate(([tk, u]) => { localStorage.setItem('auth_token', tk); localStorage.setItem('auth_user', JSON.stringify(u)); }, [tok, auth.user]);
  await page.goto(`${URL}/?tab=equipment`);
  await page.waitForTimeout(3500);
  await page.getByRole('button', { name: /Manage CCPs/ }).click();
  await page.waitForTimeout(800);
  t('the CCP list no longer reads "No CCPs defined yet"', !/No CCPs defined yet/.test(await page.locator('body').innerText()));
  t('four rows carry the Protocol 003 V4 chip', await page.locator('[data-ccp-document]').count() === 4);
  await page.locator(`[data-ccp="${pc4.id}"] button`).click();
  await page.waitForTimeout(400);
  t('the editor says the row is transcribed and names the DCR route', await page.locator('[data-ccp-lock]').count() === 1 && /Document Change Request/.test(await page.locator('[data-ccp-lock]').innerText()));
  const limitsBox = page.locator('textarea').filter({ hasText: pc4.critical_limits.slice(0, 20) }).first();
  t('the critical-limits box is disabled', await limitsBox.isDisabled());
  t('the description box is open', await page.locator('[data-ccp-description]').isEnabled());
  await browser.close();
}

console.log(`\n${pass}/${pass + fail} assertions passed`);
process.exit(fail ? 1 : 0);
